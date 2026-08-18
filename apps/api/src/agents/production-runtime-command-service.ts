import type { RuntimeExecutionOutcome } from './agent-runtime-orchestrator.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './production-model-capabilities.js';
import type { AgentRuntimeStore } from './agent-runtime-store.js';

export interface ProductionRuntimeCommandOrchestrator {
  execute(input: {
    executionId: string;
    capabilityId: string;
  }): Promise<RuntimeExecutionOutcome>;
}

export interface ProductionRuntimeCommandDependencies {
  store: Pick<AgentRuntimeStore, 'getExecution'>;
  orchestrator: ProductionRuntimeCommandOrchestrator;
}

export function createProductionRuntimeCommandService(
  dependencies: ProductionRuntimeCommandDependencies,
) {
  return {
    async execute(executionId: string): Promise<RuntimeExecutionOutcome> {
      const normalizedExecutionId = executionId.trim();
      if (!normalizedExecutionId) {
        throw new Error('Production runtime executionId is required.');
      }

      const record = await dependencies.store.getExecution(normalizedExecutionId);
      if (!record) {
        throw new Error(`Production runtime execution ${normalizedExecutionId} was not found.`);
      }
      if (record.task.destinationAgent !== 'production_agent') {
        throw new Error(
          `Production runtime command cannot execute destination agent ${record.task.destinationAgent}.`,
        );
      }

      return dependencies.orchestrator.execute({
        executionId: normalizedExecutionId,
        capabilityId: PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY,
      });
    },
  };
}
