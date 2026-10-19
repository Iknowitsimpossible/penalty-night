import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { extractRootMotion, sampleCurve, warpTime } from '../src/render/clip-tools.js';

function diveClip() {
  // hips start at (5, 90, 2), travel 200 sideways and 20 forward, dropping to 15
  const times = [0, 0.5, 1];
  const pos = new THREE.VectorKeyframeTrack('Hips.position', times, [5, 90, 2, 105, 60, 12, 205, 15, 22]);
  const rot = new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.7071, 0.7071]);
  return new THREE.AnimationClip('dive', 1, [pos, rot]);
}

describe('root motion', () => {
  it('moves the hips travel into a curve and leaves height and rotation in the clip', () => {
    const clip = diveClip();
    const curve = extractRootMotion(clip, 'Hips');
    expect([...curve.x]).toEqual([0, 100, 200]);
    expect([...curve.z]).toEqual([0, 10, 20]);
    const v = [...clip.tracks[0].values];
    expect(v).toEqual([5, 90, 2, 5, 60, 2, 5, 15, 2]);   // x, z pinned; y kept
    expect(clip.tracks[1].values[7]).toBeCloseTo(0.7071);
  });

  it('works in world space under a scaled, turned parent (a Z-up export in centimetres)', () => {
    // Blender's export: the skeleton is scaled 0.01 and turned +90 degrees about x,
    // which sends the track's local y to world +z and local z to world -y.
    const parent = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Vector3(0.01, 0.01, 0.01));
    // world: start at height 0.9, travel 2 m sideways and 0.5 m forward while dropping to 0.2
    const toLocal = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(parent.clone().invert()).toArray();
    const track = new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [...toLocal(0, 0.9, 0), ...toLocal(2, 0.2, 0.5)]);
    const clip = new THREE.AnimationClip('dive', 1, [track]);
    const curve = extractRootMotion(clip, 'Hips', parent);
    expect(curve.x[1]).toBeCloseTo(2);
    expect(curve.z[1]).toBeCloseTo(0.5);
    const end = new THREE.Vector3().fromArray(clip.tracks[0].values, 3).applyMatrix4(parent);
    expect(end.x).toBeCloseTo(0); expect(end.z).toBeCloseTo(0);   // travel pinned
    expect(end.y).toBeCloseTo(0.2);                               // height kept
  });

  it('a clip without a hips track has no travel', () => {
    const clip = new THREE.AnimationClip('idle', 1, []);
    expect(sampleCurve(extractRootMotion(clip, 'Hips'), 'x', 0.5)).toBe(0);
  });

  it('samples the curve linearly and clamps outside it', () => {
    const curve = extractRootMotion(diveClip(), 'Hips');
    expect(sampleCurve(curve, 'x', 0.25)).toBeCloseTo(50);
    expect(sampleCurve(curve, 'x', 0.75)).toBeCloseTo(150);
    expect(sampleCurve(curve, 'x', -1)).toBe(0);
    expect(sampleCurve(curve, 'x', 9)).toBe(200);
  });
});

describe('time warp', () => {
  // the game reaches full stretch at 0.45 s, the clip at 0.87 s
  const keys = [[0, 0], [0.45, 0.87], [0.9, 1.2]];
  it('hits every matching moment exactly', () => {
    for (const [g, c] of keys) expect(warpTime(g, keys)).toBeCloseTo(c);
  });
  it('runs at a constant rate between moments and at `after` speed past the last', () => {
    expect(warpTime(0.225, keys)).toBeCloseTo(0.435);
    expect(warpTime(1.4, keys)).toBeCloseTo(1.7);
    expect(warpTime(1.4, keys, 0.5)).toBeCloseTo(1.45);
  });
  it('never runs backwards', () => {
    let prev = -Infinity;
    for (let t = -0.1; t < 2; t += 0.01) { const c = warpTime(t, keys); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
  });
});
