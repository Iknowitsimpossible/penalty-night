// A pinhole camera for the 2D renderer. A camera sits at `eye`, looks along
// a direction, and has a focal length `f` in screen pixels. A world point
// (metres: x right, y up, z toward the taker) lands on the screen at
//   sx = cx + f * right / depth,   sy = cy - f * up / depth
// where right / up / depth are the point's coordinates in the camera's own
// frame. Everything is plain numbers (no three.js) so it is easy to test.
import { KEEPER_Z } from '../core/constants.js';
import { clamp } from '../core/math.js';

export const NEAR = 0.15;   // metres: anything closer to the lens is not drawn

// eye, look: {x, y, z}. f: focal length in px. cx, cy: the screen point the
// camera looks through (usually the centre; a lower cy shows more sky).
export function makeCamera(eye, look, f, cx, cy) {
  let fx = look.x - eye.x, fy = look.y - eye.y, fz = look.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = forward x world-up, then up = right x forward
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  return { eye: { ...eye }, f, cx, cy, fwd: [fx, fy, fz], right: [rx, 0, rz], up: [ux, uy, uz] };
}

// The point's coordinates in the camera frame: [right, up, depth].
export function toCamera(cam, x, y, z, out = [0, 0, 0]) {
  const dx = x - cam.eye.x, dy = y - cam.eye.y, dz = z - cam.eye.z;
  out[0] = dx * cam.right[0] + dz * cam.right[2];
  out[1] = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  out[2] = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  return out;
}

// Screen position of a world point: { x, y, s, d } where s is pixels per
// metre at that depth and d the depth. null when the point is behind the lens.
export function project(cam, x, y, z, out = { x: 0, y: 0, s: 0, d: 0 }) {
  const c = toCamera(cam, x, y, z, _c);
  if (c[2] < NEAR) return null;
  const s = cam.f / c[2];
  out.x = cam.cx + c[0] * s; out.y = cam.cy - c[1] * s; out.s = s; out.d = c[2];
  return out;
}
const _c = [0, 0, 0];

// Project a flat polygon of world points, clipped against the near plane so
// a ground or stand face that passes behind the camera still draws the part
// in front. Returns an array of [sx, sy] (empty when it is all behind).
export function projectPoly(cam, pts) {
  const cs = pts.map((p) => toCamera(cam, p[0], p[1], p[2], [0, 0, 0]));
  const kept = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length];
    const ina = a[2] >= NEAR, inb = b[2] >= NEAR;
    if (ina) kept.push(a);
    if (ina !== inb) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return kept.map((c) => [cam.cx + cam.f * c[0] / c[2], cam.cy - cam.f * c[1] / c[2]]);
}

// The world point on the plane z = planeZ under a screen point, or null when
// the ray through that pixel never reaches the plane in front of the camera.
export function screenToPlaneZ(cam, sx, sy, planeZ) {
  const a = (sx - cam.cx) / cam.f, b = (cam.cy - sy) / cam.f;
  const dx = cam.fwd[0] + a * cam.right[0] + b * cam.up[0];
  const dy = cam.fwd[1] + b * cam.up[1];
  const dz = cam.fwd[2] + a * cam.right[2] + b * cam.up[2];
  if (Math.abs(dz) < 1e-6) return null;
  const t = (planeZ - cam.eye.z) / dz;
  if (t <= 0) return null;
  return { x: cam.eye.x + dx * t, y: cam.eye.y + dy * t };
}

// Where a tap lands in the goal mouth (the keeper's plane), clamped to the
// area a dive can reach, or null. Replaces the old THREE.Raycaster version.
export function screenToGoal(cam, sx, sy) {
  const p = screenToPlaneZ(cam, sx, sy, KEEPER_Z);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: clamp(p.x, -4.6, 4.6), y: clamp(p.y, 0, 2.9) };
}
