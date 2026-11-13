import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicCharacterState, PublicPursuit } from '@elsewhere/character-interfaces';
import { CharacterPanel } from './panels/CharacterPanel';
import { NotebookPanel } from './panels/NotebookPanel';
import { parseReading, pursuitThreads, quantityParts, questionText } from './pursuitThreads';

let seq = 0;
const tried = (at: number, text: string) => ({
  kind: 'tried' as const,
  id: 'tried-' + ++seq,
  at,
  text,
  objectId: 'artifact',
});
const note = (at: number, text: string) => ({
  kind: 'note' as const,
  id: 'note-' + ++seq,
  at,
  text,
  surprised: false,
  sourceIds: [],
});
const pursuit = (
  id: string,
  question: string,
  extra: Partial<PublicPursuit> = {},
): PublicPursuit => ({
  id,
  question,
  why: 'Because of ' + id,
  status: 'open',
  openedAt: 0,
  lastAt: 0,
  questions: [],
  entries: [],
  ...extra,
});
const release = (swings: number) =>
  `Tried release 2 on the pendulum stand. Released from 2 degrees with the 100 g bob on 80 cm of cord, ten full swings took 17.98 s, and after ${swings} swings the swing had shrunk to half.`;

const B = 'pursuit-0b0b0b0b-1111';
// The shape the live world has: one object worked over many reworded questions.
const live = [
  pursuit('a', 'Does the 80 cm decay gap between 50 g and 100 g persist in another matched pair?', {
    status: 'active',
    lastAt: 900,
    entries: [note(900, 'The gap was 14 swings.')],
    questions: ['Does the gap change at a different cord length?'],
  }),
  pursuit(B, 'Does the mass-related difference in pendulum swing decay also hold at 80 cm?', {
    lastAt: 800,
    entries: [tried(700, release(63)), tried(800, release(64)), note(750, 'It held at 80 cm.')],
    questions: ['Does the gap change at a different cord length?', 'What about 120 cm?'],
  }),
  pursuit('c', 'Does repeating the 60 cm pair produce similar decay counts?', {
    status: 'set-aside',
    setAsideReason: 'Another identical pair adds little.',
    lastAt: 600,
    entries: [tried(600, release(79))],
    questions: ['Set-aside leftovers?'],
  }),
  pursuit(
    'd',
    'Does the same 18-swing mass-related decay gap persist in another matched repeat at 80 cm?',
    {
      status: 'set-aside',
      lastAt: 500,
    },
  ),
  pursuit('e', 'Why does the robin keep to the orchard wall?', {
    lastAt: 400,
    entries: [note(400, 'It forages along the wall.')],
  }),
  pursuit('f', B, { lastAt: 300, entries: [tried(300, release(62))] }),
];

describe('lines of questions', () => {
  it('gathers reworded questions and questions at one object into one line, led by the active one', () => {
    const before = structuredClone(live);
    const threads = pursuitThreads(live);
    expect(threads.map((thread) => thread.pursuits.map((item) => item.id))).toEqual([
      ['a', B, 'c', 'd', 'f'],
      ['e'],
    ]);
    const [main] = threads;
    expect(main!.lead.id).toBe('a');
    expect(main!.status).toBe('active');
    expect(main!.object).toBe('the pendulum stand');
    // Newest first, each still knowing the question it was taken for.
    expect(main!.readings.map((reading) => [reading.at, reading.pursuit.id])).toEqual([
      [800, B],
      [700, B],
      [600, 'c'],
      [300, 'f'],
    ]);
    expect(main!.notes.map((item) => item.at)).toEqual([900, 750]);
    // The lead's open questions first, no repeats, nothing from a question that was set aside.
    expect(main!.questions).toEqual([
      'Does the gap change at a different cord length?',
      'What about 120 cm?',
    ]);
    expect(live).toEqual(before);
  });

  it('counts a page rewritten for a later question once, in its newest version', () => {
    const made = (id: string, at: number, title: string) => ({
      kind: 'made' as const,
      id,
      at,
      creationId: 'creation-' + id,
      path: 'notes/pendulum.html',
      title,
      url: 'https://example.org/notes/pendulum.html',
      commitSha: id,
    });
    const [thread] = pursuitThreads([
      pursuit('one', 'Does the pendulum decay gap persist at 80 cm?', {
        entries: [tried(1, release(60)), made('m1', 2, 'First version')],
      }),
      pursuit('two', 'Does the pendulum decay gap persist at 60 cm?', {
        entries: [tried(3, release(61)), made('m2', 4, 'Second version')],
      }),
    ]);
    expect(thread!.made.map((entry) => entry.title)).toEqual(['Second version']);
  });

  it('keeps unrelated questions apart and orders them by when they were last touched', () => {
    const threads = pursuitThreads([
      pursuit('old', 'Why do herons stand so still?', { lastAt: 1 }),
      pursuit('new', 'What makes the pond rings spread at that speed?', { lastAt: 2 }),
    ]);
    expect(threads.map((thread) => thread.id)).toEqual(['new', 'old']);
  });

  it('gives a question that only names another by id that question’s words', () => {
    expect(questionText(live[5]!, live)).toBe(live[1]!.question);
    expect(questionText(pursuit('x', 'pursuit-886fd4a7-4dc6-4034-9cb4-3cd8a944ebe8'), live)).toBe(
      'An earlier question, taken up again',
    );
  });
});

