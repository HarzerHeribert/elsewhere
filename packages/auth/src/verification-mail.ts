import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LocalAuthOptions } from './index';

/** Account verification has separate credentials from creature correspondence. */
function accountSenderFromEnvironment(
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
  purpose: 'verify' | 'signin',
): LocalAuthOptions['sendSignInEmail'] {
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
      target.pathname !==
        (purpose === 'verify' ? '/api/auth/verify-email' : '/api/auth/magic-link/verify') ||
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
        'idempotency-key': `elsewhere-${purpose}-${id}`,
      },
      body: JSON.stringify({
        from: from.data,
        to: [email],
        subject: purpose === 'verify' ? 'Verify your Elsewhere account' : 'Sign in to Elsewhere',
        text:
          purpose === 'verify'
            ? `Confirm your Elsewhere email address by opening this link:\n\n${url}\n\nIf you did not request this account, ignore this message.`
            : `Sign in to Elsewhere by opening this one-use link within 10 minutes:\n\n${url}\n\nIf you did not request this sign-in, ignore this message.`,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Verification delivery failed.');
    }
    await response.body?.cancel();
  };
}

/** Provider-specific delivery stays behind the account mail port. */
export function verificationSenderFromEnvironment(
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): LocalAuthOptions['sendVerificationEmail'] {
  return accountSenderFromEnvironment(environment, fetcher, 'verify');
}
export function signInSenderFromEnvironment(
  environment: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): LocalAuthOptions['sendSignInEmail'] {
  return accountSenderFromEnvironment(environment, fetcher, 'signin');
}
