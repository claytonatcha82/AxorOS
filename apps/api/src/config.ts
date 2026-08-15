export type AxorOSEnvironment = 'development' | 'staging' | 'production' | 'test';

export interface ApiConfig {
  environment: AxorOSEnvironment;
  host: string;
  port: number;
  controlCenterUrl: string;
  databaseUrl?: string;
  betterStackIngestingHost?: string;
  betterStackSourceToken?: string;
  geminiApiKey?: string;
  geminiModel?: string;
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

  const config: ApiConfig = {
    environment: rawEnvironment as AxorOSEnvironment,
    host: env.AXOROS_API_HOST ?? '127.0.0.1',
    port,
    controlCenterUrl: parsedControlCenterUrl.origin,
  };

  if (databaseUrl) config.databaseUrl = databaseUrl;
  if (betterStackIngestingHost) config.betterStackIngestingHost = betterStackIngestingHost;
  if (betterStackSourceToken) config.betterStackSourceToken = betterStackSourceToken;
  if (geminiApiKey) config.geminiApiKey = geminiApiKey;
  if (geminiModel) config.geminiModel = geminiModel;

  return config;
}
