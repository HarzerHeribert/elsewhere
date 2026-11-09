import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountResponse } from '@elsewhere/character-interfaces';
import { getAccount, requestJson } from './worldApi';

export function useAccountSession() {
  const [session, setSession] = useState<AccountResponse | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [operatorSignInToken, setOperatorSignInToken] = useState('');
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
        value ? { ...value, user: null, managedCharacterIds: [], characterIssues: [] } : value,
      );
      setVerificationEmail('');
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
  const characterIssues = session?.user ? (session.characterIssues ?? []) : [];
  return {
    account: session?.user ?? null,
    capabilities: session,
    characterIssues,
    hasCharacterIssue: characterIssues.some((issue) => issue.resolvedAt === undefined),
    retryCharacterProvider,
    pending,
    error,
    verificationEmail,
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
