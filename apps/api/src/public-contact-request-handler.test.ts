import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createPublicContactRequestHandler } from './public-contact-request-handler.js';

async function withServer(handler: ReturnType<typeof createPublicContactRequestHandler>, run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function send(
  port: number,
  options: { method?: string; origin?: string; body?: Record<string, unknown> },
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/api/v1/public/contact',
      method: options.method ?? 'POST',
      headers: {
        ...(options.origin ? { origin: options.origin } : {}),
        ...(body !== undefined ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({
        statusCode: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const fallback = (_request: unknown, response: any) => {
  response.writeHead(404);
  response.end();
};

function repository() {
  const leads: any[] = [];
  const events: any[] = [];
  return {
    leads,
    events,
    async createLead(input: any) {
      leads.push(input);
      return { id: 'lead-1', ...input };
    },
    async createWorkflowEvent(input: any) {
      events.push(input);
      return { id: 'event-1', ...input };
    },
  };
}

test('accepts project enquiries, routes them to Sales, and persists a website lead', async () => {
  const repo = repository();
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
  });

  await withServer(handler, async (port) => {
    const response = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'Project enquiries',
        fullName: 'Synthetic Client',
        businessName: 'Synthetic Business',
        email: 'client@example.com',
        message: 'We need a new website.',
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.headers['access-control-allow-origin'], 'https://www.axorosdigital.com');
    assert.equal(repo.leads.length, 1);
    assert.equal(repo.leads[0].source, 'website_contact');
    assert.equal(repo.leads[0].contactEmail, 'client@example.com');
    assert.equal(repo.events.length, 1);
    assert.equal(repo.events[0].eventType, 'public_contact_enquiry_received');
    assert.equal(repo.events[0].payload.routedTo, 'sales@axorosdigital.com');
    assert.equal(repo.events[0].payload.leadId, 'lead-1');
    assert.match(response.body, /sales@axorosdigital\.com/);
  });
});

test('routes general enquiries to Support without creating a sales lead', async () => {
  const repo = repository();
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
  });

  await withServer(handler, async (port) => {
    const response = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'General enquiries',
        fullName: 'Synthetic Visitor',
        email: 'visitor@example.com',
        message: 'I have a general question.',
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(repo.leads.length, 0);
    assert.equal(repo.events.length, 1);
    assert.equal(repo.events[0].payload.routedTo, 'support@axorosdigital.com');
  });
});

test('routes Support enquiries to Support', async () => {
  const repo = repository();
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
  });

  await withServer(handler, async (port) => {
    const response = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'Support',
        fullName: 'Existing Client',
        businessName: 'Existing Business',
        email: 'existing@example.com',
        message: 'I need technical support.',
      },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(repo.events[0].payload.routedTo, 'support@axorosdigital.com');
  });
});

test('rejects unapproved browser origins', async () => {
  const repo = repository();
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
  });

  await withServer(handler, async (port) => {
    const response = await send(port, {
      origin: 'https://evil.example',
      body: {
        type: 'Project enquiries',
        fullName: 'Bad Origin',
        email: 'bad@example.com',
        message: 'Should not be accepted.',
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(repo.leads.length, 0);
    assert.equal(repo.events.length, 0);
  });
});

test('rejects invalid contact data without persistence', async () => {
  const repo = repository();
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
  });

  await withServer(handler, async (port) => {
    const response = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'Project enquiries',
        fullName: 'Invalid Email',
        email: 'not-an-email',
        message: 'Bad request.',
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(repo.leads.length, 0);
    assert.equal(repo.events.length, 0);
  });
});

test('rate-limits repeated submissions from the same client address', async () => {
  const repo = repository();
  let timestamp = 1_000;
  const handler = createPublicContactRequestHandler({
    repository: repo as any,
    fallback,
    allowedOrigins: ['https://www.axorosdigital.com'],
    now: () => timestamp,
  });

  await withServer(handler, async (port) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await send(port, {
        origin: 'https://www.axorosdigital.com',
        body: {
          type: 'General enquiries',
          fullName: 'Rate Test',
          email: `rate-${index}@example.com`,
          message: 'Testing rate limit.',
        },
      });
      assert.equal(response.statusCode, 202);
    }

    const limited = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'General enquiries',
        fullName: 'Rate Test',
        email: 'rate-last@example.com',
        message: 'Should be rate limited.',
      },
    });
    assert.equal(limited.statusCode, 429);

    timestamp += 10 * 60 * 1000;
    const reset = await send(port, {
      origin: 'https://www.axorosdigital.com',
      body: {
        type: 'General enquiries',
        fullName: 'Rate Test',
        email: 'rate-reset@example.com',
        message: 'Allowed after reset.',
      },
    });
    assert.equal(reset.statusCode, 202);
  });
});
