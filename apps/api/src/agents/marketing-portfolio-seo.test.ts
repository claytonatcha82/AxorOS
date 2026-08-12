import assert from 'node:assert/strict';
import test from 'node:test';
import { outdatedContentAction, portfolioProjectMayPublish, seoPriority } from './marketing-portfolio-seo.js';

test('case study publication requires publishable approval and evidence for result claims', () => {
  assert.equal(portfolioProjectMayPublish({ projectId: 'p1', industry: 'Engineering', problem: 'Outdated site', solution: 'Modern responsive rebuild', results: ['Improved enquiry flow'], technologies: ['React'], beforeAfterEvidence: ['asset://before-after'], mediaReferences: [], approvalStatus: 'publishable' }), true);
  assert.equal(portfolioProjectMayPublish({ projectId: 'p2', industry: 'Engineering', problem: 'Outdated site', solution: 'Modern responsive rebuild', results: ['Traffic doubled'], technologies: ['React'], beforeAfterEvidence: [], mediaReferences: [], approvalStatus: 'publishable' }), false);
});

test('declining organic traffic with indexing issues is critical SEO work', () => {
  assert.equal(seoPriority({ organicTrafficTrend: 'down', indexingIssues: 2, brokenInternalLinks: 0, technicalIssues: 0, contentOutdated: 0, keywordVisibilityTrend: 'down' }), 'critical');
});

test('content that no longer reflects current services is flagged for update or retirement', () => {
  assert.equal(outdatedContentAction(false), 'update_or_retire');
  assert.equal(outdatedContentAction(true), 'keep');
});
