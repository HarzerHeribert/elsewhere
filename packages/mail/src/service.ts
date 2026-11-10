import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  MailComposeSchema,
  MailPreferencesSchema,
  type AccountCharacterMail,
  type CharacterMailDraft,
  type MailComposeInput,
  type MailPreferences,
  type PublicCharacterMail,
} from '../../../characters/interfaces/src/mail';
import type { SnapshotStore } from '../../persistence/src/index';
import {
  initialMailState,
  type CharacterMailConfiguration,
  type MailRecipient,
  type MailState,
  type MailTransport,
  type ReceivedCharacterMail,
} from './state';
export type {
  CharacterMailConfiguration,
  MailRecipient,
  MailState,
  MailTransport,
  ReceivedCharacterMail,
} from './state';

export class MailError extends Error {}
const digest = (value: string) =>
  createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const mailAddress = (value: string): string | null => {
  const address = value.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/)?.[1]?.trim() ?? value.trim();
  return z.string().email().max(254).safeParse(address).success ? address.toLowerCase() : null;
};
const maxDrafts = 128;
const activeDelivery = new Set(['queued', 'sending']);
export interface CharacterMailOptions {
  characters: CharacterMailConfiguration[];
  lookupUser(userId: string): Promise<MailRecipient | null>;
  lookupUserByEmail?(email: string): Promise<MailRecipient | null>;
  transport?: MailTransport;
  unsubscribeSecret: string;
  publicOrigin: string;
  now?: () => number;
}

