import { useEffect, useRef, type ReactNode } from 'react';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { CharacterMailbox, CharacterMailPreferences } from './CharacterMail';
import { CreationManager } from './CreationManager';
import { CharacterProviderNotices } from './CharacterProviderNotices';
import { PasskeySettings } from './PasskeySettings';
import { SocialSignInSettings } from './SocialSignIn';
import { AboutWorld, WorldSettings } from './WorldDialog';
import { Button } from './ui/Button';
import { Icon } from './Icon';
import type { useAccountSession } from './useAccountSession';
import type { useOwnerActions } from './useOwnerActions';

export type SettingsSection =
  | 'account'
  | 'security'
  | 'mail'
  | 'creations'
  | 'controls'
  | 'world'
  | 'about';
export interface SettingsEntry {
  id: SettingsSection;
  label: string;
  group: 'You' | 'This world';
  badge?: string;
}
/** The sections this visitor can open. The same list feeds the phone’s More page. */
export function settingsEntries(access: {
  signedIn: boolean;
  privateLocalAccess: boolean;
  canManageWorld: boolean;
}): SettingsEntry[] {
  return [
    { id: 'account', label: 'Account', group: 'You' },
    ...(access.signedIn
      ? ([
          { id: 'security', label: 'Sign-in & security', group: 'You' },
          { id: 'mail', label: 'Mail', group: 'You' },
          { id: 'creations', label: 'Creations', group: 'You' },
        ] as const)
      : []),
    { id: 'controls', label: 'Controls', group: 'This world' },
    ...(access.canManageWorld
      ? ([{ id: 'world', label: 'World', group: 'This world', badge: 'Owner' }] as const)
      : []),
    { id: 'about', label: 'About Elsewhere', group: 'This world' },
  ];
}
const headings: Record<SettingsSection, { title: string; lead?: string }> = {
  account: { title: 'Account', lead: 'Who you are in Elsewhere.' },
  security: {
    title: 'Sign-in & security',
    lead: 'How you get into Elsewhere, and which devices can do it.',
  },
  mail: { title: 'Mail', lead: 'Letters between you and the residents.' },
  creations: { title: 'Creations', lead: 'What your characters have made and shared.' },
  controls: { title: 'Controls' },
  world: { title: 'World settings' },
  about: { title: 'About Elsewhere' },
};

