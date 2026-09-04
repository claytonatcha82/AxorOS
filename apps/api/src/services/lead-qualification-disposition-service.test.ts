import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';
import { createLeadQualificationDispositionService } from './lead-qualification-disposition-service.js';

function qualification(
  suggestedStatus: PreliminaryLeadQualificationResult['suggestedStatus'],
  overrides: Partial<PreliminaryLeadQualificationResult> = {},
): PreliminaryLeadQualificationResult {
  return {
    totalScore: suggestedStatus === 'insufficient_information' ? null : 45,
    suggestedStatus,
    humanReviewRequired: true,
    missingInformation: [],
    atlasSourcePaths: ['Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md'],
    assessments: {
      businessFit: { score: 8, evidenceReferences: ['fixture:business-fit'], missingInformation: [] },
      projectFit: { score: 8, evidenceReferences: ['fixture:project-fit'], missingInformation: [] },
      partnershipPotential: { score: 7, evidenceReferences: ['fixture:partnership'], missingInformation: [] },
      decisionMakerAccess: { score: 7, evidenceReferences: ['fixture:decision-maker'], missingInformation: [] },
      commercialFit: { score: 8, evidenceReferences: ['fixture:commercial'], missingInformation: [] },
      timeline: { score: 7, evidenceReferences: ['fixture:timeline'], missingInformation: [] },
    },
    ...overrides,
  };
}

const service = createLeadQualificationDispositionService();
const pilotService = createLeadQualificationDispositionService({ pilotAutoAdvanceThreshold: 40 });

test('holds excellent and good leads for human approval before advance', () => {
  for (const status of ['excellent', 'good'] as const) {
    const result = service.evaluate(qualification(status));
    assert.equal(result.disposition, 'hold');
    assert.equal(result.recommendedAction, 'approve_advance');
    assert.equal(result.humanApprovalRequired, true);
    assert.match(result.reasons[0]!, /human approval/i);
  }
});

test('pilot auto-advances a good lead at exactly 40 when evidence is complete', () => {
  const result = pilotService.evaluate(qualification('good', { totalScore: 40 }));
  assert.equal(result.disposition, 'advance');
  assert.equal(result.recommendedAction, 'approve_advance');
  assert.equal(result.humanApprovalRequired, false);
});

test('pilot keeps a good lead below 40 on hold', () => {
  const result = pilotService.evaluate(qualification('good', { totalScore: 39 }));
  assert.equal(result.disposition, 'hold');
  assert.equal(result.recommendedAction, 'approve_advance');
  assert.equal(result.humanApprovalRequired, true);
});

test('pilot never auto-advances incomplete evidence even when the threshold score is supplied', () => {
  const result = pilotService.evaluate(qualification('insufficient_information', {
    totalScore: null,
    missingInformation: ['Timeline has not been verified.'],
  }));
  assert.equal(result.disposition, 'hold');
  assert.equal(result.recommendedAction, 'collect_more_evidence');
  assert.equal(result.humanApprovalRequired, true);
});

test('holds moderate leads for fit review', () => {
  const result = service.evaluate(qualification('moderate'));
  assert.equal(result.disposition, 'hold');
  assert.equal(result.recommendedAction, 'review_fit');
  assert.equal(result.humanApprovalRequired, true);
});

test('holds poor-fit leads for human approval before rejection', () => {
  const result = service.evaluate(qualification('poor_fit'));
  assert.equal(result.disposition, 'hold');
  assert.equal(result.recommendedAction, 'approve_reject');
  assert.match(result.reasons[0]!, /human approval/i);
});

test('holds incomplete qualification for more evidence and preserves missing information', () => {
  const result = service.evaluate(qualification('insufficient_information', {
    missingInformation: ['Decision-maker has not been verified.'],
  }));
  assert.equal(result.disposition, 'hold');
  assert.equal(result.recommendedAction, 'collect_more_evidence');
  assert.ok(result.reasons.includes('Decision-maker has not been verified.'));
});

test('rejects disposition input that removes human review authority', () => {
  const invalid = {
    ...qualification('good'),
    humanReviewRequired: false,
  } as unknown as PreliminaryLeadQualificationResult;
  assert.throws(() => service.evaluate(invalid), /human review authority/i);
});

test('requires authoritative Atlas source paths', () => {
  assert.throws(
    () => service.evaluate(qualification('good', { atlasSourcePaths: [] })),
    /authoritative Atlas source paths/i,
  );
});

test('deduplicates Atlas source paths', () => {
  const path = 'Volume 1 - Agency/05 Client Acquisition/Lead Qualification.md';
  const result = service.evaluate(qualification('good', { atlasSourcePaths: [path, path] }));
  assert.deepEqual(result.atlasSourcePaths, [path]);
});
