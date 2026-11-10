import { useState } from 'react';

const kept = new Map<string, unknown>();
/**
 * State that outlives the panel showing it, for this visit: a chosen day, filter or sort order
 * is still there when the visitor comes back from somewhere else.
 */
export function useRemembered<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  return [
    value,
    (next: T) => {
      kept.set(key, next);
      setValue(next);
    },
  ] as const;
}
