/** Bounded per-account serialization for the platform's single active auth runtime. */
export class AuthMutationBusy extends Error {}
export class AuthMutationLocks {
  private readonly entries = new Map<string, { tail: Promise<void>; pending: number }>();
  private total = 0;
  async run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(userId);
    if (this.total >= 32 || (entry?.pending ?? 0) >= 3) throw new AuthMutationBusy();
    if (!entry) {
      entry = { tail: Promise.resolve(), pending: 0 };
      this.entries.set(userId, entry);
    }
    const previous = entry.tail;
    let release!: () => void;
    entry.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    entry.pending++;
    this.total++;
    try {
      await previous;
      return await operation();
    } finally {
      entry.pending--;
      this.total--;
      release();
      if (!entry.pending) this.entries.delete(userId);
    }
  }
}
