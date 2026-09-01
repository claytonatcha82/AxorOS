import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { createRuntimeRecoveryRunner } from './agents/agent-runtime-recovery-runner.js';
import { createFinanceGovernedControlCommand } from './agents/finance-governed-control-command.js';
import { createFinancePaymentRuntime } from './agents/finance-payment-runtime.js';
import { createPersistedMarketingRuntime } from './agents/marketing-persisted-runtime.js';
import { createOperationsProductionPrerequisiteRecorder } from './agents/operations-production-prerequisite-recorder.js';
import { createOperationsProductionReadinessPostgresService } from './agents/operations-production-readiness-postgres.js';
import { createPaystackPaymentWebhookIngress } from './agents/paystack-payment-webhook-ingress.js';
import { createPilotRuntimeOperatorCommand } from './agents/pilot-runtime-operator-command.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './agents/production-model-capabilities.js';
import { createProductionModelPolicy } from './agents/production-model-policy.js';
import { createPersistedProductionRuntime } from './agents/production-persisted-runtime.js';
import { createBetterStackLogSink } from './better-stack.js';
import { loadConfig } from './config.js';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';
import { FinanceExpensePostgresStore, FinanceSubscriptionPostgresStore } from './data/finance-reporting-postgres-store.js';
import { OperationsProductionPrerequisitePostgresStore } from './data/operations-production-prerequisite-postgres-store.js';
import { PilotSystemStatePostgresStore } from './data/pilot-system-state-postgres-store.js';
import { SalesEmailSendAttemptPostgresStore } from './data/sales-email-send-attempt-postgres-store.js';
import { SalesOutreachSuppressionPostgresStore } from './data/sales-outreach-suppression-postgres-store.js';
import { createOperationalRepository } from './data/operational-repository.js';
import { createExecutiveDashboardRequestHandler } from './dashboard/executive-dashboard-request-handler.js';
import { createExecutiveDashboardService } from './dashboard/executive-dashboard-service.js';
import { checkDatabase, createDatabasePool } from './database.js';
import { createFinanceControlPlaneRequestHandler } from './finance-control-plane-request-handler.js';
import { createFinanceReportingControlPlaneRequestHandler } from './finance-reporting-control-plane-request-handler.js';
import { createConfiguredIntegrationRegistry } from './integrations/integration-bootstrap.js';
import type { ExternalIntegration } from './integrations/integration-contract.js';
import type { GmailEmailIntegration } from './integrations/gmail-draft-integration.js';
import type { ModelGenerationInput, ModelGenerationOutput } from './integrations/model-integration.js';
import { createPilotLiveExecutionGate } from './integrations/pilot-live-execution-gate.js';
import { createKnowledgeContextService } from './knowledge/knowledge-context-service.js';
import { createKnowledgeRepository } from './knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from './knowledge/knowledge-retrieval-service.js';
import { createLeadResearchControlPlaneRequestHandler } from './lead-research-control-plane-request-handler.js';
import { logEvent, setExternalLogSink } from './logger.js';
import { createMarketingControlPlaneRequestHandler } from './marketing-control-plane-request-handler.js';
import { createPaystackWebhookRequestHandler } from './paystack-webhook-request-handler.js';
import { createPublicContactRequestHandler } from './public-contact-request-handler.js';
import { createPilotRuntimeControlPlaneRequestHandler } from './pilot-runtime-control-plane-request-handler.js';
import { createPilotLeadWorkerRunOnceRequestHandler } from './pilot-lead-worker-run-once-request-handler.js';
import { createPilotSystemStateControlPlaneRequestHandler } from './pilot-system-state-control-plane-request-handler.js';
import { createProductionDeploymentControlPlaneRequestHandler } from './production-deployment-control-plane-request-handler.js';
import { createProductionPreviewControlPlaneRequestHandler } from './production-preview-control-plane-request-handler.js';
import { createProductionProjectProvisionControlPlaneRequestHandler } from './production-project-provision-control-plane-request-handler.js';
import { createSalesIntakeControlPlaneRequestHandler } from './sales-intake-control-plane-request-handler.js';
import { createLeadLiveResearchRuntime } from './services/lead-live-research-runtime.js';
import { createPersistedLeadQualificationRuntimeReview } from './services/lead-qualification-persisted-runtime-review.js';
import { createPersistedLeadSalesIntakeRuntime } from './services/lead-sales-persisted-intake-runtime.js';
import { createPilotLeadWorker } from './services/pilot-lead-worker.js';
import { createSalesInboundModelClassificationService } from './services/sales-inbound-model-classification-service.js';
import { createPersistedSalesInboundReplyRuntime } from './services/sales-inbound-reply-runtime.js';
import { createSalesIntegrationEmailTransport } from './services/sales-integration-email-transport.js';
import { createSalesOutreachDraftReviewService } from './services/sales-outreach-draft-review-service.js';
import { createSalesSupervisedEmailExecutionService } from './services/sales-supervised-email-execution-service.js';
import { createSalesSupervisedSendGateService } from './services/sales-supervised-send-gate-service.js';

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
const executiveDashboard = createExecutiveDashboardService(databasePool);
const pilotSystemState = new PilotSystemStatePostgresStore(databasePool);
integrationRegistry.setLiveExecutionGate(createPilotLiveExecutionGate(pilotSystemState));
const financeExpenses = new FinanceExpensePostgresStore(databasePool);
const financeSubscriptions = new FinanceSubscriptionPostgresStore(databasePool);
const operationsProductionPrerequisiteStore = new OperationsProductionPrerequisitePostgresStore(databasePool);
const operationsProductionPrerequisiteRecorder = createOperationsProductionPrerequisiteRecorder(
  operationsProductionPrerequisiteStore,
);
const salesOutreachDraftReview = createSalesOutreachDraftReviewService(operationalRepository);
const salesOutreachSuppressions = new SalesOutreachSuppressionPostgresStore(databasePool);
const salesSupervisedSendGate = createSalesSupervisedSendGateService(
  operationalRepository,
  salesOutreachSuppressions,
);
const salesEmailTransport = createSalesIntegrationEmailTransport(integrationRegistry);
const salesEmailSendAttempts = new SalesEmailSendAttemptPostgresStore(databasePool);
const salesSupervisedEmailExecution = createSalesSupervisedEmailExecutionService(
  operationalRepository,
  salesEmailTransport,
  salesEmailSendAttempts,
  salesOutreachSuppressions,
);
const salesOpenAIIntegration = registeredIntegrationIds.includes('model.openai')
  ? integrationRegistry.require('model.openai') as ExternalIntegration<ModelGenerationInput, ModelGenerationOutput>
  : undefined;
