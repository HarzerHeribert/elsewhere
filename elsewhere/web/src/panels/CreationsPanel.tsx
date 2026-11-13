import type { PublicCreation } from '@elsewhere/character-interfaces';
import { Icon } from '../Icon';
import { MadeLink } from './Record';

export function safeCreationUrl(value: string): boolean {
  if (/^\/api\/creations\/[a-z\d._:-]+$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function CreationLink({ creation }: { creation: PublicCreation }) {
  return (
    <MadeLink title={creation.title} href={creation.url}>
      {creation.description && <small>{creation.description}</small>}
      <small>{creation.kind === 'repository' ? 'Repository' : creation.kind}</small>
      {creation.provenance === 'owner' && <small>Owner-added link</small>}
    </MadeLink>
  );
}

/** A character's selected work, independent of its hosting or creation tool. */
export function CreationsPanel({
  characterId,
  characterName,
  creations = [],
}: {
  characterId: string;
  characterName: string;
  creations?: PublicCreation[];
}) {
  const eligible = creations
    .filter((creation) => creation.characterId === characterId && safeCreationUrl(creation.url))
    .slice(0, 32);
  const pinned = eligible
    .filter((creation) => creation.pinnedAt !== undefined)
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!);
  const remaining = eligible
    .filter((creation) => creation.pinnedAt === undefined)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="panel-section" aria-label={`${characterName}’s creations`}>
      <p className="eyebrow">Creations</p>
      {pinned.length ? (
        <div aria-label="Pinned creations">
          {pinned.map((creation) => (
            <CreationLink key={creation.id} creation={creation} />
          ))}
        </div>
      ) : (
        <p className="empty-state">No creations pinned yet.</p>
      )}
      {remaining.length > 0 && (
        <details className="more-rows">
          <summary>
            <span>More creations · {remaining.length}</span>
            <Icon name="chevron-down" />
          </summary>
          {remaining.map((creation) => (
            <CreationLink key={creation.id} creation={creation} />
          ))}
        </details>
      )}
    </section>
  );
}
