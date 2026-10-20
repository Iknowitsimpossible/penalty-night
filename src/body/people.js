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

// Your striker at the spot, seen from behind while you aim. t < 0: waiting
// beside the ball. t >= 0: seconds since the strike; the body steps into
// the ball and the kicking leg (hips[1], the right) follows through.
export function poseStriker(b, t) {
  const k = t < 0 ? 0 : Math.min(t / 0.22, 1), e = k * (2 - k);
  b.root.position.set(lerp(-0.62, -0.42, e), 0, lerp(11.75, 11.45, e));
  b.root.rotation.set(0, 0.3 * (1 - e), 0);
  b.hips[0].rotation.set(t < 0 ? 0.1 : lerp(0.1, -0.3, e), 0, -0.05);
  b.hips[1].rotation.set(t < 0 ? -0.15 : lerp(-0.4, 1.2, e), 0, 0.05);
  b.shoulders[0].rotation.set(t < 0 ? 0 : -0.4 * e, 0, Math.PI - (t < 0 ? 0.12 : lerp(0.12, 0.9, e)));
  b.shoulders[1].rotation.set(t < 0 ? 0 : 0.5 * e, 0, -Math.PI + (t < 0 ? 0.12 : lerp(0.12, 0.6, e)));
}

// Keeper state: feet position, body tilt (radians, + leans to +x), arm raise 0..1.
// prev: the keeper this one replaces. When it is the same body, still on
// screen (a new kick in training or practice), the keeper starts where it
// was and shuffles sideways back to its spot over SHUFFLE seconds, while its
// posture eases from however it was drawn (even lying down) to standing.
// SHUFFLE is shorter than the run-up, so it is over before any ball arrives.
export const SHUFFLE = 0.7;
const STEP_LENGTH = 0.35;   // metres per side-step
export function newKeeper(body, prev = null) {
  const k = { body, x: 0, y: 0, z: KEEPER_Z, tilt: 0, arms: 0, dive: null, active: false, maxShift: 1.8, homeX: 0, blend: null, shuffle: null };
  if (prev && prev.body === body) {
    const r = body.root;
    k.x = r.position.x;
    const dist = Math.abs(k.x);
    k.shuffle = { t: 0, fromX: k.x, steps: dist < 0.05 ? 0 : Math.max(2, Math.round(dist / STEP_LENGTH)) };
    k.blend = {
      t: 0, y: r.position.y, rotZ: r.rotation.z,
      shoulders: body.shoulders.map((sh) => sh.rotation.z), hips: body.hips.map((h) => h.rotation.z),
    };
  }
  return k;
}
const READY = 2.35;           // shoulder angle with arms out and down
const REACHING = 0.08;        // arms almost parallel, both hands toward the ball
// Dive time: a base plus extra per metre of sideways travel (seconds).
export const DIVE_BASE = 0.4, DIVE_PER_M = 0.04;
// How long a keeper stays at full stretch before dropping to the grass,
// how long the drop takes, the rest on the grass, and the roll back up.
export const DIVE_HOLD = 0.45, DIVE_LAND = 0.35, GETUP_PAUSE = 0.4, GETUP = 0.6;
const smoothstep = (p) => p * p * (3 - 2 * p);
export function poseKeeper(k) {
  const b = k.body;
  b.root.position.set(k.x, k.y, k.z);
  b.root.rotation.set(0, 0, -k.tilt);
  b.shoulders[0].rotation.z = lerp(READY, REACHING, k.arms);
  b.shoulders[1].rotation.z = -lerp(READY, REACHING, k.arms);
  b.hips[0].rotation.z = -0.12 * (1 - k.arms * 0.5);
  b.hips[1].rotation.z = 0.12 * (1 - k.arms * 0.5);
  keepOnGrass(k);
}

