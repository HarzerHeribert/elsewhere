import { randomUUID } from 'node:crypto';
import hubertAppearance from '../characters/hubert/appearance.json' with { type: 'json' };
import type { PublicSnapshot, WorldState } from '@elsewhere/character-interfaces';
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
  chooseAction,
  chooseActionWithProvider,
  createInitialHubert,
  upgradeHubertState,
  publicCharacter,
  publicMemories,
  recalledMemory,
  considerWish,
  preserveWishLedger,
  publicWishes,
  needsRest,
  resolveWish as resolveCharacterWish,
  type HubertState,
} from '@elsewhere/hubert';
import type { DecisionProvider } from '@elsewhere/character-runtime';
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
    modelStatus: string;
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
      modelStatus: 'Deterministic local planner',
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
      const freezeArtifact =
        this.state.artifactCreatedAt != null && this.state.artifactSamples === undefined;
      const changed =
        JSON.stringify(upgraded) !== JSON.stringify(this.state.world) ||
        JSON.stringify(upgradedHubert) !== JSON.stringify(this.state.hubert) ||
        freezeArtifact;
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
      world: publicWorld(s.world),
      character: publicCharacter(s.hubert),
      events: s.world.events.slice(-35),
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
        costKnown:
          !this.options.modelProvider ||
          this.options.modelProvider.id === 'ollama' ||
          this.options.modelProvider.localOnly === true,
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
  private async advance(force: boolean): Promise<PublicSnapshot> {
    if (this.state.runtime.paused && !force) return this.getSnapshot();
    const s = this.state;
    const increment = force ? 30_000 : (this.options.simulationStepMs ?? 6_000);
    const now = s.runtime.simulatedAt + increment;
    s.runtime.simulatedAt = now;
    s.runtime.tick++;
    s.world = advanceWorld(s.world, now);
    s.hubert = advanceHubert(s.hubert, now);
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
      (force || now - s.runtime.lastDecisionAt >= (this.options.decisionIntervalMs ?? 18_000));
    if (ready) {
      const observation = observeWorld(s.world, 'hubert', now);
      let decision;
      if (this.options.modelProvider && !needsRest(s.hubert)) {
        const managed = this.options.modelProvider.managesAllowance === true;
        const allowance = managed
          ? s.modelAllowance
          : reserveModelCall(s.modelAllowance, this.wallNow(), this.options.modelMaximum ?? 100);
        if (allowance) {
          s.modelAllowance = allowance;
          // Legacy adapters reserve here; routed adapters reserve each actual attempt via modelBudget.
          if (!managed) await this.commit();
          this.modelDispatchActive = true;
          try {
            decision = await chooseActionWithProvider(
              s.hubert,
              observation,
              now,
              this.options.modelProvider,
            );
            s.runtime.modelStatus =
              this.options.modelProvider.id === 'routed'
                ? 'Routed model proposal validated; tools remain policy-controlled'
                : this.options.modelProvider.id === 'ollama'
                  ? 'Ollama local proposal validated; tools remain policy-controlled'
                  : 'Remote proposal validated; tools remain policy-controlled';
          } catch {
            if (this.halted) throw new Error('Model dispatch stopped after a persistence failure.');
            s.runtime.modelStatus = 'Provider unavailable or invalid proposal; local fallback';
          } finally {
            this.modelDispatchActive = false;
          }
        } else s.runtime.modelStatus = 'Daily model allowance reached; local fallback';
      }
      decision ??= chooseAction(s.hubert, observation, now);
      s.hubert = decision.state;
      const policy = authorizeCommand(decision.action);
      if (policy.allowed) {
        const result = executeWorldCommand(s.world, 'hubert', policy.command, now);
        s.world = result.world;
        s.hubert = applyOutcome(
          s.hubert,
          result.outcome,
          observeWorld(s.world, 'hubert', now),
          now,
        );
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
    return this.getSnapshot();
  }
  pause() {
    return this.serialize(async () => {
      this.state.runtime.paused = true;
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
      const previous = this.state.hubert;
      const worldVersion = this.state.world.version;
      this.state = initialState(this.wallNow());
      // Resetting a fictional life never replenishes real paid-call allowance.
      this.state.modelAllowance = allowance;
      if (routing) this.state.modelRouting = routing;
      this.state.hubert = preserveWishLedger(this.state.hubert, previous);
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
