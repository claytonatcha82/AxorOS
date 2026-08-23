import type { Pool } from 'pg';
import { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import { PaymentWebhookPostgresStore } from '../data/payment-webhook-postgres-store.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createFinanceCommercialPaymentBindingWorkflow } from './finance-commercial-payment-binding-workflow.js';
import { createFinanceGovernedOperationalCoordinator } from './finance-governed-operational-coordinator.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';
import { createFinancePaymentEventWorkflow } from './finance-payment-event-workflow.js';

export interface FinancePaymentRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
  paymentIntegrationId?: string;
  mode?: IntegrationMode;
}

export function createFinancePaymentRuntime(dependencies: FinancePaymentRuntimeDependencies) {
  const clearanceStore = new FinanceClearancePostgresStore(dependencies.pool);
  const webhookStore = new PaymentWebhookPostgresStore(dependencies.pool);
  const currentStateStore = new FinancePaymentCurrentStatePostgresStore(dependencies.pool);
  const requirementStore = new CommercialPaymentRequirementPostgresStore(dependencies.pool);
  const satisfactionStore = new CommercialPaymentSatisfactionPostgresStore(dependencies.pool);
  const workflow = createFinancePaymentClearanceWorkflow({
    integrations: dependencies.integrations,
    clearanceStore,
    paymentWebhookEvidenceStore: webhookStore,
  });
  const eventWorkflow = createFinancePaymentEventWorkflow({
    webhookStore,
    currentStateStore,
    clearanceWorkflow: workflow,
    paymentIntegrationId: dependencies.paymentIntegrationId ?? 'payment.sandbox',
    mode: dependencies.mode ?? 'sandbox',
  });
  const commercialPaymentBindingWorkflow = createFinanceCommercialPaymentBindingWorkflow({
    requirementStore,
    satisfactionStore,
    paymentWebhookEvidenceStore: webhookStore,
    clearanceWorkflow: workflow,
  });
  const operationalCoordinator = createFinanceGovernedOperationalCoordinator({
    requirementStore,
    satisfactionStore,
    currentStateStore,
  });

  return {
    clearanceStore,
    webhookStore,
    currentStateStore,
    requirementStore,
    satisfactionStore,
    workflow,
    eventWorkflow,
    commercialPaymentBindingWorkflow,
    operationalCoordinator,
  };
}
