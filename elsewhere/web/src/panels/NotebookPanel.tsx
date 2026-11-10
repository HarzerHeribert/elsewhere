import type { PublicPursuit } from '@elsewhere/character-interfaces';
import { formatDay, calendarDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

/** Per pursuit, what the resident wrote down and what it still wants to find out. */
export function NotebookPanel({ pursuits = [] }: { pursuits?: readonly PublicPursuit[] }) {
  const toWall = useWallTime();
  const withNotes = [...pursuits]
    .filter(
      (pursuit) =>
        pursuit.questions.length > 0 ||
        pursuit.entries.some((e) => e.kind === 'note' || e.kind === 'tried'),
    )
    .sort((a, b) => b.lastAt - a.lastAt);
  return (
    <div className="journal">
      <p className="panel-intro">
        What I found out, and what I still want to know, in my own words.
      </p>
      {withNotes.map((pursuit) => {
        const notes = pursuit.entries.flatMap((entry) => (entry.kind === 'note' ? [entry] : []));
        const tried = pursuit.entries.flatMap((entry) => (entry.kind === 'tried' ? [entry] : []));
        let lastDay: number | undefined;
        return (
          <section key={pursuit.id} aria-label={pursuit.question}>
            <p className="eyebrow">{pursuit.question}</p>
            {[...notes].reverse().map((note) => {
              const day = calendarDay(toWall(note.at));
              const heading = day !== lastDay;
              lastDay = day;
              return (
                <div key={note.id}>
                  {heading && <p className="day-rule eyebrow">{formatDay(day)}</p>}
                  <article className="journal-page">
                    <p>{note.text}</p>
                    {note.surprised && <small>That surprised me.</small>}
                    <time>{formatTime(toWall(note.at))}</time>
                  </article>
                </div>
              );
            })}
            {tried.length > 0 && (
              <ul className="note-topics" aria-label="Tried">
                {tried.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {pursuit.questions.length > 0 && (
              <ul className="note-topics" aria-label="Still to find out">
                {pursuit.questions.map((question) => (
                  <li key={question}>
                    <span>{question}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {!withNotes.length && (
        <p className="empty-state">
          My notebook is quiet for now. Notes appear when I have something to share.
        </p>
      )}
    </div>
  );
}
