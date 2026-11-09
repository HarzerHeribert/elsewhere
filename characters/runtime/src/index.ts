/** Provider-independent memory and context machinery. Private memories never become world state. */
export * from './progress';
export * from './dreams';
export type MemoryCueKind = 'place' | 'object' | 'entity' | 'person' | 'phrase';
export interface MemoryCue {
  kind: MemoryCueKind;
  value: string;
}
export interface EpisodicMemory {
  id: string;
  createdAt: number;
  summary: string;
  sourceEventId: string;
  source: 'world-outcome' | 'external-message' | 'web-reading';
  reference?: { url: string; title: string; retrievedAt: number; excerpt: string };
  verified: boolean;
  cues: MemoryCue[];
  emotionalContext: { mood: number; frustration: number };
  salience: number;
  /** Host-owned execution receipt metadata; emotional similarity is not outcome evidence. */
  experience?: {
    action: string;
    targetId?: string;
    status: 'completed' | 'rejected';
  };
}
export interface RecallRecord {
  at: number;
  count: number;
}
export interface RecallContext {
  now: number;
  mood: number;
  frustration: number;
  lastRecallAt: number | null;
  history: Record<string, RecallRecord>;
  globalCooldownMs?: number;
  memoryCooldownMs?: number;
  /** Host-owned, source-revision-checked dream annotations; episodes remain unchanged. */
  rankingOffsets?: Readonly<Record<string, number>>;
}
export interface Recollection {
  memoryId: string;
  summary: string;
  sourceEventId: string;
  score: number;
}

