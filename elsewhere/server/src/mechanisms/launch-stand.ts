import { act, bearingOf, control, fineOf, numberOf, rad, round, type Mechanism } from './common.js';

const GRAVITY = 9.81;
const MAX_STROKES = 60;
/** Hidden: the bottle points this way. */
const HEADING = 300;

const BOTTLE_M3 = 1.5e-3;
const EMPTY_KG = 0.12;
const NOZZLE_M2 = Math.PI * (0.0215 / 2) ** 2;
const BODY_M2 = Math.PI * (0.089 / 2) ** 2;
const BAR_PER_STROKE = 0.25;
/** The seal gives way above this gauge pressure, in bar. */
export const BURST_BAR = 6.5;
const ATMOSPHERE_PA = 101_325;
const WATER_KG_M3 = 1000;
const GAMMA = 1.4;
const DRAG_COEFFICIENT = 0.45;

export interface Flight {
  apogeeM: number;
  seconds: number;
  x: number;
  z: number;
}

/**
 * One flight, integrated with fixed small steps: the water jet driven by adiabatic air
 * (thrust twice the gauge pressure times the nozzle area) while water remains, then a
 * ballistic arc with quadratic drag against the air that moves with the wind.
 */
export function flyRocket(input: {
  fillFraction: number;
  gaugeBar: number;
  tiltDeg: number;
  headingDeg: number;
  windSpeed: number;
  windBearingDeg: number;
  airTempC: number;
  dragScale?: number;
}): Flight {
  const water0 = BOTTLE_M3 * input.fillFraction;
  const air0 = BOTTLE_M3 - water0;
  const airDensity = ATMOSPHERE_PA / (287.05 * (273.15 + input.airTempC));
  const drag = 0.5 * airDensity * DRAG_COEFFICIENT * (input.dragScale ?? 1) * BODY_M2;
  const startGauge = input.gaugeBar * 1e5;
  const aim = [
    Math.cos(rad(input.tiltDeg)) * Math.sin(rad(input.headingDeg)),
    Math.sin(rad(input.tiltDeg)),
    -Math.cos(rad(input.tiltDeg)) * Math.cos(rad(input.headingDeg)),
  ];
  const wind = [
    input.windSpeed * Math.sin(rad(input.windBearingDeg)),
    0,
    -input.windSpeed * Math.cos(rad(input.windBearingDeg)),
  ];
  const position = [0, 0, 0];
  const velocity = [0, 0, 0];
  let water = water0;
  let apogee = 0;
  let time = 0;
  while (time < 300) {
    const burning = water > 0;
    const dt = burning ? 0.0005 : 0.005;
    let force = [0, -GRAVITY, 0];
    let mass = EMPTY_KG + water * WATER_KG_M3;
    force = [0, -GRAVITY * mass, 0];
    if (burning) {
      const gauge =
        (startGauge + ATMOSPHERE_PA) * (air0 / (air0 + (water0 - water))) ** GAMMA - ATMOSPHERE_PA;
      if (gauge > 0) {
        const thrust = 2 * gauge * NOZZLE_M2;
        const speed = Math.hypot(...velocity);
        const direction = speed > 0.5 ? velocity.map((v) => v / speed) : aim;
        for (let i = 0; i < 3; i++) force[i] += thrust * direction[i];
        water = Math.max(0, water - NOZZLE_M2 * Math.sqrt((2 * gauge) / WATER_KG_M3) * dt);
      } else water = 0;
    }
    const relative = velocity.map((v, i) => v - wind[i]);
    const relativeSpeed = Math.hypot(...relative);
    for (let i = 0; i < 3; i++) force[i] -= drag * relativeSpeed * relative[i];
    mass = EMPTY_KG + water * WATER_KG_M3;
    for (let i = 0; i < 3; i++) {
      velocity[i] += (force[i] / mass) * dt;
      position[i] += velocity[i] * dt;
    }
    time += dt;
    apogee = Math.max(apogee, position[1]);
    if (position[1] < 0 && time > 0.05) break;
  }
  return { apogeeM: apogee, seconds: time, x: position[0], z: position[2] };
}

/** Rocketry: a water rocket that is filled, pumped, tilted and launched once. */
export const launchStand: Mechanism = {
  controls: [
    control('fill', 'fill the bottle with water', 0, 100, 'percent of the bottle’s volume filled'),
    control('pump', 'work the pump', 1, 30, 'strokes of the pump'),
    control('tilt', 'tilt the stand', 30, 90, 'angle from the ground in degrees'),
    act('launch', 'pull the release'),
  ],
  run: ({ control: id, value, state, conditions, scatter }) => {
    const fill = numberOf(state, 'fill', 0);
    const strokes = numberOf(state, 'strokes', 0);
    const tilt = numberOf(state, 'tilt', 60);
    if (id === 'fill')
      return {
        reading: `The bottle now holds ${value}% water.`,
        state: { ...state, fill: value as number },
      };
    if (id === 'pump') {
      const total = Math.min(MAX_STROKES, strokes + (value as number));
      return {
        reading: `${value} ${value === 1 ? 'stroke' : 'strokes'} pumped; ${total} ${total === 1 ? 'stroke' : 'strokes'} are in the bottle now, ${round(total * BAR_PER_STROKE, 2)} bar on the gauge.`,
        state: { ...state, strokes: total },
      };
    }
    if (id === 'tilt')
      return {
        reading: `The stand is now tilted to ${value} degrees.`,
        state: { ...state, tilt: value as number },
      };
    const emptied = { ...state, fill: 0, strokes: 0 };
    const bar = strokes * BAR_PER_STROKE;
    const head = `With ${fill}% water, ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} (${round(bar, 2)} bar) and a tilt of ${tilt} degrees`;
    if (bar > BURST_BAR)
      return {
        reading: `${head} the seal let go on the stand and the water ran out; nothing flew.`,
        state: emptied,
      };
    if (fill <= 0 || strokes <= 0)
      return {
        reading: `${head} the rocket only tipped over on the stand.`,
        state: emptied,
      };
    const flight = flyRocket({
      fillFraction: fill / 100,
      gaugeBar: bar,
      tiltDeg: tilt,
      headingDeg: HEADING,
      windSpeed: conditions.windSpeed,
      windBearingDeg: conditions.windBearingDeg,
      airTempC: conditions.airTempC,
      dragScale: fineOf(scatter),
    });
    return {
      reading: `${head} the rocket rose ${round(flight.apogeeM)} m, flew ${round(flight.seconds)} s and landed ${round(Math.hypot(flight.x, flight.z))} m away toward ${Math.round(bearingOf(flight.x, flight.z))} degrees.`,
      state: emptied,
    };
  },
};
