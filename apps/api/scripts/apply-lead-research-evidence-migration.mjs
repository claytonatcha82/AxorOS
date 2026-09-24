import { Pool } from 'pg';

const connectionString = process.env.AXOROS_DATABASE_URL;
if (!connectionString) throw new Error('AXOROS_DATABASE_URL is required.');

const pool = new Pool({ connectionString, max: 1, application_name: 'axoros-lead-research-evidence-migration' });

const sql = `
create table if not exists operational.lead_research_evidence (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references operational.leads(id) on delete cascade,
  provider text not null check (length(trim(provider)) > 0),
  research_type text not null check (length(trim(research_type)) > 0),
  execution_id text not null check (length(trim(execution_id)) > 0),
  query text,
  title text not null check (length(trim(title)) > 0),
  url text not null check (length(trim(url)) > 0),
  content text not null check (length(trim(content)) > 0),
  score double precision,
  retrieved_at timestamptz not null default now(),
  unique (lead_id, provider, url)
);

create index if not exists lead_research_evidence_lead_retrieved_idx
  on operational.lead_research_evidence (lead_id, retrieved_at desc);

grant select, insert, update on operational.lead_research_evidence to axoros_api;

comment on table operational.lead_research_evidence is
  'Reusable public-web research evidence scoped to a lead. Provider-specific results are persisted as evidence and may be reused by Lead and Sales without re-running external research.';
`;

try {
  await pool.query(sql);
  const result = await pool.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'operational'
      and table_name = 'lead_research_evidence'
    order by ordinal_position
  `);
  console.log(JSON.stringify({
    level: 'info',
    event: 'lead_research_evidence_migration_ready',
    table: 'operational.lead_research_evidence',
    columnCount: result.rows.length,
  }));
} finally {
  await pool.end();
}
