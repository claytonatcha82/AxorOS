import { createServer } from 'node:http';
import type { HealthResponse } from '@axoros/contracts';

const port = Number(process.env.AXOROS_API_PORT ?? 3001);
const environment = process.env.AXOROS_ENV ?? 'development';

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    const body: HealthResponse = {
      service: 'axoros-api',
      status: 'ok',
      environment,
      timestamp: new Date().toISOString()
    };

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`AxorOS API listening on http://127.0.0.1:${port}`);
});
