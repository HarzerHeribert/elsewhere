import type { PublicNotebook } from '@elsewhere/character-interfaces';
import { calendarDay, formatDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

/** The note being written, streamed as it arrives. Text is always rendered as plain text. */
export function NotebookDraft({
  draft,
  className = '',
}: {
  draft: NonNullable<PublicNotebook['draft']>;
  className?: string;
}) {
  return (
    <article
      className={'journal-draft ' + className}
      aria-label="Notebook draft"
      aria-live="polite"
      aria-atomic="false"
    >
      <small role="status">I’m writing this now</small>
      <p>
        {draft.text || '…'}
        <i className="caret" aria-hidden="true" />
      </p>
    </article>
  );
}

export function NotebookPanel({
  notebook,
  onShowPlace,
}: {
  notebook?: PublicNotebook;
  /** When given, a note's place can be shown in the world. */
  onShowPlace?: (placeId: string) => void;
}) {
  const toWall = useWallTime();
  const entries = [...(notebook?.entries ?? [])].reverse().slice(0, 32);
  let lastDay: number | undefined;
  return (
    <div className="journal">
      <p className="panel-intro">Questions, ideas and changing opinions, in my own words.</p>
      {notebook?.draft && <NotebookDraft draft={notebook.draft} />}
      {entries.map((entry) => {
        const day = calendarDay(toWall(entry.at));
        const heading = day !== lastDay;
        lastDay = day;
        return (
          <div key={entry.id}>
            {heading && <p className="day-rule eyebrow">{formatDay(day)}</p>}
            <article className="journal-page">
              <p>{entry.text}</p>
              {entry.topics && entry.topics.length > 0 && (
                <ul className="note-topics" aria-label="What this note is about">
                  {entry.topics.map((topic) => (
                    <li key={topic.kind + topic.id} className={topic.kind}>
                      {topic.kind === 'place' && onShowPlace ? (
                        <button onClick={() => onShowPlace(topic.id)}>{topic.label}</button>
                      ) : topic.kind === 'reading' && topic.id.startsWith('https://') ? (
                        <a href={topic.id} target="_blank" rel="noopener noreferrer">
                          {topic.label} ↗
                        </a>
                      ) : (
                        <span>{topic.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <time>{formatTime(toWall(entry.at))}</time>
            </article>
          </div>
        );
      })}
      {!entries.length && !notebook?.draft && (
        <p className="empty-state">
          My notebook is quiet for now. Notes appear when I have something to share.
        </p>
      )}
    </div>
  );
}
