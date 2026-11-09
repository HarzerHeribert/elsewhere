import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicCharacterState, PublicNotebook } from '@elsewhere/character-interfaces';
import { ActivityPanel } from './panels/ActivityPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { NotebookPanel } from './panels/NotebookPanel';

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
  it('shows a factual empty state instead of inventing a thought', () => {
    const html = renderToStaticMarkup(createElement(NotebookPanel));
    expect(html).toContain('His notebook is quiet for now.');
    expect(html).not.toContain('<article');
    expect(html).not.toContain('Writing a note');
    expect(html).not.toMatch(/I have chosen|I keep returning/);
  });
  it('bounds the full notebook to 32 recent entries and preview to one without mutating source order', () => {
    const notebook: PublicNotebook = {
      enabled: true,
      entries: Array.from({ length: 40 }, (_, i) =>
        entry('note-' + i, 'Authored note #' + i + '.'),
      ),
    };
    const before = structuredClone(notebook);
    const full = renderToStaticMarkup(createElement(NotebookPanel, { notebook }));
    expect(full.match(/class="memory-row"/g)).toHaveLength(32);
    expect(full).toContain('Authored note #39.');
    expect(full).toContain('Authored note #8.');
    expect(full).not.toContain('Authored note #7.');
    const preview = renderToStaticMarkup(createElement(NotebookPanel, { notebook, preview: true }));
    expect(preview.match(/class="memory-row"/g)).toHaveLength(1);
    expect(preview).toContain('Authored note #39.');
    expect(preview).not.toContain('Authored note #38.');
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
        onNotebook: noop,
        onMessage: noop,
        onViewpoint: noop,
        onMemories: noop,
        onWishes: noop,
      }),
    );
    expect(html).toContain('Listening to the wind chime');
    expect(html).toContain('The shortest tube has a surprisingly sharp sound.');
    expect(html).toContain('Notebook');
    expect(html).not.toMatch(/TEMPLATE-THOUGHT-CANARY|TEMPLATE-REFLECTION-CANARY/);
  });
  it('keeps notebook expression distinct from the event and memory feeds', () => {
    const props = {
      events: [{ id: 'event', at: 1_000, type: 'inspect', message: 'EVENT-FEED-CANARY' }],
      memories: [{ id: 'memory', at: 1_000, summary: 'MEMORY-FEED-CANARY', cues: [] }],
      notebook: { enabled: true, entries: [entry('authored', 'NOTEBOOK-FEED-CANARY')] },
      notices: [],
      onFeedChange: noop,
    };
    const notebookHtml = renderToStaticMarkup(
      createElement(ActivityPanel, { ...props, feed: 'notebook' }),
    );
    expect(notebookHtml).toContain('NOTEBOOK-FEED-CANARY');
    expect(notebookHtml).not.toMatch(/EVENT-FEED-CANARY|MEMORY-FEED-CANARY/);
    const memoryHtml = renderToStaticMarkup(
      createElement(ActivityPanel, { ...props, feed: 'memories' }),
    );
    expect(memoryHtml).toContain('MEMORY-FEED-CANARY');
    expect(memoryHtml).not.toContain('NOTEBOOK-FEED-CANARY');
  });
});
