export const PRODUCTION_AGENT_ID = 'production_agent' as const;
export const PRODUCTION_AGENT_ROLE = 'AI Production Engineer / Digital Delivery Agent' as const;
export const PRODUCTION_AGENT_AUTONOMY = 'copilot' as const;

export const PRODUCTION_AGENT_PERMISSIONS = {
  atlasOs: 'read',
  knowledgeAgent: 'query',
  clientProjectFiles: 'read_write',
  gitRepository: 'read_write',
  componentLibrary: 'read',
  templates: 'read',
  testEnvironment: 'deploy',
  productionEnvironment: 'approval_gated',
  projectManagement: 'update',
} as const;

export const PRODUCTION_AGENT_PROHIBITIONS = [
  'banking_controls',
  'unrestricted_payment_systems',
  'legal_agreement_modification',
  'arbitrary_price_changes',
  'general_sales_email_access',
  'unapproved_production_deployment',
  'unapproved_stack_deviation',
  'out_of_scope_implementation_without_change_request',
  'publishing_unverified_business_facts',
  'storing_secrets_in_source_code',
] as const;

export interface ProductionStartGateInput {
  proposalAccepted: boolean;
  contractSigned: boolean;
  requiredPaymentConfirmed: boolean;
  onboardingComplete: boolean;
  requiredAssetsAvailable: boolean;
  projectPlanningComplete: boolean;
}

export type ProductionStartGateRequirement = keyof ProductionStartGateInput;

export interface ProductionStartGateResult {
  status: 'unlocked' | 'blocked';
  productionUnlocked: boolean;
  missingRequirements: ProductionStartGateRequirement[];
}

const START_GATE_REQUIREMENTS: ProductionStartGateRequirement[] = [
  'proposalAccepted',
  'contractSigned',
  'requiredPaymentConfirmed',
  'onboardingComplete',
  'requiredAssetsAvailable',
  'projectPlanningComplete',
];

export function evaluateProductionStartGate(input: ProductionStartGateInput): ProductionStartGateResult {
  const missingRequirements = START_GATE_REQUIREMENTS.filter((requirement) => !input[requirement]);
  const productionUnlocked = missingRequirements.length === 0;

  return {
    status: productionUnlocked ? 'unlocked' : 'blocked',
    productionUnlocked,
    missingRequirements,
  };
}

export function productionAgentCan(permission: keyof typeof PRODUCTION_AGENT_PERMISSIONS): string {
  return PRODUCTION_AGENT_PERMISSIONS[permission];
}

export function productionAgentIsProhibited(action: string): boolean {
  return (PRODUCTION_AGENT_PROHIBITIONS as readonly string[]).includes(action);
}
