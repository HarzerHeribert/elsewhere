import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import {
  ChatGPTError,
  ChatGPTStore,
  assertChatGPTSessionUsable,
  chatGPTClientIdSchema,
  type ChatGPTAccount,
} from './chatgpt-store';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
  timeoutDuration: 15000,
});
const tokenSchema = z.object({
  access_token: z.string().min(1).max(24000),
  refresh_token: z.string().min(1).max(24000).optional(),
  id_token: z.string().min(1).max(24000).optional(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive().max(86400),
  scope: z.string().max(4000),
  earliest_refresh_at: z.union([z.number().int().nonnegative(), z.string().datetime()]).optional(),
});
const terminalRefresh = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
const knownErrors = new Set([
  ...terminalRefresh,
  'invalid_client',
  'access_denied',
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'subscription_sharing_invalid_user',
  'subscription_sharing_user_unavailable',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
]);

/** The only shape of provider error name ever kept or logged: a short lowercase identifier. */
export const PROVIDER_ERROR_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** What an unrecognised failure's message is about, as one of these fixed labels. */
const FAILURE_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/overload|capacity|busy|unavailable/i, 'overloaded'],
  [/rate.?limit|too many requests|quota/i, 'rate_limited'],
  [/time.?out|timed out|deadline/i, 'timed_out'],
  [/context|too long|too large|maximum.{0,40}tokens/i, 'too_long'],
  [/schema|json|format/i, 'format'],
  [/safety|policy|flagged|moderation/i, 'policy'],
  [/auth|token|credential|permission|forbidden/i, 'auth'],
  [/internal|server error|try again|retry/i, 'server_error'],
];
/** The field names of a provider error and a label for its message; never the message itself. */
function failureShape(detail: unknown): { keys: string[]; hint?: string } {
  const record = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
  const keys = Object.keys(record)
    .filter((key) => PROVIDER_ERROR_NAME.test(key))
    .sort()
    .slice(0, 12);
  const message = typeof record.message === 'string' ? record.message.slice(0, 2000) : '';
  const hint = FAILURE_HINTS.find(([pattern]) => pattern.test(message))?.[1];
  return { keys, ...(hint ? { hint } : {}) };
}

/** Never copy provider bodies, authorization codes or credentials into exception messages. */
export function chatGPTFailure(
  payload: unknown,
  status?: number,
  requestId?: string,
): ChatGPTError {
  const body = payload as
    | { error?: { code?: unknown; type?: unknown } | string | null }
    | undefined;
  const detail = typeof body?.error === 'object' ? body.error : undefined;
  const candidate = typeof body?.error === 'string' ? body.error : detail?.code;
  const known = typeof candidate === 'string' && knownErrors.has(candidate);
  const failure = new ChatGPTError(
    known ? candidate : 'request_failed',
    status,
    requestId?.match(/^[\w-]{1,200}$/)?.[0],
  );
  if (!known) {
    // An unrecognised failure keeps the provider's name for it, so an outage can be told from
    // a rate limit afterwards. Only a short plain identifier qualifies, never free text.
    const named = [candidate, detail?.type].find(
      (value): value is string =>
        typeof value === 'string' && value !== 'error' && PROVIDER_ERROR_NAME.test(value),
    );
    if (named) failure.providerError = named;
    failure.shape = failureShape(detail ?? (typeof body?.error === 'string' ? undefined : body));
  }
  return failure;
}

export async function boundedChatGPTJson(response: Response, maxBytes = 96000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ChatGPTError('empty_response', response.status);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ChatGPTError('response_too_large', response.status);
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ChatGPTError('invalid_response', response.status);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function validateChatGPTIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
  keys: JWTVerifyGetKey = jwks,
) {
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'iat'],
    });
    if (
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      (typeof payload.iat === 'number' && payload.iat > Date.now() / 1000 + 60)
    )
      throw new Error();
    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    throw new ChatGPTError('id_token_validation_failed');
  }
}

export interface ChatGPTSessionOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  /** Dependency seam for signed-token fixtures; runtime always uses the OpenAI JWKS verifier. */
  verifyIdentity?: typeof validateChatGPTIdentity;
}

