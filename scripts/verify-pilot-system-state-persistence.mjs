import pg from 'pg';
import { PilotSystemStatePostgresStore } from '../apps/api/dist/data/pilot-system-state-postgres-store.js';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-pilot-state-verify' });

try {
  await client.connect();
  await client.query('begin');
  const store = new PilotSystemStatePostgresStore(client);

  const initial = await store.get();
  if (initial.state !== 'PILOT_DISABLED') {
    throw new Error(`Expected fail-closed PILOT_DISABLED initial state, received ${initial.state}.`);
  }

  const activated = await store.set('PILOT_ACTIVE', 'verification', 'Transactional pilot-state verification only.');
  if (activated.state !== 'PILOT_ACTIVE') throw new Error('Pilot state did not transition to PILOT_ACTIVE inside verification transaction.');
  if (activated.version <= initial.version) throw new Error('Pilot state version did not increment on activation.');

  const disabled = await store.set('PILOT_DISABLED', 'verification', 'Return to fail-closed state inside verification transaction.');
  if (disabled.state !== 'PILOT_DISABLED') throw new Error('Pilot state did not transition back to PILOT_DISABLED inside verification transaction.');
  if (disabled.version <= activated.version) throw new Error('Pilot state version did not increment on deactivation.');

  await client.query('rollback');
  console.log('PASS  Pilot system state persistence, versioning, activation, and fail-closed deactivation verified transactionally.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
