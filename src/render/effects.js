// Celebration effects: confetti, fireworks and phone flashes in the stands.
import * as THREE from 'three';
import { rand, gauss } from '../core/visual-random.js';

export const GOLD = [0xf2c230, 0xffe08a, 0xffffff, 0xf6e7a8];

// opts.behindGoal(): true when the camera looks out from behind the goal,
// so fireworks go up over the far stand instead. opts.onFirework(): sound.
export function createEffects(world, opts) {
  const { scene, glowTex, crowdSpots, dummy, tmpColor } = world;

  // Confetti: one instanced mesh of small paper squares that tumble and drift down.
  const CONF_N = 900;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.15),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false }), CONF_N);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false;
  const conf = Array.from({ length: CONF_N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONF_N; i++) { confetti.setMatrixAt(i, zeroM); confetti.setColorAt(i, tmpColor.setHex(0xffffff)); }
  scene.add(confetti);
  let confNext = 0, confAlive = 0;
  function burstConfetti(cx, cy, cz, spread, count, colors, up) {
    for (let n = 0; n < count; n++) {
      const i = confNext; confNext = (confNext + 1) % CONF_N;
      const c = conf[i];
      c.life = rand(3.5, 5.5);
      c.p.set(cx + rand(-spread, spread), cy + rand(-1, 1), cz + rand(-spread * 0.4, spread * 0.4));
      c.v.set(rand(-2.5, 2.5), rand(up * 0.5, up), rand(0, 3.5));
      c.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
      c.w.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      confetti.setColorAt(i, tmpColor.setHex(colors[(Math.random() * colors.length) | 0]));
    }
    confetti.instanceColor.needsUpdate = true;
    confAlive = CONF_N;
  }
  function updateConfetti(dt, time) {
    if (!confAlive) return;
    let alive = 0;
    for (let i = 0; i < CONF_N; i++) {
      const c = conf[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y -= 7 * dt;
      c.v.multiplyScalar(1 - 1.8 * dt);           // air drag makes paper flutter instead of fall
      c.v.x += Math.sin(time * 3 + i) * 1.2 * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      if (c.life <= 0 || c.p.y < 0.02) { c.life = 0; confetti.setMatrixAt(i, zeroM); continue; }
      alive++;
      dummy.position.copy(c.p); dummy.rotation.copy(c.r); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
    confAlive = alive;
  }

  // Fireworks: glowing points that burst outward, fall, and fade to black
  // (with additive blending, black is invisible).
  const FW_N = 1600;
  const fwPos = new Float32Array(FW_N * 3), fwCol = new Float32Array(FW_N * 3);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fireworks = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 1.6, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  fireworks.frustumCulled = false;
  scene.add(fireworks);
  const fw = Array.from({ length: FW_N }, () => ({ life: 0, max: 1, v: new THREE.Vector3(), c: new THREE.Color() }));
  let fwNext = 0, fwAlive = 0;
  const _dir = new THREE.Vector3(), _white = new THREE.Color(0xffffff);
  function firework(colorHex) {
    const behind = opts.behindGoal();
    const ax = rand(-26, 26), ay = behind ? rand(15, 21) : rand(24, 33), az = behind ? rand(48, 58) : rand(-34, -24);
    const base = new THREE.Color(colorHex);
    for (let n = 0; n < 140; n++) {
      const i = fwNext; fwNext = (fwNext + 1) % FW_N;
      const f = fw[i];
      f.life = f.max = rand(1.1, 1.9);
      _dir.set(gauss(), gauss(), gauss()).normalize();
      f.v.copy(_dir).multiplyScalar(rand(7, 11));
      f.c.copy(base).lerp(_white, rand(0, 0.35));
      fwPos[i * 3] = ax; fwPos[i * 3 + 1] = ay; fwPos[i * 3 + 2] = az;
    }
    fwAlive = FW_N;
    opts.onFirework();
  }
  function updateFireworks(dt) {
    if (!fwAlive) return;
    let alive = 0;
    for (let i = 0; i < FW_N; i++) {
      const f = fw[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      f.v.y -= 5 * dt; f.v.multiplyScalar(1 - 1.1 * dt);
      fwPos[i * 3] += f.v.x * dt; fwPos[i * 3 + 1] += f.v.y * dt; fwPos[i * 3 + 2] += f.v.z * dt;
      const k = Math.max(0, f.life / f.max) * (0.75 + 0.25 * Math.random());
      fwCol[i * 3] = f.c.r * k; fwCol[i * 3 + 1] = f.c.g * k; fwCol[i * 3 + 2] = f.c.b * k;
      if (f.life > 0) alive++;
    }
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.color.needsUpdate = true;
    fwAlive = alive;
  }

  // Phone camera flashes popping in the stands: one point cloud (one draw
  // call) whose colours fade to black, which additive blending hides.
  const FLASH_N = 60;
  const flashPos = new Float32Array(FLASH_N * 3), flashCol = new Float32Array(FLASH_N * 3), flashLevel = new Float32Array(FLASH_N);
  for (let i = 0; i < FLASH_N; i++) {
    const spot = crowdSpots[(Math.random() * crowdSpots.length) | 0];
    flashPos[i * 3] = spot.x; flashPos[i * 3 + 1] = spot.y + 0.7; flashPos[i * 3 + 2] = spot.z + 0.15;
  }
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
  const flashPoints = new THREE.Points(flashGeo, new THREE.PointsMaterial({ size: 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  flashPoints.frustumCulled = false;
  scene.add(flashPoints);
  let flashRate = 0, flashesLit = false;
  function updateFlashes(dt) {
    flashRate *= Math.exp(-dt * 0.5);
    if (flashRate < 0.05 && !flashesLit) return;
    let lit = false;
    for (let i = 0; i < FLASH_N; i++) {
      if (Math.random() < flashRate * dt / FLASH_N * 6) flashLevel[i] = 1;
      else flashLevel[i] *= Math.exp(-dt * 16);
      if (flashLevel[i] > 0.01) lit = true;
      flashCol[i * 3] = flashCol[i * 3 + 1] = flashCol[i * 3 + 2] = flashLevel[i];
    }
    flashGeo.attributes.color.needsUpdate = true;
    flashesLit = lit;
  }

  return {
    burstConfetti, updateConfetti, firework, updateFireworks, updateFlashes,
    setFlashRate: (r) => { flashRate = r; },
  };
}
