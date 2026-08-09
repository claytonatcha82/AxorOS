import type {
  ClientRecord,
  CreateClientInput,
  CreateLeadInput,
  CreateProjectInput,
  LeadRecord,
  OperationalRepository,
  ProjectRecord,
  WorkflowEventRecord,
} from '../data/operational-repository.js';

export type LeadStatus = 'new' | 'qualified' | 'disqualified' | 'engaged' | 'converted';
export type ProjectStatus = 'pending' | 'active' | 'qa' | 'awaiting_approval' | 'delivered' | 'cancelled' | 'archived';
export type ActorType = 'founder' | 'agent' | 'system' | 'client' | 'provider';

const leadTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['qualified', 'disqualified'],
  qualified: ['engaged', 'disqualified'],
  engaged: ['converted', 'disqualified'],
  converted: [],
  disqualified: [],
};

const projectTransitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
  pending: ['active', 'cancelled'],
  active: ['qa', 'cancelled'],
  qa: ['active', 'awaiting_approval', 'cancelled'],
  awaiting_approval: ['active', 'delivered', 'cancelled'],
  delivered: ['archived'],
  cancelled: ['archived'],
  archived: [],
};

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function validateLeadScore(score: number | undefined): void {
  if (score === undefined) return;
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error('leadScore must be an integer between 0 and 100.');
  }
}

function assertLeadStatus(value: string): asserts value is LeadStatus {
  if (!(value in leadTransitions)) throw new Error(`Unknown lead status: ${value}`);
}

function assertProjectStatus(value: string): asserts value is ProjectStatus {
  if (!(value in projectTransitions)) throw new Error(`Unknown project status: ${value}`);
}

function assertTransition<T extends string>(current: T, next: T, allowed: readonly T[], entity: string): void {
  if (!allowed.includes(next)) {
    throw new Error(`Invalid ${entity} transition: ${current} -> ${next}`);
  }
}

export function createOperationalStateService(repository: OperationalRepository) {
  return {
    async registerClient(input: CreateClientInput, actorId = 'founder'): Promise<ClientRecord> {
      const client = await repository.createClient({
        ...input,
        displayName: requireText(input.displayName, 'displayName'),
      });
      await repository.createWorkflowEvent({
        clientId: client.id,
        eventType: 'client_registered',
        actorType: 'founder',
        actorId,
        payload: { clientId: client.id },
      });
      return client;
    },

    async registerLead(input: CreateLeadInput, actorId = 'system'): Promise<LeadRecord> {
      validateLeadScore(input.leadScore);
      const lead = await repository.createLead({
        ...input,
        companyName: requireText(input.companyName, 'companyName'),
      });
      await repository.createWorkflowEvent({
        eventType: 'lead_registered',
        actorType: 'system',
        actorId,
        payload: { leadId: lead.id, companyName: lead.companyName },
      });
      return lead;
    },

    async transitionLeadStatus(leadId: string, nextStatus: LeadStatus, actorType: ActorType, actorId: string): Promise<LeadRecord> {
      const lead = await repository.getLeadById(requireText(leadId, 'leadId'));
      if (!lead) throw new Error('Lead not found.');
      assertLeadStatus(lead.status);
      assertTransition(lead.status, nextStatus, leadTransitions[lead.status], 'lead');

      const updated = await repository.updateLeadStatus(lead.id, nextStatus);
      if (!updated) throw new Error('Lead disappeared during transition.');

      await repository.createWorkflowEvent({
        clientId: updated.clientId ?? undefined,
        eventType: 'lead_status_changed',
        actorType,
        actorId: requireText(actorId, 'actorId'),
        payload: { leadId: updated.id, from: lead.status, to: nextStatus },
      });
      return updated;
    },

    async createClientProject(input: CreateProjectInput, actorId = 'founder'): Promise<ProjectRecord> {
      const project = await repository.createProject({
        ...input,
        clientId: requireText(input.clientId, 'clientId'),
        name: requireText(input.name, 'name'),
      });
      await repository.createWorkflowEvent({
        clientId: project.clientId,
        projectId: project.id,
        eventType: 'project_created',
        actorType: 'founder',
        actorId,
        payload: { projectId: project.id, serviceType: project.serviceType },
      });
      return project;
    },

    async transitionProjectStatus(projectId: string, nextStatus: ProjectStatus, actorType: ActorType, actorId: string): Promise<ProjectRecord> {
      const project = await repository.getProjectById(requireText(projectId, 'projectId'));
      if (!project) throw new Error('Project not found.');
      assertProjectStatus(project.status);
      assertTransition(project.status, nextStatus, projectTransitions[project.status], 'project');

      const updated = await repository.updateProjectStatus(project.id, nextStatus);
      if (!updated) throw new Error('Project disappeared during transition.');

      await repository.createWorkflowEvent({
        clientId: updated.clientId,
        projectId: updated.id,
        eventType: 'project_status_changed',
        actorType,
        actorId: requireText(actorId, 'actorId'),
        payload: { projectId: updated.id, from: project.status, to: nextStatus },
      });
      return updated;
    },

    async listClients(limit?: number): Promise<ClientRecord[]> {
      return repository.listClients(limit);
    },

    async listLeads(limit?: number): Promise<LeadRecord[]> {
      return repository.listLeads(limit);
    },

    async listProjects(limit?: number): Promise<ProjectRecord[]> {
      return repository.listProjects(limit);
    },

    async listWorkflowEvents(limit?: number): Promise<WorkflowEventRecord[]> {
      return repository.listWorkflowEvents(limit);
    },
  };
}

export type OperationalStateService = ReturnType<typeof createOperationalStateService>;
