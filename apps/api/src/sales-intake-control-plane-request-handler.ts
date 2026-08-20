import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AgentRuntimeExecutionRecord } from './agents/agent-runtime-state.js';
import type { RuntimeExecutionOutcome } from './agents/agent-runtime-orchestrator.js';
import { authenticateControlPlaneRequest } from './control-plane-auth.js';
import type { ApiConfig } from './config.js';
import type { WorkflowEventRecord } from './data/operational-repository.js';
import type {
  SalesOpportunityAssessment,
  SalesOpportunityContext,
} from './services/sales-opportunity-assessment-service.js';
import type { SalesSupervisedEmailExecution } from './services/sales-supervised-email-execution-service.js';

const SALES_INTAKE_ACTIVATE_PATH = '/api/v1/control/sales-intake/activate';
const SALES_INTAKE_PROCESS_PATH = '/api/v1/control/sales-intake/process';
const SALES_INTAKE_ASSESS_PATH = '/api/v1/control/sales-intake/assess';
const SALES_EMAIL_SEND_PATH = '/api/v1/control/sales-email/send';
const MAX_CONTROL_BODY_BYTES = 4 * 1024;

export interface SalesIntakeControlPlaneDependencies {
  config: Pick<ApiConfig, 'controlCenterUrl' | 'controlPlaneToken'>;
  salesIntakeCommand: {
    activateIntake(executionId: string): Promise<AgentRuntimeExecutionRecord>;
    processIntake(executionId: string): Promise<RuntimeExecutionOutcome>;
    assessOpportunity(executionId: string, salesContext?: SalesOpportunityContext): Promise<{
      assessment: SalesOpportunityAssessment;
      record: WorkflowEventRecord;
    }>;
  };
  salesEmailCommand?: {
    execute(sendGateRecordId: string): Promise<{
      execution: SalesSupervisedEmailExecution;
      record: WorkflowEventRecord;
    }>;
  };
  fallback: RequestListener;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
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
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_CONTROL_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('invalid_json_body');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('invalid_json_body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
  return parsed as Record<string, unknown>;
}

function validExecutionOnlyBody(body: Record<string, unknown>): body is { executionId: string } {
  const keys = Object.keys(body);
  return keys.length === 1
    && keys[0] === 'executionId'
    && typeof body.executionId === 'string'
    && Boolean(body.executionId.trim());
}

function validSendGateOnlyBody(body: Record<string, unknown>): body is { sendGateRecordId: string } {
  const keys = Object.keys(body);
  return keys.length === 1
    && keys[0] === 'sendGateRecordId'
    && typeof body.sendGateRecordId === 'string'
    && Boolean(body.sendGateRecordId.trim());
}

const SALES_CONTEXT_KEYS = new Set([
  'decisionMaker',
  'industry',
  'country',
  'businessSummary',
  'websiteAudit',
  'painPoints',
  'recommendedServices',
  'priority',
  'confidence',
  'previousContact',
]);

function validOptionalText(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && Boolean(value.trim()));
}

function validOptionalTextList(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === 'string' && Boolean(entry.trim()))
  );
}

function validSalesContext(value: unknown): value is SalesOpportunityContext {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const context = value as Record<string, unknown>;
  if (!Object.keys(context).every((key) => SALES_CONTEXT_KEYS.has(key))) return false;
  if (!validOptionalText(context.decisionMaker)) return false;
  if (!validOptionalText(context.industry)) return false;
  if (!validOptionalText(context.country)) return false;
  if (!validOptionalText(context.businessSummary)) return false;
  if (!validOptionalText(context.websiteAudit)) return false;
  if (!validOptionalTextList(context.painPoints)) return false;
  if (!validOptionalTextList(context.recommendedServices)) return false;
  if (!validOptionalText(context.priority)) return false;
  if (!validOptionalText(context.previousContact)) return false;
  if (
    context.confidence !== undefined
    && (typeof context.confidence !== 'number'
      || !Number.isFinite(context.confidence)
      || context.confidence < 0
      || context.confidence > 1)
  ) return false;
  return true;
}

function validAssessmentBody(
  body: Record<string, unknown>,
): body is { executionId: string; salesContext?: SalesOpportunityContext } {
  const keys = Object.keys(body);
  if (!keys.every((key) => key === 'executionId' || key === 'salesContext')) return false;
  if (!keys.includes('executionId')) return false;
  if (typeof body.executionId !== 'string' || !body.executionId.trim()) return false;
  return validSalesContext(body.salesContext);
}

function isSalesControlPath(path: string | undefined): boolean {
  return path === SALES_INTAKE_ACTIVATE_PATH
    || path === SALES_INTAKE_PROCESS_PATH
    || path === SALES_INTAKE_ASSESS_PATH
    || path === SALES_EMAIL_SEND_PATH;
}

