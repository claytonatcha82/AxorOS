import { useMemo, useState } from 'react';
import './pilot-activation-panel.css';

type PilotSystemState = 'PILOT_DISABLED' | 'PILOT_ACTIVE';

type PilotStateRecord = {
  state: PilotSystemState;
  changedBy: string;
  reason: string;
  version: number;
  changedAt: string;
};

type PilotVerificationEvidenceRecord = {
  evidenceId: string;
  category: string;
  outcome: 'PASS' | 'FAIL';
  verifier: string;
  sourceReference: string;
  details: Record<string, unknown>;
  verifiedAt: string;
};

type PilotActivationReadinessRecord = {
  readinessId: string;
  state: 'PILOT_ACTIVATION_READY' | 'PILOT_ACTIVATION_BLOCKED';
  syntheticLifecycleVerified: boolean;
  persistedRuntimeVerified: boolean;
  financeIntegrityVerified: boolean;
  controlPlaneVerified: boolean;
  deploymentSafetyVerified: boolean;
  evidenceReferences: string[];
  assessedBy: string;
  assessedAt: string;
};

type PilotReadinessPreview = {
  readiness: PilotActivationReadinessRecord;
  evidence: PilotVerificationEvidenceRecord[];
  pilotState: PilotStateRecord;
};

export interface PilotActivationPanelProps {
  apiBaseUrl: string;
  token: string;
  pilotState: PilotStateRecord;
  onStateChanged: () => Promise<void> | void;
  onError: (message: string | null) => void;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || body.ok === false || body.data === undefined) {
    throw new Error(body.error?.message ?? `Request failed with HTTP ${response.status}.`);
  }
  return body.data;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PilotActivationPanel(props: PilotActivationPanelProps) {
  const [readinessId, setReadinessId] = useState('');
  const [preview, setPreview] = useState<PilotReadinessPreview | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [changing, setChanging] = useState(false);

  const headers = useMemo(() => ({ authorization: `Bearer ${props.token}` }), [props.token]);
  const previewMatchesInput = Boolean(preview && preview.readiness.readinessId === readinessId.trim());
  const evidenceReady = Boolean(
    previewMatchesInput
    && preview?.readiness.state === 'PILOT_ACTIVATION_READY'
    && preview.evidence.length === 5
    && preview.evidence.every((item) => item.outcome === 'PASS'),
  );

  async function loadPreview() {
    const normalized = readinessId.trim();
    if (!normalized) return;
    setLoadingPreview(true);
    props.onError(null);
    try {
      const response = await fetch(
        `${props.apiBaseUrl}/api/v1/control/pilot/readiness-preview?readinessId=${encodeURIComponent(normalized)}`,
        { headers },
      );
      const data = await readJson<PilotReadinessPreview>(response);
      setPreview(data);
    } catch (error) {
      setPreview(null);
      props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function changeState(state: PilotSystemState, ceremony: boolean) {
    if (!reason.trim()) return;
    setChanging(true);
    props.onError(null);
    try {
      const body: Record<string, unknown> = {
        state,
        reason: reason.trim(),
      };
      if (ceremony) {
        body.readinessId = readinessId.trim();
        body.confirmation = confirmation;
      }
      const response = await fetch(`${props.apiBaseUrl}/api/v1/control/pilot/state`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await readJson(response);
      setReason('');
      setConfirmation('');
      await props.onStateChanged();
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      setChanging(false);
    }
  }

  const activating = props.pilotState.state === 'PILOT_DISABLED';
  const requiredConfirmation = activating ? 'ACTIVATE PILOT' : 'DISABLE PILOT';

  return (
    <article className="panel-card pilot-ceremony-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Human Executive ceremony</p>
          <h2>{activating ? 'Evidence-backed activation' : 'Controlled pilot rollback'}</h2>
        </div>
        <span className={evidenceReady ? 'status-badge' : 'pill attention-pill'}>
          {evidenceReady ? 'READINESS VERIFIED' : 'PREVIEW REQUIRED'}
        </span>
      </div>

      <p className="muted">
        Activation authority comes from a persisted readiness ID and five immutable PASS receipts. The browser cannot substitute agent-readiness booleans for this evidence.
      </p>

      <div className="pilot-ceremony-form">
        <label htmlFor="pilot-readiness-id">Persisted readiness ID</label>
        <div className="pilot-readiness-row">
          <input
            id="pilot-readiness-id"
            value={readinessId}
            onChange={(event) => {
              setReadinessId(event.target.value);
              if (preview && event.target.value.trim() !== preview.readiness.readinessId) setPreview(null);
            }}
            placeholder="pilot-readiness:evidence-suite:..."
            autoComplete="off"
          />
          <button className="secondary-button" disabled={loadingPreview || !readinessId.trim()} onClick={() => void loadPreview()}>
            {loadingPreview ? 'Loading…' : 'Preview readiness'}
          </button>
        </div>

        {preview && (
          <div className="pilot-readiness-preview">
            <div className="pilot-readiness-summary">
              <div><span>Assessment</span><strong>{preview.readiness.state}</strong></div>
              <div><span>Assessed</span><strong>{formatDate(preview.readiness.assessedAt)}</strong></div>
              <div><span>Pilot at preview</span><strong>{preview.pilotState.state} · v{preview.pilotState.version}</strong></div>
            </div>
            <div className="pilot-evidence-list">
              {preview.evidence.map((item) => (
                <div className="pilot-evidence-row" key={item.evidenceId}>
                  <div>
                    <strong>{humanize(item.category)}</strong>
                    <span>{item.verifier}</span>
                  </div>
                  <span className={item.outcome === 'PASS' ? 'status-badge' : 'pill attention-pill'}>{item.outcome}</span>
                </div>
              ))}
            </div>
            <p className="panel-note">Readiness ID: {preview.readiness.readinessId}</p>
          </div>
        )}

        <label htmlFor="pilot-state-reason">Human Executive reason</label>
        <input
          id="pilot-state-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={activating ? 'Reason for activating the controlled pilot' : 'Reason for controlled pilot rollback'}
        />

        <label htmlFor="pilot-confirmation">Exact confirmation</label>
        <input
          id="pilot-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`Type ${requiredConfirmation}`}
          autoComplete="off"
        />

        {activating ? (
          <button
            disabled={changing || !evidenceReady || !reason.trim() || confirmation !== 'ACTIVATE PILOT'}
            onClick={() => void changeState('PILOT_ACTIVE', true)}
          >
            {changing ? 'Processing…' : 'Activate pilot with persisted readiness'}
          </button>
        ) : (
          <button
            className="reject-button"
            disabled={changing || !evidenceReady || !reason.trim() || confirmation !== 'DISABLE PILOT'}
            onClick={() => void changeState('PILOT_DISABLED', true)}
          >
            {changing ? 'Processing…' : 'Disable pilot through ceremony'}
          </button>
        )}

        {props.pilotState.state === 'PILOT_ACTIVE' && (
          <div className="pilot-emergency-stop">
            <div>
              <strong>Emergency fail-safe</strong>
              <span>Readiness evidence is intentionally not required for shutdown.</span>
            </div>
            <button
              className="reject-button"
              disabled={changing || !reason.trim()}
              onClick={() => void changeState('PILOT_DISABLED', false)}
            >
              Disable immediately
            </button>
          </div>
        )}
      </div>

      <p className="panel-note">
        Preview, activation approval and ceremony deactivation are audited server-side. Emergency shutdown remains independently available by design.
      </p>
    </article>
  );
}
