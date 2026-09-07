import type { OperationalRepository, LeadRecord } from '../data/operational-repository.js';
import type { TransactionRunner } from '../data/transaction.js';
import type { PublicWebSearchResult } from '../integrations/public-web-research-integration.js';

export interface EnrichDiscoveredLeadInput {
  leadId: string;
  companyName: string;
  officialWebsiteUrl?: string | null;
  supportingResults: PublicWebSearchResult[];
  actorId?: string;
}

const BLOCKED_THIRD_PARTY_DOMAINS = new Set([
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'rocketreach.co', 'zoominfo.com', 'crunchbase.com', 'opencorporates.com',
  'yellowpages.com', 'yelp.com', 'mapquest.com',
]);

const NON_IDENTITY_DOMAIN_MARKERS = new Set([
  'directory', 'directories', 'listing', 'listings', 'jobs', 'job', 'careers',
  'career', 'recruitment', 'recruiting', 'vacancies', 'vacancy', 'hire',
  'association', 'associations', 'chamber', 'portal', 'portals', 'marketplace',
  'companies',
]);

const NON_IDENTITY_NAME_TOKENS = new Set([
  'pty', 'ltd', 'limited', 'company', 'companies', 'inc', 'incorporated', 'the',
  'home', 'contact', 'about', 'official', 'website', 'group', 'holdings',
  'construction', 'constructors', 'contractor', 'contractors', 'building', 'builders',
  'engineering', 'engineer', 'engineers', 'projects', 'project', 'civils', 'civil',
  'consulting', 'consultants', 'services', 'solutions', 'systems', 'africa', 'south',
  'north', 'gauteng', 'cape', 'town',
]);

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

const GOOGLE_PLACE_ID_PATTERN = /^ChIJ[A-Za-z0-9_-]{10,}$/i;

function requireUsableCompanyName(value: string, field: string): string {
  const companyName = requireText(value, field);
  if (GOOGLE_PLACE_ID_PATTERN.test(companyName) || /^Google Place(?:\s+\w+)?$/i.test(companyName)) {
    throw new Error(`${field} must be a usable business name and cannot be a provider-generated place identity.`);
  }
  return companyName;
}

function normalizeWebsite(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('officialWebsiteUrl must be a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('officialWebsiteUrl must use http or https.');
  url.hash = '';
  return url.toString();
}

function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const secondLevelTlds = new Set(['co.za', 'org.za', 'net.za', 'com.au', 'co.uk', 'org.uk']);
  const suffix = labels.slice(-2).join('.');
  return secondLevelTlds.has(suffix) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
}

function mergeSpacedAcronyms(value: string): string {
  return value.replace(/\b(?:[A-Z]\s+){1,}[A-Z]\b/g, (match) => match.replace(/\s+/g, ''));
}

function extractAcronymTokens(value: string): string[] {
  const merged = mergeSpacedAcronyms(value);
  const matches = merged.match(/\b[A-Z]{2,6}\b/g) ?? [];
  return matches.map((token) => token.toLowerCase());
}

function normalizedTokens(value: string): string[] {
  const acronymTokens = extractAcronymTokens(value);
  const wordTokens = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !NON_IDENTITY_NAME_TOKENS.has(token));
  return [...new Set([...acronymTokens, ...wordTokens])];
}

function domainTokens(domain: string): string[] {
  return normalizedTokens(domain.split('.').slice(0, -1).join(' '));
}

function containsAllTokens(searchable: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const searchableTokens = new Set(normalizedTokens(searchable));
  const matched = tokens.filter((token) => searchableTokens.has(token)).length;
  const required = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);
  return matched >= required;
}

function domainHasNonIdentityMarker(domain: string): boolean {
  return domainTokens(domain).some((token) =>
    [...NON_IDENTITY_DOMAIN_MARKERS].some((marker) => token === marker || token.endsWith(marker)),
  );
}

