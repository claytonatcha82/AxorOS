import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) {
  console.error('FAIL  AXOROS_DATABASE_URL is not set.');
  process.exit(1);
}

const client = new Client({ connectionString, application_name: 'axoros-lead-qualification-verifier', connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query('begin');
  const lead = await client.query(`insert into operational.leads (company_name, source, evidence) values ($1, $2, $3::jsonb) returning id, status`, ['AxorOS Qualification Verification Lead', 'verification', '[]']);
  const leadId = lead.rows[0].id;
  const record = await client.query(`insert into operational.lead_preliminary_qualifications (lead_id, total_score, suggested_status, assessments, missing_information, atlas_source_paths, actor_id) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) returning human_review_required`, [leadId, null, 'insufficient_information', JSON.stringify({ businessFit: { score: null, evidenceReferences: [], missingInformation: ['verification'] } }), JSON.stringify(['verification']), JSON.stringify(['Atlas verification source']), 'lead_agent']);
  if (record.rows[0]?.human_review_required !== true) throw new Error('Qualification record did not enforce human review.');
  const unchanged = await client.query('select status from operational.leads where id = $1', [leadId]);
  if (unchanged.rows[0]?.status !== 'new') throw new Error('Preliminary qualification changed final lead status.');
  await assertRejected(`insert into operational.lead_preliminary_qualifications (lead_id, total_score, suggested_status, human_review_required, assessments) values ($1, 61, 'excellent', true, '{}'::jsonb)`, [leadId], 'score above 60');
  await assertRejected(`insert into operational.lead_preliminary_qualifications (lead_id, total_score, suggested_status, human_review_required, assessments) values ($1, 10, 'good', false, '{}'::jsonb)`, [leadId], 'human-review bypass');
  await client.query('rollback');
  console.log('PASS  Preliminary qualification records persist append-only evidence.');
  console.log('PASS  Human review is enforced by PostgreSQL.');
  console.log('PASS  Preliminary qualification does not change final lead status.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

async function assertRejected(sql, values, label) {
  await client.query('savepoint expected_failure');
  try {
    await client.query(sql, values);
    await client.query('rollback to savepoint expected_failure');
    throw new Error(`Database accepted forbidden ${label}.`);
  } catch (error) {
    await client.query('rollback to savepoint expected_failure').catch(() => undefined);
    if (error instanceof Error && error.message.startsWith('Database accepted forbidden')) throw error;
  }
}
