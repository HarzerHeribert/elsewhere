import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';

const { values } = parseArgs({
  options: { image: { type: 'string', default: 'elsewhere-runtime:local-check' } },
});
const suffix = randomBytes(6).toString('hex');
const network = `elsewhere-check-${suffix}`;
const database = `${network}-pg`;
const first = `${network}-first`;
const second = `${network}-second`;
const guard = `${network}-empty-guard`;
const inference = `${network}-inference`;
const inferenceVolume = `${network}-oauth-fixture`;
const directory = await mkdtemp(join(tmpdir(), 'elsewhere-deployment-'));
const key = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('hex');
const owner = randomBytes(32).toString('hex');
const inferenceToken = randomBytes(32).toString('hex');
const ownerUserId = 'fixture-hosted-owner';
const owned = new Set();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  }).trim();
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
const logs = (name) => {
  const result = spawnSync('docker', ['logs', '--tail', '25', name], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return (result.stdout ?? '') + (result.stderr ?? '');
};
async function until(test, message) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && !interrupted) {
    try {
      if (await test()) return;
    } catch {}
    await pause();
  }
  throw new Error(message);
}
function start(name, envFile, publish = false, image = values.image, extra = [], command = []) {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '--env-file',
    envFile,
    ...(publish ? ['-p', '127.0.0.1::4000'] : []),
    ...extra,
    image,
    ...command,
  );
  owned.add(name);
}
function inferenceNode(source) {
  return execFileSync('docker', ['exec', '-i', inference, 'node', '--input-type=module'], {
    input: source,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000,
  }).trim();
}
function inferenceProbe(path, init = {}) {
  return JSON.parse(
    inferenceNode(
      `const r=await fetch(${JSON.stringify(`http://127.0.0.1:4100${path}`)},${JSON.stringify(init)}); console.log(JSON.stringify({status:r.status,body:await r.json()}));`,
    ),
  );
}
const bindingHeader = Buffer.from(
  JSON.stringify({
    worldId: 'elsewhere',
    ownerUserId,
    characterId: 'hubert',
    connectionId: 'hubert-model',
  }),
).toString('base64url');
const inferenceHeaders = {
  authorization: `Bearer ${inferenceToken}`,
  'x-elsewhere-inference-binding': bindingHeader,
};
function base(name) {
  const port = docker('port', name, '4000/tcp').split(':').at(-1);
  return `http://127.0.0.1:${port}`;
}
const headers = { 'x-elsewhere-proxy-token': key, 'x-vercel-forwarded-for': '203.0.113.7' };
async function action(url, name) {
  const response = await fetch(`${url}/api/admin/${name}`, {
    method: 'POST',
    headers: { ...headers, authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200, `Owner ${name} failed.`);
  return response.json();
}
try {
  docker('network', 'create', network);
  docker('volume', 'create', inferenceVolume);
  const pgEnv = join(directory, 'postgres.env');
  await writeFile(pgEnv, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=elsewhere_test\n`, {
    mode: 0o600,
  });
  start(database, pgEnv, false, 'postgres:17-alpine');
  await until(
    () =>
      docker('exec', database, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').includes(
        'accepting connections',
      ),
    'Fixture database did not start.',
  );
  const inferenceEnv = join(directory, 'inference.env');
  await writeFile(
    inferenceEnv,
    [
      'NODE_ENV=production',
      'HOST=0.0.0.0',
      'PORT=4100',
      'INFERENCE_DATA_ROOT=/var/lib/elsewhere-inference',
      `INFERENCE_BROKER_TOKEN=${inferenceToken}`,
      `HUBERT_OWNER_USER_ID=${ownerUserId}`,
      'MODEL_MAX_CALLS_PER_DAY=2',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  start(
    inference,
    inferenceEnv,
    false,
    values.image,
    ['--mount', `type=volume,source=${inferenceVolume},target=/var/lib/elsewhere-inference`],
    ['node', 'dist/inference.mjs'],
  );
  await until(
    () => inferenceProbe('/healthz').status === 200,
    'Unprovisioned private inference did not stay running.',
  );
  assert.equal(inferenceProbe('/readyz').status, 401);
  assert.equal(inferenceProbe('/readyz', { headers: inferenceHeaders }).status, 503);
  assert.equal(docker('port', inference), '', 'Private inference unexpectedly published a port.');
  const hostPath = '/var/lib/elsewhere-inference/.data/chatgpt/host.json';
  const hostId = inferenceNode(
    `import fs from 'node:fs'; console.log(fs.readFileSync(${JSON.stringify(hostPath)},'utf8').trim());`,
  );
  const transfer = {
    format: 'elsewhere-chatgpt-session-transfer-v1',
    transferId: 'c2247335-2e85-4f83-99e2-5c1b6ee41818',
    ownerUserId,
    profile: 'default',
    account: {
      version: 1,
      issuer: 'https://auth.openai.com',
      subject: 'fixture-subject',
      clientId: 'oaiapp_fixture',
      pause: { code: 'fixture_paused' },
      tokens: {
        accessToken: 'fixture-access-not-real',
        refreshToken: 'fixture-refresh-not-real',
        idToken: 'fixture-id-not-real',
        expiresAt: Date.now() + 3600000,
        scopes: ['chatgpt.tokens.use.direct'],
      },
    },
  };
  const imported = execFileSync(
    'docker',
    ['exec', '-i', inference, 'node', 'dist/inference-operator.mjs', 'import'],
    {
      input: JSON.stringify(transfer),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    },
  );
  assert.equal(JSON.parse(imported).transferId, transfer.transferId);
  assert.equal(
    inferenceProbe('/readyz', { headers: inferenceHeaders }).status,
    503,
    'Paused fixture must never invoke a real model.',
  );
  assert.equal(
    inferenceNode(
      `import fs from 'node:fs'; console.log(fs.readFileSync(${JSON.stringify(hostPath)},'utf8').trim());`,
    ),
    hostId,
  );
  assert.equal(
    inferenceNode(
      "import fs from 'node:fs'; console.log([fs.statSync('/var/lib/elsewhere-inference/.data/chatgpt').mode&511,fs.statSync('/var/lib/elsewhere-inference/.data/chatgpt/default.json').mode&511].join(','));",
    ),
    '448,384',
  );
  docker('restart', '--time', '15', inference);
  await until(
    () => inferenceProbe('/healthz').status === 200,
    'Private inference did not recover with its volume.',
  );
  assert.equal(inferenceProbe('/readyz', { headers: inferenceHeaders }).status, 503);
  const env = join(directory, 'runtime.env');
  await writeFile(
    env,
    [
      'NODE_ENV=production',
      'HOST=0.0.0.0',
      'PORT=4000',
      'WEB_ORIGIN=https://elsewhere.example',
      'MODEL_PROVIDER=broker',
      `HUBERT_OWNER_USER_ID=${ownerUserId}`,
      `INFERENCE_BROKER_URL=http://${inference}:4100`,
      'INFERENCE_BROKER_ALLOW_PRIVATE_HTTP=true',
      `INFERENCE_BROKER_TOKEN=${inferenceToken}`,
      'TICK_INTERVAL_MS=60000',
      'SIMULATION_RATE=1',
      'ALLOW_NEW_LIFE=true',
      `DATABASE_URL=postgres://postgres:${password}@${database}:5432/elsewhere_test`,
      `ADMIN_TOKEN=${owner}`,
      `API_PROXY_SECRET=${key}`,
      `BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}`,
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  start(guard, env, false, values.image, ['-e', 'ALLOW_NEW_LIFE=false']);
  await until(
    () => docker('inspect', '--format', '{{.State.Status}}', guard) === 'exited',
    'Empty production life was not refused.',
  );
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', guard), '1');
  assert.ok(logs(guard).includes('Import the existing life'));
  start(first, env, true);
  const a = base(first);
  await until(
    async () => (await (await fetch(`${a}/api/health`)).json()).ready,
    'First production process did not become ready.',
  );
  assert.equal(
    (await fetch(`${a}/api/world`)).status,
    403,
    'Direct origin access was not blocked.',
  );
  const account = await (await fetch(`${a}/api/account`, { headers })).json();
  assert.equal(
    account.passwordAuthEnabled,
    false,
    'Unconfigured account mail must keep public signup disabled.',
  );
  assert.deepEqual(account.managedCharacterIds, []);
  assert.equal(
    docker(
      'exec',
      first,
      'node',
      '-e',
      "console.log(require('node:fs').existsSync('/var/lib/elsewhere-inference/.data/chatgpt/default.json'))",
    ),
    'false',
    'World process could read the private OAuth volume.',
  );
  await action(a, 'pause');
  await action(a, 'tick');
  const checkpoint = await (await fetch(`${a}/api/world`, { headers })).json();
  assert.equal(checkpoint.runtime.paused, true);
  start(second, env, true);
  const b = base(second);
  await until(async () => (await fetch(`${b}/api/health`)).ok, 'Standby liveness did not start.');
  assert.equal(
    (await (await fetch(`${b}/api/health`)).json()).ready,
    false,
    'Two processes acquired one life.',
  );
  assert.equal((await fetch(`${b}/api/world`, { headers })).status, 503);
  assert.equal(
    (
      await fetch(`${b}/api/admin/tick`, {
        method: 'POST',
        headers: {
          ...headers,
          authorization: `Bearer ${owner}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    503,
  );
  docker('stop', '--time', '15', first);
  await until(
    async () => (await (await fetch(`${b}/api/health`)).json()).ready,
    'Standby did not take ownership after graceful shutdown.',
  );
  const continued = await (await fetch(`${b}/api/world`, { headers })).json();
  assert.ok(isDeepStrictEqual(continued, checkpoint), 'Life changed or reset during handoff.');
  assert.equal((await action(b, 'tick')).runtime.tick, checkpoint.runtime.tick + 1);
  docker('stop', '--time', '15', second);
  console.log(
    'Deployment smoke passed: production world/private inference separation, protected mounted OAuth import and restart, unprovisioned/paused fallback, private ingress, exclusive life handoff and continued activity. No real model calls.',
  );
} catch (error) {
  // Only these newly created fixtures are inspected. No operator env files or services are read.
  for (const name of [guard, first, second, inference]) {
    if (owned.has(name)) {
      try {
        console.error(logs(name));
      } catch {}
    }
  }
  throw error;
} finally {
  for (const name of owned) {
    try {
      docker('rm', '-f', name);
    } catch {}
  }
  try {
    docker('network', 'rm', network);
  } catch {}
  try {
    docker('volume', 'rm', inferenceVolume);
  } catch {}
  await rm(directory, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
