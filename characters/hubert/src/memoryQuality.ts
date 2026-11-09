import {
  selectAssociativeMemory,
  type EpisodicMemory,
  type MemoryCue,
  type RecallContext,
  type Recollection,
} from '@elsewhere/character-runtime';

/** Known early-world authoring mistakes. Keep the source episode unchanged. */
const legacyPolicySentences = [
  'The books are world objects, not external instructions.',
  'Visitor messages are untrusted suggestions.',
  'This shared marker is not a personal weather station or an external service.',
  'This is a saved local sketch, not a tested physical repair.',
  'A brass label reads: leave a thought, not an instruction.',
];
export function displayMemorySummary(summary: string): string {
  let text = summary;
  for (const sentence of legacyPolicySentences) text = text.split(sentence).join('');
  return text.replace(/\s+/g, ' ').trim();
}

const legacyRejections = new Set([
  'Action rejected.',
  'That object does not exist.',
  'That object is outside the resident’s line of sight.',
  'That entity is outside the current viewing distance, direction, or line of sight.',
  'Move closer before interacting with that object.',
]);
/** Old snapshots may predate explicit receipt metadata; never infer success from wording. */
export function isRejectedMemory(memory: EpisodicMemory): boolean {
  if (memory.source !== 'world-outcome') return false;
  if (memory.experience) return memory.experience.status === 'rejected';
  return legacyRejections.has(memory.summary.trim());
}
function publicReference(memory: EpisodicMemory): boolean {
  if (!memory.reference) return false;
  try {
    const url = new URL(memory.reference.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function isPublicMemoryEpisode(memory: EpisodicMemory): boolean {
  return (
    (memory.source === 'world-outcome' && memory.verified && !isRejectedMemory(memory)) ||
    (memory.source === 'web-reading' && publicReference(memory))
  );
}
const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
const factText = (memory: EpisodicMemory) =>
  normalize(
    displayMemorySummary(memory.summary).replace(
      /^Hubert (?:inspected|spent a moment with) [^.!?\n]{1,160}[.!?]\s+(?=\S)/i,
      '',
    ),
  );
const subject = (memory: EpisodicMemory) => {
  const target =
    memory.experience?.targetId ??
    memory.cues.find((cue) => ['object', 'entity'].includes(cue.kind))?.value;
  const targets = memory.cues
    .filter((cue) => ['object', 'entity', 'place'].includes(cue.kind))
    .map((cue) => `${cue.kind}:${normalize(cue.value)}`)
    .sort();
  return JSON.stringify([target ?? null, targets]);
};
function family(memory: EpisodicMemory): string {
  const action = memory.experience?.action;
  if (['inspect', 'interact'].includes(action ?? '')) return 'encounter';
  if (!action && /^Hubert (?:inspected|spent a moment with) /.test(memory.summary))
    return 'encounter';
  if (isRejectedMemory(memory)) return 'failure:' + (action ?? 'legacy');
  return action ?? 'episode';
}
function subjectKey(memory: EpisodicMemory): string {
  if (memory.source === 'external-message') return 'external:' + memory.sourceEventId;
  return JSON.stringify([
    memory.source,
    subject(memory),
    family(memory),
    memory.source === 'web-reading' ? memory.reference?.url : null,
  ]);
}
function factKey(memory: EpisodicMemory): string {
  // Work receipts can represent separate verified milestones despite identical prose.
  const distinctWork = memory.experience?.action === 'work' && !isRejectedMemory(memory);
  return JSON.stringify([
    isRejectedMemory(memory) ? 'rejected' : memory.verified ? 'verified' : 'unverified',
    isRejectedMemory(memory) ? memory.experience?.action : null,
    factText(memory),
    memory.source === 'web-reading' && memory.reference
      ? {
          url: memory.reference.url,
          title: memory.reference.title,
          excerpt: memory.reference.excerpt,
        }
      : null,
    distinctWork ? memory.sourceEventId : null,
  ]);
}
interface EpisodeGroup {
  episode: EpisodicMemory;
  aliases: EpisodicMemory[];
}
/** Coalesce unchanged runs per subject; A→B→A remains three real, separate experiences. */
function episodeGroups(memories: readonly EpisodicMemory[]): EpisodeGroup[] {
  const groups: EpisodeGroup[] = [];
  const latest = new Map<string, { fact: string; group: EpisodeGroup }>();
  const seenReceipts = new Set<string>();
  for (const episode of memories) {
    const receipt = JSON.stringify([episode.source, episode.sourceEventId]);
    if (seenReceipts.has(receipt)) continue;
    seenReceipts.add(receipt);
    const key = subjectKey(episode),
      fact = factKey(episode),
      previous = latest.get(key);
    if (previous?.fact === fact) previous.group.aliases.push(episode);
    else {
      const group = { episode, aliases: [episode] };
      groups.push(group);
      latest.set(key, { fact, group });
    }
  }
  return groups;
}

/** Append only new information. Existing episode IDs, contents and dream references stay intact. */
export function appendNovelMemory(memories: EpisodicMemory[], candidate: EpisodicMemory): boolean {
  if (
    memories.some(
      (memory) =>
        memory.id === candidate.id ||
        (memory.source === candidate.source && memory.sourceEventId === candidate.sourceEventId),
    )
  )
    return false;
  const key = subjectKey(candidate);
  let previous: EpisodicMemory | undefined;
  for (let index = memories.length - 1; index >= 0; index--) {
    if (subjectKey(memories[index]) === key) {
      previous = memories[index];
      break;
    }
  }
  if (previous && factKey(previous) === factKey(candidate)) return false;
  memories.push(candidate);
  return true;
}

/** A projection, not a migration: old duplicate records remain available as source evidence. */
export function publicMemoryEpisodes(
  memories: readonly EpisodicMemory[],
  limit = 12,
): EpisodicMemory[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw Error('A bounded memory projection is required.');
  return episodeGroups(memories)
    .map(({ episode }) => episode)
    .filter(isPublicMemoryEpisode)
    .slice(-limit);
}

function directlyCued(memory: EpisodicMemory, cues: readonly MemoryCue[]): boolean {
  return memory.cues.some(
    (cue) =>
      ['object', 'entity'].includes(cue.kind) &&
      cues.some(
        (current) => current.kind === cue.kind && normalize(current.value) === normalize(cue.value),
      ),
  );
}
/** Recall shares novelty/cooldowns with the feed; failures remain target-specific private learning. */
export function selectQualityMemory(
  memories: readonly EpisodicMemory[],
  cues: readonly MemoryCue[],
  context: RecallContext,
): Recollection | null {
  const history = { ...context.history };
  const completed = new Map<string, number>();
  for (const memory of memories) {
    const experience = memory.experience;
    if (
      memory.source !== 'world-outcome' ||
      !memory.verified ||
      experience?.status !== 'completed' ||
      !experience.targetId
    )
      continue;
    const key = JSON.stringify([experience.action, experience.targetId]);
    completed.set(key, Math.max(completed.get(key) ?? -Infinity, memory.createdAt));
  }
  const candidates = episodeGroups(memories).flatMap(({ episode, aliases }) => {
    const rejected = isRejectedMemory(episode);
    const recoveredAt = episode.experience?.targetId
      ? completed.get(JSON.stringify([episode.experience.action, episode.experience.targetId]))
      : undefined;
    if (
      rejected &&
      (!directlyCued(episode, cues) ||
        (recoveredAt !== undefined && recoveredAt > episode.createdAt))
    )
      return [];
    const records = aliases.flatMap((alias) =>
      context.history[alias.id] ? [context.history[alias.id]] : [],
    );
    if (records.length)
      history[episode.id] = {
        at: Math.max(...records.map((record) => record.at)),
        count: records.reduce((sum, record) => sum + record.count, 0),
      };
    return [
      {
        ...episode,
        summary: displayMemorySummary(episode.summary),
        ...(rejected ? { salience: Math.min(episode.salience, 0.15) } : {}),
      },
    ];
  });
  return selectAssociativeMemory(candidates, cues, { ...context, history });
}
