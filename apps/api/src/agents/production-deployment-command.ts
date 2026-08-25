import type { IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { assertProductionDeploymentReady, type ProductionDeploymentGateInput } from './production-deployment-gate.js';

const MUTATING_DEPLOYMENT_OPERATIONS = new Set([
  'create_preview_deployment',
  'promote_to_production',
  'rollback_production',
  'configure_domain',
]);

export interface GovernedProductionDeploymentRequest {
  gate: ProductionDeploymentGateInput;
  integrationRequest: IntegrationRequest;
}

export interface GovernedProductionDeploymentDependencies {
  integrations: Pick<IntegrationRegistry, 'get' | 'execute'>;
}

export async function executeGovernedProductionDeployment(
  input: GovernedProductionDeploymentRequest,
  dependencies: GovernedProductionDeploymentDependencies,
): Promise<IntegrationResponse> {
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

  assertProductionDeploymentReady(input.gate);
  return dependencies.integrations.execute(request);
}
