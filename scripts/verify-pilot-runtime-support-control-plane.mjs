import { createServer } from 'node:http';
import pg from 'pg';
import { applySupportEmailRuntimeApprovalPolicy } from '../apps/api/dist/agents/support-email-runtime-approval.js';
import { SUPPORT_EMAIL_DRAFT_CAPABILITY } from '../apps/api/dist/agents/support-email-capabilities.js';
import { createPersistedProductionRuntime } from '../apps/api/dist/agents/production-persisted-runtime.js';
import { createPilotRuntimeOperatorCommand } from '../apps/api/dist/agents/pilot-runtime-operator-command.js';
import { createConfiguredIntegrationRegistry } from '../apps/api/dist/integrations/integration-bootstrap.js';
import { createPilotRuntimeControlPlaneRequestHandler } from '../apps/api/dist/pilot-runtime-control-plane-request-handler.js';

const { Pool } = pg;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required via Infisical.`);
  return value;
};

const connectionString = required('AXOROS_DATABASE_URL');
const controlPlaneToken = required('AXOROS_CONTROL_PLANE_TOKEN');
const gmailClientId = required('AXOROS_GMAIL_CLIENT_ID');
const gmailClientSecret = required('AXOROS_GMAIL_CLIENT_SECRET');
const gmailRefreshToken = required('AXOROS_GMAIL_REFRESH_TOKEN');
const identitiesJson = required('AXOROS_GMAIL_IDENTITY_ADDRESSES');
let identityAddresses;
try { identityAddresses = JSON.parse(identitiesJson); } catch { throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be valid JSON.'); }
const supportAddress = typeof identityAddresses?.support === 'string' ? identityAddresses.support.trim() : '';
if (!supportAddress) throw new Error('A support Gmail identity is required.');

const config = {
  environment: 'development',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
  controlPlaneToken,
  gmailClientId,
  gmailClientSecret,
  gmailRefreshToken,
  gmailIdentityAddresses: identityAddresses,
};
const { registry, registeredIntegrationIds } = createConfiguredIntegrationRegistry(config);
if (!registeredIntegrationIds.includes('email.gmail')) throw new Error('Gmail integration was not registered.');

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-pilot-runtime-support-control-plane-verify' });
const runtime = createPersistedProductionRuntime({ pool, integrations: registry });
const operatorCommand = createPilotRuntimeOperatorCommand({ store: runtime.store, orchestrator: runtime.orchestrator });
const fallback = (_request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false, error: { code: 'not_found' } }));
};
const handler = createPilotRuntimeControlPlaneRequestHandler({ config, operatorCommand, fallback });
const server = createServer(handler);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const executionId = `support-pilot-control-${suffix}`;
const now = new Date().toISOString();
const rawTask = {
  taskId: `task-${executionId}`,
  executionId,
  originAgent: 'operations_agent',
  destinationAgent: 'support_agent',
  objective: 'Verify persisted Support Human Executive approval through the authenticated pilot control plane',
  priority: 'normal',
  context: { environment: 'development', controlledApprovalSmoke: true, recipientClass: 'self-test-mailbox' },
  knowledgeReferences: ['atlas://support/client-communication'],
  inputs: {
    fromIdentity: 'support',
    to: [{ email: supportAddress }],
    subject: '[AxorOS TEST] Pilot control-plane approved Support draft - DO NOT SEND',
    textBody: 'Synthetic AxorOS pilot control-plane Support verification. This draft must only exist after Human Executive approval. No client data was used. Do not send.',
  },
  expectedOutput: 'One approved Support Gmail draft',
  dependencies: [],
  risks: [],
  confidence: 1,
  approvalRequired: false,
  status: 'ready',
  nextAction: 'apply_support_email_policy',
  attempt: 1,
  maxAttempts: 1,
  correlationId: `corr-${executionId}`,
  createdAt: now,
  updatedAt: now,
};
const task = applySupportEmailRuntimeApprovalPolicy(rawTask);

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${controlPlaneToken}`,
      'content-type': 'application/json',
      origin: config.controlCenterUrl,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

try {
  await runtime.store.saveExecution({ task, version: 1, persistedAt: now }, 0);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Verification HTTP server did not expose a TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const review = await post(baseUrl, '/api/v1/control/runtime/execute', { executionId, capabilityId: SUPPORT_EMAIL_DRAFT_CAPABILITY });
  if (review.data?.status !== 'review' || review.data?.approvalOwner !== 'human_executive') {
    throw new Error(`Expected Support execution to stop in human_executive review, got ${JSON.stringify(review.data)}`);
  }
  const beforeApproval = await runtime.store.getExecution(executionId);
  if (beforeApproval?.result?.output?.draftId) throw new Error('A Gmail draft existed before Human Executive approval.');

  const approval = await post(baseUrl, '/api/v1/control/runtime/approval/resolve', {
    executionId,
    decision: 'approved',
    reason: 'Controlled self-recipient pilot verification approved for Gmail draft creation only.',
  });
  if (approval.data?.status !== 'ready' || approval.data?.approvalRequired !== false) {
    throw new Error(`Approved Support execution did not return to ready, got ${JSON.stringify(approval.data)}`);
  }

  const completed = await post(baseUrl, '/api/v1/control/runtime/execute', { executionId, capabilityId: SUPPORT_EMAIL_DRAFT_CAPABILITY });
  if (completed.data?.status !== 'completed' || completed.data?.resultStatus !== 'completed') {
    throw new Error(`Approved Support execution did not complete, got ${JSON.stringify(completed.data)}`);
  }
  const persisted = await runtime.store.getExecution(executionId);
  const draftId = persisted?.result?.output?.draftId;
  if (!draftId) throw new Error('Completed Support execution is missing Gmail draft evidence.');
  const events = await runtime.store.listEvents(executionId);
  if (!events.some((event) => event.type === 'approval_requested') || !events.some((event) => event.type === 'approval_granted')) {
    throw new Error('Persisted approval audit events are missing.');
  }

  console.log('PASS persisted Support runtime -> authenticated control plane -> Human Executive approval -> Gmail draft');
  console.log(`Execution ID: ${executionId}`);
  console.log(`Draft ID: ${draftId}`);
  console.log(`Audit events: ${events.length}`);
  console.log('No email was sent. No client data was used.');
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
