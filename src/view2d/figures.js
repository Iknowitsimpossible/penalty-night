// The players, drawn the way the concept page (docs/art-direction/concept-v1.html)
// draws them: a 2D skeleton turned into tapered capsule limbs, kit pieces,
// a shaded head and a light-to-dark gradient over the whole silhouette.
//
// The skeleton is not animated here. bodyPose() reads the joints of the
// procedural body in render/people.js (the same body the collision spheres
// come from), projects them through the camera, and drawFigure() draws the
// concept figure through those points. So what you see is what saves.
import * as THREE from 'three';
import { project } from './projection.js';
import { KITS } from '../render/people.js';

// ------------------------------------------------------------------ colours
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const shadeCache = new Map();
// a colour darkened (k < 1) or lightened (k > 1), as the concept's shade()
export function shade(h, k) {
  const key = h + k;
  let v = shadeCache.get(key);
  if (!v) {
    const n = parseInt(h.slice(1), 16);
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
    v = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
    shadeCache.set(key, v);
  }
  return v;
}
// A light kit colour gets a dark trim, a dark one a white trim.
const luma = (h) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
const trimFor = (h) => (luma(h) > 140 ? '#15161b' : '#f4f4f4');

// The concept's kits. Shirt, shorts and socks come from the body's own
// materials every frame (so the opponent's colours follow dressOpponent);
// these add the details the 3D bodies never had.
const DETAILS = {
  keeper: { boots: '#1b1c22', gloves: '#f4f4f4', skin: '#b97a56', hair: '#2a1d16', number: '1' },
  cpuTaker: { boots: '#f4f4f4', bootTrim: '#e2483a', skin: '#7a4a2e', hair: '#141010', number: '10' },
  youTaker: { boots: '#1b1c22', skin: '#c98d68', hair: '#3a2618', number: '9' },
};
export function kitFor(body, role) {
  const m = body.mats;
  const shirt = '#' + m.shirt.color.getHexString(), shorts = '#' + m.shorts.color.getHexString(), socks = '#' + m.socks.color.getHexString();
  const d = DETAILS[role];
  const trim = trimFor(shirt);
  return {
    shirt, shorts, socks, trim, sockBand: trimFor(socks), skin: d.skin, hair: d.hair, number: d.number,
    boots: d.boots, bootTrim: d.bootTrim || shirt, gloves: d.gloves, gloveStrap: d.gloves ? shirt : undefined,
  };
}
export { KITS, hex };

