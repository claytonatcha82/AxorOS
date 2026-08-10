export interface ProductionQaState {
  codeQaPassed: boolean;
  functionalQaPassed: boolean;
  visualQaPassed: boolean;
  businessQaPassed: boolean;
}

export interface ProductionDeploymentGateInput extends ProductionQaState {
  clientApproved: boolean;
  requiredFinalPaymentConditionMet: boolean;
  rollbackPrepared: boolean;
  seoChecked: boolean;
  securityChecked: boolean;
  deploymentApproved: boolean;
}

export type ProductionDeploymentRequirement = keyof ProductionDeploymentGateInput;

export interface ProductionDeploymentGateResult {
  status: 'go_live' | 'blocked';
  deploymentUnlocked: boolean;
  failedRequirements: ProductionDeploymentRequirement[];
}

const DEPLOYMENT_REQUIREMENTS: ProductionDeploymentRequirement[] = [
  'codeQaPassed',
  'functionalQaPassed',
  'visualQaPassed',
  'businessQaPassed',
  'clientApproved',
  'requiredFinalPaymentConditionMet',
  'rollbackPrepared',
  'seoChecked',
  'securityChecked',
  'deploymentApproved',
];

export function evaluateProductionDeploymentGate(input: ProductionDeploymentGateInput): ProductionDeploymentGateResult {
  const failedRequirements = DEPLOYMENT_REQUIREMENTS.filter((requirement) => !input[requirement]);
  const deploymentUnlocked = failedRequirements.length === 0;

  return {
    status: deploymentUnlocked ? 'go_live' : 'blocked',
    deploymentUnlocked,
    failedRequirements,
  };
}

export function assertProductionDeploymentReady(input: ProductionDeploymentGateInput): void {
  const result = evaluateProductionDeploymentGate(input);
  if (!result.deploymentUnlocked) {
    throw new Error(`Production deployment blocked: ${result.failedRequirements.join(', ')}`);
  }
}
