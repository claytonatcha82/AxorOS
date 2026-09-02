import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';

function atlas() {
  return { idealClientProfile: { context: '# Target Industries\n- Construction\n- Engineering\n- Healthcare\n# Geographic Focus\nSouth Africa', sources: [] } } as never;
}

test('scores an ICP-aligned no-website business as an opportunity', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(), companyName: 'Acme Construction', officialWebsiteUrl: null,
    publicWebResults: [{ title: 'Acme Construction', url: 'https://directory.example/acme', content: 'Established growing construction company with 120 employees and expansion into new markets. The business has no website and wants to improve online visibility.' }],
  });
  assert.ok((assessments.businessFit.score ?? 0) >= 6);
  assert.equal(assessments.projectFit.score, 8);
});

test('does not score an unrelated business from absent evidence', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(), companyName: 'Unknown Company', officialWebsiteUrl: null,
    publicWebResults: [{ title: 'Unknown Company', url: 'https://example.test/', content: 'Information unavailable.' }],
  });
  assert.equal(assessments.businessFit.score, null);
  assert.equal(assessments.projectFit.score, null);
});
