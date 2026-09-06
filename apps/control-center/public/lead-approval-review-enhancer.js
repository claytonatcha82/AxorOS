(() => {
  const DETAILS_PATH = '/api/v1/control/lead-qualification-review/details';
  const originalFetch = window.fetch.bind(window);
  let latestApprovals = [];
  let latestHeaders = {};
  let apiBaseUrl = '';

  const style = document.createElement('style');
  style.textContent = `.lead-review-details{margin-top:16px;border:1px solid rgba(127,127,127,.25);border-radius:12px;padding:12px 14px;background:rgba(127,127,127,.06)}.lead-review-details summary{cursor:pointer;font-weight:700}.lead-review-section{margin-top:16px}.lead-review-section h4{margin:0 0 8px}.lead-review-field{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:10px;padding:7px 0;border-top:1px solid rgba(127,127,127,.16)}.lead-review-field span{white-space:pre-wrap;overflow-wrap:anywhere}.lead-review-code-field{display:block}.lead-review-code-field pre{margin:7px 0 0;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.lead-review-safety-note{margin:16px 0 0;padding:10px;border-radius:8px;font-weight:600}.approval-actions button:disabled{opacity:.45;cursor:not-allowed}`;
  document.head.append(style);

  const text = (value) => value === null || value === undefined || value === '' ? '—' : String(value);
  const pretty = (value) => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  };

  function field(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lead-review-field';
    const title = document.createElement('strong');
    title.textContent = label;
    const content = document.createElement('span');
    content.textContent = text(value);
    wrapper.append(title, content);
    return wrapper;
  }

  function codeField(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lead-review-field lead-review-code-field';
    const title = document.createElement('strong');
    title.textContent = label;
    const content = document.createElement('pre');
    content.textContent = pretty(value);
    wrapper.append(title, content);
    return wrapper;
  }

  function section(title, children) {
    const wrapper = document.createElement('section');
    wrapper.className = 'lead-review-section';
    const heading = document.createElement('h4');
    heading.textContent = title;
    wrapper.append(heading, ...children);
    return wrapper;
  }

  async function loadDetails(card, approval) {
    if (card.dataset.leadReviewEnhanced === approval.executionId) return;
    card.dataset.leadReviewEnhanced = approval.executionId;

    const details = document.createElement('details');
    details.className = 'lead-review-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Review Lead evidence before deciding';
    details.append(summary);

    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.textContent = 'Loading persisted qualification evidence…';
    details.append(loading);

    const actionButtons = card.querySelectorAll('.approval-actions button');
    actionButtons.forEach((button) => { button.disabled = true; });

    const body = card.querySelector(':scope > div:first-child');
    if (body) body.append(details);

    try {
      if (!apiBaseUrl) throw new Error('AxorOS API base URL was not discovered from the approvals request.');
      const response = await originalFetch(`${apiBaseUrl}${DETAILS_PATH}`, {
        headers: { ...latestHeaders, 'x-execution-id': approval.executionId },
      });
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`Details endpoint returned non-JSON content (HTTP ${response.status}, ${contentType || 'unknown content type'}).`);
      }
      if (!response.ok || payload.ok === false || !payload.data) throw new Error(payload.error?.message || `HTTP ${response.status}`);
      const review = payload.data;
      loading.remove();

      details.append(
        section('Business', [
          field('Business name', review.lead.companyName),
          field('Official contact name', review.lead.contactName),
          field('Contact email', review.lead.contactEmail),
          field('Lead score', review.lead.leadScore),
          field('Lead status', review.lead.status),
          field('Enrichment status', review.lead.enrichmentStatus),
          field('Opportunity summary', review.lead.opportunitySummary),
        ]),
        section('Qualification decision', [
          field('Qualification score', review.qualification.totalScore),
          field('Suggested status', review.qualification.suggestedStatus),
          field('Disposition', review.disposition.disposition),
          field('Recommended action', review.disposition.recommendedAction),
          field('Human approval required', review.disposition.humanApprovalRequired ? 'Yes' : 'No'),
          codeField('Reasons', review.disposition.reasons),
          codeField('Missing information', review.qualification.missingInformation),
        ]),
        section('Assessment evidence', [
          codeField('Qualification assessments', review.qualification.assessments),
          codeField('Research evidence', review.lead.evidence),
        ]),
        section('Authority and provenance', [
          codeField('Atlas source paths', review.qualification.atlasSourcePaths),
          field('Runtime confidence', review.runtime.confidence),
          codeField('Runtime risks', review.runtime.risks),
          field('Next action', review.runtime.nextAction),
          field('Review created', review.runtime.createdAt),
        ]),
      );
      const note = document.createElement('p');
      note.className = 'lead-review-safety-note';
      note.textContent = 'Human Executive decision required. Approve only after reviewing the persisted evidence above.';
      details.append(note);
      actionButtons.forEach((button) => { button.disabled = false; });
    } catch (error) {
      loading.textContent = `Unable to load Lead review evidence: ${error instanceof Error ? error.message : String(error)}`;
      loading.className = 'error-banner';
      actionButtons.forEach((button) => { button.disabled = true; });
    }
  }

  function enhanceCards() {
    const cards = Array.from(document.querySelectorAll('.approval-list .approval-card'));
    if (!cards.length || !latestApprovals.length) return;
    cards.forEach((card, index) => {
      const approval = latestApprovals[index];
      if (approval?.destinationAgent === 'lead_agent') void loadDetails(card, approval);
    });
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (requestUrl.includes('/api/v1/control/runtime/approvals/pending')) {
        const parsedUrl = new URL(requestUrl, window.location.href);
        apiBaseUrl = parsedUrl.origin;
        const clone = response.clone();
        const payload = await clone.json();
        if (payload?.ok && payload?.data?.approvals) {
          latestApprovals = payload.data.approvals;
          const requestInit = args[1];
          latestHeaders = requestInit?.headers instanceof Headers ? Object.fromEntries(requestInit.headers.entries()) : (requestInit?.headers || {});
          window.setTimeout(enhanceCards, 0);
        }
      }
    } catch { /* The main Control Center remains authoritative if enhancement fails. */ }
    return response;
  };

  const observer = new MutationObserver(() => enhanceCards());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
