/** Canonical JSON avoids cache misses from object insertion order. No opaque objects/functions. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 40) throw new Error('Model input is too deeply nested.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !item || active.has(item))
      throw new Error('Model input must be finite JSON data.');
    active.add(item);
    try {
      if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new Error('Model input must contain plain objects.');
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter((key) => (item as Record<string, unknown>)[key] !== undefined)
          .map((key) => [key, visit((item as Record<string, unknown>)[key], depth + 1)]),
      );
    } finally {
      active.delete(item);
    }
  };
  const encoded = JSON.stringify(visit(value, 0));
  if (new TextEncoder().encode(encoded).length > 128_000)
    throw new Error('Model input exceeds the routing allowance.');
  return encoded;
}

export async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeJson(entry);
    Object.freeze(value);
  }
  return value;
}
