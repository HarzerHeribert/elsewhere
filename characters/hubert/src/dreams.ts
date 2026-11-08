import {
  toDreamSource,
  type DreamAction,
  type DreamSource,
  type DreamProposal,
} from '@elsewhere/character-runtime';
import type { CharacterCommand, Observation } from '@elsewhere/character-interfaces';
import type { HubertState } from './index';

/** Only lived, verified episodes enter this first dream implementation. Visitor notes stay private. */
export function hubertDreamSources(state: HubertState): DreamSource[] {
  return state.memories
    .filter((memory) => memory.verified && memory.source === 'world-outcome')
    .map((memory) => toDreamSource(memory, undefined, state.recallHistory[memory.id]?.count ?? 0));
}

/** These are offers for one small step, not permission for a model-created command. */
export function hubertDreamActions(
  state: HubertState,
  observation: Observation,
  nowReal: number,
  sources = hubertDreamSources(state),
): DreamAction[] {
  const actions: DreamAction[] = [];
  for (const object of observation.visibleObjects) {
    const related = sources.filter((source) =>
      source.cues.some(
        (cue) =>
          (cue.kind === 'object' && cue.value === object.id) ||
          (cue.kind === 'place' && cue.value === observation.placeId),
      ),
    );
    if (!related.length) continue;
    const close =
      Math.hypot(
        object.position.x - observation.position.x,
        object.position.z - observation.position.z,
      ) <=
      object.radius + 1;
    const action = !close
      ? 'move'
      : !state.inspections[object.id] && object.affordances.includes('inspect')
        ? 'inspect'
        : object.affordances.includes('work') && !state.project.completed
          ? 'work'
          : object.affordances.includes('interact')
            ? 'interact'
            : object.affordances.includes('inspect')
              ? 'inspect'
              : null;
    if (!action) continue;
    if (
      ['work', 'interact'].includes(action) &&
      observation.observedAt - (state.lastObjectUse[object.id] ?? -Infinity) < 90_000
    )
      continue;
    actions.push({
      id: `${action}:${object.id}`,
      description: `Try one ${action} step with ${object.name.toLowerCase()}.`,
      sourceIds: related.slice(-3).map((source) => source.id),
      targetId: object.id,
      action,
      expiresAtReal: nowReal + 12 * 3_600_000,
      retryCondition:
        'Only while the target remains visible, reachable, permitted and off cooldown; otherwise defer.',
    });
  }
  return actions.slice(0, 6);
}

/** Fiction is deliberately labeled and never inserted into an episode or reward stream. */
export function hubertDreamFallback(actions: DreamAction[]): DreamProposal {
  return {
    vignette:
      'An imagined dream: a duck directed sparrows toward a teacup runway. Hubert woke curious about one small thing, without mistaking it for a sighting.',
    impulses: actions.slice(0, 2).map((action) => ({
      affordanceId: action.id,
      reason: 'Perhaps try a small, familiar experiment after resting.',
    })),
  };
}

/** A bad episode stays factual. Only a supported, revisable interpretation changes its weight. */
export function hubertDreamInterpretations(sources: DreamSource[]) {
  return sources.map((memory) => {
    const contrary = sources.find(
      (other) =>
        other.id !== memory.id &&
        other.createdAt > memory.createdAt &&
        memory.experience?.status === 'rejected' &&
        other.experience?.status === 'completed' &&
        Boolean(memory.experience.targetId) &&
        other.experience.targetId === memory.experience.targetId &&
        other.experience.action === memory.experience.action,
    );
    const uncomfortable =
      memory.experience?.status === 'rejected' ||
      memory.emotionalContext.mood < 40 ||
      memory.emotionalContext.frustration > 50;
    return {
      memoryId: memory.id,
      sourceIds: contrary && uncomfortable ? [memory.id, contrary.id] : [memory.id],
      text: uncomfortable
        ? contrary
          ? 'This action was rejected once; a later verified attempt with the same target completed. Current permission, hazards and resources still need checking.'
          : 'This experience felt difficult. Its cause remains unresolved; it does not establish that every future attempt will fail.'
        : 'A remembered experience worth revisiting, without treating it as a guarantee of future success.',
      status: uncomfortable && !contrary ? ('unresolved' as const) : ('active' as const),
      retrievalOffset: uncomfortable ? (contrary ? -0.15 : 0) : 0.1,
    };
  });
}

export function dreamActionCommand(
  action: Pick<DreamAction, 'action' | 'targetId'>,
): CharacterCommand | null {
  if (!['move', 'inspect', 'work', 'interact'].includes(action.action)) return null;
  return { type: action.action, targetId: action.targetId } as CharacterCommand;
}
