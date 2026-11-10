import { useEffect, useRef, useState } from 'react';
import { CharacterMailPreferences } from '../CharacterMail';
import type {
  AccountCharacterMail,
  MailPreferences,
  PublicCharacterMail,
} from '../../../../characters/interfaces/src/mail';
import { NotebookPanel } from './NotebookPanel';
import { MemoriesPanel } from './MemoriesPanel';
import { CreationsPanel } from './CreationsPanel';
import { Button } from '../ui/Button';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { Icon } from '../Icon';
import { Meter } from '../Meter';
import { activityRows } from '../activityFeed';
import { trailLabel } from '../trailLabels';
import { formatTime } from '../formatTime';
import { useWallTime } from '../worldClock';

export type CharacterTab = 'now' | 'notebook' | 'memories' | 'about';
const tabs: Array<{ id: CharacterTab; label: string }> = [
  { id: 'now', label: 'Right now' },
  { id: 'notebook', label: 'My notebook' },
  { id: 'memories', label: 'My memories' },
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
  events = [],
  memories = [],
  trail = [],
  pursuits = [],
  places = [],
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
  events?: PublicSnapshot['events'];
  memories?: PublicSnapshot['memories'];
  trail?: PublicSnapshot['trail'];
  pursuits?: PublicSnapshot['pursuits'];
  places?: ReadonlyArray<{ id: string; name: string }>;
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
  // Only what the world already publishes: the latest steps of the trail and what was seen.
  const earlier = [
    ...trail.slice(-3).map((entry) => ({
      id: 'step:' + entry.id,
      at: entry.at,
      note: entry.why || entry.text || '',
      seen: entry.why || entry.text ? '' : trailLabel(entry),
    })),
    ...activityRows(events)
      .slice(0, 3)
      .map((row) => ({ id: 'event:' + row.event.id, at: row.event.at, note: '', seen: row.text })),
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-5);
  const following = pursuits.filter((pursuit) => pursuit.status !== 'set-aside').slice(0, 3);
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
            What I’m doing and following, as it happens, in my own words.
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
          <section className="now-focus" aria-label="Right now">
            <p className="now-label">
              <i />
              Right now
            </p>
            <h3>{character.activity}</h3>
          </section>
          <div className="stats now-stats">
            <Meter label="Mood" value={character.mood} />
            <Meter label="Energy" value={character.energy} />
          </div>
          {following.length > 0 && (
            <p className="attention">
              <span>What I’m following</span>
              {following.map((pursuit) => (
                <b key={pursuit.id}>{pursuit.question}</b>
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
      {tab === 'notebook' && <NotebookPanel pursuits={pursuits} />}
      {tab === 'memories' && (
        <MemoriesPanel memories={memories} places={places} onShowPlace={onShowPlace} />
      )}
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
            <p className="eyebrow">Questions I follow</p>
            <PursuitList pursuits={pursuits} />
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

/** Each pursuit with what it has gathered, without its notes (those live in the notebook). */
export function PursuitList({ pursuits }: { pursuits: PublicSnapshot['pursuits'] }) {
  if (!pursuits.length) return <p className="muted-copy">I have not taken up a question yet.</p>;
  return (
    <div className="character-interests">
      {pursuits.map((pursuit) => (
        <div className="interest-row" key={pursuit.id}>
          <div>
            <strong>{pursuit.question}</strong>
            <span>{pursuit.status === 'set-aside' ? 'set aside' : pursuit.status}</span>
          </div>
          {pursuit.why && <small>{pursuit.why}</small>}
          <small>
            {pursuit.entries.filter((entry) => entry.kind === 'note').length} notes ·{' '}
            {pursuit.questions.length} open questions
          </small>
          {pursuit.setAsideReason && <small>{pursuit.setAsideReason}</small>}
        </div>
      ))}
    </div>
  );
}
