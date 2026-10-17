// Headless balance check: plays thousands of kicks with the game's real
// physics, collisions, keeper body and CPU decisions (no screen), and prints
// how often each side scores for every difficulty and style.
//
//   npm run balance
//
// The per-step order mirrors tick() in src/game.js: keeper decision ->
// keeper motion -> ball sub-steps with collisions -> judge.
import * as THREE from 'three';
import { createRng } from '../src/core/random.js';
import { KEEPER_Z, RUNUP, COMMIT, HALF } from '../src/core/constants.js';
import { createBallState, launchVelocity, stepBall, predictCrossing } from '../src/physics/ball.js';
import { newShot, collideStep, judge } from '../src/physics/collisions.js';
import { makePerson, KITS, newKeeper, poseKeeper, planDive, updateKeeper, keeperSpheres } from '../src/render/people.js';
import { keeperPlan, readDive } from '../src/ai/keeper.js';
import { planShot, reconsider, executeShot } from '../src/ai/taker.js';
import { LEVELS } from '../src/ai/levels.js';
import { STYLE_KEYS } from '../src/ai/styles.js';
import { flightTime } from '../src/input/swipe.js';

const PLAYER_SHIFT = +(process.env.SHIFT || 1.85);   // your keeper's dive reach (setupCpuKick)
const scene = new THREE.Scene();
const body = makePerson(scene, KITS.cpuKeeper);
const H = 1 / 240;

// One kick to its result. keeperAct(time, keeper, ball) is called every step
// and may start a dive. preDive: { x, y, lead } starts a dive `lead` seconds
// before the strike (a keeper who went during the run-up).
function playKick(target, T, spin, keeperAct, rng, maxShift, preDive = null) {
  const ball = createBallState();
  const keeper = newKeeper(body); keeper.active = true; keeper.maxShift = maxShift;
  keeper.x = 0; keeper.y = 0; keeper.tilt = 0; keeper.arms = 0; poseKeeper(keeper);
  let time = 0;
  if (preDive) {
    planDive(keeper, preDive.x, preDive.y);
    for (let t = 0; t < preDive.lead; t += H) { time += H; updateKeeper(keeper, H, time); }
    time = 0;
  }
  launchVelocity(ball.pos, new THREE.Vector3(target.x, target.y, 0), T, spin, ball.vel);
  ball.spin = spin; ball.moving = true;
  const shot = newShot(ball);
  for (let i = 0; i < 240 * 5; i++) {
    time += H;
    keeperAct(time, keeper, ball);
    updateKeeper(keeper, H, time);
    stepBall(ball, H);
    shot.cool -= H;
    collideStep(ball, shot, keeperSpheres(keeper), rng);
    shot.t += H;
    const kind = judge(shot, ball);
    if (kind) return kind;
  }
  return 'short';
}

// --- you shooting at the CPU keeper -------------------------------------
const PLAYERS = {
  // Aims anywhere in the goal with mixed power and occasional curl.
  average: (rng) => ({
    x: rng.sign() * rng.range(0.6, 3.4), y: rng.range(0.2, 2.2),
    power: rng.range(0.3, 1), curl: rng.chance(0.5) ? 0 : rng.range(-0.6, 0.6),
  }),
  // Goes for the corners with pace.
  skilled: (rng) => ({
    x: rng.sign() * rng.range(2.4, 3.4), y: rng.chance(0.5) ? rng.range(0.15, 0.5) : rng.range(1.8, 2.25),
    power: rng.range(0.65, 1), curl: rng.chance(0.6) ? 0 : rng.range(-0.5, 0.5),
  }),
};

function shootingRate(level, style, player, n, rng) {
  let goals = 0, onTarget = 0;
  for (let i = 0; i < n; i++) {
    const k = PLAYERS[player](rng);
    const T = flightTime(k.power), spin = k.curl * 28;
    const plan = keeperPlan(level, style, rng);
    let decided = false;
    const kind = playKick({ x: k.x, y: k.y }, T, spin, (time, keeper, ball) => {
      if (decided || time < plan.at) return;
      decided = true;
      const t = plan.kind === 'read' ? readDive(predictCrossing(ball, plan.readSpin), level, style, rng) : { x: plan.x, y: plan.y };
      planDive(keeper, t.x, t.y, t.speed);
    }, rng, level.shift);
    if (kind === 'goal') goals++;
    if (kind === 'goal' || kind === 'saved') onTarget++;
  }
  return { goal: goals / n, onTarget: onTarget / n };
}

