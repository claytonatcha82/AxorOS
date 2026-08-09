import type { LogSink } from './logger.js';

export function createBetterStackLogSink(ingestingHost: string, sourceToken: string): LogSink {
  return async (event) => {
    const response = await fetch(ingestingHost, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sourceToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...event, dt: event.timestamp }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Better Stack ingestion failed with status ${response.status}`);
    }
  };
}
