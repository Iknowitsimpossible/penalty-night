// Two-bone inverse kinematics: bend an arm (shoulder -> elbow -> wrist) so
// the wrist lands on a target. Used to put the animated keeper's gloves on
// the game's glove spheres, so what you see is what the ball hits.
//
// The solve has two steps, both in world space:
//   1. Bend the elbow until the shoulder-to-wrist distance equals the
//      shoulder-to-target distance (law of cosines).
//   2. Swing the whole arm at the shoulder so the wrist points at the target.
// The elbow keeps bending in the plane the animation had it in. When the
// animated arm is straight there is no such plane, so `pole` (the way the
// elbow should point, e.g. down and back) picks it.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();

// Rotate a bone by q in world space, keeping its parent where it is.
function rotateWorld(bone, q) {
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(q);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_pq);
    _wq.premultiply(_pq.invert());
  }
  bone.quaternion.copy(_wq);
  bone.updateMatrixWorld(true);
}

// The angle at b in the triangle a-b-c (radians, PI = straight).
function angleAt(a, b, c) {
  return _u.subVectors(a, b).angleTo(_v.subVectors(c, b));
}

// upper: shoulder bone (rotates), lower: elbow bone (rotates), end: wrist bone.
// target: world-space point. weight 0..1 blends from the animated arm to the solve.
// Returns how far (metres, world units) the wrist ends up from the target.
export function solveTwoBone(upper, lower, end, target, pole, weight = 1) {
  if (weight <= 0) return null;
  upper.updateMatrixWorld(true);
  const q0 = upper.quaternion.clone(), q1 = lower.quaternion.clone();
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  _t.copy(target);
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
  const d = THREE.MathUtils.clamp(_a.distanceTo(_t), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);

  // 1. elbow: the interior angle that makes |shoulder -> wrist| = d
  const want = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const now = angleAt(_a, _b, _c);
  const straight = now > Math.PI - 0.05;
  // The axis must be perpendicular to the forearm, or turning about it
  // sweeps a cone instead of opening the elbow by the angle asked for.
  if (straight) _n.subVectors(_c, _a).cross(pole);          // bend plane from the pole
  else _n.subVectors(_a, _b).cross(_w.subVectors(_c, _b));   // bend plane from the animation
  if (_n.lengthSq() < 1e-10) _n.subVectors(_c, _a).cross(_w.set(1, 0, 0));
  if (_n.lengthSq() < 1e-10) _n.subVectors(_c, _a).cross(_w.set(0, 0, 1));
  _n.normalize();
  // Rotating the forearm about _n changes the interior angle; try one way and
  // flip if it went the wrong way (cheaper to reason about than the sign).
  const bendBy = (delta) => {
    _q.setFromAxisAngle(_n, delta);
    rotateWorld(lower, _q);
    end.getWorldPosition(_c);
  };
  bendBy(now - want);
  if (Math.abs(angleAt(_a, _b, _c) - want) > 1e-3) {
    lower.quaternion.copy(q1); lower.updateMatrixWorld(true);
    bendBy(want - now);
  }

  // 2. shoulder: swing so the wrist points at the target
  const aim = () => {
    end.getWorldPosition(_c);
    _u.subVectors(_c, _a).normalize();
    _v.subVectors(_t, _a).normalize();
    _q.setFromUnitVectors(_u, _v);
    rotateWorld(upper, _q);
  };
  aim();

  // From a straight arm both bend directions are valid; keep the one that
  // puts the elbow on the pole side of the shoulder-target line.
  if (straight) {
    lower.getWorldPosition(_b);
    _u.subVectors(_t, _a).normalize();
    _w.subVectors(_b, _a);
    _w.addScaledVector(_u, -_w.dot(_u));   // elbow offset from the line
    if (_w.dot(pole) < 0) {
      upper.quaternion.copy(q0); lower.quaternion.copy(q1); upper.updateMatrixWorld(true);
      upper.getWorldPosition(_a); end.getWorldPosition(_c);
      _n.negate();
      bendBy(now - want);
      if (Math.abs(angleAt(_a, _b.setFromMatrixPosition(lower.matrixWorld), _c) - want) > 1e-3) {
        lower.quaternion.copy(q1); lower.updateMatrixWorld(true);
        bendBy(want - now);
      }
      aim();
    }
  }

  if (weight < 1) {
    upper.quaternion.copy(q0.slerp(upper.quaternion, weight));
    lower.quaternion.copy(q1.slerp(lower.quaternion, weight));
    upper.updateMatrixWorld(true);
  }
  end.getWorldPosition(_c);
  return _c.distanceTo(target);
}

