import { z } from 'zod';

export const MailPreferencesSchema = z
  .object({ newsletter: z.boolean(), correspondence: z.boolean() })
  .strict();
export type MailPreferences = z.infer<typeof MailPreferencesSchema>;
export const MailComposeSchema = z
  .object({
    kind: z.enum(['maker', 'correspondence', 'newsletter']),
    recipientUserId: z.string().min(1).max(128).optional(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((value) => !/[\r\n\x00-\x1f\x7f]/.test(value)),
    text: z
      .string()
      .trim()
      .min(1)
      .max(6000)
      .refine((value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.kind === 'correspondence') !== (input.recipientUserId !== undefined))
      context.addIssue({
        code: 'custom',
        message: 'Only correspondence selects a recipient user.',
      });
  });
export type MailComposeInput = z.infer<typeof MailComposeSchema>;
export interface PublicCharacterMail {
  characterId: string;
  name: string;
  address: string;
  receiving: 'pending' | 'enabled';
  sendingAvailable: boolean;
}
export interface CharacterMailDraft {
  id: string;
  characterId: string;
  kind: MailComposeInput['kind'];
  subject: string;
  text: string;
  recipientUserId?: string;
  source: 'character' | 'owner';
  createdAt: number;
  status: 'awaiting_approval' | 'queued' | 'completed' | 'failed' | 'uncertain';
}
export interface CharacterMailDelivery {
  id: string;
  draftId: string;
  characterId: string;
  recipientUserId: string;
  at: number;
  status: 'queued' | 'sending' | 'accepted' | 'delivered' | 'failed' | 'uncertain' | 'cancelled';
  summary: string;
}
export interface CharacterMailInboxItem {
  id: string;
  characterId: string;
  senderUserId?: string;
  senderName: string;
  subject: string;
  text: string;
  receivedAt: number;
  /** Inbound mail remains external data, never authenticated owner instructions. */
  trust: 'external';
}
export interface AccountCharacterMail extends PublicCharacterMail {
  preferences: MailPreferences;
  canSubscribe: boolean;
  owner?: {
    publication: 'review' | 'automatic';
    makerAvailable?: boolean;
    contacts?: Array<{ id: string; name: string }>;
    drafts: CharacterMailDraft[];
    inbox: CharacterMailInboxItem[];
    deliveries: CharacterMailDelivery[];
    subscriberCount: number;
  };
}
