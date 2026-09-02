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

function structuredAtlas() {
  return {
    idealClientProfile: {
      context: [
        '[ATLAS-06] Ideal Client Profile > Industries',
        'Source: Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md',
        'Authority: authoritative',
        '- Construction',
        '- Engineering',
        '- Manufacturing',
        '',
        '[ATLAS-07] Ideal Client Profile > Geographic Focus',
        'Source: Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md',
        'Authority: authoritative',
        'South Africa',
      ].join('\r\n'),
      sources: [
        {
          reference: '[ATLAS-06]',
          citation: {
            title: 'Ideal Client Profile',
            path: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md',
            headingPath: ['Industries'],
          },
        },
        {
          reference: '[ATLAS-07]',
          citation: {
            title: 'Ideal Client Profile',
            path: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md',
            headingPath: ['Geographic Focus'],
          },
        },
      ],
    },
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

test('parses target industries from the structured Atlas source chunk', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: structuredAtlas(),
    companyName: 'Acme Manufacturing',
    officialWebsiteUrl: 'https://acme.example/',
    publicWebResults: [{ title: 'Acme Manufacturing | Home', url: 'https://acme.example/', content: 'Manufacturing services for industrial clients.' }],
  });

  assert.equal(assessments.businessFit.score, null);
  assert.deepEqual(assessments.businessFit.evidenceReferences, ['public-web:https://acme.example/']);
  assert.match(assessments.businessFit.missingInformation[0]!, /Manufacturing/);
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

test('captures category-specific public-web evidence without converting qualitative evidence into an invented score', () => {
  const url = 'https://acme.example/about';
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Engineering',
    officialWebsiteUrl: 'https://acme.example/',
    publicWebResults: [{
      title: 'Acme Engineering leadership and services',
      url,
      content: 'The founder and managing director oversee the business. We provide website development and ongoing website maintenance. Contact our director for a quotation. A new website launch is planned for next month.',
    }],
  });

  for (const category of ['projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline'] as const) {
    assert.equal(assessments[category].score, null);
    assert.deepEqual(assessments[category].evidenceReferences, [`public-web:${url}`]);
    assert.match(assessments[category].missingInformation[1]!, /must not manufacture a score/i);
  }
});

test('does not treat a missing website as missing qualification evidence by itself', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Construction',
    officialWebsiteUrl: null,
    publicWebResults: [{ title: 'Acme Construction', url: 'https://directory.example/acme', content: 'Construction company. Owner and director listed. Website development services are being considered.' }],
  });

  assert.equal(assessments.businessFit.score, null);
  assert.equal(assessments.projectFit.score, null);
  assert.deepEqual(assessments.projectFit.evidenceReferences, ['public-web:https://directory.example/acme']);
});

test('only returns supplied public-web URLs as evidence references', () => {
  const assessments = createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Example Business',
    officialWebsiteUrl: 'https://official.example/',
    publicWebResults: [{ title: 'Example Business', url: 'https://research.example/listing', content: 'Construction business with website development requirements.' }],
  });

  assert.deepEqual(assessments.projectFit.evidenceReferences, ['public-web:https://research.example/listing']);
  assert.equal(assessments.projectFit.evidenceReferences.includes('public-web:https://official.example/'), false);
});

test('fails closed when Atlas target industries are unavailable', () => {
  assert.throws(() => createLeadResearchQualificationEvidenceService().build({
    atlas: { idealClientProfile: { context: '# Purpose\nMissing target industries.', sources: [] } } as never,
    companyName: 'Example',
    officialWebsiteUrl: 'https://example.test/',
    publicWebResults: [],
  }), /Target Industries/);
});
