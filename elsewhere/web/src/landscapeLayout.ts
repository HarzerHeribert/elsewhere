/** Shared trail geometry and planting exclusions. Coordinates are world metres. */
export const MEADOW_TRAILS = [
  [
    [3, 3],
    [-2, 7],
  ],
  [
    [-2, 7],
    [-17, 13],
  ],
  [
    [3, 3],
    [12, 8],
  ],
  [
    [12, 8],
    [14, 16],
  ],
  [
    [3, 3],
    [2, -8],
  ],
  [
    [2, -8],
    [-10, -8],
  ],
  [
    [-10, -8],
    [-10, -17],
  ],
  [
    [-10, -17],
    [-15, -17],
  ],
  [
    [3, 3],
    [8, 1],
  ],
  [
    [8, 1],
    [12, -8],
  ],
  [
    [12, -8],
    [22, -17],
  ],
  [
    [3, 3],
    [-3, 0],
  ],
] as const;

/** The forest bases and distant terrain use the same ridge profile. */
export function landscapeHeight(radius: number, angle: number) {
  const t = Math.max(0, Math.min(1, (radius - 61) / 164));
  const envelope = Math.sin(t * Math.PI);
  const ridge =
    13 + Math.sin(angle * 3 + 0.8) * 5 + Math.sin(angle * 7 - 1) * 3 + Math.cos(angle * 11) * 1.5;
  return -0.57 + Math.max(0, envelope) * ridge;
}
