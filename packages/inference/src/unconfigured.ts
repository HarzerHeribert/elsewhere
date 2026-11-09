import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

/** No owner, grant, allowance or provider exists until ownership is explicitly configured. */
export function createUnconfiguredInferenceService(token: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(`Bearer ${token}`);
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'GET' && request.url === '/healthz') {
      response.end(JSON.stringify({ status: 'alive' }));
      return;
    }
    const authorization = request.headers.authorization;
    if (
      !authorization ||
      authorization.length > 1024 ||
      !timingSafeEqual(digest(authorization), expected) ||
      request.headers.origin ||
      request.headers['sec-fetch-site']
    ) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/readyz') {
      response.writeHead(503);
      response.end(JSON.stringify({ ready: false }));
      return;
    }
    response.writeHead(503);
    response.end(JSON.stringify({ error: 'unavailable', retryAfterMs: 60000 }));
  });
  server.maxConnections = 16;
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
