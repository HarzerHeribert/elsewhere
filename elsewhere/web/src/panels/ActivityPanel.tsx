import { useCallback, useMemo } from 'react';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import {
  dayStories,
  filterStory,
  type DayStory,
  type StoryFilter,
  type StoryItem,
} from '../activityStory';
import { trailLabel } from '../trailLabels';
import { calendarDay, formatDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';
import { useRemembered } from '../useRemembered';
import { Icon } from '../Icon';

const filters: Array<{ id: StoryFilter; label: string; kind?: StoryItem['kind'] }> = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'trail', label: 'My trail', kind: 'step' },
  { id: 'made', label: 'Made', kind: 'made' },
  { id: 'all', label: 'All' },
];

export function ActivityPanel({
  events,
  memories,
  trail = [],
  notices,
  activity,
  now,
  places = [],
  initialFilter = 'highlights',
  onMemories,
  onPlace,
  onResident,
}: {
  events: PublicSnapshot['events'];
  memories: PublicSnapshot['memories'];
  trail?: PublicSnapshot['trail'];
  notices: ReadonlyArray<{ id: string; title: string; text: string }>;
  /** What the resident is doing at this moment, in the world's words. */
  activity?: string;
  /** The present moment on the world clock. */
  now: number;
  places?: ReadonlyArray<{ id: string; name: string }>;
  initialFilter?: StoryFilter;
  onMemories?: () => void;
  /** When given, a place named in the day opens that place. */
  onPlace?: (placeId: string) => void;
  /** When given, the day links to the resident's own page. */
  onResident?: () => void;
}) {
  const [filter, setFilter] = useRemembered<StoryFilter>('activity.filter', initialFilter);
  const [chosenDay, setChosenDay] = useRemembered<number | null>('activity.day', null);
  const toWall = useWallTime();
  const dayOf = useCallback((at: number) => calendarDay(toWall(at)), [toWall]);
  const stories = useMemo(
    () =>
      dayStories({
        events,
        memories,
        trail,
        dayOf,
      }),
    [events, memories, trail, dayOf],
  );
  const today = dayOf(now);
  const days = [...new Set([today, ...stories.map((story) => story.day)])].sort((a, b) => a - b);
  const day = chosenDay !== null && days.includes(chosenDay) ? chosenDay : today;
  const position = days.indexOf(day);
  const story: DayStory = stories.find((item) => item.day === day) ?? {
    day,
    items: [],
    routine: [],
    routineCount: 0,
  };
  const items = filterStory(story, filter);
  const hiddenMemories =
    filter === 'highlights'
      ? story.items.filter((item) => item.kind === 'memory').length -
        items.filter((item) => item.kind === 'memory').length
      : 0;
  const latest = trail.at(-1);
  const placeName = (id?: string) =>
    id ? (places.find((place) => place.id === id)?.name ?? id.replace(/-/g, ' ')) : undefined;
  const where = (id?: string) => {
    const name = placeName(id);
    if (!id || !name) return null;
    return (
      <>
        {' · '}
        {onPlace && places.some((place) => place.id === id) ? (
          <button className="inline-link" onClick={() => onPlace(id)}>
            {name}
          </button>
        ) : (
          name
        )}
      </>
    );
  };
  const showRoutine = (filter === 'highlights' || filter === 'all') && story.routineCount > 0;
  return (
    <div className="activity">
      <div className="day-nav">
        <button
          className="square-button subtle"
          aria-label="Earlier day"
          disabled={position <= 0}
          onClick={() => setChosenDay(days[position - 1]!)}
        >
          <Icon name="chevron-left" />
        </button>
        <strong>
          {formatDay(day)}
          {day === today && ' · today'}
        </strong>
        <button
          className="square-button subtle"
          aria-label="Later day"
          disabled={position >= days.length - 1}
          onClick={() => setChosenDay(days[position + 1]!)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="story-filters" role="group" aria-label="Show from this day">
        {filters.map((item) => {
          const count = item.kind
            ? story.items.filter((entry) => entry.kind === item.kind).length
            : 0;
          return (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {count > 0 && ' · ' + count}
            </button>
          );
        })}
      </div>
      {day === today && (filter === 'highlights' || filter === 'all') && (
        <section className="now-card" aria-label="Right now">
          <p className="now-label">
            <i />
            Right now
          </p>
          <h3>{activity ?? 'Spending time in Elsewhere'}</h3>
          {latest?.why && (
            <p className="now-thought">
              <span>{latest.why}</span>
            </p>
          )}
          {onResident && (
            <button className="follow-link" onClick={onResident}>
              Open my page <Icon name="arrow" />
            </button>
          )}
        </section>
      )}
      {day === today && filter === 'highlights' && notices.length > 0 && (
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
      <ol className="story-line">
        {items.map((item) => (
          <li key={item.id} className={'story-item ' + item.kind}>
            <time>{formatTime(toWall(item.at))}</time>
            <div>
              {item.kind === 'step' ? (
                <>
                  <p className="story-label">
                    <Icon name={item.entry.kind === 'note' ? 'pencil' : 'search'} />
                    <span>
                      {trailLabel(item.entry)}
                      {where(item.entry.placeId)}
                      {item.entry.times ? ` · ${item.entry.times} times` : ''}
                    </span>
                  </p>
                  {item.entry.why && <p className="story-thought">{item.entry.why}</p>}
                  {item.entry.text &&
                    (item.entry.kind === 'note' ? (
                      <blockquote>{item.entry.text}</blockquote>
                    ) : (
                      <p>{item.entry.text}</p>
                    ))}
                  {item.entry.kind === 'read' && item.entry.url?.startsWith('https://') && (
                    <a href={item.entry.url} target="_blank" rel="noopener noreferrer">
                      Open the page ↗
                    </a>
                  )}
                </>
              ) : item.kind === 'memory' ? (
                <>
                  <p className="story-label">
                    <Icon name="pin" />
                    <span>I kept a memory{where(item.memory.placeId)}</span>
                  </p>
                  <p>{item.memory.summary}</p>
                </>
              ) : item.kind === 'made' ? (
                <>
                  <p className="story-label">
                    <Icon name="star" />
                    {item.event.type === 'artifact_created'
                      ? 'I made something'
                      : 'Elsewhere changed'}
                  </p>
                  <p className="story-made">{item.event.message}</p>
                </>
              ) : (
                <p>{item.event.message}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {hiddenMemories > 0 && (
        <button className="follow-link quiet" onClick={onMemories}>
          {hiddenMemories === 1 ? '1 more memory' : hiddenMemories + ' more memories'} from this day{' '}
          <Icon name="arrow" />
        </button>
      )}
      {showRoutine && (
        <details className="in-between" open={filter === 'all'}>
          <summary>
            <Icon name="walk" />
            <span>
              In between ·{' '}
              {story.routineCount === 1 ? '1 small moment' : story.routineCount + ' small moments'}
            </span>
            <Icon name="chevron-down" />
          </summary>
          <div className="notes-list">
            {story.routine.map(({ event: e, text, count }) => (
              <article className="note-row" key={e.id}>
                <time>{formatTime(toWall(e.at))}</time>
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
            ))}
          </div>
        </details>
      )}
      {!items.length && !showRoutine && (
        <p className="empty-state">
          {filter === 'highlights' || filter === 'all'
            ? 'Nothing to tell from this day yet.'
            : 'Nothing of this kind on this day.'}
        </p>
      )}
    </div>
  );
}
