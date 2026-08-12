export interface MarketingKpis {
  organicTraffic: number;
  qualifiedInboundLeads: number;
  contentProduction: number;
  keywordGrowth: number;
  domainAuthorityTrend: number;
  emailOpenRate: number;
  clickThroughRate: number;
  portfolioViews: number;
  conversionRate: number;
  costPerInboundLead: number;
  marketingAttributedRevenue: number;
}

export function validateMarketingKpis(kpis: MarketingKpis): string[] {
  const errors: string[] = [];
  const nonNegative: Array<[string, number]> = [['organicTraffic', kpis.organicTraffic], ['qualifiedInboundLeads', kpis.qualifiedInboundLeads], ['contentProduction', kpis.contentProduction], ['portfolioViews', kpis.portfolioViews], ['costPerInboundLead', kpis.costPerInboundLead], ['marketingAttributedRevenue', kpis.marketingAttributedRevenue]];
  for (const [name, value] of nonNegative) if (value < 0) errors.push(`${name} cannot be negative.`);
  for (const [name, value] of [['emailOpenRate', kpis.emailOpenRate], ['clickThroughRate', kpis.clickThroughRate], ['conversionRate', kpis.conversionRate]] as Array<[string, number]>) if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  return errors;
}

export function primaryMarketingOutcome(kpis: MarketingKpis): number {
  return kpis.marketingAttributedRevenue;
}

export function marketingModelTier(task: 'planning' | 'drafting' | 'seo_analysis' | 'image_generation' | 'analytics'): 'strong_reasoning' | 'efficient_language' | 'deterministic_plus_ai' | 'image_only_when_needed' | 'rules_lightweight_ai' {
  if (task === 'planning') return 'strong_reasoning';
  if (task === 'drafting') return 'efficient_language';
  if (task === 'seo_analysis') return 'deterministic_plus_ai';
  if (task === 'image_generation') return 'image_only_when_needed';
  return 'rules_lightweight_ai';
}
