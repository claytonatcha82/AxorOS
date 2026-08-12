export type KnowledgeMemoryLayer = 'atlas' | 'project' | 'task';

export interface KnowledgeMemoryRecord {
  id: string;
  layer: KnowledgeMemoryLayer;
  content: string;
  projectId?: string;
  taskId?: string;
  approvedForGlobalUse: boolean;
}

export function validateKnowledgeMemoryRecord(record: KnowledgeMemoryRecord): string[] {
  const errors: string[] = [];
  if (!record.id.trim()) errors.push('id is required.');
  if (!record.content.trim()) errors.push('content is required.');
  if (record.layer === 'project' && !record.projectId?.trim()) errors.push('project memory requires projectId.');
  if (record.layer === 'task' && !record.taskId?.trim()) errors.push('task memory requires taskId.');
  if (record.layer !== 'atlas' && record.approvedForGlobalUse) errors.push('project or task memory cannot become global knowledge without governance promotion.');
  return errors;
}

export function mayUseMemoryAcrossProjects(record: KnowledgeMemoryRecord): boolean {
  return record.layer === 'atlas' && record.approvedForGlobalUse;
}
