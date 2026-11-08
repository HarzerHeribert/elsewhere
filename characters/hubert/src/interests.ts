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

/** Existing interests can be set aside, but their evidence counts are retained separately. */
function makeRoom(state: HubertState, protectedIds: readonly string[] = []): void {
  if (state.interests.length < 8) return;
  const candidates = state.interests
    .map((interest, index) => ({ interest, index }))
    .filter(({ interest }) => interest.id !== 'birds' && !protectedIds.includes(interest.id));
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
  if (state.dormantInterests.length > 64)
    state.dormantInterests = state.dormantInterests.slice(-64);
}

export function seedBirdInterest(state: HubertState): void {
  if (state.interestSchemaVersion === 1) return;
  const current = state.interests.find((interest) => interest.id === 'birds');
  if (current) {
    current.name = 'Birdwatching';
    current.strength = Math.max(0.82, Math.min(1, current.strength));
  } else {
    const archived = state.dormantInterests.find((item) => item.id === 'birds');
    makeRoom(state);
    state.interests.unshift(
      archived
        ? { ...archived, name: 'Birdwatching', strength: Math.max(0.82, archived.strength) }
        : { id: 'birds', name: 'Birdwatching', strength: 0.82, encounters: 0 },
    );
    state.dormantInterests = state.dormantInterests.filter((item) => item.id !== 'birds');
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
      makeRoom(state, meaningful);
      interest = archived
        ? { ...archived }
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
