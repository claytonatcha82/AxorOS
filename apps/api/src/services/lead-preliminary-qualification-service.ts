import type { LeadAtlasContextBundle } from './lead-atlas-context-service.js';

export type QualificationCategory =
  | 'businessFit'
  | 'projectFit'
  | 'partnershipPotential'
  | 'decisionMakerAccess'
  | 'commercialFit'
  | 'timeline';

export interface QualificationCategoryAssessment {
  score: number | null;
  evidenceReferences: string[];
  missingInformation: string[];
}

export interface PreliminaryLeadQualificationInput {
  atlas: LeadAtlasContextBundle;
  assessments: Record<QualificationCategory, QualificationCategoryAssessment>;
}

export interface PreliminaryLeadQualificationResult {
  totalScore: number | null;
  suggestedStatus: 'excellent' | 'good' | 'moderate' | 'poor_fit' | 'insufficient_information';
  humanReviewRequired: true;
  missingInformation: string[];
  atlasSourcePaths: string[];
  assessments: Record<QualificationCategory, QualificationCategoryAssessment>;
}

const CATEGORIES: QualificationCategory[] = [
  'businessFit', 'projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline',
];

function assertAtlasFramework(atlas: LeadAtlasContextBundle): void {
  const context = atlas.leadQualification.context;
  for (const required of ['Business Fit', 'Project Fit', 'Partnership Potential', 'Decision-Maker Access', 'Commercial Fit', 'Timeline', 'Maximum Score:', '60']) {
    if (!context.includes(required)) throw new Error(`Atlas Lead Qualification framework is missing required criterion: ${required}.`);
  }
}

function sourcePaths(atlas: LeadAtlasContextBundle): string[] {
  return [...new Set(atlas.leadQualification.sources.map((source) => source.citation.path))];
}

function statusFor(total: number) {
  if (total >= 50) return 'excellent' as const;
  if (total >= 40) return 'good' as const;
  if (total >= 30) return 'moderate' as const;
  return 'poor_fit' as const;
}

export function createLeadPreliminaryQualificationService() {
  return {
    evaluate(input: PreliminaryLeadQualificationInput): PreliminaryLeadQualificationResult {
      assertAtlasFramework(input.atlas);
      const missingInformation: string[] = [];
      let total = 0;
      let complete = true;

      for (const category of CATEGORIES) {
        const assessment = input.assessments[category];
        if (!assessment) throw new Error(`Missing qualification assessment: ${category}.`);
        missingInformation.push(...assessment.missingInformation);
        if (assessment.score === null) {
          complete = false;
          continue;
        }
        if (!Number.isInteger(assessment.score) || assessment.score < 0 || assessment.score > 10) {
          throw new Error(`${category} score must be an integer from 0 to 10 or null when evidence is insufficient.`);
        }
        if (assessment.evidenceReferences.length === 0) {
          throw new Error(`${category} cannot receive a score without evidence references.`);
        }
        total += assessment.score;
      }

      return {
        totalScore: complete ? total : null,
        suggestedStatus: complete ? statusFor(total) : 'insufficient_information',
        humanReviewRequired: true,
        missingInformation: [...new Set(missingInformation)],
        atlasSourcePaths: sourcePaths(input.atlas),
        assessments: input.assessments,
      };
    },
  };
}

export type LeadPreliminaryQualificationService = ReturnType<typeof createLeadPreliminaryQualificationService>;
