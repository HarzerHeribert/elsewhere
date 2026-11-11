/** A pursuit is a question a character chose to follow, with what it searched, read and noted. */
export type PursuitEntry = { id: string; at: number } & (
  | { kind: 'search'; query: string; sourceCount: number }
  | { kind: 'read'; sourceId: string; url: string; title: string }
  | { kind: 'note'; text: string; surprised: boolean; sourceIds: string[] }
  | {
      kind: 'made';
      creationId: string;
      path: string;
      title: string;
      url: string;
      commitSha: string;
    }
  | { kind: 'tried'; text: string; objectId: string }
);
export type PursuitStatus = 'active' | 'open' | 'set-aside';
export interface Pursuit {
  id: string;
  question: string;
  why: string;
  status: PursuitStatus;
  openedAt: number;
  lastAt: number;
  entries: PursuitEntry[];
  /** Open follow-up questions. */
  questions: string[];
  setAsideReason?: string;
}
export interface PursuitReading {
  sourceId: string;
  url: string;
  title: string;
  text: string;
  at: number;
}
export interface PursuitState {
  activeId?: string;
  items: Pursuit[];
  reading: PursuitReading[];
}
export const PURSUIT_LIMITS = {
  items: 12,
  entries: 40,
  entrySlack: 8,
  questions: 4,
  reading: 2,
  readingText: 12000,
  question: 240,
  why: 240,
  note: 600,
  tried: 240,
  setAsideReason: 240,
} as const;

const cut = (value: string, maximum: number) => value.trim().slice(0, maximum);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function createPursuitState(): PursuitState {
  return { items: [], reading: [] };
}

