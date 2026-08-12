import type { IntegrationMode, IntegrationRequest, IntegrationRisk } from './integration-contract.js';

export interface IntegrationExecutionPolicy {
  defaultMode: Exclude<IntegrationMode, 'live'>;
  allowLive: boolean;
  liveRiskCeiling: IntegrationRisk;
}

const riskRank: Record<IntegrationRisk, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const SAFE_INTEGRATION_POLICY: IntegrationExecutionPolicy = {
  defaultMode: 'sandbox',
  allowLive: false,
  liveRiskCeiling: 'low',
};

export function enforceIntegrationPolicy(
  request: IntegrationRequest,
  policy: IntegrationExecutionPolicy = SAFE_INTEGRATION_POLICY,
): void {
  if (request.mode !== 'live') return;
  if (!policy.allowLive) throw new Error('live integration execution is disabled by policy.');
  if (riskRank[request.risk] > riskRank[policy.liveRiskCeiling]) {
    throw new Error(`live integration risk ${request.risk} exceeds policy ceiling ${policy.liveRiskCeiling}.`);
  }
}
