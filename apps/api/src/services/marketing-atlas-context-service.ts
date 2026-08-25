import type { KnowledgeContextPackage } from '../knowledge/knowledge-context-service.js';
import type { ExactSourceContextService } from '../knowledge/exact-source-context-service.js';

export interface MarketingAtlasContextBundle {
  marketingAgent: KnowledgeContextPackage;
  marketingStrategy: KnowledgeContextPackage;
  contentStrategy: KnowledgeContextPackage;
  brandStrategy: KnowledgeContextPackage;
  brandVoice: KnowledgeContextPackage;
  idealClientProfile: KnowledgeContextPackage;
}

interface RequiredMarketingSource {
  key: keyof MarketingAtlasContextBundle;
  title: string;
}

const REQUIRED_SOURCES: readonly RequiredMarketingSource[] = [
  { key: 'marketingAgent', title: 'Marketing Agent' },
  { key: 'marketingStrategy', title: 'Marketing Strategy' },
  { key: 'contentStrategy', title: 'Content Strategy' },
  { key: 'brandStrategy', title: 'Brand Strategy' },
  { key: 'brandVoice', title: 'Brand Voice' },
  { key: 'idealClientProfile', title: 'Ideal Client Profile' },
];

function assertAuthoritativeSource(package_: KnowledgeContextPackage, expectedTitle: string): void {
  const found = package_.sources.some((source) =>
    source.citation.title.trim() === expectedTitle
    && source.citation.path.includes('Volume 1 - Agency/')
  );
  if (!found) throw new Error(`Required Atlas OS source was not retrieved: ${expectedTitle}.`);
}

export function createMarketingAtlasContextService(
  exactSourceContext: Pick<ExactSourceContextService, 'assembleExact'>,
) {
  return {
    async load(): Promise<MarketingAtlasContextBundle> {
      const entries = await Promise.all(REQUIRED_SOURCES.map(async (source) => {
        const package_ = await exactSourceContext.assembleExact({
          title: source.title,
          pathPrefix: 'Volume 1 - Agency/',
          agent: 'marketing_agent',
          task: 'marketing_content_drafting',
          maximumSecurityClassification: 'internal',
          maxCharacters: 6_000,
        });
        assertAuthoritativeSource(package_, source.title);
        return [source.key, package_] as const;
      }));
      return Object.fromEntries(entries) as unknown as MarketingAtlasContextBundle;
    },
  };
}

export type MarketingAtlasContextService = ReturnType<typeof createMarketingAtlasContextService>;
