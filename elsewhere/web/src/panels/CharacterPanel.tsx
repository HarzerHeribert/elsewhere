import { useEffect, useRef, useState } from 'react';
import { CharacterMailPreferences } from '../CharacterMail';
import type {
  AccountCharacterMail,
  MailPreferences,
  PublicCharacterMail,
} from '../../../../characters/interfaces/src/mail';
import { NotebookDraft, NotebookPanel } from './NotebookPanel';
import { MemoriesPanel } from './MemoriesPanel';
import { ResearchList, ResearchSteps, ResearchStory } from './ResearchDetails';
import { CreationsPanel } from './CreationsPanel';
import { Button } from '../ui/Button';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { CharacterInterests } from '../WildlifePanel';
import { Icon } from '../Icon';
import { Meter } from '../Meter';
import { activityRows } from '../activityFeed';
import { currentThought, researchInProgress } from '../activityStory';
import { formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

export type CharacterTab = 'now' | 'notebook' | 'memories' | 'research' | 'about';
const tabs: Array<{ id: CharacterTab; label: string }> = [
  { id: 'now', label: 'Right now' },
  { id: 'notebook', label: 'My notebook' },
  { id: 'memories', label: 'My memories' },
  { id: 'research', label: 'My research' },
  { id: 'about', label: 'About me' },
];

export function CharacterPanel({
  character,
  tab: controlledTab,
  onTabChange,
  mail,
  accountMail,
  signedIn = false,
  emailVerified = false,
  mailPending = false,
  onSignIn = () => undefined,
  onMailPreferences = async () => false,
  recalledMemory,
  creations,
  notebook,
  events = [],
  memories = [],
  research = [],
  thoughts,
  now,
  places = [],
  researchId,
  onResearch = () => undefined,
  onShowPlace,
  onMessage,
  onViewpoint,
  onWishes,
  onDay,
}: {
  character: PublicSnapshot['character'];
  tab?: CharacterTab;
  onTabChange?: (tab: CharacterTab) => void;
  mail?: PublicCharacterMail | null;
  accountMail?: AccountCharacterMail;
  signedIn?: boolean;
  emailVerified?: boolean;
  mailPending?: boolean;
  onSignIn?: () => void;
  onMailPreferences?: (preferences: MailPreferences) => Promise<boolean>;
  recalledMemory?: PublicSnapshot['recalledMemory'];
  artifacts?: PublicSnapshot['artifacts'];
  creations?: PublicSnapshot['creations'];
  notebook?: PublicSnapshot['notebook'];
  events?: PublicSnapshot['events'];
  memories?: PublicSnapshot['memories'];
  research?: PublicSnapshot['research'];
  thoughts?: PublicSnapshot['thoughts'];
  /** World time, used to tell a current thought from an earlier one. */
  now?: number;
  places?: ReadonlyArray<{ id: string; name: string }>;
  researchId?: string | null;
  onResearch?: (id: string | null) => void;
  onShowPlace?: (placeId: string) => void;
  onMessage: () => void;
  onViewpoint: () => void;
  onWishes: () => void;
  /** When given, the page links to the full account of the day. */
  onDay?: () => void;
}) {
  const toWall = useWallTime();
  const [ownTab, setOwnTab] = useState<CharacterTab>('now');
  const tab = controlledTab ?? ownTab;
  const choose = (next: CharacterTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  // A newly chosen page starts at its top, with its tab in view on a narrow panel.
  const pages = useRef<HTMLDivElement>(null);
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    const bar = pages.current;
    const scroller = bar?.closest('.panel-scroll');
    if (scroller) scroller.scrollTop = 0;
    const active = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active && bar)
      bar.scrollLeft = Math.max(0, active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2);
  }, [tab]);
  const latest = research?.at(-1);
  const live = researchInProgress(latest) ? latest : undefined;
  const opened = research?.find((episode) => episode.id === researchId);
  const thinking = now === undefined ? undefined : currentThought(thoughts?.entries, now);
  // Only what the world already publishes: shared thoughts, finished notes and what he was seen
  // doing. The current thought is shown on its own below.
  const earlier = [
    ...(thoughts?.entries ?? [])
      .filter((entry) => entry.id !== thinking?.id)
      .slice(-3)
      .map((entry) => ({ id: 'thought:' + entry.id, at: entry.at, note: entry.text, seen: '' })),
    ...(notebook?.entries ?? []).slice(thoughts?.entries.length ? -1 : -3).map((entry) => ({
      id: 'note:' + entry.id,
      at: entry.at,
      note: entry.text,
      seen: '',
    })),
    ...activityRows(events)
      .slice(0, 3)
      .map((row) => ({ id: 'event:' + row.event.id, at: row.event.at, note: '', seen: row.text })),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-5);
  const attention = [...character.interests].sort((a, b) => b.strength - a.strength).slice(0, 3);
  return (
    <>
      <div className="page-tabs" role="group" aria-label={character.name + '’s pages'} ref={pages}>
        {tabs.map((item) => (
          <button key={item.id} aria-pressed={tab === item.id} onClick={() => choose(item.id)}>
            {item.id === 'now' && <i />}
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'now' && (
        <div className="now-stream">
          <p className="stream-note">
            {thoughts?.enabled
              ? 'What I’m doing, thinking and writing, as it happens. I share these thoughts myself; the rest stays my own.'
              : 'What I’m doing and writing, as it happens. My thoughts stay my own until I write them down.'}
            {onDay && (
              <>
                {' '}
                <button className="inline-link" onClick={onDay}>
                  See my whole day
                </button>
              </>
            )}
          </p>
          {earlier.map((item, index) =>
            item.note ? (
              <p
                key={item.id}
                className="stream-thought"
                data-age={Math.min(3, earlier.length - index)}
              >
                {item.note}
              </p>
            ) : (
              <p key={item.id} className="stream-marker">
                <span>
                  {item.seen} · {formatTime(toWall(item.at))}
                </span>
              </p>
            ),
          )}
          {thinking && (
            <figure className="now-thinking" aria-label="What I’m thinking">
              <figcaption>
                <Icon name="thought" />
                I’m thinking · {formatTime(toWall(thinking.at))}
              </figcaption>
              <p>{thinking.text}</p>
            </figure>
          )}
          <section className="now-focus" aria-label="Right now">
            {notebook?.draft ? (
              <NotebookDraft draft={notebook.draft} />
            ) : live ? (
              <>
                <p className="now-label">
                  <i />
                  I’m researching
                </p>
                <h3>{live.topic}</h3>
                <ResearchSteps episode={live} />
                <button
                  className="follow-link"
                  onClick={() => {
                    choose('research');
                    onResearch(live.id);
                  }}
                >
                  Follow along <Icon name="arrow" />
                </button>
              </>
            ) : (
              <>
                <p className="now-label">
                  <i />
                  Right now
                </p>
                <h3>{character.activity}</h3>
              </>
            )}
          </section>
          <div className="stats now-stats">
            <Meter label="Mood" value={character.mood} />
            <Meter label="Energy" value={character.energy} />
          </div>
          {attention.length > 0 && (
            <p className="attention">
              <span>What I’m paying attention to</span>
              {attention.map((interest) => (
                <b key={interest.id}>{interest.name}</b>
              ))}
            </p>
          )}
          <div className="panel-actions">
            <Button onClick={onMessage}>
              <Icon name="mail" />
              Message {character.name}
            </Button>
            <Button variant="secondary" onClick={onViewpoint}>
              <Icon name="eye" />
              See through my eyes
            </Button>
          </div>
        </div>
      )}
      {tab === 'notebook' && <NotebookPanel notebook={notebook} onShowPlace={onShowPlace} />}
      {tab === 'memories' && (
        <MemoriesPanel memories={memories} places={places} onShowPlace={onShowPlace} />
      )}
      {tab === 'research' &&
        (opened ? (
          <ResearchStory episode={opened} />
        ) : (
          <ResearchList episodes={research ?? []} onOpen={onResearch} />
        ))}
      {tab === 'about' && (
        <>
          <div className="character-profile">
            <HubertPortrait />
            <div>
              <span className="tag">Founding resident</span>
              <p>Follow what I decide, look through what I remember, or leave me a note.</p>
            </div>
          </div>
          <div className="panel-section">
            <p className="eyebrow">Interests</p>
            <CharacterInterests interests={character.interests} />
          </div>
          {recalledMemory && (
            <div className="memory-glimpse">
              <p className="eyebrow">Recalled memory</p>
              <p>{recalledMemory.summary}</p>
            </div>
          )}
          <div className="panel-links">
            <button onClick={onWishes}>
              My wishes <Icon name="arrow" />
            </button>
          </div>
          <CharacterMailPreferences
            mail={mail}
            accountMail={accountMail}
            signedIn={signedIn}
            emailVerified={emailVerified}
            pending={mailPending}
            onSignIn={onSignIn}
            onChange={onMailPreferences}
          />
          <CreationsPanel
            characterId={character.id}
            characterName={character.name}
            creations={creations}
          />
        </>
      )}
    </>
  );
}
