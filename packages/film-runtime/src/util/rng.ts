/**
 * Deterministic, seeded RNG. Scene templates must never call Math.random() —
 * the purity test re-seeks the same t twice and expects identical pixels.
 */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good-enough distribution for visual jitter. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates a scene-scoped rng(seedKey) function, per the FilmContext.rng contract. */
export function createSceneRng(sceneSeed: string): (seedKey: string) => number {
  const cache = new Map<string, () => number>();
  return (seedKey: string) => {
    const key = `${sceneSeed}:${seedKey}`;
    let gen = cache.get(key);
    if (!gen) {
      gen = mulberry32(hashString(key));
      cache.set(key, gen);
    }
    return gen();
  };
}
