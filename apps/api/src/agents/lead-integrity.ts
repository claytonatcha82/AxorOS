export interface LeadIdentity {
  leadId?: string;
  companyName: string;
  websiteDomain?: string;
  emailDomain?: string;
  country: string;
}

function normalise(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

export function isDuplicateLead(candidate: LeadIdentity, existing: LeadIdentity[]): boolean {
  const website = normalise(candidate.websiteDomain);
  const email = normalise(candidate.emailDomain);
  const name = normalise(candidate.companyName);
  const country = normalise(candidate.country);
  return existing.some((lead) => {
    if (candidate.leadId && lead.leadId === candidate.leadId) return true;
    if (website && normalise(lead.websiteDomain) === website) return true;
    if (email && normalise(lead.emailDomain) === email) return true;
    return normalise(lead.companyName) === name && normalise(lead.country) === country;
  });
}

export interface LeadFreshnessEvidence {
  checkedAt: string;
  activeWebsite?: boolean;
  activeBusinessListing?: boolean;
  recentPublicActivity?: boolean;
  closureEvidence?: boolean;
}

export function leadFreshnessStatus(evidence: LeadFreshnessEvidence): 'active' | 'stale_risk' | 'closed' | 'unknown' {
  if (evidence.closureEvidence) return 'closed';
  if (evidence.activeWebsite || evidence.activeBusinessListing || evidence.recentPublicActivity) return 'active';
  if (!evidence.checkedAt.trim()) return 'unknown';
  return 'stale_risk';
}

export interface ResearchedLeadField<T> {
  value?: T;
  sourceUrl?: string;
}

export function researchedFieldIsSupported<T>(field: ResearchedLeadField<T>): boolean {
  return field.value === undefined || Boolean(field.sourceUrl?.trim());
}
