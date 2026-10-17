// The CPU goalkeeper, facing your kick.
//
// The keeper makes exactly one decision per kick, at a clear moment:
//  - a guess at the strike (kind 'gamble'): picks a side before seeing the
//    flight, so a shot down the middle or to the other side beats it; or
//  - a read (kind 'read') after its reaction time: predicts where the ball
//    will cross, understanding as much curl as its readSpin allows.
// Once it has dived it cannot change direction.
import { clamp } from '../core/math.js';
import { styleOf } from './styles.js';

// skill: { react, err, gamble, readSpin } from the difficulty level or cup rating.
export function keeperPlan(skill, styleKey, rng) {
  const k = styleOf(styleKey).keeper;
  if (rng.chance(clamp(skill.gamble * (k.gamble ?? 1), 0, 0.9))) {
    return { kind: 'gamble', at: 0.04, x: rng.sign() * rng.range(1.6, 3.2), y: rng.range(0.3, 1.9) };
  }
  return { kind: 'read', at: skill.react + (k.react ?? 0), readSpin: Math.max(skill.readSpin, k.readSpin ?? 0) };
}

// Where a reading keeper dives, given its prediction of the crossing point.
export function readDive(predicted, skill, styleKey, rng) {
  const k = styleOf(styleKey).keeper;
  let err = skill.err * (k.accuracy ?? 1);
  if (predicted.y < 0.6) err *= 1 - (k.lowSafe ?? 0);
  if (predicted.y > 1.6) err *= 1 + (k.highWeak ?? 0);
  return {
    x: predicted.x + rng.gauss() * err,
    y: clamp(predicted.y + rng.gauss() * err * 0.6, 0, 2.8),
    // A keeper strong at low shots also gets down to them faster.
    speed: predicted.y < 0.6 && k.lowSafe ? 1 - 0.35 * k.lowSafe : 1,
  };
}
