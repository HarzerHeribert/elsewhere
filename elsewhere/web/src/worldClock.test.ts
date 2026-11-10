import { describe, expect, it } from 'vitest';
import { calendarDay, formatDay } from './formatTime';
import { wallTime } from './worldClock';

const hour = 3_600_000;
describe('showing world time as real time', () => {
  it('leaves times alone when the world reports no clock', () => {
    expect(wallTime(5_000)).toBe(5_000);
    expect(wallTime(5_000, { clock: [], simulationRate: 1 })).toBe(5_000);
  });
  it('uses the stretch a moment falls in, and the first one for anything earlier', () => {
    // The world ran from real 100h, stood still for 26h at world time 3h, then ran on.
    const clock = {
      simulationRate: 1,
      clock: [
        { at: 1 * hour, wall: 100 * hour },
        { at: 3 * hour, wall: 128 * hour },
      ],
    };
    expect(wallTime(0, clock)).toBe(99 * hour);
    expect(wallTime(2 * hour, clock)).toBe(101 * hour);
    expect(wallTime(3 * hour, clock)).toBe(128 * hour);
    expect(wallTime(4.5 * hour, clock)).toBe(129.5 * hour);
  });
  it('accounts for a world that runs faster than real time', () => {
    const clock = { simulationRate: 3, clock: [{ at: 0, wall: 50 * hour }] };
    expect(wallTime(3 * hour, clock)).toBe(51 * hour);
  });
  it("names calendar days in the reader's timezone", () => {
    const noon = new Date(2026, 10, 10, 12).getTime();
    const late = new Date(2026, 10, 10, 23, 59).getTime();
    const next = new Date(2026, 10, 11, 0, 1).getTime();
    expect(calendarDay(late)).toBe(calendarDay(noon));
    expect(calendarDay(next)).toBe(calendarDay(noon) + 1);
    expect(formatDay(calendarDay(noon))).toBe(
      new Date(noon).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }),
    );
  });
});
