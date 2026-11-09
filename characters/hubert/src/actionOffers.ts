import { CharacterCommandSchema } from '@elsewhere/character-interfaces';
import type {
  CharacterCommand,
  Observation,
  WorldEntity,
  WorldObject,
  WorldOutcome,
} from '@elsewhere/character-interfaces';
import type { HubertState } from './index';

/** These match the world's admitted interaction reach and Hubert's attention policies. */
const OBJECT_REACH = 1.5;
const ENTITY_INSPECT_RANGE = 8;
const OBJECT_REUSE_COOLDOWN = 90_000;
const SUPPORTED_OBJECT_ACTIONS = ['inspect', 'interact', 'work'] as const;
type ObjectAction = (typeof SUPPORTED_OBJECT_ACTIONS)[number];

export type HubertTargetOffer = {
  id: string;
  name: string;
  kind: 'object' | 'entity' | 'place';
  visible: boolean;
  distance: number;
  /** Only these actions can be proposed against this target immediately. */
  ready: Array<'look' | ObjectAction | 'move'>;
  /** Moving is a proposal: the authoritative world still checks its path and destination. */
  approachFor?: ObjectAction[];
  nextAction?: { type: 'move'; targetId: string };
  cooldownUntil?: number;
  projectCompleted?: boolean;
  inspections?: number;
  interactions?: number;
  observedSessions?: number;
  visited?: boolean;
};

/** Keep world receipt feedback explicit. It is private planning data, never public prose. */
export type ActionOutcomeFeedback = {
  id: string;
  at: number;
  action: CharacterCommand['type'];
  status: WorldOutcome['status'];
  targetId?: string;
  summary: string;
};
export function actionOutcomeFeedback(outcome: WorldOutcome): ActionOutcomeFeedback {
  return {
    id: outcome.id,
    at: outcome.at,
    action: outcome.command.type,
    status: outcome.status,
    ...('targetId' in outcome.command && outcome.command.targetId
      ? { targetId: outcome.command.targetId }
      : {}),
    summary: outcome.summary.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 320),
  };
}

const distanceTo = (observation: Observation, target: WorldObject) =>
  Math.hypot(
    target.position.x - observation.position.x,
    target.position.z - observation.position.z,
  );
const entitySignature = (entity: WorldEntity) =>
  `${entity.kind}:${entity.species ?? 'unknown'}:${entity.behavior}`;

/** Observation supplies current visibility/facing/LOS; memory alone cannot authorize watching. */
export function canInspectObservedEntity(
  state: HubertState,
  entity: WorldEntity,
  observation: Observation,
  now: number,
): boolean {
  const current = observation.visibleEntities?.find((item) => item.id === entity.id);
  if (
    !current ||
    !current.affordances.includes('inspect') ||
    distanceTo(observation, current) > ENTITY_INSPECT_RANGE
  )
    return false;
  return entityAttentionReady(state, current, now);
}

function entityAttentionReady(state: HubertState, current: WorldEntity, now: number): boolean {
  if (state.watchAttention.lastAt !== null && now - state.watchAttention.lastAt < 120_000)
    return false;
  if (state.watchAttention.times.filter((at) => now - at < 900_000).length >= 3) return false;
  const previous = state.entityObservations[current.id];
  if (!previous) return true;
  const familiar = previous.signatures.includes(entitySignature(current));
  return (
    current.observationVersion > previous.lastVersion &&
    now - previous.lastAt >= (familiar ? 6 * 3_600_000 : 180_000)
  );
}

/**
 * Compact planning offers from current perception and remembered destinations.
 * No hidden details, stale entity positions, arbitrary URL or private world geometry is exposed.
 * Object perception is intentionally conservative: an unseen remembered object is a destination,
 * not proof its inspection/interactions can currently succeed. Execution remains world-owned.
 */