// ------------------------------------------------------------------ arms
// The arm solver is stricter than solveTwoBone, because arms are in the
// picture and noodly arms show:
//   - The elbow is a hinge. It only bends about `hinge` (an axis in the
//     upper arm's own frame), between MIN_BEND and MAX_BEND from straight,
//     so it can't bend sideways, lock out or fold up.
//   - Bent to the right angle, the arm is a rigid shape. It is turned at
//     the shoulder so the wrist lands on the target, with the elbow pointing
//     a remembered way (`arm.elbow`). That way follows the animation's (its
//     hinge axis says where the elbow points, even when the arm is straight)
//     but turns at most MAX_TURN, so the upper arm can't spin.
//   - weight slides the target from the animated wrist to the real target,
//     so the hand travels a smooth path; at 0 the animation is untouched.
// Everything is worked out in the shoulder bone's frame (the upper arm's
// parent), so a body turning in a dive carries the elbow with it. The arm
// bones are assumed to have no scale of their own (the model's is on the root).
export const MIN_BEND = THREE.MathUtils.degToRad(5);
export const MAX_BEND = THREE.MathUtils.degToRad(140);
export const MAX_TURN = THREE.MathUtils.degToRad(400);   // the elbow direction's top speed (per second)
const ELBOW_LAG = 0.08;   // seconds for the elbow direction to catch up with the animation's

// upper, lower, end: shoulder, elbow and wrist bones. hinge: the elbow's
// axis in the upper arm's frame, the way that bends the arm (right-hand rule).
export function createArm(upper, lower, end, hinge) {
  return { upper, lower, end, hinge: hinge.clone().normalize(), elbow: null, line: null, used: null };
}

const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _W = new THREE.Vector3(), _d = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _hp = new THREE.Vector3(), _fp = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3(), _p = new THREE.Vector3(), _pa = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _r = new THREE.Quaternion(), _qa = new THREE.Quaternion();

// The signed angle from a to b about axis (all perpendicular to it).
const signedAngle = (a, b, axis) => Math.atan2(axis.dot(_e3.crossVectors(a, b)), a.dot(b));
// Turn v (perpendicular to axis) about axis by angle, in place.
const turn = (v, axis, angle) => v.applyQuaternion(_r.setFromAxisAngle(axis, angle));

