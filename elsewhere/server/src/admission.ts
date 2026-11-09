/** Bounded process-local quotas. New public identities never evict an existing bucket. */
export class WindowQuota {
  private readonly entries = new Map<string, { count: number; until: number }>();
  private latest = -Infinity;
  constructor(
    private readonly capacity: number,
    private readonly windowMs = 60_000,
  ) {}

  consume(key: string, maximum: number, now: number): { allowed: boolean; retryAfter: number } {
    now = this.latest = Math.max(this.latest, now);
    // Insertion order is expiry order. Each expired entry is visited once rather than
    // scanning thousands of live entries for every rejected new identity.
    for (const [id, value] of this.entries) {
      if (value.until > now) break;
      this.entries.delete(id);
    }
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.capacity) return { allowed: false, retryAfter: 60 };
      entry = { count: 0, until: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count = Math.min(maximum + 1, entry.count + 1);
    return {
      allowed: entry.count <= maximum,
      retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)),
    };
  }
  get size() {
    return this.entries.size;
  }
}

/** Reject overload at admission; do not append another promise to an unbounded queue. */
export class AdmissionPool {
  private active = 0;
  private readonly clients = new Map<string, number>();
  constructor(
    private readonly maximum: number,
    private readonly perClient: number,
  ) {}

  enter(client: string): (() => void) | null {
    const count = this.clients.get(client) ?? 0;
    if (this.active >= this.maximum || count >= this.perClient) return null;
    this.active++;
    this.clients.set(client, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const remaining = this.clients.get(client)! - 1;
      if (remaining) this.clients.set(client, remaining);
      else this.clients.delete(client);
    };
  }
}

export interface ApiTrafficLimits {
  worldReadsPerMinute: number;
  accountReadsPerMinute: number;
  artifactReadsPerMinute: number;
  publicPayloadBytesPerMinute: number;
}

export const DEFAULT_API_TRAFFIC_LIMITS: Readonly<ApiTrafficLimits> = {
  worldReadsPerMinute: 1200,
  accountReadsPerMinute: 300,
  artifactReadsPerMinute: 120,
  publicPayloadBytesPerMinute: 16 * 1024 * 1024,
};

/** Reserve response room before starting public work, then charge the actual accepted payload.
 * HTTP/TLS overhead, rejected responses and provider-originated traffic are outside this meter.
 */
export class ResponseBudget {
  private window = -Infinity;
  private used = 0;
  private reserved = 0;
  constructor(
    private readonly maximum: number,
    private readonly responseMaximum = 256 * 1024,
  ) {}

  private advance(now: number) {
    const next = Math.floor(now / 60_000);
    if (next > this.window) {
      this.window = next;
      this.used = 0;
      this.reserved = 0;
    }
  }
  reserve(now: number): { commit(bytes: number, at: number): boolean; release(): void } | null {
    this.advance(now);
    const amount = Math.min(this.maximum, this.responseMaximum);
    if (this.used + this.reserved + amount > this.maximum) return null;
    const window = this.window;
    this.reserved += amount;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (window === this.window) this.reserved -= amount;
    };
    return {
      release,
      commit: (bytes, at) => {
        this.advance(at);
        if (released) return false;
        release();
        if (bytes > amount || this.used + this.reserved + bytes > this.maximum) return false;
        this.used += bytes;
        return true;
      },
    };
  }
}