function domainSupportsCompanyIdentity(websiteUrl: string, companyName: string, results: PublicWebSearchResult[]): boolean {
  let url: URL;
  try { url = new URL(websiteUrl); } catch { return false; }
  const domain = registrableDomain(url.hostname);
  if (BLOCKED_THIRD_PARTY_DOMAINS.has(domain)) return false;
  if (domainHasNonIdentityMarker(domain)) return false;

  const companyTokens = normalizedTokens(companyName);
  if (companyTokens.length === 0) return false;

  const domainTokensForIdentity = domainTokens(domain);
  if (!companyTokens.some((token) => domainTokensForIdentity.includes(token))) return false;

  const domainResults = results.filter((result) => {
    try { return registrableDomain(new URL(result.url).hostname) === domain; } catch { return false; }
  });

  return domainResults.some((result) => containsAllTokens(`${result.title} ${result.content}`, companyTokens));
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const NON_CONTACT_EMAIL_LOCALS = new Set(['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster']);
const PREFERRED_CONTACT_EMAIL_LOCALS = ['contact', 'info', 'hello', 'sales', 'enquiries', 'enquiry', 'office', 'admin'];

function discoverPublicBusinessEmail(results: PublicWebSearchResult[], officialWebsiteUrl: string): { email: string; evidenceReferences: string[] } | null {
  const officialDomain = registrableDomain(new URL(officialWebsiteUrl).hostname);
  const candidates = new Map<string, { email: string; evidenceReferences: string[] }>();

  for (const result of results) {
    let resultDomain: string;
    try { resultDomain = registrableDomain(new URL(result.url).hostname); } catch { continue; }
    if (resultDomain !== officialDomain) continue;

    const text = `${result.title}\n${result.content}`;
    for (const match of text.matchAll(EMAIL_PATTERN)) {
      const email = match[0].trim().toLowerCase().replace(/[.,;:)\]}]+$/, '');
      const at = email.lastIndexOf('@');
      if (at <= 0 || at === email.length - 1) continue;
      const local = email.slice(0, at);
      const domain = registrableDomain(email.slice(at + 1));
      if (domain !== officialDomain || NON_CONTACT_EMAIL_LOCALS.has(local)) continue;
      const existing = candidates.get(email) ?? { email, evidenceReferences: [] };
      const evidenceReference = `public-web:${result.url}`;
      if (!existing.evidenceReferences.includes(evidenceReference)) existing.evidenceReferences.push(evidenceReference);
      candidates.set(email, existing);
    }
  }

  if (candidates.size === 0) return null;
  const ranked = [...candidates.values()].sort((a, b) => {
    const aLocal = a.email.slice(0, a.email.indexOf('@'));
    const bLocal = b.email.slice(0, b.email.indexOf('@'));
    const aRank = PREFERRED_CONTACT_EMAIL_LOCALS.indexOf(aLocal);
    const bRank = PREFERRED_CONTACT_EMAIL_LOCALS.indexOf(bLocal);
    const normalizedARank = aRank === -1 ? PREFERRED_CONTACT_EMAIL_LOCALS.length : aRank;
    const normalizedBRank = bRank === -1 ? PREFERRED_CONTACT_EMAIL_LOCALS.length : bRank;
    if (normalizedARank !== normalizedBRank) return normalizedARank - normalizedBRank;
    if (a.email !== b.email) return a.email.localeCompare(b.email);
    return b.evidenceReferences.length - a.evidenceReferences.length;
  });
  return ranked[0] ?? null;
}

function googleIdentity(lead: LeadRecord): { providerPlaceId: string; evidenceReference: string } | null {
  if (lead.source !== 'google_places' || !Array.isArray(lead.evidence)) return null;
  for (const item of lead.evidence) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.provider === 'google_places' && typeof row.providerPlaceId === 'string' && typeof row.evidenceReference === 'string') {
      return { providerPlaceId: row.providerPlaceId, evidenceReference: row.evidenceReference };
    }
  }
  return null;
}