export function createSalesIntakeControlPlaneRequestHandler(
  dependencies: SalesIntakeControlPlaneDependencies,
): RequestListener {
  return async (request, response) => {
    if (!isSalesControlPath(request.url)) {
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
        error: {
          code,
          message: code === 'request_body_too_large'
            ? 'Request body exceeds the allowed size.'
            : 'Request body must be a JSON object.',
        },
      }, corsHeaders);
      return;
    }

    if (request.url === SALES_EMAIL_SEND_PATH) {
      if (!validSendGateOnlyBody(body)) {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'invalid_sales_email_send_command',
            message: 'Request body must contain only a non-empty sendGateRecordId.',
          },
        }, corsHeaders);
        return;
      }

      if (!dependencies.salesEmailCommand) {
        sendJson(response, 503, {
          ok: false,
          error: {
            code: 'sales_email_send_not_configured',
            message: 'Supervised Sales email execution is not configured.',
          },
        }, corsHeaders);
        return;
      }

      try {
        const outcome = await dependencies.salesEmailCommand.execute(body.sendGateRecordId);
        sendJson(response, 200, {
          ok: true,
          data: {
            sendGateRecordId: outcome.execution.sendGateRecordId,
            draftRecordId: outcome.execution.draftRecordId,
            leadId: outcome.execution.leadId,
            sentRecordId: outcome.record.id,
            providerMessageId: outcome.execution.providerMessageId,
            supervised: outcome.execution.supervised,
            humanSendApprovalVerified: outcome.execution.humanSendApprovalVerified,
            sendExecuted: outcome.execution.sendExecuted,
            pricingAuthorised: outcome.execution.pricingAuthorised,
            commercialCommitmentAuthorised: outcome.execution.commercialCommitmentAuthorised,
            nextAction: outcome.execution.nextAction,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Supervised Sales email execution failed.';
        sendJson(response, 400, { ok: false, error: { code: 'sales_email_send_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (request.url === SALES_INTAKE_ASSESS_PATH) {
      if (!validAssessmentBody(body)) {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'invalid_sales_opportunity_assessment',
            message: 'Request body must contain executionId and only supported evidence-backed salesContext fields.',
          },
        }, corsHeaders);
        return;
      }

      try {
        const outcome = await dependencies.salesIntakeCommand.assessOpportunity(
          body.executionId,
          body.salesContext ?? {},
        );
        sendJson(response, 200, {
          ok: true,
          data: {
            executionId: outcome.assessment.salesIntakeExecutionId,
            leadId: outcome.assessment.leadId,
            assessmentRecordId: outcome.record.id,
            assessmentStatus: outcome.assessment.assessmentStatus,
            missingInformation: outcome.assessment.missingInformation,
            nextAction: outcome.assessment.nextAction,
            outreachAuthorised: outcome.assessment.outreachAuthorised,
            pricingAuthorised: outcome.assessment.pricingAuthorised,
            commercialCommitmentAuthorised: outcome.assessment.commercialCommitmentAuthorised,
          },
        }, corsHeaders);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sales opportunity assessment failed.';
        sendJson(response, 400, { ok: false, error: { code: 'sales_opportunity_assessment_rejected', message } }, corsHeaders);
      }
      return;
    }

    if (!validExecutionOnlyBody(body)) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: 'invalid_sales_intake_command',
          message: 'Request body must contain only a non-empty executionId.',
        },
      }, corsHeaders);
      return;
    }

    try {
      if (request.url === SALES_INTAKE_ACTIVATE_PATH) {
        const record = await dependencies.salesIntakeCommand.activateIntake(body.executionId);
        sendJson(response, 200, {
          ok: true,
          data: {
            executionId: record.task.executionId,
            status: record.task.status,
            nextAction: record.task.nextAction,
            salesDispatchAuthorised: record.task.inputs.salesDispatchAuthorised,
            outreachAuthorised: record.task.inputs.outreachAuthorised,
          },
        }, corsHeaders);
        return;
      }

      const outcome = await dependencies.salesIntakeCommand.processIntake(body.executionId);
      sendJson(response, 200, {
        ok: true,
        data: {
          executionId: outcome.record.task.executionId,
          status: outcome.record.task.status,
          resultStatus: outcome.record.result?.status ?? null,
          salesDispatchAuthorised: outcome.record.result?.output.salesDispatchAuthorised ?? false,
          outreachAuthorised: outcome.record.result?.output.outreachAuthorised ?? false,
          replayed: outcome.replayed,
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sales intake command failed.';
      sendJson(response, 400, { ok: false, error: { code: 'sales_intake_command_rejected', message } }, corsHeaders);
    }
  };
}
