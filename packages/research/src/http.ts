import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import {
  encodeResearchBinding,
  ResearchBindingSchema,
  type ResearchBinding,
} from '../../../characters/interfaces/src/research';
import { ResearchUnavailable, type createResearchService } from './service';

type Service = Awaited<ReturnType<typeof createResearchService>>;
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function body(req: IncomingMessage) {
  if (
    req.headers['content-type']?.split(';')[0].trim() !== 'application/json' ||
    req.headers['content-encoding']
  )
    throw new ResearchUnavailable('invalid_request');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new ResearchUnavailable('invalid_request');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ResearchUnavailable('invalid_request');
  }
}
export function createResearchHttpServer(options: {
  service: Service;
  binding: ResearchBinding;
  token: string;
}) {
  const binding = encodeResearchBinding(ResearchBindingSchema.parse(options.binding));
  if (!/^[a-zA-Z0-9_-]{32,512}$/.test(options.token))
    throw Error('Invalid private research credential.');
  let active = false;
  const server = createServer(
    { headersTimeout: 10000, requestTimeout: 10000, connectionsCheckingInterval: 1000 },
    async (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('connection', 'close');
      res.shouldKeepAlive = false;
      let released = false;
      const send = (status: number, value: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        res.statusCode = status;
        if (status === 429 || status === 503) res.setHeader('retry-after', '60');
        res.end(JSON.stringify(value));
      };
      res.once('finish', () => req.socket.destroySoon());
      const timer = setTimeout(() => {
        send(408, { error: 'request_timeout' });
        req.socket.destroySoon();
      }, 5000);
      timer.unref();
      try {
        if (req.method === 'GET' && req.url === '/healthz') {
          clearTimeout(timer);
          send(200, { ok: true });
          return;
        }
        if (
          req.headers.origin ||
          !equal(req.headers.authorization ?? '', 'Bearer ' + options.token)
        ) {
          send(401, { error: 'unauthorized' });
          return;
        }
        if (
          typeof req.headers['x-elsewhere-research-binding'] !== 'string' ||
          !equal(req.headers['x-elsewhere-research-binding'], binding)
        ) {
          send(403, { error: 'not_authorized' });
          return;
        }
        if (req.method === 'GET' && req.url === '/v1/research/ready') {
          clearTimeout(timer);
          send(200, options.service.status());
          return;
        }
        if (
          req.method !== 'POST' ||
          !['/v1/research/search', '/v1/research/read'].includes(req.url ?? '')
        ) {
          send(404, { error: 'not_found' });
          return;
        }
        if (active) {
          send(503, { error: 'busy' });
          return;
        }
        active = true;
        released = true;
        const input = await body(req);
        clearTimeout(timer);
        const result = req.url?.endsWith('/search')
          ? await options.service.search(input)
          : await options.service.read(input);
        send(200, result);
      } catch (error) {
        const code = error instanceof ResearchUnavailable ? error.code : 'unavailable';
        send(
          code === 'not_granted'
            ? 403
            : code === 'invalid_request'
              ? 400
              : code === 'limit'
                ? 429
                : 503,
          { error: code },
        );
      } finally {
        clearTimeout(timer);
        if (released) active = false;
      }
    },
  );
  server.maxConnections = 32;
  server.maxHeadersCount = 32;
  server.keepAliveTimeout = 1000;
  server.setTimeout(25000, (socket) => socket.destroy());
  return server;
}
