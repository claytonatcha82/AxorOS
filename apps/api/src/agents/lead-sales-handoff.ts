export interface QualifiedLeadSalesHandoff {
  leadId: string;
  company: string;
  industry: string;
  location: string;
  website?: string;
  auditSummary: string;
  businessSummary: string;
  recommendedServices: string[];
  estimatedBudget?: string;
  painPoints: string[];
  leadScore: number;
  confidence: number;
  knowledgeReferences: string[];
  recommendedSalesStrategy: string;
}

export function validateQualifiedLeadSalesHandoff(handoff: QualifiedLeadSalesHandoff): string[] {
  const errors: string[] = [];
  if (!handoff.leadId.trim()) errors.push('leadId is required.');
  if (!handoff.company.trim()) errors.push('company is required.');
  if (!handoff.industry.trim()) errors.push('industry is required.');
  if (!handoff.location.trim()) errors.push('location is required.');
  if (!handoff.auditSummary.trim()) errors.push('auditSummary is required.');
  if (!handoff.businessSummary.trim()) errors.push('businessSummary is required.');
  if (handoff.recommendedServices.length === 0) errors.push('at least one recommended service is required.');
  if (handoff.painPoints.length === 0) errors.push('at least one pain point is required.');
  if (handoff.leadScore < 0 || handoff.leadScore > 100) errors.push('leadScore must be between 0 and 100.');
  if (handoff.confidence < 0 || handoff.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (handoff.knowledgeReferences.length === 0) errors.push('knowledgeReferences are required.');
  if (!handoff.recommendedSalesStrategy.trim()) errors.push('recommendedSalesStrategy is required.');
  return errors;
}
