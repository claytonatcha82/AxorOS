import { useEffect, useMemo, useState } from 'react';
import './pilot-activation-panel.css';
import './sales-process-status.css';

type PilotSystemState = 'PILOT_DISABLED' | 'PILOT_ACTIVE';

type PilotStateRecord = { state: PilotSystemState; changedBy: string; reason: string; version: number; changedAt: string };
type PilotVerificationEvidenceRecord = { evidenceId: string; category: string; outcome: 'PASS' | 'FAIL'; verifier: string; sourceReference: string; details: Record<string, unknown>; verifiedAt: string };
type PilotActivationReadinessRecord = { readinessId: string; state: 'PILOT_ACTIVATION_READY' | 'PILOT_ACTIVATION_BLOCKED'; syntheticLifecycleVerified: boolean; persistedRuntimeVerified: boolean; financeIntegrityVerified: boolean; controlPlaneVerified: boolean; deploymentSafetyVerified: boolean; evidenceReferences: string[]; assessedBy: string; assessedAt: string };
type PilotReadinessPreview = { readiness: PilotActivationReadinessRecord; evidence: PilotVerificationEvidenceRecord[]; pilotState: PilotStateRecord };
type SalesPipelineItem = { leadId: string; company: string; contactName: string | null; contactEmail: string | null; qualificationScore: number | null; activity: 'ACTIVE' | 'REVIEW' | 'FAILED' | 'IDLE'; stage: string; objective: string; assessmentStatus: 'context_complete' | 'context_incomplete' | null; missingInformation: string[]; humanReviewRequired: boolean; outreachAuthorised: boolean; sendAuthorised: boolean; pricingAuthorised: boolean; commercialCommitmentAuthorised: boolean; lastUpdated: string; nextAction: string | null };

export interface PilotActivationPanelProps { apiBaseUrl: string; token: string; pilotState: PilotStateRecord; onStateChanged: () => Promise<void> | void; onError: (message: string | null) => void; }

