// Practice: four guided lessons that teach both roles. A lesson only counts
// when the action itself was right (a low shot that is low and on target, a
// dive after the gold bar), not when the result happened to be good.
import { RUNUP } from '../core/constants.js';

export const LESSONS = [
  {
    id: 'low', role: 'shoot', title: 'Low shot',
    how: { swipe: 'A short, quick swipe keeps the ball low. Aim for a bottom corner.', keyboard: 'Press Down to lower the target, then hold Space about halfway and release.' },
    success: 'Low and hard. Keepers hate those.',
  },
  {
    id: 'high', role: 'shoot', title: 'High shot',
    how: { swipe: 'A longer swipe lifts the ball. Aim just under the bar.', keyboard: 'Press Up to raise the target just under the bar, then hold and release Space.' },
    success: 'Up under the bar. Hard to reach.',
  },
  {
    id: 'curl', role: 'shoot', title: 'Curved shot',
    how: { swipe: 'Bend your swipe like a banana. The ball follows the curve.', keyboard: 'Press Z or X to add curl, aim inside a post, then shoot.' },
    success: 'Look at it bend. That fools a keeper reading the straight line.',
  },
  {
    id: 'keep', role: 'keep', title: 'Keeper timing',
    how: { swipe: 'Wait for the bar to turn gold, then tap where you want to dive.', keyboard: 'Wait for the gold bar, aim with the arrows, then press Space to dive.' },
    success: 'Perfect timing. They could not change their mind.',
  },
];

const onTarget = (kind) => kind === 'goal' || kind === 'saved';

// outcome: { kind, spot: {x, y}, intent: {curl, input}, dive: {at, early} | null, flight }
// Returns { ok, reason }.
export function checkLesson(id, o) {
  const keys = o.intent && o.intent.input === 'keyboard';
  if (id === 'low') {
    if (o.kind === 'short') return { ok: false, reason: keys ? 'Too soft. Hold Space a little longer.' : 'Too soft. Swipe a little faster.' };
    if (!onTarget(o.kind)) return { ok: false, reason: keys ? 'Keep it on target: move the target inside the goal.' : 'Keep it on target: a shorter, straighter swipe.' };
    if (o.spot.y < 0.8) return { ok: true, reason: null };
    return { ok: false, reason: keys ? 'Too high for a low shot. Lower the target.' : 'Too high for a low shot. Use a shorter swipe.' };
  }
  if (id === 'high') {
    if (o.kind === 'over') return { ok: false, reason: keys ? 'Over the bar. Lower the target a little.' : 'Over the bar. A slightly shorter swipe.' };
    if (o.kind === 'short') return { ok: false, reason: keys ? 'Too soft. Hold Space longer.' : 'Too soft. Swipe faster.' };
    if (!onTarget(o.kind)) return { ok: false, reason: 'Stay inside the posts.' };
    if (o.spot.y > 1.5) return { ok: true, reason: null };
    return { ok: false, reason: keys ? 'Not high enough. Raise the target.' : 'Not high enough. Swipe further up.' };
  }
  if (id === 'curl') {
    const curl = Math.abs(o.intent ? o.intent.curl : 0);
    if (curl < 0.35) return { ok: false, reason: keys ? 'Add curl with Z or X first.' : 'Bend your swipe more: curve it like a banana.' };
    if (!onTarget(o.kind)) return { ok: false, reason: 'Good bend! Start it aimed further inside so it curls back on target.' };
    return { ok: true, reason: null };
  }
  if (id === 'keep') {
    if (!o.dive) return { ok: false, reason: 'Dive! Tap the goal once the bar turns gold.' };
    if (o.dive.early) return { ok: false, reason: 'Too early. Wait for the gold bar.' };
    if (o.dive.at > RUNUP + o.flight * 0.55) return { ok: false, reason: 'Too late. Dive as the ball is struck.' };
    return { ok: true, reason: null };
  }
  throw new Error(`Unknown lesson ${id}`);
}
