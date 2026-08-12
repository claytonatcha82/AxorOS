import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepurposeJobs, validateRepurposeRequest } from './marketing-repurpose.js';

test('one approved project source can generate governed multi-channel jobs', () => {
  const request = { source: { sourceId: 'project-1', approved: true, knowledgeReferences: ['project://1'], factualClaimsVerified: true }, channels: ['blog', 'linkedin', 'newsletter', 'portfolio_page'] as const };
  const jobs = createRepurposeJobs({ ...request, channels: [...request.channels] });
  assert.equal(jobs.length, 4);
  assert.ok(jobs.every((job) => job.sourceId === 'project-1'));
});

test('unapproved or unverified source cannot be multiplied across channels', () => {
  const errors = validateRepurposeRequest({ source: { sourceId: 'project-2', approved: false, knowledgeReferences: [], factualClaimsVerified: false }, channels: ['blog'] });
  assert.ok(errors.includes('source must be approved.'));
  assert.ok(errors.includes('source factual claims must be verified.'));
  assert.ok(errors.includes('knowledgeReferences are required.'));
});
