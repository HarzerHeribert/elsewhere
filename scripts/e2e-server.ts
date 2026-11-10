import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { DecisionContext } from '@elsewhere/character-runtime';
import { browserFixtureAction, type BrowserDecisionScenario } from '../tests/e2e/decision-fixture';
import { runServices } from './processes.mjs';
import { createLocalAuth, authOptionsFromEnvironment } from '../packages/auth/src/index';

// This launcher never discovers real credentials, a production database or a personal model.
const directory = resolve(process.env.DATA_DIR ?? '.');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(dirname(directory), resolve(tmpdir()));
assert.match(basename(directory), /^elsewhere-e2e-run-[a-zA-Z0-9-]+$/);
await mkdir(directory, { recursive: true });
// Character retries require their actual owner session, even when an operator
// bearer can otherwise control this fixture. Provision that owner only here.
const auth = await createLocalAuth(authOptionsFromEnvironment(process.env));
let ownerUserId: string;
try {
  ownerUserId = await auth.createOperatorAccount({
    name: 'Browser fixture owner',
    email: 'browser-fixture-owner@example.invalid',
  });
  await writeFile(join(directory, 'fixture-owner.json'), JSON.stringify({ userId: ownerUserId }), {
    mode: 0o600,
    flag: 'wx',
  });
} finally {
  await auth.close();
}
const key = randomBytes(32).toString('hex');
const fixture = createServer((request, response) => {
  void (async () => {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${key}`);
    const scenario = (await readFile(join(directory, 'decision-scenario'), 'utf8').catch(
      () => 'disabled',
    )) as BrowserDecisionScenario;
    assert(
      ['memories', 'wish', 'birds'].includes(scenario),
      'No browser provider scenario opted in',
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      assert(bytes <= 1_000_000, 'Browser provider request exceeds fixture bound');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const context = JSON.parse(
      body.messages.find((message: { role: string }) => message.role === 'user').content,
    ) as DecisionContext;
    const action = browserFixtureAction(
      context,
      scenario as Exclude<BrowserDecisionScenario, 'disabled'>,
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }));
  })().catch(() => {
    response.writeHead(503);
    response.end();
  });
});
await new Promise<void>((resolve, reject) => {
  fixture.once('error', reject);
  fixture.listen(0, '127.0.0.1', resolve);
});
const address = fixture.address();
assert(address && typeof address === 'object');
try {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await runServices([{ command, args: ['dev'] }], {
    env: {
      ...process.env,
      HUBERT_OWNER_USER_ID: ownerUserId,
      MODEL_PROVIDER: 'compatible',
      MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      MODEL_API_KEY: key,
      MODEL_NAME: 'isolated-browser-fixture',
      MODEL_MAX_CALLS_PER_DAY: '1000',
    },
  }).completion;
} finally {
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
}
