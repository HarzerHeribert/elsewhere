import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import type { ReflectionProvider } from '../packages/adapters/src/models/reflection';
import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext } from '@elsewhere/character-runtime';
import { scriptedProvider, type ScriptedProvider } from './scripted-provider';

const start = Date.UTC(2026, 10, 9, 12, 10);
const minute = 60_000;
const OUTSIDE = 'The quick brown fox jumps over the lazy dog beside the quiet river bank.';

class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expected: number) {
    this.saved = { version: expected + 1, value: structuredClone(value) };
    return expected + 1;
  }
  async close() {}
}
const open = new Set<ElsewhereController>();
afterEach(async () => {
  for (const controller of open) await controller.close();
  open.clear();
});
async function create(
  provider: ScriptedProvider,
  options: Partial<ConstructorParameters<typeof ElsewhereController>[1]> = {},
  store = new MemoryStore(),
) {
  const controller = await new ElsewhereController(store, {
    now: () => start,
    modelProvider: provider,
    ...options,
  }).init();
  open.add(controller);
  return { controller, store };
}
type Offers = Array<{ id: string; ready: string[] }>;
/** Walks to the sundial and works it again and again. */
const sundial = (context: DecisionContext): CharacterCommand => {
  const offer = (context.state as unknown as { actionOffers: Offers }).actionOffers.find(
    (item) => item.id === 'sundial',
  );
  return offer?.ready.includes('use')
    ? { type: 'use', targetId: 'sundial', control: 'read' }
    : { type: 'move', targetId: 'sundial' };
};
const stateOf = (context: DecisionContext) =>
  context.state as unknown as {
    readings?: Array<{ id: string; text: string; objectName: string; control: string }>;
    self?: { portrait: string; writtenAt: number };
    pursuits: { active: { entries: Array<{ kind: string }> } | null };
  };

describe('readings that stay', () => {
  it('keeps a reading taken with no pursuit open and moves the recent ones onto a new pursuit', async () => {
    let tried = 0;
    const provider = scriptedProvider([], {
      fallback: (context) => {
        const state = stateOf(context);
        if (state.pursuits.active) return { type: 'rest' };
        if ((state.readings?.length ?? 0) >= 2)
          return {
            type: 'pursue',
            question: 'Why does the shadow move so?',
            why: 'I measured it.',
          };
        tried++;
        return sundial(context);
      },
    });
    const { controller, store } = await create(provider, {
      simulationStepMs: 10_000,
      decisionIntervalMs: 20_000,
    });
    for (let tick = 0; tick < 120 && !store.saved!.value.hubert.pursuits.items.length; tick++)
      await controller.tick();
    const saved = store.saved!.value.hubert;
    expect(tried).toBeGreaterThan(0);
    expect(saved.readings.length).toBeGreaterThanOrEqual(2);
    expect(saved.readings[0]).toMatchObject({
      objectId: 'sundial',
      control: 'read',
      objectName: expect.any(String),
    });
    // The readings were taken with nothing open, appeared in the context, and then moved over.
    const seen = provider.contexts.map((context) => stateOf(context).readings?.length ?? 0);
    expect(seen.at(-1)).toBeGreaterThanOrEqual(2);
    const entries = saved.pursuits.items[0].entries.filter((entry) => entry.kind === 'tried');
    expect(entries.map((entry) => entry.id)).toEqual(
      saved.readings.map((reading) => `tried:${reading.id}`),
    );
    expect(
      saved.readings.every((reading) => reading.pursuitId === saved.pursuits.items[0].id),
    ).toBe(true);
  });

  it('also records a reading taken during a pursuit, once on the pursuit', async () => {
    const provider = scriptedProvider(
      [{ type: 'pursue', question: 'How long is the shadow?', why: 'I want to know.' }],
      { fallback: sundial },
    );
    const { controller, store } = await create(provider, {
      simulationStepMs: 10_000,
      decisionIntervalMs: 20_000,
    });
    for (let tick = 0; tick < 80 && !store.saved!.value.hubert.readings.length; tick++)
      await controller.tick();
    const saved = store.saved!.value.hubert;
    const tried = saved.pursuits.items[0].entries.filter((entry) => entry.kind === 'tried');
    expect(saved.readings).toHaveLength(tried.length);
    expect(saved.readings[0].pursuitId).toBe(saved.pursuits.items[0].id);
  });
});

