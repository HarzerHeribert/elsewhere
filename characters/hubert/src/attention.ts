import type {
  CharacterCommand,
  Observation,
  WorldEntity,
  WorldOutcome,
} from '@elsewhere/character-interfaces';
import {
  recordProgressDecision,
  recordProgressOutcome,
  updateWakeImpulse,
  wakingDreamImpulses,
} from '@elsewhere/character-runtime';
import { dreamActionCommand, hubertDreamActions } from './dreams';
import type { HubertDecision, HubertState } from './index';

interface AttentionRecorders {
  recordIntent(
    state: HubertState,
    action: CharacterCommand,
    explanation: string,
    now: number,
  ): HubertDecision;
  recordWatchIntent(
    state: HubertState,
    entity: WorldEntity,
    explanation: string,
    now: number,
  ): HubertDecision;
  chooseVisibleEntity(
    state: HubertState,
    observation: Observation,
    now: number,
  ): WorldEntity | undefined;
}

/** Map Hubert's current action and source evidence onto stable runtime intention references. */
export function trackHubertIntent(state: HubertState, action: CharacterCommand, now: number): void {
  const actionTargetId = 'targetId' in action ? action.targetId : undefined;
  const targetId =
    actionTargetId ??
    (action.type === 'reflect' && !state.project.completed && state.knownObjects.workbench
      ? 'workbench'
      : undefined);
  const intentionKey =
    (action.type === 'reflect' || targetId === 'workbench') && !state.project.completed
      ? `project:${state.project.id}`
      : targetId
        ? `object:${targetId}`
        : 'exploration';
  const kind =
    action.type === 'rest'
      ? 'rest'
      : action.type === 'inspect' && !!state.knownEntities[targetId ?? '']
        ? 'watch'
        : action.type === 'look'
          ? 'watch'
          : action.type === 'reflect'
            ? 'deliberate'
            : 'attempt';
  const decisionId = `decision:${state.turn}`;
  const target = targetId ? state.knownObjects[targetId] : undefined;
  const smallType =
    target && !state.inspections[target.id] && target.affordances.includes('inspect')
      ? 'inspect'
      : target?.affordances.includes('work') && !state.project.completed
        ? 'work'
        : target?.affordances.includes('interact')
          ? 'interact'
          : undefined;
  const recorded = recordProgressDecision(state.progress, {
    id: decisionId,
    at: now,
    intention: { key: intentionKey, ...(targetId ? { targetKey: targetId } : {}) },
    kind,
    opportunity: {
      status: 'available',
      ...(targetId && smallType ? { smallestStep: { type: smallType, targetKey: targetId } } : {}),
    },
    evidence: state.memories
      .filter(
        (memory) =>
          memory.verified &&
          memory.source === 'world-outcome' &&
          (targetId ? memory.cues.some((cue) => cue.value === targetId) : false),
      )
      .slice(-2)
      .map((memory) => ({ id: memory.sourceEventId })),
  });
  state.progress = recorded.ledger;
  if (recorded.guidance) state.progressGuidance = recorded.guidance;
  state.progressDecision = { id: decisionId, intentionKey };
}

