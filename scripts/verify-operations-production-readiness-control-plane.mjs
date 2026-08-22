import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pg from 'pg';
import { createControlPlaneRequestHandler } from '../apps/api/dist/control-plane-request-handler.js';
import { createOperationsProductionReadinessPostgresService } from '../apps/api/dist/agents/operations-production-readiness-postgres.js';
import { OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES } from '../apps/api/dist/agents/operations-production-prerequisite-evidence.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
const controlPlaneToken = 'operations-readiness-verifier-token-2026-08-22';
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'axoros-operations-readiness-control-plane-verify',
});
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const controlCenterUrl = 'http://127.0.0.1:5173';
const readinessIds = [];
const workflowEventIds = [];

const readinessService = createOperationsProductionReadinessPostgresService({ pool });
const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false }));
};
const handler = createControlPlaneRequestHandler({
  config: { controlCenterUrl, controlPlaneToken },
  productionCommand: {
    async execute() {
      throw new Error('Production execution is not part of this verifier.');
    },
  },
  operationsProductionReadinessCommand: readinessService,
  fallback,
});
const server = createServer(handler);

function assessment(label) {
  const readinessId = `operations-readiness:control-plane:${suffix}:${label}`;
  readinessIds.push(readinessId);
  return {
    readinessId,
    commercialRecordReference: `commercial:operations-readiness:${suffix}:${label}`,
    assessedAt: new Date().toISOString(),
  };
}

async function seedPrerequisites(commercialRecordReference, missingPrerequisite = null) {
  for (const [key, eventType] of Object.entries(OPERATIONS_PRODUCTION_PREREQUISITE_EVENT_TYPES)) {
    if (key === missingPrerequisite) continue;
    const result = await pool.query(
      `insert into operational.workflow_events (event_type, actor_type, actor_id, payload)
       values ($1, 'agent', 'operations_agent', $2::jsonb)
       returning id`,
      [eventType, JSON.stringify({ commercialRecordReference, verified: true })],
    );
    workflowEventIds.push(String(result.rows[0].id));
  }
}

async function post(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/v1/control/operations/production-readiness/assess`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${controlPlaneToken}`,
      'content-type': 'application/json',
      origin: controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function cleanup() {
  if (readinessIds.length > 0) {
    await pool.query(
      'delete from operations.production_readiness_decisions where readiness_id = any($1::text[])',
      [readinessIds],
    );
  }
  if (workflowEventIds.length > 0) {
    await pool.query(
      'delete from operational.workflow_events where id::text = any($1::text[])',
      [workflowEventIds],
    );
  }
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const readyAssessment = assessment('ready');
  await seedPrerequisites(readyAssessment.commercialRecordReference);
  const ready = await post(baseUrl, readyAssessment);
  assert.equal(ready.response.status, 200);
  assert.equal(ready.payload.ok, true);
  assert.equal(ready.payload.data.state, 'OPERATIONS_READY');
  assert.equal(ready.payload.data.persistence, 'accepted');

  const persistedReady = await readinessService.readinessStore.get(readyAssessment.readinessId);
  assert.ok(persistedReady);
  assert.equal(persistedReady.state, 'OPERATIONS_READY');
  assert.equal(persistedReady.approvedBy, 'operations_agent');
  assert.equal(persistedReady.commercialRecordReference, readyAssessment.commercialRecordReference);
  assert.equal(persistedReady.evidenceReferences.length, 4);
  assert.ok(persistedReady.evidenceReferences.every((reference) => reference.startsWith('workflow-event:')));

  const blockedAssessment = assessment('blocked');
  await seedPrerequisites(blockedAssessment.commercialRecordReference, 'assetsAvailable');
  const blocked = await post(baseUrl, blockedAssessment);
  assert.equal(blocked.response.status, 200);
  assert.equal(blocked.payload.ok, true);
  assert.equal(blocked.payload.data.state, 'OPERATIONS_BLOCKED');

  const persistedBlocked = await readinessService.readinessStore.get(blockedAssessment.readinessId);
  assert.ok(persistedBlocked);
  assert.equal(persistedBlocked.state, 'OPERATIONS_BLOCKED');
  assert.equal(persistedBlocked.assetsAvailable, false);

  const injectedAssessment = assessment('injected');
  await seedPrerequisites(injectedAssessment.commercialRecordReference);
  const injected = await post(baseUrl, {
    ...injectedAssessment,
    contractSigned: true,
    onboardingComplete: true,
    assetsAvailable: true,
    planningComplete: true,
    evidenceReferences: ['caller:forged'],
    state: 'OPERATIONS_READY',
    approvedBy: 'caller',
  });
  assert.equal(injected.response.status, 400);
  assert.equal(injected.payload.ok, false);
  assert.equal(injected.payload.error.code, 'invalid_operations_production_readiness_command');
  const injectedPersisted = await readinessService.readinessStore.get(injectedAssessment.readinessId);
  assert.equal(injectedPersisted, null);

  console.log('PASS  Authenticated Operations control plane derives READY/BLOCKED only from persisted prerequisite evidence and rejects caller-supplied prerequisite or authority fields.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup().catch((error) => {
    console.error(`WARN  verifier cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
  await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
