import type { Pool } from 'pg';
import type { CoreAgentId } from '../agents/agent-runtime-contract.js';

export interface DashboardMoney {
  amountMinor: number;
  currency: string;
  available: boolean;
  note?: string;
}

export interface SalesPipelineItem {
  leadId: string;
  company: string;
  contactName: string | null;
  contactEmail: string | null;
  qualificationScore: number | null;
  activity: 'ACTIVE' | 'REVIEW' | 'FAILED' | 'IDLE';
  stage: string;
  objective: string;
  assessmentStatus: 'context_complete' | 'context_incomplete' | null;
  missingInformation: string[];
  humanReviewRequired: boolean;
  outreachAuthorised: boolean;
  sendAuthorised: boolean;
  pricingAuthorised: boolean;
  commercialCommitmentAuthorised: boolean;
  lastUpdated: string;
  nextAction: string | null;
}

export interface ExecutiveDashboardSnapshot {
  generatedAt: string;
  clients: Array<{ clientId: string; displayName: string; status: string }>;
  leads: { total: number; discoveredToday: number; discoveredLast7Days: number; qualified: number; engaged: number; converted: number; awaitingHumanReview: number };
  sales: { contacted: number; contactedLast7Days: number; inboundReplies: number; interestedReplies: number; failedSends: number };
  salesPipeline: SalesPipelineItem[];
  projects: { total: number; active: number; qa: number; awaitingApproval: number; delivered: number };
  finance: { expectedIncome: DashboardMoney[]; receivedIncome: DashboardMoney[]; recurringIncome: DashboardMoney[]; expectedExpenses: DashboardMoney[]; projectedProfit: DashboardMoney[]; pendingPaymentRequirements: number; financeClearances: number; note: string };
  approvals: { pendingHumanExecutive: number };
  agents: Array<{ agentId: CoreAgentId; totalExecutions: number; activeExecutions: number; completedExecutions: number; reviewExecutions: number; failedExecutions: number; latestActivityAt: string | null; latestObjective: string | null }>;
  executiveUpdates: Array<{ executionId: string; objective: string; status: string; updatedAt: string; summary: string | null }>;
  recentActivity: Array<{ eventType: string; actorType: string; actorId: string | null; createdAt: string }>;
}

type Queryable = Pick<Pool, 'query'>;

const CORE_AGENTS: CoreAgentId[] = [
  'knowledge_agent', 'executive_agent', 'operations_agent', 'lead_agent', 'sales_agent',
  'production_agent', 'support_agent', 'marketing_agent', 'finance_agent',
];

function count(row: Record<string, unknown> | undefined, key: string): number { return Number(row?.[key] ?? 0); }
function moneyRows(rows: Record<string, unknown>[], amountKey: string): DashboardMoney[] {
  return rows.map((row) => ({ amountMinor: Number(row[amountKey] ?? 0), currency: String(row.currency), available: true }));
}

