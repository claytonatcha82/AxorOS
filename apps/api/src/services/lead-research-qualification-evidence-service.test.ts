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
    publicWebResults: [result('Acme Construction', 'Established growing construction company with 120 employees, multiple clients, projects, branches, expansion into new markets, and an outdated website that is hurting online credibility.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, 10);
  assert.deepEqual(assessments.businessFit.evidenceReferences, ['public-web:https://research.example/acme']);
});

test('parses target industries from structured Atlas source chunks without inventing an ICP score', () => {
  const assessments = build({
    atlas: structuredAtlas(),
    companyName: 'Acme Manufacturing',
    publicWebResults: [result('Acme Manufacturing', 'Manufacturing company.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, null);
  assert.match(assessments.businessFit.missingInformation.join(' '), /ICP characteristics|evidenced/i);
});

test('retains a verified no-website business as a project opportunity', () => {
  const assessments = build({
    officialWebsiteUrl: null,
    publicWebResults: [result('Acme Construction', 'Established growing construction company with 120 employees, multiple clients and projects. The business currently has no website and wants to improve its online credibility.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, 10);
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

test('does not award decision-maker access 10 from company-name false positives', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Our managing director oversees operations. Email info@acme.example.', 'https://research.example/about')],
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

test('scores near-term timeline evidence at 8 rather than treating it as current urgency', () => {
  const assessments = build({
    publicWebResults: [result('Acme launch', 'The website launch is scheduled for next month.', 'https://research.example/news')],
  });
  assert.equal(assessments.timeline.score, 8);
});

test('scores explicit urgent current timeline evidence at 10', () => {
  const assessments = build({
    publicWebResults: [result('Acme urgent project', 'The website project is urgent and must launch this month.', 'https://research.example/news')],
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

test('detects outdated website as agency opportunity evidence', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Acme Construction has an outdated website design and poor mobile experience.', 'https://research.example/acme')],
  });
  assert.equal(assessments.projectFit.score, 8);
  assert.ok(assessments.projectFit.evidenceReferences.includes('public-web:https://research.example/acme'));
});

test('detects no website as strong project opportunity', () => {
  const assessments = build({
    officialWebsiteUrl: null,
    publicWebResults: [result('Acme Construction', 'Acme Construction has no online presence and no website.', 'https://research.example/acme')],
  });
  assert.equal(assessments.projectFit.score, 8);
});

test('detects digital transformation signals for project fit', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Acme Construction is undergoing digital transformation and implementing new ERP and CRM systems.', 'https://research.example/acme')],
  });
  assert.equal(assessments.projectFit.score, 8);
});

test('detects tender announcement as commercial and timeline evidence', () => {
  const assessments = build({
    publicWebResults: [result('Acme tender', 'Acme Construction tender closing date is 15 October 2026. RFP for website development services.', 'https://research.example/tender')],
  });
  assert.equal(assessments.commercialFit.score, 7);
  assert.equal(assessments.timeline.score, 8);
});

test('awards higher decision-maker score for named director with direct email', () => {
  const assessments = build({
    publicWebResults: [result('About Us', 'John Smith, Managing Director. Email: john.smith@acme.example. Phone: +27 11 555 0100.', 'https://research.example/about')],
  });
  assert.equal(assessments.decisionMakerAccess.score, 10);
});

test('awards decision-maker score for team page with senior roles', () => {
  const assessments = build({
    publicWebResults: [result('Our Team', 'Meet the leadership team. John Smith, Managing Director. Jane Doe, Operations Director.', 'https://research.example/team')],
  });
  const score = assessments.decisionMakerAccess.score;
  assert.ok(score !== null);
  assert.ok(score >= 8);
});

test('distinguishes generic contact from named decision-maker', () => {
  const assessments = build({
    publicWebResults: [result('Contact', 'Contact us for enquiries. info@acme.example.', 'https://research.example/contact')],
  });
  assert.equal(assessments.decisionMakerAccess.score, 4);
  assert.match(assessments.decisionMakerAccess.missingInformation.join(' '), /generic company contact|named decision-maker/i);
});

test('awards decision-maker score for LinkedIn company evidence', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction LinkedIn', 'Acme Construction company page. Leadership: John Smith, Managing Director.', 'https://linkedin.com/company/acme-construction')],
  });
  const score = assessments.decisionMakerAccess.score;
  assert.ok(score !== null);
  assert.ok(score >= 6);
});
