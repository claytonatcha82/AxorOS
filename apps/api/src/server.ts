import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { createRuntimeRecoveryRunner } from './agents/agent-runtime-recovery-runner.js';
import { createFinancePaymentRuntime } from './agents/finance-payment-runtime.js';
import { createPaystackPaymentWebhookIngress } from './agents/paystack-payment-webhook-ingress.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './agents/production-model-capabilities.js';
import { createPersistedProductionRuntime } from './agents/production-persisted-runtime.js';
import { createBetterStackLogSink } from './better-stack.js';
import { loadConfig } from './config.js';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';
import { SalesEmailSendAttemptPostgresStore } from './data/sales-email-send-attempt-postgres-store.js';
import { createOperationalRepository } from './data/operational-repository.js';
import { checkDatabase, createDatabasePool } from './database.js';
import { createConfiguredIntegrationRegistry } from './integrations/integration-bootstrap.js';
import { createKnowledgeContextService } from './knowledge/knowledge-context-service.js';
import { createKnowledgeRepository } from './knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from './knowledge/knowledge-retrieval-service.js';
import { logEvent, setExternalLogSink } from './logger.js';
import { createPaystackWebhookRequestHandler } from './paystack-webhook-request-handler.js';
import { createSalesIntakeControlPlaneRequestHandler } from './sales-intake-control-plane-request-handler.js';
import { createPersistedLeadQualificationRuntimeReview } from './services/lead-qualification-persisted-runtime-review.js';
import { createPersistedLeadSalesIntakeRuntime } from './services/lead-sales-persisted-intake-runtime.js';
import { createSalesIntegrationEmailTransport } from './services/sales-integration-email-transport.js';
import { createSalesSupervisedEmailExecutionService } from './services/sales-supervised-email-execution-service.js';

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error('AXOROS_DATABASE_URL is required to start the AxorOS API.');
}

if (config.betterStackIngestingHost && config.betterStackSourceToken) {
  setExternalLogSink(createBetterStackLogSink(config.betterStackIngestingHost, config.betterStackSourceToken));
}

