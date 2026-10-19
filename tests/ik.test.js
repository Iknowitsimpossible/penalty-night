import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone, createArm, solveArm, MIN_BEND, MAX_BEND, BEND_SPEED, ROLL_SPEED } from '../src/render/ik.js';

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

// A left arm built like the Mixamo keeper's: centimetre bones under a 0.01
// scale, each pointing along its own y axis, the elbow a hinge about the
// upper arm's z axis. The forearm is bent `bend` (rad) and twisted a little,
// as in the clips.
function makeMixamoArm({ bend = 0.8, roll = 0 } = {}) {
  const body = new THREE.Group();
  body.scale.setScalar(0.01);
  body.position.set(0.3, 0.2, 0.4);
  body.rotation.set(0.3, 0.5, -0.2);
  const shoulder = new THREE.Bone(); shoulder.position.set(10, 140, 0); shoulder.rotation.set(0.1, 0.2, -1.4); body.add(shoulder);
  const upper = new THREE.Bone(); upper.position.set(0, 12, 0); upper.rotation.set(0.2, roll, 0.3); shoulder.add(upper);
  const lower = new THREE.Bone(); lower.position.set(0, 27.7, 0); upper.add(lower);
  lower.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bend)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));   // forearm twist
  const end = new THREE.Bone(); end.position.set(0, 21.3, 0); lower.add(end);
  body.updateMatrixWorld(true);
  return { body, shoulder, upper, lower, end, arm: createArm(upper, lower, end, new THREE.Vector3(0, 0, 1)) };
}
const L1 = 0.277, L2 = 0.213;
// How far the elbow is bent (rad, 0 = straight, below 0 = the wrong way)
// and how far the forearm has left the hinge's plane.
function elbowOf(a) {
  const f = new THREE.Vector3(0, 1, 0).applyQuaternion(a.lower.quaternion);
  return { bend: Math.atan2(-f.x, f.y), offHinge: Math.asin(Math.abs(f.z)) };
}
// The upper arm's roll about its own axis between two of its rotations.
function rollBetween(q0, q1) {
  const d = q0.clone().invert().multiply(q1);
  return Math.abs(2 * Math.atan2(d.y, Math.abs(d.w)));
}
const around = (a, dir, dist) => world(a.upper).addScaledVector(dir.clone().normalize(), dist);

