import { z } from 'zod';
import type {
  Earthquake,
  EarthquakeFeed,
  RiverFeed,
  SpaceWeatherFeed,
  SpeciesFeed,
  SpeciesGroup,
  WeatherFeed,
} from './types.js';

const HOUR = 3_600_000;

/** Text from outside is untrusted: letters, digits, spaces and . , - ' ( ) only, 80 at most. */
export function sanitizeName(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[^\p{L}\p{Nd} .,'()-]/gu, '')
    .trim()
    .slice(0, 80)
    .trim();
}
const name = z
  .string()
  .max(2000)
  .transform(sanitizeName)
  .refine((text) => text.length > 0);
const finite = z.number().finite();
const timestamp = z
  .string()
  .max(64)
  .transform((text) =>
    Date.parse(text.endsWith('Z') || /[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`),
  )
  .refine((ms) => Number.isFinite(ms));

const WeatherSchema = z.object({
  current: z.object({
    time: timestamp,
    temperature_2m: finite.min(-90).max(70),
    relative_humidity_2m: finite.min(0).max(100),
    surface_pressure: finite.min(300).max(1100),
    cloud_cover: finite.min(0).max(100),
    wind_speed_10m: finite.min(0).max(120),
    wind_direction_10m: finite.min(0).max(360),
  }),
  hourly: z
    .object({
      time: z.array(timestamp).max(400),
      surface_pressure: z.array(finite.nullable()).max(400),
      precipitation: z.array(finite.nullable()).max(400),
    })
    .optional(),
});
export function parseWeather(input: unknown, fetchedAt: number): WeatherFeed {
  const { current, hourly } = WeatherSchema.parse(input);
  const hour = Math.floor(current.time / HOUR) * HOUR;
  let pressureThreeHoursAgoHpa: number | undefined;
  let rain: number | undefined;
  if (hourly) {
    const at = hourly.time.indexOf(hour - 3 * HOUR);
    const before = at >= 0 ? hourly.surface_pressure[at] : undefined;
    if (typeof before === 'number' && before > 300 && before < 1100)
      pressureThreeHoursAgoHpa = before;
    let sum = 0;
    let count = 0;
    hourly.time.forEach((time, index) => {
      const mm = hourly.precipitation[index];
      if (time > hour - 24 * HOUR && time <= hour && typeof mm === 'number' && mm >= 0) {
        sum += mm;
        count++;
      }
    });
    // Most of the day has to be there for the sum to mean anything.
    if (count >= 22) rain = Math.round(sum * 10) / 10;
  }
  return {
    fetchedAt,
    temperatureC: current.temperature_2m,
    humidityPct: current.relative_humidity_2m,
    pressureHpa: current.surface_pressure,
    ...(pressureThreeHoursAgoHpa === undefined ? {} : { pressureThreeHoursAgoHpa }),
    ...(rain === undefined ? {} : { rain24hMm: rain }),
    cloudCoverPct: current.cloud_cover,
    windSpeedMs: current.wind_speed_10m,
    windFromDeg: current.wind_direction_10m % 360,
  };
}

const StationsSchema = z.array(
  z.object({
    uuid: z.string().uuid(),
    shortname: name,
    longname: name.optional().catch(undefined),
    longitude: finite.min(-180).max(180).optional(),
    latitude: finite.min(-90).max(90).optional(),
    water: z.object({
      shortname: name.optional().catch(undefined),
      longname: name.optional().catch(undefined),
    }),
    timeseries: z
      .array(
        z.object({
          shortname: z.string().max(40),
          currentMeasurement: z
            .object({ timestamp, value: finite.min(-1000).max(5000) })
            .optional()
            .catch(undefined),
        }),
      )
      .max(40),
  }),
);
const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
/** The nearest station that has a current water level. */
export function parseStations(
  input: unknown,
  home: { latitude: number; longitude: number },
  fetchedAt: number,
): RiverFeed & { uuid: string } {
  const stations = StationsSchema.parse(input);
  let best: { km: number; found: RiverFeed & { uuid: string } } | undefined;
  for (const station of stations) {
    const level = station.timeseries.find((series) => series.shortname === 'W')?.currentMeasurement;
    const stationName = station.longname ?? station.shortname;
    const waterName = station.water.longname ?? station.water.shortname;
    if (!level || !waterName || station.latitude === undefined || station.longitude === undefined)
      continue;
    const km = distanceKm(home.latitude, home.longitude, station.latitude, station.longitude);
    if (!best || km < best.km)
      best = {
        km,
        found: {
          uuid: station.uuid,
          fetchedAt,
          station: stationName,
          water: waterName,
          levelCm: level.value,
          measuredAt: level.timestamp,
        },
      };
  }
  if (!best) throw new Error('No station with a current level.');
  return best.found;
}
const HistorySchema = z
  .array(z.object({ timestamp, value: finite.min(-1000).max(5000) }))
  .max(2000);
/** The level nearest to six hours before `measuredAt`, if a reading lies within 45 minutes of it. */
export function parseHistory(input: unknown, measuredAt: number): number | undefined {
  const target = measuredAt - 6 * HOUR;
  let best: { gap: number; value: number } | undefined;
  for (const row of HistorySchema.parse(input)) {
    const gap = Math.abs(row.timestamp - target);
    if (gap <= 45 * 60_000 && (!best || gap < best.gap)) best = { gap, value: row.value };
  }
  return best?.value;
}

const QuakesSchema = z.object({
  features: z
    .array(
      z.object({
        properties: z.object({
          mag: finite.min(-2).max(11),
          place: z.string().max(500).nullable().optional(),
          time: finite,
        }),
        geometry: z.object({
          coordinates: z.tuple([
            finite.min(-180).max(180),
            finite.min(-90).max(90),
            finite.min(-100).max(1000),
          ]),
        }),
      }),
    )
    .max(2000),
});
export function parseQuakes(input: unknown, fetchedAt: number): EarthquakeFeed {
  const events: Earthquake[] = QuakesSchema.parse(input)
    .features.map(({ properties, geometry }) => ({
      time: properties.time,
      magnitude: properties.mag,
      depthKm: geometry.coordinates[2],
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
      place: sanitizeName(properties.place ?? '') || 'an unnamed place',
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 4);
  return { fetchedAt, events };
}

const KpSchema = z
  .array(z.object({ time_tag: timestamp, Kp: finite.min(0).max(9) }))
  .min(1)
  .max(2000);
export function parseKp(input: unknown): { value: number; time: number } {
  const rows = KpSchema.parse(input);
  const latest = rows.reduce((a, b) => (b.time_tag >= a.time_tag ? b : a));
  return { value: latest.Kp, time: latest.time_tag };
}
const WindSchema = z
  .array(z.object({ proton_speed: finite.min(0).max(5000), time_tag: timestamp }))
  .min(1)
  .max(10);
export function parseSolarWind(input: unknown): { speedKms: number; time: number } {
  const row = WindSchema.parse(input)[0];
  return { speedKms: row.proton_speed, time: row.time_tag };
}
export function spaceWeather(
  kp: { value: number; time: number } | undefined,
  wind: { speedKms: number; time: number } | undefined,
  fetchedAt: number,
): SpaceWeatherFeed {
  if (!kp && !wind) throw new Error('No space weather values.');
  return { fetchedAt, ...(kp ? { kp } : {}), ...(wind ? { solarWind: wind } : {}) };
}

const FacetSchema = z.object({
  count: z.number().int().min(0),
  facets: z
    .array(
      z.object({
        field: z.string(),
        counts: z
          .array(z.object({ name: z.string().regex(/^\d{1,12}$/), count: z.number().int().min(0) }))
          .max(50),
      }),
    )
    .max(5),
});
export function parseFacets(input: unknown): {
  total: number;
  keys: Array<{ key: string; count: number }>;
} {
  const parsed = FacetSchema.parse(input);
  const counts = parsed.facets.find((facet) => facet.field === 'SPECIES_KEY')?.counts ?? [];
  return {
    total: parsed.count,
    keys: counts.slice(0, 8).map((item) => ({ key: item.name, count: item.count })),
  };
}
const SpeciesNameSchema = z.object({ canonicalName: name });
export const parseSpeciesName = (input: unknown): string =>
  SpeciesNameSchema.parse(input).canonicalName;

export function speciesFeed(
  groups: Record<SpeciesGroup, { total: number; species: Array<{ name: string; count: number }> }>,
  fetchedAt: number,
): SpeciesFeed {
  return { fetchedAt, groups };
}
