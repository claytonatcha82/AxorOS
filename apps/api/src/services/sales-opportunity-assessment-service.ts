import type { AgentRuntimeExecutionRecord } from '../agents/agent-runtime-state.js';
import type { LeadRecord } from '../data/operational-repository.js';

export type SalesOpportunityAssessmentStatus = 'context_complete' | 'context_incomplete';

export interface SalesOpportunityContext {
  decisionMaker?: string;
  industry?: string;
  country?: string;
  businessSummary?: string;
  websiteAudit?: string;
  painPoints?: string[];
  recommendedServices?: string[];
  priority?: string;
  confidence?: number;
  previousContact?: string;
}

export interface SalesOpportunityAssessment {
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  source: string | null;
  opportunitySummary: string | null;
  existingLeadScore: number | null;
  salesContext: SalesOpportunityContext;
  assessmentStatus: SalesOpportunityAssessmentStatus;
  missingInformation: string[];
  atlasSourcePaths: string[];
  outreachAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  nextAction: 'retrieve_missing_sales_context' | 'prepare_governed_sales_context';
}

function presentText(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim());
}

function presentList(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => presentText(entry));
}

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
      salesContext?: SalesOpportunityContext;
    }): SalesOpportunityAssessment {
      const { intakeExecution, lead } = input;
      const salesContext = input.salesContext ?? {};
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

      if (salesContext.confidence !== undefined && (!Number.isFinite(salesContext.confidence) || salesContext.confidence < 0 || salesContext.confidence > 1)) {
        throw new Error('Sales opportunity assessment confidence must be between 0 and 1 when supplied.');
      }

      const missingInformation: string[] = [];
      if (!lead.contactName && !presentText(salesContext.decisionMaker)) missingInformation.push('decision_maker');
      if (!lead.contactEmail) missingInformation.push('contact_email');
      if (!presentText(salesContext.industry)) missingInformation.push('industry');
      if (!presentText(salesContext.country)) missingInformation.push('country');
      if (!presentText(salesContext.businessSummary)) missingInformation.push('business_summary');
      if (!presentText(salesContext.websiteAudit)) missingInformation.push('website_audit');
      if (!presentList(salesContext.painPoints)) missingInformation.push('pain_points');
      if (!presentList(salesContext.recommendedServices)) missingInformation.push('recommended_services');
      if (!presentText(salesContext.priority)) missingInformation.push('priority');
      if (salesContext.confidence === undefined) missingInformation.push('confidence');
      if (!presentText(salesContext.previousContact)) missingInformation.push('previous_contact');
      if (!lead.opportunitySummary) missingInformation.push('opportunity_summary');

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
        salesContext,
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