export function createLeadPublicWebEnrichmentService(repository: OperationalRepository, runInTransaction: TransactionRunner) {
  return {
    async enrich(input: EnrichDiscoveredLeadInput): Promise<LeadRecord> {
      const leadId = requireText(input.leadId, 'leadId');
      requireUsableCompanyName(input.companyName, 'companyName');
      const officialWebsiteUrl = input.officialWebsiteUrl ? normalizeWebsite(input.officialWebsiteUrl) : null;
      const actorId = requireText(input.actorId ?? 'lead_agent', 'actorId');
      if (input.supportingResults.length === 0) throw new Error('At least one public-web supporting result is required.');

      let matching: PublicWebSearchResult[] = [];
      if (officialWebsiteUrl) {
        matching = input.supportingResults.filter((result) => {
          try { return registrableDomain(new URL(result.url).hostname) === registrableDomain(new URL(officialWebsiteUrl).hostname); } catch { return false; }
        });
        if (matching.length === 0) throw new Error('Official website must be supported by public-web research evidence.');
      }

      return runInTransaction(async (tx) => {
        const lead = await tx.getLeadById(leadId);
        if (!lead) throw new Error(`Lead ${leadId} was not found.`);
        const identity = googleIdentity(lead);
        if (!identity) throw new Error('Lead is not an eligible Google Places discovery record.');
        if (lead.enrichmentStatus !== 'pending') {
          throw new Error(`Lead ${leadId} enrichment_status is '${lead.enrichmentStatus}' and requires an explicit requeue before enrichment.`);
        }
        requireUsableCompanyName(lead.companyName, 'lead.companyName');

        const websiteVerified = Boolean(officialWebsiteUrl && domainSupportsCompanyIdentity(officialWebsiteUrl, lead.companyName, matching));
        const verifiedWebsiteUrl = websiteVerified ? officialWebsiteUrl : null;
        // Email discovery only needs a candidate domain with matching on-domain evidence
        // (already enforced above when officialWebsiteUrl is present) — it shouldn't be
        // blocked just because the stricter identity-matching heuristic for the website
        // itself didn't clear its bar.
        const discoveredEmail = officialWebsiteUrl ? discoverPublicBusinessEmail(matching, officialWebsiteUrl) : null;
        const enrichmentStatus = verifiedWebsiteUrl ? 'verified' : 'not_found';
        const evidence = [
          ...(Array.isArray(lead.evidence) ? lead.evidence : []),
          {
            kind: 'public_web_enrichment',
            provider: 'tavily',
            websiteVerificationStatus: enrichmentStatus,
            ...(verifiedWebsiteUrl ? { officialWebsiteUrl: verifiedWebsiteUrl } : {}),
            ...(discoveredEmail ? { contactEmailDiscoveryStatus: 'verified', contactEmail: discoveredEmail.email, contactEmailEvidenceReferences: discoveredEmail.evidenceReferences } : { contactEmailDiscoveryStatus: 'not_found' }),
            evidenceReferences: input.supportingResults.map((result) => `public-web:${result.url}`),
          },
        ];
        const enriched = await tx.enrichLead(lead.id, 'pending', {
          companyName: lead.companyName,
          contactName: lead.contactName ?? undefined,
          contactEmail: discoveredEmail?.email ?? lead.contactEmail ?? undefined,
          opportunitySummary: verifiedWebsiteUrl
            ? `Official website independently identified: ${verifiedWebsiteUrl}`
            : 'Business identity independently identified; no official website was verified in public-web research. Website opportunity should be assessed during human review.',
          evidence,
        }, enrichmentStatus);
        if (!enriched) throw new Error('Lead enrichment lost its optimistic-concurrency check.');

        await tx.createWorkflowEvent({
          eventType: verifiedWebsiteUrl ? 'lead_enriched_from_public_web' : 'lead_enriched_without_verified_website',
          actorType: 'agent',
          actorId,
          payload: {
            leadId: enriched.id,
            providerPlaceId: identity.providerPlaceId,
            ...(verifiedWebsiteUrl ? { officialWebsiteUrl: verifiedWebsiteUrl } : {}),
            ...(discoveredEmail ? { contactEmail: discoveredEmail.email, contactEmailEvidenceReferences: discoveredEmail.evidenceReferences, contactEmailDiscoveryStatus: 'verified' } : { contactEmailDiscoveryStatus: 'not_found' }),
            websiteVerificationStatus: enrichmentStatus,
            enrichmentStatus,
            evidenceReferences: input.supportingResults.map((result) => `public-web:${result.url}`),
          },
        });
        return enriched;
      });
    },
  };
}

export type LeadPublicWebEnrichmentService = ReturnType<typeof createLeadPublicWebEnrichmentService>;
