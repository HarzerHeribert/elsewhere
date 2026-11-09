import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import assert from 'node:assert/strict';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-proxy-fixture-'));
const name = 'elsewhere-proxy-fixture-' + randomUUID().slice(0, 8),
  proxy = name + '-tls';
const image = 'caddy@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9';
const token = 'fixture-service-token-for-proxy-security-check-only-2026';
const researchToken = 'fixture-research-gateway-token-only-2026';
const fixtureUser = `${process.getuid()}:${process.getgid()}`;
function run(args, allow = false) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if ((r.error || r.status !== 0) && !allow)
    throw Error(
      'Isolated proxy fixture operation ' +
        args[0] +
        ' failed: ' +
        String(r.stderr ?? r.error?.message).slice(0, 2000),
    );
  return r.stdout?.trim() ?? '';
}
let result;
try {
  const tls = path.join(dir, 'tls');
  fs.mkdirSync(tls, { mode: 0o700 });
  const key = path.join(tls, 'key.pem'),
    cert = path.join(tls, 'cert.pem');
  const issued = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(issued.status, 0);
  fs.chmodSync(key, 0o600);
  fs.writeFileSync(
    path.join(dir, 'server.mjs'),
    `import http from 'node:http';let hits=0;const handler=async(req,res)=>{if(req.url==='/metrics'){res.end(JSON.stringify({hits}));return;}try{for await(const chunk of req){}hits++;res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:true}));}catch{res.destroy();}};http.createServer(handler).listen(4100,'0.0.0.0');http.createServer(handler).listen(4120,'0.0.0.0');`,
    { mode: 0o600 },
  );
  run(['network', 'create', name]);
  run([
    'run',
    '-d',
    '--network',
    name,
    '--name',
    name,
    '--user',
    fixtureUser,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--memory=64m',
    '--cpus=0.2',
    '-p',
    '127.0.0.1::9443',
    '-p',
    '127.0.0.1::4100',
    '--mount',
    `type=bind,src=${dir},dst=/fixture,readonly`,
    'node:22.22.3-bookworm-slim',
    'node',
    '/fixture/server.mjs',
  ]);
  run([
    'run',
    '-d',
    '--name',
    proxy,
    '--user',
    fixtureUser,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--memory=64m',
    '--cpus=0.2',
    '--network',
    'container:' + name,
    '--tmpfs',
    '/data:rw,noexec,nosuid,size=4m',
    '--tmpfs',
    '/config:rw,noexec,nosuid,size=4m',
    '-e',
    'HUBERT_INFERENCE_HOST=localhost',
    '-e',
    'INFERENCE_BROKER_TOKEN=' + token,
    '-e',
    'RESEARCH_BROKER_TOKEN=' + researchToken,
    '--mount',
    `type=bind,src=${process.cwd()}/infra/vps/Caddyfile.pinned,dst=/etc/caddy/Caddyfile,readonly`,
    '--mount',
    `type=bind,src=${tls},dst=/etc/hubert-tls,readonly`,
    image,
    'caddy',
    'run',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
  const port = Number(run(['port', name, '9443/tcp']).split(':').at(-1));
  const upstreamPort = Number(run(['port', name, '4100/tcp']).split(':').at(-1));
  const ca = fs.readFileSync(cert);
  const request = (route, headers = {}, body) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          servername: 'localhost',
          port,
          path: route,
          method: body === undefined ? 'GET' : 'POST',
          ca,
          headers: { host: 'localhost', ...headers },
          timeout: 10000,
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode, text }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(Error('Fixture request timeout')));
      req.end(body);
    });
  for (let i = 0; i < 30; i++) {
    try {
      await request('/readyz');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const unauth = await request('/readyz');
  assert.equal(unauth.status, 401);
  assert.equal(
    (await (await fetch('http://127.0.0.1:' + upstreamPort + '/metrics')).json()).hits,
    0,
  );
  const wrong = await request('/readyz', { authorization: 'Bearer wrong-fixture-token' });
  assert.equal(wrong.status, 401);
  const valid = await request('/readyz', { authorization: 'Bearer ' + token });
  assert.equal(valid.status, 200);
  assert.equal(
    (await (await fetch('http://127.0.0.1:' + upstreamPort + '/metrics')).json()).hits,
    1,
  );
  const unknown = await request('/not-a-service');
  assert.equal(unknown.status, 404);
  const large = await request(
    '/v1/decision',
    { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    'x'.repeat(100000),
  );
  assert.equal(large.status, 413);
  assert.equal(
    (await (await fetch('http://127.0.0.1:' + upstreamPort + '/metrics')).json()).hits,
    1,
  );
  assert.equal((await request('/v1/research/ready')).status, 401);
  assert.equal(
    (await request('/v1/research/ready', { authorization: 'Bearer ' + token })).status,
    401,
  );
  assert.equal(
    (await request('/readyz', { authorization: 'Bearer ' + researchToken })).status,
    401,
  );
  assert.equal(
    (await request('/v1/research/ready', { authorization: 'Bearer ' + researchToken })).status,
    200,
  );
  assert.equal(
    (
      await request(
        '/v1/research/search',
        { authorization: 'Bearer ' + researchToken, 'content-type': 'application/json' },
        'x'.repeat(10000),
      )
    ).status,
    413,
  );
  assert.equal(
    (await (await fetch('http://127.0.0.1:' + upstreamPort + '/metrics')).json()).hits,
    2,
  );
  result = {
    researchCredentialSeparated: true,
    proxyFixturePassed: true,
    unauthorizedRejectedBeforeUpstream: true,
    validRpcForwarded: true,
    unknownRouteRejected: true,
    oversizeRejected: large.status,
    realProviderCalls: 0,
  };
} catch (error) {
  result = {
    proxyFixturePassed: false,
    details: String(error.message).slice(0, 2000),
    fixtureLogs: run(['logs', '--tail', '8', proxy], true).slice(0, 2000),
  };
  process.exitCode = 1;
} finally {
  run(['rm', '-f', proxy], true);
  run(['rm', '-f', name], true);
  run(['network', 'rm', name], true);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(result));
