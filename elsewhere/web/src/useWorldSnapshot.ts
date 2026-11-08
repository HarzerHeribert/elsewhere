import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicSnapshot } from '@elsewhere/character-interfaces';
import { getWorldSnapshot } from './worldApi';

export function useWorldSnapshot() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const active = useRef(false),
    generation = useRef(0),
    pending = useRef<AbortController | null>(null);

  // Polls and explicit refreshes share this acceptance path. A refresh after a mutation
  // supersedes any observation that started before that mutation completed.
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const value = await getWorldSnapshot(controller.signal);
      if (active.current && version === generation.current) {
        setSnapshot(value);
        setConnection('live');
      }
      return value;
    } catch (error) {
      if (active.current && version === generation.current) setConnection('offline');
      throw error;
    } finally {
      if (version === generation.current) pending.current = null;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    const poll = () => {
      if (!pending.current) void refresh().catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active.current = false;
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
      clearInterval(timer);
    };
  }, [refresh]);
  return { snapshot, connection, refresh };
}
