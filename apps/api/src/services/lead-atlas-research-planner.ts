import type { KnowledgeContextPackage } from '../knowledge/knowledge-context-service.js';
import type { LeadAtlasContextBundle } from './lead-atlas-context-service.js';
import { createLeadDiscoveryQueryPlanner } from './lead-discovery-query-planner.js';

export interface LeadResearchPlanInput {
  atlas: LeadAtlasContextBundle;
  geographicFocus?: string;
  maxQueries?: number;
}

export interface LeadResearchPlan {
  queries: string[];
  atlasSourcePaths: string[];
}

const LEGACY_INDUSTRY_SECTION = /#\s+(?:Target\s+)?Industries([\s\S]*?)(?=\n#\s+|$)/i;
const BULLET = /^\s*-\s+(.+?)\s*$/gm;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeAtlasPath(path: string): string {
  return path.replace(/(?:\.md)+$/i, '.md');
}

function atlasPaths(atlas: LeadAtlasContextBundle): string[] {
  const packages: KnowledgeContextPackage[] = [
    atlas.idealClientProfile,
    atlas.leadGeneration,
    atlas.leadQualification,
    atlas.leadAgentGovernance,
  ];
  return unique(packages.flatMap((package_) =>
    package_.sources.map((source) => normalizeAtlasPath(source.citation.path))
  ));
}

function bulletsFromText(text: string): string[] {
  return [...text.matchAll(BULLET)].map((item) => item[1]!.replace(/\*\*/g, '').trim());
}

function atlasReferenceSection(context: string, reference: string): string {
  // Atlas context is already structured as reference/source/authority blocks.
  // Split on the static block boundary instead of interpolating a dynamic
  // reference into RegExp. This avoids runtime regex failures for references
  // such as [ATLAS-06].
  const normalizedReference = reference.trim();
  const block = context
    .split(/\n\n(?=\[ATLAS-)/)
    .find((candidate) => candidate.split('\n', 1)[0]?.trim().startsWith(normalizedReference));

  if (!block) return '';

  const lines = block.split('\n');
  const authorityIndex = lines.findIndex((line) => /^Authority:\s*/i.test(line.trim()));
  return authorityIndex >= 0 ? lines.slice(authorityIndex + 1).join('\n') : '';
}

function industriesFromAtlas(atlas: LeadAtlasContextBundle): string[] {
  const industrySources = atlas.idealClientProfile.sources.filter((source) => {
    const headings = source.citation.headingPath;
    return Array.isArray(headings)
      && headings.some((heading) => /^(target\s+)?industries$/i.test(heading.trim()));
  });

  if (industrySources.length > 0) {
    const industries = industrySources.flatMap((source) =>
      bulletsFromText(atlasReferenceSection(atlas.idealClientProfile.context, source.reference))
    );
    if (industries.length > 0) return unique(industries);
  }

  const legacyMatch = atlas.idealClientProfile.context.match(LEGACY_INDUSTRY_SECTION);
  if (!legacyMatch?.[1]) {
    const headings = unique(atlas.idealClientProfile.sources.flatMap((source) =>
      Array.isArray(source.citation.headingPath) ? source.citation.headingPath : []
    ));
    const paths = unique(atlas.idealClientProfile.sources.map((source) => source.citation.path));
    throw new Error(
      `Atlas Ideal Client Profile did not provide a Target Industries or Industries section. Retrieved headings: ${headings.length ? headings.join(' | ') : '(none)'}. Source paths: ${paths.length ? paths.join(' | ') : '(none)'}. Truncated: ${atlas.idealClientProfile.truncated}. Included chunks: ${atlas.idealClientProfile.includedItems}. Runtime commit: ${process.env.RAILWAY_GIT_COMMIT_SHA ?? '(unknown)'}. Runtime deployment: ${process.env.RAILWAY_DEPLOYMENT_ID ?? '(unknown)'}.`,
    );
  }
  const legacyIndustries = bulletsFromText(legacyMatch[1]);
  if (legacyIndustries.length === 0) throw new Error('Atlas Ideal Client Profile did not provide target industries.');
  return unique(legacyIndustries);
}

export function createLeadAtlasResearchPlanner() {
  const discoveryQueryPlanner = createLeadDiscoveryQueryPlanner();

  return {
    plan(input: LeadResearchPlanInput): LeadResearchPlan {
      const maxQueries = input.maxQueries ?? 12;
      const industries = industriesFromAtlas(input.atlas);
      const plannerInput = {
        industries,
        maxQueries,
        ...(input.geographicFocus?.trim() ? { geographicFocus: input.geographicFocus.trim() } : {}),
      };
      const planned = discoveryQueryPlanner.plan(plannerInput);
      return { queries: planned.queries, atlasSourcePaths: atlasPaths(input.atlas) };
    },
  };
}

export type LeadAtlasResearchPlanner = ReturnType<typeof createLeadAtlasResearchPlanner>;
