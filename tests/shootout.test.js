import { describe, it, expect } from 'vitest';
import { shootoutWinner, simulateShootout, nextKicker } from '../src/rules/shootout.js';
import { createRng } from '../src/core/random.js';

// Shorthand: 'x' = scored, 'o' = missed.
const k = (s) => [...s].map((c) => c === 'x');

describe('shootoutWinner', () => {
  it('is undecided while both sides can still catch up', () => {
    expect(shootoutWinner(k('xx'), k('o'))).toBe(null);
    expect(shootoutWinner(k('xxx'), k('oo'))).toBe(null); // cpu still has 3 kicks: could reach 3
  });

  it('ends early once a side cannot catch up', () => {
    expect(shootoutWinner(k('xxx'), k('ooo'))).toBe('you'); // cpu max 2 < 3
    expect(shootoutWinner(k('ooo'), k('xxx'))).toBe('cpu');
    expect(shootoutWinner(k('oooo'), k('xx'))).toBe('cpu'); // you max 1 < 2, before cpu's 3rd kick
  });

  it('decides after five each when the score differs', () => {
    expect(shootoutWinner(k('xxxxo'), k('xxxoo'))).toBe('you');
    expect(shootoutWinner(k('xxxxo'), k('xxxxo'))).toBe(null);
  });

  it('plays sudden death in pairs', () => {
    const five = k('xxxxo');
    expect(shootoutWinner([...five, true], five)).toBe(null); // cpu must answer
    expect(shootoutWinner([...five, true], [...five, false])).toBe('you');
    expect(shootoutWinner([...five, false], [...five, true])).toBe('cpu');
    expect(shootoutWinner([...five, true, false], [...five, true, false])).toBe(null);
  });

  it('alternates kickers, you first', () => {
    expect(nextKicker([], [])).toBe('you');
    expect(nextKicker([true], [])).toBe('cpu');
  });
});

describe('simulateShootout', () => {
  it('follows the same rules as a played match', () => {
    const rng = createRng(42);
    for (let i = 0; i < 2000; i++) {
      const r = simulateShootout(rng.range(0.4, 0.95), rng.range(0.4, 0.95), rng);
      // Every prefix before the end is undecided; the end is decided for the right side.
      for (let n = 1; n < r.a.length + r.b.length; n++) {
        const na = Math.ceil(n / 2), nb = Math.floor(n / 2);
        expect(shootoutWinner(r.a.slice(0, na), r.b.slice(0, nb))).toBe(null);
      }
      expect(shootoutWinner(r.a, r.b)).toBe(r.winner === 'a' ? 'you' : 'cpu');
      expect(r.ga).not.toBe(r.gb);
    }
  });

  it('can end early, like a played match', () => {
    const rng = createRng(1);
    const r = simulateShootout(1, 0, rng); // A always scores, B always misses
    expect(r.a.length).toBe(3);
    expect(r.b.length).toBe(3);
    expect([r.ga, r.gb]).toEqual([3, 0]);
  });

  it('is reproducible with the same seed', () => {
    const a = simulateShootout(0.7, 0.7, createRng(7));
    const b = simulateShootout(0.7, 0.7, createRng(7));
    expect(a).toEqual(b);
  });
});
