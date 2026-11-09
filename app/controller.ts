import { applyInterestChoice } from '../characters/hubert/src/interestChoices';
import { displayMemorySummary } from '../characters/hubert/src/memoryQuality';
import { notebookInput } from '../characters/hubert/src/notebook';
import {
  validatePublicExpression,
  type ExpressionProvider,
} from '../packages/adapters/src/models/expression';
import { randomUUID, createHash } from 'node:crypto';
import hubertAppearance from '../characters/hubert/appearance.json' with { type: 'json' };
import type { ProviderIssue, PublicSnapshot, WorldState } from '@elsewhere/character-interfaces';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
  publicWorld,
  upgradeWorldLayout,
  installWishFeature,
} from '@elsewhere/server';
import {
  advanceHubert,
  applyExternalEvent,
  applyOutcome,
  chooseActionWithProvider,
  createInitialHubert,
  upgradeHubertState,
  publicCharacter,
  publicMemories,
  recalledMemory,
  considerWish,
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
} from '@elsewhere/character-runtime';
import {
  hubertDreamActions,
  hubertDreamInterpretations,
  hubertDreamSources,
} from '../characters/hubert/src/dreams';
import { HUBERT_IDENTITY } from '../characters/hubert/src/persona';
import { hubertActivityDurationMs } from '../characters/hubert/src/pacing';
import {
  researchTargets,
  readableSources,
  rememberResearch,
  publicResearch,
  startResearchEpisode,
  deferResearchEpisode,
} from '../characters/hubert/src/research';
import { settleHubertAttention } from '../characters/hubert/src/attention';
import type { CharacterResearchPort } from '../characters/interfaces/src/research';
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
export interface ControllerState {
  schemaVersion: 1;
  world: WorldState;
  hubert: HubertState;
  runtime: {
    paused: boolean;
    tick: number;
    startedAt: number;
    simulatedAt: number;
    lastDecisionAt: number;
    /** Earliest natural completion of the current activity, in simulated world time. */
    activityUntil?: number;
    modelStatus: string;
    providerIssues?: ProviderIssue[];
    providerRetryRequested?: boolean;
    providerWorkloadRetries?: Array<'notebook' | 'reflection'>;
    /** Continuous observed rest only; a restart or pause begins a new session. */
    dreamRest?: { id: string; startedAt: number; startedAtReal: number };
  };
  modelAllowance: ModelAllowance;
  modelRouting?: RoutingLedger;
  weatherSamples: WeatherSample[];
  artifactCreatedAt: number | null;
  artifactSamples?: WeatherSample[];
}
export interface ControllerOptions {
  now?: () => number;
  simulationStepMs?: number;
  decisionIntervalMs?: number;
  simulationRate?: number;
  modelMaximum?: number;
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
    schemaVersion: 1,
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
  private publicDraft?: { id: string; at: number; text: string };
  private readonly wallNow: () => number;
  constructor(
    private readonly store: SnapshotStore<ControllerState>,
    private readonly options: ControllerOptions = {},
  ) {
    this.wallNow = options.now ?? Date.now;
  }
  async init() {
    const saved = await this.store.load();
    if (saved) {
      if (
        saved.value.schemaVersion !== 1 ||
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
      if (upgradedHubert.research?.pending) {
        deferResearchEpisode(upgradedHubert);
        delete upgradedHubert.research.pending;
        upgradedHubert.intent =
          'An interrupted research request has been deferred. Its allowance remains charged.';
      }
      if (upgradedHubert.notebook?.pending) delete upgradedHubert.notebook.pending;
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
      research: publicResearch(s.hubert),
      notebook: {
        enabled: Boolean(this.options.expressionProvider),
        entries: s.hubert.notebook?.entries ?? [],
        ...(this.publicDraft ? { draft: this.publicDraft } : {}),
      },
      events: s.world.events
        .slice(-35)
        .map((event) => ({ ...event, message: displayMemorySummary(event.message) })),
      memories: publicMemories(s.hubert),
      recalledMemory: recalledMemory(s.hubert, s.runtime.simulatedAt),
      wishes: publicWishes(s.hubert),
      artifacts: s.artifactCreatedAt
        ? [
            {
              id: 'weather-study',
              name: 'A small study of the weather',
              description: 'An SVG chart made from Elsewhere’s simulated weather observations.',
              url: '/api/artifacts/weather-study',
              createdAt: s.artifactCreatedAt,
            },
          ]
        : [],
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
        const allowance = reserveModelCall(
          this.state.modelAllowance,
          this.wallNow(),
          this.options.modelMaximum ?? 100,
        );
        if (!allowance) return null;
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
        this.state.runtime.providerRetryRequested = true;
        this.state.runtime.lastDecisionAt = -1;
        delete this.state.runtime.activityUntil;
      }
      this.state.runtime.providerWorkloadRetries = active.flatMap((issue) =>
        issue.workload && issue.workload !== 'decision' ? [issue.workload] : [],
      );
      if (active.some((issue) => issue.workload === 'notebook') && this.state.hubert.notebook) {
        // An explicit owner retry permits a new charged attempt for the last failed source.
        const book = this.state.hubert.notebook;
        if (book.failedSourceId) {
          book.sourceIds = book.sourceIds.filter((id) => id !== book.failedSourceId);
          book.lastAtReal = 0;
        }
      }
      if (active.some((issue) => issue.workload === 'reflection'))
        delete this.state.runtime.dreamRest;
      await this.commit();
      return { accepted: true };
    });
  }
  private reportProviderIssue(
    kind: ProviderIssue['kind'],
    workload: NonNullable<ProviderIssue['workload']> = 'decision',
  ) {
    const issues = (this.state.runtime.providerIssues ??= []);
    const now = this.wallNow();
    const messages = {
      unconfigured: 'No model provider is connected. Connect a provider before retrying.',
      unavailable:
        'The model provider is unavailable. Check the connection or sign-in, then retry.',
      failed:
        'The provider request failed or returned an invalid response. Check the provider, then retry.',
      allowance: 'The daily model allowance has been reached. Retry after the allowance resets.',
    };
    const existing = issues.find((issue) => issue.workload === workload && !issue.resolvedAt);
    if (existing) Object.assign(existing, { kind, lastAt: now, message: messages[kind] });
    else
      issues.push({
        id: randomUUID(),
        characterId: 'hubert',
        workload,
        kind,
        since: now,
        lastAt: now,
        message: messages[kind],
      });
    this.state.runtime.providerIssues = issues.slice(-12);
    if (workload === 'decision') {
      this.state.runtime.modelStatus = 'Hubert is currently unavailable';
      this.state.hubert.activity = {
        kind: 'unavailable',
        label: 'Currently unavailable',
        startedAt: this.state.runtime.simulatedAt,
      };
    }
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
      const allowance = managed
        ? s.modelAllowance
        : reserveModelCall(s.modelAllowance, nowReal, this.options.modelMaximum ?? 100);
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
      } else this.reportProviderIssue('allowance', 'reflection');
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
  private async advance(force: boolean): Promise<PublicSnapshot> {
    if (this.state.runtime.paused && !force) return this.getSnapshot();
    const s = this.state;
    const increment = force ? 30_000 : (this.options.simulationStepMs ?? 6_000);
    const now = s.runtime.simulatedAt + increment;
    s.runtime.simulatedAt = now;
    s.runtime.tick++;
    s.world = advanceWorld(s.world, now);
    s.hubert = advanceHubert(s.hubert, now);
    await this.dreamDuringRest();
    // A tiny independent local service: measurements continue without a viewer or model.
    const phase = (now - s.runtime.startedAt) / 60_000;
    s.weatherSamples.push({
      at: now,
      temperature: 18 + Math.sin(phase / 9) * 3,
      wind: 3 + Math.sin(phase / 4) * 1.5,
    });
    s.weatherSamples = s.weatherSamples.slice(-240);
    const resident = s.world.residents.find((r) => r.id === 'hubert');
    const ready =
      resident &&
      !resident.path.length &&
      (force ||
        (now >= (s.runtime.activityUntil ?? 0) &&
          now - s.runtime.lastDecisionAt >= (this.options.decisionIntervalMs ?? 90_000)));
    if (ready) {
      const observation = observeWorld(s.world, 'hubert', now);
      const blocked = s.runtime.providerIssues?.some(
        (issue) => issue.workload === 'decision' && !issue.resolvedAt,
      );
      if (blocked && !s.runtime.providerRetryRequested) {
        await this.commit();
        return this.getSnapshot();
      }
      delete s.runtime.providerRetryRequested;
      let decision;
      const provider = this.options.modelProvider;
      if (!provider) this.reportProviderIssue('unconfigured');
      else if (provider.isAvailable?.() === false) this.reportProviderIssue('unavailable');
      else {
        const managed = provider.managesAllowance === true;
        const allowance = managed
          ? s.modelAllowance
          : reserveModelCall(s.modelAllowance, this.wallNow(), this.options.modelMaximum ?? 100);
        if (!allowance) this.reportProviderIssue('allowance');
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
            );
            this.resolveProviderIssue('decision');
            s.runtime.modelStatus = 'Model connected';
          } catch {
            if (this.halted) throw new Error('Model dispatch stopped after a persistence failure.');
            this.reportProviderIssue('failed');
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
        if (policy.command.type === 'reconsider') {
          const choice = policy.command;
          const result = applyInterestChoice(s.hubert, policy.command, this.wallNow());
          s.hubert = result.state;
          s.hubert.activity = {
            kind: 'reconsider',
            label: 'Reconsidering an interest',
            startedAt: now,
          };
          s.hubert.intent =
            result.status === 'changed'
              ? 'I can choose where my attention goes next.'
              : 'I can leave that preference as it is for now.';
          s.hubert.lastOutcome = {
            id: 'preference-' + randomUUID(),
            at: now,
            action: 'reconsider',
            status: result.status === 'changed' ? 'completed' : 'rejected',
            summary:
              result.status === 'changed'
                ? `Interest ${choice.interestId}: ${choice.disposition}.`
                : (result.reason ?? 'No preference changed.'),
          };
          if (result.status === 'changed') {
            const interest = [...s.hubert.interests, ...s.hubert.dormantInterests].find(
              (item) => item.id === choice.interestId,
            );
            s.world.events.push({
              id: s.hubert.lastOutcome.id,
              at: now,
              type: 'interest_changed',
              characterId: 'hubert',
              message:
                choice.disposition === 'set-aside'
                  ? `Hubert set aside ${interest?.name.toLowerCase() ?? 'an interest'} for now.`
                  : `Hubert returned to ${interest?.name.toLowerCase() ?? 'an old interest'}.`,
            });
            s.world.events = s.world.events.slice(-100);
            s.world.version++;
          }
          settleHubertAttention(
            s.hubert,
            {
              id: s.hubert.lastOutcome.id,
              at: now,
              command: choice,
              status: result.status === 'changed' ? 'completed' : 'rejected',
              summary: s.hubert.lastOutcome.summary,
              ...(result.status === 'changed' ? { evidence: s.hubert.lastOutcome.id } : {}),
            },
            now,
            this.wallNow(),
          );
          s.runtime.activityUntil = now + 90_000;
        } else if (policy.command.type === 'research' || policy.command.type === 'read') {
          await this.researchActivity(policy.command, observation, now);
        } else {
          const result = executeWorldCommand(s.world, 'hubert', policy.command, now);
          s.world = result.world;
          const duration = hubertActivityDurationMs(policy.command);
          if (result.outcome.status !== 'rejected' && duration > 0)
            s.runtime.activityUntil = now + duration;
          s.hubert = applyOutcome(
            s.hubert,
            result.outcome,
            observeWorld(s.world, 'hubert', now),
            now,
            this.wallNow(),
          );
        }
      } else {
        s.hubert.intent = policy.reason;
        // Denied operations never reach an executor and never receive a success reward.
      }
      s.runtime.lastDecisionAt = now;
      s.hubert = considerWish(
        s.hubert,
        observeWorld(s.world, 'hubert', now),
        this.wallNow(),
        s.world,
      );
    }
    if (s.hubert.project.completed && !s.artifactCreatedAt) {
      s.artifactCreatedAt = now;
      s.artifactSamples = structuredClone(s.weatherSamples);
      s.world.events.push({
        id: `artifact:${now}`,
        at: now,
        type: 'artifact_created',
        message:
          'Hubert finished a local weather study. Its SVG chart can be opened from the artifact shelf.',
        characterId: 'hubert',
        placeId: 'workshop',
      });
    }
    await this.commit();
    await this.writeNotebook();
    return this.getSnapshot();
  }
  private async writeNotebook() {
    const provider = this.options.expressionProvider;
    if (!provider || this.halted || this.state.runtime.paused) return;
    if (provider.isAvailable?.() === false) {
      this.reportProviderIssue('unavailable', 'notebook');
      await this.commit();
      return;
    }
    if (
      this.state.runtime.providerIssues?.some(
        (issue) => issue.workload === 'notebook' && !issue.resolvedAt,
      ) &&
      !this.state.runtime.providerWorkloadRetries?.includes('notebook')
    )
      return;
    const input = notebookInput(this.getSnapshot());
    if (!input.facts.length) return;
    const sourceId =
      'public-' +
      createHash('sha256')
        .update(JSON.stringify({ facts: input.facts, interests: input.interests }))
        .digest('hex');
    const now = Math.max(this.wallNow(), this.state.hubert.notebook?.latestAtReal ?? 0);
    const day = new Date(now).toISOString().slice(0, 10);
    const book = (this.state.hubert.notebook ??= {
      day,
      calls: 0,
      latestAtReal: now,
      lastAtReal: 0,
      sourceIds: [],
      entries: [],
    });
    const calls = day > book.day ? 0 : book.calls;
    if (
      book.pending ||
      calls >= 8 ||
      book.sourceIds.includes(sourceId) ||
      (book.sourceIds.length > 0 && now - book.lastAtReal < 20 * 60_000)
    )
      return;
    this.state.runtime.providerWorkloadRetries = this.state.runtime.providerWorkloadRetries?.filter(
      (workload) => workload !== 'notebook',
    );
    const allowance = reserveModelCall(
      this.state.modelAllowance,
      now,
      this.options.modelMaximum ?? 100,
    );
    if (!allowance) {
      this.reportProviderIssue('allowance', 'notebook');
      await this.commit();
      return;
    }
    this.state.modelAllowance = allowance;
    book.day = day;
    book.latestAtReal = now;
    book.lastAtReal = now;
    book.calls = calls + 1;
    book.sourceIds = [...book.sourceIds, sourceId].slice(-64);
    const id = 'note-' + randomUUID();
    book.pending = { id, sourceId };
    await this.commit(); // One durable request reservation; abandoned drafts are never replayed.
    this.publicDraft = { id, at: this.state.runtime.simulatedAt, text: '' };
    this.modelDispatchActive = true;
    let draft = '',
      invalidDraft = false;
    try {
      const text = validatePublicExpression(
        await provider.express(input, (delta) => {
          if (typeof delta !== 'string' || draft.length + delta.length > 360) {
            invalidDraft = true;
            return;
          }
          draft += delta;
          if (this.publicDraft?.id === id)
            this.publicDraft.text = draft.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        }),
      );
      if (invalidDraft || (draft && validatePublicExpression(draft) !== text))
        throw Error('Notebook draft did not match its completed note.');
      this.resolveProviderIssue('notebook');
      delete book.failedSourceId;
      if (text)
        book.entries = [
          ...book.entries,
          { id, at: this.state.runtime.simulatedAt, text, sourceIds: input.facts.map((f) => f.id) },
        ].slice(-32);
    } catch {
      if (this.halted) throw Error('Notebook stopped after persistence failure.');
      book.failedSourceId = sourceId;
      this.reportProviderIssue('failed', 'notebook');
      // A failed draft is not published and does not become a memory or a fictional success.
    } finally {
      this.publicDraft = undefined;
      this.modelDispatchActive = false;
      delete book.pending;
    }
    await this.commit();
  }
  private async researchActivity(
    command: Extract<
      import('@elsewhere/character-interfaces').CharacterCommand,
      { type: 'research' | 'read' }
    >,
    observation: import('@elsewhere/character-interfaces').Observation,
    now: number,
  ) {
    const s = this.state,
      port = this.options.research,
      at = this.wallNow();
    const existing = s.hubert.research;
    if (!port || (existing && at - existing.lastAtReal < 120_000)) {
      s.hubert.intent = 'Web research is unavailable or cooling down. I can return to it later.';
      s.runtime.activityUntil = now + 90_000;
      return;
    }
    const target =
      command.type === 'research'
        ? researchTargets(s.hubert, observation, at).find((x) => x.id === command.targetId)
        : undefined;
    const source =
      command.type === 'read'
        ? readableSources(s.hubert, at).find((x) => x.id === command.sourceId)
        : undefined;
    if (command.type === 'research' ? !target : !source) {
      s.hubert.intent = 'That research offer is no longer available.';
      s.runtime.activityUntil = now + 90_000;
      return;
    }
    const research = (s.hubert.research ??= { lastAtReal: 0, topics: {}, readIds: [] });
    const id = 'research-' + randomUUID();
    research.lastAtReal = at;
    research.pending = { id, kind: command.type === 'research' ? 'search' : 'read' };
    startResearchEpisode(
      s.hubert,
      {
        id,
        kind: research.pending.kind,
        target,
        sourceId: source?.id,
        placeId: observation.placeId,
      },
      now,
    );
    if (target) {
      research.topics[target.id] = at;
      research.topics = Object.fromEntries(Object.entries(research.topics).slice(-64));
    }
    await this.commit();
    try {
      const result =
        command.type === 'research'
          ? await port.search({ requestId: id, query: target!.query })
          : await port.read({ requestId: id, sourceId: source!.id });
      if (result.kind === 'search')
        research.search = {
          targetId: target!.id,
          label: target!.label,
          placeId: observation.placeId,
          result,
        };
      rememberResearch(s.hubert, result, now);
      const label =
        result.kind === 'search' ? target!.label : (research.search?.label ?? 'a topic');
      s.hubert.activity = {
        kind: command.type,
        label: result.kind === 'search' ? `Researching ${label}` : `Reading about ${label}`,
        startedAt: now,
      };
      s.hubert.intent =
        result.kind === 'search'
          ? 'I have found web sources I can choose to read.'
          : 'I have read an external source; its claims remain separate from my lived experiences.';
      s.hubert.stats.energy = Math.max(0, s.hubert.stats.energy - 1);
      s.world.events.push({
        id: result.receiptId,
        at: now,
        type: result.kind === 'search' ? 'web_search' : 'web_read',
        characterId: 'hubert',
        placeId: observation.placeId,
        message:
          result.kind === 'search'
            ? `Hubert researched ${label} using ${result.provider}${result.cached ? ' (cached results)' : ''}; ${result.sources.length} sources were returned.`
            : `Hubert read “${result.title}”, an external web source.`,
      });
      s.world.events = s.world.events.slice(-100);
      s.world.version++;
      settleHubertAttention(
        s.hubert,
        {
          id: result.receiptId,
          command,
          status: 'completed',
          summary: 'External research receipt recorded.',
          at: now,
          evidence: result.receiptId,
        },
        now,
        at,
      );
    } catch {
      if (this.halted) throw Error('Research stopped after persistence failure.');
      deferResearchEpisode(s.hubert, source?.id);
      if (command.type === 'read') {
        research.deferredSources = Object.fromEntries(
          [
            ...Object.entries(research.deferredSources ?? {}).filter(
              ([id]) => id !== command.sourceId,
            ),
            [command.sourceId, at],
          ].slice(-32),
        );
      }
      s.hubert.activity = { kind: 'research', label: 'Leaving research for later', startedAt: now };
      s.hubert.intent = 'That web source is unavailable. I can leave it for later.';
      s.world.events.push({
        id,
        at: now,
        type: 'research_deferred',
        characterId: 'hubert',
        placeId: observation.placeId,
        message: 'Hubert deferred an unavailable web research request.',
      });
      s.world.events = s.world.events.slice(-100);
      settleHubertAttention(
        s.hubert,
        { id, command, status: 'rejected', summary: 'Research unavailable.', at: now },
        now,
        at,
      );
    } finally {
      delete research.pending;
    }
    s.runtime.activityUntil = now + 120_000;
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
      await this.commit();
      return this.getSnapshot();
    });
  }
  reset() {
    return this.serialize(async () => {
      const allowance = structuredClone(this.state.modelAllowance);
      const routing = structuredClone(this.state.modelRouting);
      const issues = structuredClone(this.state.runtime.providerIssues);
      const previous = this.state.hubert;
      const worldVersion = this.state.world.version;
      this.state = initialState(this.wallNow());
      // Resetting a fictional life never replenishes real paid-call allowance.
      this.state.modelAllowance = allowance;
      this.state.runtime.providerIssues = issues;
      if (routing) this.state.modelRouting = routing;
      this.state.hubert = preserveWishLedger(this.state.hubert, previous);
      this.state.hubert.dreams = pruneDreamState(previous.dreams, []);
      if (previous.interestChoices)
        this.state.hubert.interestChoices = structuredClone(previous.interestChoices);
      if (previous.notebook)
        this.state.hubert.notebook = {
          ...structuredClone(previous.notebook),
          entries: [],
          pending: undefined,
        };
      this.publicDraft = undefined;
      this.state.world.version = Math.max(this.state.world.version, worldVersion + 1);
      for (const wish of this.state.hubert.wishes ?? []) {
        if (wish.status === 'fulfilled')
          this.state.world = installWishFeature(
            this.state.world,
            wish.requestedObjectId,
            this.state.runtime.simulatedAt,
          );
      }
      this.state.runtime.paused = true;
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
      const world =
        decision === 'fulfill'
          ? installWishFeature(
              this.state.world,
              wish.requestedObjectId,
              this.state.runtime.simulatedAt,
            )
          : this.state.world;
      const next = resolveCharacterWish(
        this.state.hubert,
        { wishId: id, decision, receiptId: randomUUID(), world },
        this.wallNow(),
      );
      this.state.world = world;
      this.state.hubert = next;
      await this.commit();
      return this.getSnapshot();
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
  close(): Promise<void> {
    this.closing = true;
    this.closePromise ??= this.lane.then(() => this.store.close());
    return this.closePromise;
  }
}