// The lowest world-space point of a body, worked out exactly from each
// part's shape: box corners, sphere bottoms, and the lowest point on each
// rim of a cylinder. (About 16 parts, so it is cheap enough for every step.)
const _p = new THREE.Vector3(), _axis = new THREE.Vector3();
export function lowestPoint(root) {
  let low = Infinity;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.parameters, m = o.matrixWorld;
    if (o.geometry.type === 'BoxGeometry') {
      for (let i = 0; i < 8; i++) {
        _p.set((i & 1 ? 0.5 : -0.5) * g.width, (i & 2 ? 0.5 : -0.5) * g.height, (i & 4 ? 0.5 : -0.5) * g.depth).applyMatrix4(m);
        low = Math.min(low, _p.y);
      }
    } else if (o.geometry.type === 'SphereGeometry') {
      low = Math.min(low, _p.setFromMatrixPosition(m).y - g.radius);
    } else if (o.geometry.type === 'CylinderGeometry') {
      // A rim of radius r around a tilted axis dips r * sqrt(1 - axis.y^2) below its centre.
      _axis.setFromMatrixColumn(m, 1).normalize();
      const dip = Math.sqrt(Math.max(0, 1 - _axis.y * _axis.y));
      for (const [y, r] of [[g.height / 2, g.radiusTop], [-g.height / 2, g.radiusBottom]]) {
        low = Math.min(low, _p.set(0, y, 0).applyMatrix4(m).y - r * dip);
      }
    }
  });
  return low;
}
// The dive tilts the body around the feet, which would push the lower leg
// (and, landing, a glove) into the grass. Lift the keeper just enough that
// nothing goes below the ground, the way a real keeper's feet leave it.
function liftAboveGrass(root) {
  root.updateMatrixWorld(true);
  const low = lowestPoint(root);
  if (low < 0) {
    root.position.y -= low;
    root.updateMatrixWorld(true);
  }
}
function keepOnGrass(k) {
  liftAboveGrass(k.body.root);
  k.y = k.body.root.position.y;
}
// Draw the posture part way between the old pose and the one just set from
// the game state (which is left alone). Smoothstep, like the dive. Only the
// height and angles: the shuffle moves the keeper sideways.
function drawBlend(k, dt) {
  const b = k.blend, body = k.body, root = body.root;
  b.t += dt;
  const e = smoothstep(Math.min(b.t / SHUFFLE, 1));
  root.position.y = lerp(b.y, root.position.y, e);
  root.rotation.z = lerp(b.rotZ, root.rotation.z, e);
  body.shoulders.forEach((sh, i) => { sh.rotation.z = lerp(b.shoulders[i], sh.rotation.z, e); });
  body.hips.forEach((h, i) => { h.rotation.z = lerp(b.hips[i], h.rotation.z, e); });
  liftAboveGrass(root);
  if (b.t >= SHUFFLE) k.blend = null;
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
    // Low dives are almost flat: keepOnGrass() lifts a tilted body by about
    // half its width, so a steeper tilt would leave the gloves well above a
    // ball along the ground.
    tilt = side * lerp(1.45, 0.6, Math.min(h, 1));
    toY = clamp(ty - REACH * Math.cos(tilt), 0, 0.5);
    toX = tx - side * REACH * Math.sin(Math.abs(tilt));
  }
  const shift = toX - k.x;
  if (Math.abs(shift) > k.maxShift) toX = k.x + Math.sign(shift) * k.maxShift;
  k.shuffle = null;   // a dive takes over from the shuffle
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
    keepOnGrass(k);
    return;
  }
  const d = k.dive;
  let step = 0, lead = 0;   // side-step height 0 -> 1 -> 0, and which hip leads
  if (!d && k.shuffle) {
    // Shuffle back to the spot: steps follow the distance covered, so the feet don't skate.
    const sh = k.shuffle;
    sh.t += dt;
    const e = smoothstep(Math.min(sh.t / SHUFFLE, 1));
    k.x = lerp(sh.fromX, k.homeX || 0, e);
    step = Math.sin(Math.PI * ((e * sh.steps) % 1));
    lead = (k.homeX || 0) > sh.fromX ? 1 : 0;   // hips[1] is on the +x side
    k.y = 0.03 * step;
    k.arms = 0;   // ready pose
    if (sh.t >= SHUFFLE) k.shuffle = null;
  } else if (!d) {
    // Sway around the spot the keeper has stepped to (homeX), smaller once off-centre.
    const home = k.homeX || 0;
    k.x = lerp(k.x, home + 0.2 * (1 - Math.min(Math.abs(home), 1) * 0.6) * Math.sin(time * 2.3), 1 - Math.exp(-dt * 6));
    k.y = Math.max(0, Math.sin(time * 4.6)) * 0.03;
    k.arms = lerp(k.arms, 0, 1 - Math.exp(-dt * 8));
  } else {
    d.t += dt;
    const p = Math.min(d.t / d.dur, 1);
    // Smoothstep: a push-off, a fast middle, then full stretch. (An ease-out
    // here made keepers cover most of the distance in a fraction of a second.)
    const e = smoothstep(p);
    const big = Math.abs(d.tilt) > 0.5;   // a real dive that ends on the grass
    k.x = lerp(d.fromX, d.toX, e);
    k.tilt = lerp(d.fromTilt, d.tilt, e);
    k.y = lerp(d.fromY, d.toY, e) + Math.sin(p * Math.PI) * (big ? 0.22 : 0.1);
    k.arms = Math.min(1, p * 2.2);
    if (d.t > d.dur + DIVE_HOLD && big) {
      const q = Math.min((d.t - d.dur - DIVE_HOLD) / DIVE_LAND, 1);
      k.tilt = lerp(d.tilt, d.side * 1.48, q);
      k.y = lerp(d.toY, 0.16, q);
      if (q >= 1 && !d.landed) { d.landed = true; if (k.onLand) k.onLand(); }   // e.g. a thud on the grass
    }
    // Get up: one smooth roll back to standing where the dive ended, arms
    // down. A small stretch or jump has nothing to land from, so it comes
    // straight back after the hold. keepOnGrass() still applies during the roll.
    const upAt = d.dur + DIVE_HOLD + (big ? DIVE_LAND + GETUP_PAUSE : 0);
    if (d.t > upAt) {
      const q = smoothstep(Math.min((d.t - upAt) / GETUP, 1));
      k.tilt = lerp(big ? d.side * 1.48 : d.tilt, 0, q);
      k.y = lerp(big ? 0.16 : d.toY, 0, q);
      k.arms = 1 - q;
    }
  }
  poseKeeper(k);
  if (k.blend) drawBlend(k, dt);
  if (step > 0) {
    // A side-step on top of the (eased) stance: the leg on the way-to-go
    // side opens, then the feet close again.
    k.body.hips[lead].rotation.z += (lead ? 1 : -1) * 0.3 * step;
    liftAboveGrass(k.body.root);
  }
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

