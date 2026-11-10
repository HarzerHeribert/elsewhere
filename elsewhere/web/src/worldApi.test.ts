import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getAccount, requestJson } from './worldApi';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('API request recovery', () => {
  it('admits only explicit passkey capabilities and authenticated owner assurance flags', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: null,
            passkeyAuthEnabled: true,
            ownerControlsRequirePasskey: true,
            ownerControlsUnlocked: true,
            passkeyVerifiedRecently: true,
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: { id: 'owner' },
            passkeyAuthEnabled: 'true',
            ownerControlsRequirePasskey: 'false',
            ownerControlsUnlocked: 1,
            passkeyVerifiedRecently: 'yes',
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: { id: 'owner' },
            passkeyAuthEnabled: true,
            ownerControlsRequirePasskey: true,
            ownerControlsUnlocked: false,
            passkeyVerifiedRecently: false,
          }),
        ),
    );
    const anonymous = await getAccount(new AbortController().signal);
    expect(anonymous.passkeyAuthEnabled).toBe(true);
    expect(anonymous.ownerControlsRequirePasskey).toBeUndefined();
    expect(anonymous.ownerControlsUnlocked).toBeUndefined();
    expect(anonymous.passkeyVerifiedRecently).toBeUndefined();
    const malformed = await getAccount(new AbortController().signal);
    expect(malformed.passkeyAuthEnabled).toBeUndefined();
    expect(malformed.ownerControlsRequirePasskey).toBeUndefined();
    expect(malformed.ownerControlsUnlocked).toBeUndefined();
    expect(malformed.passkeyVerifiedRecently).toBeUndefined();
    expect(await getAccount(new AbortController().signal)).toMatchObject({
      passkeyAuthEnabled: true,
      ownerControlsRequirePasskey: true,
      ownerControlsUnlocked: false,
      passkeyVerifiedRecently: false,
    });
  });
  it('exposes only configured social providers and keeps linked identities private to the account', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: null,
            socialProviders: ['github', 'google', 'repo', 'github', null],
            linkedSocialProviders: ['github'],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: { id: 'owner' },
            socialProviders: ['github'],
            linkedSocialProviders: ['github', 'google', 'private-token', 'github'],
          }),
        ),
    );
    const guest = await getAccount(new AbortController().signal);
    expect(guest.socialProviders).toEqual(['github', 'google']);
    expect(guest.linkedSocialProviders).toBeUndefined();
    const owner = await getAccount(new AbortController().signal);
    expect(owner.socialProviders).toEqual(['github']);
    expect(owner.linkedSocialProviders).toEqual(['github']);
  });
  it('keeps character management independent from the signed-in platform admin role', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ enabled: true, user: { id: 'admin', isWorldAdmin: true } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          user: { id: 'owner', isWorldAdmin: false },
          managedCharacterIds: ['hubert'],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect((await getAccount(new AbortController().signal)).managedCharacterIds).toEqual([]);
    expect((await getAccount(new AbortController().signal)).managedCharacterIds).toEqual([
      'hubert',
    ]);
  });
  it('discards anonymous and malformed character-management capabilities', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ enabled: true, user: null, managedCharacterIds: ['hubert'] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          user: { id: 'owner' },
          managedCharacterIds: ['hubert', null, { id: 'other' }, '../other'],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect((await getAccount(new AbortController().signal)).managedCharacterIds).toEqual([]);
    expect((await getAccount(new AbortController().signal)).managedCharacterIds).toEqual([
      'hubert',
    ]);
  });
  it('keeps provider notices scoped to a signed-in character owner', async () => {
    const issue = {
      id: 'notice',
      characterId: 'hubert',
      kind: 'failed',
      since: 1000,
      lastAt: 2000,
      message: 'Provider unavailable.',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: null,
            managedCharacterIds: ['hubert'],
            characterIssues: [issue],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: { id: 'admin', isWorldAdmin: true },
            characterIssues: [issue],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            enabled: true,
            user: { id: 'owner' },
            managedCharacterIds: ['hubert'],
            characterIssues: [
              issue,
              { ...issue, characterId: 'another' },
              { ...issue, since: null },
            ],
          }),
        ),
    );
    expect((await getAccount(new AbortController().signal)).characterIssues).toEqual([]);
    expect((await getAccount(new AbortController().signal)).characterIssues).toEqual([]);
    expect((await getAccount(new AbortController().signal)).characterIssues).toEqual([issue]);
  });
  it('times out a stalled body, aborts the connection and allows a later request to succeed', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return Promise.resolve({ ok: true, json: () => new Promise(() => undefined) });
      })
      .mockResolvedValueOnce(Response.json({ recovered: true }));
    vi.stubGlobal('fetch', fetch);
    const failure = requestJson('/api/world', {}, 50).catch((error) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await failure).toMatchObject({ message: expect.stringContaining('timed out') });
    expect(signal?.aborted).toBe(true);
    await expect(requestJson('/api/world')).resolves.toEqual({ recovered: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('superseding a request aborts even a transport that never settles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const controller = new AbortController();
    const failure = requestJson('/api/account', { signal: controller.signal }).catch(
      (error) => error,
    );
    controller.abort(new Error('Superseded'));
    expect(await failure).toMatchObject({ message: 'Superseded' });
  });

  it('retains an HTTP status even when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 401 })));
    const error = await requestJson('/api/visitors/example').catch((error) => error);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(401);
  });
});
