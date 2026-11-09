import { describe, expect, it, vi } from 'vitest';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';

const epoch = Date.UTC(2026, 10, 9, 12);
class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, version: number) {
    expect(version).toBe(this.saved?.version ?? 0);
    this.saved = { value: structuredClone(value), version: version + 1 };
    return version + 1;
  }
  async close() {}
}
const details = {
  title: 'Bird guide',
  description: 'Collected field notes.',
  url: 'https://example.com/birds',
  kind: 'document' as const,
};

describe('creation links in the authoritative character life', () => {
  it('persists owner registered links unpinned, pins explicitly, and preserves the shelf across restart and life reset', async () => {
    const store = new MemoryStore();
    const first = await new ElsewhereController(store, { now: () => epoch }).init();
    await first.createCreation(details);
    const creation = first.getSnapshot().creations![0];
    expect(creation).toMatchObject({ ...details, characterId: 'hubert', provenance: 'owner' });
    expect(creation.pinnedAt).toBeUndefined();
    await first.createCreation(details);
    expect(first.getSnapshot().creations).toHaveLength(1);
    await first.pinCreation(creation.id, true);
    expect(first.getSnapshot().creations![0].pinnedAt).toBe(epoch);
    await first.close();
    const restarted = await new ElsewhereController(store, { now: () => epoch }).init();
    try {
      expect(restarted.getSnapshot().creations![0].pinnedAt).toBe(epoch);
      await restarted.reset();
      expect(restarted.getSnapshot().creations![0]).toEqual({ ...creation, pinnedAt: epoch });
      await restarted.pinCreation(creation.id, false);
      expect(restarted.getSnapshot().creations![0].pinnedAt).toBeUndefined();
    } finally {
      await restarted.close();
    }
  });

  it('lets the model pin only an existing creation and exposes its own shelf as planning data', async () => {
    const store = new MemoryStore();
    let creationId = '';
    const propose = vi.fn(async (context) => {
      expect(JSON.stringify(context.state.creations)).toContain('Bird guide');
      return { type: 'pin_creation', creationId, pinned: true };
    });
    const controller = await new ElsewhereController(store, {
      now: () => epoch,
      modelProvider: { id: 'fixture', propose },
    }).init();
    try {
      await controller.createCreation(details);
      creationId = controller.getSnapshot().creations![0].id;
      await controller.step();
      expect(controller.getSnapshot().creations![0].pinnedAt).toBeDefined();
      expect(store.saved!.value.hubert.lastOutcome?.status).toBe('completed');
      expect(
        controller.getSnapshot().events.filter((event) => event.type === 'creation_pinned'),
      ).toHaveLength(1);
      await controller.step();
      expect(
        controller.getSnapshot().events.filter((event) => event.type === 'creation_pinned'),
      ).toHaveLength(1);
      creationId = 'invented-creation';
      await controller.step();
      expect(controller.getSnapshot().creations).toHaveLength(1);
      expect(store.saved!.value.hubert.lastOutcome?.status).toBe('rejected');
      expect(
        controller.getSnapshot().events.some((event) => event.type === 'artifact_created'),
      ).toBe(false);
    } finally {
      await controller.close();
    }
  });

  it('rejects unsafe owner links and cross-character pin attempts without changing the published shelf', async () => {
    const store = new MemoryStore();
    const controller = await new ElsewhereController(store, { now: () => epoch }).init();
    try {
      await controller.createCreation(details);
      const before = controller.getSnapshot().creations;
      await expect(
        controller.createCreation({ ...details, url: 'javascript:alert(1)' }),
      ).rejects.toThrow('invalid');
      await expect(controller.pinCreation('another-character-creation', true)).rejects.toThrow(
        'not found',
      );
      expect(controller.getSnapshot().creations).toEqual(before);
    } finally {
      await controller.close();
    }
  });
});
