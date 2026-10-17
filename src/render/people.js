// The people on the pitch: simple jointed bodies, the run-up, and the
// keeper's movement (stance, dives, celebration) plus the spheres used to
// test whether the ball hits the keeper.
import * as THREE from 'three';
import { GOAL_H, KEEPER_Z, REACH, RUNUP } from '../core/constants.js';
import { clamp, lerp } from '../core/math.js';

export function makePerson(scene, kit) {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
  const shirt = mat(kit.shirt), shorts = mat(kit.shorts), socks = mat(kit.socks), skin = mat(0xc98d68), boot = mat(0x111111), hand = mat(kit.gloves || 0xc98d68);
  const root = new THREE.Group();
  const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const hips = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, 0.9, 0); root.add(hip);
    add(hip, new THREE.CylinderGeometry(0.085, 0.075, 0.34, 10), shorts, 0, -0.17, 0);
    add(hip, new THREE.CylinderGeometry(0.068, 0.055, 0.5, 10), socks, 0, -0.6, 0);
    add(hip, new THREE.BoxGeometry(0.11, 0.07, 0.24), boot, 0, -0.86, -0.05);
    hips.push(hip);
  }
  add(root, new THREE.BoxGeometry(0.42, 0.22, 0.26), shorts, 0, 0.92, 0);
  add(root, new THREE.BoxGeometry(0.44, 0.58, 0.25), shirt, 0, 1.25, 0);
  add(root, new THREE.SphereGeometry(0.12, 16, 12), skin, 0, 1.68, 0);
  add(root, new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d16), 0, 1.7, 0);
  const shoulders = [], gloves = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.27, 1.45, 0); root.add(sh);
    add(sh, new THREE.CylinderGeometry(0.058, 0.05, 0.62, 10), shirt, 0, 0.31, 0);
    gloves.push(add(sh, new THREE.SphereGeometry(kit.gloves ? 0.088 : 0.05, 12, 10), hand, 0, 0.66, 0));
    shoulders.push(sh);
  }
  root.rotation.order = 'YXZ';   // turn first, then lean, so a lean is always forward/back for the body
  scene.add(root);
  return { root, hips, shoulders, gloves, shirt, mats: { shirt, shorts, socks } };
}

export const KITS = {
  cpuKeeper: { shirt: 0x1fb59f, shorts: 0x0f2d2a, socks: 0x1fb59f, gloves: 0xf4f4f4 },
  youKeeper: { shirt: 0xf2c230, shorts: 0x15161b, socks: 0x15161b, gloves: 0xf4f4f4 },
  cpuTaker: { shirt: 0x1fb59f, shorts: 0xf1f1f1, socks: 0x1fb59f },
  youTaker: { shirt: 0xf2c230, shorts: 0x15161b, socks: 0xf2c230 },
};

// Run-up shared by the CPU taker and by your striker in replays: RUNUP s from
// the edge of the D to the ball, then the kicking leg swings through.
export function animateRunup(b, timer) {
  const p = Math.min(timer / RUNUP, 1);
  b.root.position.set(lerp(-1.8, -0.42, p), 0, lerp(13.6, 11.45, p));
  b.root.rotation.set(0, 0.35 * (1 - p), 0);
  const run = Math.sin(timer * 14);
  b.hips[0].rotation.set(run * 0.7, 0, 0); b.hips[1].rotation.set(-run * 0.7, 0, 0);
  b.shoulders[0].rotation.set(-run * 0.5, 0, Math.PI - 0.15); b.shoulders[1].rotation.set(run * 0.5, 0, -Math.PI + 0.15);
  if (p >= 1) { b.hips[0].rotation.x = -0.3; b.hips[1].rotation.x = 1.2; }
}

// Keeper state: feet position, body tilt (radians, + leans to +x), arm raise 0..1.
export function newKeeper(body) {
  return { body, x: 0, y: 0, z: KEEPER_Z, tilt: 0, arms: 0, dive: null, active: false, maxShift: 1.8 };
}
const READY = 2.35;           // shoulder angle with arms out and down
const REACHING = 0.08;
// Dive time: a base plus extra per metre of sideways travel (seconds).
export const DIVE_BASE = 0.4, DIVE_PER_M = 0.04;        // arms almost parallel, both hands toward the ball
export function poseKeeper(k) {
  const b = k.body;
  b.root.position.set(k.x, k.y, k.z);
  b.root.rotation.set(0, 0, -k.tilt);
  b.shoulders[0].rotation.z = lerp(READY, REACHING, k.arms);
  b.shoulders[1].rotation.z = -lerp(READY, REACHING, k.arms);
  b.hips[0].rotation.z = -0.12 * (1 - k.arms * 0.5);
  b.hips[1].rotation.z = 0.12 * (1 - k.arms * 0.5);
  b.root.updateMatrixWorld(true);
}
export function hideKeeper(body) { body.root.visible = false; }

