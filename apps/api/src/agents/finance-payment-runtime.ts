import type { Pool } from 'pg';
import { CommercialPaymentRequirementPostgresStore } from '../data/commercial-payment-requirement-postgres-store.js';
import { CommercialPaymentSatisfactionPostgresStore } from '../data/commercial-payment-satisfaction-postgres-store.js';
import { FinanceClearancePostgresStore } from '../data/finance-clearance-postgres-store.js';
import { FinanceLedgerPostgresStore } from '../data/finance-ledger-postgres-store.js';
import { FinancePaymentCurrentStatePostgresStore } from '../data/finance-payment-current-state-postgres-store.js';
import { FinancePaymentRequestPostgresStore } from '../data/finance-payment-request-postgres-store.js';
import { createOperationalRepository } from '../data/operational-repository.js';
import { PaymentWebhookPostgresStore } from '../data/payment-webhook-postgres-store.js';
import type { IntegrationMode } from '../integrations/integration-contract.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createFinanceCommercialPaymentBindingWorkflow } from './finance-commercial-payment-binding-workflow.js';
import { createFinanceGovernedAdvisoryService } from './finance-governed-advisory-service.js';
import { createFinanceGovernedBindingService } from './finance-governed-binding-service.js';
import { createFinanceGovernedOperationalCoordinator } from './finance-governed-operational-coordinator.js';
import { createFinanceGovernedOperationalRuntime } from './finance-governed-operational-runtime.js';
import { createFinanceGovernedPaymentRequestService } from './finance-governed-payment-request-service.js';
import { createFinanceLedgerRecorder } from './finance-ledger-recorder.js';
import { createFinancePaymentClearanceWorkflow } from './finance-payment-clearance-workflow.js';
import { createFinancePaymentEventWorkflow } from './finance-payment-event-workflow.js';
import { createFinancePaymentRequestLedgerWorkflow } from './finance-payment-request-ledger-workflow.js';

export interface FinancePaymentRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
  paymentIntegrationId?: string;
  mode?: IntegrationMode;
}

export function createFinancePaymentRuntime(dependencies: FinancePaymentRuntimeDependencies) {
  const paymentIntegrationId = dependencies.paymentIntegrationId ?? 'payment.sandbox';
  const mode = dependencies.mode ?? 'sandbox';
  const clearanceStore = new FinanceClearancePostgresStore(dependencies.pool);
  const ledgerStore = new FinanceLedgerPostgresStore(dependencies.pool);
  const ledgerRecorder = createFinanceLedgerRecorder(ledgerStore);
  const webhookStore = new PaymentWebhookPostgresStore(dependencies.pool);
  const currentStateStore = new FinancePaymentCurrentStatePostgresStore(dependencies.pool);
  const requirementStore = new CommercialPaymentRequirementPostgresStore(dependencies.pool);
  const satisfactionStore = new CommercialPaymentSatisfactionPostgresStore(dependencies.pool);
  const paymentRequestStore = new FinancePaymentRequestPostgresStore(dependencies.pool);
  const operationalRepository = createOperationalRepository(dependencies.pool);
  const workflow = createFinancePaymentClearanceWorkflow({
    integrations: dependencies.integrations,
    clearanceStore,
    paymentWebhookEvidenceStore: webhookStore,
  });
  const eventWorkflow = createFinancePaymentEventWorkflow({
    webhookStore,
    currentStateStore,
    clearanceWorkflow: workflow,
    paymentIntegrationId,
    mode,
  });
  const commercialPaymentBindingWorkflow = createFinanceCommercialPaymentBindingWorkflow({
    requirementStore,
    satisfactionStore,
    paymentWebhookEvidenceStore: webhookStore,
    clearanceWorkflow: workflow,
  });
  const governedOperationalCoordinator = createFinanceGovernedOperationalCoordinator({
    requirementStore,
    satisfactionStore,
    currentStateStore,
  });
  const governedOperationalRuntime = createFinanceGovernedOperationalRuntime({
    coordinator: governedOperationalCoordinator,
    eventStore: operationalRepository,
  });
  const governedAdvisoryService = createFinanceGovernedAdvisoryService({
    integrations: dependencies.integrations,
  });
  const governedBindingService = createFinanceGovernedBindingService({
    coordinator: governedOperationalCoordinator,
    bindingWorkflow: commercialPaymentBindingWorkflow,
    paymentIntegrationId,
    mode,
  });
  const governedPaymentRequestService = createFinanceGovernedPaymentRequestService({
    requirementStore,
    paymentRequestStore,
    integrations: dependencies.integrations,
    integrationId: 'payment.paystack.request',
    mode: mode === 'live' ? 'live' : 'sandbox',
  });
  const governedPaymentRequestLedgerWorkflow = createFinancePaymentRequestLedgerWorkflow({
    paymentRequestService: governedPaymentRequestService,
    paymentRequestStore,
    ledgerRecorder,
  });

  return {
    clearanceStore,
    ledgerStore,
    ledgerRecorder,
    webhookStore,
    currentStateStore,
    requirementStore,
    satisfactionStore,
    paymentRequestStore,
    workflow,
    eventWorkflow,
    commercialPaymentBindingWorkflow,
    governedOperationalCoordinator,
    governedOperationalRuntime,
    governedAdvisoryService,
    governedBindingService,
    governedPaymentRequestService: governedPaymentRequestLedgerWorkflow,
    governedPaymentRequestLedgerWorkflow,
  };
}
