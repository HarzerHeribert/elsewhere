/**
 * The world's design language. Every authored surface is one of: the three scanned
 * building materials (stone, timber, roof tile), a wood tone of that same timber scan,
 * a paint from this palette, or brass / iron / glass. No model brings its own palette.
 */
export const WORLD_PALETTE = {
  // Paints. The same four colours carry shutters, awnings, furniture, signs and tools.
  forest: 0x31594c,
  mint: 0x739989,
  cream: 0xf0dfb8,
  clay: 0xb26946,
  // Small goods.
  paper: 0xf4efdf,
  linen: 0xe4d7ba,
  soil: 0x4a3f30,
  terracotta: 0xb9714d,
  // Metals and light.
  brass: 0xc99b53,
  iron: 0x353b39,
  lamplight: 0xffc98a,
  gem: 0xe9b95c,
  // Planting.
  leaf: 0x55803f,
  leafDeep: 0x35602f,
  poppy: 0xd4553a,
  buttercup: 0xe7c64f,
  blossom: 0xf1e4d6,
  water: 0x3f7a78,
} as const;
export type WorldPaint = keyof typeof WORLD_PALETTE;

/** Linear multipliers over the weathered-plank scan, so all joinery shares one grain. */
export const WOOD_TONES = {
  oak: [4.3, 3.7, 2.5],
  walnut: [2.3, 1.85, 1.45],
  weathered: [2.9, 2.75, 2.45],
  cladding: [3.1, 2.45, 1.85],
} as const satisfies Record<string, readonly [number, number, number]>;
export type WoodTone = keyof typeof WOOD_TONES;

/** Human-readable names and uses, shown in the design-system reference. */
export const WORLD_PAINT_USES: ReadonlyArray<readonly [WorldPaint, string, string]> = [
  ['forest', 'Forest', 'Frames, posts, bench ironwork, the mailbox'],
  ['mint', 'Mint', 'Shutters, the library awning, cushions'],
  ['cream', 'Cream', 'Gables, awning stripes, sign faces'],
  ['clay', 'Clay', 'The workshop awning, chimney pots, seats'],
  ['brass', 'Brass', 'Instruments, handles, the sundial'],
  ['iron', 'Iron', 'Lanterns, brackets, hinges'],
  ['lamplight', 'Lamplight', 'The only emissive colour'],
  ['poppy', 'Poppy', 'Border flowers'],
  ['buttercup', 'Buttercup', 'Meadow flowers'],
  ['leaf', 'Leaf', 'Hand-shaped foliage and lily pads'],
  ['water', 'Water', 'The pond'],
  ['paper', 'Paper', 'Pages, plans, canvas'],
];

/** Book spines and other small painted goods draw from the paints, never from new hues. */
export const SPINE_COLORS = [0x6d8265, 0xba896c, 0xd3bf8a, 0x8d9e9c, 0x99583f, 0x31594c, 0xe6dcc3];

/** Human scale, in metres. A resident stands about 1.7 m; furniture follows from that. */
export const WORLD_SCALE = {
  seat: 0.45,
  table: 0.76,
  workTop: 0.95,
  lantern: 2.2,
  sign: 1.15,
} as const;

/** One stable afternoon: a warm key, a cool sky fill and matching haze. */
export const WORLD_LIGHT = {
  sun: 0xffe2bd,
  sunIntensity: 3.2,
  /** Polar angle from the zenith and azimuth, in degrees. */
  sunPolar: 50,
  sunAzimuth: 225,
  sky: 0xcfe2ff,
  ground: 0x8e9a72,
  fillIntensity: 1.1,
  environmentIntensity: 0.65,
  haze: 0xcfe1e4,
  hazeNear: 110,
  hazeFar: 265,
  exposure: 0.76,
} as const;
