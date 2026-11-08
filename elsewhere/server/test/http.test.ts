import type { AddressInfo } from 'node:net';
import { request, type IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { closeApiServer, createApiServer, type ApiDependencies } from '../src/http.js';
import { createInitialWorld } from '../src/world.js';

const token = 'owner-token-long-enough-for-security-tests';
function fixture(): PublicSnapshot {
  return {
    world: createInitialWorld(1000),
    character: {
      id: 'hubert',
      name: 'Hubert',
      mood: 65,
      energy: 80,
      boredom: 20,
      frustration: 0,
      socialAppetite: 30,
      activity: 'idle',
      status: 'Looking around',
      interests: [],
    },
    events: [],
    memories: [],
    runtime: {
      mode: 'local',
      paused: false,
      tick: 0,
      startedAt: 1000,
      simulatedAt: 1000,
      costUsd: 0,
    },
  };
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function start(overrides: Partial<ApiDependencies> = {}) {
  const snapshot = fixture();
  const tick = vi.fn(async () => snapshot);
  const submitMessage = vi.fn(async (_text: string) => ({ accepted: true }));
  const resolveWish = vi.fn(async (_id: string, _decision: 'fulfill' | 'decline') => snapshot);
  const server = createApiServer({
    adminToken: token,
    getSnapshot: () => snapshot,
    tick,
    pause: async () => snapshot,
    resume: async () => snapshot,
    reset: async () => snapshot,
    submitMessage,
    resolveWish,
    getArtifact: (id) =>
      id === 'test-artifact'
        ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }
        : null,
    ...overrides,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  cleanup.push(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tick,
    submitMessage,
    resolveWish,
    snapshot,
  };
}

describe('local public/owner API separation', () => {
  it('protects the production origin and trusts client IP only behind the authenticated Vercel ingress', async () => {
    const secret = 'fixture-private-proxy-'.repeat(3);
    const { url } = await start({
      proxySecret: secret,
      allowedOrigins: ['https://elsewhere.example'],
    });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect(
      (await fetch(`${url}/api/world`, { headers: { 'x-vercel-forwarded-for': '203.0.113.1' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/world`, {
          headers: { 'x-elsewhere-proxy-token': secret, 'x-forwarded-for': '203.0.113.1' },
        })
      ).status,
    ).toBe(403);
    const headers = { 'x-elsewhere-proxy-token': secret, 'x-vercel-forwarded-for': '203.0.113.1' };
    expect(
      (
        await fetch(`${url}/api/world`, {
          headers: { ...headers, origin: 'http://localhost:5173' },
        })
      ).status,
    ).toBe(403);
    const response = await fetch(`${url}/api/world`, { headers });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    for (let i = 0; i < 8; i++)
      expect(
        (
          await fetch(`${url}/api/visitors`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await fetch(`${url}/api/visitors`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await fetch(`${url}/api/visitors`, {
          method: 'POST',
          headers: {
            ...headers,
            'x-vercel-forwarded-for': '203.0.113.2',
            'content-type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(201);
  });
  it('keeps liveness available while denying reads and writes until controller ownership is ready', async () => {
    let ready = false;
    const { url, tick } = await start({ isReady: () => ready });
    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).ready).toBe(false);
    expect((await fetch(`${url}/api/world`)).status).toBe(503);
    expect(
      (
        await fetch(`${url}/api/admin/tick`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(503);
    expect(tick).not.toHaveBeenCalled();
    ready = true;
    expect((await fetch(`${url}/api/ready`)).status).toBe(200);
    expect((await fetch(`${url}/api/world`)).status).toBe(200);
  });
  it('drains when a client disconnects before an awaited account lookup finishes', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let incoming: IncomingMessage | undefined;
    const snapshot = fixture();
    const submitMessage = vi.fn(async () => ({ accepted: true }));
    const server = createApiServer({
      adminToken: token,
      getSnapshot: () => snapshot,
      tick: async () => snapshot,
      pause: async () => snapshot,
      resume: async () => snapshot,
      reset: async () => snapshot,
      auth: {
        handle: async () => {},
        isWorldAdmin: async () => false,
        getAccount: async (req) => {
          incoming = req;
          entered();
          await gate;
          return null;
        },
      },
      submitMessage,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const client = request(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '100' },
      },
    );
    client.on('error', () => {});
    try {
      client.write('{"text":');
      await started;
      client.destroy();
      await vi.waitFor(() => expect(incoming?.destroyed).toBe(true));
      release();
      let finished = false;
      const closing = closeApiServer(server, 10).then(() => {
        finished = true;
      });
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 1000 });
      await closing;
      expect(submitMessage).not.toHaveBeenCalled();
    } finally {
      release();
      client.destroy();
      server.closeAllConnections();
      server.close();
    }
  });
  it('reports complete disabled-account capabilities without advertising password flows', async () => {
    const { url } = await start();
    expect(await fetch(`${url}/api/account`).then((response) => response.json())).toEqual({
      user: null,
      enabled: false,
      passwordAuthEnabled: false,
      requiresEmailVerification: false,
    });
  });

  it('isolates authenticated visitor quotas and does not let bad tokens spend a valid session quota', async () => {
    const { url } = await start();
    const register = async () =>
      fetch(`${url}/api/visitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then((response) => response.json()) as Promise<{ visitorId: string; token: string }>;
    const first = await register(),
      second = await register();
    const inspect = (visitor: { visitorId: string; token: string }) =>
      fetch(`${url}/api/visitors/${visitor.visitorId}`, {
        headers: { Authorization: `Bearer ${visitor.token}` },
      });
    for (let i = 0; i < 900; i++) {
      const response = await inspect(first);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    expect((await inspect(first)).status).toBe(429);
    for (let i = 0; i < 121; i++) {
      const response = await inspect({ ...second, token: 'invalid-test-token' });
      expect([401, 429]).toContain(response.status);
      await response.arrayBuffer();
    }
    expect((await inspect(second)).status).toBe(200);
  });

  it('drains an active handler even after a shutdown deadline closes its connection', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    const snapshot = fixture();
    const server = createApiServer({
      adminToken: token,
      getSnapshot: () => snapshot,
      tick: async () => snapshot,
      pause: async () => snapshot,
      resume: async () => snapshot,
      reset: async () => snapshot,
      submitMessage: async () => {
        entered();
        await gate;
        completed = true;
        return { accepted: true };
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = fetch(`${url}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"text":"A test note"}',
    }).catch(() => null);
    try {
      await started;
      let closed = false;
      const closing = closeApiServer(server, 5).then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(closed).toBe(false);
      release();
      await closing;
      expect(completed).toBe(true);
      await expect(closeApiServer(server)).resolves.toBeUndefined();
    } finally {
      release();
      await request;
      await closeApiServer(server);
    }
  });
  it('exposes scene state without serializing private extra fields', async () => {
    const { url, snapshot } = await start();
    Object.assign(snapshot.character, { adminToken: token, privateMemory: 'secret' });
    Object.assign(snapshot.world, { privateControlKey: token });
    Object.assign(snapshot.world.objects[0], { secretNotes: 'not public' });
    const response = await fetch(`${url}/api/world`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain(token);
    expect(body).not.toContain('privateMemory');
    expect(body).not.toContain('privateControlKey');
    expect(body).not.toContain('secretNotes');
    expect(body).not.toContain('"detail"');
    const projected = JSON.parse(body) as PublicSnapshot;
    expect(projected.world.spatialVersion).toBe(snapshot.world.spatialVersion);
    expect(projected.world.obstacles.find((item) => item.id.includes('pond'))?.shape).toBe(
      'ellipse',
    );
    const wall = snapshot.world.obstacles.find((item) => item.sightApertures?.length)!;
    expect(projected.world.obstacles.find((item) => item.id === wall.id)?.sightApertures).toEqual(
      wall.sightApertures,
    );
    const garden = snapshot.world.objects.find((item) => item.id === 'garden')!;
    expect(projected.world.objects.find((item) => item.id === 'garden')?.footprint).toEqual(
      garden.footprint,
    );
    const artifact = projected.world.objects.find((item) => item.id === 'artifact')!;
    expect(artifact.elevation).toBe(1.19);
    expect(artifact.observationHeight).toBe(1.45);
  });

  it('requires a bearer token before advancing state', async () => {
    const { url, tick } = await start();
    expect(
      (
        await fetch(`${url}/api/admin/tick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect(tick).not.toHaveBeenCalled();
    const response = await fetch(`${url}/api/admin/tick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(tick).toHaveBeenCalledOnce();
  });

  it('rejects an unapproved origin even when the owner token is present', async () => {
    const { url, tick } = await start();
    const response = await fetch(`${url}/api/admin/tick`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(tick).not.toHaveBeenCalled();
  });

  it('validates and rate-limits public messages without accepting extra instructions', async () => {
    const { url, submitMessage } = await start();
    const send = (value: unknown) =>
      fetch(`${url}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    expect((await send({ text: 'Hello', permission: 'admin' })).status).toBe(400);
    expect((await send({ text: 'x'.repeat(501) })).status).toBe(400);
    expect((await send({ text: 'Hello Hubert' })).status).toBe(202);
    expect(submitMessage).toHaveBeenCalledWith('Hello Hubert');
    await send({ text: 'Again' });
    await send({ text: 'Again' });
    expect((await send({ text: 'Too many' })).status).toBe(429);
  });

  it('serves only explicit trusted artifacts with a restrictive CSP', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/artifacts/test-artifact`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await fetch(`${url}/api/artifacts/missing`)).status).toBe(404);
  });

  it('gives visitors exploration-only credentials with no owner or other-session authority', async () => {
    const { url, tick } = await start();
    const register = () =>
      fetch(`${url}/api/visitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    const firstResponse = await register();
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as { visitorId: string; token: string };
    const second = (await (await register()).json()) as { visitorId: string; token: string };
    const ownHeaders = {
      Authorization: `Bearer ${first.token}`,
      'Content-Type': 'application/json',
    };
    expect(
      (await fetch(`${url}/api/visitors/${first.visitorId}`, { headers: ownHeaders })).status,
    ).toBe(200);
    expect(
      (await fetch(`${url}/api/visitors/${second.visitorId}`, { headers: ownHeaders })).status,
    ).toBe(401);
    expect(
      (await fetch(`${url}/api/admin/tick`, { method: 'POST', headers: ownHeaders, body: '{}' }))
        .status,
    ).toBe(401);
    expect(tick).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${url}/api/visitors/${first.visitorId}/action`, {
          method: 'POST',
          headers: ownHeaders,
          body: JSON.stringify({ type: 'work', targetId: 'workbench' }),
        })
      ).status,
    ).toBe(400);
    const move = await fetch(`${url}/api/visitors/${first.visitorId}/action`, {
      method: 'POST',
      headers: ownHeaders,
      body: JSON.stringify({ type: 'move', position: { x: 8, z: 7 } }),
    });
    expect(move.status).toBe(200);
    const publicText = await (await fetch(`${url}/api/world`)).text();
    expect(publicText).toContain(first.visitorId);
    expect(publicText).not.toContain(first.token);
  });

  it('decodes owner wish identifiers exactly once and rejects visitor authority', async () => {
    const { url, resolveWish } = await start();
    const id = 'wish:hubert:painting-kit';
    const endpoint = `${url}/api/admin/wishes/${encodeURIComponent(id)}`;
    const request = (bearer: string) => ({
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'fulfill' }),
    });
    const registration = await fetch(`${url}/api/visitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const visitor = (await registration.json()) as { token: string };
    expect((await fetch(endpoint, request(visitor.token))).status).toBe(401);
    expect(resolveWish).not.toHaveBeenCalled();
    expect((await fetch(endpoint, request(token))).status).toBe(200);
    expect(resolveWish).toHaveBeenCalledExactlyOnceWith(id, 'fulfill');
    for (const invalid of ['bad%ZZ', 'bad%2Fid', '%253A']) {
      expect((await fetch(`${url}/api/admin/wishes/${invalid}`, request(token))).status).toBe(400);
    }
    expect(resolveWish).toHaveBeenCalledOnce();
  });
});
