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
      {awaitingLiveState && (
        <>
          <div className="resident-row" role="group" aria-label="About Hubert">
            <HubertPortrait />
            <span>
              <strong>Hubert</strong>
              <small>Elsewhere’s first resident</small>
            </span>
          </div>
          <p className="quiet-note">Waiting for the village to connect.</p>
        </>
      )}
      {residents.map((r) => (
        <button
          key={r.id}
          className="resident-row"
          aria-label={'Select ' + r.name}
          onClick={() => onSelect(r.id)}
        >
          {r.id === 'hubert' ? <HubertPortrait /> : <Icon name="people" />}
          <span>
            <strong>{r.name}</strong>
            <small>{r.id === 'hubert' ? characterActivity : r.activity}</small>
          </span>

          <Icon name="arrow" />
        </button>
      ))}
      {!awaitingLiveState && !residents.length && <p>No residents are here yet.</p>}
      {visitorCount !== undefined && (
        <p className="quiet-note">
          {visitorCount} {visitorCount === 1 ? 'visitor' : 'visitors'} exploring
        </p>
      )}
    </>
  );
}
