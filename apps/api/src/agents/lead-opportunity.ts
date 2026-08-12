export interface LeadScoringFactors {
  websiteQualityOpportunity: number;
  businessMaturity: number;
  industryFit: number;
  growthIndicators: number;
  budgetLikelihood: number;
  seoOpportunity: number;
  aiAutomationOpportunity: number;
}

const WEIGHTS = {
  websiteQualityOpportunity: 20,
  businessMaturity: 15,
  industryFit: 15,
  growthIndicators: 15,
  budgetLikelihood: 15,
  seoOpportunity: 10,
  aiAutomationOpportunity: 10,
} as const;

export function scoreLeadOpportunity(factors: LeadScoringFactors): number {
  const entries = Object.entries(factors) as Array<[keyof LeadScoringFactors, number]>;
  for (const [name, value] of entries) {
    if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
  }
  return Math.round(entries.reduce((total, [name, value]) => total + value * WEIGHTS[name], 0));
}

export interface WebsiteOpportunityAssessment {
  hasWebsite: boolean;
  designQuality: 'poor' | 'adequate' | 'strong' | 'unknown';
  mobileFriendly: boolean | 'unknown';
  https: boolean | 'unknown';
  performance: 'poor' | 'adequate' | 'strong' | 'unknown';
  seoQuality: 'poor' | 'adequate' | 'strong' | 'unknown';
  accessibilityQuality: 'poor' | 'adequate' | 'strong' | 'unknown';
  conversionQuality: 'poor' | 'adequate' | 'strong' | 'unknown';
}

export function recommendLeadServices(assessment: WebsiteOpportunityAssessment): string[] {
  if (!assessment.hasWebsite) return ['website_design_and_development'];
  const services: string[] = [];
  const rebuildSignals = [assessment.designQuality === 'poor', assessment.mobileFriendly === false, assessment.performance === 'poor', assessment.conversionQuality === 'poor'];
  if (rebuildSignals.filter(Boolean).length >= 2) services.push('website_redesign');
  if (assessment.seoQuality === 'poor') services.push('seo_optimisation');
  if (assessment.accessibilityQuality === 'poor') services.push('accessibility_improvement');
  if (assessment.https === false) services.push('website_security_remediation');
  return services;
}
