import { describe, expect, it } from 'vitest';
import {
  PURSUIT_LIMITS,
  activePursuit,
  addPursuitQuestion,
  createPursuitState,
  openPursuit,
  publicPursuits,
  pursuitContext,
  recordPursuitEntry,
  recordPursuitReading,
  resolvePursuitQuestion,
  resumePursuit,
  setAsidePursuit,
  type PursuitEntry,
  type PursuitState,
} from './pursuits';

const open = (state: PursuitState, id: string, question = `Question ${id}?`, now = 1) =>
  openPursuit(state, { id, question, why: 'because' }, now);
const note = (id: string): PursuitEntry => ({
  kind: 'note',
  id,
  at: 1,
  text: 'a note',
  surprised: false,
  sourceIds: ['s1'],
});
const frozen = <T>(value: T): T => structuredClone(value);

describe('openPursuit', () => {
  it('opens and activates, demoting the previous active one', () => {
    const a = open(createPursuitState(), 'a', 'Why?', 10);
    const b = open(a, 'b', 'How?', 20);
    expect(b.activeId).toBe('b');
    expect(b.items.find((i) => i.id === 'a')?.status).toBe('open');
    expect(activePursuit(b)).toMatchObject({ id: 'b', openedAt: 20, lastAt: 20, entries: [] });
  });
  it('trims and cuts text', () => {
    const state = openPursuit(
      createPursuitState(),
      { id: 'a', question: `  ${'q'.repeat(300)}  `, why: ` ${'w'.repeat(300)} ` },
      1,
    );
    expect(state.items[0].question).toHaveLength(PURSUIT_LIMITS.question);
    expect(state.items[0].why).toHaveLength(PURSUIT_LIMITS.why);
  });
  it('throws on an empty question or duplicate id', () => {
    expect(() => open(createPursuitState(), 'a', '   ')).toThrow();
    const a = open(createPursuitState(), 'a');
    expect(() => open(a, 'a', 'Other?')).toThrow();
  });
  it('resumes a non-set-aside pursuit with the same question', () => {
    const a = open(createPursuitState(), 'a', 'Why do herons stand?', 1);
    const b = open(a, 'b', 'Other?', 2);
    const again = open(b, 'c', '  why do HERONS stand?  ', 3);
    expect(again.items).toHaveLength(2);
    expect(again.activeId).toBe('a');
    expect(again.items.find((i) => i.id === 'b')?.status).toBe('open');
  });
  it('does not resume a set-aside pursuit with the same question', () => {
    const a = setAsidePursuit(open(createPursuitState(), 'a', 'Same?'), 'a', 'later', 2);
    const b = open(a, 'b', 'same?', 3);
    expect(b.items).toHaveLength(2);
    expect(b.activeId).toBe('b');
  });
  it('evicts the least recently touched set-aside one first', () => {
    let state = createPursuitState();
    for (let i = 0; i < PURSUIT_LIMITS.items; i++) state = open(state, `p${i}`, `Q${i}?`, 100 + i);
    state = setAsidePursuit(state, 'p5', 'r', 500);
    state = setAsidePursuit(state, 'p7', 'r', 400);
    state = open(state, 'new', 'New?', 600);
    expect(state.items).toHaveLength(PURSUIT_LIMITS.items);
    expect(state.items.some((i) => i.id === 'p7')).toBe(false);
    expect(state.items.some((i) => i.id === 'p5')).toBe(true);
  });
  it('evicts the least recently touched open one, never the active one', () => {
    let state = createPursuitState();
    for (let i = 0; i < PURSUIT_LIMITS.items; i++) state = open(state, `p${i}`, `Q${i}?`, 100 + i);
    state = open(state, 'new', 'New?', 600);
    expect(state.items.some((i) => i.id === 'p0')).toBe(false);
    expect(state.items.some((i) => i.id === 'p11')).toBe(true);
    expect(state.activeId).toBe('new');
    expect(state.items).toHaveLength(PURSUIT_LIMITS.items);
  });
  it('does not mutate its input', () => {
    const a = open(createPursuitState(), 'a');
    const copy = frozen(a);
    open(a, 'b');
    expect(a).toEqual(copy);
  });
});

