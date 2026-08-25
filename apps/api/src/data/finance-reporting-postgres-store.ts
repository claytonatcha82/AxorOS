import type { Pool } from 'pg';

export type FinanceExpenseCategory =
  | 'DIRECT_PROJECT_COST' | 'VARIABLE_OPERATING_COST' | 'FIXED_OPERATING_COST' | 'FOUNDER_EXPENSE'
  | 'REFUND' | 'PAYMENT_PROCESSING_FEE' | 'SOFTWARE' | 'HOSTING' | 'DOMAIN' | 'AI'
  | 'MARKETING' | 'ADMINISTRATION' | 'PROFESSIONAL_SERVICES' | 'OTHER';
export type FinanceBillingPeriod = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export type FinanceExpenseStatus = 'PLANNED' | 'INCURRED' | 'PAID' | 'CANCELLED';
export type FinanceSubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

export interface FinanceExpenseRecord {
  expenseId: string;
  category: FinanceExpenseCategory;
  vendor: string;
  description: string;
  amountMinor: number;
  currency: string;
  billingType: 'ONE_TIME' | 'RECURRING';
  billingPeriod?: FinanceBillingPeriod;
  clientId?: string;
  projectId?: string;
  expenseDate: string;
  receiptReference?: string;
  status: FinanceExpenseStatus;
  approvedBy: string;
  evidenceReferences: string[];
}

export interface FinanceSubscriptionRecord {
  subscriptionId: string;
  clientId: string;
  service: string;
  billingFrequency: FinanceBillingPeriod;
  amountMinor: number;
  currency: string;
  startDate: string;
  nextBillingDate: string;
  status: FinanceSubscriptionStatus;
  autoRenew: boolean;
  paymentMethodReference?: string;
  invoicePolicy: string;
  cancellationDate?: string;
  commercialReference: string;
  evidenceReferences: string[];
  approvedBy: string;
}

export class FinanceReportingIntegrityConflictError extends Error {
  constructor(kind: 'expense' | 'subscription', id: string) {
    super(`Finance ${kind} integrity conflict for ${id}.`);
    this.name = 'FinanceReportingIntegrityConflictError';
  }
}

function expenseCanonical(record: FinanceExpenseRecord): string {
  return JSON.stringify([
    record.expenseId, record.category, record.vendor, record.description, record.amountMinor, record.currency,
    record.billingType, record.billingPeriod ?? null, record.clientId ?? null, record.projectId ?? null,
    record.expenseDate, record.receiptReference ?? null, record.status, record.approvedBy,
    record.evidenceReferences,
  ]);
}

function subscriptionCanonical(record: FinanceSubscriptionRecord): string {
  return JSON.stringify([
    record.subscriptionId, record.clientId, record.service, record.billingFrequency, record.amountMinor,
    record.currency, record.startDate, record.nextBillingDate, record.status, record.autoRenew,
    record.paymentMethodReference ?? null, record.invoicePolicy, record.cancellationDate ?? null,
    record.commercialReference, record.evidenceReferences, record.approvedBy,
  ]);
}

function parseStringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error('Persisted Finance reporting evidence is invalid.');
  }
  return parsed.map((item) => item.trim());
}