async function readJson<T>(response: Response): Promise<T> { const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } }; if (!response.ok || body.ok === false || body.data === undefined) throw new Error(body.error?.message ?? `Request failed with HTTP ${response.status}.`); return body.data; }
function formatDate(value: string): string { return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function humanize(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function salesStatusClass(activity: SalesPipelineItem['activity']): string { return `sales-pipeline-status sales-pipeline-status-${activity.toLowerCase()}`; }

export function PilotActivationPanel(props: PilotActivationPanelProps) {
  const [readinessId, setReadinessId] = useState('');
  const [preview, setPreview] = useState<PilotReadinessPreview | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [changing, setChanging] = useState(false);
  const [salesPipeline, setSalesPipeline] = useState<SalesPipelineItem[]>([]);
  const [expandedSalesLead, setExpandedSalesLead] = useState<string | null>(null);
  const headers = useMemo(() => ({ authorization: `Bearer ${props.token}` }), [props.token]);
  const previewMatchesInput = Boolean(preview && preview.readiness.readinessId === readinessId.trim());
  const evidenceReady = Boolean(previewMatchesInput && preview?.readiness.state === 'PILOT_ACTIVATION_READY' && preview.evidence.length === 5 && preview.evidence.every((item) => item.outcome === 'PASS'));

  useEffect(() => {
    let cancelled = false;
    const loadSalesPipeline = async () => {
      try {
        const response = await fetch(`${props.apiBaseUrl}/api/v1/control/dashboard/executive`, { headers });
        const dashboard = await readJson<{ salesPipeline?: SalesPipelineItem[] }>(response);
        if (!cancelled) setSalesPipeline(dashboard.salesPipeline ?? []);
      } catch { if (!cancelled) setSalesPipeline([]); }
    };
    void loadSalesPipeline();
    const timer = window.setInterval(() => { void loadSalesPipeline(); }, 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [headers, props.apiBaseUrl]);

  async function loadPreview(mode: 'latest' | 'explicit') {
    const normalized = readinessId.trim(); if (mode === 'explicit' && !normalized) return;
    setLoadingPreview(true); props.onError(null);
    try { const query = mode === 'explicit' ? `?readinessId=${encodeURIComponent(normalized)}` : ''; const response = await fetch(`${props.apiBaseUrl}/api/v1/control/pilot/readiness-preview${query}`, { headers }); const data = await readJson<PilotReadinessPreview>(response); setReadinessId(data.readiness.readinessId); setPreview(data); }
    catch (error) { setPreview(null); props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingPreview(false); }
  }

  async function changeState(state: PilotSystemState, ceremony: boolean) {
    if (!reason.trim()) return; setChanging(true); props.onError(null);
    try { const body: Record<string, unknown> = { state, reason: reason.trim() }; if (ceremony) { body.readinessId = readinessId.trim(); body.confirmation = confirmation; } const response = await fetch(`${props.apiBaseUrl}/api/v1/control/pilot/state`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }); await readJson(response); setReason(''); setConfirmation(''); await props.onStateChanged(); }
    catch (error) { props.onError(error instanceof Error ? error.message : String(error)); }
    finally { setChanging(false); }
  }

  const activating = props.pilotState.state === 'PILOT_DISABLED';
  const requiredConfirmation = activating ? 'ACTIVATE PILOT' : 'DISABLE PILOT';
  const salesActiveCount = salesPipeline.filter((item) => item.activity === 'ACTIVE').length;
  const salesReviewCount = salesPipeline.filter((item) => item.activity === 'REVIEW').length;

  return (
    <article className="panel-card pilot-ceremony-card">
      <div className="card-heading"><div><p className="eyebrow">Human Executive ceremony</p><h2>{activating ? 'Evidence-backed activation' : 'Controlled pilot rollback'}</h2></div><span className={evidenceReady ? 'status-badge' : 'pill attention-pill'}>{evidenceReady ? 'READINESS VERIFIED' : 'PREVIEW REQUIRED'}</span></div>
      <p className="muted">Activation authority comes from the latest persisted readiness assessment and five immutable PASS receipts. You can also enter a specific readiness ID to inspect historical evidence.</p>
      <div className="pilot-ceremony-form">
        <div className="pilot-readiness-row"><button className="secondary-button" disabled={loadingPreview} onClick={() => void loadPreview('latest')}>{loadingPreview ? 'Loading…' : 'Load latest verified readiness'}</button><span className="panel-note">Server-selected by assessed timestamp.</span></div>
        <label htmlFor="pilot-readiness-id">Persisted readiness ID</label>
        <div className="pilot-readiness-row"><input id="pilot-readiness-id" value={readinessId} onChange={(event) => { setReadinessId(event.target.value); if (preview && event.target.value.trim() !== preview.readiness.readinessId) setPreview(null); }} placeholder="pilot-readiness:evidence-suite:..." autoComplete="off" /><button className="secondary-button" disabled={loadingPreview || !readinessId.trim()} onClick={() => void loadPreview('explicit')}>{loadingPreview ? 'Loading…' : 'Preview specific ID'}</button></div>
        {preview && <div className="pilot-readiness-preview"><div className="pilot-readiness-summary"><div><span>Assessment</span><strong>{preview.readiness.state}</strong></div><div><span>Assessed</span><strong>{formatDate(preview.readiness.assessedAt)}</strong></div><div><span>Pilot at preview</span><strong>{preview.pilotState.state} · v{preview.pilotState.version}</strong></div></div><div className="pilot-evidence-list">{preview.evidence.map((item) => <div className="pilot-evidence-row" key={item.evidenceId}><div><strong>{humanize(item.category)}</strong><span>{item.verifier}</span></div><span className={item.outcome === 'PASS' ? 'status-badge' : 'pill attention-pill'}>{item.outcome}</span></div>)}</div><p className="panel-note">Readiness ID: {preview.readiness.readinessId}</p></div>}

        <div className="sales-process-panel">
          <div className="sales-process-panel-header"><div><p className="eyebrow">Sales Agent · live workflow</p><h3>Lead-by-lead Sales status</h3><p className="panel-note">Every Lead that has reached Sales appears here. The panel refreshes automatically every 2 seconds.</p></div><div className="sales-process-summary"><span>{salesPipeline.length} in Sales</span><span>{salesActiveCount} active</span><span>{salesReviewCount} review</span></div></div>
          {salesPipeline.length === 0 ? <div className="sales-process-empty">No Leads have reached the Sales workflow yet.</div> : <div className="sales-pipeline-list">{salesPipeline.map((item) => { const isExpanded = expandedSalesLead === item.leadId; return <article className="sales-pipeline-card" key={item.leadId}>
            <button className="sales-pipeline-card-toggle" onClick={() => setExpandedSalesLead(isExpanded ? null : item.leadId)} aria-expanded={isExpanded}><div className="sales-pipeline-card-main"><div className="sales-pipeline-card-title"><span className={salesStatusClass(item.activity)}>{item.activity}</span><h4>{item.company}</h4></div><p>{item.stage}</p><small>Lead {item.leadId} · Updated {formatDate(item.lastUpdated)}</small></div><div className="sales-pipeline-card-score"><span>Score</span><strong>{item.qualificationScore ?? '—'}</strong><span>{isExpanded ? 'Hide' : 'Details'}</span></div></button>
            {isExpanded && <div className="sales-pipeline-details"><div className="sales-pipeline-detail-grid"><div><span>Contact</span><strong>{item.contactName ?? 'Not confirmed'}</strong></div><div><span>Email</span><strong>{item.contactEmail ?? 'Not confirmed'}</strong></div><div><span>Assessment</span><strong>{item.assessmentStatus ? humanize(item.assessmentStatus) : 'Not recorded'}</strong></div><div><span>Current objective</span><strong>{item.objective}</strong></div><div><span>Next action</span><strong>{item.nextAction ? humanize(item.nextAction) : 'Continue governed processing'}</strong></div><div><span>Human review</span><strong>{item.humanReviewRequired ? 'REQUIRED' : 'Not currently required'}</strong></div></div><div className="sales-pipeline-controls"><div><span>Outreach</span><strong>{item.outreachAuthorised ? 'AUTHORISED' : 'NOT AUTHORISED'}</strong></div><div><span>Send</span><strong>{item.sendAuthorised ? 'AUTHORISED' : 'NOT AUTHORISED'}</strong></div><div><span>Pricing</span><strong>{item.pricingAuthorised ? 'AUTHORISED' : 'NOT AUTHORISED'}</strong></div><div><span>Commercial commitment</span><strong>{item.commercialCommitmentAuthorised ? 'AUTHORISED' : 'NOT AUTHORISED'}</strong></div></div>{item.missingInformation.length > 0 && <div className="sales-pipeline-missing"><span>Missing information</span><ul>{item.missingInformation.map((missing) => <li key={missing}>{missing}</li>)}</ul></div>}</div>}
          </article>; })}</div>}
        </div>

        <label htmlFor="pilot-state-reason">Human Executive reason</label><input id="pilot-state-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={activating ? 'Reason for activating the controlled pilot' : 'Reason for controlled pilot rollback'} />
        <label htmlFor="pilot-confirmation">Exact confirmation</label><input id="pilot-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={`Type ${requiredConfirmation}`} autoComplete="off" />
        {activating ? <button disabled={changing || !evidenceReady || !reason.trim() || confirmation !== 'ACTIVATE PILOT'} onClick={() => void changeState('PILOT_ACTIVE', true)}>{changing ? 'Processing…' : 'Activate pilot with persisted readiness'}</button> : <button className="reject-button" disabled={changing || !evidenceReady || !reason.trim() || confirmation !== 'DISABLE PILOT'} onClick={() => void changeState('PILOT_DISABLED', true)}>{changing ? 'Processing…' : 'Disable pilot through ceremony'}</button>}
        {props.pilotState.state === 'PILOT_ACTIVE' && <div className="pilot-emergency-stop"><div><strong>Emergency fail-safe</strong><span>Readiness evidence is intentionally not required for shutdown.</span></div><button className="reject-button" disabled={changing || !reason.trim()} onClick={() => void changeState('PILOT_DISABLED', false)}>Disable immediately</button></div>}
      </div>
      <p className="panel-note">Preview, activation approval and ceremony deactivation are audited server-side. Emergency shutdown remains independently available by design.</p>
    </article>
  );
}
