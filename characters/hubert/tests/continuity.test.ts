import { describe, expect, it } from 'vitest';
import type { Observation } from '@elsewhere/character-interfaces';
import {
  applyNote,
  applyPursue,
  chooseActionWithProvider,
  createInitialHubert,
  portraitDue,
  portraitInput,
  publicCharacter,
  recordPortrait,
  upgradeHubertState,
  workingContext,
  type HubertState,
} from '../src/index';
import { recordReading, READINGS_KEPT } from '@elsewhere/character-runtime';
import { MODEL_ACTION_FORMAT, MODEL_ACTION_INSTRUCTIONS } from '@elsewhere/character-interfaces';

const minute = 60_000;
const epoch = Date.UTC(2026, 10, 9, 12);
const observation: Observation = {
  characterId: 'hubert',
  placeId: 'courtyard',
  position: { x: 0, z: 0 },
  facing: 0,
  visibleObjects: [],
  events: [],
  observedAt: epoch,
};
function withReadings(count: number, spacing = minute): HubertState {
  const state = createInitialHubert(epoch);
  for (let n = 0; n < count; n++)
    state.readings = recordReading(state.readings, {
      id: `use-${n}`,
      at: epoch + n * spacing,
      objectId: 'sundial',
      objectName: 'The sundial',
      control: 'read',
      text: `Tried read on the sundial. Shadow ${n}.`,
    });
  return state;
}
const pursue = (state: HubertState, id: string, at: number, question = `Question ${id} here?`) =>
  applyPursue(state, { type: 'pursue', question, why: 'I want to know.' }, id, at);

describe('readings carried onto a new pursuit', () => {
  it('copies only the last sixty minutes, once, and never from a resumed pursuit', () => {
    let state = withReadings(0);
    for (const [n, at] of [
      [0, 0],
      [1, 30 * minute],
      [2, 59 * minute],
    ] as const)
      state.readings = recordReading(state.readings, {
        id: `use-${n}`,
        at: epoch + at,
        objectId: 'sundial',
        objectName: 'The sundial',
        control: 'read',
        text: `Tried read on the sundial. Shadow ${n}.`,
      });
    state = pursue(state, 'p1', epoch + 75 * minute);
    const first = state.pursuits.items.find((item) => item.id === 'p1')!;
    expect(first.entries.map((entry) => entry.id)).toEqual(['tried:use-1', 'tried:use-2']);
    expect(first.entries[0]).toMatchObject({ kind: 'tried', objectId: 'sundial' });
    expect(state.readings.map((reading) => reading.pursuitId)).toEqual([undefined, 'p1', 'p1']);
    // A second new pursuit finds nothing left to take, and resuming copies nothing.
    state = pursue(state, 'p2', epoch + 76 * minute);
    expect(state.pursuits.items.find((item) => item.id === 'p2')!.entries).toEqual([]);
    state = applyPursue(state, { type: 'pursue', pursuitId: 'p1' }, 'unused', epoch + 77 * minute);
    expect(state.pursuits.items.find((item) => item.id === 'p1')!.entries).toHaveLength(2);
  });

  it('does not copy when the question resumes one that already exists', () => {
    let state = pursue(withReadings(0), 'p1', epoch, 'Why do sparrows hop?');
    state.readings = recordReading(state.readings, {
      id: 'use-9',
      at: epoch + minute,
      objectId: 'sundial',
      objectName: 'The sundial',
      control: 'read',
      text: 'Tried read on the sundial.',
    });
    state = pursue(state, 'p2', epoch + 2 * minute, 'Why do sparrows hop?');
    expect(state.pursuits.items).toHaveLength(1);
    expect(state.readings[0].pursuitId).toBeUndefined();
  });
});

