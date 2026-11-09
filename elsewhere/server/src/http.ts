import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  PROTOCOL_VERSION,
  VisitorMessageSchema,
  type AccountSummary,
  type PublicSnapshot,
} from '@elsewhere/character-interfaces';
import { publicWorld } from './world.js';
import { VisitorError, VisitorRegistry } from './visitors.js';

export interface ApiAuth {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  getAccount(req: IncomingMessage): Promise<AccountSummary | null>;
  isWorldAdmin(req: IncomingMessage): Promise<boolean>;
  passwordAuthEnabled?: boolean;
  requiresEmailVerification?: boolean;
}

export interface ApiDependencies {
  auth?: ApiAuth;
  adminToken: string;
  allowedOrigins?: string[];
  /** Set only for the known Vercel ingress; all non-health traffic must present this secret. */
  proxySecret?: string;
  isReady?(): boolean;
  /** Derived from trusted ownership records, independently of the account's admin role. */
  canManageCharacter?(userId: string, characterId: string): boolean | Promise<boolean>;
  getSnapshot(): PublicSnapshot | Promise<PublicSnapshot>;
  tick(): Promise<PublicSnapshot>;
  pause(): Promise<PublicSnapshot>;
  resume(): Promise<PublicSnapshot>;
  reset(): Promise<PublicSnapshot>;
  submitMessage(
    text: string,
    actor?: { userId: string; displayName: string },
  ): Promise<{ accepted: boolean }>;
  getArtifact?(id: string): { contentType: string; body: string } | null;
  resolveWish?(id: string, decision: 'fulfill' | 'decline'): Promise<PublicSnapshot>;
}

/** Explicitly project public fields: never serialize a controller or private character state. */
export function publicSnapshot(snapshot: PublicSnapshot): PublicSnapshot {
  const character = snapshot.character;
  const memory = (item: PublicSnapshot['memories'][number]) => ({
    id: item.id,
    at: item.at,
    summary: item.summary,
    cues: item.cues,
    placeId: item.placeId,
    objectId: item.objectId,
    entityId: item.entityId,
    moodAtEncoding: item.moodAtEncoding,
    salience: item.salience,
  });
  return {
    world: publicWorld(snapshot.world),
    character: {
      id: character.id,
      name: character.name,
      mood: character.mood,
      energy: character.energy,
      boredom: character.boredom,
      frustration: character.frustration,
      socialAppetite: character.socialAppetite,
      activity: character.activity,
      status: character.status,
      interests: character.interests.map(({ id, name, strength, encounters }) => ({
        id,
        name,
        strength,
        encounters,
      })),
      currentThought: character.currentThought,
      lastReflection: character.lastReflection,
    },
    events: snapshot.events.map(
      ({ id, at, type, message, characterId, objectId, entityId, placeId }) => ({
        id,
        at,
        type,
        message,
        characterId,
        objectId,
        entityId,
        placeId,
      }),
    ),
    memories: snapshot.memories.map(memory),
    recalledMemory: snapshot.recalledMemory ? memory(snapshot.recalledMemory) : null,
    artifacts: snapshot.artifacts?.map(({ id, name, description, url, createdAt }) => ({
      id,
      name,
      description,
      url,
      createdAt,
    })),
    wishes: snapshot.wishes?.map(
      ({
        id,
        title,
        description,
        reason,
        createdAt,
        status,
        requestedObjectId,
        fulfilledAt,
        declinedAt,
        receiptId,
      }) => ({
        id,
        title,
        description,
        reason,
        createdAt,
        status,
        requestedObjectId,
        fulfilledAt,
        declinedAt,
        receiptId,
      }),
    ),
    runtime: {
      mode: snapshot.runtime.mode,
      paused: snapshot.runtime.paused,
      tick: snapshot.runtime.tick,
      startedAt: snapshot.runtime.startedAt,
      simulatedAt: snapshot.runtime.simulatedAt,
      costUsd: snapshot.runtime.costUsd,
      modelCalls: snapshot.runtime.modelCalls,
      modelStatus: snapshot.runtime.modelStatus,
      costKnown: snapshot.runtime.costKnown,
      simulationRate: snapshot.runtime.simulationRate,
    },
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Authentication may have awaited I/O while the client disconnected or another reader ended.
    if (req.destroyed || req.aborted || req.readableEnded) {
      reject(new HttpError(400, 'Request interrupted or already consumed.'));
      return;
    }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'Use application/json.'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        if (!tooLarge) reject(new HttpError(413, 'Request body exceeds 64 KB.'));
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Malformed JSON.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Request interrupted.')));
    req.on('aborted', () => reject(new HttpError(400, 'Request interrupted.')));
  });
}

