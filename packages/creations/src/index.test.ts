import { describe, expect, it } from 'vitest';
import { addCreation, publicCreations, setCreationPinned } from './index';
import { CreateCreationSchema } from '../../../characters/interfaces/src/creations';

const input = {
  title: 'A bird guide',
  description: 'Notes about birds.',
  url: 'https://example.com/birds',
  kind: 'document' as const,
};
const author = {
  id: 'guide',
  characterId: 'hubert',
  createdAt: 1000,
  provenance: 'character' as const,
};

describe('character creation shelf', () => {
  it('registers an attributed link unpinned and treats receipt replay as idempotent', () => {
    const items = addCreation([], input, author);
    expect(items[0]).toMatchObject({ ...input, ...author });
    expect(items[0].pinnedAt).toBeUndefined();
    expect(addCreation(items, input, { ...author, id: 'retry' })).toEqual(items);
    expect(publicCreations(items, 'another-character')).toEqual([]);
  });
  it('pins explicitly, preserves the first pin time on replay, and can unpin without deleting the creation', () => {
    const items = addCreation([], input, author);
    const pinned = setCreationPinned(items, 'hubert', 'guide', true, 2000);
    expect(pinned[0].pinnedAt).toBe(2000);
    expect(items[0].pinnedAt).toBeUndefined();
    expect(setCreationPinned(pinned, 'hubert', 'guide', true, 3000)).toEqual(pinned);
    expect(setCreationPinned(pinned, 'hubert', 'guide', false, 4000)[0].pinnedAt).toBeUndefined();
    expect(() => setCreationPinned(items, 'other', 'guide', true, 2000)).toThrow('not found');
  });
  it('bounds each character shelf and pinned list without evicting existing work', () => {
    let items = [] as ReturnType<typeof addCreation>;
    for (let i = 0; i < 32; i++)
      items = addCreation(items, { ...input, url: input.url + i }, { ...author, id: 'guide-' + i });
    expect(() =>
      addCreation(items, { ...input, url: input.url + 'overflow' }, { ...author, id: 'overflow' }),
    ).toThrow('full');
    for (let i = 0; i < 6; i++)
      items = setCreationPinned(items, 'hubert', 'guide-' + i, true, 2000);
    expect(() => setCreationPinned(items, 'hubert', 'guide-6', true, 2000)).toThrow('six');
    expect(items).toHaveLength(32);
  });
  it.each([
    'javascript:alert(1)',
    'http://example.com',
    'https://user:password@example.com',
    'https://localhost',
    'https://192.168.1.1/file',
    'https://service.internal/file',
  ])('rejects unsafe link %s', (url) => {
    expect(CreateCreationSchema.safeParse({ ...input, url }).success).toBe(false);
  });
  it('does not project extra private fields from retained records', () => {
    const items = [{ ...addCreation([], input, author)[0], secret: 'PRIVATE-CANARY' }];
    expect(JSON.stringify(publicCreations(items, 'hubert'))).not.toContain('PRIVATE-CANARY');
  });
});
