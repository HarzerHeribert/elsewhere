import { useState, type FormEvent } from 'react';
import type {
  AccountCharacterMail,
  MailPreferences,
  PublicCharacterMail,
} from '../../../characters/interfaces/src/mail';
import { Button } from './ui/Button';
import { requestJson } from './worldApi';
import './CharacterMail.css';

export function CharacterMailPreferences({
  mail,
  accountMail,
  signedIn,
  emailVerified,
  onSignIn,
  onChange,
  pending = false,
}: {
  mail?: PublicCharacterMail | null;
  accountMail?: AccountCharacterMail;
  signedIn: boolean;
  emailVerified: boolean;
  onSignIn: () => void;
  onChange: (preferences: MailPreferences) => Promise<boolean>;
  pending?: boolean;
}) {
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState<MailPreferences | null>(null);
  if (!mail) return null;
  const preferences = optimistic ??
    accountMail?.preferences ?? { newsletter: false, correspondence: false };
  const change = async (next: MailPreferences) => {
    setError('');
    setOptimistic(next);
    if (!(await onChange(next))) setError('Your email preference could not be saved. Try again.');
    setOptimistic(null);
  };
  return (
    <section className="panel-section character-mail" aria-label={`Emails from ${mail.name}`}>
      <p className="eyebrow">Emails from {mail.name}</p>
      <p>{mail.address}</p>
      <p className="privacy-note">
        {mail.receiving === 'pending'
          ? 'Replies are not available yet. Receiving is being verified.'
          : 'Replies arrive in this character’s private inbox.'}
      </p>
      {!mail.sendingAvailable && (
        <p className="privacy-note">Email sending is not connected yet.</p>
      )}
      {!signedIn ? (
        <Button variant="secondary" onClick={onSignIn}>
          Sign in to choose emails
        </Button>
      ) : !emailVerified ? (
        <p className="empty-state">Verify your email address to subscribe.</p>
      ) : !accountMail ? (
        <p className="empty-state">Your email preferences are unavailable right now.</p>
      ) : (
        <fieldset disabled={pending || !accountMail.canSubscribe}>
          <label className="mail-preference">
            <input
              type="checkbox"
              checked={preferences.newsletter}
              onChange={(event) =>
                void change({ ...preferences, newsletter: event.target.checked })
              }
            />
            Receive {mail.name}’s newsletter
          </label>
          <label className="mail-preference">
            <input
              type="checkbox"
              checked={preferences.correspondence}
              onChange={(event) =>
                void change({ ...preferences, correspondence: event.target.checked })
              }
            />
            Allow personal emails from {mail.name}
          </label>
          <small>
            {pending
              ? 'Saving your email preferences…'
              : 'You can change either preference at any time.'}
          </small>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function CharacterMailbox({
  mail,
  onChanged,
  readOnlyReason,
}: {
  mail: AccountCharacterMail;
  onChanged: () => Promise<void>;
  readOnlyReason?: string;
}) {
  const [pending, setPending] = useState(false);
  const [kind, setKind] = useState<'maker' | 'newsletter' | 'correspondence'>(() =>
    mail.owner?.makerAvailable === true ? 'maker' : 'newsletter',
  );
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  if (!mail.owner) return null;
  const endpoint = `/api/characters/${encodeURIComponent(mail.characterId)}/mail/drafts`;
  const makerAvailable = mail.owner.makerAvailable === true;
  const correspondentsAvailable = Boolean(mail.owner.contacts?.length);
  const targetUnavailable =
    (kind === 'maker' && !makerAvailable) ||
    (kind === 'correspondence' && !correspondentsAvailable);
  async function mutate(url: string, data: Record<string, unknown>, success: string) {
    if (pending || readOnlyReason) return false;
    setPending(true);
    setError('');
    setStatus('');
    try {
      await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await onChanged();
      setStatus(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mail could not be saved.');
      return false;
    } finally {
      setPending(false);
    }
  }
  async function compose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (targetUnavailable) {
      setError('This recipient is unavailable. Choose another recipient.');
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const accepted = await mutate(
      endpoint,
      {
        kind,
        subject: String(data.get('subject') ?? ''),
        text: String(data.get('text') ?? ''),
        ...(kind === 'correspondence'
          ? { recipientUserId: String(data.get('recipientUserId') ?? '') }
          : {}),
      },
      kind === 'newsletter' && mail.owner?.publication === 'review'
        ? 'Newsletter draft saved for your review.'
        : 'Email queued for delivery.',
    );
    if (accepted) form.reset();
  }
  return (
    <section className="panel-section character-mail" aria-label={`${mail.name} mailbox`}>
      <h3>{mail.name}’s mail</h3>
      <p>{mail.address}</p>
      <p>
        {mail.receiving === 'pending' ? 'Receiving pending verification.' : 'Receiving enabled.'}{' '}
        {mail.sendingAvailable ? 'Sending connected.' : 'Sending not connected.'}
      </p>
      <p>
        {mail.owner.subscriberCount} newsletter subscribers ·{' '}
        {mail.owner.publication === 'review'
          ? 'Newsletters require your approval.'
          : 'Automatic publication enabled.'}
      </p>
      {readOnlyReason && <p className="privacy-note">{readOnlyReason}</p>}
      <details>
        <summary>Write an email as {mail.name}</summary>
        <form onSubmit={(event) => void compose(event)}>
          <fieldset disabled={pending || Boolean(readOnlyReason)}>
            <label>
              Send to
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="maker" disabled={!makerAvailable}>
                  The maker{makerAvailable ? '' : ' · Not connected'}
                </option>
                <option value="newsletter">Newsletter subscribers</option>
                <option value="correspondence" disabled={!correspondentsAvailable}>
                  A consenting member{correspondentsAvailable ? '' : ' · None available'}
                </option>
              </select>
            </label>
            {kind === 'correspondence' && (
              <label>
                Recipient
                <select name="recipientUserId" required defaultValue="">
                  <option value="" disabled>
                    Choose a consenting member
                  </option>
                  {(mail.owner?.contacts ?? []).map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
                </select>
                {!mail.owner?.contacts?.length && (
                  <small>No members currently allow personal emails from this character.</small>
                )}
              </label>
            )}
            <label>
              Subject
              <input name="subject" required maxLength={160} />
            </label>
            <label>
              Message
              <textarea name="text" required maxLength={6000} rows={5} />
            </label>
            <Button type="submit" busy={pending} disabled={targetUnavailable}>
              {kind === 'newsletter' && mail.owner?.publication === 'review'
                ? 'Save newsletter draft'
                : kind === 'newsletter'
                  ? 'Queue newsletter'
                  : 'Queue email'}
            </Button>
          </fieldset>
        </form>
      </details>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      <details open={mail.owner.drafts.some((draft) => draft.status === 'awaiting_approval')}>
        <summary>Drafts and sent mail · {mail.owner.drafts.length}</summary>
        {[...mail.owner.drafts].reverse().map((draft) => (
          <article className="memory-glimpse" key={draft.id}>
            <strong>{draft.subject}</strong>
            <small>
              {draft.kind} · {draft.status.replace(/_/g, ' ')} ·{' '}
              {draft.source === 'owner' ? 'Written by owner' : 'Written by character'}
            </small>
            <p className="mail-body">{draft.text}</p>
            {draft.status === 'awaiting_approval' && (
              <Button
                variant="secondary"
                busy={pending}
                disabled={Boolean(readOnlyReason)}
                onClick={() =>
                  void mutate(
                    `${endpoint}/${encodeURIComponent(draft.id)}/approve`,
                    {},
                    'Email approved for delivery.',
                  )
                }
              >
                Approve and send
              </Button>
            )}
          </article>
        ))}
      </details>
      <details>
        <summary>Delivery status · {mail.owner.deliveries.length}</summary>
        {[...mail.owner.deliveries].reverse().map((delivery) => (
          <article className="memory-glimpse" key={delivery.id}>
            <strong>{delivery.status}</strong>
            <p>{delivery.summary}</p>
            <small>{new Date(delivery.at).toLocaleString()}</small>
          </article>
        ))}
      </details>
      <details>
        <summary>Private inbox · {mail.owner.inbox.length}</summary>
        {[...mail.owner.inbox].reverse().map((item) => (
          <article className="memory-glimpse" key={item.id}>
            <strong>{item.subject}</strong>
            <small>
              From {item.senderName} · {new Date(item.receivedAt).toLocaleString()}
            </small>
            <p className="mail-body">{item.text}</p>
          </article>
        ))}
      </details>
    </section>
  );
}
