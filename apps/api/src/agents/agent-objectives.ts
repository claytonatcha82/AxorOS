export type CoreAgentId =
  | 'knowledge_agent'
  | 'executive_agent'
  | 'operations_agent'
  | 'lead_agent'
  | 'sales_agent'
  | 'production_agent'
  | 'support_agent'
  | 'marketing_agent'
  | 'finance_agent';

export interface AgentObjectiveDefinition {
  agentId: CoreAgentId;
  primaryOutcome: string;
  description: string;
  owner: 'executive_agent';
  reviewCadence: 'quarterly';
}

export const AGENT_OBJECTIVES: readonly AgentObjectiveDefinition[] = [
  { agentId: 'knowledge_agent', primaryOutcome: 'deliver_accurate_context', description: 'Deliver accurate, authoritative, relevant context to the AxorOS workforce.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'executive_agent', primaryOutcome: 'make_better_strategic_decisions', description: 'Make better strategic and governance decisions while preserving required human authority.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'operations_agent', primaryOutcome: 'coordinate_efficient_execution', description: 'Coordinate efficient execution across agents, dependencies, priorities, capacity, and exceptions.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'lead_agent', primaryOutcome: 'generate_qualified_opportunities', description: 'Generate and prioritise qualified commercial opportunities without contacting prospects.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'sales_agent', primaryOutcome: 'convert_opportunities_into_revenue', description: 'Convert qualified opportunities into approved commercial agreements and revenue.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'production_agent', primaryOutcome: 'deliver_high_quality_work_profitably', description: 'Deliver high-quality approved work profitably, securely, and according to Atlas OS.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'support_agent', primaryOutcome: 'maximise_client_retention_and_satisfaction', description: 'Maximise client retention and satisfaction while protecting supported client assets.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'marketing_agent', primaryOutcome: 'increase_qualified_inbound_demand', description: 'Increase qualified inbound demand by building trust, authority, proof, education, and visibility.', owner: 'executive_agent', reviewCadence: 'quarterly' },
  { agentId: 'finance_agent', primaryOutcome: 'maintain_accurate_auditable_financial_state', description: 'Maintain accurate, auditable financial state and reliable financial workflow gates.', owner: 'executive_agent', reviewCadence: 'quarterly' },
] as const;

export function getAgentObjective(agentId: CoreAgentId): AgentObjectiveDefinition {
  const objective = AGENT_OBJECTIVES.find((item) => item.agentId === agentId);
  if (!objective) throw new Error(`No primary objective configured for ${agentId}.`);
  return objective;
}

export function validateAgentObjectiveRegistry(): string[] {
  const errors: string[] = [];
  const agentIds = new Set<string>();
  const outcomes = new Set<string>();

  for (const objective of AGENT_OBJECTIVES) {
    if (agentIds.has(objective.agentId)) errors.push(`duplicate agent objective: ${objective.agentId}`);
    if (outcomes.has(objective.primaryOutcome)) errors.push(`duplicate primary outcome: ${objective.primaryOutcome}`);
    if (!objective.primaryOutcome.trim()) errors.push(`primary outcome missing: ${objective.agentId}`);
    if (!objective.description.trim()) errors.push(`objective description missing: ${objective.agentId}`);
    if (objective.reviewCadence !== 'quarterly') errors.push(`review cadence must be quarterly: ${objective.agentId}`);
    agentIds.add(objective.agentId);
    outcomes.add(objective.primaryOutcome);
  }

  if (AGENT_OBJECTIVES.length !== 9) errors.push('all nine core agents must have exactly one primary objective.');
  return errors;
}
