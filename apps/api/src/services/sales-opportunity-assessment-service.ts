import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { LeadRecord } from '../data/operational-repository.js';

export type SalesOpportunityAssessmentStatus = 'context_complete' | 'context_incomplete';

export interface SalesOpportunityAssessment {
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  source: string | null;
  opportunitySummary: string | null;
  existingLeadScore: number | null;
  assessmentStatus: SalesOpportunityAssessmentStatus;
  missingInformation: string[];
  atlasSourcePaths: string[];
  outreachAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'retrieve_missing_sales_context' | 'prepare_governed_sales_context';
}

const REQUIRED_SALES_CONTEXT = [
  'decision_maker',
  'industry',
  'country',
  'business_summary',
  'website_audit',
  'pain_points',
  'recommended_services',
  'priority',
  'confidence',
  'previous_contact',
] as const;

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createSalesOpportunityAssessmentService() {
  return {
    assess(input: {
      intakeExecution: AgentRuntimeExecutionRecord;
      lead: LeadRecord;
    }): SalesOpportunityAssessment {
      const { intakeExecution, lead } = input;
      const task = intakeExecution.task;

      if (task.destinationAgent !== 'sales_agent') {
        throw new Error('Sales opportunity assessment requires a Sales Agent intake execution.');
      }
      if (task.status !== 'completed' || intakeExecution.result?.status !== 'completed') {
        throw new Error('Sales opportunity assessment requires a completed internal Sales intake.');
      }
      if (task.inputs.salesIntakeOnly !== true) {
        throw new Error('Sales opportunity assessment requires intake-only authority.');
      }
      if (task.inputs.salesDispatchAuthorised !== false || task.inputs.outreachAuthorised !== false) {
        throw new Error('Sales opportunity assessment must not inherit dispatch or outreach authority.');
      }
      if (task.knowledgeReferences.length === 0) {
        throw new Error('Sales opportunity assessment requires Atlas provenance.');
      }

      const taskLeadId = required(String(task.context.leadId ?? ''), 'leadId');
      if (lead.id !== taskLeadId) {
        throw new Error(`Sales opportunity assessment lead mismatch: expected ${taskLeadId}, received ${lead.id}.`);
      }

      const missingInformation = [...REQUIRED_SALES_CONTEXT];
      if (!lead.contactName) missingInformation.unshift('contact_name');
      if (!lead.contactEmail) missingInformation.unshift('contact_email');
      if (!lead.opportunitySummary) missingInformation.unshift('opportunity_summary');

      const assessmentStatus: SalesOpportunityAssessmentStatus = missingInformation.length === 0
        ? 'context_complete'
        : 'context_incomplete';

      return {
        leadId: lead.id,
        salesIntakeExecutionId: task.executionId,
        company: lead.companyName,
        contactName: lead.contactName,
        contactEmail: lead.contactEmail,
        source: lead.source,
        opportunitySummary: lead.opportunitySummary,
        existingLeadScore: lead.leadScore,
        assessmentStatus,
        missingInformation,
        atlasSourcePaths: [...new Set(task.knowledgeReferences)],
        outreachAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        nextAction: assessmentStatus === 'context_complete'
          ? 'prepare_governed_sales_context'
          : 'retrieve_missing_sales_context',
      };
    },
  };
}

export type SalesOpportunityAssessmentService = ReturnType<typeof createSalesOpportunityAssessmentService>;
