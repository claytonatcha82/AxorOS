export type DeploymentEnvironment = 'preview' | 'production';
export type DeploymentProviderStatus = 'queued' | 'building' | 'ready' | 'failed' | 'unknown';

export interface DeploymentProjectReference {
  projectName: string;
}

export interface DeploymentProjectProvisionInput extends DeploymentProjectReference {
  productionBranch: string;
}

export interface DeploymentAsset {
  path: string;
  contentHash: string;
  contentType: string;
  contentBase64: string;
}

export interface DeploymentPreviewInput extends DeploymentProjectReference {
  productionBranch: string;
  previewBranch: string;
  assets: DeploymentAsset[];
  buildOutputDirectory?: string;
  commitHash?: string;
  commitMessage?: string;
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

export function validateDeploymentPreviewInput(input: DeploymentPreviewInput): string[] {
  const errors = validateDeploymentProjectReference(input);
  if (!input.productionBranch?.trim()) errors.push('productionBranch is required.');
  if (!input.previewBranch?.trim()) errors.push('previewBranch is required.');
  if (input.productionBranch?.trim() && input.previewBranch?.trim() && input.productionBranch.trim() === input.previewBranch.trim()) {
    errors.push('previewBranch must differ from productionBranch.');
  }
  if (!Array.isArray(input.assets) || input.assets.length === 0) {
    errors.push('assets must contain at least one file.');
    return errors;
  }
  if (input.assets.length > 20000) errors.push('assets cannot exceed 20000 files.');
  const seenPaths = new Set<string>();
  for (const asset of input.assets) {
    const path = asset.path?.trim();
    if (!path || !path.startsWith('/') || path.includes('..')) errors.push('asset path must be an absolute safe deployment path.');
    if (path && seenPaths.has(path)) errors.push(`duplicate asset path: ${path}.`);
    if (path) seenPaths.add(path);
    if (!/^[a-f0-9]{32}$/i.test(asset.contentHash?.trim() ?? '')) errors.push(`asset ${path || '<unknown>'} has an invalid contentHash.`);
    if (!asset.contentType?.trim()) errors.push(`asset ${path || '<unknown>'} contentType is required.`);
    if (!asset.contentBase64?.trim()) errors.push(`asset ${path || '<unknown>'} contentBase64 is required.`);
  }
  return errors;
}

export function validateDeploymentStatusInput(input: DeploymentStatusInput): string[] {
  const errors = validateDeploymentProjectReference(input);
  if (!input.deploymentId?.trim()) errors.push('deploymentId is required.');
  return errors;
}
