import { z } from 'zod';
import { WORKLOADS, type RoutingConfig } from './contracts';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const rate = z.number().finite().min(0).max(10_000);
const profile = z
  .object({
    id: identifier,
    vendor: identifier,
    transport: z.enum(['compatible', 'ollama']),
    baseUrl: z.string().url(),
    model: z.string().min(1).max(200),
    apiKeyEnv: z
      .string()
      .regex(/^MODEL_[A-Z0-9_]{1,74}$/)
      .optional(),
    local: z.boolean(),
    capabilities: z
      .array(z.enum(['text', 'json', 'embedding', 'vision', 'code']))
      .min(1)
      .max(5),
    quality: z.number().int().min(1).max(5),
    contextTokens: z.number().int().min(1024).max(2_000_000),
    maxOutputTokens: z.number().int().min(1).max(32_000),
    expectedLatencyMs: z.number().int().min(1).max(60_000),
    rates: z
      .object({
        inputUsdPerMillion: rate,
        outputUsdPerMillion: rate,
        cachedInputUsdPerMillion: rate,
      })
      .strict(),
    promptCache: z.enum(['none', 'automatic', 'key', 'cloudflare']),
    gateway: z.literal('cloudflare').optional(),
  })
  .strict();
const policy = z
  .object({
    models: z.array(identifier).min(1).max(16),
    strategy: z.enum(['economy', 'latency', 'quality']),
    minimumQuality: z.number().int().min(1).max(5),
    maxLatencyMs: z.number().int().min(1).max(60_000),
    maxOutputTokens: z.number().int().min(1).max(32_000),
    maxRequestMicroUsd: z.number().int().min(0).max(1_000_000_000),
    maxAttempts: z.number().int().min(1).max(2),
    affinityTolerancePercent: z.number().int().min(0).max(25),
  })
  .strict();
const schema = z
  .object({
    scope: z.object({ ownerId: identifier, worldId: identifier, characterId: identifier }).strict(),
    allowRemote: z.boolean(),
    dailyMicroUsd: z.number().int().min(0).max(1_000_000_000),
    profiles: z.array(profile).min(1).max(16),
    policies: z.partialRecord(z.enum(WORKLOADS), policy),
  })
  .strict();

export function parseRoutingConfig(input: unknown, production = false): RoutingConfig {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > 32_000) throw new Error('Model routing configuration is too large.');
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error('Model routing configuration is invalid JSON.');
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('Model routing configuration has invalid fields.');
  const config = parsed.data;
  const ids = new Set(config.profiles.map((item) => item.id));
  if (ids.size !== config.profiles.length) throw new Error('Model profile IDs must be unique.');
  for (const model of config.profiles) {
    const url = new URL(model.baseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    )
      throw new Error('Model routing endpoints require HTTPS without embedded secrets.');
    if (
      model.local !== loopback ||
      (model.transport === 'ollama' && !model.local) ||
      (production && model.local)
    )
      throw new Error('Model routing locality conflicts with deployment policy.');
    if (model.transport === 'compatible' && !model.apiKeyEnv)
      throw new Error('Compatible model profiles require a credential environment reference.');
    if (
      !model.local &&
      (!config.allowRemote ||
        model.rates.inputUsdPerMillion <= 0 ||
        (model.capabilities.some((capability) => capability !== 'embedding') &&
          model.rates.outputUsdPerMillion <= 0))
    )
      throw new Error(
        'Remote routing requires explicit permission and positive operator-supplied rates.',
      );
    if (model.rates.cachedInputUsdPerMillion > model.rates.inputUsdPerMillion)
      throw new Error('Cached input rate cannot exceed the conservative input rate.');
  }
  for (const route of Object.values(config.policies))
    if (
      route.models.some((id) => !ids.has(id)) ||
      new Set(route.models).size !== route.models.length
    )
      throw new Error('Workload policy references an unknown or duplicate model profile.');
  return config;
}
