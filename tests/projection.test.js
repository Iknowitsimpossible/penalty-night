import { describe, it, expect } from 'vitest';
import { makeCamera, project, projectPoly, screenToGoal, screenToPlaneZ, NEAR } from '../src/view2d/projection.js';
import { viewCamera, VIEWS } from '../src/view2d/views.js';
import { HALF, GOAL_H, KEEPER_Z } from '../src/core/constants.js';

// The concept page's camera: 7 m behind the spot, 2.4 m up, level, f = 1296.
const concept = () => makeCamera({ x: 0, y: 2.4, z: 18 }, { x: 0, y: 2.4, z: 0 }, 1296, 800, 360);

describe('pinhole projection', () => {
  it('matches the concept page formula', () => {
    // concept: [cx + f X / Z, hz + f (camH - Y) / Z] with Z the distance from the camera
    const p = project(concept(), 1.3, 0.5, 0);
    expect(p.x).toBeCloseTo(800 + 1296 * 1.3 / 18, 6);
    expect(p.y).toBeCloseTo(360 + 1296 * (2.4 - 0.5) / 18, 6);
    expect(p.s).toBeCloseTo(1296 / 18, 6);
    expect(p.d).toBeCloseTo(18, 6);
  });

  it('puts the look-at point on the screen centre, for any direction', () => {
    const cam = makeCamera({ x: 9, y: 1.6, z: 5.5 }, { x: 0.8, y: 1, z: 4 }, 900, 640, 400);
    const p = project(cam, 0.8, 1, 4);
    expect(p.x).toBeCloseTo(640, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });

  it('keeps up up and right right', () => {
    const cam = viewCamera('shoot', 1280, 800);
    const a = project(cam, 0, 0, 0), up = project(cam, 0, 1, 0), right = project(cam, 1, 0, 0);
    expect(up.y).toBeLessThan(a.y);
    expect(right.x).toBeGreaterThan(a.x);
    // behind the goal looking out, world +x is screen left
    const k = viewCamera('keeper', 1280, 800);
    expect(project(k, 1, 1, 5).x).toBeLessThan(project(k, 0, 1, 5).x);
  });

  it('returns null behind the lens and clips polygons at the near plane', () => {
    const cam = concept();
    expect(project(cam, 0, 0, 30)).toBe(null);
    expect(project(cam, 0, 0, 18 - NEAR / 2)).toBe(null);
    // a ground quad running from in front of the camera to behind it
    const poly = projectPoly(cam, [[-5, 0, 0], [5, 0, 0], [5, 0, 30], [-5, 0, 30]]);
    expect(poly.length).toBe(4);
    poly.forEach(([x, y]) => { expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true); });
    expect(projectPoly(cam, [[-5, 0, 20], [5, 0, 20], [5, 0, 30]])).toEqual([]);
  });
});

describe('tap to goal (the inverse projection)', () => {
  it('maps a projected goal point back to where it came from', () => {
    for (const name of ['keeper', 'shoot']) {
      for (const [w, h] of [[1280, 800], [375, 812], [812, 375]]) {
        const cam = viewCamera(name, w, h);
        for (const [x, y] of [[0, 1], [-3.2, 0.2], [3.4, 2.3], [1.1, 1.7]]) {
          const p = project(cam, x, y, KEEPER_Z);
          const g = screenToGoal(cam, p.x, p.y);
          expect(g.x).toBeCloseTo(x, 6);
          expect(g.y).toBeCloseTo(y, 6);
        }
      }
    }
  });

  it('clamps far-off taps to what a dive can reach, and rejects taps that never reach the goal', () => {
    const cam = viewCamera('keeper', 1280, 800);
    const sky = screenToGoal(cam, 640, -5000);
    expect(sky === null || sky.y === 2.9).toBe(true);
    const wide = screenToGoal(cam, -4000, 400);
    expect(wide.x).toBe(4.6);   // screen left is world +x from behind the goal
    // shoot camera looks level: a tap far above the horizon is still in front, low taps hit the grass side
    const shoot = viewCamera('shoot', 1280, 800);
    expect(screenToPlaneZ(shoot, 640, 400, 30)).toBe(null);   // the plane behind the camera
  });

  it('keeps every corner of the goal on screen in the keeper view, even on a tall phone', () => {
    for (const [w, h] of [[1280, 800], [375, 812], [320, 700], [1024, 1366]]) {
      const cam = viewCamera('keeper', w, h);
      for (const [x, y] of [[-HALF, 0], [HALF, 0], [-HALF, GOAL_H], [HALF, GOAL_H]]) {
        const p = project(cam, x, y, KEEPER_Z);
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(w);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('stays finite after a 0x0 resize (hidden container)', () => {
    for (const name of VIEWS) {
      const cam = viewCamera(name, 0, 0);
      const p = project(cam, 0, 1, 0);
      expect(p === null || (Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(Number.isFinite(cam.f)).toBe(true);
    }
  });
});