// target: world-space point. dt: seconds since the last solve of this arm.
// elbow: a fixed elbow direction (shoulder frame) instead of the remembered
// one; a replay stores arm.used, the direction each solve ended up using,
// and passes it back. Returns how far the wrist ends up from target.
export function solveArm(arm, target, weight, dt, elbow = null) {
  const { upper, lower, end, hinge } = arm;
  if (weight <= 0) { arm.elbow = null; arm.used = null; return null; }
  const parent = upper.parent;
  upper.updateMatrixWorld(true);
  _S.copy(upper.position);
  _T.copy(target); parent.worldToLocal(_T);
  _W.setFromMatrixPosition(end.matrixWorld); parent.worldToLocal(_W);
  _T.lerp(_W, 1 - weight);   // where the wrist goes this frame
  _qa.copy(upper.quaternion);
  const dist = _d.subVectors(_T, _S).length();
  if (dist < 1e-9) return _W.distanceTo(_T);
  _d.divideScalar(dist);

  // 1. The elbow. In the upper arm's frame, shoulder -> elbow is v1 and
  // elbow -> wrist is f2; turning the forearm about the hinge changes the
  // angle between their parts across the hinge, and so the reach.
  _v1.copy(lower.position);
  _f2.copy(end.position).applyQuaternion(lower.quaternion);
  const v1h = hinge.dot(_v1), f2h = hinge.dot(_f2);
  _hp.copy(_v1).addScaledVector(hinge, -v1h);
  _fp.copy(_f2).addScaledVector(hinge, -f2h);
  const cosBend = (dist * dist - _v1.lengthSq() - _f2.lengthSq() - 2 * v1h * f2h) / (2 * _hp.length() * _fp.length());
  const want = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(cosBend, -1, 1)), MIN_BEND, MAX_BEND);
  const now = signedAngle(_hp, _fp, hinge);
  lower.quaternion.premultiply(_r.setFromAxisAngle(hinge, want - now));

  // 2. Which way the elbow points: a direction across the shoulder -> target
  // line. The animation's is where its hinge axis says (the elbow sits on
  // the line x hinge side); how well that is defined falls to nothing when
  // the line runs along the hinge axis.
  _pa.copy(hinge).applyQuaternion(_qa);
  _pa.crossVectors(_d, _pa);
  const sure = _pa.length();
  if (sure > 1e-6) _pa.divideScalar(sure);
  if (elbow) {
    _p.copy(elbow);
  } else if (!arm.elbow) {
    arm.elbow = sure > 1e-6 ? _pa.clone() : perpendicular(_d, new THREE.Vector3());
    arm.line = _d.clone();
    _p.copy(arm.elbow);
  } else {
    // carry the remembered direction round with the line (a small turn each
    // frame, so no twist about the line), then ease it towards the
    // animation's, quicker the surer that is
    arm.elbow.applyQuaternion(_r.setFromUnitVectors(arm.line, _d));
    arm.line.copy(_d);
    if (sure > 1e-6) {
      const gap = signedAngle(arm.elbow, _pa, _d);
      const step = Math.min(Math.abs(gap) * (1 - Math.exp(-dt / ELBOW_LAG)), MAX_TURN * dt) * THREE.MathUtils.smoothstep(sure, 0.1, 0.4);
      turn(arm.elbow, _d, Math.sign(gap) * step);
    }
    _p.copy(arm.elbow);
    // part way back to the animation's while the IK fades, so it hands over
    // without a jump
    if (weight < 1 && sure > 1e-6) turn(_p, _d, (1 - weight) * signedAngle(_p, _pa, _d));
  }
  _p.addScaledVector(_d, -_p.dot(_d));
  if (_p.lengthSq() < 1e-12) perpendicular(_d, _p);
  _p.normalize();
  arm.used = (arm.used || new THREE.Vector3()).copy(_p);

  // 3. The shoulder: turn the rigid arm so that, in the upper arm's frame,
  // the shoulder -> wrist direction (e1) goes to the target line and the
  // elbow's side of that line (e2: square to e1 and to the hinge) goes to the
  // elbow direction. Both frames are completed with a cross product.
  _e1.copy(_v1).add(_f2.copy(end.position).applyQuaternion(lower.quaternion)).normalize();
  _e2.crossVectors(_e1, hinge).normalize();
  _m1.makeBasis(_e1, _e2, _e3.crossVectors(_e1, _e2));
  _m2.makeBasis(_d, _p, _e3.crossVectors(_d, _p));
  _m2.multiply(_m1.transpose());   // upper arm frame -> its frame -> the shoulder's
  upper.quaternion.setFromRotationMatrix(_m2);
  upper.updateMatrixWorld(true);

  end.getWorldPosition(_W);
  return _W.distanceTo(target);
}

// Some direction square to d (unit), into out.
function perpendicular(d, out) {
  out.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0);
  return out.addScaledVector(d, -out.dot(d)).normalize();
}
