import { useEffect, useRef, useState } from 'react';
const shapes = {
  arrow: [
    [4, 12, 20, 12],
    [14, 6, 20, 12],
    [14, 18, 20, 12],
  ],
  check: [
    [5, 12, 10, 17],
    [10, 17, 20, 6],
    [12, 12, 12, 12],
  ],
  close: [
    [6, 6, 18, 18],
    [18, 6, 6, 18],
    [12, 12, 12, 12],
  ],
};
/** Persistent lines interpolate from their current position, including interrupted transitions. */
export function MorphIcon({ state }: { state: keyof typeof shapes }) {
  const [lines, setLines] = useState(shapes[state]);
  const current = useRef(lines);
  useEffect(() => {
    const target = shapes[state];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const duration =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--ew-duration-panel'),
      ) || 0;
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const settle = () => {
      cancelAnimationFrame(frame);
      current.current = target;
      setLines(target);
    };
    if (reduce.matches || duration === 0) {
      settle();
      return;
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        eased = 1 - Math.pow(1 - t, 3);
      current.current = target.map((line, i) =>
        line.map((v, j) => from[i]![j]! + (v - from[i]![j]!) * eased),
      );
      setLines(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    reduce.addEventListener('change', settle);
    return () => {
      cancelAnimationFrame(frame);
      reduce.removeEventListener('change', settle);
    };
  }, [state]);
  return (
    <svg
      className="ew-morph-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {lines.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          opacity={Math.hypot(x2! - x1!, y2! - y1!) < 0.1 ? 0 : 1}
        />
      ))}
    </svg>
  );
}
