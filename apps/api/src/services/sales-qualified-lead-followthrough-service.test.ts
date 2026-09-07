import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalesFollowthroughTask, parseGeneratedOutput } from './sales-qualified-lead-followthrough-service.js';

const baseInput = {
  executionId: 'sales-followthrough:intake-1',
  leadId: 'lead-1',
  correlationId: 'corr-1',
  atlasSourcePaths: ['Volume 1 - Agency/06 Sales System/Sales Agent.md'],
  lead: { id: 'lead-1', companyName: 'Example Engineering', contactEmail: 'person@example.com' },
  qualification: { totalScore: 42, suggestedStatus: 'good' },
  intakeResult: { intakeAccepted: true },
  createdAt: '2026-09-07T10:00:00.000Z',
};

const completeOutput = JSON.stringify({
  salesContext: {
    decisionMaker: 'A Person',
    industry: 'Engineering',
    country: 'South Africa',
    businessSummary: 'Engineering services business.',
    websiteAudit: 'Public website evidence reviewed.',
    painPoints: ['Mobile usability opportunity'],
    recommendedServices: ['Website improvement assessment'],
    priority: 'normal',
    confidence: 0.8,
    previousContact: 'No previous contact recorded.',
  },
  email: { subject: 'Website opportunity', body: 'Internal candidate draft.' },
});

test('builds followthrough task with intake-only authority', () => {
  const task = buildSalesFollowthroughTask(baseInput);
  assert.equal(task.originAgent, 'lead_agent');
  assert.equal(task.destinationAgent, 'sales_agent');
  assert.equal(task.status, 'ready');
  assert.equal(task.nextAction, 'execute_qualified_lead_sales_followthrough');
  assert.equal(task.inputs.salesIntakeOnly, true);
  assert.equal(task.inputs.salesDispatchAuthorised, false);
  assert.equal(task.inputs.outreachAuthorised, false);
  assert.equal(task.approvalRequired, false);
  assert.equal(task.maxAttempts, 1);
});

test('deduplicates Atlas references in the followthrough task', () => {
  const task = buildSalesFollowthroughTask({ ...baseInput, atlasSourcePaths: ['Atlas/A.md', 'Atlas/A.md', 'Atlas/B.md'] });
  assert.deepEqual(task.knowledgeReferences, ['Atlas/A.md', 'Atlas/B.md']);
});

test('parses strict JSON containing sales context and internal email draft', () => {
  const parsed = parseGeneratedOutput(completeOutput);
  assert.equal(parsed.salesContext.industry, 'Engineering');
  assert.equal(parsed.email.subject, 'Website opportunity');
  assert.equal(parsed.email.body, 'Internal candidate draft.');
});

test('accepts a fenced JSON response without weakening the schema', () => {
  const parsed = parseGeneratedOutput(`\n\`\`\`json\n${completeOutput}\n\`\`\`\n`);
  assert.equal(parsed.email.subject, 'Website opportunity');
});

test('fails closed on invalid model JSON', () => {
  assert.throws(() => parseGeneratedOutput('not json'), /invalid JSON/i);
});

test('fails closed when salesContext is omitted', () => {
  assert.throws(() => parseGeneratedOutput(JSON.stringify({ email: { subject: 'x', body: 'y' } })), /omitted salesContext/i);
});

test('fails closed when the internal email draft is incomplete', () => {
  assert.throws(() => parseGeneratedOutput(JSON.stringify({ salesContext: {}, email: { subject: '', body: 'x' } })), /incomplete email draft/i);
});
