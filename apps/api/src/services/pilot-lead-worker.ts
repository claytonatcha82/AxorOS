import { randomUUID } from 'node:crypto';
import type { PilotSystemStateRecord } from '../data/pilot-system-state-postgres-store.js';
import type { AtlasLeadResearchOutput, AtlasLeadResearchInput } from './lead-atlas-research-orchestrator.js';

export interface PilotLeadWorkerState {
  get(): Promise<PilotSystemStateRecord>;
}

export interface PilotLeadWorkerResearch {
  research(input: AtlasLeadResearchInput): Promise<AtlasLeadResearchOutput>;
}

export interface PilotLeadWorkerOptions {
  intervalMs: number;
  geographicFocus?: string;
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  onCycleCompleted?: (result: AtlasLeadResearchOutput) => void;
  onCycleSkipped?: (reason: 'pilot_disabled' | 'cycle_in_progress') => void;
  onCycleFailed?: (error: unknown) => void;
}

export function createPilotLeadWorker(
  state: PilotLeadWorkerState,
  research: PilotLeadWorkerResearch,
  options: PilotLeadWorkerOptions,
) {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 60_000) {
    throw new Error('Pilot Lead worker interval must be at least 60000ms.');
  }

  let timer: NodeJS.Timeout | undefined;
  let inProgress = false;
  let lastStartedAt: string | null = null;
  let lastCompletedAt: string | null = null;
  let lastFailedAt: string | null = null;
  let lastOutcome: 'completed' | 'failed' | 'skipped' | null = null;
  let lastSummary: {
    discovered: number;
    enriched: number;
    duplicateSkipped: number;
    webResearchFailed: number;
    unresolved: number;
    ambiguous: number;
    notFound: number;
  } | null = null;

  async function runOnce(): Promise<AtlasLeadResearchOutput | null> {
    if (inProgress) {
      options.onCycleSkipped?.('cycle_in_progress');
      return null;
    }

    // Reserve the process-local worker synchronously before the first await.
    // This makes concurrent run-once requests fail closed instead of both
    // crossing the provider boundary.
    inProgress = true;
    lastStartedAt = new Date().toISOString();
    try {
      const current = await state.get();
      if (current.state !== 'PILOT_ACTIVE') {
        lastOutcome = 'skipped';
        lastOutcome = 'skipped';
        options.onCycleSkipped?.('pilot_disabled');
        return null;
      }
      // Re-check immediately before external research so a concurrent kill-switch
      // transition fails closed before provider execution begins.
      const confirmed = await state.get();
      if (confirmed.state !== 'PILOT_ACTIVE') {
        options.onCycleSkipped?.('pilot_disabled');
        return null;
      }

      const runId = randomUUID();
      const result = await research.research({
        executionId: `pilot-lead-worker:${runId}`,
        correlationId: `pilot-lead-worker:${runId}`,
        geographicFocus: options.geographicFocus ?? 'South Africa',
        ...(options.country ? { country: options.country } : {}),
        maxQueries: options.maxQueries ?? 1,
        maxBusinessesPerQuery: options.maxBusinessesPerQuery ?? 3,
        maxWebResultsPerBusiness: options.maxWebResultsPerBusiness ?? 3,
      });
      lastCompletedAt = new Date().toISOString();
      lastOutcome = 'completed';
      lastSummary = {
        discovered: result.discovered,
        enriched: result.outcomes.enriched,
        duplicateSkipped: result.outcomes.duplicateSkipped,
        webResearchFailed: result.outcomes.webResearchFailed,
        unresolved: result.outcomes.unresolved,
        ambiguous: result.outcomes.ambiguous,
        notFound: result.outcomes.notFound,
      };
      options.onCycleCompleted?.(result);
      return result;
    } catch (error) {
      lastFailedAt = new Date().toISOString();
      lastOutcome = 'failed';
      options.onCycleFailed?.(error);
      throw error;
    } finally {
      inProgress = false;
    }
  }

  return {
    runOnce,
    getStatus() {
      return { inProgress, lastStartedAt, lastCompletedAt, lastFailedAt, lastOutcome, lastSummary };
    },
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void runOnce().catch(() => undefined);
      }, options.intervalMs);
      timer.unref();
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
