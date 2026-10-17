// The CPU penalty taker.
//
// 1. At the start of the run-up the taker picks a plan from their style.
// 2. At the plant foot (COMMIT) they look at the keeper one last time: if you
//    have already dived, they may switch to the other side. After COMMIT the
//    plan is locked, so a dive after the gold bar can never be "read".
// 3. At the strike the plan is executed with some error (their skill).
import { HALF, GOAL_H, R } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { styleOf } from './styles.js';

// skill: { cpuErr, reAim, cpuPace } from the difficulty level.
export function planShot(styleKey, rng) {
  const t = styleOf(styleKey).taker;
  if (rng.chance(t.middle ?? 0.1)) {
    return { side: 0, x: rng.range(-0.5, 0.5), y: rng.range(1.2, 2.0), middle: true, switched: false };
  }
  const side = rng.chance(0.5 + (t.side ?? 0) * 0.4) ? 1 : -1;
  const high = t.high ?? 0.35, low = t.low ?? 0.35;
  const roll = rng.next();
  const y = roll < high ? rng.range(1.5, 2.2) : roll < high + low ? rng.range(0.15, 0.5) : rng.range(0.5, 1.5);
  return { side, x: side * rng.range(1.5, 3.4), y, middle: false, switched: false };
}

// Called once, at the plant foot. dive: the keeper's dive target if they
// have already gone ({ x }), or null. lean: how far the keeper has stepped
// off-centre (m, world x). A lean is a weaker tell than an early dive: the
// taker only reacts when it is toward their planned side.
// Returns the (possibly switched) plan.
export function reconsider(plan, dive, styleKey, skill, rng, lean = 0) {
  const t = styleOf(styleKey).taker;
  if (!dive) {
    if (Math.abs(lean) < 0.3 || plan.middle || Math.sign(lean) !== plan.side) return plan;
    const pl = clamp(skill.reAim * (t.switch ?? 1) * 0.45 * Math.min(Math.abs(lean), 1), 0, 0.6);
    if (!rng.chance(pl)) return plan;
    return { ...plan, side: -plan.side, x: -plan.side * rng.range(1.8, 3.2), switched: true };
  }
  const p = clamp(skill.reAim * (t.switch ?? 1), 0, 0.95);
  if (!rng.chance(p)) return plan;
  const away = -(Math.sign(dive.x) || 1);
  // Roll it into the side the keeper has left, or down the middle if they went far.
  if (plan.middle || Math.abs(dive.x) > 1.2) {
    return { ...plan, side: away, x: away * rng.range(1.6, 3.2), y: rng.range(0.3, 1.6), middle: false, switched: true };
  }
  return { ...plan, side: 0, x: rng.range(-0.4, 0.4), y: rng.range(0.4, 1.4), middle: true, switched: true };
}

// The strike: the planned target plus the taker's error.
export function executeShot(plan, styleKey, skill, rng) {
  const t = styleOf(styleKey).taker;
  let x = plan.x + rng.gauss() * skill.cpuErr;
  let y = plan.y + rng.gauss() * skill.cpuErr * 0.8;
  if (t.over && rng.chance(t.over)) y = GOAL_H + rng.range(0.2, 0.9);
  // plan.T fixes the flight time (training drills); otherwise style and level set it.
  const T = plan.T ?? clamp(rng.range(0.55, 0.8) - (t.power ?? 0) - (skill.cpuPace ?? 0), 0.42, 0.9);
  return { target: { x, y: Math.max(R, y) }, T, spin: rng.range(-10, 10), onTarget: Math.abs(x) < HALF && y < GOAL_H };
}
