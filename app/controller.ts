import type { CharacterMailService } from '../packages/mail/src/service';
import { addCreation, publicCreations, setCreationPinned } from '../packages/creations/src/index';
import type { CreateCreationInput } from '../characters/interfaces/src/creations';
import {
  InvalidDecisionError,
  activePursuit,
  publicPursuits,
  recordPursuitEntry,
  recordPursuitReading,
} from '@elsewhere/character-runtime';
import { BrokerModelError } from '../packages/adapters/src/models/broker';
import { displayMemorySummary } from '../characters/hubert/src/memoryQuality';
import {
  validatePublicWish,
  type ExpressionProvider,
} from '../packages/adapters/src/models/expression';
import { randomUUID } from 'node:crypto';
import hubertAppearance from '../characters/hubert/appearance.json' with { type: 'json' };
import type {
  ProviderIssue,
  PublicCreation,
  PublicSnapshot,
  WorldState,
} from '@elsewhere/character-interfaces';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
  publicWorld,
  upgradeWorldLayout,
  RETIRED_FEATURE_IDS,
} from '@elsewhere/server';
import {
  advanceHubert,
  appendTrail,
  applyExternalEvent,
  applyNote,
  applyOutcome,
  applyPursue,
  applySetAside,
  isMindCommand,
  isMindType,
  chooseActionWithProvider,
  createInitialHubert,
  upgradeHubertState,
  publicCharacter,
  publicMemories,
  recalledMemory,
  wishDue,
  wishInput,
  recordWish,
  preserveWishLedger,
  publicWishes,
  resolveWish as resolveCharacterWish,
  type HubertState,
} from '@elsewhere/hubert';
import {
  abandonDreamConsolidation,
  beginDreamConsolidation,
  completeDreamConsolidation,
  pruneDreamState,
  type DecisionProvider,
  type JsonObject,
} from '@elsewhere/character-runtime';
import {
  hubertDreamActions,
  hubertDreamInterpretations,
  hubertDreamSources,
} from '../characters/hubert/src/dreams';
import { HUBERT_IDENTITY } from '../characters/hubert/src/persona';
import { hubertActivityDurationMs } from '../characters/hubert/src/pacing';
import {
  readableSources,
  RESEARCH_OFFERS_KEPT,
  RESEARCH_READ_IDS_KEPT,
} from '../characters/hubert/src/research';
import type { CharacterResearchPort } from '../characters/interfaces/src/research';
import type { CharacterCommand, Observation } from '../characters/interfaces/src/index';
import type { ReflectionProvider } from '../packages/adapters/src/models/reflection';
import {
  assertRoutingLedger,
  reserveRoutingBudget,
  settleRoutingBudget,
  type RoutingLedger,
} from '../packages/models/src/budget';
import type {
  AttemptEstimate,
  ModelBudgetPort,
  ModelProfile,
  ModelUsage,
  RoutingConfig,
} from '../packages/models/src/contracts';
import type { SnapshotStore } from '../packages/persistence/src/index';
import {
  authorizeCommand,
  reserveModelCall,
  type ModelAllowance,
} from '../packages/security/src/index';

interface WeatherSample {
  at: number;
  temperature: number;
  wind: number;
}
/** Longest wait between automatic attempts after failed provider requests, in decision intervals. */
const MAX_PROVIDER_BACKOFF = 16;
/** Longest stall, in real time, that the world clock makes up for instead of standing still. */
const CLOCK_CATCH_UP_MS = 90_000;
const MAX_CLOCK_ANCHORS = 200;
/** Refusals that stay refused until the owner repairs access; waiting alone does not clear them. */
const PROVIDER_REFUSALS: ReadonlySet<string> = new Set(['unauthorized', 'not_authorized']);

export interface ControllerState {
  schemaVersion: 2;
  world: WorldState;
  hubert: HubertState;
  runtime: {
    paused: boolean;
    tick: number;
    startedAt: number;
    simulatedAt: number;
    /** Where the world clock was last lined up with real time, oldest first. */
    clock?: { at: number; wall: number }[];
    lastDecisionAt: number;
    /** Earliest natural completion of the current activity, in simulated world time. */
    activityUntil?: number;
    modelStatus: string;
    providerIssues?: ProviderIssue[];
    providerRetryRequested?: boolean;
    invalidDecisionCount?: number;
    /** Consecutive well-formed proposals the world declined; these pace retries, never halt. */
    declinedDecisionCount?: number;
    /** Consecutive failed provider requests; each one waits longer before the next attempt. */
    providerFailureCount?: number;
    /** Wall-clock time of the next automatic attempt after provider trouble. */
    providerRetryAt?: number;
    providerWorkloadRetries?: Array<'reflection'>;
    /** Type of the last command carried out; mind steps are followed up without the usual wait. */
    lastCommandType?: CharacterCommand['type'];
    /** Continuous observed rest only; a restart or pause begins a new session. */
    dreamRest?: { id: string; startedAt: number; startedAtReal: number };
  };
  modelAllowance: ModelAllowance;
  modelRouting?: RoutingLedger;
  weatherSamples: WeatherSample[];
  creations?: PublicCreation[];
  artifactCreatedAt: number | null;
  artifactSamples?: WeatherSample[];
}
export interface ControllerOptions {
  mail?: CharacterMailService;
  now?: () => number;
  simulationStepMs?: number;
  decisionIntervalMs?: number;
  simulationRate?: number;
  /**
   * Keep the world clock in step with real time while the world runs, and record where each
   * pause or restart ended so clients can show world times as real ones. The world's own clock
   * never jumps over a gap: nothing ages while the world stands still.
   */
  realTimeClock?: boolean;
  modelMaximum?: number;
  /** Calls allowed in one UTC hour; unset means no hourly cap. */
  modelHourlyMaximum?: number;
  /** Keeps a saved life of a retired shape before a fresh one begins. Best effort. */
  archiveSnapshot?: (value: unknown, version: number) => void | Promise<void>;
  modelProvider?: DecisionProvider;
  reflectionProvider?: ReflectionProvider;
  expressionProvider?: ExpressionProvider;
  research?: CharacterResearchPort;
}

/** Character definitions supply their body dimensions; the shared world stays species-agnostic. */
function withResidentAppearance(world: WorldState): WorldState {
  const resident = world.residents.find((item) => item.id === 'hubert');
  if (!resident || resident.eyeHeight === hubertAppearance.eyeHeight) return world;
  const updated = structuredClone(world);
  updated.residents.find((item) => item.id === 'hubert')!.eyeHeight = hubertAppearance.eyeHeight;
  return updated;
}

