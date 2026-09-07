(() => {
  const originalFetch = window.fetch.bind(window);
  let latestPipeline = [];
  let renderScheduled = false;
  let lastRenderedMarkup = '';

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

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    window.requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
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

    // Only render leads that have an actual Sales workflow state. Leads still
    // waiting for Human Executive approval must not appear as Sales activity.
    const approvedPipeline = latestPipeline.filter((item) => String(item.activity ?? '').toUpperCase() !== 'IDLE');

    const markup = !approvedPipeline.length
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

    if (container.innerHTML !== markup || lastRenderedMarkup !== markup) {
      container.innerHTML = markup;
      lastRenderedMarkup = markup;
    }
  }

  function captureDashboard(response) {
    response.clone().json().then((body) => {
      const pipeline = body?.data?.salesPipeline;
      if (Array.isArray(pipeline)) {
        latestPipeline = pipeline;
        scheduleRender();
      }
    }).catch(() => {});
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.includes('/api/v1/control/dashboard/executive')) {
      captureDashboard(response);
    }
    return response;
  };

  const observer = new MutationObserver(() => scheduleRender());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(scheduleRender, 2000);
})();
