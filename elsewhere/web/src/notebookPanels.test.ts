import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicCharacterState, PublicNotebook } from '@elsewhere/character-interfaces';
import { ActivityPanel } from './panels/ActivityPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { NotebookPanel } from './panels/NotebookPanel';
import { calendarDay, formatDay } from './formatTime';
import { WallTimeProvider } from './worldClock';

const entry = (id: string, text: string) => ({
  id,
  at: 1_000,
  text,
  sourceIds: ['observed:' + id],
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
  interests: [],
  currentThought: 'TEMPLATE-THOUGHT-CANARY',
  lastReflection: 'TEMPLATE-REFLECTION-CANARY',
};
const noop = () => undefined;

describe('authored notebook presentation', () => {
  it('shows notes at the real time they were written, not at the world clock time', () => {
    const written = Date.UTC(2026, 10, 9, 7, 9);
    const real = Date.UTC(2026, 10, 10, 9, 38);
    const notebook: PublicNotebook = {
      enabled: true,
      entries: [{ ...entry('late', 'Written after a long pause.'), at: written }],
    };
    const html = renderToStaticMarkup(
      createElement(
        WallTimeProvider,
        { value: (at: number) => at + (real - written) },
        createElement(NotebookPanel, { notebook }),
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
    expect(html).not.toContain('writing this now');
    expect(html).not.toMatch(/I have chosen|I keep returning/);
  });
  it('bounds the notebook to 32 recent entries, grouped by calendar day, without mutating source order', () => {
    const notebook: PublicNotebook = {
      enabled: true,
      entries: Array.from({ length: 40 }, (_, i) =>
        entry('note-' + i, 'Authored note #' + i + '.'),
      ),
    };
    const before = structuredClone(notebook);
    const full = renderToStaticMarkup(createElement(NotebookPanel, { notebook }));
    expect(full.match(/class="journal-page"/g)).toHaveLength(32);
    expect(full.split(formatDay(calendarDay(1_000)))).toHaveLength(2);
    expect(full).toContain('Authored note #39.');
    expect(full).toContain('Authored note #8.');
    expect(full).not.toContain('Authored note #7.');
    expect(notebook).toEqual(before);
  });
  it('renders hostile draft and completed text as plain text, never as executable elements', () => {
    const notebook: PublicNotebook = {
      enabled: true,
      entries: [entry('unsafe', '<script>window.NOT_EXECUTED=true</script>')],
      draft: { id: 'draft', at: 2_000, text: '<img src=x onerror="window.NOT_EXECUTED=true">' },
    };
    const html = renderToStaticMarkup(createElement(NotebookPanel, { notebook }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('role="status"');
    expect(html).toContain('Notebook draft');
  });
  it('uses authored notebook entries on Hubert’s profile without exposing old thought/reflection placeholders', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        notebook: {
          enabled: true,
          entries: [entry('authored', 'The shortest tube has a surprisingly sharp sound.')],
        },
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(html).toContain('Listening to the wind chime');
    expect(html).toContain('The shortest tube has a surprisingly sharp sound.');
    expect(html).toContain('My notebook');
    expect(html).not.toMatch(/TEMPLATE-THOUGHT-CANARY|TEMPLATE-REFLECTION-CANARY/);
  });
  it('keeps notebook expression distinct from routine events and from the memory page', () => {
    const props = {
      events: [{ id: 'event', at: 1_000, type: 'inspect', message: 'EVENT-FEED-CANARY' }],
      memories: [{ id: 'memory', at: 1_000, summary: 'MEMORY-FEED-CANARY', cues: [] }],
      notebook: { enabled: true, entries: [entry('authored', 'NOTEBOOK-FEED-CANARY')] },
      notices: [],
      now: 2_000,
    };
    const notes = renderToStaticMarkup(
      createElement(ActivityPanel, { ...props, initialFilter: 'notes' }),
    );
    expect(notes).toContain('NOTEBOOK-FEED-CANARY');
    expect(notes).not.toMatch(/EVENT-FEED-CANARY|MEMORY-FEED-CANARY/);
    const highlights = renderToStaticMarkup(createElement(ActivityPanel, props));
    expect(highlights).toContain('I wrote in my notebook');
    expect(highlights).toContain('I kept a memory');
    expect(highlights).toContain('1 small moment');
    const memories = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        tab: 'memories',
        memories: props.memories,
        notebook: props.notebook,
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(memories).toContain('MEMORY-FEED-CANARY');
    expect(memories).not.toContain('NOTEBOOK-FEED-CANARY');
  });
  it('never renders withheld thought or reflection text on any page', () => {
    for (const tab of ['now', 'notebook', 'memories', 'research', 'about'] as const)
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
