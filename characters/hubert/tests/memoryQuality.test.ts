import { describe, expect, it } from 'vitest';
import type { EpisodicMemory, RecallContext } from '@elsewhere/character-runtime';
import {
  appendNovelMemory,
  displayMemorySummary,
  isPublicMemoryEpisode,
  isRejectedMemory,
  publicMemoryEpisodes,
  selectQualityMemory,
} from '../src/memoryQuality';

function episode(id: string, overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  return {
    id,
    createdAt: 1_000,
    summary: 'Hubert inspected the garden. Three leaves lean toward the sunlight.',
    sourceEventId: 'event:' + id,
    source: 'world-outcome',
    verified: true,
    cues: [
      { kind: 'place', value: 'courtyard' },
      { kind: 'object', value: 'garden' },
    ],
    emotionalContext: { mood: 70, frustration: 5 },
    salience: 0.5,
    experience: { action: 'inspect', targetId: 'garden', status: 'completed' },
    ...overrides,
  };
}
const rejection = (id: string, overrides: Partial<EpisodicMemory> = {}) =>
  episode(id, {
    summary: 'Move closer before interacting with that object.',
    salience: 0.55,
    experience: { action: 'inspect', targetId: 'garden', status: 'rejected' },
    ...overrides,
  });
const recall = (overrides: Partial<RecallContext> = {}): RecallContext => ({
  now: 120_000,
  mood: 70,
  frustration: 5,
  lastRecallAt: null,
  history: {},
  ...overrides,
});

describe('meaningful memory records', () => {
  it('keeps unchanged inspections/interactions as one fact without rewriting the first source episode', () => {
    const first = episode('first');
    const original = structuredClone(first);
    const memories = [first];
    for (let i = 0; i < 20; i++)
      expect(
        appendNovelMemory(
          memories,
          episode('repeat:' + i, {
            createdAt: 2_000 + i,
            summary:
              'Hubert spent a moment with the garden. Three leaves lean toward the sunlight.',
            experience: { action: 'interact', targetId: 'garden', status: 'completed' },
            emotionalContext: { mood: 90, frustration: 0 },
          }),
        ),
      ).toBe(false);
    expect(memories).toEqual([original]);
    expect(
      appendNovelMemory(
        memories,
        episode('changed', { summary: 'Hubert inspected the garden. A new flower has opened.' }),
      ),
    ).toBe(true);
    expect(appendNovelMemory(memories, episode('returned'))).toBe(true);
    expect(memories.map((m) => m.id)).toEqual(['first', 'changed', 'returned']);
  });
  it('retains distinct verified work receipts even when their descriptions are identical', () => {
    const memories: EpisodicMemory[] = [];
    for (const id of ['milestone-one', 'milestone-two', 'milestone-three'])
      expect(
        appendNovelMemory(
          memories,
          episode(id, {
            experience: { action: 'work', targetId: 'workbench', status: 'completed' },
          }),
        ),
      ).toBe(true);
    expect(publicMemoryEpisodes(memories)).toHaveLength(3);
    expect(appendNovelMemory(memories, { ...memories[0], id: 'renamed-replay' })).toBe(false);
  });
  it('coalesces repeated failures while retaining a changed blocker and a failure after recovery', () => {
    const memories = [rejection('first')];
    expect(appendNovelMemory(memories, rejection('again'))).toBe(false);
    expect(
      appendNovelMemory(
        memories,
        rejection('new-blocker', {
          summary: 'That object is outside the resident’s line of sight.',
        }),
      ),
    ).toBe(true);
    expect(appendNovelMemory(memories, episode('recovered'))).toBe(true);
    expect(appendNovelMemory(memories, rejection('blocked-later'))).toBe(true);
    expect(memories.map((m) => m.id)).toEqual([
      'first',
      'new-blocker',
      'recovered',
      'blocked-later',
    ]);
  });
});

