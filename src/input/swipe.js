// Turning a swipe (or keyboard input) into a kick.
//
// Every length is measured in "screen units" U = min(height, width * 1.5),
// so the same thumb-relative gesture gives the same kick on a phone and on a
// desktop monitor. Only the moving part of the gesture counts: resting on the
// ball before swiping, or holding still before letting go, changes nothing.
//
//   direction  <- swipe angle (sideways vs upward travel)
//   height     <- how far up the swipe travels, in U
//   power      <- active swipe speed, in U per second (faster = harder, less time for the keeper)
//   curl       <- how far the path bows away from a straight line
import { clamp, lerp } from '../core/math.js';

export const SWIPE = {
  minUp: 0.06,        // shortest upward travel (U) that counts as a kick
  still: 0.012,       // movement below this (U) counts as holding still
  slow: 0.6,          // speed (U/s) of the softest kick
  fast: 3.2,          // speed (U/s) of the hardest kick
  softT: 1.05,        // flight time (s) to the goal of the softest kick
  hardT: 0.44,        // flight time (s) of the hardest kick
  maxSpin: 28,
};

export const screenUnit = (w, h) => Math.min(h, w * 1.5);

// Drop the stationary start (finger resting on the ball) and the stationary
// end (finger paused before release). Returns the moving points only.
export function activePoints(pts, unit) {
  const tol = SWIPE.still * unit;
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) > tol;
  let i = 0;
  while (i < pts.length - 1 && !far(pts[i + 1], pts[0])) i++;
  let j = pts.length - 1;
  while (j > i && !far(pts[j - 1], pts[pts.length - 1])) j--;
  return pts.slice(i, j + 1);
}

// Power 0..1 -> flight time. Shared by swipe and keyboard so both feel the same.
export const flightTime = (power) => lerp(SWIPE.softT, SWIPE.hardT, clamp(power, 0, 1));

// Aim in the goal from the gesture's shape (scale-free ratios and U lengths).
export function aimFrom(dxU, upU) {
  return {
    aimX: clamp(dxU / upU, -1.3, 1.3) * 5.2,
    aimY: Math.max(0.11, (upU - 0.1) * 8.2),
  };
}

// Reads a swipe. pts: [{x, y, t}] in CSS pixels / milliseconds.
// Returns null (with a reason) for gestures that are not a kick.
export function readSwipe(pts, width, height) {
  if (!pts || pts.length < 2) return { kick: null, reason: 'tap' };
  const unit = screenUnit(width, height);
  const act = activePoints(pts, unit);
  if (act.length < 2) {
    const first = pts[0], last = pts[pts.length - 1];
    const moved = Math.hypot(last.x - first.x, last.y - first.y) / unit;
    if (moved < SWIPE.still) return { kick: null, reason: 'tap' };
    return { kick: null, reason: last.y < first.y ? 'short' : 'down' };
  }
  const s = act[0], e = act[act.length - 1];
  const dxU = (e.x - s.x) / unit, upU = (s.y - e.y) / unit;
  if (upU < SWIPE.minUp) return { kick: null, reason: upU < 0 ? 'down' : 'short' };

  let pathU = 0;
  for (let k = 1; k < act.length; k++) pathU += Math.hypot(act[k].x - act[k - 1].x, act[k].y - act[k - 1].y) / unit;
  const seconds = Math.max(0.03, (e.t - s.t) / 1000);
  const speed = pathU / seconds;
  const power = clamp((speed - SWIPE.slow) / (SWIPE.fast - SWIPE.slow), 0, 1);

  // Curl: largest sideways bulge from the straight start-end line, as a share of its length.
  const len = Math.hypot(e.x - s.x, e.y - s.y);
  let dev = 0;
  for (const p of act) {
    const c = ((p.x - s.x) * (e.y - s.y) - (p.y - s.y) * (e.x - s.x)) / len;
    if (Math.abs(c) > Math.abs(dev)) dev = c;
  }
  // curl +1 = the swipe bows right (dev is negative then, since screen y points
  // down). Positive spin bends the ball's flight the same way as the swipe.
  const curl = clamp(-dev / len / 0.35, -1, 1);

  const { aimX, aimY } = aimFrom(dxU, upU);
  return {
    kick: { aimX, aimY, T: flightTime(power), spin: curl * SWIPE.maxSpin, power, curl, speed, upU },
    reason: null,
  };
}

// Keyboard kick: aim marker in goal metres, power 0..1 from the hold meter,
// curl -1..1 from Z / X (+1 bends the flight out to the right, like a swipe bowing right).
export function keyboardKick(aimX, aimY, power, curl) {
  return { aimX, aimY: Math.max(0.11, aimY), T: flightTime(power), spin: clamp(curl, -1, 1) * SWIPE.maxSpin, power, curl, speed: null, upU: null };
}
