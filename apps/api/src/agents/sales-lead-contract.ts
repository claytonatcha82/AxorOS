export interface QualifiedSalesLeadPackage {
  leadId: string;
  company: string;
  decisionMaker: string;
  industry: string;
  country: string;
  businessSummary: string;
  websiteAudit: string;
  painPoints: string[];
  recommendedServices: string[];
  leadScore: number;
  priority: 'low' | 'medium' | 'high';
  confidence: number;
  previousContact: string;
  knowledgeReferences: string[];
}

export interface QualifiedSalesLeadValidation {
  valid: boolean;
  missingFields: Array<keyof QualifiedSalesLeadPackage>;
  errors: string[];
}

const REQUIRED_TEXT_FIELDS: Array<keyof QualifiedSalesLeadPackage> = [
  'leadId', 'company', 'industry', 'country', 'businessSummary', 'websiteAudit', 'previousContact',
];

const REQUIRED_LIST_FIELDS: Array<keyof QualifiedSalesLeadPackage> = ['painPoints', 'recommendedServices', 'knowledgeReferences'];

export function validateQualifiedSalesLeadPackage(input: QualifiedSalesLeadPackage): QualifiedSalesLeadValidation {
  const missingFields: Array<keyof QualifiedSalesLeadPackage> = [];
  const errors: string[] = [];

  for (const field of REQUIRED_TEXT_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value.trim().length === 0) missingFields.push(field);
  }

  for (const field of REQUIRED_LIST_FIELDS) {
    const value = input[field];
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
      missingFields.push(field);
    }
  }

  if (!Number.isFinite(input.leadScore) || input.leadScore < 0 || input.leadScore > 100) errors.push('leadScore must be between 0 and 100.');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) errors.push('confidence must be between 0 and 1.');
  if (!['low', 'medium', 'high'].includes(input.priority)) errors.push('priority must be low, medium, or high.');

  return { valid: missingFields.length === 0 && errors.length === 0, missingFields, errors };
}

export function assertQualifiedSalesLeadReady(input: QualifiedSalesLeadPackage): void {
  const validation = validateQualifiedSalesLeadPackage(input);
  if (!validation.valid) {
    const details = [...validation.missingFields.map((field) => `missing:${field}`), ...validation.errors].join(', ');
    throw new Error(`Qualified sales lead package is not ready: ${details}`);
  }
}
