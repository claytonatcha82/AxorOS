import { createServer } from 'node:http';
import pg from 'pg';
import { createPilotSystemStateControlPlaneRequestHandler } from '../apps/api/dist/pilot-system-state-control-plane-request-handler.js';
import { PilotActivationReadinessPostgresStore } from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';
import { PilotSystemStatePostgresStore } from '../apps/api/dist/data/pilot-system-state-postgres-store.js';

const { Pool } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
}

const connectionString = required('AXOROS_DATABASE_URL');
const controlPlaneToken = required('AXOROS_CONTROL_PLANE_TOKEN');
const controlCenterUrl = 'http://localhost:5173';
const pool = new Pool({
  connectionString,
  max: 1,
  application_name: 'axoros-pilot-activation-control-plane-verify',
});
const pilotState = new PilotSystemStatePostgresStore(pool);
const readinessStore = new PilotActivationReadinessPostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readinessId = `pilot-readiness:control-plane:blocked:${suffix}`;
const assessedAt = new Date().toISOString();
const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false, error: { code: 'not_found' } }));
};
const handler = createPilotSystemStateControlPlaneRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  store: pilotState,
  fallback,
});
const server = createServer(handler);

async function post(baseUrl, bearer, body) {
  const response = await fetch(`${baseUrl}/api/v1/control/pilot/state`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      origin: controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

try {
  await readinessStore.save({
    readinessId,
    state: 'PILOT_ACTIVATION_BLOCKED',
    syntheticLifecycleVerified: true,
    persistedRuntimeVerified: true,
    financeIntegrityVerified: true,
    controlPlaneVerified: false,
    deploymentSafetyVerified: true,
    evidenceReferences: [
      'verify://synthetic-lifecycle',
      'verify://persisted-runtime',
      'verify://finance-integrity',
      'verify://deployment-safety',
      'verify://control-plane-intentionally-blocked',
    ],
    assessedBy: 'verification_script',
    assessedAt,
  });

  const before = await pilotState.get();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Verification HTTP server did not expose a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const command = {
    state: 'PILOT_ACTIVE',
    readinessId,
    reason: 'Synthetic blocked readiness control-plane verification.',
    confirmation: 'ACTIVATE PILOT',
  };

  const unauthorized = await post(baseUrl, `${controlPlaneToken}-wrong`, command);
  if (unauthorized.response.status !== 401 || unauthorized.payload?.error?.code !== 'control_plane_unauthorized') {
    throw new Error(`Expected unauthorized activation rejection, got ${unauthorized.response.status} ${JSON.stringify(unauthorized.payload)}`);
  }

  const blocked = await post(baseUrl, controlPlaneToken, command);
  if (blocked.response.status !== 409 || blocked.payload?.error?.code !== 'pilot_activation_readiness_blocked') {
    throw new Error(`Expected readiness activation rejection, got ${blocked.response.status} ${JSON.stringify(blocked.payload)}`);
  }

  const after = await pilotState.get();
  if (after.state !== before.state || after.version !== before.version || after.changedAt !== before.changedAt) {
    throw new Error(`Pilot state mutated during blocked verification: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  console.log('PASS  Pilot activation control plane is authenticated and fail closed.');
  console.log(`Blocked readiness ID: ${readinessId}`);
  console.log(`Pilot state remained ${after.state} at version ${after.version}.`);
  console.log('No pilot activation occurred.');
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await pool.query('delete from runtime.pilot_activation_readiness where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