describe('a saved life from before', () => {
  it('loads with dreams and progress fields and keeps pursuits, trail and creations', async () => {
    const backing = new MemoryStore();
    const first = await create(
      scriptedProvider([
        { type: 'pursue', question: 'Why do sparrows hop?', why: 'I keep watching them.' },
        { type: 'note', text: 'Short legs beat running.', surprised: false },
      ]),
      {},
    );
    // Reuse the first controller's store so the saved life is the one that is loaded.
    await first.controller.step();
    await first.controller.step();
    const saved = structuredClone(first.store.saved!);
    await first.controller.close();
    open.delete(first.controller);
    const old = saved.value as unknown as Record<string, any>;
    old.creations = [
      {
        id: 'creation-1',
        characterId: 'hubert',
        title: 'A chart',
        description: 'Tallies',
        url: 'https://example.org/chart',
        kind: 'website',
        createdAt: 1,
        provenance: 'character',
      },
    ];
    Object.assign(old.hubert, {
      dreams: { entries: [], pending: null },
      progress: { ledger: [] },
      progressGuidance: null,
      progressDecision: null,
      activeWakeImpulse: null,
    });
    delete old.hubert.readings;
    delete old.hubert.portraits;
    old.runtime.dreamRest = { id: 'rest', startedAt: 1, startedAtReal: 1 };
    const trail = old.hubert.trail;
    const pursuits = old.hubert.pursuits;
    await backing.save(saved.value, 0);
    const { controller } = await create(scriptedProvider(), {}, backing);
    const state = (await backing.load())!.value;
    for (const retired of ['dreams', 'progress', 'progressGuidance', 'progressDecision'])
      expect(state.hubert).not.toHaveProperty(retired);
    expect(state.hubert).not.toHaveProperty('activeWakeImpulse');
    expect(state.runtime).not.toHaveProperty('dreamRest');
    expect(state.schemaVersion).toBe(2);
    expect(state.hubert.pursuits).toEqual(pursuits);
    expect(state.hubert.trail).toEqual(trail);
    expect(state.hubert.readings).toEqual([]);
    expect(state.creations).toHaveLength(1);
    expect(controller.getSnapshot().pursuits).toHaveLength(1);
    expect(controller.getSnapshot().trail.length).toBe(trail.length);
  });
});

describe('the wish as the resident’s own action', () => {
  const wish = (n: number) => ({
    type: 'wish' as const,
    text: `I would like a way to measure wind number ${n}.`,
  });
  it('adds a public ledger entry and a trail entry, up to three that are unresolved', async () => {
    const provider = scriptedProvider([wish(1), wish(2), wish(3), wish(4)], {
      fallback: { type: 'rest' },
    });
    const { controller, store } = await create(provider);
    for (let step = 0; step < 3; step++) await controller.step();
    const snapshot = controller.getSnapshot();
    expect(snapshot.wishes?.map((item) => item.text)).toEqual([
      wish(1).text,
      wish(2).text,
      wish(3).text,
    ]);
    expect(snapshot.wishes!.every((item) => item.status === 'pending')).toBe(true);
    expect(
      snapshot.trail.filter((entry) => entry.kind === 'wish').map((entry) => entry.text),
    ).toEqual([wish(1).text, wish(2).text, wish(3).text]);
    // Three are waiting, so wishing is no longer a choice, and a further one is refused with a reason.
    await controller.step();
    expect(provider.contexts[3].choices?.map((choice) => choice.type)).not.toContain('wish');
    expect(provider.contexts[0].choices?.map((choice) => choice.type)).toContain('wish');
    const saved = store.saved!.value.hubert;
    expect(saved.wishes).toHaveLength(3);
    expect(saved.lastDecisionProblem?.message).toMatch(/nobody has answered/);
    expect(saved.lastOutcome).toMatchObject({ action: 'wish', status: 'rejected' });
    expect(controller.getSnapshot().trail.filter((entry) => entry.kind === 'wish')).toHaveLength(3);
  });

  it('can be resolved by the owner, which makes room for another', async () => {
    const provider = scriptedProvider([wish(1), wish(2), wish(3)], { fallback: wish(4) });
    const { controller } = await create(provider);
    for (let step = 0; step < 3; step++) await controller.step();
    const [first] = controller.getSnapshot().wishes!;
    const answered = await controller.resolveWish(first.id, 'fulfill');
    expect(answered.wishes![0]).toMatchObject({ status: 'fulfilled' });
    await controller.step();
    const statuses = controller.getSnapshot().wishes!.map((item) => item.status);
    expect(statuses.filter((status) => status === 'fulfilled')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'pending')).toHaveLength(3);
    expect(provider.contexts.at(-1)!.choices?.map((choice) => choice.type)).toContain('wish');
  });

  it('does not accept a wish that repeats an outside message', async () => {
    const provider = scriptedProvider([{ type: 'wish', text: OUTSIDE }], {
      fallback: { type: 'rest' },
    });
    const { controller } = await create(provider);
    await controller.submitMessage(OUTSIDE);
    await controller.step();
    expect(controller.getSnapshot().wishes).toEqual([]);
  });
});

