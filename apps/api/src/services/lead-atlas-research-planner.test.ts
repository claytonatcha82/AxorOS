import assert from 'node:assert/strict';
import test from 'node:test';
import { createLeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';

function package_(title: string, context: string, reference = '[ATLAS-01]', headingPath?: string[]) {
  return {
    query: title,
    context,
    sources: [{ reference, score: 1, citation: { title, path: `Volume 1 - Agency/${title}.md.md`, ...(headingPath ? { headingPath } : {}) } }],
    includedItems: 1,
    truncated: false,
    characterCount: context.length,
  };
}

function atlas() {
  return {
    idealClientProfile: package_('Ideal Client Profile', '# Target Industries\n\n- Construction\n- Engineering\n- Manufacturing\n- Healthcare\n- Hospitality\n- Property\n\n# Geographic Focus\nSouth Africa'),
    leadGeneration: package_('Lead Generation System', 'Quality over quantity.'),
    leadQualification: package_('Lead Qualification', 'Business fit and project fit.'),
    leadAgentGovernance: package_('Lead Agent', 'Atlas OS remains the single source of truth.'),
  } as never;
}

test('derives bounded breadth-first discovery queries from Atlas target industries', () => {
  const plan = createLeadAtlasResearchPlanner().plan({ atlas: atlas(), geographicFocus: 'South Africa', maxQueries: 4 });
  assert.deepEqual(plan.queries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
    'professional Construction firms in South Africa',
    'Engineering businesses in South Africa',
  ]);
  assert.equal(plan.queries.some((query) => /web design|website developer/i.test(query)), false);
  assert.ok(plan.atlasSourcePaths.some((path) => path.includes('Ideal Client Profile')));
  assert.equal(plan.atlasSourcePaths.some((path) => path.endsWith('.md.md')), false);
  assert.ok(plan.atlasSourcePaths.every((path) => path.endsWith('.md')));
});

test('extracts industries from the exact Atlas chunk rendering used in production', () => {
  const structuredContext = [
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
  ].join('\r\n');
  const structured = {
    idealClientProfile: package_('Ideal Client Profile', structuredContext, '[ATLAS-06]', ['Industries']),
    leadGeneration: package_('Lead Generation System', 'Quality over quantity.'),
    leadQualification: package_('Lead Qualification', 'Business fit and project fit.'),
    leadAgentGovernance: package_('Lead Agent', 'Atlas OS remains the single source of truth.'),
  } as never;

  const plan = createLeadAtlasResearchPlanner().plan({ atlas: structured, geographicFocus: 'South Africa', maxQueries: 6 });
  assert.deepEqual(plan.queries, [
    'Construction businesses in South Africa',
    'Construction companies in South Africa',
    'professional Construction firms in South Africa',
    'Engineering businesses in South Africa',
    'Engineering companies in South Africa',
    'professional Engineering firms in South Africa',
  ]);
});

test('fails closed when Atlas does not provide target industries', () => {
  const missing = atlas() as any;
  missing.idealClientProfile = package_('Ideal Client Profile', '# Purpose\nNo target industry section here.');
  assert.throws(
    () => createLeadAtlasResearchPlanner().plan({ atlas: missing }),
    /Target Industries.*Retrieved headings:.*Source paths:.*Truncated:.*Included chunks:/,
  );
});
