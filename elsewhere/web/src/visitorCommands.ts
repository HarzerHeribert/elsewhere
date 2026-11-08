import type { VisitorAction } from '@elsewhere/character-interfaces';

/** Serializes side effects, keeps only the latest intentions, and never throttles away a stop. */
export class VisitorCommandQueue {
  private move: VisitorAction | null = null;
  private look: VisitorAction | null = null;
  private stopping = false;
  private sending = false;
  private disposed = false;
  private lastSentAt = -Infinity;
  private lastKind: VisitorAction['type'] = 'look';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopRetries = 0;
  private epoch = 0;

  constructor(
    private readonly send: (command: VisitorAction) => Promise<void>,
    private readonly intervalMs = 200,
  ) {}

  enqueue(command: VisitorAction): void {
    if (this.disposed) return;
    if (command.type === 'stop') {
      this.stopRetries = 0;
      this.move = null;
      this.look = null;
      this.stopping = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    } else if (command.type === 'move') this.move = command;
    else this.look = command;
    void this.pump();
  }

  clear(): void {
    this.epoch++;
    this.stopRetries = 0;
    this.move = null;
    this.look = null;
    this.stopping = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private async pump(): Promise<void> {
    if (this.disposed || this.sending || this.timer || (!this.stopping && !this.move && !this.look))
      return;
    const remaining = this.intervalMs - (performance.now() - this.lastSentAt);
    if (!this.stopping && remaining > 0) {
      if (!this.timer)
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.pump();
        }, remaining);
      return;
    }
    let command: VisitorAction;
    if (this.stopping) {
      command = { type: 'stop' };
      this.stopping = false;
    } else if (this.look && (this.lastKind === 'move' || !this.move)) {
      command = this.look;
      this.look = null;
    } else if (this.move) {
      command = this.move;
      this.move = null;
    } else return;
    this.sending = true;
    this.lastSentAt = performance.now();
    this.lastKind = command.type;
    const epoch = this.epoch;
    try {
      await this.send(command);
    } catch {
      // Repeating a stop is safe. Never replay a failed movement intention: it may
      // have become obsolete while the network was unavailable.
      if (
        command.type === 'stop' &&
        !this.disposed &&
        epoch === this.epoch &&
        this.stopRetries < 2
      ) {
        this.stopping = true;
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.pump();
        }, 250 * ++this.stopRetries);
      }
    } finally {
      this.sending = false;
      void this.pump();
    }
  }
}
