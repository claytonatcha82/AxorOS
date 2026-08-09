export type LogLevel = 'info' | 'warn' | 'error';

interface LogEvent {
  level: LogLevel;
  event: string;
  timestamp: string;
  service: 'axoros-api';
  [key: string]: unknown;
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const payload: LogEvent = {
    level,
    event,
    timestamp: new Date().toISOString(),
    service: 'axoros-api',
    ...fields,
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}
