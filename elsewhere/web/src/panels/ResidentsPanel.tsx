import type { PublicWorldState } from '@elsewhere/character-interfaces';
import { HubertPortrait } from '../HubertPortrait';
import { Icon } from '../Icon';

export function ResidentsPanel({
  residents,
  characterActivity,
  visitorCount,
  onSelect,
}: {
  residents: PublicWorldState['residents'];
  characterActivity?: string;
  visitorCount: number;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <p className="panel-intro">A place shared with lives that have their own plans.</p>
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
      <p className="quiet-note">{visitorCount} visitors exploring</p>
    </>
  );
}
