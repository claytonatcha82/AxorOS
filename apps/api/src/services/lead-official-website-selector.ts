import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';

export interface OfficialWebsiteSelectionInput {
  businessName: string;
  results: PublicWebSearchResult[];
}

export type OfficialWebsiteSelection =
  | { status: 'selected'; websiteUrl: string; companyName: string; evidence: PublicWebSearchResult[] }
  | { status: 'ambiguous'; candidateUrls: string[] }
  | { status: 'not_found'; candidateUrls: [] };

const THIRD_PARTY_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com', 'youtube.com',
  'google.com', 'google.co.za', 'yelp.com', 'tripadvisor.com', 'yellowpages.co.za',
];

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length >= 3);
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

export function selectOfficialWebsite(input: OfficialWebsiteSelectionInput): OfficialWebsiteSelection {
  const businessName = input.businessName.trim();
  if (!businessName) throw new Error('businessName is required.');
  const words = normalizedWords(businessName);
  if (words.length === 0) return { status: 'not_found', candidateUrls: [] };

  const byOrigin = new Map<string, { score: number; evidence: PublicWebSearchResult[] }>();
  for (const result of input.results) {
    const candidate = registrableCandidate(result);
    if (!candidate) continue;
    const haystack = `${result.title} ${candidate.hostname}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const matched = words.filter((word) => haystack.includes(word));
    if (matched.length === 0) continue;
    const titleWords = normalizedWords(result.title);
    const titleMatches = words.filter((word) => titleWords.includes(word)).length;
    const hostMatches = words.filter((word) => candidate.hostname.replace(/[^a-z0-9]+/g, ' ').includes(word)).length;
    const score = matched.length + titleMatches + (hostMatches * 2);
    const current = byOrigin.get(candidate.origin) ?? { score: 0, evidence: [] };
    current.score = Math.max(current.score, score);
    current.evidence.push(result);
    byOrigin.set(candidate.origin, current);
  }

  const ranked = [...byOrigin.entries()].sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0) return { status: 'not_found', candidateUrls: [] };
  const [bestOrigin, best] = ranked[0]!;
  const second = ranked[1];
  if (best.score < 4 || (second && second[1].score >= best.score)) {
    return { status: 'ambiguous', candidateUrls: ranked.map(([origin]) => origin) };
  }
  const companyName = independentlySourcedCompanyName(best.evidence);
  if (!companyName) return { status: 'ambiguous', candidateUrls: ranked.map(([origin]) => origin) };
  return { status: 'selected', websiteUrl: bestOrigin, companyName, evidence: best.evidence };
}
