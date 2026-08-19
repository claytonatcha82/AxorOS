import type { ApiConfig } from '../config.js';
import { createGooglePlacesLeadResearchIntegration } from './google-places-lead-research-integration.js';
import { IntegrationRegistry } from './integration-registry.js';
import { createTavilyPublicWebResearchIntegration } from './tavily-public-web-research-integration.js';

export interface LeadResearchRegistryResult {
  registry: IntegrationRegistry;
  registeredIntegrationIds: readonly string[];
}

export function createConfiguredLeadResearchRegistry(config: ApiConfig): LeadResearchRegistryResult {
  const registry = new IntegrationRegistry({
    defaultMode: 'sandbox',
    allowLive: true,
    liveRiskCeiling: 'low',
  });
  const registeredIntegrationIds: string[] = [];

  if (config.googlePlacesApiKey) {
    const googlePlaces = createGooglePlacesLeadResearchIntegration({ apiKey: config.googlePlacesApiKey });
    registry.register(googlePlaces);
    registeredIntegrationIds.push(googlePlaces.integrationId);
  }

  if (config.tavilyApiKey) {
    const tavily = createTavilyPublicWebResearchIntegration({ apiKey: config.tavilyApiKey });
    registry.register(tavily);
    registeredIntegrationIds.push(tavily.integrationId);
  }

  return { registry, registeredIntegrationIds };
}
