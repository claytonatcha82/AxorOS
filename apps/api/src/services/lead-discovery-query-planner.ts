export interface LeadDiscoveryQueryPlannerInput {
  industries: string[];
  geographicFocus?: string;
  maxQueries?: number;
  exhaustedQueries?: string[];
  geographicVariants?: string[];
}

export interface LeadDiscoveryQueryPlannerOutput {
  queries: string[];
  exhaustedQueries: string[];
  geographicVariantUsed?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a bounded, deterministic discovery queue from Atlas-approved industries.
 *
 * It skips exhausted queries, interleaves query variants per industry, and can
 * fall back to configured geographic sub-regions when the primary region has
 * been exhausted. Geographic targets remain explicitly bounded by the caller.
 */
export function createLeadDiscoveryQueryPlanner() {
  return {
    plan(input: LeadDiscoveryQueryPlannerInput): LeadDiscoveryQueryPlannerOutput {
      const maxQueries = input.maxQueries ?? 12;
      if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > 30) {
        throw new Error('maxQueries must be an integer between 1 and 30.');
      }

      const exhausted = new Set((input.exhaustedQueries ?? []).map(clean));
      const geographicFocus = input.geographicFocus?.trim();
      const geographicVariants = unique(input.geographicVariants ?? []);

      const geoTargets: string[] = [];
      if (geographicFocus) geoTargets.push(geographicFocus);
      for (const variant of geographicVariants) {
        if (variant.toLowerCase() !== geographicFocus?.toLowerCase()) {
          geoTargets.push(variant);
        }
      }
      if (geoTargets.length === 0) geoTargets.push('');

      const industries = unique(input.industries).map(clean).filter(Boolean);
      const variants = [
        (industry: string, geo: string) => `${industry} businesses${geo ? ` in ${geo}` : ''}`,
        (industry: string, geo: string) => `${industry} companies${geo ? ` in ${geo}` : ''}`,
        (industry: string, geo: string) => `professional ${industry} firms${geo ? ` in ${geo}` : ''}`,
      ];

      const queries: string[] = [];
      const skippedExhausted: string[] = [];
      let geographicVariantUsed: string | undefined;

      for (const industry of industries) {
        if (queries.length >= maxQueries) break;

        for (const variant of variants) {
          if (queries.length >= maxQueries) break;

          for (const geo of geoTargets) {
            if (queries.length >= maxQueries) break;

            const query = clean(variant(industry, geo));
            if (exhausted.has(query)) {
              skippedExhausted.push(query);
              continue;
            }
            if (!queries.includes(query)) {
              queries.push(query);
              if (!geographicVariantUsed && geo) geographicVariantUsed = geo;
            }
          }
        }
      }

      return {
        queries,
        exhaustedQueries: skippedExhausted,
        geographicVariantUsed,
      };
    },
  };
}

export type LeadDiscoveryQueryPlanner = ReturnType<typeof createLeadDiscoveryQueryPlanner>;
