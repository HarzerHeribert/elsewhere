import type { PublicPursuit, PublicPursuitEntry } from '@elsewhere/character-interfaces';

type Entry<K extends PublicPursuitEntry['kind']> = Extract<PublicPursuitEntry, { kind: K }>;
/** One entry of a line of questions, with the question it was recorded under. */
export type Filed<K extends PublicPursuitEntry['kind']> = Entry<K> & { pursuit: PublicPursuit };

/**
 * Questions that belong together: reworded versions of one question, or questions worked on at
 * the same object. Shown as one line of work instead of as many separate things.
 */
export interface PursuitThread {
  id: string;
  /** The question that stands for the line: the active one, else the one touched last. */
  lead: PublicPursuit;
  /** Every question of the line, newest first, the lead included. */
  pursuits: PublicPursuit[];
  /** The object most of the line's tries were made at, as its readings name it. */
  object?: string;
  status: PublicPursuit['status'];
  lastAt: number;
  /** Newest first. */
  readings: Filed<'tried'>[];
  notes: Filed<'note'>[];
  made: Filed<'made'>[];
  sources: Filed<'read'>[];
  searches: Filed<'search'>[];
  /** What is still to find out, the lead's own first, without repeats. */
  questions: string[];
}

const STOP = new Set(
  (
    'a an the of to in at on and or is are was does do did would will another also i it its this ' +
    'that than with for by be as from between whether how why what which so can could still same ' +
    'my me'
  ).split(' '),
);
/** The content words of a question, lightly stemmed. */
export function questionWords(question: string): Set<string> {
  const words = new Set<string>();
  for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    if (!/\d/.test(raw) && raw.length < 3) continue;
    words.add(raw.length > 4 ? raw.replace(/(ing|ed|es|s)$/, '') : raw);
  }
  return words;
}
/** Whether two questions are one question in different words. */
export function sameQuestion(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5;
}

/** A reading as the world words it: "Tried <what> on <the object>. <what happened>". */
export function parseReading(text: string): { action?: string; object?: string; result: string } {
  const match = /^Tried (.+?) on (the .+?)\. ([\s\S]+)$/.exec(text);
  return match ? { action: match[1], object: match[2], result: match[3]! } : { result: text };
}

const UNIT_WORDS =
  'degrees?|swings?|seconds?|minutes?|hours?|days?|turns?|times|bars?|metres?|meters?|grams?|hertz';
const NOT_UNITS = new Set(
  'of to in on at and or is as the for it was had by per vs now are but a an if so no'.split(' '),
);
const QUANTITY = new RegExp(
  String.raw`(?<![A-Za-z\d.])\d+(?:[.,]\d+)?(?:[–-]\d+(?:[.,]\d+)?)?(?:\s?(?:°|%|(?:${UNIT_WORDS})\b|[A-Za-zµ]{1,3}\b))?`,
  'g',
);
/** A sentence cut into plain text and its measurements (a number with its unit). */
export function quantityParts(text: string): Array<{ text: string; quantity: boolean }> {
  const parts: Array<{ text: string; quantity: boolean }> = [];
  let from = 0;
  for (const match of text.matchAll(QUANTITY)) {
    let found = match[0];
    const unit = /\s?([A-Za-zµ]+)$/.exec(found);
    // "2 of", "80 and": the word after the number is not its unit.
    if (unit && NOT_UNITS.has(unit[1]!.toLowerCase()))
      found = found.slice(0, found.length - unit[0].length);
    const at = match.index;
    if (at > from) parts.push({ text: text.slice(from, at), quantity: false });
    parts.push({ text: found, quantity: true });
    from = at + found.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), quantity: false });
  return parts;
}

/** The question in words. A question that only names another by its id borrows that one's words. */
export function questionText(pursuit: PublicPursuit, all: readonly PublicPursuit[] = []): string {
  if (!/^pursuit-[0-9a-f-]{8,}$/i.test(pursuit.question.trim())) return pursuit.question;
  return (
    all.find((other) => other.id === pursuit.question.trim() && other.id !== pursuit.id)
      ?.question ?? 'An earlier question, taken up again'
  );
}

/** The object most of a question's tries were made at. */
function mainObject(pursuit: PublicPursuit): { key: string; name?: string } | undefined {
  const counts = new Map<string, { n: number; name?: string }>();
  for (const entry of pursuit.entries) {
    if (entry.kind !== 'tried') continue;
    const name = parseReading(entry.text).object;
    const key = entry.objectId + '|' + (name ?? '');
    const seen = counts.get(key) ?? { n: 0, name };
    seen.n++;
    counts.set(key, seen);
  }
  let best: { key: string; name?: string; n: number } | undefined;
  for (const [key, value] of counts) if (!best || value.n > best.n) best = { key, ...value };
  return best;
}

const pick = <K extends PublicPursuitEntry['kind']>(pursuits: PublicPursuit[], kind: K) =>
  pursuits
    .flatMap((pursuit) =>
      pursuit.entries.flatMap((entry) =>
        entry.kind === kind ? [{ ...(entry as Entry<K>), pursuit }] : [],
      ),
    )
    .sort((a, b) => b.at - a.at);

/** The lines of questions, the one being followed now first, then by when they were last touched. */
export function pursuitThreads(pursuits: readonly PublicPursuit[]): PursuitThread[] {
  const parent = pursuits.map((_, index) => index);
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const words = pursuits.map((pursuit) => questionWords(questionText(pursuit, pursuits)));
  const objects = pursuits.map(mainObject);
  for (let a = 0; a < pursuits.length; a++)
    for (let b = a + 1; b < pursuits.length; b++)
      if ((objects[a] && objects[a]!.key === objects[b]?.key) || sameQuestion(words[a]!, words[b]!))
        parent[find(a)] = find(b);
  const groups = new Map<number, PublicPursuit[]>();
  pursuits.forEach((pursuit, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), pursuit]);
  });
  const threads = [...groups.values()].map((members): PursuitThread => {
    const sorted = [...members].sort((a, b) => b.lastAt - a.lastAt);
    const lead =
      sorted.find((pursuit) => pursuit.status === 'active') ??
      sorted.find((pursuit) => pursuit.status === 'open') ??
      sorted[0]!;
    const questions: string[] = [];
    for (const pursuit of [lead, ...sorted.filter((item) => item !== lead)])
      if (pursuit === lead || pursuit.status !== 'set-aside')
        for (const question of pursuit.questions)
          if (!questions.includes(question)) questions.push(question);
    const readings = pick(sorted, 'tried');
    return {
      id: lead.id,
      lead,
      pursuits: sorted,
      object: readings.map((reading) => parseReading(reading.text).object).find(Boolean),
      status: lead.status,
      lastAt: Math.max(...sorted.map((pursuit) => pursuit.lastAt)),
      readings,
      notes: pick(sorted, 'note'),
      // A page rewritten for a later question is still one page: its newest version stands.
      made: pick(sorted, 'made').filter(
        (entry, index, list) => list.findIndex((other) => other.path === entry.path) === index,
      ),
      sources: pick(sorted, 'read'),
      searches: pick(sorted, 'search'),
      questions,
    };
  });
  const rank = (thread: PursuitThread) => (thread.status === 'active' ? 0 : 1);
  return threads.sort((a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt);
}

/** Whether a line of questions has anything written down. */
export const threadHasRecord = (thread: PursuitThread) =>
  thread.notes.length + thread.readings.length + thread.made.length + thread.questions.length > 0;
