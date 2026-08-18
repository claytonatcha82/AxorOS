import { validateControlPlaneToken } from './control-plane-auth.js';

export type AxorOSEnvironment = 'development' | 'staging' | 'production' | 'test';

export interface ApiConfig {
  environment: AxorOSEnvironment;
  host: string;
  port: number;
  controlCenterUrl: string;
  controlPlaneToken?: string;
  databaseUrl?: string;
  betterStackIngestingHost?: string;
  betterStackSourceToken?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  gmailClientId?: string;
  gmailClientSecret?: string;
  gmailRefreshToken?: string;
  gmailIdentityAddresses?: Readonly<Record<string, string>>;
  paystackSecretKey?: string;
}

const allowedEnvironments = new Set<AxorOSEnvironment>([
  'development',
  'staging',
  'production',
  'test',
]);

function optionalHttpsUrl(value: string | undefined, field: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`Invalid ${field}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return parsed.origin;
}

function parseGmailIdentityAddresses(value: string | undefined): Readonly<Record<string, string>> | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Invalid AXOROS_GMAIL_IDENTITY_ADDRESSES JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must be a JSON object.');
  }

  const addresses: Record<string, string> = {};
  for (const [identity, address] of Object.entries(parsed)) {
    if (!identity.trim() || typeof address !== 'string' || !address.trim()) {
      throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES contains an invalid identity or address.');
    }
    addresses[identity.trim()] = address.trim();
  }

  if (Object.keys(addresses).length === 0) {
    throw new Error('AXOROS_GMAIL_IDENTITY_ADDRESSES must contain at least one identity.');
  }
  return addresses;
}

function parsePaystackSecretKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('sk_test_') && !trimmed.startsWith('sk_live_')) {
    throw new Error('AXOROS_PAYSTACK_SECRET_KEY must be a Paystack test or live secret key.');
  }
  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawEnvironment = env.AXOROS_ENV ?? 'development';

  if (!allowedEnvironments.has(rawEnvironment as AxorOSEnvironment)) {
    throw new Error(`Invalid AXOROS_ENV: ${rawEnvironment}`);
  }

  const rawPort = env.AXOROS_API_PORT ?? '3001';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid AXOROS_API_PORT: ${rawPort}`);
  }

  const controlCenterUrl = env.AXOROS_CONTROL_CENTER_URL ?? 'http://localhost:5173';
  let parsedControlCenterUrl: URL;
  try {
    parsedControlCenterUrl = new URL(controlCenterUrl);
  } catch {
    throw new Error(`Invalid AXOROS_CONTROL_CENTER_URL: ${controlCenterUrl}`);
  }

  if (!['http:', 'https:'].includes(parsedControlCenterUrl.protocol)) {
    throw new Error(`Invalid AXOROS_CONTROL_CENTER_URL protocol: ${parsedControlCenterUrl.protocol}`);
  }

  const controlPlaneToken = validateControlPlaneToken(env.AXOROS_CONTROL_PLANE_TOKEN);

  const databaseUrl = env.AXOROS_DATABASE_URL?.trim();
  if (databaseUrl) {
    let parsedDatabaseUrl: URL;
    try {
      parsedDatabaseUrl = new URL(databaseUrl);
    } catch {
      throw new Error('Invalid AXOROS_DATABASE_URL');
    }
    if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
      throw new Error(`Invalid AXOROS_DATABASE_URL protocol: ${parsedDatabaseUrl.protocol}`);
    }
  }

  const betterStackIngestingHost = optionalHttpsUrl(env.AXOROS_BETTERSTACK_INGESTING_HOST, 'AXOROS_BETTERSTACK_INGESTING_HOST');
  const betterStackSourceToken = env.AXOROS_BETTERSTACK_SOURCE_TOKEN?.trim() || undefined;
  if ((betterStackIngestingHost && !betterStackSourceToken) || (!betterStackIngestingHost && betterStackSourceToken)) {
    throw new Error('Better Stack ingesting host and source token must be configured together.');
  }

  const geminiApiKey = env.GEMINI_API_KEY?.trim() || undefined;
  const geminiModel = env.AXOROS_GEMINI_MODEL?.trim() || undefined;

  const gmailClientId = env.AXOROS_GMAIL_CLIENT_ID?.trim() || undefined;
  const gmailClientSecret = env.AXOROS_GMAIL_CLIENT_SECRET?.trim() || undefined;
  const gmailRefreshToken = env.AXOROS_GMAIL_REFRESH_TOKEN?.trim() || undefined;
  const gmailIdentityAddresses = parseGmailIdentityAddresses(env.AXOROS_GMAIL_IDENTITY_ADDRESSES);
  const gmailParts = [gmailClientId, gmailClientSecret, gmailRefreshToken, gmailIdentityAddresses];
  const configuredGmailParts = gmailParts.filter((part) => part !== undefined).length;
  if (configuredGmailParts !== 0 && configuredGmailParts !== gmailParts.length) {
    throw new Error('Gmail draft integration requires client ID, client secret, refresh token, and identity addresses together.');
  }

  const paystackSecretKey = parsePaystackSecretKey(env.AXOROS_PAYSTACK_SECRET_KEY);

  const config: ApiConfig = {
    environment: rawEnvironment as AxorOSEnvironment,
    host: env.AXOROS_API_HOST ?? '127.0.0.1',
    port,
    controlCenterUrl: parsedControlCenterUrl.origin,
  };

  if (controlPlaneToken) config.controlPlaneToken = controlPlaneToken;
  if (databaseUrl) config.databaseUrl = databaseUrl;
  if (betterStackIngestingHost) config.betterStackIngestingHost = betterStackIngestingHost;
  if (betterStackSourceToken) config.betterStackSourceToken = betterStackSourceToken;
  if (geminiApiKey) config.geminiApiKey = geminiApiKey;
  if (geminiModel) config.geminiModel = geminiModel;
  if (gmailClientId) config.gmailClientId = gmailClientId;
  if (gmailClientSecret) config.gmailClientSecret = gmailClientSecret;
  if (gmailRefreshToken) config.gmailRefreshToken = gmailRefreshToken;
  if (gmailIdentityAddresses) config.gmailIdentityAddresses = gmailIdentityAddresses;
  if (paystackSecretKey) config.paystackSecretKey = paystackSecretKey;

  return config;
}
