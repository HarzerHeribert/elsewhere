import { activityRows } from '../activityFeed';
import { ResearchDetails } from './ResearchDetails';
import { NotebookPanel } from './NotebookPanel';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';

export function ActivityPanel({
  events,
  memories,
  notebook,
  research,
  notices,
  feed,
  onFeedChange,
}: {
  events: PublicSnapshot['events'];
  memories: PublicSnapshot['memories'];
  notebook?: PublicSnapshot['notebook'];
  research?: PublicSnapshot['research'];
  notices: ReadonlyArray<{ id: string; title: string; text: string }>;
  feed: 'events' | 'memories' | 'notebook';
  onFeedChange: (feed: 'events' | 'memories' | 'notebook') => void;
}) {
  return (
    <>
      <div className="panel-tabs ew-segments" role="group" aria-label="Activity feed">
        <button
          className="ew-segment"
          aria-pressed={feed === 'events'}
          onClick={() => onFeedChange('events')}
        >
          Events
        </button>
        <button
          className="ew-segment"
          aria-pressed={feed === 'memories'}
          onClick={() => onFeedChange('memories')}
        >
          Memories
        </button>
        <button
          className="ew-segment"
          aria-pressed={feed === 'notebook'}
          onClick={() => onFeedChange('notebook')}
        >
          Notebook
        </button>
      </div>
      {feed === 'notebook' && <NotebookPanel notebook={notebook} />}
      {feed === 'events' && notices.length > 0 && (
        <div className="notification-list">
          <p className="eyebrow">On your visit</p>
          {notices.slice(0, 5).map((n) => (
            <article key={n.id}>
              <i />
              <div>
                <strong>{n.title}</strong>
                <p>{n.text}</p>
              </div>
            </article>
          ))}
        </div>
      )}
      {feed === 'events' && Boolean(research?.length) && <ResearchDetails episodes={research!} />}
      {feed === 'memories' && (
        <p className="panel-intro">Experiences Hubert retains for later decisions.</p>
      )}
      <div className="notes-list">
        {feed === 'events'
          ? activityRows(events ?? []).map(({ event: e, text, count }) => (
              <article className="note-row" key={e.id}>
                <time>{formatTime(e.at)}</time>
                <div>
                  <p>
                    {text}
                    {count > 1 && <small> · {count} times</small>}
                  </p>
                  {text !== e.message && (
                    <details>
                      <summary>Observation details</summary>
                      <p>{e.message}</p>
                    </details>
                  )}
                </div>
              </article>
            ))
          : feed === 'memories'
            ? [...(memories ?? [])].reverse().map((m) => (
                <article className="memory-row" key={m.id}>
                  <time>{formatTime(m.at)}</time>
                  <p>{m.summary}</p>
                  <small>{m.placeId?.replace(/-/g, ' ')}</small>
                  {m.sourceUrl && (
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-button"
                    >
                      {m.sourceTitle ?? 'External source'} ↗
                    </a>
                  )}
                </article>
              ))
            : null}
      </div>
      {feed === 'memories' && !memories.length && (
        <p className="empty-state">Memories appear as the resident experiences the world.</p>
      )}
    </>
  );
}
