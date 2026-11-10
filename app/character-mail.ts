import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import { SqliteSnapshotStore } from '../packages/persistence/src/index';
import {
  CharacterMailService,
  type MailRecipient,
  type MailState,
} from '../packages/mail/src/service';
import { PostgresMailStore } from '../packages/mail/src/store';
import { characterMailFromEnvironment } from '../packages/mail/src/config';
import { MailTransportError, verifyResendWebhook } from '../packages/mail/src/resend';

/** Host-only composition: provider secrets and resolved addresses never enter the character context. */
export async function createCharacterMail(
  environment: NodeJS.ProcessEnv,
  options: {
    dataDirectory: string;
    ownerUserId: string;
    publicOrigin: string;
    databaseUrl?: string;
    lookupUser(userId: string): Promise<MailRecipient | null>;
    lookupUserByEmail(email: string): Promise<MailRecipient | null>;
  },
) {
  const configured = characterMailFromEnvironment({
    ...environment,
    HUBERT_OWNER_USER_ID: options.ownerUserId,
    WEB_ORIGIN: options.publicOrigin,
  });
  const characters = configured?.characters ?? [
    {
      characterId: 'hubert',
      name: 'Hubert',
      address: 'hubert@elswhr.dev',
      ownerUserId: options.ownerUserId,
      receiving: 'pending' as const,
      publication: 'review' as const,
      dailyLimit: 20,
    },
  ];
  const store = options.databaseUrl
    ? new PostgresMailStore(options.databaseUrl)
    : new SqliteSnapshotStore<MailState>(resolve(options.dataDirectory, 'character-mail.sqlite'));
  const service = new CharacterMailService(store, {
    characters,
    transport: configured?.transport,
    lookupUser: options.lookupUser,
    lookupUserByEmail: options.lookupUserByEmail,
    // Unconfigured mail never emits unsubscribe links; a real connection requires its persistent secret.
    unsubscribeSecret: configured?.unsubscribeSecret ?? randomBytes(48).toString('base64url'),
    publicOrigin: configured?.publicOrigin ?? options.publicOrigin,
  });
  try {
    await service.init();
  } catch (error) {
    await store.close();
    throw error;
  }
  return {
    service,
    async handleWebhook(raw: string, headers: IncomingHttpHeaders) {
      if (!configured?.webhookSecret) throw new MailTransportError('configuration');
      const event = verifyResendWebhook(
        raw,
        {
          'svix-id': typeof headers['svix-id'] === 'string' ? headers['svix-id'] : undefined,
          'svix-timestamp':
            typeof headers['svix-timestamp'] === 'string' ? headers['svix-timestamp'] : undefined,
          'svix-signature':
            typeof headers['svix-signature'] === 'string' ? headers['svix-signature'] : undefined,
        },
        configured.webhookSecret,
      );
      if (event.type !== 'email.received')
        return service.deliveryEvent(event.eventId, event.emailId, event.type);
      const mailbox = (value: string) =>
        (value.match(/<([^<>]+)>$/)?.[1] ?? value).trim().toLowerCase();
      const accepts = characters.some(
        (character) =>
          character.receiving === 'enabled' &&
          event.to?.some((address) => mailbox(address) === character.address.toLowerCase()),
      );
      if (!accepts) return { accepted: false, receiving: 'pending' };
      const received = await configured.transport.retrieveReceived(event.emailId);
      if (received.id !== event.emailId) throw new MailTransportError('response');
      return service.receive({ ...received, eventId: event.eventId, emailId: received.id });
    },
  };
}