describe('what the decision context carries', () => {
  it('shows the newest 24 readings, oldest first, and no pursuit marker', () => {
    const state = withReadings(READINGS_KEPT);
    const context = workingContext(state, observation);
    const readings = context.state.readings as Array<{ id: string; pursuitId?: string }>;
    expect(readings).toHaveLength(24);
    expect(readings[0].id).toBe(`use-${READINGS_KEPT - 24}`);
    expect(readings.at(-1)!.id).toBe(`use-${READINGS_KEPT - 1}`);
    expect(readings.every((reading) => !('pursuitId' in reading))).toBe(true);
    expect(context.state).not.toHaveProperty('self');
  });

  it('shows the last portrait as state.self', () => {
    const state = recordPortrait(createInitialHubert(epoch), 'I keep coming back to shadows.', 5);
    expect(workingContext(state, observation).state.self).toEqual({
      portrait: 'I keep coming back to shadows.',
      writtenAt: 5,
    });
  });

  it('never offers reflect or work, and rejects a proposed reflect as unavailable', async () => {
    const context = workingContext(createInitialHubert(epoch), observation);
    const types = (context.choices ?? []).map((choice) => choice.type);
    expect(types.length).toBeGreaterThan(0);
    expect(types).not.toContain('reflect');
    expect(types).not.toContain('work');
    const offered = JSON.stringify(MODEL_ACTION_FORMAT);
    expect(offered).not.toContain('"reflect"');
    expect(offered).not.toContain('"work"');
    expect(MODEL_ACTION_INSTRUCTIONS).not.toMatch(/(^| )(reflect|work):/);
    for (const type of ['reflect', 'work'] as const) {
      const proposal = type === 'work' ? { type, targetId: 'workbench' } : { type };
      await expect(
        chooseActionWithProvider(createInitialHubert(epoch), observation, epoch, {
          id: 'stub',
          propose: async () => ({ action: proposal, why: '' }),
        }),
      ).rejects.toMatchObject({ code: 'unavailable_action' });
    }
  });
});

describe('a saved life from before', () => {
  it('drops dreams and progress guidance and keeps pursuits, trail and the rest', () => {
    const saved = pursue(createInitialHubert(epoch), 'p1', epoch);
    const old = {
      ...saved,
      dreams: { entries: ['x'] },
      progress: { ledger: true },
      progressGuidance: { kind: 'select-alternative' },
      progressDecision: { id: 'a', intentionKey: 'b' },
      activeWakeImpulse: 'impulse',
      wishesAskedAtReal: 3,
    } as unknown as HubertState;
    delete (old as Partial<HubertState>).readings;
    delete (old as Partial<HubertState>).portraits;
    old.trail = [{ id: 't1', at: 1, kind: 'pursue', text: 'Question p1 here?' }];
    const upgraded = upgradeHubertState(old);
    for (const retired of [
      'dreams',
      'progress',
      'progressGuidance',
      'progressDecision',
      'activeWakeImpulse',
      'wishesAskedAtReal',
    ])
      expect(upgraded).not.toHaveProperty(retired);
    expect(upgraded.readings).toEqual([]);
    expect(upgraded.portraits).toEqual([]);
    expect(upgraded.pursuits.items.map((item) => item.id)).toEqual(['p1']);
    expect(upgraded.trail).toEqual(old.trail);
  });
});

describe('the self-portrait', () => {
  it('is due only after a rest of ten minutes, three hours after the last one, with a pursuit', () => {
    let state = pursue(createInitialHubert(epoch), 'p1', epoch);
    state.activity = { kind: 'rest', label: 'Resting', startedAt: epoch };
    expect(portraitDue(state, epoch + 9 * minute)).toBe(false);
    expect(portraitDue(state, epoch + 10 * minute)).toBe(true);
    state = recordPortrait(state, 'First.', epoch + 10 * minute);
    expect(portraitDue(state, epoch + 3 * 60 * minute + 9 * minute)).toBe(false);
    expect(portraitDue(state, epoch + 13 * 60 * minute)).toBe(true);
    const empty = createInitialHubert(epoch);
    empty.activity = { kind: 'rest', label: 'Resting', startedAt: epoch };
    expect(portraitDue(empty, epoch + 20 * minute)).toBe(false);
    state.activity = { kind: 'look', label: 'Looking', startedAt: epoch };
    expect(portraitDue(state, epoch + 13 * 60 * minute)).toBe(false);
  });

  it('keeps the five before the current one and publishes both', () => {
    let state = createInitialHubert(epoch);
    for (let n = 1; n <= 8; n++) state = recordPortrait(state, `Portrait ${n}.`, n);
    expect(state.portrait).toEqual({ text: 'Portrait 8.', at: 8 });
    expect(state.portraits.map((item) => item.text)).toEqual([
      'Portrait 3.',
      'Portrait 4.',
      'Portrait 5.',
      'Portrait 6.',
      'Portrait 7.',
    ]);
    const published = publicCharacter(state);
    expect(published.portrait).toEqual({ text: 'Portrait 8.', at: 8 });
    expect(published.portraits).toHaveLength(5);
  });

  it('is written from the record alone: pursuits, creations, the last portrait and readings', () => {
    let state = pursue(withReadings(15), 'p1', epoch + 20 * minute);
    state.outsideMessages.push({
      id: 'm',
      source: 'visitor-guestbook',
      text: 'PRIVATE-GUEST-CANARY',
      at: epoch,
    });
    state = recordPortrait(state, 'Before.', epoch);
    const input = portraitInput(state, 'Identity.', [
      { title: 'Notes', url: 'https://x.invalid/n' },
    ]);
    expect(input).toMatchObject({
      form: 'portrait',
      identity: 'Identity.',
      previous: 'Before.',
      creations: [{ title: 'Notes', url: 'https://x.invalid/n' }],
    });
    expect(input.readings).toHaveLength(12);
    expect(input.pursuits[0]).toMatchObject({ question: 'Question p1 here?', status: 'active' });
    expect(JSON.stringify(input)).not.toContain('PRIVATE-GUEST-CANARY');
  });
});

