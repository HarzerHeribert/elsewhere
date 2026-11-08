import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LocalAuthOptions } from './index';

/** Account verification has separate credentials from creature correspondence. */
export function verificationSenderFromEnvironment(
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): LocalAuthOptions['sendVerificationEmail'] {
  if (!environment.AUTH_EMAIL_API_KEY && !environment.AUTH_EMAIL_FROM) return undefined;
  const from = z.string().email().safeParse(environment.AUTH_EMAIL_FROM);
  if (!from.success || !environment.AUTH_EMAIL_API_KEY?.match(/^re_[a-zA-Z0-9_-]+$/))
    throw new Error(
      'Account verification requires AUTH_EMAIL_FROM and a dedicated Resend AUTH_EMAIL_API_KEY.',
    );
  const origin = new URL(
    environment.BETTER_AUTH_URL ?? environment.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
  ).origin;
  const key = environment.AUTH_EMAIL_API_KEY;
  return async ({ email, url }) => {
    const target = new URL(url);
    if (
      target.origin !== origin ||
      target.username ||
      target.password ||
      target.hash ||
      target.pathname !== '/api/auth/verify-email' ||
      !z.string().email().safeParse(email).success
    )
      throw new Error('Invalid verification delivery request.');
    const id = createHash('sha256').update(`${email}\n${url}`).digest('hex');
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': `elsewhere-verify-${id}`,
      },
      body: JSON.stringify({
        from: from.data,
        to: [email],
        subject: 'Verify your Elsewhere account',
        text: `Confirm your Elsewhere email address by opening this link:\n\n${url}\n\nIf you did not request this account, ignore this message.`,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Verification delivery failed.');
    }
    await response.body?.cancel();
  };
}
