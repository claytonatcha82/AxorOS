import type { IntegrationResponse } from '../integrations/integration-contract.js';
import type { DeploymentStatusOutput } from '../integrations/deployment-provider-contract.js';
import type { CloudflareProductionDeploymentInput } from '../integrations/cloudflare-production-deployment-integration.js';
import { packageProductionPreviewAssets } from './production-preview-asset-packager.js';
import {
  executeGovernedProductionDeployment,
  type GovernedProductionDeploymentDependencies,
} from './production-deployment-command.js';

export interface GovernedProductionBuildDeploymentRequest {
  authorityId: string;
  commercialRecordReference: string;
  projectName: string;
  productionBranch: string;
  buildOutputDirectory: string;
  executionId: string;
  correlationId: string;
  idempotencyKey: string;
  requestedBy: 'production_agent' | 'human_executive';
  commitHash?: string;
  commitMessage?: string;
}

export interface GovernedProductionBuildDeploymentResult {
  deployment: IntegrationResponse<DeploymentStatusOutput>;
  packagedFileCount: number;
  packagedBytes: number;
  buildOutputDirectory: string;
}

export async function executeGovernedProductionBuildDeployment(
  input: GovernedProductionBuildDeploymentRequest,
  dependencies: GovernedProductionDeploymentDependencies,
): Promise<GovernedProductionBuildDeploymentResult> {
  const authorityId = input.authorityId.trim();
  const commercialRecordReference = input.commercialRecordReference.trim();
  const projectName = input.projectName.trim();
  const productionBranch = input.productionBranch.trim();
  const executionId = input.executionId.trim();
  const correlationId = input.correlationId.trim();
  const idempotencyKey = input.idempotencyKey.trim();

  if (!authorityId) throw new Error('Production build deployment authority ID is required.');
  if (!commercialRecordReference) throw new Error('Production build deployment commercial record is required.');
  if (!projectName) throw new Error('Production build deployment project name is required.');
  if (!productionBranch) throw new Error('Production build deployment production branch is required.');
  if (!executionId) throw new Error('Production build deployment execution ID is required.');
  if (!correlationId) throw new Error('Production build deployment correlation ID is required.');
  if (!idempotencyKey) throw new Error('Production build deployment idempotency key is required.');

  const packaged = await packageProductionPreviewAssets(input.buildOutputDirectory);
  const providerInput: CloudflareProductionDeploymentInput = {
    projectName,
    productionBranch,
    assets: packaged.assets,
    buildOutputDirectory: packaged.buildOutputDirectory,
    ...(input.commitHash?.trim() ? { commitHash: input.commitHash.trim() } : {}),
    ...(input.commitMessage?.trim() ? { commitMessage: input.commitMessage.trim() } : {}),
  };

  const deployment = await executeGovernedProductionDeployment<
    CloudflareProductionDeploymentInput,
    DeploymentStatusOutput
  >({
    authorityId,
    commercialRecordReference,
    projectName,
    integrationRequest: {
      integrationId: 'deployment.cloudflare.production',
      operation: 'deploy_production',
      requestedBy: input.requestedBy,
      executionId,
      correlationId,
      mode: 'live',
      risk: 'critical',
      idempotencyKey,
      input: providerInput,
    },
  }, dependencies);

  return {
    deployment,
    packagedFileCount: packaged.assets.length,
    packagedBytes: packaged.totalBytes,
    buildOutputDirectory: packaged.buildOutputDirectory,
  };
}
