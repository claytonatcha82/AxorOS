import { randomUUID } from 'node:crypto';
import type { PilotSystemStateRecord } from '../data/pilot-system-state-postgres-store.js';
import type { AtlasLeadResearchOutput, AtlasLeadResearchInput } from './lead-atlas-research-orchestrator.js';
import { logEvent } from '../logger.js';

export interface PilotLeadWorkerState {
  get(): Promise<PilotSystemStateRecord>;
}

export interface PilotLeadWorkerResearch {
  research(input: AtlasLeadResearchInput): Promise<AtlasLeadResearchOutput>;
}

// NEW: Optional store for persisting query exhaustion state across cycles
export interface PilotLeadWorkerQueryStore {
  get(): Promise<Record<string, { exhausted: boolean; lastAttemptedAt?: string; nextPageToken?: string | null }>>;
  save(state: Record<string, { exhausted: boolean; lastAttemptedAt: string; nextPageToken?: string | null }>): Promise<void>;
}

export interface PilotLeadWorkerOptions {
  intervalMs: number;
  geographicFocus?: string;
  geographicVariants?: string[]; // NEW
  country?: string;
  maxQueries?: number;
  maxBusinessesPerQuery?: number;
  maxWebResultsPerBusiness?: number;
  pilotAutoAdvanceThreshold?: number; // NEW
  onCycleCompleted?: (result: AtlasLeadResearchOutput) => void;
  onCycleSkipped?: (reason: 'pilot_disabled' | 'cycle_in_progress') => void;
  onCycleFailed?: (error: unknown) => void;
}

export function createPilotLeadWorker(
  state: PilotLeadWorkerState,
  research: PilotLeadWorkerResearch,
  options: PilotLeadWorkerOptions,
  queryStore?: PilotLeadWorkerQueryStore, // NEW: optional but required for exhaustion tracking
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
    queriesExhausted: number; // NEW
  } | null = null;

  async function runOnce(): Promise<AtlasLeadResearchOutput | null> {
    if (inProgress) {
      options.onCycleSkipped?.('cycle_in_progress');
      return null;
    }

    inProgress = true;
    lastStartedAt = new Date().toISOString();
    try {
      const current = await state.get();
      if (current.state !== 'PILOT_ACTIVE') {
        lastOutcome = 'skipped';
        options.onCycleSkipped?.('pilot_disabled');
        return null;
      }
      const confirmed = await state.get();
      if (confirmed.state !== 'PILOT_ACTIVE') {
        options.onCycleSkipped?.('pilot_disabled');
        return null;
      }

      const runId = randomUUID();
      
      // NEW: Load persisted query state so we skip exhausted queries
      const queryState = queryStore ? await queryStore.get() : {};

      const result = await research.research({
        executionId: `pilot-lead-worker:${runId}`,
        correlationId: `pilot-lead-worker:${runId}`,
        geographicFocus: options.geographicFocus ?? 'South Africa',
        geographicVariants: options.geographicVariants ?? [
          'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 
          'Mpumalanga', 'Limpopo', 'North West', 'Free State', 'Northern Cape', 'Durban', 'Johannesburg', 'Cape Town'
        ],
        ...(options.country ? { country: options.country } : {}),
        maxQueries: options.maxQueries ?? 12, // Bumped default from 6 to 12 for better coverage
        maxBusinessesPerQuery: options.maxBusinessesPerQuery ?? 3,
        maxWebResultsPerBusiness: options.maxWebResultsPerBusiness ?? 3,
        queryState,
      });
      
      // NEW: Save updated query state for next cycle
      if (queryStore) {
        await queryStore.save(result.updatedQueryState);
      }

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
        queriesExhausted: Object.values(result.updatedQueryState).filter((s) => s.exhausted).length,
      };
      options.onCycleCompleted?.(result);
      logEvent('info', 'pilot_lead_worker_qualification_summary', {
        leads: result.enriched.map((lead) => ({
          companyName: lead.companyName,
          officialWebsiteUrl: lead.officialWebsiteUrl,
          websiteStatus: lead.officialWebsiteUrl ? 'verified' : 'no_verified_website',
          businessFit: lead.preliminaryQualification.assessments.businessFit.score,
          projectFit: lead.preliminaryQualification.assessments.projectFit.score,
          partnershipPotential: lead.preliminaryQualification.assessments.partnershipPotential.score,
          decisionMakerAccess: lead.preliminaryQualification.assessments.decisionMakerAccess.score,
          commercialFit: lead.preliminaryQualification.assessments.commercialFit.score,
          timeline: lead.preliminaryQualification.assessments.timeline.score,
          totalScore: lead.preliminaryQualification.totalScore,
          suggestedStatus: lead.preliminaryQualification.suggestedStatus,
          missingInformation: lead.preliminaryQualification.missingInformation,
          reviewExecutionId: lead.qualificationReviewExecutionId,
          disposition: lead.qualificationDisposition.disposition, // NEW
          humanApprovalRequired: lead.qualificationDisposition.humanApprovalRequired, // NEW
        })),
        queryMetrics: {
          queriesRun: result.queries.length,
          queriesExhausted: lastSummary.queriesExhausted,
          totalQueryState: Object.keys(result.updatedQueryState).length,
          queriesWithPendingPageTokens: Object.values(result.updatedQueryState).filter((s) => typeof s.nextPageToken === 'string').length,
        },
      });
      return result;
    } catch (error) {
      lastFailedAt = new Date().toISOString();
      lastOutcome = 'failed';
      logEvent('error', 'pilot_lead_worker_exception_diagnostic_v1', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack ?? '(no stack)' : '(non-Error thrown value)',
        runtimeCommit: process.env.RAILWAY_GIT_COMMIT_SHA ?? '(unknown)',
        runtimeDeployment: process.env.RAILWAY_DEPLOYMENT_ID ?? '(unknown)',
      });
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
