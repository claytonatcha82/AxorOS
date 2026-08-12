export interface OperationsDependencyTask {
  taskId: string;
  dependencies: string[];
  status: 'queued' | 'ready' | 'in_progress' | 'waiting' | 'review' | 'completed' | 'blocked' | 'failed' | 'cancelled' | 'escalated';
}

export function unresolvedDependencies(task: OperationsDependencyTask, tasks: OperationsDependencyTask[]): string[] {
  const byId = new Map(tasks.map((item) => [item.taskId, item]));
  return task.dependencies.filter((dependencyId) => byId.get(dependencyId)?.status !== 'completed');
}

export function hasDependencyCycle(tasks: OperationsDependencyTask[]): boolean {
  const graph = new Map(tasks.map((task) => [task.taskId, task.dependencies]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) if (graph.has(dependency) && visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return tasks.some((task) => visit(task.taskId));
}

export type OperationsRetryAction = 'retry_automatically' | 'alternative_approach' | 'escalate' | 'no_retry';

export function operationsRetryAction(attempt: number, highRisk = false): OperationsRetryAction {
  if (highRisk) return 'no_retry';
  if (attempt === 1) return 'retry_automatically';
  if (attempt === 2) return 'alternative_approach';
  return 'escalate';
}
