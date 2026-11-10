import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityRows } from './activityFeed';
import { ResearchStory } from './panels/ResearchDetails';
import { currentThought, dayStories, filterStory } from './activityStory';

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
  it('shows query, source evidence, unread status, and honest follow-up while blocking unsafe links', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchStory, {
        episode: {
          id: 'search',
          at: 1000,
          topic: 'Robins',
          query: 'robin behavior',
          context: 'Following up on a robin encountered in Elsewhere.',
          status: 'read',
          sources: [
            {
              id: 'read',
              url: 'https://example.org/robin',
              title: 'Robin study',
              snippet: 'Bird behavior.',
              status: 'read',
              excerpt: '<script>unsafe</script>',
            },
            {
              id: 'unread',
              url: 'javascript:alert(1)',
              title: 'Not opened',
              snippet: '',
              status: 'returned',
            },
          ],
          nextStep: 'No follow-up action has been recorded for this research.',
        },
      }),
    );
    expect(html).toContain('robin behavior');
    expect(html).toContain('Source excerpt');
    expect(html).toContain('Found, not opened');
    expect(html).toContain('What I searched for');
    expect(html).toContain('No follow-up action');
    expect(html).toContain('href="https://example.org/robin"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
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
      notes: [{ id: 'note', at: 50, text: 'A note.', sourceIds: [] }],
      research: [],
    });
    expect(stories.map((story) => story.day)).toEqual([2, 1]);
    const first = stories[1]!;
    expect(first.routineCount).toBe(2);
    expect(first.routine).toHaveLength(1);
    expect(first.items.map((item) => item.kind)).not.toContain('event');
    expect(filterStory(first, 'made').map((item) => item.id)).toEqual(['event:made']);
    expect(filterStory(first, 'notes')).toHaveLength(1);
    const highlights = filterStory(first, 'highlights');
    expect(highlights.filter((item) => item.kind === 'memory').map((item) => item.id)).toEqual([
      'memory:memory-4',
      'memory:memory-3',
      'memory:memory-2',
    ]);
    expect(filterStory(first, 'all').filter((item) => item.kind === 'memory')).toHaveLength(4);
  });
  it('keeps shared thoughts in the day, the latest few in highlights and one as current', () => {
    const minute = 60_000;
    const thoughts = [1, 2, 3, 4, 5].map((n) => ({
      id: 't' + n,
      at: n * 10 * minute,
      text: 'Thought ' + n,
    }));
    const [story] = dayStories({
      dayOf: () => 1,
      events: [],
      memories: [],
      notes: [],
      research: [],
      thoughts,
    });
    expect(filterStory(story!, 'thoughts').map((item) => item.id)).toEqual([
      'thought:t5',
      'thought:t4',
      'thought:t3',
      'thought:t2',
      'thought:t1',
    ]);
    expect(filterStory(story!, 'highlights').map((item) => item.id)).toEqual([
      'thought:t5',
      'thought:t4',
      'thought:t3',
    ]);
    expect(currentThought(thoughts, 55 * minute)?.id).toBe('t5');
    expect(currentThought(thoughts, 81 * minute)).toBeUndefined();
    // A thought from another life (after a reset to an earlier clock) is not current.
    expect(currentThought(thoughts, 10 * minute)).toBeUndefined();
    expect(currentThought([], 0)).toBeUndefined();
  });
});
