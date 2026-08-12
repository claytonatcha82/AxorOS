export type LeadStatus = 'discovered' | 'researching' | 'qualified' | 'prioritised' | 'assigned' | 'sales';

export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  discovered: ['researching'],
  researching: ['qualified'],
  qualified: ['prioritised'],
  prioritised: ['assigned'],
  assigned: ['sales'],
  sales: [],
};

export interface LeadCompanyProfile {
  leadId: string;
  companyName: string;
  industry: string;
  country: string;
  city?: string;
  employees?: number;
  website?: string;
  email?: string;
  phone?: string;
  socials: string[];
  currentWebsiteStatus: 'none' | 'poor' | 'adequate' | 'strong' | 'unknown';
  technology: string[];
  websiteQuality?: number;
  seoScore?: number;
  mobileScore?: number;
  performanceScore?: number;
  estimatedOpportunity: string;
  painPoints: string[];
  recommendedServices: string[];
  leadScore: number;
  priority: 'immediate' | 'very_high' | 'high' | 'medium' | 'low';
  confidence: number;
  sourceUrls: string[];
}

export function canTransitionLeadStatus(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}

export function validateLeadCompanyProfile(profile: LeadCompanyProfile): string[] {
  const errors: string[] = [];
  if (!profile.leadId.trim()) errors.push('leadId is required.');
  if (!profile.companyName.trim()) errors.push('companyName is required.');
  if (!profile.industry.trim()) errors.push('industry is required.');
  if (!profile.country.trim()) errors.push('country is required.');
  if (profile.leadScore < 0 || profile.leadScore > 100) errors.push('leadScore must be between 0 and 100.');
  if (profile.confidence < 0 || profile.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (profile.sourceUrls.length === 0) errors.push('at least one public source URL is required for traceability.');
  return errors;
}

export function leadPriorityForScore(score: number): LeadCompanyProfile['priority'] {
  if (score < 0 || score > 100) throw new Error('lead score must be between 0 and 100.');
  if (score >= 95) return 'immediate';
  if (score >= 90) return 'very_high';
  if (score >= 80) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}
