import type { AgentRuntimeTask } from './agent-runtime-contract.js';
import type { FinanceClearanceDecision } from './finance-clearance-gate.js';

export function applyProductionFinanceGate(
  task: AgentRuntimeTask,
  clearance: FinanceClearanceDecision,
): AgentRuntimeTask {
  if (task.destinationAgent !== 'production_agent') {
    throw new Error('Production Finance gate requires destinationAgent production_agent.');
  }

  if (clearance.state !== 'FINANCE_CLEARED') {
    return {
      ...task,
      status: 'blocked',
      nextAction: 'obtain_finance_clearance',
      context: {
        ...task.context,
        financeGate: {
          state: clearance.state,
          commercialRecordReference: clearance.commercialRecordReference,
          reason: clearance.reason,
          evidenceReferences: clearance.evidenceReferences,
        },
      },
    };
  }

  return {
    ...task,
    context: {
      ...task.context,
      financeGate: {
        state: clearance.state,
        commercialRecordReference: clearance.commercialRecordReference,
        reason: clearance.reason,
        evidenceReferences: clearance.evidenceReferences,
      },
    },
  };
}

export function assertProductionFinanceGate(task: AgentRuntimeTask): void {
  if (task.destinationAgent !== 'production_agent') return;
  const gate = task.context.financeGate;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) throw new Error('Production start blocked: FINANCE_CLEARED evidence is missing.');
  const state = Reflect.get(gate, 'state');
  const evidenceReferences = Reflect.get(gate, 'evidenceReferences');
  if (state !== 'FINANCE_CLEARED' || !Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
    throw new Error('Production start blocked: valid FINANCE_CLEARED evidence is required.');
  }
}
