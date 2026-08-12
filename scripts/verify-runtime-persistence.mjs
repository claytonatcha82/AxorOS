import pg from 'pg';
import { createAgentRuntimePostgresStore } from '../apps/api/dist/data/agent-runtime-postgres-store.js';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;

if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const executionId = `smoke-exec-${suffix}`;
const taskId = `smoke-task-${suffix}`;
const eventId = `smoke-event-${suffix}`;
const correlationId = `smoke-corr-${suffix}`;
const idempotencyKey = `runtime:${executionId}:smoke`;
const now = new Date().toISOString();

const task = {
  taskId,
  executionId,
  originAgent: 'operations_agent',
  destinationAgent: 'knowledge_agent',
  objective: 'Verify durable runtime persistence',
  priority: 'normal',
  context: {},
  knowledgeReferences: [],
  inputs: {},
  expectedOutput: 'Persisted runtime execution',
  dependencies: [],
  risks: [],
  confidence: 1,
  approvalRequired: false,
  status: 'ready',
  nextAction: 'Verify persistence',
  attempt: 1,
  maxAttempts: 3,
  correlationId,
  createdAt: now,
  updatedAt: now,
};

const record = { task, version: 1, persistedAt: now };
const event = {
  eventId,
  executionId,
  taskId,
  correlationId,
  type: 'dispatch_requested',
  actor: 'runtime',
  payload: { smokeTest: true },
  idempotencyKey,
  occurredAt: now,
};
const idempotencyRecord = {
  idempotencyKey,
  executionId,
  eventId,
  operation: 'smoke_test',
  firstSeenAt: now,
  completed: true,
};

let pool = new Pool({ connectionString, max: 1, application_name: 'axoros-runtime-smoke-write' });

try {
  const store = createAgentRuntimePostgresStore(pool);
  await store.saveExecution(record, 0);
  await store.appendEvent(event);
  await store.saveIdempotencyRecord(idempotencyRecord);
  await pool.end();

  pool = new Pool({ connectionString, max: 1, application_name: 'axoros-runtime-smoke-read' });
  const restartedStore = createAgentRuntimePostgresStore(pool);
  const persisted = await restartedStore.getExecution(executionId);
  const events = await restartedStore.listEvents(executionId);
  const idempotent = await restartedStore.hasIdempotencyKey(idempotencyKey);

  if (!persisted || persisted.task.executionId !== executionId || persisted.version !== 1) throw new Error('execution did not survive pool restart.');
  if (events.length !== 1 || events[0]?.eventId !== eventId) throw new Error('runtime event was not persisted correctly.');
  if (!idempotent) throw new Error('idempotency record was not persisted correctly.');

  console.log('PASS  Runtime execution survived database connection restart.');
  console.log('PASS  Runtime audit event persisted.');
  console.log('PASS  Runtime idempotency record persisted.');
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.query('delete from runtime.agent_events where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.idempotency_records where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.query('delete from runtime.agent_executions where execution_id = $1', [executionId]).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
