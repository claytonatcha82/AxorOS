(() => {
  const originalFetch = window.fetch.bind(window);
  const REVIEW_PATH = '/api/v1/control/sales-email/review-draft';
  let apiBaseUrl = '';
  let latestHeaders = {};
  let actionInFlight = false;

  function capture(input, init, response) {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    if (typeof requestUrl === 'string') {
      try {
        const parsed = new URL(requestUrl, window.location.href);
        if (parsed.origin !== window.location.origin) apiBaseUrl = parsed.origin;
      } catch {}
    }
    if (init?.headers) {
      latestHeaders = init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : { ...init.headers };
    }
    if (response?.url) {
      try {
        const parsed = new URL(response.url, window.location.href);
        if (parsed.origin !== window.location.origin) apiBaseUrl = parsed.origin;
      } catch {}
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    capture(args[0], args[1], response);
    return response;
  };

  function setMessage(card, message, error = false) {
    const section = card?.closest('.sales-live-drafts-section');
    if (!section) return;
    let node = section.querySelector('.sales-draft-fallback-message');
    if (!node) {
      node = document.createElement('div');
      node.className = 'sales-live-draft-confirmation sales-draft-fallback-message';
      section.prepend(node);
    }
    node.textContent = message;
    node.style.borderColor = error ? '#7f1d1d' : '';
  }

  async function review(button, decision) {
    if (actionInFlight) return;
    const card = button.closest('.sales-live-draft-card');
    const draftId = button.getAttribute('data-draft-id');
    if (!card || !draftId) return;

    if (!apiBaseUrl || !Object.keys(latestHeaders).length) {
      setMessage(card, 'Control Centre has not captured the authenticated API session yet. Please refresh once and try again.', true);
      return;
    }

    actionInFlight = true;
    const buttons = card.querySelectorAll('button');
    buttons.forEach((item) => { item.disabled = true; });
    button.textContent = decision === 'approved' ? 'Creating Gmail draft…' : 'Rejecting draft…';
    setMessage(card, decision === 'approved' ? 'Creating Gmail draft…' : 'Rejecting draft…');

    try {
      const response = await originalFetch(`${apiBaseUrl}${REVIEW_PATH}`, {
        method: 'POST',
        headers: { ...latestHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ draftRecordId: draftId, decision }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }

      if (decision === 'approved') {
        const gmailDraftId = payload?.data?.review?.gmailDraftId;
        setMessage(card, gmailDraftId
          ? `Gmail draft created (${gmailDraftId}). The email has not been sent.`
          : 'Gmail draft created. The email has not been sent.');
      } else {
        setMessage(card, 'Sales draft rejected for revision.');
      }

      card.remove();
      window.dispatchEvent(new CustomEvent('axoros:sales-draft-reviewed', { detail: { draftId, decision } }));
    } catch (error) {
      buttons.forEach((item) => { item.disabled = false; });
      button.textContent = decision === 'approved' ? 'Approve & create Gmail draft' : 'Reject for revision';
      setMessage(card, `Sales draft review failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      actionInFlight = false;
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('.sales-draft-approve, .sales-draft-reject')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void review(target, target.classList.contains('sales-draft-approve') ? 'approved' : 'rejected');
  }, true);
})();
