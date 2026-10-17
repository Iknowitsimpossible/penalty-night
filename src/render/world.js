// The stadium: renderer, camera, lights, pitch, goal, net, boards, stands,
// crowd and floodlights. Everything here is scenery; gameplay lives elsewhere.
import * as THREE from 'three';
import { HALF, GOAL_H, POST_R, PX, BAR_Y, SPOT_Z, NET_D0, NET_D1, netDepth } from '../core/constants.js';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand } from '../core/visual-random.js';

export function createWorld(canvas) {
  // ------------------------------------------------------------------ renderer
  // Throws when WebGL is unavailable; the caller shows a message.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1020, 70, 190);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    return t;
  }

  // ------------------------------------------------------------------ sky
  scene.background = canvasTexture(512, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#02040b'); g.addColorStop(0.6, '#0a1330'); g.addColorStop(1, '#1b2850');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(255,255,255,${rand(0.15, 0.7)})`;
      c.fillRect(rand(0, w), rand(0, h * 0.6), 1, 1);
    }
  });

  // ------------------------------------------------------------------ lights
  const hemi = new THREE.HemisphereLight(0xaab8ff, 0x1d3a22, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d4, 1.3);
  key.position.set(12, 24, 18);
  key.target.position.set(0, 0, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 18, bottom: -9, near: 1, far: 80 });
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc6d4ff, 0.45);
  fill.position.set(-16, 14, -10);
  scene.add(fill);

  // ------------------------------------------------------------------ pitch
  // The canvas covers x -40..40 and z -30..60 at 25.6 px per metre.
  const PPM = 25.6;
  const pitchTex = canvasTexture(2048, 2304, (c, w, h) => {
    const P = (x, z) => [(x + 40) * PPM, (z + 30) * PPM];
    for (let z = -30, i = 0; z < 60; z += 5.5, i++) {
      c.fillStyle = i % 2 ? '#2b7536' : '#307f3b';
      const [, y0] = P(0, z);
      c.fillRect(0, y0, w, 5.5 * PPM + 1);
    }
    for (let i = 0; i < 26000; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.045)';
      c.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(2, 6));
    }
    c.strokeStyle = 'rgba(245,248,240,0.92)';
    c.lineWidth = 0.12 * PPM;
    const line = (pts) => { c.beginPath(); pts.forEach(([x, z], k) => { const [px, py] = P(x, z); k ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); };
    line([[-34, 0], [34, 0]]);
    line([[-34, 0], [-34, 60]]); line([[34, 0], [34, 60]]);
    line([[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]]);
    line([[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]]);
    // the "D": the part of a 9.15 m circle around the spot outside the box
    const [sx, sy] = P(0, SPOT_Z);
    const a = Math.acos(5.5 / 9.15);
    c.beginPath(); c.arc(sx, sy, 9.15 * PPM, Math.PI / 2 - a, Math.PI / 2 + a); c.stroke();
    c.fillStyle = 'rgba(245,248,240,0.95)';
    c.beginPath(); c.arc(sx, sy, 0.13 * PPM, 0, Math.PI * 2); c.fill();
  });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(80, 90),
    new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, 15);
  pitch.receiveShadow = true;
  scene.add(pitch);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: 0x173520, roughness: 1 }));
  surround.rotation.x = -Math.PI / 2; surround.position.y = -0.02;
  scene.add(surround);

  // ------------------------------------------------------------------ goal frame
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.1, transparent: true });
  function bar(a, b, r, mat) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 14), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    scene.add(m);
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  bar(V(-PX, 0, 0), V(-PX, BAR_Y + POST_R, 0), POST_R, white);
  bar(V(PX, 0, 0), V(PX, BAR_Y + POST_R, 0), POST_R, white);
  bar(V(-PX - POST_R, BAR_Y, 0), V(PX + POST_R, BAR_Y, 0), POST_R, white);
  const support = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.5, transparent: true });
  for (const s of [-1, 1]) {
    bar(V(s * PX, BAR_Y, 0), V(s * PX, GOAL_H, -NET_D1), 0.025, support);
    bar(V(s * PX, GOAL_H, -NET_D1), V(s * PX, 0.02, -NET_D0), 0.025, support);
  }
  bar(V(-PX, 0.02, -NET_D0), V(PX, 0.02, -NET_D0), 0.025, support);
  bar(V(-PX, GOAL_H, -NET_D1), V(PX, GOAL_H, -NET_D1), 0.025, support);

  // ------------------------------------------------------------------ net
  // Every knot of the net is a grid vertex; a goal pushes a bulge into it.
  const net = { base: [], segs: [], bulges: [] };
  function netGrid(nu, nv, fn) {
    const start = net.base.length;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) net.base.push(fn(i / nu, j / nv));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const k = start + j * (nu + 1) + i;
      if (i < nu) net.segs.push(k, k + 1);
      if (j < nv) net.segs.push(k, k + nu + 1);
    }
  }
  netGrid(40, 13, (u, v) => { const y = v * GOAL_H; return V(-HALF + u * 2 * HALF, y, -netDepth(y)); });
  netGrid(40, 6, (u, v) => V(-HALF + u * 2 * HALF, GOAL_H, -v * NET_D1));
  for (const s of [-1, 1]) netGrid(9, 13, (u, v) => { const y = v * GOAL_H; return V(s * HALF, y, -u * netDepth(y)); });
  net.geo = new THREE.BufferGeometry();
  net.pos = new Float32Array(net.segs.length * 3);
  net.geo.setAttribute('position', new THREE.BufferAttribute(net.pos, 3));
  net.cur = net.base.map((p) => p.clone());
  function writeNet() {
    for (let i = 0; i < net.segs.length; i++) {
      const p = net.cur[net.segs[i]];
      net.pos[i * 3] = p.x; net.pos[i * 3 + 1] = p.y; net.pos[i * 3 + 2] = p.z;
    }
    net.geo.attributes.position.needsUpdate = true;
  }
  writeNet();
  const netMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  scene.add(new THREE.LineSegments(net.geo,
    netMat));
  function bulgeNet(at, dir, strength) {
    net.bulges.push({ at: at.clone(), dir: dir.clone().normalize(), a: strength, t: 0 });
  }
  function updateNet(dt) {
    if (!net.bulges.length) return;
    net.bulges.forEach((b) => { b.t += dt; });
    net.bulges = net.bulges.filter((b) => b.t < 2.2);
    for (let k = 0; k < net.base.length; k++) {
      const p = net.cur[k].copy(net.base[k]);
      for (const b of net.bulges) {
        const amp = b.a * Math.exp(-b.t * 3.0) * Math.cos(b.t * 9);
        const d2 = p.distanceToSquared(b.at);
        p.addScaledVector(b.dir, amp * Math.exp(-d2 / 0.6));
      }
    }
    writeNet();
  }

  // ------------------------------------------------------------------ boards, stands, crowd, floodlights
  let boardTex;
  function drawBoard() {
    boardTex = canvasTexture(2048, 64, (c, w, h) => {
      c.fillStyle = '#0d1226'; c.fillRect(0, 0, w, h);
      c.font = `900 44px ${getComputedStyle(document.documentElement).getPropertyValue('--display')}`;
      c.textBaseline = 'middle';
      const words = ['PENALTY NIGHT', 'FIVE KICKS EACH', 'SUDDEN DEATH', 'NERVES OF STEEL'];
      let x = 20, i = 0;
      while (x < w) {
        c.fillStyle = i % 2 ? '#2fc6b4' : '#f2c230';
        const t = words[i % words.length] + '   ·   ';
        c.fillText(t, x, h / 2 + 2); x += c.measureText(t).width; i++;
      }
    });
    boardTex.wrapS = THREE.RepeatWrapping;
    boardTex.repeat.set(2, 1);
    boardMat.map = boardTex; boardMat.emissiveMap = boardTex; boardMat.needsUpdate = true;
  }
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6, transparent: true });
  const board = new THREE.Mesh(new THREE.BoxGeometry(40, 0.9, 0.12), boardMat);
  board.position.set(0, 0.45, -4.6);
  scene.add(board);
  drawBoard();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBoard);

  const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1f30, roughness: 0.9 });
  const crowdSpots = [];
  // All stand tiers are merged into one mesh: one draw call instead of fifty.
  const tierGeos = [];
  const addTier = (w, h, d, x, y, z) => tierGeos.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  for (let r = 0; r < 22; r++) {
    const z = -7.2 - r * 0.8, y = 0.7 + r * 0.45;
    addTier(76, y, 0.8, 0, y / 2, z);
    for (let x = -36; x < 36; x += 0.55) if (Math.random() > 0.1) crowdSpots.push({ x: x + rand(-0.1, 0.1), y, z: z + 0.1, rot: 0, side: x < 0 ? 'you' : 'cpu' });
  }
  for (const s of [-1, 1]) for (let r = 0; r < 14; r++) {
    const x = s * (38 + r * 0.8), y = 0.7 + r * 0.45;
    addTier(0.8, y, 62, x, y / 2, 22);
    for (let z = -8; z < 52; z += 0.6) if (Math.random() > 0.15) crowdSpots.push({ x: x - s * 0.1, y, z: z + rand(-0.1, 0.1), rot: -s * Math.PI / 2, side: 'mix' });
  }
  scene.add(new THREE.Mesh(BufferGeometryUtils.mergeBufferGeometries(tierGeos), standMat));
  tierGeos.forEach((g) => g.dispose());
  const crowd = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.44, 0.64),
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), crowdSpots.length);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  crowdSpots.forEach((p, i) => {
    p.phase = rand(0, Math.PI * 2);
    p.pick = (Math.random() * 60) | 0;
    p.shade = rand(0.22, 0.45);
    dummy.position.set(p.x, p.y + 0.32, p.z); dummy.rotation.set(0, p.rot, 0); dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
  });
  const lighten = (hex, t) => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), t).getHex();
  // Your fans wear gold; the other half of the stand wears the opponent's colour.
  function paintCrowd(cpuHex) {
    const you = [0xf2c230, 0xf2c230, 0xffe08a, 0x20232c, 0xeeeeee];
    const cpu = [cpuHex, cpuHex, lighten(cpuHex, 0.45), 0x20232c, 0xeeeeee];
    const mix = [0xf2c230, cpuHex, 0xd8d8d8, 0x3a3f55, 0xc0573d, 0x5577aa];
    crowdSpots.forEach((p, i) => {
      const pal = p.side === 'you' ? you : p.side === 'cpu' ? cpu : mix;
      crowd.setColorAt(i, tmpColor.setHex(pal[p.pick % pal.length]).multiplyScalar(p.shade));
    });
    crowd.instanceColor.needsUpdate = true;
  }
  paintCrowd(0x2fc6b4);
  scene.add(crowd);
  let cheer = { you: 0, cpu: 0 };
  function updateCrowd(time) {
    if (cheer.you < 0.01 && cheer.cpu < 0.01) return;
    crowdSpots.forEach((p, i) => {
      const amt = p.side === 'you' ? cheer.you : p.side === 'cpu' ? cheer.cpu : Math.max(cheer.you, cheer.cpu) * 0.6;
      const hop = Math.max(0, Math.sin(time * 11 + p.phase)) * 0.28 * amt;
      dummy.position.set(p.x, p.y + 0.32 + hop, p.z); dummy.rotation.set(0, p.rot, 0); dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
    });
    crowd.instanceMatrix.needsUpdate = true;
  }

  const glowTex = canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,250,225,1)'); g.addColorStop(0.25, 'rgba(255,236,170,0.5)'); g.addColorStop(1, 'rgba(255,236,170,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4052, roughness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c8, emissiveIntensity: 1.6 });
  const towers = [];   // each floodlight can be switched on separately for the title sequence
  for (const [x, z] of [[-44, -18], [44, -18], [-44, 34], [44, 34]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 32, 10), poleMat);
    pole.position.set(x, 16, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.5), lampMat.clone());
    head.position.set(x, 33, z); head.lookAt(0, 0, 8); scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.scale.set(26, 26, 1); glow.position.set(x, 33, z); scene.add(glow);
    towers.push({ head, glow, on: 1, shown: 1, flare: 0 });
  }
  // Lighting follows how many towers are on: dark stadium -> full floodlights.
  function updateTowers(dt) {
    let sum = 0;
    for (const t of towers) {
      const target = t.on;
      if (target > t.shown + 0.5) t.flare = 1;                 // the moment a tower bangs on
      t.shown = target;
      t.flare *= Math.exp(-dt * 3);
      t.head.material.emissiveIntensity = 0.04 + 1.56 * t.shown;
      t.glow.material.opacity = t.shown;
      t.glow.scale.setScalar(26 + t.flare * 40);
      sum += t.shown;
    }
    const f = sum / towers.length;
    key.intensity = 1.3 * f; fill.intensity = 0.45 * f; hemi.intensity = 0.16 + 0.39 * f;
    boardMat.emissiveIntensity = 0.12 + 0.43 * f;
  }

  // When you keep goal the camera looks out from behind the net, so the
  // net, its support bars and the ad board fade to keep the taker and the
  // ball clear. f: 0 = normal, 1 = fully faded.
  function setGoalFade(f) {
    netMat.opacity = 0.5 - 0.38 * f;
    support.opacity = 1 - 0.8 * f;
    boardMat.opacity = 1 - 0.85 * f;
    white.opacity = 1 - 0.65 * f;      // posts and crossbar stay faintly visible
    support.depthWrite = boardMat.depthWrite = white.depthWrite = f < 0.05;
  }

  return {
    setGoalFade,
    renderer, scene, camera, canvasTexture, glowTex, maxAniso,
    net, bulgeNet, updateNet,
    boardMat, drawBoard, getBoardTex: () => boardTex,
    crowd, crowdSpots, paintCrowd, updateCrowd, cheer, lighten,
    towers, updateTowers, dummy, tmpColor,
  };
}
