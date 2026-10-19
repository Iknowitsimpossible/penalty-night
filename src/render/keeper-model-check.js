// Development only: measure the animated keeper against the acceptance rules
// (feet grounded, no sliding, floating or sudden jumps, gloves on the game's
// gloves) by playing real kicks at the CPU keeper with the game stepped at a
// fixed rate. Run from the console: __pn.checkKeeper().
// trace: pass an array to get every frame's arm numbers pushed onto it.
import * as THREE from 'three';

// A spread of kicks: [arrow key, presses sideways, presses up].
export const DEFAULT_KICKS = [['ArrowRight', 9, 6], ['ArrowLeft', 9, 1], ['ArrowLeft', 4, 7], ['ArrowRight', 5, 0], ['ArrowLeft', 7, 4], ['ArrowRight', 1, 2]];
const PLANTED = 0.04;   // a toe this close to the grass counts as planted (m)
const DEG = 180 / Math.PI;

// The arms. Mixamo bones point along their own y axis, and in every clip
// the elbow is a hinge about the upper arm's z axis (+z left, -z right),
// bending the forearm towards -x (left) / +x (right). So, from the forearm's
// direction in the upper arm's frame:
//   bend: how far the elbow is bent from straight (deg; below 0 is
//         hyperextended, bent the wrong way)
//   offHinge: how far the forearm has left the hinge's plane (deg; a real
//         elbow can't bend sideways)
//   roll: the upper arm's turn about its own axis since the last frame (rad)
const _y = new THREE.Vector3(0, 1, 0), _f = new THREE.Vector3(), _dq = new THREE.Quaternion();
function armPose(B, side, prevQ) {
  const sign = side === 'Left' ? 1 : -1;
  _f.copy(_y).applyQuaternion(B[side + 'ForeArm'].quaternion);
  const bend = Math.atan2(-sign * _f.x, _f.y) * DEG;
  const offHinge = Math.asin(Math.min(1, Math.abs(_f.z))) * DEG;
  let roll = 0;
  if (prevQ) {
    _dq.copy(prevQ).invert().multiply(B[side + 'Arm'].quaternion);   // this frame's turn, in the upper arm's frame
    roll = Math.abs(2 * Math.atan2(_dq.y, Math.abs(_dq.w)));         // its twist about y
  }
  return { bend, offHinge, roll, q: B[side + 'Arm'].quaternion.clone(), elbow: B[side + 'ForeArm'].getWorldPosition(new THREE.Vector3()), shoulder: B[side + 'Arm'].getWorldPosition(new THREE.Vector3()) };
}

export function checkKeeperModel(pn, kicks = DEFAULT_KICKS, seed = 11, trace = null) {
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
    const row = { kick: `${dir} x${side} up${up}`, clips: new Set(), slideMax: 0, slideTotal: 0, floatMax: 0, hipsMax: 0, gloveGapAtBall: null, gloveGapMax: 0,
      pullMax: 0, rollMax: 0, elbowMax: 0, elbowRelMax: 0, bendMin: Infinity, bendMax: -Infinity, bendRateMax: 0, offHingeMax: 0 };
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
      if (s.ik > 0) row.pullMax = Math.max(row.pullMax, s.pull);
      if (s.ik >= 0.999) row.gloveGapMax = Math.max(row.gloveGapMax, s.ikError);
      if (row.gloveGapAtBall === null && st.ball[2] < 0.6) row.gloveGapAtBall = s.ik >= 0.999 ? r3(s.ikError) : `ik ${r3(s.ik)}`;
      const arms = ['Left', 'Right'].map((side, j) => armPose(B, side, prev && prev.arms[j].q));
      if (prev) {
        arms.forEach((a, j) => {
          const p = prev.arms[j];
          row.rollMax = Math.max(row.rollMax, a.roll * DEG / dt);
          row.elbowMax = Math.max(row.elbowMax, a.elbow.distanceTo(p.elbow) / dt);
          const rel = a.elbow.clone().sub(a.shoulder).sub(p.elbow.clone().sub(p.shoulder));
          row.elbowRelMax = Math.max(row.elbowRelMax, rel.length() / dt);
          row.bendRateMax = Math.max(row.bendRateMax, Math.abs(a.bend - p.bend) / dt);
        });
      }
      for (const a of arms) {
        row.bendMin = Math.min(row.bendMin, a.bend); row.bendMax = Math.max(row.bendMax, a.bend);
        row.offHingeMax = Math.max(row.offHingeMax, a.offHinge);
      }
      if (trace && prev) trace.push({ kick: rows.length, ct: +(st.keeperDive ? st.keeperDive.t : -1).toFixed(3), mode: s.mode, ik: r3(s.ik), corr: r3(s.corr), pull: r3(s.pull),
        arms: arms.map((a, j) => [Math.round(a.roll * DEG / dt), Math.round(a.bend), Math.round(a.offHinge), +(a.elbow.distanceTo(prev.arms[j].elbow) / dt).toFixed(1)]) });
      prev = { toes, hips, arms };
    }
    rows.push({
      kick: row.kick, clips: [...row.clips].join(' '),
      'slide max m/s': r3(row.slideMax), 'slide total m': r3(row.slideTotal),
      'float max m': r3(row.floatMax), 'hips max m/s': r3(row.hipsMax),
      'glove gap at ball m': row.gloveGapAtBall, 'glove gap max m': r3(row.gloveGapMax),
      'ik pull max m': r3(row.pullMax), 'arm roll max °/s': Math.round(row.rollMax), 'elbow max m/s': +row.elbowMax.toFixed(1), 'elbow vs shoulder max m/s': +row.elbowRelMax.toFixed(1),
      'elbow bend °': `${Math.round(row.bendMin)}..${Math.round(row.bendMax)}`, 'elbow bend max °/s': Math.round(row.bendRateMax),
      'elbow off hinge max °': Math.round(row.offHingeMax),
    });
  }
  return rows;
}
