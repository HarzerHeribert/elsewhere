import { describe, it, expect } from 'vitest';
import type { WorldState } from '@elsewhere/character-interfaces';
import {
  predictApprovedPath,
  directWalkTarget,
  clearSegment,
  stepLocalMovement,
  WORLD_PREDICTION_MS,
} from './sceneMotion';
const world = {
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  obstacles: [{ id: 'wall', minX: 1, maxX: 1.5, minZ: -2, maxZ: 2, height: 2 }],
} as WorldState;
describe('bounded scene locomotion', () => {
  it('follows approved corners instead of cutting diagonally across them', () => {
    expect(
      predictApprovedPath(
        { x: 0, z: 0 },
        [
          { x: 1, z: 0 },
          { x: 1, z: 1 },
        ],
        1500,
        0.001,
        2000,
      ),
    ).toEqual({ x: 1, z: 0.5 });
  });
  it('caps prediction during a stale connection and never exceeds the path', () => {
    expect(predictApprovedPath({ x: 0, z: 0 }, [{ x: 10, z: 0 }], 100000)).toEqual({
      x: 1.12,
      z: 0,
    });
    expect(predictApprovedPath({ x: 0, z: 0 }, [{ x: 0.2, z: 0 }], 100000)).toEqual({
      x: 0.2,
      z: 0,
    });
  });
  it('clips keyboard movement before a wall instead of planning a detour', () => {
    const target = directWalkTarget(world, { x: 0, z: 0 }, { x: 2, z: 0 });
    expect(target).not.toBeNull();
    expect(target!.x).toBeLessThan(0.75);
    expect(target!.z).toBe(0);
    expect(clearSegment(world, { x: 0, z: 0 }, { x: 2, z: 0 })).toBe(false);
  });
  it('rejects a grazing corner even when evenly spaced samples miss the intersection', () => {
    const corner = {
      ...world,
      obstacles: [{ id: 'north', minX: -9.2, maxX: -0.8, minZ: -6.2, maxZ: -5.8, height: 2 }],
    } as WorldState;
    // The collision interval is only about six millimetres long between sample locations.
    expect(clearSegment(corner, { x: -0.5, z: -6.4 }, { x: -0.62, z: -6.51 })).toBe(false);
    expect(clearSegment(corner, { x: -0.5, z: -6.4 }, { x: -0.5, z: -6.5 })).toBe(true);
    expect(clearSegment(corner, { x: -0.5, z: -6.5 }, { x: -3, z: -6.5 })).toBe(true);
    expect(directWalkTarget(corner, { x: -0.5, z: -6.4 }, { x: -0.62, z: -6.51 })).toBeNull();
  });
  it('uses the same radius and elliptical pond boundary as authoritative walking', () => {
    const pond = {
      ...world,
      obstacles: [
        { id: 'pond', minX: 16, maxX: 24, minZ: 10, maxZ: 18, height: 0.1, shape: 'ellipse' },
      ],
      bounds: { minX: -32, maxX: 32, minZ: -26, maxZ: 26 },
    } as WorldState;
    expect(clearSegment(pond, { x: 15.5, z: 10 }, { x: 17, z: 10 })).toBe(true);
    expect(clearSegment(pond, { x: 14, z: 14 }, { x: 26, z: 14 })).toBe(false);
    expect(clearSegment(world, { x: 0.72, z: 0 }, { x: 0.72, z: 0.5 })).toBe(true);
  });
});

describe('responsive local input', () => {
  it('moves on the first frame, normalizes diagonals, and handles small collision steps', () => {
    const start = { x: 0, z: 0 };
    const forward = stepLocalMovement(world, start, start, 0, 1, 0, 1 / 60);
    const diagonal = stepLocalMovement(world, start, start, 0, 1, 1, 1 / 60);
    expect(forward.z).toBeCloseTo(3.2 / 60);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(forward.z);
    const wall = { x: 0.72, z: 0 };
    expect(stepLocalMovement(world, wall, wall, Math.PI / 2, 1, 0, 1 / 60)).toEqual(wall);
  });
  it('bounds visual lead during latency and does not move without input', () => {
    const authority = { x: 0, z: 0 },
      ahead = { x: 0, z: 1.24 };
    expect(stepLocalMovement(world, ahead, authority, 0, 1, 0, 0.016)).toEqual(ahead);
    expect(stepLocalMovement(world, ahead, authority, 0, 0, 0, 0.016)).toEqual(ahead);
  });
  it('keeps approved public routes moving throughout a normal poll interval', () => {
    const sample = (age: number) =>
      predictApprovedPath({ x: 0, z: 0 }, [{ x: 0, z: 20 }], age, 0.0022, WORLD_PREDICTION_MS);
    expect(sample(1500).z).toBeGreaterThan(sample(1200).z);
    expect(sample(10000)).toEqual(sample(WORLD_PREDICTION_MS));
  });
});
