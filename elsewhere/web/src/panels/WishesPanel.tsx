import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';

/** Wishes carry real time, unlike world events, so they are shown without the world clock. */
const wishDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

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
      <div className="wish-list">
        {wishes?.map((w) => (
          <article className="wish-card" key={w.id}>
            <StatusBadge tone={w.status === 'pending' ? 'waiting' : 'neutral'}>
              {w.status === 'pending' ? 'open' : w.status === 'fulfilled' ? 'built' : 'declined'}
            </StatusBadge>
            <h3>{w.text}</h3>
            <small>{wishDate.format(w.createdAt)}</small>
            {canDecide && w.status === 'pending' && (
              <div className="wish-actions">
                <Button disabled={busy} onClick={() => void onDecide(w.id, 'fulfill')}>
                  Mark as built
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
      {!wishes?.length && <p className="empty-state">No resident has made a wish yet.</p>}
      <p role="status" className="control-status">
        {status}
      </p>
    </>
  );
}
