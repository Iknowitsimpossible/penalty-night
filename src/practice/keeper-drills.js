// Keeper training: five stages that add one difficulty at a time, so a
// control problem shows up on its own instead of hiding inside a match.
// Each stage is five shots; save three to move on.
export const SHOTS_PER_STAGE = 5;
export const SAVES_TO_PASS = 3;

const CORNERS = [
  { x: 2.7, y: 0.35 },  // low, world +x (your left as keeper)
  { x: -2.7, y: 1.9 },  // high, your right
  { x: -2.7, y: 0.35 }, // low, your right
  { x: 2.7, y: 1.9 },   // high, your left
];

const HABIT = CORNERS[2];  // low, your right

export const STAGES = [
  {
    id: 'shown', title: 'Read the marker',
    how: 'The ring shows where they will shoot. Wait for them to strike, then dive to it.',
    T: () => 0.82, corner: (i) => CORNERS[i % 4], show: true, reAim: 0,
  },
  {
    id: 'fixed', title: 'Same corner',
    how: 'Every shot goes to one corner. Watch the first, then be ready for it.',
    T: () => 0.8, corner: (i, s) => s.fixedCorner, show: false, reAim: 0,
  },
  {
    id: 'random', title: 'Any corner',
    how: 'Slow shots, any corner. Wait for the strike, then dive toward the ball.',
    T: () => 0.78, corner: (i, s, rng) => rng.pick(CORNERS), show: false, reAim: 0,
  },
  {
    id: 'quick', title: 'Quicker shots',
    how: 'Brisker shots, any corner. React the moment they strike. Diving before the gold bar lets them switch.',
    T: (rng) => rng.range(0.68, 0.76), corner: (i, s, rng) => rng.pick(CORNERS), show: false, reAim: 0.5,
  },
  {
    id: 'habit', title: 'Read the habit',
    how: 'Match pace, too quick to react to. This taker sends four in five low to your right: step that way to buy time, then dive as they strike.',
    T: (rng) => rng.range(0.56, 0.66), corner: (i, s, rng) => (rng.chance(0.8) ? HABIT : rng.pick(CORNERS.filter((c) => c !== HABIT))), show: false, reAim: 0.5,
  },
];

// A new stage: picks the hidden corner for the "same corner" stage.
export function startStage(index, rng) {
  return { index, attempt: 0, saves: 0, results: [], fixedCorner: rng.pick(CORNERS) };
}

// The taker's plan for the next shot: a corner, a flight time, and whether
// the corner is shown in advance.
export function drillPlan(stageState, rng) {
  const st = STAGES[stageState.index];
  const T = st.T(rng);
  const c = st.corner(stageState.attempt, stageState, rng);
  return { side: Math.sign(c.x), x: c.x, y: c.y, middle: false, switched: false, T, shown: st.show };
}

// Record one attempt. Returns 'continue', 'passed' or 'failed'.
export function recordAttempt(stageState, saved) {
  stageState.attempt++;
  stageState.results.push(saved);
  if (saved) stageState.saves++;
  if (stageState.saves >= SAVES_TO_PASS) return 'passed';
  const left = SHOTS_PER_STAGE - stageState.attempt;
  if (stageState.saves + left < SAVES_TO_PASS) return 'failed';
  return 'continue';
}
