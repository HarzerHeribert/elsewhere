/**
 * The real sky over Elsewhere, which lies at latitude 51.0 N, longitude 10.0 E. Everything here
 * is pure astronomy from a UTC time in milliseconds; bearings follow the code's convention
 * (0 = north = toward -z, 90 = east = toward +x).
 */
export const LATITUDE = 51;
export const LONGITUDE = 10;
const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const norm360 = (value: number) => ((value % 360) + 360) % 360;
const norm180 = (value: number) => norm360(value + 180) - 180;

/** Days since J2000.0 (2000-01-01 12:00 UT), with the fraction. */
export const daysSinceJ2000 = (now: number) => now / MS_PER_DAY + 2440587.5 - 2451545.0;

/** Greenwich mean sidereal time in degrees. */
export const greenwichSiderealDeg = (now: number) =>
  norm360(280.46061837 + 360.98564736629 * daysSinceJ2000(now));
/** Local sidereal time in degrees at Elsewhere. */
export const localSiderealDeg = (now: number) => norm360(greenwichSiderealDeg(now) + LONGITUDE);

/** Obliquity of the ecliptic in degrees. */
const obliquity = (n: number) => 23.439291 - 0.0000004 * n;

/** Right ascension and declination (degrees) of an ecliptic longitude and latitude (degrees). */
export function eclipticToEquatorial(lambdaDeg: number, betaDeg: number, n: number) {
  const eps = obliquity(n) * RAD;
  const lambda = lambdaDeg * RAD;
  const beta = betaDeg * RAD;
  const ra = Math.atan2(
    Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps),
    Math.cos(lambda),
  );
  const dec = Math.asin(
    Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda),
  );
  return { raDeg: norm360(ra / RAD), decDeg: dec / RAD };
}

/** Elevation and bearing (degrees) of a point on the sky for the local sidereal time. */
export function horizontalOf(raDeg: number, decDeg: number, now: number) {
  const hour = (localSiderealDeg(now) - raDeg) * RAD;
  const dec = decDeg * RAD;
  const lat = LATITUDE * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD;
  const south = Math.atan2(
    Math.sin(hour),
    Math.cos(hour) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
  );
  return { elevationDeg, bearingDeg: norm360(south / RAD + 180) };
}

/** The sun: ecliptic longitude, equatorial position, equation of time (minutes). */
export function sunPosition(now: number) {
  const n = daysSinceJ2000(now);
  const meanLongitude = norm360(280.46 + 0.9856474 * n);
  const anomaly = norm360(357.528 + 0.9856003 * n) * RAD;
  const lambda = meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly);
  const { raDeg, decDeg } = eclipticToEquatorial(lambda, 0, n);
  const equationOfTimeMin = norm180(meanLongitude - raDeg) * 4;
  return { lambdaDeg: norm360(lambda), raDeg, decDeg, equationOfTimeMin };
}

/** The real sun over Elsewhere at a UTC time. */
export function sunHorizontal(now: number) {
  const { raDeg, decDeg } = sunPosition(now);
  return horizontalOf(raDeg, decDeg, now);
}

/** Bearing at which a body of the given declination rises (geometric horizon, flat ground). */
export const risingBearing = (decDeg: number) =>
  Math.acos(Math.sin(decDeg * RAD) / Math.cos(LATITUDE * RAD)) / RAD;
/** Obliquity at the solstices. */
export const SOLSTICE_DECLINATION = 23.44;

/** The moon, a simple model: ecliptic longitude and latitude from the mean orbit and its main terms. */
export function moonPosition(now: number) {
  const n = daysSinceJ2000(now);
  const meanLongitude = norm360(218.316 + 13.176396 * n);
  const anomaly = norm360(134.963 + 13.064993 * n) * RAD;
  const node = norm360(93.272 + 13.22935 * n) * RAD;
  const lambda = norm360(meanLongitude + 6.289 * Math.sin(anomaly));
  const beta = 5.128 * Math.sin(node);
  const { raDeg, decDeg } = eclipticToEquatorial(lambda, beta, n);
  const elongation = norm360(lambda - sunPosition(now).lambdaDeg);
  return { raDeg, decDeg, elongationDeg: elongation, lit: (1 - Math.cos(elongation * RAD)) / 2 };
}
export const SYNODIC_MONTH_DAYS = 29.53;
export const SIDEREAL_MONTH_DAYS = 27.32;

/** The phase in words, for a lit fraction and whether it is growing. */
export function phaseWords(elongationDeg: number): string {
  const lit = (1 - Math.cos(elongationDeg * RAD)) / 2;
  const growing = elongationDeg < 180;
  const side = growing ? 'lit on its right' : 'lit on its left';
  if (lit < 0.03) return 'a dark disc, barely there';
  if (lit < 0.3) return `a thin crescent, ${side}`;
  if (lit < 0.45) return `a fat crescent, ${side}`;
  if (lit < 0.58) return `half lit, ${side}`;
  if (lit < 0.85) return `more than half lit, ${side}`;
  if (lit < 0.97) return `nearly full, ${side}`;
  return 'full';
}

