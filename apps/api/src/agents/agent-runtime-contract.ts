export type CoreAgentId = 'knowledge_agent' | 'executive_agent' | 'operations_agent' | 'lead_agent' | 'sales_agent' | 'production_agent' | 'support_agent' | 'marketing_agent' | 'finance_agent';

export type AgentExecutionStatus = 'queued' | 'ready' | 'in_progress' | 'waiting' | 'review' | 'completed' | 'blocked' | 'failed' | 'cancelled' | 'escalated';
export type AgentPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AgentRuntimeTask {
  taskId: string;
  executionId: string;
  originAgent: CoreAgentId | 'human_executive';
  destinationAgent: CoreAgentId;
  objective: string;
  priority: AgentPriority;
  context: Record<string, unknown>;
  knowledgeReferences: string[];
  inputs: Record<string, unknown>;
  expectedOutput: string;
  dependencies: string[];
  risks: string[];
  confidence: number;
  approvalRequired: boolean;
  approvalOwner?: CoreAgentId | 'human_executive';
  deadline?: string;
  status: AgentExecutionStatus;
  nextAction: string;
  attempt: number;
  maxAttempts: number;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRuntimeResult {
  executionId: string;
  taskId: string;
  agentId: CoreAgentId;
  status: Extract<AgentExecutionStatus, 'completed' | 'blocked' | 'failed' | 'escalated' | 'review'>;
  output: Record<string, unknown>;
  evidenceReferences: string[];
  knowledgeReferences: string[];
  confidence: number;
  nextAction?: string;
  errorCode?: string;
  errorMessage?: string;
  completedAt?: string;
}

export function validateAgentRuntimeTask(task: AgentRuntimeTask): string[] {
  const errors: string[] = [];
  if (!task.taskId.trim()) errors.push('taskId is required.');
  if (!task.executionId.trim()) errors.push('executionId is required.');
  if (!task.objective.trim()) errors.push('objective is required.');
  if (!task.expectedOutput.trim()) errors.push('expectedOutput is required.');
  if (!task.nextAction.trim()) errors.push('nextAction is required.');
  if (!task.correlationId.trim()) errors.push('correlationId is required.');
  if (!Number.isInteger(task.attempt) || task.attempt < 1) errors.push('attempt must be a positive integer.');
  if (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1) errors.push('maxAttempts must be a positive integer.');
  if (task.attempt > task.maxAttempts) errors.push('attempt cannot exceed maxAttempts.');
  if (task.confidence < 0 || task.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (task.approvalRequired && !task.approvalOwner) errors.push('approvalOwner is required when approvalRequired is true.');
  return errors;
}
