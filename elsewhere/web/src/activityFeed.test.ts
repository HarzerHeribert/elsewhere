import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityRows } from './activityFeed';
import { ResearchDetails } from './panels/ResearchDetails';

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
      createElement(ResearchDetails, {
        episodes: [
          {
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
        ],
      }),
    );
    expect(html).toContain('robin behavior');
    expect(html).toContain('Source excerpt');
    expect(html).toContain('Search result · not read');
    expect(html).toContain('No follow-up action');
    expect(html).toContain('href="https://example.org/robin"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
  });
});
