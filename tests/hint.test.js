import { describe, it, expect } from 'vitest';
import { shotHint, hintSkill } from '../src/ai/hint.js';
import { LEVELS } from '../src/ai/levels.js';
import { createRng } from '../src/core/random.js';

describe('keeper hint', () => {
  it('ranks the levels from easy to hard to read', () => {
    expect(hintSkill(LEVELS.amateur)).toBe(0);
    expect(hintSkill(LEVELS.pro)).toBeGreaterThan(0.5);
    expect(hintSkill(LEVELS.legend)).toBe(1);
  });

  it('always contains the real spot, whatever the level', () => {
    const rng = createRng(3);
    for (const skill of [0, 0.5, 1]) {
      for (let i = 0; i < 500; i++) {
        const t = { x: rng.range(-3.5, 3.5), y: rng.range(0.1, 2.4) };
        const h = shotHint(t, skill, rng);
        expect(Math.hypot(h.x - t.x, h.y - t.y)).toBeLessThan(h.r);
      }
    }
  });

  it('is bigger, vaguer and later against better opponents', () => {
    const easy = shotHint({ x: 2, y: 1 }, 0, createRng(1)), hard = shotHint({ x: 2, y: 1 }, 1, createRng(1));
    expect(hard.r).toBeGreaterThan(easy.r);
    expect(hard.delay).toBeGreaterThan(easy.delay);
    // on average the centre sits further from the spot
    const spread = (skill) => {
      const rng = createRng(5); let s = 0;
      for (let i = 0; i < 400; i++) { const h = shotHint({ x: 0, y: 1 }, skill, rng); s += Math.hypot(h.x, h.y - 1); }
      return s / 400;
    };
    expect(spread(1)).toBeGreaterThan(spread(0) * 3);
  });

  it('is the same for the same seed', () => {
    expect(shotHint({ x: 1, y: 1 }, 0.6, createRng(9))).toEqual(shotHint({ x: 1, y: 1 }, 0.6, createRng(9)));
  });
});
