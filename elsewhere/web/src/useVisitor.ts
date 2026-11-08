import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Position,
  VisitorAction,
  VisitorRegistration,
  VisitorSessionView,
} from '@elsewhere/character-interfaces';
import { VisitorCommandQueue } from './visitorCommands';
import { ApiError, requestJson } from './worldApi';

type Credential = { visitorId: string; token: string };
const storageKey = 'elsewhere.visitor';
function readCredential(): Credential | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    return typeof value?.visitorId === 'string' && typeof value?.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function useVisitor() {
  const [initialCredential] = useState(readCredential);
  const credential = useRef<Credential | null>(initialCredential);
  const [visitor, setVisitor] = useState<VisitorSessionView | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const mounted = useRef(false);
  const refreshPending = useRef<Promise<VisitorSessionView | null> | null>(null),
    refreshAbort = useRef<AbortController | null>(null);
  const enterPending = useRef<Promise<boolean> | null>(null);
  const queueRef = useRef<VisitorCommandQueue | null>(null);
  const disposalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    credential.current = null;
    queueRef.current?.clear();
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory visits still work without browser storage. */
    }
    if (mounted.current) setVisitor(null);
  }, []);
  const accept = useCallback((view: VisitorSessionView) => {
    if (!mounted.current || credential.current?.visitorId !== view.visitorId) return;
    setVisitor((previous) =>
      previous?.visitorId === view.visitorId && previous.observedAt > view.observedAt
        ? previous
        : view,
    );
  }, []);
  const ended = useCallback(
    (error: unknown, c: Credential) => {
      if (credential.current?.visitorId !== c.visitorId) return true;
      if (error instanceof ApiError && [401, 404, 410].includes(error.status)) {
        clear();
        if (mounted.current) setStatus('Your visit ended. You can enter again.');
        return true;
      }
      return false;
    },
    [clear],
  );
  const refresh = useCallback((): Promise<VisitorSessionView | null> => {
    if (refreshPending.current) return refreshPending.current;
    const c = credential.current;
    if (!c) return Promise.resolve(null);
    const controller = new AbortController();
    refreshAbort.current = controller;
    let pending!: Promise<VisitorSessionView | null>;
    pending = (async () => {
      try {
        const view = await requestJson<VisitorSessionView>(
          `/api/visitors/${encodeURIComponent(c.visitorId)}`,
          {
            headers: { Authorization: `Bearer ${c.token}` },
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (credential.current?.visitorId !== c.visitorId) return null;
        accept(view);
        return view;
      } catch (error) {
        ended(error, c);
        return null;
      } finally {
        if (refreshPending.current === pending) refreshPending.current = null;
      }
    })();
    refreshPending.current = pending;
    return pending;
  }, [accept, ended]);

  const send = useCallback(
    async (command: VisitorAction) => {
      const c = credential.current;
      if (!c) return;
      try {
        const data = await requestJson<VisitorSessionView>(
          `/api/visitors/${encodeURIComponent(c.visitorId)}/action`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(command),
            keepalive: command.type === 'stop',
          },
        );
        if (credential.current?.visitorId !== c.visitorId) return;
        accept(data);
        if (mounted.current)
          setStatus(
            command.type === 'move'
              ? 'Walking through Elsewhere.'
              : command.type === 'stop'
                ? 'You stopped for a moment.'
                : 'Looking around.',
          );
      } catch (error) {
        if (ended(error, c)) return;
        if (mounted.current)
          setStatus(
            error instanceof ApiError
              ? error.message
              : 'The connection is resting. Try moving again shortly.',
          );
        throw error;
      }
    },
    [accept, ended],
  );
  const queue = useMemo(() => new VisitorCommandQueue(send), [send]);
  queueRef.current = queue;

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 200);
    return () => {
      mounted.current = false;
      refreshAbort.current?.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (disposalTimer.current) clearTimeout(disposalTimer.current);
    return () => {
      queue.enqueue({ type: 'stop' });
      // Allow the in-flight command, final stop and brief stop retries to settle.
      disposalTimer.current = setTimeout(() => queue.dispose(), 17000);
    };
  }, [queue]);

  const enter = useCallback((): Promise<boolean> => {
    if (enterPending.current) return enterPending.current;
    setBusy(true);
    setStatus('');
    const pending = (async () => {
      try {
        if (credential.current) {
          const view = await refresh();
          if (view) return true;
          if (credential.current)
            throw new Error('Your visit could not be restored. Please try again shortly.');
        }
        const { token, ...view } = await requestJson<VisitorRegistration>(
          '/api/visitors',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
          8000,
        );
        if (!mounted.current) return false;
        credential.current = { visitorId: view.visitorId, token };
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(credential.current));
        } catch {
          /* Keep the current in-memory visit. */
        }
        accept(view);
        setStatus('You are here. Walk with WASD or the arrow keys.');
        return true;
      } catch (error) {
        if (mounted.current)
          setStatus(error instanceof Error ? error.message : 'Could not enter Elsewhere.');
        return false;
      } finally {
        enterPending.current = null;
        if (mounted.current) setBusy(false);
      }
    })();
    enterPending.current = pending;
    return pending;
  }, [accept, refresh]);

  return {
    visitor,
    busy,
    status,
    enter,
    move: useCallback((position: Position) => queue.enqueue({ type: 'move', position }), [queue]),
    look: useCallback((facing: number) => queue.enqueue({ type: 'look', facing }), [queue]),
    stop: useCallback(() => queue.enqueue({ type: 'stop' }), [queue]),
  };
}
