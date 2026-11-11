import type { AddressInfo } from 'node:net';
import { createConnection } from 'node:net';
import { request, type IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary, PublicSnapshot } from '@elsewhere/character-interfaces';
import { createApiServer, type ApiDependencies } from '../src/http';
import { createInitialWorld } from '../src/world';

const token = 'fixture-owner-recovery-token-long-enough';
const proxy = 'fixture-trusted-proxy-secret-long-enough';
const origin = 'https://elsewhere.example';
const account: AccountSummary = {
  id: 'fixture-operator',
  name: 'Operator',
  email: 'operator@example.invalid',
  emailVerified: false,
  role: 'admin',
  isWorldAdmin: true,
};
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
    },
    events: [],
    memories: [],
    pursuits: [],
    trail: [],
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
function headers(ip = '203.0.113.1') {
  return { 'x-elsewhere-proxy-token': proxy, 'x-vercel-forwarded-for': ip };
}
const closing: Array<() => void> = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});
async function start(overrides: Partial<ApiDependencies> = {}) {
  const snapshot = fixture();
  const pause = vi.fn(async () => snapshot);
  const getAccount = vi.fn(async (req: IncomingMessage) =>
    req.headers.cookie === 'fixture-valid-session' ? account : null,
  );
  const server = createApiServer({
    adminToken: token,
    proxySecret: proxy,
    allowedOrigins: [origin],
    auth: {
      handle: async (_req, res) => {
        res.end('{}');
      },
      getAccount,
      isWorldAdmin: async () => false,
    },
    getSnapshot: () => snapshot,
    tick: async () => snapshot,
    pause,
    resume: async () => snapshot,
    reset: async () => snapshot,
    submitMessage: async () => ({ accepted: true }),
    getArtifact: () => ({ contentType: 'image/svg+xml', body: '<svg/>' }),
    ...overrides,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  closing.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    pause,
    getAccount,
    snapshot,
    server,
  };
}
async function consumed(response: Response) {
  await response.arrayBuffer();
  return response;
}
async function control(url: string, session = false) {
  return consumed(
    await fetch(url + '/api/admin/pause', {
      method: 'POST',
      headers: {
        ...headers(),
        origin,
        'content-type': 'application/json',
        ...(session ? { cookie: 'fixture-valid-session' } : { authorization: `Bearer ${token}` }),
      },
      body: '{}',
    }),
  );
}

describe('public overload and owner recovery', () => {
  it('rejects abusive reads before repeated projection or account lookups, without limiting ordinary polls', async () => {
    const { url, getAccount } = await start();
    for (const [path, allowed] of [
      ['world', 120],
      ['account', 60],
      ['artifacts/fixture', 30],
    ] as const) {
      for (let index = 0; index < 300; index++) {
        const response = await consumed(await fetch(url + '/api/' + path, { headers: headers() }));
        expect(response.status).toBe(index < allowed ? 200 : 429);
        if (index >= allowed)
          expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      }
    }
    expect(getAccount).toHaveBeenCalledTimes(60);
    expect((await control(url)).status).toBe(200);
    expect((await control(url, true)).status).toBe(200);
  });

  it('bounds aggregate reads across different trusted client addresses before expensive work', async () => {
    const snapshot = fixture();
    const projection = vi.fn(() => snapshot);
    const { url } = await start({ traffic: { worldReadsPerMinute: 2 }, getSnapshot: projection });
    for (let index = 0; index < 3; index++) {
      const response = await consumed(
        await fetch(url + '/api/world', { headers: headers(`203.0.113.${index + 1}`) }),
      );
      expect(response.status).toBe(index < 2 ? 200 : 429);
    }
    expect(projection).toHaveBeenCalledTimes(2);
    expect((await control(url, true)).status).toBe(200);
  });

  it('rejects additional public work instead of queueing it while health and verified controls remain available', async () => {
    const snapshot = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const projection = vi.fn(async () => {
      await gate;
      return snapshot;
    });
    const { url, pause } = await start({ getSnapshot: projection });
    const pending = Array.from({ length: 32 }, (_, i) =>
      fetch(url + '/api/world', { headers: headers(`198.51.100.${Math.floor(i / 4) + 1}`) }).then(
        consumed,
      ),
    );
    try {
      await vi.waitFor(() => expect(projection).toHaveBeenCalledTimes(32));
      const denied = await consumed(
        await fetch(url + '/api/world', { headers: headers('198.51.100.99') }),
      );
      expect(denied.status).toBe(503);
      expect(denied.headers.get('retry-after')).toBe('2');
      expect((await consumed(await fetch(url + '/api/health'))).status).toBe(200);
      expect((await control(url)).status).toBe(200);
      expect((await control(url, true)).status).toBe(200);
      const forged = await consumed(
        await fetch(url + '/api/admin/pause', {
          method: 'POST',
          headers: {
            ...headers(),
            origin,
            'content-type': 'application/json',
            authorization: 'Bearer forged-owner',
            cookie: 'fixture-forged-session',
          },
          body: '{}',
        }),
      );
      expect(forged.status).toBe(401);
      expect(pause).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await Promise.all(pending);
    }
  });

  it('bounds public mutation admission independently of verified recovery commands', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submit = vi.fn(async () => {
      await gate;
      return { accepted: true };
    });
    const { url } = await start({ submitMessage: submit });
    const registration = await fetch(url + '/api/visitors', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: '{}',
    });
    const visitor = (await registration.json()) as { visitorId: string; token: string };
    const post = (ip: string) =>
      fetch(url + '/api/messages', {
        method: 'POST',
        headers: { ...headers(ip), 'content-type': 'application/json' },
        body: '{"text":"fixture note"}',
      }).then(consumed);
    const pending = Array.from({ length: 8 }, (_, index) => post(`198.51.100.${index + 1}`));
    try {
      await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(8));
      expect((await post('198.51.100.90')).status).toBe(503);
      expect(submit).toHaveBeenCalledTimes(8);
      expect((await control(url)).status).toBe(200);
      expect((await control(url, true)).status).toBe(200);
      const visitorHeaders = { ...headers(), authorization: 'Bearer ' + visitor.token };
      expect(
        (
          await consumed(
            await fetch(url + '/api/visitors/' + visitor.visitorId, { headers: visitorHeaders }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await consumed(
            await fetch(url + '/api/visitors/' + visitor.visitorId + '/action', {
              method: 'POST',
              headers: { ...visitorHeaders, 'content-type': 'application/json' },
              body: '{"type":"stop"}',
            }),
          )
        ).status,
      ).toBe(200);
    } finally {
      release();
      await Promise.all(pending);
    }
  });

  it('expires an unfinished JSON body, closes its socket and releases admission without executing it', async () => {
    const submit = vi.fn(async () => ({ accepted: true }));
    const { url } = await start({ bodyTimeoutMs: 50, submitMessage: submit });
    let status = 0,
      retry: string | undefined;
    const client = request(
      url + '/api/messages',
      {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json', 'content-length': '100' },
      },
      (response) => {
        status = response.statusCode ?? 0;
        retry = response.headers['retry-after'];
        response.resume();
      },
    );
    client.on('error', () => undefined);
    client.write('{"text":');
    try {
      await vi.waitFor(() => expect(status).toBe(408), { timeout: 1500 });
      expect(retry).toBe('1');
      expect(submit).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(client.destroyed).toBe(true));
      const accepted = await consumed(
        await fetch(url + '/api/messages', {
          method: 'POST',
          headers: { ...headers(), 'content-type': 'application/json' },
          body: '{"text":"complete fixture note"}',
        }),
      );
      expect(accepted.status).toBe(202);
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      client.destroy();
    }
  });

  it('starts the body deadline before an awaited account lookup and never executes a timed-out body', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submit = vi.fn(async () => ({ accepted: true }));
    const { url } = await start({
      bodyTimeoutMs: 50,
      submitMessage: submit,
      auth: {
        handle: async () => undefined,
        isWorldAdmin: async () => false,
        getAccount: async () => {
          await gate;
          return null;
        },
      },
    });
    let status = 0;
    const client = request(
      url + '/api/messages',
      {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json', 'content-length': '100' },
      },
      (response) => {
        status = response.statusCode ?? 0;
        response.resume();
      },
    );
    client.on('error', () => undefined);
    client.write('{"text":');
    try {
      await vi.waitFor(() => expect(status).toBe(408), { timeout: 1500 });
      expect(submit).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(client.destroyed).toBe(true));
      expect(submit).not.toHaveBeenCalled();
    } finally {
      release();
      client.destroy();
    }
  });

  it.each([
    { method: 'POST', path: '/api/messages', status: 403, trusted: false },
    { method: 'POST', path: '/api/admin/pause', status: 401, trusted: true },
    { method: 'POST', path: '/api/missing', status: 404, trusted: true },
    { method: 'OPTIONS', path: '/api/world', status: 204, trusted: true },
    { method: 'GET', path: '/api/world', status: 200, trusted: true },
  ])(
    'closes unread bodies on $method $path replies so they cannot retain the shared socket cap',
    async ({ method, path, status, trusted }) => {
      const { url, server } = await start();
      server.maxConnections = 1;
      const target = new URL(url);
      const socket = createConnection({ host: '127.0.0.1', port: Number(target.port) });
      let prefix = '';
      socket.on('data', (data) => {
        if (prefix.length < 1000) prefix += data.toString().slice(0, 1000 - prefix.length);
      });
      socket.on('error', () => undefined);
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n${trusted ? `x-elsewhere-proxy-token: ${proxy}\r\nx-vercel-forwarded-for: 203.0.113.1\r\n` : ''}\r\n`,
      );
      try {
        await vi.waitFor(() => expect(prefix).toMatch(new RegExp(`^HTTP/1.1 ${status} `)), {
          timeout: 1500,
        });
        await vi.waitFor(() => expect(socket.destroyed).toBe(true), { timeout: 1500 });
        expect((await consumed(await fetch(url + '/api/health'))).status).toBe(200);
      } finally {
        socket.destroy();
      }
    },
  );

  it('keeps recovery usable when the bounded public identity table is saturated', async () => {
    const { url } = await start();
    for (let offset = 0; offset < 4096; offset += 16)
      await Promise.all(
        Array.from({ length: 16 }, (_, index) => {
          const n = offset + index;
          return fetch(url + '/api/not-a-route', {
            headers: headers(`198.18.${Math.floor(n / 256)}.${n % 256}`),
          }).then(consumed);
        }),
      );
    expect(
      (await consumed(await fetch(url + '/api/world', { headers: headers('203.0.113.254') })))
        .status,
    ).toBe(429);
    expect((await control(url)).status).toBe(200);
    expect((await control(url, true)).status).toBe(200);
  }, 20000);

  it('clears visitors only after a successful explicit reset, preserving visits on pause, resume and failed reset', async () => {
    let failReset = true;
    const snapshot = fixture();
    const { url } = await start({
      reset: async () => {
        if (failReset) throw Error('fixture failure');
        return snapshot;
      },
    });
    const registration = await fetch(url + '/api/visitors', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: '{}',
    });
    const visitor = (await registration.json()) as { visitorId: string; token: string };
    const own = () =>
      fetch(url + '/api/visitors/' + visitor.visitorId, {
        headers: { ...headers(), authorization: 'Bearer ' + visitor.token },
      }).then(consumed);
    const action = (name: string) =>
      fetch(url + '/api/admin/' + name, {
        method: 'POST',
        headers: {
          ...headers(),
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: '{}',
      }).then(consumed);
    expect((await own()).status).toBe(200);
    expect((await action('pause')).status).toBe(200);
    expect((await own()).status).toBe(200);
    expect((await action('resume')).status).toBe(200);
    expect((await own()).status).toBe(200);
    expect((await action('reset')).status).toBe(500);
    expect((await own()).status).toBe(200);
    failReset = false;
    expect((await action('reset')).status).toBe(200);
    expect((await own()).status).toBe(401);
  });
});
