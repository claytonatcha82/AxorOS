(() => {
  const originalFetch = window.fetch.bind(window);
  const DRAFTS_PATH = '/api/v1/control/sales-email/drafts';
  const REVIEW_PATH = '/api/v1/control/sales-email/review-draft';
  let latestPipeline = [];
  let latestDrafts = [];
  let latestHeaders = {};
  let apiBaseUrl = '';
  let renderScheduled = false;
  let lastRenderedMarkup = '';
  let draftActionInFlight = null;
  let draftActionMessage = '';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function humanize(value) {
    return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatDate(value) {
    if (!value) return 'No activity yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function pipelineCompany(leadId) {
    const item = latestPipeline.find((candidate) => candidate.leadId === leadId);
    return item?.company || `Lead ${leadId}`;
  }

  async function loadDrafts() {
    if (!apiBaseUrl || !Object.keys(latestHeaders).length) return;
    try {
      const response = await originalFetch(`${apiBaseUrl}${DRAFTS_PATH}`, { headers: latestHeaders });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false || !Array.isArray(payload?.data?.drafts)) return;
      latestDrafts = payload.data.drafts;
      scheduleRender();
    } catch {
      // The main Control Center remains usable if draft retrieval is temporarily unavailable.
    }
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    window.requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function bindDraftActions(container) {
    container.querySelectorAll('.sales-draft-approve').forEach((button) => {
      button.addEventListener('click', () => {
        const draftId = button.getAttribute('data-draft-id');
        if (draftId) void decideDraft(draftId, 'approved');
      });
    });
    container.querySelectorAll('.sales-draft-reject').forEach((button) => {
      button.addEventListener('click', () => {
        const draftId = button.getAttribute('data-draft-id');
        if (draftId) void decideDraft(draftId, 'rejected');
      });
    });
  }

  function renderDrafts() {
    if (!latestDrafts.length) {
      return '<div class="sales-live-drafts-empty">No Sales outreach draft is currently awaiting Human Executive review.</div>';
    }

    return `<div class="sales-live-drafts-list">${latestDrafts.map((draft) => `
      <article class="sales-live-draft-card" data-draft-record-id="${escapeHtml(draft.draftRecordId)}">
        <div class="sales-live-draft-head">
          <div>
            <strong>${escapeHtml(pipelineCompany(draft.leadId))}</strong>
            <span>Lead ${escapeHtml(draft.leadId || '—')}</span>
          </div>
          <span class="sales-live-draft-status">Human review required</span>
        </div>
        <div class="sales-live-draft-meta">
          <span><small>Recipient</small><strong>${escapeHtml(draft.recipient || '—')}</strong></span>
          <span><small>Created</small><strong>${escapeHtml(formatDate(draft.createdAt))}</strong></span>
          <span><small>Type</small><strong>${escapeHtml(humanize(draft.draftKind))}</strong></span>
        </div>
        <div class="sales-live-draft-field"><small>Subject</small><strong>${escapeHtml(draft.subject || '—')}</strong></div>
        <div class="sales-live-draft-field"><small>Email body</small><div class="sales-live-draft-body">${escapeHtml(draft.body || '—')}</div></div>
        <div class="sales-live-draft-safety">
          <span>Outreach authority: ${draft.outreachAuthorised ? 'YES' : 'NO'}</span>
          <span>Send authority: ${draft.sendAuthorised ? 'YES' : 'NO'}</span>
          <span>Pricing authority: ${draft.pricingAuthorised ? 'YES' : 'NO'}</span>
          <span>Commercial authority: ${draft.commercialCommitmentAuthorised ? 'YES' : 'NO'}</span>
        </div>
        <div class="sales-live-draft-actions">
          <button type="button" class="sales-draft-approve" data-draft-id="${escapeHtml(draft.draftRecordId)}" ${draftActionInFlight ? 'disabled' : ''}>Approve & create Gmail draft</button>
          <button type="button" class="sales-draft-reject" data-draft-id="${escapeHtml(draft.draftRecordId)}" ${draftActionInFlight ? 'disabled' : ''}>Reject for revision</button>
        </div>
      </article>
    `).join('')}</div>`;
  }

  function render() {
    const agentsSection = document.querySelector('#agents');
    const agentGrid = agentsSection?.querySelector('.agent-grid');
    if (!agentsSection || !agentGrid) return;

    let container = agentsSection.querySelector('.sales-live-workflow');
    if (!container) {
      container = document.createElement('section');
      container.className = 'sales-live-workflow';
      agentGrid.insertAdjacentElement('afterend', container);
    }

    const approvedPipeline = latestPipeline.filter((item) => String(item.activity ?? '').toUpperCase() !== 'IDLE');
    const pipelineMarkup = !approvedPipeline.length
      ? `
        <div class="sales-live-workflow-header">
          <div>
            <p class="sales-live-workflow-eyebrow">Sales Agent · Live workflow</p>
            <h3>Sales Live Workflow</h3>
            <p>Only leads that have passed the Human Executive Lead approval gate appear here.</p>
          </div>
          <span class="sales-live-workflow-count">0 approved leads</span>
        </div>
        <div class="sales-live-workflow-empty">No Human Executive-approved Lead is currently in the Sales workflow.</div>
      `
      : `
        <div class="sales-live-workflow-header">
          <div>
            <p class="sales-live-workflow-eyebrow">Sales Agent · Live workflow</p>
            <h3>Sales Live Workflow</h3>
            <p>Approved leads currently moving through the governed Sales workflow.</p>
          </div>
          <span class="sales-live-workflow-count">${approvedPipeline.length} approved lead${approvedPipeline.length === 1 ? '' : 's'}</span>
        </div>
        <div class="sales-live-workflow-list">
          ${approvedPipeline.map((item) => `
            <article class="sales-live-workflow-row">
              <div class="sales-live-workflow-row-head">
                <div class="sales-live-workflow-company">
                  <strong>${escapeHtml(item.company)}</strong>
                  <span>Lead ${escapeHtml(item.leadId)}</span>
                </div>
                <span class="sales-live-workflow-status sales-live-workflow-status-${escapeHtml(String(item.activity).toLowerCase())}">${escapeHtml(item.activity)}</span>
              </div>
              <div class="sales-live-workflow-stage">${escapeHtml(item.stage)}</div>
              <div class="sales-live-workflow-meta">
                <span><small>Qualification</small><strong>${escapeHtml(item.qualificationScore ?? '—')}</strong></span>
                <span><small>Last updated</small><strong>${escapeHtml(formatDate(item.lastUpdated))}</strong></span>
              </div>
              <div class="sales-live-workflow-next"><small>Next action</small><strong>${escapeHtml(item.nextAction ? humanize(item.nextAction) : item.objective)}</strong></div>
            </article>
          `).join('')}
        </div>
      `;

    const draftStatusMarkup = draftActionMessage
      ? `<div class="sales-live-draft-confirmation" role="status">${escapeHtml(draftActionMessage)}</div>`
      : '';
    const draftMarkup = `
      <div class="sales-live-drafts-section">
        <div class="sales-live-drafts-header">
          <div>
            <p class="sales-live-workflow-eyebrow">Governed outreach</p>
            <h3>Sales Outreach Draft Review</h3>
            <p>Approving the prepared email creates an unsent Gmail draft. It does not send the email.</p>
          </div>
          <span class="sales-live-workflow-count">${latestDrafts.length} pending draft${latestDrafts.length === 1 ? '' : 's'}</span>
        </div>
        ${draftStatusMarkup}
        ${renderDrafts()}
      </div>
    `;

    const markup = pipelineMarkup + draftMarkup;
    if (container.innerHTML !== markup || lastRenderedMarkup !== markup) {
      container.innerHTML = markup;
      lastRenderedMarkup = markup;
      bindDraftActions(container);
    }
  }

  function captureDashboard(response, requestInit) {
    response.clone().json().then((body) => {
      const pipeline = body?.data?.salesPipeline;
      if (Array.isArray(pipeline)) {
        latestPipeline = pipeline;
        scheduleRender();
      }
      const parsedUrl = new URL(typeof response.url === 'string' && response.url ? response.url : window.location.href);
      apiBaseUrl = parsedUrl.origin;
      latestHeaders = requestInit?.headers instanceof Headers ? Object.fromEntries(requestInit.headers.entries()) : (requestInit?.headers || {});
      void loadDrafts();
    }).catch(() => {});
  }

  async function decideDraft(draftId, decision) {
    if (!apiBaseUrl || !Object.keys(latestHeaders).length || draftActionInFlight) return;
    draftActionInFlight = draftId;
    draftActionMessage = '';
    scheduleRender();
    try {
      const response = await originalFetch(`${apiBaseUrl}${REVIEW_PATH}`, {
        method: 'POST',
        headers: { ...latestHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ draftRecordId: draftId, decision }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      if (decision === 'approved') {
        const gmailDraftId = payload?.data?.review?.gmailDraftId;
        draftActionMessage = gmailDraftId
          ? `Gmail draft created (${gmailDraftId}). The email has not been sent.`
          : 'Gmail draft created. The email has not been sent.';
        latestDrafts = latestDrafts.filter((draft) => draft.draftRecordId !== draftId);
      } else {
        latestDrafts = latestDrafts.filter((draft) => draft.draftRecordId !== draftId);
        draftActionMessage = 'Sales draft rejected for revision.';
      }
      scheduleRender();
      await loadDrafts();
    } catch (error) {
      draftActionMessage = '';
      window.alert(`Sales draft review failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      draftActionInFlight = null;
      scheduleRender();
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.includes('/api/v1/control/dashboard/executive')) {
      captureDashboard(response, args[1]);
    }
    return response;
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => { void loadDrafts(); }, 2000);
  window.setInterval(scheduleRender, 2000);
})();
