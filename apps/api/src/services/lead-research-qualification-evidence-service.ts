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

const PROJECT_PATTERNS = [
  /website/i, /web\s+design/i, /web\s+development/i, /e[-\s]?commerce/i,
  /digital/i, /online\s+(?:presence|platform|store)/i, /branding/i,
  /automation/i, /software/i, /portal/i,
];
const PROJECT_DEFICIENCY_PATTERNS = [
  /no\s+website/i, /without\s+(?:a\s+)?website/i, /outdated\s+website/i,
  /poor\s+(?:website|mobile|online)/i, /slow\s+(?:website|site|loading)/i,
  /weak\s+(?:branding|online\s+presence|search\s+visibility)/i,
];
const PARTNERSHIP_PATTERNS = [
  /growth/i, /expanding|expansion/i, /new\s+market/i, /maintenance/i,
  /ongoing\s+(?:support|service|services|management)/i, /retainer/i,
  /automation/i, /digital\s+transformation/i, /multiple\s+(?:locations|branches)/i,
];
const DECISION_MAKER_PATTERNS = [
  /\b(?:owner|founder|ceo|chief\s+executive|managing\s+director|director|principal|general\s+manager)\b/i,
];
const COMMERCIAL_PATTERNS = [
  /\b(?:budget|pricing|price|quote|quotation|tender|procurement|rfq|request\s+for\s+quotation)\b/i,
  /\b(?:project|contract|clients?|customers?|services?|products?)\b/i,
  /\b(?:revenue|turnover|contract\s+value|project\s+value|payment\s+terms)\b/i,
  /\b(?:established|operating|operations|head\s+office|branches?)\b/i,
];
const URGENT_TIMELINE_PATTERNS = [
  /\b(?:deadline|launch\s+date|delivery\s+date|project\s+date|completion\s+date)\b/i,
  /\b(?:urgent|urgently|immediate|asap|this\s+month|next\s+month)\b/i,
  /\b(?:tender|rfq)\b[\s\S]{0,80}\b(?:closing|closes|closing\s+date)\b/i,
];
const CURRENT_ACTIVITY_PATTERNS = [
  /current|ongoing|launch|expanding|expansion|new\s+market|tender|rfq|project|contract/i,
];

function assessment(score: number | null, references: string[], missingInformation: string[] = []): QualificationCategoryAssessment {
  return { score, evidenceReferences: [...new Set(references)], missingInformation: [...new Set(missingInformation)] };
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
    return Array.isArray(headings) && headings.some((heading) => /^(target\s+)?industries$/i.test(heading.trim()));
  });
  if (industrySources.length > 0) {
    const industries = industrySources.flatMap((source) => bulletsFromText(atlasReferenceSection(atlas.idealClientProfile.context, source.reference)));
    if (industries.length > 0) return [...new Set(industries)];
  }
  const legacyMatch = atlas.idealClientProfile.context.match(LEGACY_INDUSTRY_SECTION);
  if (!legacyMatch?.[1]) throw new Error('Atlas Ideal Client Profile did not provide a Target Industries or Industries section.');
  const industries = bulletsFromText(legacyMatch[1]);
  if (industries.length === 0) throw new Error('Atlas Ideal Client Profile did not provide target industries.');
  return [...new Set(industries)];
}

function corpus(input: LeadResearchQualificationEvidenceInput): string {
  return [input.companyName, ...input.publicWebResults.flatMap((result) => [result.title, result.content])].filter(Boolean).join(' ');
}

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchingResults(results: PublicWebSearchResult[], patterns: RegExp[]): PublicWebSearchResult[] {
  return results.filter((result) => matches([result.title, result.content].filter(Boolean).join(' '), patterns));
}

function businessFitAssessment(input: LeadResearchQualificationEvidenceInput, text: string, industries: string[]): QualificationCategoryAssessment {
  const lower = text.toLowerCase();
  const matchedIndustry = industries.find((industry) => lower.includes(industry.toLowerCase()));
  if (!matchedIndustry) {
    return assessment(null, [], ['Target-industry or broader Ideal Client Profile fit is not yet evidenced.']);
  }
  const references = evidenceReferences(input.publicWebResults.filter((result) => [result.title, result.content].filter(Boolean).join(' ').toLowerCase().includes(matchedIndustry.toLowerCase())));
  if (references.length === 0) return assessment(null, [], ['Target-industry match could not be tied to public evidence.']);

  const positiveSignals = [
    /established|growing|growth|expanding|expansion|digital\s+transformation/i,
    /\b(?:5|[1-9]\d|1\d\d|2[0-4]\d|250)\s*(?:employees?|staff|people)\b/i,
    /customers?|clients?|projects?|branches?|locations?|operations?/i,
    /modernis|technology|digital|online|brand|market/i,
  ].filter((pattern) => pattern.test(text)).length;

  const score = positiveSignals >= 3 ? 10 : positiveSignals >= 2 ? 8 : positiveSignals >= 1 ? 6 : 5;
  return assessment(score, references, positiveSignals < 2 ? ['Additional ICP characteristics are not fully evidenced.'] : []);
}

