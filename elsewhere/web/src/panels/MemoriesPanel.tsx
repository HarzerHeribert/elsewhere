import { useId, useState, type ReactNode } from 'react';
import type { PublicMemory } from '@elsewhere/character-interfaces';
import { calendarDay, formatDay, formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';
import { useRemembered } from '../useRemembered';
import { Icon } from '../Icon';

type Sort = 'place' | 'time' | 'source';
interface Group {
  id: string;
  title: string;
  placeId?: string;
  memories: PublicMemory[];
}
const readable = (id: string) => id.replace(/-/g, ' ');

function groups(
  memories: PublicMemory[],
  sort: Sort,
  placeName: (id: string) => string,
  dayOf: (at: number) => number,
): Group[] {
  const result = new Map<string, Group>();
  const add = (id: string, group: Omit<Group, 'id' | 'memories'>, memory: PublicMemory) => {
    let value = result.get(id);
    if (!value) result.set(id, (value = { id, memories: [], ...group }));
    value.memories.push(memory);
  };
  for (const memory of memories) {
    if (sort === 'time') {
      const day = dayOf(memory.at);
      add('day:' + day, { title: formatDay(day) }, memory);
    } else if (sort === 'source') {
      if (memory.sourceUrl) add('reading', { title: 'From my reading' }, memory);
      else add('seen', { title: 'From what I saw' }, memory);
    } else if (memory.placeId)
      add(
        'place:' + memory.placeId,
        { title: placeName(memory.placeId), placeId: memory.placeId },
        memory,
      );
    else add('nowhere', { title: 'Along the way' }, memory);
  }
  return [...result.values()];
}

function MemoryGroup({
  group,
  initiallyOpen,
  onLocate,
  children,
}: {
  group: Group;
  initiallyOpen: boolean;
  onLocate?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <section className="memory-group">
      <div className="memory-group-head">
        <h4>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            <Icon name="chevron-down" />
            <span>{group.title}</span>
            <span className="memory-count" aria-label={group.memories.length + ' memories'}>
              {group.memories.length}
            </span>
          </button>
        </h4>
        {onLocate && (
          <button
            className="show-place"
            aria-label={'Show ' + group.title + ' in the world'}
            onClick={onLocate}
          >
            <Icon name="pin" />
            <span>View in world</span>
          </button>
        )}
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function MemoriesPanel({
  memories,
  places = [],
  onShowPlace,
}: {
  memories: readonly PublicMemory[];
  places?: ReadonlyArray<{ id: string; name: string }>;
  onShowPlace?: (placeId: string) => void;
}) {
  const toWall = useWallTime();
  const dayOf = (at: number) => calendarDay(toWall(at));
  const [sort, setSort] = useRemembered<Sort>('memories.sort', 'place');
  const newest = [...memories].sort((a, b) => b.at - a.at);
  const placeName = (id: string) => places.find((place) => place.id === id)?.name ?? readable(id);
  const list = groups(newest, sort, placeName, dayOf);
  return (
    <div className="memories">
      <div className="sort-row">
        <div className="ew-segments" role="group" aria-label="Sort memories">
          {(['place', 'time', 'source'] as const).map((value) => (
            <button
              key={value}
              className="ew-segment"
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {value === 'place' ? 'Place' : value === 'time' ? 'Time' : 'Source'}
            </button>
          ))}
        </div>
      </div>
      {list.map((group, index) => (
        <MemoryGroup
          key={sort + group.id}
          group={group}
          initiallyOpen={index === 0}
          onLocate={
            group.placeId && onShowPlace && places.some((place) => place.id === group.placeId)
              ? () => onShowPlace(group.placeId!)
              : undefined
          }
        >
          {group.memories.map((memory) => (
            <article className="memory-row" key={memory.id}>
              <time dateTime={new Date(toWall(memory.at)).toISOString()}>
                {sort !== 'time' && (
                  <>
                    <span>{formatDay(dayOf(memory.at), 'short')}</span>
                  </>
                )}
                {formatTime(toWall(memory.at))}
              </time>
              <p>{memory.summary}</p>
              {sort !== 'place' && memory.placeId && <small>{placeName(memory.placeId)}</small>}
              {memory.sourceUrl && (
                <a
                  href={memory.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-button"
                >
                  {memory.sourceTitle ?? 'External source'} ↗
                </a>
              )}
            </article>
          ))}
        </MemoryGroup>
      ))}
      {!memories.length && (
        <p className="empty-state">Memories appear as I experience the world.</p>
      )}
    </div>
  );
}
