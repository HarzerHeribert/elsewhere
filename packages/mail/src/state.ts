import type {
  CharacterMailDraft,
  CharacterMailDelivery,
  CharacterMailInboxItem,
  MailPreferences,
} from '../../../characters/interfaces/src/mail';

export interface MailRecipient {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
}
export interface CharacterMailConfiguration {
  characterId: string;
  name: string;
  address: string;
  ownerUserId: string;
  makerUserId?: string;
  receiving: 'pending' | 'enabled';
  publication: 'review' | 'automatic';
  dailyLimit: number;
}
export interface MailSendInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey: string;
}
export interface MailTransport {
  send(input: MailSendInput): Promise<{ id: string }>;
}
export interface ReceivedCharacterMail {
  eventId: string;
  emailId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: number;
  inReplyTo?: string;
}
export interface MailState {
  version: 1;
  latestAt: number;
  preferences: Array<MailPreferences & { characterId: string; userId: string; emailHash: string }>;
  drafts: CharacterMailDraft[];
  deliveries: Array<CharacterMailDelivery & { providerId?: string; emailHash?: string }>;
  inbox: CharacterMailInboxItem[];
  allowances: Record<string, { day: string; calls: number }>;
  suppressed: string[];
  eventIds: string[];
}
export const initialMailState = (): MailState => ({
  version: 1,
  latestAt: 0,
  preferences: [],
  drafts: [],
  deliveries: [],
  inbox: [],
  allowances: {},
  suppressed: [],
  eventIds: [],
});