/** One durable host lane: all recipients are resolved privately at the moment of dispatch. */
export class CharacterMailService {
  private state: MailState = initialMailState();
  private committed: MailState = initialMailState();
  private version = 0;
  private halted = false;
  private closing = false;
  private lane: Promise<unknown> = Promise.resolve();
  private readonly characters: CharacterMailConfiguration[];
  private readonly origin: string;
  constructor(
    private readonly store: SnapshotStore<MailState>,
    private readonly options: CharacterMailOptions,
  ) {
    const parsed = z
      .array(
        z
          .object({
            characterId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
            name: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[^\r\n<>\x00-\x1f]+$/),
            address: z.string().email().max(254),
            ownerUserId: z.string().min(1).max(128),
            makerUserId: z.string().min(1).max(128).optional(),
            receiving: z.enum(['pending', 'enabled']),
            publication: z.enum(['review', 'automatic']),
            dailyLimit: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .max(100)
      .safeParse(options.characters);
    if (
      !parsed.success ||
      options.unsubscribeSecret.length < 32 ||
      new Set(parsed.data.map((x) => x.characterId)).size !== parsed.data.length ||
      new Set(parsed.data.map((x) => x.address.toLowerCase())).size !== parsed.data.length
    )
      throw new MailError('Character mail configuration is invalid.');
    const url = new URL(options.publicOrigin);
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new MailError('Character mail origin is invalid.');
    this.origin = url.origin;
    this.characters = parsed.data;
  }
  async init() {
    const saved = await this.store.load();
    if (saved) {
      if (saved.value.version !== 1) throw new MailError('Character mail storage is incompatible.');
      this.state = structuredClone(saved.value);
      this.version = saved.version;
      this.committed = structuredClone(this.state);
      let changed = false;
      for (const delivery of this.state.deliveries)
        if (delivery.status === 'sending') {
          delivery.status = 'uncertain';
          delivery.summary =
            'An interrupted delivery needs provider review; it will not be resent automatically.';
          changed = true;
        }
      if (changed) {
        this.updateDrafts();
        await this.commit();
      }
    } else await this.commit();
    return this;
  }
  private now() {
    return Math.max(this.options.now?.() ?? Date.now(), this.state.latestAt);
  }
  private character(id: string) {
    const found = this.characters.find((item) => item.characterId === id);
    if (!found) throw new MailError('Character mail is unavailable.');
    return found;
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new MailError('Character mail is closing.'));
    const next = this.lane.then(async () => {
      if (this.halted) throw new MailError('Character mail stopped after a storage failure.');
      try {
        return await operation();
      } catch (error) {
        this.state = structuredClone(this.committed);
        throw error;
      }
    });
    this.lane = next.catch(() => undefined);
    return next;
  }
  private async commit() {
    this.state.latestAt = this.now();
    try {
      this.version = await this.store.save(this.state, this.version);
      this.committed = structuredClone(this.state);
    } catch {
      this.state = structuredClone(this.committed);
      this.halted = true;
      throw new MailError('Character mail stopped after a storage failure.');
    }
  }
  getPublic(characterId: string): PublicCharacterMail | null {
    const character = this.characters.find((item) => item.characterId === characterId);
    return character
      ? {
          characterId,
          name: character.name,
          address: character.address,
          receiving: character.receiving,
          sendingAvailable: Boolean(this.options.transport) && !this.halted,
        }
      : null;
  }
  async getAccount(
    accountId: string,
    managedCharacterIds: readonly string[],
  ): Promise<AccountCharacterMail[]> {
    const account = await this.options.lookupUser(accountId);
    const state = this.committed;
    return Promise.all(
      this.characters.map(async (character) => {
        const preference = state.preferences.find(
          (item) =>
            item.userId === accountId &&
            item.characterId === character.characterId &&
            account &&
            item.emailHash === digest(account.email),
        );
        const canSubscribe = Boolean(account?.emailVerified);
        const owner =
          managedCharacterIds.includes(character.characterId) &&
          character.ownerUserId === accountId;
        const prefs =
          canSubscribe && preference
            ? { newsletter: preference.newsletter, correspondence: preference.correspondence }
            : { newsletter: false, correspondence: false };
        const planning = owner ? await this.getPlanning(character.characterId) : undefined;
        return {
          ...this.getPublic(character.characterId)!,
          preferences: prefs,
          canSubscribe,
          ...(owner
            ? {
                owner: {
                  publication: character.publication,
                  contacts: planning!.contacts,
                  makerAvailable: planning!.makerAvailable,
                  drafts: state.drafts
                    .filter((item) => item.characterId === character.characterId)
                    .slice(-32)
                    .map((item) => ({ ...item })),
                  inbox: state.inbox
                    .filter((item) => item.characterId === character.characterId)
                    .slice(-32)
                    .map((item) => ({ ...item })),
                  deliveries: state.deliveries
                    .filter((item) => item.characterId === character.characterId)
                    .slice(-64)
                    .map(({ providerId: _providerId, emailHash: _emailHash, ...item }) => item),
                  subscriberCount: state.preferences.filter(
                    (item) =>
                      item.characterId === character.characterId &&
                      item.newsletter &&
                      !state.suppressed.includes(item.emailHash),
                  ).length,
                },
              }
            : {}),
        };
      }),
    );
  }
  setPreferences(characterId: string, userId: string, input: MailPreferences) {
    return this.run(async () => {
      this.character(characterId);
      const parsed = MailPreferencesSchema.safeParse(input);
      if (!parsed.success) throw new MailError('Mail preferences are invalid.');
      const user = await this.options.lookupUser(userId);
      if (!user?.emailVerified)
        throw new MailError('Verify your account email before subscribing.');
      const existing = this.state.preferences.find(
        (item) => item.characterId === characterId && item.userId === userId,
      );
      if (!existing && this.state.preferences.length >= 10000)
        throw new MailError('Mail subscriptions are at capacity.');
      const value = { ...parsed.data, characterId, userId, emailHash: digest(user.email) };
      if (existing) Object.assign(existing, value);
      else this.state.preferences.push(value);
      await this.commit();
      return { ...parsed.data };
    });
  }
  compose(characterId: string, input: MailComposeInput, source: 'character' | 'owner') {
    return this.run(async () => {
      const character = this.character(characterId);
      const parsed = MailComposeSchema.safeParse(input);
      if (!parsed.success) throw new MailError('Mail content is invalid.');
      if (!['character', 'owner'].includes(source)) throw new MailError('Mail author is invalid.');
      const message = parsed.data;
      if (message.kind === 'maker' && !character.makerUserId)
        throw new MailError('No maker contact is configured.');
      if (message.kind === 'correspondence') {
        const user = await this.options.lookupUser(message.recipientUserId!);
        if (!this.permitted(characterId, message.kind, user))
          throw new MailError('This person has not enabled character correspondence.');
      }
      const duplicate = this.state.drafts.find(
        (item) =>
          item.characterId === characterId &&
          item.kind === message.kind &&
          item.recipientUserId === message.recipientUserId &&
          item.subject === message.subject &&
          item.text === message.text,
      );
      if (duplicate) return structuredClone(duplicate);
      const removable = this.state.drafts.filter((item) =>
        ['completed', 'failed'].includes(item.status),
      );
      if (this.state.drafts.length >= maxDrafts && removable.length) {
        const id = removable[0].id;
        this.state.drafts = this.state.drafts.filter((item) => item.id !== id);
      }
      if (this.state.drafts.length >= maxDrafts)
        throw new MailError('Review pending mail before creating more drafts.');
      const at = this.now();
      const draft: CharacterMailDraft = {
        ...message,
        id: 'mail-' + randomUUID(),
        characterId,
        source,
        createdAt: at,
        status:
          message.kind === 'newsletter' && character.publication === 'review'
            ? 'awaiting_approval'
            : 'queued',
      };
      this.state.drafts.push(draft);
      if (draft.status === 'queued') this.queueDraft(draft, character);
      await this.commit();
      return structuredClone(draft);
    });
  }
  approve(characterId: string, draftId: string, ownerUserId: string) {
    return this.run(async () => {
      const character = this.character(characterId);
      if (character.ownerUserId !== ownerUserId)
        throw new MailError('Character ownership is required.');
      const draft = this.state.drafts.find(
        (item) => item.characterId === characterId && item.id === draftId,
      );
      if (!draft) throw new MailError('Mail draft not found.');
      if (draft.status === 'awaiting_approval') {
        draft.status = 'queued';
        this.queueDraft(draft, character);
        await this.commit();
      }
      return structuredClone(draft);
    });
  }
  private queueDraft(draft: CharacterMailDraft, character: CharacterMailConfiguration) {
    const recipients =
      draft.kind === 'newsletter'
        ? this.state.preferences
            .filter((item) => item.characterId === draft.characterId && item.newsletter)
            .map((item) => item.userId)
        : [draft.kind === 'maker' ? character.makerUserId! : draft.recipientUserId!];
    if (
      this.state.deliveries.filter((item) => activeDelivery.has(item.status)).length +
        recipients.length >
      10000
    )
      throw new MailError('Mail delivery queue is at capacity.');
    for (const recipientUserId of new Set(recipients)) {
      if (
        this.state.deliveries.some(
          (item) => item.draftId === draft.id && item.recipientUserId === recipientUserId,
        )
      )
        continue;
      this.state.deliveries.push({
        id: 'delivery-' + randomUUID(),
        draftId: draft.id,
        characterId: draft.characterId,
        recipientUserId,
        at: this.now(),
        status: 'queued',
        summary: 'Queued for individual delivery.',
      });
    }
    if (!recipients.length) draft.status = 'completed';
  }
  private permitted(
    characterId: string,
    kind: MailComposeInput['kind'],
    user: MailRecipient | null,
  ): user is MailRecipient {
    if (!user?.emailVerified || this.state.suppressed.includes(digest(user.email))) return false;
    if (kind === 'maker') return true;
    const prefs = this.state.preferences.find(
      (item) =>
        item.characterId === characterId &&
        item.userId === user.id &&
        item.emailHash === digest(user.email),
    );
    return Boolean(prefs && (kind === 'newsletter' ? prefs.newsletter : prefs.correspondence));
  }
  private token(
    characterId: string,
    userId: string,
    emailHash: string,
    kind: 'newsletter' | 'correspondence',
  ) {
    const body = Buffer.from(
      JSON.stringify({ c: characterId, u: userId, e: emailHash, k: kind }),
    ).toString('base64url');
    return (
      body +
      '.' +
      createHmac('sha256', this.options.unsubscribeSecret).update(body).digest('base64url')
    );
  }
  unsubscribe(token: string) {
    return this.run(async () => {
      if (typeof token !== 'string' || token.length > 2048)
        throw new MailError('Unsubscribe link is invalid.');
      const [body, signature, ...extra] = token.split('.');
      const expected = createHmac('sha256', this.options.unsubscribeSecret)
        .update(body ?? '')
        .digest();
      let actual: Buffer;
      try {
        actual = Buffer.from(signature ?? '', 'base64url');
      } catch {
        throw new MailError('Unsubscribe link is invalid.');
      }
      if (extra.length || actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new MailError('Unsubscribe link is invalid.');
      let parsed;
      try {
        parsed = z
          .object({
            c: z.string(),
            u: z.string(),
            e: z.string().length(64),
            k: z.enum(['newsletter', 'correspondence']),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
      } catch {
        throw new MailError('Unsubscribe link is invalid.');
      }
      const prefs = this.state.preferences.find(
        (item) =>
          item.characterId === parsed.c && item.userId === parsed.u && item.emailHash === parsed.e,
      );
      if (prefs) {
        prefs[parsed.k] = false;
        await this.commit();
      }
      return { unsubscribed: true as const };
    });
  }
  dispatch() {
    return this.run(async () => {
      if (!this.options.transport) return;
      // Each timer pass is bounded and grants are rechecked for each individual recipient.
      let count = 0,
        examined = 0;
      for (const delivery of this.state.deliveries.filter((item) => item.status === 'queued')) {
        if (count >= 1 || examined++ >= 20) break;
        const character = this.character(delivery.characterId);
        const draft = this.state.drafts.find(
          (item) => item.id === delivery.draftId && item.characterId === delivery.characterId,
        );
        if (!draft) {
          delivery.status = 'cancelled';
          delivery.summary = 'The source draft is unavailable.';
          await this.commit();
          continue;
        }
        const user = await this.options.lookupUser(delivery.recipientUserId);
        if (
          !this.permitted(delivery.characterId, draft.kind, user) ||
          (draft.kind === 'maker' && character.makerUserId !== user.id)
        ) {
          delivery.status = 'cancelled';
          delivery.summary = 'Recipient verification or contact permission is no longer available.';
          this.updateDrafts();
          await this.commit();
          continue;
        }
        const at = this.now(),
          day = dayOf(at),
          ledger = this.state.allowances[character.characterId];
        const current = ledger && ledger.day >= day ? ledger : { day, calls: 0 };
        if (current.calls >= character.dailyLimit) {
          const summary = 'Waiting for the next daily sending allowance.';
          if (delivery.summary !== summary) {
            delivery.summary = summary;
            await this.commit();
          }
          continue;
        }
        const recent = this.state.deliveries.some(
          (item) =>
            item.id !== delivery.id &&
            item.characterId === character.characterId &&
            item.recipientUserId === user.id &&
            !['queued', 'cancelled'].includes(item.status) &&
            at - item.at < 3600000,
        );
        if (recent) {
          const summary = 'Waiting before contacting this person again.';
          if (delivery.summary !== summary) {
            delivery.summary = summary;
            await this.commit();
          }
          continue;
        }
        this.state.allowances[character.characterId] = { ...current, calls: current.calls + 1 };
        delivery.status = 'sending';
        delivery.at = at;
        delivery.emailHash = digest(user.email);
        delivery.summary = 'Delivery reserved.';
        await this.commit(); // A crash after this point never replays an ambiguous send.
        count++;
        let text = draft.text;
        let headers: Record<string, string> | undefined;
        if (draft.kind !== 'maker') {
          const token = this.token(character.characterId, user.id, digest(user.email), draft.kind);
          const link = this.origin + '/api/mail/unsubscribe?token=' + encodeURIComponent(token);
          text +=
            '\n\nUnsubscribe from ' +
            character.name +
            (draft.kind === 'newsletter' ? ' newsletters: ' : ' correspondence: ') +
            link;
          headers = {
            'List-Unsubscribe': '<' + link + '>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          };
        }
        try {
          const result = await this.options.transport.send({
            from: character.name + ' <' + character.address + '>',
            to: user.email,
            subject: draft.subject,
            text,
            replyTo: character.receiving === 'enabled' ? character.address : undefined,
            headers,
            idempotencyKey: delivery.id,
          });
          if (!result.id || typeof result.id !== 'string' || result.id.length > 200)
            throw new Error();
          delivery.providerId = result.id;
          delivery.status = 'accepted';
          delivery.summary = 'Accepted by the mail provider; delivery is not yet confirmed.';
        } catch {
          delivery.status = 'uncertain';
          delivery.summary =
            'The delivery outcome is unknown. Check the provider before sending again.';
        }
        this.updateDrafts();
        await this.commit();
      }
      // Prune only terminal receipts; queued/uncertain requests retain their identity.
      const terminal = this.state.deliveries.filter((item) =>
        ['accepted', 'delivered', 'failed', 'cancelled'].includes(item.status),
      );
      if (terminal.length > 2000) {
        const keep = new Set(terminal.slice(-2000).map((item) => item.id));
        this.state.deliveries = this.state.deliveries.filter(
          (item) =>
            !['accepted', 'delivered', 'failed', 'cancelled'].includes(item.status) ||
            keep.has(item.id),
        );
        await this.commit();
      }
    });
  }
  private updateDrafts() {
    for (const draft of this.state.drafts) {
      if (draft.status === 'awaiting_approval') continue;
      const deliveries = this.state.deliveries.filter((item) => item.draftId === draft.id);
      draft.status = deliveries.some((item) => activeDelivery.has(item.status))
        ? 'queued'
        : deliveries.some((item) => item.status === 'uncertain')
          ? 'uncertain'
          : deliveries.some((item) => item.status === 'failed')
            ? 'failed'
            : 'completed';
    }
  }
  receive(input: ReceivedCharacterMail & { authenticated?: boolean }) {
    return this.run(async () => {
      if (this.state.eventIds.includes(input.eventId)) return { accepted: true };
      if (
        !Number.isFinite(input.receivedAt) ||
        typeof input.subject !== 'string' ||
        typeof input.text !== 'string' ||
        !Array.isArray(input.to)
      )
        throw new MailError('Inbound mail is invalid.');
      const recipients = this.characters.filter(
        (item) =>
          item.receiving === 'enabled' &&
          input.to.some((address) => mailAddress(address) === item.address.toLowerCase()),
      );
      if (!recipients.length) return { accepted: false };
      const sender =
        input.authenticated && this.options.lookupUserByEmail
          ? await this.options.lookupUserByEmail(mailAddress(input.from) ?? '')
          : null;
      const known =
        sender?.emailVerified && digest(sender.email) === digest(mailAddress(input.from) ?? '')
          ? sender
          : null;
      for (const character of recipients) {
        if (
          this.state.inbox.some(
            (item) => item.id === input.emailId && item.characterId === character.characterId,
          )
        )
          continue;
        this.state.inbox.push({
          id: input.emailId,
          characterId: character.characterId,
          ...(known ? { senderUserId: known.id } : {}),
          senderName: known?.name.slice(0, 80) ?? 'External sender',
          subject: input.subject.slice(0, 160),
          text: input.text.slice(0, 6000),
          receivedAt: input.receivedAt,
          trust: 'external',
        });
      }
      this.state.inbox = this.state.inbox.slice(-1000);
      this.state.eventIds = [...this.state.eventIds, input.eventId].slice(-10000);
      await this.commit();
      return { accepted: true };
    });
  }
  deliveryEvent(
    eventId: string,
    emailId: string,
    type: 'email.delivered' | 'email.bounced' | 'email.complained',
  ) {
    return this.run(async () => {
      if (this.state.eventIds.includes(eventId)) return { accepted: true };
      const found = this.state.deliveries.filter((item) => item.providerId === emailId);
      for (const delivery of found) {
        if (type === 'email.delivered' && delivery.status !== 'failed') {
          delivery.status = 'delivered';
          delivery.summary = 'Delivery confirmed by the provider.';
        } else if (type !== 'email.delivered') {
          delivery.status = 'failed';
          delivery.summary =
            type === 'email.bounced'
              ? 'Delivery bounced; further mail to this address is suppressed.'
              : 'Recipient reported unwanted mail; further mail to this address is suppressed.';
          if (delivery.emailHash && !this.state.suppressed.includes(delivery.emailHash))
            this.state.suppressed.push(delivery.emailHash);
        }
      }
      this.state.eventIds = [...this.state.eventIds, eventId].slice(-10000);
      this.updateDrafts();
      await this.commit();
      return { accepted: true };
    });
  }
  async getPlanning(characterId: string) {
    const character = this.character(characterId);
    const contacts = [];
    for (const preference of this.committed.preferences
      .filter((item) => item.characterId === characterId && item.correspondence)
      .slice(-16)) {
      const user = await this.options.lookupUser(preference.userId);
      if (this.permitted(characterId, 'correspondence', user))
        contacts.push({ id: user.id, name: user.name.slice(0, 80) });
    }
    const maker = character.makerUserId
      ? await this.options.lookupUser(character.makerUserId)
      : null;
    return {
      available: Boolean(this.options.transport) && !this.halted,
      makerAvailable: Boolean(maker?.emailVerified),
      newsletterPublication: character.publication,
      contacts,
      inbox: this.committed.inbox
        .filter((item) => item.characterId === characterId)
        .slice(-4)
        .map((item) => ({ ...item, text: item.text.slice(0, 1400), trust: 'external' as const })),
      recentDrafts: this.committed.drafts
        .filter((item) => item.characterId === characterId)
        .slice(-4)
        .map(({ id, kind, status, subject }) => ({ id, kind, status, subject })),
    };
  }
  async close() {
    this.closing = true;
    await this.lane;
    await this.store.close();
  }
}
