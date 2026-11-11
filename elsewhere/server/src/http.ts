import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import {
  MailComposeSchema,
  MailPreferencesSchema,
  type AccountCharacterMail,
  type MailComposeInput,
  type MailPreferences,
  type PublicCharacterMail,
} from '../../../characters/interfaces/src/mail';
import { MailError } from '../../../packages/mail/src/service';
import { MailTransportError } from '../../../packages/mail/src/resend';
import {
  PROTOCOL_VERSION,
  VisitorMessageSchema,
  type AccountSummary,
  type PublicPursuit,
  type PublicPursuitEntry,
  type PublicSnapshot,
  type PublicTrailEntry,
  type ProviderIssue,
} from '@elsewhere/character-interfaces';
import { publicWorld } from './world.js';
import {
  CreateCreationSchema,
  PinCreationSchema,
  type CreateCreationInput,
} from '../../../characters/interfaces/src/creations';
import { CreationError, publicCreations } from '../../../packages/creations/src/index';
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
  emailLinkAuthEnabled?: boolean;
  passkeyAuthEnabled?: boolean;
  socialProviders?: ReadonlyArray<'github' | 'google'>;
  getLinkedSocialProviders?(req: IncomingMessage): Promise<Array<'github' | 'google'>>;
  getSecurityState?(req: IncomingMessage): Promise<{
    ownerControlsRequirePasskey: boolean;
    ownerControlsUnlocked: boolean;
    passkeyVerifiedRecently: boolean;
  } | null>;
  canUseOwnerControls?(req: IncomingMessage): Promise<boolean>;
  requiresEmailVerification?: boolean;
}

