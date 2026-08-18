import type { Pool } from 'pg';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import {
  dispatchProductionHandoff,
  type HandoffDispatchResult,
  type ProductionFinanceAuthorisation,
} from './agent-runtime-handoff.js';
import type { AgentRuntimeRegistry } from './agent-runtime-registry.js';

export interface PostgresProductionHandoffDependencies {
  pool: Pick<Pool, 'query'>;
  registry: AgentRuntimeRegistry;
}

export function createPostgresProductionHandoffDispatcher(
  dependencies: PostgresProductionHandoffDependencies,
) {
  const financeClearanceStore = new FinanceClearancePostgresStore(dependencies.pool);

  return {
    async dispatch(
      task: AgentRuntimeTask,
      capabilityId: string,
      authorisation: ProductionFinanceAuthorisation,
    ): Promise<HandoffDispatchResult> {
      return dispatchProductionHandoff(
        task,
        capabilityId,
        dependencies.registry,
        financeClearanceStore,
        authorisation,
      );
    },
  };
}
