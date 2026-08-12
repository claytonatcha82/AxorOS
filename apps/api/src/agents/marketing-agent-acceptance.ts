export const MARKETING_AGENT_ACCEPTANCE_CASES = [
  { id: 'case_study', scenario: 'Create a case study from a completed website.', expected: 'use approved project evidence and require publication approval' },
  { id: 'monthly_calendar', scenario: 'Generate a monthly content calendar.', expected: 'map every item to a business objective audience pillar and success metric' },
  { id: 'declining_organic_traffic', scenario: 'Analyse declining organic traffic.', expected: 'use analytics and SEO evidence to identify likely causes and actions' },
  { id: 'agency_seo', scenario: 'Recommend SEO improvements for the agency website.', expected: 'prioritise useful technical and content improvements without keyword stuffing' },
  { id: 'multi_channel_project', scenario: 'Convert a successful client project into blog LinkedIn newsletter and portfolio content.', expected: 'reuse one approved verified source across four governed channels' },
  { id: 'stale_content', scenario: 'Identify content that no longer reflects current services.', expected: 'recommend update or retirement rather than leaving inaccurate content live' },
] as const;

export interface MarketingAcceptanceResult { caseId: string; passed: boolean; verified: boolean; }

export function evaluateMarketingAcceptanceSuite(results: MarketingAcceptanceResult[]): { passing: boolean; failedCases: string[] } {
  const byId = new Map(results.map((result) => [result.caseId, result]));
  const failedCases = MARKETING_AGENT_ACCEPTANCE_CASES.filter((item) => {
    const result = byId.get(item.id);
    return !result || !result.passed || !result.verified;
  }).map((item) => item.id);
  return { passing: failedCases.length === 0, failedCases };
}
