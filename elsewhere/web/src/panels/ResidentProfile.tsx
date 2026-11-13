import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { Icon } from '../Icon';
import type { PursuitThread } from '../pursuitThreads';
import type { CharacterTab } from './CharacterPanel';
import { CreationsPanel } from './CreationsPanel';

export function ResidentProfile({
  character,
  placeName,
  threads,
  memories,
  creations,
  onChoose,
  onMessage,
  onWishes,
  onDay,
}: {
  character: PublicSnapshot['character'];
  placeName?: string;
  threads: PursuitThread[];
  memories: PublicSnapshot['memories'];
  creations?: PublicSnapshot['creations'];
  onChoose: (tab: CharacterTab) => void;
  onMessage: () => void;
  onWishes: () => void;
  onDay?: () => void;
}) {
  const note = threads.flatMap((thread) => thread.notes.slice(0, 1)).sort((a, b) => b.at - a.at)[0];
  const remembered = memories.reduce<(typeof memories)[number] | undefined>(
    (last, record) => (!last || record.at > last.at ? record : last),
    undefined,
  );
  const departments: { title: string; tab: CharacterTab; excerpt: string }[] = [
    { title: 'Activity', tab: 'now', excerpt: character.activity || 'No recent observations.' },
    { title: 'Notebook', tab: 'notebook', excerpt: note?.text ?? 'No notebook entries yet.' },
    {
      title: 'Memories',
      tab: 'memories',
      excerpt: remembered?.summary ?? 'No public memories yet.',
    },
  ];
  return (
    <article className="resident-spread">
      <div className={'resident-intro' + (character.id === 'hubert' ? ' illustrated' : '')}>
        <div className="resident-intro-text">
          <span>{placeName ? 'Resident · ' + placeName : 'Resident'}</span>
          <h3>{character.name}</h3>
          {character.portrait?.text && <p>{character.portrait.text}</p>}
        </div>
        {character.id === 'hubert' && (
          <div className="resident-workshop">
            <img
              src="/residents/hubert/workshop.webp"
              alt="Hubert beside the pendulum in his illustrated workshop"
              width="1140"
              height="855"
            />
          </div>
        )}
      </div>
      <div className="resident-index">
        {departments.map(({ title, tab, excerpt }) => (
          <button
            key={tab}
            aria-label={title}
            className={'index-' + tab}
            onClick={() => onChoose(tab)}
          >
            <strong>{title}</strong>
            <span className="index-copy">{excerpt}</span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <div className="resident-foot">
        <div className="resident-shortcuts">
          <button onClick={() => onChoose('about')}>About {character.name}</button>
          <button onClick={onMessage}>Write to {character.name}</button>
          <button onClick={onWishes}>Wishes</button>
          {onDay && <button onClick={onDay}>Read the day</button>}
        </div>
        {character.id === 'hubert' && (
          <nav className="resident-publications" aria-label="Hubert’s publishing links">
            <a
              href="https://hubertfromelsewhere.github.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hubert’s website ↗
            </a>
            <a
              href="https://github.com/HubertFromElsewhere/hubertfromelsewhere.github.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub repository ↗
            </a>
          </nav>
        )}
        <CreationsPanel
          characterId={character.id}
          characterName={character.name}
          creations={creations}
        />
      </div>
    </article>
  );
}
