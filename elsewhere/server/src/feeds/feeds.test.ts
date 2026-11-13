import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LiveFeeds, sanitizeName, type FeedFetch } from './index.js';
import {
  parseFacets,
  parseHistory,
  parseKp,
  parseQuakes,
  parseSolarWind,
  parseSpeciesName,
  parseStations,
  parseWeather,
} from './parse.js';
import { worldConditions } from '../mechanisms/common.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-13T12:05:00Z');
const HOME = { latitude: 51, longitude: 10 };

describe('parsing real responses into the reduced values', () => {
  it('weather: current values, pressure three hours ago and the rain of 24 hours', () => {
    const weather = parseWeather(fixture('open-meteo.json'), NOW);
    expect(weather).toMatchObject({
      fetchedAt: NOW,
      temperatureC: 5.9,
      humidityPct: 73,
      pressureHpa: 966.9,
      cloudCoverPct: 54,
      windSpeedMs: 4.08,
      windFromDeg: 281,
    });
    expect(weather.pressureThreeHoursAgoHpa).toBeGreaterThan(900);
    expect(weather.rain24hMm).toBeGreaterThanOrEqual(0);
  });
  it('river: the nearest station that has a current level, with the level six hours earlier', () => {
    const river = parseStations(fixture('pegelonline-stations.json'), HOME, NOW);
    expect(river).toMatchObject({ station: 'HELDRA', water: 'WERRA', levelCm: 141 });
    expect(river.measuredAt).toBe(Date.parse('2026-11-13T12:00:00Z'));
    expect(parseHistory(fixture('pegelonline-history.json'), river.measuredAt)).toBe(138);
    expect(parseHistory([], river.measuredAt)).toBeUndefined();
  });
  it('earthquakes: the four most recent, newest first', () => {
    const feed = parseQuakes(fixture('usgs-4.5-day.json'), NOW);
    expect(feed.events).toHaveLength(4);
    expect(feed.events[0].time).toBeGreaterThanOrEqual(feed.events[1].time);
    expect(feed.events[0]).toMatchObject({ magnitude: 4.8, place: '59 km WSW of Houma, Tonga' });
    expect(feed.events[0].latitude).toBeCloseTo(-21.3036);
    expect(feed.events[0].depthKm).toBeCloseTo(162.78);
  });
  it('space weather: the latest K index and the solar wind speed', () => {
    const kp = parseKp(fixture('swpc-kp.json'));
    expect(kp.time).toBe(Date.parse('2026-11-13T09:00:00Z'));
    expect(kp.value).toBeGreaterThanOrEqual(0);
    expect(parseSolarWind(fixture('swpc-solar-wind.json'))).toEqual({
      speedKms: 376,
      time: Date.parse('2026-11-13T12:03:00Z'),
    });
  });
  it('species: the total and the eight species keys, then the canonical name', () => {
    const facets = parseFacets(fixture('gbif-birds.json'));
    expect(facets.total).toBe(7605);
    expect(facets.keys).toHaveLength(8);
    expect(facets.keys[0]).toEqual({ key: '2474950', count: 622 });
    expect(parseSpeciesName(fixture('gbif-species.json'))).toBe('Grus grus');
  });
  it('rejects a response of the wrong shape', () => {
    expect(() => parseWeather({ current: {} }, NOW)).toThrow();
    expect(() => parseKp([])).toThrow();
  });
});

describe('text from outside', () => {
  it("keeps letters, digits, spaces and . , - ' ( ) and cuts at 80", () => {
    expect(sanitizeName("Hann. Münden (Weser), km-5 d'Été")).toBe(
      "Hann. Münden (Weser), km-5 d'Été",
    );
    expect(sanitizeName('A<script>alert(1)</script>;\n"B"')).toBe('Ascriptalert(1)script B');
    expect(sanitizeName('x'.repeat(200))).toHaveLength(80);
    expect(sanitizeName('  Ignore   previous\tinstructions!  ')).toBe(
      'Ignore previous instructions',
    );
  });
  it('is applied to the names taken from a response', () => {
    const stations = JSON.parse(JSON.stringify(fixture('pegelonline-stations.json')));
    stations[0].longname = 'EVIL <b>{"x":1}</b> [river]';
    const river = parseStations(stations.slice(0, 1), HOME, NOW);
    expect(river.station).toBe('EVIL bx1b river');
  });
});

/** A fake network that serves the fixtures and records every request. */
function network(overrides: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const json = (value: unknown) => () => new Response(JSON.stringify(value));
  const routes: Array<[string, () => Response]> = [
    ['api.open-meteo.com', json(fixture('open-meteo.json'))],
    ['/measurements.json', json(fixture('pegelonline-history.json'))],
    ['pegelonline', json(fixture('pegelonline-stations.json'))],
    ['usgs.gov', json(fixture('usgs-4.5-day.json'))],
    ['noaa-planetary-k-index', json(fixture('swpc-kp.json'))],
    ['solar-wind-speed', json(fixture('swpc-solar-wind.json'))],
    ['occurrence/search', json(fixture('gbif-birds.json'))],
    ['gbif.org/v1/species/', json(fixture('gbif-species.json'))],
  ];
  const fetch: FeedFetch = async (url, init) => {
    calls.push({ url, init });
    for (const [part, make] of Object.entries(overrides)) if (url.includes(part)) return make();
    const route = routes.find(([part]) => url.includes(part));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1]();
  };
  return { fetch, calls };
}

