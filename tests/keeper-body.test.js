import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makePerson, KITS, newKeeper, planDive, updateKeeper, DIVE_HOLD, DIVE_LAND, GETUP_PAUSE, GETUP, SHUFFLE } from '../src/body/people.js';
import { RUNUP } from '../src/core/constants.js';

// The lowest world-space vertex of every mesh in the body. Slower than
// lowestPoint() in people.js, but it checks the real triangles, so it also
// checks that function.
const _v = new THREE.Vector3();
function lowestVertex(root) {
  root.updateMatrixWorld(true);
  let low = Infinity;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) low = Math.min(low, _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y);
  });
  return low;
}

const body = makePerson(new THREE.Scene(), KITS.cpuKeeper);
const xs = [-3.4, -2.4, -1.2, -0.4, 0, 0.4, 1.2, 2.4, 3.4];
const ys = [0.1, 0.4, 0.9, 1.5, 2.1, 2.4];
const H = 1 / 240;
// Long enough for the slowest dive to land, rest, and get back up.
const ALL_DONE = 0.52 + DIVE_HOLD + DIVE_LAND + GETUP_PAUSE + GETUP + 0.1;

describe('keeper body', () => {
  it('never goes into the grass: dive, hold at full stretch, land, get up', () => {
    let worst = Infinity;
    for (const homeX of [0, -0.8]) {
      for (const tx of xs) for (const ty of ys) {
        const k = newKeeper(body);
        k.active = true; k.x = k.homeX = homeX;
        planDive(k, tx, ty);
        for (let t = 0; t < ALL_DONE; t += H) {
          updateKeeper(k, H, t);
          if (Math.round(t / H) % 4 === 0) worst = Math.min(worst, lowestVertex(body.root));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(-0.01);
  });

  it('still lies low enough to stop a ball along the ground', () => {
    // At full stretch for a low corner the lower glove is close to the grass.
    const k = newKeeper(body);
    k.active = true;
    planDive(k, 3, 0.15);
    for (let t = 0; t < k.dive.dur; t += H) updateKeeper(k, H, t);
    const glove = new THREE.Vector3();
    body.gloves[1].getWorldPosition(glove);
    expect(glove.y).toBeLessThan(0.45);
  });

  it('gets back up in one smooth roll and stays where the dive ended', () => {
    for (const [tx, ty] of [[3, 0.2], [-2.6, 1.8], [0.3, 2.2], [1, 0.5]]) {
      const k = newKeeper(body);
      k.active = true;
      planDive(k, tx, ty);
      let prev = null, maxJump = 0;
      for (let t = 0; t < ALL_DONE; t += H) {
        updateKeeper(k, H, t);
        if (prev) maxJump = Math.max(maxJump, Math.abs(k.tilt - prev.tilt), Math.abs(k.y - prev.y));
        prev = { tilt: k.tilt, y: k.y };
      }
      expect(k.tilt).toBe(0);
      expect(k.y).toBeLessThan(0.01);
      expect(k.arms).toBe(0);
      expect(k.x).toBeCloseTo(k.dive.toX, 5);
      // At 240 steps a second, nothing moves more than a few centimetres
      // (or a few hundredths of a radian) in one step: no snap.
      expect(maxJump).toBeLessThan(0.03);
    }
  });

  it('a new kick shuffles the same keeper sideways back to the centre', () => {
    // Lying on the grass after a long dive (before getting up), as when a
    // training shot ends early and the next one starts.
    const old = newKeeper(body);
    old.active = true;
    planDive(old, 3.2, 0.3);
    for (let t = 0; t < 1.4; t += H) updateKeeper(old, H, t);
    const startX = body.root.position.x;
    expect(startX).toBeGreaterThan(1);
    const k = newKeeper(body, old);
    k.active = true;
    expect(k.x).toBe(startX);   // starts where it was drawn
    const at = body.root.position.clone();
    let maxMove = 0, worst = Infinity, steps = 0, open = false, backwards = 0, prevX = k.x, endX = null;
    for (let t = 0; t < 0.75; t += H) {   // a little longer than SHUFFLE
      updateKeeper(k, H, t);
      maxMove = Math.max(maxMove, body.root.position.distanceTo(at));
      at.copy(body.root.position);
      worst = Math.min(worst, lowestVertex(body.root));
      if (t < SHUFFLE && k.x > prevX + 1e-9) backwards++;
      prevX = k.x;
      if (endX === null && !k.shuffle) endX = k.x;
      // count side-steps: the leading (-x side) leg opening wider than standing
      const wide = body.hips[0].rotation.z < -0.2;
      if (wide && !open) steps++;
      open = wide;
    }
    expect(maxMove).toBeLessThan(0.05);         // no jump between steps
    expect(worst).toBeGreaterThanOrEqual(-0.01);
    expect(backwards).toBe(0);                  // always heading for the centre
    expect(steps).toBeGreaterThanOrEqual(3);    // real side-steps, not a slide
    expect(k.shuffle).toBe(null);
    expect(k.blend).toBe(null);
    expect(Math.abs(endX)).toBeLessThan(1e-9);   // exactly on the spot when the shuffle ends
    expect(Math.abs(body.root.rotation.z)).toBeLessThan(1e-9);   // standing, facing forward
    expect(body.root.rotation.y).toBe(0);
  });

  it('the shuffle is over before a CPU kick can be struck', () => {
    expect(SHUFFLE).toBeLessThan(RUNUP);
  });

  it('a different body (the other keeper) starts standing, with no shuffle', () => {
    const other = makePerson(new THREE.Scene(), KITS.youKeeper);
    const old = newKeeper(other);
    const k = newKeeper(body, old);
    expect(k.shuffle).toBe(null);
    expect(k.blend).toBe(null);
  });
});
