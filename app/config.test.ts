import { expect, it } from 'vitest';
import { appConfig } from './config';

const production = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://elsewhere.example',
  ADMIN_TOKEN: 'fixture-owner-'.repeat(4),
  BETTER_AUTH_SECRET: 'fixture-auth-'.repeat(4),
  API_PROXY_SECRET: 'fixture-ingress-'.repeat(4),
  DATABASE_URL: 'postgres://fixture@localhost/fixture',
};
it('keeps zero-key local startup and requires a complete hosted boundary', () => {
  expect(appConfig({}).production).toBe(false);
  expect(appConfig(production).production).toBe(true);
  expect(appConfig(production).allowNewLife).toBe(false);
  expect(appConfig({ ...production, ALLOW_NEW_LIFE: 'true' }).allowNewLife).toBe(true);
});
it.each(['ADMIN_TOKEN', 'BETTER_AUTH_SECRET', 'API_PROXY_SECRET', 'DATABASE_URL'] as const)(
  'fails closed when production lacks %s',
  (name) => {
    expect(() => appConfig({ ...production, [name]: '' })).toThrow(name);
  },
);
it.each([
  'http://elsewhere.example',
  'https://elsewhere.example/private',
  'https://user:password@elsewhere.example',
  'https://elsewhere.example?key=fixture',
])('rejects unsafe public origins', (WEB_ORIGIN) => {
  expect(() => appConfig({ ...production, WEB_ORIGIN })).toThrow();
});
it('rejects a different auth origin and a personal local model in production', () => {
  expect(() => appConfig({ ...production, BETTER_AUTH_URL: 'https://another.example' })).toThrow(
    'BETTER_AUTH_URL',
  );
  expect(() => appConfig({ ...production, MODEL_PROVIDER: 'ollama' })).toThrow('Ollama');
});
it('allows explicit local subscription mode and blocks an unreviewed hosted credential boundary', () => {
  expect(appConfig({ MODEL_PROVIDER: 'chatgpt' }).MODEL_PROVIDER).toBe('chatgpt');
  expect(() => appConfig({ ...production, MODEL_PROVIDER: 'chatgpt' })).toThrow(
    'local owner runtime',
  );
  expect(() => appConfig({ MODEL_PROVIDER: 'chatgpt', HOST: '0.0.0.0' })).toThrow('loopback');
});

it('keeps research optional and requires its own service credentials', () => {
  const research = {
    ...production,
    RESEARCH_BROKER_URL: 'https://research.example',
    RESEARCH_BROKER_TOKEN: 'fixture-research-'.repeat(4),
  };
  expect(appConfig(research).RESEARCH_BROKER_URL).toBe('https://research.example');
  expect(() => appConfig({ ...research, RESEARCH_BROKER_TOKEN: undefined })).toThrow('both');
  expect(() => appConfig({ ...research, RESEARCH_BROKER_URL: undefined })).toThrow('both');
  for (const name of ['ADMIN_TOKEN', 'BETTER_AUTH_SECRET', 'API_PROXY_SECRET'] as const)
    expect(() => appConfig({ ...research, RESEARCH_BROKER_TOKEN: production[name] })).toThrow(
      'separate',
    );
  expect(() =>
    appConfig({ ...research, INFERENCE_BROKER_TOKEN: research.RESEARCH_BROKER_TOKEN }),
  ).toThrow('separate');
  expect(() => appConfig({ ...research, TAVILY_API_KEY: 'fixture-search-provider-key' })).toThrow(
    'private research service',
  );
});
