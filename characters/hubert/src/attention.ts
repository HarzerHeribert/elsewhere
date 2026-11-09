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
  type ProgressOpportunity,
} from '@elsewhere/character-runtime';
import { assessHubertSpatialAction, hubertActionOffers } from './actionOffers';
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

/** Record current feasible opportunities, never infer availability from a remembered object. */
function currentOpportunity(
  state: HubertState,
  action: CharacterCommand,
  targetId: string | undefined,
  observation: Observation | undefined,
  now: number,
): ProgressOpportunity {
  if (action.type === 'rest') return { status: 'available' };
  if (!observation)
    return {
      status: 'waiting',
      retryCondition: 'Observe the current surroundings before choosing a next step.',
    };
  const target = hubertActionOffers(state, observation, now, targetId).find(
    (offer) => offer.id === targetId,
  );
  const waitForPerception: ProgressOpportunity = {
    status: 'waiting',
    retryCondition:
      'Find the remembered target and observe it again before assuming an interaction is possible.',
  };
  if (action.type === 'reflect') {
    if (!target || !target.visible) return waitForPerception;
    const preferred = [
      ...(!state.inspections[target.id] ? ['inspect'] : []),
      ...(!state.project.completed ? ['work'] : []),
      'interact',
    ].find((type) => target.ready.includes(type as 'inspect' | 'work' | 'interact'));
    if (preferred)
      return { status: 'available', smallestStep: { type: preferred, targetKey: target.id } };
    if (target.nextAction && target.approachFor?.length)
      return { status: 'available', smallestStep: { type: 'move', targetKey: target.id } };
    if (target.cooldownUntil && target.cooldownUntil > now)
      return {
        status: 'waiting',
        retryAt: target.cooldownUntil,
        retryCondition: 'Wait for the activity cooldown or choose another current offer.',
      };
    return {
      status: 'blocked',
      retryCondition:
        'No current activity offer supports this idea; reconsider or leave it for later.',
    };
  }
  const assessment = assessHubertSpatialAction(state, observation, action, now);
  if (assessment.status === 'not-spatial')
    return {
      status: 'waiting',
      retryCondition:
        'Wait for the capability admission and execution receipt before treating this as an opportunity.',
    };
  if (target && !target.visible && target.kind !== 'place' && action.type !== 'move')
    return waitForPerception;
  if (assessment.status === 'ready' || assessment.status === 'approach') {
    const command = assessment.command;
    return {
      status: 'available',
      smallestStep: {
        type: command.type,
        ...('targetId' in command && command.targetId ? { targetKey: command.targetId } : {}),
      },
    };
  }
  if (target?.cooldownUntil && target.cooldownUntil > now)
    return {
      status: 'waiting',
      retryAt: target.cooldownUntil,
      retryCondition: 'Wait for the activity cooldown or choose another current offer.',
    };
  return { status: 'blocked', retryCondition: assessment.reason };
}

