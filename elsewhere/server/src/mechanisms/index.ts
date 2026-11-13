import type { WorldControl, WorldObject } from '@elsewhere/character-interfaces';
import {
  scatterOf,
  worldConditions,
  type Mechanism,
  type OperateResult,
  type Scene,
  type MechanismState,
} from './common.js';
import { artifact } from './artifact.js';
import { easel } from './easel.js';
import { garden } from './garden.js';
import { launchStand } from './launch-stand.js';
import { musicBox } from './music-box.js';
import { orchardTree } from './orchard-tree.js';
import { pond } from './pond.js';
import { reckoningBench } from './reckoning-bench.js';
import { seedDrawers } from './seed-drawers.js';
import { specimenTray } from './specimen-tray.js';
import { standingStones } from './standing-stones.js';
import { sundial } from './sundial.js';
import { telescope } from './telescope.js';
import { weatherMarker } from './weather-marker.js';
import { window } from './window.js';
import { windchime } from './windchime.js';

export { worldConditions } from './common.js';
export type { Conditions, MechanismState, OperateResult, Scene } from './common.js';

/** Every working object answers by its kind. */
const mechanisms: Record<string, Mechanism> = {
  sundial,
  windchime,
  'weather-marker': weatherMarker,
  artifact,
  pond,
  telescope,
  stones: standingStones,
  garden,
  tree: orchardTree,
  window,
  'painting-kit': easel,
  'music-box': musicBox,
  'launch-stand': launchStand,
  'magnifying-glass': specimenTray,
  'seed-library': seedDrawers,
  'reckoning-bench': reckoningBench,
};

/** The controls an object of this kind offers, or undefined when it cannot be worked. */
export function mechanismFor(kind: string): WorldControl[] | undefined {
  const found = mechanisms[kind];
  return found ? found.controls.map((control) => structuredClone(control)) : undefined;
}

/** `scene` is what the world shows publicly; only objects that look out at it use it. */
export function operate(
  object: WorldObject,
  control: string,
  value: number | undefined,
  state: MechanismState | undefined,
  now: number,
  scene?: Scene,
  text?: string,
): OperateResult {
  const mechanism = mechanisms[object.kind];
  if (!mechanism) return { ok: false, problem: 'That object has no controls.' };
  const chosen = mechanism.controls.find((item) => item.id === control);
  if (!chosen) {
    return {
      ok: false,
      problem: `That object has no control called ${control}. Its controls are: ${mechanism.controls.map((item) => item.id).join(', ')}.`,
    };
  }
  const range = chosen.value;
  let used: number | undefined;
  if (range) {
    const whole = range.step === 1;
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      value < range.min ||
      value > range.max ||
      (whole && !Number.isInteger(value))
    ) {
      return {
        ok: false,
        problem: `${control} needs a ${whole ? 'whole ' : ''}number from ${range.min} to ${range.max} (${range.meaning}).`,
      };
    }
    // A control cannot be set finer than its step: the nearest setting is what takes effect.
    used = range.step ? Math.round(value / range.step) * range.step : value;
  }
  const spec = chosen.text;
  let written: string | undefined;
  if (spec) {
    const trimmed = text?.trim() ?? '';
    if (!trimmed) {
      return { ok: false, problem: `${control} needs written input (${spec.meaning}).` };
    }
    if (trimmed.length > spec.max) {
      return {
        ok: false,
        problem: `${control} needs written input of at most ${spec.max} characters (${spec.meaning}).`,
      };
    }
    written = trimmed;
  }
  const current = state ?? {};
  const uses = typeof current.uses === 'number' ? current.uses : 0;
  const result = mechanism.run({
    object,
    control,
    value: used,
    text: written,
    state: current,
    conditions: worldConditions(now),
    scatter: scatterOf(object.id, control, uses),
    now,
    scene,
  });
  if ('problem' in result) return { ok: false, problem: result.problem };
  return {
    ok: true,
    reading: result.reading,
    state: { ...(result.state ?? current), uses: uses + 1 },
  };
}
