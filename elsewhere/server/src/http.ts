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
import {
  AdmissionPool,
  DEFAULT_API_TRAFFIC_LIMITS,
  ResponseBudget,
  WindowQuota,
  type ApiTrafficLimits,
} from './admission.js';

export interface ApiAuth {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  getAccount(req: IncomingMessage): Promise<AccountSummary | null>;
  isWorldAdmin(req: IncomingMessage): Promise<boolean>;
  passwordAuthEnabled?: boolean;
  requiresEmailVerification?: boolean;
}

export interface ApiDependencies {
  /** Absolute JSON body deadline; trusted test/operator configuration, never client input. */
  bodyTimeoutMs?: number;
  /** Trusted host configuration only; no request can change admission or payload budgets. */
  traffic?: Partial<ApiTrafficLimits>;
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
    ...(item.sourceUrl?.startsWith('https://')
      ? { sourceUrl: item.sourceUrl, sourceTitle: item.sourceTitle }
      : {}),
  });
  return {
    world: publicWorld(snapshot.world),
    ...(snapshot.notebook
      ? {
          notebook: {
            enabled: snapshot.notebook.enabled === true,
            entries: snapshot.notebook.entries.slice(-32).map(({ id, at, text, sourceIds }) => ({
              id,
              at,
              text: text.slice(0, 360),
              sourceIds: sourceIds.slice(0, 3),
            })),
            ...(snapshot.notebook.draft
              ? {
                  draft: {
                    id: snapshot.notebook.draft.id,
                    at: snapshot.notebook.draft.at,
                    text: snapshot.notebook.draft.text.slice(0, 360),
                  },
                }
              : {}),
          },
        }
      : {}),
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

function readJson(req: IncomingMessage, timeoutMs: number): Promise<unknown> {
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
    let size = 0,
      settled = false;
    const finish = (error?: HttpError, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.off('data', data);
      req.off('end', end);
      req.off('aborted', aborted);
      chunks.length = 0;
      if (error) {
        req.resume();
        reject(error);
      } else resolve(value);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        finish(new HttpError(413, 'Request body exceeds 64 KB.'));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      try {
        finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        finish(new HttpError(400, 'Malformed JSON.'));
      }
    };
    const aborted = () => finish(new HttpError(400, 'Request interrupted.'));
    const deadline = setTimeout(
      () => finish(new HttpError(408, 'Request body timed out.')),
      timeoutMs,
    );
    deadline.unref();
    req.on('data', data);
    req.on('end', end);
    // Retain this no-op-after-settlement listener for late TCP errors after an abort.
    req.on('error', aborted);
    req.on('aborted', aborted);
  });
}

