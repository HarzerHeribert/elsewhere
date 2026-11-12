import {
  angleDiff,
  bearing,
  control,
  numberOf,
  round,
  worldConditions,
  type Mechanism,
} from './common.js';
import {
  STARS,
  horizontalOf,
  moonPosition,
  phaseWords,
  starHorizontal,
  wandererMoonOffsets,
  wandererPosition,
} from './sky.js';

export interface SkyBody {
  /** What the eyepiece shows. */
  seen: string;
  bearing: number;
  elevation: number;
  /** 0 (barely there) to 1 (bright): how little sharpness it takes to tell it apart. */
  brightness: number;
  /** What the star chart fixed to the stand prints for it, where it is a chart star. */
  label?: string;
  /** Set for the wanderer: the points that circle it, east (+) and west (-) in planet radii. */
  points?: number[];
}

/** Half the width of the eyepiece's view, in degrees of bearing. */
const FIELD = 8;
/** Seen from the lowest altitude at which anything can be made out through the haze. */
const HORIZON_HAZE = 1;

const brightnessOf = (magnitude: number) => Math.max(0.15, Math.min(1, (3 - magnitude) / 4.5));
const WORDS = ['no', 'one', 'two', 'three', 'four'];

/** Everything above the horizon at a world time. Hidden: only `aim` ever reports from it. */
export function skyAt(now: number): SkyBody[] {
  const { sunElevationDeg, sunBearingDeg } = worldConditions(now);
  const bodies: SkyBody[] = [];
  if (sunElevationDeg > 0)
    bodies.push({
      seen: 'the sun, a glaring disc',
      bearing: sunBearingDeg,
      elevation: sunElevationDeg,
      brightness: 1,
    });
  const moonAt = moonPosition(now);
  const moon = horizontalOf(moonAt.raDeg, moonAt.decDeg, now);
  if (moon.elevationDeg > 0)
    bodies.push({
      seen: `the moon, ${phaseWords(moonAt.elongationDeg)}`,
      bearing: moon.bearingDeg,
      elevation: moon.elevationDeg,
      brightness: 0.55 + 0.4 * moonAt.lit,
    });
  if (sunElevationDeg < -6) {
    for (const star of STARS) {
      const place = starHorizontal(star, now);
      if (place.elevationDeg < HORIZON_HAZE) continue;
      bodies.push({
        seen: `a steady ${star.colour} light`,
        bearing: place.bearingDeg,
        elevation: place.elevationDeg,
        brightness: brightnessOf(star.magnitude),
        label: star.label,
      });
    }
    const wanderer = wandererPosition(now);
    const place = horizontalOf(wanderer.raDeg, wanderer.decDeg, now);
    if (place.elevationDeg >= HORIZON_HAZE)
      bodies.push({
        seen: 'a steady cream-white light',
        bearing: place.bearingDeg,
        elevation: place.elevationDeg,
        brightness: 0.95,
        points: wandererMoonOffsets(now)
          .filter((point) => !point.hidden)
          .map((point) => point.offset),
      });
  }
  return bodies;
}

const sharpnessAt = (ring: number, airTempC: number) => {
  const best = 58 + 0.9 * (airTempC - 12);
  return Math.exp(-(((ring - best) / 9) ** 2));
};

/** Astronomy: a focus ring that is stiff to find, and an eyepiece that can be aimed. */
export const telescope: Mechanism = {
  controls: [
    control('focus', 'turn the focus ring', 0, 100, 'ring position'),
    control('aim', 'aim the telescope along a bearing', 0, 359, 'compass bearing in degrees'),
  ],
  run: ({ control: id, value, conditions, scatter, state, now }) => {
    if (id === 'focus') {
      const sharpness = sharpnessAt((value as number) * scatter, conditions.airTempC);
      const sunUp = conditions.sunElevationDeg > 0;
      const craters = Math.round(11 * sharpness * (sunUp ? 0.5 : 1));
      const edge = sharpness > 0.75 ? 'crisp' : sharpness > 0.35 ? 'soft' : 'blurred';
      return {
        reading: `The moon's edge is ${edge}; ${craters} ${craters === 1 ? 'crater' : 'craters'} can be told apart.`,
        state: { ...state, focus: value as number },
      };
    }
    const ring = numberOf(state, 'focus', 20);
    const sharpness = sharpnessAt(ring, conditions.airTempC);
    const target = value as number;
    const sky = skyAt(now);
    const inView = sky
      .filter((body) => Math.abs(angleDiff(body.bearing, target)) <= FIELD)
      .sort((a, b) => b.brightness - a.brightness);
    // A sharp eyepiece tells a body apart; an unsharp one still shows the bright ones as a patch.
    const crisp = sharpness > 0.75;
    const told = inView
      .map((body) => {
        if (sharpness >= 0.97 - 0.85 * body.brightness) {
          let line = `${body.seen}, ${round(body.elevation, 0)} degrees up`;
          if (crisp && body.label) line += `, marked ${body.label} on the chart`;
          if (crisp && body.points) {
            const count = Math.min(4, body.points.length);
            const sides = body.points
              .slice()
              .sort((a, b) => a - b)
              .map((offset) => `${round(Math.abs(offset) / 2)} ${offset > 0 ? 'east' : 'west'}`);
            line += `, with ${WORDS[count]} tiny ${count === 1 ? 'point' : 'points'} in a line beside it${count ? ` at ${sides.join(', ')} planet-diameters from it` : ''}`;
          }
          return line;
        }
        return body.brightness >= 0.5
          ? `a blurred bright patch, ${round(body.elevation, 0)} degrees up`
          : undefined;
      })
      .filter((line): line is string => Boolean(line))
      .slice(0, 3);
    const head = `Aimed along ${bearing(target)} degrees with the ring at ${ring}`;
    if (told.length) return { reading: `${head}: ${told.join('; ')}.` };
    // Nothing in the eyepiece: say on which side the nearest glow lies, if one is close.
    const near = sky
      .map((body) => ({ body, off: angleDiff(body.bearing, target) }))
      .filter(({ body, off }) => Math.abs(off) <= 45 && body.brightness >= 0.3)
      .sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
    return {
      reading: near
        ? `${head}: nothing in the eyepiece; a glow shows off to the ${near.off > 0 ? 'right' : 'left'}.`
        : `${head}: nothing can be made out.`,
    };
  },
};
