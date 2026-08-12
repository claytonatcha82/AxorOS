export type OperationsTaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type OperationsTaskStatus = 'queued' | 'ready' | 'in_progress' | 'waiting' | 'review' | 'completed' | 'blocked' | 'failed' | 'cancelled' | 'escalated';

export interface OperationsTask {
  taskId: string;
  originAgent: string;
  destinationAgent: string;
  objective: string;
  priority: OperationsTaskPriority;
  context: string[];
  knowledgeReferences: string[];
  inputs: string[];
  expectedOutput: string;
  dependencies: string[];
  risks: string[];
  confidence: number;
  approvalRequired: boolean;
  approvalOwner?: string;
  deadline: string;
  status: OperationsTaskStatus;
  nextAction: string;
}

export function validateOperationsTask(task: OperationsTask): string[] {
  const errors: string[] = [];
  const requiredText: Array<keyof OperationsTask> = ['taskId', 'originAgent', 'destinationAgent', 'objective', 'expectedOutput', 'deadline', 'nextAction'];
  for (const field of requiredText) {
    const value = task[field];
    if (typeof value !== 'string' || !value.trim()) errors.push(`${field} is required.`);
  }
  if (task.confidence < 0 || task.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (task.approvalRequired && !task.approvalOwner?.trim()) errors.push('approvalOwner is required when approvalRequired is true.');
  if (task.context.some((item) => !item.trim())) errors.push('context cannot contain blank items.');
  if (task.knowledgeReferences.some((item) => !item.trim())) errors.push('knowledgeReferences cannot contain blank items.');
  return errors;
}

const TRANSITIONS: Record<OperationsTaskStatus, readonly OperationsTaskStatus[]> = {
  queued: ['ready', 'cancelled', 'blocked'],
  ready: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['waiting', 'review', 'completed', 'blocked', 'failed', 'escalated'],
  waiting: ['ready', 'in_progress', 'blocked', 'cancelled', 'escalated'],
  review: ['completed', 'in_progress', 'blocked', 'failed', 'escalated'],
  completed: [],
  blocked: ['ready', 'cancelled', 'escalated'],
  failed: ['ready', 'escalated', 'cancelled'],
  cancelled: [],
  escalated: ['ready', 'cancelled'],
};

export function canTransitionOperationsTask(from: OperationsTaskStatus, to: OperationsTaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
