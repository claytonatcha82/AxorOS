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
        { reference: '[ATLAS-06]', citation: { title: 'Ideal Client Profile', path: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md', headingPath: ['Industries'] } },
        { reference: '[ATLAS-07]', citation: { title: 'Ideal Client Profile', path: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile.md.md', headingPath: ['Geographic Focus'] } },
      ],
    },
  } as never;
}

function result(title: string, content: string, url: string) {
  return { title, content, url };
}

function build(overrides: Partial<Parameters<ReturnType<typeof createLeadResearchQualificationEvidenceService>['build']>[0]> = {}) {
  return createLeadResearchQualificationEvidenceService().build({
    atlas: atlas(),
    companyName: 'Acme Construction',
    officialWebsiteUrl: 'https://acme.example/',
    publicWebResults: [result('Acme Construction', 'Construction company.', 'https://research.example/acme')],
    ...overrides,
  });
}

test('scores a strong ICP-aligned business fit', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Established growing construction company with 120 employees, multiple clients, projects, branches and expansion into new markets.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, 10);
  assert.deepEqual(assessments.businessFit.evidenceReferences, ['public-web:https://research.example/acme']);
});

test('parses target industries from structured Atlas source chunks', () => {
  const assessments = build({
    atlas: structuredAtlas(),
    companyName: 'Acme Manufacturing',
    publicWebResults: [result('Acme Manufacturing', 'Manufacturing company.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, 5);
  assert.deepEqual(assessments.businessFit.evidenceReferences, ['public-web:https://research.example/acme']);
});

test('retains a verified no-website business as a project opportunity', () => {
  const assessments = build({
    officialWebsiteUrl: null,
    publicWebResults: [result('Acme Construction', 'Established construction company with multiple clients and projects.', 'https://research.example/acme')],
  });
  assert.equal(assessments.projectFit.score, 8);
  assert.match(assessments.projectFit.missingInformation.join(' '), /No verified official website/i);
});

test('uses evidenced digital deficiency for project fit when a website exists', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Construction company with an outdated website and weak mobile experience.', 'https://research.example/acme')],
  });
  assert.equal(assessments.projectFit.score, 8);
  assert.deepEqual(assessments.projectFit.evidenceReferences, ['public-web:https://research.example/acme']);
});

test('does not award decision-maker access 8 without a contact route', () => {
  const assessments = build({
    publicWebResults: [result('Leadership', 'Managing Director Jane Doe leads Acme Construction.', 'https://research.example/about')],
  });
  assert.equal(assessments.decisionMakerAccess.score, 6);
});

test('awards decision-maker 8 for named role plus credible business contact route', () => {
  const assessments = build({
    publicWebResults: [result('Leadership', 'Managing Director Jane Doe leads Acme Construction. Contact our office for enquiries.', 'https://research.example/about')],
  });
  assert.equal(assessments.decisionMakerAccess.score, 8);
});

test('awards decision-maker 10 only with named role and direct contact route', () => {
  const assessments = build({
    publicWebResults: [result('Leadership', 'Managing Director Jane Doe. Direct email: jane.doe@acme.example.', 'https://research.example/contact')],
  });
  assert.equal(assessments.decisionMakerAccess.score, 10);
});

test('does not infer commercial capacity from generic company operations', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Established construction company with clients, customers, projects and services.', 'https://research.example/acme')],
  });
  assert.equal(assessments.commercialFit.score, 4);
  assert.match(assessments.commercialFit.missingInformation.join(' '), /budget|payment|value/i);
});

test('commercial evidence can score 7 from one explicit strong signal', () => {
  const assessments = build({
    publicWebResults: [result('Acme tender', 'Acme is participating in a procurement tender.', 'https://research.example/tender')],
  });
  assert.equal(assessments.commercialFit.score, 7);
});

test('does not invent timeline from a generic website opportunity', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Construction company with an online presence opportunity.', 'https://research.example/acme')],
  });
  assert.equal(assessments.timeline.score, null);
});

test('scores explicit current timeline evidence', () => {
  const assessments = build({
    publicWebResults: [result('Acme launch', 'The website launch is scheduled for next month.', 'https://research.example/news')],
  });
  assert.equal(assessments.timeline.score, 10);
});

test('keeps unsupported categories null rather than converting uncertainty into poor fit', () => {
  const assessments = build({
    companyName: 'Unknown Company',
    officialWebsiteUrl: null,
    publicWebResults: [result('Unknown Company', 'Company information unavailable.', 'https://research.example/unknown')],
  });
  assert.equal(assessments.businessFit.score, null);
  assert.equal(assessments.projectFit.score, null);
  assert.equal(assessments.decisionMakerAccess.score, 2);
  assert.equal(assessments.commercialFit.score, null);
  assert.equal(assessments.timeline.score, null);
});

test('poor-fit scoring is not manufactured from absence of evidence', () => {
  const assessments = build({
    companyName: 'Example Business',
    publicWebResults: [result('Example Business', 'General business information.', 'https://research.example/example')],
  });
  assert.notEqual(assessments.businessFit.score, 0);
  assert.notEqual(assessments.projectFit.score, 0);
  assert.notEqual(assessments.commercialFit.score, 0);
});

test('only supplied public-web URLs are emitted as evidence references', () => {
  const assessments = build({
    officialWebsiteUrl: 'https://official.example/',
    publicWebResults: [result('Acme Construction', 'Construction business with branding requirements.', 'https://research.example/listing')],
  });
  assert.deepEqual(assessments.projectFit.evidenceReferences, ['public-web:https://research.example/listing']);
  assert.equal(assessments.projectFit.evidenceReferences.includes('public-web:https://official.example/'), false);
});

test('fails closed when Atlas target industries are unavailable', () => {
  assert.throws(() => build({
    atlas: { idealClientProfile: { context: '# Purpose\nMissing target industries.', sources: [] } } as never,
  }), /Target Industries/);
});