const salesInboundModelClassification = salesOpenAIIntegration
  ? createSalesInboundModelClassificationService(salesOpenAIIntegration)
  : undefined;
const salesGmailIntegration = registeredIntegrationIds.includes('email.gmail')
  ? integrationRegistry.require('email.gmail') as unknown as GmailEmailIntegration
  : undefined;
const salesInboundReplyRuntime = salesGmailIntegration
  ? createPersistedSalesInboundReplyRuntime(
      databasePool,
      salesGmailIntegration,
      salesInboundModelClassification,
    )
  : undefined;
const financePaymentRuntime = createFinancePaymentRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
  ...(config.paymentIntegrationId ? { paymentIntegrationId: config.paymentIntegrationId } : {}),
  ...(config.paymentIntegrationMode ? { mode: config.paymentIntegrationMode } : {}),
});
const financeGovernedControlCommand = createFinanceGovernedControlCommand({
  operationalRuntime: financePaymentRuntime.governedOperationalRuntime,
  bindingService: financePaymentRuntime.governedBindingService,
  paymentWebhookEvidenceStore: financePaymentRuntime.webhookStore,
});
const operationsProductionReadiness = createOperationsProductionReadinessPostgresService({ pool: databasePool });
const productionModelPolicy = createProductionModelPolicy(config.productionModelIntegrationId);
const productionRuntime = createPersistedProductionRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
  modelPolicy: productionModelPolicy,
});
const marketingRuntime = createPersistedMarketingRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
});
const pilotRuntimeOperatorCommand = createPilotRuntimeOperatorCommand({
  store: productionRuntime.store,
  orchestrator: productionRuntime.orchestrator,
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
const leadLiveResearchRuntime = createLeadLiveResearchRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
  knowledgeContext: knowledgeContextService,
  runtimeStore,
});
const pilotLeadWorker = createPilotLeadWorker(
  pilotSystemState,
  leadLiveResearchRuntime,
  {
    intervalMs: 60 * 60 * 1000,
    geographicFocus: 'South Africa',
    maxQueries: 1,
    maxBusinessesPerQuery: 3,
    maxWebResultsPerBusiness: 3,
    onCycleCompleted(result) {
      logEvent('info', 'pilot_lead_worker_cycle_completed', {
        queries: result.queries,
        atlasSourcePaths: result.atlasSourcePaths,
        discovered: result.discovered,
        newOrRetryable: result.discovered,
        providerCandidatesExamined: result.discovered + result.outcomes.duplicateSkipped,
        enriched: result.enriched.length,
        ambiguousOrUnresolved: result.proposals.length,
        duplicateSkipped: result.outcomes.duplicateSkipped,
        webResearchFailed: result.outcomes.webResearchFailed,
        candidateOutcomes: result.outcomes,
        reviewExecutionIds: result.enriched.map((lead) => lead.qualificationReviewExecutionId),
      });
    },
    onCycleSkipped(reason) {
      if (reason === 'pilot_disabled') {
        logEvent('info', 'pilot_lead_worker_cycle_skipped', { reason });
      }
    },
    onCycleFailed(error) {
      logEvent('error', 'pilot_lead_worker_cycle_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  },
);
const apiRequestHandler = createRequestHandler(
  config,
  () => checkDatabase(databasePool),
  knowledgeRetrievalService,
  knowledgeContextService,
);
const controlPlaneRequestHandler = createControlPlaneRequestHandler({
  config,
  productionCommand: productionRuntime.commands,
  operationsProductionPrerequisiteCommand: operationsProductionPrerequisiteRecorder,
  operationsProductionReadinessCommand: operationsProductionReadiness,
  leadQualificationReviewCommand: leadQualificationReviewRuntime.commands,
  fallback: apiRequestHandler,
});
const financeControlPlaneRequestHandler = createFinanceControlPlaneRequestHandler({
  config,
  financeCommand: financeGovernedControlCommand,
  paymentRequestCommand: financePaymentRuntime.governedPaymentRequestService,
  fallback: controlPlaneRequestHandler,
});
const financeReportingControlPlaneRequestHandler = createFinanceReportingControlPlaneRequestHandler({
  config,
  expenses: financeExpenses,
  subscriptions: financeSubscriptions,
  fallback: financeControlPlaneRequestHandler,
});
const salesIntakeControlPlaneRequestHandler = createSalesIntakeControlPlaneRequestHandler({
  config,
  salesIntakeCommand: salesIntakeRuntime.commands,
  salesOutreachDraftReviewCommand: salesOutreachDraftReview,
  salesSupervisedSendGateCommand: salesSupervisedSendGate,
  salesEmailCommand: salesSupervisedEmailExecution,
  fallback: financeReportingControlPlaneRequestHandler,
});
const productionPreviewControlPlaneRequestHandler = createProductionPreviewControlPlaneRequestHandler({
  config,
  previewDependencies: {
    integrations: integrationRegistry,
    financeClearanceStore: productionRuntime.financeClearanceStore,
    financePaymentStateStore: productionRuntime.financePaymentStateStore,
    commercialPaymentRequirementStore: productionRuntime.commercialPaymentRequirementStore,
    commercialPaymentSatisfactionStore: productionRuntime.commercialPaymentSatisfactionStore,
    operationsReadinessStore: productionRuntime.operationsReadinessStore,
  },
  fallback: salesIntakeControlPlaneRequestHandler,
});
const productionProjectProvisionControlPlaneRequestHandler = createProductionProjectProvisionControlPlaneRequestHandler({
  config,
  provisionDependencies: {
    integrations: integrationRegistry,
    financeClearanceStore: productionRuntime.financeClearanceStore,
    financePaymentStateStore: productionRuntime.financePaymentStateStore,
    commercialPaymentRequirementStore: productionRuntime.commercialPaymentRequirementStore,
    commercialPaymentSatisfactionStore: productionRuntime.commercialPaymentSatisfactionStore,
    operationsReadinessStore: productionRuntime.operationsReadinessStore,
  },
  fallback: productionPreviewControlPlaneRequestHandler,
});
const productionDeploymentControlPlaneRequestHandler = createProductionDeploymentControlPlaneRequestHandler({
  config,
  deploymentDependencies: {
    integrations: integrationRegistry,
    deploymentAuthorityStore: productionRuntime.deploymentAuthorityStore,
  },
  fallback: productionProjectProvisionControlPlaneRequestHandler,
});
const pilotRuntimeControlPlaneRequestHandler = createPilotRuntimeControlPlaneRequestHandler({
  config,
  operatorCommand: pilotRuntimeOperatorCommand,
  fallback: productionDeploymentControlPlaneRequestHandler,
});
const pilotLeadWorkerRunOnceRequestHandler = createPilotLeadWorkerRunOnceRequestHandler({
  config,
  worker: pilotLeadWorker,
  fallback: pilotRuntimeControlPlaneRequestHandler,
});
const pilotSystemStateControlPlaneRequestHandler = createPilotSystemStateControlPlaneRequestHandler({
  config,
  store: pilotSystemState,
  fallback: pilotLeadWorkerRunOnceRequestHandler,
});
const executiveDashboardRequestHandler = createExecutiveDashboardRequestHandler({
  config,
  dashboard: executiveDashboard,
  pilotSystemState,
  pilotLeadWorkerStatus: () => pilotLeadWorker.getStatus(),
  fallback: pilotSystemStateControlPlaneRequestHandler,
});
const leadResearchControlPlaneRequestHandler = createLeadResearchControlPlaneRequestHandler({
  config,
  research: leadLiveResearchRuntime,
  fallback: executiveDashboardRequestHandler,
});
const marketingControlPlaneRequestHandler = createMarketingControlPlaneRequestHandler({
  config,
  marketing: marketingRuntime.commands,
  fallback: leadResearchControlPlaneRequestHandler,
});
const paystackWebhookIngress = config.paymentIntegrationId === 'payment.paystack' && config.paystackSecretKey
  ? createPaystackPaymentWebhookIngress({
      secretKey: config.paystackSecretKey,
      currentStateStore: financePaymentRuntime.currentStateStore,
      eventWorkflow: financePaymentRuntime.eventWorkflow,
    })
  : undefined;
const paystackWebhookRequestHandler = createPaystackWebhookRequestHandler({
  config,
  ...(paystackWebhookIngress ? { ingress: paystackWebhookIngress } : {}),
  fallback: marketingControlPlaneRequestHandler,
});
const publicContactRequestHandler = createPublicContactRequestHandler({
  repository: operationalRepository,
  fallback: paystackWebhookRequestHandler,
});
const server = createServer(publicContactRequestHandler);
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeRecoveryRunner.stop();
  pilotLeadWorker.stop();

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
  const initialPilotState = await pilotSystemState.get();
  await runtimeRecoveryRunner.runOnce();
  runtimeRecoveryRunner.start();
  pilotLeadWorker.start();

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
      executiveDashboardConfigured: Boolean(config.controlPlaneToken),
      pilotSystemStateControlPlaneConfigured: Boolean(config.controlPlaneToken),
      pilotSystemState: initialPilotState.state,
      pilotRuntimeOperatorControlPlaneConfigured: Boolean(config.controlPlaneToken),
      pilotLeadWorkerConfigured: true,
      pilotLeadWorkerRunOnceControlPlaneConfigured: Boolean(config.controlPlaneToken),
      pilotLeadWorkerIntervalMs: 60 * 60 * 1000,
      pilotLeadWorkerMaxBusinessesPerCycle: 3,
      leadLiveResearchRuntimeConfigured: registeredIntegrationIds.includes('research.google-places')
        && registeredIntegrationIds.includes('research.tavily-web'),
      leadLiveResearchControlPlaneConfigured: Boolean(
        config.controlPlaneToken
        && registeredIntegrationIds.includes('research.google-places')
        && registeredIntegrationIds.includes('research.tavily-web'),
      ),
      marketingDraftRuntimeConfigured: registeredIntegrationIds.includes('model.gemini'),
      marketingDraftControlPlaneConfigured: Boolean(
        config.controlPlaneToken && registeredIntegrationIds.includes('model.gemini'),
      ),
      marketingPublishingConfigured: false,
      financePaymentRuntimeConfigured: Boolean(financePaymentRuntime.workflow && financePaymentRuntime.clearanceStore),
      financeGovernedRuntimeConfigured: true,
      financeGovernedControlPlaneConfigured: Boolean(config.controlPlaneToken),
      financeReportingPersistenceConfigured: true,
      financeReportingControlPlaneConfigured: Boolean(config.controlPlaneToken),
      financePaymentRequestRuntimeConfigured: registeredIntegrationIds.includes('payment.paystack.request'),
      financePaymentRequestControlPlaneConfigured: Boolean(
        config.controlPlaneToken && registeredIntegrationIds.includes('payment.paystack.request'),
      ),
      paymentSandboxConfigured: registeredIntegrationIds.includes('payment.sandbox'),
      paystackConfigured: registeredIntegrationIds.includes('payment.paystack'),
      paystackWebhookConfigured: Boolean(paystackWebhookIngress),
      activePaymentIntegration: config.paymentIntegrationId ?? 'payment.sandbox',
      activePaymentMode: config.paymentIntegrationMode ?? 'sandbox',
      operationsProductionPrerequisiteControlPlaneConfigured: Boolean(config.controlPlaneToken),
      operationsProductionReadinessRuntimeConfigured: true,
      operationsProductionReadinessControlPlaneConfigured: Boolean(config.controlPlaneToken),
      productionRuntimeConfigured: Boolean(
        productionRuntime.handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY),
      ),
      productionRuntimePersistenceConfigured: true,
      productionProjectProvisionControlPlaneConfigured: Boolean(
        config.controlPlaneToken && registeredIntegrationIds.includes('deployment.cloudflare.project'),
      ),
      productionPreviewDeploymentControlPlaneConfigured: Boolean(
        config.controlPlaneToken && registeredIntegrationIds.includes('deployment.cloudflare.preview'),
      ),
      productionDeploymentControlPlaneConfigured: Boolean(
        config.controlPlaneToken && registeredIntegrationIds.includes('deployment.cloudflare.production'),
      ),
      productionModelIntegration: productionModelPolicy.technicalImplementationIntegrationId,
      leadQualificationReviewRuntimeConfigured: true,
      leadQualificationReviewControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesIntakeRuntimeConfigured: true,
      salesIntakeControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesOutreachDraftReviewControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesSupervisedSendGateControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesSupervisedSendGateSuppressionConfigured: true,
      salesSupervisedEmailRuntimeConfigured: true,
      salesSupervisedEmailSuppressionConfigured: true,
      salesSupervisedEmailControlPlaneConfigured: Boolean(config.controlPlaneToken),
      salesSupervisedGmailConfigured: Boolean(
        config.gmailSupervisedSalesSendEnabled && registeredIntegrationIds.includes('email.gmail'),
      ),
      salesInboundOpenAIClassificationConfigured: Boolean(salesInboundModelClassification),
      salesInboundReplyRuntimeConfigured: Boolean(salesInboundReplyRuntime),
      registeredIntegrations: registeredIntegrationIds,
    });
  });
}

start().catch(async (error) => {
  logEvent('error', 'api_start_failed', { error: error instanceof Error ? error.message : String(error) });
  await databasePool.end().catch(() => undefined);
  process.exit(1);
});