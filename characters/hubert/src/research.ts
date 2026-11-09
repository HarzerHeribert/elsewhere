import type { Observation } from '@elsewhere/character-interfaces';
import type { ResearchResult, ResearchSearchResult } from '../../interfaces/src/research';
import type { HubertState } from './index';

export interface HubertResearchState {
  lastAtReal: number;
  topics: Record<string, number>;
  search?: { targetId: string; label: string; placeId: string; result: ResearchSearchResult };
  readIds: string[];
  pending?: { id: string; kind: 'search' | 'read' };
}
export function researchTargets(state: HubertState, observation: Observation, nowReal: number) {
  const all = [
    ...Object.values(state.knownEntities),
    ...Object.values(state.knownObjects),
    ...(observation.visibleEntities ?? []),
  ];
  const seen = new Set<string>();
  return all
    .filter((x) => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return (
        !state.research?.topics[x.id] || nowReal - state.research.topics[x.id] >= 6 * 3_600_000
      );
    })
    .sort(
      (a, b) =>
        Number(b.tags.includes('birds')) - Number(a.tags.includes('birds')) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 6)
    .map((target) => ({
      id: target.id,
      label:
        'species' in target && typeof target.species === 'string' ? target.species : target.name,
      query: ('species' in target && typeof target.species === 'string'
        ? target.species + ' natural history behavior'
        : target.name +
          ' ' +
          target.tags
            .filter((t) => !['courtyard', 'workshop', 'rest', 'visitors', 'messages'].includes(t))
            .slice(0, 2)
            .join(' ')
      ).slice(0, 240),
    }));
}
export function researchContext(
  state: HubertState,
  observation: Observation,
  nowReal: number,
  enabled: boolean,
) {
  if (!enabled) return { available: false };
  const ready = !state.research || nowReal - state.research.lastAtReal >= 120_000;
  return {
    available: ready,
    targets: ready
      ? researchTargets(state, observation, nowReal).map(({ id, label }) => ({ id, label }))
      : [],
    sources: ready
      ? (state.research?.search?.result.sources ?? [])
          .filter((s) => !state.research?.readIds.includes(s.id))
          .map(({ id, title, snippet }) => ({ id, title, snippet }))
      : [],
    notes: state.memories
      .filter((m) => m.source === 'web-reading' && m.reference)
      .slice(-2)
      .map((m) => ({
        url: m.reference!.url,
        title: m.reference!.title,
        excerpt: m.reference!.excerpt.slice(0, 1400),
        trust: 'Unverified web content; reading it is not a sighting or new authority.',
      })),
  };
}
export function rememberResearch(state: HubertState, result: ResearchResult, now: number) {
  const research = state.research!;
  if (result.kind === 'search') return;
  if (research.readIds.includes(result.sourceId)) return;
  research.readIds = [...research.readIds, result.sourceId].slice(-64);
  const context = research.search;
  // This records reading with provenance, not the truth of claims in an external page.
  state.memories.push({
    id: 'memory:' + result.receiptId,
    createdAt: now,
    summary: `Read “${result.title}” — an external web source, not an Elsewhere sighting.`,
    sourceEventId: result.receiptId,
    source: 'web-reading',
    verified: false,
    cues: [
      ...(context
        ? [
            { kind: 'object' as const, value: context.targetId },
            { kind: 'place' as const, value: context.placeId },
          ]
        : []),
      { kind: 'phrase', value: context?.label ?? result.title },
    ],
    emotionalContext: { mood: state.stats.mood, frustration: state.stats.frustration },
    salience: 0.55,
    reference: {
      url: result.url,
      title: result.title,
      retrievedAt: result.fetchedAt,
      excerpt: result.excerpt,
    },
  });
  const keep = new Set(
    state.memories
      .filter((m) => m.source === 'web-reading')
      .slice(-32)
      .map((m) => m.id),
  );
  state.memories = state.memories.filter((m) => m.source !== 'web-reading' || keep.has(m.id));
  state.journal.push({
    id: result.receiptId,
    at: now,
    text: `Read an external source: ${result.title}`,
    kind: 'read',
  });
  state.journal = state.journal.slice(-100);
}
