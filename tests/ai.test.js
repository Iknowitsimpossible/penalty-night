import { describe, it, expect } from 'vitest';
import { planShot, reconsider, executeShot } from '../src/ai/taker.js';
import { keeperPlan, readDive } from '../src/ai/keeper.js';
import { STYLES, STYLE_KEYS } from '../src/ai/styles.js';
import { createRng } from '../src/core/random.js';

const PRO = { react: 0.21, err: 0.55, shift: 1.7, gamble: 0.2, readSpin: 0.5, cpuErr: 0.42, reAim: 0.5 };
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

describe('opponent styles', () => {
  it('each style has a scouting hint', () => {
    for (const key of STYLE_KEYS) expect(STYLES[key].scout.length).toBeGreaterThan(20);
  });

  it('right-footed takers mostly shoot to the keeper\'s right (world -x)', () => {
    const rng = createRng(1);
    const plans = many(2000, () => planShot('rightFooted', rng)).filter((p) => !p.middle);
    const right = plans.filter((p) => p.x < 0).length / plans.length;
    expect(right).toBeGreaterThan(0.75);
  });

  it('high flyers aim high and low drivers aim low', () => {
    const rng = createRng(2);
    const avgY = (key) => {
      const plans = many(2000, () => planShot(key, rng)).filter((p) => !p.middle);
      return plans.reduce((s, p) => s + p.y, 0) / plans.length;
    };
    expect(avgY('highFlyer')).toBeGreaterThan(1.5);
    expect(avgY('powerLow')).toBeLessThan(0.7);
    expect(avgY('highFlyer')).toBeGreaterThan(avgY('balanced'));
  });

  it('a guesser keeper gambles far more often than the wall (which never does)', () => {
    const rng = createRng(3);
    const share = (key) => many(3000, () => keeperPlan(PRO, key, rng)).filter((p) => p.kind === 'gamble').length / 3000;
    expect(share('guesser')).toBeGreaterThan(0.4);
    expect(share('wall')).toBe(0);
  });

  it('the wall dives more accurately at low shots than high ones', () => {
    const rng = createRng(4);
    const spread = (y) => {
      const xs = many(3000, () => readDive({ x: 0, y }, PRO, 'wall', rng).x);
      return Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
    };
    expect(spread(0.3)).toBeLessThan(spread(2.0) * 0.5);
  });

  it('the reader always understands curl', () => {
    const plan = keeperPlan({ ...PRO, gamble: 0 }, 'reader', createRng(5));
    expect(plan).toMatchObject({ kind: 'read', readSpin: 1 });
  });
});

describe('taker commitment point', () => {
  it('never changes the plan when the keeper has not dived before the plant foot', () => {
    const rng = createRng(6);
    for (let i = 0; i < 500; i++) {
      const plan = planShot('trickster', rng);
      expect(reconsider(plan, null, 'trickster', PRO, rng)).toBe(plan);
    }
  });

  it('may switch away from an early dive, more often for tricksters', () => {
    const rng = createRng(7);
    const rate = (key) => many(4000, () => {
      const plan = { side: 1, x: 2.5, y: 1, middle: false, switched: false };
      return reconsider(plan, { x: 2.5 }, key, PRO, rng);
    });
    const balanced = rate('balanced'), tricks = rate('trickster');
    const share = (rs) => rs.filter((r) => r.switched).length / rs.length;
    expect(share(balanced)).toBeCloseTo(PRO.reAim, 1);
    expect(share(tricks)).toBeGreaterThan(share(balanced) + 0.25);
    // A switched shot never goes toward the dive.
    for (const r of tricks.filter((x) => x.switched)) expect(r.x).toBeLessThan(0.5);
  });

  it('executes the plan with the taker\'s error', () => {
    const rng = createRng(8);
    const plan = { side: -1, x: -2.5, y: 1, middle: false, switched: false };
    const xs = many(2000, () => executeShot(plan, 'balanced', PRO, rng).target.x);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeCloseTo(-2.5, 1);
  });
});
