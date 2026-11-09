import type { PublicCreation } from '@elsewhere/character-interfaces';
import { CreationManager } from './CreationManager';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './ui/Button';
import type { useAccountSession } from './useAccountSession';

export function AccountDialog({
  session,
  creations,
  onCreationsChanged,
  onClose,
  onOpenManagement,
  privateLocalAccess = false,
}: {
  session: ReturnType<typeof useAccountSession>;
  creations?: PublicCreation[];
  onCreationsChanged?: () => void | Promise<void>;
  onClose: () => void;
  onOpenManagement?: () => void;
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
          {capabilities?.managedCharacterIds.map((characterId) => (
            <CreationManager
              key={characterId}
              characterId={characterId}
              creations={creations}
              onChanged={onCreationsChanged}
            />
          ))}
          {session.characterIssues.length > 0 && (
            <section aria-label="Character provider notices">
              <h3>Your characters</h3>
              {session.characterIssues
                .slice()
                .reverse()
                .map((issue) => (
                  <article key={issue.id} className="memory-glimpse">
                    <strong>
                      {issue.characterId === 'hubert' ? 'Hubert' : issue.characterId} ·{' '}
                      {issue.resolvedAt !== undefined
                        ? 'Recovered'
                        : issue.retrying
                          ? 'Reconsidering'
                          : 'Needs attention'}
                    </strong>
                    <p>
                      {issue.resolvedAt !== undefined
                        ? 'This earlier issue has recovered.'
                        : issue.message}
                    </p>
                    {issue.code && (
                      <p>
                        Action feedback: {issue.code.replace(/_/g, ' ')}
                        {issue.fields?.length ? ' · fields: ' + issue.fields.join(', ') : ''}
                      </p>
                    )}
                    <small>
                      {issue.workload === 'notebook'
                        ? 'Notebook'
                        : issue.workload === 'reflection'
                          ? 'Reflection'
                          : 'Decisions'}{' '}
                      · {new Date(issue.since).toLocaleString()}
                      {issue.resolvedAt !== undefined && (
                        <> · Recovered {new Date(issue.resolvedAt).toLocaleString()}</>
                      )}
                    </small>
                    {issue.resolvedAt === undefined && !issue.retrying && (
                      <Button
                        variant="secondary"
                        busy={pending}
                        onClick={() => void session.retryCharacterProvider(issue.characterId)}
                      >
                        Retry provider
                      </Button>
                    )}
                  </article>
                ))}
            </section>
          )}
          <p className="privacy-note">
            Your email stays private. Character email delivery requires verified contact details and
            explicit consent; it is not connected yet.
          </p>
          <Button
            variant="secondary"
            className="full-width"
            busy={pending}
            onClick={async () => {
              if (await session.signOut()) onClose();
            }}
          >
            {pending ? 'One moment…' : 'Sign out'}
          </Button>
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
        (!capabilities.passwordAuthEnabled && !capabilities.emailLinkAuthEnabled) ? (
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
      ) : mode === 'signin' && capabilities.emailLinkAuthEnabled && !usePassword ? (
        <>
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
      {onOpenManagement && (
        <Button variant="secondary" className="full-width" onClick={onOpenManagement}>
          World settings
        </Button>
      )}
      <p role="alert" className="auth-error">
        {error}
      </p>
    </Modal>
  );
}
