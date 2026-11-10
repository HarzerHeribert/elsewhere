import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export interface MailSendInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey: string;
}
export interface ReceivedMail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: number;
  inReplyTo?: string;
  /** Server-computed provider authentication, never a claim from message headers. */
  authenticated: boolean;
}
export interface MailTransport {
  send(input: MailSendInput): Promise<{ id: string }>;
  retrieveReceived?(id: string): Promise<ReceivedMail>;
}
export class MailTransportError extends Error {
  constructor(readonly code: 'configuration' | 'input' | 'unavailable' | 'response' | 'signature') {
    super(`Character mail transport: ${code}.`);
  }
}
const email = z.string().email().max(254);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const sendSchema = z
  .object({
    from: z
      .string()
      .min(3)
      .max(320)
      .refine((value) => {
        const match = /^(?:[^<>\r\n]{1,60} <)?([^<>\r\n]+)>?$/.exec(value);
        return !!match && email.safeParse(match[1]).success;
      }),
    to: email,
    subject: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[^\r\n\x00]+$/),
    text: z.string().min(1).max(12000),
    replyTo: email.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[a-zA-Z0-9:_-]+$/),
  })
  .strict();

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new MailTransportError('unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MailTransportError('response');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 262144) throw new MailTransportError('response');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof MailTransportError) throw error;
    throw new MailTransportError('response');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Private host transport. No model or browser receives this key or chooses the API origin. */
export class ResendMailTransport implements MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly options: { fetcher?: typeof fetch; receiveApiKey?: string } = {},
  ) {
    if (
      !/^re_[a-zA-Z0-9_-]{8,512}$/.test(apiKey) ||
      (options.receiveApiKey !== undefined &&
        !/^re_[a-zA-Z0-9_-]{8,512}$/.test(options.receiveApiKey))
    )
      throw new MailTransportError('configuration');
  }
  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    idempotencyKey?: string,
  ) {
    try {
      return await boundedJson(
        await (this.options.fetcher ?? fetch)('https://api.resend.com' + path, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            authorization:
              'Bearer ' +
              (method === 'GET' ? (this.options.receiveApiKey ?? this.apiKey) : this.apiKey),
            'content-type': 'application/json',
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    } catch (error) {
      if (error instanceof MailTransportError) throw error;
      throw new MailTransportError('unavailable');
    }
  }
  async send(input: MailSendInput): Promise<{ id: string }> {
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) throw new MailTransportError('input');
    const value = parsed.data;
    const headers: Record<string, string> = {};
    for (const [name, content] of Object.entries(value.headers ?? {})) {
      // These are host-controlled compliance/threading headers, never arbitrary credential headers.
      if (
        !['List-Unsubscribe', 'List-Unsubscribe-Post', 'In-Reply-To', 'References'].includes(
          name,
        ) ||
        /[\r\n\x00]/.test(content) ||
        content.length > 2048
      )
        throw new MailTransportError('input');
      headers[name] = content;
    }
    const response = z.object({ id }).safeParse(
      await this.request(
        '/emails',
        'POST',
        {
          from: value.from,
          to: [value.to],
          subject: value.subject,
          text: value.text,
          ...(value.replyTo ? { reply_to: value.replyTo } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
        },
        value.idempotencyKey,
      ),
    );
    if (!response.success) throw new MailTransportError('response');
    return { id: response.data.id };
  }
  async retrieveReceived(emailId: string): Promise<ReceivedMail> {
    if (!id.safeParse(emailId).success) throw new MailTransportError('input');
    const parsed = z
      .object({
        id,
        from: z.string().max(320),
        to: z.array(z.string().max(320)).max(20),
        subject: z.string().max(1000),
        text: z.string().max(200000).nullable().optional(),
        created_at: z.string().datetime({ offset: true }),
        headers: z.record(z.string(), z.string()).optional(),
        authentication: z
          .object({ spf: z.string(), dkim: z.string(), dmarc: z.string() })
          .nullable()
          .optional(),
      })
      .safeParse(await this.request('/emails/receiving/' + emailId, 'GET'));
    if (!parsed.success || parsed.data.id !== emailId) throw new MailTransportError('response');
    const data = parsed.data;
    const fromAddress = /<([^<>]+)>$/.exec(data.from)?.[1] ?? data.from;
    if (!email.safeParse(fromAddress).success) throw new MailTransportError('response');
    const recipients = data.to.map((value) => /<([^<>]+)>$/.exec(value)?.[1] ?? value);
    if (recipients.some((value) => !email.safeParse(value).success))
      throw new MailTransportError('response');
    const inReplyTo = Object.entries(data.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'in-reply-to',
    )?.[1];
    return {
      id: data.id,
      from: fromAddress.toLowerCase(),
      to: recipients.map((value) => value.toLowerCase()),
      subject: data.subject.replace(/[\r\n\x00]/g, ' ').slice(0, 160),
      // HTML/attachments are never executed or rendered; HTML-only mail is explicitly identified.
      text: (data.text ?? '[This email has no plain-text body.]').slice(0, 6000),
      receivedAt: Date.parse(data.created_at),
      ...(inReplyTo ? { inReplyTo: inReplyTo.slice(0, 512) } : {}),
      authenticated:
        data.authentication?.dmarc === 'pass' &&
        (data.authentication.dkim === 'pass' || data.authentication.spf === 'pass'),
    };
  }
}

export interface VerifiedMailEvent {
  eventId: string;
  type: 'email.received' | 'email.delivered' | 'email.bounced' | 'email.complained';
  emailId: string;
  createdAt: number;
  from?: string;
  to?: string[];
  subject?: string;
}
export interface WebhookHeaders {
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
}
/** Verify the exact raw bytes before parsing. Replayed event IDs are deduplicated durably by the service. */
export function verifyResendWebhook(
  raw: string,
  headers: WebhookHeaders,
  secret: string,
  now = Date.now(),
): VerifiedMailEvent {
  const fail = (): never => {
    throw new MailTransportError('signature');
  };
  if (Buffer.byteLength(raw) > 65536 || !/^whsec_[a-zA-Z0-9+/=]{20,512}$/.test(secret))
    return fail();
  const messageId = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (
    !messageId ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId) ||
    !timestamp ||
    !/^\d{10,12}$/.test(timestamp) ||
    !signatures ||
    signatures.length > 4096
  )
    return fail();
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > 300) return fail();
  const key = Buffer.from(secret.slice(6), 'base64');
  if (key.length < 16) return fail();
  const expected = createHmac('sha256', key).update(`${messageId}.${timestamp}.${raw}`).digest();
  const valid = signatures.split(' ').some((signature) => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
    const actual = Buffer.from(signature.slice(3), 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!valid) return fail();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail();
  }
  const parsed = z
    .object({
      type: z.enum(['email.received', 'email.delivered', 'email.bounced', 'email.complained']),
      created_at: z.string().datetime({ offset: true }),
      data: z.object({
        email_id: id,
        from: z.string().max(320).optional(),
        to: z.array(z.string().max(320)).max(20).optional(),
        subject: z.string().max(1000).optional(),
      }),
    })
    .safeParse(value);
  if (!parsed.success) throw new MailTransportError('response');
  return {
    eventId: messageId,
    type: parsed.data.type,
    emailId: parsed.data.data.email_id,
    createdAt: Date.parse(parsed.data.created_at),
    ...(parsed.data.data.from ? { from: parsed.data.data.from } : {}),
    ...(parsed.data.data.to ? { to: parsed.data.data.to } : {}),
    ...(parsed.data.data.subject ? { subject: parsed.data.data.subject.slice(0, 160) } : {}),
  };
}