function authenticated(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const expected = Buffer.from(token);
  const received = Buffer.from(supplied);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createApiServer(deps: ApiDependencies) {
  const bodyTimeoutMs = deps.bodyTimeoutMs ?? 5000;
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 10 || bodyTimeoutMs > 15000)
    throw new Error('JSON body timeout must be between 10 and 15000 ms.');
  if (deps.adminToken.length < 24) throw new Error('Owner token must be at least 24 characters.');
  if (deps.proxySecret && deps.proxySecret.length < 32)
    throw new Error('Proxy secret must be at least 32 characters.');
  const origins = new Set(
    deps.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
  );
  const limits = new WindowQuota(4096);
  const traffic = { ...DEFAULT_API_TRAFFIC_LIMITS, ...deps.traffic };
  for (const value of Object.values(traffic))
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1024 * 1024 * 1024)
      throw new Error('Traffic limits must be bounded positive integers.');
  const globalLimits = new WindowQuota(16);
  const responses = new ResponseBudget(traffic.publicPayloadBytesPerMinute);
  // Only verified principals reach this table; public identity churn cannot fill it.
  const controlLimits = new WindowQuota(256);
  const controlChecks = new WindowQuota(1024);
  const publicReads = new AdmissionPool(32, 4);
  const publicWrites = new AdmissionPool(8, 2);
  const accounts = new AdmissionPool(8, 2);
  const authentication = new AdmissionPool(8, 2);
  const controlVerification = new AdmissionPool(4, 1);
  const controls = new AdmissionPool(4, 2);
  const visitorReads = new AdmissionPool(16, 2);
  const visitorWrites = new AdmissionPool(16, 1);
  const visitors = new VisitorRegistry();
  const snapshotWithVisitors = async () => {
    const snapshot = publicSnapshot(await deps.getSnapshot());
    snapshot.world.visitors = visitors.publicVisitors(snapshot.world);
    return snapshot;
  };
  const active = new Set<Promise<void>>();
  const server = createServer(
    { headersTimeout: 10_000, requestTimeout: 15_000, connectionsCheckingInterval: 1000 },
    (req: IncomingMessage, res: ServerResponse) => {
      const bodyExpected =
        req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? '0') > 0;
      // Start at header receipt, before any account/database lookup.
      const bodyDeadline = bodyExpected
        ? setTimeout(() => {
            if (req.complete || req.destroyed || res.writableEnded) return;
            if (res.headersSent) {
              req.destroy();
              return;
            }
            res.statusCode = 408;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Retry-After', '1');
            res.end(JSON.stringify({ error: 'Request body timed out.' }));
          }, bodyTimeoutMs)
        : undefined;
      bodyDeadline?.unref();
      const clearBodyDeadline = () => clearTimeout(bodyDeadline);
      req.once('end', clearBodyDeadline);
      req.once('aborted', clearBodyDeadline);
      res.once('finish', clearBodyDeadline);
      const originalEnd = res.end;
      res.end = function (this: ServerResponse, ...args: Parameters<ServerResponse['end']>) {
        const unread = bodyExpected && !req.readableEnded;
        const rejection = [401, 403, 404, 408, 413, 415, 429, 503].includes(this.statusCode);
        if (unread || rejection) {
          if (!this.headersSent) this.setHeader('Connection', 'close');
          this.shouldKeepAlive = false;
          this.once('finish', () => req.socket.destroySoon());
        }
        return Reflect.apply(originalEnd, this, args);
      } as ServerResponse['end'];
      const operation = handle(req, res);
      active.add(operation);
      void operation
        .catch(() => {
          if (!res.destroyed) res.destroy();
        })
        .finally(() => active.delete(operation));
    },
  );
  server.maxConnections = 256;
  server.maxHeadersCount = 64;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.setTimeout(60_000, (socket) => socket.destroy());
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const releases: Array<() => void> = [];
    let responseBudget: ReturnType<ResponseBudget['reserve']> | undefined;
    const enter = (pool: AdmissionPool, client: string) => {
      const release = pool.enter(client);
      if (!release) {
        res.setHeader('Retry-After', '2');
        throw new HttpError(503, 'Elsewhere is busy. Please retry shortly.');
      }
      releases.push(release);
      return release;
    };
    const consume = (key: string, maximum: number, now: number, quota = limits) => {
      const result = quota.consume(key, maximum, now);
      if (!result.allowed) res.setHeader('Retry-After', String(result.retryAfter));
      return result.allowed;
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.headers.origin;
    const sendBody = (status: number, body: string) => {
      if (res.destroyed || res.writableEnded) return;
      if (
        status >= 200 &&
        status < 300 &&
        responseBudget &&
        !responseBudget.commit(Buffer.byteLength(body), Date.now())
      ) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.removeHeader('Content-Disposition');
        res.setHeader('Retry-After', '60');
        res.statusCode = 429;
        res.end(
          JSON.stringify({ error: 'Public response capacity reached. Please retry shortly.' }),
        );
        return;
      }
      res.statusCode = status;
      res.end(body);
    };
    const send = (status: number, value: unknown) => sendBody(status, JSON.stringify(value));
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/health') {
        res.setHeader('Connection', 'close');
        res.shouldKeepAlive = false;
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
        res.setHeader('Connection', 'close');
        res.shouldKeepAlive = false;
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
      const owner = authenticated(req, deps.adminToken);
      const controlRoute = req.method === 'POST' && pathname.startsWith('/api/admin/');
      const visitorRoute = /^\/api\/visitors\/(visitor-[a-f0-9-]{36})(\/action)?$/.exec(pathname);
      const visitorRequest =
        visitorRoute &&
        ((req.method === 'GET' && !visitorRoute[2]) || (req.method === 'POST' && visitorRoute[2]));
      if (visitorRequest) {
        try {
          visitors.authenticate(
            visitorRoute[1],
            req.headers.authorization?.replace(/^Bearer /, '') ?? '',
          );
        } catch (error) {
          if (
            !consume(`visitor-denied:${clientAddress}`, 120, Date.now()) ||
            !consume('visitor-denied', 600, Date.now(), globalLimits)
          )
            throw new HttpError(429, 'Visitor request limit reached.');
          throw error;
        }
      }
      let releaseVerification: (() => void) | undefined;
      if (controlRoute && owner) enter(controls, 'bearer-owner');
      else if (controlRoute) {
        // A cookie or Authorization header alone never earns privileged admission.
        if (!consume(`control-check:${clientAddress}`, 60, Date.now(), controlChecks))
          throw new HttpError(429, 'Please wait before trying authorization again.');
        if (!consume('control-check', 240, Date.now(), globalLimits))
          throw new HttpError(429, 'Authorization capacity reached. Please retry shortly.');
        releaseVerification = enter(controlVerification, clientAddress);
      } else if (visitorRequest) {
        enter(req.method === 'GET' ? visitorReads : visitorWrites, visitorRoute[1]);
      } else if (pathname.startsWith('/api/auth/')) enter(authentication, clientAddress);
      else if (pathname === '/api/account') enter(accounts, clientAddress);
      else if (req.method === 'GET') enter(publicReads, clientAddress);
      else enter(publicWrites, clientAddress);

      if (!controlRoute && !pathname.startsWith('/api/auth/')) {
        responseBudget = responses.reserve(Date.now());
        if (!responseBudget) {
          res.setHeader('Retry-After', '60');
          throw new HttpError(429, 'Public response capacity reached. Please retry shortly.');
        }
        releases.push(responseBudget.release);
      }

      if (req.method === 'GET') {
        const bucket =
          pathname === '/api/world'
            ? (['world-read', 120] as const)
            : pathname === '/api/account'
              ? (['account-read', 60] as const)
              : pathname.startsWith('/api/artifacts/')
                ? (['artifact-read', 30] as const)
                : pathname.startsWith('/api/visitors/') || pathname.startsWith('/api/auth/')
                  ? null
                  : (['other-read', 60] as const);
        if (bucket && !consume(`${bucket[0]}:${clientAddress}`, bucket[1], Date.now()))
          throw new HttpError(429, 'Please wait before requesting more data.');
        const global =
          pathname === '/api/world'
            ? (['world-read', traffic.worldReadsPerMinute] as const)
            : pathname === '/api/account'
              ? (['account-read', traffic.accountReadsPerMinute] as const)
              : pathname.startsWith('/api/artifacts/')
                ? (['artifact-read', traffic.artifactReadsPerMinute] as const)
                : pathname.startsWith('/api/visitors/')
                  ? (['visitor', 18000] as const)
                  : pathname.startsWith('/api/auth/')
                    ? null
                    : (['other-read', 600] as const);
        if (global && !consume(global[0], global[1], Date.now(), globalLimits))
          throw new HttpError(429, 'Public request capacity reached. Please retry shortly.');
      }
      if (
        req.method !== 'GET' &&
        !controlRoute &&
        !visitorRequest &&
        !pathname.startsWith('/api/auth/') &&
        pathname !== '/api/visitors' &&
        pathname !== '/api/messages'
      ) {
        if (
          !consume(`other-write:${clientAddress}`, 60, Date.now()) ||
          !consume('other-read', 600, Date.now(), globalLimits)
        )
          throw new HttpError(429, 'Public request capacity reached. Please retry shortly.');
      }
      if (pathname.startsWith('/api/auth/')) {
        if (!deps.auth) throw new HttpError(503, 'Accounts are not configured.');
        if (!consume(`auth:${clientAddress}`, 60, Date.now()))
          throw new HttpError(429, 'Please wait before trying authentication again.');
        if (!consume('auth', 600, Date.now(), globalLimits))
          throw new HttpError(429, 'Authentication capacity reached. Please retry shortly.');
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
        if (!consume('visitor-create', 30, Date.now(), globalLimits))
          throw new HttpError(429, 'Visitor admission is busy. Please retry shortly.');
        if (!consume(`visitor-create:${ip}`, 8, Date.now()))
          throw new HttpError(429, 'Please wait before creating another visitor.');
        const body = await readJson(req, bodyTimeoutMs);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new HttpError(400, 'Visitor registration takes an empty object.');
        send(201, visitors.create((await deps.getSnapshot()).world, clientAddress));
        return;
      }
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
        if (req.method === 'POST' && !consume('visitor', 18000, Date.now(), globalLimits))
          throw new HttpError(429, 'Visitor capacity reached. Please retry shortly.');
        const world = (await deps.getSnapshot()).world;
        const session =
          req.method === 'GET'
            ? visitors.get(visitorRoute[1], token, world)
            : visitors.act(visitorRoute[1], token, await readJson(req, bodyTimeoutMs), world);
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
        sendBody(200, artifact.body);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/messages') {
        if (!consume('messages', 120, Date.now(), globalLimits))
          throw new HttpError(429, 'Message capacity reached. Please retry shortly.');
        const account = deps.auth ? await deps.auth.getAccount(req) : null;
        if (!consume(account ? `message:user:${account.id}` : `message:${ip}`, 5, Date.now()))
          throw new HttpError(429, 'Please wait before leaving another thought.');
        const parsed = VisitorMessageSchema.safeParse(await readJson(req, bodyTimeoutMs));
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
        if (!owner) {
          releaseVerification?.();
          enter(controls, `user:${account!.id}`);
        }
        if (
          !consume(
            owner ? 'admin:owner' : `admin:user:${account!.id}`,
            120,
            Date.now(),
            controlLimits,
          )
        )
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
          const body = await readJson(req, bodyTimeoutMs);
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
        const body = await readJson(req, bodyTimeoutMs);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new HttpError(400, 'Owner action body must be an empty object.');
        if (
          (isCharacterAction || (!owner && !account?.isWorldAdmin)) &&
          !(await managesCharacter())
        )
          throw new HttpError(403, 'Character ownership or world moderation is required.');
        const result = await handlers[action]();
        if (action === 'reset') visitors.clear();
        send(200, publicSnapshot(result));
        return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (error instanceof HttpError || error instanceof VisitorError) {
        if (error.status === 408 && !res.hasHeader('Retry-After'))
          res.setHeader('Retry-After', '1');
        if ((error.status === 429 || error.status === 503) && !res.hasHeader('Retry-After'))
          res.setHeader('Retry-After', error.status === 429 ? '60' : '2');
        send(error.status, { error: error.message });
      } else send(500, { error: 'The local controller could not complete this request.' });
    } finally {
      for (const release of releases) release();
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
