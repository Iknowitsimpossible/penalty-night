// Keyboard play. Arrows move a target in the goal (the same keys for both
// roles). Shooting: hold Space to fill the power meter, release to shoot;
// Z / X add curl. Keeping: Space dives to the target.
import { clamp } from '../core/math.js';
import { keyboardKick } from './swipe.js';

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const STEP_KEYS = ['a', 'd'];
export const CHARGE_TIME = 0.9;   // seconds of holding Space for full power

// mode(): 'shoot' | 'keep' | null (what the keys can do right now)
// on: { shoot(kick), dive(x, y), wake() }
export function createKeyboardAim({ mode, on }) {
  const kb = { x: 0, y: 1.2, held: new Set(), charging: false, power: 0, curl: 0, active: false };

  function shootNow() {
    kb.charging = false;
    const kick = keyboardKick(kb.x, kb.y, kb.power, kb.curl);
    // Keyboard aim is exact, so harder kicks spread a little.
    kick.spread = 0.1 + 0.3 * kb.power * kb.power;
    kb.power = 0;
    on.shoot(kick);
  }

  return {
    state: kb,
    // Centre the target for a new kick.
    reset(y = 1.2) { kb.x = 0; kb.y = y; kb.curl = 0; kb.power = 0; kb.charging = false; },
    release() { kb.charging = false; kb.held.clear(); },
    // Returns true when the key was used.
    keydown(e, k) {
      const m = mode();
      if (STEP_KEYS.includes(k)) { kb.held.add(k); return true; }
      if (ARROWS.includes(k)) { kb.held.add(k); kb.active = true; e.preventDefault(); return true; }
      if (k === ' ' && m === 'shoot') {
        e.preventDefault(); kb.active = true;
        if (!kb.charging && !e.repeat) { kb.charging = true; kb.power = 0; on.wake(); }
        return true;
      }
      if (k === ' ' && m === 'keep') { e.preventDefault(); kb.active = true; on.wake(); on.dive(kb.x, kb.y); return true; }
      if ((k === 'z' || k === 'x') && m === 'shoot') {
        const want = k === 'z' ? -1 : 1;
        kb.curl = kb.curl === want ? 0 : want; kb.active = true; e.preventDefault(); return true;
      }
      return false;
    },
    keyup(e) {
      kb.held.delete(e.key);
      kb.held.delete(e.key.toLowerCase());
      if (e.key === ' ' && kb.charging) {
        e.preventDefault();
        if (mode() === 'shoot') shootNow(); else kb.charging = false;
      }
    },
    // Keeper stepping: -1 (A, screen left), 0, or 1 (D, screen right).
    stepDir: () => (kb.held.has('d') ? 1 : 0) - (kb.held.has('a') ? 1 : 0),
    update(dt) {
      const m = mode();
      if (m) {
        let dx = (kb.held.has('ArrowRight') ? 1 : 0) - (kb.held.has('ArrowLeft') ? 1 : 0);
        const dy = (kb.held.has('ArrowUp') ? 1 : 0) - (kb.held.has('ArrowDown') ? 1 : 0);
        if (m === 'keep') dx = -dx;     // facing the taker, screen right is world -x
        kb.x = clamp(kb.x + dx * 3.2 * dt, -4.3, 4.3);
        kb.y = clamp(kb.y + dy * 2.4 * dt, 0.15, 2.9);
      }
      if (kb.charging) kb.power = Math.min(1, kb.power + dt / CHARGE_TIME);
      return m;
    },
  };
}
