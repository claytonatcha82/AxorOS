import type { AgentRuntimeHandler } from './agent-runtime-handlers.js';

export const SALES_INTERNAL_INTAKE_CAPABILITY = 'sales_internal_intake';

export const salesInternalIntakeHandler: AgentRuntimeHandler = {
  agentId: 'sales_agent',
  capabilityId: SALES_INTERNAL_INTAKE_CAPABILITY,
  async execute(task) {
    if (task.inputs.salesIntakeOnly !== true) throw new Error('Sales internal intake requires intake-only authority.');
    if (task.inputs.salesDispatchAuthorised !== false || task.inputs.outreachAuthorised !== false) {
      throw new Error('Sales internal intake cannot execute with Sales dispatch or outreach authority.');
    }
    if (task.knowledgeReferences.length === 0) throw new Error('Sales internal intake requires Atlas provenance.');

    return {
      executionId: task.executionId,
      taskId: task.taskId,
      agentId: 'sales_agent',
      status: 'completed',
      output: {
        intakeAccepted: true,
        leadId: task.context.leadId ?? null,
        eligibilityRecordId: task.context.eligibilityRecordId ?? null,
        salesDispatchAuthorised: false,
        outreachAuthorised: false,
        nextAction: 'define_governed_sales_opportunity_assessment',
      },
      evidenceReferences: [],
      knowledgeReferences: [...task.knowledgeReferences],
      confidence: 1,
    };
  },
};
