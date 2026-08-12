import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_OBJECTIVES, getAgentObjective, validateAgentObjectiveRegistry } from './agent-objectives.js';

test('all nine core agents have one unique quarterly-reviewed primary outcome', () => {
  assert.equal(AGENT_OBJECTIVES.length, 9);
  assert.deepEqual(validateAgentObjectiveRegistry(), []);
  assert.equal(new Set(AGENT_OBJECTIVES.map((item) => item.agentId)).size, 9);
  assert.equal(new Set(AGENT_OBJECTIVES.map((item) => item.primaryOutcome)).size, 9);
  assert.ok(AGENT_OBJECTIVES.every((item) => item.owner === 'executive_agent' && item.reviewCadence === 'quarterly'));
});

test('canonical outcomes match established agent roles', () => {
  assert.equal(getAgentObjective('knowledge_agent').primaryOutcome, 'deliver_accurate_context');
  assert.equal(getAgentObjective('executive_agent').primaryOutcome, 'make_better_strategic_decisions');
  assert.equal(getAgentObjective('operations_agent').primaryOutcome, 'coordinate_efficient_execution');
  assert.equal(getAgentObjective('lead_agent').primaryOutcome, 'generate_qualified_opportunities');
  assert.equal(getAgentObjective('sales_agent').primaryOutcome, 'convert_opportunities_into_revenue');
  assert.equal(getAgentObjective('production_agent').primaryOutcome, 'deliver_high_quality_work_profitably');
  assert.equal(getAgentObjective('support_agent').primaryOutcome, 'maximise_client_retention_and_satisfaction');
  assert.equal(getAgentObjective('marketing_agent').primaryOutcome, 'increase_qualified_inbound_demand');
  assert.equal(getAgentObjective('finance_agent').primaryOutcome, 'maintain_accurate_auditable_financial_state');
});
