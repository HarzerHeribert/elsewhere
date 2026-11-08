import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, requestJson } from './worldApi';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('API request recovery', () => {
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
