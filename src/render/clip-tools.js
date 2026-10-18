// Helpers for the animated keeper's clips: pulling the travel (root motion)
// out of a clip so the game can scale and place it, measuring key moments,
// and mapping game time onto clip time.
import * as THREE from 'three';

// Take the hips' horizontal travel (x and z) out of a clip and return it as
// its own curve. The clip keeps the hips' height (crouching, lying down) and
// all rotations, so the body animates in place while the curve says where
// the whole body should be. Without this the clip would carry the hips
// sideways by its own fixed amount, and the game could not make a dive
// longer or shorter without the feet sliding.
// Returns { times, x, z } relative to the first frame, in the clip's units.
export function extractRootMotion(clip, hipsName) {
  const track = clip.tracks.find((t) => t.name === `${hipsName}.position`);
  if (!track) return { times: new Float32Array([0]), x: new Float32Array([0]), z: new Float32Array([0]) };
  const n = track.times.length, v = track.values;
  const x0 = v[0], z0 = v[2];
  const x = new Float32Array(n), z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = v[i * 3] - x0; z[i] = v[i * 3 + 2] - z0;
    v[i * 3] = x0; v[i * 3 + 2] = z0;
  }
  return { times: track.times.slice(), x, z };
}

// Linear interpolation along a curve from extractRootMotion (clamped at the ends).
export function sampleCurve(curve, key, t) {
  const ts = curve.times, vs = curve[key], n = ts.length;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[n - 1]) return vs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) lo = mid; else hi = mid; }
  const u = (t - ts[lo]) / (ts[hi] - ts[lo]);
  return vs[lo] + (vs[hi] - vs[lo]) * u;
}

// Map game time onto clip time through matching moments:
// keys = [[game0, clip0], [game1, clip1], ...] with both columns increasing.
// Between keys the clip runs at a constant rate; after the last key it runs
// at `after` x real speed.
export function warpTime(t, keys, after = 1) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [g0, c0] = keys[i - 1], [g1, c1] = keys[i];
    if (t <= g1) return c0 + (c1 - c0) * ((t - g0) / (g1 - g0));
  }
  const [gl, cl] = keys[keys.length - 1];
  return cl + (t - gl) * after;
}

// Measure a dive clip by playing it on its own skeleton:
//   start:   take-off, just before the hips start travelling sideways (the
//            clips open with a wind-up the game's dive doesn't have)
//   stretch: full stretch, when the leading hand is furthest from the
//            opposite foot before the hips reach the grass
//   ground:  when the hips first get down near their lowest
//   reach:   how far the hips have travelled sideways at full stretch (clip units)
//   handOff: at full stretch, how far (world units, sideways) the leading hand
//            is from the hips; for a catch, the middle of the two hands
// side: +1 for a dive towards +x, -1 towards -x, 0 for a catch (no side: full
// stretch is then the highest hand).
// bones: { hips, leftHand, rightHand, leftFoot, rightFoot }.
export function measureDive(root, clip, bones, side, curve, steps = 120) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  const scale = root.scale.x;
  const hand = new THREE.Vector3(), foot = new THREE.Vector3(), hips = new THREE.Vector3();
  const lead = side >= 0 ? bones.leftHand : bones.rightHand;   // the keeper faces +z: left hand is on +x
  const far = side >= 0 ? bones.rightFoot : bones.leftFoot;
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const t = (clip.duration - 1e-3) * i / steps;
    mixer.setTime(t); root.updateMatrixWorld(true);
    const travel = sampleCurve(curve, 'x', t) * scale;   // put back the travel taken out of the clip
    lead.getWorldPosition(hand); hand.x += travel;
    far.getWorldPosition(foot); foot.x += travel;
    bones.hips.getWorldPosition(hips);
    const other = (side >= 0 ? bones.rightHand : bones.leftHand).getWorldPosition(new THREE.Vector3());
    const handOff = (side === 0 ? (hand.x - travel + other.x) / 2 : hand.x - travel) - hips.x;
    const highest = Math.max(bones.leftHand.getWorldPosition(foot.clone()).y, bones.rightHand.getWorldPosition(foot.clone()).y);
    samples.push({ t, travel, hipsY: hips.y, spread: hand.distanceTo(foot), highest, handOff });
  }
  action.stop(); mixer.uncacheRoot(root);

  const lowY = Math.min(...samples.map((s) => s.hipsY));
  const groundAt = samples.find((s) => s.hipsY < lowY + 0.05) || samples[samples.length - 1];
  const moving = samples.find((s) => Math.abs(s.travel) > 0.05);
  const start = moving ? Math.max(0, moving.t - 0.15) : 0;
  let best = -Infinity, stretch = start, handOff = 0;
  for (const s of samples) {
    if (s.t < start || s.t > groundAt.t) continue;
    const score = side === 0 ? s.highest : s.spread;
    if (score > best) { best = score; stretch = s.t; handOff = s.handOff; }
  }
  if (stretch <= start) stretch = Math.min(start + 0.2, clip.duration);
  return { start, stretch, ground: Math.max(groundAt.t, stretch), reach: sampleCurve(curve, 'x', stretch), handOff };
}
