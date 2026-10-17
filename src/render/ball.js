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
