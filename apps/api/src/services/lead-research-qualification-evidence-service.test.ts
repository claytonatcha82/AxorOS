import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';

function atlas() {
  return {
    idealClientProfile: {
      context: '# Target Industries\n\n- Construction\n- Engineering\n- Healthcare\n\n# Geographic Focus\nSouth Africa',
      sources: [],
    },
  } as never;
}

function result(title: string, content: string, url = 'https://example.com') {
  return { title, content, url };
}

test('scores ICP-aligned businesses and retains no-website opportunities', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Construction',
    officialWebsiteUrl: null,
    publicWebResults: [result('Acme Construction', 'Established construction company with multiple projects, clients and operations in South Africa.')],
  });

  assert.ok((assessments.businessFit.score ?? 0) >= 6);
  assert.equal(assessments.projectFit.score, 8);
  assert.ok(assessments.projectFit.evidenceReferences.length > 0);
});

test('scores category evidence without inventing decision-maker authority or budget', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Engineering',
    officialWebsiteUrl: 'https://example.com',
    publicWebResults: [
      result('Acme Engineering leadership', 'Managing Director Jane Doe leads an established engineering company delivering projects and contracts.', 'https://example.com/about'),
      result('Acme Engineering tender', 'Procurement tender and project value information.', 'https://example.org/tender'),
    ],
  });

  assert.equal(assessments.decisionMakerAccess.score, 8);
  assert.ok((assessments.commercialFit.score ?? 0) >= 7);
  assert.match(assessments.decisionMakerAccess.missingInformation.join(' '), /authority/i);
});

test('keeps categories unverified when there is no meaningful evidence', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Unknown Company',
    officialWebsiteUrl: null,
    publicWebResults: [result('Unknown Company', 'Company information unavailable.')],
  });

  assert.equal(assessments.businessFit.score, null);
  assert.equal(assessments.projectFit.score, null);
});

test('only returns supplied public-web URLs as evidence references', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://official.example/',
    publicWebResults: [result('Example Business', 'Construction business with website development requirements.', 'https://research.example/listing')],
  });

  assert.deepEqual(assessments.projectFit.evidenceReferences, ['public-web:https://research.example/listing']);
});

test('fails closed when Atlas target industries are unavailable', () => {
  assert.throws(() => createLeadResearchQualificationEvidenceService().build({
    atlas: { idealClientProfile: { context: '# Purpose\nMissing target industries.', sources: [] } } as never,
    companyName: 'Example',
    officialWebsiteUrl: 'https://example.test/',
    publicWebResults: [],
  }), /Target Industries/);
});
