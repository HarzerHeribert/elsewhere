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
import { trailLabel } from '../trailLabels';
import { formatTime } from '../formatTime';
import { pursuitThreads, questionText, threadHasRecord } from '../pursuitThreads';
import {
  QuestionKin,
  QuestionRow,
  SectionHead,
  StatusTag,
  ThreadRecord,
  When,
  threadCounts,
  threadSpan,
} from './Record';
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
  memories = [],
  trail = [],
  pursuits = [],
  places = [],
  onShowPlace,
  onMessage,
  onViewpoint,
  onWishes,
  onDay,
  carrying = [],
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
  /** What the resident has on them, as the world reports it. */
  carrying?: ReadonlyArray<{ kind: string; name: string; count: number }>;
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
  const threads = pursuitThreads(pursuits);
  const main = threads[0];
  const others = threads.slice(1);
  const latest = trail.at(-1);
  const lastSteps = trail.slice(-5).reverse();
  const mainLabel =
    main?.status === 'active' ? 'The question I’m on' : 'The question I was last on';
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
        <div className="now-page">
          <section className="now-focus" aria-label="Right now">
            <p className="now-label">
              <i />
              Right now
            </p>
            <h3>{character.activity}</h3>
            {latest?.why && latest.kind !== 'portrait' && <p className="now-why">{latest.why}</p>}
            <div className="stats now-stats">
              <Meter label="Mood" value={character.mood} />
              <Meter label="Energy" value={character.energy} />
            </div>
            {carrying.some((item) => item.count > 0) && (
              <p className="now-carrying">
                Carrying{' '}
                {carrying
                  .filter((item) => item.count > 0)
                  .map((item) => `${item.count} ${item.name}${item.count === 1 ? '' : 's'}`)
                  .join(', ')}
              </p>
            )}
          </section>
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
          {main ? (
            <section className="record" aria-label={mainLabel}>
              <SectionHead label={mainLabel} />
              <h3 className="question-title">{questionText(main.lead, pursuits)}</h3>
              {main.lead.why && <p className="question-why">{main.lead.why}</p>}
              <QuestionKin thread={main} all={pursuits} />
              <ThreadRecord thread={main} all={pursuits} readingLimit={5} noteLimit={2} />
              {threadHasRecord(main) && (
                <button className="follow-link" onClick={() => choose('notebook')}>
                  All of it in my notebook <Icon name="arrow" />
                </button>
              )}
            </section>
          ) : (
            <p className="muted-copy">I have not taken up a question yet.</p>
          )}
          {others.length > 0 && (
            <section className="record" aria-label="Other questions">
              <SectionHead label="Other questions" count={others.length} />
              {others.map((thread) => (
                <details className="question-fold" key={thread.id}>
                  <summary>
                    <span>
                      <strong>{questionText(thread.lead, pursuits)}</strong>
                      <small>
                        {[threadSpan(thread), threadCounts(thread)].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    <StatusTag status={thread.status} />
                    <Icon name="chevron-down" />
                  </summary>
                  {thread.lead.why && <p className="question-why">{thread.lead.why}</p>}
                  <QuestionKin thread={thread} all={pursuits} />
                  <ThreadRecord thread={thread} all={pursuits} readingLimit={3} noteLimit={1} />
                </details>
              ))}
            </section>
          )}
          {lastSteps.length > 0 && (
            <section className="record" aria-label="My last steps">
              <SectionHead label="My last steps" />
              <ol className="step-list">
                {lastSteps.map((step) => (
                  <li key={step.id}>
                    <When at={step.at} />
                    <p>
                      <b>{trailLabel(step)}</b>
                      {step.kind !== 'portrait' && step.text && <span>{step.text}</span>}
                    </p>
                  </li>
                ))}
              </ol>
              {onDay && (
                <button className="follow-link" onClick={onDay}>
                  See my whole day <Icon name="arrow" />
                </button>
              )}
            </section>
          )}
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
          {character.portrait && (
            <div className="panel-section portrait-text">
              <p className="eyebrow">How I see myself</p>
              <p>{character.portrait.text}</p>
              <small>Written {formatTime(toWall(character.portrait.at))}</small>
            </div>
          )}
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

/** Each line of questions with what it has gathered, without its notes (those live in the notebook). */
export function PursuitList({ pursuits }: { pursuits: PublicSnapshot['pursuits'] }) {
  if (!pursuits.length) return <p className="muted-copy">I have not taken up a question yet.</p>;
  return (
    <div className="question-list">
      {pursuitThreads(pursuits).map((thread) => (
        <QuestionRow key={thread.id} pursuit={thread.lead} all={pursuits}>
          {threadCounts(thread) && (
            <small className="question-counts">{threadCounts(thread)}</small>
          )}
          <QuestionKin thread={thread} all={pursuits} />
        </QuestionRow>
      ))}
    </div>
  );
}
