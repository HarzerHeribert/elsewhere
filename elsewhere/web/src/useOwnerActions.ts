import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, requestJson } from './worldApi';

function initialOwner() {
  const token = new URLSearchParams(location.hash.slice(1)).get('owner');
  if (!import.meta.env.DEV) {
    if (token) history.replaceState(null, '', location.pathname + location.search);
    try {
      sessionStorage.removeItem('elsewhere.owner');
    } catch {
      /* No local credential to restore. */
    }
    return '';
  }
  if (token) {
    try {
      sessionStorage.setItem('elsewhere.owner', token);
    } catch {
      /* Keep this visit's credential in memory. */
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
  try {
    return token ?? sessionStorage.getItem('elsewhere.owner') ?? '';
  } catch {
    return token ?? '';
  }
}

export function useOwnerActions(
  refreshWorld: () => Promise<unknown>,
  refreshAccount: () => Promise<unknown>,
) {
  const [owner, setOwner] = useState(initialOwner),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const inFlight = useRef(false);
  const active = useRef(false),
    request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const saveOwner = useCallback((value: string) => {
    const token = import.meta.env.DEV ? value.trim() : '';
    setOwner(token);
    try {
      if (token) sessionStorage.setItem('elsewhere.owner', token);
      else sessionStorage.removeItem('elsewhere.owner');
    } catch {
      /* In-memory owner controls remain usable for this visit. */
    }
    setStatus(token ? 'Owner credential saved for this tab.' : 'Owner controls disconnected.');
  }, []);
  async function run(path: string, body: object, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatus('');
    const controller = new AbortController();
    request.current = controller;
    try {
      await requestJson(
        '/api/admin/' + path,
        {
          method: 'POST',
          headers: {
            ...(owner ? { Authorization: 'Bearer ' + owner } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        30000,
      );
      if (!active.current) return;
      setStatus(success);
      try {
        await refreshWorld();
      } catch {
        setStatus(success + ' Reconnecting to the world.');
      }
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) void refreshAccount();
      setStatus(error instanceof Error ? error.message : 'Owner action failed.');
    } finally {
      inFlight.current = false;
      request.current = null;
      if (active.current) setBusy(false);
    }
  }
  return {
    owner,
    busy,
    status,
    setStatus,
    saveOwner,
    ownerAction: (action: 'tick' | 'pause' | 'resume') =>
      run(
        action,
        {},
        action === 'tick'
          ? 'Advanced one decision.'
          : action === 'pause'
            ? 'Hubert is paused.'
            : 'Hubert is running.',
      ),
    decideWish: (id: string, decision: 'fulfill' | 'decline') =>
      run(
        'wishes/' + encodeURIComponent(id),
        { decision },
        decision === 'fulfill' ? 'The wish is marked as built.' : 'The wish was declined for now.',
      ),
  };
}
