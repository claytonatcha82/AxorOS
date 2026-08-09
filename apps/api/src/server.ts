import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = createServer(createRequestHandler(config));
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down AxorOS API.`);

  server.close((error) => {
    if (error) {
      console.error('AxorOS API shutdown failed.', error);
      process.exitCode = 1;
      return;
    }

    console.log('AxorOS API stopped cleanly.');
  });

  setTimeout(() => {
    console.error('AxorOS API forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.listen(config.port, config.host, () => {
  console.log(`AxorOS API listening on http://${config.host}:${config.port}`);
});
