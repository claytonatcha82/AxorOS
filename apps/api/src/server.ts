import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = createServer(createRequestHandler(config));

server.listen(config.port, config.host, () => {
  console.log(`AxorOS API listening on http://${config.host}:${config.port}`);
});
