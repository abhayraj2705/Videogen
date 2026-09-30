/** Pure easing functions, t in [0, 1] -> eased [0, 1]. No side effects, no time source. */

export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export const linear = (t: number): number => clamp01(t);

export const easeOutCubic = (t: number): number => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
};

export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export const easeOutBack = (t: number): number => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export const easeOutExpo = (t: number): number => {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
};

/** Maps global localT into a [0,1] progress within [start, end], eased. */
export function progress(
  localT: number,
  start: number,
  end: number,
  ease: (t: number) => number = linear,
): number {
  if (end <= start) return localT >= end ? 1 : 0;
  return ease(clamp01((localT - start) / (end - start)));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
