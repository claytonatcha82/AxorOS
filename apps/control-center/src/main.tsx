import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceReportingForms } from './FinanceReportingForms';
import './styles.css';

type Money = { amountMinor: number; currency: string; available: boolean; note?: string };
type AgentId = 'knowledge_agent' | 'executive_agent' | 'operations_agent' | 'lead_agent' | 'sales_agent' | 'production_agent' | 'support_agent' | 'marketing_agent' | 'finance_agent';
type AgentReadinessStatus = 'READY' | 'NOT_CONFIGURED' | 'BLOCKED' | 'DEGRADED';
type ClientOption = { clientId: string; displayName: string; status: string };

type AgentReadinessRecord = {
  agentId: AgentId;
  status: AgentReadinessStatus;
  requiredIntegrations: string[];
  missingIntegrations: string[];
  blockers: string[];
  notes: string[];
};

type DashboardSnapshot = {
  generatedAt: string;
  clients: ClientOption[];
  leads: { total: number; discoveredToday: number; discoveredLast7Days: number; qualified: number; engaged: number; converted: number; awaitingHumanReview: number };
  sales: { contacted: number; contactedLast7Days: number; inboundReplies: number; interestedReplies: number; failedSends: number };
  projects: { total: number; active: number; qa: number; awaitingApproval: number; delivered: number };
  finance: {
    expectedIncome: Money[];
    receivedIncome: Money[];
    recurringIncome: Money[];
    expectedExpenses: Money[];
    projectedProfit: Money[];
    pendingPaymentRequirements: number;
    financeClearances: number;
    note: string;
  };
  approvals: { pendingHumanExecutive: number };
  agents: Array<{ agentId: AgentId; totalExecutions: number; activeExecutions: number; completedExecutions: number; reviewExecutions: number; failedExecutions: number; latestActivityAt: string | null; latestObjective: string | null }>;
  agentReadiness: AgentReadinessRecord[];
  executiveUpdates: Array<{ executionId: string; objective: string; status: string; updatedAt: string; summary: string | null }>;
  recentActivity: Array<{ eventType: string; actorType: string; actorId: string | null; createdAt: string }>;
};

type PendingApproval = {
  executionId: string;
  destinationAgent: string;
  objective: string;
  expectedOutput: string;
  capabilityId: string;
  persistedAt: string;
  reason?: string;
};

const API_BASE_URL = (import.meta.env.VITE_AXOROS_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:3001';

const AGENT_LABELS: Record<AgentId, string> = {
  lead_agent: 'Lead',
  sales_agent: 'Sales',
  production_agent: 'Production',
  operations_agent: 'Operations',
  finance_agent: 'Finance',
  support_agent: 'Support',
  marketing_agent: 'Marketing',
  knowledge_agent: 'Knowledge',
  executive_agent: 'Executive',
};

function formatMoney(items: Money[]): string {
  if (!items.length) return 'R0.00';
  if (items.some((item) => !item.available)) return 'Unavailable';
  return items.map((item) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: item.currency }).format(item.amountMinor / 100)).join(' · ');
}

function formatDate(value: string | null): string {
  if (!value) return 'No activity yet';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replace(/_agent$/, '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function runtimeActivity(agent: DashboardSnapshot['agents'][number]): 'ACTIVE' | 'REVIEW' | 'FAILED' | 'IDLE' {
  if (agent.activeExecutions > 0) return 'ACTIVE';
  if (agent.reviewExecutions > 0) return 'REVIEW';
  if (agent.failedExecutions > 0) return 'FAILED';
  return 'IDLE';
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || body.ok === false || body.data === undefined) {
    throw new Error(body.error?.message ?? `Request failed with HTTP ${response.status}.`);
  }
  return body.data;
}

