import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configuredDevelopmentEnvironments,
  credentialSchemas,
  loadCredentialProfile,
  saveCredentialProfile,
} from './credential-store';

const model = {
  baseUrl: 'https://model.example/v1',
  model: 'fixture-small',
  apiKey: 'fixture-model-key-never-real',
  maxCallsPerDay: 20,
};
const stripe = { restrictedKey: 'rk_test_fixtureNeverReal123' };
const email = { apiKey: 're_fixtureNeverReal123', fromAddress: 'hubert@example.com' };
let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elsewhere-setup-test-'));
  outside = mkdtempSync(join(tmpdir(), 'elsewhere-setup-outside-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('private local credential records', () => {
  it('keeps profiles separate and preserves lived state, owner credentials and dotenv', () => {
    mkdirSync(join(root, '.data'), { mode: 0o700 });
    writeFileSync(join(root, '.env'), 'EXISTING=fixture\n');
    writeFileSync(join(root, '.data', 'owner-token'), 'fixture-owner');
    writeFileSync(join(root, '.data', 'elsewhere.sqlite'), 'fixture-world');
    saveCredentialProfile(root, 'hubert', 'model', model);
    saveCredentialProfile(root, 'hubert', 'stripe', stripe);
    saveCredentialProfile(root, 'hubert', 'email', email);
    saveCredentialProfile(root, 'other', 'stripe', { restrictedKey: 'rk_test_otherFixture123' });
    expect(loadCredentialProfile(root, 'hubert', 'model')?.values).toEqual(model);
    expect(loadCredentialProfile(root, 'hubert', 'stripe')?.values).toEqual(stripe);
    expect(loadCredentialProfile(root, 'other', 'stripe')?.values.restrictedKey).not.toBe(
      stripe.restrictedKey,
    );
    expect(loadCredentialProfile(root, 'other', 'model')).toBeNull();
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('EXISTING=fixture\n');
    expect(readFileSync(join(root, '.data', 'owner-token'), 'utf8')).toBe('fixture-owner');
    expect(readFileSync(join(root, '.data', 'elsewhere.sqlite'), 'utf8')).toBe('fixture-world');
    for (const path of ['.data', '.data/credentials', '.data/credentials/hubert'])
      expect(lstatSync(join(root, path)).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(root, '.data/credentials/hubert/model.json')).mode & 0o777).toBe(0o600);
  });

  it('requires explicit replacement and changes only the selected profile', () => {
    saveCredentialProfile(root, 'hubert', 'model', model);
    saveCredentialProfile(root, 'hubert', 'stripe', stripe);
    expect(() =>
      saveCredentialProfile(root, 'hubert', 'model', { ...model, apiKey: 'fixture-new-key' }),
    ).toThrow('explicit confirmation');
    expect(loadCredentialProfile(root, 'hubert', 'model')?.values).toEqual(model);
    saveCredentialProfile(
      root,
      'hubert',
      'model',
      { ...model, apiKey: 'fixture-new-key' },
      { replace: true },
    );
    expect(loadCredentialProfile(root, 'hubert', 'model')?.values.apiKey).toBe('fixture-new-key');
    expect(loadCredentialProfile(root, 'hubert', 'stripe')?.values).toEqual(stripe);
    expect(readdirSync(join(root, '.data/credentials/hubert')).sort()).toEqual([
      'model.json',
      'stripe.json',
    ]);
  });

  it.each([
    'sk_test_fixtureSecret123',
    'sk_live_fixtureSecret123',
    'rk_live_fixtureSecret123',
    'pk_test_fixtureSecret123',
  ])(
    'rejects full-access, live and publishable Stripe keys without writing or echoing them',
    (key) => {
      try {
        saveCredentialProfile(root, 'hubert', 'stripe', { restrictedKey: key });
        throw new Error('Should reject');
      } catch (error) {
        expect(String(error)).toContain('Settings are invalid');
        expect(String(error)).not.toContain(key);
      }
      expect(existsSync(join(root, '.data'))).toBe(false);
    },
  );

  it.each(['../escape', 'hubert/other', '/tmp/escape', '..', 'Hubert'])(
    'rejects unsafe character identifiers',
    (character) => {
      expect(() => saveCredentialProfile(root, character, 'stripe', stripe)).toThrow(
        'lowercase character ID',
      );
      expect(existsSync(join(root, '.data'))).toBe(false);
    },
  );

  it.each(['.data', '.data/credentials', '.data/credentials/hubert'])(
    'refuses a symlinked storage directory',
    (path) => {
      const parts = path.split('/');
      if (parts.length > 1)
        mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true, mode: 0o700 });
      symlinkSync(outside, join(root, path));
      expect(() => saveCredentialProfile(root, 'hubert', 'stripe', stripe)).toThrow(
        'symbolic links',
      );
      expect(readdirSync(outside)).toEqual([]);
    },
  );

  it.each(['symlink', 'hardlink', 'shared-permissions'])(
    'refuses unsafe existing credential files during read and replacement',
    (mode) => {
      saveCredentialProfile(root, 'hubert', 'stripe', stripe);
      const path = join(root, '.data/credentials/hubert/stripe.json');
      if (mode === 'shared-permissions') chmodSync(path, 0o644);
      else {
        const target = join(outside, 'target.json');
        if (mode === 'hardlink') linkSync(path, target);
        else {
          rmSync(path);
          writeFileSync(target, 'unchanged', { mode: 0o600 });
          symlinkSync(target, path);
        }
      }
      expect(() => loadCredentialProfile(root, 'hubert', 'stripe')).toThrow();
      expect(() =>
        saveCredentialProfile(root, 'hubert', 'stripe', stripe, { replace: true }),
      ).toThrow();
      if (mode === 'symlink')
        expect(readFileSync(join(outside, 'target.json'), 'utf8')).toBe('unchanged');
    },
  );

  it('does not bypass an existing writer lock or expose malformed record contents', () => {
    saveCredentialProfile(root, 'hubert', 'stripe', stripe);
    const path = join(root, '.data/credentials/hubert/stripe.json');
    writeFileSync(`${path}.lock`, '', { mode: 0o600 });
    expect(() =>
      saveCredentialProfile(root, 'hubert', 'stripe', stripe, { replace: true }),
    ).toThrow('locked');
    expect(loadCredentialProfile(root, 'hubert', 'stripe')?.values).toEqual(stripe);
    rmSync(`${path}.lock`);
    writeFileSync(path, '{broken-fixture-secret', { mode: 0o600 });
    try {
      loadCredentialProfile(root, 'hubert', 'stripe');
      throw new Error('Should reject');
    } catch (error) {
      expect(String(error)).toContain('invalid');
      expect(String(error)).not.toContain('broken-fixture-secret');
    }
  });

  it('refuses shared directories and oversized profiles', () => {
    mkdirSync(join(root, '.data'), { mode: 0o755 });
    expect(() => saveCredentialProfile(root, 'hubert', 'stripe', stripe)).toThrow('private');
    chmodSync(join(root, '.data'), 0o700);
    saveCredentialProfile(root, 'hubert', 'stripe', stripe);
    writeFileSync(join(root, '.data/credentials/hubert/stripe.json'), 'x'.repeat(16385));
    expect(() => loadCredentialProfile(root, 'hubert', 'stripe')).toThrow('too large');
  });
});

