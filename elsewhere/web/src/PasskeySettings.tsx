import { useState, type FormEvent } from 'react';
import type { useAccountSession } from './useAccountSession';
import { Button } from './ui/Button';
import './PasskeySettings.css';

type AccountSession = ReturnType<typeof useAccountSession>;

export function PasskeySignIn({ session }: { session: AccountSession }) {
  if (!session.capabilities?.passkeyAuthEnabled) return null;
  return (
    <div className="passkey-signin">
      <Button
        className="full-width"
        busy={session.pending}
        disabled={!session.passkeysSupported}
        onClick={() => void session.signInWithPasskey()}
      >
        Sign in with a passkey
      </Button>
      <p className="privacy-note">
        {session.passkeysSupported
          ? 'Use your device’s screen lock or a security key.'
          : 'Passkeys are not available in this browser.'}
      </p>
    </div>
  );
}

export function PasskeySettings({ session }: { session: AccountSession }) {
  const [removing, setRemoving] = useState<string | null>(null);
  if (!session.account || !session.capabilities?.passkeyAuthEnabled) return null;
  const owner = session.account.isWorldAdmin || session.capabilities.managedCharacterIds.length > 0;
  const required = session.capabilities.ownerControlsRequirePasskey === true;
  const unlocked = !required || session.capabilities.ownerControlsUnlocked === true;
  const verified = session.capabilities.passkeyVerifiedRecently === true;
  const locked = required && !unlocked;
  const hasFallback =
    session.capabilities.emailLinkAuthEnabled || session.capabilities.passwordAuthEnabled;
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('passkey-name') ?? '');
    if (await session.addPasskey(name)) form.reset();
  }

  return (
    <section className="panel-section passkey-settings" aria-label="Account passkeys">
      <h3>Passkeys</h3>
      <p>Sign in using your device’s screen lock or a security key.</p>
      {session.capabilities.emailLinkAuthEnabled ? (
        <p>Email-link sign-in remains available.</p>
      ) : session.capabilities.passwordAuthEnabled ? (
        <p>Password sign-in remains available.</p>
      ) : (
        <p>Keep a second passkey so you have another way to sign in.</p>
      )}
      {session.passkeysLoading && <p role="status">Loading your passkeys…</p>}
      {session.passkeyListError && (
        <>
          <p role="alert">{session.passkeyListError}</p>
          <Button variant="secondary" onClick={session.refreshPasskeys} busy={session.pending}>
            Reload passkeys
          </Button>
        </>
      )}
      {!session.passkeysLoading && !session.passkeyListError && !session.passkeys.length && (
        <p>No passkeys added yet.</p>
      )}
      {session.passkeys.map((passkey) => (
        <article className="memory-row passkey-settings__key" key={passkey.id}>
          <strong>{passkey.name}</strong>
          {passkey.createdAt && (
            <small>Added {new Date(passkey.createdAt).toLocaleDateString()}</small>
          )}
          {removing === passkey.id ? (
            <div role="group" aria-label={`Remove ${passkey.name}`}>
              <p>This passkey will no longer sign in to Elsewhere.</p>
              <div className="panel-actions">
                <Button
                  variant="danger"
                  busy={session.pending}
                  onClick={async () => {
                    if (await session.removePasskey(passkey.id)) setRemoving(null);
                  }}
                >
                  Confirm removal
                </Button>
                <Button
                  variant="secondary"
                  disabled={session.pending}
                  onClick={() => setRemoving(null)}
                >
                  Keep passkey
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="quiet"
              disabled={
                session.pending ||
                locked ||
                (session.passkeys.length === 1 && (required || !hasFallback))
              }
              onClick={() => setRemoving(passkey.id)}
              aria-label={`Remove ${passkey.name}`}
            >
              Remove
            </Button>
          )}
        </article>
      ))}
      {required && session.passkeys.length === 1 && (
        <p>Turn off the owner-control requirement before removing your last passkey.</p>
      )}
      <form onSubmit={(event) => void add(event)}>
        <label htmlFor="account-passkey-name">Passkey name</label>
        <input
          className="ew-field"
          id="account-passkey-name"
          name="passkey-name"
          placeholder="For example, my MacBook"
          defaultValue="My passkey"
          maxLength={60}
          required
          disabled={session.pending || locked}
        />
        <Button
          type="submit"
          variant="secondary"
          className="full-width"
          busy={session.pending}
          disabled={!session.passkeysSupported || locked}
        >
          Add a passkey
        </Button>
      </form>
      {!session.passkeysSupported && <p>Passkeys are not available in this browser.</p>}
      {owner && (
        <div className="passkey-settings__owner">
          <h4>Owner controls</h4>
          <p>
            Require a passkey to change world or character settings. Verifying a passkey unlocks
            owner controls for five minutes.
          </p>
          {required ? (
            <p>
              {unlocked
                ? 'Owner controls are unlocked temporarily.'
                : 'Owner controls are locked. Verify your passkey to continue.'}
            </p>
          ) : (
            <p>The passkey requirement is off. Adding a passkey does not turn it on.</p>
          )}
          <div className="panel-actions">
            <Button
              variant="secondary"
              busy={session.pending}
              disabled={!session.passkeysSupported || session.passkeys.length === 0}
              onClick={() => void session.verifyPasskey()}
            >
              Verify passkey
            </Button>
            <Button
              variant="secondary"
              busy={session.pending}
              disabled={!verified || session.passkeys.length === 0}
              onClick={() => void session.setOwnerPasskeyRequired(!required)}
            >
              {required ? 'Turn off passkey requirement' : 'Require passkey for owner controls'}
            </Button>
          </div>
          {!verified && <small>Verify your passkey before changing this requirement.</small>}
        </div>
      )}
      {session.passkeyStatus && <p role="status">{session.passkeyStatus}</p>}
    </section>
  );
}
