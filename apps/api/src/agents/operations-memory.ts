export type OperationsMemoryLayer = 'operational' | 'process' | 'temporary';

export interface OperationsMemoryRecord {
  id: string;
  layer: OperationsMemoryLayer;
  content: string;
  sourceWorkflowId: string;
  expiresAt?: string;
  humanApprovedForProcessPromotion?: boolean;
}

export function validateOperationsMemory(record: OperationsMemoryRecord): string[] {
  const errors: string[] = [];
  if (!record.id.trim()) errors.push('id is required.');
  if (!record.content.trim()) errors.push('content is required.');
  if (!record.sourceWorkflowId.trim()) errors.push('sourceWorkflowId is required.');
  if (record.layer === 'temporary' && !record.expiresAt?.trim()) errors.push('temporary memory requires expiresAt.');
  return errors;
}

export function mayPromoteToProcessMemory(record: OperationsMemoryRecord): boolean {
  if (record.layer === 'process') return true;
  return record.humanApprovedForProcessPromotion === true;
}
