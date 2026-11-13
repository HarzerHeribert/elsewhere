import type { Bounds, Position, WorldControl, WorldObject } from '@elsewhere/character-interfaces';
import type { FeedSnapshot } from '../feeds/types.js';
import { sunHorizontal } from './sky.js';

/**
 * Objects that answer back. Everything here is pure and deterministic: a reading depends on
 * the control worked, the hidden state of the object, the world conditions at the world time
 * and a small scatter seeded by the object's use counter. None of it is ever written into
 * text a resident or visitor can read; only the numbers come out.
 */
export interface Conditions {
  sunElevationDeg: number;
  sunBearingDeg: number;
  windSpeed: number;
  windBearingDeg: number;
  airTempC: number;
}
/** JSON only, and small: numbers and flat lists of numbers. */
export type StateValue = number | number[];
export type MechanismState = Record<string, StateValue>;
export type OperateResult =
  | { ok: true; reading: string; state: MechanismState; spend?: string; offered?: string }
  | { ok: false; problem: string };
/** What an object may be able to see of the rest of the world (public facts only). */
export interface Scene {
  objects: Array<
    Pick<WorldObject, 'id' | 'name' | 'position' | 'radius' | 'height'> & { footprint?: Bounds }
  >;
  places: Array<{ id: string; name: string; bounds: Bounds; entryPoint?: Position }>;
}

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const TAU = Math.PI * 2;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;
export const deg = (radians: number) => (radians * 180) / Math.PI;
export const mod = (value: number, base: number) => ((value % base) + base) % base;
export const wave = (now: number, periodMinutes: number, phase: number) =>
  Math.sin((TAU * now) / (periodMinutes * MINUTE) + phase);

/** A weather value fetched within this long is taken as the weather over Elsewhere. */
export const WEATHER_FRESH_MS = 2 * HOUR;

/**
 * Conditions at a world time. Never exposed directly. With a fresh weather value in `feeds`,
 * wind and air temperature are the real ones; otherwise they are simulated.
 */
export function worldConditions(now: number, feeds?: FeedSnapshot): Conditions {
  // The real sun over latitude 51.0 N, longitude 10.0 E at this UTC time.
  const { elevationDeg: sunElevationDeg, bearingDeg: sunBearingDeg } = sunHorizontal(now);
  const windSpeed = Math.max(
    0,
    3.4 +
      1.6 * wave(now, 37, 0.7) +
      1.3 * wave(now, 83, 2.1) +
      1.1 * wave(now, 251, 4) +
      1.5 * wave(now, 613, 1.3),
  );
  const windBearingDeg = mod(
    225 + 55 * wave(now, 191, 0.4) + 40 * wave(now, 457, 2.2) + 15 * wave(now, 53, 5),
    360,
  );
  const airTempC =
    12 +
    4 * wave(now, 720, 3.5) +
    3 * wave(now, 320, 1.1) +
    1.5 * wave(now, 107, 0.2) +
    0.8 * wave(now, 41, 2.9);
  const live = feeds?.weather;
  if (live && Math.abs(now - live.fetchedAt) <= WEATHER_FRESH_MS) {
    return {
      sunElevationDeg,
      sunBearingDeg,
      windSpeed: live.windSpeedMs,
      // Reported as the direction the wind comes from; the world's bearing is where it blows to.
      windBearingDeg: mod(live.windFromDeg + 180, 360),
      airTempC: live.temperatureC,
    };
  }
  return { sunElevationDeg, sunBearingDeg, windSpeed, windBearingDeg, airTempC };
}

/** A hash of text into [0, 1). */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** About +-2%, seeded by the object, the control and how often the object was used. */
export const scatterOf = (id: string, control: string, uses: number) =>
  1 + (hash(`${id}:${control}:${uses}`) - 0.5) * 0.04;

/** A finer scatter, about +-0.5%, for readings that are measured with care. */
export const fineOf = (scatter: number) => 1 + (scatter - 1) / 4;

export const round = (value: number, digits = 1) => value.toFixed(digits);
export const bearing = (value: number) => mod(Math.round(value), 360);
/** Compass bearing of a ground offset: 0 is toward -z, 90 toward +x. */
export const bearingOf = (dx: number, dz: number) => mod(deg(Math.atan2(dx, -dz)), 360);
/** Smallest signed difference a - b in degrees, in [-180, 180). */
export const angleDiff = (a: number, b: number) => mod(a - b + 180, 360) - 180;
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export const numberOf = (state: MechanismState, key: string, fallback: number): number => {
  const value = state[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
export const listOf = (state: MechanismState, key: string): number[] => {
  const value = state[key];
  return Array.isArray(value) ? value : [];
};
/** How long ago, in plain words with a number. */
export function ago(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < 90_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 90 * MINUTE) return `${Math.round(ms / MINUTE)} min ago`;
  if (ms < 36 * HOUR) return `${round(ms / HOUR)} h ago`;
  return `${round(ms / DAY)} days ago`;
}

export interface RunInput {
  object: WorldObject;
  control: string;
  value: number | undefined;
  text: string | undefined;
  state: MechanismState;
  conditions: Conditions;
  scatter: number;
  now: number;
  scene: Scene | undefined;
  /** Real data from outside; undefined when there is none. */
  feeds: FeedSnapshot | undefined;
  /** What the actor carries, as a count by kind. */
  carrying: Record<string, number>;
}
export type RunResult =
  | {
      reading: string;
      state?: MechanismState;
      /** An item kind of which one piece is used up. */
      spend?: string;
      /** Words handed over with the action. */
      offered?: string;
    }
  | { problem: string };
export interface Mechanism {
  controls: WorldControl[];
  run: (input: RunInput) => RunResult;
}
/** A numeric control; whole numbers unless a finer step is given. */
export const control = (
  id: string,
  description: string,
  min: number,
  max: number,
  meaning: string,
  step = 1,
): WorldControl => ({ id, description, value: { min, max, step, meaning } });
/** A control that takes written text of at most `max` characters. */
export const written = (
  id: string,
  description: string,
  max: number,
  meaning: string,
): WorldControl => ({ id, description, text: { max, meaning } });
export const act = (id: string, description: string): WorldControl => ({ id, description });

/** The shadow tip of the 18 cm pin: length in cm and the bearing it falls toward. */
export function shadowOf(conditions: Conditions, scatter: number) {
  const fine = 1 + (scatter - 1) / 4;
  const length = (18 / Math.tan(rad(conditions.sunElevationDeg))) * fine;
  const falls = bearing(conditions.sunBearingDeg + 180 + (fine - 1) * 100);
  return { length, falls };
}
