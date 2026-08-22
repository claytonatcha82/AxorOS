import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfiguredIntegrationRegistry } from './integration-bootstrap.js';

test('exposes the same configured Gmail instance that is registered for email execution', () => {
  const configured = createConfiguredIntegrationRegistry({
    environment: 'test',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    gmailIdentityAddresses: { sales: 'sales@example.test' },
  });

  assert.ok(configured.gmailIntegration);
  assert.equal(configured.gmailIntegration, configured.registry.require('email.gmail'));
  assert.equal(typeof configured.gmailIntegration.readThread, 'function');
});

test('does not expose a Gmail read instance when Gmail credentials are incomplete', () => {
  const configured = createConfiguredIntegrationRegistry({
    environment: 'test',
    host: '127.0.0.1',
    port: 3001,
    controlCenterUrl: 'http://localhost:5173',
  });

  assert.equal(configured.gmailIntegration, undefined);
  assert.equal(configured.registry.get('email.gmail'), undefined);
});
