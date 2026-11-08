/** Small process-local optimization, never authoritative state or a permission store. */
export class ExactModelCache {
  private readonly entries = new Map<string, { value: string; expires: number; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 128,
    private readonly maxBytes = 1_000_000,
  ) {}
  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.remove(key);
    if (entry.expires <= this.now()) return;
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    return JSON.parse(entry.value);
  }
  delete(key: string) {
    this.remove(key);
  }
  set(key: string, value: unknown, ttlMs: number) {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value);
    } catch {
      return;
    }
    if (typeof encoded !== 'string') return;
    const bytes = new TextEncoder().encode(encoded).length;
    if (bytes > 64_000 || bytes > this.maxBytes || !Number.isFinite(ttlMs) || ttlMs <= 0) return;
    this.remove(key);
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.remove(id);
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)
      this.remove(this.entries.keys().next().value!);
    this.entries.set(key, {
      value: encoded,
      expires: this.now() + Math.min(ttlMs, 3_600_000),
      bytes,
    });
    this.bytes += bytes;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}
