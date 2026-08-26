import type { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import type { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import type { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import type { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import type { OperationsProductionReadinessPostgresStore } from '../data/operations-production-readiness-postgres-store.js';
import type { IntegrationRequest, IntegrationResponse } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import type { DeploymentProjectOutput, DeploymentProjectProvisionInput } from '../integrations/deployment-provider-contract.js';
import { assertPersistedProductionFinanceReady } from './trusted-production-finance-gate.js';
import { assertPersistedOperationsReady } from './trusted-production-operations-gate.js';

export interface GovernedPreviewProjectProvisionRequest {
  commercialRecordReference: string;
  financeClearanceId: string;
  operationsReadinessId: string;
  integrationRequest: IntegrationRequest<DeploymentProjectProvisionInput>;
}

export interface GovernedPreviewProjectProvisionDependencies {
  integrations: Pick<IntegrationRegistry, 'get' | 'execute'>;
  financeClearanceStore: Pick<FinanceClearancePostgresStore, 'get'>;
  financePaymentStateStore: Pick<FinancePaymentCurrentStatePostgresStore, 'get'>;
  commercialPaymentRequirementStore: Pick<CommercialPaymentRequirementPostgresStore, 'get'>;
  commercialPaymentSatisfactionStore: Pick<CommercialPaymentSatisfactionPostgresStore, 'get'>;
  operationsReadinessStore: Pick<OperationsProductionReadinessPostgresStore, 'get'>;
}

export async function executeGovernedPreviewProjectProvision(
  input: GovernedPreviewProjectProvisionRequest,
  dependencies: GovernedPreviewProjectProvisionDependencies,
): Promise<IntegrationResponse<DeploymentProjectOutput>> {
  const request = input.integrationRequest;
  if (request.integrationId !== 'deployment.cloudflare.project' || request.operation !== 'create_project') {
    throw new Error('Preview project provisioning requires deployment.cloudflare.project/create_project.');
  }
  const integration = dependencies.integrations.get(request.integrationId);
  if (!integration || integration.kind !== 'deployment') {
    throw new Error(`Deployment integration is not registered: ${request.integrationId}.`);
  }
  if (request.requestedBy !== 'production_agent' && request.requestedBy !== 'human_executive') {
    throw new Error('Preview project provisioning may only be requested by Production or the Human Executive.');
  }
  if (request.mode !== 'live') throw new Error('Preview project provisioning requires live integration mode.');
  if (request.risk !== 'high' && request.risk !== 'critical') {
    throw new Error('Preview project provisioning requires high or critical risk classification.');
  }

  const commercialRecordReference = input.commercialRecordReference.trim();
  if (!commercialRecordReference) throw new Error('Preview project provisioning commercial record is required.');
  if (!request.input.projectName?.trim()) throw new Error('Preview project provisioning project name is required.');
  if (!request.input.productionBranch?.trim()) throw new Error('Preview project provisioning production branch is required.');

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

  return dependencies.integrations.execute<DeploymentProjectProvisionInput, DeploymentProjectOutput>(request);
}
