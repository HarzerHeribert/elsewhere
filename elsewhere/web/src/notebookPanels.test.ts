import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicCharacterState, PublicPursuit } from '@elsewhere/character-interfaces';
import { ActivityPanel } from './panels/ActivityPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { NotebookPanel } from './panels/NotebookPanel';
import { calendarDay, formatDay } from './formatTime';
import { WallTimeProvider } from './worldClock';

const pursuit = (
  id: string,
  notes: Array<{ id: string; at: number; text: string; surprised?: boolean }>,
  overrides: Partial<PublicPursuit> = {},
): PublicPursuit => ({
  id,
  question: 'Why do herons stand so still? (' + id + ')',
  why: 'I want to know',
  status: 'open',
  openedAt: 0,
  lastAt: Math.max(0, ...notes.map((note) => note.at)),
  questions: [],
  entries: notes.map((note) => ({
    kind: 'note' as const,
    id: note.id,
    at: note.at,
    text: note.text,
    surprised: note.surprised ?? false,
    sourceIds: [],
  })),
  ...overrides,
});
const character: PublicCharacterState = {
  id: 'hubert',
  name: 'Hubert',
  mood: 70,
  energy: 80,
  boredom: 20,
  frustration: 2,
  socialAppetite: 30,
  activity: 'Listening to the wind chime',
  status: 'exploring',
  currentThought: 'TEMPLATE-THOUGHT-CANARY',
  lastReflection: 'TEMPLATE-REFLECTION-CANARY',
};
const noop = () => undefined;