function dateOnly(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const directDate = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(trimmed)?.[1];
    if (directDate) return directDate;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error('Persisted Finance reporting date is invalid.');
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class FinanceExpensePostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(expenseId: string): Promise<FinanceExpenseRecord | null> {
    const result = await this.pool.query(
      `select expense_id, category, vendor, description, amount_minor, currency, billing_type,
              billing_period, client_id, project_id, expense_date, receipt_reference, status,
              approved_by, evidence_references
         from finance.expenses where expense_id = $1 limit 1`,
      [expenseId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      expenseId: String(row.expense_id),
      category: String(row.category) as FinanceExpenseCategory,
      vendor: String(row.vendor),
      description: String(row.description),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      billingType: String(row.billing_type) as 'ONE_TIME' | 'RECURRING',
      ...(row.billing_period === null ? {} : { billingPeriod: String(row.billing_period) as FinanceBillingPeriod }),
      ...(row.client_id === null ? {} : { clientId: String(row.client_id) }),
      ...(row.project_id === null ? {} : { projectId: String(row.project_id) }),
      expenseDate: dateOnly(row.expense_date),
      ...(row.receipt_reference === null ? {} : { receiptReference: String(row.receipt_reference) }),
      status: String(row.status) as FinanceExpenseStatus,
      approvedBy: String(row.approved_by),
      evidenceReferences: parseStringArray(row.evidence_references),
    };
  }

  async save(record: FinanceExpenseRecord): Promise<'accepted' | 'duplicate'> {
    if (record.approvedBy !== 'human_executive') throw new Error('Finance expense persistence requires Human Executive approval provenance.');
    if (!record.evidenceReferences.length) throw new Error('Finance expense persistence requires evidence references.');
    const result = await this.pool.query(
      `insert into finance.expenses
        (expense_id, category, vendor, description, amount_minor, currency, billing_type, billing_period,
         client_id, project_id, expense_date, receipt_reference, status, approved_by, evidence_references)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       on conflict (expense_id) do nothing returning expense_id`,
      [record.expenseId, record.category, record.vendor, record.description, record.amountMinor, record.currency,
       record.billingType, record.billingPeriod ?? null, record.clientId ?? null, record.projectId ?? null,
       record.expenseDate, record.receiptReference ?? null, record.status, record.approvedBy,
       JSON.stringify(record.evidenceReferences)],
    );
    if (result.rowCount === 1) return 'accepted';
    const existing = await this.get(record.expenseId);
    if (!existing || expenseCanonical(existing) !== expenseCanonical(record)) {
      throw new FinanceReportingIntegrityConflictError('expense', record.expenseId);
    }
    return 'duplicate';
  }
}

export class FinanceSubscriptionPostgresStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async get(subscriptionId: string): Promise<FinanceSubscriptionRecord | null> {
    const result = await this.pool.query(
      `select subscription_id, client_id, service, billing_frequency, amount_minor, currency,
              start_date, next_billing_date, status, auto_renew, payment_method_reference,
              invoice_policy, cancellation_date, commercial_reference, evidence_references, approved_by
         from finance.subscriptions where subscription_id = $1 limit 1`,
      [subscriptionId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      subscriptionId: String(row.subscription_id),
      clientId: String(row.client_id),
      service: String(row.service),
      billingFrequency: String(row.billing_frequency) as FinanceBillingPeriod,
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      startDate: dateOnly(row.start_date),
      nextBillingDate: dateOnly(row.next_billing_date),
      status: String(row.status) as FinanceSubscriptionStatus,
      autoRenew: Boolean(row.auto_renew),
      ...(row.payment_method_reference === null ? {} : { paymentMethodReference: String(row.payment_method_reference) }),
      invoicePolicy: String(row.invoice_policy),
      ...(row.cancellation_date === null ? {} : { cancellationDate: dateOnly(row.cancellation_date) }),
      commercialReference: String(row.commercial_reference),
      evidenceReferences: parseStringArray(row.evidence_references),
      approvedBy: String(row.approved_by),
    };
  }

  async save(record: FinanceSubscriptionRecord): Promise<'accepted' | 'duplicate'> {
    if (record.approvedBy !== 'human_executive') throw new Error('Finance subscription persistence requires Human Executive approval provenance.');
    if (!record.evidenceReferences.length) throw new Error('Finance subscription persistence requires evidence references.');
    const result = await this.pool.query(
      `insert into finance.subscriptions
        (subscription_id, client_id, service, billing_frequency, amount_minor, currency, start_date,
         next_billing_date, status, auto_renew, payment_method_reference, invoice_policy,
         cancellation_date, commercial_reference, evidence_references, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
       on conflict (subscription_id) do nothing returning subscription_id`,
      [record.subscriptionId, record.clientId, record.service, record.billingFrequency, record.amountMinor,
       record.currency, record.startDate, record.nextBillingDate, record.status, record.autoRenew,
       record.paymentMethodReference ?? null, record.invoicePolicy, record.cancellationDate ?? null,
       record.commercialReference, JSON.stringify(record.evidenceReferences), record.approvedBy],
    );
    if (result.rowCount === 1) return 'accepted';
    const existing = await this.get(record.subscriptionId);
    if (!existing || subscriptionCanonical(existing) !== subscriptionCanonical(record)) {
      throw new FinanceReportingIntegrityConflictError('subscription', record.subscriptionId);
    }
    return 'duplicate';
  }
}