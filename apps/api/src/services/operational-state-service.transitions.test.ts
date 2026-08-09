import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationalStateService } from './operational-state-service.js';

function makeLead(status: string) {
  return {
    id: 'lead-1',
    clientId: null,
    companyName: 'Example',
    contactName: null,
    contactEmail: null,
    source: null,
    opportunitySummary: null,
    leadScore: 80,
    status,
    evidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeProject(status: string) {
  return {
    id: 'project-1',
    clientId: 'client-1',
    leadId: null,
    name: 'Example Project',
    status,
    serviceType: 'website',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function passthroughTransaction(repository: never) {
  return async <T>(work: (tx: never) => Promise<T>): Promise<T> => work(repository);
}

test('lead transition new -> qualified succeeds and writes audit event', async () => {
  const events: unknown[] = [];
  const repository = {
    getLeadById: async () => makeLead('new'),
    updateLeadStatus: async (_id: string, status: string) => makeLead(status),
    createWorkflowEvent: async (event: unknown) => { events.push(event); return event; },
  } as never;

  const service = createOperationalStateService(repository, passthroughTransaction(repository));
  const result = await service.transitionLeadStatus('lead-1', 'qualified', 'agent', 'lead-agent');

  assert.equal(result.status, 'qualified');
  assert.equal(events.length, 1);
});

test('lead transition new -> converted is rejected', async () => {
  const repository = {
    getLeadById: async () => makeLead('new'),
  } as never;

  const service = createOperationalStateService(repository, passthroughTransaction(repository));
  await assert.rejects(
    () => service.transitionLeadStatus('lead-1', 'converted', 'agent', 'lead-agent'),
    /Invalid lead transition/,
  );
});

test('project transition pending -> active succeeds', async () => {
  const events: unknown[] = [];
  const repository = {
    getProjectById: async () => makeProject('pending'),
    updateProjectStatus: async (_id: string, status: string) => makeProject(status),
    createWorkflowEvent: async (event: unknown) => { events.push(event); return event; },
  } as never;

  const service = createOperationalStateService(repository, passthroughTransaction(repository));
  const result = await service.transitionProjectStatus('project-1', 'active', 'system', 'runtime');

  assert.equal(result.status, 'active');
  assert.equal(events.length, 1);
});

test('project transition pending -> delivered is rejected', async () => {
  const repository = {
    getProjectById: async () => makeProject('pending'),
  } as never;

  const service = createOperationalStateService(repository, passthroughTransaction(repository));
  await assert.rejects(
    () => service.transitionProjectStatus('project-1', 'delivered', 'system', 'runtime'),
    /Invalid project transition/,
  );
});
