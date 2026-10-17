// Acceptance: what the game decides matches what the keeper's body does.
// A grid of shots against a real keeper (the same body, dive and collision
// spheres the game uses), stepped in lockstep with the ball at 240 Hz.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createBallState, launchVelocity, stepBall } from '../src/physics/ball.js';
import { newShot, coolDown, collideStep, judge } from '../src/physics/collisions.js';
import { makePerson, KITS, newKeeper, poseKeeper, planDive, updateKeeper, keeperSpheres } from '../src/render/people.js';
import { createRng } from '../src/core/random.js';
import { POST_R, R, HALF, GOAL_H } from '../src/core/constants.js';
import { SWIPE } from '../src/input/swipe.js';

const H = 1 / 240;
const TOL = 0.005;
const body = makePerson(new THREE.Scene(), KITS.cpuKeeper);

// How deep the ball is inside the nearest keeper sphere (> 0 means overlapping).
function deepest(pos, spheres) {
  let depth = -Infinity;
  for (const s of spheres) depth = Math.max(depth, s.r + R - s.c.distanceTo(pos));
  return depth;
}

// One kick with a diving keeper. dive: { x, y } the keeper dives to, `at`
// seconds after the strike.
function playWithKeeper({ target, T, spin = 0, dive, at = 0.05, seed = 1 }) {
  const k = newKeeper(body);
  k.active = true; poseKeeper(k);
  const ball = createBallState();
  launchVelocity(ball.pos, new THREE.Vector3(target.x, target.y, 0), T, spin, ball.vel);
  ball.spin = spin; ball.moving = true;
  const shot = newShot(ball);
  const rng = createRng(seed);
  const before = new THREE.Vector3();
  let overlapped = false, touchDepth = null, time = 0;
  for (let i = 0; i < 240 * 5; i++) {
    time += H;
    if (dive && !k.dive && time >= at) planDive(k, dive.x, dive.y);
    updateKeeper(k, H, time);
    stepBall(ball, H);
    const spheres = keeperSpheres(k);
    before.copy(ball.pos);
    if (deepest(before, spheres) > 0) overlapped = true;
    const hadTouch = !!shot.touchAt;
    coolDown(shot, H);
    collideStep(ball, shot, spheres, rng);
    // The step the save was decided: was the ball really against the body?
    if (!hadTouch && shot.touchAt) touchDepth = deepest(before, spheres);
    shot.t += H;
    const kind = judge(shot, ball);
    if (kind) return { kind, shot, overlapped, touchDepth };
  }
  return { kind: 'short', shot, overlapped, touchDepth };
}

// high / low / close to the keeper, each left / centre / right, at two speeds,
// with the keeper diving toward the shot and away from it.
const SHOTS = [];
for (const [height, y, xs] of [['low', 0.25, [-2.8, 0, 2.8]], ['high', 2.1, [-2.8, 0, 2.8]], ['close', 1.0, [-0.7, 0, 0.7]]]) {
  for (const x of xs) for (const T of [0.5, 0.7]) {
    const away = x === 0 ? 2.6 : -x;
    SHOTS.push({ name: `${height} x=${x} T=${T} keeper toward`, target: { x, y }, T, dive: { x: x + 0.2, y } });
    SHOTS.push({ name: `${height} x=${x} T=${T} keeper away`, target: { x, y }, T, dive: { x: away, y } });
  }
}

describe('acceptance: results match the keeper body', () => {
  const results = SHOTS.map((s, i) => ({ ...s, ...playWithKeeper({ ...s, seed: 10 + i }) }));

  it('every save happened with the ball touching a keeper sphere on that step', () => {
    const saves = results.filter((r) => r.kind === 'saved');
    expect(saves.length).toBeGreaterThan(5);
    for (const r of saves) expect(r.touchDepth, r.name).toBeGreaterThan(-TOL);
  });

  it('a goal never went through the keeper', () => {
    const goals = results.filter((r) => r.kind === 'goal');
    expect(goals.length).toBeGreaterThan(5);
    for (const r of goals) expect(r.overlapped && !r.shot.touched, r.name).toBe(false);
  });

  it('a keeper diving the wrong way never stops a corner shot', () => {
    for (const r of results.filter((s) => s.name.includes('away') && Math.abs(s.target.x) > 2)) {
      expect(r.kind, r.name).toBe('goal');
    }
  });
});

// Why the ball needs no swept (continuous) collision test: in one 240 Hz
// step even the fastest kick moves less than the thinnest thing it can hit,
// so it cannot jump from one side of a post to the other between checks.
describe('no tunnelling at 240 Hz', () => {
  it('the fastest kick moves less in one step than the width of a post', () => {
    const fastestT = Math.min(SWIPE.hardT, 0.42);   // 0.42 s: the CPU's quickest flight time
    let maxStep = 0;
    // Anything aimed further out than this cannot reach the frame or the keeper.
    for (const x of [-HALF - 0.8, 0, HALF + 0.8]) for (const y of [R, GOAL_H + 0.5]) for (const spin of [-SWIPE.maxSpin, 0, SWIPE.maxSpin]) {
      const ball = createBallState();
      launchVelocity(ball.pos, new THREE.Vector3(x, y, 0), fastestT, spin, ball.vel);
      ball.spin = spin;
      for (let t = 0; t < fastestT; t += H) { maxStep = Math.max(maxStep, ball.vel.length() * H); stepBall(ball, H); }
    }
    // A post blocks the ball's centre over a width of 2 * (POST_R + R) = 34 cm.
    // Keeper spheres are wider still (the thinnest, a forearm, is 38 cm).
    expect(maxStep).toBeLessThan(2 * (POST_R + R));
    expect(maxStep).toBeLessThan(0.15);   // about 13 cm in practice: a wide margin
  });
});
