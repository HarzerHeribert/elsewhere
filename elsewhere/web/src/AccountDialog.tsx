import { PasskeySignIn } from './PasskeySettings';
import { SocialSignIn } from './SocialSignIn';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './ui/Button';
import type { useAccountSession } from './useAccountSession';

/** Signing in and creating an account. Everything for a signed-in visitor lives in Settings. */
export function AccountDialog({
  session,
  onClose,
  privateLocalAccess = false,
}: {
  session: ReturnType<typeof useAccountSession>;
  onClose: () => void;
  privateLocalAccess?: boolean;
}) {
  const { account, capabilities, pending, error, verificationEmail } = session;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [usePassword, setUsePassword] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [mode]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !form.current) return;
    const data = new FormData(form.current);
    const accepted = await session.authenticate(mode, {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      ...(mode === 'signup' ? { name: String(data.get('name') ?? '') } : {}),
    });
    if (accepted) form.current?.reset();
  }
  return (
    <Modal
      titleId="account-title"
      onClose={onClose}
      closeLabel="Close account dialog"
      className="account-dialog"
    >
      <p className="eyebrow">Your place in Elsewhere</p>
      <h2 id="account-title">
        {account
          ? 'Hello, ' + account.name
          : privateLocalAccess
            ? 'Private local session'
            : verificationEmail
              ? 'Check your email.'
              : mode === 'signup'
                ? 'A name for your visits.'
                : 'Welcome back.'}
      </h2>
      {session.operatorSignInToken ? (
        <>
          <p>
            This private link signs you into the operator account it was issued for. It can be used
            once and expires after 15 minutes.
          </p>
          {account && (
            <p>You are currently signed in as {account.name}. Continuing switches accounts.</p>
          )}
          <Button
            className="full-width"
            busy={pending}
            onClick={() => void session.signInWithOperatorLink()}
          >
            {pending ? 'Signing in…' : 'Continue with private sign-in'}
          </Button>
        </>
      ) : !account && privateLocalAccess ? (
        <p>A private development session is connected for this tab.</p>
      ) : account ? (
        <>
          <p>
            You are signed in as <strong>{account.name}</strong>.
          </p>
        </>
      ) : !capabilities ? (
        <>
          <p>
            {error
              ? 'Account service unavailable. You can keep exploring as a guest.'
              : 'Checking the account service…'}
          </p>
          {error && (
            <Button
              variant="secondary"
              className="full-width"
              onClick={() => void session.refresh()}
            >
              Try again
            </Button>
          )}
        </>
      ) : !capabilities.enabled ||
        (!capabilities.passwordAuthEnabled &&
          !capabilities.emailLinkAuthEnabled &&
          !capabilities.passkeyAuthEnabled &&
          !capabilities.socialProviders?.length) ? (
        <p>Account sign-in is unavailable on this instance. You can keep exploring as a guest.</p>
      ) : verificationEmail ? (
        <>
          <p role="status">
            Your account was created. Open the verification link sent to{' '}
            <strong>{verificationEmail}</strong>, then sign in to continue.
          </p>
          <Button
            className="full-width"
            onClick={() => {
              setMode('signin');
              session.dismissVerification();
            }}
          >
            Back to sign in
          </Button>
        </>
      ) : session.signInLinkEmail ? (
        <>
          <p role="status">
            If {session.signInLinkEmail} has an Elsewhere account, a one-use sign-in link is on its
            way. Open it within 10 minutes.
          </p>
          <Button variant="secondary" className="full-width" onClick={session.dismissSignInLink}>
            Use another email
          </Button>
        </>
      ) : !capabilities.passwordAuthEnabled && !capabilities.emailLinkAuthEnabled ? (
        <>
          <SocialSignIn session={session} />
          <PasskeySignIn session={session} />
        </>
      ) : mode === 'signin' && capabilities.emailLinkAuthEnabled && !usePassword ? (
        <>
          <SocialSignIn session={session} />
          <PasskeySignIn session={session} />
          <p>Receive a one-use sign-in link for your existing Elsewhere account.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = String(new FormData(event.currentTarget).get('email') ?? '');
              void session.sendSignInLink(email);
            }}
          >
            <label htmlFor="account-link-email">Email</label>
            <input
              className="ew-field"
              data-autofocus
              id="account-link-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              disabled={pending}
            />
            <Button type="submit" className="full-width" busy={pending}>
              Email me a sign-in link
            </Button>
          </form>
          {capabilities.passwordAuthEnabled && (
            <Button variant="quiet" className="full-width" onClick={() => setUsePassword(true)}>
              Use a password instead
            </Button>
          )}
          {capabilities.passwordAuthEnabled && (
            <Button variant="secondary" className="full-width" onClick={() => setMode('signup')}>
              Create a visitor account
            </Button>
          )}
        </>
      ) : (
        <>
          <SocialSignIn session={session} />
          {mode === 'signin' && <PasskeySignIn session={session} />}
          <p>
            Keep exploring as a guest, or create a visitor account. Sign-up never grants world
            administration.
          </p>
          <form ref={form} onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <label htmlFor="account-name">Display name</label>
                <input
                  className="ew-field"
                  data-autofocus
                  id="account-name"
                  name="name"
                  autoComplete="nickname"
                  maxLength={60}
                  required
                  disabled={pending}
                />
              </>
            )}
            <label htmlFor="account-email">Email</label>
            <input
              className="ew-field"
              data-autofocus={mode === 'signin' ? '' : undefined}
              id="account-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              disabled={pending}
            />
            <label htmlFor="account-password">Password</label>
            <input
              className="ew-field"
              id="account-password"
              name="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={12}
              maxLength={128}
              required
              disabled={pending}
            />
            <p className="privacy-note">
              Use at least 12 characters.{' '}
              {capabilities.requiresEmailVerification
                ? 'Verify your email before your first sign-in.'
                : 'This local instance does not send verification or password-reset email.'}
            </p>
            <Button type="submit" className="full-width" busy={pending}>
              {pending ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          {mode === 'signin' && capabilities.emailLinkAuthEnabled && (
            <Button variant="quiet" className="full-width" onClick={() => setUsePassword(false)}>
              Use an email link instead
            </Button>
          )}
          <p className="account-switch">
            {mode === 'signup' ? 'Already have an account?' : 'New to Elsewhere?'}{' '}
            <Button
              variant="quiet"
              busy={pending}
              onClick={() => {
                session.dismissVerification();
                setMode(mode === 'signup' ? 'signin' : 'signup');
              }}
            >
              {mode === 'signup' ? 'Sign in instead' : 'Create an account'}
            </Button>
          </p>
        </>
      )}
      <p role="alert" className="auth-error">
        {error || session.socialAuthReturnMessage}
      </p>
    </Modal>
  );
}
