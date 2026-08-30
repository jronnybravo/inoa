/** Deterministic randomness — the same seed always produces the same run. */

export interface Rng {
  (): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  sample<T>(items: readonly T[], n: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Sample `n` items without replacement, each item's chance proportional to
   * its weight. Strong candidates usually appear; weak ones sometimes do.
   *
   * This is what makes changing the seed change the *material* of a run rather
   * than only the order it is assembled in. Taking a deterministic top-N by
   * score meant every seed drew the same roots and the same words.
   */
  weighted<T>(items: readonly T[], weight: (item: T) => number, n: number): T[];
  chance(p: number): boolean;
}

/** mulberry32 — small, fast, good enough for combinatorial search. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = next as Rng;
  rng.int = (maxExclusive: number) => Math.floor(next() * Math.max(1, maxExclusive));
  rng.pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('pick() from empty list');
    return items[rng.int(items.length)] as T;
  };
  rng.shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const a2 = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = a2;
    }
    return copy;
  };
  rng.sample = <T,>(items: readonly T[], n: number): T[] => rng.shuffle(items).slice(0, n);
  // Efraimidis-Spirakis: key each item as random^(1/weight) and take the
  // largest keys. One pass, no replacement, exactly proportional to weight.
  rng.weighted = <T,>(items: readonly T[], weight: (item: T) => number, n: number): T[] =>
    items
      .map((item) => {
        const w = Math.max(1e-6, weight(item));
        return { item, key: Math.pow(next(), 1 / w) };
      })
      .sort((a, b) => b.key - a.key)
      .slice(0, Math.max(0, n))
      .map((entry) => entry.item);
  rng.chance = (p: number) => next() < p;
  return rng;
}
