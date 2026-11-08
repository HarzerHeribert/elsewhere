import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { CharacterInterests } from '../WildlifePanel';
import { Icon } from '../Icon';
import { Meter } from '../Meter';

export function CharacterPanel({
  character,
  recalledMemory,
  artifacts,
  onMessage,
  onViewpoint,
  onMemories,
  onWishes,
}: {
  character: PublicSnapshot['character'];
  recalledMemory?: PublicSnapshot['recalledMemory'];
  artifacts?: PublicSnapshot['artifacts'];
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
          <p>An odd little creature. Especially curious about birds.</p>
        </div>
      </div>
      <div className="character-now">
        <p className="eyebrow">Right now</p>
        <h3>{character.activity}</h3>
        <p>{character.currentThought}</p>
      </div>
      <div className="stats">
        <Meter label="Mood" value={character.mood} />
        <Meter label="Energy" value={character.energy} />
      </div>
      <div className="panel-section">
        <p className="eyebrow">Things he returns to</p>
        <CharacterInterests interests={character.interests} />
      </div>
      {recalledMemory && (
        <div className="memory-glimpse">
          <p className="eyebrow">Something came back to him</p>
          <p>{recalledMemory.summary}</p>
        </div>
      )}
      <div className="panel-actions">
        <button className="primary-button" onClick={onMessage}>
          <Icon name="mail" />
          Message Hubert
        </button>
        <button className="secondary-button" onClick={onViewpoint}>
          <Icon name="eye" />
          His viewpoint
        </button>
      </div>
      <div className="panel-links">
        <button onClick={onMemories}>
          Memories <Icon name="arrow" />
        </button>
        <button onClick={onWishes}>
          Wishes <Icon name="arrow" />
        </button>
      </div>
      {Boolean(artifacts?.length) && (
        <div className="panel-section">
          <p className="eyebrow">Things he’s made</p>
          {artifacts
            ?.filter((a) => /^\/api\/artifacts\/[a-z\d_-]+$/i.test(a.url))
            .map((a) => (
              <a
                className="artifact-link"
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>◈</span>
                <div>
                  <strong>{a.name}</strong>
                  <small>{a.description}</small>
                </div>
                <Icon name="arrow" />
              </a>
            ))}
        </div>
      )}
    </>
  );
}
