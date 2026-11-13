import { act, ago, type Mechanism } from './common.js';
import { fixed, plain, takenNote, utc, OLD_AFTER_MS } from './outside.js';

const BLANK = 'Nothing has come in yet; the tape is blank.';
const degrees = (value: number, positive: string, negative: string) =>
  `${fixed(Math.abs(value), 2)} ${value >= 0 ? positive : negative}`;

/** A ticker-tape telegraph: river gauge, earthquakes and space weather as they came in. */
export const dispatchWire: Mechanism = {
  controls: [
    act('river', 'read the river gauge on the tape'),
    act('tremors', 'read the earthquakes on the tape'),
    act('sun', 'read the space weather on the tape'),
  ],
  run: ({ control, feeds, now }) => {
    if (control === 'river') {
      const river = feeds?.river;
      if (!river) return { problem: BLANK };
      const change =
        river.levelSixHoursEarlierCm === undefined
          ? ''
          : river.levelCm === river.levelSixHoursEarlierCm
            ? ' No change over six hours.'
            : ` ${river.levelCm > river.levelSixHoursEarlierCm ? 'Up' : 'Down'} ${plain(Math.abs(river.levelCm - river.levelSixHoursEarlierCm))} cm over six hours.`;
      return {
        reading: `Gauge ${river.station} on the ${river.water}: level ${plain(river.levelCm)} cm at ${utc(river.measuredAt, now)}.${change}${takenNote(river.measuredAt, now)}`,
      };
    }
    if (control === 'tremors') {
      const quakes = feeds?.earthquakes;
      if (!quakes) return { problem: BLANK };
      const note = takenNote(quakes.fetchedAt, now);
      if (!quakes.events.length)
        return { reading: `No earthquake above magnitude 4.5 came in over the last day.${note}` };
      const lines = quakes.events.map(
        (quake) =>
          `magnitude ${fixed(quake.magnitude)} at ${utc(quake.time, now)}, depth ${fixed(quake.depthKm)} km, ${degrees(quake.latitude, 'N', 'S')} ${degrees(quake.longitude, 'E', 'W')}, ${quake.place}`,
      );
      return {
        reading: `Earthquakes above magnitude 4.5 over the last day, newest first: ${lines.join('; ')}.${note}`,
      };
    }
    const space = feeds?.space;
    if (!space) return { problem: BLANK };
    const age = (time: number) => (now - time > OLD_AFTER_MS ? ` (taken ${ago(now - time)})` : '');
    const parts: string[] = [];
    if (space.kp)
      parts.push(
        `Planetary K index ${fixed(space.kp.value, 2)} for the interval starting ${utc(space.kp.time, now)}${age(space.kp.time)}`,
      );
    if (space.solarWind)
      parts.push(
        `${parts.length ? 'solar' : 'Solar'} wind speed ${plain(space.solarWind.speedKms)} km/s at ${utc(space.solarWind.time, now)}${age(space.solarWind.time)}`,
      );
    const missing = [
      space.kp ? '' : ' The K index did not come in.',
      space.solarWind ? '' : ' The solar wind speed did not come in.',
    ].join('');
    return { reading: `${parts.join('; ')}.${missing}` };
  },
};