// ------------------------------------------------------------------ figure drawing
// A pose is a 2D skeleton in body units (height = 1, y up, x to screen
// right): head, neck, sL/sR shoulders, eL/eR elbows, hL/hR hands,
// hipL/hipR, kL/kR knees, aL/aR ankles, tL/tR toes. `far` ('L' or 'R')
// marks a side view, whose far limbs are drawn first and darker.
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Draws straight onto ctx (no shading); drawShadedFigure() adds the gradient.
// ox, oy: screen point of body (0, 0). px: screen pixels per body unit.
// opts: { back, face, faceDir }
export function drawFigure(ctx, pose, kit, ox, oy, px, opts = {}) {
  const X = (p) => ox + p[0] * px, Y = (p) => oy - p[1] * px;
  const fill = (c) => { ctx.fillStyle = c; ctx.fill(); };
  // band: a flat strip across a limb (no round caps), for sock tops, cuffs and glove straps
  const band = (a, b, r, c) => {
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), R = r * px;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * R, ny = dx / len * R;
    ctx.beginPath();
    ctx.moveTo(ax + nx, ay + ny); ctx.lineTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.lineTo(ax - nx, ay - ny);
    ctx.closePath(); fill(c);
  };
  const capsule = (a, b, r1, r2, c) => {
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), R1 = r1 * px, R2 = r2 * px;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(ax + nx * R1, ay + ny * R1); ctx.lineTo(bx + nx * R2, by + ny * R2);
    ctx.lineTo(bx - nx * R2, by - ny * R2); ctx.lineTo(ax - nx * R1, ay - ny * R1); ctx.closePath();
    ctx.moveTo(ax + R1, ay); ctx.arc(ax, ay, R1, 0, Math.PI * 2);
    ctx.moveTo(bx + R2, by); ctx.arc(bx, by, R2, 0, Math.PI * 2);
    fill(c);
  };
  const poly = (pts, c) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.closePath(); fill(c);
  };

  const keeper = !!kit.gloves;
  const leg = (side, dim) => {
    const c = (h) => (dim ? shade(h, 0.72) : h);
    const hip = pose['hip' + side], knee = pose['k' + side], ank = pose['a' + side], toe = pose['t' + side];
    capsule(hip, knee, 0.058, 0.044, c(kit.skin));
    capsule(knee, lerp2(knee, ank, 0.12), 0.044, 0.044, c(kit.skin));
    capsule(lerp2(knee, ank, 0.12), lerp2(knee, ank, 0.4), 0.043, 0.045, c(kit.socks));
    capsule(lerp2(knee, ank, 0.4), ank, 0.045, 0.027, c(kit.socks));
    band(lerp2(knee, ank, 0.12), lerp2(knee, ank, 0.2), 0.0445, c(kit.sockBand));
    capsule(ank, toe, 0.031, 0.022, c(kit.boots));
    capsule(lerp2(ank, toe, 0.25), toe, 0.012, 0.012, c(kit.bootTrim));
    capsule(hip, lerp2(hip, knee, 0.42), 0.074, 0.066, c(kit.shorts));
  };
  const arm = (side, dim) => {
    const c = (h) => (dim ? shade(h, 0.72) : h);
    const sh = pose['s' + side], el = pose['e' + side], ha = pose['h' + side];
    capsule(sh, el, 0.04, 0.032, c(keeper ? kit.shirt : kit.skin));
    capsule(el, ha, 0.032, 0.025, c(keeper ? kit.shirt : kit.skin));
    if (!keeper) capsule(sh, lerp2(sh, el, 0.5), 0.05, 0.044, c(kit.shirt));
    if (!keeper) band(lerp2(sh, el, 0.44), lerp2(sh, el, 0.5), 0.0445, c(kit.trim));
    if (keeper) {
      const tip = [ha[0] + (ha[0] - el[0]) * 0.38, ha[1] + (ha[1] - el[1]) * 0.38];
      capsule(lerp2(el, ha, 0.85), tip, 0.036, 0.046, c(kit.gloves));
      band(lerp2(el, ha, 0.84), lerp2(el, ha, 0.93), 0.038, c(kit.gloveStrap));
    } else {
      const tip = [ha[0] + (ha[0] - el[0]) * 0.22, ha[1] + (ha[1] - el[1]) * 0.22];
      capsule(ha, tip, 0.024, 0.02, c(kit.skin));
    }
  };

  const near = pose.far === 'L' ? 'R' : 'L';
  if (pose.far) { leg(pose.far, true); arm(pose.far, true); } else { leg('L'); leg('R'); }

  // torso: shoulders widened along the shoulder line, hips along the hip line
  const sL = pose.sL, sR = pose.sR, hL = pose.hipL, hR = pose.hipR;
  const pelvis = lerp2(hL, hR, 0.5), neck = pose.neck;
  const up = [neck[0] - pelvis[0], neck[1] - pelvis[1]], ul = Math.hypot(up[0], up[1]) || 1;
  const u = [up[0] / ul, up[1] / ul], s = [u[1], -u[0]];   // s points to the body's screen-right
  const w = (p, k, j = 0) => [p[0] + s[0] * k + u[0] * j, p[1] + s[1] * k + u[1] * j];
  const sw = pose.far ? 0.06 : 0.035;
  const top = lerp2(sL, sR, 0.5);
  const torso = pose.far
    ? [w(top, -0.085, 0.03), w(top, 0.075, 0.03), w(pelvis, 0.07, 0.07), w(pelvis, 0.07, -0.02), w(pelvis, -0.075, -0.02), w(pelvis, -0.08, 0.07)]
    : [w(sL, -sw, 0.03), w(sR, sw, 0.03), w(lerp2(sR, hR, 0.55), 0.01), w(hR, 0.045, 0.06), w(hL, -0.045, 0.06), w(lerp2(sL, hL, 0.55), -0.01)];
  poly(torso, kit.shirt);
  // side panel / trim
  if (!pose.far) {
    poly([w(lerp2(sR, hR, 0.3), sw * 0.6), w(lerp2(sR, hR, 0.3), sw * 0.6 - 0.018), w(hR, 0.027, 0.06), w(hR, 0.045, 0.06)], kit.trim);
    poly([w(lerp2(sL, hL, 0.3), -sw * 0.6), w(lerp2(sL, hL, 0.3), -sw * 0.6 + 0.018), w(hL, -0.027, 0.06), w(hL, -0.045, 0.06)], kit.trim);
  }
  // shorts waistband
  poly(pose.far
    ? [w(pelvis, 0.075, 0.075), w(pelvis, 0.075, -0.06), w(pelvis, -0.08, -0.06), w(pelvis, -0.08, 0.075)]
    : [w(hR, 0.055, 0.07), w(hR, 0.07, -0.04), w(hL, -0.07, -0.04), w(hL, -0.055, 0.07)], kit.shorts);

  // number on the back / crest on the front
  const chest = lerp2(top, pelvis, 0.38);
  const ang = Math.atan2(-s[1], s[0]);   // the body's lean, as a screen rotation (clockwise +)
  if (opts.back && kit.number) {
    ctx.save();
    ctx.translate(X(chest), Y(chest)); ctx.rotate(ang);
    ctx.fillStyle = kit.trim; ctx.textAlign = 'center';
    ctx.font = `${0.14 * px}px Impact, 'Arial Black', sans-serif`;
    ctx.fillText(kit.number, 0, 0.045 * px);
    if (kit.name) {
      ctx.font = `${0.032 * px}px 'Arial Black', sans-serif`;
      ctx.fillText(kit.name, 0, -0.06 * px);
    }
    ctx.restore();
  } else if (!pose.far) {
    const crest = w(chest, -0.045, 0.06);
    ctx.beginPath(); ctx.arc(X(crest), Y(crest), 0.014 * px, 0, Math.PI * 2); fill(kit.trim);
  }

  if (pose.far) { leg(near); arm(near); } else { arm('L'); arm('R'); }

  // neck + head
  const head = pose.head;
  capsule(neck, lerp2(neck, head, 0.5), 0.028, 0.026, shade(kit.skin, 0.85));
  const collar = w(neck, 0, -0.005);
  ctx.beginPath(); ctx.ellipse(X(collar), Y(collar), 0.042 * px, 0.016 * px, ang, 0, Math.PI * 2); fill(kit.trim);
  const rx = 0.056 * px, ry = 0.066 * px;
  ctx.save();
  ctx.translate(X(head), Y(head)); ctx.rotate(ang);
  ctx.beginPath();
  ctx.ellipse(-rx * 0.98, ry * 0.05, rx * 0.18, ry * 0.26, 0, 0, Math.PI * 2);
  ctx.moveTo(rx * 0.98 + rx * 0.18, ry * 0.05); ctx.ellipse(rx * 0.98, ry * 0.05, rx * 0.18, ry * 0.26, 0, 0, Math.PI * 2);
  fill(shade(kit.skin, 0.9));
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); fill(kit.skin);
  ctx.beginPath();
  if (opts.back) {
    ctx.moveTo(-rx * 1.02, ry * 0.2);
    ctx.quadraticCurveTo(-rx * 1.1, -ry * 1.25, 0, -ry * 1.12);
    ctx.quadraticCurveTo(rx * 1.1, -ry * 1.25, rx * 1.02, ry * 0.2);
    ctx.quadraticCurveTo(0, ry * 0.72, -rx * 1.02, ry * 0.2);
    ctx.closePath(); fill(kit.hair);
  } else {
    ctx.moveTo(-rx * 1.03, -ry * 0.05);
    ctx.quadraticCurveTo(-rx * 1.05, -ry * 1.25, 0, -ry * 1.12);
    ctx.quadraticCurveTo(rx * 1.05, -ry * 1.25, rx * 1.03, -ry * 0.05);
    ctx.quadraticCurveTo(rx * 0.7, -ry * 0.62, 0, -ry * 0.6);
    ctx.quadraticCurveTo(-rx * 0.7, -ry * 0.62, -rx * 1.03, -ry * 0.05);
    ctx.closePath(); fill(kit.hair);
    if (opts.face && !pose.far) {
      ctx.beginPath();
      ctx.ellipse(-rx * 0.38, -ry * 0.05, rx * 0.11, ry * 0.08, 0, 0, Math.PI * 2);
      ctx.moveTo(rx * 0.38 + rx * 0.11, -ry * 0.05); ctx.ellipse(rx * 0.38, -ry * 0.05, rx * 0.11, ry * 0.08, 0, 0, Math.PI * 2);
      fill(shade(kit.skin, 0.35));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.58, -ry * 0.25); ctx.lineTo(-rx * 0.2, -ry * 0.29);
      ctx.moveTo(rx * 0.58, -ry * 0.25); ctx.lineTo(rx * 0.2, -ry * 0.29);
      ctx.strokeStyle = kit.hair; ctx.lineWidth = rx * 0.12; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-rx * 0.25, ry * 0.48); ctx.quadraticCurveTo(0, ry * 0.58, rx * 0.25, ry * 0.48);
      ctx.strokeStyle = shade(kit.skin, 0.55); ctx.lineWidth = rx * 0.08; ctx.stroke();
    }
    if (pose.far) {   // side view: a nose toward the way the player faces
      const dir = opts.faceDir || (pose.far === 'R' ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(dir * rx * 0.95, -ry * 0.1); ctx.lineTo(dir * rx * 1.13, ry * 0.08); ctx.lineTo(dir * rx * 0.93, ry * 0.13);
      ctx.closePath(); fill(kit.skin);
    }
  }
  ctx.restore();
}

