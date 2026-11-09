import type { HubertState } from './index';

export interface InterestEvidence {
  lastAt: number;
  signatures: string[];
  sessions: number;
}
const ignoredTags = new Set([
  'workshop',
  'courtyard',
  'projects',
  'rest',
  'unfamiliar',
  'messages',
  'visitors',
]);
const interestName = (id: string) =>
  id === 'birds'
    ? 'Birdwatching'
    : id.replace(/[-_]/g, ' ').replace(/^./, (value) => value.toUpperCase());

export const INITIAL_BIRD_INTEREST_STRENGTH = 0.35;

/** Existing interests can be set aside, but their evidence counts are retained separately. */
function makeRoom(state: HubertState, protectedIds: readonly string[] = []): void {
  if (state.interests.length < 8) return;
  const candidates = state.interests
    .map((interest, index) => ({ interest, index }))
    .filter(({ interest }) => !protectedIds.includes(interest.id));
  candidates.sort(
    (a, b) =>
      a.interest.strength - b.interest.strength ||
      a.interest.encounters - b.interest.encounters ||
      a.interest.id.localeCompare(b.interest.id),
  );
  const index = candidates[0]?.index ?? state.interests.length - 1;
  const [removed] = state.interests.splice(index, 1);
  if (removed && !state.dormantInterests.some((item) => item.id === removed.id))
    state.dormantInterests.push(removed);
  // Archived statistics are derived summaries; the original source episodes remain in memory.
  if (state.dormantInterests.length > 72)
    state.dormantInterests = state.dormantInterests.slice(-72);
}

export function seedBirdInterest(state: HubertState): void {
  if (state.interestPolicyVersion !== 2) {
    const existing =
      state.interests.find((interest) => interest.id === 'birds') ??
      state.dormantInterests.find((interest) => interest.id === 'birds');
    if (existing) {
      // The owner lowered the authored prior from .82 to .35. Remove that difference
      // once, retaining earned encounters, evidence, other interests and archive status.
      existing.strength = Math.max(0.2, existing.strength - 0.47);
    }
    state.interestPolicyVersion = 2;
  }
  state.interestSchemaVersion = 1;
}

/** Only call for a verified world experience. A source/meaning signature is rewarded once. */
export function developInterests(
  state: HubertState,
  topics: readonly string[],
  sourceId: string,
  signature: string,
  now: number,
  cooldownMs = 120_000,
): boolean {
  const previous = state.interestEvidence[sourceId];
  if (previous?.signatures.includes(signature) || (previous && now - previous.lastAt < cooldownMs))
    return false;
  const meaningful = [
    ...new Set(topics.map((topic) => topic.toLowerCase().trim().replace(/\s+/g, '-'))),
  ]
    .filter((topic) => /^[a-z][a-z0-9-]{0,39}$/.test(topic) && !ignoredTags.has(topic))
    .slice(0, 4);
  if (!meaningful.length) return false;
  state.interestEvidence[sourceId] = {
    lastAt: now,
    sessions: (previous?.sessions ?? 0) + 1,
    signatures: [...(previous?.signatures ?? []), signature].slice(-16),
  };
  for (const id of meaningful) {
    let interest = state.interests.find((item) => item.id === id);
    if (!interest) {
      const archived = state.dormantInterests.find((item) => item.id === id);
      if (archived && state.interestChoices?.lastDispositions[id] === 'set-aside') {
        // Another encounter can add evidence without overruling Hubert's deliberate preference.
        const novelty = 1 / (1 + archived.encounters * 0.35);
        archived.strength = Math.min(0.97, archived.strength + 0.08 * novelty);
        archived.encounters++;
        continue;
      }
      makeRoom(state, meaningful);
      interest = archived
        ? { ...archived, strength: Math.max(0.2, archived.strength) }
        : { id, name: interestName(id), strength: 0.22, encounters: 0 };
      state.dormantInterests = state.dormantInterests.filter((item) => item.id !== id);
      state.interests.push(interest);
    }
    const novelty = 1 / (1 + interest.encounters * 0.35);
    interest.strength = Math.min(0.97, interest.strength + 0.08 * novelty);
    interest.encounters += 1;
  }
  return true;
}

/** Attention can fade; episodes and earned encounter counts remain as a personal history. */
export function relaxInterests(state: HubertState, elapsedMs: number): void {
  const hours = Math.max(0, Math.min(6 * 3600000, elapsedMs)) / 3600000;
  if (!hours) return;
  const attended = state.activity.objectId
    ? (state.knownObjects[state.activity.objectId] ?? state.knownEntities[state.activity.objectId])
    : undefined;
  for (const interest of state.interests) {
    if (!attended?.tags.includes(interest.id)) interest.strength *= Math.exp(-hours / 336);
  }
  const fading = state.interests.filter((interest) => interest.strength < 0.12);
  state.interests = state.interests.filter((interest) => interest.strength >= 0.12);
  for (const interest of fading) {
    const existing = state.dormantInterests.findIndex((item) => item.id === interest.id);
    if (existing >= 0) state.dormantInterests[existing] = interest;
    else state.dormantInterests.push(interest);
  }
  state.dormantInterests = state.dormantInterests.slice(-72);
}
