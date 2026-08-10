import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorResponse, ApiSuccessResponse, HealthResponse } from '@axoros/contracts';
import type { ApiConfig } from './config.js';
import type { DatabaseHealth } from './database.js';
import type { KnowledgeContextRequest, KnowledgeContextService } from './knowledge/knowledge-context-service.js';
import type { KnowledgeRetrievalRequest, KnowledgeRetrievalService } from './knowledge/knowledge-retrieval-service.js';
import { logEvent } from './logger.js';
import { getMetricsSnapshot, recordHttpRequest, recordReadinessFailure } from './metrics.js';

type JsonBody = ApiSuccessResponse<unknown> | ApiErrorResponse | HealthResponse;
type DatabaseCheck = () => Promise<DatabaseHealth>;
type KnowledgeRetriever = Pick<KnowledgeRetrievalService, 'retrieve'>;
type KnowledgeContextAssembler = Pick<KnowledgeContextService, 'assemble'>;

const MAX_JSON_BODY_BYTES = 16 * 1024;

function sendJson(response: ServerResponse, statusCode: number, body: JsonBody, requestId: string, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-request-id': requestId,
    ...extraHeaders,
  });
  response.end(payload);
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string, requestId: string, headers: Record<string, string>): void {
  sendJson(response, statusCode, { ok: false, requestId, error: { code, message } }, requestId, headers);
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }

  if (chunks.length === 0) throw new Error('invalid_json_body');

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_body');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_json_body') throw error;
    throw new Error('invalid_json_body');
  }
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`invalid_${field}`);
  return value;
}

