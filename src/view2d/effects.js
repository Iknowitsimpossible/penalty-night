// Celebration effects in 2D. Phase 1 keeps the game's calls working; the
// confetti, fireworks and flashes are drawn in phase 2.
export const GOLD = [0xf2c230, 0xffe08a, 0xffffff, 0xf6e7a8];

export function createEffects() {
  return {
    burstConfetti() {}, updateConfetti() {}, firework() {}, updateFireworks() {}, updateFlashes() {},
    setFlashRate() {}, draw() {},
  };
}
