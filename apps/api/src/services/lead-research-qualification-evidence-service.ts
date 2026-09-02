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
const SENIOR_ROLE_PATTERNS = [
  /\b(?:owner|founder|ceo|chief\s+executive|managing\s+director|director|principal|general\s+manager|marketing\s+manager|operations\s+manager|practice\s+manager)\b/i,
];
const NAMED_PERSON_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g;
const DIRECT_CONTACT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:direct|personal)\s+(?:email|phone|line)\b/i,
  /\b(?:mobile|cell)\s*(?:number|phone|tel|telephone)?\s*[:\-]?\s*\+?\d[\d\s().-]{6,}\b/i,
];
const BUSINESS_CONTACT_PATTERNS = [
  /\b(?:email|e-mail|phone|telephone|tel|contact|call|enquir(?:y|ies)|inquiries)\b/i,
  /\bcontact\s+(?:us|our|the)\b/i,
];
const STRONG_COMMERCIAL_PATTERNS = [
  /\b(?:budget|tender|procurement|rfq|request\s+for\s+quotation|revenue|turnover|contract\s+value|project\s+value|payment\s+terms)\b/i,
];
const ESTABLISHED_OPERATION_PATTERNS = [
  /\bestablished\b/i, /\boperating\b/i, /\boperations\b/i, /\bhead\s+office\b/i,
  /\bbranches?\b/i, /\bmultiple\s+(?:locations|sites)\b/i, /\bemployees?\b/i,
];
const COMMERCIAL_SUITABILITY_PATTERNS = [
  /\b(?:commercial|contract|contracts|projects?|clients?|customers?|suppliers?|procurement|tender)\b/i,
];
const URGENT_TIMELINE_PATTERNS = [
  /\b(?:urgent|urgently|immediate|asap)\b/i,
  /\b(?:deadline|closing\s+date|closing\s+deadline)\b[\s\S]{0,80}\b(?:today|tomorrow|this\s+(?:week|month)|by\s+\w+|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/i,
  /\b(?:tender|rfq)\b[\s\S]{0,80}\b(?:closing|closes|closing\s+date)\b/i,
];
const STRONG_NEAR_TERM_TIMELINE_PATTERNS = [
  /\b(?:launch\s+date|delivery\s+date|project\s+date|completion\s+date)\b/i,
  /\b(?:this\s+(?:month|quarter|year)|next\s+(?:month|quarter))\b/i,
  /\b(?:launch(?:ing)?|underway|in\s+progress|ongoing)\b/i,
];
const CURRENT_TIMELINE_PATTERNS = [
  /\b(?:currently|current|active)\b/i,
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
  if (!matchedIndustry) return assessment(null, [], ['Target-industry or broader Ideal Client Profile fit is not yet evidenced.']);
  const references = evidenceReferences(input.publicWebResults.filter((result) => [result.title, result.content].filter(Boolean).join(' ').toLowerCase().includes(matchedIndustry.toLowerCase())));
  if (references.length === 0) return assessment(null, [], ['Target-industry match could not be tied to public evidence.']);
  const positiveSignals = [
    /established|growing|growth|expanding|expansion|digital\s+transformation/i,
    /\b(?:5|[1-9]\d|1\d\d|2[0-4]\d|250)\s*(?:employees?|staff|people)\b/i,
    /customers?|clients?|projects?|branches?|locations?|operations?/i,
    /modernis|technology|digital|online|brand|market/i,
  ].filter((pattern) => pattern.test(text)).length;
  const score = positiveSignals >= 3 ? 10 : positiveSignals >= 2 ? 8 : positiveSignals >= 1 ? 6 : null;
  return assessment(score, references, score === null ? ['Additional ICP characteristics are not evidenced sufficiently for a numeric score.'] : score < 10 ? ['Some preferred ICP characteristics remain unverified.'] : []);
}

function projectFitAssessment(input: LeadResearchQualificationEvidenceInput, businessFit: QualificationCategoryAssessment): QualificationCategoryAssessment {
  const references = evidenceReferences(input.publicWebResults);
  const deficiencyResults = matchingResults(input.publicWebResults, PROJECT_DEFICIENCY_PATTERNS);
  const projectResults = matchingResults(input.publicWebResults, PROJECT_PATTERNS);
  if (input.officialWebsiteUrl === null && businessFit.score !== null && businessFit.score >= 6) {
    return assessment(8, references.length > 0 ? references : businessFit.evidenceReferences, ['No verified official website was found during research; this is treated as a website opportunity signal, not a failed lead.']);
  }
  if (deficiencyResults.length > 0) return assessment(8, evidenceReferences(deficiencyResults));
  if (projectResults.length >= 2) return assessment(7, evidenceReferences(projectResults), ['A specific active agency project is not publicly confirmed.']);
  if (projectResults.length === 1) return assessment(6, evidenceReferences(projectResults), ['The agency-service connection is evidenced, but the specific project need is not confirmed.']);
  return assessment(null, [], ['No meaningful website, digital, branding, automation, or related agency opportunity is currently evidenced.']);
}

function partnershipAssessment(input: LeadResearchQualificationEvidenceInput, text: string): QualificationCategoryAssessment {
  const matching = matchingResults(input.publicWebResults, PARTNERSHIP_PATTERNS);
  const references = evidenceReferences(matching);
  if (matching.length >= 3) return assessment(10, references);
  if (matching.length >= 2) return assessment(8, references);
  if (matching.length === 1) return assessment(6, references, ['Only one clear long-term or growth signal is evidenced.']);
  if (/\b(?:services?|products?|customers?|clients?|projects?|operations?)\b/i.test(text)) return assessment(4, evidenceReferences(input.publicWebResults), ['Long-term partnership potential is plausible but not specifically evidenced.']);
  return assessment(null, [], ['No meaningful growth, recurring service, or long-term partnership signal is currently evidenced.']);
}

function namedPersonNearRole(text: string): boolean {
  const roleMatches = [...text.matchAll(SENIOR_ROLE_PATTERNS[0]!)];
  if (roleMatches.length === 0) return false;
  const personMatches = [...text.matchAll(NAMED_PERSON_PATTERN)];
  return roleMatches.some((roleMatch) => personMatches.some((personMatch) => {
    if (personMatch.index === undefined || roleMatch.index === undefined) return false;
    const distance = Math.abs(personMatch.index - roleMatch.index);
    return distance <= 80;
  }));
}

function decisionMakerAssessment(input: LeadResearchQualificationEvidenceInput): QualificationCategoryAssessment {
  const roleResults = matchingResults(input.publicWebResults, SENIOR_ROLE_PATTERNS);
  const roleReferences = evidenceReferences(roleResults);
  const namedRoleResults = roleResults.filter((result) => namedPersonNearRole([result.title, result.content].filter(Boolean).join(' ')));
  const directContactResults = namedRoleResults.filter((result) => matches([result.title, result.content].filter(Boolean).join(' '), DIRECT_CONTACT_PATTERNS));
  const businessContactResults = input.publicWebResults.filter((result) => matches([result.title, result.content].filter(Boolean).join(' '), BUSINESS_CONTACT_PATTERNS));
  if (directContactResults.length > 0) return assessment(10, evidenceReferences(directContactResults), ['Decision-maker role, identity, and a direct contact route are evidenced; procurement authority is not assumed.']);
  if (namedRoleResults.length > 0 && businessContactResults.length > 0) return assessment(8, [...evidenceReferences(namedRoleResults), ...evidenceReferences(businessContactResults)], ['A credible business contact route exists, but a direct route to the named decision-maker is not confirmed.']);
  if (roleResults.length > 0) return assessment(6, roleReferences, ['A senior/relevant management role is identified, but named identity and/or direct access is incomplete.']);
  if (businessContactResults.length > 0) return assessment(4, evidenceReferences(businessContactResults), ['A relevant business contact route exists, but decision-maker authority is unverified.']);
  if (input.publicWebResults.length > 0) return assessment(2, evidenceReferences(input.publicWebResults), ['Only generic public evidence is available; no credible decision-maker route is established.']);
  return assessment(null, [], ['No public decision-maker or credible business contact evidence is available.']);
}

function commercialAssessment(input: LeadResearchQualificationEvidenceInput): QualificationCategoryAssessment {
  const strong = matchingResults(input.publicWebResults, STRONG_COMMERCIAL_PATTERNS);
  const operations = matchingResults(input.publicWebResults, ESTABLISHED_OPERATION_PATTERNS);
  const suitability = matchingResults(input.publicWebResults, COMMERCIAL_SUITABILITY_PATTERNS);
  if (strong.length >= 2) return assessment(8, evidenceReferences(strong), ['Low commercial risk and payment reliability are not independently verified.']);
  if (strong.length === 1) return assessment(7, evidenceReferences(strong), ['Budget/value capacity and payment reliability are only partly verified.']);
  if (operations.length >= 2 && suitability.length >= 1) return assessment(6, evidenceReferences([...operations, ...suitability]), ['Commercial capacity is reasonably indicated, but budget, project value, and payment reliability remain unverified.']);
  if (suitability.length >= 1) return assessment(4, evidenceReferences(suitability), ['Some commercial evidence exists, but capacity, budget/value, and payment reliability remain unknown.']);
  return assessment(null, [], ['No meaningful commercial capacity, value, budget, or payment evidence is currently available.']);
}

function timelineAssessment(input: LeadResearchQualificationEvidenceInput): QualificationCategoryAssessment {
  const urgent = matchingResults(input.publicWebResults, URGENT_TIMELINE_PATTERNS);
  if (urgent.length > 0) return assessment(10, evidenceReferences(urgent), ['The evidence indicates a current actionable deadline/urgency; exact delivery requirements remain subject to human confirmation.']);
  const nearTerm = matchingResults(input.publicWebResults, STRONG_NEAR_TERM_TIMELINE_PATTERNS);
  if (nearTerm.length > 0) return assessment(8, evidenceReferences(nearTerm), ['Near-term timing is evidenced, but clear urgency and an actionable current deadline are not fully established.']);
  const current = matchingResults(input.publicWebResults, CURRENT_TIMELINE_PATTERNS);
  if (current.length > 0) return assessment(6, evidenceReferences(current), ['Timing is indicated but exact timeframe, urgency, and actionability are incomplete.']);
  return assessment(null, [], ['No meaningful current, near-term, or deadline evidence is available; timing remains unverified.']);
}

export function createLeadResearchQualificationEvidenceService() {
  return {
    build(input: LeadResearchQualificationEvidenceInput): LeadResearchQualificationAssessments {
      if (!input.companyName.trim()) throw new Error('companyName is required.');
      if (input.officialWebsiteUrl !== null && input.officialWebsiteUrl !== undefined && !/^https?:\/\//i.test(input.officialWebsiteUrl)) throw new Error('officialWebsiteUrl must be an HTTP(S) URL when provided.');
      const text = corpus(input);
      const industries = targetIndustries(input.atlas);
      const businessFit = businessFitAssessment(input, text, industries);
      const projectFit = projectFitAssessment(input, businessFit);
      const assessments: LeadResearchQualificationAssessments = {
        businessFit,
        projectFit,
        partnershipPotential: partnershipAssessment(input, text),
        decisionMakerAccess: decisionMakerAssessment(input),
        commercialFit: commercialAssessment(input),
        timeline: timelineAssessment(input),
      };
      for (const category of CATEGORIES) if (!assessments[category]) throw new Error(`Qualification assessment builder omitted category: ${category}.`);
      return assessments;
    },
  };
}

export type LeadResearchQualificationEvidenceService = ReturnType<typeof createLeadResearchQualificationEvidenceService>;
