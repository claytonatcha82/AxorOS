import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { ApiConfig } from './config.js';

const PAYSTACK_WEBHOOK_PATH = '/api/v1/webhooks/paystack';
const MAX_PAYSTACK_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface PaystackWebhookIngressCommand {
  ingest(input: { rawBody: Buffer; signature: string | undefined }): Promise<unknown>;
}

export interface PaystackWebhookRequestHandlerDependencies {
  config: Pick<ApiConfig, 'paystackSecretKey'>;
  ingress?: PaystackWebhookIngressCommand;
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

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_PAYSTACK_WEBHOOK_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }

  if (chunks.length === 0) throw new Error('empty_request_body');
  return Buffer.concat(chunks);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return undefined;
}

export function createPaystackWebhookRequestHandler(
  dependencies: PaystackWebhookRequestHandlerDependencies,
): RequestListener {
  return async (request, response) => {
    if (request.url !== PAYSTACK_WEBHOOK_PATH) {
      dependencies.fallback(request, response);
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, {
        ok: false,
        error: { code: 'method_not_allowed', message: 'Method is not allowed.' },
      }, { allow: 'POST' });
      return;
    }

    if (!dependencies.config.paystackSecretKey || !dependencies.ingress) {
      sendJson(response, 503, {
        ok: false,
        error: { code: 'paystack_webhook_not_configured', message: 'Paystack webhook processing is not configured.' },
      });
      return;
    }

    const signature = firstHeaderValue(request.headers['x-paystack-signature']);
    if (!signature) {
      sendJson(response, 401, {
        ok: false,
        error: { code: 'paystack_signature_required', message: 'Paystack webhook signature is required.' },
      });
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_request_body';
      sendJson(response, code === 'request_body_too_large' ? 413 : 400, {
        ok: false,
        error: {
          code,
          message: code === 'request_body_too_large'
            ? 'Webhook request body exceeds the allowed size.'
            : 'Webhook request body is required.',
        },
      });
      return;
    }

    try {
      await dependencies.ingress.ingest({ rawBody, signature });
      response.writeHead(200, { 'cache-control': 'no-store', 'content-length': '0' });
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/signature/i.test(message)) {
        sendJson(response, 401, {
          ok: false,
          error: { code: 'paystack_signature_invalid', message: 'Paystack webhook authentication failed.' },
        });
        return;
      }
      if (/JSON|payload|commercial record|transaction reference|amount|currency|timestamp|event/i.test(message)) {
        sendJson(response, 400, {
          ok: false,
          error: { code: 'paystack_webhook_invalid', message: 'Paystack webhook payload is invalid.' },
        });
        return;
      }

      sendJson(response, 500, {
        ok: false,
        error: { code: 'paystack_webhook_processing_failed', message: 'Paystack webhook processing failed.' },
      });
    }
  };
}
