import { expect, it } from 'vitest';
import { modelProfile, routingConfig } from '../../../tests/model-fixtures';
import { parseRoutingConfig } from './config';
import { canonicalJson } from './data';
import { ExactModelCache } from './cache';

it('rejects inline keys, unknown models, unsafe endpoints, unapproved remote use and production loopback', () => {
  const base = routingConfig();
  expect(() => parseRoutingConfig({ ...base, apiKey: 'PRIVATE-CANARY' })).toThrow('invalid fields');
  expect(() => parseRoutingConfig({ ...base, allowRemote: false })).toThrow('permission');
  expect(() =>
    parseRoutingConfig({
      ...base,
      profiles: [modelProfile('cf-routine', { baseUrl: 'http://models.example.invalid' })],
    }),
  ).toThrow('HTTPS');
  expect(() =>
    parseRoutingConfig({
      ...base,
      profiles: [
        modelProfile('cf-routine', { baseUrl: 'https://user:PRIVATE-CANARY@example.invalid' }),
      ],
    }),
  ).toThrow('embedded');
  expect(() =>
    parseRoutingConfig({
      ...base,
      profiles: [modelProfile('cf-routine', { apiKeyEnv: 'ADMIN_TOKEN' })],
    }),
  ).toThrow('invalid fields');
  expect(() =>
    parseRoutingConfig({
      ...base,
      policies: { decision: { ...base.policies.decision!, models: ['unknown'] } },
    }),
  ).toThrow('unknown');
  const local = routingConfig({
    profiles: [
      modelProfile('cf-routine', {
        transport: 'ollama',
        local: true,
        baseUrl: 'http://127.0.0.1:11434',
      }),
    ],
  });
  expect(parseRoutingConfig(local).profiles[0].local).toBe(true);
  expect(() => parseRoutingConfig(local, true)).toThrow('locality');
  expect(() => parseRoutingConfig('{PRIVATE-CANARY')).toThrow('invalid JSON');
});

it('bounds LRU cache size and expiry, and never shares mutable outputs', () => {
  let now = 0;
  const cache = new ExactModelCache(() => now, 2, 1000);
  cache.set('one', { value: 1 }, 100);
  cache.set('two', { value: 2 }, 100);
  (cache.get('one') as { value: number }).value = 99;
  cache.set('three', 'three', 100);
  expect(cache.get('two')).toBeUndefined();
  expect(cache.get('one')).toEqual({ value: 1 });
  now = 101;
  expect(cache.get('one')).toBeUndefined();
  cache.set('large', 'x'.repeat(2000), 100);
  expect(cache.get('large')).toBeUndefined();
});

it('canonicalizes only bounded finite JSON, with stable object ordering', () => {
  expect(canonicalJson({ z: 1, a: { d: 2, c: 3 } })).toBe(
    canonicalJson({ a: { c: 3, d: 2 }, z: 1 }),
  );
  expect(() => canonicalJson({ unsafe: Infinity })).toThrow('finite');
  expect(() => canonicalJson({ execute: () => undefined })).toThrow('finite');
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => canonicalJson(cycle)).toThrow('finite');
});
