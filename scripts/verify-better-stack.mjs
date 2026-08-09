const rawHost = process.env.AXOROS_BETTERSTACK_INGESTING_HOST?.trim();
const token = process.env.AXOROS_BETTERSTACK_SOURCE_TOKEN?.trim();

if (!rawHost) {
  console.error('FAIL  AXOROS_BETTERSTACK_INGESTING_HOST is not set');
  process.exit(1);
}

if (!token) {
  console.error('FAIL  AXOROS_BETTERSTACK_SOURCE_TOKEN is not set');
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL(rawHost.startsWith('http') ? rawHost : `https://${rawHost}`);
} catch {
  console.error('FAIL  Better Stack ingesting host is invalid');
  process.exit(1);
}

if (endpoint.protocol !== 'https:') {
  console.error('FAIL  Better Stack ingesting host must use HTTPS');
  process.exit(1);
}

const event = {
  level: 'info',
  event: 'better_stack_ingestion_verification',
  service: 'axoros-api',
  environment: process.env.AXOROS_ENV ?? 'unknown',
  timestamp: new Date().toISOString(),
  dt: new Date().toISOString(),
  message: 'AxorOS Better Stack ingestion verification',
};

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status !== 202) {
    console.error(`FAIL  Better Stack returned HTTP ${response.status}`);
    process.exit(1);
  }

  console.log('PASS  Better Stack accepted test event (HTTP 202)');
} catch (error) {
  console.error(`FAIL  Better Stack request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
