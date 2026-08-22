import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import type { EmailDraftOutput, EmailIntegration, EmailMessageInput } from './email-integration.js';
import { validateEmailMessage } from './email-integration.js';
import { assertAgentMayUseEmailIdentity } from './email-identity-policy.js';

export interface GmailDraftIntegrationOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  identityAddresses: Readonly<Record<string, string>>;
  allowSupervisedSalesSend?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GmailThreadMessageEvidence {
  messageId: string;
  threadReference: string;
  from?: string;
  to?: string;
  subject?: string;
  internalDate?: string;
  snippet?: string;
  textBody?: string;
  deliveryStatusNotification?: boolean;
}

export interface GmailThreadEvidence {
  threadReference: string;
  messages: readonly GmailThreadMessageEvidence[];
}

export interface GmailEmailIntegration extends EmailIntegration {
  readThread(threadReference: string): Promise<GmailThreadEvidence>;
}

interface GmailTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GmailDraftResponse {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GmailMessagePart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailThreadMessageResponse {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePart;
}

interface GmailThreadResponse {
  id?: string;
  messages?: GmailThreadMessageResponse[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function formatAddress(name: string | undefined, email: string): string {
  if (!name?.trim()) return email;
  const safeName = name.replace(/[\r\n\"]/g, '').trim();
  return `\"${safeName}\" <${email}>`;
}

function buildMimeMessage(input: EmailMessageInput, fromAddress: string): string {
  const headers = [
    `From: ${fromAddress}`,
    `To: ${input.to.map((recipient) => formatAddress(recipient.name, recipient.email)).join(', ')}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.map((recipient) => formatAddress(recipient.name, recipient.email)).join(', ')}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.map((recipient) => formatAddress(recipient.name, recipient.email)).join(', ')}`] : []),
    `Subject: ${input.subject.replace(/[\r\n]/g, ' ').trim()}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    'MIME-Version: 1.0',
  ];

  if (!input.htmlBody) {
    return [...headers, 'Content-Type: text/plain; charset=UTF-8', '', input.textBody].join('\r\n');
  }

  const boundary = `axoros_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    input.textBody,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    input.htmlBody,
    `--${boundary}--`,
  ].join('\r\n');
}

function headerValue(part: GmailMessagePart | undefined, name: string): string | undefined {
  const value = part?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim();
  return value || undefined;
}

function textBody(part: GmailMessagePart | undefined): string | undefined {
  if (!part) return undefined;
  if ((!part.mimeType || part.mimeType === 'text/plain') && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data).trim();
    if (decoded) return decoded;
  }

  for (const child of part.parts ?? []) {
    if (child.mimeType === 'text/plain') {
      const decoded = textBody(child);
      if (decoded) return decoded;
    }
  }

  for (const child of part.parts ?? []) {
    const decoded = textBody(child);
    if (decoded) return decoded;
  }

  return undefined;
}

function containsMimeType(part: GmailMessagePart | undefined, mimeType: string): boolean {
  if (!part) return false;
  if (part.mimeType?.toLowerCase() === mimeType.toLowerCase()) return true;
  return (part.parts ?? []).some((child) => containsMimeType(child, mimeType));
}

export function createGmailDraftIntegration(options: GmailDraftIntegrationOptions): GmailEmailIntegration {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowSupervisedSalesSend = options.allowSupervisedSalesSend === true;

  if (!options.clientId.trim()) throw new Error('Gmail clientId is required.');
  if (!options.clientSecret.trim()) throw new Error('Gmail clientSecret is required.');
  if (!options.refreshToken.trim()) throw new Error('Gmail refreshToken is required.');

  async function getAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: options.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = (await response.json()) as GmailTokenResponse;
    if (!response.ok || !payload.access_token) {
      const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
      throw new Error(`Gmail OAuth token refresh failed: ${detail}.`);
    }
    return payload.access_token;
  }

