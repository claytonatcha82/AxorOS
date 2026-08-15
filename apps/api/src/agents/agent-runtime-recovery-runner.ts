import type { AgentRuntimeStore } from './agent-runtime-store.js';
import { recoverStaleRuntimeExecutions, type RuntimeRecoveryDecision } from './agent-runtime-recovery.js';

export interface RuntimeRecoveryRunnerOptions {
  staleAfterMs?: number;
  intervalMs?: number;
  limit?: number;
  now?: () => string;
  createEventId?: () => string;
  onCycleCompleted?: (decisions: readonly RuntimeRecoveryDecision[]) => void;
  onCycleFailed?: (error: unknown) => void;
}

export interface RuntimeRecoveryRunner {
  runOnce(): Promise<readonly RuntimeRecoveryDecision[]>;
  start(): void;
  stop(): void;
}

const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;

export function createRuntimeRecoveryRunner(
  store: AgentRuntimeStore,
  options: RuntimeRecoveryRunnerOptions = {},
): RuntimeRecoveryRunner {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const limit = options.limit ?? 100;

  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw new Error('runtime recovery intervalMs must be at least 1000.');
  }

  let timer: NodeJS.Timeout | undefined;
  let cycleInFlight = false;

  async function runOnce(): Promise<readonly RuntimeRecoveryDecision[]> {
    if (cycleInFlight) return [];
    cycleInFlight = true;
    try {
      const decisions = await recoverStaleRuntimeExecutions(store, {
        staleAfterMs,
        limit,
        ...(options.now ? { now: options.now } : {}),
        ...(options.createEventId ? { createEventId: options.createEventId } : {}),
      });
      options.onCycleCompleted?.(decisions);
      return decisions;
    } catch (error) {
      options.onCycleFailed?.(error);
      throw error;
    } finally {
      cycleInFlight = false;
    }
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void runOnce().catch(() => {
          // Failure is surfaced through onCycleFailed; keep future recovery cycles alive.
        });
      }, intervalMs);
      timer.unref();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
