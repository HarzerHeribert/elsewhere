import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { configuredDevelopmentEnvironments } from '../packages/security/src/credential-store';
import { runServices } from '../scripts/processes.mjs';

it('delivers the configured key to an actual API child without passing it to the web child', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'elsewhere-configured-process-test-'));
  const environment = configuredDevelopmentEnvironments(
    {
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      apiKey: 'fixture-child-api-key',
      maxCallsPerDay: 20,
    },
    { ...process.env, MODEL_API_KEY: 'fixture-inherited-key' },
  );
  const fixture = `
    require('node:fs').writeFileSync(process.argv[1], JSON.stringify({
      hasKey: Boolean(process.env.MODEL_API_KEY), correctKey: process.env.MODEL_API_KEY === 'fixture-child-api-key',
    }));
    setInterval(() => {}, 1000);
  `;
  const api = join(directory, 'api.json');
  const web = join(directory, 'web.json');
  const services = runServices(
    [
      { command: process.execPath, args: ['-e', fixture, api], env: environment.api },
      { command: process.execPath, args: ['-e', fixture, web], env: environment.web },
    ],
    { graceMs: 1000 },
  );
  try {
    const deadline = Date.now() + 4000;
    for (;;) {
      const ready = await Promise.allSettled([stat(api), stat(web)]);
      if (ready.every((result) => result.status === 'fulfilled')) break;
      if (Date.now() >= deadline) throw new Error('Fixture children did not become ready.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(JSON.parse(await readFile(api, 'utf8'))).toEqual({ hasKey: true, correctKey: true });
    expect(JSON.parse(await readFile(web, 'utf8'))).toEqual({ hasKey: false, correctKey: false });
  } finally {
    await services.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
