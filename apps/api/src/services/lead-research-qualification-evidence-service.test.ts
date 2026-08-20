import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';

function atlas() {
  return {
    idealClientProfile: { context: '# Target Industries\n\n- Construction\n- Engineering\n- Healthcare\n\n# Geographic Focus\nSouth Africa' },
  } as never;
}

test('records target-industry evidence without inventing a numeric business-fit score', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Engineering',
    officialWebsiteUrl: 'https://acme.example/',
    publicWebResults: [{ title: 'Acme Engineering | Home', url: 'https://acme.example/', content: 'Engineering services for industrial clients.' }],
  });

  assert.equal(assessments.businessFit.score, null);
  assert.deepEqual(assessments.businessFit.evidenceReferences, ['public-web:https://acme.example/']);
  assert.match(assessments.businessFit.missingInformation[0]!, /does not define a deterministic numeric Business Fit score/i);
  assert.equal(assessments.projectFit.score, null);
  assert.equal(assessments.partnershipPotential.score, null);
  assert.equal(assessments.decisionMakerAccess.score, null);
  assert.equal(assessments.commercialFit.score, null);
  assert.equal(assessments.timeline.score, null);
});

test('does not invent business-fit score when target-industry evidence is absent', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://example.test/',
    publicWebResults: [{ title: 'Example Business', url: 'https://example.test/', content: 'Independent business information.' }],
  });
  assert.equal(assessments.businessFit.score, null);
  assert.deepEqual(assessments.businessFit.evidenceReferences, []);
  assert.match(assessments.businessFit.missingInformation[0]!, /Target-industry/);
});

test('fails closed when Atlas target industries are unavailable', () => {
  assert.throws(() => createLeadResearchQualificationEvidenceService().build({
    atlas: { idealClientProfile: { context: '# Purpose\nMissing target industries.' } } as never,
    companyName: 'Example',
    officialWebsiteUrl: 'https://example.test/',
    publicWebResults: [],
  }), /Target Industries/);
});
