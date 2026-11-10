import type { MailPreferences } from '../../../characters/interfaces/src/mail';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountResponse } from '@elsewhere/character-interfaces';
import { getAccount, requestJson } from './worldApi';
import {
  socialAuthorizationUrl,
  socialReturnMessage,
  type SocialSignInProvider,
} from './socialAuth';
import {
  addAccountPasskey,
  browserSupportsPasskeys,
  listAccountPasskeys,
  removeAccountPasskey,
  signInWithPasskey,
  type AccountPasskey,
} from './passkeyAuth';

export function useAccountSession() {
  const [session, setSession] = useState<AccountResponse | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [signInLinkEmail, setSignInLinkEmail] = useState('');
  const [operatorSignInToken, setOperatorSignInToken] = useState('');
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeyListError, setPasskeyListError] = useState('');
  const [passkeyStatus, setPasskeyStatus] = useState('');
  const [passkeyRevision, setPasskeyRevision] = useState(0);
  const [returnedFromSocial, setReturnedFromSocial] = useState(false);
  const [socialAuthReturnMessage, setSocialAuthReturnMessage] = useState('');
  const active = useRef(false),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    mutating = useRef(false);
  const begin = useCallback(() => {
    const version = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return { version, controller };
  }, []);
  const current = useCallback(
    (version: number) => active.current && generation.current === version,
    [],
  );
  const refresh = useCallback(async () => {
    if (mutating.current) return;
    const { version, controller } = begin();
    try {
      const value = await getAccount(controller.signal);
      if (current(version)) {
        setSession(value);
        setError('');
      }
    } catch (reason) {
      if (current(version))
        setError(reason instanceof Error ? reason.message : 'Account service unavailable.');
    }
  }, [begin, current]);

  useEffect(() => {
    active.current = true;
    const socialReturn = new URLSearchParams(location.search);
    if (socialReturn.get('auth-callback') === '1') {
      setReturnedFromSocial(true);
      setSocialAuthReturnMessage(socialReturnMessage(socialReturn.get('error')));
      for (const key of ['auth-callback', 'error', 'error_description']) socialReturn.delete(key);
      history.replaceState(
        null,
        '',
        location.pathname +
          (socialReturn.size ? '?' + socialReturn.toString() : '') +
          location.hash,
      );
    }
    const readPrivateLink = () => {
      const fragment = new URLSearchParams(location.hash.slice(1));
      const token = fragment.get('sign-in');
      if (token !== null) {
        history.replaceState(null, '', location.pathname + location.search);
        if (fragment.size === 1 && /^[a-zA-Z0-9_-]{32}$/.test(token)) setOperatorSignInToken(token);
      }
    };
    readPrivateLink();
    window.addEventListener('hashchange', readPrivateLink);
    void refresh();
    const check = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 60000);
    return () => {
      active.current = false;
      ++generation.current;
      request.current?.abort();
      window.removeEventListener('hashchange', readPrivateLink);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => setPasskeysSupported(browserSupportsPasskeys()), []);
  useEffect(() => setPasskeyStatus(''), [session?.user?.id]);
  useEffect(() => {
    const userId = session?.user?.id;
    const controller = new AbortController();
    let listening = true;
    setPasskeys([]);
    setPasskeyListError('');
    if (!userId || !session.passkeyAuthEnabled) {
      setPasskeysLoading(false);
      return;
    }
    setPasskeysLoading(true);
    void listAccountPasskeys(userId, controller.signal)
      .then((value) => {
        if (listening) setPasskeys(value);
      })
      .catch((reason) => {
        if (listening)
          setPasskeyListError(
            reason instanceof Error ? reason.message : 'Your passkeys could not be loaded.',
          );
      })
      .finally(() => {
        if (listening) setPasskeysLoading(false);
      });
    return () => {
      listening = false;
      controller.abort();
    };
  }, [session?.user?.id, session?.passkeyAuthEnabled, passkeyRevision]);

  const performPasskey = useCallback(
    async (action: 'signin' | 'verify' | 'add' | 'remove', value = '') => {
      if (mutating.current || !session?.passkeyAuthEnabled) return false;
      if (action !== 'remove' && !browserSupportsPasskeys()) {
        setError('Passkeys are not available in this browser. Use another sign-in method.');
        return false;
      }
      const expectedUser = session.user?.id;
      if (action !== 'signin' && !expectedUser) return false;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      setPasskeyStatus('');
      try {
        if (action === 'add')
          await addAccountPasskey(value.trim().slice(0, 60) || 'My passkey', controller.signal);
        else if (action === 'remove') await removeAccountPasskey(value, controller.signal);
        else await signInWithPasskey(controller.signal);
        const confirmed = await getAccount(controller.signal);
        if (!current(version)) return false;
        setSession(confirmed);
        if (!confirmed.user)
          throw new Error('Your session could not be confirmed. Please sign in again.');
        if (action !== 'signin' && confirmed.user.id !== expectedUser)
          throw new Error(
            'That passkey did not verify the account you were managing. Please sign in to the intended account.',
          );
        if (
          (action === 'verify' || action === 'signin') &&
          confirmed.passkeyVerifiedRecently !== true
        )
          throw new Error('Your passkey verification could not be confirmed. Please try again.');
        setVerificationEmail('');
        setSocialAuthReturnMessage('');
        setSignInLinkEmail('');
        setPasskeyRevision((revision) => revision + 1);
        setPasskeyStatus(
          action === 'add'
            ? 'Passkey added.'
            : action === 'remove'
              ? 'Passkey removed.'
              : action === 'verify'
                ? 'Passkey verified.'
                : '',
        );
        return true;
      } catch (reason) {
        if (current(version))
          setError(
            reason instanceof Error
              ? reason.message
              : 'The passkey request could not be completed.',
          );
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current, session?.passkeyAuthEnabled, session?.user?.id],
  );

  const setOwnerPasskeyRequired = useCallback(
    async (required: boolean) => {
      if (mutating.current || !session?.user || !session.passkeyAuthEnabled) return false;
      const expectedUser = session.user.id;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      setPasskeyStatus('');
      try {
        await requestJson('/api/auth/security/owner-passkey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ required }),
          signal: controller.signal,
        });
        const confirmed = await getAccount(controller.signal);
        if (!current(version)) return false;
        setSession(confirmed);
        if (
          confirmed.user?.id !== expectedUser ||
          confirmed.ownerControlsRequirePasskey !== required
        )
          throw new Error(
            'The account security change could not be confirmed. Refresh your account and try again.',
          );
        setPasskeyStatus(
          required
            ? 'Owner controls now require a verified passkey.'
            : 'Passkey requirement for owner controls removed.',
        );
        return true;
      } catch (reason) {
        if (current(version))
          setError(
            reason instanceof Error
              ? reason.message
              : 'The account security change could not be saved.',
          );
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current, session?.passkeyAuthEnabled, session?.user?.id],
  );

  const beginSocial = useCallback(
    async (provider: SocialSignInProvider, mode: 'signin' | 'link') => {
      if (mutating.current || !session?.socialProviders?.includes(provider)) return false;
      if (mode === 'link' && !session.user) return false;
      if (
        mode === 'link' &&
        session.ownerControlsRequirePasskey === true &&
        session.ownerControlsUnlocked !== true
      ) {
        setError('Verify a passkey before linking another sign-in account.');
        return false;
      }
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      setSocialAuthReturnMessage('');
      try {
        const target = await socialAuthorizationUrl(provider, mode, controller.signal);
        if (!current(version)) return false;
        location.assign(target);
        return true;
      } catch (reason) {
        if (current(version))
          setError(
            reason instanceof Error ? reason.message : 'The provider sign-in could not be started.',
          );
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [
      begin,
      current,
      session?.socialProviders,
      session?.user?.id,
      session?.ownerControlsRequirePasskey,
      session?.ownerControlsUnlocked,
    ],
  );

  const signInWithOperatorLink = useCallback(async () => {
    if (mutating.current || !operatorSignInToken) return false;
    mutating.current = true;
    const { version, controller } = begin();
    setPending(true);
    setError('');
    try {
      await requestJson('/api/auth/one-time-token/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: operatorSignInToken }),
        signal: controller.signal,
      });
      const value = await getAccount(controller.signal);
      if (!value.user)
        throw new Error('Your session could not be confirmed. Request a new private sign-in link.');
      if (!current(version)) return false;
      setSession(value);
      return true;
    } catch (reason) {
      if (current(version))
        setError(
          reason instanceof Error ? reason.message : 'Private sign-in failed. Request a new link.',
        );
      return false;
    } finally {
      mutating.current = false;
      setOperatorSignInToken('');
      if (current(version)) setPending(false);
    }
  }, [begin, current, operatorSignInToken]);

  const authenticate = useCallback(
    async (
      mode: 'signin' | 'signup',
      details: { email: string; password: string; name?: string },
    ) => {
      if (mutating.current) return false;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      setVerificationEmail('');
      setSocialAuthReturnMessage('');
      try {
        await requestJson(
          '/api/auth/' + (mode === 'signup' ? 'sign-up/email' : 'sign-in/email'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(details),
            signal: controller.signal,
          },
          10000,
        );
        const value = await getAccount(controller.signal);
        if (!current(version)) return false;
        setSession(value);
        if (!value.user && mode === 'signup' && value.requiresEmailVerification) {
          setVerificationEmail(details.email);
          return true;
        }
        if (!value.user)
          throw new Error('Your session could not be confirmed. Please sign in again.');
        return true;
      } catch (reason) {
        if (current(version))
          setError(reason instanceof Error ? reason.message : 'Account service unavailable.');
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current],
  );

  const signOut = useCallback(async () => {
    if (mutating.current) return false;
    mutating.current = true;
    const { version, controller } = begin();
    setPending(true);
    setError('');
    try {
      await requestJson('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      if (!current(version)) return false;
      setSession((value) =>
        value
          ? {
              user: null,
              enabled: value.enabled,
              passwordAuthEnabled: value.passwordAuthEnabled,
              requiresEmailVerification: value.requiresEmailVerification,
              ...(value.emailLinkAuthEnabled ? { emailLinkAuthEnabled: true } : {}),
              ...(value.passkeyAuthEnabled ? { passkeyAuthEnabled: true } : {}),
              ...(value.socialProviders ? { socialProviders: value.socialProviders } : {}),
              managedCharacterIds: [],
              characterIssues: [],
              characterMail: [],
            }
          : value,
      );
      setVerificationEmail('');
      setSignInLinkEmail('');
      setPasskeyStatus('');
      setSocialAuthReturnMessage('');
      return true;
    } catch (reason) {
      if (current(version))
        setError(reason instanceof Error ? reason.message : 'Could not sign out.');
      return false;
    } finally {
      mutating.current = false;
      if (current(version)) setPending(false);
    }
  }, [begin, current]);
  const sendSignInLink = useCallback(
    async (email: string) => {
      if (mutating.current) return false;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      setSocialAuthReturnMessage('');
      try {
        await requestJson('/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, callbackURL: location.origin }),
          signal: controller.signal,
        });
        if (!current(version)) return false;
        setSignInLinkEmail(email);
        return true;
      } catch (reason) {
        if (current(version))
          setError(reason instanceof Error ? reason.message : 'Could not request a sign-in link.');
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current],
  );
  const retryCharacterProvider = useCallback(
    async (characterId: string) => {
      if (mutating.current) return false;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      try {
        await requestJson(`/api/characters/${encodeURIComponent(characterId)}/provider/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        });
        const value = await getAccount(controller.signal);
        if (!current(version)) return false;
        setSession(value);
        return true;
      } catch (reason) {
        if (current(version))
          setError(reason instanceof Error ? reason.message : 'Provider retry failed.');
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current],
  );
  const updateMailPreferences = useCallback(
    async (characterId: string, preferences: MailPreferences) => {
      if (mutating.current) return false;
      mutating.current = true;
      const { version, controller } = begin();
      setPending(true);
      setError('');
      try {
        await requestJson(`/api/characters/${encodeURIComponent(characterId)}/mail/preferences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preferences),
          signal: controller.signal,
        });
        const value = await getAccount(controller.signal);
        if (!current(version)) return false;
        setSession(value);
        return true;
      } catch (reason) {
        if (current(version))
          setError(
            reason instanceof Error ? reason.message : 'Email preferences could not be saved.',
          );
        return false;
      } finally {
        mutating.current = false;
        if (current(version)) setPending(false);
      }
    },
    [begin, current],
  );
  const characterIssues = session?.user ? (session.characterIssues ?? []) : [];
  return {
    account: session?.user ?? null,
    capabilities: session,
    characterIssues,
    characterMail: session?.user ? (session.characterMail ?? []) : [],
    characterMailUnavailable: Boolean(session?.user && session.characterMailUnavailable),
    updateMailPreferences,
    hasCharacterIssue: characterIssues.some(
      (issue) => issue.resolvedAt === undefined && !issue.retrying,
    ),
    retryCharacterProvider,
    returnedFromSocial,
    socialAuthReturnMessage,
    dismissSocialReturn: () => {
      setReturnedFromSocial(false);
      setSocialAuthReturnMessage('');
    },
    beginSocialSignIn: (provider: SocialSignInProvider) => beginSocial(provider, 'signin'),
    linkSocialSignIn: (provider: SocialSignInProvider) => beginSocial(provider, 'link'),
    passkeysSupported,
    passkeys,
    passkeysLoading,
    passkeyListError,
    passkeyStatus,
    refreshPasskeys: () => setPasskeyRevision((revision) => revision + 1),
    signInWithPasskey: () => performPasskey('signin'),
    verifyPasskey: () => performPasskey('verify'),
    addPasskey: (name: string) => performPasskey('add', name),
    removePasskey: (id: string) => performPasskey('remove', id),
    setOwnerPasskeyRequired,
    pending,
    error,
    verificationEmail,
    signInLinkEmail,
    sendSignInLink,
    dismissSignInLink: () => {
      setSignInLinkEmail('');
      setError('');
    },
    refresh,
    authenticate,
    signOut,
    operatorSignInToken,
    signInWithOperatorLink,
    dismissOperatorSignIn: () => setOperatorSignInToken(''),
    dismissVerification: () => {
      setVerificationEmail('');
      setError('');
    },
  };
}