describe('resumePursuit and setAsidePursuit', () => {
  it('resumes a set-aside pursuit and clears its reason', () => {
    let state = open(open(createPursuitState(), 'a'), 'b');
    state = setAsidePursuit(state, 'a', 'dead end', 5);
    expect(state.items.find((i) => i.id === 'a')).toMatchObject({
      status: 'set-aside',
      setAsideReason: 'dead end',
    });
    const resumed = resumePursuit(state, 'a', 9);
    expect(resumed.activeId).toBe('a');
    const a = resumed.items.find((i) => i.id === 'a')!;
    expect(a.status).toBe('active');
    expect(a.setAsideReason).toBeUndefined();
    expect(a.lastAt).toBe(9);
    expect(resumed.items.find((i) => i.id === 'b')?.status).toBe('open');
  });
  it('clears activeId only when the active one is set aside', () => {
    const state = open(open(createPursuitState(), 'a'), 'b');
    expect(setAsidePursuit(state, 'b', 'x', 2).activeId).toBeUndefined();
    expect(setAsidePursuit(state, 'a', 'x', 2).activeId).toBe('b');
  });
  it('cuts the reason and throws on unknown ids without mutating', () => {
    const state = open(createPursuitState(), 'a');
    const copy = frozen(state);
    const next = setAsidePursuit(state, 'a', ` ${'r'.repeat(500)} `, 2);
    expect(next.items[0].setAsideReason).toHaveLength(PURSUIT_LIMITS.setAsideReason);
    expect(state).toEqual(copy);
    expect(() => resumePursuit(state, 'zz', 1)).toThrow();
    expect(() => setAsidePursuit(state, 'zz', 'r', 1)).toThrow();
  });
});

describe('entries', () => {
  it('appends entries, updates lastAt and keeps the newest within the limit', () => {
    let state = open(createPursuitState(), 'a');
    const copy = frozen(state);
    for (let i = 0; i < PURSUIT_LIMITS.entries + PURSUIT_LIMITS.entrySlack + 1; i++)
      state = recordPursuitEntry(state, 'a', note(`n${i}`), 50 + i);
    const item = state.items[0];
    expect(item.entries).toHaveLength(PURSUIT_LIMITS.entries);
    expect(item.entries[0].id).toBe(`n${PURSUIT_LIMITS.entrySlack + 1}`);
    expect(item.lastAt).toBe(50 + PURSUIT_LIMITS.entries + PURSUIT_LIMITS.entrySlack);
    expect(copy.items[0].entries).toEqual([]);
  });
  it('cuts note text and throws on unknown ids', () => {
    const state = open(createPursuitState(), 'a');
    const next = recordPursuitEntry(
      state,
      'a',
      { ...note('n'), text: ` ${'t'.repeat(900)} ` } as PursuitEntry,
      2,
    );
    expect(next.items[0].entries[0]).toMatchObject({ text: 't'.repeat(PURSUIT_LIMITS.note) });
    expect(() => recordPursuitEntry(state, 'zz', note('n'), 1)).toThrow();
  });
});

describe('open questions', () => {
  it('adds, skips case-insensitive duplicates and keeps the newest', () => {
    let state = open(createPursuitState(), 'a');
    state = addPursuitQuestion(state, 'a', 'Why?', 2);
    state = addPursuitQuestion(state, 'a', ' why? ', 3);
    expect(state.items[0].questions).toEqual(['Why?']);
    for (let i = 0; i < PURSUIT_LIMITS.questions + 3; i++)
      state = addPursuitQuestion(state, 'a', `Follow ${i}?`, 4);
    expect(state.items[0].questions).toHaveLength(PURSUIT_LIMITS.questions);
    expect(state.items[0].questions.at(-1)).toBe(`Follow ${PURSUIT_LIMITS.questions + 2}?`);
    expect(() => addPursuitQuestion(state, 'zz', 'x?', 1)).toThrow();
  });
  it('cuts long questions', () => {
    const state = addPursuitQuestion(open(createPursuitState(), 'a'), 'a', 'q'.repeat(500), 2);
    expect(state.items[0].questions[0]).toHaveLength(PURSUIT_LIMITS.question);
  });
  it('resolves a matching question and ignores absent ones', () => {
    const state = addPursuitQuestion(open(createPursuitState(), 'a'), 'a', 'Why?', 2);
    const copy = frozen(state);
    expect(resolvePursuitQuestion(state, 'a', 'WHY?').items[0].questions).toEqual([]);
    expect(resolvePursuitQuestion(state, 'a', 'other').items[0].questions).toEqual(['Why?']);
    expect(state).toEqual(copy);
  });
});