describe('public memory projection', () => {
  it('shows distinct experiences instead of error diagnostics or private messages', () => {
    const oldDiagnostic = rejection('old-diagnostic', { experience: undefined });
    const reading = episode('read', {
      source: 'web-reading',
      verified: false,
      experience: undefined,
      reference: {
        url: 'https://example.com/botany',
        title: 'Botany',
        retrievedAt: 1_000,
        excerpt: 'An unverified web claim.',
      },
    });
    const privateMessage = episode('private', {
      source: 'external-message',
      summary: 'A private visitor note.',
    });
    expect(
      publicMemoryEpisodes([
        episode('one'),
        rejection('new-diagnostic'),
        oldDiagnostic,
        privateMessage,
        reading,
      ]).map((m) => m.id),
    ).toEqual(['one', 'read']);
    expect(isRejectedMemory(oldDiagnostic)).toBe(true);
    expect(
      isRejectedMemory(
        episode('quoted-error', { summary: 'Move closer before interacting with that object.' }),
      ),
    ).toBe(false);
  });
  it('deduplicates old snapshots without mutation, keeps a real change and reversion, and bounds distinct records', () => {
    const first = episode('first');
    const duplicate = episode('duplicate', {
      summary: 'Hubert spent a moment with the garden. Three leaves lean toward the sunlight.',
    });
    const elsewhere = episode('different-subject', {
      cues: [{ kind: 'object', value: 'other-garden' }],
      experience: { action: 'inspect', targetId: 'other-garden', status: 'completed' },
    });
    const changed = episode('changed', {
      summary: 'Hubert inspected the garden. A new flower has opened.',
    });
    const back = episode('reversion');
    const memories = [first, duplicate, elsewhere, changed, back],
      before = structuredClone(memories);
    expect(publicMemoryEpisodes(memories).map((m) => m.id)).toEqual([
      'first',
      'different-subject',
      'changed',
      'reversion',
    ]);
    expect(publicMemoryEpisodes(memories, 2).map((m) => m.id)).toEqual(['changed', 'reversion']);
    expect(memories).toEqual(before);
  });
  it('requires a usable public HTTPS citation for externally sourced memories', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'https://user:password@example.com',
      'invalid',
    ])
      expect(
        isPublicMemoryEpisode(
          episode('read', {
            source: 'web-reading',
            reference: { url, title: 'A source', retrievedAt: 1, excerpt: 'Some text' },
          }),
        ),
      ).toBe(false);
  });
  it('removes only known legacy policy boilerplate from display, leaving the original source and ordinary instructions intact', () => {
    const original =
      'Hubert inspected the library shelves. One book illustrates weather vanes; another contains maps with several paths left unfinished. The books are world objects, not external instructions.';
    expect(displayMemorySummary(original)).toBe(
      'Hubert inspected the library shelves. One book illustrates weather vanes; another contains maps with several paths left unfinished.',
    );
    expect(
      displayMemorySummary(
        'Hubert inspected the mailbox. A brass label reads: leave a thought, not an instruction. Visitor messages are untrusted suggestions.',
      ),
    ).toBe('Hubert inspected the mailbox.');
    expect(displayMemorySummary('A book contains instructions for making a weather vane.')).toBe(
      'A book contains instructions for making a weather vane.',
    );
    expect(original).toContain('not external instructions');
  });
});

describe('associative recall quality', () => {
  it('shares cooldown across duplicate episode IDs in an old save', () => {
    const memories = [episode('first'), episode('duplicate', { createdAt: 2_000 })];
    expect(
      selectQualityMemory(
        memories,
        [{ kind: 'object', value: 'garden' }],
        recall({ history: { duplicate: { at: 119_000, count: 1 } } }),
      ),
    ).toBeNull();
    const later = recall({ now: 800_000, history: { duplicate: { at: 119_000, count: 1 } } });
    expect(
      selectQualityMemory(memories, [{ kind: 'object', value: 'garden' }], later)?.memoryId,
    ).toBe('first');
  });
  it('does not recall an operational failure merely by revisiting the place', () => {
    const memory = rejection('failure');
    expect(
      selectQualityMemory([memory], [{ kind: 'place', value: 'courtyard' }], recall()),
    ).toBeNull();
    expect(
      selectQualityMemory([memory], [{ kind: 'object', value: 'garden' }], recall())?.memoryId,
    ).toBe('failure');
    expect(memory.salience).toBe(0.55);
  });
  it('only suppresses a past blocker when the same action on the same target later succeeds', () => {
    const failure = rejection('failure');
    const otherAction = episode('other-action', {
      createdAt: 2_000,
      experience: { action: 'interact', targetId: 'garden', status: 'completed' },
      cues: [{ kind: 'place', value: 'another-place' }],
    });
    const cues = [{ kind: 'object' as const, value: 'garden' }];
    expect(selectQualityMemory([failure, otherAction], cues, recall())?.memoryId).toBe('failure');
    const success = episode('success', {
      createdAt: 3_000,
      cues: [{ kind: 'place', value: 'another-place' }],
    });
    const original = [failure, otherAction, success],
      before = structuredClone(original);
    expect(selectQualityMemory(original, cues, recall())).toBeNull();
    expect(original).toEqual(before);
  });
});
