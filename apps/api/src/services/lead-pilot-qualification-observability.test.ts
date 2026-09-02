import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeLeadPilotQualification } from './lead-pilot-qualification-observability.js';

test('summarizes all six qualification scores without changing them', () => {
  const summary = summarizeLeadPilotQualification({
    companyName: 'Acme Construction',
    officialWebsiteUrl: null,
    assessments: {
      businessFit: { score: 8 },
      projectFit: { score: 8 },
      partnershipPotential: { score: 6 },
      decisionMakerAccess: { score: null },
      commercialFit: { score: 4 },
      timeline: { score: null },
    },
    totalScore: null,
    suggestedStatus: 'insufficient_information',
    missingInformation: ['Decision-maker authority is not yet evidenced.'],
    reviewExecutionId: 'lead-qualification-review:test',
  });

  assert.deepEqual(summary.scores, {
    businessFit: 8,
    projectFit: 8,
    partnershipPotential: 6,
    decisionMakerAccess: null,
    commercialFit: 4,
    timeline: null,
  });
  assert.equal(summary.totalScore, null);
  assert.equal(summary.websiteStatus, 'no_verified_website');
});

test('preserves a verified website in the observability summary', () => {
  const summary = summarizeLeadPilotQualification({
    companyName: 'Acme Engineering',
    officialWebsiteUrl: 'https://acme.example',
    assessments: {},
    totalScore: 42,
    suggestedStatus: 'good',
    missingInformation: [],
    reviewExecutionId: 'lead-qualification-review:test-2',
  });

  assert.equal(summary.websiteStatus, 'verified');
  assert.equal(summary.officialWebsiteUrl, 'https://acme.example');
  assert.equal(summary.totalScore, 42);
});
