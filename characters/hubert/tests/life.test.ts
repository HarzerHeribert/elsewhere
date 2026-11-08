import { describe, expect, it } from 'vitest';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
} from '../../../elsewhere/server/src/world';
import { applyOutcome, chooseAction, createInitialHubert } from '../src/index';

describe('local life through the real world protocol', () => {
  it('discovers objects, visits both spaces, and makes a persistent sketch', () => {
    let world = createInitialWorld(0);
    let state = createInitialHubert(0);
    const commands: string[] = [];
    for (let turn = 1; turn <= 160; turn++) {
      const now = turn * 30_000;
      world = advanceWorld(world, now);
      const observation = observeWorld(world, 'hubert', now);
      const decision = chooseAction(state, observation, now);
      state = decision.state;
      const execution = executeWorldCommand(world, 'hubert', decision.action, now);
      world = execution.world;
      state = applyOutcome(state, execution.outcome, observation, now);
      commands.push(`${decision.action.type}:${execution.outcome.status}`);
    }
    expect(
      state.memories.some((memory) =>
        memory.cues.some((cue) => cue.kind === 'place' && cue.value === 'workshop'),
      ),
    ).toBe(true);
    expect(
      state.memories.some((memory) =>
        memory.cues.some((cue) => cue.kind === 'place' && cue.value === 'courtyard'),
      ),
    ).toBe(true);
    expect(world.objects.some((object) => object.id === 'weather-vane-sketch')).toBe(true);
    expect(state.project.verifiedWorkSessions).toBeGreaterThan(0);
    expect(commands.filter((command) => command.endsWith(':rejected')).length).toBeLessThan(10);
    expect(state.lastRecallAt).not.toBeNull();
  });
});
