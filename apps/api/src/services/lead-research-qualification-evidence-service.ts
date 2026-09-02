import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';
import type { LeadAtlasContextBundle } from './lead-atlas-context-service.js';
import type { QualificationCategory, QualificationCategoryAssessment } from './lead-preliminary-qualification-service.js';

export interface LeadResearchQualificationEvidenceInput {
  atlas: LeadAtlasContextBundle;
  companyName: string;
  officialWebsiteUrl?: string | null;
  publicWebResults: PublicWebSearchResult[];
}

export type LeadResearchQualificationAssessments = Record<QualificationCategory, QualificationCategoryAssessment>;

const CATEGORIES: QualificationCategory[] = [
  'businessFit', 'projectFit', 'partnershipPotential', 'decisionMakerAccess', 'commercialFit', 'timeline',
];

const LEGACY_INDUSTRY_SECTION = /#\s+(?:Target\s+)?Industries([\s\S]*?)(?=\n#\s+|$)/i;
const BULLET = /^\s*-\s+(.+?)\s*$/gm;

const CATEGORY_EVIDENCE_PATTERNS: Record<Exclude<QualificationCategory, 'businessFit'>, RegExp[]> = {
  projectFit: [
    /web\s+design/i,
    /website\s+(?:design|development|redesign|build|project)/i,
    /web\s+development/i,
    /e[-\s]?commerce/i,
    /digital\s+(?:platform|transformation|presence|services?)/i,
    /online\s+(?:store|platform)/i,
    /branding/i,
  ],
  partnershipPotential: [
    /maintenance/i,
    /ongoing\s+(?:support|service|services|management)/i,
    /retainer/i,
    /long[-\s]?term/i,
    /monthly\s+(?:support|service|management)/i,
    /seo/i,
    /automation/i,
    /managed\s+services?/i,
  ],
  decisionMakerAccess: [
    /\b(?:owner|founder|ceo|chief\s+executive|managing\s+director|director|principal)\b/i,
    /\b(?:decision[-\s]?maker|management|leadership|executive)\b/i,
    /contact\s+(?:person|details|information)/i,
  ],
  commercialFit: [
    /\b(?:budget|pricing|price|quote|quotation|tender|procurement|rfq|request\s+for\s+quotation)\b/i,
    /\b(?:revenue|turnover|contract\s+value|project\s+value|payment\s+terms)\b/i,
  ],
  timeline: [
    /\b(?:deadline|launch\s+date|delivery\s+date|project\s+date|completion\s+date)\b/i,
    /\b(?:urgent|urgently|immediate|asap|this\s+month|next\s+month)\b/i,
    /\b(?:tender|rfq)\b[\s\S]{0,80}\b(?:closing|closes|closing\s+date)\b/i,
  ],
};

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

function resultMatches(result: PublicWebSearchResult, patterns: RegExp[]): boolean {
  const text = [result.title, result.content].filter(Boolean).join(' ');
  return patterns.some((pattern) => pattern.test(text));
}

function categoryEvidence(
  results: PublicWebSearchResult[],
  patterns: RegExp[],
  missing: string,
): QualificationCategoryAssessment {
  const matching = results.filter((result) => resultMatches(result, patterns));
  const references = evidenceReferences(matching);
  return references.length > 0
    ? {
        score: null,
        evidenceReferences: references,
        missingInformation: [
          missing,
          'Atlas does not provide a deterministic numeric scoring rule for this evidence alone; the Lead Agent must not manufacture a score.',
        ],
      }
    : emptyAssessment(missing);
}

function corpus(input: LeadResearchQualificationEvidenceInput): string {
  return [input.companyName, ...input.publicWebResults.flatMap((result) => [result.title, result.content])].filter(Boolean).join(' ').toLowerCase();
}

export function createLeadResearchQualificationEvidenceService() {
  return {
    build(input: LeadResearchQualificationEvidenceInput): LeadResearchQualificationAssessments {
      if (!input.companyName.trim()) throw new Error('companyName is required.');
      if (input.officialWebsiteUrl !== null && input.officialWebsiteUrl !== undefined && !/^https?:\/\//i.test(input.officialWebsiteUrl)) {
        throw new Error('officialWebsiteUrl must be an HTTP(S) URL when provided.');
      }
      const text = corpus(input);
      const industries = targetIndustries(input.atlas);
      const matchedIndustry = industries.find((industry) => text.includes(industry.toLowerCase()));
      const industryResults = input.publicWebResults.filter((result) => {
        const resultText = [result.title, result.content].filter(Boolean).join(' ').toLowerCase();
        return Boolean(matchedIndustry) && resultText.includes(matchedIndustry!.toLowerCase());
      });
      const businessReferences = evidenceReferences(industryResults);

      const businessFit: QualificationCategoryAssessment = matchedIndustry && businessReferences.length > 0
        ? {
            score: null,
            evidenceReferences: businessReferences,
            missingInformation: [
              `Atlas target-industry evidence found (${matchedIndustry}), but Atlas does not define a deterministic numeric Business Fit score for industry match alone. Human-supervised or Atlas-constrained interpretation is required.`,
            ],
          }
        : emptyAssessment('Target-industry or broader Ideal Client Profile fit is not yet evidenced.');

      const assessments: LeadResearchQualificationAssessments = {
        businessFit,
        projectFit: categoryEvidence(
          input.publicWebResults,
          CATEGORY_EVIDENCE_PATTERNS.projectFit,
          'A specific website, digital, branding, or other requested project/service requirement is not yet evidenced.',
        ),
        partnershipPotential: categoryEvidence(
          input.publicWebResults,
          CATEGORY_EVIDENCE_PATTERNS.partnershipPotential,
          'Ongoing maintenance, support, retainer, growth, or automation potential is not yet evidenced.',
        ),
        decisionMakerAccess: categoryEvidence(
          input.publicWebResults,
          CATEGORY_EVIDENCE_PATTERNS.decisionMakerAccess,
          'A specific decision-maker and their authority to procure services have not yet been verified.',
        ),
        commercialFit: categoryEvidence(
          input.publicWebResults,
          CATEGORY_EVIDENCE_PATTERNS.commercialFit,
          'Budget, project value, procurement conditions, payment reliability, and profitability are not yet evidenced.',
        ),
        timeline: categoryEvidence(
          input.publicWebResults,
          CATEGORY_EVIDENCE_PATTERNS.timeline,
          'A project deadline, urgency, or actionable timing requirement is not yet evidenced.',
        ),
      };

      for (const category of CATEGORIES) {
        if (!assessments[category]) throw new Error(`Qualification assessment builder omitted category: ${category}.`);
      }
      return assessments;
    },
  };
}

export type LeadResearchQualificationEvidenceService = ReturnType<typeof createLeadResearchQualificationEvidenceService>;
