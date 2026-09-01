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
 */
export function createLeadDiscoveryQueryPlanner() {
  return {
    plan(input: LeadDiscoveryQueryPlannerInput): LeadDiscoveryQueryPlannerOutput {
      const maxQueries = input.maxQueries ?? 12;
      if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
        throw new Error('maxQueries must be an integer between 1 and 30.');
      }

      const geographicFocus = input.geographicFocus?.trim();
      const queries: string[] = [];

      for (const rawIndustry of unique(input.industries)) {
        const industry = clean(rawIndustry);
        if (!industry) continue;

        const suffix = geographicFocus ? ` in ${geographicFocus}` : '';
        const variants = [
          `${industry} businesses${suffix}`,
          `${industry} companies${suffix}`,
          `professional ${industry} firms${suffix}`,
        ];

        for (const variant of variants) {
          const query = clean(variant);
          if (!queries.includes(query)) queries.push(query);
          if (queries.length >= maxQueries) return { queries };
        }
      }

      return { queries };
    },
  };
}

export type LeadDiscoveryQueryPlanner = ReturnType<typeof createLeadDiscoveryQueryPlanner>;
