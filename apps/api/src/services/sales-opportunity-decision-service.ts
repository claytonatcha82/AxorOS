import type { SalesOpportunityAssessment } from './sales-opportunity-assessment-service.js';

export type SalesOpportunityDecision = 'pursue' | 'needs_information' | 'do_not_pursue';

export interface SalesOpportunityDecisionResult {
  leadId: string;
  salesIntakeExecutionId: string;
  company: string;
  decision: SalesOpportunityDecision;
  rationale: string[];
  missingInformation: string[];
  confidence: number;
  recommendedNextAction:
    | 'request_founder_approval_for_outreach'
    | 'retrieve_missing_sales_context'
    | 'close_sales_opportunity';
  outreachAuthorised: false;
  pricingAuthorised: false;
  commercialCommitmentAuthorised: false;
  atlasSourcePaths: string[];
}

function presentList(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && Boolean(entry.trim()));
}

function requiredConfidence(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Sales opportunity decision requires confidence between 0 and 1.');
  }
  return value;
}

export function createSalesOpportunityDecisionService() {
  return {
    decide(assessment: SalesOpportunityAssessment): SalesOpportunityDecisionResult {
      if (assessment.atlasSourcePaths.length === 0) {
        throw new Error('Sales opportunity decision requires authoritative Atlas source paths.');
      }
      if (assessment.outreachAuthorised !== false) {
        throw new Error('Sales opportunity decision must not authorise outreach.');
      }
      if (assessment.pricingAuthorised !== false) {
        throw new Error('Sales opportunity decision must not authorise pricing.');
      }
      if (assessment.commercialCommitmentAuthorised !== false) {
        throw new Error('Sales opportunity decision must not authorise commercial commitments.');
      }

      const confidence = requiredConfidence(assessment.salesContext.confidence);
      const missingInformation = [...new Set(assessment.missingInformation)];
      const rationale: string[] = [];

      if (assessment.assessmentStatus === 'context_incomplete') {
        rationale.push('Sales context is incomplete; the opportunity must not advance to outreach approval.');
        return {
          leadId: assessment.leadId,
          salesIntakeExecutionId: assessment.salesIntakeExecutionId,
          company: assessment.company,
          decision: 'needs_information',
          rationale,
          missingInformation,
          confidence,
          recommendedNextAction: 'retrieve_missing_sales_context',
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          atlasSourcePaths: [...new Set(assessment.atlasSourcePaths)],
        };
      }

      if (!assessment.existingLeadScore || assessment.existingLeadScore < 40) {
        rationale.push('The existing Lead qualification score is below the governed Sales pursuit threshold.');
        return {
          leadId: assessment.leadId,
          salesIntakeExecutionId: assessment.salesIntakeExecutionId,
          company: assessment.company,
          decision: 'do_not_pursue',
          rationale,
          missingInformation,
          confidence,
          recommendedNextAction: 'close_sales_opportunity',
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          atlasSourcePaths: [...new Set(assessment.atlasSourcePaths)],
        };
      }

      if (confidence < 0.7 || !presentList(assessment.salesContext.painPoints) || !presentList(assessment.salesContext.recommendedServices)) {
        rationale.push('The opportunity has a qualifying Lead score but insufficient Sales confidence or opportunity evidence.');
        return {
          leadId: assessment.leadId,
          salesIntakeExecutionId: assessment.salesIntakeExecutionId,
          company: assessment.company,
          decision: 'needs_information',
          rationale,
          missingInformation,
          confidence,
          recommendedNextAction: 'retrieve_missing_sales_context',
          outreachAuthorised: false,
          pricingAuthorised: false,
          commercialCommitmentAuthorised: false,
          atlasSourcePaths: [...new Set(assessment.atlasSourcePaths)],
        };
      }

      rationale.push('The opportunity has complete Sales context, a qualifying Lead score, and sufficient opportunity evidence.');
      rationale.push('Founder approval is required before any prospect outreach.');
      return {
        leadId: assessment.leadId,
        salesIntakeExecutionId: assessment.salesIntakeExecutionId,
        company: assessment.company,
        decision: 'pursue',
        rationale,
        missingInformation,
        confidence,
        recommendedNextAction: 'request_founder_approval_for_outreach',
        outreachAuthorised: false,
        pricingAuthorised: false,
        commercialCommitmentAuthorised: false,
        atlasSourcePaths: [...new Set(assessment.atlasSourcePaths)],
      };
    },
  };
}

export type SalesOpportunityDecisionService = ReturnType<typeof createSalesOpportunityDecisionService>;
