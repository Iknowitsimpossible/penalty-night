// The fixed camera shots the 2D game cuts between. Each one is a plain
// pinhole camera (projection.js) worked out for the screen size, so the
// stadium behind it can be painted once and reused every frame.
import { KEEPER_Z } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { makeCamera } from './projection.js';

const BASE_DIST = 6.75, GOAL_VIEW = 4.3;   // metres: keeper shot distance, goal half-width that must fit

// Vertical field of view (degrees): wider on portrait screens so the goal still fits.
export const baseFov = (w, h) => (w / h < 1 ? clamp(50 / (w / h) * 0.72, 50, 78) : 50);
const focal = (h, fovDeg) => (h / 2) / Math.tan((fovDeg * Math.PI) / 360);

export const VIEWS = ['shoot', 'keeper', 'menu', 'pick', 'replayL', 'replayR'];

// name: one of VIEWS. w, h: screen size in CSS pixels (a 0x0 size is treated as 1x1).
export function viewCamera(name, w, h) {
  w = w > 0 ? w : 1; h = h > 0 ? h : 1;
  const fov = baseFov(w, h), f = focal(h, fov);
  if (name === 'shoot') {
    // The concept's shot: 7 m behind the spot, 2.4 m up, looking level with
    // the horizon 40% down the screen. The lens is set by the width (with a
    // floor for tall phones), so the goal fills a third of a landscape screen.
    const lens = Math.max(0.81 * w, 0.62 * h);
    const portrait = w / h < 1;
    return makeCamera({ x: 0, y: 2.4, z: 18 }, { x: 0, y: 2.4, z: 0 }, lens, w / 2, h * (portrait ? 0.5 : 0.4));
  }
  if (name === 'keeper') {
    // Behind the goal. On narrow screens the camera backs up until the whole
    // goal mouth fits, so every corner can be seen and tapped.
    const half = Math.atan((w / 2) / f);
    const d = Math.max(BASE_DIST, GOAL_VIEW / Math.tan(half));
    return makeCamera({ x: 0, y: Math.min(6, 3.5 * d / BASE_DIST), z: KEEPER_Z - d }, { x: 0, y: 0.7, z: 10 }, f, w / 2, h / 2);
  }
  if (name === 'menu') {
    // the floodlit goal on the right, clear of the title
    return makeCamera({ x: -3.5, y: 2.1, z: 15.5 }, { x: -4.2, y: 1.6, z: 0 }, f, w / 2, h / 2);
  }
  if (name === 'pick') return makeCamera({ x: 0, y: 1.32, z: 15.6 }, { x: 0, y: 1.25, z: 0 }, f, w / 2, h / 2);
  if (name === 'replayL' || name === 'replayR') {
    // low and to the side the ball went, so the whole flight from spot to goal is in shot
    const side = name === 'replayR' ? 1 : -1;
    return makeCamera({ x: side * 9, y: 1.6, z: 5.5 }, { x: side * 0.8, y: 1, z: 4 }, focal(h, fov * 0.8), w / 2, h / 2);
  }
  throw new Error(`unknown view ${name}`);
}
