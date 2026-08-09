import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HealthResponse } from '@axoros/contracts';
import type { ApiConfig } from './config.js';

interface ErrorResponse {
  error: string;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: HealthResponse | ErrorResponse,
): void {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export function createRequestHandler(config: ApiConfig) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        const body: HealthResponse = {
          service: 'axoros-api',
          status: 'ok',
          environment: config.environment,
          timestamp: new Date().toISOString(),
        };

        sendJson(response, 200, body);
        return;
      }

      if (request.method === 'GET' && request.url === '/ready') {
        sendJson(response, 200, {
          service: 'axoros-api',
          status: 'ok',
          environment: config.environment,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch {
      sendJson(response, 500, { error: 'internal_server_error' });
    }
  };
}