export interface ApiCharacterMail {
  getPublic(characterId: string): PublicCharacterMail | null;
  getAccount(userId: string, managedIds: string[]): Promise<AccountCharacterMail[]>;
  setPreferences(
    characterId: string,
    userId: string,
    preferences: MailPreferences,
  ): Promise<unknown>;
  compose(characterId: string, input: MailComposeInput, source: 'owner'): Promise<unknown>;
  approve(characterId: string, draftId: string, ownerUserId: string): Promise<unknown>;
  unsubscribe(token: string): Promise<unknown>;
}
export interface ApiDependencies {
  characterMail?: ApiCharacterMail;
  handleMailWebhook?(rawBody: string, headers: IncomingHttpHeaders): Promise<unknown>;
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
  getCharacterIssues?(): ProviderIssue[] | Promise<ProviderIssue[]>;
  retryCharacterProvider?(): Promise<unknown>;
  createCreation?(input: CreateCreationInput): Promise<unknown>;
  pinCreation?(creationId: string, pinned: boolean): Promise<unknown>;
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

const httpsUrl = (value: string | undefined): string | undefined => {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password && value!.length <= 2048
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};
const publicPursuitEntry = (entry: PublicPursuitEntry): PublicPursuitEntry => {
  const base = { id: String(entry.id).slice(0, 128), at: entry.at };
  switch (entry.kind) {
    case 'search':
      return {
        ...base,
        kind: 'search',
        query: entry.query.slice(0, 240),
        sourceCount: entry.sourceCount,
      };
    case 'read':
      return {
        ...base,
        kind: 'read',
        sourceId: entry.sourceId.slice(0, 128),
        url: httpsUrl(entry.url) ?? '',
        title: entry.title.slice(0, 180),
      };
    case 'note':
      return {
        ...base,
        kind: 'note',
        text: entry.text.slice(0, 600),
        surprised: entry.surprised === true,
        sourceIds: entry.sourceIds.slice(0, 8).map((id) => id.slice(0, 128)),
      };
    case 'made':
      return {
        ...base,
        kind: 'made',
        creationId: entry.creationId.slice(0, 128),
        path: entry.path.slice(0, 240),
        title: entry.title.slice(0, 180),
        url: httpsUrl(entry.url) ?? '',
        commitSha: entry.commitSha.slice(0, 64),
      };
    case 'tried':
      return {
        ...base,
        kind: 'tried',
        text: entry.text.slice(0, 240),
        objectId: entry.objectId.slice(0, 128),
      };
  }
};
const publicPursuit = (pursuit: PublicPursuit): PublicPursuit => ({
  id: pursuit.id,
  question: pursuit.question.slice(0, 240),
  why: pursuit.why.slice(0, 240),
  status: pursuit.status,
  openedAt: pursuit.openedAt,
  lastAt: pursuit.lastAt,
  questions: pursuit.questions.slice(0, 8).map((question) => question.slice(0, 240)),
  ...(pursuit.setAsideReason ? { setAsideReason: pursuit.setAsideReason.slice(0, 240) } : {}),
  entries: pursuit.entries.slice(-40).map(publicPursuitEntry),
});
const publicTrailEntry = (entry: PublicTrailEntry): PublicTrailEntry => ({
  id: entry.id,
  at: entry.at,
  kind: entry.kind,
  ...(entry.why ? { why: entry.why.slice(0, 200) } : {}),
  ...(entry.pursuitId ? { pursuitId: entry.pursuitId } : {}),
  ...(entry.text ? { text: entry.text.slice(0, 600) } : {}),
  ...(httpsUrl(entry.url) ? { url: entry.url } : {}),
  ...(entry.placeId ? { placeId: entry.placeId } : {}),
  ...(Number.isSafeInteger(entry.times) && entry.times! > 1 ? { times: entry.times } : {}),
});

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
    ...(snapshot.mail
      ? {
          mail: {
            characterId: snapshot.mail.characterId,
            name: snapshot.mail.name,
            address: snapshot.mail.address,
            receiving: snapshot.mail.receiving,
            sendingAvailable: snapshot.mail.sendingAvailable === true,
          },
        }
      : {}),
    creations: publicCreations(snapshot.creations ?? [], character.id),
    pursuits: (snapshot.pursuits ?? []).slice(0, 12).map(publicPursuit),
    trail: (snapshot.trail ?? []).slice(-120).map(publicTrailEntry),
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
    wishes: snapshot.wishes?.map(({ id, text, createdAt, status, fulfilledAt, declinedAt }) => ({
      id,
      text,
      createdAt,
      status,
      fulfilledAt,
      declinedAt,
    })),
    runtime: {
      mode: snapshot.runtime.mode,
      paused: snapshot.runtime.paused,
      tick: snapshot.runtime.tick,
      startedAt: snapshot.runtime.startedAt,
      simulatedAt: snapshot.runtime.simulatedAt,
      ...(snapshot.runtime.clock ? { clock: snapshot.runtime.clock } : {}),
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

/** Raw payload is preserved for provider signature verification. */
function readRaw(req: IncomingMessage, timeoutMs: number, maximum = 131072): Promise<string> {
  return new Promise((resolve, reject) => {
    if (req.destroyed || req.aborted || req.readableEnded) {
      reject(new HttpError(400, 'Request interrupted.'));
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0,
      done = false;
    const finish = (error?: HttpError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAbort);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximum) finish(new HttpError(413, 'Mail request is too large.'));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onAbort = () => finish(new HttpError(400, 'Request interrupted.'));
    const timer = setTimeout(
      () => finish(new HttpError(408, 'Request body timed out.')),
      timeoutMs,
    );
    timer.unref();
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAbort);
    req.on('error', onAbort);
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
      const requestUrl = new URL(req.url ?? '/', 'http://localhost');
      const pathname = requestUrl.pathname;
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
      // Only this signed provider endpoint can enter without the browser proxy secret.
      // The callback verifies the raw body and signature before any provider fetch or state change.
      if (req.method === 'POST' && pathname === '/api/mail/webhook/resend') {
        if (deps.isReady && !deps.isReady())
          throw new HttpError(503, 'Mail is temporarily unavailable.');
        if (!deps.handleMailWebhook) throw new HttpError(503, 'Mail receiving is not configured.');
        const ip = req.socket.remoteAddress ?? 'unknown';
        enter(publicWrites, ip);
        if (
          !consume(`mail-webhook:${ip}`, 120, Date.now()) ||
          !consume('mail-webhook', 600, Date.now(), globalLimits)
        )
          throw new HttpError(429, 'Mail webhook capacity reached.');
        const raw = await readRaw(req, bodyTimeoutMs);
        try {
          await deps.handleMailWebhook(raw, req.headers);
        } catch (error) {
          if (
            error instanceof MailTransportError &&
            ['signature', 'input', 'response'].includes(error.code)
          )
            throw new HttpError(400, 'Mail webhook could not be verified.');
          throw new HttpError(503, 'Mail processing is temporarily unavailable.');
        }
        send(200, { accepted: true });
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
      const requireControlAssurance = async () => {
        if (!owner && deps.auth?.canUseOwnerControls && !(await deps.auth.canUseOwnerControls(req)))
          throw new HttpError(403, 'Verify a passkey to unlock owner controls for five minutes.');
      };
      const providerRetry =
        /^\/api\/characters\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/provider\/retry$/.exec(pathname);
      const creationRoute =
        /^\/api\/characters\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/creations(?:\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/pin)?$/.exec(
          pathname,
        );
      const mailRoute =
        /^\/api\/characters\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/mail\/(preferences|drafts)(?:\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/approve)?$/.exec(
          pathname,
        );
      const unsubscribeRoute =
        /^\/api\/mail\/unsubscribe\/([a-zA-Z0-9_.-]{32,2048})$/.exec(pathname) ??
        (pathname === '/api/mail/unsubscribe' &&
        /^[a-zA-Z0-9_.-]{32,2048}$/.test(requestUrl.searchParams.get('token') ?? '')
          ? [pathname, requestUrl.searchParams.get('token')!]
          : null);
      const controlRoute =
        req.method === 'POST' &&
        (pathname.startsWith('/api/admin/') ||
          !!providerRetry ||
          !!creationRoute ||
          (mailRoute !== null && mailRoute[2] === 'drafts'));
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
        // Better Auth reads only this server-owned address, never caller-supplied forwarding chains.
        req.headers['x-elsewhere-auth-client-ip'] = clientAddress;
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
        let characterMail: AccountCharacterMail[] | undefined;
        let characterMailUnavailable = false;
        if (account && deps.characterMail) {
          try {
            characterMail = await deps.characterMail.getAccount(
              account.id,
              managesCharacter ? [characterId] : [],
            );
          } catch {
            // Optional correspondence must not hide sign-in, ownership, or passkey recovery.
            characterMail = [];
            characterMailUnavailable = true;
          }
        }
        send(200, {
          user: account,
          enabled: true,
          passwordAuthEnabled: deps.auth.passwordAuthEnabled ?? true,
          ...(deps.auth.emailLinkAuthEnabled ? { emailLinkAuthEnabled: true } : {}),
          ...(deps.auth.passkeyAuthEnabled ? { passkeyAuthEnabled: true } : {}),
          requiresEmailVerification: deps.auth.requiresEmailVerification ?? false,
          ...(deps.auth.socialProviders?.length
            ? {
                socialProviders: [...deps.auth.socialProviders],
                ...(account
                  ? {
                      linkedSocialProviders:
                        (await deps.auth.getLinkedSocialProviders?.(req)) ?? [],
                    }
                  : {}),
              }
            : {}),
          ...(account ? await deps.auth.getSecurityState?.(req) : {}),
          managedCharacterIds: managesCharacter ? [characterId] : [],
          ...(characterMail !== undefined ? { characterMail } : {}),
          ...(characterMailUnavailable ? { characterMailUnavailable: true } : {}),
          ...(managesCharacter
            ? {
                characterIssues: ((await deps.getCharacterIssues?.()) ?? [])
                  .filter((issue) => issue.characterId === characterId)
                  .slice(-16)
                  .map(
                    ({
                      id,
                      characterId,
                      kind,
                      workload,
                      since,
                      lastAt,
                      message,
                      resolvedAt,
                      code,
                      fields,
                      retrying,
                    }) => ({
                      id,
                      characterId,
                      kind,
                      workload,
                      since,
                      lastAt,
                      message,
                      ...(code ? { code } : {}),
                      ...(fields ? { fields } : {}),
                      ...(retrying !== undefined ? { retrying } : {}),
                      ...(resolvedAt === undefined ? {} : { resolvedAt }),
                    }),
                  ),
              }
            : {}),
        });
        return;
      }
      if (unsubscribeRoute && (req.method === 'GET' || req.method === 'POST')) {
        if (!deps.characterMail) throw new HttpError(503, 'Character mail is unavailable.');
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
          );
          sendBody(
            200,
            `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe · Elsewhere</title><main><h1>Stop receiving these emails?</h1><p>This changes only the email preference linked to this message. Your Elsewhere account stays active.</p><form method="post" action="/api/mail/unsubscribe?token=${unsubscribeRoute[1]}"><button type="submit">Unsubscribe</button></form></main></html>`,
          );
        } else {
          await readRaw(req, bodyTimeoutMs, 4096);
          await deps.characterMail.unsubscribe(unsubscribeRoute[1]);
          send(200, { unsubscribed: true });
        }
        return;
      }
      if (req.method === 'POST' && mailRoute) {
        if (!deps.characterMail) throw new HttpError(503, 'Character mail is unavailable.');
        const account = deps.auth ? await deps.auth.getAccount(req) : null;
        if (!account) throw new HttpError(401, 'Sign in to manage character email.');
        if (!account.emailVerified) throw new HttpError(403, 'Verify your email address first.');
        if (!origin || !origins.has(origin))
          throw new HttpError(403, 'A trusted origin is required for email changes.');
        const characterId = mailRoute[1];
        if (characterId !== (await deps.getSnapshot()).character.id)
          throw new HttpError(404, 'Character not found.');
        const managesCharacter = async () =>
          (await deps.canManageCharacter?.(account.id, characterId)) === true;
        const ownerOperation = mailRoute[2] === 'drafts';
        if (ownerOperation && !(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        if (ownerOperation) await requireControlAssurance();
        if (ownerOperation && !owner) {
          releaseVerification?.();
          enter(controls, `user:${account.id}`);
        }
        // Personal subscription consent is public-account traffic, not owner-control capacity.
        if (
          !consume(
            `mail-change:${account.id}`,
            30,
            Date.now(),
            ownerOperation ? controlLimits : limits,
          )
        )
          throw new HttpError(429, 'Please wait before changing mail again.');
        const body = await readJson(req, bodyTimeoutMs);
        if (ownerOperation && !(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        // Re-read the session after consuming the body: revoked/unverified sessions cannot mutate.
        const currentAccount = await deps.auth!.getAccount(req);
        if (!currentAccount || currentAccount.id !== account.id || !currentAccount.emailVerified)
          throw new HttpError(403, 'A verified account is required.');
        if (ownerOperation) await requireControlAssurance();
        if (mailRoute[3]) {
          if (
            mailRoute[2] !== 'drafts' ||
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length
          )
            throw new HttpError(400, 'Approval takes an empty object.');
          send(200, await deps.characterMail.approve(characterId, mailRoute[3], account.id));
        } else if (ownerOperation) {
          const parsed = MailComposeSchema.safeParse(body);
          if (!parsed.success) throw new HttpError(400, 'Mail draft is invalid.');
          send(201, await deps.characterMail.compose(characterId, parsed.data, 'owner'));
        } else {
          const parsed = MailPreferencesSchema.safeParse(body);
          if (!parsed.success) throw new HttpError(400, 'Mail preferences are invalid.');
          send(200, await deps.characterMail.setPreferences(characterId, account.id, parsed.data));
        }
        return;
      }
      if (req.method === 'POST' && creationRoute) {
        const account = deps.auth ? await deps.auth.getAccount(req) : null;
        if (!account)
          throw new HttpError(401, 'Sign in as the character owner to manage creations.');
        const characterId = creationRoute[1];
        const managesCharacter = async () =>
          characterId === (await deps.getSnapshot()).character.id &&
          (await deps.canManageCharacter?.(account.id, characterId)) === true;
        if (!(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        await requireControlAssurance();
        if (!origin || !origins.has(origin))
          throw new HttpError(
            403,
            'A trusted origin is required for session-authenticated changes.',
          );
        if (!owner) {
          releaseVerification?.();
          enter(controls, `user:${account.id}`);
        }
        if (!consume(`creation-write:${account.id}`, 30, Date.now(), controlLimits))
          throw new HttpError(429, 'Please wait before changing creations again.');
        const body = await readJson(req, bodyTimeoutMs);
        const input = creationRoute[2]
          ? PinCreationSchema.safeParse(body)
          : CreateCreationSchema.safeParse(body);
        if (!input.success) throw new HttpError(400, 'Creation details are invalid.');
        if (!(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        await requireControlAssurance();
        try {
          if (creationRoute[2]) {
            if (!deps.pinCreation) throw new HttpError(503, 'Creation pinning is unavailable.');
            const pin = PinCreationSchema.parse(input.data);
            send(200, await deps.pinCreation(creationRoute[2], pin.pinned));
          } else {
            if (!deps.createCreation)
              throw new HttpError(503, 'Creation registration is unavailable.');
            send(201, await deps.createCreation(CreateCreationSchema.parse(input.data)));
          }
        } catch (error) {
          if (error instanceof CreationError) throw new HttpError(400, error.message);
          throw error;
        }
        return;
      }
      if (req.method === 'POST' && providerRetry) {
        const account = deps.auth ? await deps.auth.getAccount(req) : null;
        if (!account) throw new HttpError(401, 'Sign in as the character owner to retry.');
        const characterId = providerRetry[1];
        const managesCharacter = async () =>
          characterId === (await deps.getSnapshot()).character.id &&
          (await deps.canManageCharacter?.(account.id, characterId)) === true;
        if (!(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        await requireControlAssurance();
        if (!origin || !origins.has(origin))
          throw new HttpError(
            403,
            'A trusted origin is required for session-authenticated changes.',
          );
        if (!owner) {
          releaseVerification?.();
          enter(controls, `user:${account.id}`);
        }
        if (!consume(`provider-retry:${account.id}`, 5, Date.now(), controlLimits))
          throw new HttpError(429, 'Please wait before retrying the provider again.');
        const body = await readJson(req, bodyTimeoutMs);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new HttpError(400, 'Provider retry body must be an empty object.');
        if (!(await managesCharacter()))
          throw new HttpError(403, 'Character ownership is required.');
        await requireControlAssurance();
        if (!deps.retryCharacterProvider)
          throw new HttpError(503, 'Provider retry is unavailable.');
        await deps.retryCharacterProvider();
        send(200, { accepted: true });
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
        await requireControlAssurance();
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
          await requireControlAssurance();
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
        await requireControlAssurance();
        const result = await handlers[action]();
        if (action === 'reset') visitors.clear();
        send(200, publicSnapshot(result));
        return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (error instanceof MailError) {
        send(400, { error: error.message });
      } else if (error instanceof HttpError || error instanceof VisitorError) {
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