export class ChatGPTSession {
  private refreshing?: Promise<string>;
  constructor(
    readonly store: ChatGPTStore,
    private readonly options: ChatGPTSessionOptions = {},
  ) {}
  private get now() {
    return (this.options.now ?? Date.now)();
  }
  get fetcher() {
    return this.options.fetcher ?? fetch;
  }
  /** Safe to consult before the controller reserves a real daily inference call. */
  isAvailable() {
    let record: ChatGPTAccount | undefined;
    try {
      record = this.store.load();
    } catch {
      return false;
    }
    return (
      !!record?.tokens?.scopes.includes('chatgpt.tokens.use.direct') &&
      (!record.transfer || record.transfer.state === 'received') &&
      (!record.pause || (record.pause.until !== undefined && record.pause.until <= this.now))
    );
  }
  private async exchange(body: URLSearchParams, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher(tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new ChatGPTError('oauth_network_unavailable');
    }
    const payload = await boundedChatGPTJson(response);
    if (!response.ok)
      throw chatGPTFailure(
        payload,
        response.status,
        response.headers.get('x-request-id') ?? undefined,
      );
    const parsed = tokenSchema.safeParse(payload);
    if (!parsed.success) throw new ChatGPTError('invalid_token_response');
    return parsed.data;
  }
  private async accountFromToken(
    token: z.infer<typeof tokenSchema>,
    clientId: string,
    prior?: ChatGPTAccount,
    nonce?: string,
  ): Promise<ChatGPTAccount> {
    assertChatGPTSessionUsable(prior);
    if (!token.id_token && !prior?.tokens?.idToken) throw new ChatGPTError('missing_id_token');
    const identity = token.id_token
      ? await (this.options.verifyIdentity ?? validateChatGPTIdentity)(
          token.id_token,
          clientId,
          nonce,
        )
      : { subject: prior!.subject, email: prior!.email };
    if (prior && (prior.clientId !== clientId || prior.subject !== identity.subject))
      throw new ChatGPTError('account_identity_mismatch');
    const earliest = token.earliest_refresh_at;
    return {
      version: 1,
      clientId,
      issuer,
      ...identity,
      ...(prior?.transfer ? { transfer: prior.transfer } : {}),
      tokens: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? prior?.tokens?.refreshToken,
        idToken: token.id_token ?? prior!.tokens!.idToken,
        expiresAt: this.now + token.expires_in * 1000,
        scopes: token.scope.split(/\s+/).filter(Boolean),
        ...(earliest !== undefined
          ? {
              earliestRefreshAt:
                typeof earliest === 'number' ? earliest * 1000 : Date.parse(earliest),
            }
          : {}),
      },
    };
  }
  async completeSignIn(input: {
    code: string;
    clientId: string;
    verifier: string;
    redirectUri: string;
    nonce: string;
    prior?: ChatGPTAccount;
    signal?: AbortSignal;
  }) {
    await this.store.exclusive(async () => {
      input.signal?.throwIfAborted();
      const current = this.store.load();
      assertChatGPTSessionUsable(current);
      if (
        current &&
        (!input.prior ||
          current.clientId !== input.prior.clientId ||
          current.subject !== input.prior.subject)
      )
        throw new ChatGPTError('account_changed_during_sign_in');
      const token = await this.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: input.clientId,
          code: input.code,
          code_verifier: input.verifier,
          redirect_uri: input.redirectUri,
          resource,
        }),
        input.signal,
      );
      const account = await this.accountFromToken(token, input.clientId, input.prior, input.nonce);
      input.signal?.throwIfAborted();
      this.store.save(account);
    });
  }
  async accessToken(): Promise<string> {
    const account = this.store.load();
    assertChatGPTSessionUsable(account);
    if (!account?.tokens) throw new ChatGPTError('sign_in_required');
    if (!account.tokens.scopes.includes('chatgpt.tokens.use.direct'))
      throw new ChatGPTError('plan_permission_not_granted');
    if (account.pause && (account.pause.until === undefined || account.pause.until > this.now))
      throw new ChatGPTError(account.pause.code);
    if (account.tokens.expiresAt > this.now + 60000) return account.tokens.accessToken;
    if (account.tokens.earliestRefreshAt && account.tokens.earliestRefreshAt > this.now) {
      if (account.tokens.expiresAt <= this.now) throw new ChatGPTError('refresh_not_yet_available');
      return account.tokens.accessToken;
    }
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async refresh() {
    return this.store.exclusive(async () => {
      const account = this.store.load();
      assertChatGPTSessionUsable(account);
      if (!account?.tokens?.refreshToken) throw new ChatGPTError('sign_in_required');
      if (account.tokens.expiresAt > this.now + 60000) return account.tokens.accessToken;
      try {
        const token = await this.exchange(
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: account.clientId,
            refresh_token: account.tokens.refreshToken,
            resource,
          }),
        );
        const next = await this.accountFromToken(token, account.clientId, account);
        if (!token.refresh_token) throw new ChatGPTError('missing_rotated_refresh_token');
        this.store.save(next);
        if (!next.tokens!.scopes.includes('chatgpt.tokens.use.direct'))
          throw new ChatGPTError('plan_permission_not_granted');
        return next.tokens!.accessToken;
      } catch (error) {
        if (error instanceof ChatGPTError && terminalRefresh.has(error.code)) {
          this.store.save({ ...account, tokens: undefined, pause: { code: 'sign_in_required' } });
        }
        throw error;
      }
    });
  }
  async pauseFor(error: ChatGPTError) {
    await this.store.exclusive(async () => {
      const account = this.store.load();
      if (!account) return;
      if (account.transfer && account.transfer.state !== 'received') return;
      const stopUntilOperator = [
        'subscription_sharing_usage_limit_exceeded',
        'subscription_sharing_user_not_eligible',
        'subscription_sharing_unsupported_capability',
        'subscription_sharing_route_not_supported',
        'subscription_sharing_invalid_user',
        'chatpass_v2_scope_not_authorized',
        'chatpass_v2_invalid_authorization_context',
        'sign_in_required',
        'plan_permission_not_granted',
      ];
      const transient =
        !stopUntilOperator.includes(error.code) && (!error.status || error.status >= 500);
      this.store.save({
        ...account,
        pause: {
          code: error.code,
          ...(transient ? { until: this.now + 5 * 60000 } : {}),
        },
      });
    });
  }
  async resume() {
    await this.store.exclusive(async () => {
      const account = this.store.load();
      assertChatGPTSessionUsable(account);
      if (!account) throw new ChatGPTError('sign_in_required');
      this.store.save({ ...account, pause: undefined });
    });
  }
  async signOut(): Promise<boolean> {
    return this.store.exclusive(async () => {
      const account = this.store.load();
      assertChatGPTSessionUsable(account);
      if (!account?.tokens) return true;
      let revoked = false;
      try {
        // Fixed endpoint from OpenAI's OIDC discovery; no credential-bearing redirects.
        const response = await this.fetcher(`${issuer}/api/accounts/oauth/revoke`, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: account.tokens.refreshToken ?? account.tokens.accessToken,
            token_type_hint: account.tokens.refreshToken ? 'refresh_token' : 'access_token',
            client_id: account.clientId,
          }),
        });
        revoked = response.status === 200;
        await response.body?.cancel();
      } catch {
        /* Locally disconnect even if remote revocation cannot be confirmed. */
      }
      this.store.save({ ...account, tokens: undefined, pause: undefined });
      return revoked;
    });
  }
}

