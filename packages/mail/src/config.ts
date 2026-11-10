import { z } from 'zod';
import { MailTransportError, ResendMailTransport } from './resend';

export interface MailCharacterConfiguration {
  characterId: string;
  name: string;
  address: string;
  ownerUserId: string;
  makerUserId?: string;
  receiving: 'pending' | 'enabled';
  publication: 'review' | 'automatic';
  dailyLimit: number;
}
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const settings = z.object({
  CHARACTER_MAIL_API_KEY: z.string().regex(/^re_[a-zA-Z0-9_-]{8,512}$/),
  CHARACTER_MAIL_RECEIVE_API_KEY: z
    .string()
    .regex(/^re_[a-zA-Z0-9_-]{8,512}$/)
    .optional(),
  CHARACTER_MAIL_FROM_DOMAIN: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/)
    .max(253)
    .default('elswhr.dev'),
  HUBERT_OWNER_USER_ID: identifier,
  CHARACTER_MAIL_MAKER_USER_ID: identifier.optional(),
  CHARACTER_MAIL_RECEIVING: z.enum(['pending', 'enabled']).default('pending'),
  CHARACTER_MAIL_PUBLICATION: z.enum(['review', 'automatic']).default('review'),
  CHARACTER_MAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  CHARACTER_MAIL_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[a-zA-Z0-9+/=]{20,512}$/)
    .optional(),
  CHARACTER_MAIL_UNSUBSCRIBE_SECRET: z.string().min(32).max(512),
  WEB_ORIGIN: z.string().url(),
});
/** No AUTH_EMAIL_* fallback: account delivery and character correspondence are separate grants. */
export function characterMailFromEnvironment(
  environment: NodeJS.ProcessEnv,
  options: { fetcher?: typeof fetch } = {},
) {
  if (!environment.CHARACTER_MAIL_API_KEY) return undefined;
  const parsed = settings.safeParse(environment);
  if (
    !parsed.success ||
    environment.CHARACTER_MAIL_API_KEY === environment.AUTH_EMAIL_API_KEY ||
    (environment.CHARACTER_MAIL_RECEIVE_API_KEY &&
      environment.CHARACTER_MAIL_RECEIVE_API_KEY === environment.AUTH_EMAIL_API_KEY)
  )
    throw new MailTransportError('configuration');
  const config = parsed.data;
  const origin = new URL(config.WEB_ORIGIN);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) ||
    (environment.NODE_ENV === 'production' && origin.protocol !== 'https:') ||
    (config.CHARACTER_MAIL_RECEIVING === 'enabled' &&
      (!config.CHARACTER_MAIL_WEBHOOK_SECRET || !config.CHARACTER_MAIL_RECEIVE_API_KEY))
  )
    throw new MailTransportError('configuration');
  const characters: MailCharacterConfiguration[] = [
    {
      characterId: 'hubert',
      name: 'Hubert',
      address: 'hubert@' + config.CHARACTER_MAIL_FROM_DOMAIN,
      ownerUserId: config.HUBERT_OWNER_USER_ID,
      ...(config.CHARACTER_MAIL_MAKER_USER_ID
        ? { makerUserId: config.CHARACTER_MAIL_MAKER_USER_ID }
        : {}),
      receiving: config.CHARACTER_MAIL_RECEIVING,
      publication: config.CHARACTER_MAIL_PUBLICATION,
      dailyLimit: config.CHARACTER_MAIL_DAILY_LIMIT,
    },
  ];
  return {
    transport: new ResendMailTransport(config.CHARACTER_MAIL_API_KEY, {
      ...options,
      receiveApiKey: config.CHARACTER_MAIL_RECEIVE_API_KEY,
    }),
    characters,
    webhookSecret: config.CHARACTER_MAIL_WEBHOOK_SECRET,
    unsubscribeSecret: config.CHARACTER_MAIL_UNSUBSCRIBE_SECRET,
    publicOrigin: origin.origin,
  };
}
