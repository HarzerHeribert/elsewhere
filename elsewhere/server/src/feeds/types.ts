/**
 * What the world knows of the outside, as a plain snapshot. Mechanisms read it and never fetch:
 * the fetching lives in LiveFeeds. Every value carries the wall-clock time it was fetched.
 */
export interface WeatherFeed {
  fetchedAt: number;
  /** Air temperature in degrees Celsius at 2 m. */
  temperatureC: number;
  humidityPct: number;
  pressureHpa: number;
  /** Surface pressure three hours before the current hour, when the response covers it. */
  pressureThreeHoursAgoHpa?: number;
  /** Rain over the last 24 hours in mm, when the response covers it. */
  rain24hMm?: number;
  cloudCoverPct: number;
  /** Wind speed at 10 m in m/s. */
  windSpeedMs: number;
  /** Direction the wind blows FROM, in degrees (meteorological convention). */
  windFromDeg: number;
}
export interface RiverFeed {
  fetchedAt: number;
  station: string;
  water: string;
  levelCm: number;
  /** Time of the measurement, ms since the epoch. */
  measuredAt: number;
  levelSixHoursEarlierCm?: number;
}
export interface Earthquake {
  /** ms since the epoch. */
  time: number;
  magnitude: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  place: string;
}
export interface EarthquakeFeed {
  fetchedAt: number;
  /** The most recent first, at most four. */
  events: Earthquake[];
}
export interface SpaceWeatherFeed {
  fetchedAt: number;
  kp?: { value: number; time: number };
  solarWind?: { speedKms: number; time: number };
}
export const SPECIES_GROUPS = ['birds', 'insects', 'mammals', 'plants'] as const;
export type SpeciesGroup = (typeof SPECIES_GROUPS)[number];
export interface SpeciesFeed {
  fetchedAt: number;
  groups: Record<SpeciesGroup, { total: number; species: Array<{ name: string; count: number }> }>;
}
export interface FeedSnapshot {
  weather?: WeatherFeed;
  river?: RiverFeed;
  earthquakes?: EarthquakeFeed;
  space?: SpaceWeatherFeed;
  species?: SpeciesFeed;
}
