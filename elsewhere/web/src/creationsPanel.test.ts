import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicCreation, PublicCharacterState } from '@elsewhere/character-interfaces';
import { CreationsPanel, safeCreationUrl } from './panels/CreationsPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { CreationManager } from './CreationManager';

const creation = (id: string, patch: Partial<PublicCreation> = {}): PublicCreation => ({
  id,
  characterId: 'hubert',
  title: 'A bird field guide',
  description: 'Notes from the orchard.',
  url: 'https://github.com/example/field-guide',
  kind: 'repository',
  createdAt: 1000,
  provenance: 'character',
  ...patch,
});
const render = (creations: PublicCreation[] = []) =>
  renderToStaticMarkup(
    createElement(CreationsPanel, {
      characterId: 'hubert',
      characterName: 'Hubert',
      creations,
    }),
  );

describe('character creations shelf', () => {
  it('has a factual empty state and does not invent or promote the prototype weather chart', () => {
    const html = render();
    expect(html).toContain('No creations pinned yet.');
    expect(html).not.toContain('weather');
    expect(html).not.toContain('<a');
  });

  it('shows explicit pins first and keeps unpinned work in a collapsed list without changing saved order', () => {
    const creations = [
      creation('unpinned', { title: 'Unpinned draft' }),
      creation('old-pin', { title: 'Earlier pin', pinnedAt: 2000 }),
      creation('new-pin', { title: 'Recent pin', pinnedAt: 3000 }),
    ];
    const before = structuredClone(creations);
    const html = render(creations);
    expect(html.indexOf('Recent pin')).toBeLessThan(html.indexOf('Earlier pin'));
    expect(html.indexOf('Earlier pin')).toBeLessThan(html.indexOf('<details>'));
    expect(html).toContain('<summary>More creations · 1</summary>');
    expect(html.indexOf('Unpinned draft')).toBeGreaterThan(html.indexOf('<details>'));
    expect(html).not.toContain('<details open');
    expect(creations).toEqual(before);
  });

  it('does not mix another character’s work into Hubert’s shelf and labels owner-added links', () => {
    const html = render([
      creation('other', {
        characterId: 'someone-else',
        title: 'OTHER-CHARACTER-CANARY',
        pinnedAt: 2,
      }),
      creation('owner', { title: 'Owner supplied guide', provenance: 'owner', pinnedAt: 3 }),
    ]);
    expect(html).not.toContain('OTHER-CHARACTER-CANARY');
    expect(html).toContain('Owner supplied guide');
    expect(html).toContain('Owner-added link');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com',
    '//example.com',
    'https://user:password@example.com/file',
    '/api/artifacts/weather-study',
    '/api/creations/../private',
  ])('rejects unsafe or legacy creation links: %s', (url) => {
    expect(safeCreationUrl(url)).toBe(false);
    expect(
      render([creation('unsafe', { url, title: 'UNSAFE-CREATION-CANARY', pinnedAt: 1 })]),
    ).not.toContain('UNSAFE-CREATION-CANARY');
  });

  it('accepts published HTTPS and trusted local creation URLs while rendering author text safely', () => {
    expect(safeCreationUrl('https://example.com/a-project')).toBe(true);
    expect(safeCreationUrl('/api/creations/creation:123')).toBe(true);
    const html = render([
      creation('safe', {
        title: '<script>not-executed</script>',
        description: '<img src=x onerror=alert(1)>',
        pinnedAt: 1,
      }),
    ]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
  });

  it('keeps legacy artifacts out of the character profile', () => {
    const character: PublicCharacterState = {
      id: 'hubert',
      name: 'Hubert',
      mood: 70,
      energy: 70,
      boredom: 20,
      frustration: 0,
      socialAppetite: 30,
      activity: 'Reading',
      status: 'exploring',
    };
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      createElement(CharacterPanel, {
        character,
        artifacts: [
          {
            id: 'weather-study',
            name: 'WEATHER-PROTOTYPE-CANARY',
            description: 'A prototype',
            url: '/api/artifacts/weather-study',
            createdAt: 1,
          },
        ],
        tab: 'about',
        onMessage: noop,
        onViewpoint: noop,
        onWishes: noop,
      }),
    );
    expect(html).not.toContain('WEATHER-PROTOTYPE-CANARY');
    expect(html).toContain('No creations pinned yet.');
  });

  it('presents owner additions separately from pinning and limits management rows to this character', () => {
    const html = renderToStaticMarkup(
      createElement(CreationManager, {
        characterId: 'hubert',
        creations: [
          creation('unpinned', { provenance: 'owner' }),
          creation('pinned', { pinnedAt: 1 }),
          creation('other', { characterId: 'other', title: 'OTHER-MANAGER-CANARY' }),
        ],
      }),
    );
    expect(html).toContain('Add link');
    expect(html).toContain('Pin creation');
    expect(html).toContain('Unpin creation');
    expect(html).toContain('Owner-added link');
    expect(html).not.toContain('OTHER-MANAGER-CANARY');
    expect(html).not.toContain('type="checkbox"');
  });
});
