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
  MODEL_PROVIDER: z
    .enum(['local', 'compatible', 'ollama', 'routed', 'chatgpt', 'broker'])
    .default('local'),
  HUBERT_OWNER_USER_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/)
    .default('local-owner'),
  INFERENCE_BROKER_URL: z.string().url().optional(),
  INFERENCE_BROKER_HOSTPORT: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/)
    .optional(),
  INFERENCE_BROKER_TOKEN: z.string().min(32).max(512).optional(),
  INFERENCE_BROKER_ALLOW_PRIVATE_HTTP: z.enum(['true', 'false']).default('false'),
  CHATGPT_PROFILE: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,47}$/)
    .default('default'),
  CHATGPT_AUTH_ROOT: z.string().min(1).optional(),
  MODEL_MAX_CALLS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(100),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15000),
});

/** Never print Zod's input-bearing error details for environment configuration. */
export function appConfig(environment: NodeJS.ProcessEnv) {
  const result = schema.safeParse(environment);
  if (!result.success)
    throw new Error('Application settings are invalid; check variable names and bounds.');
  const config = result.data;
  if (config.INFERENCE_BROKER_HOSTPORT) {
    if (config.INFERENCE_BROKER_URL || config.INFERENCE_BROKER_ALLOW_PRIVATE_HTTP !== 'true')
      throw new Error(
        'Private broker hostport requires explicit private HTTP and cannot be combined with a URL.',
      );
    try {
      config.INFERENCE_BROKER_URL = new URL(`http://${config.INFERENCE_BROKER_HOSTPORT}`).href;
    } catch {
      throw new Error('Private broker hostport is invalid.');
    }
  }
  if (
    config.MODEL_PROVIDER === 'broker' &&
    (!config.INFERENCE_BROKER_URL || !config.INFERENCE_BROKER_TOKEN)
  )
    throw new Error(
      'Broker mode requires INFERENCE_BROKER_URL and a dedicated INFERENCE_BROKER_TOKEN.',
    );
  if (
    config.MODEL_PROVIDER === 'broker' &&
    Object.entries(environment).some(
      ([key, value]) =>
        value &&
        (/^(CHATGPT_|OPENAI_)/.test(key) ||
          /^MODEL_.*(?:KEY|TOKEN|SECRET)$/.test(key) ||
          [
            'CLOUDFLARE_API_TOKEN',
            'CF_API_TOKEN',
            'VERCEL_TOKEN',
            'RENDER_API_KEY',
            'GITHUB_TOKEN',
            'GH_TOKEN',
          ].includes(key)),
    )
  )
    throw new Error(
      'The world runtime must not receive provider credentials or ChatGPT profile settings in broker mode.',
    );
  if (config.MODEL_PROVIDER === 'chatgpt' && config.HOST !== '127.0.0.1')
    throw new Error(
      'ChatGPT plan mode currently requires the loopback owner runtime (HOST=127.0.0.1).',
    );
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
    if (config.MODEL_PROVIDER === 'chatgpt')
      throw new Error(
        'ChatGPT plan mode currently supports the local owner runtime. Review hosted eligibility and session transfer before deployment.',
      );
    if (config.MODEL_PROVIDER === 'broker' && config.HUBERT_OWNER_USER_ID === 'local-owner')
      throw new Error(
        'Hosted broker mode requires an explicit HUBERT_OWNER_USER_ID from the hosted Elsewhere account.',
      );
    if (
      config.MODEL_PROVIDER === 'broker' &&
      [
        environment.ADMIN_TOKEN,
        environment.BETTER_AUTH_SECRET,
        environment.API_PROXY_SECRET,
      ].includes(config.INFERENCE_BROKER_TOKEN)
    )
      throw new Error(
        'The inference service credential must be separate from world, auth and ingress secrets.',
      );
  }
  return {
    ...config,
    production: config.NODE_ENV === 'production',
    allowNewLife: config.ALLOW_NEW_LIFE === 'true',
  };
}
