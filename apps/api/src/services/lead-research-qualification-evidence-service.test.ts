import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadResearchQualificationAssessments } from './lead-research-qualification-evidence-service.js';

const result = (title: string, content: string, url: string) => ({ title, content, url });

const baseAtlas = {
  targetIndustries: ['Construction', 'Engineering', 'Manufacturing'],
  geographicFocus: 'South Africa',
};

function build(overrides: Partial<Parameters<typeof buildLeadResearchQualificationAssessments>[0]> = {}) {
  return buildLeadResearchQualificationAssessments({
    atlas: baseAtlas,
    companyName: 'Acme Construction',
    officialWebsiteUrl: 'https://acme.example',
    publicWebResults: [],
    ...overrides,
  });
}

test('strong ICP-aligned business fit scores 10', () => {
  const assessments = build({
    publicWebResults: [result('Acme Construction', 'Acme Construction is a South African construction company delivering commercial and industrial projects.', 'https://research.example/acme')],
  });
  assert.equal(assessments.businessFit.score, 10);
});

test('structured Atlas parsing does not invent ICP score', () => {
  const assessments = build({ atlas: { targetIndustries: ['Construction'] } });
  assert.equal(assessments.businessFit.score, null);
});

test('no-website business project opportunity is evidenced', () => {
  const assessments = build({ officialWebsiteUrl: null, publicWebResults: [result('Acme Construction', 'Acme Construction operates in commercial building projects and invites business enquiries.', 'https://research.example/acme')] });
  assert.equal(assessments.projectFit.score, 8);
});

test('evidenced digital deficiency project fit scores 8', () => {
  const assessments = build({ publicWebResults: [result('Acme Construction', 'The company website is outdated and has a poor mobile experience.', 'https://research.example/acme')] });
  assert.equal(assessments.projectFit.score, 8);
});

test('decision-maker named role without contact route scores 6', () => {
  const assessments = build({ publicWebResults: [result('Leadership', 'John Smith, Managing Director.', 'https://research.example/about')] });
  assert.equal(assessments.decisionMakerAccess.score, 6);
});

test('false positive company name still requires credible decision-maker evidence', () => {
  const assessments = build({ companyName: 'John Smith Construction', publicWebResults: [result('About', 'John Smith, Managing Director.', 'https://research.example/about')] });
  assert.equal(assessments.decisionMakerAccess.score, 6);
});

test('named role plus credible business contact route scores 8', () => {
  const assessments = build({ publicWebResults: [result('Leadership', 'John Smith, Managing Director. Contact our office at info@acme.example.', 'https://research.example/about')] });
  assert.equal(assessments.decisionMakerAccess.score, 8);
});

test('named role plus direct contact scores 10', () => {
  const assessments = build({ publicWebResults: [result('About Us', 'John Smith, Managing Director. Email: john.smith@acme.example. Phone: +27 11 555 0100.', 'https://research.example/about')] });
  assert.equal(assessments.decisionMakerAccess.score, 10);
});

test('team page with senior roles scores at least 8', () => {
  const assessments = build({ publicWebResults: [result('Our Team', 'Meet the leadership team. John Smith, Managing Director. Jane Doe, Operations Director.', 'https://research.example/team')] });
  const score = assessments.decisionMakerAccess.score;
  assert.ok(score !== null);
  assert.ok(score >= 8);
});

test('generic contact scores 4 and identifies missing named decision-maker', () => {
  const assessments = build({ publicWebResults: [result('Contact', 'Contact us for enquiries. info@acme.example.', 'https://research.example/contact')] });
  assert.equal(assessments.decisionMakerAccess.score, 4);
  assert.match(assessments.decisionMakerAccess.missingInformation.join(' '), /generic company contact|named decision-maker/i);
});

test('LinkedIn company evidence scores at least 6', () => {
  const assessments = build({ publicWebResults: [result('Acme Construction LinkedIn', 'Acme Construction company page. Leadership: John Smith, Managing Director.', 'https://linkedin.com/company/acme-construction')] });
  const score = assessments.decisionMakerAccess.score;
  assert.ok(score !== null);
  assert.ok(score >= 6);
});

test('explicit tender scores commercial fit 7 and future closing date scores timeline 8', () => {
  const assessments = build({
    publicWebResults: [result('Acme tender', 'Acme Construction tender closing date is 15 October 2026. RFP for website development services.', 'https://research.example/tender')],
  });
  assert.equal(assessments.commercialFit.score, 7);
  assert.equal(assessments.timeline.score, 8);
});