export function hubertActionOffers(
  state: HubertState,
  observation: Observation,
  now: number,
  preferredTargetId?: string,
): HubertTargetOffer[] {
  if (observation.characterId !== state.id)
    throw Error('Action offers belong to another character.');
  const visibleObjects = new Map(observation.visibleObjects.map((object) => [object.id, object]));
  const objects = new Map(Object.values(state.knownObjects).map((object) => [object.id, object]));
  for (const [id, object] of visibleObjects) objects.set(id, object);
  const objectOffers: HubertTargetOffer[] = [...objects.values()]
    .sort(
      (a, b) =>
        Number(b.id === preferredTargetId) - Number(a.id === preferredTargetId) ||
        Number(visibleObjects.has(b.id)) - Number(visibleObjects.has(a.id)) ||
        distanceTo(observation, a) - distanceTo(observation, b) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 16)
    .map((object) => {
      const visible = visibleObjects.has(object.id);
      const distance = distanceTo(observation, object);
      const cooldownUntil = (state.lastObjectUse[object.id] ?? -Infinity) + OBJECT_REUSE_COOLDOWN;
      const supported = SUPPORTED_OBJECT_ACTIONS.filter((action) =>
        object.affordances.includes(action),
      );
      const available = supported.filter((action) => action === 'inspect' || now >= cooldownUntil);
      const withinReach = visible && distance <= object.radius + OBJECT_REACH;
      return {
        id: object.id,
        name: object.name,
        kind: 'object' as const,
        visible,
        distance,
        inspections: state.inspections[object.id] ?? 0,
        interactions: state.interactions[object.id] ?? 0,
        ready: [...(visible ? (['look'] as const) : []), ...(withinReach ? available : [])],
        ...(!withinReach
          ? { nextAction: { type: 'move' as const, targetId: object.id }, approachFor: available }
          : {}),
        ...(cooldownUntil > now ? { cooldownUntil } : {}),
        ...(object.id === 'workbench' && state.project.completed ? { projectCompleted: true } : {}),
      };
    });
  const entityOffers: HubertTargetOffer[] = (observation.visibleEntities ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.id === preferredTargetId) - Number(a.id === preferredTargetId) ||
        distanceTo(observation, a) - distanceTo(observation, b) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 8)
    .map((entity) => {
      const canInspect = canInspectObservedEntity(state, entity, observation, now);
      const far = distanceTo(observation, entity) > ENTITY_INSPECT_RANGE;
      return {
        id: entity.id,
        name: entity.name,
        kind: 'entity' as const,
        visible: true,
        distance: distanceTo(observation, entity),
        observedSessions: state.entityObservations[entity.id]?.sessions ?? 0,
        ready: ['look', ...(canInspect ? (['inspect'] as const) : [])],
        ...(far &&
        entity.affordances.includes('inspect') &&
        entityAttentionReady(state, entity, now)
          ? {
              nextAction: { type: 'move' as const, targetId: entity.id },
              approachFor: ['inspect' as const],
            }
          : {}),
      };
    });
  const places: HubertTargetOffer[] = (observation.knownPlaces ?? [])
    .slice()
    .sort((a, b) => Number(b.id === preferredTargetId) - Number(a.id === preferredTargetId))
    .slice(0, 8)
    .map((place) => ({
      id: place.id,
      name: place.name,
      kind: 'place',
      visible: place.id === observation.placeId,
      visited: state.visitedPlaces[place.id] !== undefined,
      distance: Math.hypot(
        place.position.x - observation.position.x,
        place.position.z - observation.position.z,
      ),
      ready: ['move'],
    }));
  return [...objectOffers, ...entityOffers, ...places];
}

export type SpatialActionAssessment =
  | { status: 'ready'; command: CharacterCommand }
  | { status: 'approach'; command: { type: 'move'; targetId: string }; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'not-spatial' };

/** Repair distance prerequisites explicitly; never invent a successful inspection or action. */
export function assessHubertSpatialAction(
  state: HubertState,
  observation: Observation,
  command: CharacterCommand,
  now: number,
): SpatialActionAssessment {
  if (!CharacterCommandSchema.safeParse(command).success)
    return { status: 'unavailable', reason: 'That action does not match the command contract.' };
  if (!['move', 'look', 'inspect', 'interact', 'work'].includes(command.type))
    return { status: 'not-spatial' };
  if (command.type === 'move' && command.position) return { status: 'ready', command }; // Geometry/path admission belongs to the world.
  const targetId = 'targetId' in command ? command.targetId : undefined;
  const offer = hubertActionOffers(state, observation, now, targetId).find(
    (target) => target.id === targetId,
  );
  if (!offer) return { status: 'unavailable', reason: 'That target is not currently offered.' };
  if (command.type === 'move') {
    if (offer.kind === 'entity' && !offer.visible)
      return { status: 'unavailable', reason: 'That creature is not currently visible.' };
    return { status: 'ready', command };
  }
  if (offer.kind === 'place')
    return {
      status: 'unavailable',
      reason: 'A place is a destination, not an interactable object.',
    };
  const type = command.type as 'look' | ObjectAction;
  if (offer.ready.includes(type)) return { status: 'ready', command };
  if (offer.nextAction && offer.approachFor?.includes(type as ObjectAction))
    return {
      status: 'approach',
      command: offer.nextAction,
      reason: `Move closer to ${offer.name.toLowerCase()} before ${type === 'inspect' ? 'inspecting it' : 'trying that activity'}.`,
    };
  return {
    status: 'unavailable',
    reason:
      offer.cooldownUntil && offer.cooldownUntil > now
        ? 'That activity is cooling down; choose another activity or a quiet pause.'
        : offer.kind === 'entity'
          ? 'That creature is not available for this activity now.'
          : 'That activity is not currently available for this object.',
  };
}
