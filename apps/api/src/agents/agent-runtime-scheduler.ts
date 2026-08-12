import type { AgentPriority, AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';
import { findCircularDependencies, resolveTaskDependencies, taskParticipatesInCycle } from './agent-runtime-dependencies.js';

export type AgentCapacityState = 'available' | 'busy' | 'constrained' | 'overloaded';

export interface AgentCapacity {
  agentId: CoreAgentId;
  state: AgentCapacityState;
  activeTasks: number;
  maxConcurrentTasks: number;
}

export interface ScheduledTaskDecision {
  taskId: string;
  decision: 'ready' | 'waiting_dependencies' | 'blocked_cycle' | 'deferred_capacity';
  reason: string;
}

const priorityWeight: Record<AgentPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

export function rankRuntimeQueue(tasks: readonly AgentRuntimeTask[]): AgentRuntimeTask[] {
  return [...tasks].sort((a, b) => {
    const priorityDelta = priorityWeight[b.priority] - priorityWeight[a.priority];
    if (priorityDelta !== 0) return priorityDelta;
    const deadlineA = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
    const deadlineB = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function canScheduleForCapacity(task: AgentRuntimeTask, capacity: AgentCapacity): boolean {
  if (capacity.agentId !== task.destinationAgent) return false;
  if (capacity.state === 'overloaded') return false;
  if (capacity.activeTasks >= capacity.maxConcurrentTasks) return false;
  if (capacity.state === 'constrained' && (task.priority === 'low' || task.priority === 'normal')) return false;
  return true;
}

export function scheduleRuntimeTasks(
  tasks: readonly AgentRuntimeTask[],
  capacities: readonly AgentCapacity[],
): ScheduledTaskDecision[] {
  const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
  const capacityByAgent = new Map(capacities.map((capacity) => [capacity.agentId, capacity]));
  const cycles = findCircularDependencies(tasks);

  return rankRuntimeQueue(tasks)
    .filter((task) => task.status === 'queued' || task.status === 'waiting' || task.status === 'blocked')
    .map((task) => {
      if (taskParticipatesInCycle(task.taskId, cycles)) {
        return { taskId: task.taskId, decision: 'blocked_cycle', reason: 'Task participates in a circular dependency and requires Operations review.' };
      }

      const dependencies = resolveTaskDependencies(task, tasksById);
      if (!dependencies.ready) {
        return { taskId: task.taskId, decision: 'waiting_dependencies', reason: 'One or more dependencies are missing or incomplete.' };
      }

      const capacity = capacityByAgent.get(task.destinationAgent);
      if (!capacity || !canScheduleForCapacity(task, capacity)) {
        return { taskId: task.taskId, decision: 'deferred_capacity', reason: 'Destination agent does not currently have safe execution capacity.' };
      }

      return { taskId: task.taskId, decision: 'ready', reason: 'Dependencies are complete and destination capacity permits execution.' };
    });
}
