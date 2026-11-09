import { Button } from '../ui/Button';
import type {
  Place,
  Position,
  PublicSnapshot,
  PublicWorldObject,
  PublicWorldEntity,
  VisitorSessionView,
} from '@elsewhere/character-interfaces';
import { villageScenery } from '../scenery';
import { WorldMap } from '../WorldMap';
import { EntityDetails, WildlifeDirectory } from '../WildlifePanel';
import { Icon } from '../Icon';

function placeCenter(place: Place): Position {
  return (
    place.entryPoint ?? {
      x: (place.bounds.minX + place.bounds.maxX) / 2,
      z: (place.bounds.minZ + place.bounds.maxZ) / 2,
    }
  );
}

export function MapPanel({
  snapshot,
  visitor,
  discovered,
  onFocusPlace,
  onWalk,
  onSelectObject,
}: {
  snapshot: PublicSnapshot | null;
  visitor: VisitorSessionView | null;
  discovered: readonly string[];
  onFocusPlace: (position: Position, id: string) => void;
  onWalk: (position: Position) => Promise<void>;
  onSelectObject: (id: string) => void;
}) {
  const world = snapshot?.world ?? villageScenery;
  const places = world.places.filter((place) => place.id !== 'meadow');
  return (
    <>
      <p className="panel-intro">Explore the places and objects that residents interact with.</p>
      <WorldMap
        snapshot={snapshot}
        visitor={visitor}
        onFocus={onFocusPlace}
        onMove={(p) => void onWalk(p)}
      />
      <div className="exploration-count">
        <span>Your field journal</span>
        <strong>
          {places.filter((place) => discovered.includes(place.id)).length} / {places.length}
        </strong>
      </div>
      <div className="place-list">
        {places.map((p, i) => (
          <button key={p.id} onClick={() => onFocusPlace(placeCenter(p), p.id)}>
            <span className="place-number">
              {discovered.includes(p.id) ? '✓' : String(i + 1).padStart(2, '0')}
            </span>
            <span>
              {p.name}
              <small>
                {discovered.includes(p.id) ? 'Visited on this walk' : 'Waiting to be explored'}
              </small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <WildlifeDirectory entities={snapshot?.world.entities ?? []} onSelect={onSelectObject} />
      <details className="object-directory">
        <summary>Objects in the world</summary>
        <div>
          {world.objects.map((o) => (
            <button key={o.id} onClick={() => onSelectObject(o.id)}>
              {o.name}
              <Icon name="arrow" />
            </button>
          ))}
        </div>
      </details>
    </>
  );
}

export function PlacePanel({
  place,
  objects,
  discovered,
  onWalk,
  onSelectObject,
  onBack,
}: {
  place: Place;
  objects: PublicWorldObject[];
  discovered: boolean;
  onWalk?: (position: Position) => Promise<void>;
  onSelectObject: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <span className="tag">{discovered ? 'In your field journal' : 'Somewhere new'}</span>
      <p className="large-copy">{place.description}</p>
      <Button
        className="full-width"
        disabled={!onWalk}
        onClick={() => void onWalk?.(placeCenter(place))}
      >
        <Icon name="walk" />
        Walk toward here
      </Button>
      <div className="panel-section">
        <p className="eyebrow">Objects here</p>
        <div className="object-list">
          {objects
            .filter(
              (o) =>
                o.position.x >= place.bounds.minX &&
                o.position.x <= place.bounds.maxX &&
                o.position.z >= place.bounds.minZ &&
                o.position.z <= place.bounds.maxZ,
            )
            .map((o) => (
              <button key={o.id} onClick={() => onSelectObject(o.id)}>
                {o.name}
                <Icon name="arrow" />
              </button>
            ))}
        </div>
      </div>
      <Button variant="quiet" onClick={onBack}>
        ← Back to the map
      </Button>
    </>
  );
}

export function ObjectPanel({
  entity,
  object,
  onBack,
}: {
  entity?: PublicWorldEntity;
  object?: PublicWorldObject;
  onBack: () => void;
}) {
  return (
    <>
      {entity && (
        <>
          <EntityDetails entity={entity} />
          <Button variant="quiet" aria-label="Close wildlife details" onClick={onBack}>
            ← Back to exploring
          </Button>
        </>
      )}
      {object && (
        <>
          <span className="tag">{object.kind.replace(/-/g, ' ')}</span>
          <div className="object-emblem">◈</div>
          <p className="large-copy">{object.description}</p>
          <div className="interests">
            {object.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <p className="muted-copy">
            You can look around freely. Hubert decides how he spends his own time.
          </p>
          <Button variant="quiet" aria-label="Close object details" onClick={onBack}>
            ← Back to exploring
          </Button>
        </>
      )}
    </>
  );
}
