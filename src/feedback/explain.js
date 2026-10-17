// Explains each kick in plain words: what happened, one specific piece of
// advice, and marks for a small goal diagram (intended vs actual).
//
// Coordinates are world metres on the goal line: x right as the shooter
// sees it, y up. When you keep goal the diagram is drawn from your side,
// mirrored, so "your right" is on the right.
import { HALF, GOAL_H, RUNUP, COMMIT } from '../core/constants.js';
import { styleOf } from '../ai/styles.js';

const TITLES = {
  goal: 'Goal', saved: 'Saved', post: 'Off the woodwork', over: 'Over the bar', wide: 'Wide', short: 'Too soft',
};

// Words for a spot in the goal. view 'keeper' describes it from the keeper's side.
export function describeSpot(x, y, view = 'shooter') {
  const sx = view === 'keeper' ? -x : x;
  const h = sx > 1.2 ? 'right' : sx < -1.2 ? 'left' : 'centre';
  const v = y > 1.6 ? 'top' : y < 0.7 ? 'low' : '';
  if (h === 'centre') return v === 'top' ? 'high and central' : v === 'low' ? 'low and central' : 'down the middle';
  const spot = v ? `${v} ${h}` : h;
  return view === 'keeper' ? `your ${spot}` : spot;
}

// The same advice in swipe words or keyboard words.
const PHRASES = {
  swipe: {
    faster: 'Swipe faster',
    over: 'Shorten your swipe: a long swipe lifts the ball over.',
    rose: 'It rose late. Shorten your swipe a little.',
    straighter: 'Swipe straighter: you aimed outside the post.',
    lessCurl: 'Less curl: the bend carried it wide.',
    bar: 'Off the bar. Shorten your swipe slightly.',
  },
  keyboard: {
    faster: 'Hold Space longer',
    over: 'Lower the target: it was above the bar.',
    rose: 'Hard kicks spread a little. Aim a bit lower or use less power.',
    straighter: 'Move the target inside the post.',
    lessCurl: 'Less curl (Z / X): the bend carried it wide.',
    bar: 'Off the bar. Lower the target slightly.',
  },
};

const sameSide = (a, b) => Math.sign(a) === Math.sign(b) && Math.abs(a) > 0.6 && Math.abs(b) > 0.6;

// Your kick.
//   kind: 'goal' | 'saved' | 'post' | 'over' | 'wide' | 'short'
//   intent: { aimX, aimY, power (0..1), curl (-1..1) }
//   ball: where it crossed the line or was stopped { x, y }
//   keeper: { kind: 'gamble' | 'read', target: { x, y } | null }
//   style: opponent style key
export function explainKick({ kind, intent, ball, keeper, style }) {
  const marks = [
    { type: 'aim', x: intent.aimX, y: intent.aimY },
    { type: 'ball', x: ball.x, y: ball.y },
  ];
  if (keeper && keeper.target) marks.push({ type: 'keeper', x: keeper.target.x, y: keeper.target.y });
  const aimed = describeSpot(intent.aimX, intent.aimY);
  let advice;
  const keeperGuessed = keeper && keeper.kind === 'gamble' && keeper.target;
  const say = PHRASES[intent.input === 'keyboard' ? 'keyboard' : 'swipe'];

  if (kind === 'goal') {
    if (keeperGuessed && !sameSide(keeper.target.x, ball.x)) advice = 'The keeper guessed early and went the wrong way.';
    else if (Math.abs(ball.x) > HALF - 0.8 && (ball.y > 1.6 || ball.y < 0.5)) advice = 'Right in the corner: unstoppable.';
    else advice = 'Keep mixing up your corners.';
  } else if (kind === 'saved') {
    if (keeperGuessed && sameSide(keeper.target.x, ball.x)) advice = 'The keeper guessed your side. Try the other corner or the middle.';
    else if (Math.abs(ball.x) < 1.3) advice = 'Too close to the keeper. Aim nearer a post.';
    else if (intent.power < 0.45) advice = `${say.faster}: the keeper had time to react.`;
    else if (style === 'wall' && ball.y < 0.7) advice = 'This keeper smothers low shots. Lift it.';
    else if (style === 'reader') advice = 'This keeper reads placement. Hit it harder.';
    else if (ball.y > 0.6 && ball.y < 1.6) advice = 'Mid-height shots are easiest to save. Go low or high.';
    else advice = 'Good shot, better save. Keep varying your corners.';
  } else if (kind === 'over') {
    advice = intent.aimY > GOAL_H ? say.over : say.rose;
  } else if (kind === 'wide') {
    advice = Math.abs(intent.aimX) > HALF ? say.straighter : Math.abs(intent.curl) > 0.3 ? say.lessCurl : 'Just wide. Aim a touch further inside.';
  } else if (kind === 'post') {
    advice = ball.y > GOAL_H - 0.25 ? say.bar : 'So close. Aim a touch inside the post.';
  } else {
    advice = `${say.faster}: it ran out of pace.`;
  }
  return { title: TITLES[kind], detail: `You aimed ${aimed}.`, advice, marks, view: 'shooter' };
}

// Your save attempt.
//   kind: result from the shooter's side ('goal' = they scored)
//   shot: where their shot crossed { x, y }
//   dive: { x, y, at, early } (at = seconds since the run-up started) or null
//   switched: the taker changed side because of an early dive
//   flight: seconds from strike to the goal line
export function explainSave({ kind, shot, dive, switched, flight, style }) {
  const marks = [{ type: 'ball', x: shot.x, y: shot.y }];
  if (dive) marks.push({ type: 'dive', x: dive.x, y: dive.y });
  const where = describeSpot(shot.x, shot.y, 'keeper');
  const st = styleOf(style);
  let title, advice;

  if (kind === 'saved') {
    title = 'Saved';
    advice = dive && !dive.early ? 'Perfect timing: you waited for the gold bar.' : 'You read it.';
  } else if (kind !== 'goal') {
    title = 'They missed';
    advice = dive && dive.early && switched ? 'Lucky: they switched away from your early dive.' : null;
  } else {
    title = 'They scored';
    const late = dive && dive.at > RUNUP + flight * 0.55;
    if (!dive) advice = 'Tap where to dive once the bar turns gold.';
    else if (dive.early && switched) advice = 'You dived too early: they saw you go and switched sides.';
    else if (dive.early) advice = `Too early. Wait for the gold bar (${COMMIT.toFixed(1)} s into the run-up).`;
    else if (late) advice = 'Too late: dive as soon as they strike.';
    else if (!sameSide(dive.x, shot.x) && Math.abs(shot.x) > 0.8) {
      advice = st.taker.side ? `Wrong way. ${st.label} takers favour your ${st.taker.side < 0 ? 'right' : 'left'}.` : 'Wrong way. After the gold bar, wait for the strike and dive toward the ball.';
    } else if (Math.abs(dive.y - shot.y) > 0.9) advice = shot.y > dive.y ? 'Right side. Dive higher: tap nearer the bar.' : 'Right side. Dive lower: tap nearer the ground.';
    else advice = 'Right idea, but it was tucked in the corner.';
  }
  return { title, detail: `Their shot: ${where}.`, advice, marks, view: 'keeper' };
}
