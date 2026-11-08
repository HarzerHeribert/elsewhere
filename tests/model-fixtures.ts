import type {
  ModelJob,
  ModelProfile,
  RoutingConfig,
  WorkloadPolicy,
} from '../packages/models/src/contracts';

export function modelProfile(
  id = 'cf-routine',
  overrides: Partial<ModelProfile> = {},
): ModelProfile {
  return {
    id,
    vendor: 'cloudflare',
    transport: 'compatible',
    baseUrl: 'https://models.example.invalid/v1',
    model: 'fixture-model',
    apiKeyEnv: 'MODEL_FIXTURE_KEY',
    local: false,
    capabilities: ['text', 'json'],
    quality: 2,
    contextTokens: 64_000,
    maxOutputTokens: 1000,
    expectedLatencyMs: 1000,
    rates: { inputUsdPerMillion: 1, outputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1 },
    promptCache: 'key',
    ...overrides,
  };
}
export function modelPolicy(overrides: Partial<WorkloadPolicy> = {}): WorkloadPolicy {
  return {
    models: ['cf-routine'],
    strategy: 'economy',
    minimumQuality: 2,
    maxLatencyMs: 20_000,
    maxOutputTokens: 160,
    maxRequestMicroUsd: 200_000,
    maxAttempts: 1,
    affinityTolerancePercent: 10,
    ...overrides,
  };
}
export function routingConfig(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return {
    scope: { ownerId: 'fixture-owner', worldId: 'elsewhere', characterId: 'hubert' },
    allowRemote: true,
    dailyMicroUsd: 1_000_000,
    profiles: [modelProfile()],
    policies: { decision: modelPolicy(), summary: modelPolicy() },
    ...overrides,
  };
}
export function modelJob(overrides: Partial<ModelJob> = {}): ModelJob {
  return {
    workload: 'decision',
    input: { observation: 'a bird' },
    prefix: 'Trusted fixed instructions.',
    promptVersion: 'v1',
    validationVersion: 'v1',
    privacy: 'remote-allowed',
    audience: 'character-private',
    ...overrides,
  };
}
