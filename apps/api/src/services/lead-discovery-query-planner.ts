export interface LeadDiscoveryQueryPlannerInput {
  industries: string[];
  geographicFocus?: string;
  maxQueries?: number;
}

export interface LeadDiscoveryQueryPlannerOutput {
  queries: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a bounded, deterministic discovery queue from Atlas-approved industries.
 * It expands each industry into a small set of semantically distinct searches,
 * without inventing new industries or geographic markets.
 *
 * Industries are interleaved by variant rather than exhausted one industry at a
 * time. This prevents a small query cap from repeatedly spending an entire
 * cycle on the first Atlas industries when provider results heavily overlap.
 */
export function createLeadDiscoveryQueryPlanner() {
  return {
    plan(input: LeadDiscoveryQueryPlannerInput): LeadDiscoveryQueryPlannerOutput {
      const maxQueries = input.maxQueries ?? 12;
      if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
        throw new Error('maxQueries must be an integer between 1 and 30.');
      }

      const geographicFocus = input.geographicFocus?.trim();
      const industries = unique(input.industries).map(clean).filter(Boolean);
      const suffix = geographicFocus ? ` in ${geographicFocus}` : '';
      const variants = [
        (industry: string) => `${industry} businesses${suffix}`,
        (industry: string) => `${industry} companies${suffix}`,
        (industry: string) => `professional ${industry} firms${suffix}`,
      ];
      const queries: string[] = [];

      for (const variant of variants) {
        for (const industry of industries) {
          const query = clean(variant(industry));
          if (!queries.includes(query)) queries.push(query);
          if (queries.length >= maxQueries) return { queries };
        }
      }

      return { queries };
    },
  };
}

export type LeadDiscoveryQueryPlanner = ReturnType<typeof createLeadDiscoveryQueryPlanner>;