function authenticated(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const expected = Buffer.from(token);
  const received = Buffer.from(supplied);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createApiServer(deps: ApiDependencies) {
  if (deps.adminToken.length < 24) throw new Error('Owner token must be at least 24 characters.');
  if (deps.proxySecret && deps.proxySecret.length < 32)
    throw new Error('Proxy secret must be at least 32 characters.');
  const origins = new Set(
    deps.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
  );
  const limits = new Map<string, { count: number; until: number }>();
  const visitors = new VisitorRegistry();
  const snapshotWithVisitors = async () => {
    const snapshot = publicSnapshot(await deps.getSnapshot());
    snapshot.world.visitors = visitors.publicVisitors(snapshot.world);
    return snapshot;
  };
  function consume(key: string, maximum: number, now: number): boolean {
    // Bound memory even if the service is exposed accidentally to many remote clients.
    if (limits.size > 2000)
      for (const [id, entry] of limits) if (entry.until < now) limits.delete(id);
    if (limits.size > 10000) return false;
    const previous = limits.get(key);
    const entry = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
    entry.count++;
    limits.set(key, entry);
    return entry.count <= maximum;
  }
  const active = new Set<Promise<void>>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const operation = handle(req, res);
    active.add(operation);
    void operation
      .catch(() => {
        if (!res.destroyed) res.destroy();
      })
      .finally(() => active.delete(operation));
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    const send = (status: number, value: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/health') {
        send(200, {
          ok: true,
          ready: deps.isReady?.() ?? true,
          service: 'elsewhere',
          protocolVersion: PROTOCOL_VERSION,
        });
        return;
      }
      let clientAddress = req.socket.remoteAddress ?? 'unknown';
      if (deps.proxySecret) {
        const supplied = req.headers['x-elsewhere-proxy-token'];
        const expected = Buffer.from(deps.proxySecret);
        const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
          throw new HttpError(403, 'Use the public Elsewhere origin.');
        // Vercel overwrites this header at ingress. Never trust arbitrary forwarding headers.
        const forwarded = req.headers['x-vercel-forwarded-for'];
        if (typeof forwarded !== 'string' || !isIP(forwarded))
          throw new HttpError(403, 'Trusted client address is missing.');
        clientAddress = forwarded;
      }
      if (deps.isReady && !deps.isReady()) {
        res.setHeader('Retry-After', '2');
        throw new HttpError(
          503,
          'Elsewhere is handing over to its next process. Please retry shortly.',
        );
      }
      if (req.method === 'GET' && pathname === '/api/ready') {
        send(200, { ok: true });
        return;
      }
      if (origin && !origins.has(origin)) throw new HttpError(403, 'Origin is not permitted.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.statusCode = 204;
        res.end();
        return;
      }
      if (pathname.startsWith('/api/auth/')) {
        if (!deps.auth) throw new HttpError(503, 'Accounts are not configured.');
        if (!consume(`auth:${clientAddress}`, 60, Date.now()))
          throw new HttpError(429, 'Please wait before trying authentication again.');
        await deps.auth.handle(req, res);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/account') {
        if (!deps.auth) {
          send(200, {
            user: null,
            enabled: false,
            passwordAuthEnabled: false,
            requiresEmailVerification: false,
            managedCharacterIds: [],
          });
          return;
        }
        const account = await deps.auth.getAccount(req);
        const characterId = (await deps.getSnapshot()).character.id;
        const managesCharacter =
          account && (await deps.canManageCharacter?.(account.id, characterId)) === true;
        send(200, {
          user: account,
          enabled: true,
          passwordAuthEnabled: deps.auth.passwordAuthEnabled ?? true,
          requiresEmailVerification: deps.auth.requiresEmailVerification ?? false,
          managedCharacterIds: managesCharacter ? [characterId] : [],
        });
        return;
      }
      if (req.method === 'GET' && pathname === '/api/world') {
        send(200, await snapshotWithVisitors());
        return;
      }
      const ip = clientAddress;
      if (req.method === 'POST' && pathname === '/api/visitors') {
        if (!consume(`visitor-create:${ip}`, 8, Date.now()))
          throw new HttpError(429, 'Please wait before creating another visitor.');
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new HttpError(400, 'Visitor registration takes an empty object.');
        send(201, visitors.create((await deps.getSnapshot()).world));
        return;
      }
      const visitorRoute = /^\/api\/visitors\/(visitor-[a-f0-9-]{36})(\/action)?$/.exec(pathname);
      if (
        visitorRoute &&
        ((req.method === 'GET' && !visitorRoute[2]) || (req.method === 'POST' && visitorRoute[2]))
      ) {
        const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        try {
          visitors.authenticate(visitorRoute[1], token);
        } catch (error) {
          if (!consume(`visitor-denied:${ip}`, 120, Date.now()))
            throw new HttpError(429, 'Visitor request limit reached.');
          throw error;
        }
        if (!consume(`visitor-action:${visitorRoute[1]}`, 900, Date.now()))
          throw new HttpError(429, 'Visitor request limit reached.');
        const world = (await deps.getSnapshot()).world;
        const session =
          req.method === 'GET'
            ? visitors.get(visitorRoute[1], token, world)
            : visitors.act(visitorRoute[1], token, await readJson(req), world);
        send(200, session);
        return;
      }
      if (req.method === 'GET' && pathname.startsWith('/api/artifacts/')) {
        const id = pathname.slice('/api/artifacts/'.length);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
          throw new HttpError(400, 'Invalid artifact identifier.');
        const artifact = deps.getArtifact?.(id);
        if (!artifact) throw new HttpError(404, 'Artifact not found.');
        if (artifact.contentType !== 'image/svg+xml')
          throw new HttpError(415, 'Unsupported artifact format.');
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader(
          'Content-Security-Policy',
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        );
        res.setHeader('Content-Disposition', `inline; filename="${id}.svg"`);
        res.statusCode = 200;
        res.end(artifact.body);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/messages') {
        const account = deps.auth ? await deps.auth.getAccount(req) : null;
        if (!consume(account ? `message:user:${account.id}` : `message:${ip}`, 5, Date.now()))
          throw new HttpError(429, 'Please wait before leaving another thought.');
        const parsed = VisitorMessageSchema.safeParse(await readJson(req));
        if (!parsed.success)
          throw new HttpError(400, 'Message must contain 1–500 characters of text.');
        const result = account
          ? await deps.submitMessage(parsed.data.text, {
              userId: account.id,
              displayName: account.name,
            })
          : await deps.submitMessage(parsed.data.text);
        send(result.accepted ? 202 : 400, result);
        return;
      }
      if (req.method === 'POST' && pathname.startsWith('/api/admin/')) {
        const owner = authenticated(req, deps.adminToken);
        const account = !owner && deps.auth ? await deps.auth.getAccount(req) : null;
        const managesCharacter = async () =>
          owner ||
          (!!account &&
            (await deps.canManageCharacter?.(
              account.id,
              (await deps.getSnapshot()).character.id,
            )) === true);
        if (!owner && !account?.isWorldAdmin && !(await managesCharacter())) {
          if (!consume(`admin-denied:${ip}`, 120, Date.now()))
            throw new HttpError(429, 'Owner request limit reached.');
          throw new HttpError(401, 'Character-owner or world-admin authorization required.');
        }
        if (!consume(owner ? 'admin:owner' : `admin:user:${account!.id}`, 120, Date.now()))
          throw new HttpError(429, 'Owner request limit reached.');
        if (!authenticated(req, deps.adminToken) && (!origin || !origins.has(origin)))
          throw new HttpError(
            403,
            'A trusted origin is required for session-authenticated changes.',
          );
        const wishRoute = /^\/api\/admin\/wishes\/([^/]+)$/.exec(pathname);
        if (wishRoute && deps.resolveWish) {
          if (!(await managesCharacter()))
            throw new HttpError(403, 'Character ownership is required.');
          let wishId: string;
          try {
            wishId = decodeURIComponent(wishRoute[1]);
          } catch {
            throw new HttpError(400, 'Invalid wish identifier.');
          }
          if (!/^[a-zA-Z0-9:_-]{1,150}$/.test(wishId))
            throw new HttpError(400, 'Invalid wish identifier.');
          const body = await readJson(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !('decision' in body) ||
            (body.decision !== 'fulfill' && body.decision !== 'decline')
          )
            throw new HttpError(400, 'Wish decision must be fulfill or decline.');
          if (!(await managesCharacter()))
            throw new HttpError(403, 'Character ownership is required.');
          send(200, publicSnapshot(await deps.resolveWish(wishId, body.decision)));
          return;
        }
        const action = pathname.slice('/api/admin/'.length);
        const handlers: Record<string, () => Promise<PublicSnapshot>> = {
          tick: deps.tick.bind(deps),
          pause: deps.pause.bind(deps),
          resume: deps.resume.bind(deps),
          reset: deps.reset.bind(deps),
        };
        if (!Object.hasOwn(handlers, action)) throw new HttpError(404, 'Unknown owner action.');
        const isCharacterAction = action === 'tick' || action === 'reset';
        if (isCharacterAction && !(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new HttpError(400, 'Owner action body must be an empty object.');
        if (!(await managesCharacter()) && (isCharacterAction || !account?.isWorldAdmin))
          throw new HttpError(403, 'Character ownership or world moderation is required.');
        send(200, publicSnapshot(await handlers[action]()));
        return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (error instanceof HttpError || error instanceof VisitorError)
        send(error.status, { error: error.message });
      else send(500, { error: 'The local controller could not complete this request.' });
    }
  }
  return Object.assign(server, {
    async waitForRequests() {
      while (active.size) await Promise.allSettled([...active]);
    },
  });
}

/** Stop admission, drain current handlers, then let the caller close controller/auth storage. */
export async function closeApiServer(
  server: ReturnType<typeof createApiServer>,
  graceMs = 5000,
): Promise<void> {
  const closed = new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
        reject(error);
      else resolve();
    }),
  );
  const force = setTimeout(() => server.closeAllConnections(), graceMs);
  server.closeIdleConnections();
  try {
    await closed;
    await server.waitForRequests();
  } finally {
    clearTimeout(force);
  }
}
