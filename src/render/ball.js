// The ball's look: a classic black-and-white panel texture on a sphere.
import * as THREE from 'three';
import { R } from '../core/constants.js';

export function createBallMesh(world) {
  const { canvasTexture } = world;
  const tex = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#f7f7f4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#16171c';
    const spots = [[90, 0], [-90, 0]];
    for (let k = 0; k < 5; k++) { spots.push([26.6, k * 72]); spots.push([-26.6, k * 72 + 36]); }
    for (const [lat, lon] of spots) {
      const x = ((lon + 180) % 360) / 360 * w, y = (90 - lat) / 180 * h;
      if (Math.abs(lat) > 80) { c.fillRect(0, lat > 0 ? 0 : h - 22, w, 22); continue; }
      const rx = 26 / Math.cos(lat * Math.PI / 180);
      for (const dx of [-w, 0, w]) {
        c.beginPath();
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; c.lineTo(x + dx + Math.cos(a) * rx, y + Math.sin(a) * 26); }
        c.fill();
      }
    }
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 }));
  mesh.castShadow = true;
  world.scene.add(mesh);
  return mesh;
}

// Helpers that make a fast, small ball easy to follow: a soft glow around
// it and a short fading trail of where it has just been.
const TRAIL_N = 18;
export function createBallTracking(world) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: world.glowTex, color: 0xfff4d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.scale.set(0.9, 0.9, 1);
  world.scene.add(halo);

  const pos = new Float32Array(TRAIL_N * 3), col = new Float32Array(TRAIL_N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  trail.frustumCulled = false;
  world.scene.add(trail);
  const history = [];
  let strength = 0;

  // emphasis 0..1: how strongly to highlight (stronger when you keep goal).
  function update(ballPos, moving, emphasis, dt) {
    strength += ((moving ? emphasis : 0) - strength) * Math.min(1, dt * 10);
    halo.position.copy(ballPos);
    halo.material.opacity = 0.55 * strength;
    if (moving) { history.unshift(ballPos.clone()); if (history.length > TRAIL_N) history.pop(); } else history.length = 0;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = history[Math.min(i, history.length - 1)] || ballPos;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const k = strength * (1 - i / TRAIL_N) * 0.8;
      col[i * 3] = k; col[i * 3 + 1] = k * 0.92; col[i * 3 + 2] = k * 0.7;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { update };
}
