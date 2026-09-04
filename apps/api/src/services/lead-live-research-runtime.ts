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
import { createPersistedLeadSalesIntakeRuntime } from './lead-sales-persisted-intake-runtime.js';
import { logEvent } from '../logger.js';

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
    pilotAutoAdvanceThreshold: 40,
  });
  const dispositionPersistence = createLeadQualificationDispositionPersistenceService(repository);
  const runtimeReview = createLeadQualificationRuntimeReviewService();
  const runtimeReviewRegistration = createLeadQualificationRuntimeReviewRegistrationService({
    store: dependencies.runtimeStore,
  });
  const baseOrchestrator = createLeadAtlasResearchOrchestrator(
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
  const salesIntakeRuntime = createPersistedLeadSalesIntakeRuntime(dependencies.pool);

  return {
    async research(input: Parameters<typeof baseOrchestrator.research>[0]): Promise<Awaited<ReturnType<typeof baseOrchestrator.research>>> {
      const result = await baseOrchestrator.research(input);
      const autoAdvanced = result.enriched.filter(
        (lead) =>
          lead.qualificationDisposition.disposition === 'advance' &&
          lead.qualificationDisposition.humanApprovalRequired === false &&
          lead.qualificationDisposition.recommendedAction === 'approve_advance',
      );

      for (const lead of autoAdvanced) {
        const intake = await salesIntakeRuntime.commands.handoffAutoAdvancedLead({
          leadId: lead.leadId,
          qualificationRecordId: lead.preliminaryQualificationRecordId,
          dispositionRecordId: lead.qualificationDispositionRecordId,
          atlasSourcePaths: lead.qualificationDisposition.atlasSourcePaths,
          correlationId: input.correlationId,
          createdAt: new Date().toISOString(),
        });

        logEvent('info', 'lead_sales_auto_advance_handoff_completed', {
          leadId: lead.leadId,
          companyName: lead.companyName,
          qualificationRecordId: lead.preliminaryQualificationRecordId,
          dispositionRecordId: lead.qualificationDispositionRecordId,
          salesIntakeExecutionId: intake.intakeExecution.task.executionId,
          salesIntakeStatus: intake.intakeExecution.task.status,
          salesDispatchAuthorised: intake.intakeExecution.task.inputs.salesDispatchAuthorised,
          outreachAuthorised: intake.intakeExecution.task.inputs.outreachAuthorised,
        });
      }

      return result;
    },
  };
}

export type LeadLiveResearchRuntime = ReturnType<typeof createLeadLiveResearchRuntime>;
