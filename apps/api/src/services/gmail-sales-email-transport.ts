import type {
  SalesEmailMessage,
  SalesEmailTransport,
  SalesEmailTransportResult,
} from './sales-supervised-email-execution-service.js';

export interface GmailSalesEmailTransportConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
}

export interface GmailTransportFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

interface GmailTokenResponse {
  access_token?: string;
}

interface GmailSendResponse {
  id?: string;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawMessage(senderEmail: string, message: SalesEmailMessage): string {
  const to = required(message.to, 'message.to');
  const subject = required(message.subject, 'message.subject');
  const body = required(message.body, 'message.body');

  if (/[\r\n]/.test(senderEmail) || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    throw new Error('Email headers must not contain line breaks.');
  }

  return [
    `From: ${senderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
}

export function createGmailSalesEmailTransport(
  config: GmailSalesEmailTransportConfig,
  fetchImpl: GmailTransportFetch = fetch,
): SalesEmailTransport {
  const clientId = required(config.clientId, 'GMAIL_CLIENT_ID');
  const clientSecret = required(config.clientSecret, 'GMAIL_CLIENT_SECRET');
  const refreshToken = required(config.refreshToken, 'GMAIL_REFRESH_TOKEN');
  const senderEmail = required(config.senderEmail, 'GMAIL_SENDER_EMAIL');

  return {
    async send(message: SalesEmailMessage): Promise<SalesEmailTransportResult> {
      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
      });

      if (!tokenResponse.ok) {
        throw new Error(`Gmail OAuth token refresh failed with status ${tokenResponse.status}.`);
      }

      const tokenPayload = await tokenResponse.json() as GmailTokenResponse;
      const accessToken = required(tokenPayload.access_token ?? '', 'Gmail access token');
      const raw = encodeBase64Url(buildRawMessage(senderEmail, message));

      const sendResponse = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });

      if (!sendResponse.ok) {
        throw new Error(`Gmail message send failed with status ${sendResponse.status}.`);
      }

      const sendPayload = await sendResponse.json() as GmailSendResponse;
      return {
        providerMessageId: required(sendPayload.id ?? '', 'Gmail provider message ID'),
      };
    },
  };
}

export function createGmailSalesEmailTransportFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: GmailTransportFetch = fetch,
): SalesEmailTransport {
  return createGmailSalesEmailTransport({
    clientId: env.GMAIL_CLIENT_ID ?? '',
    clientSecret: env.GMAIL_CLIENT_SECRET ?? '',
    refreshToken: env.GMAIL_REFRESH_TOKEN ?? '',
    senderEmail: env.GMAIL_SENDER_EMAIL ?? '',
  }, fetchImpl);
}
