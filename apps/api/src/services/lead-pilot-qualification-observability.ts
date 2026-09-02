export interface LeadPilotQualificationObservabilityInput {
  companyName: string;
  officialWebsiteUrl: string | null;
  websiteStatus?: string;
  assessments: Record<string, unknown>;
  totalScore: number | null;
  suggestedStatus: string;
  missingInformation: string[];
  reviewExecutionId: string;
}

/**
 * Produces a compact, log-safe qualification summary for pilot-cycle telemetry.
 * This is observability only: it does not calculate or alter qualification scores.
 */
export function summarizeLeadPilotQualification(
  input: LeadPilotQualificationObservabilityInput,
) {
  const score = (key: string): number | null => {
    const value = input.assessments[key];
    if (!value || typeof value !== 'object') return null;
    const candidate = (value as { score?: unknown }).score;
    return typeof candidate === 'number' ? candidate : null;
  };

  return {
    companyName: input.companyName,
    officialWebsiteUrl: input.officialWebsiteUrl,
    websiteStatus: input.websiteStatus ?? (input.officialWebsiteUrl ? 'verified' : 'no_verified_website'),
    scores: {
      businessFit: score('businessFit'),
      projectFit: score('projectFit'),
      partnershipPotential: score('partnershipPotential'),
      decisionMakerAccess: score('decisionMakerAccess'),
      commercialFit: score('commercialFit'),
      timeline: score('timeline'),
    },
    totalScore: input.totalScore,
    suggestedStatus: input.suggestedStatus,
    missingInformation: input.missingInformation,
    reviewExecutionId: input.reviewExecutionId,
  };
}
