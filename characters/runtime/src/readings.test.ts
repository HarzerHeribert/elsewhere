import { describe, expect, it } from 'vitest';
import {
  READINGS_KEPT,
  claimReadings,
  recentReadings,
  recordReading,
  type ReadingEntry,
} from './readings';

const reading = (n: number, at = n * 1000, extra: Partial<ReadingEntry> = {}): ReadingEntry => ({
  id: `use-${n}`,
  at,
  objectId: 'sundial',
  objectName: 'The sundial',
  control: 'read',
  text: `Tried read on the sundial. Shadow ${n}.`,
  ...extra,
});

describe('the log of readings', () => {
  it('keeps the newest forty in order and never lists one twice', () => {
    let log: ReadingEntry[] = [];
    for (let n = 0; n < READINGS_KEPT + 7; n++) log = recordReading(log, reading(n));
    expect(log).toHaveLength(READINGS_KEPT);
    expect(log[0].id).toBe('use-7');
    expect(log.at(-1)!.id).toBe(`use-${READINGS_KEPT + 6}`);
    expect(recordReading(log, reading(READINGS_KEPT + 6))).toEqual(log);
    expect(recentReadings(log, 3).map((item) => item.id)).toEqual([
      `use-${READINGS_KEPT + 4}`,
      `use-${READINGS_KEPT + 5}`,
      `use-${READINGS_KEPT + 6}`,
    ]);
  });

  it('cuts the text at 240 characters and keeps a value', () => {
    const [kept] = recordReading([], { ...reading(1, 1, { value: 3 }), text: 'x'.repeat(400) });
    expect(kept.text).toHaveLength(240);
    expect(kept.value).toBe(3);
  });

  it('claims only unclaimed readings of the window, once', () => {
    const minute = 60_000;
    const log = [
      reading(1, 0),
      reading(2, 30 * minute),
      reading(3, 50 * minute, { pursuitId: 'other' }),
      reading(4, 59 * minute),
    ];
    const first = claimReadings(log, 'new', 70 * minute, 60 * minute);
    expect(first.claimed.map((item) => item.id)).toEqual(['use-2', 'use-4']);
    expect(first.log.map((item) => item.pursuitId)).toEqual([undefined, 'new', 'other', 'new']);
    expect(claimReadings(first.log, 'later', 70 * minute, 60 * minute).claimed).toEqual([]);
  });
});
