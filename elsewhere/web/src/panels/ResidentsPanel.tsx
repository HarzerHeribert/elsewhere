import type { PublicWorldState } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { Icon } from '../Icon';

export function ResidentsPanel({
  residents,
  awaitingLiveState = false,
  characterActivity,
  visitorCount,
  onSelect,
}: {
  residents: PublicWorldState['residents'];
  awaitingLiveState?: boolean;
  characterActivity?: string;
  visitorCount?: number;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <p className="panel-intro">Meet the digital characters who inhabit this world.</p>
      {awaitingLiveState && (
        <>
          <div className="resident-row" role="group" aria-label="About Hubert">
            <HubertPortrait />
            <span>
              <strong>Hubert</strong>
              <small>Elsewhere’s first resident</small>
            </span>
          </div>
          <p className="quiet-note">
            Hubert is Elsewhere’s first resident. His current activity will appear when the world
            connects.
          </p>
        </>
      )}
      {residents.map((r) => (
        <button
          key={r.id}
          className="resident-row"
          aria-label={'Select ' + r.name}
          onClick={() => onSelect(r.id)}
        >
          <HubertPortrait />
          <span>
            <strong>{r.name}</strong>
            <small>{r.id === 'hubert' ? characterActivity : r.activity}</small>
          </span>
          <i className="presence" />
          <Icon name="arrow" />
        </button>
      ))}
      {visitorCount !== undefined && (
        <p className="quiet-note">{visitorCount} visitors exploring</p>
      )}
    </>
  );
}
