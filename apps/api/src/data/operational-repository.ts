import type { Pool } from 'pg';

export interface ClientRecord {
  id: string;
  displayName: string;
  legalName: string | null;
  status: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientInput {
  displayName: string;
  legalName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
}

export interface LeadRecord {
  id: string;
  clientId: string | null;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  source: string | null;
  opportunitySummary: string | null;
  leadScore: number | null;
  status: string;
  evidence: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadInput {
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  source?: string;
  opportunitySummary?: string;
  leadScore?: number;
  evidence?: unknown;
}

export interface ProjectRecord {
  id: string;
  clientId: string;
  leadId: string | null;
  name: string;
  status: string;
  serviceType: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  clientId: string;
  leadId?: string;
  name: string;
  serviceType?: string;
}

export interface WorkflowEventRecord {
  id: string;
  clientId: string | null;
  projectId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: unknown;
  createdAt: string;
}

export interface CreateWorkflowEventInput {
  clientId?: string;
  projectId?: string;
  eventType: string;
  actorType: 'founder' | 'agent' | 'system' | 'client' | 'provider';
  actorId?: string;
  payload?: unknown;
}

function mapClient(row: Record<string, unknown>): ClientRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    legalName: row.legal_name === null ? null : String(row.legal_name),
    status: String(row.status),
    primaryEmail: row.primary_email === null ? null : String(row.primary_email),
    primaryPhone: row.primary_phone === null ? null : String(row.primary_phone),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapLead(row: Record<string, unknown>): LeadRecord {
  return {
    id: String(row.id),
    clientId: row.client_id === null ? null : String(row.client_id),
    companyName: String(row.company_name),
    contactName: row.contact_name === null ? null : String(row.contact_name),
    contactEmail: row.contact_email === null ? null : String(row.contact_email),
    source: row.source === null ? null : String(row.source),
    opportunitySummary: row.opportunity_summary === null ? null : String(row.opportunity_summary),
    leadScore: row.lead_score === null ? null : Number(row.lead_score),
    status: String(row.status),
    evidence: row.evidence,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    leadId: row.lead_id === null ? null : String(row.lead_id),
    name: String(row.name),
    status: String(row.status),
    serviceType: String(row.service_type),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapWorkflowEvent(row: Record<string, unknown>): WorkflowEventRecord {
  return {
    id: String(row.id),
    clientId: row.client_id === null ? null : String(row.client_id),
    projectId: row.project_id === null ? null : String(row.project_id),
    eventType: String(row.event_type),
    actorType: String(row.actor_type),
    actorId: row.actor_id === null ? null : String(row.actor_id),
    payload: row.payload,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export function createOperationalRepository(pool: Pool) {
  return {
    async listClients(limit = 50): Promise<ClientRecord[]> {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const result = await pool.query(
        'select id, display_name, legal_name, status, primary_email, primary_phone, created_at, updated_at from operational.clients order by created_at desc limit $1',
        [safeLimit],
      );
      return result.rows.map((row) => mapClient(row as Record<string, unknown>));
    },

    async createClient(input: CreateClientInput): Promise<ClientRecord> {
      const result = await pool.query(
        `insert into operational.clients (display_name, legal_name, primary_email, primary_phone)
         values ($1, $2, $3, $4)
         returning id, display_name, legal_name, status, primary_email, primary_phone, created_at, updated_at`,
        [input.displayName.trim(), input.legalName?.trim() || null, input.primaryEmail?.trim() || null, input.primaryPhone?.trim() || null],
      );
      return mapClient(result.rows[0] as Record<string, unknown>);
    },

    async listLeads(limit = 50): Promise<LeadRecord[]> {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const result = await pool.query(
        `select id, client_id, company_name, contact_name, contact_email, source, opportunity_summary,
                lead_score, status, evidence, created_at, updated_at
         from operational.leads order by created_at desc limit $1`,
        [safeLimit],
      );
      return result.rows.map((row) => mapLead(row as Record<string, unknown>));
    },

    async getLeadById(id: string): Promise<LeadRecord | null> {
      const result = await pool.query(
        `select id, client_id, company_name, contact_name, contact_email, source, opportunity_summary,
                lead_score, status, evidence, created_at, updated_at
         from operational.leads where id = $1`,
        [id],
      );
      return result.rows[0] ? mapLead(result.rows[0] as Record<string, unknown>) : null;
    },

    async createLead(input: CreateLeadInput): Promise<LeadRecord> {
      const result = await pool.query(
        `insert into operational.leads (company_name, contact_name, contact_email, source, opportunity_summary, lead_score, evidence)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)
         returning id, client_id, company_name, contact_name, contact_email, source, opportunity_summary, lead_score, status, evidence, created_at, updated_at`,
        [
          input.companyName.trim(),
          input.contactName?.trim() || null,
          input.contactEmail?.trim() || null,
          input.source?.trim() || null,
          input.opportunitySummary?.trim() || null,
          input.leadScore ?? null,
          JSON.stringify(input.evidence ?? []),
        ],
      );
      return mapLead(result.rows[0] as Record<string, unknown>);
    },

    async updateLeadStatus(id: string, status: string): Promise<LeadRecord | null> {
      const result = await pool.query(
        `update operational.leads
         set status = $2
         where id = $1
         returning id, client_id, company_name, contact_name, contact_email, source, opportunity_summary, lead_score, status, evidence, created_at, updated_at`,
        [id, status],
      );
      return result.rows[0] ? mapLead(result.rows[0] as Record<string, unknown>) : null;
    },

    async listProjects(limit = 50): Promise<ProjectRecord[]> {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const result = await pool.query(
        `select id, client_id, lead_id, name, status, service_type, created_at, updated_at
         from operational.projects order by created_at desc limit $1`,
        [safeLimit],
      );
      return result.rows.map((row) => mapProject(row as Record<string, unknown>));
    },

    async getProjectById(id: string): Promise<ProjectRecord | null> {
      const result = await pool.query(
        `select id, client_id, lead_id, name, status, service_type, created_at, updated_at
         from operational.projects where id = $1`,
        [id],
      );
      return result.rows[0] ? mapProject(result.rows[0] as Record<string, unknown>) : null;
    },

    async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
      const result = await pool.query(
        `insert into operational.projects (client_id, lead_id, name, service_type)
         values ($1, $2, $3, $4)
         returning id, client_id, lead_id, name, status, service_type, created_at, updated_at`,
        [input.clientId, input.leadId ?? null, input.name.trim(), input.serviceType?.trim() || 'website'],
      );
      return mapProject(result.rows[0] as Record<string, unknown>);
    },

    async updateProjectStatus(id: string, status: string): Promise<ProjectRecord | null> {
      const result = await pool.query(
        `update operational.projects
         set status = $2
         where id = $1
         returning id, client_id, lead_id, name, status, service_type, created_at, updated_at`,
        [id, status],
      );
      return result.rows[0] ? mapProject(result.rows[0] as Record<string, unknown>) : null;
    },

    async listWorkflowEvents(limit = 100): Promise<WorkflowEventRecord[]> {
      const safeLimit = Math.max(1, Math.min(limit, 200));
      const result = await pool.query(
        `select id, client_id, project_id, event_type, actor_type, actor_id, payload, created_at
         from operational.workflow_events order by created_at desc limit $1`,
        [safeLimit],
      );
      return result.rows.map((row) => mapWorkflowEvent(row as Record<string, unknown>));
    },

    async createWorkflowEvent(input: CreateWorkflowEventInput): Promise<WorkflowEventRecord> {
      const result = await pool.query(
        `insert into operational.workflow_events (client_id, project_id, event_type, actor_type, actor_id, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         returning id, client_id, project_id, event_type, actor_type, actor_id, payload, created_at`,
        [input.clientId ?? null, input.projectId ?? null, input.eventType.trim(), input.actorType, input.actorId?.trim() || null, JSON.stringify(input.payload ?? {})],
      );
      return mapWorkflowEvent(result.rows[0] as Record<string, unknown>);
    },
  };
}

export type OperationalRepository = ReturnType<typeof createOperationalRepository>;
