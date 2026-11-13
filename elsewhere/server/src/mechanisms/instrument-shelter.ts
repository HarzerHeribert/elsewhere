import { act, type Mechanism } from './common.js';
import { fixed, takenNote } from './outside.js';

/** Wet-bulb temperature from air temperature (deg C) and relative humidity (%): Stull, 2011. */
export function wetBulbC(temperatureC: number, humidityPct: number): number {
  const rh = Math.min(100, Math.max(1, humidityPct));
  const wet =
    temperatureC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(temperatureC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035;
  // Evaporation only cools: the wet bulb is never above the dry bulb.
  return Math.min(wet, temperatureC);
}

/** Cloud cover in eighths: only a clear sky is 0 and only a covered one is 8. */
export function oktas(coverPct: number): number {
  const eighths = Math.round(coverPct / 12.5);
  if (coverPct > 0 && eighths === 0) return 1;
  if (coverPct < 100 && eighths === 8) return 7;
  return eighths;
}

const BLANK = 'Nothing has come in yet; the instruments have no reading.';

/** Meteorology: a Stevenson screen with psychrometer and aneroid barometer, and a rain gauge. */
export const instrumentShelter: Mechanism = {
  controls: [
    act('thermometers', 'read the dry-bulb and wet-bulb thermometers'),
    act('barometer', 'read the aneroid barometer and the marker set three hours ago'),
    act('rain-gauge', 'read the rain gauge'),
    act('sky', 'estimate the cloud cover in eighths'),
  ],
  run: ({ control, feeds, now }) => {
    const weather = feeds?.weather;
    if (!weather) return { problem: BLANK };
    const note = takenNote(weather.fetchedAt, now);
    if (control === 'thermometers') {
      return {
        reading: `Dry bulb ${fixed(weather.temperatureC)} °C, wet bulb ${fixed(wetBulbC(weather.temperatureC, weather.humidityPct))} °C.${note}`,
      };
    }
    if (control === 'barometer') {
      const before =
        weather.pressureThreeHoursAgoHpa === undefined
          ? 'no marker was set three hours ago'
          : `the marker set three hours ago stands at ${fixed(weather.pressureThreeHoursAgoHpa)} hPa`;
      return { reading: `Pressure now ${fixed(weather.pressureHpa)} hPa; ${before}.${note}` };
    }
    if (control === 'rain-gauge') {
      if (weather.rain24hMm === undefined)
        return { problem: 'The gauge has no record for the last 24 hours.' };
      return { reading: `Rain gauge: ${fixed(weather.rain24hMm)} mm in the last 24 hours.${note}` };
    }
    return {
      reading: `Cloud cover ${oktas(weather.cloudCoverPct)} oktas (eighths of the sky).${note}`,
    };
  },
};
