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
  lastNote: 240,
} as const;

const cut = (value: string, maximum: number) => value.trim().slice(0, maximum);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Words that say nothing about what a question is about. */
const FILLER = new Set(
  (
    'a an the of in on at to for from by with and or but is are was were be been do does did ' +
    'will would could should can may might it its this that these those i my me we you your ' +
    'he she they them his her their what which who whom whether how why when where if than ' +
    'then so as also another other again still more most any some each every one no not into ' +
    'about over under between same there here have has had'
  ).split(' '),
);
const singular = (word: string) =>
  word.length > 4 && word.endsWith('ies')
    ? word.slice(0, -3) + 'y'
    : word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
      ? word.slice(0, -1)
      : word;
/** The words (and numbers) a question is about, lower-cased, without filler. */
export function questionWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word && !FILLER.has(word))
      .map(singular),
  );
}
/**
 * Whether two questions ask nearly the same thing: the same wording, or most of the same words.
 * "Does it repeat at 60 cm?" and "Does it repeat at 120 cm?" are alike: one line of inquiry.
 */
export function questionsAlike(a: string, b: string, share = ALIKE): boolean {
  if (same(a, b)) return true;
  const [left, right] = [questionWords(a), questionWords(b)];
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared >= 3 && shared / (left.size + right.size - shared) >= share;
}
/** Share of words in common at which two questions belong to one line of inquiry. */
const ALIKE = 0.6;
/** Share at which one is only a rewording of the other. */
const REWORDED = 0.85;
/** Whether the pursuit already holds this question, give or take a rewording. */
const holds = (pursuit: Pursuit, question: string) =>
  questionsAlike(pursuit.question, question, REWORDED) ||
  pursuit.questions.some((known) => questionsAlike(known, question, REWORDED));
/** A question is written in words; an identifier (such as another pursuit's id) is not one. */
export function isQuestionText(text: string): boolean {
  const value = text.trim();
  return value !== '' && !/^[a-z]+-[0-9a-f-]{8,}$/i.test(value);
}

export interface PursuitMatch {
  pursuit: Pursuit;
  /** Whether the pursuit's own question or one of its follow-up questions is the near-copy. */
  on: 'question' | 'follow-up';
}
/** The pursuit that already holds a near-copy of this question: the active one first, then the newest. */
export function findAlikePursuit(state: PursuitState, question: string): PursuitMatch | undefined {
  const ordered = [...state.items].sort(
    (a, b) =>
      Number(b.id === state.activeId) - Number(a.id === state.activeId) || b.lastAt - a.lastAt,
  );
  for (const pursuit of ordered)
    if (questionsAlike(pursuit.question, question)) return { pursuit, on: 'question' };
  for (const pursuit of ordered)
    if (
      pursuit.status !== 'set-aside' &&
      pursuit.questions.some((known) => questionsAlike(known, question))
    )
      return { pursuit, on: 'follow-up' };
  return undefined;
}

/**
 * Why a pursue step would change nothing, in words the character can read; undefined when it
 * would. A near-copy of a question that is already here is not a problem: openPursuit goes
 * back to that pursuit, and keeps a variation there as a follow-up, instead of opening a second.
 */
export function pursueProblem(
  state: PursuitState,
  step: { question?: string; pursuitId?: string },
): string | undefined {
  if (step.pursuitId !== undefined) {
    if (!state.items.some((item) => item.id === step.pursuitId))
      return 'That pursuit does not exist. Use a pursuitId from state.pursuits.';
    return step.pursuitId === state.activeId
      ? 'That is already the pursuit you are following; opening it again changes nothing. Take the next step on it.'
      : undefined;
  }
  const question = step.question ?? '';
  if (!isQuestionText(question))
    return 'A new pursuit needs a question written out in words. To return to an earlier pursuit give only its pursuitId.';
  const alike = findAlikePursuit(state, question);
  if (!alike || alike.pursuit.id !== state.activeId || !holds(alike.pursuit, question))
    return undefined;
  return questionsAlike(alike.pursuit.question, question, REWORDED)
    ? `You are already following this: "${alike.pursuit.question}". Asking it again changes nothing: take the next step on it and note what it shows.`
    : 'That question is already an open follow-up on the pursuit you are following. Work on it there: what you find goes on the same pursuit.';
}

/**
 * Repairs pursuits saved without a real question (an identifier was once accepted as one): the
 * oldest follow-up question, or else the reason, becomes the question.
 */
export function repairPursuitQuestions(state: PursuitState): PursuitState {
  if (state.items.every((item) => isQuestionText(item.question))) return state;
  return {
    ...state,
    items: state.items.map((item) => {
      if (isQuestionText(item.question)) return item;
      const [first, ...rest] = item.questions;
      return first && isQuestionText(first)
        ? { ...item, question: first, questions: rest }
        : { ...item, question: cut(item.why, PURSUIT_LIMITS.question) || 'An earlier question' };
    }),
  };
}

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
  if (!isQuestionText(question)) throw new Error('A pursuit needs a question written in words.');
  if (state.items.some((item) => item.id === input.id))
    throw new Error(`Pursuit already exists: ${input.id}`);
  // A near-copy of a question that is already here goes back to that pursuit, set aside or
  // not, and keeps the new wording there as a follow-up: one line of inquiry, one record.
  const alike = findAlikePursuit(state, question);
  if (alike) {
    const back = activate(state, alike.pursuit.id, now);
    return holds(alike.pursuit, question)
      ? back
      : addPursuitQuestion(back, alike.pursuit.id, question, now);
  }
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
    if (!text || item.questions.some((known) => questionsAlike(known, text, REWORDED))) return item;
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
      .map((item) => {
        const notes = item.entries.filter((entry) => entry.kind === 'note');
        const last = notes.at(-1);
        return {
          id: item.id,
          question: item.question,
          status: item.status,
          lastAt: item.lastAt,
          notes: notes.length,
          openQuestions: item.questions.length,
          // Where it stood, so comparing with it does not take going back to it.
          ...(last?.kind === 'note' && item.status !== 'set-aside'
            ? { lastNote: cut(last.text, PURSUIT_LIMITS.lastNote) }
            : {}),
          ...(item.setAsideReason ? { setAsideReason: item.setAsideReason } : {}),
        };
      }),
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
