import { describe, expect, it } from 'vitest';
import { SnapshotMotion } from './snapshotMotion';

describe('public wildlife interpolation', () => {
  it('moves continuously across 1.5 second updates with network jitter', () => {
    const motion = new SnapshotMotion();
    motion.sample(0, 0, 0, 0, 0);
    motion.sample(1500, 1500, 3, 1, 0);
    let previous = motion.position(1800)!.x;
    for (let now = 1816; now < 6000; now += 16) {
      if (now >= 4500) motion.sample(4500, 4500, 9, 3, 0);
      else if (now >= 3100) motion.sample(3000, 3100, 6, 2, 0);
      const current = motion.position(now)!.x;
      expect(current).toBeGreaterThan(previous);
      expect(current - previous).toBeLessThan(0.04);
      previous = current;
    }
  });
  it('holds the last known position on disconnect and resets on world rollback', () => {
    const motion = new SnapshotMotion();
    motion.sample(100, 0, 1, 2, 3);
    motion.sample(200, 1500, 4, 5, 6);
    expect(motion.position(100000)).toMatchObject({ x: 4, y: 5, z: 6 });
    motion.sample(1, 100100, 0, 0, 0);
    expect(motion.position(100100)).toMatchObject({ x: 0, y: 0, z: 0 });
  });
});