export function createRequestHandler(
  config: ApiConfig,
  checkDatabase?: DatabaseCheck,
  knowledgeRetriever?: KnowledgeRetriever,
  knowledgeContextAssembler?: KnowledgeContextAssembler,
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const startedAt = performance.now();
    const requestId = request.headers['x-request-id']?.toString().trim() || randomUUID();
    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };

    response.once('finish', () => {
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      recordHttpRequest(response.statusCode, durationMs);
      logEvent('info', 'http_request_completed', {
        requestId,
        method: request.method,
        path: request.url,
        statusCode: response.statusCode,
        durationMs,
      });
    });

    if (origin === config.controlCenterUrl) {
      corsHeaders['access-control-allow-origin'] = config.controlCenterUrl;
      corsHeaders['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'content-type,x-request-id';
    }

    try {
      if (request.method === 'OPTIONS') {
        if (origin && origin !== config.controlCenterUrl) {
          sendError(response, 403, 'cors_origin_denied', 'Origin is not allowed.', requestId, corsHeaders);
          return;
        }
        response.writeHead(204, { 'x-request-id': requestId, ...corsHeaders });
        response.end();
        return;
      }

      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { service: 'axoros-api', status: 'ok', environment: config.environment, timestamp: new Date().toISOString() }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/ready') {
        if (!checkDatabase) {
          recordReadinessFailure();
          logEvent('warn', 'readiness_check_failed', { requestId, dependency: 'database', reason: 'not_configured' });
          sendError(response, 503, 'database_not_configured', 'Database readiness check is not configured.', requestId, corsHeaders);
          return;
        }
        const database = await checkDatabase();
        if (!database.ok) {
          recordReadinessFailure();
          logEvent('warn', 'readiness_check_failed', { requestId, dependency: 'database', reason: 'unavailable', latencyMs: database.latencyMs });
          sendError(response, 503, 'database_unavailable', 'Database is unavailable.', requestId, corsHeaders);
          return;
        }
        sendJson(response, 200, {
          ok: true,
          requestId,
          data: { service: 'axoros-api', status: 'ok', environment: config.environment, database: { status: 'ok', latencyMs: database.latencyMs } },
        }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/api/v1') {
        sendJson(response, 200, { ok: true, requestId, data: { service: 'axoros-api', apiVersion: 'v1', environment: config.environment } }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/api/v1/meta') {
        sendJson(response, 200, { ok: true, requestId, data: { service: 'axoros-api', apiVersion: 'v1', environment: config.environment, nodeVersion: process.version } }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/api/v1/metrics') {
        sendJson(response, 200, { ok: true, requestId, data: getMetricsSnapshot() }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'POST' && request.url === '/api/v1/knowledge/retrieve') {
        if (!knowledgeRetriever) {
          sendError(response, 503, 'knowledge_retrieval_not_configured', 'Knowledge retrieval is not configured.', requestId, corsHeaders);
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = await readJsonObject(request);
        } catch (error) {
          const code = error instanceof Error ? error.message : 'invalid_json_body';
          if (code === 'request_body_too_large') sendError(response, 413, code, 'Request body exceeds the allowed size.', requestId, corsHeaders);
          else sendError(response, 400, 'invalid_json_body', 'Request body must be a JSON object.', requestId, corsHeaders);
          return;
        }

        try {
          const query = typeof body.query === 'string' ? body.query : '';
          const agent = typeof body.agent === 'string' ? body.agent : '';
          const task = typeof body.task === 'string' ? body.task : '';
          const limit = optionalInteger(body.limit, 'limit');
          const retrievalRequest: KnowledgeRetrievalRequest = {
            query,
            agent,
            task,
            maximumSecurityClassification: 'internal',
            ...(limit === undefined ? {} : { limit }),
          };
          const results = await knowledgeRetriever.retrieve(retrievalRequest);

          logEvent('info', 'knowledge_retrieval_completed', {
            requestId,
            agent: agent.trim().toLowerCase().replace(/[\s-]+/g, '_'),
            task: task.trim().toLowerCase().replace(/[\s-]+/g, '_'),
            resultCount: results.length,
          });

          sendJson(response, 200, { ok: true, requestId, data: { results } }, requestId, corsHeaders);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid knowledge retrieval request.';
          logEvent('warn', 'knowledge_retrieval_rejected', { requestId, reason: message });
          sendError(response, 400, 'invalid_knowledge_retrieval_request', message, requestId, corsHeaders);
        }
        return;
      }

      if (request.method === 'POST' && request.url === '/api/v1/knowledge/context') {
        if (!knowledgeContextAssembler) {
          sendError(response, 503, 'knowledge_context_not_configured', 'Knowledge context assembly is not configured.', requestId, corsHeaders);
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = await readJsonObject(request);
        } catch (error) {
          const code = error instanceof Error ? error.message : 'invalid_json_body';
          if (code === 'request_body_too_large') sendError(response, 413, code, 'Request body exceeds the allowed size.', requestId, corsHeaders);
          else sendError(response, 400, 'invalid_json_body', 'Request body must be a JSON object.', requestId, corsHeaders);
          return;
        }

        try {
          const query = typeof body.query === 'string' ? body.query : '';
          const agent = typeof body.agent === 'string' ? body.agent : '';
          const task = typeof body.task === 'string' ? body.task : '';
          const limit = optionalInteger(body.limit, 'limit');
          const maxCharacters = optionalInteger(body.maxCharacters, 'max_characters');
          const contextRequest: KnowledgeContextRequest = {
            query,
            agent,
            task,
            maximumSecurityClassification: 'internal',
            ...(limit === undefined ? {} : { limit }),
            ...(maxCharacters === undefined ? {} : { maxCharacters }),
          };
          const contextPackage = await knowledgeContextAssembler.assemble(contextRequest);

          logEvent('info', 'knowledge_context_assembled', {
            requestId,
            agent: agent.trim().toLowerCase().replace(/[\s-]+/g, '_'),
            task: task.trim().toLowerCase().replace(/[\s-]+/g, '_'),
            includedItems: contextPackage.includedItems,
            truncated: contextPackage.truncated,
            characterCount: contextPackage.characterCount,
          });

          sendJson(response, 200, { ok: true, requestId, data: contextPackage }, requestId, corsHeaders);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid knowledge context request.';
          logEvent('warn', 'knowledge_context_rejected', { requestId, reason: message });
          sendError(response, 400, 'invalid_knowledge_context_request', message, requestId, corsHeaders);
        }
        return;
      }

      sendError(response, 404, 'not_found', 'Route not found.', requestId, corsHeaders);
    } catch (error) {
      logEvent('error', 'http_request_unhandled_error', { requestId, method: request.method, path: request.url, error: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) sendError(response, 500, 'internal_server_error', 'Internal server error.', requestId, corsHeaders);
      else response.destroy();
    }
  };
}
