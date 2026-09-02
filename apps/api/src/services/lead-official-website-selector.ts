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

// Hosts that are useful as research sources but must never be promoted to an
// official business website. Keep this list focused on platforms whose primary
// purpose is hosting listings, maps, social profiles, or third-party directories.
const THIRD_PARTY_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com', 'youtube.com',
  'google.com', 'google.co.za', 'yelp.com', 'tripadvisor.com', 'yellowpages.co.za',
  'waze.com', 'rsa.worldorgs.com', 'goafricaonline.com', 'cylex.net.za',
  'africabizinfo.com', 'dnb.com', 'zoominfo.com', 'crunchbase.com', 'mapquest.com',
  'foursquare.com', 'hotfrog.com', 'kompass.com', 'zaubee.com', 'snupit.co.za',
  'sanha.org.za',
];

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length >= 3);
}

const LOCATION_STOP_WORDS = new Set([
  'south', 'africa', 'street', 'road', 'avenue', 'drive', 'lane', 'highway', 'route',
  'building', 'floor', 'unit', 'postal', 'code',
]);

function locationWords(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(normalizedWords(value).filter((word) => !LOCATION_STOP_WORDS.has(word)))];
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

function hasStrongNameIdentity(businessWords: string[], result: PublicWebSearchResult, hostname: string): boolean {
  const titleWords = normalizedWords(result.title);
  const contentWords = normalizedWords(result.content);
  const titleMatches = businessWords.filter((word) => titleWords.includes(word)).length;
  const contentMatches = businessWords.filter((word) => contentWords.includes(word)).length;
  const hostMatches = businessWords.filter((word) => hostname.replace(/[^a-z0-9]+/g, ' ').includes(word)).length;

  // A domain containing the business identity is useful evidence, but it is not
  // mandatory: legitimate businesses can operate under a brand/domain that does
  // not contain their legal name. In that case require stronger first-party text.
  if (hostMatches >= 1 && titleMatches >= 1) return true;
  return titleMatches === businessWords.length && contentMatches >= Math.min(2, businessWords.length);
}

export function selectOfficialWebsite(input: OfficialWebsiteSelectionInput): OfficialWebsiteSelection {
  const businessName = input.businessName.trim();
  if (!businessName) throw new Error('businessName is required.');
  const words = normalizedWords(businessName);
  if (words.length === 0) return { status: 'not_found', candidateUrls: [] };
  const knownLocationWords = locationWords(input.formattedAddress);

  const byOrigin = new Map<string, { identityScore: number; locationScore: number; evidence: PublicWebSearchResult[] }>();
  for (const result of input.results) {
    const candidate = registrableCandidate(result);
    if (!candidate) continue;
    if (!hasStrongNameIdentity(words, result, candidate.hostname)) continue;

    const haystack = `${result.title} ${candidate.hostname}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const matched = words.filter((word) => haystack.includes(word));
    const titleWords = normalizedWords(result.title);
    const titleMatches = words.filter((word) => titleWords.includes(word)).length;
    const hostMatches = words.filter((word) => candidate.hostname.replace(/[^a-z0-9]+/g, ' ').includes(word)).length;
    const contentWords = normalizedWords(result.content);
    const contentMatches = words.filter((word) => contentWords.includes(word)).length;
    const identityScore = matched.length + titleMatches + (hostMatches * 2) + contentMatches;
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
