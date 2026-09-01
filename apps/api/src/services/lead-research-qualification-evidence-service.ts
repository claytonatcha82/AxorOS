import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { LeadAtlasContextBundle } from './lead-atlas-context-service.js';
import type { QualificationCategory, QualificationCategoryAssessment } from './lead-preliminary-qualification-service.js';

export interface LeadResearchQualificationEvidenceInput {
  atlas: LeadAtlasContextBundle;
  companyName: string;
  officialWebsiteUrl: string;
  publicWebResults: PublicWebSearchResult[];
}

export type LeadResearchQualificationAssessments = Record<QualificationCategory, QualificationCategoryAssessment>;

const CATEGORIES: QualificationCategory[] = [
  'businessFit', 'projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline',
];

const LEGACY_INDUSTRY_SECTION = /#\s+(?:Target\s+)?Industries([\s\S]*?)(?=\n#\s+|$)/i;
const BULLET = /^\s*-\s+(.+?)\s*$/gm;

function emptyAssessment(missing: string): QualificationCategoryAssessment {
  return { score: null, evidenceReferences: [], missingInformation: [missing] };
}

function evidenceReferences(results: PublicWebSearchResult[]): string[] {
  return [...new Set(results.map((result) => result.url).filter(Boolean).map((url) => `public-web:${url}`))];
}

function bulletsFromText(text: string): string[] {
  return [...text.matchAll(BULLET)].map((match) => match[1]!.replace(/\*\*/g, '').trim()).filter(Boolean);
}

function atlasReferenceSection(context: string, reference: string): string {
  const normalizedReference = reference.trim();
  if (!normalizedReference) return '';

  const lines = context.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === normalizedReference || trimmed.startsWith(`${normalizedReference} `);
  });
  if (start < 0) return '';

  const end = lines.findIndex((line, index) => index > start && /^\[ATLAS-\d+\](?:\s|$)/.test(line.trim()));
  const block = lines.slice(start, end < 0 ? lines.length : end);
  const authorityIndex = block.findIndex((line) => /^Authority:\s*/i.test(line.trim()));
  return authorityIndex >= 0 ? block.slice(authorityIndex + 1).join('\n') : '';
}

function targetIndustries(atlas: LeadAtlasContextBundle): string[] {
  const sources = atlas.idealClientProfile.sources ?? [];
  const industrySources = sources.filter((source) => {
    const headings = source.citation.headingPath;
    return Array.isArray(headings)
      && headings.some((heading) => /^(target\s+)?industries$/i.test(heading.trim()));
  });

  if (industrySources.length > 0) {
    const industries = industrySources.flatMap((source) =>
      bulletsFromText(atlasReferenceSection(atlas.idealClientProfile.context, source.reference)),
    );
    if (industries.length > 0) return [...new Set(industries)];
  }

  const legacyMatch = atlas.idealClientProfile.context.match(LEGACY_INDUSTRY_SECTION);
  if (!legacyMatch?.[1]) {
    throw new Error('Atlas Ideal Client Profile did not provide a Target Industries or Industries section.');
  }
  const industries = bulletsFromText(legacyMatch[1]);
  if (industries.length === 0) throw new Error('Atlas Ideal Client Profile did not provide target industries.');
  return [...new Set(industries)];
}

function corpus(input: LeadResearchQualificationEvidenceInput): string {
  return [input.companyName, ...input.publicWebResults.flatMap((result) => [result.title, result.content])].filter(Boolean).join(' ').toLowerCase();
}

export function createLeadResearchQualificationEvidenceService() {
  return {
    build(input: LeadResearchQualificationEvidenceInput): LeadResearchQualificationAssessments {
      if (!input.companyName.trim()) throw new Error('companyName is required.');
      if (!/^https?:\/\//i.test(input.officialWebsiteUrl)) throw new Error('officialWebsiteUrl must be an HTTP(S) URL.');
      const references = evidenceReferences(input.publicWebResults);
      const text = corpus(input);
      const industries = targetIndustries(input.atlas);
      const matchedIndustry = industries.find((industry) => text.includes(industry.toLowerCase()));

      const businessFit = matchedIndustry && references.length > 0
        ? {
            score: null,
            evidenceReferences: references,
            missingInformation: [
              `Atlas target-industry evidence found (${matchedIndustry}), but Atlas does not define a deterministic numeric Business Fit score for industry match alone. Human-supervised or Atlas-constrained interpretation is required.`,
            ],
          }
        : emptyAssessment('Target-industry or broader Ideal Client Profile fit is not yet evidenced.');

      const assessments: LeadResearchQualificationAssessments = {
        businessFit,
        projectFit: emptyAssessment('No requested project or service requirement has been evidenced yet.'),
        partnershipPotential: emptyAssessment('Long-term partnership, maintenance, growth, or automation potential requires further evidence.'),
        decisionMakerAccess: emptyAssessment('A decision-maker and their authority have not yet been verified.'),
        commercialFit: emptyAssessment('Budget, project value, payment reliability, and profitability are not yet evidenced.'),
        timeline: emptyAssessment('Deadline, urgency, responsiveness, and resource timing are not yet evidenced.'),
      };

      for (const category of CATEGORIES) {
        if (!assessments[category]) throw new Error(`Qualification assessment builder omitted category: ${category}.`);
      }
      return assessments;
    },
  };
}

export type LeadResearchQualificationEvidenceService = ReturnType<typeof createLeadResearchQualificationEvidenceService>;
