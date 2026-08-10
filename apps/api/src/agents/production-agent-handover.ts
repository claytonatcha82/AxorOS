import { evaluateProductionStartGate, type ProductionStartGateInput, type ProductionStartGateResult } from './production-agent-policy.js';

export interface ProductionAgentHandover {
  projectId: string;
  clientId: string;
  business: string;
  primaryContact: string;
  projectObjective: string;
  approvedScope: string[];
  deliverables: string[];
  excludedScope: string[];
  timeline: string;
  milestones: string[];
  approvedProposal: string;
  contractStatus: string;
  paymentStatus: string;
  brandAssets: string[];
  contentAssets: string[];
  technicalRequirements: string[];
  requiredIntegrations: string[];
  seoRequirements: string[];
  accessibilityRequirements: string[];
  supportRequirements: string[];
  clientExpectations: string[];
  risks: string[];
  openItems: string[];
  startGate: ProductionStartGateInput;
}

export interface ProductionAgentHandoverValidation {
  valid: boolean;
  missingFields: string[];
  startGate: ProductionStartGateResult;
  productionReady: boolean;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function hasEntries(value: string[]): boolean {
  return value.some((entry) => entry.trim().length > 0);
}

export function validateProductionAgentHandover(handover: ProductionAgentHandover): ProductionAgentHandoverValidation {
  const missingFields: string[] = [];

  const requiredTextFields: Array<[string, string]> = [
    ['projectId', handover.projectId],
    ['clientId', handover.clientId],
    ['business', handover.business],
    ['primaryContact', handover.primaryContact],
    ['projectObjective', handover.projectObjective],
    ['timeline', handover.timeline],
    ['approvedProposal', handover.approvedProposal],
    ['contractStatus', handover.contractStatus],
    ['paymentStatus', handover.paymentStatus],
  ];

  for (const [field, value] of requiredTextFields) {
    if (!hasText(value)) missingFields.push(field);
  }

  const requiredListFields: Array<[string, string[]]> = [
    ['approvedScope', handover.approvedScope],
    ['deliverables', handover.deliverables],
    ['milestones', handover.milestones],
  ];

  for (const [field, value] of requiredListFields) {
    if (!hasEntries(value)) missingFields.push(field);
  }

  const startGate = evaluateProductionStartGate(handover.startGate);
  const valid = missingFields.length === 0;

  return {
    valid,
    missingFields,
    startGate,
    productionReady: valid && startGate.productionUnlocked,
  };
}

export function assertProductionAgentHandoverReady(handover: ProductionAgentHandover): void {
  const validation = validateProductionAgentHandover(handover);

  if (!validation.valid) {
    throw new Error(`Production handover is incomplete: ${validation.missingFields.join(', ')}`);
  }

  if (!validation.startGate.productionUnlocked) {
    throw new Error(`Production is blocked: ${validation.startGate.missingRequirements.join(', ')}`);
  }
}
