export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  event: string;
  timestamp: string;
  service: 'axoros-api';
  [key: string]: unknown;
}

export type LogSink = (event: LogEvent) => void | Promise<void>;

const sensitiveKeyPattern = /(password|secret|token|authorization|cookie|api[_-]?key|database[_-]?url|connection[_-]?string)/i;
const maxStringLength = 2_000;
let externalSink: LogSink | undefined;

function sanitizeValue(key: string, value: unknown, depth = 0): unknown {
  if (sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (depth > 5) return '[TRUNCATED_DEPTH]';

  if (typeof value === 'string') {
    return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}[TRUNCATED]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue('', item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[childKey] = sanitizeValue(childKey, childValue, depth + 1);
    }
    return sanitized;
  }

  return value;
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

export function setExternalLogSink(sink?: LogSink): void {
  externalSink = sink;
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const payload: LogEvent = {
    level,
    event,
    timestamp: new Date().toISOString(),
    service: 'axoros-api',
    ...sanitizeLogFields(fields),
  };

  const line = JSON.stringify(payload);

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (externalSink) {
    Promise.resolve(externalSink(payload)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'external_log_sink_failed',
        timestamp: new Date().toISOString(),
        service: 'axoros-api',
        error: message.slice(0, maxStringLength),
      }));
    });
  }
}
