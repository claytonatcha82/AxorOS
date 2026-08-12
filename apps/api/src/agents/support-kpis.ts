export interface SupportKpis {
  firstResponseTimeMs: number;
  resolutionTimeMs: number;
  firstContactResolutionRate: number;
  reopenRate: number;
  escalationRate: number;
  slaComplianceRate: number;
  clientSatisfactionRate: number;
  websiteUptimeRate: number;
  recurringIncidentRate: number;
  humanInterventionRate: number;
  costPerResolvedTicket: number;
  retentionRate: number;
  expansionRevenue: number;
}

export function validateSupportKpis(kpis: SupportKpis): string[] {
  const errors: string[] = [];
  const rates: Array<[string, number]> = [
    ['firstContactResolutionRate', kpis.firstContactResolutionRate], ['reopenRate', kpis.reopenRate], ['escalationRate', kpis.escalationRate],
    ['slaComplianceRate', kpis.slaComplianceRate], ['clientSatisfactionRate', kpis.clientSatisfactionRate], ['websiteUptimeRate', kpis.websiteUptimeRate],
    ['recurringIncidentRate', kpis.recurringIncidentRate], ['humanInterventionRate', kpis.humanInterventionRate], ['retentionRate', kpis.retentionRate],
  ];
  for (const [name, value] of rates) if (value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  if (kpis.firstResponseTimeMs < 0 || kpis.resolutionTimeMs < 0 || kpis.costPerResolvedTicket < 0 || kpis.expansionRevenue < 0) errors.push('support time and cost metrics cannot be negative.');
  return errors;
}

export function supportModelTier(input: { deterministicCheckAvailable: boolean; unusualCase: boolean; securitySensitive: boolean }): 'deterministic' | 'lightweight_ai' | 'strong_reasoning' {
  if (input.securitySensitive || input.unusualCase) return 'strong_reasoning';
  if (input.deterministicCheckAvailable) return 'deterministic';
  return 'lightweight_ai';
}
