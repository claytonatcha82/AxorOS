import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createRequestHandler } from './app.js';
import type { ApiConfig } from './config.js';
import type { KnowledgeRetrievalService } from './knowledge/knowledge-retrieval-service.js';

const config: ApiConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3001,
  controlCenterUrl: 'http://localhost:5173',
};

type KnowledgeRetriever = Pick<KnowledgeRetrievalService, 'retrieve'>;

async function withServer(run: (baseUrl: string) => Promise<void>, knowledgeRetriever?: KnowledgeRetriever): Promise<void> {
  const server = createServer(createRequestHandler(config, undefined, knowledgeRetriever));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /api/v1 returns a versioned success envelope and request ID', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      headers: { 'x-request-id': 'req-test-123' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'req-test-123');
    assert.deepEqual(body, {
      ok: true,
      requestId: 'req-test-123',
      data: {
        service: 'axoros-api',
        apiVersion: 'v1',
        environment: 'test',
      },
    });
  });
});

test('unknown routes return a consistent error envelope', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json() as { ok: boolean; requestId: string; error: { code: string } };

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'not_found');
    assert.ok(body.requestId.length > 0);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
  });
});

test('allowed Control Center origin receives CORS headers', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      headers: { origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

test('disallowed CORS preflight is rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1`, {
      method: 'OPTIONS',
      headers: { origin: 'https://attacker.example' },
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'cors_origin_denied');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('POST /api/v1/knowledge/retrieve returns controlled retrieval results', async () => {
  let capturedRequest: Parameters<KnowledgeRetriever['retrieve']>[0] | undefined;
  const knowledgeRetriever: KnowledgeRetriever = {
    retrieve: async (request) => {
      capturedRequest = request;
      return [{
        content: 'Atlas guidance for website delivery.',
        score: 1.25,
        citation: {
          documentId: 'db-document-1',
          documentKey: 'atlas-document-1',
          title: 'Website Delivery',
          path: 'Volume 2 - Development/Website Delivery.md',
          headingPath: ['Delivery'],
          chunkId: 'chunk-1',
          chunkIndex: 0,
          chunkType: 'prose',
          authorityLevel: 'authoritative',
          securityClassification: 'internal',
          sourceVersion: 'abc123',
          documentChecksum: 'doc-checksum',
          chunkChecksum: 'chunk-checksum',
        },
      }];
    },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/knowledge/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'knowledge-req-1' },
      body: JSON.stringify({ query: 'website delivery', agent: 'Production Agent', task: 'Build Website', limit: 5 }),
    });
    const body = await response.json() as { ok: boolean; requestId: string; data: { results: Array<{ content: string }> } };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.requestId, 'knowledge-req-1');
    assert.equal(body.data.results.length, 1);
    assert.equal(body.data.results[0]!.content, 'Atlas guidance for website delivery.');
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.query, 'website delivery');
    assert.equal(capturedRequest.agent, 'Production Agent');
    assert.equal(capturedRequest.task, 'Build Website');
    assert.equal(capturedRequest.maximumSecurityClassification, 'internal');
    assert.equal(capturedRequest.limit, 5);
  }, knowledgeRetriever);
});

test('knowledge retrieval endpoint cannot request restricted or confidential data', async () => {
  let maximumSecurityClassification: string | undefined;
  const knowledgeRetriever: KnowledgeRetriever = {
    retrieve: async (request) => {
      maximumSecurityClassification = request.maximumSecurityClassification;
      return [];
    },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/knowledge/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'security policy',
        agent: 'lead_agent',
        task: 'research',
        maximumSecurityClassification: 'confidential',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(maximumSecurityClassification, 'internal');
  }, knowledgeRetriever);
});

test('knowledge retrieval endpoint rejects invalid JSON bodies', async () => {
  const knowledgeRetriever: KnowledgeRetriever = { retrieve: async () => [] };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/knowledge/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_json_body');
  }, knowledgeRetriever);
});

test('knowledge retrieval endpoint rejects invalid retrieval requests', async () => {
  const knowledgeRetriever: KnowledgeRetriever = {
    retrieve: async () => { throw new Error('query is required.'); },
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/knowledge/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '', agent: 'lead_agent', task: 'research' }),
    });
    const body = await response.json() as { error: { code: string; message: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_knowledge_retrieval_request');
    assert.equal(body.error.message, 'query is required.');
  }, knowledgeRetriever);
});

test('knowledge retrieval endpoint reports unavailable service when not configured', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/knowledge/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'website', agent: 'lead_agent', task: 'research' }),
    });
    const body = await response.json() as { error: { code: string } };

    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'knowledge_retrieval_not_configured');
  });
});
