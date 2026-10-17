// Adaptive resolution. Rendering at a phone's full pixel density can be too
// slow; this watches frame times and lowers the pixel ratio one step when
// frames stay slow. It only ever steps down, so it settles on the best
// level the device can keep up with instead of bouncing between two.
export const STEPS = [2, 1.75, 1.5, 1.25, 1];
const SLOW = 1 / 40;      // frames slower than 25 ms on average...
const SLOW_FOR = 1.5;     // ...for this many seconds trigger a step down
const COOLDOWN = 3;       // seconds to let a change take effect before judging again

export function createQualityGovernor(maxRatio) {
  let i = STEPS.findIndex((r) => r <= maxRatio + 1e-6);
  if (i < 0) i = STEPS.length - 1;
  let avg = 1 / 60, slowT = 0, cool = COOLDOWN;

  return {
    get ratio() { return STEPS[i]; },
    // dt: seconds since the last frame. Returns a new pixel ratio, or null.
    update(dt) {
      if (dt <= 0 || dt > 0.5) return null;       // ignore pauses and tab switches
      avg += (dt - avg) * 0.1;
      cool -= dt;
      if (cool > 0) { slowT = 0; return null; }
      slowT = avg > SLOW ? slowT + dt : 0;
      if (slowT > SLOW_FOR && i < STEPS.length - 1) {
        i++; slowT = 0; cool = COOLDOWN;
        return STEPS[i];
      }
      return null;
    },
  };
}