/** Map Hubert's current action and source evidence onto stable runtime intention references. */
export function trackHubertIntent(
  state: HubertState,
  action: CharacterCommand,
  now: number,
  observation?: Observation,
): void {
  const actionTargetId = 'targetId' in action ? action.targetId : undefined;
  const projectChosen =
    !state.project.completed &&
    (state.project.verifiedWorkSessions > 0 ||
      (state.activity.objectId === 'workbench' && ['work', 'move'].includes(state.activity.kind)));
  const visibleAlternative =
    action.type === 'reflect' && !projectChosen && observation
      ? hubertActionOffers(state, observation, now)
          .filter(
            (offer) =>
              offer.kind === 'object' &&
              offer.visible &&
              (offer.ready.some((type) => ['inspect', 'work', 'interact'].includes(type)) ||
                (offer.nextAction && offer.approachFor?.length)),
          )
          .sort(
            (a, b) =>
              Number((state.inspections[a.id] ?? 0) > 0) -
                Number((state.inspections[b.id] ?? 0) > 0) ||
              a.distance - b.distance ||
              a.id.localeCompare(b.id),
          )[0]
      : undefined;
  const targetId =
    actionTargetId ??
    (action.type === 'reflect'
      ? projectChosen &&
        (state.knownObjects.workbench ||
          observation?.visibleObjects.some((object) => object.id === 'workbench'))
        ? 'workbench'
        : visibleAlternative?.id
      : undefined);
  const intentionKey =
    (action.type === 'reflect' ? projectChosen : targetId === 'workbench') &&
    !state.project.completed
      ? `project:${state.project.id}`
      : targetId
        ? `object:${targetId}`
        : 'exploration';
  const opportunity = currentOpportunity(state, action, targetId, observation, now);
  const quietWatch =
    opportunity.status === 'available' &&
    opportunity.smallestStep?.type === action.type &&
    (action.type === 'look' ||
      (action.type === 'inspect' &&
        !!observation?.visibleEntities?.some((entity) => entity.id === targetId)));
  const kind =
    action.type === 'rest'
      ? 'rest'
      : quietWatch
        ? 'watch'
        : action.type === 'reflect'
          ? 'deliberate'
          : 'attempt';
  const decisionId = `decision:${state.turn}`;
  const recorded = recordProgressDecision(state.progress, {
    id: decisionId,
    at: now,
    intention: { key: intentionKey, ...(targetId ? { targetKey: targetId } : {}) },
    kind,
    opportunity,
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
    const targetId = guidance.smallestStep?.targetKey;
    const type = guidance.smallestStep?.type;
    if (targetId && type && ['move', 'inspect', 'work', 'interact'].includes(type)) {
      const assessment = assessHubertSpatialAction(
        state,
        observation,
        { type, targetId } as CharacterCommand,
        now,
      );
      if (assessment.status === 'ready' || assessment.status === 'approach') {
        state.progressGuidance = null;
        return recorders.recordIntent(
          state,
          assessment.command,
          assessment.status === 'approach'
            ? assessment.reason
            : 'I can try just one small step with this idea, then decide what I think.',
          now,
        );
      }
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
  const candidates = observation.visibleObjects.filter(
    (item) => item.id !== guidance.targetKey && item.affordances.includes('inspect'),
  );
  const fresh = candidates.filter((item) => !state.inspections[item.id]);
  const chooseObject = (object: (typeof candidates)[number]): HubertDecision | null => {
    const assessment = assessHubertSpatialAction(
      state,
      observation,
      { type: 'inspect', targetId: object.id },
      now,
    );
    if (assessment.status !== 'ready' && assessment.status !== 'approach') return null;
    return recorders.recordIntent(
      state,
      assessment.command,
      assessment.status === 'approach'
        ? assessment.reason
        : 'I have considered that enough for now. I will try one small thing I can actually see.',
      now,
    );
  };
  // A newly noticed object gets room before another familiar creature-watching detour.
  for (const object of fresh) {
    const decision = chooseObject(object);
    if (decision) return decision;
  }
  const entity = recorders.chooseVisibleEntity(state, observation, now);
  if (entity) {
    const assessment = assessHubertSpatialAction(
      state,
      observation,
      { type: 'inspect', targetId: entity.id },
      now,
    );
    if (assessment.status === 'ready')
      return recorders.recordWatchIntent(
        state,
        entity,
        'I will leave that idea for later and watch what this creature does for a while.',
        now,
      );
  }
  for (const object of candidates) {
    const decision = chooseObject(object);
    if (decision) return decision;
  }
  return recorders.recordIntent(
    state,
    { type: 'rest', durationMs: 30_000 },
    'I can leave that idea for later. I would like a quiet pause.',
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
    const proposed = dreamActionCommand(current);
    if (!proposed) continue;
    const assessment = assessHubertSpatialAction(state, observation, proposed, now);
    if (assessment.status !== 'ready' && assessment.status !== 'approach') {
      state.dreams = updateWakeImpulse(state.dreams, impulse.id, {
        status: 'deferred',
        nowReal,
        untilReal: nowReal + 3_600_000,
      });
      continue;
    }
    const action = assessment.command;
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
