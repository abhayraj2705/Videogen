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

export const easeOutQuint = (t: number): number => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 5);
};

export const easeInCubic = (t: number): number => {
  const x = clamp01(t);
  return x * x * x;
};

export const easeInOutQuart = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

/**
 * Closed-form underdamped spring, t in [0, 1] -> [0, ~1.1] (overshoots, then
 * settles on exactly 1 at t = 1). `damping` is the damping ratio (lower =
 * bouncier), `freq` the number of oscillations across the unit interval.
 * Pure in t — no integration step, so seek(t) stays deterministic.
 */
export function spring(t: number, damping = 0.62, freq = 1.4): number {
  const x = clamp01(t);
  if (x === 0) return 0;
  if (x === 1) return 1;
  const w0 = 2 * Math.PI * freq;
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * x) * (Math.cos(wd * x) + ((damping * w0) / wd) * Math.sin(wd * x));
}

/** Default spring as an easing function (for progress()). */
export const easeSpring = (t: number): number => spring(t);

/** Softer spring: a single small overshoot. */
export const easeSpringSoft = (t: number): number => spring(t, 0.78, 1.1);

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
