// A headless kick: the game's real ball physics, collisions and keeper body,
// with no screen. Used by the balance report (scripts/balance.mjs) and by
// acceptance tests that check keeping feels fair and reliable.
//
// The per-step order mirrors tick() in src/game.js: keeper decision ->
// keeper motion -> ball step with collisions -> judge.
import * as THREE from 'three';
import { createBallState, launchVelocity, stepBall } from '../physics/ball.js';
import { newShot, collideStep, judge } from '../physics/collisions.js';
import { makePerson, KITS, newKeeper, poseKeeper, planDive, updateKeeper, keeperSpheres } from '../render/people.js';

const H = 1 / 240;
let body = null;

// target: { x, y } on the goal line; T: flight time; spin: curl.
// keeperAct(time, keeper, ball): called every step after the strike; may dive.
// opts.maxShift: how far the keeper's feet can travel in a dive.
// opts.homeX: where the keeper stands (stepped off-centre before the shot).
// opts.preDive: { x, y, lead } a dive started `lead` seconds before the strike.
export function playKick(target, T, spin, keeperAct, rng, opts = {}) {
  body = body || makePerson(new THREE.Scene(), KITS.cpuKeeper);
  const keeper = newKeeper(body);
  keeper.active = true; keeper.maxShift = opts.maxShift ?? 1.85;
  keeper.homeX = opts.homeX ?? 0;
  keeper.x = keeper.homeX; keeper.y = 0; keeper.tilt = 0; keeper.arms = 0; poseKeeper(keeper);
  let time = 0;
  if (opts.preDive) {
    planDive(keeper, opts.preDive.x, opts.preDive.y);
    for (let t = 0; t < opts.preDive.lead; t += H) { time += H; updateKeeper(keeper, H, time); }
    time = 0;
  }
  const ball = createBallState();
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
