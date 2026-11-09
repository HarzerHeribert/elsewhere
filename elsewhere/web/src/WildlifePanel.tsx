import type { PublicCharacterState, WorldEntity } from '@elsewhere/character-interfaces';

export function BirdMark({ kind = 'bird' }: { kind?: string }) {
  if (kind === 'butterfly')
    return (
      <svg
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 15v16m0-14C4 2 4 22 17 23 3 25 12 37 20 28m0-11C36 2 36 22 23 23c14 2 5 14-3 5m-3-19 3 6 3-6" />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 25c8 0 9-10 17-10 4 0 6 3 6 6l5 2-5 2c-2 7-12 9-18 4l-7 1 4-5m11-3-6 4m9 5-1 5m5-6 1 5" />
      <circle cx="27" cy="20" r=".7" fill="currentColor" />
    </svg>
  );
}

export function WildlifeDirectory({
  entities,
  onSelect,
}: {
  entities: WorldEntity[];
  onSelect: (id: string) => void;
}) {
  if (!entities.length) return null;
  return (
    <section className="wildlife-directory" aria-label="Wildlife in Elsewhere">
      <p className="eyebrow">Wildlife</p>
      <div>
        {entities.map((entity) => (
          <button key={entity.id} onClick={() => onSelect(entity.id)}>
            <span className="wildlife-icon">
              <BirdMark kind={entity.kind} />
            </span>
            <span>
              <strong>{entity.name}</strong>
              <small>
                {entity.species ?? entity.kind} · {entity.behavior}
              </small>
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <p className="quiet-note">Part of the environment residents can observe and remember.</p>
    </section>
  );
}

export function EntityDetails({ entity }: { entity: WorldEntity }) {
  return (
    <>
      <span className="tag">Wildlife · {entity.species ?? entity.kind}</span>
      <div className="object-emblem wildlife-emblem">
        <BirdMark kind={entity.kind} />
      </div>
      <p className="large-copy">{entity.description}</p>
      <dl className="entity-facts">
        <div>
          <dt>Right now</dt>
          <dd>{entity.behavior}</dd>
        </div>
        <div>
          <dt>Where to look</dt>
          <dd>
            {entity.elevation > 1
              ? 'Above the ground'
              : entity.behavior === 'swimming'
                ? 'On the water'
                : 'Near the ground'}
          </dd>
        </div>
      </dl>
      <div className="interests">
        {entity.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <p className="muted-copy">
        Hubert can notice this life when it crosses his path. Watching it may become a memory, or
        the start of an interest.
      </p>
    </>
  );
}

export function CharacterInterests({
  interests,
}: {
  interests: PublicCharacterState['interests'];
}) {
  return (
    <div className="character-interests">
      {[...interests]
        .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
        .map((interest) => (
          <div
            className={'interest-row' + (interest.id === 'birds' ? ' bird-interest' : '')}
            key={interest.id}
          >
            <div>
              <strong>
                {interest.id === 'birds' && <BirdMark />}
                {interest.name}
              </strong>
              <span>{Math.round(interest.strength * 100)}%</span>
            </div>
            <div
              className="interest-track"
              role="meter"
              aria-label={interest.name + ' interest'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(interest.strength * 100)}
            >
              <i style={{ width: Math.max(0, Math.min(100, interest.strength * 100)) + '%' }} />
            </div>
            {interest.encounters !== undefined && (
              <small>
                {interest.encounters > 0
                  ? `${interest.encounters} ${interest.encounters === 1 ? 'encounter' : 'encounters'}`
                  : interest.id === 'birds'
                    ? 'His starting fascination'
                    : 'A curiosity to follow'}
              </small>
            )}
          </div>
        ))}
    </div>
  );
}
