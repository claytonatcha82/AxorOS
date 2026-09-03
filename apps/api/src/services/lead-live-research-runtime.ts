import type { Pool } from 'pg';
import { createOperationalRepository } from '../data/operational-repository.js';
import { createTransactionRunner } from '../data/transaction.js';
import type { IntegrationRegistry } from '../integrations/integration-registry.js';
import { createExactSourceContextService } from '../knowledge/exact-source-context-service.js';
import type { KnowledgeContextService } from '../knowledge/knowledge-context-service.js';
import { createLeadAtlasContextService } from './lead-atlas-context-service.js';
import { createLeadAtlasResearchOrchestrator } from './lead-atlas-research-orchestrator.js';
import { createLeadAtlasResearchPlanner } from './lead-atlas-research-planner.js';
import { createLeadDiscoveryService } from './lead-discovery-service.js';
import { createLeadPreliminaryQualificationPersistenceService } from './lead-preliminary-qualification-persistence-service.js';
import { createLeadPreliminaryQualificationService } from './lead-preliminary-qualification-service.js';
import { createLeadPublicWebEnrichmentService } from './lead-public-web-enrichment-service.js';
import { createLeadQualificationDispositionPersistenceService } from './lead-qualification-disposition-persistence-service.js';
import { createLeadQualificationDispositionService } from './lead-qualification-disposition-service.js';
import {
  createLeadQualificationRuntimeReviewRegistrationService,
  type LeadQualificationRuntimeReviewRegistrationStore,
} from './lead-qualification-runtime-review-registration-service.js';
import { createLeadQualificationRuntimeReviewService } from './lead-qualification-runtime-review-service.js';
import { createLeadResearchQualificationEvidenceService } from './lead-research-qualification-evidence-service.js';
import { createLeadResearchWorkflowService } from './lead-research-workflow-service.js';

export interface LeadLiveResearchRuntimeDependencies {
  pool: Pool;
  integrations: IntegrationRegistry;
  knowledgeContext: Pick<KnowledgeContextService, 'assemble'>;
  runtimeStore: LeadQualificationRuntimeReviewRegistrationStore;
}

export function createLeadLiveResearchRuntime(dependencies: LeadLiveResearchRuntimeDependencies) {
  const repository = createOperationalRepository(dependencies.pool);
  const transactionRunner = createTransactionRunner(dependencies.pool);
  const exactSourceContext = createExactSourceContextService(dependencies.pool);
  const atlasContext = createLeadAtlasContextService(dependencies.knowledgeContext, exactSourceContext);
  const planner = createLeadAtlasResearchPlanner();
  const discovery = createLeadDiscoveryService(repository, transactionRunner);
  const enrichment = createLeadPublicWebEnrichmentService(repository, transactionRunner);
  const workflow = createLeadResearchWorkflowService(dependencies.integrations, discovery, enrichment);
  const qualificationEvidence = createLeadResearchQualificationEvidenceService();
  const qualification = createLeadPreliminaryQualificationService();
  const qualificationPersistence = createLeadPreliminaryQualificationPersistenceService(repository);
  const disposition = createLeadQualificationDispositionService({
  pilotAutoAdvanceThreshold: 45,
});
  const dispositionPersistence = createLeadQualificationDispositionPersistenceService(repository);
  const runtimeReview = createLeadQualificationRuntimeReviewService();
  const runtimeReviewRegistration = createLeadQualificationRuntimeReviewRegistrationService({
    store: dependencies.runtimeStore,
  });

  return createLeadAtlasResearchOrchestrator(
    atlasContext,
    planner,
    workflow,
    qualificationEvidence,
    qualification,
    qualificationPersistence,
    disposition,
    dispositionPersistence,
    runtimeReview,
    runtimeReviewRegistration,
  );
}

export type LeadLiveResearchRuntime = ReturnType<typeof createLeadLiveResearchRuntime>;
