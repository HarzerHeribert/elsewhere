import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CharacterMailbox, CharacterMailPreferences } from './CharacterMail';
import type { AccountCharacterMail } from '../../../characters/interfaces/src/mail';
const mail: AccountCharacterMail = {
  characterId: 'hubert',
  name: 'Hubert',
  address: 'hubert@elswhr.dev',
  receiving: 'pending',
  sendingAvailable: true,
  canSubscribe: true,
  preferences: { newsletter: false, correspondence: true },
};
const props = {
  mail,
  accountMail: mail,
  signedIn: true,
  emailVerified: true,
  onSignIn: () => undefined,
  onChange: async () => true,
};
describe('character mail presentation', () => {
  it('shows receiving as pending and keeps newsletter and correspondence preferences separate', () => {
    const html = renderToStaticMarkup(createElement(CharacterMailPreferences, props));
    expect(html).toContain('hubert@elswhr.dev');
    expect(html).toContain('Receiving is being verified');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
  it('requires sign-in and verification before offering subscription controls', () => {
    const guest = renderToStaticMarkup(
      createElement(CharacterMailPreferences, { ...props, signedIn: false }),
    );
    expect(guest).toContain('Sign in to choose emails');
    expect(guest).not.toContain('type="checkbox"');
    const unverified = renderToStaticMarkup(
      createElement(CharacterMailPreferences, { ...props, emailVerified: false }),
    );
    expect(unverified).toContain('Verify your email address');
    expect(unverified).not.toContain('type="checkbox"');
  });
  it('does not show missing preference data as an unchecked subscription', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterMailPreferences, { ...props, accountMail: undefined }),
    );
    expect(html).toContain('Your email preferences are unavailable right now.');
    expect(html).not.toContain('type="checkbox"');
  });
  it('hides mailbox controls from people who do not own this character', () => {
    expect(
      renderToStaticMarkup(
        createElement(CharacterMailbox, { mail, onChanged: async () => undefined }),
      ),
    ).toBe('');
  });
  it('shows owner review and delivery state and escapes email content', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterMailbox, {
        mail: {
          ...mail,
          owner: {
            publication: 'review',
            subscriberCount: 2,
            drafts: [
              {
                id: 'draft-1',
                characterId: 'hubert',
                kind: 'newsletter',
                subject: 'Public note',
                text: '<script>untrusted()</script>',
                source: 'character',
                createdAt: 1000,
                status: 'awaiting_approval',
              },
            ],
            inbox: [],
            deliveries: [],
          },
        },
        onChanged: async () => undefined,
      }),
    );
    expect(html).toContain('Approve and send');
    expect(html).toContain('2 newsletter subscribers');
    expect(html).toContain('Receiving pending verification');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('keeps owner mail readable while preventing composition and approval when controls are locked', () => {
    const html = renderToStaticMarkup(
      createElement(CharacterMailbox, {
        mail: {
          ...mail,
          owner: {
            publication: 'review',
            subscriberCount: 1,
            drafts: [
              {
                id: 'pending',
                characterId: 'hubert',
                kind: 'newsletter',
                subject: 'Pending note',
                text: 'Draft text',
                source: 'character',
                createdAt: 1000,
                status: 'awaiting_approval',
              },
            ],
            inbox: [
              {
                id: 'letter',
                characterId: 'hubert',
                senderName: 'A visitor',
                subject: 'A letter',
                text: 'Private inbox text',
                receivedAt: 1000,
                trust: 'external',
              },
            ],
            deliveries: [],
          },
        },
        readOnlyReason: 'Verify a passkey before sending as Hubert.',
        onChanged: async () => undefined,
      }),
    );
    expect(html).toContain('Verify a passkey before sending as Hubert.');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve and send<\/button>/);
    expect(html).toContain('Private inbox text');
    expect(html).toContain('Pending note');
    expect(html).toContain('<option value="newsletter" selected="">');
    expect(html).toContain('<option value="maker" disabled="">The maker · Not connected</option>');
    expect(html).toContain('A consenting member · None available');
  });
});
