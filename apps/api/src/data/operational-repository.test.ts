import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationalRepository } from './operational-repository.js';

function createPoolMock(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push(values ? { text, values } : { text });
        return { rows };
      },
    },
  };
}

test('listClients uses parameterized bounded query', async () => {
  const mock = createPoolMock([]);
  const repository = createOperationalRepository(mock.pool as never);

  await repository.listClients(500);

  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0]!.text, /operational\.clients/);
  assert.deepEqual(mock.calls[0]!.values, [100]);
});

test('createClient parameterizes client values', async () => {
  const now = new Date().toISOString();
  const mock = createPoolMock([{
    id: '00000000-0000-0000-0000-000000000001',
    display_name: 'Example Client',
    legal_name: null,
    status: 'prospect',
    primary_email: 'client@example.com',
    primary_phone: null,
    created_at: now,
    updated_at: now,
  }]);
  const repository = createOperationalRepository(mock.pool as never);

  const client = await repository.createClient({
    displayName: ' Example Client ',
    primaryEmail: ' client@example.com ',
  });

  assert.equal(client.displayName, 'Example Client');
  assert.deepEqual(mock.calls[0]!.values, [
    'Example Client',
    null,
    'client@example.com',
    null,
  ]);
});