describe('arm IK', () => {
  it('puts the wrist on every reachable target, keeps the bones and bends only on the hinge', () => {
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const a = makeMixamoArm({ bend: 0.2 + (i % 5) * 0.3, roll: (i % 7) - 3 });
      const dir = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 0.37));
      const target = around(a, dir, 0.18 + (i % 9) * 0.035);   // 0.18 to 0.46, inside 0.49
      worst = Math.max(worst, solveArm(a.arm, target, 1, 1 / 60));
      expect(world(a.lower).distanceTo(world(a.upper))).toBeCloseTo(L1, 5);
      expect(world(a.end).distanceTo(world(a.lower))).toBeCloseTo(L2, 5);
      expect(elbowOf(a).offHinge).toBeLessThan(1e-6);
      // the forearm keeps its own twist
      const twist = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -elbowOf(a).bend).multiply(a.lower.quaternion));
      expect(Math.atan2(-twist.z, twist.x)).toBeCloseTo(0.4, 5);
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('keeps the elbow between 5 and 140 degrees, never bent backwards', () => {
    for (const dist of [0.02, 0.06, 0.1, 0.3, 0.488, 0.6, 1.5]) {
      for (const bend of [-0.3, 0, 0.05, 1.2, 2.6]) {
        const a = makeMixamoArm({ bend });
        solveArm(a.arm, around(a, new THREE.Vector3(1, 0.3, 0.2), dist), 1, 1 / 60);
        const b = elbowOf(a).bend;
        expect(b).toBeGreaterThanOrEqual(MIN_BEND - 1e-6);
        expect(b).toBeLessThanOrEqual(MAX_BEND + 1e-6);
      }
    }
    // out of reach: as straight as allowed, pointing at the target
    const a = makeMixamoArm();
    const target = around(a, new THREE.Vector3(0.2, -1, 0.4), 1);
    solveArm(a.arm, target, 1, 1 / 60);
    expect(elbowOf(a).bend).toBeCloseTo(MIN_BEND, 5);
    const toWrist = world(a.end).sub(world(a.upper)).normalize();
    expect(toWrist.angleTo(target.clone().sub(world(a.upper)).normalize())).toBeLessThan(1e-6);
  });

  it("keeps the animation's twist: a target on the animated wrist changes nothing", () => {
    for (let i = 0; i < 20; i++) {
      const a = makeMixamoArm({ bend: 0.3 + i * 0.1, roll: i * 0.3 });
      const q0 = a.upper.quaternion.clone(), q1 = a.lower.quaternion.clone();
      solveArm(a.arm, world(a.end), 1, 1 / 60);
      expect(a.upper.quaternion.angleTo(q0)).toBeLessThan(1e-5);
      expect(a.lower.quaternion.angleTo(q1)).toBeLessThan(1e-5);
    }
  });

  it("follows the animation's roll when the target moves, instead of spinning the arm", () => {
    // Sweep the target across a wide arc (half a circle in a second) while
    // the animation holds still: the upper arm turns, but hardly rolls.
    const a = makeMixamoArm({ bend: 0.6 });
    const anim = { upper: a.upper.quaternion.clone(), lower: a.lower.quaternion.clone() };
    let prev = null, worst = 0;
    for (let f = 0; f <= 60; f++) {
      a.upper.quaternion.copy(anim.upper); a.lower.quaternion.copy(anim.lower); a.body.updateMatrixWorld(true);
      const ang = Math.PI * f / 60;
      solveArm(a.arm, around(a, new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.3), 0.4), 1, 1 / 60);
      if (prev) worst = Math.max(worst, rollBetween(prev, a.upper.quaternion) * 60);
      prev = a.upper.quaternion.clone();
    }
    expect(worst).toBeLessThan(THREE.MathUtils.degToRad(400));
  });

  it('rolls the upper arm no faster than ROLL_SPEED, with the wrist kept on the target', () => {
    const a = makeMixamoArm({ bend: 0.8, roll: 0 });
    const target = around(a, new THREE.Vector3(1, -0.2, 0.5), 0.38);
    solveArm(a.arm, target, 1, 1 / 60);
    // the animation suddenly rolls the arm by 2 rad
    const rolled = makeMixamoArm({ bend: 0.8, roll: 2 });
    let prev = a.upper.quaternion.clone();
    const rolls = [];
    for (let f = 0; f < 60; f++) {
      a.upper.quaternion.copy(rolled.upper.quaternion); a.lower.quaternion.copy(rolled.lower.quaternion); a.body.updateMatrixWorld(true);
      expect(solveArm(a.arm, target, 1, 1 / 60)).toBeLessThan(1e-4);
      rolls.push(rollBetween(prev, a.upper.quaternion));
      prev = a.upper.quaternion.clone();
    }
    expect(Math.max(...rolls)).toBeLessThanOrEqual(ROLL_SPEED / 60 + 1e-4);
    expect(rolls[0]).toBeGreaterThan(ROLL_SPEED / 60 * 0.9);   // it does turn, at the limit
    // and gets there: the same as solving fresh on the rolled animation
    const fresh = makeMixamoArm({ bend: 0.8, roll: 2 });
    solveArm(fresh.arm, target, 1, 1 / 60);
    expect(a.upper.quaternion.angleTo(fresh.upper.quaternion)).toBeLessThan(0.01);
  });

  it('bends the elbow no faster than BEND_SPEED', () => {
    const a = makeMixamoArm({ bend: 0.6 });
    const anim = { upper: a.upper.quaternion.clone(), lower: a.lower.quaternion.clone() };
    const bends = [];
    for (let f = 0; f < 30; f++) {
      a.upper.quaternion.copy(anim.upper); a.lower.quaternion.copy(anim.lower); a.body.updateMatrixWorld(true);
      solveArm(a.arm, around(a, new THREE.Vector3(1, 0.2, 0), f < 3 ? 0.2 : 0.6), 1, 1 / 60);   // a target that suddenly jumps out of reach
      bends.push(elbowOf(a).bend);
    }
    for (let f = 1; f < bends.length; f++) expect(Math.abs(bends[f] - bends[f - 1])).toBeLessThanOrEqual(BEND_SPEED / 60 + 1e-6);
    expect(bends[bends.length - 1]).toBeCloseTo(MIN_BEND, 5);   // and gets straight in the end
  });

  it('after the weight is back to 0, eases back to the animation and then lets go', () => {
    const a = makeMixamoArm({ bend: 0.8, roll: 0 });
    const anim = { upper: a.upper.quaternion.clone(), lower: a.lower.quaternion.clone() };
    const target = around(a, new THREE.Vector3(-1, 0.5, 0.2), 0.4);
    for (let f = 0; f < 10; f++) {
      a.upper.quaternion.copy(anim.upper); a.lower.quaternion.copy(anim.lower); a.body.updateMatrixWorld(true);
      solveArm(a.arm, target, 1, 1 / 60);
    }
    // fade the weight out over a fifth of a second, then keep going at 0
    let prev = a.upper.quaternion.clone(), frames = 0;
    for (; frames < 200; frames++) {
      a.upper.quaternion.copy(anim.upper); a.lower.quaternion.copy(anim.lower); a.body.updateMatrixWorld(true);
      const w = Math.max(0, 1 - (frames + 1) / 12);
      const r = solveArm(a.arm, w > 0 ? target : null, w, 1 / 60);
      expect(rollBetween(prev, a.upper.quaternion)).toBeLessThanOrEqual(ROLL_SPEED / 60 + 1e-4);
      prev = a.upper.quaternion.clone();
      if (r === null && !a.arm.last) break;
    }
    expect(frames).toBeGreaterThan(12);   // it took a while: no snap back
    expect(frames).toBeLessThan(200);
    expect(a.upper.quaternion.angleTo(anim.upper)).toBeLessThan(1e-6);
    expect(a.lower.quaternion.angleTo(anim.lower)).toBeLessThan(1e-6);
  });

  it('carries the elbow round with the body, not fixed in the world', () => {
    const a = makeMixamoArm();
    const target = () => a.shoulder.localToWorld(new THREE.Vector3(5, 45, 10));   // moves with the body
    solveArm(a.arm, target(), 1, 1 / 60);
    const before = a.upper.quaternion.clone();
    a.body.rotation.y += 1.2; a.body.updateMatrixWorld(true);
    solveArm(a.arm, target(), 1, 1 / 60);
    expect(a.upper.quaternion.angleTo(before)).toBeLessThan(1e-5);
  });

  it('weight 0 leaves the animation alone, and a small weight barely moves it', () => {
    const a = makeMixamoArm();
    const q0 = a.upper.quaternion.clone(), wrist = world(a.end);
    const target = around(a, new THREE.Vector3(-0.3, 1, 0.2), 0.3);
    expect(solveArm(a.arm, target, 0, 1 / 60)).toBe(null);
    expect(a.upper.quaternion.angleTo(q0)).toBeLessThan(1e-6);
    solveArm(a.arm, target, 0.01, 1 / 60);
    expect(world(a.end).distanceTo(wrist)).toBeLessThan(0.01 * wrist.distanceTo(target) + 1e-6);
    // and half way puts the wrist half way
    const b = makeMixamoArm();
    solveArm(b.arm, target, 0.5, 1 / 60);
    expect(world(b.end).distanceTo(wrist.clone().lerp(target, 0.5))).toBeLessThan(1e-4);
  });

  it('a stored elbow direction poses the arm again exactly (replays)', () => {
    const a = makeMixamoArm({ bend: 0.5 });
    const anim = { upper: a.upper.quaternion.clone(), lower: a.lower.quaternion.clone() };
    const target = around(a, new THREE.Vector3(1, 0.4, -0.3), 0.35);
    for (let f = 0; f < 10; f++) solveArm(a.arm, target.clone().add(new THREE.Vector3(0, f * 0.01, 0)), 1, 1 / 60);
    const pose = a.upper.quaternion.clone(), stored = a.arm.used.clone();
    a.upper.quaternion.copy(anim.upper); a.lower.quaternion.copy(anim.lower); a.body.updateMatrixWorld(true);
    const replay = createArm(a.upper, a.lower, a.end, new THREE.Vector3(0, 0, 1));
    solveArm(replay, target.clone().add(new THREE.Vector3(0, 0.09, 0)), 1, 1 / 60, stored);
    expect(a.upper.quaternion.angleTo(pose)).toBeLessThan(1e-5);
  });
});
