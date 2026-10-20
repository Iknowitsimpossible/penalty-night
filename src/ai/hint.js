// The keeper hint in matches: at the plant foot a soft zone lights up
// around where the CPU's shot is going. It is honest (the shot always
// lands inside it) but not exact: the better the opponent, the bigger the
// zone, the further its centre sits from the real spot, and the later it
// shows. So you still read it and time the dive.
import { clamp, lerp } from '../core/math.js';

// How hard the opponent is to read, 0 (amateur) .. 1 (legend), from their
// takers' accuracy. Cup teams sit in between.
export function hintSkill(params) {
  return clamp((0.8 - params.cpuErr) / (0.8 - 0.3), 0, 1);
}

// target: where the ball will cross the line { x, y }. skill: 0..1.
// Returns { x, y, r, delay }: the zone's centre and radius (m) and how long
// after the plant foot it appears (s).
export function shotHint(target, skill, rng) {
  const r = lerp(0.5, 1.1, skill);
  // off-centre by at most 55% of the radius, so the real spot is always inside
  const off = rng.range(0, 0.55 * skill + 0.1) * r;
  const a = rng.range(0, Math.PI * 2);
  return { x: target.x + Math.cos(a) * off, y: target.y + Math.sin(a) * off, r, delay: lerp(0, 0.12, skill) };
}
