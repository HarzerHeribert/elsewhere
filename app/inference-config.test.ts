import { expect, it } from 'vitest';
import { inferenceConfig } from './inference-config';
import { appConfig } from './config';

const token = 'fixture-private-inference-'.repeat(3);
const inference = {
  NODE_ENV: 'production',
  INFERENCE_DATA_ROOT: '/var/lib/elsewhere-inference',
  INFERENCE_BROKER_TOKEN: token,
  HUBERT_OWNER_USER_ID: 'fixture-owner-id',
};
const world = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://elsewhere.example',
  ADMIN_TOKEN: 'fixture-world-control-'.repeat(3),
  BETTER_AUTH_SECRET: 'fixture-auth-'.repeat(4),
  API_PROXY_SECRET: 'fixture-ingress-'.repeat(4),
  DATABASE_URL: 'postgres://fixture@localhost/fixture',
  MODEL_PROVIDER: 'broker',
  HUBERT_OWNER_USER_ID: 'fixture-owner-id',
  INFERENCE_BROKER_TOKEN: token,
  INFERENCE_BROKER_HOSTPORT: 'elsewhere-inference:4100',
  INFERENCE_BROKER_ALLOW_PRIVATE_HTTP: 'true',
};
it('supports the sole-Hubert private-service composition and default Luna without world credentials', () => {
  expect(inferenceConfig(inference).MODEL_NAME).toBe('gpt-6-luna');
  expect(appConfig(world).INFERENCE_BROKER_URL).toBe('http://elsewhere-inference:4100/');
});
it('supplies separate observed-token and unknown-usage safeguards without reducing the approved call cap', () => {
  const config = inferenceConfig({ ...inference, MODEL_MAX_CALLS_PER_DAY: '1000' });
  expect(config).toMatchObject({
    MODEL_MAX_CALLS_PER_DAY: 1000,
    MODEL_MAX_INPUT_TOKENS_PER_DAY: 3500000,
    MODEL_MAX_OUTPUT_TOKENS_PER_DAY: 100000,
    MODEL_MAX_INPUT_TOKENS_PER_REQUEST: 32000,
    MODEL_OUTPUT_TOKEN_RESERVE: 2000,
    MODEL_MAX_UNKNOWN_USAGE_CALLS_PER_DAY: 3,
    MODEL_REQUEST_BODY_TIMEOUT_MS: 5000,
  });
});
it('allows an ownerless installation that cannot instantiate a grant or spend quota', () => {
  expect(
    inferenceConfig({ ...inference, HUBERT_OWNER_USER_ID: undefined }).HUBERT_OWNER_USER_ID,
  ).toBeUndefined();
  expect(
    inferenceConfig({ ...inference, HUBERT_OWNER_USER_ID: '' }).HUBERT_OWNER_USER_ID,
  ).toBeUndefined();
  expect(() => inferenceConfig({ ...inference, HUBERT_OWNER_USER_ID: 'local-owner' })).toThrow();
});
it.each([
  '/tmp',
  '/tmp/sessions',
  '/srv/../tmp',
  '/private/tmp',
  '/var/tmp',
  '/var/lib/../../tmp/data',
  'relative/data',
])('rejects ephemeral or relative hosted auth/quota storage %s', (path) => {
  expect(() => inferenceConfig({ ...inference, INFERENCE_DATA_ROOT: path })).toThrow();
});
it.each([
  'ADMIN_TOKEN',
  'BETTER_AUTH_SECRET',
  'API_PROXY_SECRET',
  'DATABASE_URL',
  'OPENAI_REFRESH_TOKEN',
  'MODEL_VERCEL_GATEWAY_KEY',
  'CLOUDFLARE_API_TOKEN',
  'VERCEL_TOKEN',
  'RENDER_API_KEY',
  'GH_TOKEN',
])('keeps unrelated %s out of the private inference service', (key) => {
  expect(() => inferenceConfig({ ...inference, [key]: 'fixture-only' })).toThrow();
});
it.each(['CHATGPT_AUTH_ROOT', 'OPENAI_REFRESH_TOKEN', 'MODEL_CF_INFERENCE_KEY', 'VERCEL_TOKEN'])(
  'keeps upstream credential/settings %s out of the broker-backed world process',
  (key) => {
    expect(() => appConfig({ ...world, [key]: 'fixture-only' })).toThrow();
  },
);
it('requires explicit ownership and a dedicated service secret in hosted broker mode', () => {
  expect(() => appConfig({ ...world, HUBERT_OWNER_USER_ID: undefined })).toThrow(
    'HUBERT_OWNER_USER_ID',
  );
  expect(() => appConfig({ ...world, INFERENCE_BROKER_TOKEN: world.ADMIN_TOKEN })).toThrow(
    'separate',
  );
  expect(() => appConfig({ ...world, INFERENCE_BROKER_ALLOW_PRIVATE_HTTP: 'false' })).toThrow(
    'private HTTP',
  );
  expect(() => appConfig({ ...world, INFERENCE_BROKER_URL: 'https://broker.example' })).toThrow(
    'combined',
  );
});
