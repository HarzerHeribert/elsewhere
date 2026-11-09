import type { PublicNotebook } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';

export function NotebookPanel({
  notebook,
  preview = false,
}: {
  notebook?: PublicNotebook;
  preview?: boolean;
}) {
  const entries = [...(notebook?.entries ?? [])].reverse().slice(0, preview ? 1 : 32);
  return (
    <div className="notebook">
      <p className="eyebrow">{preview ? 'In his words' : 'Hubert’s notebook'}</p>
      {!preview && (
        <p className="panel-intro">
          Observations and questions Hubert has written about his experiences.
        </p>
      )}
      {notebook?.draft && (
        <article
          className="memory-glimpse notebook-draft"
          aria-label="Notebook draft"
          aria-live="polite"
          aria-atomic="false"
        >
          <small role="status">Writing a note…</small>
          <p>{notebook.draft.text || '…'}</p>
        </article>
      )}
      {entries.map((entry) => (
        <article className="memory-row" key={entry.id}>
          {!preview && <time>{formatTime(entry.at)}</time>}
          <p>{entry.text}</p>
        </article>
      ))}
      {!entries.length && !notebook?.draft && (
        <p className="empty-state">
          His notebook is quiet for now. Notes appear when he has something to share.
        </p>
      )}
    </div>
  );
}
