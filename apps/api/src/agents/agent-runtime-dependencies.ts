import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export interface DependencyResolution {
  ready: boolean;
  missingDependencies: string[];
  incompleteDependencies: string[];
}

export function resolveTaskDependencies(task: AgentRuntimeTask, tasksById: ReadonlyMap<string, AgentRuntimeTask>): DependencyResolution {
  const missingDependencies: string[] = [];
  const incompleteDependencies: string[] = [];

  for (const dependencyId of task.dependencies) {
    const dependency = tasksById.get(dependencyId);
    if (!dependency) {
      missingDependencies.push(dependencyId);
      continue;
    }
    if (dependency.status !== 'completed') incompleteDependencies.push(dependencyId);
  }

  return {
    ready: missingDependencies.length === 0 && incompleteDependencies.length === 0,
    missingDependencies,
    incompleteDependencies,
  };
}

export function findCircularDependencies(tasks: readonly AgentRuntimeTask[]): string[][] {
  const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      if (start >= 0) cycles.push([...stack.slice(start), taskId]);
      return;
    }

    const task = tasksById.get(taskId);
    if (!task) return;

    visiting.add(taskId);
    stack.push(taskId);
    for (const dependencyId of task.dependencies) visit(dependencyId);
    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) visit(task.taskId);
  return cycles;
}

export function taskParticipatesInCycle(taskId: string, cycles: readonly string[][]): boolean {
  return cycles.some((cycle) => cycle.includes(taskId));
}