describe('looking at itself after a long rest', () => {
  const PORTRAIT = 'I have been following how sparrows hop, and I keep coming back to short legs.';
  const pursue = {
    type: 'pursue' as const,
    question: 'Why do sparrows hop?',
    why: 'I watch them.',
  };
  /** One pursuit, a long rest, then more long rests. */
  const resting = (rest = 15 * minute) =>
    scriptedProvider([pursue, { type: 'rest', durationMs: rest }], {
      fallback: { type: 'rest', durationMs: 60 * minute },
    });
  const reflecting = (answer: (input: unknown) => string = () => PORTRAIT) => {
    const reflect = vi.fn(async (input: unknown) => answer(input));
    const provider: ReflectionProvider = {
      id: 'fixture',
      localOnly: true,
      reflect: reflect as ReflectionProvider['reflect'],
    };
    return { provider, reflect };
  };
  const run = async (controller: ElsewhereController, ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) await controller.tick();
  };
  const options = { simulationStepMs: minute, decisionIntervalMs: minute };

  it('writes one portrait when the rest ends, not again within three hours, and shows it', async () => {
    const provider = resting();
    const { provider: reflection, reflect } = reflecting();
    const { controller, store } = await create(provider, {
      ...options,
      reflectionProvider: reflection,
    });
    await run(controller, 40);
    expect(reflect).toHaveBeenCalledTimes(1);
    const saved = store.saved!.value.hubert;
    expect(saved.portrait).toMatchObject({ text: PORTRAIT });
    const snapshot = controller.getSnapshot();
    expect(snapshot.character.portrait).toEqual(saved.portrait);
    expect(snapshot.trail.filter((entry) => entry.kind === 'portrait')).toEqual([
      expect.objectContaining({ text: PORTRAIT, at: saved.portrait!.at }),
    ]);
    // The next decision after it carries the portrait.
    expect(stateOf(provider.contexts.at(-1)!).self).toEqual({
      portrait: PORTRAIT,
      writtenAt: saved.portrait!.at,
    });
    // One-hour rests inside the next three hours write nothing more.
    await run(controller, 120);
    expect(reflect).toHaveBeenCalledTimes(1);
    // After three hours the next long rest does.
    await run(controller, 120);
    expect(reflect.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(store.saved!.value.hubert.portraits.map((item) => item.text)).toEqual([PORTRAIT]);
    expect(controller.getSnapshot().character.portraits).toHaveLength(1);
  });

  it('writes nothing after a rest shorter than ten minutes', async () => {
    const { provider: reflection, reflect } = reflecting();
    const { controller } = await create(resting(5 * minute), {
      ...options,
      reflectionProvider: reflection,
    });
    await run(controller, 12);
    expect(reflect).not.toHaveBeenCalled();
  });

  it('is skipped silently when the allowance refuses, and the request is never sent', async () => {
    const { provider: reflection, reflect } = reflecting();
    // The pursuit and the rest take the whole allowance.
    const { controller } = await create(resting(), {
      ...options,
      modelMaximum: 2,
      reflectionProvider: reflection,
    });
    await run(controller, 30);
    expect(reflect).not.toHaveBeenCalled();
    expect(
      controller.getCharacterIssues().filter((issue) => issue.workload === 'reflection'),
    ).toEqual([]);
    expect(controller.getSnapshot().character.portrait).toBeUndefined();
  });

  it('is dropped when it reproduces an outside message, and its input never held one', async () => {
    const { provider: reflection, reflect } = reflecting(() => `A portrait. ${OUTSIDE}`);
    const { controller, store } = await create(resting(), {
      ...options,
      reflectionProvider: reflection,
    });
    await controller.submitMessage(OUTSIDE);
    await run(controller, 40);
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(store.saved!.value.hubert.portrait).toBeUndefined();
    expect(controller.getSnapshot().trail.some((entry) => entry.kind === 'portrait')).toBe(false);
    const sent = JSON.stringify(reflect.mock.calls[0][0]);
    expect(sent).not.toContain('quiet river bank');
    expect(sent).toContain('Why do sparrows hop?');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('quiet river bank');
  });

  it('is dropped when it is empty', async () => {
    const { provider: reflection, reflect } = reflecting(() => '');
    const { controller, store } = await create(resting(), {
      ...options,
      reflectionProvider: reflection,
    });
    await run(controller, 40);
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(store.saved!.value.hubert.portrait).toBeUndefined();
  });

  it('needs at least one pursuit', async () => {
    const { provider: reflection, reflect } = reflecting();
    const provider = scriptedProvider([{ type: 'rest', durationMs: 15 * minute }], {
      fallback: { type: 'rest', durationMs: 15 * minute },
    });
    const { controller } = await create(provider, { ...options, reflectionProvider: reflection });
    await run(controller, 40);
    expect(reflect).not.toHaveBeenCalled();
  });
});
