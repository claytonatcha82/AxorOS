import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { createRuntimeRecoveryRunner } from './agents/agent-runtime-recovery-runner.js';
import { createFinancePaymentRuntime } from './agents/finance-payment-runtime.js';
import { PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY } from './agents/production-model-capabilities.js';
import { createPersistedProductionRuntime } from './agents/production-persisted-runtime.js';
import { createBetterStackLogSink } from './better-stack.js';
import { loadConfig } from './config.js';
import { createControlPlaneRequestHandler } from './control-plane-request-handler.js';
import { checkDatabase, createDatabasePool } from './database.js';
import { createConfiguredIntegrationRegistry } from './integrations/integration-bootstrap.js';
import { createKnowledgeContextService } from './knowledge/knowledge-context-service.js';
import { createKnowledgeRepository } from './knowledge/knowledge-repository.js';
import { createKnowledgeRetrievalService } from './knowledge/knowledge-retrieval-service.js';
import { logEvent, setExternalLogSink } from './logger.js';

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error('AXOROS_DATABASE_URL is required to start the AxorOS API.');
}

if (config.betterStackIngestingHost && config.betterStackSourceToken) {
  setExternalLogSink(createBetterStackLogSink(config.betterStackIngestingHost, config.betterStackSourceToken));
}

const databasePool = createDatabasePool(config.databaseUrl);
const { registry: integrationRegistry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(config);
const financePaymentRuntime = createFinancePaymentRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
});
const productionRuntime = createPersistedProductionRuntime({
  pool: databasePool,
  integrations: integrationRegistry,
});
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
const server = createServer(createControlPlaneRequestHandler({
  config,
  productionCommand: productionRuntime.commands,
  fallback: apiRequestHandler,
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
      productionRuntimeConfigured: Boolean(
        productionRuntime.handlers.get('production_agent', PRODUCTION_TECHNICAL_ASSISTANCE_CAPABILITY),
      ),
      productionRuntimePersistenceConfigured: true,
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