describe('reading', () => {
  const page = (sourceId: string, at: number, text = 'text') => ({
    sourceId,
    url: `https://example.com/${sourceId}`,
    title: sourceId,
    text,
    at,
  });
  it('puts newest first, replaces the same source and keeps two pages', () => {
    let state = createPursuitState();
    state = recordPursuitReading(state, page('a', 1));
    state = recordPursuitReading(state, page('b', 2));
    state = recordPursuitReading(state, page('c', 3));
    expect(state.reading.map((r) => r.sourceId)).toEqual(['c', 'b']);
    state = recordPursuitReading(state, page('b', 4, 'new'));
    expect(state.reading.map((r) => r.sourceId)).toEqual(['b', 'c']);
    expect(state.reading[0].text).toBe('new');
  });
  it('cuts text to the limit without mutating', () => {
    const state = createPursuitState();
    const next = recordPursuitReading(state, page('a', 1, 'x'.repeat(20000)));
    expect(next.reading[0].text).toHaveLength(PURSUIT_LIMITS.readingText);
    expect(state.reading).toEqual([]);
  });
});

describe('projections', () => {
  const build = () => {
    let state = open(createPursuitState(), 'a', 'First?', 10);
    state = recordPursuitEntry(state, 'a', note('n1'), 11);
    state = addPursuitQuestion(state, 'a', 'Follow?', 12);
    state = open(state, 'b', 'Second?', 20);
    state = open(state, 'c', 'Third?', 30);
    state = setAsidePursuit(state, 'a', 'stuck', 40);
    return recordPursuitReading(state, {
      sourceId: 's',
      url: 'https://example.com',
      title: 'T',
      text: 'SECRET PAGE TEXT',
      at: 1,
    });
  };
  it('pursuitContext gives the active pursuit, reading and sorted others', () => {
    const context = pursuitContext(build());
    expect(context.active?.id).toBe('c');
    expect(context.reading).toHaveLength(1);
    expect(context.others).toEqual([
      {
        id: 'a',
        question: 'First?',
        status: 'set-aside',
        lastAt: 40,
        notes: 1,
        openQuestions: 1,
        setAsideReason: 'stuck',
      },
      { id: 'b', question: 'Second?', status: 'open', lastAt: 20, notes: 0, openQuestions: 0 },
    ]);
  });
  it('pursuitContext has no reading or active without an active pursuit', () => {
    const state = setAsidePursuit(build(), 'c', 'done', 50);
    const context = pursuitContext(state);
    expect(context.active).toBeNull();
    expect(context.reading).toEqual([]);
    expect(context.others[0].id).toBe('c');
  });
  it('publicPursuits is sorted, complete and free of page text', () => {
    const state = build();
    const copy = frozen(state);
    const list = publicPursuits(state);
    expect(list.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(list[0]).toMatchObject({
      question: 'First?',
      why: 'because',
      status: 'set-aside',
      openedAt: 10,
      lastAt: 40,
      questions: ['Follow?'],
      setAsideReason: 'stuck',
    });
    expect(list[0].entries).toHaveLength(1);
    expect(list[1]).not.toHaveProperty('setAsideReason');
    expect(JSON.stringify(list)).not.toContain('SECRET PAGE TEXT');
    expect(state).toEqual(copy);
  });
});
