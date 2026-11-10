import { describe, expect, it } from 'vitest';
import type {
  CharacterCommand,
  Observation,
  PublicCreation,
  WorldEntity,
  WorldObject,
} from '@elsewhere/character-interfaces';
import { narrowActionFormat } from '@elsewhere/character-interfaces';
import {
  advanceWorld,
  createInitialWorld,
  executeWorldCommand,
  observeWorld,
} from '../../../elsewhere/server/src/world';
import { createInitialHubert, workingContext } from '../src/index';
import {
  actionOutcomeFeedback,
  assessHubertSpatialAction,
  canInspectObservedEntity,
  hubertActionOffers,
  hubertSpatialChoices,
} from '../src/actionOffers';

const sundial: WorldObject = {
  id: 'test-sundial',
  name: 'The sundial',
  kind: 'sundial',
  description: 'A stone dial.',
  detail: 'INSPECTION-ONLY-DETAIL',
  position: { x: 0, z: 5 },
  radius: 0.3,
  height: 1,
  color: '#aaa',
  tags: ['time', 'making'],
  affordances: ['inspect', 'interact'],
};
const creature: WorldEntity = {
  ...sundial,
  id: 'test-creature',
  name: 'A visitor from the grass',
  kind: 'butterfly',
  tags: ['color'],
  affordances: ['inspect'],
  radius: 0.1,
  height: 0.1,
  behavior: 'perched',
  elevation: 0.8,
  facing: 0,
  observationVersion: 1,
};
function fixture() {
  const now = 1000;
  const world = createInitialWorld(now);
  world.obstacles = [];
  world.objects = [structuredClone(sundial)];
  world.entities = [];
  world.residents[0].position = { x: 0, z: 0 };
  world.residents[0].facing = 0;
  const state = createInitialHubert(now);
  state.knownObjects[sundial.id] = structuredClone(sundial);
  return { now, state, world, observation: observeWorld(world, 'hubert') };
}
const offerFor = (offers: ReturnType<typeof hubertActionOffers>, id: string) =>
  offers.find((o) => o.id === id)!;

