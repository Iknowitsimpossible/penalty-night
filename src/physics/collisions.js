// What the ball hits after the kick: posts and bar, the keeper, the goal
// line, the net and the ad boards. Then judge() decides the result.
// Sounds and visuals are passed in as callbacks, so this file is pure
// physics and can be tested without a screen.
import * as THREE from 'three';
import { HALF, GOAL_H, POST_R, R, PX, BAR_Y, netDepth } from '../core/constants.js';
import { clamp } from '../core/math.js';

// The record of one kick in flight.
export function newShot(ball) {
  return {
    t: 0, touched: false, post: false, goal: false, crossed: false, outside: null,
    prevZ: ball.pos.z, cool: 0, keeperCool: 0, done: false,
    lineAt: null, touchAt: null, postAt: null,
  };
}

const _cp = new THREE.Vector3(), _n = new THREE.Vector3();
function bounceOff(ball, cp, radius, restitution) {
  _n.subVectors(ball.pos, cp);
  const dist = _n.length();
  if (dist >= R + radius || dist === 0) return false;
  _n.divideScalar(dist);
  const vn = ball.vel.dot(_n);
  if (vn < 0) ball.vel.addScaledVector(_n, -(1 + restitution) * vn);
  ball.pos.copy(cp).addScaledVector(_n, R + radius);
  return true;
}

// Short pauses between repeated hits, so one contact makes one sound and one
// deflection. The frame and the keeper have separate pauses: a ball coming
// off the post can still hit the keeper straight away. Call once per step.
export function coolDown(shot, h) { shot.cool -= h; shot.keeperCool -= h; }

// One collision pass after each physics step (call coolDown() first).
// keeperSpheres: [{ c: Vector3, r }] for the keeper's body and gloves, or null.
// on: { post(), save(), net(pos, vel, strength) }
export function collideStep(ball, shot, keeperSpheres, rng, on = {}) {
  const p = ball.pos;
  const hitFrame = () => {
    if (shot.cool > 0) return;
    if (!shot.postAt) shot.postAt = { x: p.x, y: p.y };
    shot.post = true; shot.cool = 0.08;
    if (on.post) on.post();
  };
  for (const s of [-1, 1]) {
    if (bounceOff(ball, _cp.set(s * PX, clamp(p.y, 0, BAR_Y), 0), POST_R, 0.6)) hitFrame();
  }
  if (bounceOff(ball, _cp.set(clamp(p.x, -PX, PX), BAR_Y, 0), POST_R, 0.6)) hitFrame();

  // The keeper always stops the ball (like the posts above); only the
  // deflection and the sound wait for the keeper's own pause.
  if (keeperSpheres && p.z < 1.6 && p.z > -0.4) {
    for (const s of keeperSpheres) {
      if (bounceOff(ball, s.c, s.r, 0.3)) {
        if (shot.keeperCool > 0) break;
        ball.vel.z = Math.max(ball.vel.z, rng.range(1.5, 4));
        ball.vel.x += rng.range(-1.5, 1.5);
        ball.spin *= 0.2;
        if (!shot.touchAt) shot.touchAt = { x: p.x, y: p.y };
        shot.touched = true; shot.keeperCool = 0.1;
        if (on.save) on.save();
        break;
      }
    }
  }
  // crossing the goal line
  if (!shot.crossed && shot.prevZ >= 0 && p.z < 0) {
    shot.crossed = true;
    shot.lineAt = { x: p.x, y: p.y };
    if (Math.abs(p.x) < HALF && p.y < GOAL_H) { shot.goal = true; shot.goalY = p.y; }
    else shot.outside = { x: p.x, y: p.y };
  }
  shot.prevZ = p.z;
  // the net catches a goal
  if (shot.goal && p.z < 0) {
    const depth = netDepth(clamp(p.y, 0, GOAL_H));
    if (p.z < -depth + R) {
      if (!shot.netHit) { shot.netHit = true; if (on.net) on.net(p, ball.vel, clamp(ball.vel.length() * 0.035, 0.12, 0.6)); }
      p.z = -depth + R; ball.vel.multiplyScalar(0.12); ball.vel.z = Math.abs(ball.vel.z) * 0.3;
    }
    if (Math.abs(p.x) > HALF - R) { p.x = Math.sign(p.x) * (HALF - R); ball.vel.x *= -0.2; }
    if (p.y > GOAL_H - R) { p.y = GOAL_H - R; ball.vel.y = -Math.abs(ball.vel.y) * 0.2; }
  }
  // advertising boards behind the goal
  if (p.z < -4.6 + 0.06 + R && p.y < 0.9 + R && ball.vel.z < 0) { ball.vel.z = -ball.vel.z * 0.35; ball.vel.x *= 0.6; }
}

// The result of a kick once it is clear, or null while the ball is still live.
// 'goal' | 'saved' | 'post' | 'over' | 'wide' | 'short'
export function judge(shot, ball) {
  const s = shot, v = ball.vel, p = ball.pos;
  if (s.goal) return 'goal';
  if (s.outside) return s.post ? 'post' : s.outside.y >= GOAL_H ? 'over' : 'wide';
  if (s.touched && ((v.z > 0.4 && p.z > 0.9) || v.length() < 0.8)) return 'saved';
  if (s.post && v.z > 0.3 && p.z > 0.8) return 'post';
  if (s.t > 3.2 || (v.length() < 0.25 && p.y <= R + 0.001)) return s.touched ? 'saved' : s.post ? 'post' : 'short';
  return null;
}
