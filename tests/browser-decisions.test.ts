import { describe, expect, it } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import { browserFixtureAction } from './e2e/decision-fixture';

describe('explicit browser decision scenarios', () => {
  for (const scenario of ['memories', 'wish', 'birds'] as const) {
    it(`${scenario} proposes offered actions and obtains authoritative evidence`, async () => {
      let calls = 0;
      let enabled = false;
      const store = new SqliteSnapshotStore<ControllerState>(':memory:');
      const controller = await new ElsewhereController(store, {
        modelProvider: {
          id: 'browser-scenario-fixture',
          propose: async (context) => {
            calls++;
            if (!enabled)
              throw new Error('Fixture provider is disabled until explicitly selected.');
            return browserFixtureAction(context, scenario);
          },
        },
      }).init();
      try {
        await controller.step();
        expect(controller.getCharacterIssues().some((issue) => !issue.resolvedAt)).toBe(true);
        await controller.reset();
        enabled = true;
        await controller.step();
        expect(calls, 'Reset must preserve the provider failure until an explicit retry').toBe(1);
        await controller.retryCharacterProvider();
        let snapshot = controller.getSnapshot();
        expect(snapshot.character.interests).toEqual([]);
        expect(snapshot.memories).toEqual([]);
        const finished = () =>
          scenario === 'wish'
            ? snapshot.wishes?.some((wish) => wish.status === 'pending')
            : scenario === 'birds'
              ? snapshot.memories.some((memory) => memory.entityId === 'courtyard-sparrow')
              : snapshot.memories.length > 0;
        for (let turn = 0; turn < (scenario === 'wish' ? 60 : 12) && !finished(); turn++)
          snapshot = await controller.step();
        expect(calls).toBeGreaterThan(1);
        expect(controller.getCharacterIssues().every((issue) => issue.resolvedAt)).toBe(true);
        expect(finished(), `Scenario ${scenario} must create genuine evidence`).toBeTruthy();
        const saved = (await store.load())!.value;
        expect(
          snapshot.memories.every((memory) =>
            saved.hubert.memories.some(
              (episode) =>
                episode.id === memory.id &&
                episode.verified &&
                episode.source === 'world-outcome' &&
                episode.experience?.status === 'completed',
            ),
          ),
        ).toBe(true);
        if (scenario === 'birds') {
          expect(
            snapshot.character.interests.find((interest) => interest.id === 'birds')?.encounters,
          ).toBeGreaterThan(0);
          expect(snapshot.events.some((event) => event.type === 'entity_observed')).toBe(true);
        }
        if (scenario === 'wish') expect(snapshot.memories.length).toBeGreaterThanOrEqual(3);
      } finally {
        await controller.close();
      }
    });
  }
});