function projectFitAssessment(input: LeadResearchQualificationEvidenceInput, text: string, businessFit: QualificationCategoryAssessment): QualificationCategoryAssessment {
  const references = evidenceReferences(input.publicWebResults);
  const deficiencyResults = matchingResults(input.publicWebResults, PROJECT_DEFICIENCY_PATTERNS);
  const projectResults = matchingResults(input.publicWebResults, PROJECT_PATTERNS);

  if (input.officialWebsiteUrl === null && businessFit.score !== null && businessFit.score >= 6) {
    return assessment(8, references.length > 0 ? references : businessFit.evidenceReferences, ['No verified official website was found during research; this is treated as a website opportunity signal, not a failed lead.']);
  }
  if (deficiencyResults.length > 0) {
    return assessment(8, evidenceReferences(deficiencyResults), []);
  }
  if (projectResults.length >= 2) {
    return assessment(7, evidenceReferences(projectResults), ['The business has digital relevance, but a specific active project requirement is not publicly confirmed.']);
  }
  if (projectResults.length === 1) {
    return assessment(6, evidenceReferences(projectResults), ['The agency-service connection is evidenced, but the specific project need is not confirmed.']);
  }
  return assessment(null, [], ['No meaningful website, digital, branding, automation, or related agency opportunity is currently evidenced.']);
}

function partnershipAssessment(input: LeadResearchQualificationEvidenceInput, text: string): QualificationCategoryAssessment {
  const matching = matchingResults(input.publicWebResults, PARTNERSHIP_PATTERNS);
  const references = evidenceReferences(matching);
  if (matching.length >= 3) return assessment(10, references);
  if (matching.length >= 2) return assessment(8, references);
  if (matching.length === 1) return assessment(6, references, ['Only one clear long-term or growth signal is evidenced.']);
  if (/services?|products?|customers?|clients?|projects?|operations?/i.test(text)) {
    return assessment(4, evidenceReferences(input.publicWebResults), ['Long-term partnership potential is plausible but not specifically evidenced.']);
  }
  return assessment(null, [], ['No meaningful growth, recurring service, or long-term partnership signal is currently evidenced.']);
}

function decisionMakerAssessment(input: LeadResearchQualificationEvidenceInput): QualificationCategoryAssessment {
  const matching = matchingResults(input.publicWebResults, DECISION_MAKER_PATTERNS);
  const references = evidenceReferences(matching);
  if (matching.length > 0 && input.publicWebResults.length > 0) return assessment(8, references, ['Direct procurement authority is not independently verified.']);
  if (input.publicWebResults.length > 0) return assessment(4, evidenceReferences(input.publicWebResults), ['Decision-maker identity and authority remain unverified.']);
  return assessment(null, [], ['No public decision-maker or credible business contact evidence is available.']);
}

function commercialAssessment(input: LeadResearchQualificationEvidenceInput, text: string): QualificationCategoryAssessment {
  const matching = matchingResults(input.publicWebResults, COMMERCIAL_PATTERNS);
  const references = evidenceReferences(matching);
  const strong = matchingResults(input.publicWebResults, [/\b(?:budget|tender|rfq|procurement|revenue|turnover|contract\s+value|project\s+value)\b/i]);
  if (strong.length >= 2) return assessment(8, evidenceReferences(strong));
  if (strong.length === 1) return assessment(7, evidenceReferences(strong), ['Budget, value, or payment reliability is not fully verified.']);
  if (matching.length >= 2) return assessment(6, references, ['Budget, project value, and payment reliability remain unverified.']);
  if (matching.length === 1) return assessment(4, references, ['Commercial capacity is only partially evidenced.']);
  return assessment(null, [], ['No meaningful commercial capacity or project-value evidence is currently available.']);
}

function timelineAssessment(input: LeadResearchQualificationEvidenceInput, text: string, projectFit: QualificationCategoryAssessment): QualificationCategoryAssessment {
  const urgent = matchingResults(input.publicWebResults, URGENT_TIMELINE_PATTERNS);
  if (urgent.length > 0) return assessment(10, evidenceReferences(urgent));
  const current = matchingResults(input.publicWebResults, CURRENT_ACTIVITY_PATTERNS);
  if (current.length >= 2) return assessment(7, evidenceReferences(current), ['An exact project deadline is not publicly established.']);
  if (current.length === 1) return assessment(6, evidenceReferences(current), ['An exact project deadline is not publicly established.']);
  if (projectFit.score !== null) return assessment(4, projectFit.evidenceReferences, ['Actionable timing is unknown; this score reflects a plausible opportunity rather than confirmed urgency.']);
  return assessment(null, [], ['No meaningful timeline or current activity evidence is available.']);
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
      const businessFit = businessFitAssessment(input, text, industries);
      const projectFit = projectFitAssessment(input, text, businessFit);
      const assessments: LeadResearchQualificationAssessments = {
        businessFit,
        projectFit,
        partnershipPotential: partnershipAssessment(input, text),
        decisionMakerAccess: decisionMakerAssessment(input),
        commercialFit: commercialAssessment(input, text),
        timeline: timelineAssessment(input, text, projectFit),
      };

      for (const category of CATEGORIES) {
        if (!assessments[category]) throw new Error(`Qualification assessment builder omitted category: ${category}.`);
      }
      return assessments;
    },
  };
}

export type LeadResearchQualificationEvidenceService = ReturnType<typeof createLeadResearchQualificationEvidenceService>;
