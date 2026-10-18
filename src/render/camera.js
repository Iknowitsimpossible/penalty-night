// The camera director: picks a shot for each moment (title sweep, menu,
// shooting, keeping, celebration, replay) and glides between them.
// With reduced motion it cuts instead of gliding, holds still in menus,
// and never chases the ball.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';

const KEEPER_PLANE = 0.35, BASE_DIST = 6.75, GOAL_VIEW = 4.3;   // metres

const isFiniteVec = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export function createCameraDirector(camera) {
  // Distance behind the keeper's line at which GOAL_VIEW metres either side fit the screen.
  const keeperDistance = () => {
    const half = Math.atan(Math.tan((baseFov * Math.PI) / 360) * camera.aspect);
    return Math.max(BASE_DIST, GOAL_VIEW / Math.tan(half));
  };
  const pos = new THREE.Vector3(-3.5, 2.1, 16.7), look = new THREE.Vector3(-4.2, 1.6, 0);
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let baseFov = 50;
  let shake = 0;                       // a small jolt when the ball hits the frame
  const jolt = new THREE.Vector3();

  const director = {
    goal: 'menu',
    wantPos, wantLook,
    // s: { intro, flying, ball, run, reduced }
    update(dt, time, s) {
      const goal = director.goal;
      const t = s.reduced ? 0 : time;   // no idle drift with reduced motion
      if (goal === 'intro' && s.intro) {
        // from high above the far end, sweeping down to a low angle on the goal
        const p = s.reduced ? 1 : clamp(s.intro.t / 4.4, 0, 1), e = p * p * (3 - 2 * p);
        const a = lerp(0.9, -0.42, e), r = lerp(70, 22.5, e);
        pos.set(Math.sin(a) * r, lerp(40, 4.2, e), Math.cos(a) * r);
        look.set(0, lerp(0, 1.4, e), lerp(14, 0, e));
        if (p >= 1 && !s.reduced) { s.intro.orbit = (s.intro.orbit || 0) + dt; }
        if (s.intro.orbit !== undefined) {
          const o = -0.42 + Math.sin(s.intro.orbit * 0.12) * 0.5;
          pos.set(Math.sin(o) * 22.5, 4.2 + Math.sin(s.intro.orbit * 0.2) * 0.4, Math.cos(o) * 22.5);
        }
        wantPos.copy(pos); wantLook.copy(look);
        camera.position.copy(pos); camera.lookAt(look);
        return;
      } else if (goal === 'pick') {
        const a = t * 0.25;
        wantPos.set(Math.sin(a) * 0.25, 1.32, 15.6); wantLook.set(Math.sin(a * 0.8) * 0.3, 1.25, 0);
      } else if (goal === 'menu') {
        // a slow drift that keeps the floodlit goal on the right, clear of the title
        const a = t * 0.12;
        wantPos.set(-3.5 + Math.sin(a) * 1.5, 2.1 + Math.sin(a * 0.7) * 0.3, 15.5 + Math.cos(a) * 1.2);
        wantLook.set(-4.2 + Math.sin(a) * 0.8, 1.6, 0);
      } else if (goal === 'shoot') {
        if (s.flying && !s.reduced) {
          wantPos.set(s.ball.x * 0.3, 1.4, Math.max(s.ball.z + 5, 6.2)); wantLook.set(s.ball.x * 0.5, 1.1, 0);
        } else { wantPos.set(0, 1.45, 14.7); wantLook.set(0, 1.15, 0); }
      } else if (goal === 'celebrate' && s.run && s.run.pos) {
        // behind and beside the scorer, looking past them at their fans
        const r = s.run, dx = r.to.x - r.from.x, dz = r.to.z - r.from.z, L = Math.hypot(dx, dz);
        const fx = dx / L, fz = dz / L;
        wantPos.set(r.pos.x - fx * 4 - fz * 2.4, 1.9, r.pos.z - fz * 4 + fx * 2.4);
        wantLook.set(r.pos.x + fx * 2.5, 1.0, r.pos.z + fz * 2.5);
      } else if (goal === 'keeper') {
        // Behind the goal. On narrow (portrait) screens the camera backs up
        // until the whole goal mouth fits, so every corner can be seen and tapped.
        const d = keeperDistance();
        wantPos.set(0, Math.min(6, 3.5 * d / BASE_DIST), KEEPER_PLANE - d); wantLook.set(0, 0.7, 10);
      }
      // 'replay': wantPos / wantLook are set by the replay itself
      const rate = goal === 'menu' ? 1.5 : goal === 'pick' ? 1.8 : goal === 'replay' ? 6 : goal === 'celebrate' ? 4 : 3.2;
      const k = s.reduced ? 1 : 1 - Math.exp(-dt * rate);
      pos.lerp(wantPos, k); look.lerp(wantLook, k);
      // Easing can't recover from NaN (NaN + anything is NaN), so once the
      // target is sane again, jump straight to it instead.
      if (!isFiniteVec(pos) && isFiniteVec(wantPos)) pos.copy(wantPos);
      if (!isFiniteVec(look) && isFiniteVec(wantLook)) look.copy(wantLook);
      shake = s.reduced ? 0 : shake * Math.exp(-dt * 9);
      jolt.set(Math.sin(time * 61), Math.sin(time * 47 + 1), 0).multiplyScalar(shake);
      camera.position.copy(pos).add(jolt); camera.lookAt(look);
      // Backed into the stands: skip drawing anything right in front of the
      // lens (seats and crowd behind the goal) so the view stays clear.
      const near = goal === 'keeper' ? Math.max(0.1, -pos.z - 5.5) : 0.1;
      if (Math.abs(camera.near - near) > 0.01) { camera.near = near; camera.updateProjectionMatrix(); }
      const fov = goal === 'replay' ? baseFov * 0.66 : baseFov;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = s.reduced ? fov : lerp(camera.fov, fov, 1 - Math.exp(-dt * 5));
        camera.updateProjectionMatrix();
      }
    },
    snap() { pos.copy(wantPos); look.copy(wantLook); },
    shake(amount) { shake = Math.max(shake, amount); },
    resize(w, h) {
      // A hidden container reports 0x0; w / h would be NaN and poison every shot.
      if (!(w > 0 && h > 0)) return;
      camera.aspect = w / h;
      baseFov = w / h < 1 ? clamp(50 / (w / h) * 0.72, 50, 78) : 50;
      camera.fov = director.goal === 'replay' ? baseFov * 0.66 : baseFov;
      camera.updateProjectionMatrix();
    },
  };
  return director;
}
