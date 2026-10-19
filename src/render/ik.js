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
//     and no faster than BEND_SPEED (PINNED_BEND_SPEED once the weight is 1,
//     so the wrist keeps up with a target that is pinned and moving).
//   - Bent to that angle, the arm is a rigid shape, turned at the shoulder so
//     the wrist points at the target. That leaves one free choice: how far
//     the arm is swivelled about the shoulder -> target line (which way the
//     elbow points); the wrist stays put whatever it is. The solver swivels
//     towards the animation's elbow direction (read from its hinge axis, so
//     it is defined for a straight arm too), but never so fast that the upper
//     arm rolls about its own length faster than ROLL_SPEED.
//   - weight slides the target from the animated wrist to the real target,
//     so the hand travels a smooth path. When the weight is back to 0 the arm
//     keeps being solved (onto the animated wrist) until it has caught up
//     with the animation, then lets go, so it never snaps back.
// It all happens in the shoulder bone's frame (the upper arm's parent), so a
// body turning in a dive carries the arm with it. The arm bones are assumed
// to have no scale of their own (the model's is on the root).
export const MIN_BEND = THREE.MathUtils.degToRad(5);
export const MAX_BEND = THREE.MathUtils.degToRad(150);
export const BEND_SPEED = THREE.MathUtils.degToRad(600);          // per second
export const PINNED_BEND_SPEED = THREE.MathUtils.degToRad(1200);  // per second
export const ROLL_SPEED = THREE.MathUtils.degToRad(450);          // per second
const CAUGHT_UP = THREE.MathUtils.degToRad(0.5);

// upper, lower, end: shoulder, elbow and wrist bones. hinge: the elbow's
// axis in the upper arm's frame, the way that bends the arm (right-hand rule).
export function createArm(upper, lower, end, hinge) {
  return { upper, lower, end, hinge: hinge.clone().normalize(), axis: lower.position.clone().normalize(), last: null, bend: 0, used: null };
}
// Forget the last frame (after a jump: the arm is not continuing a motion).
export function resetArm(arm) { arm.last = null; arm.used = null; }

const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _W = new THREE.Vector3(), _d = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _hp = new THREE.Vector3(), _fp = new THREE.Vector3(), _x = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3(), _p = new THREE.Vector3(), _pa = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _r = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qf = new THREE.Quaternion();
const _qg = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _dq = new THREE.Quaternion();

// The signed angle from a to b about axis (both perpendicular to it).
const signedAngle = (a, b, axis) => Math.atan2(axis.dot(_x.crossVectors(a, b)), a.dot(b));

