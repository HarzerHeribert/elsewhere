import type { HubertState } from './index';

/** A source a search returned for one pursuit. */
export interface ResearchOffer {
  pursuitId: string;
  sourceId: string;
  url: string;
  title: string;
  snippet: string;
  fetchedAt: number;
}
export interface HubertResearchState {
  /** Sources returned by searches, newest last. */
  offers: ResearchOffer[];
  readIds: string[];
  pending?: { id: string; kind: 'search' | 'read' };
}
export const RESEARCH_OFFERS_KEPT = 30;
export const RESEARCH_READ_IDS_KEPT = 64;
/** Offers expire with the gateway allowlist. */
const OFFER_LIFETIME_MS = 86_400_000;

export function createResearchState(): HubertResearchState {
  return { offers: [], readIds: [] };
}

/** Sources offered for the active pursuit, fetched within 24 hours and not yet read. */
export function readableSources(state: HubertState, nowReal: number): ResearchOffer[] {
  const activeId = state.pursuits.activeId;
  if (!activeId) return [];
  return state.research.offers.filter(
    (offer) =>
      offer.pursuitId === activeId &&
      nowReal - offer.fetchedAt < OFFER_LIFETIME_MS &&
      !state.research.readIds.includes(offer.sourceId),
  );
}

export function researchContext(state: HubertState, nowReal: number, enabled: boolean) {
  if (!enabled) return { available: false, sources: [] };
  return {
    available: true,
    sources: readableSources(state, nowReal).map(({ sourceId, title, snippet, url }) => ({
      id: sourceId,
      title,
      snippet,
      url,
    })),
  };
}