// Plan a dive so the gloves arrive at (tx, ty). The whole body tilts
// around the feet, like a real keeper pushing off one leg.
// speed: below 1 dives faster (a keeper strong in that area).
export function planDive(k, tx, ty, speed = 1) {
  const side = Math.sign(tx - k.x) || 1;
  const lateral = Math.abs(tx - k.x);
  let tilt, toX, toY;
  if (lateral < 0.75) {
    tilt = side * lateral * 0.35;
    toX = k.x + (tx - k.x) * 0.6;
    toY = clamp(ty - REACH, 0, 0.55);
  } else {
    const h = clamp(ty / GOAL_H, 0, 1.15);
    tilt = side * lerp(1.35, 0.6, Math.min(h, 1));
    toY = clamp(ty - REACH * Math.cos(tilt), 0, 0.5);
    toX = tx - side * REACH * Math.sin(Math.abs(tilt));
  }
  const shift = toX - k.x;
  if (Math.abs(shift) > k.maxShift) toX = k.x + Math.sign(shift) * k.maxShift;
  k.dive = { t: 0, dur: (DIVE_BASE + DIVE_PER_M * Math.min(lateral, 3)) * speed, fromX: k.x, fromY: k.y, fromTilt: k.tilt, toX, toY, tilt, side, landed: false };
}
export function updateKeeper(k, dt, time) {
  if (!k.active) return;
  if (k.cheer) {
    const c = (k.cheer.t += dt);
    k.tilt = lerp(k.tilt, 0, 1 - Math.exp(-dt * 6));
    k.x = lerp(k.x, k.cheer.x, 1 - Math.exp(-dt * 3));
    k.y = c > 0.45 ? Math.abs(Math.sin((c - 0.45) * 7)) * 0.36 : lerp(k.y, 0, 1 - Math.exp(-dt * 8));
    k.arms = 1;
    poseKeeper(k);
    k.body.shoulders[0].rotation.z = 0.55 + Math.sin(c * 14) * 0.3;
    k.body.shoulders[1].rotation.z = -0.12;
    k.body.root.updateMatrixWorld(true);
    return;
  }
  const d = k.dive;
  if (!d) {
    k.x = lerp(k.x, 0.2 * Math.sin(time * 2.3), 1 - Math.exp(-dt * 6));
    k.y = Math.max(0, Math.sin(time * 4.6)) * 0.03;
    k.arms = lerp(k.arms, 0, 1 - Math.exp(-dt * 8));
  } else {
    d.t += dt;
    const p = Math.min(d.t / d.dur, 1);
    // Smoothstep: a push-off, a fast middle, then full stretch. (An ease-out
    // here made keepers cover most of the distance in a fraction of a second.)
    const e = p * p * (3 - 2 * p);
    k.x = lerp(d.fromX, d.toX, e);
    k.tilt = lerp(d.fromTilt, d.tilt, e);
    k.y = lerp(d.fromY, d.toY, e) + Math.sin(p * Math.PI) * (Math.abs(d.tilt) > 0.5 ? 0.22 : 0.1);
    k.arms = Math.min(1, p * 2.2);
    if (d.t > d.dur + 0.3 && Math.abs(d.tilt) > 0.5) {
      const q = Math.min((d.t - d.dur - 0.3) / 0.35, 1);
      k.tilt = lerp(d.tilt, d.side * 1.48, q);
      k.y = lerp(d.toY, 0.16, q);
    }
  }
  poseKeeper(k);
}
// Spheres that stand in for the keeper for collisions: five along the body,
// the two gloves (indices 5 and 6), one between the hands, and one on each
// forearm, so a ball cannot slip through the gap between reaching arms.
const bodyPoints = [[0, 0.3, 0.17], [0, 0.7, 0.19], [0, 1.1, 0.21], [0, 1.42, 0.2], [0, 1.68, 0.14]];
const spheres = Array.from({ length: 10 }, () => ({ c: new THREE.Vector3(), r: 0 }));
const _shoulder = new THREE.Vector3();
export function keeperSpheres(k) {
  const root = k.body.root;
  bodyPoints.forEach(([x, y, r], i) => { spheres[i].c.set(x, y, 0); root.localToWorld(spheres[i].c); spheres[i].r = r; });
  k.body.gloves.forEach((g, i) => { g.getWorldPosition(spheres[5 + i].c); spheres[5 + i].r = 0.14; });
  spheres[7].c.addVectors(spheres[5].c, spheres[6].c).multiplyScalar(0.5);
  spheres[7].r = 0.13;
  k.body.shoulders.forEach((sh, i) => {
    sh.getWorldPosition(_shoulder);
    spheres[8 + i].c.lerpVectors(_shoulder, spheres[5 + i].c, 0.65);
    spheres[8 + i].r = 0.08;
  });
  return spheres;
}