// target: world-space point, or null for the animated wrist. dt: seconds
// since this arm's last solve. elbow: an elbow direction (shoulder frame) to
// use as it is, from a replay: each solve leaves the one it used in arm.used.
// Returns how far the wrist ends up from target, or null if the animation
// was left alone.
export function solveArm(arm, target, weight, dt, elbow = null) {
  const { upper, lower, end, hinge } = arm;
  if (weight <= 0 && !arm.last && !elbow) return null;
  const parent = upper.parent;
  upper.updateMatrixWorld(true);
  _S.copy(upper.position);
  _W.setFromMatrixPosition(end.matrixWorld); parent.worldToLocal(_W);
  if (target) { _T.copy(target); parent.worldToLocal(_T); } else _T.copy(_W);
  _T.lerp(_W, 1 - Math.max(weight, 0));   // where the wrist goes this frame
  _qa.copy(upper.quaternion); _qf.copy(lower.quaternion);
  const dist = _d.subVectors(_T, _S).length();
  if (dist < 1e-9) return null;
  _d.divideScalar(dist);
  const live = !elbow && arm.last;   // carrying on from last frame's solve

  // 1. The elbow. In the upper arm's frame, shoulder -> elbow is v1 and
  // elbow -> wrist is f2; turning the forearm about the hinge changes the
  // angle between their parts across the hinge, and so the reach.
  _v1.copy(lower.position);
  _f2.copy(end.position).applyQuaternion(lower.quaternion);
  const v1h = hinge.dot(_v1), f2h = hinge.dot(_f2);
  _hp.copy(_v1).addScaledVector(hinge, -v1h);
  _fp.copy(_f2).addScaledVector(hinge, -f2h);
  const cosBend = (dist * dist - _v1.lengthSq() - _f2.lengthSq() - 2 * v1h * f2h) / (2 * _hp.length() * _fp.length());
  let bend = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(cosBend, -1, 1)), MIN_BEND, MAX_BEND);
  const bendSpeed = weight >= 1 ? PINNED_BEND_SPEED : BEND_SPEED;
  if (live) bend = arm.bend + THREE.MathUtils.clamp(bend - arm.bend, -bendSpeed * dt, bendSpeed * dt);
  const animBend = signedAngle(_hp, _fp, hinge);
  lower.quaternion.premultiply(_r.setFromAxisAngle(hinge, bend - animBend));

  // 2. Which way the elbow should point: across the shoulder -> target line,
  // where the animation's hinge axis says (the elbow is on the line x hinge
  // side). That is poorly defined when the line runs along the hinge axis;
  // there the last frame's direction is trusted more.
  _pa.copy(hinge).applyQuaternion(_qa);
  _pa.crossVectors(_d, _pa);
  const sure = _pa.length();
  if (elbow) _p.copy(elbow);
  else if (sure > 1e-6) _p.copy(_pa).divideScalar(sure);
  else perpendicular(_d, _p);
  if (live && arm.used) {
    _e1.copy(arm.used).addScaledVector(_d, -arm.used.dot(_d));
    if (_e1.lengthSq() > 1e-8) {
      _e1.normalize();
      const toAnim = signedAngle(_e1, _p, _d);
      _p.copy(_e1).applyQuaternion(_r.setFromAxisAngle(_d, THREE.MathUtils.smoothstep(sure, 0.1, 0.4) * toAnim));
    }
  }
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();

  // 3. The shoulder: turn the rigid arm so that, in the upper arm's frame,
  // the shoulder -> wrist direction (e1) goes to the target line and the
  // elbow's side of it (e2: square to e1 and the hinge) goes to the elbow
  // direction. Both frames are completed with a cross product.
  _e1.copy(_v1).add(_f2.copy(end.position).applyQuaternion(lower.quaternion)).normalize();
  _e2.crossVectors(_e1, hinge).normalize();
  _m1.makeBasis(_e1, _e2, _e3.crossVectors(_e1, _e2));
  _m2.makeBasis(_d, _p, _e3.crossVectors(_d, _p));
  _qg.setFromRotationMatrix(_m2.multiply(_m1.transpose()));   // upper arm frame -> shoulder frame

  // 4. Roll limit: if that would roll the upper arm about its length faster
  // than ROLL_SPEED since last frame, swivel back (about the target line, so
  // the wrist stays put) until it doesn't.
  let swivel = 0;
  if (live) {
    const limit = ROLL_SPEED * dt;
    const rollAt = (a) => roll(arm.last, _qt.setFromAxisAngle(_d, a).multiply(_qg), arm.axis);
    const r0 = rollAt(0);
    if (Math.abs(r0) > limit) {
      const want = Math.sign(r0) * limit;
      for (let i = 0; i < 8; i++) {   // Newton's method on the swivel angle
        const f = rollAt(swivel) - want;
        if (Math.abs(f) < 1e-5) break;
        const slope = (rollAt(swivel + 1e-4) - rollAt(swivel)) / 1e-4;
        if (Math.abs(slope) < 0.05) break;   // the arm points along the line: swivelling can't help
        swivel = THREE.MathUtils.clamp(swivel - f / slope, -Math.PI, Math.PI);
      }
      if (Math.abs(rollAt(swivel)) > Math.abs(r0)) swivel = 0;
    }
  }
  upper.quaternion.setFromAxisAngle(_d, swivel).multiply(_qg);
  _p.applyQuaternion(_r.setFromAxisAngle(_d, swivel));

  // Caught up with the animation after the IK has faded: let go.
  if (weight <= 0 && !elbow && upper.quaternion.angleTo(_qa) < CAUGHT_UP && Math.abs(bend - animBend) < CAUGHT_UP) {
    upper.quaternion.copy(_qa); lower.quaternion.copy(_qf); upper.updateMatrixWorld(true);
    resetArm(arm);
    return null;
  }
  arm.last = (arm.last || new THREE.Quaternion()).copy(upper.quaternion);
  arm.bend = bend;
  arm.used = (arm.used || new THREE.Vector3()).copy(_p);
  upper.updateMatrixWorld(true);
  end.getWorldPosition(_W);
  return target && weight > 0 ? _W.distanceTo(target) : null;
}

// How far (rad, signed) q1 has turned about axis (a direction in the bone's
// own frame) since q0.
function roll(q0, q1, axis) {
  _dq.copy(q0).invert().multiply(q1);
  if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
  return 2 * Math.atan2(_dq.x * axis.x + _dq.y * axis.y + _dq.z * axis.z, _dq.w);
}

// Some direction square to d (unit), into out.
function perpendicular(d, out) {
  out.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0);
  return out.addScaledVector(d, -out.dot(d)).normalize();
}
