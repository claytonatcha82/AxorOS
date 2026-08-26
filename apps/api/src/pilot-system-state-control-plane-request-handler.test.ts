import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import test from 'node:test';
import { createPilotSystemStateControlPlaneRequestHandler } from './pilot-system-state-control-plane-request-handler.js';

const token = 'pilot-control-token-1234567890123456';
const controlCenterUrl = 'http://localhost:5173';

async function withServer(
  options: {
    activation?: (input: { readinessId: string; actor: 'human_executive'; reason: string }) => Promise<unknown>;
  },
  run: (
    baseUrl: string,
    writes: () => Array<{ state: string; reason: string }>,
    activations: () => Array<{ readinessId: string; actor: string; reason: string }>,
  ) => Promise<void>,
) {
  const changes: Array<{ state: string; reason: string }> = [];
  const activationCalls: Array<{ readinessId: string; actor: string; reason: string }> = [];
  const fallback: RequestListener = (_request, response) => { response.writeHead(418); response.end(); };
  const handler = createPilotSystemStateControlPlaneRequestHandler({
    config: { controlCenterUrl, controlPlaneToken: token },
    store: {
      async get() {
        return {
          state: 'PILOT_DISABLED',
          changedBy: 'system',
          reason: 'test',
          version: 1,
          changedAt: '2026-08-25T00:00:00.000Z',
        } as const;
      },
      async set(state, _changedBy, reason) {
        changes.push({ state, reason });
        return {
          state,
          changedBy: 'human_executive',
          reason,
          version: 2,
          changedAt: '2026-08-25T00:01:00.000Z',
        };
      },
    },
    activationCommand: {
      async activate(input) {
        activationCalls.push(input);
        if (options.activation) return options.activation(input) as never;
        return {
          readinessId: input.readinessId,
          replayed: false,
          state: {
            state: 'PILOT_ACTIVE',
            changedBy: 'human_executive',
            reason: `${input.reason} Readiness: ${input.readinessId}.`,
            version: 2,
            changedAt: '2026-08-25T00:01:00.000Z',
          },
        };
      },
    },
    fallback,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(
      `http://127.0.0.1:${address.port}`,
      () => changes,
      () => activationCalls,
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(baseUrl: string, body: Record<string, unknown>, bearer = token) {
  return fetch(`${baseUrl}/api/v1/control/pilot/state`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('pilot activation requires authenticated control-plane access', async () => {
  await withServer({}, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_ACTIVE',
      readinessId: 'pilot-readiness:test',
      reason: 'Begin pilot.',
      confirmation: 'ACTIVATE PILOT',
    }, 'wrong-token');
    assert.equal(response.status, 401);
    assert.equal(writes().length, 0);
    assert.equal(activations().length, 0);
  });
});

test('pilot activation requires exact Human Executive confirmation', async () => {
  await withServer({}, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_ACTIVE',
      readinessId: 'pilot-readiness:test',
      reason: 'Begin pilot.',
      confirmation: 'activate pilot',
    });
    assert.equal(response.status, 409);
    assert.equal(writes().length, 0);
    assert.equal(activations().length, 0);
  });
});

test('pilot activation requires a persisted readiness ID', async () => {
  await withServer({}, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_ACTIVE',
      reason: 'Begin pilot.',
      confirmation: 'ACTIVATE PILOT',
    });
    const body = await response.json() as { error: { code: string } };
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'pilot_activation_readiness_id_required');
    assert.equal(writes().length, 0);
    assert.equal(activations().length, 0);
  });
});

test('pilot activation is blocked when persisted readiness command rejects it', async () => {
  await withServer({
    async activation() { throw new Error('Pilot activation readiness pilot-readiness:blocked is PILOT_ACTIVATION_BLOCKED.'); },
  }, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_ACTIVE',
      readinessId: 'pilot-readiness:blocked',
      reason: 'Begin pilot.',
      confirmation: 'ACTIVATE PILOT',
    });
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'pilot_activation_readiness_blocked');
    assert.match(body.error.message, /PILOT_ACTIVATION_BLOCKED/);
    assert.equal(writes().length, 0);
    assert.equal(activations().length, 1);
  });
});

test('pilot activation delegates state mutation exclusively to persisted readiness command', async () => {
  await withServer({}, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_ACTIVE',
      readinessId: 'pilot-readiness:verified',
      reason: 'Readiness audit passed.',
      confirmation: 'ACTIVATE PILOT',
    });
    assert.equal(response.status, 200);
    assert.equal(writes().length, 0);
    assert.deepEqual(activations(), [{
      readinessId: 'pilot-readiness:verified',
      actor: 'human_executive',
      reason: 'Readiness audit passed.',
    }]);
  });
});

test('pilot deactivation remains directly available regardless of readiness', async () => {
  await withServer({}, async (baseUrl, writes, activations) => {
    const response = await post(baseUrl, {
      state: 'PILOT_DISABLED',
      reason: 'Human Executive emergency stop.',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(writes(), [{ state: 'PILOT_DISABLED', reason: 'Human Executive emergency stop.' }]);
    assert.equal(activations().length, 0);
  });
});
