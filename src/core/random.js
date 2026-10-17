// A seedable random number generator (mulberry32). Gameplay decisions use it
// so a test can replay exactly the same keeper guesses and simulated cup
// results by passing the same seed. Purely visual randomness (confetti,
// crowd colours) keeps using Math.random.
export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[(next() * arr.length) | 0],
    // Standard normal sample (Box-Muller).
    gauss() {
      let u = 0, v = 0;
      while (!u) u = next();
      while (!v) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return rng;
}