export interface Star {
  name: string;
  /** What a star chart prints beside it: Bayer designation. */
  label: string;
  raHours: number;
  decDeg: number;
  magnitude: number;
  colour: string;
}
export const STARS: Star[] = [
  {
    name: 'Polaris',
    label: 'α UMi',
    raHours: 2.5303,
    decDeg: 89.264,
    magnitude: 2.0,
    colour: 'yellow-white',
  },
  {
    name: 'Vega',
    label: 'α Lyr',
    raHours: 18.6156,
    decDeg: 38.784,
    magnitude: 0.03,
    colour: 'blue-white',
  },
  {
    name: 'Deneb',
    label: 'α Cyg',
    raHours: 20.6906,
    decDeg: 45.28,
    magnitude: 1.25,
    colour: 'white',
  },
  {
    name: 'Altair',
    label: 'α Aql',
    raHours: 19.8464,
    decDeg: 8.868,
    magnitude: 0.76,
    colour: 'white',
  },
  {
    name: 'Capella',
    label: 'α Aur',
    raHours: 5.2781,
    decDeg: 45.998,
    magnitude: 0.08,
    colour: 'yellow',
  },
  {
    name: 'Aldebaran',
    label: 'α Tau',
    raHours: 4.5986,
    decDeg: 16.509,
    magnitude: 0.86,
    colour: 'orange',
  },
  {
    name: 'Betelgeuse',
    label: 'α Ori',
    raHours: 5.9194,
    decDeg: 7.407,
    magnitude: 0.5,
    colour: 'orange-red',
  },
  {
    name: 'Rigel',
    label: 'β Ori',
    raHours: 5.2422,
    decDeg: -8.202,
    magnitude: 0.13,
    colour: 'blue-white',
  },
  {
    name: 'Sirius',
    label: 'α CMa',
    raHours: 6.7525,
    decDeg: -16.716,
    magnitude: -1.46,
    colour: 'white',
  },
  {
    name: 'Procyon',
    label: 'α CMi',
    raHours: 7.655,
    decDeg: 5.225,
    magnitude: 0.34,
    colour: 'yellow-white',
  },
  {
    name: 'Arcturus',
    label: 'α Boo',
    raHours: 14.2611,
    decDeg: 19.182,
    magnitude: -0.05,
    colour: 'orange',
  },
  {
    name: 'Spica',
    label: 'α Vir',
    raHours: 13.42,
    decDeg: -11.161,
    magnitude: 0.97,
    colour: 'blue-white',
  },
  {
    name: 'Regulus',
    label: 'α Leo',
    raHours: 10.1394,
    decDeg: 11.967,
    magnitude: 1.35,
    colour: 'blue-white',
  },
  {
    name: 'Antares',
    label: 'α Sco',
    raHours: 16.49,
    decDeg: -26.432,
    magnitude: 1.06,
    colour: 'red',
  },
];
export const starHorizontal = (star: Star, now: number) =>
  horizontalOf(star.raHours * 15, star.decDeg, now);

/** The bright wanderer (meant to be Jupiter): on the ecliptic in the Lion, a few degrees from Regulus, in mid-November 2026. */
const WANDERER_EPOCH = Date.UTC(2026, 10, 15);
const WANDERER_LONGITUDE = 145;
export const WANDERER_DRIFT_PER_DAY = 0.083;
export function wandererPosition(now: number) {
  const lambda =
    WANDERER_LONGITUDE + (WANDERER_DRIFT_PER_DAY * (now - WANDERER_EPOCH)) / MS_PER_DAY;
  return eclipticToEquatorial(lambda, 0, daysSinceJ2000(now));
}

/** Four small points that circle the wanderer: real periods (days) and orbit radii (planet radii). */
export const WANDERER_MOONS = [
  { periodDays: 1.769, radius: 5.9, phase: 0.6 },
  { periodDays: 3.551, radius: 9.4, phase: 2.9 },
  { periodDays: 7.155, radius: 15.0, phase: 4.4 },
  { periodDays: 16.689, radius: 26.4, phase: 1.3 },
];
/**
 * East(+)/west(-) offsets from the planet's centre in planet radii, and whether the point is
 * hidden by (or lost against) the disc.
 */
export function wandererMoonOffsets(now: number) {
  const days = (now - WANDERER_EPOCH) / MS_PER_DAY;
  return WANDERER_MOONS.map((moon) => {
    const angle = (2 * Math.PI * days) / moon.periodDays + moon.phase;
    const offset = moon.radius * Math.sin(angle);
    const inFront = Math.cos(angle) < 0;
    return { offset, hidden: Math.abs(offset) < 1, inFront };
  });
}
