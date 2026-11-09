import { describe, expect, it } from 'vitest';
import type { EpisodicMemory } from '../characters/runtime/src/index';
import { createInitialHubert } from '../characters/hubert/src/index';
import { considerWish } from '../characters/hubert/src/wishes';
import { createInitialWorld, observeWorld } from '../elsewhere/server/src/world';

const epoch = Date.UTC(2026, 10, 9, 12);
function receipt(id: string, targetId: string, action = 'inspect'): EpisodicMemory {
  return {
    id,
    createdAt: epoch - 1000,
    sourceEventId: `world:${id}`,
    source: 'world-outcome',
    verified: true,
    summary: `Hubert completed an ${action} of ${targetId}.`,
    cues: [{ kind: 'object', value: targetId }],
    emotionalContext: { mood: 65, frustration: 10 },
    salience: 0.5,
    experience: { action, targetId, status: 'completed' },
  };
}
function fixture() {
  const world = createInitialWorld(epoch);
  const state = createInitialHubert(epoch);
  state.knownObjects = Object.fromEntries(world.objects.map((object) => [object.id, object]));
  state.memories = [
    receipt('bench-1', 'bench'),
    receipt('bench-2', 'bench'),
    receipt('bench-3', 'bench'),
  ];
  const observation = observeWorld(world, 'hubert', epoch);
  const consider = () => considerWish(state, observation, epoch, world);
  return { world, state, observation, consider };
}

describe('wishes grounded in changing tastes and actual experiences', () => {
  it('defers when three real but unrelated episodes cannot support any candidate', () => {
    const h = fixture();
    h.state.interests = [
      { id: 'weather', name: 'Weather', strength: 0.9, encounters: 1 },
      { id: 'patterns', name: 'Patterns', strength: 0.8, encounters: 1 },
      { id: 'nature', name: 'Nature', strength: 0.7, encounters: 1 },
      { id: 'quiet', name: 'Quiet', strength: 0.6, encounters: 1 },
    ];
    const before = structuredClone(h.state);
    expect(h.consider().wishes).toEqual([]);
    expect(h.state).toEqual(before);
  });

  it('requires a positive active taste rather than using a dormant, absent or zero preference', () => {
    const h = fixture();
    h.state.memories[0] = receipt('garden', 'garden');
    h.state.dormantInterests = [{ id: 'nature', name: 'Nature', strength: 0.9, encounters: 6 }];
    expect(h.consider().wishes).toEqual([]);
    for (const strength of [0, -0.2]) {
      h.state.interests = [{ id: 'nature', name: 'Nature', strength, encounters: 6 }];
      expect(h.consider().wishes).toEqual([]);
    }
    h.state.interests[0].strength = 0.3;
    expect(h.consider().wishes[0]).toMatchObject({
      requestedObjectId: 'seed-library',
      sourceMemoryIds: ['garden'],
    });
  });

  it('requires both a genuine work session and its completed receipt for a weather station', () => {
    const h = fixture();
    h.state.interests = [{ id: 'weather', name: 'Weather', strength: 0.9, encounters: 1 }];
    h.state.project.verifiedWorkSessions = 1;
    h.state.memories[0] = receipt('workbench-inspection', 'workbench');
    expect(h.consider().wishes).toEqual([]);
    h.state.memories[0] = receipt('weather-work', 'workbench', 'work');
    h.state.project.verifiedWorkSessions = 0;
    expect(h.consider().wishes).toEqual([]);
    h.state.project.verifiedWorkSessions = 1;
    const requested = h.consider().wishes[0];
    expect(requested).toMatchObject({
      requestedObjectId: 'weather-station',
      sourceMemoryIds: ['weather-work'],
    });
    expect(requested.sourceMemoryIds).not.toContain('bench-2');
  });

  it.each(['rejected', 'unverified', 'external', 'ambiguous'] as const)(
    'does not turn a %s work claim into weather-study history',
    (kind) => {
      const h = fixture();
      h.state.interests = [{ id: 'weather', name: 'Weather', strength: 0.9, encounters: 1 }];
      h.state.project.verifiedWorkSessions = 1;
      const work = receipt('claimed-work', 'workbench', 'work');
      if (kind === 'rejected') work.experience!.status = 'rejected';
      if (kind === 'unverified') work.verified = false;
      if (kind === 'external') work.source = 'external-message';
      if (kind === 'ambiguous') delete work.experience;
      h.state.memories.unshift(work);
      expect(h.consider().wishes).toEqual([]);
    },
  );

  it('ranks grounded candidates by current tastes rather than a permanent weather-project bonus', () => {
    const h = fixture();
    h.state.project.verifiedWorkSessions = 3;
    h.state.memories = [
      receipt('weather-work', 'workbench', 'work'),
      receipt('garden', 'garden'),
      receipt('chime', 'windchime'),
    ];
    h.state.interests = [
      { id: 'weather', name: 'Weather', strength: 0.3, encounters: 3 },
      { id: 'nature', name: 'Nature', strength: 0.8, encounters: 2 },
      { id: 'sound', name: 'Sound', strength: 0.4, encounters: 1 },
    ];
    expect(h.consider().wishes[0]).toMatchObject({
      requestedObjectId: 'seed-library',
      sourceMemoryIds: ['garden'],
    });
    h.state.interests.find((interest) => interest.id === 'sound')!.strength = 0.9;
    expect(h.consider().wishes[0]).toMatchObject({
      requestedObjectId: 'music-box',
      sourceMemoryIds: ['chime'],
    });
  });

  it('does not turn a generic nature encounter into a history of gardening', () => {
    const h = fixture();
    h.state.interests = [{ id: 'nature', name: 'Nature', strength: 0.8, encounters: 1 }];
    h.state.knownObjects['nature-token'] = {
      ...h.state.knownObjects.bench,
      id: 'nature-token',
      kind: 'artifact',
      tags: ['nature'],
    };
    h.state.memories[0] = receipt('nature-token', 'nature-token');
    expect(h.consider().wishes).toEqual([]);
  });

  it('retains an existing pending request when its original taste later fades', () => {
    const h = fixture();
    h.state.memories[0] = receipt('garden', 'garden');
    h.state.interests = [{ id: 'nature', name: 'Nature', strength: 0.8, encounters: 1 }];
    const requested = h.consider();
    requested.interests = [];
    requested.memories = [];
    const later = considerWish(requested, h.observation, epoch + 3 * 86_400_000, h.world);
    expect(later.wishes).toEqual(requested.wishes);
    expect(later.wishes[0].status).toBe('pending');
  });
});
