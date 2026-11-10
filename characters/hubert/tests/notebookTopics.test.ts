import { expect, it } from 'vitest';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { notebookTopics } from '../src/notebook';
import { thoughtInput, thoughtMoment } from '../src/thoughts';

const snapshot = {
  world: { places: [{ id: 'pond', name: 'The pond' }] },
  character: {
    activity: 'Looking more closely',
    status: 'exploring',
    interests: [
      { id: 'a', name: 'Water', strength: 3 },
      { id: 'b', name: 'Birds', strength: 9 },
    ],
  },
  memories: [
    { id: 'm1', at: 1, summary: 'Watched the pond.', cues: [], placeId: 'pond' },
    {
      id: 'm2',
      at: 2,
      summary: 'Read about reeds.',
      cues: [],
      placeId: 'pond',
      sourceUrl: 'https://example.org/reeds',
      sourceTitle: 'Reeds',
    },
  ],
  events: [{ id: 'e1', at: 3, type: 'interest_changed', message: 'Hubert chose birds.' }],
  research: [{ id: 'r1', at: 4, topic: 'Common reed', status: 'reading', sources: [] }],
  thoughts: { available: true, enabled: true, entries: [{ id: 't', at: 5, text: 'Earlier.' }] },
} as unknown as PublicSnapshot;

it('labels a note only with what its supplied facts were about', () => {
  expect(
    notebookTopics(snapshot, [
      { id: 'm1', summary: '' },
      { id: 'm2', summary: '' },
      { id: 'e1', summary: '' },
      { id: 'unknown', summary: '' },
    ]),
  ).toEqual([
    { kind: 'place', id: 'pond', label: 'The pond' },
    { kind: 'reading', id: 'https://example.org/reeds', label: 'Reeds' },
    { kind: 'interest', id: 'e1', label: 'A change of interest' },
  ]);
  expect(notebookTopics(snapshot, [{ id: 'unknown', summary: '' }])).toEqual([]);
});

it('builds a thought request from the public moment and tells one moment from the next', () => {
  const input = thoughtInput(snapshot, 'pond');
  expect(input).toEqual({
    form: 'thought',
    facts: [
      { id: 'now', summary: 'Right now: Looking more closely, at The pond.' },
      { id: 'r1', summary: 'Looking into Common reed on the web.' },
      { id: 'm2', summary: 'Read about reeds.' },
    ],
    interests: ['Birds', 'Water'],
    recentNotes: ['Earlier.'],
  });
  expect(thoughtMoment(snapshot, 'pond').key).not.toBe(thoughtMoment(snapshot, undefined).key);
  expect(thoughtMoment(snapshot, 'pond').resting).toBe(false);
});
