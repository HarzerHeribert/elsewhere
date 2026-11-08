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
        Possibilities Hubert has imagined from his life here. Up to three in seven days, with room
        between them.
      </p>
      <div className="wish-list">
        {wishes?.map((w) => (
          <article className="wish-card" key={w.id}>
            <span className={'wish-state ' + w.status}>{w.status}</span>
            <h3>{w.title}</h3>
            <p>{w.reason}</p>
            <small>{w.description}</small>
            {canDecide && w.status === 'pending' && (
              <div className="wish-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void onDecide(w.id, 'fulfill')}
                >
                  Add to Elsewhere
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void onDecide(w.id, 'decline')}
                >
                  Decline for now
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!wishes?.length && (
        <p className="empty-state">He’s still discovering what this place could become.</p>
      )}
      <p role="status" className="control-status">
        {status}
      </p>
    </>
  );
}
