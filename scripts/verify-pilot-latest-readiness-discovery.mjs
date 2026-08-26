import { createServer } from 'node:http';
import pg from 'pg';

import { createPilotSystemStateControlPlaneRequestHandler } from '../apps/api/dist/pilot-system-state-control-plane-request-handler.js';
import { PilotActivationReadinessPostgresStore } from '../apps/api/dist/data/pilot-activation-readiness-postgres-store.js';
import { PilotVerificationEvidencePostgresStore } from '../apps/api/dist/data/pilot-verification-evidence-postgres-store.js';
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
const pool = new Pool({ connectionString, max: 2, application_name: 'axoros-pilot-latest-readiness-discovery-verify' });
const readinessStore = new PilotActivationReadinessPostgresStore(pool);
const evidenceStore = new PilotVerificationEvidencePostgresStore(pool);
const stateStore = new PilotSystemStatePostgresStore(pool);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const categories = ['SYNTHETIC_LIFECYCLE','PERSISTED_RUNTIME','FINANCE_INTEGRITY','CONTROL_PLANE','DEPLOYMENT_SAFETY'];
const evidenceIds = categories.map((category) => `pilot-evidence:latest-discovery:${category.toLowerCase()}:${suffix}`);
const readinessId = `pilot-readiness:latest-discovery:${suffix}`;
const assessedAt = new Date(Date.now() + 1000).toISOString();
const server = createServer(createPilotSystemStateControlPlaneRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  store: stateStore,
  fallback: (_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false }));
  },
}));

async function request(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${controlPlaneToken}`,
      origin: controlCenterUrl,
    },
  });
  return { response, payload: await response.json() };
}

const before = await stateStore.get();
if (before.state !== 'PILOT_DISABLED') throw new Error(`Verifier requires PILOT_DISABLED, found ${before.state}.`);

try {
  for (let index = 0; index < categories.length; index += 1) {
    await evidenceStore.save({
      evidenceId: evidenceIds[index],
      category: categories[index],
      outcome: 'PASS',
      verifier: 'verify-pilot-latest-readiness-discovery.mjs',
      sourceReference: `verification://latest-readiness/${categories[index].toLowerCase()}/${suffix}`,
      details: { latestReadinessDiscoveryVerification: true },
      verifiedAt: assessedAt,
    });
  }

  await readinessStore.save({
    readinessId,
    state: 'PILOT_ACTIVATION_READY',
    syntheticLifecycleVerified: true,
    persistedRuntimeVerified: true,
    financeIntegrityVerified: true,
    controlPlaneVerified: true,
    deploymentSafetyVerified: true,
    evidenceReferences: evidenceIds.map((id) => `pilot-verification:${id}`),
    assessedBy: 'verification_runner',
    assessedAt,
  });

  const directLatest = await readinessStore.getLatestReady();
  if (directLatest?.readinessId !== readinessId) {
    throw new Error(`PostgreSQL latest READY lookup returned ${directLatest?.readinessId ?? 'null'} instead of ${readinessId}.`);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Verifier server did not expose a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const preview = await request(baseUrl, '/api/v1/control/pilot/readiness-preview');
  if (preview.response.status !== 200 || preview.payload?.data?.readiness?.readinessId !== readinessId) {
    throw new Error(`Latest readiness preview failed: ${preview.response.status} ${JSON.stringify(preview.payload)}`);
  }
  if (!Array.isArray(preview.payload?.data?.evidence) || preview.payload.data.evidence.length !== 5) {
    throw new Error('Latest readiness preview did not return five persisted PASS receipts.');
  }

  const after = await stateStore.get();
  if (after.state !== before.state || after.version !== before.version || after.changedAt !== before.changedAt) {
    throw new Error(`Real pilot singleton changed during latest readiness discovery: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  const auditRows = await pool.query(
    `select action from runtime.pilot_activation_ceremony_audit where readiness_id = $1 order by recorded_at`,
    [readinessId],
  );
  if (auditRows.rows.length !== 1 || auditRows.rows[0].action !== 'PREVIEWED') {
    throw new Error(`Expected one PREVIEWED audit for latest readiness, got ${JSON.stringify(auditRows.rows)}.`);
  }

  console.log('PASS  PostgreSQL selected the latest persisted PILOT_ACTIVATION_READY assessment.');
  console.log('PASS  Control-plane readiness preview discovered it without a manually supplied readiness ID.');
  console.log('PASS  Latest readiness preview returned five persisted PASS receipts and was immutably audited.');
  console.log(`Discovered readiness ID: ${readinessId}`);
  console.log(`Real pilot state remained ${after.state} at version ${after.version}.`);
  console.log('No real pilot activation occurred.');
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await pool.query('delete from runtime.pilot_activation_ceremony_audit where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.query('delete from runtime.pilot_activation_readiness where readiness_id = $1', [readinessId]).catch(() => undefined);
  await pool.query('delete from runtime.pilot_verification_evidence where evidence_id = any($1::text[])', [evidenceIds]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
