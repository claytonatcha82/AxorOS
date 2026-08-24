import type { Pool } from 'pg';
import type { CoreAgentId } from '../agents/agent-runtime-contract.js';

export interface DashboardMoney {
  amountMinor: number;
  currency: string;
  available: boolean;
  note?: string;
}

export interface ExecutiveDashboardSnapshot {
  generatedAt: string;
  leads: {
    total: number;
    discoveredToday: number;
    discoveredLast7Days: number;
    qualified: number;
    engaged: number;
    converted: number;
    awaitingHumanReview: number;
  };
  sales: {
    contacted: number;
    contactedLast7Days: number;
    inboundReplies: number;
    interestedReplies: number;
    failedSends: number;
  };
  projects: {
    total: number;
    active: number;
    qa: number;
    awaitingApproval: number;
    delivered: number;
  };
  finance: {
    expectedIncome: DashboardMoney[];
    receivedIncome: DashboardMoney[];
    recurringIncome: DashboardMoney[];
    expectedExpenses: DashboardMoney[];
    projectedProfit: DashboardMoney[];
    pendingPaymentRequirements: number;
    financeClearances: number;
    note: string;
  };
  approvals: { pendingHumanExecutive: number };
  agents: Array<{
    agentId: CoreAgentId;
    totalExecutions: number;
    activeExecutions: number;
    completedExecutions: number;
    reviewExecutions: number;
    failedExecutions: number;
    latestActivityAt: string | null;
    latestObjective: string | null;
  }>;
  executiveUpdates: Array<{
    executionId: string;
    objective: string;
    status: string;
    updatedAt: string;
    summary: string | null;
  }>;
  recentActivity: Array<{
    eventType: string;
    actorType: string;
    actorId: string | null;
    createdAt: string;
  }>;
}

type Queryable = Pick<Pool, 'query'>;

const CORE_AGENTS: CoreAgentId[] = [
  'knowledge_agent', 'executive_agent', 'operations_agent', 'lead_agent', 'sales_agent',
  'production_agent', 'support_agent', 'marketing_agent', 'finance_agent',
];

