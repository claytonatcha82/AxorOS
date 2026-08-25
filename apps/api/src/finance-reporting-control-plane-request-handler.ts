import { randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type {
  FinanceBillingPeriod,
  FinanceExpenseCategory,
  FinanceExpensePostgresStore,
  FinanceSubscriptionPostgresStore,
} from './data/finance-reporting-postgres-store.js';

const EXPENSE_PATH = '/api/v1/control/finance/reporting/expense';
const SUBSCRIPTION_PATH = '/api/v1/control/finance/reporting/subscription';
const MAX_BODY_BYTES = 8 * 1024;

const EXPENSE_CATEGORIES = new Set<FinanceExpenseCategory>([
  'DIRECT_PROJECT_COST', 'VARIABLE_OPERATING_COST', 'FIXED_OPERATING_COST', 'FOUNDER_EXPENSE',
  'REFUND', 'PAYMENT_PROCESSING_FEE', 'SOFTWARE', 'HOSTING', 'DOMAIN', 'AI', 'MARKETING',
  'ADMINISTRATION', 'PROFESSIONAL_SERVICES', 'OTHER',
]);
const BILLING_PERIODS = new Set<FinanceBillingPeriod>(['MONTHLY', 'QUARTERLY', 'ANNUAL']);

export interface FinanceReportingControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  expenses: Pick<FinanceExpensePostgresStore, 'save'>;
  subscriptions: Pick<FinanceSubscriptionPostgresStore, 'save'>;
  fallback: RequestListener;
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) throw new Error('invalid_json_body');
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function currency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || text(value);
}

function validExpense(body: Record<string, unknown>): boolean {
  const allowed = new Set([
    'category', 'vendor', 'description', 'amountMinor', 'currency', 'billingType', 'billingPeriod',
    'clientId', 'projectId', 'expenseDate', 'receiptReference', 'status', 'evidenceReference',
  ]);
  if (!Object.keys(body).every((key) => allowed.has(key))) return false;
  if (!text(body.category) || !EXPENSE_CATEGORIES.has(body.category as FinanceExpenseCategory)) return false;
  if (!text(body.vendor) || !text(body.description) || !positiveInteger(body.amountMinor) || !currency(body.currency)) return false;
  if (body.billingType !== 'ONE_TIME' && body.billingType !== 'RECURRING') return false;
  if (body.billingType === 'RECURRING') {
    if (!text(body.billingPeriod) || !BILLING_PERIODS.has(body.billingPeriod as FinanceBillingPeriod)) return false;
  } else if (body.billingPeriod !== undefined) return false;
  if (!optionalText(body.clientId) || !optionalText(body.projectId) || !date(body.expenseDate)) return false;
  if (!optionalText(body.receiptReference) || !text(body.evidenceReference)) return false;
  return body.status === 'PLANNED' || body.status === 'INCURRED' || body.status === 'PAID';
}

function validSubscription(body: Record<string, unknown>): boolean {
  const allowed = new Set([
    'clientId', 'service', 'billingFrequency', 'amountMinor', 'currency', 'startDate', 'nextBillingDate',
    'status', 'autoRenew', 'paymentMethodReference', 'invoicePolicy', 'cancellationDate',
    'commercialReference', 'evidenceReference',
  ]);
  if (!Object.keys(body).every((key) => allowed.has(key))) return false;
  if (!text(body.clientId) || !text(body.service) || !text(body.billingFrequency)
      || !BILLING_PERIODS.has(body.billingFrequency as FinanceBillingPeriod)) return false;
  if (!positiveInteger(body.amountMinor) || !currency(body.currency) || !date(body.startDate) || !date(body.nextBillingDate)) return false;
  if (!['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'].includes(String(body.status))) return false;
  if (typeof body.autoRenew !== 'boolean' || !optionalText(body.paymentMethodReference) || !text(body.invoicePolicy)) return false;
  if (body.cancellationDate !== undefined && !date(body.cancellationDate)) return false;
  return text(body.commercialReference) && text(body.evidenceReference);
}

