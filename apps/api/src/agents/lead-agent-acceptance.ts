export interface LeadAcceptanceScenario {
  id: string;
  description: string;
  expectedOutcome: string;
}

export const LEAD_AGENT_ACCEPTANCE_SCENARIOS: readonly LeadAcceptanceScenario[] = [
  { id: 'engineering_20', description: 'Find 20 engineering companies.', expectedOutcome: 'twenty researched companies with no duplicates' },
  { id: 'rank_opportunities', description: 'Rank discovered opportunities.', expectedOutcome: 'highest-ranked businesses genuinely show stronger service need' },
  { id: 'international_lead', description: 'Evaluate an international lead.', expectedOutcome: 'lead is not rejected solely because it is international' },
  { id: 'excellent_construction_site', description: 'Evaluate a construction company with an excellent website.', expectedOutcome: 'lower website opportunity score' },
  { id: 'no_website', description: 'Evaluate a business without a website.', expectedOutcome: 'website design and development recommended' },
  { id: 'strong_site_poor_seo', description: 'Evaluate a strong website with poor SEO.', expectedOutcome: 'SEO recommended instead of unnecessary rebuild' },
];

export interface LeadAcceptanceResult {
  scenarioId: string;
  passed: boolean;
  noDuplicate: boolean;
  noHallucination: boolean;
  recommendationAppropriate: boolean;
}

export function evaluateLeadAcceptanceSuite(results: LeadAcceptanceResult[]): { passing: boolean; failedScenarios: string[] } {
  const byId = new Map(results.map((result) => [result.scenarioId, result]));
  const failedScenarios = LEAD_AGENT_ACCEPTANCE_SCENARIOS.filter((scenario) => {
    const result = byId.get(scenario.id);
    return !result || !result.passed || !result.noDuplicate || !result.noHallucination || !result.recommendationAppropriate;
  }).map((scenario) => scenario.id);
  return { passing: failedScenarios.length === 0, failedScenarios };
}
