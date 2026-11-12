import {
  act,
  angleDiff,
  bearingOf,
  control,
  numberOf,
  round,
  type Mechanism,
  type Scene,
} from './common.js';

/** Hidden: pigment colours and how strongly each tints a mix. */
const PIGMENTS = [
  { key: 'red', rgb: [196, 38, 38], strength: 1 },
  { key: 'yellow', rgb: [240, 200, 30], strength: 0.8 },
  { key: 'blue', rgb: [30, 60, 170], strength: 1.5 },
];
const VIEW_DEGREES = 40;
const MAX_THINGS = 6;
const REACH = 45;

const hex = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

/** Subtractive mixing: each pigment filters the light, and more paint darkens the mix. */
export function mixColour(parts: number[]): { hex: string; lightness: number } | undefined {
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total <= 0) return undefined;
  const weights = parts.map((part, i) => part * PIGMENTS[i].strength);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const darken = 1 / (1 + 0.04 * (total - 1));
  const [r, g, b] = [0, 1, 2].map(
    (channel) =>
      Math.exp(
        weights.reduce(
          (sum, weight, i) => sum + (weight / weightSum) * Math.log(PIGMENTS[i].rgb[channel]),
          0,
        ),
      ) * darken,
  );
  return {
    hex: `#${hex(r)}${hex(g)}${hex(b)}`,
    lightness: Math.round(((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 100),
  };
}

function view(scene: Scene | undefined, from: { x: number; z: number }, facing: number) {
  const things: Array<{ distance: number; text: string }> = [];
  const consider = (name: string, x: number, z: number, proportion: string) => {
    const dx = x - from.x;
    const dz = z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.4 || distance > REACH) return;
    if (Math.abs(angleDiff(bearingOf(dx, dz), facing)) > VIEW_DEGREES / 2) return;
    things.push({ distance, text: `${name}, ${round(distance)} m away, ${proportion}` });
  };
  for (const object of scene?.objects ?? []) {
    const width = object.footprint
      ? object.footprint.maxX - object.footprint.minX
      : 2 * object.radius;
    consider(
      object.name,
      object.position.x,
      object.position.z,
      `${round(width / Math.max(0.05, object.height))} wide to 1 tall`,
    );
  }
  for (const place of scene?.places ?? []) {
    const { minX, maxX, minZ, maxZ } = place.bounds;
    const at = place.entryPoint ?? { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    consider(
      place.name,
      at.x,
      at.z,
      `${round((maxX - minX) / Math.max(1, maxZ - minZ))} wide to 1 deep`,
    );
  }
  return things.sort((a, b) => a.distance - b.distance).slice(0, MAX_THINGS);
}

/** Illustration: three paints to mix, and a frame to hold up to the view. */
export const easel: Mechanism = {
  controls: [
    control('red', 'squeeze red paint onto the palette', 0, 10, 'parts of red'),
    control('yellow', 'squeeze yellow paint onto the palette', 0, 10, 'parts of yellow'),
    control('blue', 'squeeze blue paint onto the palette', 0, 10, 'parts of blue'),
    act('dab', 'stir the palette and dab the mixed paint on the board'),
    control('frame', 'hold up the frame toward a bearing', 0, 359, 'compass bearing in degrees'),
  ],
  run: ({ control: id, value, state, object, scene }) => {
    if (id === 'red' || id === 'yellow' || id === 'blue')
      return {
        reading: `The palette now holds ${value} ${value === 1 ? 'part' : 'parts'} of ${id}.`,
        state: { ...state, [id]: value as number },
      };
    const parts = PIGMENTS.map((pigment) => numberOf(state, pigment.key, 0));
    if (id === 'dab') {
      const mixed = mixColour(parts);
      const head = `With ${parts[0]} red, ${parts[1]} yellow and ${parts[2]} blue`;
      return {
        reading: mixed
          ? `${head} the dab comes out ${mixed.hex}, ${mixed.lightness}% light.`
          : `${head} there is nothing on the brush.`,
      };
    }
    const facing = value as number;
    const things = view(scene, object.position, facing);
    return {
      reading: things.length
        ? `Framing ${facing} degrees across a ${VIEW_DEGREES} degree view: ${things.map((thing) => thing.text).join('; ')}.`
        : `Framing ${facing} degrees across a ${VIEW_DEGREES} degree view: nothing but open ground.`,
    };
  },
};
