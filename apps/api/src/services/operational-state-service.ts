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
