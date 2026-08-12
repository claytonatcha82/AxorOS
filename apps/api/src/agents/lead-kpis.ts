export interface LeadAgentKpis {
  qualifiedLeadsGenerated: number;
  qualificationAccuracy: number;
  duplicateRate: number;
  averageLeadScore: number;
  salesConversionRate: number;
  revenueFromSourcedLeads: number;
  averageQualificationTimeMs: number;
  researchCostPerLead: number;
}

export function validateLeadAgentKpis(kpis: LeadAgentKpis): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(kpis.qualifiedLeadsGenerated) || kpis.qualifiedLeadsGenerated < 0) errors.push('qualifiedLeadsGenerated must be a non-negative integer.');
  for (const [name, value] of [
    ['qualificationAccuracy', kpis.qualificationAccuracy], ['duplicateRate', kpis.duplicateRate], ['salesConversionRate', kpis.salesConversionRate],
  ] as Array<[string, number]>) if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  if (kpis.averageLeadScore < 0 || kpis.averageLeadScore > 100) errors.push('averageLeadScore must be between 0 and 100.');
  if (kpis.revenueFromSourcedLeads < 0) errors.push('revenueFromSourcedLeads cannot be negative.');
  if (kpis.averageQualificationTimeMs < 0) errors.push('averageQualificationTimeMs cannot be negative.');
  if (kpis.researchCostPerLead < 0) errors.push('researchCostPerLead cannot be negative.');
  return errors;
}

export function leadRevenueEfficiency(kpis: LeadAgentKpis): number {
  if (kpis.qualifiedLeadsGenerated === 0) return 0;
  return kpis.revenueFromSourcedLeads / kpis.qualifiedLeadsGenerated;
}
