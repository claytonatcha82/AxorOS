(() => {
  const DETAILS_PATH = '/api/v1/control/lead-qualification-review/details';
  const RESOLVE_PATH = '/api/v1/control/lead-qualification-review/resolve';
  const originalFetch = window.fetch.bind(window);
  let latestApprovals = [];
  let latestHeaders = {};
  let apiBaseUrl = '';
  let activeLeadApprovalExecutionId = null;
  const detailLoads = new Set();

  if (document.documentElement.dataset.leadApprovalReviewEnhancerLoaded === 'true') return;
  document.documentElement.dataset.leadApprovalReviewEnhancerLoaded = 'true';

  const style = document.createElement('style');
  style.textContent = `.lead-review-details{margin-top:16px;border:1px solid rgba(127,127,127,.25);border-radius:12px;padding:12px 14px;background:rgba(127,127,127,.06)}.lead-review-details summary{cursor:pointer;font-weight:700}.lead-review-section{margin-top:16px}.lead-review-section h4{margin:0 0 8px}.lead-review-field{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:10px;padding:7px 0;border-top:1px solid rgba(127,127,127,.16)}.lead-review-field span{white-space:pre-wrap;overflow-wrap:anywhere}.lead-review-code-field{display:block}.lead-review-code-field pre{margin:7px 0 0;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.lead-review-safety-note{margin:16px 0 0;padding:10px;border-radius:8px;font-weight:600}.approval-actions button:disabled{opacity:.45;cursor:not-allowed}.lead-handoff-status{margin:0 0 16px;padding:14px 16px;border-radius:12px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.08);display:flex;flex-direction:column;gap:4px}.lead-handoff-status strong{font-size:15px}.lead-handoff-status span{font-size:13px;opacity:.8}.lead-handoff-status.processing{border-style:dashed}.lead-handoff-status.success{font-weight:600}.lead-handoff-status.error{font-weight:600}`;
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

  function removeDuplicateDetails(card, executionId) {
    const details = Array.from(card.querySelectorAll('.lead-review-details'));
    const matching = details.filter((item) => item.dataset.executionId === executionId);
    const keep = matching[0] ?? null;
    details.forEach((item) => {
      if (item !== keep) item.remove();
    });
    return keep;
  }

  function showHandoffStatus(state, title, detail) {
    let status = document.querySelector('.lead-handoff-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'lead-handoff-status';
      const approvalsSection = document.getElementById('approvals');
      if (approvalsSection) approvalsSection.prepend(status);
      else document.body.prepend(status);
    }
    status.className = `lead-handoff-status ${state}`;
    status.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const message = document.createElement('span');
    message.textContent = detail;
    status.append(heading, message);
  }

  function markLeadApprovalProcessing(executionId) {
    activeLeadApprovalExecutionId = executionId;
    showHandoffStatus('processing', 'Handing to Sales…', 'Lead approval was submitted. AxorOS is completing the governed Lead → Sales handoff and starting the Sales internal intake.');
  }

  function markLeadApprovalSuccess() {
    if (!activeLeadApprovalExecutionId) return;
    showHandoffStatus('success', 'Handed to Sales ✓', 'The approved Lead has been handed to Sales. Sales can now continue its internal assessment and prepare the outreach draft for Human Executive review. No email has been sent.');
    activeLeadApprovalExecutionId = null;
  }

  function markLeadApprovalFailure(message) {
    if (!activeLeadApprovalExecutionId) return;
    showHandoffStatus('error', 'Sales handoff failed', message || 'The Lead approval could not complete the governed handoff.');
    activeLeadApprovalExecutionId = null;
  }

  async function loadDetails(card, approval, details) {
    if (detailLoads.has(approval.executionId)) return;
    detailLoads.add(approval.executionId);

    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.textContent = 'Loading persisted qualification evidence…';
    details.append(loading);

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
    } catch (error) {
      loading.textContent = `Unable to load Lead review evidence: ${error instanceof Error ? error.message : String(error)}`;
      loading.className = 'error-banner';
    } finally {
      detailLoads.delete(approval.executionId);
    }
  }

  function ensureDetails(card, approval) {
    let details = removeDuplicateDetails(card, approval.executionId);
    if (!details) {
      details = document.createElement('details');
      details.className = 'lead-review-details';
      details.dataset.executionId = approval.executionId;
      const summary = document.createElement('summary');
      summary.textContent = 'Review Lead evidence before deciding';
      details.append(summary);
      const body = card.querySelector(':scope > div:first-child');
      if (body) body.append(details);
      else card.append(details);

      details.addEventListener('toggle', () => {
        if (details.open) void loadDetails(card, approval, details);
      });
    }
    return details;
  }

  function enhanceCards() {
    const cards = Array.from(document.querySelectorAll('.approval-list .approval-card'));
    if (!cards.length || !latestApprovals.length) return;
    cards.forEach((card, index) => {
      const approval = latestApprovals[index];
      if (approval?.destinationAgent === 'lead_agent') {
        card.dataset.executionId = approval.executionId;
        ensureDetails(card, approval);
      } else {
        card.querySelectorAll('.lead-review-details').forEach((item) => item.remove());
      }
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
      if (requestUrl.includes(RESOLVE_PATH) && activeLeadApprovalExecutionId && response.ok) {
        markLeadApprovalSuccess();
      }
      if (requestUrl.includes(RESOLVE_PATH) && activeLeadApprovalExecutionId && !response.ok) {
        const clone = response.clone();
        let message = `HTTP ${response.status}`;
        try {
          const payload = await clone.json();
          message = payload?.error?.message || message;
        } catch { /* Keep HTTP status when the error body is not JSON. */ }
        markLeadApprovalFailure(message);
      }
    } catch { /* The main Control Center remains authoritative if enhancement fails. */ }
    return response;
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.approval-actions button');
    if (!button) return;
    const card = button.closest('.approval-card');
    if (!card) return;
    const executionId = card.dataset.executionId;
    const approval = latestApprovals.find((item) => item.executionId === executionId);
    if (!approval || approval.destinationAgent !== 'lead_agent') return;
    if (button.classList.contains('reject-button')) return;
    markLeadApprovalProcessing(executionId);
  });

  const observer = new MutationObserver(() => enhanceCards());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
