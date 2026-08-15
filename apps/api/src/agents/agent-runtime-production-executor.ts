import type { AgentObjectiveConflict } from './agent-objective-conflicts.js';
import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { RuntimeExecutionOutcome, RuntimeSchedulingContext } from './agent-runtime-orchestrator.js';
import type { AgentCapacity } from './agent-runtime-scheduler.js';

export interface ProductionRuntimeOrchestrator {
  execute(input: {
    executionId: string;
    capabilityId: string;
    objectiveConflict?: AgentObjectiveConflict;
    scheduling: RuntimeSchedulingContext;
  }): Promise<RuntimeExecutionOutcome>;
}

export interface ProductionRuntimeSchedulingSource {
  listSchedulingTasks(executionId: string): Promise<readonly AgentRuntimeTask[]>;
  getAgentCapacity(agentId: AgentRuntimeTask['destinationAgent']): Promise<AgentCapacity>;
}

export interface ExecuteProductionRuntimeTaskInput {
  executionId: string;
  capabilityId: string;
  objectiveConflict?: AgentObjectiveConflict;
}

export interface ProductionRuntimeExecutionDependencies {
  orchestrator: ProductionRuntimeOrchestrator;
  schedulingSource: ProductionRuntimeSchedulingSource;
}

function requireCurrentTask(tasks: readonly AgentRuntimeTask[], executionId: string): AgentRuntimeTask {
  const matches = tasks.filter((task) => task.executionId === executionId);
  if (matches.length === 0) {
    throw new Error(`production runtime scheduling source did not return execution ${executionId}.`);
  }
  if (matches.length > 1) {
    throw new Error(`production runtime scheduling source returned duplicate execution ${executionId}.`);
  }
  return matches[0]!;
}

export function createProductionRuntimeExecutor(dependencies: ProductionRuntimeExecutionDependencies) {
  return {
    async execute(input: ExecuteProductionRuntimeTaskInput): Promise<RuntimeExecutionOutcome> {
      if (!input.executionId.trim()) throw new Error('production runtime executionId is required.');
      if (!input.capabilityId.trim()) throw new Error('production runtime capabilityId is required.');

      const tasks = await dependencies.schedulingSource.listSchedulingTasks(input.executionId);
      const currentTask = requireCurrentTask(tasks, input.executionId);
      const capacity = await dependencies.schedulingSource.getAgentCapacity(currentTask.destinationAgent);

      if (capacity.agentId !== currentTask.destinationAgent) {
        throw new Error(
          `production runtime capacity mismatch: expected ${currentTask.destinationAgent}, received ${capacity.agentId}.`,
        );
      }

      const request: {
        executionId: string;
        capabilityId: string;
        objectiveConflict?: AgentObjectiveConflict;
        scheduling: RuntimeSchedulingContext;
      } = {
        executionId: input.executionId,
        capabilityId: input.capabilityId,
        scheduling: { tasks, capacity },
      };
      if (input.objectiveConflict) request.objectiveConflict = input.objectiveConflict;

      return dependencies.orchestrator.execute(request);
    },
  };
}
