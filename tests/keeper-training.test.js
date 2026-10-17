import { describe, it, expect } from 'vitest';
import { STAGES, startStage, drillPlan, recordAttempt, SHOTS_PER_STAGE } from '../src/practice/keeper-drills.js';
import { reconsider, executeShot } from '../src/ai/taker.js';
import { diveReport } from '../src/feedback/explain.js';
import { playKick } from '../src/sim/kick-sim.js';
import { planDive } from '../src/render/people.js';
import { predictCrossing } from '../src/physics/ball.js';
import { createRng } from '../src/core/random.js';
import { RUNUP, COMMIT } from '../src/core/constants.js';

const TRAINING_TAKER = (reAim = 0) => ({ cpuErr: 0.08, reAim, cpuPace: 0 });

describe('training stages', () => {
  it('passes a stage at three saves and fails it once three are out of reach', () => {
    const s = startStage(0, createRng(1));
    expect(recordAttempt(s, true)).toBe('continue');
    expect(recordAttempt(s, false)).toBe('continue');
    expect(recordAttempt(s, true)).toBe('continue');
    expect(recordAttempt(s, true)).toBe('passed');
    const f = startStage(0, createRng(1));
    recordAttempt(f, false); recordAttempt(f, false);
    expect(recordAttempt(f, false)).toBe('failed');   // 0 saves, 2 shots left
    expect(SHOTS_PER_STAGE).toBe(5);
  });

  it('shows the corner only in the first stage and keeps one corner in the second', () => {
    const rng = createRng(2);
    expect(drillPlan(startStage(0, rng), rng).shown).toBe(true);
    const s = startStage(1, rng);
    const corners = new Set();
    for (let i = 0; i < 5; i++) { s.attempt = i; const p = drillPlan(s, rng); corners.add(`${p.x},${p.y}`); expect(p.shown).toBe(false); }
    expect(corners.size).toBe(1);
  });

  it('fixes the flight time from the drill', () => {
    const k = executeShot({ x: 2, y: 1, side: 1, T: 0.81 }, 'balanced', TRAINING_TAKER(), createRng(3));
    expect(k.T).toBe(0.81);
  });
});

describe('positioning: the taker reads a lean', () => {
  const plan = { side: -1, x: -2.5, y: 1, middle: false, switched: false };
  it('ignores a small step or a lean away from the planned side', () => {
    const rng = createRng(4);
    for (let i = 0; i < 200; i++) {
      expect(reconsider(plan, null, 'balanced', { reAim: 1 }, rng, -0.2)).toBe(plan);
      expect(reconsider(plan, null, 'balanced', { reAim: 1 }, rng, 0.9)).toBe(plan);
    }
  });
  it('sometimes switches away from a clear lean toward their side, less often than from an early dive', () => {
    const rng = createRng(5);
    const rate = (fn) => Array.from({ length: 4000 }, fn).filter((p) => p.switched).length / 4000;
    const lean = rate(() => reconsider(plan, null, 'balanced', { reAim: 0.5 }, rng, -1));
    const dive = rate(() => reconsider(plan, { x: -2.5 }, 'balanced', { reAim: 0.5 }, rng));
    expect(lean).toBeGreaterThan(0.1);
    expect(lean).toBeLessThan(dive);
  });
});

describe('dive report', () => {
  it('says when you dived relative to the strike and how far off you were', () => {
    const shot = { x: -2.6, y: 0.4 };
    expect(diveReport({ x: -2.6, y: 0.9, at: RUNUP + 0.12, early: false }, shot)).toBe('You dived 0.12 s after the strike, 0.5 m from the ball.');
    expect(diveReport({ x: 2, y: 1, at: COMMIT - 0.2, early: true }, shot)).toMatch(/before the gold bar/);
    expect(diveReport(null, shot)).toBe('You did not dive.');
  });
});

// Acceptance: a keeper who plays each stage the way its instructions say
// saves reliably. Uses the real physics, keeper body and collisions.
describe('acceptance: deliberate keeping saves predictable shots', () => {
  const N = 150;
  const saveRate = (stageIndex, keeperAct, opts = {}) => {
    const rng = createRng(100 + stageIndex);
    const st = startStage(stageIndex, rng);
    let saves = 0;
    for (let i = 0; i < N; i++) {
      st.attempt = i % 5;
      const plan = drillPlan(st, rng);
      const k = executeShot(plan, 'balanced', TRAINING_TAKER(), rng);
      if (playKick(k.target, k.T, k.spin, keeperAct(plan, rng), rng, opts) === 'saved') saves++;
    }
    return saves / N;
  };
  // Dive at `at` seconds after the strike toward a known corner, with a little aiming error.
  const toCorner = (at) => (plan, rng) => { let gone = false; return (t, kp) => { if (gone || t < at) return; gone = true; planDive(kp, plan.x + rng.gauss() * 0.3, plan.y + rng.gauss() * 0.2); }; };
  // React to the ball after `r` seconds, misjudging by a little.
  const react = (r) => (plan, rng) => { let gone = false; return (t, kp, ball) => { if (gone || t < r) return; gone = true; const c = predictCrossing(ball, 1); planDive(kp, c.x + rng.gauss() * 0.4, c.y + rng.gauss() * 0.25); }; };
  // Pass probability for "3 of 5" at a given save rate.
  const pass = (p) => [3, 4, 5].reduce((s, k) => s + [1, 5, 10, 10, 5, 1][k] * p ** k * (1 - p) ** (5 - k), 0);

  it('stage 1: diving to the shown corner at the strike', () => {
    const p = saveRate(0, toCorner(0.05));
    expect(p).toBeGreaterThan(0.75);
    expect(pass(p)).toBeGreaterThan(0.9);
  }, 30000);

  it('stage 2: once the corner is known', () => {
    expect(saveRate(1, toCorner(0.05))).toBeGreaterThan(0.75);
  }, 30000);

  it('stages 3 and 4: reacting to the ball in about a quarter of a second', () => {
    expect(saveRate(2, react(0.27))).toBeGreaterThan(0.6);
    expect(saveRate(3, react(0.25))).toBeGreaterThan(0.5);
  }, 30000);

  it('stage 5: using the habit (step toward it, dive at the strike)', () => {
    const habit = { x: -2.6, y: 0.4 };
    const p = saveRate(4, (plan, rng) => toCorner(0.05)(habit, rng), { homeX: -0.8 });
    expect(p).toBeGreaterThan(0.55);
  }, 30000);
});