export async function beginChatGPTSignIn(session: ChatGPTSession, timeoutMs = 5 * 60000) {
  const lifetime = new AbortController();
  const hostId = await session.store.hostId();
  const prior = session.store.load();
  assertChatGPTSessionUsable(prior);
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // Attach a handler immediately; the caller may still be opening its browser.
  void completion.catch(() => undefined);
  let claimed = false;
  let redirectUri = '';
  let timer: ReturnType<typeof setTimeout>;
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('referrer-policy', 'no-referrer');
    let callback: URL;
    try {
      callback = new URL(request.url ?? '/', redirectUri);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (
      request.method !== 'GET' ||
      request.headers.host !== new URL(redirectUri).host ||
      callback.pathname !== '/auth/callback'
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    const returnedState = callback.searchParams.get('state') ?? '';
    if (
      claimed ||
      Buffer.byteLength(returnedState) !== Buffer.byteLength(state) ||
      !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state)) ||
      [...callback.searchParams.keys()].some(
        (key) => callback.searchParams.getAll(key).length !== 1,
      )
    ) {
      response.writeHead(400);
      response.end('Invalid or expired sign-in attempt.');
      return;
    }
    claimed = true;
    void (async () => {
      try {
        if (callback.searchParams.has('error')) throw new ChatGPTError('authorization_declined');
        const clientId = callback.searchParams.get('client_id') ?? prior?.clientId;
        if (
          !chatGPTClientIdSchema.safeParse(clientId).success ||
          (prior && prior.clientId !== clientId)
        )
          throw new ChatGPTError('registration_client_mismatch');
        const code = callback.searchParams.get('code');
        if (!code || code.length > 12000) throw new ChatGPTError('registration_incomplete');
        await session.completeSignIn({
          code,
          clientId: clientId!,
          verifier,
          redirectUri,
          nonce,
          prior,
          signal: lifetime.signal,
        });
        response.end(
          'Elsewhere: ChatGPT connected. You can close this tab and return to the terminal.',
        );
        resolveCompletion();
      } catch (error) {
        response.writeHead(400);
        response.end('Elsewhere sign-in did not complete. Return to the terminal.');
        rejectCompletion(error);
      } finally {
        clearTimeout(timer);
        server.close();
        server.closeIdleConnections();
      }
    })();
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new ChatGPTError('callback_listener_failed');
  redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  const url = new URL(`${issuer}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: prior?.clientId ?? 'dynamic_agent_client',
    ...(!prior ? { agent_name_hint: 'Elsewhere' } : {}),
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes,
    resource,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    // Omit login hints from CLI URLs; account identity is checked after reauthorization.
  }).toString();
  const cancel = () => {
    lifetime.abort();
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    rejectCompletion(new ChatGPTError('sign_in_cancelled'));
  };
  timer = setTimeout(cancel, timeoutMs);
  return { url: url.toString(), completion, cancel };
}
