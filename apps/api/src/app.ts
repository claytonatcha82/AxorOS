import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorResponse, ApiSuccessResponse, HealthResponse } from '@axoros/contracts';
import type { ApiConfig } from './config.js';
import { logEvent } from './logger.js';

type JsonBody = ApiSuccessResponse<unknown> | ApiErrorResponse | HealthResponse;

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: JsonBody,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): void {
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

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  headers: Record<string, string>,
): void {
  sendJson(
    response,
    statusCode,
    {
      ok: false,
      requestId,
      error: { code, message },
    },
    requestId,
    headers,
  );
}

export function createRequestHandler(config: ApiConfig) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const startedAt = performance.now();
    const requestId = request.headers['x-request-id']?.toString().trim() || randomUUID();
    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };

    response.once('finish', () => {
      logEvent('info', 'http_request_completed', {
        requestId,
        method: request.method,
        path: request.url,
        statusCode: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
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
        sendJson(response, 200, {
          service: 'axoros-api', status: 'ok', environment: config.environment, timestamp: new Date().toISOString(),
        }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/ready') {
        sendJson(response, 200, {
          service: 'axoros-api', status: 'ok', environment: config.environment, timestamp: new Date().toISOString(),
        }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/api/v1') {
        sendJson(response, 200, {
          ok: true,
          requestId,
          data: { service: 'axoros-api', apiVersion: 'v1', environment: config.environment },
        }, requestId, corsHeaders);
        return;
      }

      if (request.method === 'GET' && request.url === '/api/v1/meta') {
        sendJson(response, 200, {
          ok: true,
          requestId,
          data: {
            service: 'axoros-api',
            apiVersion: 'v1',
            environment: config.environment,
            nodeVersion: process.version,
          },
        }, requestId, corsHeaders);
        return;
      }

      sendError(response, 404, 'not_found', 'Route not found.', requestId, corsHeaders);
    } catch (error) {
      logEvent('error', 'http_request_unhandled_error', {
        requestId,
        method: request.method,
        path: request.url,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        sendError(response, 500, 'internal_server_error', 'Internal server error.', requestId, corsHeaders);
      } else {
        response.destroy();
      }
    }
  };
}
