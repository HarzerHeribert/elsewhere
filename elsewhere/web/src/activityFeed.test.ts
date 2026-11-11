import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityRows } from './activityFeed';
import { ActivityPanel } from './panels/ActivityPanel';
import { dayStories, filterStory } from './activityStory';

describe('compact public activity', () => {
  it('coalesces identical routines while retaining changed evidence and separate milestones', () => {
    const routine = {
      type: 'inspect',
      message: 'Hubert inspected the chime. A sharp sound.',
      objectId: 'chime',
    };
    const events = [
      { ...routine, id: 'a', at: 1 },
      { id: 'work-1', at: 2, type: 'work', message: 'Worked at the bench.' },
      { ...routine, id: 'b', at: 3 },
      { ...routine, id: 'changed', at: 4, message: 'Hubert inspected the chime. A dull sound.' },
      { id: 'work-2', at: 5, type: 'work', message: 'Worked at the bench.' },
    ];
    const before = structuredClone(events);
    const rows = activityRows(events);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.event.id === 'b')).toMatchObject({
      count: 2,
      text: 'Hubert inspected the chime.',
    });
    expect(rows.filter((row) => row.event.type === 'work')).toHaveLength(2);
    expect(events).toEqual(before);
  });
  it('shows the trail with its why and text, and links only to safe pages', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityPanel, {
        events: [],
        memories: [],
        notices: [],
        now: 2_000,
        initialFilter: 'trail',
        trail: [
          {
            id: 's',
            at: 1_000,
            kind: 'search',
            why: 'I want the exception',
            text: 'robin behavior',
          },
          {
            id: 'r',
            at: 1_100,
            kind: 'read',
            text: 'Robin <b>study</b>',
            url: 'https://example.org/robin',
          },
          { id: 'u', at: 1_200, kind: 'read', text: 'Unsafe', url: 'javascript:alert(1)' },
          { id: 'n', at: 1_300, kind: 'note', text: 'A tally beats an impression.' },
        ],
      }),
    );
    expect(html).toContain('I searched the web');
    expect(html).toContain('I want the exception');
    expect(html).toContain('robin behavior');
    expect(html).toContain('href="https://example.org/robin"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<b>study</b>');
    expect(html).toContain('A tally beats an impression.');
  });
  it('tells each world day as milestones first, with routine movement folded away', () => {
    const day = 86_400_000;
    const stories = dayStories({
      dayOf: (at) => Math.floor(at / day) + 1,
      events: [
        { id: 'walk-1', at: 10, type: 'move', message: 'Hubert walked to the pond.' },
        { id: 'walk-2', at: 20, type: 'move', message: 'Hubert walked to the pond.' },
        { id: 'made', at: 30, type: 'artifact_created', message: 'A small study.' },
        { id: 'later', at: day + 5, type: 'rest', message: 'Hubert rested.' },
      ],
      memories: [1, 2, 3, 4].map((n) => ({
        id: 'memory-' + n,
        at: 40 + n,
        summary: 'Memory ' + n,
        cues: [],
        salience: n,
      })),
      trail: [{ id: 'note', at: 50, kind: 'note', text: 'A note.' }],
    });
    expect(stories.map((story) => story.day)).toEqual([2, 1]);
    const first = stories[1]!;
    expect(first.routineCount).toBe(2);
    expect(first.routine).toHaveLength(1);
    expect(first.items.map((item) => item.kind)).not.toContain('event');
    expect(filterStory(first, 'made').map((item) => item.id)).toEqual(['event:made']);
    expect(filterStory(first, 'trail')).toHaveLength(1);
    const highlights = filterStory(first, 'highlights');
    expect(highlights.filter((item) => item.kind === 'memory').map((item) => item.id)).toEqual([
      'memory:memory-4',
      'memory:memory-3',
      'memory:memory-2',
    ]);
    expect(filterStory(first, 'all').filter((item) => item.kind === 'memory')).toHaveLength(4);
  });
  it('keeps steps of the mind in the highlights and every step in the trail', () => {
    const trail = [
      { id: 'a', at: 10, kind: 'pursue' as const, text: 'Why do herons stand still?' },
      { id: 'b', at: 20, kind: 'move' as const },
      { id: 'c', at: 30, kind: 'note' as const, text: 'They wait.' },
    ];
    const [story] = dayStories({ dayOf: () => 1, events: [], memories: [], trail });
    expect(filterStory(story!, 'trail').map((item) => item.id)).toEqual([
      'step:c',
      'step:b',
      'step:a',
    ]);
    expect(filterStory(story!, 'highlights').map((item) => item.id)).toEqual(['step:c', 'step:a']);
    expect(filterStory(story!, 'all')).toHaveLength(3);
  });
});