describe('readings', () => {
  it('splits a reading into what was done and what came of it', () => {
    expect(parseReading(release(63))).toEqual({
      action: 'release 2',
      object: 'the pendulum stand',
      result:
        'Released from 2 degrees with the 100 g bob on 80 cm of cord, ten full swings took 17.98 s, and after 63 swings the swing had shrunk to half.',
    });
    expect(parseReading('The chime rang twice.')).toEqual({ result: 'The chime rang twice.' });
  });

  it('sets measurements apart without changing a character of the sentence', () => {
    const text =
      'Bob 2 of 100 g now hangs. At 2° it took 17.98 s for 79–81 swings, 0.4 bar, 1,5 m and 30%.';
    const parts = quantityParts(text);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts.filter((part) => part.quantity).map((part) => part.text)).toEqual([
      '2',
      '100 g',
      '2°',
      '17.98 s',
      '79–81 swings',
      '0.4 bar',
      '1,5 m',
      '30%',
    ]);
    expect(quantityParts('No numbers here.')).toEqual([
      { text: 'No numbers here.', quantity: false },
    ]);
  });
});

const character: PublicCharacterState = {
  id: 'hubert',
  name: 'Hubert',
  mood: 70,
  energy: 80,
  boredom: 20,
  frustration: 2,
  socialAppetite: 30,
  activity: 'Timing the pendulum',
  status: 'exploring',
};
const noop = () => undefined;

describe('a resident’s page, in order', () => {
  const html = renderToStaticMarkup(
    createElement(CharacterPanel, {
      tab: 'now',
      character,
      pursuits: live,
      trail: [
        { id: 't1', at: 890, kind: 'use', why: 'I need the matched count.', text: 'Released.' },
        { id: 't2', at: 900, kind: 'note', why: 'I want to record the gap.', text: 'The gap.' },
      ],
      onMessage: noop,
      onViewpoint: noop,
      onWishes: noop,
      onDay: noop,
    }),
  );
  const at = (text: string) => {
    const index = html.indexOf(text);
    expect(index, text).toBeGreaterThan(-1);
    return index;
  };

  it('leads with what he is doing, then the question, what he tried, concluded and still asks', () => {
    const order = [
      'Timing the pendulum',
      'I want to record the gap.',
      'Message Hubert',
      'The question I’m on',
      live[0]!.question,
      'One of 5 questions at the pendulum stand',
      'What I tried',
      'What I concluded',
      'Still to find out',
      'Other questions',
      'Why does the robin keep to the orchard wall?',
      'My last steps',
      'See my whole day',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows each reading as a row with its numbers set apart, under the question it served', () => {
    expect(html).toContain('<span class="reading-what">release 2</span>');
    expect(html).toContain('<b class="qty">17.98 s</b>');
    expect(html).toContain('<b class="qty">64 swings</b>');
    expect(html).toContain('For: ' + live[1]!.question);
    // The other wordings are folded under the one that leads, not listed as separate things.
    expect(html.match(/class="question-title"/g)).toHaveLength(1);
  });

  it('files the same record in the notebook, one page per line of questions', () => {
    const notebook = renderToStaticMarkup(createElement(NotebookPanel, { pursuits: live }));
    expect(notebook.match(/class="record notebook-thread"/g)).toHaveLength(2);
    expect(notebook).toContain('<span class="reading-what">release 2</span>');
    expect(notebook).toContain('The gap was 14 swings.');
    expect(notebook).toContain('Set aside: Another identical pair adds little.');
  });
});
