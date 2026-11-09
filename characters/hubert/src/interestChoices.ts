import type { HubertState } from './index';

export type InterestDisposition = 'pursue' | 'set-aside';
export interface HubertInterestChoiceState {
  version: 1;
  /** Real wall-clock fence; simulation speed and a backwards clock cannot refill choices. */
  latestAtReal: number;
  day: string;
  choices: number;
  lastByInterest: Record<string, number>;
  /** Deliberately parked topics stay parked until Hubert explicitly resumes one. */
  lastDispositions: Record<string, InterestDisposition>;
}
export type InterestChoice = { interestId: string; disposition: InterestDisposition };
export type InterestChoiceOffer = InterestChoice & { name: string };
type ChoiceHost = HubertState & { interestChoices?: HubertInterestChoiceState };
export type InterestChoiceResult = {
  state: ChoiceHost;
  status: 'changed' | 'unchanged' | 'unavailable';
  reason?: string;
};
export const INTEREST_CHOICE_LIMITS = {
  perDay: 4,
  perTopicCooldownMs: 6 * 3_600_000,
  active: 8,
  trackedTopics: 72,
  resumedStrength: 0.2,
} as const;

function validTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
    throw Error('A finite non-negative real wall-clock time is required for interest choices.');
  return value;
}
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const validTopic = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 100;
const disposition = (value: unknown): value is InterestDisposition =>
  value === 'pursue' || value === 'set-aside';
function ledgerAt(input: ChoiceHost, nowReal: number): HubertInterestChoiceState {
  const now = validTime(nowReal);
  const saved = input.interestChoices;
  if (!saved)
    return {
      version: 1,
      latestAtReal: now,
      day: dayOf(now),
      choices: 0,
      lastByInterest: {},
      lastDispositions: {},
    };
  const last = validTime(saved.latestAtReal);
  if (
    saved.version !== 1 ||
    saved.day !== dayOf(last) ||
    !Number.isSafeInteger(saved.choices) ||
    saved.choices < 0 ||
    saved.choices > INTEREST_CHOICE_LIMITS.perDay ||
    !saved.lastByInterest ||
    !saved.lastDispositions
  )
    throw Error('Invalid persisted interest choice ledger.');
  const entries = Object.entries(saved.lastByInterest);
  if (
    entries.length > INTEREST_CHOICE_LIMITS.trackedTopics ||
    Object.keys(saved.lastDispositions).length !== entries.length ||
    entries.some(
      ([id, at]) =>
        !validTopic(id) ||
        !Number.isSafeInteger(at) ||
        at < 0 ||
        at > last ||
        !Object.hasOwn(saved.lastDispositions, id) ||
        !disposition(saved.lastDispositions[id]),
    )
  )
    throw Error('Invalid persisted interest choice history.');
  const at = Math.max(now, last);
  const day = dayOf(at);
  return {
    version: 1,
    latestAtReal: at,
    day,
    choices: day > saved.day ? 0 : saved.choices,
    lastByInterest: { ...saved.lastByInterest },
    lastDispositions: { ...saved.lastDispositions },
  };
}
function topicAvailable(ledger: HubertInterestChoiceState, id: string): boolean {
  const last = Object.hasOwn(ledger.lastByInterest, id) ? ledger.lastByInterest[id] : undefined;
  return (
    last === undefined || ledger.latestAtReal - last >= INTEREST_CHOICE_LIMITS.perTopicCooldownMs
  );
}
function knownTopics(state: ChoiceHost) {
  const counts = new Map<string, number>();
  for (const topic of [...state.interests, ...(state.dormantInterests ?? [])])
    counts.set(topic.id, (counts.get(topic.id) ?? 0) + 1);
  return counts;
}

