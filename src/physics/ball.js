import * as THREE from 'three';
import { G, MAGNUS, R, SPOT_Z, KEEPER_Z } from '../core/constants.js';

export function createBallState() {
  return { pos: new THREE.Vector3(0, R, SPOT_Z), vel: new THREE.Vector3(), spin: 0, moving: false };
}

// Solve the kick so the ball reaches target after T seconds, including the
// sideways push of its spin, so a curled shot still finds its target.
export function launchVelocity(from, target, T, spin, out = new THREE.Vector3()) {
  const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
  const ax = MAGNUS * spin * (dz / T);
  return out.set((dx - 0.5 * ax * T * T) / T, (dy - 0.5 * G * T * T) / T, dz / T);
}

// One physics step for any ball-like state (also used by the keeper to predict).
export function stepBall(b, h) {
  b.vel.y += G * h;
  b.vel.x += MAGNUS * b.spin * b.vel.z * h;
  b.vel.z += -MAGNUS * b.spin * b.vel.x * h;
  b.pos.addScaledVector(b.vel, h);
  b.spin *= 1 - 0.12 * h;
  if (b.pos.y < R) {
    b.pos.y = R;
    if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.5;
    if (b.vel.y < 0.35) b.vel.y = 0;
    b.vel.x *= 1 - 0.6 * h; b.vel.z *= 1 - 0.6 * h; b.spin *= 1 - 2 * h;
  }
}

// Where the ball will be when it reaches the plane z = planeZ. readSpin
// (0..1) is how much of the curl the predictor understands: a keeper with
// readSpin 0 expects a straight shot.
export function predictCrossing(state, readSpin = 1, planeZ = KEEPER_Z) {
  const b = { pos: state.pos.clone(), vel: state.vel.clone(), spin: state.spin * readSpin };
  let t = 0;
  for (let i = 0; i < 600 && b.pos.z > planeZ; i++) { stepBall(b, 1 / 120); t += 1 / 120; }
  return { x: b.pos.x, y: b.pos.y, z: b.pos.z, t };
}
