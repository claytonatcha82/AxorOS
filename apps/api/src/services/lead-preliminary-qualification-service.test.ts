import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadPreliminaryQualificationService, type QualificationCategory } from './lead-preliminary-qualification-service.js';

const qualificationContext = `
## Business Fit
## Project Fit
## Partnership Potential
## Decision-Maker Access
## Commercial Fit
## Timeline
# Lead Scoring Model
Maximum Score: 60
`;

function atlas() {
  return {
    leadQualification: {
      context: qualificationContext,
      sources: [{ citation: { path: 'Volume 1 - Agency/05 - Client Acquisition/Lead Qualification.md.md' } }],
    },
  } as never;
}

const categories: QualificationCategory[] = ['businessFit', 'projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline'];

function assessments(score: number | null) {
  return Object.fromEntries(categories.map((category) => [category, {
    score,
    evidenceReferences: score === null ? [] : [`public-web:${category}`],
    missingInformation: score === null ? [`Missing ${category} evidence`] : [],
  }])) as never;
}

test('applies the Atlas 60-point qualification thresholds and always requires human review', () => {
  const service = createLeadPreliminaryQualificationService();
  const excellent = service.evaluate({ atlas: atlas(), assessments: assessments(9) });
  assert.equal(excellent.totalScore, 54);
  assert.equal(excellent.suggestedStatus, 'excellent');
  assert.equal(excellent.humanReviewRequired, true);

  const moderateAssessments = assessments(5) as any;
  moderateAssessments.businessFit.score = 6;
  const moderate = service.evaluate({ atlas: atlas(), assessments: moderateAssessments });
  assert.equal(moderate.totalScore, 31);
  assert.equal(moderate.suggestedStatus, 'moderate');
});

test('does not invent scores when evidence is insufficient', () => {
  const result = createLeadPreliminaryQualificationService().evaluate({ atlas: atlas(), assessments: assessments(null) });
  assert.equal(result.totalScore, null);
  assert.equal(result.suggestedStatus, 'insufficient_information');
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.missingInformation.length, 6);
});

test('rejects a scored category without supporting evidence', () => {
  const input = assessments(8) as any;
  input.businessFit.evidenceReferences = [];
  assert.throws(
    () => createLeadPreliminaryQualificationService().evaluate({ atlas: atlas(), assessments: input }),
    /cannot receive a score without evidence references/,
  );
});

test('fails closed if the Atlas qualification framework is incomplete', () => {
  const incomplete = atlas() as any;
  incomplete.leadQualification.context = 'Business Fit only';
  assert.throws(
    () => createLeadPreliminaryQualificationService().evaluate({ atlas: incomplete, assessments: assessments(8) }),
    /Atlas Lead Qualification framework is missing required criterion/,
  );
});
