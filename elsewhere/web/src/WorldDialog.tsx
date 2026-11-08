import { useState, type FormEvent } from 'react';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { Modal } from './Modal';
import type { useOwnerActions } from './useOwnerActions';

export function WorldDialog({
  kind,
  snapshot,
  admin,
  isWorldAdmin,
  onClose,
}: {
  kind: 'owner' | 'about';
  snapshot: PublicSnapshot | null;
  admin: ReturnType<typeof useOwnerActions>;
  isWorldAdmin: boolean;
  onClose: () => void;
}) {
  const [credential, setCredential] = useState(admin.owner);
  function save(event: FormEvent) {
    event.preventDefault();
    admin.saveOwner(credential);
  }
  return (
    <Modal titleId="modal-title" onClose={onClose}>
      {kind === 'owner' ? (
        <>
          <p className="eyebrow">Behind the scenes</p>
          <h2 id="modal-title">Owner controls</h2>
          <p>
            Run <code>pnpm owner</code> in the project terminal for your private local owner link.
          </p>
          <form onSubmit={save}>
            <label htmlFor="owner-credential">Owner credential</label>
            <input
              id="owner-credential"
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
            <button className="primary-button">Save for this tab</button>
          </form>
          {(admin.owner || isWorldAdmin) && (
            <div className="owner-actions">
              <button
                className="secondary-button"
                disabled={admin.busy}
                onClick={() =>
                  void admin.ownerAction(snapshot?.runtime.paused ? 'resume' : 'pause')
                }
              >
                {snapshot?.runtime.paused ? 'Resume life' : 'Pause life'}
              </button>
              <button
                className="secondary-button"
                disabled={admin.busy}
                onClick={() => void admin.ownerAction('tick')}
              >
                Advance one decision
              </button>
              {admin.owner && (
                <button
                  className="text-button"
                  onClick={() => {
                    admin.saveOwner('');
                    setCredential('');
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
            Your credential stays in this tab. Visitor access never grants these permissions.
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
            {snapshot?.runtime.mode === 'ollama'
              ? 'His decisions are backed by a local Ollama model.'
              : snapshot?.runtime.mode === 'compatible'
                ? 'A configured model proposes his decisions.'
                : 'This instance uses a reproducible local planner.'}{' '}
            The world verifies his actions and preserves their outcomes.
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
