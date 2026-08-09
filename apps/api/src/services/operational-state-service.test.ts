import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationalStateService } from './operational-state-service.js';

function createRepositoryMock() {
  const events: unknown[] = [];
  return {
    events,
    repository: {
      async createClient() {
        return { id: 'client-1', displayName: 'Example', legalName: null, status: 'prospect', primaryEmail: null, primaryPhone: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      },
      async createLead(input: { companyName: string }) {
        return { id: 'lead-1', clientId: null, companyName: input.companyName, contactName: null, contactEmail: null, source: null, opportunitySummary: null, leadScore: null, status: 'new', evidence: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      },
      async createProject() {
        return { id: 'project-1', clientId: 'client-1', leadId: null, name: 'Website', status: 'pending', serviceType: 'website', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      },
      async createWorkflowEvent(input: unknown) {
        events.push(input);
        return { id: 'event-1', clientId: null, projectId: null, eventType: 'test', actorType: 'system', actorId: null, payload: {}, createdAt: new Date().toISOString() };
      },
      async listClients() { return []; },
      async listLeads() { return []; },
      async listProjects() { return []; },
      async listWorkflowEvents() { return []; },
    },
  };
}

test('registerLead rejects invalid lead score before repository write', async () => {
  const mock = createRepositoryMock();
  const service = createOperationalStateService(mock.repository as never);
  await assert.rejects(() => service.registerLead({ companyName: 'Example', leadScore: 101 }), /leadScore/);
  assert.equal(mock.events.length, 0);
});

test('registerLead records an audit event', async () => {
  const mock = createRepositoryMock();
  const service = createOperationalStateService(mock.repository as never);
  const lead = await service.registerLead({ companyName: ' Example ' });
  assert.equal(lead.companyName, 'Example');
  assert.equal(mock.events.length, 1);
  assert.deepEqual(mock.events[0], {
    eventType: 'lead_registered',
    actorType: 'system',
    actorId: 'system',
    payload: { leadId: 'lead-1', companyName: 'Example' },
  });
});
