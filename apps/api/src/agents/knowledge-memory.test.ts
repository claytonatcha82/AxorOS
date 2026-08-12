import assert from 'node:assert/strict';
import test from 'node:test';
import { mayUseMemoryAcrossProjects, validateKnowledgeMemoryRecord, type KnowledgeMemoryRecord } from './knowledge-memory.js';

test('Atlas memory may be reused globally only when approved', () => {
  const record: KnowledgeMemoryRecord = { id: 'atlas-1', layer: 'atlas', content: 'Approved agency standard', approvedForGlobalUse: true };
  assert.deepEqual(validateKnowledgeMemoryRecord(record), []);
  assert.equal(mayUseMemoryAcrossProjects(record), true);
});

test('project memory remains scoped to a project', () => {
  const record: KnowledgeMemoryRecord = { id: 'project-1', layer: 'project', content: 'Client prefers dark theme', projectId: 'client-x', approvedForGlobalUse: false };
  assert.deepEqual(validateKnowledgeMemoryRecord(record), []);
  assert.equal(mayUseMemoryAcrossProjects(record), false);
});

test('task memory cannot silently become organisational knowledge', () => {
  const record: KnowledgeMemoryRecord = { id: 'task-1', layer: 'task', content: 'Temporary task note', taskId: 'task-123', approvedForGlobalUse: true };
  const errors = validateKnowledgeMemoryRecord(record);
  assert.ok(errors.includes('project or task memory cannot become global knowledge without governance promotion.'));
});

test('scoped memory requires its scope identifier', () => {
  assert.ok(validateKnowledgeMemoryRecord({ id: 'p', layer: 'project', content: 'x', approvedForGlobalUse: false }).includes('project memory requires projectId.'));
  assert.ok(validateKnowledgeMemoryRecord({ id: 't', layer: 'task', content: 'x', approvedForGlobalUse: false }).includes('task memory requires taskId.'));
});
