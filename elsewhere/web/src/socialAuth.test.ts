import { afterEach, describe, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ signin: vi.fn(), link: vi.fn() }));
vi.mock('./authClient', () => ({
  authClient: { signIn: { social: actions.signin }, linkSocial: actions.link },
}));
import { socialAuthorizationUrl, socialReturnMessage } from './socialAuth';
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('optional social sign-in browser boundary', () => {
  it('pins callbacks to this site and requests login identity without app integration scopes', async () => {
    vi.stubGlobal('location', { origin: 'https://www.elswhr.dev' });
    actions.signin.mockResolvedValue({
      data: { url: 'https://github.com/login/oauth/authorize?state=fixture', redirect: false },
      error: null,
    });
    const signal = new AbortController().signal;
    expect(await socialAuthorizationUrl('github', 'signin', signal)).toBe(
      'https://github.com/login/oauth/authorize?state=fixture',
    );
    expect(actions.signin).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: 'https://www.elswhr.dev/?auth-callback=1',
      errorCallbackURL: 'https://www.elswhr.dev/?auth-callback=1',
      disableRedirect: true,
      fetchOptions: { signal },
    });
    expect(actions.link).not.toHaveBeenCalled();
  });
  it.each([
    'https://github.com.evil.invalid/',
    'http://github.com/login',
    'https://user:secret@github.com/login',
    'https://github.com/login#token',
    'https://accounts.google.com/o/oauth2/auth',
  ])('refuses unexpected GitHub redirect destinations: %s', async (url) => {
    vi.stubGlobal('location', { origin: 'https://www.elswhr.dev' });
    actions.signin.mockResolvedValue({ data: { url }, error: null });
    await expect(
      socialAuthorizationUrl('github', 'signin', new AbortController().signal),
    ).rejects.toThrow('unexpected sign-in destination');
  });
  it('explains explicit linking and never displays raw provider errors', () => {
    expect(socialReturnMessage('account_not_linked')).toContain(
      'Sign in with your existing method, then link',
    );
    expect(socialReturnMessage('PRIVATE-PROVIDER-CANARY')).not.toContain('CANARY');
    expect(socialReturnMessage(null)).toBe('');
  });
});