export function createExecutiveDashboardService(pool: Queryable) {
  return {
    async snapshot(): Promise<ExecutiveDashboardSnapshot> {
      const [clientResult, leadResult, salesResult, salesPipelineResult, projectResult, financeExpectedResult, financeReceivedResult,
        financeRecurringResult, financeExpenseResult, financeRequirementResult, financeClearanceResult,
        approvalResult, agentResult, executiveResult, activityResult] = await Promise.all([
        pool.query(`select id, display_name, status from operational.clients where status <> 'archived' order by display_name asc`, []),
        pool.query(`select count(*)::int as total, count(*) filter (where created_at >= current_date)::int as discovered_today, count(*) filter (where created_at >= now() - interval '7 days')::int as discovered_last_7_days, count(*) filter (where status = 'qualified')::int as qualified, count(*) filter (where status = 'engaged')::int as engaged, count(*) filter (where status = 'converted')::int as converted, (select count(*)::int from runtime.agent_executions where destination_agent = 'lead_agent' and status = 'review' and task->>'approvalRequired' = 'true' and task->>'approvalOwner' = 'human_executive') as awaiting_human_review from operational.leads`, []),
        pool.query(`select count(*) filter (where event_type = 'sales_supervised_email_sent')::int as contacted, count(*) filter (where event_type = 'sales_supervised_email_sent' and created_at >= now() - interval '7 days')::int as contacted_last_7_days, (select count(*)::int from operational.sales_inbound_reply_evidence) as inbound_replies, (select count(*)::int from operational.sales_inbound_reply_classifications where primary_category in ('positive_interest','information_request','pricing_or_commercial_question','meeting_request')) as interested_replies, (select count(*)::int from operational.sales_email_send_attempts where status = 'failed') as failed_sends from operational.workflow_events`, []),
        pool.query(`with latest as (select distinct on (payload->>'leadId') payload->>'leadId' as lead_id, coalesce(nullif(payload->>'company', ''), 'Lead ' || payload->>'leadId') as company, nullif(payload->>'contactName', '') as contact_name, nullif(payload->>'contactEmail', '') as contact_email, nullif(payload->>'existingLeadScore', '')::int as qualification_score, payload->>'assessmentStatus' as assessment_status, coalesce(payload->'missingInformation', '[]'::jsonb) as missing_information, event_type, created_at, coalesce(payload->>'nextAction', '') as next_action, event_type = 'sales_internal_outreach_draft_recorded' as draft_ready, coalesce((payload->>'humanReviewRequired')::boolean, false) as human_review_required, coalesce((payload->>'outreachAuthorised')::boolean, false) as outreach_authorised, coalesce((payload->>'sendAuthorised')::boolean, false) as send_authorised, coalesce((payload->>'pricingAuthorised')::boolean, false) as pricing_authorised, coalesce((payload->>'commercialCommitmentAuthorised')::boolean, false) as commercial_commitment_authorised from operational.workflow_events where actor_id = 'sales_agent' and payload ? 'leadId' and event_type in ('sales_opportunity_assessment_recorded','sales_internal_outreach_draft_recorded') order by payload->>'leadId', created_at desc) select lead_id, company, contact_name, contact_email, qualification_score, case when draft_ready then 'REVIEW' when assessment_status in ('context_incomplete','context_complete') then 'ACTIVE' else 'IDLE' end as activity, case when draft_ready then 'Outreach draft ready for Human Executive review' when assessment_status = 'context_incomplete' then 'Sales assessment incomplete · context retrieval / reassessment required' when assessment_status = 'context_complete' then 'Sales assessment complete · outreach preparation' else 'Sales intake / internal processing' end as stage, case when draft_ready then 'Prepare outreach draft for Human Executive review' when assessment_status = 'context_incomplete' then 'Retrieve missing Sales context and reassess' when assessment_status = 'context_complete' then 'Prepare governed outreach context' else 'Continue internal Sales processing' end as objective, assessment_status, missing_information, human_review_required, outreach_authorised, send_authorised, pricing_authorised, commercial_commitment_authorised, created_at, nullif(next_action, '') as next_action from latest order by created_at desc`, []),
        pool.query(`select count(*)::int as total, count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'qa')::int as qa, count(*) filter (where status = 'awaiting_approval')::int as awaiting_approval, count(*) filter (where status = 'delivered')::int as delivered from operational.projects`, []),
        pool.query(`select currency, coalesce(sum(required_amount_minor), 0)::bigint as amount_minor from finance.commercial_payment_requirements where status = 'ACTIVE' group by currency order by currency`, []),
        pool.query(`select currency, coalesce(sum(amount_minor), 0)::bigint as amount_minor from finance.clearance_decisions where state = 'FINANCE_CLEARED' group by currency order by currency`, []),
        pool.query(`select currency, round(sum(case billing_frequency when 'MONTHLY' then amount_minor::numeric when 'QUARTERLY' then amount_minor::numeric / 3 when 'ANNUAL' then amount_minor::numeric / 12 end))::bigint as amount_minor from finance.subscriptions where status = 'ACTIVE' group by currency order by currency`, []),
        pool.query(`select currency, round(sum(case when billing_type = 'RECURRING' then case billing_period when 'MONTHLY' then amount_minor::numeric when 'QUARTERLY' then amount_minor::numeric / 3 when 'ANNUAL' then amount_minor::numeric / 12 end when billing_type = 'ONE_TIME' and status = 'PLANNED' and expense_date >= date_trunc('month', current_date)::date and expense_date < (date_trunc('month', current_date) + interval '1 month')::date then amount_minor::numeric else 0 end))::bigint as amount_minor from finance.expenses where status <> 'CANCELLED' group by currency having sum(case when billing_type = 'RECURRING' then amount_minor::numeric when billing_type = 'ONE_TIME' and status = 'PLANNED' and expense_date >= date_trunc('month', current_date)::date and expense_date < (date_trunc('month', current_date) + interval '1 month')::date then amount_minor::numeric else 0 end) > 0 order by currency`, []),
        pool.query(`select count(*)::int as pending from finance.commercial_payment_requirements where status = 'ACTIVE'`, []),
        pool.query(`select count(*)::int as cleared from finance.clearance_decisions where state = 'FINANCE_CLEARED'`, []),
        pool.query(`select count(*)::int as pending from runtime.agent_executions where status = 'review' and task->>'approvalRequired' = 'true' and task->>'approvalOwner' = 'human_executive'`, []),
        pool.query(`select destination_agent, count(*)::int as total_executions, count(*) filter (where status in ('queued','ready','in_progress','waiting','blocked'))::int + case when destination_agent = 'sales_agent' then (select count(*)::int from operational.workflow_events where actor_id = 'sales_agent' and event_type = 'sales_opportunity_assessment_recorded' and payload->>'assessmentStatus' = 'context_incomplete' and created_at = (select max(created_at) from operational.workflow_events where actor_id = 'sales_agent' and event_type in ('sales_opportunity_assessment_recorded','sales_internal_outreach_draft_recorded'))) else 0 end as active_executions, count(*) filter (where status = 'completed')::int as completed_executions, count(*) filter (where status = 'review')::int + case when destination_agent = 'sales_agent' then (select count(*)::int from operational.workflow_events where actor_id = 'sales_agent' and event_type = 'sales_internal_outreach_draft_recorded') else 0 end as review_executions, count(*) filter (where status = 'failed')::int as failed_executions, greatest(max(persisted_at), (select max(created_at) from operational.workflow_events where actor_id = destination_agent)) as latest_activity_at, case when destination_agent = 'sales_agent' then coalesce((select case when event_type = 'sales_internal_outreach_draft_recorded' then concat('Outreach draft ready for human review · ', payload->>'company') when event_type = 'sales_opportunity_assessment_recorded' and payload->>'assessmentStatus' = 'context_incomplete' then concat('Sales assessment incomplete · ', payload->>'company') when event_type = 'sales_opportunity_assessment_recorded' then concat('Sales assessment complete · ', payload->>'company') end from operational.workflow_events where actor_id = 'sales_agent' and event_type in ('sales_opportunity_assessment_recorded','sales_internal_outreach_draft_recorded') order by created_at desc limit 1), (array_agg(task->>'objective' order by persisted_at desc))[1]) else (array_agg(task->>'objective' order by persisted_at desc))[1] end as latest_objective from runtime.agent_executions group by destination_agent`, []),
        pool.query(`select execution_id, task->>'objective' as objective, status, persisted_at, case when result is null then null else result->'output'->>'text' end as summary from runtime.agent_executions where destination_agent = 'executive_agent' order by persisted_at desc limit 8`, []),
        pool.query(`select case when event_type = 'sales_opportunity_assessment_recorded' and payload->>'assessmentStatus' = 'context_complete' then 'sales_followthrough_context_complete' when event_type = 'sales_opportunity_assessment_recorded' and payload->>'assessmentStatus' = 'context_incomplete' then 'sales_followthrough_context_incomplete' when event_type = 'sales_internal_outreach_draft_recorded' then 'sales_outreach_draft_ready_for_human_review' else event_type end as event_type, actor_type, actor_id, created_at from operational.workflow_events order by created_at desc limit 20`, []),
      ]);

      const lead = leadResult.rows[0] as Record<string, unknown> | undefined;
      const sales = salesResult.rows[0] as Record<string, unknown> | undefined;
      const projects = projectResult.rows[0] as Record<string, unknown> | undefined;
      const agentRows = new Map((agentResult.rows as Record<string, unknown>[]).map((row) => [String(row.destination_agent), row]));
      const expectedIncome = moneyRows(financeExpectedResult.rows as Record<string, unknown>[], 'amount_minor');
      const receivedIncome = moneyRows(financeReceivedResult.rows as Record<string, unknown>[], 'amount_minor');
      const recurringIncome = moneyRows(financeRecurringResult.rows as Record<string, unknown>[], 'amount_minor');
      const expectedExpenses = moneyRows(financeExpenseResult.rows as Record<string, unknown>[], 'amount_minor');

      return {
        generatedAt: new Date().toISOString(),
        clients: (clientResult.rows as Record<string, unknown>[]).map((row) => ({ clientId: String(row.id), displayName: String(row.display_name), status: String(row.status) })),
        leads: { total: count(lead, 'total'), discoveredToday: count(lead, 'discovered_today'), discoveredLast7Days: count(lead, 'discovered_last_7_days'), qualified: count(lead, 'qualified'), engaged: count(lead, 'engaged'), converted: count(lead, 'converted'), awaitingHumanReview: count(lead, 'awaiting_human_review') },
        sales: { contacted: count(sales, 'contacted'), contactedLast7Days: count(sales, 'contacted_last_7_days'), inboundReplies: count(sales, 'inbound_replies'), interestedReplies: count(sales, 'interested_replies'), failedSends: count(sales, 'failed_sends') },
        salesPipeline: (salesPipelineResult.rows as Record<string, unknown>[]).map((row) => ({ leadId: String(row.lead_id), company: String(row.company), contactName: row.contact_name === null ? null : String(row.contact_name), contactEmail: row.contact_email === null ? null : String(row.contact_email), qualificationScore: row.qualification_score === null ? null : Number(row.qualification_score), activity: String(row.activity) as SalesPipelineItem['activity'], stage: String(row.stage), objective: String(row.objective), assessmentStatus: row.assessment_status === null ? null : String(row.assessment_status) as SalesPipelineItem['assessmentStatus'], missingInformation: Array.isArray(row.missing_information) ? (row.missing_information as unknown[]).map(String) : [], humanReviewRequired: Boolean(row.human_review_required), outreachAuthorised: Boolean(row.outreach_authorised), sendAuthorised: Boolean(row.send_authorised), pricingAuthorised: Boolean(row.pricing_authorised), commercialCommitmentAuthorised: Boolean(row.commercial_commitment_authorised), lastUpdated: new Date(String(row.created_at)).toISOString(), nextAction: row.next_action === null ? null : String(row.next_action) })),
        projects: { total: count(projects, 'total'), active: count(projects, 'active'), qa: count(projects, 'qa'), awaitingApproval: count(projects, 'awaiting_approval'), delivered: count(projects, 'delivered') },
        finance: { expectedIncome, receivedIncome, recurringIncome, expectedExpenses, projectedProfit: [{ amountMinor: 0, currency: 'ZAR', available: false, note: 'Unavailable until AxorOS has an authoritative period-based profitability basis that prevents recurring-revenue/payment-requirement double counting.' }], pendingPaymentRequirements: count(financeRequirementResult.rows[0] as Record<string, unknown> | undefined, 'pending'), financeClearances: count(financeClearanceResult.rows[0] as Record<string, unknown> | undefined, 'cleared'), note: 'Expected income is active governed payment requirements. Received income is Finance-cleared payment evidence. Recurring income is monthly-equivalent ACTIVE subscription value. Expected expenses are recurring monthly-equivalent costs plus one-time PLANNED costs due this month.' },
        approvals: { pendingHumanExecutive: count(approvalResult.rows[0] as Record<string, unknown> | undefined, 'pending') },
        agents: CORE_AGENTS.map((agentId) => { const row = agentRows.get(agentId); return { agentId, totalExecutions: count(row, 'total_executions'), activeExecutions: count(row, 'active_executions'), completedExecutions: count(row, 'completed_executions'), reviewExecutions: count(row, 'review_executions'), failedExecutions: count(row, 'failed_executions'), latestActivityAt: row?.latest_activity_at ? new Date(String(row.latest_activity_at)).toISOString() : null, latestObjective: row?.latest_objective ? String(row.latest_objective) : null }; }),
        executiveUpdates: (executiveResult.rows as Record<string, unknown>[]).map((row) => ({ executionId: String(row.execution_id), objective: String(row.objective ?? ''), status: String(row.status), updatedAt: new Date(String(row.persisted_at)).toISOString(), summary: row.summary === null ? null : String(row.summary) })),
        recentActivity: (activityResult.rows as Record<string, unknown>[]).map((row) => ({ eventType: String(row.event_type), actorType: String(row.actor_type), actorId: row.actor_id === null ? null : String(row.actor_id), createdAt: new Date(String(row.created_at)).toISOString() })),
      };
    },
  };
}

export type ExecutiveDashboardService = ReturnType<typeof createExecutiveDashboardService>;
