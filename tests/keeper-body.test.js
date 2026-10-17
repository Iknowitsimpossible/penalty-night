import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makePerson, KITS, newKeeper, planDive, updateKeeper } from '../src/render/people.js';

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

describe('keeper body', () => {
  it('never goes into the grass: dive, hold at full stretch, land', () => {
    let worst = Infinity;
    for (const homeX of [0, -0.8]) {
      for (const tx of xs) for (const ty of ys) {
        const k = newKeeper(body);
        k.active = true; k.x = k.homeX = homeX;
        planDive(k, tx, ty);
        for (let t = 0; t < 2; t += H) {
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
});
