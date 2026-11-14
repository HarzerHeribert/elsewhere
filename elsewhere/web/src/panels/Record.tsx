import { Fragment, type ReactNode } from 'react';
import type { PublicPursuit } from '@elsewhere/character-interfaces';
import { calendarDay, formatDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';
import { Icon } from '../Icon';
import {
  parseReading,
  quantityParts,
  questionText,
  type Filed,
  type PursuitThread,
} from '../pursuitThreads';

// The pieces every panel builds a resident's record from, so a question, a reading, a note and a
// made page look the same wherever they appear.

/** A moment as a time of day, with its date when it was not today. */
export function When({ at }: { at: number }) {
  const wall = useWallTime()(at);
  const day = calendarDay(wall);
  return (
    <time className="row-time">
      {day !== calendarDay(Date.now()) && <span>{formatDay(day, 'short')}</span>}
      {formatTime(wall)}
    </time>
  );
}

/** A sentence with its measurements set apart, so the numbers can be picked out at a glance. */
export function Measured({ text }: { text: string }) {
  return (
    <>
      {quantityParts(text).map((part, index) =>
        part.quantity ? (
          <b className="qty" key={index}>
            {part.text}
          </b>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export function SectionHead({ label, count }: { label: string; count?: number }) {
  return (
    <p className="eyebrow record-head">
      {label}
      {!!count && <span>{count}</span>}
    </p>
  );
}

const statusLabel = { active: 'following now', open: 'open', 'set-aside': 'set aside' } as const;
export function StatusTag({ status }: { status: PublicPursuit['status'] }) {
  return <span className={'status-tag ' + status}>{statusLabel[status]}</span>;
}

/** One reading: when, what was done, what came of it. */
export function ReadingRow({ at, text }: { at: number; text: string }) {
  const { action, result } = parseReading(text);
  return (
    <li className="reading-row">
      <When at={at} />
      <div>
        {action && <span className="reading-what">{action}</span>}
        <p>
          <Measured text={result} />
        </p>
      </div>
    </li>
  );
}

/** Readings newest first; a line marks where they were taken for a different question. */
export function ReadingList({
  readings,
  lead,
  all,
  limit,
}: {
  readings: readonly Filed<'tried'>[];
  lead: PublicPursuit;
  all: readonly PublicPursuit[];
  limit: number;
}) {
  let last = lead.id;
  const rows = readings.map((reading) => {
    const changed = reading.pursuit.id !== last;
    last = reading.pursuit.id;
    return (
      <Fragment key={reading.id}>
        {changed && <li className="reading-for">For: {questionText(reading.pursuit, all)}</li>}
        <ReadingRow at={reading.at} text={reading.text} />
      </Fragment>
    );
  });
  return (
    <Folded rows={rows} limit={limit} wrap={(part) => <ol className="reading-list">{part}</ol>} />
  );
}

/** A note in the resident's own words. */
export function NoteCard({
  text,
  at,
  surprised,
}: {
  text: string;
  at?: number;
  surprised?: boolean;
}) {
  return (
    <article className="note-card">
      <p>{text}</p>
      {(surprised || at !== undefined) && (
        <footer>
          {at !== undefined && <When at={at} />}
          {surprised && <small>That surprised me.</small>}
        </footer>
      )}
    </article>
  );
}

/** Rows that fold away after the first few. */
function Folded({
  rows,
  limit,
  wrap,
}: {
  rows: ReactNode[];
  limit: number;
  wrap: (rows: ReactNode[]) => ReactNode;
}) {
  return (
    <>
      {wrap(rows.slice(0, limit))}
      {rows.length > limit && (
        <details className="more-rows">
          <summary>
            <span>Show all {rows.length}</span>
            <Icon name="chevron-down" />
          </summary>
          {wrap(rows.slice(limit))}
        </details>
      )}
    </>
  );
}

/** Notes newest first, optionally under the day they were written; a line marks a change of question. */
export function NoteList({
  notes,
  lead,
  all,
  limit,
  days = false,
}: {
  notes: readonly Filed<'note'>[];
  lead?: PublicPursuit;
  all: readonly PublicPursuit[];
  limit: number;
  days?: boolean;
}) {
  const toWall = useWallTime();
  let lastDay: number | undefined;
  let last = lead?.id;
  const cards = notes.map((note) => {
    const day = calendarDay(toWall(note.at));
    const heading = days && day !== lastDay;
    lastDay = day;
    const changed = note.pursuit.id !== last;
    last = note.pursuit.id;
    return (
      <div key={note.id}>
        {heading && <p className="day-rule eyebrow">{formatDay(day)}</p>}
        {changed && <p className="reading-for">For: {questionText(note.pursuit, all)}</p>}
        <NoteCard text={note.text} at={note.at} surprised={note.surprised} />
      </div>
    );
  });
  return (
    <Folded rows={cards} limit={limit} wrap={(rows) => <div className="note-list">{rows}</div>} />
  );
}

/** Something made: a page, a file, a link. Opens in a new tab when it has an address. */
export function MadeLink({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span aria-hidden="true">◈</span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
      {href && <Icon name="arrow" />}
    </>
  );
  return href ? (
    <a className="made-link" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <div className="made-link">{body}</div>
  );
}

/** A question as one row of a list: its words, where it stands, and why it was taken up. */
export function QuestionRow({
  pursuit,
  all,
  children,
}: {
  pursuit: PublicPursuit;
  all: readonly PublicPursuit[];
  children?: ReactNode;
}) {
  return (
    <div className="question-row">
      <div>
        <strong>{questionText(pursuit, all)}</strong>
        <StatusTag status={pursuit.status} />
      </div>
      {pursuit.why && <small>{pursuit.why}</small>}
      {pursuit.setAsideReason && <small>Set aside: {pursuit.setAsideReason}</small>}
      {children}
    </div>
  );
}

/** How many questions a line holds and where they were worked on. */
export function threadSpan(thread: PursuitThread) {
  const n = thread.pursuits.length;
  if (n < 2) return '';
  return thread.object
    ? `One of ${n} questions at ${thread.object}`
    : `One of ${n} related questions`;
}
export function threadCounts(thread: PursuitThread) {
  const count = (n: number, one: string, many: string) => (n === 1 ? '1 ' + one : n + ' ' + many);
  return [
    thread.readings.length && count(thread.readings.length, 'try', 'tries'),
    thread.notes.length && count(thread.notes.length, 'note', 'notes'),
    thread.made.length && thread.made.length + ' made',
    thread.questions.length && thread.questions.length + ' still open',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The other questions of a line, folded away under the one that leads it. */
export function QuestionKin({
  thread,
  all,
}: {
  thread: PursuitThread;
  all: readonly PublicPursuit[];
}) {
  const others = thread.pursuits.filter((pursuit) => pursuit !== thread.lead);
  if (!others.length) return null;
  return (
    <details className="question-kin">
      <summary>
        <span>{threadSpan(thread)}</span>
        <Icon name="chevron-down" />
      </summary>
      {others.map((pursuit) => (
        <QuestionRow key={pursuit.id} pursuit={pursuit} all={all} />
      ))}
    </details>
  );
}

/** What a line of questions has gathered, always in the same order: tried, concluded, made, open. */
export function ThreadRecord({
  thread,
  all,
  readingLimit,
  noteLimit,
  days = false,
}: {
  thread: PursuitThread;
  all: readonly PublicPursuit[];
  readingLimit: number;
  noteLimit: number;
  days?: boolean;
}) {
  return (
    <>
      {thread.readings.length > 0 && (
        <section className="record-part" aria-label="What I tried">
          <SectionHead label="What I tried" count={thread.readings.length} />
          <ReadingList
            readings={thread.readings}
            lead={thread.lead}
            all={all}
            limit={readingLimit}
          />
        </section>
      )}
      {thread.notes.length > 0 && (
        <section className="record-part" aria-label="What I concluded">
          <SectionHead label="What I concluded" count={thread.notes.length} />
          <NoteList
            notes={thread.notes}
            lead={thread.lead}
            all={all}
            limit={noteLimit}
            days={days}
          />
        </section>
      )}
      {thread.made.length > 0 && (
        <section className="record-part" aria-label="What I made">
          <SectionHead label="What I made" count={thread.made.length} />
          {thread.made.map((entry) => (
            <MadeLink
              key={entry.id}
              title={entry.title}
              href={entry.url.startsWith('https://') ? entry.url : undefined}
            >
              <small>{entry.path}</small>
            </MadeLink>
          ))}
        </section>
      )}
      {thread.questions.length > 0 && (
        <section className="record-part" aria-label="Still to find out">
          <SectionHead label="Still to find out" count={thread.questions.length} />
          <Folded
            rows={thread.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
            limit={5}
            wrap={(rows) => <ul className="open-questions">{rows}</ul>}
          />
        </section>
      )}
    </>
  );
}
