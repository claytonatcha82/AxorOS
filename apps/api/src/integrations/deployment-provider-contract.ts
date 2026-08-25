export type DeploymentEnvironment = 'preview' | 'production';
export type DeploymentProviderStatus = 'queued' | 'building' | 'ready' | 'failed' | 'unknown';

export interface DeploymentProjectReference {
  projectName: string;
}

export interface DeploymentProjectProvisionInput extends DeploymentProjectReference {
  productionBranch: string;
}

export interface DeploymentStatusInput extends DeploymentProjectReference {
  deploymentId: string;
}

export interface DeploymentStatusOutput {
  projectName: string;
  deploymentId: string;
  environment: DeploymentEnvironment;
  status: DeploymentProviderStatus;
  url?: string;
  createdAt?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
}

export interface DeploymentProjectOutput {
  projectName: string;
  productionBranch?: string;
  productionUrl?: string;
  providerErrorCode?: string;
  providerErrorMessage?: string;
}

export function validateDeploymentProjectReference(input: DeploymentProjectReference): string[] {
  const errors: string[] = [];
  if (!input.projectName?.trim()) errors.push('projectName is required.');
  return errors;
}

export function validateDeploymentProjectProvisionInput(input: DeploymentProjectProvisionInput): string[] {
  const errors = validateDeploymentProjectReference(input);
  if (!input.productionBranch?.trim()) errors.push('productionBranch is required.');
  return errors;
}

export function validateDeploymentStatusInput(input: DeploymentStatusInput): string[] {
  const errors = validateDeploymentProjectReference(input);
  if (!input.deploymentId?.trim()) errors.push('deploymentId is required.');
  return errors;
}
