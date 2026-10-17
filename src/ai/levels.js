// Difficulty: how quick and accurate the CPU keeper and takers are.
//   react    keeper reaction time (s) before a read dive
//   err      keeper aiming error (m)
//   shift    how far the keeper's feet can travel in a dive (m)
//   gamble   chance the keeper guesses a side at the strike
//   readSpin how much curl the keeper understands (0..1)
//   cpuErr   CPU taker's aiming error (m)
//   reAim    chance the taker switches away from an early dive
//   cpuPace  seconds the taker's shots are quicker than a steady kick
// Tuned with `npm run balance` (see scripts/balance.mjs).
export const LEVELS = {
  amateur: { note: 'Slow keeper who guesses a lot. Their takers miss often.',
    react: 0.30, err: 0.85, shift: 1.45, gamble: 0.24, readSpin: 0, cpuErr: 0.8, reAim: 0.25, cpuPace: 0 },
  pro: { note: 'Quick keeper who reads straight shots. Their takers are steady.',
    react: 0.17, err: 0.56, shift: 1.75, gamble: 0.18, readSpin: 0.5, cpuErr: 0.42, reAim: 0.5, cpuPace: 0.04 },
  legend: { note: 'Reads curve and punishes slow kicks. Takers rarely miss.',
    react: 0.14, err: 0.42, shift: 1.95, gamble: 0.12, readSpin: 1, cpuErr: 0.3, reAim: 0.75, cpuPace: 0.08 },
};
