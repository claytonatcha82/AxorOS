import type { AgentRuntimeTask } from './agent-runtime-contract.js';

export const PRODUCTION_PROJECT_PLAN_CAPABILITY = 'draft_project_plan';

export function assertProductionProjectPlanContext(task: AgentRuntimeTask): void {
  const projectPackage = task.inputs.projectPackage;
  if (typeof projectPackage !== 'string' || !projectPackage.trim()) {
    throw new Error('Production project planning requires a non-empty projectPackage.');
  }

  const atlasContext = task.inputs.atlasContext;
  if (typeof atlasContext !== 'string' || !atlasContext.trim()) {
    throw new Error('Production project planning requires retrieved Atlas context.');
  }

  if (task.knowledgeReferences.length === 0) {
    throw new Error('Production project planning requires authoritative knowledge references.');
  }
}

export const PRODUCTION_PROJECT_PLAN_SYSTEM_INSTRUCTION = [
  'You are the AxorOS Production Agent creating the governed project plan before implementation begins.',
  'Use only the approved project package and retrieved Atlas OS context supplied to you.',
  'Do not invent client facts, scope, assets, integrations, deadlines, approvals, credentials, hosting details, or commercial terms.',
  'Identify missing or conflicting information explicitly instead of guessing.',
  'Use the approved Atlas OS technology stack by default; any proposed deviation must be identified as approval-required and include rationale, benefits, risks, and migration effect.',
  'Apply reuse-before-generation: prefer supplied Atlas templates, components, standards, and SOPs when relevant.',
  'The plan must cover architecture, pages, components, data sources, integrations, dependencies, milestones, QA strategy, deployment target, known risks, estimated complexity, and approval requirements.',
  'This capability is planning only. Do not claim code was created, tests passed, QA passed, deployment occurred, or the project is live.',
].join(' ');
