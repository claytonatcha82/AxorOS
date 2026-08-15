import type { IntegrationRequest, IntegrationResponse } from './integration-contract.js';
import type { EmailDraftOutput, EmailIntegration, EmailMessageInput } from './email-integration.js';
import { validateEmailMessage } from './email-integration.js';

export interface GmailDraftIntegrationOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  identityAddresses: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
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

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function formatAddress(name: string | undefined, email: string): string {
  if (!name?.trim()) return email;
  const safeName = name.replace(/[\r\n"]/g, '').trim();
  return `"${safeName}" <${email}>`;
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
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
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

export function createGmailDraftIntegration(options: GmailDraftIntegrationOptions): EmailIntegration {
  const fetchImpl = options.fetchImpl ?? fetch;

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
    supportedModes: ['draft'],
    supportedOperations: ['create_draft'],
    async execute(
      request: IntegrationRequest<EmailMessageInput>,
    ): Promise<IntegrationResponse<EmailDraftOutput>> {
      if (request.mode !== 'draft' || request.operation !== 'create_draft') {
        throw new Error('Gmail integration is draft-only and supports create_draft only.');
      }

      const errors = validateEmailMessage(request.input);
      if (errors.length) throw new Error(errors.join(' '));

      const fromAddress = options.identityAddresses[request.input.fromIdentity]?.trim();
      if (!fromAddress) {
        throw new Error(`No Gmail address configured for email identity ${request.input.fromIdentity}.`);
      }

      const accessToken = await getAccessToken();
      const mime = buildMimeMessage(request.input, fromAddress);
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

      return {
        integrationId: 'email.gmail',
        operation: request.operation,
        provider: 'google-gmail',
        mode: request.mode,
        status: 'drafted',
        output: {
          draftId: payload.id,
          messageId: payload.message?.id,
          fromIdentity: request.input.fromIdentity,
          recipients: request.input.to.map((recipient) => recipient.email),
          subject: request.input.subject,
          preview: request.input.textBody.slice(0, 160),
        },
        externalReference: payload.id,
        evidenceReferences: [`gmail:draft:${payload.id}`],
        retryable: false,
      };
    },
  };
}
