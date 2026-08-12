export type ExecutiveAssignedFunction =
  | 'operations'
  | 'lead'
  | 'sales'
  | 'production'
  | 'marketing'
  | 'finance'
  | 'support';

export interface ExecutiveOperationsInstruction {
  instructionId: string;
  task: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedFunction: ExecutiveAssignedFunction;
  rationale: string;
  expectedOutcome: string;
}

const DIRECT_SPECIALIST_EXECUTION_ACTIONS = new Set([
  'find_leads',
  'send_sales_email',
  'build_website',
  'manage_support_ticket',
  'post_marketing_content',
  'process_payment',
  'deploy_code',
]);

export function validateExecutiveOperationsInstruction(instruction: ExecutiveOperationsInstruction): string[] {
  const errors: string[] = [];
  if (!instruction.instructionId.trim()) errors.push('instructionId is required.');
  if (!instruction.task.trim()) errors.push('task is required.');
  if (!instruction.rationale.trim()) errors.push('rationale is required.');
  if (!instruction.expectedOutcome.trim()) errors.push('expectedOutcome is required.');
  return errors;
}

export function executiveMayDirectlyExecute(action: string): boolean {
  return !DIRECT_SPECIALIST_EXECUTION_ACTIONS.has(action);
}

export function executiveShouldDelegateToOperations(assignedFunction: ExecutiveAssignedFunction): boolean {
  return assignedFunction !== 'operations';
}
