import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createBallState, launchVelocity, stepBall, predictCrossing } from '../src/physics/ball.js';

function fly(target, T, spin) {
  const b = createBallState();
  launchVelocity(b.pos, target, T, spin, b.vel);
  b.spin = spin;
  return predictCrossing(b, 1, 0);
}

describe('ball flight', () => {
  it('reaches the target of a straight kick', () => {
    const c = fly(new THREE.Vector3(2.5, 1.2, 0), 0.6, 0);
    expect(c.x).toBeCloseTo(2.5, 1);
    expect(c.y).toBeCloseTo(1.2, 1);
    expect(c.t).toBeCloseTo(0.6, 1);
  });

  it('lands close to the target even with heavy curl', () => {
    for (const spin of [-28, 28]) {
      const c = fly(new THREE.Vector3(-2, 1.8, 0), 0.8, spin);
      expect(Math.abs(c.x - -2)).toBeLessThan(0.3);
      expect(Math.abs(c.y - 1.8)).toBeLessThan(0.3);
    }
  });

  it('curls sideways in the middle of the flight', () => {
    const b = createBallState();
    launchVelocity(b.pos, new THREE.Vector3(0, 1, 0), 0.8, 28, b.vel);
    b.spin = 28;
    let maxDev = 0;
    while (b.pos.z > 0) { stepBall(b, 1 / 240); maxDev = Math.max(maxDev, Math.abs(b.pos.x)); }
    expect(maxDev).toBeGreaterThan(0.3);
  });

  it('a keeper that ignores spin misreads a curled shot', () => {
    const b = createBallState();
    launchVelocity(b.pos, new THREE.Vector3(2, 1, 0), 0.8, 28, b.vel);
    b.spin = 28;
    const straight = predictCrossing(b, 0), true_ = predictCrossing(b, 1);
    expect(Math.abs(straight.x - true_.x)).toBeGreaterThan(0.3);
  });
});