describe('grounded Hubert action offers', () => {
  it('distinguishes places from interactable objects rather than offering an invalid inspection', () => {
    const f = fixture();
    const place = f.observation.knownPlaces![0];
    expect(
      executeWorldCommand(f.world, 'hubert', { type: 'inspect', targetId: place.id }).outcome
        .status,
    ).toBe('rejected');
    expect(offerFor(hubertActionOffers(f.state, f.observation, f.now), place.id)).toMatchObject({
      kind: 'place',
      ready: ['move'],
    });
    expect(
      assessHubertSpatialAction(
        f.state,
        f.observation,
        { type: 'inspect', targetId: place.id },
        f.now,
      ).status,
    ).toBe('unavailable');
    expect(
      assessHubertSpatialAction(f.state, f.observation, { type: 'move', targetId: place.id }, f.now)
        .status,
    ).toBe('ready');
  });

  it('turns a distant interaction into an explicit approach, then admits the interaction on arrival', () => {
    const f = fixture();
    const wanted: CharacterCommand = { type: 'interact', targetId: sundial.id };
    expect(executeWorldCommand(f.world, 'hubert', wanted).outcome.summary).toContain('Move closer');
    const assessment = assessHubertSpatialAction(f.state, f.observation, wanted, f.now);
    expect(assessment.status).toBe('approach');
    if (assessment.status !== 'approach') throw Error('Expected approach');
    expect(assessment.command).toEqual({ type: 'move', targetId: sundial.id });
    const travel = executeWorldCommand(f.world, 'hubert', assessment.command);
    expect(travel.outcome.status).toBe('started');
    const arrived = advanceWorld(travel.world, f.now + 10000);
    const current = observeWorld(arrived, 'hubert');
    expect(assessHubertSpatialAction(f.state, current, wanted, arrived.updatedAt).status).toBe(
      'ready',
    );
    expect(executeWorldCommand(arrived, 'hubert', wanted).outcome.status).toBe('completed');
  });

  it('matches the world interaction-reach boundary, including an immediately out-of-reach object', () => {
    for (const distance of [1.79, 1.8, 1.800001]) {
      const f = fixture();
      f.world.objects[0].position = { x: 0, z: distance };
      f.state.knownObjects[sundial.id] = structuredClone(f.world.objects[0]);
      const observation = observeWorld(f.world, 'hubert');
      const action: CharacterCommand = { type: 'inspect', targetId: sundial.id };
      const admitted =
        executeWorldCommand(f.world, 'hubert', action).outcome.status === 'completed';
      expect(assessHubertSpatialAction(f.state, observation, action, f.now).status).toBe(
        admitted ? 'ready' : 'approach',
      );
    }
  });

  it('does not confuse a remembered object or creature with current visibility or leak inspection-only detail', () => {
    const f = fixture();
    f.state.knownEntities[creature.id] = { ...creature, lastSeenAt: f.now };
    const hidden: Observation = { ...f.observation, visibleObjects: [], visibleEntities: [] };
    const offers = hubertActionOffers(f.state, hidden, f.now);
    expect(offerFor(offers, sundial.id)).toMatchObject({
      visible: false,
      ready: [],
      nextAction: { type: 'move', targetId: sundial.id },
    });
    expect(offers.some((o) => o.id === creature.id)).toBe(false);
    expect(
      assessHubertSpatialAction(f.state, hidden, { type: 'move', targetId: creature.id }, f.now)
        .status,
    ).toBe('unavailable');
    expect(JSON.stringify(offers)).not.toContain('INSPECTION-ONLY-DETAIL');
    expect(
      assessHubertSpatialAction(f.state, hidden, { type: 'look', targetId: sundial.id }, f.now)
        .status,
    ).toBe('unavailable');
  });

  it('shows current cooldowns without forbidding inspection, practice, rest or non-spatial capabilities', () => {
    const f = fixture();
    f.world.objects[0].position = { x: 0, z: 1 };
    f.world.objects[0].id = 'workbench';
    f.world.objects[0].affordances = ['inspect', 'interact', 'work'];
    f.state.knownObjects.workbench = structuredClone(f.world.objects[0]);
    f.state.project.completed = true;
    f.state.lastObjectUse.workbench = f.now;
    const observation = observeWorld(f.world, 'hubert');
    expect(offerFor(hubertActionOffers(f.state, observation, f.now), 'workbench')).toMatchObject({
      ready: ['look', 'inspect', 'use'],
      cooldownUntil: f.now + 90000,
      projectCompleted: true,
    });
    expect(
      assessHubertSpatialAction(
        f.state,
        observation,
        { type: 'work', targetId: 'workbench' },
        f.now,
      ).status,
    ).toBe('unavailable');
    expect(
      assessHubertSpatialAction(
        f.state,
        observation,
        { type: 'work', targetId: 'workbench' },
        f.now + 90000,
      ).status,
    ).toBe('ready');
    expect(
      assessHubertSpatialAction(f.state, observation, { type: 'rest', durationMs: 60000 }, f.now)
        .status,
    ).toBe('not-spatial');
    expect(
      assessHubertSpatialAction(
        f.state,
        observation,
        { type: 'search', query: 'sundial history' },
        f.now,
      ).status,
    ).toBe('not-spatial');
  });

  it('offers a farther visible creature only as an approach and observes actual watch eligibility', () => {
    const f = fixture();
    f.world.objects = [];
    f.world.entities = [{ ...creature, position: { x: 0, z: 9 } }];
    const observation = observeWorld(f.world, 'hubert');
    expect(observation.visibleEntities).toHaveLength(1);
    expect(canInspectObservedEntity(f.state, creature, observation, f.now)).toBe(false);
    const before = hubertActionOffers(f.state, observation, f.now);
    expect(offerFor(before, creature.id)).toMatchObject({
      kind: 'entity',
      ready: ['look'],
      approachFor: ['inspect'],
    });
    expect(
      executeWorldCommand(f.world, 'hubert', { type: 'inspect', targetId: creature.id }).outcome
        .status,
    ).toBe('rejected');
    f.state.watchAttention.lastAt = f.now;
    expect(
      offerFor(hubertActionOffers(f.state, observation, f.now), creature.id).nextAction,
    ).toBeUndefined();
    expect(
      assessHubertSpatialAction(
        f.state,
        observation,
        { type: 'interact', targetId: creature.id },
        f.now,
      ).status,
    ).toBe('unavailable');
  });

  it('never offers an immediate world action which its own current authoritative observation would reject', () => {
    for (const distance of [0.5, 1.5, 3, 8, 8.01, 9.99]) {
      const f = fixture();
      f.world.objects[0].position = { x: 0, z: distance };
      f.world.entities = [{ ...creature, position: { x: 0.2, z: distance } }];
      const observation = observeWorld(f.world, 'hubert');
      for (const offer of hubertActionOffers(f.state, observation, f.now)) {
        for (const type of offer.ready) {
          if (type === 'move') continue; // Paths are checked by execution, not reconstructed here.
          const control = offer.controls?.[0];
          const command: CharacterCommand =
            type === 'use'
              ? { type, targetId: offer.id, control: control!.id, value: control!.value?.min }
              : { type, targetId: offer.id };
          expect(executeWorldCommand(f.world, 'hubert', command).outcome.status).toBe('completed');
        }
      }
    }
  });

  it('keeps prompt offers bounded without rejecting a known destination solely because it was omitted for space', () => {
    const f = fixture();
    f.state.knownObjects = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => {
        const id = 'known-' + index.toString().padStart(2, '0');
        return [id, { ...sundial, id }];
      }),
    );
    const observation = { ...f.observation, visibleObjects: [] };
    expect(
      hubertActionOffers(f.state, observation, f.now).filter((o) => o.kind === 'object'),
    ).toHaveLength(16);
    expect(
      assessHubertSpatialAction(f.state, observation, { type: 'move', targetId: 'known-39' }, f.now)
        .status,
    ).toBe('ready');
  });

  it('does not declare a malformed movement command ready merely because it contains a position', () => {
    const f = fixture();
    expect(
      assessHubertSpatialAction(
        f.state,
        f.observation,
        { type: 'move', targetId: sundial.id, position: { x: 0, z: 0 } },
        f.now,
      ).status,
    ).toBe('unavailable');
    expect(
      assessHubertSpatialAction(
        f.state,
        f.observation,
        { type: 'move', position: { x: NaN, z: 0 } },
        f.now,
      ).status,
    ).toBe('unavailable');
  });

  it('keeps the last actual receipt bounded and separate from fabricated narrative or private command payloads', () => {
    const feedback = actionOutcomeFeedback({
      id: 'receipt',
      at: 10,
      status: 'rejected',
      command: { type: 'say', text: 'PRIVATE-COMMAND-TEXT' },
      summary: 'not allowed\n' + 'x'.repeat(500),
    });
    expect(feedback).toMatchObject({ id: 'receipt', at: 10, status: 'rejected', action: 'say' });
    expect(feedback.summary).toHaveLength(320);
    expect(feedback.summary).not.toContain('\n');
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE-COMMAND-TEXT');
  });
});

