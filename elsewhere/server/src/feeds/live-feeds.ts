import {
  parseFacets,
  parseHistory,
  parseKp,
  parseQuakes,
  parseSolarWind,
  parseSpeciesName,
  parseStations,
  parseWeather,
  spaceWeather,
  speciesFeed,
} from './parse.js';
import { SPECIES_GROUPS, type FeedSnapshot, type SpeciesGroup } from './types.js';

/** Where Elsewhere lies. */
export const HOME = { latitude: 51.0, longitude: 10.0 };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const RETRY_MS = 10 * MINUTE;

export type FeedName = 'weather' | 'river' | 'earthquakes' | 'space' | 'species';
const INTERVAL: Record<FeedName, number> = {
  weather: 15 * MINUTE,
  river: 30 * MINUTE,
  earthquakes: 15 * MINUTE,
  space: 30 * MINUTE,
  species: 12 * HOUR,
};
export const FEED_NAMES = Object.keys(INTERVAL) as FeedName[];

const GROUP_TAXON: Record<SpeciesGroup, number> = {
  birds: 212, // Aves
  insects: 216, // Insecta
  mammals: 359, // Mammalia
  plants: 6, // Plantae
};

export type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface LiveFeedsOptions {
  /** Off means nothing is ever fetched. */
  enabled?: boolean;
  fetch?: FeedFetch;
  now?: () => number;
}

/**
 * Keeps a snapshot of real, current data from outside. A failed refresh keeps the previous
 * value and never throws; mechanisms only ever see `snapshot()`.
 */
export class LiveFeeds {
  private readonly enabled: boolean;
  private readonly fetcher: FeedFetch;
  private readonly now: () => number;
  private values: FeedSnapshot = {};
  private timers = new Map<FeedName, ReturnType<typeof setTimeout>>();
  private running = false;
  private readonly busy = new Set<FeedName>();
  private readonly speciesNames = new Map<string, string>();

  constructor(options: LiveFeedsOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  start() {
    if (!this.enabled || this.running) return;
    this.running = true;
    for (const feed of FEED_NAMES) void this.cycle(feed);
  }
  stop() {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  snapshot(): FeedSnapshot {
    return structuredClone(this.values);
  }
  /** Refreshes every feed once, now. Failures are swallowed. */
  async refreshAll(): Promise<void> {
    await Promise.all(FEED_NAMES.map((feed) => this.refresh(feed)));
  }
  /** One refresh; true when a new value was kept. */
  async refresh(feed: FeedName): Promise<boolean> {
    if (!this.enabled || this.busy.has(feed)) return false;
    this.busy.add(feed);
    try {
      await this.load(feed);
      return true;
    } catch {
      return false;
    } finally {
      this.busy.delete(feed);
    }
  }

  private async cycle(feed: FeedName) {
    const ok = await this.refresh(feed);
    if (!this.running) return;
    const timer = setTimeout(
      () => void this.cycle(feed),
      ok ? INTERVAL[feed] : Math.min(INTERVAL[feed], RETRY_MS),
    );
    timer.unref?.();
    this.timers.set(feed, timer);
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'elsewhere-world', Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new Error('Response too large.');
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error('Response too large.');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('Response too large.');
    }
    return JSON.parse(text);
  }

  private async load(feed: FeedName) {
    if (feed === 'weather') {
      const url =
        'https://api.open-meteo.com/v1/forecast?latitude=51&longitude=10&wind_speed_unit=ms&timezone=UTC&past_days=1&forecast_days=1' +
        '&current=temperature_2m,relative_humidity_2m,surface_pressure,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
        '&hourly=surface_pressure,precipitation';
      this.values.weather = parseWeather(await this.json(url), this.now());
    } else if (feed === 'river') {
      const base = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations';
      const found = parseStations(
        await this.json(
          `${base}.json?latitude=${HOME.latitude}&longitude=${HOME.longitude}&radius=60&includeTimeseries=true&includeCurrentMeasurement=true`,
        ),
        HOME,
        this.now(),
      );
      const { uuid, ...river } = found;
      let earlier: number | undefined;
      try {
        earlier = parseHistory(
          await this.json(`${base}/${uuid}/W/measurements.json?start=PT7H`),
          river.measuredAt,
        );
      } catch {
        // The trend is optional.
      }
      this.values.river = {
        ...river,
        ...(earlier === undefined ? {} : { levelSixHoursEarlierCm: earlier }),
      };
    } else if (feed === 'earthquakes') {
      this.values.earthquakes = parseQuakes(
        await this.json(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
        ),
        this.now(),
      );
    } else if (feed === 'space') {
      const base = 'https://services.swpc.noaa.gov/products';
      const [kp, wind] = await Promise.all([
        this.json(`${base}/noaa-planetary-k-index.json`).then(parseKp, () => undefined),
        this.json(`${base}/summary/solar-wind-speed.json`).then(parseSolarWind, () => undefined),
      ]);
      this.values.space = spaceWeather(kp, wind, this.now());
    } else {
      const month = new Date(this.now()).getUTCMonth() + 1;
      const groups = {} as NonNullable<FeedSnapshot['species']>['groups'];
      for (const group of SPECIES_GROUPS) {
        const url =
          `https://api.gbif.org/v1/occurrence/search?decimalLatitude=50.75,51.25&decimalLongitude=9.6,10.4` +
          `&month=${month}&taxonKey=${GROUP_TAXON[group]}&limit=0&facet=speciesKey&facetLimit=8`;
        const { total, keys } = parseFacets(await this.json(url));
        const species: Array<{ name: string; count: number }> = [];
        for (const { key, count } of keys) {
          let speciesName = this.speciesNames.get(key);
          if (!speciesName) {
            speciesName = parseSpeciesName(
              await this.json(`https://api.gbif.org/v1/species/${key}`),
            );
            this.speciesNames.set(key, speciesName);
          }
          species.push({ name: speciesName, count });
        }
        groups[group] = { total, species };
      }
      this.values.species = speciesFeed(groups, this.now());
    }
  }
}