describe('a line of inquiry stays one pursuit', () => {
  const proposing = (action: object) => ({
    id: 'scripted',
    propose: async () => ({ action, why: 'I want to see it once more.' }),
  });
  const decide = (state: HubertState, action: object) =>
    chooseActionWithProvider(state, observation, epoch + minute, proposing(action) as never);
  const SWING = 'Does the heavier bob’s slower swing decay repeat in a matched pair at 60 cm?';

  it('declines opening the pursuit that is already active, by id or by its question', async () => {
    const state = pursue(createInitialHubert(epoch), 'pursuit-a', epoch, SWING);
    await expect(decide(state, { type: 'pursue', pursuitId: 'pursuit-a' })).rejects.toMatchObject({
      code: 'unavailable_action',
      message: expect.stringContaining('already the pursuit you are following'),
    });
    await expect(
      decide(state, {
        type: 'pursue',
        question: 'Does the heavier bob’s slower swing decay repeat in the matched pair at 60 cm?',
        why: 'Once more.',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('already following this') });
  });
  it('declines a pursuit whose question is an identifier', async () => {
    const state = pursue(createInitialHubert(epoch), 'pursuit-a', epoch, SWING);
    await expect(
      decide(state, {
        type: 'pursue',
        question: 'pursuit-886fd4a7-4dc6-4034-9cb4-3cd8a944ebe8',
        why: 'Two pairs are enough.',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('written out in words') });
  });
  it('keeps a variation on the same pursuit and goes back to an earlier one for its near-copy', () => {
    let state = pursue(createInitialHubert(epoch), 'pursuit-a', epoch, SWING);
    state = pursue(state, 'pursuit-b', epoch + 1, SWING.replace('60 cm', '120 cm'));
    expect(state.pursuits.items).toHaveLength(1);
    expect(state.pursuits.items[0].questions).toEqual([SWING.replace('60 cm', '120 cm')]);
    state = pursue(state, 'pursuit-c', epoch + 2, 'How fast do rings spread on the pond?');
    state = pursue(state, 'pursuit-d', epoch + 3, SWING.replace('60 cm', '80 cm'));
    expect(state.pursuits.items.map((item) => item.id)).toEqual(['pursuit-a', 'pursuit-c']);
    expect(state.pursuits.activeId).toBe('pursuit-a');
  });
  it('declines a note that says again what the last one said', async () => {
    const text =
      'At 40 cm and a 2 degree release the 100 g bob took 62 swings to halve and the 200 g bob about 80.';
    let state = pursue(createInitialHubert(epoch), 'pursuit-a', epoch, SWING);
    state = applyNote(state, { type: 'note', text, surprised: false }, 'note-1', epoch + 1);
    await expect(decide(state, { type: 'note', text, surprised: false })).rejects.toMatchObject({
      message: expect.stringContaining('already noted this'),
    });
  });
  it('gives a saved pursuit without a question one again', () => {
    const state = pursue(createInitialHubert(epoch), 'pursuit-a', epoch, SWING);
    state.pursuits.items[0].question = 'pursuit-886fd4a7-4dc6-4034-9cb4-3cd8a944ebe8';
    state.pursuits.items[0].questions = [
      'Would the mass difference persist at another cord length?',
    ];
    const upgraded = upgradeHubertState(state);
    expect(upgraded.pursuits.items[0].question).toBe(
      'Would the mass difference persist at another cord length?',
    );
  });
  it('shows the wishes made so far, also when there are none', () => {
    const state = createInitialHubert(epoch);
    expect(workingContext(state, observation).state.wishes).toEqual([]);
    state.wishes.push({
      id: 'wish-1',
      text: 'Bobs of one shape in different weights.',
      createdAt: epoch,
      status: 'pending',
    });
    expect(workingContext(state, observation).state.wishes).toEqual([
      { text: 'Bobs of one shape in different weights.', status: 'pending', askedAt: epoch },
    ]);
  });
});