// --- the CPU shooting at you ---------------------------------------------
// A player keeper who waits for the plant foot, then guesses a side
// (or follows the scouting tip `lean` of the time).
// react: instead of guessing, dive `react` seconds after the strike toward
// where the ball is heading (with `err` metres of misjudgement).
function cpuRate(level, style, n, rng, { early = 0, lean = 0, react = 0, err = 0.5, shift = PLAYER_SHIFT } = {}) {
  let goals = 0, onTarget = 0;
  for (let i = 0; i < n; i++) {
    let plan = planShot(style, rng);
    const diveAtRunup = rng.chance(early) ? rng.range(0.2, COMMIT - 0.05) : rng.range(COMMIT, RUNUP + 0.12);
    const side = rng.chance(lean) ? Math.sign(plan.x) || rng.sign() : rng.sign();
    const dive = { x: side * rng.range(1.8, 3.2), y: rng.range(0.3, 1.9) };
    if (diveAtRunup < COMMIT) plan = reconsider(plan, dive, style, level, rng);
    const k = executeShot(plan, style, level, rng);
    if (react) {
      let gone = false;
      const kind = playKick(k.target, k.T, k.spin, (time, keeper, ball) => {
        if (gone || time < react) return;
        gone = true;
        const c = predictCrossing(ball, 1);
        planDive(keeper, c.x + rng.gauss() * err, c.y + rng.gauss() * err * 0.6);
      }, rng, shift);
      if (kind === 'goal') goals++;
      if (k.onTarget) onTarget++;
      continue;
    }
    const lead = RUNUP - diveAtRunup;
    let dived = lead > 0;
    const kind = playKick(k.target, k.T, k.spin, (time, keeper) => {
      if (dived || time < -lead) return;
      dived = true;
      planDive(keeper, dive.x, dive.y);
    }, rng, shift, lead > 0 ? { ...dive, lead } : null);
    if (kind === 'goal') goals++;
    if (k.onTarget) onTarget++;
  }
  return { goal: goals / n, onTarget: onTarget / n };
}

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const N = +(process.argv[2] || 600);
const rng = createRng(2026);

console.log(`\nYour kicks: goal rate (on-target rate), ${N} kicks each\n`);
console.log('level     player    ' + ['balanced', ...STYLE_KEYS.filter((s) => s !== 'balanced')].map((s) => s.padEnd(12)).join(''));
for (const [name, level] of Object.entries(LEVELS)) {
  for (const player of Object.keys(PLAYERS)) {
    const cells = ['balanced', ...STYLE_KEYS.filter((s) => s !== 'balanced')].map((st) => {
      const r = shootingRate(level, st, player, N, rng);
      return `${pct(r.goal)} (${pct(r.onTarget).trim()})`.padEnd(12);
    });
    console.log(`${name.padEnd(10)}${player.padEnd(10)}${cells.join('')}`);
  }
}

console.log('\nSkilled player by shot height (goal rate)');
for (const [name, level] of Object.entries(LEVELS)) {
  const row = ['balanced', 'wall', 'reader'].map((st) => {
    const by = (lo, hi) => {
      let g = 0, n = 0;
      for (let i = 0; i < N; i++) {
        const k = { x: rng.sign() * rng.range(2.4, 3.4), y: rng.range(lo, hi), power: rng.range(0.65, 1) };
        const plan = keeperPlan(level, st, rng);
        let decided = false;
        const kind = playKick({ x: k.x, y: k.y }, flightTime(k.power), 0, (time, keeper, ball) => {
          if (decided || time < plan.at) return;
          decided = true;
          const t = plan.kind === 'read' ? readDive(predictCrossing(ball, plan.readSpin), level, st, rng) : { x: plan.x, y: plan.y };
          planDive(keeper, t.x, t.y, t.speed);
        }, rng, level.shift);
        n++; if (kind === 'goal') g++;
      }
      return pct(g / n);
    };
    return `${st}: low ${by(0.15, 0.5)} high ${by(1.8, 2.25)}`;
  });
  console.log(`${name.padEnd(10)}${row.join('   ')}`);
}

console.log(`\nCPU kicks: their goal rate (their on-target rate)\n`);
for (const [name, level] of Object.entries(LEVELS)) {
  const show = (r) => `${pct(r.goal)} (${pct(r.onTarget).trim()})`;
  const guess = cpuRate(level, 'balanced', N, rng);
  const early = cpuRate(level, 'trickster', N, rng, { early: 1 });
  const tip = cpuRate(level, 'rightFooted', N, rng, { lean: 0.8 });
  const react = cpuRate(level, 'balanced', N, rng, { react: 0.25, err: 0.5 });
  const sharp = cpuRate(level, 'balanced', N, rng, { react: 0.2, err: 0.3 });
  console.log(`${name.padEnd(10)} guess ${show(guess)}  early v tricksters ${show(early)}  tip ${show(tip)}  react ${show(react)}  sharp ${show(sharp)}`);
}
