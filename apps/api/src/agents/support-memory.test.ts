import assert from 'node:assert/strict';
import test from 'node:test';
import { credentialAccessMode, mayAccessClientSupportMemory, type ClientSupportMemory } from './support-memory.js';

const clientA: ClientSupportMemory = { clientId: 'client-a', websites: ['a.example'], technology: ['React'], supportPlan: 'basic', preferences: [], knownIssues: [], pastIncidents: [], maintenanceHistory: [], approvedContacts: [], openRequests: [], renewalDates: [] };

test('client support memory is isolated by client id', () => {
  assert.equal(mayAccessClientSupportMemory('client-a', clientA), true);
  assert.equal(mayAccessClientSupportMemory('client-b', clientA), false);
});

test('credentials are accessed only through an authorised secure reference', () => {
  assert.equal(credentialAccessMode({ clientId: 'client-a', credentialReference: 'secret://client-a/site', authorised: true }), 'temporary_authorised_access');
  assert.equal(credentialAccessMode({ clientId: 'client-a', credentialReference: '', authorised: true }), 'deny');
  assert.equal(credentialAccessMode({ clientId: 'client-a', credentialReference: 'secret://client-a/site', authorised: false }), 'deny');
});
