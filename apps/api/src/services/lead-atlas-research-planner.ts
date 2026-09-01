import type { KnowledgeContextPackage } from '../knowledge/knowledge-context-service.js';
import type { LeadAtlasContextBundle } from './lead-atlas-context-service.js';

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

function industriesFromAtlas(atlas: LeadAtlasContextBundle): string[] {
  const industrySources = atlas.idealClientProfile.sources.filter((source) => {
    const headings = source.citation.headingPath;
    return Array.isArray(headings)
      && headings.some((heading) => /^(target\s+)?industries$/i.test(heading.trim()));
  });

  if (industrySources.length > 0) {
    const industries = industrySources.flatMap((source) => {
      const reference = source.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const section = atlas.idealClientProfile.context.match(
        new RegExp(`${reference}[^\\n]*\\nSource:[^\\n]*\\nAuthority:[^\\n]*\\n([\\s\\S]*?)(?=\\n\\n\\[ATLAS-|$)`),
      )?.[1] ?? '';
      return bulletsFromText(section);
    });
    if (industries.length > 0) return unique(industries);
  }

  const legacyMatch = atlas.idealClientProfile.context.match(LEGACY_INDUSTRY_SECTION);
  if (!legacyMatch?.[1]) {
    throw new Error('Atlas Ideal Client Profile did not provide a Target Industries or Industries section.');
  }
  const legacyIndustries = bulletsFromText(legacyMatch[1]);
  if (legacyIndustries.length === 0) throw new Error('Atlas Ideal Client Profile did not provide target industries.');
  return unique(legacyIndustries);
}

export function createLeadAtlasResearchPlanner() {
  return {
    plan(input: LeadResearchPlanInput): LeadResearchPlan {
      const maxQueries = input.maxQueries ?? 12;
      if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
        throw new Error('maxQueries must be an integer between 1 and 30.');
      }
      const geographicFocus = input.geographicFocus?.trim();
      const industries = industriesFromAtlas(input.atlas);
      const queries = industries.slice(0, maxQueries).map((industry) =>
        geographicFocus ? `${industry} businesses in ${geographicFocus}` : `${industry} businesses`
      );
      return { queries, atlasSourcePaths: atlasPaths(input.atlas) };
    },
  };
}

export type LeadAtlasResearchPlanner = ReturnType<typeof createLeadAtlasResearchPlanner>;
