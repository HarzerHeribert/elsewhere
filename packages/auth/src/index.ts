import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Database from 'better-sqlite3';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { admin } from 'better-auth/plugins';
import { oneTimeToken } from 'better-auth/plugins/one-time-token';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { AccountSummary } from '@elsewhere/character-interfaces';
export type { AccountSummary } from '@elsewhere/character-interfaces';
export { authOptionsFromEnvironment } from './environment';
export interface LocalAuthOptions {
  dataDirectory: string;
  baseURL: string;
  trustedOrigins: string[];
  secret?: string;
  databaseUrl?: string;
  adminUserIds?: string[];
  production?: boolean;
  bodyTimeoutMs?: number;
  sendVerificationEmail?: (message: { email: string; name: string; url: string }) => Promise<void>;
  sendSignInEmail?: (message: { email: string; url: string }) => Promise<void>;
}

/** Separate from the owner token. Neither credential is passed into Hubert or a public response. */
function authSecret(directory: string, supplied?: string): string {
  if (supplied !== undefined) {
    if (supplied.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters.');
    return supplied;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'auth-secret');
  if (existsSync(file)) {
    chmodSync(file, 0o600);
    const secret = readFileSync(file, 'utf8').trim();
    if (secret.length < 32)
      throw new Error(
        'The saved auth secret is invalid. Restore it before starting authentication.',
      );
    return secret;
  }
  const secret = randomBytes(48).toString('base64url');
  try {
    writeFileSync(file, secret, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return authSecret(directory);
    throw error;
  }
  return secret;
}

/** Real Better Auth with its own database and signed HTTP-only session cookies. */
export async function createLocalAuth(options: LocalAuthOptions) {
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 5000;
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 10 || bodyTimeoutMs > 15000)
    throw new Error('Authentication body timeout must be between 10 and 15000 ms.');
  const base = new URL(options.baseURL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Auth baseURL must be an HTTP(S) URL without credentials, query or fragment.');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  if (production && base.protocol !== 'https:')
    throw new Error('Production authentication requires an HTTPS baseURL.');
  if (production && !options.secret)
    throw new Error('Production authentication requires an explicit BETTER_AUTH_SECRET.');
  const secret = authSecret(options.dataDirectory, options.secret);
  mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
  const sqlite = options.databaseUrl
    ? undefined
    : new Database(join(options.dataDirectory, 'auth.sqlite'));
  sqlite?.pragma('journal_mode = WAL');
  sqlite?.pragma('foreign_keys = ON');
  if (sqlite) chmodSync(join(options.dataDirectory, 'auth.sqlite'), 0o600);
  const pool = options.databaseUrl
    ? new pg.Pool({
        connectionString: options.databaseUrl,
        max: 3,
        connectionTimeoutMillis: 5000,
        query_timeout: 6000,
        statement_timeout: 5000,
        lock_timeout: 2000,
        idle_in_transaction_session_timeout: 5000,
      })
    : undefined;
  pool?.on('error', () => {
    // pg discards failed idle clients; individual active operations still reject normally.
  });
  const explicitAdmins = new Set(options.adminUserIds ?? []);
  // Local development has no email sender. Public password auth remains off until delivery exists.
  const passwordAuthEnabled = !production || Boolean(options.sendVerificationEmail);
  const emailLinkAuthEnabled = Boolean(options.sendSignInEmail);
  const allowedOrigins = new Set([base.origin, ...options.trustedOrigins]);
  const operatorTokens = oneTimeToken({
    disableClientRequest: true,
    storeToken: 'hashed',
    expiresIn: 15,
  });
  const auth = betterAuth({
    appName: 'Elsewhere',
    baseURL: base.origin,
    basePath: '/api/auth',
    secret,
    database: pool ?? sqlite!,
    trustedOrigins: [...allowedOrigins],
    logger: { disabled: true },
    user: { modelName: 'elsewhere_auth_user' },
    session: {
      modelName: 'elsewhere_auth_session',
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    account: { modelName: 'elsewhere_auth_account' },
    verification: { modelName: 'elsewhere_auth_verification' },
    emailAndPassword: {
      enabled: passwordAuthEnabled,
      requireEmailVerification: production,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    ...(options.sendVerificationEmail
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string; name: string };
              url: string;
            }) => {
              await options.sendVerificationEmail!({ email: user.email, name: user.name, url });
            },
          },
        }
      : {}),
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: 'database',
      modelName: 'elsewhere_auth_rate_limit',
    },
    advanced: {
      useSecureCookies: production,
      cookiePrefix: 'elsewhere',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production },
    },
    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'], adminUserIds: [...explicitAdmins] }),
      operatorTokens,
      ...(options.sendSignInEmail
        ? [
            magicLink({
              storeToken: 'hashed',
              expiresIn: 600,
              disableSignUp: true,
              rateLimit: { window: 60, max: 5 },
              sendMagicLink: async ({ email, url }) => options.sendSignInEmail!({ email, url }),
            }),
          ]
        : []),
    ],
  });
  try {
    const migration = await getMigrations(auth.options);
    await migration.runMigrations();
    await auth.$context;
  } catch (error) {
    sqlite?.close();
    await pool?.end();
    throw error;
  }
  // World administration grants no authority over other people's accounts. Keep the admin
  // plugin's role schema while deliberately withholding all of its public account-admin APIs.
  const webHandler = async (request: Request): Promise<Response> => {
    const failure = (status: number, message: string) => Response.json({ message }, { status });
    const validReturn = (value: unknown) => {
      if (value === undefined || value === null) return true;
      if (typeof value !== 'string' || value.length > 2000) return false;
      try {
        const target = new URL(value, base.origin);
        return target.origin === base.origin && !target.username && !target.password;
      } catch {
        return false;
      }
    };
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return failure(400, 'Invalid authentication route.');
    }
    if (path.includes('%') || path.includes('\\') || !/^\/api\/auth\/[a-zA-Z0-9/_-]+$/.test(path))
      return failure(400, 'Invalid authentication route.');
    if (path === '/api/auth/admin' || path.startsWith('/api/auth/admin/'))
      return failure(403, 'Account-administration endpoints are not enabled.');
    if (path === '/api/auth/one-time-token/generate')
      return failure(403, 'Sign-in links are issued only by the private operator command.');
    if (path === '/api/auth/magic-link/verify') {
      const parameters = new URL(request.url).searchParams;
      if (
        ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'].some((key) =>
          parameters.getAll(key).some((value) => !validReturn(value)),
        )
      )
        return failure(403, 'Sign-in returns must stay on this Elsewhere instance.');
    }
    const origin = request.headers.get('origin');
    if (origin && !allowedOrigins.has(origin)) return failure(403, 'Origin is not permitted.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin)
      return failure(403, 'A trusted origin is required for authentication changes.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        return failure(415, 'Use application/json.');
      if (Number(request.headers.get('content-length') ?? 0) > 65_536)
        return failure(413, 'Authentication request exceeds 64 KB.');
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error('Authentication request body timed out.'));
            void reader?.cancel().catch(() => undefined);
          }, bodyTimeoutMs);
          timer.unref();
        });
        const read = async () => {
          if (!reader) return;
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.byteLength;
            if (length > 65_536) {
              void reader.cancel().catch(() => undefined);
              return false;
            }
            chunks.push(item.value);
          }
          return true;
        };
        if ((await Promise.race([read(), deadline])) === false)
          return failure(413, 'Authentication request exceeds 64 KB.');
      } catch {
        if (expired)
          return Response.json(
            { message: 'Authentication request body timed out.' },
            { status: 408, headers: { 'Retry-After': '1', Connection: 'close' } },
          );
        return failure(400, 'Authentication request was interrupted.');
      } finally {
        clearTimeout(timer);
      }
      const body = Buffer.concat(chunks);
      if (path === '/api/auth/sign-in/magic-link') {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(body.toString());
        } catch {
          return failure(400, 'Invalid authentication request.');
        }
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL'].some(
            (key) => !validReturn(input[key]),
          )
        )
          return failure(403, 'Sign-in returns must stay on this Elsewhere instance.');
      }
      const response = await auth.handler(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body,
        }),
      );
      if (path === '/api/auth/one-time-token/verify' && response.ok) {
        const headers = new Headers(response.headers);
        headers.set('content-type', 'application/json');
        headers.set('cache-control', 'no-store');
        headers.delete('content-length');
        await response.body?.cancel();
        // The ordinary HttpOnly cookie is sufficient; never return its raw session token to JS.
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      }
      return response;
    }
    const response = await auth.handler(request);
    if (path === '/api/auth/magic-link/verify') {
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      headers.set('referrer-policy', 'no-referrer');
      if (response.ok) {
        headers.set('content-type', 'application/json');
        headers.delete('content-length');
        await response.body?.cancel();
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      }
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  };
  const nodeHandler = toNodeHandler(webHandler);
  async function getSession(req: IncomingMessage) {
    return auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
    });
  }
  async function getAccount(req: IncomingMessage): Promise<AccountSummary | null> {
    const session = await getSession(req);
    if (!session?.user) return null;
    const user = session.user;
    if (user.banned) return null;
    const allowed = user.role?.split(',').includes('admin') || explicitAdmins.has(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: allowed ? 'admin' : 'user',
      isWorldAdmin: Boolean(allowed),
    };
  }
  async function isWorldAdmin(req: IncomingMessage) {
    return (await getAccount(req))?.isWorldAdmin ?? false;
  }
  /** Trusted operator only: no HTTP endpoint creates privileged users or grants character ownership. */
  async function createOperatorAccount(input: { email: string; name: string }) {
    if (!input.name.trim() || input.name.length > 60 || input.email.length > 254)
      throw new Error('Invalid operator identity.');
    const { user } = await auth.api.createUser({
      body: { email: input.email, name: input.name.trim(), role: 'admin' },
    });
    return user.id;
  }
  /** Recovery link for an explicitly provisioned operator, with ordinary revocable auth sessions. */
  async function issueOperatorSignIn(userId: string) {
    const context = await auth.$context;
    const user = await context.internalAdapter.findUserById(userId);
    if (
      !user ||
      ('banned' in user && user.banned) ||
      !('role' in user) ||
      typeof user.role !== 'string' ||
      !user.role.split(',').includes('admin')
    )
      throw new Error('An existing world operator account is required.');
    const session = await context.internalAdapter.createSession(userId);
    if (!session) throw new Error('Operator session could not be created.');
    try {
      const { token } = await operatorTokens.endpoints.generateOneTimeToken({
        context: { ...context, session: { user, session } },
      });
      const url = new URL(base.origin);
      url.hash = new URLSearchParams({ 'sign-in': token }).toString();
      return { url: url.href, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    } catch {
      await context.internalAdapter.deleteSession(session.token);
      throw new Error('Operator sign-in link could not be issued.');
    }
  }
  // Deliberately not mounted as an HTTP endpoint. Only a trusted out-of-band owner command may call it.
  async function setWorldAdmin(userId: string, enabled = true): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error('Invalid user identifier.');
    if (pool) {
      const result = await pool.query(
        'UPDATE "elsewhere_auth_user" SET "role"=$1,"updatedAt"=$2 WHERE "id"=$3',
        [enabled ? 'admin' : 'user', new Date(), userId],
      );
      if (result.rowCount !== 1) throw new Error('Account not found.');
    } else {
      const result = sqlite!
        .prepare('UPDATE "elsewhere_auth_user" SET "role"=?,"updatedAt"=? WHERE "id"=?')
        .run(enabled ? 'admin' : 'user', Date.now(), userId);
      if (result.changes !== 1) throw new Error('Account not found.');
    }
  }
  return {
    handle: async (req: IncomingMessage, res: ServerResponse) => nodeHandler(req, res),
    webHandler,
    getSession,
    getAccount,
    isWorldAdmin,
    setWorldAdmin,
    createOperatorAccount,
    issueOperatorSignIn,
    passwordAuthEnabled,
    emailLinkAuthEnabled,
    requiresEmailVerification: production,
    close: async () => {
      sqlite?.close();
      await pool?.end();
    },
  };
}
export type LocalAuth = Awaited<ReturnType<typeof createLocalAuth>>;
