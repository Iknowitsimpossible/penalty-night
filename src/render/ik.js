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
