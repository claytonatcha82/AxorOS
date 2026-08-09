export type RequestOutcome = 'success' | 'client_error' | 'server_error';

interface RequestMetric {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface MetricsSnapshot {
  service: 'axoros-api';
  uptimeSeconds: number;
  requests: Record<RequestOutcome, RequestMetric & { averageDurationMs: number }>;
  readinessFailures: number;
}

const startedAt = Date.now();
const requestMetrics: Record<RequestOutcome, RequestMetric> = {
  success: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
  client_error: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
  server_error: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
};
let readinessFailures = 0;

export function classifyHttpOutcome(statusCode: number): RequestOutcome {
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  return 'success';
}

export function recordHttpRequest(statusCode: number, durationMs: number): void {
  const outcome = classifyHttpOutcome(statusCode);
  const metric = requestMetrics[outcome];
  metric.count += 1;
  metric.totalDurationMs += durationMs;
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
}

export function recordReadinessFailure(): void {
  readinessFailures += 1;
}

function withAverage(metric: RequestMetric): RequestMetric & { averageDurationMs: number } {
  return {
    ...metric,
    averageDurationMs: metric.count === 0 ? 0 : Math.round((metric.totalDurationMs / metric.count) * 100) / 100,
  };
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    service: 'axoros-api',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: {
      success: withAverage(requestMetrics.success),
      client_error: withAverage(requestMetrics.client_error),
      server_error: withAverage(requestMetrics.server_error),
    },
    readinessFailures,
  };
}

export function resetMetricsForTests(): void {
  for (const metric of Object.values(requestMetrics)) {
    metric.count = 0;
    metric.totalDurationMs = 0;
    metric.maxDurationMs = 0;
  }
  readinessFailures = 0;
}
