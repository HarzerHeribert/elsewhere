import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, chmodSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ChatGPTError, ChatGPTStore, type ChatGPTAccount } from './chatgpt-store';
import { beginChatGPTSignIn, ChatGPTSession, validateChatGPTIdentity } from './chatgpt';

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function store(profile = 'default') {
  const root = mkdtempSync(join(tmpdir(), 'elsewhere-chatgpt-'));
  directories.push(root);
  return new ChatGPTStore(root, profile);
}
const now = Date.now();
function account(): ChatGPTAccount {
  return {
    version: 1,
    issuer: 'https://auth.openai.com',
    clientId: 'oaiapp_fixture',
    subject: 'fixture-user',
    tokens: {
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      idToken: 'fixture-id',
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
      expiresAt: now + 3600000,
    },
  };
}
function token(overrides = {}) {
  return {
    access_token: 'fixture-new-access',
    refresh_token: 'fixture-new-refresh',
    id_token: 'fixture-new-id',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid chatgpt.tokens.use.direct',
    ...overrides,
  };
}
const identity = async () => ({ subject: 'fixture-user', email: 'fixture@example.test' });
describe('separate ChatGPT operator credentials', () => {
  it('persists a stable host and isolated account registrations with private atomic files', async () => {
    const s = store();
    const id = await s.hostId();
    s.save(account());
    expect(await s.hostId()).toBe(id);
    expect(id).toMatch(/^urn:uuid:/);
    expect(statSync(s.directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(s.directory, 'default.json')).mode & 0o777).toBe(0o600);
    expect(s.load()).toEqual(account());
    const other = new ChatGPTStore(join(s.directory, '../..'), 'other');
    expect(other.load()).toBeUndefined();
    await expect(s.exclusive(() => s.exclusive(async () => 1))).rejects.toThrow('session_busy');
  });
  it('rejects symlinked, public and invalid account records without printing contents', async () => {
    const s = store();
    await s.hostId();
    s.save(account());
    const path = join(s.directory, 'default.json');
    chmodSync(path, 0o644);
    expect(() => s.load()).toThrow('unsafe_credential_storage');
    chmodSync(path, 0o600);
    writeFileSync(path, '{"secret":"fixture-secret-keep-private"}');
    try {
      s.load();
    } catch (error) {
      expect(String(error)).not.toContain('fixture-secret');
    }
    rmSync(path);
    symlinkSync(join(s.directory, 'host.json'), path);
    expect(() => s.load()).toThrow('unsafe_credential_storage');
    expect(new ChatGPTSession(s).isAvailable()).toBe(false);
  });
  it('coalesces concurrent refreshes, rotates credentials and preserves the issued registration', async () => {
    const s = store();
    const before = account();
    before.tokens!.expiresAt = now + 1000;
    s.save(before);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('oaiapp_fixture');
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.has('scope')).toBe(false);
      return Response.json(token());
    });
    const session = new ChatGPTSession(s, {
      fetcher: fetcher as typeof fetch,
      verifyIdentity: identity,
      now: () => now,
    });
    expect(await Promise.all([session.accessToken(), session.accessToken()])).toEqual([
      'fixture-new-access',
      'fixture-new-access',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.load()?.tokens?.refreshToken).toBe('fixture-new-refresh');
  });
  it('clears terminally revoked tokens while keeping the client/account mapping', async () => {
    const s = store();
    const before = account();
    before.tokens!.expiresAt = now;
    s.save(before);
    const session = new ChatGPTSession(s, {
      fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
    });
    await expect(session.accessToken()).rejects.toThrow('invalid_grant');
    expect(s.load()?.tokens).toBeUndefined();
    expect(s.load()?.clientId).toBe(before.clientId);
  });
  it('does not infer without consent, or retry a quota failure after restart', async () => {
    const s = store();
    const record = account();
    record.tokens!.scopes = ['openid'];
    s.save(record);
    const fetcher = vi.fn();
    const session = new ChatGPTSession(s, { fetcher });
    expect(session.isAvailable()).toBe(false);
    await expect(session.accessToken()).rejects.toThrow('plan_permission_not_granted');
    expect(fetcher).not.toHaveBeenCalled();
    s.save(account());
    await session.pauseFor(new ChatGPTError('subscription_sharing_usage_limit_exceeded'));
    const restarted = new ChatGPTSession(s, { now: () => now + 100 * 86400000 });
    expect(restarted.isAvailable()).toBe(false);
  });
  it('keeps transient outages recoverable and reports unconfirmed remote revocation', async () => {
    const s = store();
    s.save(account());
    const session = new ChatGPTSession(s, {
      now: () => now,
      fetcher: async () => {
        throw new Error('fixture-token-must-not-leak');
      },
    });
    await session.pauseFor(new ChatGPTError('request_failed', 503));
    expect(session.isAvailable()).toBe(false);
    expect(new ChatGPTSession(s, { now: () => now + 6 * 60000 }).isAvailable()).toBe(true);
    expect(await session.signOut()).toBe(false);
    expect(s.load()?.tokens).toBeUndefined();
    expect(s.load()?.clientId).toBe('oaiapp_fixture');
  });
});

