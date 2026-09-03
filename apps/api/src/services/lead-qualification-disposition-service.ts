import type { PreliminaryLeadQualificationResult } from './lead-preliminary-qualification-service.js';

export type LeadQualificationRecommendedAction =
  | 'approve_advance'
  | 'collect_more_evidence'
  | 'review_fit'
  | 'approve_reject';

export interface LeadQualificationDisposition {
  disposition: 'hold' | 'advance';
  recommendedAction: LeadQualificationRecommendedAction;
  humanApprovalRequired: boolean;
  reasons: string[];
  atlasSourcePaths: string[];
}

function recommendedActionFor(
  status: PreliminaryLeadQualificationResult['suggestedStatus'],
): LeadQualificationRecommendedAction {
  switch (status) {
    case 'excellent':
    case 'good':
      return 'approve_advance';
    case 'moderate':
      return 'review_fit';
    case 'poor_fit':
      return 'approve_reject';
    case 'insufficient_information':
      return 'collect_more_evidence';
  }
}

function reasonsFor(result: PreliminaryLeadQualificationResult): string[] {
  switch (result.suggestedStatus) {
    case 'excellent':
    case 'good':
      return [
        `Atlas-backed preliminary qualification suggests ${result.suggestedStatus} fit, but human approval is required before advancing the lead.`,
      ];
    case 'moderate':
      return [
        'Atlas-backed preliminary qualification suggests moderate fit; human review is required before any consequential lead-state change.',
      ];
    case 'poor_fit':
      return [
        'Atlas-backed preliminary qualification suggests poor fit, but human approval is required before rejecting the lead.',
      ];
    case 'insufficient_information':
      return [
        'Qualification evidence is incomplete; collect additional evidence before considering advance or rejection.',
        ...result.missingInformation,
      ];
  }
}

export interface LeadQualificationDispositionServiceOptions {
  pilotAutoAdvanceThreshold?: number;
}

export function createLeadQualificationDispositionService(options?: LeadQualificationDispositionServiceOptions) {
  return {
    evaluate(result: PreliminaryLeadQualificationResult): LeadQualificationDisposition {
      if (result.humanReviewRequired !== true) {
        throw new Error('Lead disposition requires the preliminary qualification to preserve human review authority.');
      }
      if (result.atlasSourcePaths.length === 0) {
        throw new Error('Lead disposition requires authoritative Atlas source paths.');
      }

      const meetsAutoAdvanceThreshold =
        options?.pilotAutoAdvanceThreshold !== undefined &&
        result.totalScore !== null &&
        result.totalScore >= options.pilotAutoAdvanceThreshold &&
        (result.suggestedStatus === 'excellent' || result.suggestedStatus === 'good');

      return {
        disposition: meetsAutoAdvanceThreshold ? 'advance' : 'hold',
        recommendedAction: recommendedActionFor(result.suggestedStatus),
        humanApprovalRequired: !meetsAutoAdvanceThreshold,
        reasons: [...new Set(reasonsFor(result))],
        atlasSourcePaths: [...new Set(result.atlasSourcePaths)],
      };
    },
  };
}

export type LeadQualificationDispositionService = ReturnType<typeof createLeadQualificationDispositionService>;