function find(state: PursuitState, id: string): Pursuit {
  const found = state.items.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown pursuit: ${id}`);
  return found;
}
function update(state: PursuitState, id: string, change: (item: Pursuit) => Pursuit): PursuitState {
  find(state, id);
  return { ...state, items: state.items.map((item) => (item.id === id ? change(item) : item)) };
}
/** Makes `id` active and demotes the previously active pursuit to 'open'. */
function activate(state: PursuitState, id: string, now: number): PursuitState {
  const items = state.items.map((item) => {
    if (item.id === id) {
      const { setAsideReason: _dropped, ...rest } = item;
      return { ...rest, status: 'active' as const, lastAt: now };
    }
    return item.status === 'active' ? { ...item, status: 'open' as const } : item;
  });
  return { ...state, activeId: id, items };
}

export function openPursuit(
  state: PursuitState,
  input: { id: string; question: string; why: string },
  now: number,
): PursuitState {
  const question = cut(input.question, PURSUIT_LIMITS.question);
  if (!question) throw new Error('A pursuit needs a question.');
  if (state.items.some((item) => item.id === input.id))
    throw new Error(`Pursuit already exists: ${input.id}`);
  const existing = state.items.find(
    (item) => item.status !== 'set-aside' && same(item.question, question),
  );
  if (existing) return activate(state, existing.id, now);
  const created: Pursuit = {
    id: input.id,
    question,
    why: cut(input.why, PURSUIT_LIMITS.why),
    status: 'active',
    openedAt: now,
    lastAt: now,
    entries: [],
    questions: [],
  };
  let items = [
    ...state.items.map((item) =>
      item.status === 'active' ? { ...item, status: 'open' as const } : item,
    ),
    created,
  ];
  while (items.length > PURSUIT_LIMITS.items) {
    const oldest = (status: PursuitStatus) =>
      items
        .filter((item) => item.status === status && item.id !== created.id)
        .reduce<Pursuit | undefined>((a, b) => (!a || b.lastAt < a.lastAt ? b : a), undefined);
    const victim = oldest('set-aside') ?? oldest('open');
    if (!victim) break;
    items = items.filter((item) => item.id !== victim.id);
  }
  return { ...state, activeId: created.id, items };
}

export function resumePursuit(state: PursuitState, pursuitId: string, now: number): PursuitState {
  find(state, pursuitId);
  return activate(state, pursuitId, now);
}

export function setAsidePursuit(
  state: PursuitState,
  pursuitId: string,
  reason: string,
  now: number,
): PursuitState {
  const next = update(state, pursuitId, (item) => ({
    ...item,
    status: 'set-aside',
    setAsideReason: cut(reason, PURSUIT_LIMITS.setAsideReason),
    lastAt: now,
  }));
  if (state.activeId !== pursuitId) return next;
  const { activeId: _cleared, ...rest } = next;
  return rest;
}

function cleanEntry(entry: PursuitEntry): PursuitEntry {
  if (entry.kind === 'tried') return { ...entry, text: cut(entry.text, PURSUIT_LIMITS.tried) };
  return entry.kind === 'note'
    ? { ...entry, text: cut(entry.text, PURSUIT_LIMITS.note), sourceIds: [...entry.sourceIds] }
    : { ...entry };
}
const trimmed = <T>(entries: T[]): T[] =>
  entries.length > PURSUIT_LIMITS.entries + PURSUIT_LIMITS.entrySlack
    ? entries.slice(-PURSUIT_LIMITS.entries)
    : entries;

export function recordPursuitEntry(
  state: PursuitState,
  pursuitId: string,
  entry: PursuitEntry,
  now: number,
): PursuitState {
  return update(state, pursuitId, (item) => ({
    ...item,
    // Trimmed in steps, not every time, so consecutive decision contexts share a long prefix.
    entries: trimmed([...item.entries, cleanEntry(entry)]),
    lastAt: now,
  }));
}

export function addPursuitQuestion(
  state: PursuitState,
  pursuitId: string,
  question: string,
  now: number,
): PursuitState {
  const text = cut(question, PURSUIT_LIMITS.question);
  return update(state, pursuitId, (item) => {
    if (!text || item.questions.some((known) => same(known, text))) return item;
    return {
      ...item,
      questions: [...item.questions, text].slice(-PURSUIT_LIMITS.questions),
      lastAt: now,
    };
  });
}

export function resolvePursuitQuestion(
  state: PursuitState,
  pursuitId: string,
  question: string,
): PursuitState {
  return update(state, pursuitId, (item) => ({
    ...item,
    questions: item.questions.filter((known) => !same(known, question)),
  }));
}

export function recordPursuitReading(state: PursuitState, reading: PursuitReading): PursuitState {
  const page = { ...reading, text: reading.text.slice(0, PURSUIT_LIMITS.readingText) };
  return {
    ...state,
    reading: [page, ...state.reading.filter((known) => known.sourceId !== page.sourceId)].slice(
      0,
      PURSUIT_LIMITS.reading,
    ),
  };
}

export function activePursuit(state: PursuitState): Pursuit | undefined {
  return state.activeId ? state.items.find((item) => item.id === state.activeId) : undefined;
}

const byRecent = (a: Pursuit, b: Pursuit) => b.lastAt - a.lastAt;

/** The projection handed to the model. */
export function pursuitContext(state: PursuitState) {
  const active = activePursuit(state);
  return {
    active: active ?? null,
    reading: active ? state.reading : [],
    others: state.items
      .filter((item) => item !== active)
      .sort(byRecent)
      .map((item) => ({
        id: item.id,
        question: item.question,
        status: item.status,
        lastAt: item.lastAt,
        notes: item.entries.filter((entry) => entry.kind === 'note').length,
        openQuestions: item.questions.length,
        ...(item.setAsideReason ? { setAsideReason: item.setAsideReason } : {}),
      })),
  };
}

/** The visitor-facing projection. Never includes reading text. */
export function publicPursuits(state: PursuitState) {
  return [...state.items].sort(byRecent).map((item) => ({
    id: item.id,
    question: item.question,
    why: item.why,
    status: item.status,
    openedAt: item.openedAt,
    lastAt: item.lastAt,
    questions: [...item.questions],
    ...(item.setAsideReason ? { setAsideReason: item.setAsideReason } : {}),
    entries: item.entries.map((entry) => ({ ...entry })),
  }));
}