function count(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

function moneyRows(rows: Record<string, unknown>[], amountKey: string): DashboardMoney[] {
  return rows.map((row) => ({
    amountMinor: Number(row[amountKey] ?? 0),
    currency: String(row.currency),
    available: true,
  }));
}

export function createExecutiveDashboardService(pool: Queryable) {
  return {
    async snapshot(): Promise<ExecutiveDashboardSnapshot> {
      const [leadResult, salesResult, projectResult, financeExpectedResult, financeReceivedResult,
        financeRequirementResult, financeClearanceResult, approvalResult, agentResult, executiveResult, activityResult] = await Promise.all([
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where created_at >= current_date)::int as discovered_today,
          count(*) filter (where created_at >= now() - interval '7 days')::int as discovered_last_7_days,
          count(*) filter (where status = 'qualified')::int as qualified,
          count(*) filter (where status = 'engaged')::int as engaged,
          count(*) filter (where status = 'converted')::int as converted,
          (select count(*)::int from operational.lead_preliminary_qualifications where human_review_required = true) as awaiting_human_review
        from operational.leads`, []),
        pool.query(`select
          count(*) filter (where event_type = 'sales_supervised_email_sent')::int as contacted,
          count(*) filter (where event_type = 'sales_supervised_email_sent' and created_at >= now() - interval '7 days')::int as contacted_last_7_days,
          (select count(*)::int from operational.sales_inbound_reply_evidence) as inbound_replies,
          (select count(*)::int from operational.sales_inbound_reply_classifications where primary_category in ('interested','positive','meeting_request','question')) as interested_replies,
          (select count(*)::int from operational.sales_email_send_attempts where status = 'failed') as failed_sends
        from operational.workflow_events`, []),
        pool.query(`select
          count(*)::int as total,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'qa')::int as qa,
          count(*) filter (where status = 'awaiting_approval')::int as awaiting_approval,
          count(*) filter (where status = 'delivered')::int as delivered
        from operational.projects`, []),
        pool.query(`select currency, coalesce(sum(required_amount_minor), 0)::bigint as amount_minor
          from finance.commercial_payment_requirements
          where status = 'ACTIVE'
          group by currency order by currency`, []),
        pool.query(`select currency, coalesce(sum(amount_minor), 0)::bigint as amount_minor
          from finance.clearance_decisions
          where state = 'FINANCE_CLEARED'
          group by currency order by currency`, []),
        pool.query(`select count(*)::int as pending from finance.commercial_payment_requirements where status = 'ACTIVE'`, []),
        pool.query(`select count(*)::int as cleared from finance.clearance_decisions where state = 'FINANCE_CLEARED'`, []),
        pool.query(`select count(*)::int as pending
          from runtime.agent_executions
          where status = 'review' and task->>'approvalRequired' = 'true' and task->>'approvalOwner' = 'human_executive'`, []),
        pool.query(`select destination_agent,
          count(*)::int as total_executions,
          count(*) filter (where status in ('queued','ready','in_progress','waiting','blocked'))::int as active_executions,
          count(*) filter (where status = 'completed')::int as completed_executions,
          count(*) filter (where status = 'review')::int as review_executions,
          count(*) filter (where status = 'failed')::int as failed_executions,
          max(persisted_at) as latest_activity_at,
          (array_agg(task->>'objective' order by persisted_at desc))[1] as latest_objective
        from runtime.agent_executions group by destination_agent`, []),
        pool.query(`select execution_id, task->>'objective' as objective, status, persisted_at,
          case when result is null then null else result->'output'->>'text' end as summary
        from runtime.agent_executions
        where destination_agent = 'executive_agent'
        order by persisted_at desc limit 8`, []),
        pool.query(`select event_type, actor_type, actor_id, created_at
          from operational.workflow_events order by created_at desc limit 20`, []),
      ]);

      const lead = leadResult.rows[0] as Record<string, unknown> | undefined;
      const sales = salesResult.rows[0] as Record<string, unknown> | undefined;
      const projects = projectResult.rows[0] as Record<string, unknown> | undefined;
      const agentRows = new Map((agentResult.rows as Record<string, unknown>[]).map((row) => [String(row.destination_agent), row]));
      const expectedIncome = moneyRows(financeExpectedResult.rows as Record<string, unknown>[], 'amount_minor');
      const receivedIncome = moneyRows(financeReceivedResult.rows as Record<string, unknown>[], 'amount_minor');

      return {
        generatedAt: new Date().toISOString(),
        leads: {
          total: count(lead, 'total'), discoveredToday: count(lead, 'discovered_today'),
          discoveredLast7Days: count(lead, 'discovered_last_7_days'), qualified: count(lead, 'qualified'),
          engaged: count(lead, 'engaged'), converted: count(lead, 'converted'),
          awaitingHumanReview: count(lead, 'awaiting_human_review'),
        },
        sales: {
          contacted: count(sales, 'contacted'), contactedLast7Days: count(sales, 'contacted_last_7_days'),
          inboundReplies: count(sales, 'inbound_replies'), interestedReplies: count(sales, 'interested_replies'),
          failedSends: count(sales, 'failed_sends'),
        },
        projects: {
          total: count(projects, 'total'), active: count(projects, 'active'), qa: count(projects, 'qa'),
          awaitingApproval: count(projects, 'awaiting_approval'), delivered: count(projects, 'delivered'),
        },
        finance: {
          expectedIncome,
          receivedIncome,
          recurringIncome: [{ amountMinor: 0, currency: 'ZAR', available: false, note: 'No authoritative recurring-revenue contract schedule is persisted yet.' }],
          expectedExpenses: [{ amountMinor: 0, currency: 'ZAR', available: false, note: 'No authoritative expense ledger is persisted yet.' }],
          projectedProfit: [{ amountMinor: 0, currency: 'ZAR', available: false, note: 'Unavailable until authoritative expense data exists.' }],
          pendingPaymentRequirements: count(financeRequirementResult.rows[0] as Record<string, unknown> | undefined, 'pending'),
          financeClearances: count(financeClearanceResult.rows[0] as Record<string, unknown> | undefined, 'cleared'),
          note: 'Expected income is active governed payment requirements. Received income is Finance-cleared payment evidence. Missing finance metrics are shown as unavailable rather than estimated.',
        },
        approvals: { pendingHumanExecutive: count(approvalResult.rows[0] as Record<string, unknown> | undefined, 'pending') },
        agents: CORE_AGENTS.map((agentId) => {
          const row = agentRows.get(agentId);
          return {
            agentId,
            totalExecutions: count(row, 'total_executions'), activeExecutions: count(row, 'active_executions'),
            completedExecutions: count(row, 'completed_executions'), reviewExecutions: count(row, 'review_executions'),
            failedExecutions: count(row, 'failed_executions'),
            latestActivityAt: row?.latest_activity_at ? new Date(String(row.latest_activity_at)).toISOString() : null,
            latestObjective: row?.latest_objective ? String(row.latest_objective) : null,
          };
        }),
        executiveUpdates: (executiveResult.rows as Record<string, unknown>[]).map((row) => ({
          executionId: String(row.execution_id), objective: String(row.objective ?? ''), status: String(row.status),
          updatedAt: new Date(String(row.persisted_at)).toISOString(), summary: row.summary === null ? null : String(row.summary),
        })),
        recentActivity: (activityResult.rows as Record<string, unknown>[]).map((row) => ({
          eventType: String(row.event_type), actorType: String(row.actor_type),
          actorId: row.actor_id === null ? null : String(row.actor_id), createdAt: new Date(String(row.created_at)).toISOString(),
        })),
      };
    },
  };
}

export type ExecutiveDashboardService = ReturnType<typeof createExecutiveDashboardService>;