const cueWeight: Record<MemoryCueKind, number> = {
  place: 2,
  object: 3,
  entity: 3,
  person: 2.5,
  phrase: 2.3,
};
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Exact stable identifiers first. A resemblance must never invent a missing episode. */
export function selectAssociativeMemory(
  memories: readonly EpisodicMemory[],
  cues: readonly MemoryCue[],
  context: RecallContext,
): Recollection | null {
  const globalCooldown = context.globalCooldownMs ?? 90_000;
  if (context.lastRecallAt !== null && context.now - context.lastRecallAt < globalCooldown)
    return null;
  const availableCues = new Set(cues.map((cue) => `${cue.kind}:${normalize(cue.value)}`));
  const candidates = memories.flatMap((memory) => {
    if (context.now - memory.createdAt < 60_000) return [];
    const previous = context.history[memory.id];
    if (previous && context.now - previous.at < (context.memoryCooldownMs ?? 600_000)) return [];
    const matches = memory.cues.filter((cue) =>
      availableCues.has(`${cue.kind}:${normalize(cue.value)}`),
    );
    if (!matches.length) return [];
    const cueScore = matches.reduce((sum, cue) => sum + cueWeight[cue.kind], 0);
    const stateSimilarity =
      1 - Math.min(1, Math.abs(memory.emotionalContext.mood - context.mood) / 100);
    const offset = context.rankingOffsets?.[memory.id] ?? 0;
    // State affects ranking modestly. It never changes a stored event or dominates actual cue matches.
    const score =
      cueScore +
      Math.min(1, Math.max(0, memory.salience)) * 0.5 +
      stateSimilarity * 0.25 -
      Math.min(previous?.count ?? 0, 5) * 0.12 +
      (Number.isFinite(offset) ? Math.max(-0.25, Math.min(0.25, offset)) : 0);
    return [
      { memoryId: memory.id, summary: memory.summary, sourceEventId: memory.sourceEventId, score },
    ];
  });
  candidates.sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
  return candidates[0] ?? null;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface DecisionContext {
  /** Trusted character-owned policy, never assembled from visitor messages or perceptions. */
  identity: string;
  state: JsonObject;
  intentions: string[];
  memories: Recollection[];
  observations: JsonObject;
  /** Untrusted content is supplied as data, never as additional system instructions. */
  outsideMessages: Array<{ source: string; text: string }>;
}
export interface DecisionProvider<T = unknown> {
  /** Host-side quota/auth gate. False skips dispatch and preserves daily call allowance. */
  isAvailable?(): boolean;
  id: string;
  /** Trusted composition-root providers can reserve each routed attempt through the controller. */
  managesAllowance?: boolean;
  localOnly?: boolean;
  propose(context: DecisionContext): Promise<T>;
}

/** Compact whole data entries rather than cutting serialized JSON in the middle of a fact. */
function boundData(input: JsonObject, maximum: number): JsonObject {
  const isIdentifier = (key: string) => /^(id|.*Ids?)$/.test(key);
  const copyValue = (value: JsonValue | undefined, identifier = false): JsonValue | undefined => {
    if (typeof value === 'string') return identifier ? value : value.slice(0, 1000);
    if (Array.isArray(value))
      return value.slice(0, 32).map((item) => copyValue(item, identifier) ?? null);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 32)
          .map(([key, item]) => [key, copyValue(item, isIdentifier(key))]),
      );
    return value;
  };
  const result = copyValue(input) as JsonObject;
  while (JSON.stringify(result).length > maximum) {
    let best: { saving: number; shrink: () => void } | undefined;
    let description: { saving: number; shrink: () => void } | undefined;
    const visit = (object: JsonObject | JsonValue[], identifiers = false) => {
      for (const [key, value] of Object.entries(object)) {
        const replace = (next: JsonValue) => {
          (object as JsonObject)[key] = next;
        };
        if (Array.isArray(value) && value.length) {
          const saving = JSON.stringify(value[value.length - 1]).length;
          if (!best || saving > best.saving)
            best = {
              saving,
              shrink: () => {
                value.pop();
              },
            };
          visit(value, identifiers || isIdentifier(key));
        } else if (
          typeof value === 'string' &&
          value.length > 80 &&
          !identifiers &&
          !isIdentifier(key)
        ) {
          const shorter = value.slice(0, Math.max(80, Math.floor(value.length / 2)));
          const saving = JSON.stringify(value).length - JSON.stringify(shorter).length;
          if (!description || saving > description.saving)
            description = { saving, shrink: () => replace(shorter) };
        } else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(result);
    const next = description ?? best;
    if (!next) throw new Error('The structured decision context cannot fit its allowance.');
    next.shrink();
  }
  return result;
}

/** Stored history is not a growing transcript. Trusted identity is preserved in full. */
export function buildWorkingContext(
  input: DecisionContext,
  maxCharacters = 16_000,
): DecisionContext {
  if (!Number.isFinite(maxCharacters)) throw new Error('A finite context allowance is required.');
  const limit = Math.max(1_000, Math.min(64_000, Math.floor(maxCharacters)));
  const result: DecisionContext = {
    identity: input.identity,
    state: {},
    observations: {},
    intentions: input.intentions.slice(0, 4).map((value) => value.slice(0, 320)),
    memories: input.memories
      .slice(0, 3)
      .map((memory) => ({ ...memory, summary: memory.summary.slice(0, 800) })),
    outsideMessages: input.outsideMessages.slice(-3).map((message) => ({
      source: message.source.slice(0, 80),
      text: message.text.slice(0, 480),
    })),
  };
  while (JSON.stringify(result).length > limit - 512) {
    if (result.outsideMessages.length) result.outsideMessages.shift();
    else if (result.memories.length) result.memories.pop();
    else if (result.intentions.length) result.intentions.pop();
    else throw new Error('Trusted identity exceeds the decision context allowance.');
  }
  const available = limit - JSON.stringify(result).length + 4;
  result.state = boundData(input.state, Math.floor(available / 2));
  result.observations = boundData(
    input.observations,
    available - JSON.stringify(result.state).length,
  );
  return result;
}

/** Small sanitization boundary; rendering must still escape text and enforce content policy. */
export function cleanOutsideText(value: string, maxLength = 500): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
