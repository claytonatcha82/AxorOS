export type ProductionModelIntegrationId = 'model.gemini' | 'model.openai' | 'model.anthropic';

export interface ProductionModelPolicy {
  projectPlanningIntegrationId: ProductionModelIntegrationId;
  technicalImplementationIntegrationId: ProductionModelIntegrationId;
}

export const DEFAULT_PRODUCTION_MODEL_POLICY: ProductionModelPolicy = {
  projectPlanningIntegrationId: 'model.gemini',
  technicalImplementationIntegrationId: 'model.gemini',
};

export function createProductionModelPolicy(
  integrationId?: ProductionModelIntegrationId,
): ProductionModelPolicy {
  const selected = integrationId ?? DEFAULT_PRODUCTION_MODEL_POLICY.projectPlanningIntegrationId;
  return {
    projectPlanningIntegrationId: selected,
    technicalImplementationIntegrationId: selected,
  };
}
