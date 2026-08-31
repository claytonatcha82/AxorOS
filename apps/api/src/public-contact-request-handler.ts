import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { OperationalRepository } from './data/operational-repository.js';

const PUBLIC_CONTACT_PATH = '/api/v1/public/contact';
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

export type PublicContactType = 'Project enquiries' | 'General enquiries' | 'Support';

const ROUTING: Readonly<Record<PublicContactType, string>> = {
  'Project enquiries': 'sales@axorosdigital.com',
  'General enquiries': 'support@axorosdigital.com',
  Support: 'support@axorosdigital.com',
};

export interface PublicContactRequestHandlerDependencies {
  repository: Pick<OperationalRepository, 'createLead' | 'createWorkflowEvent'>;
  fallback: RequestListener;
  allowedOrigins?: readonly string[];
  now?: () => number;
}

interface RateState {
  count: number;
  resetAt: number;
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
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('request_body_too_large');
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

function cleanText(value: unknown, field: string, max: number, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  if (normalized.length > max) throw new Error(`${field} exceeds ${max} characters.`);
  return normalized;
}

function emailAddress(value: unknown): string {
  const email = cleanText(value, 'email', 254)!;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email must be a valid email address.');
  return email.toLowerCase();
}

function contactType(value: unknown): PublicContactType {
  if (value === 'Project enquiries' || value === 'General enquiries' || value === 'Support') return value;
  throw new Error('type must be Project enquiries, General enquiries, or Support.');
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || request.socket.remoteAddress || 'unknown';
}

export function createPublicContactRequestHandler(
  dependencies: PublicContactRequestHandlerDependencies,
): RequestListener {
  const allowedOrigins = new Set(
    dependencies.allowedOrigins ?? ['https://axorosdigital.com', 'https://www.axorosdigital.com'],
  );
  const now = dependencies.now ?? Date.now;
  const rates = new Map<string, RateState>();

  return async (request, response) => {
    if (request.url !== PUBLIC_CONTACT_PATH) {
      dependencies.fallback(request, response);
      return;
    }

    const origin = request.headers.origin;
    const corsHeaders: Record<string, string> = { vary: 'Origin' };
    if (origin && allowedOrigins.has(origin)) {
      corsHeaders['access-control-allow-origin'] = origin;
      corsHeaders['access-control-allow-methods'] = 'POST,OPTIONS';
      corsHeaders['access-control-allow-headers'] = 'content-type,x-request-id';
    }

    if (request.method === 'OPTIONS') {
      if (!origin || !allowedOrigins.has(origin)) {
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

    if (origin && !allowedOrigins.has(origin)) {
      sendJson(response, 403, { ok: false, error: { code: 'cors_origin_denied', message: 'Origin is not allowed.' } }, corsHeaders);
      return;
    }

    const ip = clientIp(request);
    const timestamp = now();
    const state = rates.get(ip);
    if (!state || timestamp >= state.resetAt) {
      rates.set(ip, { count: 1, resetAt: timestamp + RATE_WINDOW_MS });
    } else if (state.count >= RATE_LIMIT) {
      sendJson(response, 429, { ok: false, error: { code: 'rate_limited', message: 'Too many enquiries. Please try again later.' } }, {
        'retry-after': String(Math.max(1, Math.ceil((state.resetAt - timestamp) / 1000))),
        ...corsHeaders,
      });
      return;
    } else {
      state.count += 1;
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

    try {
      const type = contactType(body.type);
      const fullName = cleanText(body.fullName, 'fullName', 120)!;
      const businessName = cleanText(body.businessName, 'businessName', 160, false);
      const email = emailAddress(body.email);
      const message = cleanText(body.message, 'message', 4000)!;
      const routedTo = ROUTING[type];

      let leadId: string | undefined;
      if (type === 'Project enquiries') {
        const lead = await dependencies.repository.createLead({
          companyName: businessName ?? fullName,
          contactName: fullName,
          contactEmail: email,
          source: 'website_contact',
          opportunitySummary: message,
          evidence: [{
            provider: 'axoros_website',
            contactType: type,
            routedTo,
          }],
        });
        leadId = lead.id;
      }

      const event = await dependencies.repository.createWorkflowEvent({
        eventType: 'public_contact_enquiry_received',
        actorType: 'client',
        actorId: email,
        payload: {
          type,
          fullName,
          ...(businessName ? { businessName } : {}),
          email,
          message,
          routedTo,
          ...(leadId ? { leadId } : {}),
          source: 'axorosdigital.com',
        },
      });

      sendJson(response, 202, {
        ok: true,
        data: {
          enquiryId: event.id,
          type,
          routedTo,
          ...(leadId ? { leadId } : {}),
          status: 'received',
        },
      }, corsHeaders);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Contact enquiry could not be accepted.';
      sendJson(response, 400, {
        ok: false,
        error: { code: 'invalid_contact_enquiry', message },
      }, corsHeaders);
    }
  };
}
