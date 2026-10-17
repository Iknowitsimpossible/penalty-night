// Development only (loaded from game.js under import.meta.env.DEV, so it is
// never part of a production build). Press C to see what the physics sees:
// the keeper's collision spheres, the posts and bar, and the ball, drawn as
// wireframes on top of everything. While it is on, the game freezes the
// first time a kick touches the frame or the keeper and marks the contact,
// so you can check that it really touched. Any key or click carries on.
import * as THREE from 'three';
import { POST_R, R, PX, BAR_Y } from '../core/constants.js';
import { clamp } from '../core/math.js';

const COLORS = { body: 0xffe14d, glove: 0x4de1ff, frame: 0xff8a3d, ball: 0xffffff, contact: 0xff2d55 };

function wire(geo, color) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85, depthTest: false, fog: false }));
  m.renderOrder = 20;
  return m;
}

export function createCollisionDebug(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const unitSphere = new THREE.SphereGeometry(1, 12, 8);
  const keeperWires = [];   // created on first use, one per keeper sphere
  const ballWire = wire(unitSphere, COLORS.ball);
  ballWire.scale.setScalar(R);
  group.add(ballWire);

  // The frame exactly as collideStep() tests it: two posts and the bar.
  for (const s of [-1, 1]) {
    const post = wire(new THREE.CylinderGeometry(POST_R, POST_R, BAR_Y, 10, 4, true), COLORS.frame);
    post.position.set(s * PX, BAR_Y / 2, 0);
    group.add(post);
  }
  const bar = wire(new THREE.CylinderGeometry(POST_R, POST_R, 2 * PX, 10, 8, true), COLORS.frame);
  bar.rotation.z = Math.PI / 2; bar.position.set(0, BAR_Y, 0);
  group.add(bar);

  // Contact markers: the ball where it touched, and a dot on the surface it hit.
  const markers = [];
  let markedShot = null;
  const clearMarkers = () => { for (const m of markers) group.remove(m); markers.length = 0; };

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9999;padding:6px 10px;border-radius:6px;' +
    'background:rgba(0,0,0,.72);color:#fff;font:12px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre';
  label.hidden = true;
  document.body.appendChild(label);
  const showLabel = () => {
    label.hidden = !group.visible;
    label.textContent = debug.halted
      ? `Collision debug: FROZEN on ${debug.halted} contact\nAny key or click to carry on`
      : 'Collision debug (C to hide)\nyellow body · cyan gloves · orange frame';
  };

  // The nearest point on a collider's surface to the ball's centre.
  const _q = new THREE.Vector3();
  function surfacePoint(ballPos, spheres, kind) {
    let best = null, bestGap = Infinity;
    const consider = (centre, radius) => {
      const gap = centre.distanceTo(ballPos) - radius - R;
      if (gap < bestGap) { bestGap = gap; best = centre.clone().add(_q.subVectors(ballPos, centre).setLength(radius)); }
    };
    if (kind === 'keeper' && spheres) for (const s of spheres) consider(s.c, s.r);
    if (kind === 'frame') {
      for (const s of [-1, 1]) consider(new THREE.Vector3(s * PX, clamp(ballPos.y, 0, BAR_Y), 0), POST_R);
      consider(new THREE.Vector3(clamp(ballPos.x, -PX, PX), BAR_Y, 0), POST_R);
    }
    return { point: best, gap: bestGap };
  }

  const debug = {
    get on() { return group.visible; },
    halted: null,   // 'keeper' | 'frame' while frozen on a contact
    toggle() {
      group.visible = !group.visible;
      if (!group.visible) { clearMarkers(); debug.halted = null; }
      showLabel();
    },
    resume() { debug.halted = null; showLabel(); },
    // Every frame: follow the keeper's spheres (null when no keeper) and the ball.
    update(spheres, ballPos) {
      if (!group.visible) return;
      const n = spheres ? spheres.length : 0;
      while (keeperWires.length < n) {
        const w = wire(unitSphere, keeperWires.length === 5 || keeperWires.length === 6 ? COLORS.glove : COLORS.body);
        keeperWires.push(w); group.add(w);
      }
      keeperWires.forEach((w, i) => {
        w.visible = i < n;
        if (i < n) { w.position.copy(spheres[i].c); w.scale.setScalar(spheres[i].r); }
      });
      ballWire.position.copy(ballPos);
    },
    // Called from the collision callbacks. Freezes on the first contact of
    // each kind in a kick. Returns true when the game should stop ticking.
    contact(kind, shot, ballPos, spheres) {
      if (!group.visible) return false;
      if (shot !== markedShot) { clearMarkers(); markedShot = shot; shot.debugSeen = {}; }
      if (shot.debugSeen[kind]) return false;
      shot.debugSeen[kind] = true;
      const ghost = wire(unitSphere, COLORS.contact);
      ghost.scale.setScalar(R); ghost.position.copy(ballPos);
      const { point, gap } = surfacePoint(ballPos, spheres, kind);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: COLORS.contact, depthTest: false, fog: false }));
      dot.renderOrder = 21;
      if (point) dot.position.copy(point);
      markers.push(ghost, dot); group.add(ghost, dot);
      debug.halted = kind;
      // gap is about 0 after the bounce pushed the ball out to the surface
      console.info(`[collision debug] ${kind} contact at`, ballPos.toArray().map((v) => +v.toFixed(3)), 'gap', +gap.toFixed(4));
      showLabel();
      return true;
    },
  };
  return debug;
}
