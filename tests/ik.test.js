import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone } from '../src/render/ik.js';

// A right arm hanging off a rotated, scaled body, like a skinned model's
// bones: upper arm 0.3, forearm 0.28.
function makeArm({ bent = true } = {}) {
  const body = new THREE.Group();
  body.position.set(0.5, 1.0, 0.2);
  body.rotation.set(0.2, -0.4, 0.1);
  const shoulder = new THREE.Bone(); shoulder.position.set(-0.2, 0.4, 0); body.add(shoulder);
  const elbow = new THREE.Bone(); elbow.position.set(0, -0.3, 0); shoulder.add(elbow);
  const wrist = new THREE.Bone(); wrist.position.set(0, -0.28, 0); elbow.add(wrist);
  if (bent) elbow.rotation.x = -0.6;   // the animation has the elbow bent forward
  body.updateMatrixWorld(true);
  return { body, shoulder, elbow, wrist };
}
const world = (o) => o.getWorldPosition(new THREE.Vector3());
const DOWN_BACK = new THREE.Vector3(0, -1, -0.5).normalize();

describe('two-bone IK', () => {
  it('puts the wrist on every reachable target and keeps the bone lengths', () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const arm = makeArm({ bent: i % 2 === 0 });
      const s = world(arm.shoulder);
      const dir = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 0.37)).normalize();
      const target = s.clone().addScaledVector(dir, 0.1 + (i % 9) * 0.05);   // 0.1 to 0.5, inside 0.58
      const err = solveTwoBone(arm.shoulder, arm.elbow, arm.wrist, target, DOWN_BACK);
      worst = Math.max(worst, err);
      expect(world(arm.elbow).distanceTo(s)).toBeCloseTo(0.3, 5);
      expect(world(arm.wrist).distanceTo(world(arm.elbow))).toBeCloseTo(0.28, 5);
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('reaches straight towards a target that is too far away', () => {
    const arm = makeArm();
    const s = world(arm.shoulder);
    const target = s.clone().add(new THREE.Vector3(0.8, 0.4, 0));
    const err = solveTwoBone(arm.shoulder, arm.elbow, arm.wrist, target, DOWN_BACK);
    expect(err).toBeCloseTo(s.distanceTo(target) - 0.58, 3);
    const toWrist = world(arm.wrist).sub(s).normalize();
    expect(toWrist.angleTo(target.clone().sub(s).normalize())).toBeLessThan(1e-3);
  });

  it('bends a straight arm with the elbow towards the pole', () => {
    const arm = makeArm({ bent: false });
    const s = world(arm.shoulder);
    const target = s.clone().add(new THREE.Vector3(0.35, 0.1, 0.1));
    solveTwoBone(arm.shoulder, arm.elbow, arm.wrist, target, DOWN_BACK);
    const line = target.clone().sub(s).normalize();
    const off = world(arm.elbow).sub(s);
    off.addScaledVector(line, -off.dot(line));
    expect(off.dot(DOWN_BACK)).toBeGreaterThan(0);
  });

  it('weight 0 leaves the animated arm alone, weight 0.5 goes part way', () => {
    const arm = makeArm();
    const before = world(arm.wrist);
    const target = world(arm.shoulder).add(new THREE.Vector3(0.3, 0.2, 0.2));
    expect(solveTwoBone(arm.shoulder, arm.elbow, arm.wrist, target, DOWN_BACK, 0)).toBe(null);
    expect(world(arm.wrist).distanceTo(before)).toBeLessThan(1e-9);
    const half = solveTwoBone(arm.shoulder, arm.elbow, arm.wrist, target, DOWN_BACK, 0.5);
    expect(half).toBeGreaterThan(0.01);
    expect(half).toBeLessThan(before.distanceTo(target));
  });
});