const databasePool = createDatabasePool(config.databaseUrl);
const { registry: integrationRegistry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(config);
const operationalRepository = createOperationalRepository(databasePool);
const salesEmailTransport = createSalesIntegrationEmailTransport(integrationRegistry);
const salesEmailSendAttempts = new SalesEmailSendAttemptPostgresStore(databasePool);
const salesSupervisedEmailExecution = createSalesSupervisedEmailExecutionService(
  operationalRepository,
  salesEmailTransport,
  salesEmailSendAttempts,
);
const financePaymentRuntime = createFinancePaymentRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
  ...(config.paymentIntegrationId ? { paymentIntegrationId: config.paymentIntegrationId } : {}),
  ...(config.paymentIntegrationMode ? { mode: config.paymentIntegrationMode } : {}),
});
const productionRuntime = createPersistedProductionRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
});
const leadQualificationReviewRuntime = createPersistedLeadQualificationRuntimeReview(databasePool);
const salesIntakeRuntime = createPersistedLeadSalesIntakeRuntime(databasePool);
const runtimeStore = productionRuntime.store;
const runtimeRecoveryRunner = createRuntimeRecoveryRunner(runtimeStore, {
  onCycleCompleted(decisions) {
    if (decisions.length > 0) {
      logEvent('warn', 'runtime_stale_recovery_completed', {
        decisions: decisions.map((decision) => ({ executionId: decision.executionId, action: decision.action })),
      });
    }
  },
  onCycleFailed(error) {
    logEvent('error', 'runtime_stale_recovery_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  },
});
const knowledgeRepository = createKnowledgeRepository(databasePool);
const knowledgeRetrievalService = createKnowledgeRetrievalService(knowledgeRepository);
const knowledgeContextService = createKnowledgeContextService(knowledgeRetrievalService);
const apiRequestHandler = createRequestHandler(
  config,
  () => checkDatabase(databasePool),
  knowledgeRetrievalService,
  knowledgeContextService,
);
const controlPlaneRequestHandler = createControlPlaneRequestHandler({
  config,
  productionCommand: productionRuntime.commands,
  leadQualificationReviewCommand: leadQualificationReviewRuntime.commands,
  fallback: apiRequestHandler,
});
const salesIntakeControlPlaneRequestHandler = createSalesIntakeControlPlaneRequestHandler({
  config,
  salesIntakeCommand: salesIntakeRuntime.commands,
  salesEmailCommand: salesSupervisedEmailExecution,
  fallback: controlPlaneRequestHandler,
});
const paystackWebhookIngress = config.paymentIntegrationId === 'payment.paystack' && config.paystackSecretKey
  ? createPaystackPaymentWebhookIngress({
      secretKey: config.paystackSecretKey,
      currentStateStore: financePaymentRuntime.currentStateStore,
      eventWorkflow: financePaymentRuntime.eventWorkflow,
    })
  : undefined;
const server = createServer(createPaystackWebhookRequestHandler({
  config,
  ...(paystackWebhookIngress ? { ingress: paystackWebhookIngress } : {}),
  fallback: salesIntakeControlPlaneRequestHandler,
}));
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeRecoveryRunner.stop();

  logEvent('info', 'api_shutdown_started', { signal });

  server.close(async (error) => {
    if (error) {
      logEvent('error', 'api_shutdown_failed', { signal, error: error.message });
      process.exitCode = 1;
      return;
    }

    try {
      await databasePool.end();
      logEvent('info', 'api_shutdown_completed', { signal });
    } catch (databaseError) {
      logEvent('error', 'database_pool_shutdown_failed', {
        signal,
        error: databaseError instanceof Error ? databaseError.message : String(databaseError),
      });
      process.exitCode = 1;
    }
  });

  setTimeout(() => {
    logEvent('error', 'api_shutdown_forced', { signal, timeoutMs: 10_000 });
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

async function start(): Promise<void> {
  await runtimeRecoveryRunner.runOnce();
  runtimeRecoveryRunner.start();

  server.listen(config.port, config.host, () => {
    logEvent('info', 'api_started', {
      environment: config.environment,
      host: config.host,
      port: config.port,
      nodeVersion: process.version,
      databaseConfigured: true,
      knowledgeRetrievalConfigured: true,
      knowledgeContextConfigured: true,
      runtimeRecoveryConfigured: true,
      financePaymentRuntimeConfigured: Boolean(financePaymentRuntime.workflow && financePaymentRuntime.clearanceStore),
      paymentSandboxConfigured: registeredIntegrationIds.includes('payment.sandbox'),
      paystackConfigured: registeredIntegrationIds.includes('payment.paystack'),
      paystackWebhookConfigured: Boolean(paystackWebhookIngress),
      activePaymentIntegration: config.paymentIntegrationId ?? 'payment.sandbox',
      activePaymentMode: config.paymentIntegrationMode ?? 'sandbox',
      productionRuntimeConfigured: Boolean(
        productionRuntime.handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY),
      ),
      productionRuntimePersistenceConfigured: true,
      leadQualificationReviewRuntimeConfigured: true,
      leadQualificationReviewControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesIntakeRuntimeConfigured: true,
      salesIntakeControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesSupervisedEmailRuntimeConfigured: true,
      salesSupervisedEmailControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesSupervisedGmailConfigured: Boolean(
        config.gmailSupervisedSalesSendEnabled && registeredIntegrationIds.includes('email.gmail'),
      ),
      productionControlPlaneConfigured: Boolean(config.controlPlaneToken),
      registeredIntegrations: registeredIntegrationIds,
      geminiConfigured: registeredIntegrationIds.includes('model.gemini'),
      externalTelemetryConfigured: Boolean(config.betterStackIngestingHost),
    });
  });
}

void start().catch(async (error) => {
  logEvent('error', 'api_startup_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    await databasePool.end();
  } finally {
    process.exitCode = 1;
  }
});
