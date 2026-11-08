/** Host-owned routing policy. Neither prompts nor model output may alter these records. */
export const WORKLOADS = [
  'decision',
  'classification',
  'summary',
  'reflection',
  'embedding',
  'vision',
  'code',
] as const;
export type ModelWorkload = (typeof WORKLOADS)[number];
export type ModelCapability = 'text' | 'json' | 'embedding' | 'vision' | 'code';
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
export interface ModelProfile {
  id: string;
  vendor: string;
  transport: 'compatible' | 'ollama';
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  local: boolean;
  capabilities: ModelCapability[];
  quality: number;
  contextTokens: number;
  maxOutputTokens: number;
  expectedLatencyMs: number;
  /** Operator-supplied rates, before credits. Input rate must cover cache-write premiums. */
  rates: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
  };
  /** none means no cache hint/affinity, not a provider retention guarantee. */
  promptCache: 'none' | 'automatic' | 'key' | 'cloudflare';
  gateway?: 'cloudflare';
}
export interface WorkloadPolicy {
  models: string[];
  strategy: 'economy' | 'latency' | 'quality';
  minimumQuality: number;
  maxLatencyMs: number;
  maxOutputTokens: number;
  maxRequestMicroUsd: number;
  /** Includes the initial attempt. Failover is explicit and still consumes allowance. */
  maxAttempts: number;
  affinityTolerancePercent: number;
}
export interface RoutingConfig {
  scope: { ownerId: string; worldId: string; characterId: string };
  allowRemote: boolean;
  dailyMicroUsd: number;
  profiles: ModelProfile[];
  policies: Partial<Record<ModelWorkload, WorkloadPolicy>>;
}
export interface ModelJob {
  workload: ModelWorkload;
  /** Complete model-visible input; immutable facts, instructions and tools all belong here. */
  input: unknown;
  prefix: string;
  promptVersion: string;
  validationVersion: string;
  privacy: 'local-only' | 'remote-allowed';
  /** Host-derived recipient/access partition, such as character-private or a visitor ID. */
  audience: string;
  /** Exact output reuse is opt-in and restricted to pure workloads. */
  cache?: { revision: string; ttlMs: number };
}
export interface AttemptEstimate {
  profileId: string;
  workload: ModelWorkload;
  maximumMicroUsd: number;
}
export interface ModelBudgetPort {
  /** Must durably save the reservation before returning its opaque identifier. */
  reserve(estimate: AttemptEstimate): Promise<string | null>;
  /** Missing/invalid usage keeps the whole reservation charged. Must be idempotent. */
  settle(id: string, usage: ModelUsage | undefined, failed: boolean): Promise<void>;
}
export interface ModelExecution {
  /** Frozen snapshot of the exact input used to select, reserve and key this job. */
  input: unknown;
  profile: Readonly<ModelProfile>;
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Opaque namespace, never raw prompts, names, visitor text or credential values. */
  promptCacheKey?: string;
  sessionAffinity?: string;
}
export interface ModelResult<T> {
  value: T;
  profileId: string;
  cacheHit: boolean;
}

export interface ModelCachePort {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** Preserve received usage even when transport parsing or result validation fails. */
export class ModelExecutionError extends Error {
  constructor(readonly usage?: ModelUsage) {
    super('Model execution failed.');
  }
}