function initialState(now: number): ControllerState {
  return {
    schemaVersion: 2,
    world: withResidentAppearance(createInitialWorld(now)),
    hubert: createInitialHubert(now),
    runtime: {
      paused: false,
      tick: 0,
      startedAt: now,
      simulatedAt: now,
      lastDecisionAt: now - 60_000,
      modelStatus: 'Waiting for model connection',
    },
    modelAllowance: {
      day: new Date(now).toISOString().slice(0, 10),
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    weatherSamples: [],
    artifactCreatedAt: null,
  };
}

/** One authoritative commit lane. Nothing in a character can mutate its policy or credentials. */
export class ElsewhereController {
  private version = 0;
  private state!: ControllerState;
  private lane: Promise<unknown> = Promise.resolve();
  private halted = false;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private lastCommitted: ControllerState | undefined;
  private modelDispatchActive = false;
  private readonly wallNow: () => number;
  /** True until the next tick lines the world clock up with real time again. */
  private clockStopped = true;
  constructor(
    private readonly store: SnapshotStore<ControllerState>,
    private readonly options: ControllerOptions = {},
  ) {
    this.wallNow = options.now ?? Date.now;
  }
  async init() {
    const saved = await this.store.load();
    if (saved && (saved.value as { schemaVersion?: unknown }).schemaVersion === 1) {
      // A life in the retired shape is archived, then a new one begins, as after a reset.
      const previous = saved.value as unknown as ControllerState;
      try {
        await this.options.archiveSnapshot?.(saved.value, saved.version);
      } catch {
        // Archiving is best effort; the new life does not depend on it.
      }
      this.version = saved.version;
      this.state = this.freshLife(previous, previous.runtime?.paused === true);
      await this.commit();
    } else if (saved) {
      if (
        saved.value.schemaVersion !== 2 ||
        saved.value.hubert?.id !== 'hubert' ||
        saved.value.world?.id !== 'elsewhere'
      )
        throw new Error('Unsupported persisted state. Back up .data before migrating it.');
      this.state = saved.value;
      if (this.state.modelRouting) assertRoutingLedger(this.state.modelRouting);
      this.version = saved.version;
      this.lastCommitted = structuredClone(saved.value);
      const upgraded = withResidentAppearance(upgradeWorldLayout(this.state.world));
      const upgradedHubert = upgradeHubertState(this.state.hubert);
      if (upgradedHubert.research.pending) {
        delete upgradedHubert.research.pending;
        upgradedHubert.intent =
          'An interrupted research request has been left for later. Its allowance remains charged.';
      }
      // Never resume an in-flight creative call or count offline time as observed rest.
      upgradedHubert.dreams = abandonDreamConsolidation(upgradedHubert.dreams);
      const interruptedRest = this.state.runtime.dreamRest !== undefined;
      delete this.state.runtime.dreamRest;
      const freezeArtifact =
        this.state.artifactCreatedAt != null && this.state.artifactSamples === undefined;
      const changed =
        JSON.stringify(upgraded) !== JSON.stringify(this.state.world) ||
        JSON.stringify(upgradedHubert) !== JSON.stringify(this.state.hubert) ||
        freezeArtifact ||
        interruptedRest;
      this.state.world = upgraded;
      this.state.hubert = preserveWishLedger(upgradedHubert, upgradedHubert);
      // A world upgrade may retire an object; the resident cannot go on choosing it.
      for (const id of RETIRED_FEATURE_IDS) delete this.state.hubert.knownObjects[id];
      if (freezeArtifact) this.state.artifactSamples = structuredClone(this.state.weatherSamples);
      if (changed) await this.commit();
    } else {
      this.state = initialState(this.wallNow());
      await this.commit();
    }
    return this;
  }
  private async commit() {
    try {
      this.version = await this.store.save(this.state, this.version);
      this.lastCommitted = structuredClone(this.state);
    } catch (error) {
      this.halted = true;
      if (this.lastCommitted) this.state = structuredClone(this.lastCommitted);
      throw error;
    }
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Controller is closing or closed.'));
    const next = this.lane.then(() => {
      if (this.halted)
        throw new Error(
          'Controller halted after a persistence failure. Check storage and restart.',
        );
      return operation();
    });
    this.lane = next.catch(() => undefined);
    return next;
  }
  getSnapshot(): PublicSnapshot {
    const s = this.lastCommitted;
    if (!s) throw new Error('Controller has no committed state.');
    return structuredClone({
      world: {
        ...publicWorld(s.world),
        events: s.world.events.map((event) => ({
          ...event,
          message: displayMemorySummary(event.message),
        })),
      },
      character: publicCharacter(s.hubert),
      pursuits: publicPursuits(s.hubert.pursuits),
      trail: s.hubert.trail.slice(-120).map((entry) => ({ ...entry })),
      ...(this.options.mail?.getPublic(s.hubert.id)
        ? { mail: this.options.mail.getPublic(s.hubert.id)! }
        : {}),
      creations: publicCreations(s.creations ?? [], s.hubert.id),
      events: s.world.events
        .slice(-35)
        .map((event) => ({ ...event, message: displayMemorySummary(event.message) })),
      memories: publicMemories(s.hubert),
      recalledMemory: recalledMemory(s.hubert, s.runtime.simulatedAt),
      wishes: publicWishes(s.hubert),
      artifacts: [], // Legacy prototype downloads remain available by their original URL.
      runtime: {
        mode:
          this.options.modelProvider?.id === 'ollama'
            ? 'ollama'
            : this.options.modelProvider
              ? 'compatible'
              : 'local',
        paused: s.runtime.paused || this.halted,
        tick: s.runtime.tick,
        startedAt: s.runtime.startedAt,
        simulatedAt: s.runtime.simulatedAt,
        ...(s.runtime.clock ? { clock: s.runtime.clock.map((anchor) => ({ ...anchor })) } : {}),
        costUsd: 0,
        costKnown: [
          this.options.modelProvider,
          this.options.reflectionProvider,
          this.options.expressionProvider,
        ].every((provider) => !provider || provider.id === 'ollama' || provider.localOnly === true),
        modelCalls: s.modelAllowance.calls,
        modelStatus: this.halted
          ? 'Controller halted after a persistence failure. Check storage and restart.'
          : s.runtime.modelStatus,
        simulationRate: this.options.simulationRate ?? 3,
      },
    });
  }
  addUsage(input: number, output: number) {
    this.state.modelAllowance.inputTokens += input;
    this.state.modelAllowance.outputTokens += output;
  }
  /** Only an owned, serialized decision can reserve spending; never exposed as an HTTP tool. */
  modelBudget(config: RoutingConfig): ModelBudgetPort {
    const dailyMaximum = config.dailyMicroUsd;
    const profiles = new Map(
      config.profiles.map((profile) => [profile.id, structuredClone(profile)]),
    );
    const assertActive = () => {
      if (!this.modelDispatchActive || this.halted || this.closing)
        throw new Error('No active owned model dispatch.');
    };
    return {
      reserve: async (estimate: AttemptEstimate) => {
        assertActive();
        if (!profiles.has(estimate.profileId))
          throw new Error('Unknown model reservation profile.');
        const reservation = this.reserveCall(this.wallNow());
        if (!('allowance' in reservation)) return null;
        const allowance = reservation.allowance;
        const id = randomUUID();
        const ledger = reserveRoutingBudget(
          this.state.modelRouting,
          estimate,
          dailyMaximum,
          this.wallNow(),
          id,
        );
        if (!ledger) return null;
        this.state.modelAllowance = allowance;
        this.state.modelRouting = ledger;
        await this.commit();
        return id;
      },
      settle: async (id: string, usage: ModelUsage | undefined, failed: boolean) => {
        // Already accepted requests may settle during graceful shutdown.
        if (!this.modelDispatchActive || this.halted)
          throw new Error('No active owned model settlement.');
        const receipt = this.state.modelRouting?.receipts.find((item) => item.id === id);
        const profile: ModelProfile | undefined = receipt && profiles.get(receipt.profileId);
        if (!receipt || !profile) throw new Error('Model reservation is unavailable.');
        const pending = receipt.status === 'pending';
        this.state.modelRouting = settleRoutingBudget(
          this.state.modelRouting!,
          id,
          profile,
          usage,
          failed,
        );
        const completed = this.state.modelRouting.receipts.find((item) => item.id === id)!;
        if (pending && completed.usage)
          this.addUsage(completed.usage.inputTokens, completed.usage.outputTokens);
        await this.commit();
      },
    };
  }
  /**
   * One model call against the daily allowance and, when set, the hourly one. A refusal says
   * which cap stopped it: an hourly one passes by itself at the start of the next UTC hour.
   */
  private reserveCall(
    now: number,
    scale = 1,
  ): { allowance: ModelAllowance } | { refused: 'daily' | 'hourly' } {
    const maximum = Math.floor((this.options.modelMaximum ?? 100) * scale);
    const allowance = reserveModelCall(
      this.state.modelAllowance,
      now,
      maximum,
      this.options.modelHourlyMaximum,
    );
    if (allowance) return { allowance };
    return {
      refused: reserveModelCall(this.state.modelAllowance, now, maximum) ? 'hourly' : 'daily',
    };
  }
  tick() {
    return this.serialize(async () => this.advance(false));
  }
  step() {
    return this.serialize(async () => this.advance(true));
  }
  getCharacterIssues(): ProviderIssue[] {
    return structuredClone(this.lastCommitted?.runtime.providerIssues ?? []);
  }
  retryCharacterProvider() {
    return this.serialize(async () => {
      this.options.modelProvider?.resetAvailability?.();
      this.options.expressionProvider?.resetAvailability?.();
      this.options.reflectionProvider?.resetAvailability?.();
      const active = (this.state.runtime.providerIssues ?? []).filter((issue) => !issue.resolvedAt);
      if (active.some((issue) => issue.workload === 'decision')) {
        this.state.runtime.invalidDecisionCount = 0;
        this.state.runtime.declinedDecisionCount = 0;
        this.state.runtime.providerFailureCount = 0;
        delete this.state.runtime.providerRetryAt;
        this.state.runtime.providerRetryRequested = true;
        this.state.runtime.lastDecisionAt = -1;
        delete this.state.runtime.activityUntil;
      }
      this.state.runtime.providerWorkloadRetries = active.flatMap((issue) =>
        issue.workload && issue.workload !== 'decision' ? [issue.workload] : [],
      );
      if (active.some((issue) => issue.workload === 'reflection'))
        delete this.state.runtime.dreamRest;
      await this.commit();
      return { accepted: true };
    });
  }
  /** The character's own notes, newest last. Public text it wrote itself. */
  private publicNotes(): Array<{ id: string; text: string }> {
    return this.state.hubert.pursuits.items
      .flatMap((pursuit) => pursuit.entries)
      .flatMap((entry) =>
        entry.kind === 'note' ? [{ id: entry.id, at: entry.at, text: entry.text }] : [],
      )
      .sort((a, b) => a.at - b.at)
      .slice(-16);
  }
  private async mailPlanningContext(): Promise<JsonObject> {
    if (!this.options.mail) return { available: false };
    try {
      return {
        ...(await this.options.mail.getPlanning(this.state.hubert.id)),
        publicEntries: this.publicNotes().map(({ id, text }) => ({ id, text })),
      } as JsonObject;
    } catch {
      // Optional correspondence cannot turn a recipient lookup outage into a model failure.
      return { available: false };
    }
  }
  private reportProviderIssue(
    kind: ProviderIssue['kind'],
    workload: NonNullable<ProviderIssue['workload']> = 'decision',
    detail?: Pick<ProviderIssue, 'code' | 'fields' | 'retrying'>,
  ) {
    const issues = (this.state.runtime.providerIssues ??= []);
    const now = this.wallNow();
    const name = publicCharacter(this.state.hubert).name;
    // Trouble with the provider itself passes without the owner; the notice says so plainly
    // rather than reading like a reply the model got wrong.
    const waiting = detail?.retrying === true && kind !== 'invalid';
    const messages = {
      unconfigured: 'No model provider is connected. Connect a provider before retrying.',
      unavailable: waiting
        ? `The model provider is not available right now. ${name} will try again automatically. If this continues, check the connection or sign-in.`
        : 'The model provider is unavailable. Check the connection or sign-in, then retry.',
      failed: waiting
        ? `A request to the model provider failed. ${name} will try again automatically, waiting longer after each failure.`
        : 'The provider request failed or returned an invalid response. Check the provider, then retry.',
      allowance: waiting
        ? `The daily model allowance has been reached. ${name} will continue when it resets.`
        : 'The daily model allowance has been reached. Retry after the allowance resets.',
      invalid: detail?.retrying
        ? `The model replied, but its proposed action could not be used. ${name} will reconsider on a following turn.`
        : 'Three consecutive model replies could not be used. No replacement actions were chosen. Review the action feedback, then retry.',
    };
    const existing = issues.find((issue) => issue.workload === workload && !issue.resolvedAt);
    if (existing) Object.assign(existing, { kind, lastAt: now, message: messages[kind] });
    else
      issues.push({
        id: randomUUID(),
        characterId: this.state.hubert.id,
        workload,
        kind,
        since: now,
        lastAt: now,
        message: messages[kind],
      });
    this.state.runtime.providerIssues = issues.slice(-12);
    const current = this.state.runtime.providerIssues.find(
      (issue) => issue.workload === workload && !issue.resolvedAt,
    );
    if (current) {
      delete current.code;
      delete current.fields;
      delete current.retrying;
      if (detail) Object.assign(current, detail);
    }
    if (workload === 'decision') {
      if (detail?.retrying && !waiting) {
        this.state.runtime.modelStatus = 'Model replied; reconsidering an unusable action';
        this.state.hubert.activity = {
          kind: 'reconsidering',
          label: 'Considering another approach',
          startedAt: this.state.runtime.simulatedAt,
        };
        return;
      }
      this.state.runtime.modelStatus = waiting
        ? 'Model provider unavailable; trying again automatically'
        : `${name} is currently unavailable`;
      const activity = this.state.hubert.activity;
      this.state.hubert.activity = {
        kind: 'unavailable',
        label: 'Currently unavailable',
        // Repeated checks during one outage are one continuous absence.
        startedAt:
          activity.kind === 'unavailable' ? activity.startedAt : this.state.runtime.simulatedAt,
      };
    }
  }
  /**
   * Provider trouble passes without the owner: wait, then try again on a later turn. A failed
   * request may have been charged, so consecutive failures wait progressively longer. An
   * unavailable provider or an exhausted allowance is only a free local check each interval.
   */
  private awaitProvider(kind: 'unavailable' | 'failed' | 'allowance', code?: string) {
    const failures = this.state.runtime.providerFailureCount ?? 0;
    const intervals =
      kind === 'failed' ? Math.min(2 ** Math.max(0, failures - 1), MAX_PROVIDER_BACKOFF) : 1;
    this.state.runtime.providerRetryAt =
      this.wallNow() + (this.options.decisionIntervalMs ?? 90_000) * intervals;
    // A provider that stays away after a failed request keeps the reason it gave.
    const previous = this.state.runtime.providerIssues?.find(
      (issue) => issue.workload === 'decision' && !issue.resolvedAt,
    );
    const reason =
      code ??
      (kind === 'unavailable' && (previous?.kind === 'failed' || previous?.kind === 'unavailable')
        ? previous.code
        : undefined);
    // Refused access is still rechecked for free, but the owner is told it needs repairing.
    const passes = !reason || !PROVIDER_REFUSALS.has(reason);
    this.reportProviderIssue(kind, 'decision', {
      ...(reason ? { code: reason } : {}),
      ...(passes ? { retrying: true } : {}),
    });
  }
  private resolveProviderIssue(workload: NonNullable<ProviderIssue['workload']>) {
    for (const issue of this.state.runtime.providerIssues ?? [])
      if (issue.workload === workload && !issue.resolvedAt) issue.resolvedAt = this.wallNow();
  }
  private async dreamDuringRest() {
    const s = this.state;
    const nowReal = this.wallNow();
    if (s.hubert.activity.kind !== 'rest' || !this.options.reflectionProvider) {
      delete s.runtime.dreamRest;
      return;
    }
    const rest = (s.runtime.dreamRest ??= {
      id: `rest:${nowReal}:${s.hubert.turn}`,
      startedAt: s.runtime.simulatedAt,
      startedAtReal: nowReal,
    });
    if (
      s.runtime.providerIssues?.some(
        (issue) => issue.workload === 'reflection' && !issue.resolvedAt,
      ) &&
      !s.runtime.providerWorkloadRetries?.includes('reflection')
    )
      return;
    const sources = hubertDreamSources(s.hubert);
    const begin = beginDreamConsolidation({
      state: s.hubert.dreams,
      sources,
      rest: { ...rest, voluntary: true, endedAt: s.runtime.simulatedAt, endedAtReal: nowReal },
      nowReal,
    });
    s.hubert.dreams = begin.state;
    if (!begin.request) return;
    // Reserve the rest/source window before any inference. A crash abandons this opportunity.
    await this.commit();
    const observation = observeWorld(s.world, 'hubert', s.runtime.simulatedAt);
    const actions = hubertDreamActions(s.hubert, observation, nowReal, begin.request.sources);
    s.runtime.providerWorkloadRetries = s.runtime.providerWorkloadRetries?.filter(
      (workload) => workload !== 'reflection',
    );
    let proposal;
    const provider = this.options.reflectionProvider;
    if (provider && provider.isAvailable?.() !== false) {
      const managed = provider.managesAllowance === true;
      const reservation = this.reserveCall(nowReal);
      const allowance = managed
        ? s.modelAllowance
        : 'allowance' in reservation
          ? reservation.allowance
          : undefined;
      if (allowance) {
        s.modelAllowance = allowance;
        if (!managed) await this.commit();
        this.modelDispatchActive = true;
        try {
          proposal = await provider.reflect({
            identity: HUBERT_IDENTITY,
            episodes: begin.request.sources.map(({ id, summary }) => ({ id, summary })),
            affordances: actions.map(({ id, description }) => ({ id, description })),
          });
          this.resolveProviderIssue('reflection');
        } catch {
          if (this.halted) throw new Error('Dream dispatch stopped after a persistence failure.');
          this.reportProviderIssue('failed', 'reflection');
        } finally {
          this.modelDispatchActive = false;
        }
      } else if (!('refused' in reservation) || reservation.refused === 'daily')
        this.reportProviderIssue('allowance', 'reflection');
      // An hourly pause is not trouble; the dream is simply not begun this hour.
    } else this.reportProviderIssue('unavailable', 'reflection');
    if (!proposal) {
      s.hubert.dreams = abandonDreamConsolidation(s.hubert.dreams);
      await this.commit();
      return;
    }
    const completed = completeDreamConsolidation({
      state: s.hubert.dreams,
      requestKey: begin.request.idempotencyKey,
      currentSources: hubertDreamSources(s.hubert),
      proposal,
      nowReal: this.wallNow(),
      availableActions: actions,
      interpretations: hubertDreamInterpretations(begin.request.sources),
    });
    s.hubert.dreams = completed.state;
    if (completed.receipt) s.hubert.activity.label = 'Dreaming quietly';
    // One snapshot atomically publishes all private derived records; none enter world events.
    await this.commit();
  }
  /**
   * The world clock is the world's own: it stands still while the world is paused or its
   * process is away, so nothing ages across a gap. While the world runs it keeps pace with real
   * time, and each time it starts moving again the moment is recorded, so that a client can
   * show any world time as the real time it happened.
   */
  private nextWorldTime(force: boolean): number {
    const runtime = this.state.runtime;
    const step = this.options.simulationStepMs ?? 6_000;
    if (force) {
      this.clockStopped = true;
      return runtime.simulatedAt + 30_000;
    }
    if (!this.options.realTimeClock) return runtime.simulatedAt + step;
    const rate = this.options.simulationRate ?? 3;
    const wall = this.wallNow();
    const anchor = runtime.clock?.at(-1);
    // How far the clock is behind where it would stand had every tick since then run on time.
    const lag = anchor
      ? Math.round(anchor.at + (wall - anchor.wall) * rate - runtime.simulatedAt)
      : 0;
    if (!anchor || this.clockStopped || Math.abs(lag) > CLOCK_CATCH_UP_MS * rate) {
      const now = runtime.simulatedAt + step;
      runtime.clock = [...(runtime.clock ?? []), { at: now, wall }].slice(-MAX_CLOCK_ANCHORS);
      this.clockStopped = false;
      return now;
    }
    // Ticks missed while a model request was awaited are made up, so the clock does not drift.
    return runtime.simulatedAt + Math.max(step, lag);
  }
  private async advance(force: boolean): Promise<PublicSnapshot> {
    if (this.state.runtime.paused && !force) return this.getSnapshot();
    const s = this.state;
    const now = this.nextWorldTime(force);
    s.runtime.simulatedAt = now;
    s.runtime.tick++;
    s.world = advanceWorld(s.world, now);
    s.hubert = advanceHubert(s.hubert, now);
    await this.dreamDuringRest();
    const resident = s.world.residents.find((r) => r.id === 'hubert');
    const ready =
      resident &&
      !resident.path.length &&
      (force ||
        (now >= (s.runtime.activityUntil ?? 0) &&
          // A step of the mind is followed up at once; a step in the world waits as usual.
          ((s.runtime.lastCommandType !== undefined && isMindType(s.runtime.lastCommandType)) ||
            now - s.runtime.lastDecisionAt >= (this.options.decisionIntervalMs ?? 90_000))));
    if (ready) {
      const observation = observeWorld(s.world, 'hubert', now);
      // Only a missing provider or repeatedly unreadable replies wait for the owner. Failed
      // requests, outages and an exhausted allowance pass by themselves, so they only delay the
      // next attempt. Judging by kind also releases failures stored by releases that stopped.
      const blocked = s.runtime.providerIssues?.some(
        (issue) =>
          issue.workload === 'decision' &&
          !issue.resolvedAt &&
          (issue.kind === 'unconfigured' || (issue.kind === 'invalid' && !issue.retrying)),
      );
      const wait = (s.runtime.providerRetryAt ?? 0) - this.wallNow();
      // A wait beyond the longest one ever scheduled means the clock moved; do not honour it.
      const waiting =
        wait > 0 && wait <= (this.options.decisionIntervalMs ?? 90_000) * MAX_PROVIDER_BACKOFF;
      if ((blocked || waiting) && !s.runtime.providerRetryRequested) {
        await this.commit();
        return this.getSnapshot();
      }
      delete s.runtime.providerRetryRequested;
      delete s.runtime.providerRetryAt;
      let decision;
      const provider = this.options.modelProvider;
      if (!provider) this.reportProviderIssue('unconfigured');
      else if (provider.isAvailable?.() === false) this.awaitProvider('unavailable');
      else {
        const managed = provider.managesAllowance === true;
        const reservation = this.reserveCall(this.wallNow());
        if ('refused' in reservation && reservation.refused === 'hourly') {
          // The hourly cap passes by itself at the start of the next UTC hour: nothing to report.
          await this.commit();
          return this.getSnapshot();
        }
        const mailContext = await this.mailPlanningContext();
        const allowance = managed
          ? s.modelAllowance
          : 'allowance' in reservation
            ? reservation.allowance
            : undefined;
        if (!allowance) this.awaitProvider('allowance');
        else {
          s.modelAllowance = allowance;
          if (!managed) await this.commit();
          this.modelDispatchActive = true;
          try {
            decision = await chooseActionWithProvider(
              s.hubert,
              observation,
              now,
              provider,
              this.wallNow(),
              Boolean(this.options.research),
              s.creations ?? [],
              mailContext,
            );
            this.resolveProviderIssue('decision');
            s.runtime.invalidDecisionCount = 0;
            s.runtime.declinedDecisionCount = 0;
            s.runtime.providerFailureCount = 0;
            delete decision.state.lastDecisionProblem;
            s.runtime.modelStatus = 'Model connected';
          } catch (error) {
            if (this.halted) throw new Error('Model dispatch stopped after a persistence failure.');
            if (error instanceof InvalidDecisionError) {
              // A well-formed proposal the world declines is ordinary feedback from a working
              // model. Only replies that cannot be read at all count towards stopping.
              const declined =
                error.code === 'unavailable_action'
                  ? (s.runtime.declinedDecisionCount ?? 0) + 1
                  : 0;
              const count = declined ? 0 : (s.runtime.invalidDecisionCount ?? 0) + 1;
              s.runtime.invalidDecisionCount = count;
              s.runtime.declinedDecisionCount = declined;
              // Any reply at all means the provider itself is working.
              s.runtime.providerFailureCount = 0;
              s.hubert.lastDecisionProblem = {
                at: now,
                code: error.code,
                message: error.message,
                fields: [...error.fields],
              };
              if (error.command) {
                s.hubert.lastOutcome = {
                  id: randomUUID(),
                  at: now,
                  action: error.command.type,
                  status: 'rejected',
                  ...('targetId' in error.command ? { targetId: error.command.targetId } : {}),
                  summary: error.message,
                };
                s.hubert.lastProposal = {
                  at: now,
                  type: error.command.type,
                  ...('targetId' in error.command ? { targetId: error.command.targetId } : {}),
                  adjustment: error.message,
                };
              }
              s.runtime.lastDecisionAt = now;
              delete s.runtime.lastCommandType;
              // Repeated declines wait progressively longer (at most eight intervals) rather
              // than spending a call every turn or leaving the character stopped for its owner.
              s.runtime.activityUntil =
                now +
                (this.options.decisionIntervalMs ?? 90_000) *
                  Math.min(2 ** Math.max(0, declined - 1), 8);
              this.reportProviderIssue('invalid', 'decision', {
                code: error.code,
                fields: [...error.fields],
                retrying: count < 3,
              });
            } else {
              s.runtime.providerFailureCount = (s.runtime.providerFailureCount ?? 0) + 1;
              const code =
                error instanceof BrokerModelError
                  ? (error.diagnostic?.providerCode ?? error.code)
                  : 'decision_error';
              this.awaitProvider(PROVIDER_REFUSALS.has(code) ? 'unavailable' : 'failed', code);
            }
          } finally {
            this.modelDispatchActive = false;
          }
        }
      }
      if (!decision) {
        await this.commit();
        return this.getSnapshot();
      }
      s.hubert = decision.state;
      const policy = authorizeCommand(decision.action);
      delete s.runtime.activityUntil;
      if (policy.allowed) {
        s.runtime.lastCommandType = policy.command.type;
        // A reading only exists once the world answers, so `use` is recorded with its outcome.
        if (!isMindCommand(policy.command) && policy.command.type !== 'use')
          this.recordTrail(policy.command, decision.why, observation.placeId, now);
        if (policy.command.type === 'draft_mail') {
          const command = policy.command;
          try {
            const notes = this.publicNotes();
            const entries = [...new Set(command.entryIds)].map((id) =>
              notes.find((entry) => entry.id === id),
            );
            if (!this.options.mail || entries.some((entry) => !entry))
              throw Error('Mail sources unavailable.');
            const name = publicCharacter(s.hubert).name;
            const draft = await this.options.mail.compose(
              s.hubert.id,
              {
                kind: command.kind,
                ...(command.recipientUserId ? { recipientUserId: command.recipientUserId } : {}),
                subject:
                  command.kind === 'newsletter' ? `${name}’s field notes` : `A note from ${name}`,
                text: entries.map((entry) => entry!.text).join('\n\n'),
              },
              'character',
            );
            s.hubert.lastOutcome = {
              id: draft.id,
              at: now,
              action: command.type,
              status: 'completed',
              summary:
                draft.status === 'awaiting_approval'
                  ? 'A letter draft is awaiting owner review. No delivery has been claimed.'
                  : 'A letter draft was recorded for distribution. Delivery status is tracked separately.',
            };
            s.hubert.activity = { kind: command.type, label: 'Writing a letter', startedAt: now };
          } catch {
            s.hubert.lastOutcome = {
              id: randomUUID(),
              at: now,
              action: command.type,
              status: 'rejected',
              summary:
                'The letter could not be drafted. Check available public entries, contact consent and mail connection.',
            };
          }
          s.runtime.activityUntil = now + 120_000;
        } else if (policy.command.type === 'pin_creation') {
          const command = policy.command;
          try {
            const before = s.creations?.find(
              (creation) =>
                creation.id === command.creationId && creation.characterId === s.hubert.id,
            );
            s.creations = setCreationPinned(
              s.creations ?? [],
              s.hubert.id,
              command.creationId,
              command.pinned,
              now,
            );
            s.hubert.lastOutcome = {
              id: randomUUID(),
              at: now,
              action: command.type,
              status: 'completed',
              summary: command.pinned
                ? 'Pinned a recorded creation link.'
                : 'Unpinned a recorded creation link.',
            };
            s.hubert.activity = { kind: command.type, label: 'Curating creations', startedAt: now };
            if (before && (before.pinnedAt !== undefined) !== command.pinned) {
              s.world.events.push({
                id: s.hubert.lastOutcome.id,
                at: now,
                type: command.pinned ? 'creation_pinned' : 'creation_unpinned',
                characterId: s.hubert.id,
                message: `${publicCharacter(s.hubert).name} ${command.pinned ? 'pinned' : 'unpinned'} “${before.title}” on the Creations shelf.`,
              });
              s.world.events = s.world.events.slice(-100);
              s.world.version++;
            }
          } catch {
            s.hubert.lastOutcome = {
              id: randomUUID(),
              at: now,
              action: command.type,
              status: 'rejected',
              summary: 'That creation is unavailable or the pin limit was reached.',
            };
          }
          s.runtime.activityUntil = now + 90_000;
        } else if (isMindCommand(policy.command)) {
          await this.mindStep(policy.command, decision.why, observation, now);
        } else {
          const result = executeWorldCommand(s.world, 'hubert', policy.command, now);
          s.world = result.world;
          const duration = hubertActivityDurationMs(policy.command, s.hubert.stats.energy);
          if (result.outcome.status !== 'rejected' && duration > 0)
            s.runtime.activityUntil = now + duration;
          if (policy.command.type === 'use')
            this.recordTrail(policy.command, decision.why, observation.placeId, now, {
              text:
                result.outcome.status === 'completed' && result.outcome.evidence
                  ? result.outcome.evidence
                  : result.outcome.summary,
            });
          s.hubert = applyOutcome(
            s.hubert,
            result.outcome,
            observeWorld(s.world, 'hubert', now),
            now,
            this.wallNow(),
          );
        }
      } else {
        delete s.runtime.lastCommandType;
        s.hubert.intent = policy.reason;
        // Denied operations never reach an executor and never receive a success reward.
      }
      s.runtime.lastDecisionAt = now;
    }
    await this.commit();
    await this.makeWish();
    return this.getSnapshot();
  }
  /**
   * Now and then the resident is given the chance to say what they wish for. The words are
   * theirs, authored from the public snapshot alone; an empty answer is no wish.
   * A wish installs nothing and reaches no one but the owner's wish list.
   */
  private async makeWish() {
    const provider = this.options.expressionProvider;
    if (!provider || this.halted || this.state.runtime.paused) return;
    if (provider.isAvailable?.() === false) return;
    const now = this.wallNow();
    if (!wishDue(this.state.hubert, now)) return;
    const snapshot = this.getSnapshot();
    if (snapshot.character.status === 'resting') return;
    // Wishes never spend the last fifth of the day's calls.
    const reservation = this.reserveCall(now, 0.8);
    if (!('allowance' in reservation)) return;
    this.state.modelAllowance = reservation.allowance;
    this.state.hubert.wishesAskedAtReal = now;
    await this.commit(); // One durable request reservation; an abandoned wish is never replayed.
    this.modelDispatchActive = true;
    try {
      const text = validatePublicWish(await provider.express(wishInput(snapshot)));
      if (text)
        this.state.hubert = recordWish(
          this.state.hubert,
          { id: 'wish-' + randomUUID(), text },
          now,
        );
    } catch {
      if (this.halted) throw Error('Wish stopped after persistence failure.');
      // A wish that fails or does not validate is simply not made; the next chance comes later.
    } finally {
      this.modelDispatchActive = false;
    }
    await this.commit();
  }
  /** One step on the public trail: what was done, why, on which pursuit and where. */
  private recordTrail(
    command: CharacterCommand,
    why: string,
    placeId: string,
    now: number,
    extra: { text?: string; url?: string } = {},
  ) {
    const pursuitId = this.state.hubert.pursuits.activeId;
    this.state.hubert = appendTrail(this.state.hubert, {
      id: 'trail-' + randomUUID(),
      at: now,
      kind: command.type,
      ...(why ? { why } : {}),
      ...(pursuitId ? { pursuitId } : {}),
      ...(extra.text ? { text: extra.text } : {}),
      ...(extra.url ? { url: extra.url } : {}),
      placeId,
    });
  }
  /** A step of the mind: it changes what the character follows, never the world. */
  private async mindStep(
    command: Extract<
      CharacterCommand,
      { type: 'pursue' | 'set_aside' | 'search' | 'read' | 'note' }
    >,
    why: string,
    observation: Observation,
    now: number,
  ) {
    const s = this.state;
    const outcome = (status: 'completed' | 'rejected', summary: string, label?: string) => {
      s.hubert.lastOutcome = {
        id: randomUUID(),
        at: now,
        action: command.type,
        status,
        summary,
      };
      s.hubert.intent = summary;
      if (label) s.hubert.activity = { kind: command.type, label, startedAt: now };
      s.runtime.activityUntil = now + hubertActivityDurationMs(command);
    };
    const trail = (text?: string, url?: string) =>
      this.recordTrail(command, why, observation.placeId, now, { text, url });
    try {
      if (command.type === 'pursue') {
        s.hubert = applyPursue(s.hubert, command, 'pursuit-' + randomUUID(), now);
        const opened = activePursuit(s.hubert.pursuits)!;
        outcome('completed', `Following a question: ${opened.question}`, 'Following a question');
        trail(opened.question);
      } else if (command.type === 'set_aside') {
        s.hubert = applySetAside(s.hubert, command, now);
        outcome('completed', 'Set a question aside.', 'Setting a question aside');
        trail(command.reason);
      } else if (command.type === 'note') {
        s.hubert = applyNote(s.hubert, command, 'note-' + randomUUID(), now);
        outcome('completed', 'Wrote a note.', 'Writing a note');
        trail(command.text);
      } else await this.researchStep(command, why, observation, now, outcome);
    } catch {
      if (this.halted) throw Error('Mind step stopped after persistence failure.');
      outcome('rejected', 'That step is no longer available.');
    }
  }
  /** Search and read reach an external service: the attempt is persisted before the call. */
  private async researchStep(
    command: Extract<CharacterCommand, { type: 'search' | 'read' }>,
    why: string,
    observation: Observation,
    now: number,
    outcome: (status: 'completed' | 'rejected', summary: string, label?: string) => void,
  ) {
    const s = this.state,
      port = this.options.research,
      at = this.wallNow();
    const active = activePursuit(s.hubert.pursuits);
    const source =
      command.type === 'read'
        ? readableSources(s.hubert, at).find((offer) => offer.sourceId === command.sourceId)
        : undefined;
    if (!port || !active || (command.type === 'read' && !source)) {
      outcome('rejected', 'Web research is unavailable, or that source is no longer offered.');
      return;
    }
    const id = 'research-' + randomUUID();
    const research = s.hubert.research;
    research.pending = { id, kind: command.type };
    await this.commit();
    const trail = (text?: string, url?: string) =>
      this.recordTrail(command, why, observation.placeId, now, { text, url });
    try {
      if (command.type === 'search') {
        const result = await port.search({ requestId: id, query: command.query });
        const fresh = new Set(result.sources.map((item) => item.id));
        research.offers = [
          ...research.offers.filter(
            (offer) => !(offer.pursuitId === active.id && fresh.has(offer.sourceId)),
          ),
          ...result.sources.map((item) => ({
            pursuitId: active.id,
            sourceId: item.id,
            url: item.url,
            title: item.title,
            snippet: item.snippet,
            fetchedAt: result.fetchedAt,
          })),
        ].slice(-RESEARCH_OFFERS_KEPT);
        s.hubert.pursuits = recordPursuitEntry(
          s.hubert.pursuits,
          active.id,
          {
            kind: 'search',
            id: result.receiptId,
            at: now,
            query: result.query,
            sourceCount: result.sources.length,
          },
          now,
        );
        s.hubert.stats.energy = Math.max(0, s.hubert.stats.energy - 1);
        outcome(
          'completed',
          result.sources.length
            ? 'I have found web sources I can choose to read.'
            : 'The search returned no sources.',
          'Searching the web',
        );
        trail(command.query);
      } else {
        const result = await port.read({ requestId: id, sourceId: source!.sourceId });
        s.hubert.pursuits = recordPursuitReading(s.hubert.pursuits, {
          sourceId: result.sourceId,
          url: result.url,
          title: result.title,
          text: result.excerpt,
          at: now,
        });
        s.hubert.pursuits = recordPursuitEntry(
          s.hubert.pursuits,
          active.id,
          {
            kind: 'read',
            id: result.receiptId,
            at: now,
            sourceId: result.sourceId,
            url: result.url,
            title: result.title,
          },
          now,
        );
        research.readIds = [...research.readIds, result.sourceId].slice(-RESEARCH_READ_IDS_KEPT);
        s.hubert.stats.energy = Math.max(0, s.hubert.stats.energy - 1);
        outcome(
          'completed',
          'I have read an external source; its claims remain separate from my lived experiences.',
          'Reading',
        );
        trail(result.title, result.url);
      }
    } catch {
      if (this.halted) throw Error('Research stopped after persistence failure.');
      // A failed source is not offered again; nothing else cools down.
      if (command.type === 'read')
        research.offers = research.offers.filter((offer) => offer.sourceId !== command.sourceId);
      outcome(
        'rejected',
        command.type === 'search'
          ? 'The web search failed. I can try again.'
          : 'That web source is unavailable. I can choose another.',
      );
      trail(command.type === 'search' ? command.query : undefined);
    } finally {
      delete s.hubert.research.pending;
    }
  }
  pause() {
    return this.serialize(async () => {
      this.state.runtime.paused = true;
      delete this.state.runtime.dreamRest;
      await this.commit();
      return this.getSnapshot();
    });
  }
  resume() {
    return this.serialize(async () => {
      this.state.runtime.paused = false;
      this.clockStopped = true;
      await this.commit();
      return this.getSnapshot();
    });
  }
  /**
   * A new life in a new world. Everything that is not the fictional life stays: the real call
   * allowance and routing ledger, creations, provider trouble, the wish ledger and dreams.
   */
  private freshLife(previous: ControllerState, paused: boolean): ControllerState {
    const fresh = initialState(this.wallNow());
    // Resetting a fictional life never replenishes real paid-call allowance.
    fresh.modelAllowance = structuredClone(previous.modelAllowance);
    fresh.creations = structuredClone(previous.creations);
    fresh.runtime.providerIssues = structuredClone(
      previous.runtime?.providerIssues?.filter(
        (issue) => (issue.workload as string | undefined) !== 'notebook',
      ),
    );
    fresh.runtime.invalidDecisionCount = previous.runtime?.invalidDecisionCount;
    fresh.runtime.declinedDecisionCount = previous.runtime?.declinedDecisionCount;
    // A fictional reset is no reason to ask a failing provider again any sooner.
    if (previous.runtime?.providerFailureCount)
      fresh.runtime.providerFailureCount = previous.runtime.providerFailureCount;
    if (previous.runtime?.providerRetryAt)
      fresh.runtime.providerRetryAt = previous.runtime.providerRetryAt;
    if (previous.modelRouting) fresh.modelRouting = structuredClone(previous.modelRouting);
    fresh.hubert = preserveWishLedger(fresh.hubert, previous.hubert);
    fresh.hubert.dreams = pruneDreamState(previous.hubert.dreams, []);
    fresh.world.version = Math.max(fresh.world.version, (previous.world?.version ?? 0) + 1);
    fresh.runtime.paused = paused;
    return fresh;
  }
  reset() {
    return this.serialize(async () => {
      this.state = this.freshLife(this.state, true);
      await this.commit();
      return this.getSnapshot();
    });
  }
  submitMessage(text: string, actor?: { userId: string; displayName: string }) {
    return this.serialize(async () => {
      // Identity comes from the verified server session, never the visitor's message body.
      const sourceId = actor ? 'user:' + actor.userId : 'visitor-guestbook';
      this.state.hubert = applyExternalEvent(
        this.state.hubert,
        { id: randomUUID(), sourceId, senderName: actor?.displayName, text },
        this.state.runtime.simulatedAt,
      );
      await this.commit();
      return { accepted: true };
    });
  }
  resolveWish(id: string, decision: 'fulfill' | 'decline') {
    return this.serialize(async () => {
      const wish = this.state.hubert.wishes?.find((item) => item.id === id);
      if (!wish || wish.status !== 'pending') throw new Error('This wish is not pending.');
      // The owner's word only: whatever was built reaches the world through its own update.
      this.state.hubert = resolveCharacterWish(
        this.state.hubert,
        { wishId: id, decision, receiptId: randomUUID() },
        this.wallNow(),
      );
      await this.commit();
      return this.getSnapshot();
    });
  }
  createCreation(input: CreateCreationInput) {
    return this.serialize(async () => {
      this.state.creations = addCreation(this.state.creations ?? [], input, {
        id: 'creation-' + randomUUID(),
        characterId: this.state.hubert.id,
        createdAt: this.state.runtime.simulatedAt,
        provenance: 'owner',
      });
      await this.commit();
      return { accepted: true };
    });
  }
  pinCreation(creationId: string, pinned: boolean) {
    return this.serialize(async () => {
      this.state.creations = setCreationPinned(
        this.state.creations ?? [],
        this.state.hubert.id,
        creationId,
        pinned,
        this.state.runtime.simulatedAt,
      );
      await this.commit();
      return { accepted: true };
    });
  }
  getArtifact(id: string): { contentType: string; body: string } | null {
    const s = this.lastCommitted;
    if (!s) throw new Error('Controller has no committed state.');
    if (id !== 'weather-study' || !s.artifactCreatedAt) return null;
    const points = s.artifactSamples ?? s.weatherSamples;
    const path = points
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${(50 + (i / Math.max(1, points.length - 1)) * 620).toFixed(1)},${(250 - (p.temperature - 14) * 20).toFixed(1)}`,
      )
      .join(' ');
    return {
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 340"><rect width="720" height="340" fill="#f6f2e9"/><text x="40" y="45" font-family="Georgia,serif" font-size="26" fill="#254a40">A small study of the weather</text><text x="40" y="73" font-family="sans-serif" font-size="13" fill="#52665b">Hubert · Elsewhere · local simulated observations</text><path d="M50 100V270H670" fill="none" stroke="#9eaa99"/><path d="${path}" fill="none" stroke="#477762" stroke-width="3"/><text x="50" y="306" font-family="sans-serif" font-size="12" fill="#52665b">${points.length} simulated temperature samples. This is not real-world weather data.</text></svg>`,
    };
  }
  /** Host shutdown drains accepted decisions before closing their external service ports. */
  async drain(): Promise<void> {
    await this.lane;
  }
  close(): Promise<void> {
    this.closing = true;
    this.closePromise ??= this.lane.then(() => this.store.close());
    return this.closePromise;
  }
}
