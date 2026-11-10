import { authClient } from './authClient';

export type SocialSignInProvider = 'github' | 'google';
export const providerName = (provider: SocialSignInProvider) =>
  provider === 'github' ? 'GitHub' : 'Google';
const providerOrigins = {
  github: 'https://github.com',
  google: 'https://accounts.google.com',
} as const;

export function socialReturnMessage(code: string | null) {
  switch (code?.toLowerCase()) {
    case 'account_not_linked':
    case 'oauth_account_not_linked':
    case 'user_already_exists':
      return 'Sign in with your existing method, then link this provider from your account. Accounts are not joined just because their email addresses match.';
    case 'unable_to_link_account':
      return 'This sign-in account could not be linked. Sign in with your existing method and try linking it from your account.';
    case 'email_not_verified':
      return 'The provider did not confirm your email address. Use an existing sign-in method or verify your email with the provider.';
    case 'access_denied':
      return 'The provider sign-in was cancelled. You can try again or use another method.';
    default:
      return code
        ? 'The provider sign-in could not be completed. Try again or use an existing method.'
        : '';
  }
}

/** Ask Better Auth to begin OAuth, then navigate only to the selected provider's HTTPS origin. */
export async function socialAuthorizationUrl(
  provider: SocialSignInProvider,
  mode: 'signin' | 'link',
  signal: AbortSignal,
) {
  const callbackURL = location.origin + '/?auth-callback=1';
  const details = {
    provider,
    callbackURL,
    errorCallbackURL: callbackURL,
    disableRedirect: true,
    fetchOptions: { signal },
  };
  let result;
  try {
    result =
      mode === 'link'
        ? await authClient.linkSocial(details)
        : await authClient.signIn.social(details);
  } catch {
    throw new Error('The provider could not be reached. Please try again.');
  }
  if (result.error) {
    const code = (result.error as { code?: string }).code;
    throw new Error(socialReturnMessage(code ?? 'unknown'));
  }
  let target: URL;
  try {
    target = new URL(result.data?.url ?? '');
  } catch {
    throw new Error('The provider sign-in could not be started. Please try again.');
  }
  if (
    target.origin !== providerOrigins[provider] ||
    target.username ||
    target.password ||
    target.hash
  )
    throw new Error('The provider returned an unexpected sign-in destination.');
  return target.href;
}