describe('real loopback OAuth and signed identity', () => {
  it('validates signatures, audience, nonce and expiry before trusting an identity', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const key = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...key, kid: 'fixture', alg: 'RS256' }] });
    const jwt = await new SignJWT({ nonce: 'expected' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setSubject('verified-user')
      .setIssuer('https://auth.openai.com')
      .setAudience('oaiapp_fixture')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    expect(await validateChatGPTIdentity(jwt, 'oaiapp_fixture', 'expected', keys)).toEqual({
      subject: 'verified-user',
      email: undefined,
    });
    await expect(validateChatGPTIdentity(jwt, 'oaiapp_other', 'expected', keys)).rejects.toThrow(
      'id_token_validation',
    );
    await expect(validateChatGPTIdentity(jwt, 'oaiapp_fixture', 'wrong', keys)).rejects.toThrow(
      'id_token_validation',
    );
    await expect(
      validateChatGPTIdentity(jwt.slice(0, -3) + 'bad', 'oaiapp_fixture', 'expected', keys),
    ).rejects.toThrow('id_token_validation');
    const expired = await new SignJWT({ nonce: 'expected' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setSubject('verified-user')
      .setIssuer('https://auth.openai.com')
      .setAudience('oaiapp_fixture')
      .setIssuedAt()
      .setExpirationTime(1)
      .sign(privateKey);
    await expect(
      validateChatGPTIdentity(expired, 'oaiapp_fixture', 'expected', keys),
    ).rejects.toThrow('id_token_validation');
  });
  it('rejects bad state before exchanging, then binds PKCE and the exact callback to the issued client', async () => {
    const s = store();
    let authorization: URL;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('oaiapp_fixture');
      expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'));
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
        authorization.searchParams.get('code_challenge'),
      );
      return Response.json(token());
    });
    const session = new ChatGPTSession(s, {
      fetcher: fetcher as typeof fetch,
      verifyIdentity: async (_jwt, _client, nonce) => {
        expect(nonce).toBe(authorization.searchParams.get('nonce'));
        return identity();
      },
    });
    const attempt = await beginChatGPTSignIn(session);
    authorization = new URL(attempt.url);
    try {
      expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({
        state: 'wrong',
        code: 'fixture',
        client_id: 'oaiapp_fixture',
      }).toString();
      expect((await fetch(callback)).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      expect((await fetch(callback)).status).toBe(200);
      await attempt.completion;
      expect(s.load()?.subject).toBe('fixture-user');
    } finally {
      attempt.cancel();
    }
  });
  it('handles declined permission without code exchange or replacing an existing session', async () => {
    const s = store();
    s.save(account());
    const fetcher = vi.fn();
    const attempt = await beginChatGPTSignIn(new ChatGPTSession(s, { fetcher }));
    try {
      const authorization = new URL(attempt.url);
      expect(authorization.searchParams.has('agent_name_hint')).toBe(false);
      expect(authorization.searchParams.has('id_token_hint')).toBe(false);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({
        state: authorization.searchParams.get('state')!,
        error: 'access_denied',
      }).toString();
      await fetch(callback);
      await expect(attempt.completion).rejects.toThrow('authorization_declined');
      expect(fetcher).not.toHaveBeenCalled();
      expect(s.load()).toEqual(account());
    } finally {
      attempt.cancel();
    }
  });
  it('cancels an in-flight sign-in without saving credentials after the callback expires', async () => {
    const s = store();
    let finish!: () => void;
    const fetcher = async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return Response.json(token());
    };
    const attempt = await beginChatGPTSignIn(
      new ChatGPTSession(s, { fetcher, verifyIdentity: identity }),
    );
    const authorization = new URL(attempt.url);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code: 'fixture',
      client_id: 'oaiapp_fixture',
    }).toString();
    const request = fetch(callback).catch(() => undefined);
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      attempt.cancel();
      finish();
      await expect(attempt.completion).rejects.toThrow('sign_in_cancelled');
      await request;
      await vi.waitFor(() => expect(s.load()).toBeUndefined());
    } finally {
      attempt.cancel();
    }
  });
});
