import type { ProductionDeploymentAuthorityRecord } from '../data/production-deployment-authority-postgres-store.js';
import type { IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { assertProductionDeploymentReady } from './production-deployment-gate.js';

const MUTATING_DEPLOYMENT_OPERATIONS = new Set([
  'create_preview_deployment',
  'promote_to_production',
  'deploy_production',
  'rollback_production',
  'configure_domain',
]);

export interface GovernedProductionDeploymentRequest<TInput = Record<string, unknown>> {
  authorityId: string;
  commercialRecordReference: string;
  projectName: string;
  integrationRequest: IntegrationRequest<TInput>;
}

export interface GovernedProductionDeploymentDependencies {
  integrations: Pick<IntegrationRegistry, 'get' | 'execute'>;
  deploymentAuthorityStore: {
    get(authorityId: string): Promise<ProductionDeploymentAuthorityRecord | null>;
  };
}

export async function executeGovernedProductionDeployment<
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
>(
  input: GovernedProductionDeploymentRequest<TInput>,
  dependencies: GovernedProductionDeploymentDependencies,
): Promise<IntegrationResponse<TOutput>> {
  const request = input.integrationRequest;
  const integration = dependencies.integrations.get(request.integrationId);

  if (!integration || integration.kind !== 'deployment') {
    throw new Error(`Deployment integration is not registered: ${request.integrationId}.`);
  }
  if (!MUTATING_DEPLOYMENT_OPERATIONS.has(request.operation)) {
    throw new Error(`Production deployment command does not permit operation ${request.operation}.`);
  }
  if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
    throw new Error('Production deployment command may only be requested by Production or the Human Executive.');
  }
  if (request.mode !== 'live') {
    throw new Error('Production deployment mutations require live integration mode.');
  }
  if (request.risk !== 'high' && request.risk !== 'critical') {
    throw new Error('Production deployment mutations require high or critical risk classification.');
  }
  if (!input.authorityId.trim()) throw new Error('Persisted deployment authority reference is required.');
  if (!input.commercialRecordReference.trim()) throw new Error('Deployment commercial record is required.');
  if (!input.projectName.trim()) throw new Error('Deployment project name is required.');

  const authority = await dependencies.deploymentAuthorityStore.get(input.authorityId.trim());
  if (!authority) throw new Error('Persisted Production deployment authority was not found.');
  if (authority.commercialRecordReference !== input.commercialRecordReference.trim()) {
    throw new Error('Persisted Production deployment authority commercial record does not match deployment request.');
  }
  if (authority.projectName !== input.projectName.trim()) {
    throw new Error('Persisted Production deployment authority project does not match deployment request.');
  }
  if (!authority.evidenceReferences.length) {
    throw new Error('Persisted Production deployment authority has no supporting evidence.');
  }

  assertProductionDeploymentReady(authority);
  return dependencies.integrations.execute<TInput, TOutput>(request);
}