export function SettingsScreen({
  section,
  entries,
  onSection,
  onClose,
  onBack,
  session,
  snapshot,
  admin,
  canManageCharacter,
  privateLocalAccess,
  onSignIn,
  onCreationsChanged,
  controls,
}: {
  section: SettingsSection;
  entries: SettingsEntry[];
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  /** Phones reach a section from the More page and return to it. */
  onBack: () => void;
  session: ReturnType<typeof useAccountSession>;
  snapshot: PublicSnapshot | null;
  admin: ReturnType<typeof useOwnerActions>;
  canManageCharacter: boolean;
  privateLocalAccess: boolean;
  onSignIn: () => void;
  onCreationsChanged: () => void | Promise<void>;
  controls: ReactNode;
}) {
  const { account, capabilities, pending } = session;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [section]);
  const ownerControlsLocked =
    capabilities?.ownerControlsRequirePasskey === true &&
    capabilities?.ownerControlsUnlocked !== true;
  const unlock = (
    <div className="memory-glimpse">
      <strong>Owner controls are locked</strong>
      <p>Verify a passkey to change your world or characters.</p>
      <Button
        variant="secondary"
        busy={pending}
        disabled={!session.passkeysSupported}
        onClick={() => void session.verifyPasskey()}
      >
        Unlock owner controls
      </Button>
    </div>
  );
  const signOut = (
    <div className="settings-card settings-row">
      <div>
        <strong>Sign out</strong>
        <p>You can keep exploring as a guest.</p>
      </div>
      <Button
        variant="secondary"
        busy={pending}
        onClick={async () => {
          if (await session.signOut()) onClose();
        }}
      >
        {pending ? 'One moment…' : 'Sign out'}
      </Button>
    </div>
  );
  const groups = ['You', 'This world'] as const;
  return (
    <section className="settings-screen" aria-label="Settings">
      <nav className="settings-list" aria-label="Settings sections">
        <h2>Settings</h2>
        {groups.map((group) => (
          <div key={group}>
            <p className="eyebrow">{group}</p>
            {entries
              .filter((entry) => entry.group === group)
              .map((entry) => (
                <button
                  key={entry.id}
                  aria-current={section === entry.id ? 'page' : undefined}
                  onClick={() => onSection(entry.id)}
                >
                  {entry.label}
                  {entry.badge && <span className="settings-badge">{entry.badge}</span>}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-body" key={section}>
          <header className="settings-head">
            <button className="back-link settings-back" onClick={onBack}>
              <Icon name="chevron-left" />
              Account
            </button>
            <h2 ref={heading} tabIndex={-1}>
              {headings[section].title}
            </h2>
            <button
              className="square-button subtle settings-close"
              aria-label="Close settings"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </header>
          {headings[section].lead && <p className="settings-lead">{headings[section].lead}</p>}
          {section === 'account' &&
            (account ? (
              <>
                <h3 className="settings-greeting">{'Hello, ' + account.name}</h3>
                <p>
                  You are signed in as <strong>{account.name}</strong>.
                </p>
                <CharacterProviderNotices
                  issues={session.characterIssues}
                  pending={pending}
                  onRetry={session.retryCharacterProvider}
                  canRetry={!ownerControlsLocked}
                />
                {ownerControlsLocked && unlock}
                <dl className="account-details settings-card">
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
                  Your email address stays private. Each character’s newsletter and personal email
                  preferences are separate.
                </p>
                {signOut}
              </>
            ) : privateLocalAccess ? (
              <>
                <h3 className="settings-greeting">Private local session</h3>
                <p>A private development session is connected for this tab.</p>
              </>
            ) : (
              <div className="settings-card settings-row">
                <div>
                  <strong>You’re exploring as a guest</strong>
                  <p>Sign in to receive mail from residents and manage your own characters.</p>
                </div>
                <Button onClick={onSignIn}>Sign in or create an account</Button>
              </div>
            ))}
          {section === 'security' && account && (
            <>
              <PasskeySettings session={session} />
              <SocialSignInSettings session={session} />
              {signOut}
            </>
          )}
          {section === 'mail' && account && (
            <>
              {session.characterMailUnavailable && (
                <div className="privacy-note" role="status">
                  <p>Character mail is temporarily unavailable.</p>
                  <Button variant="quiet" onClick={() => void session.refresh()}>
                    Reload mail
                  </Button>
                </div>
              )}
              {session.characterMail.map((mail) => (
                <div key={mail.characterId}>
                  <CharacterMailPreferences
                    mail={mail}
                    accountMail={mail}
                    signedIn
                    emailVerified={account.emailVerified}
                    onSignIn={() => undefined}
                    pending={pending}
                    onChange={(preferences) =>
                      session.updateMailPreferences(mail.characterId, preferences)
                    }
                  />
                  <CharacterMailbox
                    mail={mail}
                    onChanged={session.refresh}
                    readOnlyReason={
                      ownerControlsLocked
                        ? 'Verify a passkey before writing or sending mail as this character.'
                        : !account.emailVerified
                          ? 'Verify your account email before writing or sending mail as this character.'
                          : undefined
                    }
                  />
                </div>
              ))}
              {!session.characterMail.length && !session.characterMailUnavailable && (
                <p className="empty-state">No resident has a mailbox for this account yet.</p>
              )}
            </>
          )}
          {section === 'creations' &&
            account &&
            (ownerControlsLocked ? (
              unlock
            ) : capabilities?.managedCharacterIds.length ? (
              capabilities.managedCharacterIds.map((characterId) => (
                <CreationManager
                  key={characterId}
                  characterId={characterId}
                  creations={snapshot?.creations}
                  onChanged={onCreationsChanged}
                />
              ))
            ) : (
              <p className="empty-state">
                Creations appear here once you manage a character of your own.
              </p>
            ))}
          {section === 'controls' && controls}
          {section === 'world' &&
            (ownerControlsLocked ? (
              unlock
            ) : (
              <WorldSettings
                snapshot={snapshot}
                admin={admin}
                isWorldAdmin={account?.isWorldAdmin ?? false}
                canManageCharacter={canManageCharacter}
              />
            ))}
          {section === 'about' && <AboutWorld offline={!snapshot} onBack={onClose} />}
          {account && (
            <p role="alert" className="auth-error">
              {session.error || session.socialAuthReturnMessage}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
