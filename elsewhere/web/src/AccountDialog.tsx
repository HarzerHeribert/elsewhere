import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import type { useAccountSession } from './useAccountSession';

export function AccountDialog({
  session,
  onClose,
}: {
  session: ReturnType<typeof useAccountSession>;
  onClose: () => void;
}) {
  const { account, capabilities, pending, error, verificationEmail } = session;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
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
          : verificationEmail
            ? 'Check your email.'
            : mode === 'signup'
              ? 'A name for your visits.'
              : 'Welcome back.'}
      </h2>
      {account ? (
        <>
          <p>
            You are signed in as <strong>{account.name}</strong>.
          </p>
          <dl className="account-details">
            <div>
              <dt>Email</dt>
              <dd>{account.email}</dd>
            </div>
            <div>
              <dt>World access</dt>
              <dd>{account.isWorldAdmin ? 'World admin' : 'Visitor'}</dd>
            </div>
            <div>
              <dt>Characters you manage</dt>
              <dd>
                {capabilities?.managedCharacterIds.length
                  ? capabilities.managedCharacterIds
                      .map((id) => (id === 'hubert' ? 'Hubert' : id))
                      .join(', ')
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Email status</dt>
              <dd>{account.emailVerified ? 'Verified' : 'Unverified'}</dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd>
                <code>{account.id}</code>
              </dd>
            </div>
          </dl>
          <p className="privacy-note">
            Your email stays private. Character email delivery requires verified contact details and
            explicit consent; it is not connected yet.
          </p>
          <button
            className="secondary-button full-width"
            disabled={pending}
            onClick={async () => {
              if (await session.signOut()) onClose();
            }}
          >
            {pending ? 'One moment…' : 'Sign out'}
          </button>
        </>
      ) : !capabilities ? (
        <>
          <p>
            {error
              ? 'Account service unavailable. You can keep exploring as a guest.'
              : 'Checking the account service…'}
          </p>
          {error && (
            <button className="secondary-button full-width" onClick={() => void session.refresh()}>
              Try again
            </button>
          )}
        </>
      ) : !capabilities.enabled || !capabilities.passwordAuthEnabled ? (
        <p>Account sign-in is unavailable on this instance. You can keep exploring as a guest.</p>
      ) : verificationEmail ? (
        <>
          <p role="status">
            Your account was created. Open the verification link sent to{' '}
            <strong>{verificationEmail}</strong>, then sign in to continue.
          </p>
          <button
            className="primary-button full-width"
            onClick={() => {
              setMode('signin');
              session.dismissVerification();
            }}
          >
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <p>
            Keep exploring as a guest, or create a visitor account. Sign-up never grants world
            administration.
          </p>
          <form ref={form} onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <label htmlFor="account-name">Display name</label>
                <input
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
            <button className="primary-button full-width" disabled={pending}>
              {pending ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="account-switch">
            {mode === 'signup' ? 'Already have an account?' : 'New to Elsewhere?'}{' '}
            <button
              className="text-button"
              disabled={pending}
              onClick={() => {
                session.dismissVerification();
                setMode(mode === 'signup' ? 'signin' : 'signup');
              }}
            >
              {mode === 'signup' ? 'Sign in instead' : 'Create an account'}
            </button>
          </p>
        </>
      )}
      <p role="alert" className="auth-error">
        {error}
      </p>
    </Modal>
  );
}
