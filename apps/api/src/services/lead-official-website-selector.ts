import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';

export interface OfficialWebsiteSelectionInput {
  businessName: string;
  formattedAddress?: string;
  results: PublicWebSearchResult[];
}

export type OfficialWebsiteSelection =
  | { status: 'selected'; websiteUrl: string; companyName: string; evidence: PublicWebSearchResult[] }
  | { status: 'ambiguous'; candidateUrls: string[] }
  | { status: 'not_found'; candidateUrls: [] };

// These domains are discovery platforms, social networks, maps, directories, or
// industry/listing portals. They may contain useful business evidence, but they
// are never acceptable as the business's official website.
const THIRD_PARTY_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com', 'youtube.com',
  'google.com', 'google.co.za', 'yelp.com', 'tripadvisor.com', 'yellowpages.co.za',
  'rsa.worldorgs.com', 'waze.com', 'goafricaonline.com', 'sanha.org.za',
  'cylex.net.za', 'africabizinfo.com', 'steel-technology.com',
  'hotfrog.com', 'zaubee.com', 'mapquest.com', 'manta.com',
];

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length >= 3);
}

const LOCATION_STOP_WORDS = new Set([
  'south', 'africa', 'street', 'road', 'avenue', 'drive', 'lane', 'highway', 'route',
  'building', 'floor', 'unit', 'postal', 'code',
]);

const LEGAL_NAME_STOP_WORDS = new Set([
  'pty', 'ltd', 'limited', 'inc', 'incorporated', 'cc', 'company', 'companies',
  'corporation', 'corp', 'llc', 'group', 'services', 'service', 'solutions',
  'solution', 'engineering', 'engineers', 'manufacturing', 'industries', 'industry',
]);

function locationWords(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(normalizedWords(value).filter((word) => !LOCATION_STOP_WORDS.has(word)))];
}

function businessIdentityWords(value: string): string[] {
  return [...new Set(normalizedWords(value).filter((word) => !LEGAL_NAME_STOP_WORDS.has(word)))];
}

function registrableCandidate(result: PublicWebSearchResult): { origin: string; hostname: string } | null {
  try {
    const url = new URL(result.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (THIRD_PARTY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
    return { origin: `${url.protocol}//${url.host}/`, hostname };
  } catch { return null; }
}

function independentlySourcedCompanyName(evidence: PublicWebSearchResult[]): string | null {
  const title = evidence[0]?.title.trim();
  if (!title) return null;
  const firstSegment = title.split(/\s[|–—]\s/)[0]?.trim();
  return firstSegment || title;
}

function firstPartyEvidenceScore(
  businessWords: string[],
  result: PublicWebSearchResult,
  hostname: string,
): number {
  const titleWords = normalizedWords(result.title);
  const contentWords = normalizedWords(result.content);
  const titleMatches = businessWords.filter((word) => titleWords.includes(word)).length;
  const contentMatches = businessWords.filter((word) => contentWords.includes(word)).length;
  const hostMatches = businessWords.filter((word) => hostname.replace(/[^a-z0-9]+/g, ' ').includes(word)).length;
  const content = result.content.toLowerCase();

  // A domain that contains the business identity is the strongest durable signal.
  if (hostMatches >= 1) return 4 + Math.min(3, titleMatches) + Math.min(2, contentMatches);

  // Do not promote arbitrary third-party pages simply because their search title
  // repeats the business name. A domain with no business identity must provide
  // several independent first-party signals before it can be considered official.
  const firstPartySignals = [
    /\babout (us|the company)\b/.test(content),
    /\bcontact (us|details)\b/.test(content),
    /\b(enquiries|inquiries)\b/.test(content),
    /\b\+?\d[\d\s().-]{6,}\b/.test(result.content),
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(result.content),
    contentMatches >= Math.min(2, businessWords.length),
  ].filter(Boolean).length;

  if (titleMatches === businessWords.length && firstPartySignals >= 3) {
    return 2 + firstPartySignals;
  }
  return 0;
}

export function selectOfficialWebsite(input: OfficialWebsiteSelectionInput): OfficialWebsiteSelection {
  const businessName = input.businessName.trim();
  if (!businessName) throw new Error('businessName is required.');
  const words = normalizedWords(businessName);
  if (words.length === 0) return { status: 'not_found', candidateUrls: [] };
  const identityWords = businessIdentityWords(businessName);
  const knownLocationWords = locationWords(input.formattedAddress);

  const byOrigin = new Map<string, { identityScore: number; locationScore: number; evidence: PublicWebSearchResult[] }>();
  for (const result of input.results) {
    const candidate = registrableCandidate(result);
    if (!candidate) continue;
    const identityScore = firstPartyEvidenceScore(identityWords.length > 0 ? identityWords : words, result, candidate.hostname);
    if (identityScore === 0) continue;

    const locationHaystack = `${result.title} ${result.content}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const locationScore = knownLocationWords.filter((word) => locationHaystack.includes(word)).length;
    const current = byOrigin.get(candidate.origin) ?? { identityScore: 0, locationScore: 0, evidence: [] };
    current.identityScore = Math.max(current.identityScore, identityScore);
    current.locationScore = Math.max(current.locationScore, locationScore);
    current.evidence.push(result);
    byOrigin.set(candidate.origin, current);
  }

  const ranked = [...byOrigin.entries()].sort((a, b) =>
    b[1].identityScore - a[1].identityScore
    || b[1].locationScore - a[1].locationScore
  );
  if (ranked.length === 0) return { status: 'not_found', candidateUrls: [] };
  const [bestOrigin, best] = ranked[0]!;
  const second = ranked[1];
  if (
    best.identityScore < 4
    || (
      second
      && second[1].identityScore === best.identityScore
      && second[1].locationScore >= best.locationScore
    )
  ) {
    return { status: 'ambiguous', candidateUrls: ranked.map(([origin]) => origin) };
  }
  const companyName = independentlySourcedCompanyName(best.evidence);
  if (!companyName) return { status: 'ambiguous', candidateUrls: ranked.map(([origin]) => origin) };
  return { status: 'selected', websiteUrl: bestOrigin, companyName, evidence: best.evidence };
}
