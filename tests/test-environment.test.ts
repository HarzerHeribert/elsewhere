import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { isolatedAppEnvironment } from '../scripts/test-environment';

it('isolates both inherited configuration and an operator dotenv file in actual child startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'elsewhere-env-test-'));
  try {
    await writeFile(
      join(directory, '.env'),
      'AUTH_DATABASE_URL=postgres://dotenv-sentinel.invalid/private\nMODEL_PROVIDER=compatible\nRESEARCH_BROKER_URL=https://dotenv-research.invalid\nTAVILY_API_KEY=dotenv-research-key\n',
    );
    const environment = isolatedAppEnvironment(
      {
        dataDirectory: join(directory, 'test-data'),
        port: 4015,
        webPort: 5175,
        ownerToken: 'isolated-test-owner-not-an-operator-credential',
      },
      {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://world-sentinel.invalid/private',
        AUTH_DATABASE_URL: 'postgres://auth-sentinel.invalid/private',
        BETTER_AUTH_URL: 'https://operator-sentinel.invalid',
        BETTER_AUTH_SECRET: 'operator-sentinel-secret-do-not-inherit',
        AUTH_ADMIN_USER_IDS: 'operator-sentinel-admin',
        MODEL_API_KEY: 'operator-sentinel-key',
        MODEL_ROUTING_JSON: 'operator-routing-sentinel',
        MODEL_CF_INFERENCE_KEY: 'operator-routing-key-sentinel',
        RESEARCH_BROKER_URL: 'https://operator-research.invalid',
        RESEARCH_BROKER_TOKEN: 'operator-research-token',
        RESEARCH_BROKER_CA_PEM: 'operator-research-certificate',
        RESEARCH_BROKER_ALLOW_PRIVATE_HTTP: 'true',
        TAVILY_API_KEY: 'operator-tavily-key',
        TAVILY_FUTURE_TOKEN: 'operator-future-key',
        SEARXNG_BASE_URL: 'https://operator-search.invalid',
        SEARXNG_API_KEY: 'operator-searxng-key',
        CHARACTER_MAIL_API_KEY: 'operator-character-mail-key',
        CHARACTER_MAIL_RECEIVE_API_KEY: 'operator-character-receiving-key',
        CHARACTER_MAIL_WEBHOOK_SECRET: 'operator-webhook-secret',
        CHARACTER_MAIL_UNSUBSCRIBE_SECRET: 'operator-unsubscribe-secret',
        RESEND_API_KEY: 'operator-resend-key',
        AUTH_EMAIL_API_KEY: 'operator-mail-key',
        AUTH_EMAIL_FROM: 'operator@example.com',
        API_PROXY_SECRET: 'operator-ingress-key',
      },
    );
    const dotenv = pathToFileURL(createRequire(import.meta.url).resolve('dotenv/config')).href;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      await import(${JSON.stringify(dotenv)});
      const names=['NODE_ENV','DATABASE_URL','AUTH_DATABASE_URL','BETTER_AUTH_URL','AUTH_ADMIN_USER_IDS','MODEL_PROVIDER','MODEL_API_KEY','AUTH_EMAIL_API_KEY','AUTH_EMAIL_FROM','API_PROXY_SECRET','DATA_DIR',...Object.keys(process.env).filter(name=>/^(CHARACTER_MAIL_|RESEND_|RESEARCH_|TAVILY_|SEARXNG_)/.test(name))];
      process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name=>[name,process.env[name]]))));
    `,
      ],
      { cwd: directory, env: environment, encoding: 'utf8', timeout: 5000 },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      AUTH_DATABASE_URL: '',
      BETTER_AUTH_URL: 'http://127.0.0.1:5175',
      AUTH_ADMIN_USER_IDS: '',
      MODEL_PROVIDER: 'local',
      MODEL_API_KEY: '',
      AUTH_EMAIL_API_KEY: '',
      AUTH_EMAIL_FROM: '',
      API_PROXY_SECRET: '',
      DATA_DIR: join(directory, 'test-data'),
    });
    expect(environment.BETTER_AUTH_SECRET).not.toBe('operator-sentinel-secret-do-not-inherit');
    expect(environment.MODEL_ROUTING_JSON).toBeUndefined();
    expect(environment.MODEL_CF_INFERENCE_KEY).toBeUndefined();
    expect(
      Object.keys(environment).filter((name) =>
        /^(CHARACTER_MAIL_|RESEND_|RESEARCH_|TAVILY_|SEARXNG_)/.test(name),
      ),
    ).toEqual([]);
    expect(environment.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(environment.BETTER_AUTH_SECRET).not.toBe(environment.ADMIN_TOKEN);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