// Draws the figure with the concept's volumetric shading: the figure goes
// into a scratch canvas, a light-to-dark gradient is painted over it with
// 'source-atop' (so only the silhouette is tinted), and the result is copied
// onto ctx. dpr: device pixels per CSS pixel. light: +1 = from screen-right.
const scratch = { canvas: null, ctx: null };
export function drawShadedFigure(ctx, pose, kit, ox, oy, px, opts = {}, dpr = 1) {
  // bounding box of the skeleton plus the widest limb, in CSS pixels
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k in pose) {
    const p = pose[k];
    if (!Array.isArray(p)) continue;
    const x = ox + p[0] * px, y = oy - p[1] * px;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = 0.16 * px;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const bw = Math.ceil((x1 - x0) * dpr), bh = Math.ceil((y1 - y0) * dpr);
  if (!(bw > 0 && bh > 0) || bw > 4096 || bh > 4096) return;
  if (!scratch.canvas) {
    scratch.canvas = document.createElement('canvas');
    scratch.ctx = scratch.canvas.getContext('2d');
  }
  const c = scratch.canvas, g = scratch.ctx;
  if (c.width < bw || c.height < bh) { c.width = Math.max(c.width, bw); c.height = Math.max(c.height, bh); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, bw + 2, bh + 2);
  g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
  drawFigure(g, pose, kit, ox, oy, px, opts);
  // the concept's gradient: light from the top on the lit side, dark at the far bottom
  const right = (opts.light ?? 1) > 0;
  const grad = g.createLinearGradient(right ? x1 : x0, y0, right ? x0 : x1, y1);
  grad.addColorStop(0, 'rgba(255,246,220,0.32)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(5,10,26,0.42)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = grad;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.globalCompositeOperation = 'source-over';
  ctx.drawImage(c, 0, 0, bw, bh, x0, y0, bw / dpr, bh / dpr);
}

// ------------------------------------------------------------------ joints from the 3D body
// The procedural bodies only have hips, shoulders, gloves, feet and a head.
// Knees and elbows are placed a little off the straight line between the
// real joints, bending the natural way, so the figure is not stiff while
// the gloves, feet and hips stay exactly where the collision body is.
export const BODY_H = 1.8;            // metres per concept body unit
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _chest = new THREE.Vector3();
const _sh = new THREE.Vector3(), _gl = new THREE.Vector3(), _mid = new THREE.Vector3(), _arm = new THREE.Vector3();
const _p = { x: 0, y: 0, s: 0, d: 0 };

// fwd: +1 when the body faces its local +z (the keeper, toward the taker),
// -1 when it faces local -z (the takers, toward the goal).
// Returns { pose, ox, oy, px, depth, back, face, faceDir, foot } or null when off camera.
export function bodyPose(body, cam, { fwd = 1, kneeOut = 0.02 } = {}) {
  const root = body.root;
  root.updateMatrixWorld(true);
  const pts = {}, world = {};
  let ok = true;
  const put = (name, v) => {
    world[name] = [v.x, v.y, v.z];
    const p = project(cam, v.x, v.y, v.z, _p);
    if (!p) { ok = false; return; }
    pts[name] = [p.x, p.y];
  };
  // legs: hips[0] is the body's -x side ('A'), hips[1] its +x side ('B')
  body.hips.forEach((hip, i) => {
    const side = i ? 'B' : 'A', out = i ? 1 : -1;
    put('hip' + side, hip.getWorldPosition(_v));
    put('k' + side, hip.localToWorld(_v.set(out * kneeOut, -0.41, fwd * 0.06)));
    put('a' + side, hip.localToWorld(_v.set(0, -0.8, 0)));
    put('t' + side, hip.localToWorld(_v.set(0, -0.86, fwd * 0.16)));
  });
  // arms: the drawn shoulder sits a little inside the 3D arm pivot; the glove is exact
  root.localToWorld(_chest.set(0, 1.2, 0));
  body.shoulders.forEach((shoulder, i) => {
    const side = i ? 'B' : 'A';
    shoulder.getWorldPosition(_sh);
    body.gloves[i].getWorldPosition(_gl);
    // elbow: halfway down the arm, pushed out away from the chest
    _mid.addVectors(_sh, _gl).multiplyScalar(0.5);
    _arm.subVectors(_gl, _sh).normalize();
    _w.subVectors(_mid, _chest);
    _w.addScaledVector(_arm, -_w.dot(_arm));
    if (_w.lengthSq() > 1e-8) _mid.addScaledVector(_w.normalize(), 0.05);
    put('e' + side, _mid);
    // the concept's glove reaches past the wrist: put the wrist so the glove's middle is on the collision glove
    _v.copy(_mid).lerp(_gl, 1 / 1.115);
    put('h' + side, _v);
    put('s' + side, root.localToWorld(_v.set((i ? 1 : -1) * 0.2, 1.44, 0)));
  });
  put('neck', root.localToWorld(_v.set(0, 1.52, 0)));
  put('head', root.localToWorld(_v.set(0, 1.68, 0)));
  if (!ok) return null;

  // scale: pixels per body unit at the pelvis
  const pel = _v.set(0, 0, 0).addVectors(body.hips[0].getWorldPosition(_w), body.hips[1].getWorldPosition(_sh)).multiplyScalar(0.5);
  const pp = project(cam, pel.x, pel.y, pel.z, _p);
  if (!pp) return null;
  const px = pp.s * BODY_H, ox = pp.x, oy = pp.y, depth = pp.d;
  // the patch of grass under the body, for its shadow (wide when lying down in a dive)
  let sx0 = Infinity, sx1 = -Infinity, low = Infinity;
  for (const k in world) { sx0 = Math.min(sx0, world[k][0]); sx1 = Math.max(sx1, world[k][0]); low = Math.min(low, world[k][1]); }
  const foot = { x: (sx0 + sx1) / 2, z: pel.z, half: (sx1 - sx0) / 2, lift: Math.max(0, low) };

  // which way the body faces, relative to the camera
  root.localToWorld(_w.set(0, 0, fwd)).sub(root.getWorldPosition(_sh));
  const toward = _w.x * cam.fwd[0] + _w.z * cam.fwd[2];   // > 0: facing away from us
  const side = Math.abs(toward) < 0.5;
  const pose = {};
  // screen px -> body units around the pelvis
  const B = (p) => [(p[0] - ox) / px, (oy - p[1]) / px];
  for (const k in pts) pose[k] = B(pts[k]);

  const rename = (a, b) => {
    for (const k of ['hip', 'k', 'a', 't', 's', 'e', 'h']) { pose[k + 'L'] = pose[k + a]; pose[k + 'R'] = pose[k + b]; delete pose[k + 'A']; delete pose[k + 'B']; }
  };
  let faceDir = 0;
  if (side) {
    // the far side is the shoulder further from the lens
    const dA = depthOf(cam, world.sA), dB = depthOf(cam, world.sB);
    rename('A', 'B');
    pose.far = dA > dB ? 'L' : 'R';
    // the nose points where the facing direction lands on screen
    const fx = _w.x * cam.right[0] + _w.z * cam.right[2];
    faceDir = fx >= 0 ? 1 : -1;
  } else {
    // front or back: L is whichever side is on the body's screen-left
    const pelvis = lerp2(pose.hipA, pose.hipB, 0.5);
    const u = [pose.neck[0] - pelvis[0], pose.neck[1] - pelvis[1]];
    const s = [u[1], -u[0]];
    const ab = (pose.sB[0] - pose.sA[0]) * s[0] + (pose.sB[1] - pose.sA[1]) * s[1];
    if (ab >= 0) rename('A', 'B'); else rename('B', 'A');
  }
  return { pose, ox, oy, px, depth, back: toward > 0.5, face: toward < -0.5, faceDir, foot };
}
const depthOf = (cam, p) => (p[0] - cam.eye.x) * cam.fwd[0] + (p[1] - cam.eye.y) * cam.fwd[1] + (p[2] - cam.eye.z) * cam.fwd[2];
