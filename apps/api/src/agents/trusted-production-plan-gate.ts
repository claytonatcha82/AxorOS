import type { Pool } from 'pg';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import { PRODUCTION_PROJECT_PLAN_CAPABILITY } from './production-project-plan-capability.js';

export interface TrustedProductionPlanGateDependencies {
  pool?: Pick<Pool, 'query'>;
}

function requiredTaskContextString(task: AgentRuntimeTask, key: string, label: string): string {
  const value = task.context[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persisted Production plan task is invalid.');
  return value as Record<string, unknown>;
}

export async function assertTrustedProductionPlanGate(
  task: AgentRuntimeTask,
  dependencies: TrustedProductionPlanGateDependencies,
): Promise<void> {
  if (!dependencies.pool) throw new Error('Production plan evidence store is not configured.');

  const planExecutionId = requiredTaskContextString(task, 'productionPlanExecutionId', 'Production plan execution reference');
  const commercialRecordReference = requiredTaskContextString(task, 'commercialRecordReference', 'Production commercial record');

  const execution = await dependencies.pool.query(
    `select destination_agent, status, task, result
       from runtime.agent_executions
      where execution_id = $1`,
    [planExecutionId],
  );
  if (!execution.rows[0]) throw new Error('Persisted Production plan execution was not found.');

  const row = execution.rows[0] as Record<string, unknown>;
  if (row.destination_agent !== 'production_agent') throw new Error('Persisted Production plan execution belongs to the wrong agent.');
  if (row.status !== 'completed') throw new Error('Persisted Production plan execution is not completed.');

  const planTask = parseJsonRecord(row.task);
  const planContext = parseJsonRecord(planTask.context);
  if (planContext.commercialRecordReference !== commercialRecordReference) {
    throw new Error('Persisted Production plan commercial record does not match implementation task.');
  }

  const planResult = parseJsonRecord(row.result);
  if (planResult.status !== 'completed') throw new Error('Persisted Production plan result is not completed.');
  const evidenceReferences = planResult.evidenceReferences;
  if (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
    throw new Error('Persisted Production plan result has no provider evidence.');
  }

  const dispatch = await dependencies.pool.query(
    `select 1
       from runtime.agent_events
      where execution_id = $1
        and event_type = 'status_transitioned'
        and payload ->> 'capabilityId' = $2
      limit 1`,
    [planExecutionId, PRODUCTION_PROJECT_PLAN_CAPABILITY],
  );
  if ((dispatch.rowCount ?? dispatch.rows.length) < 1) {
    throw new Error('Persisted Production plan execution was not produced by the governed project-planning capability.');
  }
}
