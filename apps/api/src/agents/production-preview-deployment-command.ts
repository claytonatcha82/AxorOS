import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import type { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import type { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';
import type { IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { DeploymentPreviewInput, DeploymentStatusOutput } from '../integrations/deployment-provider-contract.js';
import { assertPersistedProductionFinanceReady } from './trusted-production-finance-gate.js';
import { assertPersistedOperationsReady } from './trusted-production-operations-gate.js';

export interface GovernedPreviewDeploymentRequest {
  commercialRecordReference: string;
  financeClearanceId: string;
  operationsReadinessId: string;
  integrationRequest: IntegrationRequest<DeploymentPreviewInput>;
}

export interface GovernedPreviewDeploymentDependencies {
  integrations: Pick<IntegrationRegistry, 'get' | 'execute'>;
  financeClearanceStore: Pick<FinanceClearancePostgresStore, 'get'>;
  financePaymentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'get'>;
  commercialPaymentRequirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  commercialPaymentSatisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'get'>;
  operationsReadinessStore: Pick<OperationsProductionReadinessPostgresStore, 'get'>;
}

export async function executeGovernedPreviewDeployment(
  input: GovernedPreviewDeploymentRequest,
  dependencies: GovernedPreviewDeploymentDependencies,
): Promise<IntegrationResponse<DeploymentStatusOutput>> {
  const request = input.integrationRequest;
  if (request.integrationId !== 'deployment.cloudflare.preview' || request.operation !== 'create_preview_deployment') {
    throw new Error('Preview deployment requires deployment.cloudflare.preview/create_preview_deployment.');
  }
  const integration = dependencies.integrations.get(request.integrationId);
  if (!integration || integration.kind !== 'deployment') {
    throw new Error(`Deployment integration is not registered: ${request.integrationId}.`);
  }
  if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
    throw new Error('Preview deployment may only be requested by Production or the Human Executive.');
  }
  if (request.mode !== 'live') throw new Error('Preview deployment requires live integration mode.');
  if (request.risk !== 'high' && request.risk !== 'critical') {
    throw new Error('Preview deployment requires high or critical risk classification.');
  }

  const commercialRecordReference = input.commercialRecordReference.trim();
  if (!commercialRecordReference) throw new Error('Preview deployment commercial record is required.');
  if (!request.input.projectName?.trim()) throw new Error('Preview deployment project name is required.');

  await assertPersistedProductionFinanceReady({
    financeClearanceId: input.financeClearanceId,
    commercialRecordReference,
  }, {
    clearanceStore: dependencies.financeClearanceStore,
    paymentStateStore: dependencies.financePaymentStateStore,
    paymentRequirementStore: dependencies.commercialPaymentRequirementStore,
    paymentSatisfactionStore: dependencies.commercialPaymentSatisfactionStore,
  });

  await assertPersistedOperationsReady(
    dependencies.operationsReadinessStore,
    input.operationsReadinessId,
    commercialRecordReference,
  );

  return dependencies.integrations.execute<DeploymentPreviewInput, DeploymentStatusOutput>(request);
}
