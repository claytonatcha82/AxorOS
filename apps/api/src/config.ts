export type AxorOSEnvironment = 'development' | 'staging' | 'production' | 'test';

export interface ApiConfig {
  environment: AxorOSEnvironment;
  host: string;
  port: number;
  controlCenterUrl: string;
}

const allowedEnvironments = new Set<AxorOSEnvironment>([
  'development',
  'staging',
  'production',
  'test',
]);

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

  return {
    environment: rawEnvironment as AxorOSEnvironment,
    host: env.AXOROS_API_HOST ?? '127.0.0.1',
    port,
    controlCenterUrl: parsedControlCenterUrl.origin,
  };
}
