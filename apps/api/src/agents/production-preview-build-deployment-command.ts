import type { IntegrationResponse } from '../integrations/integration-contract.js';
import type { DeploymentStatusOutput } from '../integrations/deployment-provider-contract.js';
import { packageProductionPreviewAssets } from './production-preview-asset-packager.js';
import {
  executeGovernedPreviewDeployment,
  type GovernedPreviewDeploymentDependencies,
} from './production-preview-deployment-command.js';

export interface GovernedPreviewBuildDeploymentRequest {
  commercialRecordReference: string;
  financeClearanceId: string;
  operationsReadinessId: string;
  projectName: string;
  productionBranch: string;
  previewBranch: string;
  buildOutputDirectory: string;
  executionId: string;
  correlationId: string;
  idempotencyKey: string;
  requestedBy: 'production_agent' | 'human_executive';
  commitHash?: string;
  commitMessage?: string;
}

export interface GovernedPreviewBuildDeploymentResult {
  deployment: IntegrationResponse<DeploymentStatusOutput>;
  packagedFileCount: number;
  packagedBytes: number;
  buildOutputDirectory: string;
}

export async function executeGovernedPreviewBuildDeployment(
  input: GovernedPreviewBuildDeploymentRequest,
  dependencies: GovernedPreviewDeploymentDependencies,
): Promise<GovernedPreviewBuildDeploymentResult> {
  const projectName = input.projectName.trim();
  const productionBranch = input.productionBranch.trim();
  const previewBranch = input.previewBranch.trim();
  const executionId = input.executionId.trim();
  const correlationId = input.correlationId.trim();
  const idempotencyKey = input.idempotencyKey.trim();

  if (!projectName) throw new Error('Preview build deployment project name is required.');
  if (!productionBranch) throw new Error('Preview build deployment production branch is required.');
  if (!previewBranch) throw new Error('Preview build deployment preview branch is required.');
  if (productionBranch === previewBranch) throw new Error('Preview branch must differ from production branch.');
  if (!executionId) throw new Error('Preview build deployment execution ID is required.');
  if (!correlationId) throw new Error('Preview build deployment correlation ID is required.');
  if (!idempotencyKey) throw new Error('Preview build deployment idempotency key is required.');

  const packaged = await packageProductionPreviewAssets(input.buildOutputDirectory);

  const deployment = await executeGovernedPreviewDeployment({
    commercialRecordReference: input.commercialRecordReference,
    financeClearanceId: input.financeClearanceId,
    operationsReadinessId: input.operationsReadinessId,
    integrationRequest: {
      integrationId: 'deployment.cloudflare.preview',
      operation: 'create_preview_deployment',
      requestedBy: input.requestedBy,
      executionId,
      correlationId,
      mode: 'live',
      risk: 'high',
      idempotencyKey,
      input: {
        projectName,
        productionBranch,
        previewBranch,
        assets: packaged.assets,
        buildOutputDirectory: packaged.buildOutputDirectory,
        ...(input.commitHash?.trim() ? { commitHash: input.commitHash.trim() } : {}),
        ...(input.commitMessage?.trim() ? { commitMessage: input.commitMessage.trim() } : {}),
      },
    },
  }, dependencies);

  return {
    deployment,
    packagedFileCount: packaged.assets.length,
    packagedBytes: packaged.totalBytes,
    buildOutputDirectory: packaged.buildOutputDirectory,
  };
}