/** A bounded change of approach uses present observations, never the wording of a model plan. */
export function followThrough(
  state: HubertState,
  observation: Observation,
  now: number,
  recorders: AttentionRecorders,
): HubertDecision | null {
  const guidance = state.progressGuidance;
  if (!guidance) return null;
  if (guidance.kind === 'shrink' && guidance.reason === 'repeated-deliberation') {
    const object = observation.visibleObjects.find(
      (item) => item.id === guidance.smallestStep?.targetKey,
    );
    const type = guidance.smallestStep?.type;
    if (
      object &&
      type &&
      ['inspect', 'work', 'interact'].includes(type) &&
      object.affordances.includes(type) &&
      (type === 'inspect' || now - (state.lastObjectUse[object.id] ?? -Infinity) >= 90_000)
    ) {
      const close =
        Math.hypot(
          object.position.x - observation.position.x,
          object.position.z - observation.position.z,
        ) <=
        object.radius + 1;
      state.progressGuidance = null;
      return recorders.recordIntent(
        state,
        close
          ? ({ type, targetId: object.id } as CharacterCommand)
          : { type: 'move', targetId: object.id },
        'I can try just one small step with this idea, then decide what I think.',
        now,
      );
    }
  }
  const deferred = recordProgressDecision(state.progress, {
    id: `defer:${state.turn + 1}`,
    at: now,
    intention: { key: guidance.intentionKey },
    kind: 'defer',
    reason: 'Leave the repeated approach for later and try one small permitted alternative.',
  });
  state.progress = deferred.ledger;
  state.progressGuidance = null;
  const bird = recorders.chooseVisibleEntity(state, observation, now);
  if (bird)
    return recorders.recordWatchIntent(
      state,
      bird,
      'I will leave that idea for later and watch what this creature does for a while.',
      now,
    );
  const object =
    observation.visibleObjects.find(
      (item) =>
        item.id !== guidance.targetKey &&
        item.affordances.includes('inspect') &&
        !state.inspections[item.id],
    ) ??
    observation.visibleObjects.find(
      (item) => item.id !== guidance.targetKey && item.affordances.includes('inspect'),
    );
  if (!object)
    return recorders.recordIntent(
      state,
      { type: 'rest', durationMs: 30_000 },
      'I can leave that idea for later. I would like a quiet pause.',
      now,
    );
  const close =
    Math.hypot(
      object.position.x - observation.position.x,
      object.position.z - observation.position.z,
    ) <=
    object.radius + 1;
  return recorders.recordIntent(
    state,
    close ? { type: 'inspect', targetId: object.id } : { type: 'move', targetId: object.id },
    'I have considered that enough for now. I will try one small thing I can actually see.',
    now,
  );
}

/** Impulses are offered, not obligations. Recheck current affordances before even proposing one. */
export function wakeImpulseDecision(
  state: HubertState,
  observation: Observation,
  now: number,
  nowReal: number,
  recordIntent: AttentionRecorders['recordIntent'],
): HubertDecision | null {
  if (state.stats.energy < 55 || state.turn % 3 !== 0) return null;
  for (const impulse of wakingDreamImpulses(state.dreams, nowReal)) {
    const current = hubertDreamActions(state, observation, nowReal).find(
      (action) => action.id === impulse.affordanceId,
    );
    const relevant = impulse.sources.every((source) =>
      state.memories.some((memory) => memory.id === source.id),
    );
    if (!current || !relevant) {
      state.dreams = updateWakeImpulse(state.dreams, impulse.id, {
        status: 'deferred',
        nowReal,
        untilReal: nowReal + 3_600_000,
      });
      continue;
    }
    const action = dreamActionCommand(current);
    if (!action) continue;
    state.activeWakeImpulse = impulse.id;
    return recordIntent(
      state,
      action,
      'After resting, I feel like trying one small thing nearby.',
      now,
    );
  }
  return null;
}

/** Only world receipts settle the current attempt and any temporary waking impulse. */
export function settleHubertAttention(
  state: HubertState,
  outcome: WorldOutcome,
  now: number,
  nowReal: number,
): void {
  if (state.progressDecision) {
    state.progress = recordProgressOutcome(state.progress, {
      id: outcome.id,
      at: now,
      decisionId: state.progressDecision.id,
      intentionKey: state.progressDecision.intentionKey,
      status: outcome.status === 'rejected' ? 'blocked' : 'succeeded',
      // A world-admitted path is evidence of an attempt, not of arrival or project completion.
      // A completed no-op move has no such receipt and cannot clear deliberation counters.
      evidence:
        (outcome.status === 'completed' && Boolean(outcome.evidence)) ||
        (outcome.status === 'started' && outcome.command.type === 'move'),
    });
  }
  if (
    ((outcome.status === 'completed' && outcome.evidence) ||
      (outcome.status === 'started' && outcome.command.type === 'move')) &&
    state.progressGuidance?.intentionKey === state.progressDecision?.intentionKey
  ) {
    state.progressGuidance = null;
  }
  if (state.activeWakeImpulse) {
    state.dreams = updateWakeImpulse(
      state.dreams,
      state.activeWakeImpulse,
      outcome.status === 'rejected' || (outcome.status === 'completed' && !outcome.evidence)
        ? { status: 'deferred', nowReal, untilReal: nowReal + 3_600_000 }
        : { status: 'completed', nowReal },
    );
    state.activeWakeImpulse = null;
  }
}
