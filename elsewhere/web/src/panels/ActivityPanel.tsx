import { useCallback, useMemo, useState } from 'react';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import {
  currentThought,
  dayStories,
  filterStory,
  researchInProgress,
  type DayStory,
  type StoryFilter,
  type StoryItem,
} from '../activityStory';
import { calendarDay, formatDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';
import { Icon } from '../Icon';
import { NotebookDraft } from './NotebookPanel';
import { ResearchSteps, ResearchStory, researchStatus } from './ResearchDetails';

const filters: Array<{ id: StoryFilter; label: string; kind?: StoryItem['kind'] }> = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'thoughts', label: 'Thoughts', kind: 'thought' },
  { id: 'research', label: 'Research', kind: 'research' },
  { id: 'made', label: 'Made', kind: 'made' },
  { id: 'notes', label: 'Notes', kind: 'note' },
  { id: 'all', label: 'All' },
];

export function ActivityPanel({
  events,
  memories,
  notebook,
  research = [],
  thoughts,
  notices,
  activity,
  now,
  places = [],
  initialFilter = 'highlights',
  researchId,
  onResearch = () => undefined,
  onMemories,
}: {
  events: PublicSnapshot['events'];
  memories: PublicSnapshot['memories'];
  notebook?: PublicSnapshot['notebook'];
  research?: PublicSnapshot['research'];
  thoughts?: PublicSnapshot['thoughts'];
  notices: ReadonlyArray<{ id: string; title: string; text: string }>;
  /** What the resident is doing at this moment, in the world's words. */
  activity?: string;
  /** The present moment on the world clock. */
  now: number;
  places?: ReadonlyArray<{ id: string; name: string }>;
  initialFilter?: StoryFilter;
  researchId?: string | null;
  onResearch?: (id: string | null) => void;
  onMemories?: () => void;
}) {
  const [filter, setFilter] = useState<StoryFilter>(initialFilter);
  const [chosenDay, setChosenDay] = useState<number | null>(null);
  const toWall = useWallTime();
  const dayOf = useCallback((at: number) => calendarDay(toWall(at)), [toWall]);
  const stories = useMemo(
    () =>
      dayStories({
        events,
        memories,
        notes: notebook?.entries ?? [],
        research,
        thoughts: thoughts?.entries,
        dayOf,
      }),
    [events, memories, notebook?.entries, research, thoughts?.entries, dayOf],
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
  const opened = research.find((episode) => episode.id === researchId);
  if (opened)
    return <ResearchStory episode={opened} backLabel="Activity" onBack={() => onResearch(null)} />;
  const latest = research.at(-1);
  const live = researchInProgress(latest) ? latest : undefined;
  const thinking = currentThought(thoughts?.entries, now);
  const filterList = filters.filter(
    (item) => item.id !== 'thoughts' || thoughts?.enabled || thoughts?.entries.length,
  );
  const placeName = (id?: string) =>
    id ? (places.find((place) => place.id === id)?.name ?? id.replace(/-/g, ' ')) : undefined;
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
        {filterList.map((item) => {
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
          {live ? (
            <>
              <p className="now-label">
                <i />
                Right now · I’m researching
              </p>
              <h3>{live.topic}</h3>
              <ResearchSteps episode={live} />
              <button className="follow-link" onClick={() => onResearch(live.id)}>
                Follow along <Icon name="arrow" />
              </button>
            </>
          ) : notebook?.draft ? (
            <>
              <p className="now-label">
                <i />
                Right now · I’m writing
              </p>
              <NotebookDraft draft={notebook.draft} className="on-dark" />
            </>
          ) : (
            <>
              <p className="now-label">
                <i />
                Right now
              </p>
              <h3>{activity ?? 'Spending time in Elsewhere'}</h3>
            </>
          )}
          {thinking && (
            <p className="now-thought">
              <Icon name="thought" />
              <span>{thinking.text}</span>
            </p>
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
              {item.kind === 'research' ? (
                <>
                  <p className="story-label">
                    <Icon name="search" />
                    {researchInProgress(item.episode)
                      ? 'I’m looking something up'
                      : 'I looked something up'}
                  </p>
                  <button className="story-card" onClick={() => onResearch(item.episode.id)}>
                    <strong>{item.episode.topic}</strong>
                    <small>
                      {researchStatus(item.episode)} ·{' '}
                      {item.episode.sources.length === 1
                        ? '1 source'
                        : item.episode.sources.length + ' sources'}
                    </small>
                    <Icon name="chevron-right" />
                  </button>
                </>
              ) : item.kind === 'note' ? (
                <>
                  <p className="story-label">
                    <Icon name="pencil" />I wrote in my notebook
                  </p>
                  <blockquote>{item.entry.text}</blockquote>
                </>
              ) : item.kind === 'thought' ? (
                <>
                  <p className="story-label">
                    <Icon name="thought" />I thought
                    {placeName(item.thought.placeId) && ' · ' + placeName(item.thought.placeId)}
                  </p>
                  <p className="story-thought">{item.thought.text}</p>
                </>
              ) : item.kind === 'memory' ? (
                <>
                  <p className="story-label">
                    <Icon name="pin" />I kept a memory
                    {placeName(item.memory.placeId) && ' · ' + placeName(item.memory.placeId)}
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