function App() {
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [dashboardResponse, approvalsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/v1/control/dashboard/executive`, { headers }),
        fetch(`${API_BASE_URL}/api/v1/control/runtime/approvals/pending`, { headers }),
      ]);
      const [dashboardData, approvalsData] = await Promise.all([
        readJson<DashboardSnapshot>(dashboardResponse),
        readJson<{ approvals: PendingApproval[] }>(approvalsResponse),
      ]);
      setDashboard(dashboardData);
      setApprovals(approvalsData.approvals);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    if (token) void refresh();
  }, [refresh, token]);

  async function resolveApproval(approval: PendingApproval, decision: 'approved' | 'rejected') {
    if (!token) return;
    setActioning(approval.executionId);
    setError(null);
    try {
      const approvalResponse = await fetch(`${API_BASE_URL}/api/v1/control/runtime/approval/resolve`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          executionId: approval.executionId,
          decision,
          reason: decision === 'approved'
            ? 'Approved by Human Executive through AxorOS Control Center.'
            : 'Rejected by Human Executive through AxorOS Control Center.',
        }),
      });
      await readJson(approvalResponse);

      if (decision === 'approved') {
        const executeResponse = await fetch(`${API_BASE_URL}/api/v1/control/runtime/execute`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ executionId: approval.executionId, capabilityId: approval.capabilityId }),
        });
        await readJson(executeResponse);
      }
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setActioning(null);
    }
  }

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand-mark">AX</div>
          <p className="eyebrow">AxorOS · Human Executive</p>
          <h1>Control Center</h1>
          <p className="muted">Enter the development control-plane token to open the governed executive dashboard. The token is kept only in this browser tab's memory.</p>
          <form onSubmit={(event) => { event.preventDefault(); if (draftToken.trim()) setToken(draftToken.trim()); }}>
            <label htmlFor="token">Control-plane token</label>
            <input id="token" type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} autoComplete="off" placeholder="AXOROS_CONTROL_PLANE_TOKEN" />
            <button type="submit" disabled={!draftToken.trim()}>Open Control Center</button>
          </form>
          <p className="security-note">Do not paste the token into source code or commit it to GitHub.</p>
        </section>
      </main>
    );
  }

  const moneyUnavailableNote = dashboard?.finance.expectedExpenses.find((item) => !item.available)?.note;
  const readinessByAgent = new Map((dashboard?.agentReadiness ?? []).map((record) => [record.agentId, record]));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row"><div className="brand-mark small">AX</div><div><strong>AxorOS</strong><span>Control Center</span></div></div>
        <nav>
          <a href="#overview" className="active">Overview</a>
          <a href="#finance">Finance</a>
          <a href="#finance-records">Finance records</a>
          <a href="#agents">Agents</a>
          <a href="#approvals">Approvals</a>
          <a href="#executive">Executive updates</a>
          <a href="#activity">Activity</a>
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" /> Development connected
          <button className="text-button" onClick={() => { setToken(''); setDraftToken(''); setDashboard(null); setApprovals([]); }}>Lock dashboard</button>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">Human Executive</p>
            <h1>Business Command Center</h1>
            <p className="muted">Authoritative live data from AxorOS persisted agent, operational and Finance state.</p>
          </div>
          <div className="topbar-actions">
            <span className="last-updated">{dashboard ? `Updated ${formatDate(dashboard.generatedAt)}` : 'Not loaded'}</span>
            <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>

        {error && <div className="error-banner"><strong>Control Center error</strong><span>{error}</span></div>}
        {!dashboard && !error && <div className="loading-panel">Loading authoritative business state…</div>}

        {dashboard && <>
          <section id="overview" className="section-block">
            <div className="section-heading"><div><p className="eyebrow">Executive overview</p><h2>Agency pulse</h2></div><span className="pill">{dashboard.approvals.pendingHumanExecutive} approvals waiting</span></div>
            <div className="metric-grid">
              <article className="metric-card"><span>Leads found</span><strong>{dashboard.leads.total}</strong><small>{dashboard.leads.discoveredToday} today · {dashboard.leads.discoveredLast7Days} last 7 days</small></article>
              <article className="metric-card"><span>Prospects contacted</span><strong>{dashboard.sales.contacted}</strong><small>{dashboard.sales.contactedLast7Days} in last 7 days</small></article>
              <article className="metric-card"><span>Qualified / engaged</span><strong>{dashboard.leads.qualified + dashboard.leads.engaged}</strong><small>{dashboard.leads.converted} converted</small></article>
              <article className="metric-card"><span>Active projects</span><strong>{dashboard.projects.active}</strong><small>{dashboard.projects.qa} QA · {dashboard.projects.awaitingApproval} awaiting approval</small></article>
              <article className="metric-card finance-highlight"><span>Expected income</span><strong>{formatMoney(dashboard.finance.expectedIncome)}</strong><small>{dashboard.finance.pendingPaymentRequirements} active payment requirements</small></article>
              <article className="metric-card finance-highlight"><span>Revenue received</span><strong>{formatMoney(dashboard.finance.receivedIncome)}</strong><small>{dashboard.finance.financeClearances} Finance clearances</small></article>
              <article className="metric-card"><span>Recurring income</span><strong>{formatMoney(dashboard.finance.recurringIncome)}</strong><small>Shown only from authoritative recurring contracts</small></article>
              <article className="metric-card"><span>Expected expenses</span><strong>{formatMoney(dashboard.finance.expectedExpenses)}</strong><small>{moneyUnavailableNote ?? 'Authoritative expense state'}</small></article>
              <article className="metric-card"><span>Projected profit</span><strong>{formatMoney(dashboard.finance.projectedProfit)}</strong><small>Never inferred without a non-duplicating profitability basis</small></article>
              <article className="metric-card attention"><span>Human approvals</span><strong>{dashboard.approvals.pendingHumanExecutive}</strong><small>{dashboard.leads.awaitingHumanReview} Lead reviews included where actionable</small></article>
            </div>
          </section>

          <section id="finance" className="section-block split-grid">
            <article className="panel-card">
              <div className="card-heading"><div><p className="eyebrow">Finance Agent</p><h2>Revenue and obligations</h2></div><span className="status-badge">Governed</span></div>
              <div className="finance-table">
                <div><span>Expected income</span><strong>{formatMoney(dashboard.finance.expectedIncome)}</strong></div>
                <div><span>Received income</span><strong>{formatMoney(dashboard.finance.receivedIncome)}</strong></div>
                <div><span>Recurring income</span><strong>{formatMoney(dashboard.finance.recurringIncome)}</strong></div>
                <div><span>Expected expenses</span><strong>{formatMoney(dashboard.finance.expectedExpenses)}</strong></div>
                <div className="profit-row"><span>Projected profit</span><strong>{formatMoney(dashboard.finance.projectedProfit)}</strong></div>
              </div>
              <p className="panel-note">{dashboard.finance.note}</p>
            </article>

            <article className="panel-card">
              <div className="card-heading"><div><p className="eyebrow">Sales pipeline</p><h2>Commercial activity</h2></div></div>
              <div className="compact-stat-grid">
                <div><strong>{dashboard.sales.contacted}</strong><span>Contacted</span></div>
                <div><strong>{dashboard.sales.inboundReplies}</strong><span>Replies</span></div>
                <div><strong>{dashboard.sales.interestedReplies}</strong><span>Interested / commercial</span></div>
                <div><strong>{dashboard.sales.failedSends}</strong><span>Failed sends</span></div>
              </div>
              <div className="pipeline-line">
                <span style={{ width: `${Math.min(100, dashboard.leads.total ? (dashboard.sales.contacted / dashboard.leads.total) * 100 : 0)}%` }} />
              </div>
              <p className="panel-note">Contact rate across currently persisted leads. Sales remains governed by its dedicated supervised send path.</p>
            </article>
          </section>

          <div id="finance-records">
            <FinanceReportingForms
              apiBaseUrl={API_BASE_URL}
              token={token}
              clients={dashboard.clients}
              onSaved={refresh}
              onError={(message) => setError(message || null)}
            />
          </div>

          <section id="agents" className="section-block">
            <div className="section-heading"><div><p className="eyebrow">Agent network</p><h2>All nine agents</h2></div></div>
            <div className="agent-grid">
              {dashboard.agents.map((agent) => {
                const readiness = readinessByAgent.get(agent.agentId);
                const activity = runtimeActivity(agent);
                const readinessDetail = readiness?.blockers[0] ?? readiness?.notes[0] ?? 'Required runtime and integration prerequisites are configured.';
                return (
                  <article className="agent-card" key={agent.agentId}>
                    <div className="agent-card-top"><div className="agent-icon">{AGENT_LABELS[agent.agentId].slice(0, 2).toUpperCase()}</div><div><h3>{AGENT_LABELS[agent.agentId]} Agent</h3><span>Readiness: {readiness?.status ?? 'NOT_CONFIGURED'} · Activity: {activity}</span></div></div>
                    <div className="agent-stats"><span><strong>{agent.totalExecutions}</strong>Total</span><span><strong>{agent.completedExecutions}</strong>Done</span><span><strong>{agent.reviewExecutions}</strong>Review</span><span><strong>{agent.failedExecutions}</strong>Failed</span></div>
                    <p>{readinessDetail}</p>
                    <p>{agent.latestObjective ?? 'No persisted runtime objective yet.'}</p>
                    <small>{formatDate(agent.latestActivityAt)}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section id="approvals" className="section-block">
            <div className="section-heading"><div><p className="eyebrow">Governance</p><h2>Human Executive approvals</h2></div><span className="pill attention-pill">{approvals.length} actionable</span></div>
            {approvals.length === 0 ? (
              <div className="empty-state"><strong>No shared runtime approvals waiting.</strong><span>Support, Marketing and Operations approval work will appear here when actionable.</span></div>
            ) : (
              <div className="approval-list">
                {approvals.map((approval) => (
                  <article className="approval-card" key={approval.executionId}>
                    <div><span className="agent-tag">{humanize(approval.destinationAgent)}</span><h3>{approval.objective}</h3><p>{approval.reason ?? approval.expectedOutput}</p><small>{formatDate(approval.persistedAt)}</small></div>
                    <div className="approval-actions">
                      <button className="reject-button" disabled={actioning === approval.executionId} onClick={() => void resolveApproval(approval, 'rejected')}>Reject</button>
                      <button disabled={actioning === approval.executionId} onClick={() => void resolveApproval(approval, 'approved')}>{actioning === approval.executionId ? 'Processing…' : 'Approve & execute'}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section id="executive" className="section-block split-grid">
            <article className="panel-card">
              <div className="card-heading"><div><p className="eyebrow">Executive Agent</p><h2>Strategic updates</h2></div></div>
              {dashboard.executiveUpdates.length === 0 ? <div className="empty-inline">No persisted Executive Agent updates yet.</div> : (
                <div className="update-list">{dashboard.executiveUpdates.map((update) => <div key={update.executionId}><div><strong>{update.objective}</strong><span className="status-badge">{update.status}</span></div><p>{update.summary ?? 'Strategic analysis has no text summary persisted yet.'}</p><small>{formatDate(update.updatedAt)}</small></div>)}</div>
              )}
            </article>

            <article id="activity" className="panel-card">
              <div className="card-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent business activity</h2></div></div>
              {dashboard.recentActivity.length === 0 ? <div className="empty-inline">No operational workflow events yet.</div> : (
                <div className="activity-list">{dashboard.recentActivity.slice(0, 10).map((activity, index) => <div key={`${activity.createdAt}-${index}`}><span className="activity-dot"/><div><strong>{humanize(activity.eventType)}</strong><span>{activity.actorId ? humanize(activity.actorId) : humanize(activity.actorType)}</span></div><time>{formatDate(activity.createdAt)}</time></div>)}</div>
              )}
            </article>
          </section>
        </>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
