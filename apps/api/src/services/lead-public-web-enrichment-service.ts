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
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'rocketreach.co',
  'zoominfo.com',
  'crunchbase.com',
  'opencorporates.com',
  'yellowpages.com',
  'yelp.com',
  'mapquest.com',
]);

const NON_IDENTITY_DOMAIN_MARKERS = new Set([
  'directory',
  'directories',
  'listing',
  'listings',
  'jobs',
  'job',
  'careers',
  'career',
  'recruitment',
  'recruiting',
  'vacancies',
  'vacancy',
  'hire',
  'association',
  'associations',
  'chamber',
  'portal',
  'portals',
  'marketplace',
  'companies',
]);

const NON_IDENTITY_NAME_TOKENS = new Set([
  'pty',
  'ltd',
  'limited',
  'company',
  'companies',
  'inc',
  'incorporated',
  'the',
  'home',
  'contact',
  'about',
  'official',
  'website',
  'group',
  'holdings',
  'construction',
  'constructors',
  'contractor',
  'contractors',
  'building',
  'builders',
  'engineering',
  'engineer',
  'engineers',
  'projects',
  'project',
  'civils',
  'civil',
  'consulting',
  'consultants',
  'services',
  'solutions',
  'systems',
  'africa',
  'south',
  'north',
  'gauteng',
  'cape',
  'town',
]);

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
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

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !NON_IDENTITY_NAME_TOKENS.has(token));
}

function domainTokens(domain: string): string[] {
  return normalizedTokens(domain.split('.').slice(0, -1).join(' '));
}

function containsAllTokens(searchable: string, tokens: string[]): boolean {
  const searchableTokens = new Set(normalizedTokens(searchable));
  return tokens.length > 0 && tokens.every((token) => searchableTokens.has(token));
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
  // The domain must contain at least one distinctive company-name token. Generic
  // industry/legal/page-title words are removed before this comparison.
  if (!companyTokens.some((token) => domainTokensForIdentity.includes(token))) return false;

  const domainResults = results.filter((result) => {
    try { return registrableDomain(new URL(result.url).hostname) === domain; } catch { return false; }
  });

  // A matching domain alone is not enough. At least one result from that domain
  // must independently identify the same business by all distinctive name tokens.
  return domainResults.some((result) => containsAllTokens(`${result.title} ${result.content}`, companyTokens));
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
      requireText(input.companyName, 'companyName');
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

        const websiteVerified = Boolean(officialWebsiteUrl && domainSupportsCompanyIdentity(officialWebsiteUrl, lead.companyName, matching));
        const verifiedWebsiteUrl = websiteVerified ? officialWebsiteUrl : null;
        const enrichmentStatus = verifiedWebsiteUrl ? 'verified' : 'not_found';
        const evidence = [
          ...(Array.isArray(lead.evidence) ? lead.evidence : []),
          {
            kind: 'public_web_enrichment',
            provider: 'tavily',
            websiteVerificationStatus: enrichmentStatus,
            ...(verifiedWebsiteUrl ? { officialWebsiteUrl: verifiedWebsiteUrl } : {}),
            evidenceReferences: input.supportingResults.map((result) => `public-web:${result.url}`),
          },
        ];
        const enriched = await tx.enrichLead(lead.id, 'pending', {
          companyName: lead.companyName,
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