it.each([
  'not-a-url',
  'http://remote.example/v1',
  'https://user:fixture@model.example/v1',
  'https://model.example/v1?key=fixture',
  'https://model.example/v1#fixture',
])('rejects unsafe model endpoints without throwing from the validator', (baseUrl) => {
  expect(credentialSchemas.model.safeParse({ ...model, baseUrl }).success).toBe(false);
});

it('delivers only the selected model to the API and strips sensitive settings from the web environment', () => {
  const parent = {
    PATH: '/usr/bin',
    PORT: '4000',
    VITE_PORT: '5173',
    MODEL_API_KEY: 'fixture-old-model',
    STRIPE_KEY: 'fixture-parent-stripe',
    RESEND_API_KEY: 'fixture-parent-resend',
    ADMIN_TOKEN: 'fixture-parent-owner',
    BETTER_AUTH_SECRET: 'fixture-parent-auth',
    DATABASE_URL: 'fixture-parent-database',
  };
  const before = { ...parent };
  const environment = configuredDevelopmentEnvironments(model, parent);
  expect(environment.api.MODEL_API_KEY).toBe(model.apiKey);
  expect(environment.api.MODEL_BASE_URL).toBe(model.baseUrl);
  expect(environment.api.MODEL_MAX_CALLS_PER_DAY).toBe('20');
  expect(environment.web).toEqual({ PATH: '/usr/bin', PORT: '4000', VITE_PORT: '5173' });
  expect(parent).toEqual(before);
});