describe('turn choices derived from grounded offers', () => {
  const spatial = ['move', 'look', 'inspect', 'interact', 'work'] as const;
  const offeredTargets = (
    choices: ReturnType<typeof hubertSpatialChoices>,
    type: (typeof spatial)[number],
  ) =>
    choices.flatMap((choice) =>
      choice.type === type && Array.isArray(choice.where?.targetId) ? choice.where.targetId : [],
    );

  it('admits exactly the spatial proposals its own assessment would accept', () => {
    for (const distance of [0.5, 1.5, 3, 8, 8.01, 9.99])
      for (const justWatched of [false, true])
        for (const justUsed of [false, true]) {
          const f = fixture();
          f.world.objects[0].position = { x: 0, z: distance };
          f.world.entities = [{ ...creature, position: { x: 0.2, z: distance } }];
          if (justWatched) f.state.watchAttention.lastAt = f.now;
          if (justUsed) f.state.lastObjectUse[sundial.id] = f.now;
          const observation = observeWorld(f.world, 'hubert');
          const offers = hubertActionOffers(f.state, observation, f.now);
          const choices = hubertSpatialChoices(offers);
          expect(offers.length).toBeGreaterThan(2);
          for (const offer of offers)
            for (const type of spatial) {
              const { status } = assessHubertSpatialAction(
                f.state,
                observation,
                { type, targetId: offer.id },
                f.now,
              );
              expect(
                offeredTargets(choices, type).includes(offer.id),
                `${type} ${offer.id} at ${distance}`,
              ).toBe(status === 'ready' || status === 'approach');
            }
        }
  });

  it('cannot select a creature whose watch is cooling down, however its affordances read', () => {
    const f = fixture();
    f.world.entities = [{ ...creature, position: { x: 0, z: 3 } }];
    const observation = observeWorld(f.world, 'hubert', f.now);
    const selectable = (type: string) => {
      const format = narrowActionFormat(workingContext(f.state, observation).choices)
        .anyOf as Array<{ properties: { type: { const: string }; targetId?: { enum: string[] } } }>;
      return format.flatMap((alternative) =>
        alternative.properties.type.const === type
          ? (alternative.properties.targetId?.enum ?? [])
          : [],
      );
    };
    expect(observation.visibleEntities?.[0].affordances).toContain('inspect');
    expect(selectable('inspect')).toContain(creature.id);
    f.state.watchAttention.lastAt = f.now;
    // This is the reply the live model kept giving; it is declined, so it is no longer offered.
    expect(
      assessHubertSpatialAction(
        f.state,
        observation,
        { type: 'inspect', targetId: creature.id },
        f.now,
      ),
    ).toEqual({
      status: 'unavailable',
      reason: 'That creature is not available for this activity now.',
    });
    expect(selectable('inspect')).not.toContain(creature.id);
    expect(selectable('look')).toContain(creature.id);
    expect(selectable('inspect')).toContain(sundial.id);
  });

  it('offers non-spatial actions only while their sources exist', () => {
    const f = fixture();
    const observation = observeWorld(f.world, 'hubert', f.now);
    const quiet = workingContext(f.state, observation).choices!;
    const types = new Set(quiet.map((choice) => choice.type));
    for (const type of ['move', 'look', 'inspect', 'rest', 'reflect'])
      expect(types).toContain(type);
    for (const type of ['research', 'read', 'pin_creation', 'draft_mail', 'say', 'delegate'])
      expect(types).not.toContain(type);
    expect(quiet).toContainEqual({ type: 'move', where: { position: 'any' } });

    const creation = { id: 'chart', characterId: f.state.id } as unknown as PublicCreation;
    const other = { id: 'elsewhere', characterId: 'another' } as unknown as PublicCreation;
    const connected = workingContext(f.state, observation, f.now, false, [creation, other], {
      available: true,
      makerAvailable: false,
      publicEntries: [{ id: 'note-1', text: 'A sparrow.' }],
      contacts: [{ id: 'reader', name: 'Reader' }],
    }).choices!;
    expect(connected).toContainEqual({ type: 'pin_creation', where: { creationId: ['chart'] } });
    expect(connected.filter((choice) => choice.type === 'draft_mail')).toEqual([
      { type: 'draft_mail', where: { kind: ['newsletter'], entryIds: ['note-1'] } },
      {
        type: 'draft_mail',
        where: { kind: ['correspondence'], recipientUserId: ['reader'], entryIds: ['note-1'] },
      },
    ]);
    const halted = workingContext(f.state, observation, f.now, false, [], {
      available: false,
      publicEntries: [{ id: 'note-1', text: 'A sparrow.' }],
    }).choices!;
    expect(halted.some((choice) => choice.type === 'draft_mail')).toBe(false);
  });
});
