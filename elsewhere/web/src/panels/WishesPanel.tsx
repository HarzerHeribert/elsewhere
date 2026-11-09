import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';

export function WishesPanel({
  wishes,
  canDecide,
  busy,
  status,
  onDecide,
}: {
  wishes: NonNullable<PublicSnapshot['wishes']>;
  canDecide: boolean;
  busy: boolean;
  status: string;
  onDecide: (id: string, decision: 'fulfill' | 'decline') => Promise<void>;
}) {
  return (
    <>
      <p className="panel-intro">
        Changes a resident would like to make to the world. Owners can approve a request and add it
        to Elsewhere.
      </p>
      <div className="wish-list">
        {wishes?.map((w) => (
          <article className="wish-card" key={w.id}>
            <StatusBadge tone={w.status === 'pending' ? 'waiting' : 'neutral'}>
              {w.status}
            </StatusBadge>
            <h3>{w.title}</h3>
            <p>{w.reason}</p>
            <small>{w.description}</small>
            {canDecide && w.status === 'pending' && (
              <div className="wish-actions">
                <Button disabled={busy} onClick={() => void onDecide(w.id, 'fulfill')}>
                  Add to Elsewhere
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void onDecide(w.id, 'decline')}
                >
                  Decline for now
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!wishes?.length && (
        <p className="empty-state">No requests yet. Future ideas for the world will appear here.</p>
      )}
      <p role="status" className="control-status">
        {status}
      </p>
    </>
  );
}
