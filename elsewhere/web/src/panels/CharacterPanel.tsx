import { NotebookPanel } from './NotebookPanel';
import { CreationsPanel } from './CreationsPanel';
import { Button } from '../ui/Button';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { CharacterInterests } from '../WildlifePanel';
import { Icon } from '../Icon';
import { Meter } from '../Meter';

export function CharacterPanel({
  character,
  recalledMemory,
  creations,
  notebook,
  onNotebook,
  onMessage,
  onViewpoint,
  onMemories,
  onWishes,
}: {
  character: PublicSnapshot['character'];
  recalledMemory?: PublicSnapshot['recalledMemory'];
  artifacts?: PublicSnapshot['artifacts'];
  creations?: PublicSnapshot['creations'];
  notebook?: PublicSnapshot['notebook'];
  onNotebook: () => void;
  onMessage: () => void;
  onViewpoint: () => void;
  onMemories: () => void;
  onWishes: () => void;
}) {
  return (
    <>
      <div className="character-profile">
        <HubertPortrait />
        <div>
          <span className="tag">Founding resident</span>
          <p>Follow his decisions, explore his memories, or leave him a note.</p>
        </div>
      </div>
      <div className="character-now">
        <p className="eyebrow">Right now</p>
        <h3>{character.activity}</h3>
      </div>
      <NotebookPanel notebook={notebook} preview />
      <div className="stats">
        <Meter label="Mood" value={character.mood} />
        <Meter label="Energy" value={character.energy} />
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
      <div className="panel-actions">
        <Button onClick={onMessage}>
          <Icon name="mail" />
          Message {character.name}
        </Button>
        <Button variant="secondary" onClick={onViewpoint}>
          <Icon name="eye" />
          His viewpoint
        </Button>
      </div>
      <div className="panel-links">
        <button onClick={onNotebook}>
          Notebook <Icon name="arrow" />
        </button>
        <button onClick={onMemories}>
          Memories <Icon name="arrow" />
        </button>
        <button onClick={onWishes}>
          Wishes <Icon name="arrow" />
        </button>
      </div>
      <CreationsPanel
        characterId={character.id}
        characterName={character.name}
        creations={creations}
      />
    </>
  );
}
