import type { Pool } from 'pg';

export const SYNTHETIC_PRODUCTION_PLAN_EXECUTION_ID = 'exec:production-plan:synthetic';

export function createSyntheticProductionPlanEvidencePool(
  commercialRecordReference: string,
): Pick<Pool, 'query'> {
  return {
    query: (async (sql: string) => {
      if (sql.includes('from runtime.agent_executions')) {
        return {
          rowCount: 1,
          rows: [{
            destination_agent: 'production_agent',
            status: 'completed',
            task: { context: { commercialRecordReference } },
            result: {
              status: 'completed',
              evidenceReferences: ['model:synthetic:production-plan'],
            },
          }],
        };
      }
      if (sql.includes('from runtime.agent_events')) {
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }
      throw new Error(`Unexpected Production plan fixture SQL: ${sql}`);
    }) as unknown as Pool['query'],
  };
}
