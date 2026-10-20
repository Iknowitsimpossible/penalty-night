import { describe, it, expect } from 'vitest';
import { createDirector } from '../src/view2d/director.js';
import { viewCamera } from '../src/view2d/views.js';
import { project } from '../src/view2d/projection.js';

// The 2D successor of the old camera director tests: a hidden (0x0)
// container must never leave the camera broken, and each moment of the
// game must pick the right shot.
const finiteCam = (c) => [c.eye.x, c.eye.y, c.eye.z, c.f, c.cx, c.cy, ...c.fwd, ...c.right, ...c.up].every(Number.isFinite);

describe('camera director (2D)', () => {
  it('survives a 0x0 resize (hidden container) followed by a real one', () => {
    const d = createDirector();
    d.goal = 'keeper';
    expect(finiteCam(viewCamera(d.view, 0, 0))).toBe(true);
    const cam = viewCamera(d.view, 1280, 720);
    expect(finiteCam(cam)).toBe(true);
    expect(cam.eye.z).toBeLessThan(0);   // behind the goal
    const p = project(cam, 0, 1, 0.35);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('cuts to the right shot for each moment', () => {
    const d = createDirector();
    const shots = { intro: 'menu', menu: 'menu', pick: 'pick', shoot: 'shoot', celebrate: 'shoot', keeper: 'keeper' };
    for (const [goal, view] of Object.entries(shots)) { d.goal = goal; expect(d.view).toBe(view); }
    d.goal = 'replay';
    d.replaySide = -1; expect(d.view).toBe('replayL');
    d.replaySide = 1; expect(d.view).toBe('replayR');
  });

  it('shakes, settles, keeps the jolt finite, and never shakes with reduced motion', () => {
    const d = createDirector();
    d.shake(0.06);
    d.update(1 / 60, 0.3, { reduced: false });
    expect(Math.hypot(...d.jolt)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) d.update(1 / 60, 0.3 + i / 60, { reduced: false });
    expect(Math.hypot(...d.jolt)).toBeLessThan(0.1);
    d.shake(NaN);
    d.update(1 / 60, 3, { reduced: false });
    expect(d.jolt.every(Number.isFinite)).toBe(true);
    d.shake(0.06);
    d.update(1 / 60, 3.1, { reduced: true });
    expect(d.jolt).toEqual([0, 0]);
  });
});
