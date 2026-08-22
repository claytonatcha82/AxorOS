import type { IntegrationMode, IntegrationRequest, IntegrationRisk } from './integration-contract.js';

export interface ScopedLiveIntegrationRule {
  integrationId: string;
  operation: string;
  riskCeiling: IntegrationRisk;
}

export interface IntegrationExecutionPolicy {
  defaultMode: Exclude<IntegrationMode, 'live'>;
  allowLive: boolean;
  liveRiskCeiling: IntegrationRisk;
  scopedLiveRules?: readonly ScopedLiveIntegrationRule[];
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

function findScopedLiveRule(
  request: IntegrationRequest,
  policy: IntegrationExecutionPolicy,
): ScopedLiveIntegrationRule | undefined {
  return policy.scopedLiveRules?.find((rule) => (
    rule.integrationId === request.integrationId && rule.operation === request.operation
  ));
}

export function enforceIntegrationPolicy(
  request: IntegrationRequest,
  policy: IntegrationExecutionPolicy = SAFE_INTEGRATION_POLICY,
): void {
  if (request.mode !== 'live') return;

  const scopedRule = findScopedLiveRule(request, policy);
  if (!policy.allowLive && !scopedRule) {
    throw new Error('live integration execution is disabled by policy.');
  }

  const riskCeiling = scopedRule?.riskCeiling ?? policy.liveRiskCeiling;
  if (riskRank[request.risk] > riskRank[riskCeiling]) {
    throw new Error(`live integration risk ${request.risk} exceeds policy ceiling ${riskCeiling}.`);
  }
}
