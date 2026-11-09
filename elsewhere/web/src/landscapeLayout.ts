import * as THREE from 'three';

/** Control points of each connected walk, including the approaches through both doorways. */
const trailRoutes = [
  [
    [3, 3],
    [-2, 7],
    [-8, 8.6],
    [-13, 11.5],
    [-17, 13],
  ],
  [
    [3, 3],
    [8, 5.8],
    [12, 8],
    [14, 11.5],
    [14, 16],
    [14, 20],
  ],
  [
    [3, 3],
    [2.2, -2],
    [2, -7.5],
    [-3, -8],
    [-9.5, -8.4],
    [-10, -13],
    [-10.8, -16.5],
    [-15, -17],
  ],
  [
    [3, 3],
    [7.8, 1],
    [10.2, -4],
    [12, -8],
    [18, -13],
    [22, -17],
  ],
  [
    [3, 3],
    [1.4, 1.2],
    [0, 0.2],
    [-3, 0],
  ],
] as const;

export const TRAIL_LINES = trailRoutes.map((route) => {
  const spline = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  return spline
    .getSpacedPoints(Math.ceil(spline.getLength() / 1.4))
    .map(({ x, z }) => [x, z] as const);
});
export const MEADOW_TRAILS = TRAIL_LINES.flatMap((line) =>
  line.slice(1).map((point, i) => [line[i], point] as const),
);

/** A continuous floor under the village rises into pasture, then wooded hills. */
export function landscapeHeight(radius: number, angle: number) {
  const t = THREE.MathUtils.smoothstep(radius, 43, 110);
  const ridge = 8.8 + Math.sin(angle * 3 + 0.8) * 3.6 + Math.sin(angle * 7 - 1) * 1.9;
  const range = 14 * THREE.MathUtils.smoothstep(radius, 105, 163);
  return (
    t * (ridge + 2.5 * Math.sin(radius * 0.075 + 4 * angle)) +
    range * (0.7 + 0.38 * Math.cos(angle * 8 + radius * 0.04))
  );
}
