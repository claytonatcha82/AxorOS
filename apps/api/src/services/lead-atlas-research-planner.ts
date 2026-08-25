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

const BULLET = /^\s*-\s+(.+?)\s*$/gm;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function atlasPaths(atlas: LeadAtlasContextBundle): string[] {
  const packages: KnowledgeContextPackage[] = [
    atlas.idealClientProfile,
    atlas.leadGeneration,
    atlas.leadQualification,
    atlas.leadAgentGovernance,
  ];
  return unique(packages.flatMap((package_) =>
    package_.sources.map((source) => source.citation.path)
  ));
}

function industriesFromAtlas(atlas: LeadAtlasContextBundle): string[] {
  const industrySources = atlas.idealClientProfile.sources.filter((source) =>
    source.citation.headingPath.some((heading) => /^(target\s+)?industries$/i.test(heading.trim()))
  );
  if (industrySources.length === 0) {
    throw new Error('Atlas Ideal Client Profile did not provide an Industries section.');
  }

  const industries = industrySources.flatMap((source) => {
    const reference = source.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const section = atlas.idealClientProfile.context.match(
      new RegExp(`${reference}[^\\n]*\\nSource:[^\\n]*\\nAuthority:[^\\n]*\\n([\\s\\S]*?)(?=\\n\\n\\[ATLAS-|$)`),
    )?.[1] ?? '';
    return [...section.matchAll(BULLET)].map((item) => item[1]!.replace(/\*\*/g, '').trim());
  });

  if (industries.length === 0) throw new Error('Atlas Ideal Client Profile did not provide target industries.');
  return unique(industries);
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
