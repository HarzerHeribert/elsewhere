import { expect, it } from 'vitest';
import { narrowActionFormat, type Observation } from '@elsewhere/character-interfaces';
import {
  applyNote,
  applyPursue,
  createInitialHubert,
  workingContext,
  type HubertState,
} from '../characters/hubert/src/index';
import { decisionMessages } from '../packages/adapters/src/models/shared';
import { responsesActionFormat } from '../packages/adapters/src/models/responses-action';

/**
 * A provider can reuse a cached prompt only as far as two requests are identical from the
 * first byte: the instructions, the output format, then the input. These tests hold the parts
 * this code controls still, so that consecutive decisions share as much as they can.
 */
const epoch = Date.UTC(2026, 10, 9, 12);
const observation = (at: number, facing = 0): Observation => ({
  characterId: 'hubert',
  placeId: 'workshop',
  position: { x: 0, z: 0 },
  facing,
  visibleObjects: [],
  events: [],
  observedAt: at,
});
const request = (state: HubertState, at: number, facing = 0) => {
  const context = workingContext(state, observation(at, facing), at, true);
  const [instructions, input] = decisionMessages(context, 'envelope');
  return {
    instructions: instructions.content,
    format: JSON.stringify(responsesActionFormat(context.choices)),
    input: input.content,
  };
};
const sharedPrefix = (a: string, b: string) => {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
};
function following(): HubertState {
  let state = createInitialHubert(epoch);
  state.portrait = { text: 'I have been timing a pendulum. '.repeat(20), at: epoch };
  state = applyPursue(
    state,
    { type: 'pursue', question: 'Why does a heavier bob keep swinging longer?', why: 'It did.' },
    'pursuit-a',
    epoch,
  );
  for (let n = 0; n < 12; n++)
    state = applyNote(
      state,
      {
        type: 'note',
        text: `Trial ${n}: the count to half was ${60 + n} swings.`,
        surprised: false,
      },
      `note-${n}`,
      epoch + n * 1000,
    );
  return state;
}

it('sends the same instructions and format, and the same input up to the new note, one step later', () => {
  const state = following();
  const before = request(state, epoch + 60_000);
  const next = applyNote(
    state,
    { type: 'note', text: 'Trial 12: the count to half was 72 swings.', surprised: true },
    'note-12',
    epoch + 61_000,
  );
  const after = request(next, epoch + 120_000);
  expect(after.instructions).toBe(before.instructions);
  expect(after.format).toBe(before.format);
  // Everything up to the newest entry of the active pursuit is byte for byte the same.
  const shared = sharedPrefix(before.input, after.input);
  expect(before.input.slice(0, shared)).toContain('Trial 11');
  expect(before.input.indexOf('"actionOffers"')).toBeGreaterThan(shared);
  expect(shared).toBeGreaterThan(before.input.indexOf('"pursuits"'));
});

it('gives the same format for the same choices in any order', () => {
  const choices = [
    { type: 'look' as const, where: { targetId: ['window', 'artifact', 'workbench'] } },
    { type: 'rest' as const },
  ];
  const shuffled = [
    { type: 'look' as const, where: { targetId: ['workbench', 'window', 'artifact'] } },
    { type: 'rest' as const },
  ];
  expect(JSON.stringify(narrowActionFormat(shuffled))).toBe(
    JSON.stringify(narrowActionFormat(choices)),
  );
});
