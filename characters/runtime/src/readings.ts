/** A reading from a working thing, kept whether or not a question is being followed. */
export interface ReadingEntry {
  id: string;
  at: number;
  objectId: string;
  objectName: string;
  control: string;
  value?: number;
  /** What was tried and what came back, in one line. */
  text: string;
  /** The pursuit this reading was put on, once it has been. */
  pursuitId?: string;
}
export const READINGS_KEPT = 40;
export const READING_TEXT_LIMIT = 240;

/** Appends one reading, keeping the newest. A reading with a known id is not added twice. */
export function recordReading(log: readonly ReadingEntry[], entry: ReadingEntry): ReadingEntry[] {
  if (log.some((known) => known.id === entry.id)) return log.map((item) => ({ ...item }));
  return [
    ...log.map((item) => ({ ...item })),
    { ...entry, text: entry.text.trim().slice(0, READING_TEXT_LIMIT) },
  ].slice(-READINGS_KEPT);
}

/** The newest `count` readings, oldest first. */
export function recentReadings(log: readonly ReadingEntry[], count: number): ReadingEntry[] {
  return log.slice(-count).map((item) => ({ ...item }));
}

/**
 * Marks the readings taken in the `windowMs` before `now` that are on no pursuit yet as being
 * on `pursuitId`, and returns them, oldest first, so the caller can put them there.
 */
export function claimReadings(
  log: readonly ReadingEntry[],
  pursuitId: string,
  now: number,
  windowMs: number,
): { log: ReadingEntry[]; claimed: ReadingEntry[] } {
  const claimed: ReadingEntry[] = [];
  const next = log.map((item) => {
    if (item.pursuitId || now - item.at > windowMs || item.at > now) return { ...item };
    const marked = { ...item, pursuitId };
    claimed.push(marked);
    return marked;
  });
  return { log: next, claimed };
}
