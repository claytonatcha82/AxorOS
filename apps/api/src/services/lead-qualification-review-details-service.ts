import type { AgentRuntimeStore } from '../agents/agent-runtime-store.js';
import type { OperationalRepository } from '../data/operational-repository.js';

export interface LeadQualificationReviewDetails {
  executionId: string;
  lead: {
    id: string;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    opportunitySummary: string | null;
    leadScore: number | null;
    status: string;
    enrichmentStatus: string;
    evidence: unknown;
  };
  qualification: {
    id: string;
    totalScore: number | null;
    suggestedStatus: string;
    assessments: unknown;
    missingInformation: unknown;
    atlasSourcePaths: unknown;
    createdAt: string;
  };
  disposition: {
    disposition: string;
    recommendedAction: string;
    humanApprovalRequired: boolean;
    reasons: unknown;
    atlasSourcePaths: unknown;
    createdAt: string;
  };
  runtime: {
    confidence: number;
    risks: readonly string[];
    nextAction: string;
    createdAt: string;
    updatedAt: string;
  };
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createLeadQualificationReviewDetailsService(
  dependencies: {
    runtimeStore: Pick<AgentRuntimeStore, 'getExecution'>;
    operationalRepository: Pick<OperationalRepository, 'getLeadById' | 'listPreliminaryLeadQualifications' | 'findWorkflowEventByTypeAndPayloadField'>;
  },
) {
  return {
    async get(executionId: string): Promise<LeadQualificationReviewDetails> {
      const normalizedExecutionId = required(executionId, 'executionId');
      const record = await dependencies.runtimeStore.getExecution(normalizedExecutionId);
      if (!record) throw new Error(`Lead qualification review execution ${normalizedExecutionId} was not found.`);
      if (record.task.destinationAgent !== 'lead_agent') {
        throw new Error('Lead qualification review details require Lead Agent destination.');
      }

      const context = record.task.context as Record<string, unknown>;
      const leadId = typeof context.leadId === 'string' ? context.leadId.trim() : '';
      const qualificationRecordId = typeof context.qualificationRecordId === 'string' ? context.qualificationRecordId.trim() : '';
      const dispositionRecordId = typeof context.dispositionRecordId === 'string' ? context.dispositionRecordId.trim() : '';
      if (!leadId || !qualificationRecordId || !dispositionRecordId) {
        throw new Error('Lead qualification review execution is missing persisted review references.');
      }

      const [lead, qualifications, dispositionEvent] = await Promise.all([
        dependencies.operationalRepository.getLeadById(leadId),
        dependencies.operationalRepository.listPreliminaryLeadQualifications(leadId),
        dependencies.operationalRepository.findWorkflowEventByTypeAndPayloadField(
          'lead_qualification_disposition_recorded',
          'qualificationRecordId',
          qualificationRecordId,
        ),
      ]);
      if (!lead) throw new Error(`Lead not found: ${leadId}.`);
      const qualification = qualifications.find((item) => item.id === qualificationRecordId);
      if (!qualification) throw new Error(`Lead qualification record not found: ${qualificationRecordId}.`);
      if (!dispositionEvent || dispositionEvent.id !== dispositionRecordId) {
        throw new Error(`Lead qualification disposition record not found: ${dispositionRecordId}.`);
      }

      const dispositionPayload = dispositionEvent.payload as Record<string, unknown>;
      return {
        executionId: normalizedExecutionId,
        lead: {
          id: lead.id,
          companyName: lead.companyName,
          contactName: lead.contactName,
          contactEmail: lead.contactEmail,
          opportunitySummary: lead.opportunitySummary,
          leadScore: lead.leadScore,
          status: lead.status,
          enrichmentStatus: lead.enrichmentStatus,
          evidence: lead.evidence,
        },
        qualification: {
          id: qualification.id,
          totalScore: qualification.totalScore,
          suggestedStatus: qualification.suggestedStatus,
          assessments: qualification.assessments,
          missingInformation: qualification.missingInformation,
          atlasSourcePaths: qualification.atlasSourcePaths,
          createdAt: qualification.createdAt,
        },
        disposition: {
          disposition: typeof dispositionPayload.disposition === 'string' ? dispositionPayload.disposition : 'unknown',
          recommendedAction: typeof dispositionPayload.recommendedAction === 'string' ? dispositionPayload.recommendedAction : 'unknown',
          humanApprovalRequired: dispositionPayload.humanApprovalRequired === true,
          reasons: dispositionPayload.reasons ?? [],
          atlasSourcePaths: dispositionPayload.atlasSourcePaths ?? [],
          createdAt: dispositionEvent.createdAt,
        },
        runtime: {
          confidence: record.task.confidence,
          risks: record.task.risks,
          nextAction: record.task.nextAction,
          createdAt: record.task.createdAt,
          updatedAt: record.task.updatedAt,
        },
      };
    },
  };
}

export type LeadQualificationReviewDetailsService = ReturnType<typeof createLeadQualificationReviewDetailsService>;
