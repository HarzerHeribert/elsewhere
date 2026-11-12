import { act, angleDiff, bearingOf, control, numberOf, round, type Mechanism } from './common.js';
import { SOLSTICE_DECLINATION, risingBearing } from './sky.js';

const HEIGHTS_M = [1.7, 1.2, 2.1, 0.9, 1.9, 1.5, 1.4];
/** Where the sun rises at midwinter and at midsummer for this latitude, in degrees. */
export const WINTER_SUNRISE = risingBearing(-SOLSTICE_DECLINATION);
export const SUMMER_SUNRISE = risingBearing(SOLSTICE_DECLINATION);
const along = (from: { x: number; z: number }, bearingDeg: number, metres: number) => ({
  x: Math.round((from.x + metres * Math.sin((bearingDeg * Math.PI) / 180)) * 100) / 100,
  z: Math.round((from.z - metres * Math.cos((bearingDeg * Math.PI) / 180)) * 100) / 100,
});
const STONE_1 = { x: 0, z: 0 };
const STONE_2 = { x: 4.5, z: 1 };
/**
 * Hidden layout in metres. Stone 4 stands on the line from stone 1 toward the midwinter sunrise
 * and stone 6 on the line from stone 2 toward the midsummer sunrise; no other pair lines up.
 */
export const LAYOUT = [
  STONE_1,
  STONE_2,
  { x: 9, z: -1.5 },
  along(STONE_1, WINTER_SUNRISE, 6.4),
  { x: -6, z: -2 },
  along(STONE_2, SUMMER_SUNRISE, 7.5),
  { x: -7, z: 3 },
];
const PACE_M = 0.75;

/** Surveying: seven stones that can be tapped, measured, paced out and sighted along. */
export const standingStones: Mechanism = {
  controls: [
    control('tap', 'tap one stone', 1, 7, 'stone number'),
    control('pick', 'pick the stone to work from', 1, 7, 'stone number'),
    act('measure', 'measure the picked stone with a rod'),
    control('pace', 'pace out the way from the picked stone', 1, 7, 'stone number to walk to'),
    control(
      'sight',
      'sight from the picked stone over another',
      1,
      7,
      'stone number to sight over',
    ),
  ],
  run: ({ control: id, value, state, conditions, scatter }) => {
    const picked = numberOf(state, 'pick', 1);
    if (id === 'pick')
      return { reading: `Stone ${value} is picked.`, state: { ...state, pick: value as number } };
    if (id === 'tap') {
      const height = HEIGHTS_M[(value as number) - 1];
      const pitch = (190 / height) * scatter;
      const carries = ((0.9 + 0.6 * height) * scatter) / (1 + 0.05 * conditions.windSpeed);
      return {
        reading: `The knock sounds at ${round(pitch, 0)} Hz and carries for ${round(carries)} s.`,
      };
    }
    if (id === 'measure') {
      const cm = HEIGHTS_M[picked - 1] * 100 * (1 + (scatter - 1) * 0.25);
      return { reading: `Stone ${picked} stands ${round(cm, 0)} cm high.` };
    }
    const other = value as number;
    if (other === picked)
      return { problem: `Stone ${picked} is the picked stone; choose another one.` };
    const from = LAYOUT[picked - 1];
    const to = LAYOUT[other - 1];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (id === 'pace') {
      const paces = Math.round((Math.hypot(dx, dz) / PACE_M) * scatter * 2) / 2;
      return { reading: `From stone ${picked} to stone ${other} is ${paces} paces.` };
    }
    const line = Math.round(bearingOf(dx, dz) + (scatter - 1) * 25);
    const base = `Sighting from stone ${picked} over stone ${other}, the line runs on ${(line + 360) % 360} degrees`;
    if (conditions.sunElevationDeg < 0) return { reading: `${base}; the sun is down.` };
    const off = Math.round(angleDiff(conditions.sunBearingDeg, line));
    const where =
      off === 0
        ? 'stands on the line'
        : `stands ${Math.abs(off)} degrees to the ${off > 0 ? 'right' : 'left'} of it`;
    return {
      reading: `${base}; the sun ${where}, ${Math.round(conditions.sunElevationDeg)} degrees up.`,
    };
  },
};
