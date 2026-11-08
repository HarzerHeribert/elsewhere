import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { isolatedAppEnvironment } from './test-environment';

const directory = await mkdtemp(join(tmpdir(), 'elsewhere-smoke-'));
const portServer = createServer();
await new Promise<void>((resolve, reject) => {
  portServer.once('error', reject);
  portServer.listen(0, '127.0.0.1', resolve);
});
const address = portServer.address();
assert(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((resolve) => portServer.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
const environment = isolatedAppEnvironment({
  dataDirectory: directory,
  port,
  ownerToken: token,
  tickIntervalMs: 60000,
});
let child: ChildProcess | undefined;
let logs = '';
async function boot(tickIntervalMs = 60000) {
  logs = '';
  child = spawn(process.execPath, ['--import', 'tsx', 'app/main.ts'], {
    cwd: process.cwd(),
    env: { ...environment, TICK_INTERVAL_MS: String(tickIntervalMs) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Local service exited: ${logs}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Local service did not become healthy: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child?.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout);
  child = undefined;
}
async function owner(action: string) {
  const response = await fetch(`${base}/api/admin/${action}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200, `${action}: ${await response.clone().text()}`);
  return response.json() as Promise<PublicSnapshot>;
}
try {
  await boot(250);
  const initial = (await fetch(`${base}/api/world`).then((response) =>
    response.json(),
  )) as PublicSnapshot;
  let automatic = initial;
  for (
    let attempt = 0;
    attempt < 100 && automatic.runtime.tick <= initial.runtime.tick;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    automatic = (await fetch(`${base}/api/world`).then((response) =>
      response.json(),
    )) as PublicSnapshot;
  }
  assert.equal(
    automatic.runtime.paused,
    false,
    'The service should start with its simulation running',
  );
  assert(
    automatic.runtime.tick > initial.runtime.tick,
    'The service timer must advance life without an owner step',
  );
  const unauthorized = await fetch(`${base}/api/admin/tick`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 401);
  const hostileOrigin = await fetch(`${base}/api/admin/tick`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: 'https://untrusted.example',
    },
    body: '{}',
  });
  assert.equal(hostileOrigin.status, 403);
  await owner('pause');
  let snapshot = await owner('tick');
  for (let i = 0; i < 90; i++) snapshot = await owner('tick');
  assert(snapshot.memories.length > 0, 'Hubert should remember actual experiences');
  assert(
    snapshot.world.objects.some((object) => object.id === 'weather-vane-sketch'),
    'A verified work action should produce a persistent sketch',
  );
  assert(snapshot.artifacts?.length, 'Completed project should publish an actual artifact');
  const artifact = await fetch(`${base}${snapshot.artifacts[0].url}`);
  assert.equal(artifact.status, 200);
  assert((await artifact.text()).includes('<svg'));
  const privateNote = 'smoke-private-note-do-not-publish-8362';
  const delivered = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: privateNote }),
  });
  assert.equal(delivered.status, 202);
  const before = await fetch(`${base}/api/world`).then((response) => response.text());
  assert(!before.includes(token), 'Owner credential must stay private');
  assert(!before.includes(privateNote), 'Guestbook contents must stay private');
  await stop();
  await boot();
  const after = await fetch(`${base}/api/world`).then((response) => response.text());
  assert.equal(after, before, 'Restart must recover the exact committed public state');
  console.log(
    'Smoke passed: actual service startup, autonomous activity, owner authorization, origin checks, private messages, SVG artifact, and restart persistence.',
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
