import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { loadConfig } from './config.js';
import { logEvent } from './logger.js';

const config = loadConfig();
const server = createServer(createRequestHandler(config));
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logEvent('info', 'api_shutdown_started', { signal });

  server.close((error) => {
    if (error) {
      logEvent('error', 'api_shutdown_failed', { signal, error: error.message });
      process.exitCode = 1;
      return;
    }

    logEvent('info', 'api_shutdown_completed', { signal });
  });

  setTimeout(() => {
    logEvent('error', 'api_shutdown_forced', { signal, timeoutMs: 10_000 });
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.listen(config.port, config.host, () => {
  logEvent('info', 'api_started', {
    environment: config.environment,
    host: config.host,
    port: config.port,
    nodeVersion: process.version,
  });
});
