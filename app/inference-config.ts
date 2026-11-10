import { isAbsolute, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  INFERENCE_DATA_ROOT: z.string().min(1),
  INFERENCE_BROKER_TOKEN: z.string().regex(/^[^\s\x00-\x1f\x7f]{32,512}$/),
  HUBERT_OWNER_USER_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
  ),
  CHATGPT_PROFILE: z
    .string()
    .regex(/^(?!host$)[a-z][a-z0-9-]{0,47}$/)
    .default('default'),
  MODEL_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,120}$/)
    .default('gpt-6-luna'),
  MODEL_MAX_CALLS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(20),
  MODEL_MAX_INPUT_TOKENS_PER_DAY: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(3_500_000),
  MODEL_MAX_OUTPUT_TOKENS_PER_DAY: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(100_000),
  MODEL_MAX_INPUT_TOKENS_PER_REQUEST: z.coerce.number().int().min(1).max(128_000).default(32_000),
  MODEL_OUTPUT_TOKEN_RESERVE: z.coerce.number().int().min(1).max(1_000_000).default(2_000),
  MODEL_MAX_UNKNOWN_USAGE_CALLS_PER_DAY: z.coerce.number().int().min(1).max(100).default(20),
  MODEL_REQUEST_BODY_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(5000),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
});

/** The private service has its own environment; it never loads a world .env file. */
export function inferenceConfig(environment: NodeJS.ProcessEnv) {
  const result = schema.safeParse(environment);
  if (!result.success) throw new Error('Private inference configuration is invalid.');
  const config = result.data;
  if (!isAbsolute(config.INFERENCE_DATA_ROOT))
    throw new Error('INFERENCE_DATA_ROOT must be an absolute protected persistent directory.');
  config.INFERENCE_DATA_ROOT = resolve(config.INFERENCE_DATA_ROOT);
  const ephemeral = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', tmpdir()].some(
    (path) =>
      config.INFERENCE_DATA_ROOT === resolve(path) ||
      config.INFERENCE_DATA_ROOT.startsWith(resolve(path) + sep),
  );
  if (
    config.NODE_ENV === 'production' &&
    (ephemeral || config.HUBERT_OWNER_USER_ID === 'local-owner')
  )
    throw new Error(
      'Hosted inference requires persistent storage and an explicit owner account ID.',
    );
  if (
    Object.entries(environment).some(
      ([key, value]) =>
        value &&
        (/^OPENAI_/.test(key) ||
          /^MODEL_.*(?:KEY|TOKEN|SECRET)$/.test(key) ||
          [
            'ADMIN_TOKEN',
            'BETTER_AUTH_SECRET',
            'API_PROXY_SECRET',
            'DATABASE_URL',
            'AUTH_DATABASE_URL',
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
      'World, auth, infrastructure and alternate provider credentials must not be installed in the inference service.',
    );
  return config;
}