/** Offers change focus only for already known interests; no preference or encounter is invented. */
export function availableInterestChoices(
  state: ChoiceHost,
  nowReal: number,
): InterestChoiceOffer[] {
  const ledger = ledgerAt(state, nowReal);
  if (ledger.choices >= INTEREST_CHOICE_LIMITS.perDay) return [];
  const counts = knownTopics(state);
  const eligible = (id: string) =>
    validTopic(id) && counts.get(id) === 1 && topicAvailable(ledger, id);
  return [
    ...state.interests
      .filter((topic) => eligible(topic.id))
      .map((topic) => ({
        interestId: topic.id,
        name: topic.name,
        disposition: 'set-aside' as const,
      })),
    ...(state.interests.length < INTEREST_CHOICE_LIMITS.active
      ? (state.dormantInterests ?? [])
          .filter((topic) => eligible(topic.id))
          .map((topic) => ({
            interestId: topic.id,
            name: topic.name,
            disposition: 'pursue' as const,
          }))
      : []),
  ].slice(0, INTEREST_CHOICE_LIMITS.trackedTopics);
}

/**
 * A host-admitted focus choice, separate from earned evidence, needs and automatic interest decay.
 * Persist the returned state even on a no-op/denial so its real-time fence remains monotonic.
 */
export function applyInterestChoice(
  input: ChoiceHost,
  choice: InterestChoice,
  nowReal: number,
): InterestChoiceResult {
  const ledger = ledgerAt(input, nowReal);
  const state: ChoiceHost = structuredClone(input);
  state.interestChoices = ledger;
  const unavailable = (reason: string): InterestChoiceResult => ({
    state,
    status: 'unavailable',
    reason,
  });
  if (!validTopic(choice.interestId) || !disposition(choice.disposition))
    return unavailable('Choose one of the offered known interests and dispositions.');
  const activeIndex = state.interests.findIndex((topic) => topic.id === choice.interestId);
  const dormantIndex = (state.dormantInterests ?? []).findIndex(
    (topic) => topic.id === choice.interestId,
  );
  const matches = knownTopics(state).get(choice.interestId) ?? 0;
  if (matches !== 1)
    return unavailable(
      matches === 0
        ? 'That interest is not known.'
        : 'That interest needs an unambiguous saved record.',
    );
  // Replaying a completed choice cannot consume allowance, award evidence or boost a preference.
  if (
    (choice.disposition === 'pursue' && activeIndex >= 0) ||
    (choice.disposition === 'set-aside' && dormantIndex >= 0)
  )
    return { state, status: 'unchanged' };
  if (ledger.choices >= INTEREST_CHOICE_LIMITS.perDay)
    return unavailable('The daily interest-choice allowance has been used.');
  if (!topicAvailable(ledger, choice.interestId))
    return unavailable('Leave this interest alone until its reconsideration cooldown ends.');
  if (choice.disposition === 'pursue' && state.interests.length >= INTEREST_CHOICE_LIMITS.active)
    return unavailable('Set aside an active interest before resuming another one.');
  if (choice.disposition === 'set-aside') {
    const [topic] = state.interests.splice(activeIndex, 1);
    state.dormantInterests ??= [];
    state.dormantInterests.push(topic);
  } else {
    const [topic] = state.dormantInterests.splice(dormantIndex, 1);
    // Conscious pursuit restores viable attention, not fictional encounters or an emotional reward.
    state.interests.push({
      ...topic,
      strength: Math.max(INTEREST_CHOICE_LIMITS.resumedStrength, topic.strength),
    });
  }
  ledger.choices++;
  const records = [
    ...Object.entries(ledger.lastByInterest)
      .filter(([id]) => id !== choice.interestId)
      .map(([id, at]) => ({ id, at, disposition: ledger.lastDispositions[id] })),
    { id: choice.interestId, at: ledger.latestAtReal, disposition: choice.disposition },
  ]
    .sort(
      (a, b) =>
        b.at - a.at ||
        Number(b.id === choice.interestId) - Number(a.id === choice.interestId) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, INTEREST_CHOICE_LIMITS.trackedTopics);
  ledger.lastByInterest = Object.fromEntries(records.map((record) => [record.id, record.at]));
  ledger.lastDispositions = Object.fromEntries(
    records.map((record) => [record.id, record.disposition]),
  );
  return { state, status: 'changed' };
}
