import {
  DAY,
  HOUR,
  angleDiff,
  bearing,
  control,
  mod,
  numberOf,
  round,
  worldConditions,
  type Mechanism,
} from './common.js';

export interface SkyBody {
  /** What the eyepiece shows. */
  seen: string;
  bearing: number;
  elevation: number;
  /** 0 (barely there) to 1 (bright): how little sharpness it takes to tell it apart. */
  brightness: number;
}

/** Five lights circle together at one rate; the wanderer drifts against them over days. */
const LIGHTS = [
  { seen: 'a steady yellowish light', bearing: 20, elevation: 52, brightness: 0.9 },
  { seen: 'a steady white light', bearing: 95, elevation: 38, brightness: 0.8 },
  { seen: 'a steady bluish light', bearing: 160, elevation: 61, brightness: 0.6 },
  { seen: 'a faint reddish light', bearing: 232, elevation: 29, brightness: 0.3 },
  { seen: 'a faint cluster', bearing: 301, elevation: 44, brightness: 0.15 },
];
const WANDERER = { seen: 'a steady white light', bearing: 58, elevation: 47, brightness: 0.75 };
/** Half the width of the eyepiece's view, in degrees of bearing. */
const FIELD = 8;
const SIDEREAL_HOURS = 23.934;
const DRIFT_PER_DAY = 3.7;
const LUNAR_DAY_HOURS = 24.84;

const horizon = (hour: number) => ({
  elevation: 60 * Math.sin((2 * Math.PI * (mod(hour, 24) - 6)) / 24) - 5,
  bearing: mod(90 + (mod(hour, 24) - 6) * 15, 360),
});

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
  const moon = horizon((now / HOUR) * (24 / LUNAR_DAY_HOURS) + 9);
  if (moon.elevation > 0)
    bodies.push({
      seen: 'the moon',
      bearing: moon.bearing,
      elevation: moon.elevation,
      brightness: 0.55,
    });
  if (sunElevationDeg < -6) {
    const turn = (360 * now) / (SIDEREAL_HOURS * HOUR);
    for (const light of LIGHTS) bodies.push({ ...light, bearing: mod(light.bearing + turn, 360) });
    bodies.push({
      ...WANDERER,
      bearing: mod(WANDERER.bearing + turn + (DRIFT_PER_DAY * now) / DAY, 360),
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
    const told = inView
      .map((body) =>
        sharpness >= 0.97 - 0.85 * body.brightness
          ? `${body.seen}, ${round(body.elevation, 0)} degrees up`
          : body.brightness >= 0.5
            ? `a blurred bright patch, ${round(body.elevation, 0)} degrees up`
            : undefined,
      )
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
