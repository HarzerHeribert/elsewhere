/** Buffer public observations by one poll plus jitter, without inventing wildlife routes. */
export class SnapshotMotion {
  private samples: { at: number; x: number; y: number; z: number }[] = [];
  private stamp: number | undefined;

  sample(stamp: number, now: number, x: number, y: number, z: number) {
    if (stamp === this.stamp) return;
    if (this.stamp !== undefined && stamp < this.stamp) this.samples = [];
    this.stamp = stamp;
    this.samples.push({ at: now, x, y, z });
    if (this.samples.length > 8) this.samples.shift();
  }

  position(now: number) {
    const time = now - 1700;
    while (this.samples.length > 2 && this.samples[1]!.at <= time) this.samples.shift();
    const a = this.samples[0];
    if (!a) return undefined;
    const b = this.samples[1];
    if (!b) return a;
    const t = Math.max(0, Math.min(1, (time - a.at) / Math.max(1, b.at - a.at)));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
}
