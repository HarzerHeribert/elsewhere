import type { useAccountSession } from './useAccountSession';
import { Button } from './ui/Button';
import { providerName } from './socialAuth';

type AccountSession = ReturnType<typeof useAccountSession>;

export function SocialSignIn({ session }: { session: AccountSession }) {
  const providers = session.capabilities?.socialProviders ?? [];
  if (!providers.length) return null;
  return (
    <div className="panel-actions social-signin" aria-label="Provider sign-in">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          className="full-width"
          busy={session.pending}
          onClick={() => void session.beginSocialSignIn(provider)}
        >
          Continue with {providerName(provider)}
        </Button>
      ))}
    </div>
  );
}

export function SocialSignInSettings({ session }: { session: AccountSession }) {
  const providers = session.capabilities?.socialProviders ?? [];
  if (!session.account || !providers.length) return null;
  const locked =
    session.capabilities?.ownerControlsRequirePasskey === true &&
    session.capabilities.ownerControlsUnlocked !== true;
  const linked = session.capabilities?.linkedSocialProviders ?? [];
  return (
    <section className="panel-section" aria-label="Linked sign-in accounts">
      <h3>Linked sign-in accounts</h3>
      <p>
        Link a provider to sign in to this Elsewhere account. Hubert’s app connections are managed
        separately.
      </p>
      {providers.map((provider) => (
        <div className="memory-row" key={provider}>
          {linked.includes(provider) ? (
            <strong>{providerName(provider)} · Linked</strong>
          ) : (
            <Button
              variant="secondary"
              busy={session.pending}
              disabled={locked}
              onClick={() => void session.linkSocialSignIn(provider)}
            >
              Link {providerName(provider)}
            </Button>
          )}
        </div>
      ))}
      {locked && <p>Verify a passkey before linking another sign-in account.</p>}
    </section>
  );
}