describe('authored notebook presentation', () => {
  it('shows notes at the real time they were written, not at the world clock time', () => {
    const written = Date.UTC(2026, 10, 9, 7, 9);
    const real = Date.UTC(2026, 10, 10, 9, 38);
    const pursuits = [
      pursuit('p', [{ id: 'late', at: written, text: 'Written after a long pause.' }]),
    ];
    const html = renderToStaticMarkup(
      createElement(
        WallTimeProvider,
        { value: (at: number) => at + (real - written) },
        createElement(NotebookPanel, { pursuits }),
      ),
    );
    expect(html).toContain(formatDay(calendarDay(real)));
    expect(html).not.toContain(formatDay(calendarDay(written)));
    expect(html).toContain(
      new Date(real).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
  });
  it('shows a factual empty state instead of inventing a thought', () => {
    const html = renderToStaticMarkup(createElement(NotebookPanel));
    expect(html).toContain('My notebook is quiet for now.');
    expect(html).not.toContain('<article');
    expect(html).not.toMatch(/I have chosen|I keep returning/);
  });
  it('shows, per pursuit, its notes newest first and the questions still open', () => {
    const pursuits = [
      pursuit('old', [{ id: 'a', at: 1_000, text: 'First finding.' }]),
      pursuit(
        'new',
        [
          { id: 'b', at: 2_000, text: 'Second finding.' },
          { id: 'c', at: 3_000, text: 'Third finding.', surprised: true },
        ],
        { questions: ['How long do they wait?'] },
      ),
      pursuit('quiet', []),
    ];
    const before = structuredClone(pursuits);
    const html = renderToStaticMarkup(createElement(NotebookPanel, { pursuits }));
    expect(html.indexOf('(new)')).toBeLessThan(html.indexOf('(old)'));
    expect(html.indexOf('Third finding.')).toBeLessThan(html.indexOf('Second finding.'));
    expect(html).toContain('That surprised me.');
    expect(html).toContain('How long do they wait?');
    expect(html).not.toContain('(quiet)');
    expect(pursuits).toEqual(before);
  });
  it('renders hostile note and question text as plain text, never as executable elements', () => {
    const pursuits = [
      pursuit('unsafe', [{ id: 'x', at: 1, text: '<script>window.NOT_EXECUTED=true</script>' }], {
        questions: ['<img src=x onerror="window.NOT_EXECUTED=true">'],
      }),
    ];
    const html = renderToStaticMarkup(createElement(NotebookPanel, { pursuits }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
  });
  it('shows what Hubert follows on his page without exposing old thought/reflection placeholders', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        tab: 'now',
        pursuits: [pursuit('p', [], { status: 'active' })],
        trail: [{ id: 't', at: 1, kind: 'search', why: 'The exception is out there.' }],
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(html).toContain('Listening to the wind chime');
    expect(html).toContain('Why do herons stand so still?');
    expect(html).toContain('The exception is out there.');
    expect(html).toContain('Notebook');
    expect(html).not.toMatch(/TEMPLATE-THOUGHT-CANARY|TEMPLATE-REFLECTION-CANARY/);
  });
  it('opens on the live portrait and latest public excerpts, including when the latest note belongs to an older question', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        pursuits: [
          pursuit('a', [{ id: 'late', at: 4_000, text: 'Latest written entry.' }]),
          pursuit('b', [{ id: 'early', at: 3_000, text: 'Previous written entry.' }], {
            status: 'active',
          }),
        ],
        memories: [
          { id: 'late', at: 4_000, summary: 'Latest kept memory.', cues: [] },
          { id: 'early', at: 1_000, summary: 'Previous kept memory.', cues: [] },
        ],
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(html).toContain('Latest written entry.');
    expect(html).toContain('Latest kept memory.');
    expect(html).toContain('Listening to the wind chime');
    expect(html).not.toMatch(/Previous written|Previous kept|TEMPLATE-THOUGHT/);
  });
  it('keeps the trail distinct from routine events and from the memory page', () => {
    const props = {
      events: [{ id: 'event', at: 1_000, type: 'inspect', message: 'EVENT-FEED-CANARY' }],
      memories: [{ id: 'memory', at: 1_000, summary: 'MEMORY-FEED-CANARY', cues: [] }],
      trail: [{ id: 'step', at: 1_000, kind: 'note' as const, text: 'TRAIL-FEED-CANARY' }],
      notices: [],
      now: 2_000,
    };
    const trail = renderToStaticMarkup(
      createElement(ActivityPanel, { ...props, initialFilter: 'trail' }),
    );
    expect(trail).toContain('TRAIL-FEED-CANARY');
    expect(trail).not.toMatch(/EVENT-FEED-CANARY|MEMORY-FEED-CANARY/);
    const highlights = renderToStaticMarkup(createElement(ActivityPanel, props));
    expect(highlights).toContain('I wrote a note');
    expect(highlights).toContain('I kept a memory');
    expect(highlights).toContain('1 small moment');
    const memories = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        tab: 'memories',
        memories: props.memories,
        trail: props.trail,
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(memories).toContain('MEMORY-FEED-CANARY');
    expect(memories).not.toContain('TRAIL-FEED-CANARY');
  });
  it('points from a day with nothing made to the last day that has something', () => {
    const day = 86_400_000;
    const html = renderToStaticMarkup(
      createElement(ActivityPanel, {
        events: [],
        memories: [],
        trail: [],
        creations: [
          {
            id: 'c',
            characterId: 'hubert',
            title: 'EARLIER-PAGE-CANARY',
            description: '',
            url: 'https://example.org/page',
            kind: 'document',
            createdAt: 3 * day,
            provenance: 'character',
          },
        ],
        notices: [],
        now: 5 * day,
        initialFilter: 'made',
      }),
    );
    expect(html).toContain('Nothing of this kind on this day.');
    expect(html).toContain('The last day with some · ' + formatDay(calendarDay(3 * day)));
    expect(html).not.toContain('EARLIER-PAGE-CANARY');
  });
  it('never renders withheld thought or reflection text on any page', () => {
    for (const tab of ['now', 'notebook', 'memories', 'about'] as const)
      expect(
        renderToStaticMarkup(
          createElement(CharacterPanel, {
            character,
            tab,
            onMessage: noop,
            onViewpoint: noop,
            onWishes: noop,
          }),
        ),
      ).not.toMatch(/TEMPLATE-THOUGHT-CANARY|TEMPLATE-REFLECTION-CANARY/);
  });
});
