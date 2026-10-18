// Development only: measure the animated keeper against the acceptance rules
// (feet grounded, no sliding, floating or sudden jumps, gloves on the game's
// gloves) by playing real kicks at the CPU keeper with the game stepped at a
// fixed rate. Run from the console: __pn.checkKeeper().
import * as THREE from 'three';

// A spread of kicks: [arrow key, presses sideways, presses up].
export const DEFAULT_KICKS = [['ArrowRight', 9, 6], ['ArrowLeft', 9, 1], ['ArrowLeft', 4, 7], ['ArrowRight', 5, 0], ['ArrowLeft', 7, 4], ['ArrowRight', 1, 2]];
const PLANTED = 0.04;   // a toe this close to the grass counts as planted (m)

export function checkKeeperModel(pn, kicks = DEFAULT_KICKS, seed = 11) {
  const model = pn.keeperModelRef;
  if (!model) return 'The animated keeper has not loaded.';
  const B = model.bones, dt = 1 / 60;
  const at = (b) => b.getWorldPosition(new THREE.Vector3());
  const key = (type, k) => document.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === ' ' ? 'Space' : k, bubbles: true }));
  const tap = (k, n) => { for (let i = 0; i < n; i++) { key('keydown', k); pn.step(0.05); key('keyup', k); } };
  const r3 = (x) => +x.toFixed(3);
  pn.freeze(); pn.seed(seed); pn.quickMatch();
  const rows = [];
  for (const [dir, side, up] of kicks) {
    for (let i = 0; i < 1500 && !(pn.state.turn === 'you' && pn.state.phase === 'aim'); i++) pn.step(dt);
    if (pn.state.phase !== 'aim') break;   // the match ended
    tap(dir, side); tap('ArrowUp', up);
    key('keydown', ' '); pn.step(0.42); key('keyup', ' ');
    const row = { kick: `${dir} x${side} up${up}`, clips: new Set(), slideMax: 0, slideTotal: 0, floatMax: 0, hipsMax: 0, gloveGapAtBall: null, gloveGapMax: 0 };
    let prev = null;
    for (let i = 0; i < 60 * 5; i++) {
      pn.step(dt);
      const st = pn.state;
      if (st.turn !== 'you' || st.replay || !model.root.visible) { prev = null; continue; }
      const s = model.state;
      row.clips.add(s.mode);
      const toes = [at(B.LeftToeBase), at(B.RightToeBase)], hips = at(B.Hips);
      if (prev) {
        toes.forEach((t, j) => {
          const p = prev.toes[j];
          if (t.y < PLANTED && p.y < PLANTED) {
            const d = Math.hypot(t.x - p.x, t.z - p.z);
            row.slideMax = Math.max(row.slideMax, d / dt); row.slideTotal += d;
          }
        });
        row.hipsMax = Math.max(row.hipsMax, hips.distanceTo(prev.hips) / dt);
      }
      if (s.mode === 'standing') row.floatMax = Math.max(row.floatMax, Math.min(toes[0].y, toes[1].y));
      if (s.ik >= 0.999) row.gloveGapMax = Math.max(row.gloveGapMax, s.ikError);
      if (row.gloveGapAtBall === null && st.ball[2] < 0.6) row.gloveGapAtBall = s.ik >= 0.999 ? r3(s.ikError) : `ik ${r3(s.ik)}`;
      prev = { toes, hips };
    }
    rows.push({
      kick: row.kick, clips: [...row.clips].join(' '),
      'slide max m/s': r3(row.slideMax), 'slide total m': r3(row.slideTotal),
      'float max m': r3(row.floatMax), 'hips max m/s': r3(row.hipsMax),
      'glove gap at ball m': row.gloveGapAtBall, 'glove gap max m': r3(row.gloveGapMax),
    });
  }
  return rows;
}
