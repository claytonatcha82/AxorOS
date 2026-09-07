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
    const cards = Array.from(document.querySelectorAll('.agent-card'));
    const salesCard = cards.find((card) => card.querySelector('h3')?.textContent?.trim() === 'Sales Agent');
    if (!salesCard) return;

    let container = salesCard.querySelector('.sales-agent-card-live-details');
    if (!container) {
      container = document.createElement('div');
      container.className = 'sales-agent-card-live-details';
      const footer = salesCard.querySelector('small');
      if (footer) footer.insertAdjacentElement('afterend', container);
      else salesCard.appendChild(container);
    }

    const markup = !latestPipeline.length
      ? '<div class="sales-agent-card-live-empty">No lead-level Sales workflow record is currently exposed by the executive dashboard.</div>'
      : `
        <div class="sales-agent-card-live-heading">
          <span>Lead-level workflow</span>
          <strong>${latestPipeline.length} lead${latestPipeline.length === 1 ? '' : 's'}</strong>
        </div>
        <div class="sales-agent-card-live-list">
          ${latestPipeline.map((item) => `
            <div class="sales-agent-card-live-row">
              <div class="sales-agent-card-live-row-top">
                <strong>${escapeHtml(item.company)}</strong>
                <span class="sales-agent-card-live-status sales-agent-card-live-status-${escapeHtml(String(item.activity).toLowerCase())}">${escapeHtml(item.activity)}</span>
              </div>
              <div class="sales-agent-card-live-stage">${escapeHtml(item.stage)}</div>
              <div class="sales-agent-card-live-meta">
                <span>Lead ${escapeHtml(item.leadId)}</span>
                <span>Score ${escapeHtml(item.qualificationScore ?? '—')}</span>
                <span>${escapeHtml(formatDate(item.lastUpdated))}</span>
              </div>
              <div class="sales-agent-card-live-next"><span>Next:</span> ${escapeHtml(item.nextAction ? humanize(item.nextAction) : item.objective)}</div>
            </div>
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
