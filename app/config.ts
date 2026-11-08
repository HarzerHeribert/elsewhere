import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  DATA_DIR: z.string().default('.data'),
  ALLOW_NEW_LIFE: z.enum(['true', 'false']).default('false'),
  TICK_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  SIMULATION_RATE: z.coerce.number().min(0.1).max(60).default(3),
  MODEL_PROVIDER: z.enum(['local', 'compatible', 'ollama']).default('local'),
  MODEL_MAX_CALLS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(100),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15000),
});

/** Never print Zod's input-bearing error details for environment configuration. */
export function appConfig(environment: NodeJS.ProcessEnv) {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new Error('Application settings are invalid; check variable names and bounds.');
  const config = result.data;
  const origin = new URL(config.WEB_ORIGIN);
  if (origin.origin !== config.WEB_ORIGIN || origin.username || origin.password)
    throw new Error('WEB_ORIGIN must be an origin without a path, credentials, query or fragment.');
  if (config.NODE_ENV === 'production') {
    if (origin.protocol !== 'https:') throw new Error('Production WEB_ORIGIN must use HTTPS.');
    for (const name of ['ADMIN_TOKEN', 'BETTER_AUTH_SECRET', 'API_PROXY_SECRET'] as const)
      if (!environment[name] || environment[name]!.length < 32)
        throw new Error(`Production requires an explicit ${name} of at least 32 characters.`);
    if (!environment.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//))
      throw new Error(
        'Production requires PostgreSQL DATABASE_URL; ephemeral SQLite is not allowed.',
      );
    if (environment.BETTER_AUTH_URL && environment.BETTER_AUTH_URL !== config.WEB_ORIGIN)
      throw new Error('BETTER_AUTH_URL must equal the public WEB_ORIGIN in this deployment.');
    if (config.MODEL_PROVIDER === 'ollama')
      throw new Error('The public production profile cannot reach a personal Ollama service.');
  }
  return {
    ...config,
    production: config.NODE_ENV === 'production',
    allowNewLife: config.ALLOW_NEW_LIFE === 'true',
  };
}
