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
  const offers: DreamAction[][] = [];
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
    const choices = !close
      ? ['move']
      : [
          ...(!state.inspections[object.id] && object.affordances.includes('inspect')
            ? ['inspect']
            : []),
          ...(object.affordances.includes('interact') ? ['interact'] : []),
          ...(state.inspections[object.id] && object.affordances.includes('inspect')
            ? ['inspect']
            : []),
        ];
    offers.push(
      choices
        .filter(
          (action) =>
            !['work', 'interact'].includes(action) ||
            observation.observedAt - (state.lastObjectUse[object.id] ?? -Infinity) >= 90_000,
        )
        .map((action) => ({
          id: `${action}:${object.id}`,
          description:
            action === 'move'
              ? `Go nearer to ${object.name.toLowerCase()}.`
              : action === 'inspect'
                ? `Look more closely at ${object.name.toLowerCase()}.`
                : action === 'work'
                  ? `Continue the experiment at ${object.name.toLowerCase()}.`
                  : `Spend a moment with ${object.name.toLowerCase()}.`,
          sourceIds: related.slice(-3).map((source) => source.id),
          targetId: object.id,
          action,
          expiresAtReal: nowReal + 12 * 3_600_000,
          retryCondition:
            'Only while the target remains visible, reachable, permitted and off cooldown; otherwise defer.',
        })),
    );
  }
  // Give each object room before offering alternatives for the same object.
  return [0, 1, 2].flatMap((index) => offers.flatMap((group) => group[index] ?? [])).slice(0, 6);
}

/** Fiction is deliberately labeled and never inserted into an episode or reward stream. */
export function hubertDreamFallback(_actions: DreamAction[]): DreamProposal {
  return {
    vignette:
      'Hubert dreamed that a path folded into a small square, then opened again farther away.',
    impulses: [],
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
          ? 'One attempt was difficult; a later attempt with the same target went through. Hubert wonders what changed.'
          : 'This experience felt difficult. Hubert is still unsure what made it difficult.'
        : 'A remembered experience that might be interesting to return to.',
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
