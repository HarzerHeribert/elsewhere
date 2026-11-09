import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { Modal } from './Modal';
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
          {(admin.owner || isWorldAdmin || canManageCharacter) && (
            <div className="owner-actions">
              {(admin.owner || isWorldAdmin) && (
                <button
                  className="secondary-button"
                  disabled={admin.busy || !snapshot}
                  onClick={() =>
                    void admin.ownerAction(snapshot?.runtime.paused ? 'resume' : 'pause')
                  }
                >
                  {snapshot?.runtime.paused ? 'Resume life' : 'Pause life'}
                </button>
              )}
              {(admin.owner || canManageCharacter) && (
                <button
                  className="secondary-button"
                  disabled={admin.busy || !snapshot}
                  onClick={() => void admin.ownerAction('tick')}
                >
                  Advance one decision
                </button>
              )}
              {admin.owner && (
                <button
                  className="text-button"
                  onClick={() => {
                    admin.saveOwner('');
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
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
          <p className="eyebrow">A place with a life of its own</p>
          <h2 id="modal-title">This is Elsewhere.</h2>
          <p>
            Hubert is its first resident: a small, unclassified creature with three little feet and
            a particular interest in birds. He explores, makes things, rests and remembers. You can
            take a walk alongside him.
          </p>
          <p>
            {!snapshot
              ? 'You’re looking around the village while its live world is unavailable.'
              : snapshot.runtime.mode === 'ollama'
                ? 'His decisions are backed by a local Ollama model.'
                : ['compatible', 'routed', 'chatgpt', 'broker'].includes(snapshot.runtime.mode)
                  ? 'A configured model proposes his decisions.'
                  : 'This instance uses a reproducible local planner.'}{' '}
            {snapshot && 'The world verifies his actions and preserves their outcomes.'}
          </p>
          <p>
            The character camera shows his viewpoint; the planner currently uses structured sight.
            Visitor messages stay private.
          </p>
          <p>
            3D assets by Kenney and textures by Poly Haven, distributed under CC0. Source and
            license records are included in this project.
          </p>
        </>
      )}
    </Modal>
  );
}