  return {
    integrationId: 'email.gmail',
    kind: 'email',
    provider: 'google-gmail',
    supportedModes: allowSupervisedSalesSend ? ['draft', 'live'] : ['draft'],
    supportedOperations: allowSupervisedSalesSend ? ['create_draft', 'send_email'] : ['create_draft'],
    async readThread(threadReference: string): Promise<GmailThreadEvidence> {
      const normalizedThreadReference = threadReference.trim();
      if (!normalizedThreadReference) throw new Error('Gmail threadReference is required.');

      const accessToken = await getAccessToken();
      const response = await fetchImpl(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(normalizedThreadReference)}?format=full`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );
      const payload = (await response.json()) as GmailThreadResponse;
      if (!response.ok || !payload.id) {
        const detail = payload.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`Gmail thread retrieval failed: ${detail}.`);
      }
      if (payload.id !== normalizedThreadReference) {
        throw new Error('Gmail thread retrieval returned a different thread reference.');
      }

      const messages = (payload.messages ?? []).map((message): GmailThreadMessageEvidence => {
        const messageId = message.id?.trim();
        if (!messageId) throw new Error('Gmail thread message id is required.');
        const messageThreadReference = message.threadId?.trim();
        if (!messageThreadReference || messageThreadReference !== normalizedThreadReference) {
          throw new Error('Gmail thread message reference does not match the requested thread.');
        }

        const from = headerValue(message.payload, 'From');
        const to = headerValue(message.payload, 'To');
        const subject = headerValue(message.payload, 'Subject');
        const body = textBody(message.payload);
        const deliveryStatusNotification = containsMimeType(message.payload, 'message/delivery-status');
        return {
          messageId,
          threadReference: messageThreadReference,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(subject ? { subject } : {}),
          ...(message.internalDate?.trim() ? { internalDate: message.internalDate.trim() } : {}),
          ...(message.snippet?.trim() ? { snippet: message.snippet.trim() } : {}),
          ...(body ? { textBody: body } : {}),
          ...(deliveryStatusNotification ? { deliveryStatusNotification: true } : {}),
        };
      });

      return { threadReference: payload.id, messages };
    },
    async execute(
      request: IntegrationRequest<EmailMessageInput>,
    ): Promise<IntegrationResponse<EmailDraftOutput>> {
      const isDraft = request.mode === 'draft' && request.operation === 'create_draft';
      const isSupervisedSalesSend = allowSupervisedSalesSend
        && request.mode === 'live'
        && request.operation === 'send_email'
        && request.requestedBy === 'sales_agent'
        && request.input.fromIdentity === 'sales';

      if (!isDraft && !isSupervisedSalesSend) {
        throw new Error('Gmail integration only supports draft creation by default and supervised Sales sending when explicitly enabled.');
      }

      if (request.requestedBy !== 'human_executive') {
        assertAgentMayUseEmailIdentity(request.requestedBy, request.input.fromIdentity);
      }

      if (isSupervisedSalesSend && !request.idempotencyKey?.trim()) {
        throw new Error('Supervised Gmail send requires an idempotencyKey.');
      }

      const errors = validateEmailMessage(request.input);
      if (errors.length) throw new Error(errors.join(' '));

      const fromAddress = options.identityAddresses[request.input.fromIdentity]?.trim();
      if (!fromAddress) {
        throw new Error(`No Gmail address configured for email identity ${request.input.fromIdentity}.`);
      }

      const accessToken = await getAccessToken();
      const mime = buildMimeMessage(request.input, fromAddress);

      if (isDraft) {
        const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: { raw: base64Url(mime) } }),
        });
        const payload = (await response.json()) as GmailDraftResponse;
        if (!response.ok || !payload.id) {
          const detail = payload.error?.message ?? `HTTP ${response.status}`;
          return {
            integrationId: 'email.gmail',
            operation: request.operation,
            provider: 'google-gmail',
            mode: request.mode,
            status: 'failed',
            output: {
              fromIdentity: request.input.fromIdentity,
              recipients: request.input.to.map((recipient) => recipient.email),
              subject: request.input.subject,
              preview: detail,
            },
            evidenceReferences: [],
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          };
        }

        const output: EmailDraftOutput = {
          draftId: payload.id,
          fromIdentity: request.input.fromIdentity,
          recipients: request.input.to.map((recipient) => recipient.email),
          subject: request.input.subject,
          preview: request.input.textBody.slice(0, 160),
          ...(payload.message?.id ? { messageId: payload.message.id } : {}),
          ...(payload.message?.threadId ? { threadReference: payload.message.threadId } : {}),
        };

        return {
          integrationId: 'email.gmail',
          operation: request.operation,
          provider: 'google-gmail',
          mode: request.mode,
          status: 'drafted',
          output,
          externalReference: payload.id,
          evidenceReferences: [`gmail:draft:${payload.id}`],
          retryable: false,
        };
      }

      const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: base64Url(mime) }),
      });
      const payload = (await response.json()) as GmailSendResponse;
      if (!response.ok || !payload.id) {
        const detail = payload.error?.message ?? `HTTP ${response.status}`;
        return {
          integrationId: 'email.gmail',
          operation: request.operation,
          provider: 'google-gmail',
          mode: request.mode,
          status: 'failed',
          output: {
            fromIdentity: request.input.fromIdentity,
            recipients: request.input.to.map((recipient) => recipient.email),
            subject: request.input.subject,
            preview: detail,
          },
          evidenceReferences: [],
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        };
      }

      return {
        integrationId: 'email.gmail',
        operation: request.operation,
        provider: 'google-gmail',
        mode: request.mode,
        status: 'succeeded',
        output: {
          messageId: payload.id,
          ...(payload.threadId ? { threadReference: payload.threadId } : {}),
          fromIdentity: request.input.fromIdentity,
          recipients: request.input.to.map((recipient) => recipient.email),
          subject: request.input.subject,
          preview: request.input.textBody.slice(0, 160),
        },
        externalReference: payload.id,
        evidenceReferences: [`gmail:message:${payload.id}`],
        retryable: false,
      };
    },
  };
}
