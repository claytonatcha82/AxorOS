import fs from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required.');

const sql = await fs.readFile('infra/supabase/migrations/202608261730_pilot_activation_ceremony_audit.sql', 'utf8');
const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-pilot-activation-ceremony-audit-migration' });
try {
  await pool.query(sql);
  console.log('PASS  Pilot activation ceremony audit persistence migration applied.');
} finally {
  await pool.end().catch(() => undefined);
}
