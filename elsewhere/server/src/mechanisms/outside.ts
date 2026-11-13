import { HOUR, ago, round } from './common.js';

/** A value taken this long ago or longer says so in its reading. */
export const OLD_AFTER_MS = 6 * HOUR;

/** A time as UTC: the clock alone on the same UTC day as `now`, with the date otherwise. */
export function utc(ms: number, now: number): string {
  const iso = new Date(ms).toISOString();
  const clock = `${iso.slice(11, 16)} UTC`;
  return iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
    ? clock
    : `${iso.slice(0, 10)} ${clock}`;
}

/** The sentence added when a value is older than six hours; empty otherwise. */
export function takenNote(takenAt: number, now: number): string {
  return now - takenAt > OLD_AFTER_MS ? ` These figures were taken ${ago(now - takenAt)}.` : '';
}

/** A number with at most one decimal and no trailing zero. */
export const plain = (value: number) => String(Math.round(value * 10) / 10);
export const fixed = (value: number, digits = 1) => round(value, digits);

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const monthName = (ms: number) => MONTHS[new Date(ms).getUTCMonth()];
