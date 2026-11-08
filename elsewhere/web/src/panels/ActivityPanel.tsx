import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { formatTime } from '../formatTime';

export function ActivityPanel({
  events,
  memories,
  notices,
  feed,
  onFeedChange,
}: {
  events: PublicSnapshot['events'];
  memories: PublicSnapshot['memories'];
  notices: ReadonlyArray<{ id: string; title: string; text: string }>;
  feed: 'events' | 'memories';
  onFeedChange: (feed: 'events' | 'memories') => void;
}) {
  return (
    <>
      <div className="panel-tabs" role="group" aria-label="Activity feed">
        <button aria-pressed={feed === 'events'} onClick={() => onFeedChange('events')}>
          Events
        </button>
        <button aria-pressed={feed === 'memories'} onClick={() => onFeedChange('memories')}>
          Memories
        </button>
      </div>
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
      <div className="notes-list">
        {feed === 'events'
          ? [...(events ?? [])]
              .reverse()
              .slice(0, 20)
              .map((e) => (
                <article className="note-row" key={e.id}>
                  <time>{formatTime(e.at)}</time>
                  <p>{e.message}</p>
                </article>
              ))
          : [...(memories ?? [])].reverse().map((m) => (
              <article className="memory-row" key={m.id}>
                <time>{formatTime(m.at)}</time>
                <p>{m.summary}</p>
                <small>{m.placeId?.replace(/-/g, ' ')}</small>
              </article>
            ))}
      </div>
      {feed === 'memories' && !memories.length && (
        <p className="empty-state">His first experiences will find a place here.</p>
      )}
    </>
  );
}
