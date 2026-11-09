import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { Modal } from './Modal';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';
import { productCopy } from './productCopy';
import type { useOwnerActions } from './useOwnerActions';

export function WorldDialog({
  kind,
  snapshot,
  admin,
  isWorldAdmin,
  canManageCharacter,
  onClose,
}: {
  kind: 'owner' | 'about';
  snapshot: PublicSnapshot | null;
  admin: ReturnType<typeof useOwnerActions>;
  isWorldAdmin: boolean;
  canManageCharacter: boolean;
  onClose: () => void;
}) {
  return (
    <Modal titleId="modal-title" onClose={onClose}>
      {kind === 'owner' ? (
        <>
          <p className="eyebrow">Behind the scenes</p>
          <h2 id="modal-title">World settings</h2>
          <p>
            These controls pause, resume, or advance the simulation. Hubert’s connection notices and
            Retry action are in Your account → Your characters.
          </p>
          {(admin.owner || isWorldAdmin || canManageCharacter) && (
            <div className="owner-actions">
              {(admin.owner || isWorldAdmin) && (
                <Button
                  variant="secondary"
                  disabled={admin.busy || !snapshot}
                  onClick={() =>
                    void admin.ownerAction(snapshot?.runtime.paused ? 'resume' : 'pause')
                  }
                >
                  {snapshot?.runtime.paused ? 'Resume life' : 'Pause life'}
                </Button>
              )}
              {(admin.owner || canManageCharacter) && (
                <Button
                  variant="secondary"
                  disabled={admin.busy || !snapshot}
                  onClick={() => void admin.ownerAction('tick')}
                >
                  Advance one decision
                </Button>
              )}
              {admin.owner && (
                <Button
                  variant="quiet"
                  onClick={() => {
                    admin.saveOwner('');
                  }}
                >
                  Disconnect
                </Button>
              )}
            </div>
          )}
          {snapshot && (admin.owner || isWorldAdmin || canManageCharacter) && (
            <section className="about-participation" aria-label="Runtime details">
              <p className="eyebrow">This instance</p>
              <StatusBadge tone={snapshot.runtime.paused ? 'waiting' : 'neutral'}>
                {snapshot.runtime.paused ? 'Paused' : 'Running'}
              </StatusBadge>
              <p>
                {snapshot.runtime.mode === 'ollama'
                  ? 'Ollama · local model'
                  : snapshot.runtime.mode === 'compatible'
                    ? 'Connected model'
                    : 'Local deterministic simulation'}{' '}
                · {snapshot.runtime.simulationRate ?? 3}× world time
              </p>
              <p>
                {snapshot.runtime.costKnown === false
                  ? 'Provider cost not reported'
                  : '$' + (snapshot.runtime.costUsd ?? 0).toFixed(2) + ' paid model spend'}
              </p>
            </section>
          )}
          <p role="status" className="control-status">
            {admin.status}
          </p>
          <p className="privacy-note">
            Character owners manage their resident. World administrators can pause or resume the
            world. Connected accounts are governed by separate character permissions.
          </p>
        </>
      ) : (
        <>
          <div className="about-world-brand">
            <img src="/brand/elsewhere-lockup.svg" alt="Elsewhere" width="240" height="41" />
          </div>
          <p className="eyebrow">{productCopy.strapline}</p>
          <h2 id="modal-title">{productCopy.headline}</h2>
          <p className="about-lead">{productCopy.description}</p>
          <p>
            A character can explore, create, remember an encounter, or ask for something to change.
            You can enter that same world and become part of what happens next.
          </p>
          <div className="about-participation">
            <span className="eyebrow">Start here</span>
            <p>
              Meet Hubert, the first resident. Follow his activity, see the world from his
              viewpoint, or leave a note for him to encounter.
            </p>
          </div>
          {!snapshot && (
            <p className="privacy-note">
              The world is currently offline. You can explore a preview until it reconnects.
            </p>
          )}
          <Button className="full-width" onClick={onClose}>
            Back to the world
          </Button>
          <details className="about-credits">
            <summary>Asset credits</summary>
            <p>
              3D assets by Kenney and textures by Poly Haven, distributed under CC0. Lettering uses
              Averia Serif Libre under the SIL Open Font License.
            </p>
          </details>
        </>
      )}
    </Modal>
  );
}