export function createFinanceReportingControlPlaneRequestHandler(
  dependencies: FinanceReportingControlPlaneDependencies,
): RequestListener {
  return async (request, response) => {
    if (request.url !== EXPENSE_PATH && request.url !== SUBSCRIPTION_PATH) {
      dependencies.fallback(request, response);
      return;
    }

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin === dependencies.config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = dependencies.config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'POST,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'authorization,content-type,x-request-id';
    }

    if (request.method === 'OPTIONS') {
      if (origin && origin !== dependencies.config.controlCenterUrl) {
        sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
        return;
      }
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method is not allowed.' } }, { allow: 'POST,OPTIONS', ...corsHeaders });
      return;
    }

    const auth = authenticateControlPlaneRequest(request.headers.authorization, dependencies.config.controlPlaneToken);
    if (!auth.authenticated) {
      const notConfigured = auth.reason === 'not_configured';
      sendJson(response, notConfigured ? 503 : 401, {
        ok: false,
        error: {
          code: notConfigured ? 'control_plane_auth_not_configured' : 'control_plane_unauthorized',
          message: notConfigured ? 'Control-plane authentication is not configured.' : 'Authentication is required.',
        },
      }, { ...(notConfigured ? {} : { 'www-authenticate': 'Bearer' }), ...corsHeaders });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readBody(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_json_body';
      sendJson(response, code === 'request_body_too_large' ? 413 : 400, {
        ok: false,
        error: { code, message: code === 'request_body_too_large' ? 'Request body exceeds the allowed size.' : 'Request body must be a JSON object.' },
      }, corsHeaders);
      return;
    }

    try {
      if (request.url === EXPENSE_PATH) {
        if (!validExpense(body)) {
          sendJson(response, 400, { ok: false, error: { code: 'invalid_finance_expense_record', message: 'Expense fields are invalid or contain unsupported authority fields.' } }, corsHeaders);
          return;
        }
        const expenseId = `expense:control:${randomUUID()}`;
        const persistence = await dependencies.expenses.save({
          expenseId,
          category: body.category as FinanceExpenseCategory,
          vendor: String(body.vendor).trim(),
          description: String(body.description).trim(),
          amountMinor: Number(body.amountMinor),
          currency: String(body.currency),
          billingType: body.billingType as 'ONE_TIME' | 'RECURRING',
          ...(body.billingPeriod ? { billingPeriod: body.billingPeriod as FinanceBillingPeriod } : {}),
          ...(body.clientId ? { clientId: String(body.clientId).trim() } : {}),
          ...(body.projectId ? { projectId: String(body.projectId).trim() } : {}),
          expenseDate: String(body.expenseDate),
          ...(body.receiptReference ? { receiptReference: String(body.receiptReference).trim() } : {}),
          status: body.status as 'PLANNED' | 'INCURRED' | 'PAID',
          approvedBy: 'human_executive',
          evidenceReferences: [String(body.evidenceReference).trim()],
        });
        sendJson(response, 200, { ok: true, data: { expenseId, persistence } }, corsHeaders);
        return;
      }

      if (!validSubscription(body)) {
        sendJson(response, 400, { ok: false, error: { code: 'invalid_finance_subscription_record', message: 'Recurring-plan fields are invalid or contain unsupported authority fields.' } }, corsHeaders);
        return;
      }
      const subscriptionId = `subscription:control:${randomUUID()}`;
      const persistence = await dependencies.subscriptions.save({
        subscriptionId,
        clientId: String(body.clientId).trim(),
        service: String(body.service).trim(),
        billingFrequency: body.billingFrequency as FinanceBillingPeriod,
        amountMinor: Number(body.amountMinor),
        currency: String(body.currency),
        startDate: String(body.startDate),
        nextBillingDate: String(body.nextBillingDate),
        status: body.status as 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED',
        autoRenew: Boolean(body.autoRenew),
        ...(body.paymentMethodReference ? { paymentMethodReference: String(body.paymentMethodReference).trim() } : {}),
        invoicePolicy: String(body.invoicePolicy).trim(),
        ...(body.cancellationDate ? { cancellationDate: String(body.cancellationDate) } : {}),
        commercialReference: String(body.commercialReference).trim(),
        evidenceReferences: [String(body.evidenceReference).trim()],
        approvedBy: 'human_executive',
      });
      sendJson(response, 200, { ok: true, data: { subscriptionId, persistence } }, corsHeaders);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: { code: 'finance_reporting_record_rejected', message: error instanceof Error ? error.message : 'Finance reporting record was rejected.' },
      }, corsHeaders);
    }
  };
}
