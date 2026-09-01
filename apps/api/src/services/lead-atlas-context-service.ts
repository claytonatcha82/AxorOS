import type { ExactSourceContextService } from '../knowledge/exact-source-context-service.js';
import type { KnowledgeContextPackage, KnowledgeContextService } from '../knowledge/knowledge-context-service.js';

export interface LeadAtlasContextBundle {
  idealClientProfile: KnowledgeContextPackage;
  leadGeneration: KnowledgeContextPackage;
  leadQualification: KnowledgeContextPackage;
  leadAgentGovernance: KnowledgeContextPackage;
}

interface RequiredAtlasSource {
  key: keyof LeadAtlasContextBundle;
  query: string;
  expectedTitle: string;
  pathPrefix: string;
}

const REQUIRED_SOURCES: RequiredAtlasSource[] = [
  {
    key: 'idealClientProfile',
    query: 'Ideal Client Profile',
    expectedTitle: 'Ideal Client Profile',
    pathPrefix: 'Volume 1 - Agency/02 - Agency Positioning/Ideal Client Profile',
  },
  {
    key: 'leadGeneration',
    query: 'Lead Generation System',
    expectedTitle: 'Lead Generation System',
    pathPrefix: 'Volume 1 - Agency/05 - Client Acquisition/Lead Generation System',
  },
  {
    key: 'leadQualification',
    query: 'Lead Qualification',
    expectedTitle: 'Lead Qualification',
    pathPrefix: 'Volume 1 - Agency/05 - Client Acquisition/Lead Qualification',
  },
  {
    key: 'leadAgentGovernance',
    query: 'Lead Agent',
    expectedTitle: 'Lead Agent',
    pathPrefix: 'Volume 1 - Agency/11 - AI Agency Infrastructure/Lead Agent',
  },
];

function assertAuthoritativeSource(package_: KnowledgeContextPackage, expectedTitle: string): void {
  const hasExpectedAtlasSource = package_.sources.some((source) =>
    source.citation.title.trim() === expectedTitle
    && source.citation.path.includes('Volume 1 - Agency/')
  );
  if (!hasExpectedAtlasSource) {
    throw new Error(`Required Atlas OS source was not retrieved: ${expectedTitle}.`);
  }
}

export function createLeadAtlasContextService(
  contextService: Pick<KnowledgeContextService, 'assemble'>,
  exactSourceContext?: Pick<ExactSourceContextService, 'assembleExact'>,
) {
  return {
    async load(): Promise<LeadAtlasContextBundle> {
      const entries = await Promise.all(REQUIRED_SOURCES.map(async (source) => {
        const package_ = exactSourceContext
          ? await exactSourceContext.assembleExact({
              title: source.expectedTitle,
              pathPrefix: source.pathPrefix,
              agent: 'lead_agent',
              task: 'lead_research_and_qualification',
              maximumSecurityClassification: 'internal',
              maxCharacters: source.key === 'idealClientProfile' ? 40_000 : 14_000,
            })
          : await contextService.assemble({
              query: source.query,
              agent: 'lead_agent',
              task: 'lead_research_and_qualification',
              maximumSecurityClassification: 'internal',
              limit: 12,
              maxCharacters: 14_000,
            });
        assertAuthoritativeSource(package_, source.expectedTitle);
        return [source.key, package_] as const;
      }));

      return Object.fromEntries(entries) as unknown as LeadAtlasContextBundle;
    },
  };
}

export type LeadAtlasContextService = ReturnType<typeof createLeadAtlasContextService>;