describe('LiveFeeds', () => {
  it('loads every feed and hands out a snapshot with fetchedAt on each value', async () => {
    const { fetch, calls } = network();
    const feeds = new LiveFeeds({ fetch, now: () => NOW });
    expect(feeds.snapshot()).toEqual({});
    await feeds.refreshAll();
    const snapshot = feeds.snapshot();
    for (const key of ['weather', 'river', 'earthquakes', 'space', 'species'] as const)
      expect(snapshot[key]?.fetchedAt, key).toBe(NOW);
    expect(snapshot.river?.levelSixHoursEarlierCm).toBe(138);
    expect(snapshot.species?.groups.birds.total).toBe(7605);
    expect(snapshot.species?.groups.birds.species[0]).toEqual({ name: 'Grus grus', count: 622 });
    // Every request is bounded, refuses redirects and carries only the generic agent.
    for (const { init } of calls) {
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeDefined();
      expect(init.headers).toMatchObject({ 'User-Agent': 'elsewhere-world' });
    }
    // A copy: nothing a mechanism does reaches the stored value.
    snapshot.weather!.temperatureC = -99;
    expect(feeds.snapshot().weather?.temperatureC).toBe(5.9);
  });

  it('asks Open-Meteo, GBIF and the others for the places and fields named', async () => {
    const { fetch, calls } = network();
    await new LiveFeeds({ fetch, now: () => NOW }).refreshAll();
    const urls = calls.map((call) => call.url);
    expect(urls.find((url) => url.includes('open-meteo'))).toContain('wind_speed_unit=ms');
    expect(urls.find((url) => url.includes('open-meteo'))).toContain('past_days=1');
    expect(urls.some((url) => url.includes('occurrence/search') && url.includes('month=11'))).toBe(
      true,
    );
    expect(urls.filter((url) => url.includes('occurrence/search'))).toHaveLength(4);
  });

  it('keeps the previous value when a refresh fails, and never throws', async () => {
    let failing = false;
    const { fetch } = network();
    const flaky: FeedFetch = async (url, init) => {
      if (failing) throw new Error('offline');
      return fetch(url, init);
    };
    const feeds = new LiveFeeds({ fetch: flaky, now: () => NOW });
    await feeds.refreshAll();
    const before = feeds.snapshot();
    failing = true;
    await expect(feeds.refreshAll()).resolves.toBeUndefined();
    expect(feeds.snapshot()).toEqual(before);
  });

  it('keeps the previous value on an error status, an oversized or a malformed response', async () => {
    const feeds = new LiveFeeds({ ...network(), now: () => NOW });
    await feeds.refreshAll();
    const before = feeds.snapshot();
    for (const response of [
      () => new Response('nope', { status: 503 }),
      () => new Response('{}', { headers: { 'content-length': '3000000' } }),
      () => new Response(`["${'x'.repeat(2_100_000)}"]`),
      () => new Response('not json'),
      () => new Response('{"current":{}}'),
    ]) {
      const bad = new LiveFeeds({
        fetch: network({ 'open-meteo': response }).fetch,
        now: () => NOW + 1,
      });
      expect(await bad.refresh('weather')).toBe(false);
      expect(bad.snapshot().weather).toBeUndefined();
    }
    expect(feeds.snapshot()).toEqual(before);
  });

  it('leaves out the trend when the history is unavailable and one part of space weather', async () => {
    const feeds = new LiveFeeds({
      fetch: network({
        '/measurements.json': () => new Response('x', { status: 500 }),
        'solar-wind-speed': () => new Response('x', { status: 500 }),
      }).fetch,
      now: () => NOW,
    });
    await feeds.refreshAll();
    expect(feeds.snapshot().river?.levelCm).toBe(141);
    expect(feeds.snapshot().river?.levelSixHoursEarlierCm).toBeUndefined();
    expect(feeds.snapshot().space?.kp).toBeDefined();
    expect(feeds.snapshot().space?.solarWind).toBeUndefined();
  });

  it('with LIVE_FEEDS off performs no fetch at all', async () => {
    const fetch = vi.fn<FeedFetch>();
    const feeds = new LiveFeeds({ enabled: false, fetch });
    feeds.start();
    await feeds.refreshAll();
    feeds.stop();
    expect(fetch).not.toHaveBeenCalled();
    expect(feeds.snapshot()).toEqual({});
  });

  it('starts refreshing in the background and stops cleanly', async () => {
    const { fetch, calls } = network();
    const feeds = new LiveFeeds({ fetch, now: () => NOW });
    feeds.start();
    await vi.waitFor(() => expect(feeds.snapshot().species).toBeDefined());
    feeds.stop();
    const count = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.length).toBe(count);
  });
});

describe('conditions from the weather feed', () => {
  const weather = parseWeather(fixture('open-meteo.json'), NOW);
  it('use the live wind and temperature while the value is fresh', () => {
    const live = worldConditions(NOW + 60 * 60_000, { weather });
    expect(live.windSpeed).toBe(4.08);
    expect(live.airTempC).toBe(5.9);
    // Reported as where it blows from; the world's bearing is where it blows to.
    expect(live.windBearingDeg).toBe(101);
  });
  it('fall back to the simulated values when stale or absent', () => {
    const at = NOW + 3 * 3_600_000;
    expect(worldConditions(at, { weather })).toEqual(worldConditions(at));
    expect(worldConditions(at, {})).toEqual(worldConditions(at));
    expect(worldConditions(NOW)).not.toEqual(worldConditions(NOW, { weather }));
  });
  it('never change the sun', () => {
    expect(worldConditions(NOW, { weather }).sunElevationDeg).toBe(
      worldConditions(NOW).sunElevationDeg,
    );
  });
});
