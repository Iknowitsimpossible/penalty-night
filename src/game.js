import * as THREE from 'three';
import { shootoutWinner } from './rules.js';
import { shotFromSwipe } from './shot.js';

export function startGame() {
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------
// Real-world units: metres and seconds. x = right, y = up, z = toward
// the penalty taker. The goal line is z = 0, the spot is z = 11.
// ------------------------------------------------------------------
const HALF = 3.66, GOAL_H = 2.44, POST_R = 0.06, R = 0.11;
const PX = HALF + POST_R, BAR_Y = GOAL_H + POST_R;
const SPOT_Z = 11, G = -9.81, MAGNUS = 0.022;
const NET_D0 = 2.0, NET_D1 = 1.0;          // net depth at the ground / at the roof
const KEEPER_Z = 0.35;
const REACH = 2.09;                          // feet to gloves with arms up

const LEVELS = {
  amateur: { note: 'Slow keeper who guesses a lot. Their takers miss often.',
    react: 0.30, err: 0.85, shift: 1.45, gamble: 0.24, readSpin: 0, cpuErr: 0.62, reAim: 0.25 },
  pro: { note: 'Quick keeper who reads straight shots. Their takers are steady.',
    react: 0.21, err: 0.55, shift: 1.7, gamble: 0.2, readSpin: 0.5, cpuErr: 0.42, reAim: 0.5 },
  legend: { note: 'Reads curve and punishes slow kicks. Takers rarely miss.',
    react: 0.14, err: 0.32, shift: 1.95, gamble: 0.12, readSpin: 1, cpuErr: 0.3, reAim: 0.75 },
};

// ------------------------------------------------------------------ renderer
const stage = $('stage');
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  $('fail').hidden = false; $('menu').hidden = true; return;
}
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
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

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
const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35, metalness: 0.1 });
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
const support = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.5 });
for (const s of [-1, 1]) {
  bar(V(s * PX, BAR_Y, 0), V(s * PX, GOAL_H, -NET_D1), 0.025, support);
  bar(V(s * PX, GOAL_H, -NET_D1), V(s * PX, 0.02, -NET_D0), 0.025, support);
}
bar(V(-PX, 0.02, -NET_D0), V(PX, 0.02, -NET_D0), 0.025, support);
bar(V(-PX, GOAL_H, -NET_D1), V(PX, GOAL_H, -NET_D1), 0.025, support);

// ------------------------------------------------------------------ net
// Every knot of the net is a grid vertex; a goal pushes a bulge into it.
const netDepth = (y) => NET_D0 - (NET_D0 - NET_D1) * (y / GOAL_H);
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
scene.add(new THREE.LineSegments(net.geo,
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })));
function bulgeNet(at, dir, strength, fromReplay) {
  if (rec && !fromReplay) rec.events.push({ t: rec.t, at: at.clone(), dir: dir.clone(), s: strength });
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
const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 });
const board = new THREE.Mesh(new THREE.BoxGeometry(40, 0.9, 0.12), boardMat);
board.position.set(0, 0.45, -4.6);
scene.add(board);
drawBoard();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBoard);

const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1f30, roughness: 0.9 });
const crowdSpots = [];
for (let r = 0; r < 22; r++) {
  const z = -7.2 - r * 0.8, y = 0.7 + r * 0.45;
  const tier = new THREE.Mesh(new THREE.BoxGeometry(76, y, 0.8), standMat);
  tier.position.set(0, y / 2, z); scene.add(tier);
  for (let x = -36; x < 36; x += 0.55) if (Math.random() > 0.1) crowdSpots.push({ x: x + rand(-0.1, 0.1), y, z: z + 0.1, rot: 0, side: x < 0 ? 'you' : 'cpu' });
}
for (const s of [-1, 1]) for (let r = 0; r < 14; r++) {
  const x = s * (38 + r * 0.8), y = 0.7 + r * 0.45;
  const tier = new THREE.Mesh(new THREE.BoxGeometry(0.8, y, 62), standMat);
  tier.position.set(x, y / 2, 22); scene.add(tier);
  for (let z = -8; z < 52; z += 0.6) if (Math.random() > 0.15) crowdSpots.push({ x: x - s * 0.1, y, z: z + rand(-0.1, 0.1), rot: -s * Math.PI / 2, side: 'mix' });
}
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

// ------------------------------------------------------------------ celebration effects
const GOLD = [0xf2c230, 0xffe08a, 0xffffff, 0xf6e7a8];
let cpuPal = [0x2fc6b4, 0x9ff2e6, 0xffffff];   // confetti for the opponent's fans

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
  const behind = camGoal === 'keeper';
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
  sfx.pop();
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

// Phone camera flashes popping in the stands.
const flashes = [];
for (let i = 0; i < 60; i++) {
  const spot = crowdSpots[(Math.random() * crowdSpots.length) | 0];
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sp.position.set(spot.x, spot.y + 0.7, spot.z + 0.15); sp.scale.set(1.1, 1.1, 1);
  scene.add(sp); flashes.push(sp);
}
let flashRate = 0;
function updateFlashes(dt) {
  flashRate *= Math.exp(-dt * 0.5);
  for (const f of flashes) {
    if (Math.random() < flashRate * dt / flashes.length * 6) f.material.opacity = 1;
    else f.material.opacity *= Math.exp(-dt * 16);
  }
}

// ------------------------------------------------------------------ people
function makePerson(kit) {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
  const shirt = mat(kit.shirt), shorts = mat(kit.shorts), socks = mat(kit.socks), skin = mat(0xc98d68), boot = mat(0x111111), hand = mat(kit.gloves || 0xc98d68);
  const root = new THREE.Group();
  const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const hips = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, 0.9, 0); root.add(hip);
    add(hip, new THREE.CylinderGeometry(0.085, 0.075, 0.34, 10), shorts, 0, -0.17, 0);
    add(hip, new THREE.CylinderGeometry(0.068, 0.055, 0.5, 10), socks, 0, -0.6, 0);
    add(hip, new THREE.BoxGeometry(0.11, 0.07, 0.24), boot, 0, -0.86, -0.05);
    hips.push(hip);
  }
  add(root, new THREE.BoxGeometry(0.42, 0.22, 0.26), shorts, 0, 0.92, 0);
  add(root, new THREE.BoxGeometry(0.44, 0.58, 0.25), shirt, 0, 1.25, 0);
  add(root, new THREE.SphereGeometry(0.12, 16, 12), skin, 0, 1.68, 0);
  add(root, new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d16), 0, 1.7, 0);
  const shoulders = [], gloves = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.27, 1.45, 0); root.add(sh);
    add(sh, new THREE.CylinderGeometry(0.058, 0.05, 0.62, 10), shirt, 0, 0.31, 0);
    gloves.push(add(sh, new THREE.SphereGeometry(kit.gloves ? 0.088 : 0.05, 12, 10), hand, 0, 0.66, 0));
    shoulders.push(sh);
  }
  root.rotation.order = 'YXZ';   // turn first, then lean, so a lean is always forward/back for the body
  scene.add(root);
  return { root, hips, shoulders, gloves, shirt, mats: { shirt, shorts, socks } };
}

const KITS = {
  cpuKeeper: { shirt: 0x1fb59f, shorts: 0x0f2d2a, socks: 0x1fb59f, gloves: 0xf4f4f4 },
  youKeeper: { shirt: 0xf2c230, shorts: 0x15161b, socks: 0x15161b, gloves: 0xf4f4f4 },
  cpuTaker: { shirt: 0x1fb59f, shorts: 0xf1f1f1, socks: 0x1fb59f },
  youTaker: { shirt: 0xf2c230, shorts: 0x15161b, socks: 0xf2c230 },
};
const keepers = { cpu: makePerson(KITS.cpuKeeper), you: makePerson(KITS.youKeeper) };
const taker = makePerson(KITS.cpuTaker);
const striker = makePerson(KITS.youTaker);   // you: only seen in replays and celebrations
striker.root.visible = false;

// Run-up shared by the CPU taker and by your striker in replays: 1.05 s from
// the edge of the D to the ball, then the kicking leg swings through.
const RUNUP = 1.05;
function animateRunup(b, timer) {
  const p = Math.min(timer / RUNUP, 1);
  b.root.position.set(lerp(-1.8, -0.42, p), 0, lerp(13.6, 11.45, p));
  b.root.rotation.set(0, 0.35 * (1 - p), 0);
  const run = Math.sin(timer * 14);
  b.hips[0].rotation.set(run * 0.7, 0, 0); b.hips[1].rotation.set(-run * 0.7, 0, 0);
  b.shoulders[0].rotation.set(-run * 0.5, 0, Math.PI - 0.15); b.shoulders[1].rotation.set(run * 0.5, 0, -Math.PI + 0.15);
  if (p >= 1) { b.hips[0].rotation.x = -0.3; b.hips[1].rotation.x = 1.2; }
}

// Keeper state: feet position, body tilt (radians, + leans to +x), arm raise 0..1.
function newKeeper(body) {
  return { body, x: 0, y: 0, z: KEEPER_Z, tilt: 0, arms: 0, dive: null, active: false, maxShift: 1.8 };
}
let keeper = newKeeper(keepers.cpu);
const READY = 2.35;           // shoulder angle with arms out and down
function poseKeeper(k) {
  const b = k.body;
  b.root.position.set(k.x, k.y, k.z);
  b.root.rotation.set(0, 0, -k.tilt);
  b.shoulders[0].rotation.z = lerp(READY, 0.25, k.arms);
  b.shoulders[1].rotation.z = -lerp(READY, 0.25, k.arms);
  b.hips[0].rotation.z = -0.12 * (1 - k.arms * 0.5);
  b.hips[1].rotation.z = 0.12 * (1 - k.arms * 0.5);
  b.root.updateMatrixWorld(true);
}
function hideKeeper(body) { body.root.visible = false; }

// Plan a dive so the gloves arrive at (tx, ty). The whole body tilts
// around the feet, like a real keeper pushing off one leg.
function planDive(k, tx, ty) {
  const side = Math.sign(tx - k.x) || 1;
  const lateral = Math.abs(tx - k.x);
  let tilt, toX, toY;
  if (lateral < 0.75) {
    tilt = side * lateral * 0.35;
    toX = k.x + (tx - k.x) * 0.6;
    toY = clamp(ty - REACH, 0, 0.55);
  } else {
    const h = clamp(ty / GOAL_H, 0, 1.15);
    tilt = side * lerp(1.35, 0.6, Math.min(h, 1));
    toY = clamp(ty - REACH * Math.cos(tilt), 0, 0.5);
    toX = tx - side * REACH * Math.sin(Math.abs(tilt));
  }
  const shift = toX - k.x;
  if (Math.abs(shift) > k.maxShift) toX = k.x + Math.sign(shift) * k.maxShift;
  k.dive = { t: 0, dur: 0.38 + 0.08 * Math.min(lateral, 3) / 3, fromX: k.x, fromY: k.y, fromTilt: k.tilt, toX, toY, tilt, side, landed: false };
}
function updateKeeper(k, dt, time) {
  if (!k.active) return;
  if (k.cheer) {
    const c = (k.cheer.t += dt);
    k.tilt = lerp(k.tilt, 0, 1 - Math.exp(-dt * 6));
    k.x = lerp(k.x, k.cheer.x, 1 - Math.exp(-dt * 3));
    k.y = c > 0.45 ? Math.abs(Math.sin((c - 0.45) * 7)) * 0.36 : lerp(k.y, 0, 1 - Math.exp(-dt * 8));
    k.arms = 1;
    poseKeeper(k);
    k.body.shoulders[0].rotation.z = 0.55 + Math.sin(c * 14) * 0.3;
    k.body.shoulders[1].rotation.z = -0.12;
    k.body.root.updateMatrixWorld(true);
    return;
  }
  const d = k.dive;
  if (!d) {
    k.x = lerp(k.x, 0.2 * Math.sin(time * 2.3), 1 - Math.exp(-dt * 6));
    k.y = Math.max(0, Math.sin(time * 4.6)) * 0.03;
    k.arms = lerp(k.arms, 0, 1 - Math.exp(-dt * 8));
  } else {
    d.t += dt;
    const p = Math.min(d.t / d.dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    k.x = lerp(d.fromX, d.toX, e);
    k.tilt = lerp(d.fromTilt, d.tilt, e);
    k.y = lerp(d.fromY, d.toY, e) + Math.sin(p * Math.PI) * (Math.abs(d.tilt) > 0.5 ? 0.22 : 0.1);
    k.arms = Math.min(1, p * 2.2);
    if (d.t > d.dur + 0.3 && Math.abs(d.tilt) > 0.5) {
      const q = Math.min((d.t - d.dur - 0.3) / 0.35, 1);
      k.tilt = lerp(d.tilt, d.side * 1.48, q);
      k.y = lerp(d.toY, 0.16, q);
    }
  }
  poseKeeper(k);
}
// Spheres that stand in for the keeper's body and gloves, for collisions.
const _v = new THREE.Vector3();
const bodyPoints = [[0, 0.3, 0.17], [0, 0.7, 0.19], [0, 1.1, 0.21], [0, 1.42, 0.2], [0, 1.68, 0.14]];
const spheres = Array.from({ length: 7 }, () => ({ c: new THREE.Vector3(), r: 0 }));
function keeperSpheres(k) {
  const root = k.body.root;
  bodyPoints.forEach(([x, y, r], i) => { spheres[i].c.set(x, y, 0); root.localToWorld(spheres[i].c); spheres[i].r = r; });
  k.body.gloves.forEach((g, i) => { g.getWorldPosition(spheres[5 + i].c); spheres[5 + i].r = 0.14; });
  return spheres;
}

// ------------------------------------------------------------------ ball
const ballTex = canvasTexture(512, 256, (c, w, h) => {
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
const ball = {
  mesh: new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.42 })),
  pos: new THREE.Vector3(0, R, SPOT_Z), vel: new THREE.Vector3(), spin: 0, moving: false,
};
ball.mesh.castShadow = true;
scene.add(ball.mesh);
function placeBall() {
  ball.pos.set(0, R, SPOT_Z); ball.vel.set(0, 0, 0); ball.spin = 0; ball.moving = false;
  ball.mesh.position.copy(ball.pos);
}

// Solve the kick so the ball reaches target after T seconds, including
// the sideways push of its spin, so a curled shot still finds its target.
function launch(target, T, spin) {
  const d = new THREE.Vector3().subVectors(target, ball.pos);
  const ax = MAGNUS * spin * (d.z / T);
  ball.vel.set((d.x - 0.5 * ax * T * T) / T, (d.y - 0.5 * G * T * T) / T, d.z / T);
  ball.spin = spin;
  ball.moving = true;
}

// One physics step for any ball-like state (also used by the keeper to predict).
function stepBall(b, h) {
  b.vel.y += G * h;
  b.vel.x += MAGNUS * b.spin * b.vel.z * h;
  b.vel.z += -MAGNUS * b.spin * b.vel.x * h;
  b.pos.addScaledVector(b.vel, h);
  b.spin *= 1 - 0.12 * h;
  if (b.pos.y < R) {
    b.pos.y = R;
    if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.5;
    if (b.vel.y < 0.35) b.vel.y = 0;
    b.vel.x *= 1 - 0.6 * h; b.vel.z *= 1 - 0.6 * h; b.spin *= 1 - 2 * h;
  }
}
function predictCrossing(readSpin) {
  const b = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin * readSpin };
  for (let i = 0; i < 400 && b.pos.z > KEEPER_Z; i++) stepBall(b, 1 / 120);
  return b.pos;
}

// ------------------------------------------------------------------ collisions
const _cp = new THREE.Vector3(), _n = new THREE.Vector3();
function bounceOff(cp, radius, restitution) {
  _n.subVectors(ball.pos, cp);
  const dist = _n.length();
  if (dist >= R + radius || dist === 0) return false;
  _n.divideScalar(dist);
  const vn = ball.vel.dot(_n);
  if (vn < 0) ball.vel.addScaledVector(_n, -(1 + restitution) * vn);
  ball.pos.copy(cp).addScaledVector(_n, R + radius);
  return true;
}
function collide(h) {
  const p = ball.pos;
  for (const s of [-1, 1]) {
    if (bounceOff(_cp.set(s * PX, clamp(p.y, 0, BAR_Y), 0), POST_R, 0.6)) hitFrame();
  }
  if (bounceOff(_cp.set(clamp(p.x, -PX, PX), BAR_Y, 0), POST_R, 0.6)) hitFrame();

  if (keeper.active && shot && shot.cool <= 0 && p.z < 1.6 && p.z > -0.4) {
    for (const s of keeperSpheres(keeper)) {
      if (bounceOff(s.c, s.r, 0.3)) {
        ball.vel.z = Math.max(ball.vel.z, rand(1.5, 4));
        ball.vel.x += rand(-1.5, 1.5);
        ball.spin *= 0.2;
        shot.touched = true; shot.cool = 0.1;
        sfx.save();
        break;
      }
    }
  }
  // crossing the goal line
  if (shot && !shot.crossed && shot.prevZ >= 0 && p.z < 0) {
    shot.crossed = true;
    if (Math.abs(p.x) < HALF && p.y < GOAL_H) { shot.goal = true; shot.goalY = p.y; }
    else shot.outside = { x: p.x, y: p.y };
  }
  if (shot) shot.prevZ = p.z;
  // the net catches a goal
  if (shot && shot.goal && p.z < 0) {
    const depth = netDepth(clamp(p.y, 0, GOAL_H));
    if (p.z < -depth + R) {
      if (!shot.netHit) { shot.netHit = true; bulgeNet(p, ball.vel, clamp(ball.vel.length() * 0.035, 0.12, 0.6)); sfx.net(); }
      p.z = -depth + R; ball.vel.multiplyScalar(0.12); ball.vel.z = Math.abs(ball.vel.z) * 0.3;
    }
    if (Math.abs(p.x) > HALF - R) { p.x = Math.sign(p.x) * (HALF - R); ball.vel.x *= -0.2; }
    if (p.y > GOAL_H - R) { p.y = GOAL_H - R; ball.vel.y = -Math.abs(ball.vel.y) * 0.2; }
  }
  // advertising boards behind the goal
  if (p.z < -4.6 + 0.06 + R && p.y < 0.9 + R && ball.vel.z < 0) { ball.vel.z = -ball.vel.z * 0.35; ball.vel.x *= 0.6; }
}
function hitFrame() {
  if (shot && shot.cool <= 0) { shot.post = true; shot.cool = 0.08; sfx.post(); }
}

// ------------------------------------------------------------------ audio (all synthesized, nothing to download)
let ac = null, master = null, crowdGain = null, noiseBuf = null, muted = false;
function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
    crowdGain = ac.createGain(); crowdGain.gain.value = 0.05;
    src.connect(bp); bp.connect(crowdGain); crowdGain.connect(master); src.start();
  } catch (e) { ac = null; }
}
function noise(dur, freq, q, gain, type) {
  if (!ac) return;
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); const t = ac.currentTime;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}
function tone(type, f0, f1, dur, gain, delay) {
  if (!ac) return;
  const t = ac.currentTime + (delay || 0);
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function swell(level, hold) {
  if (!crowdGain) return;
  const t = ac.currentTime, g = crowdGain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(level, t + 0.25); g.linearRampToValueAtTime(level * 0.8, t + 0.25 + hold);
  g.linearRampToValueAtTime(0.05, t + 1.2 + hold);
}
const sfx = {
  kick(p) { tone('sine', 150, 42, 0.16, 0.9 * p + 0.2); noise(0.05, 2400, 0.8, 0.35); },
  post() { tone('triangle', 960, 900, 0.7, 0.25); tone('triangle', 1430, 1400, 0.5, 0.15); },
  net() { noise(0.4, 2800, 0.7, 0.35); },
  save() { tone('sine', 110, 60, 0.12, 0.6); noise(0.08, 900, 0.9, 0.4); },
  whistle() { for (let i = 0; i < 3; i++) tone('sine', 2850, 2950, 0.12, 0.12, i * 0.04); },
  roar(big) { swell(big ? 0.5 : 0.28, big ? 1.4 : 0.6); },
  groan() { swell(0.16, 0.4); noise(1.2, 300, 0.5, 0.12, 'lowpass'); },
  pop() { noise(0.5, 380, 0.6, 0.28, 'lowpass'); noise(0.9, 4200, 0.5, 0.05); },
};
$('mute').addEventListener('click', () => {
  muted = !muted;
  $('mute').textContent = muted ? 'Sound off' : 'Sound on';
  if (master) master.gain.value = muted ? 0 : 0.9;
});

// ------------------------------------------------------------------ match
const match = { level: 'pro', you: [], cpu: [], turn: 'you', phase: 'menu', early: false, timer: 0 };
let shot = null;
let level = LEVELS.pro;

function winner() {
  return shootoutWinner(match.you, match.cpu);
}

function renderHud() {
  const fillDots = (el, arr) => {
    const n = Math.max(5, arr.length + (arr.length >= 5 ? 1 : 0));
    el.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const li = document.createElement('li');
      if (i < arr.length) li.className = arr[i] ? 'goal' : 'miss';
      el.appendChild(li);
    }
  };
  fillDots($('dotsYou'), match.you);
  fillDots($('dotsCpu'), match.cpu);
  $('scoreLine').textContent = `${match.you.filter(Boolean).length} – ${match.cpu.filter(Boolean).length}`;
  const round = match.you.length === match.cpu.length ? match.you.length + 1 : match.you.length;
  $('round').textContent = (match.stageLabel ? match.stageLabel + ' · ' : '') + (round <= 5 ? `Round ${round} of 5` : `Sudden death · kick ${round - 5}`);
}

let bannerTimer = 0;
function banner(text, sub, tone, holdMs) {
  const el = $('banner');
  $('bannerText').textContent = text; $('bannerSub').textContent = sub || '';
  el.className = tone; void el.offsetWidth; el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('bannerText').textContent = ''; $('bannerSub').textContent = ''; }, holdMs || 1700);
}
const hint = (t) => { $('hint').textContent = t; };

// The opponent decides how good their keeper and takers are, their kit,
// and the colour of their half of the crowd.
function quickOpponent() {
  return { mode: 'quick', name: 'CPU', code: 'CPU', color: 0x2fc6b4, params: LEVELS[match.level], label: '' };
}
function dressOpponent(o) {
  const col = new THREE.Color(o.color);
  taker.mats.shirt.color.copy(col); taker.mats.socks.color.copy(col);
  taker.mats.shorts.color.setHex(o.color === 0xf0f0f0 ? 0x1b2340 : 0xf1f1f1);
  const gk = col.clone().lerp(new THREE.Color(0x0b0d14), 0.45);
  keepers.cpu.mats.shirt.color.copy(gk); keepers.cpu.mats.socks.color.copy(gk);
  paintCrowd(o.color);
  cpuPal = [o.color, lighten(o.color, 0.5), 0xffffff];
  stage.style.setProperty('--cpu', '#' + col.getHexString());
  $('cpuTag').textContent = o.code;
}
function startMatch(o) {
  intro = null; towers.forEach((tw) => { tw.on = 1; });
  match.mode = o.mode; match.opp = o; match.stageLabel = o.label;
  level = o.params;
  dressOpponent(o);
  $('hub').hidden = true;
  party = false; post = null; replay = null; rec = null; endReplayLook();
  match.you = []; match.cpu = [];
  $('menu').hidden = true; $('end').hidden = true; $('hud').hidden = false;
  sfx.whistle();
  nextTurn();
}

function nextTurn() {
  const w = winner();
  if (w) return endMatch(w);
  renderHud();
  if (match.you.length === match.cpu.length) setupYourKick(); else setupCpuKick();
}

function setupYourKick() {
  match.turn = 'you'; match.phase = 'aim'; shot = null;
  placeBall();
  hideKeeper(keepers.you); keepers.cpu.root.visible = true;
  keeper = newKeeper(keepers.cpu); keeper.active = true; keeper.maxShift = level.shift;
  taker.root.visible = false; striker.root.visible = false;
  camGoal = 'shoot';
  const round = match.you.length + 1;
  banner(round <= 5 ? 'Your kick' : 'Sudden death', round <= 5 ? `Kick ${round} of 5` : 'Score and they must answer', 'info', 1100);
  hint('Swipe up from the ball. Curve the swipe to bend it.');
  if (!coached) $('coach').hidden = false;
}

function setupCpuKick() {
  match.turn = 'cpu'; match.phase = 'runup'; match.early = false; match.timer = 0; shot = null;
  placeBall();
  hideKeeper(keepers.cpu); keepers.you.root.visible = true;
  keeper = newKeeper(keepers.you); keeper.active = true; keeper.maxShift = 1.85;
  taker.root.visible = true; striker.root.visible = false;
  animateRunup(taker, 0);
  startRecording(false);
  camGoal = 'keeper';
  banner('Save it', 'Tap where you want to dive', 'info', 1000);
  hint('Tap a spot in the goal to dive there.');
}

// ---------------- your kick: read the swipe
const trail = $('trail');
const tctx = trail.getContext('2d');
let swipe = null, trailFade = 0;
function stagePoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
}
let coached = false;
try { coached = localStorage.getItem('penaltyNight.coached') === '1'; } catch (e) { /* storage unavailable */ }
function trySkip() {
  if (post && (replay || post.t > 0.5)) { finishPost(); return true; }
  return !!post;
}
document.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') && post) { e.preventDefault(); trySkip(); }
});
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (trySkip()) return;
  if (match.phase === 'aim') {
    if (!coached) { coached = true; $('coach').hidden = true; try { localStorage.setItem('penaltyNight.coached', '1'); } catch (err) { /* storage unavailable */ } }
    const p = stagePoint(e);
    if (p.y < stage.clientHeight * 0.3) return;
    swipe = [p]; trailFade = 1;
    canvas.setPointerCapture(e.pointerId);
  } else if ((match.phase === 'runup' || match.phase === 'flight') && match.turn === 'cpu' && !keeper.dive) {
    playerDive(e);
  }
});
canvas.addEventListener('pointermove', (e) => { if (swipe) swipe.push(stagePoint(e)); });
canvas.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  swipe.push(stagePoint(e));
  const pts = swipe; swipe = null;
  takeKick(pts);
});
canvas.addEventListener('pointercancel', () => { swipe = null; });

function takeKick(pts) {
  const kick = shotFromSwipe(pts, stage.clientHeight);
  if (!kick) { hint('Swipe further up toward the goal.'); return; }
  const { aimX, aimY, T, spin } = kick;
  startRecording(true);
  launch(new THREE.Vector3(aimX, aimY, 0), T, spin);
  sfx.kick(clamp(1.1 - T, 0, 1));
  startShot();
  // the keeper's move: either a gamble at the moment of the kick or a read after his reaction time
  if (Math.random() < level.gamble) {
    keeper.pending = { at: 0.04, x: Math.sign(Math.random() - 0.5) * rand(1.6, 3.2), y: rand(0.3, 1.9) };
  } else keeper.pending = { at: level.react, read: true };
  hint('');
}

function startShot() {
  match.phase = 'flight';
  shot = { t: 0, touched: false, post: false, goal: false, crossed: false, outside: null, prevZ: ball.pos.z, cool: 0, done: false, after: 0 };
}

// ---------------- their kick: you dive
const raycaster = new THREE.Raycaster();
function playerDive(e) {
  const r = stage.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin: o, direction: d } = raycaster.ray;
  if (Math.abs(d.z) < 1e-4) return;
  const t = (KEEPER_Z - o.z) / d.z;
  if (t <= 0) return;
  planDive(keeper, clamp(o.x + d.x * t, -4.6, 4.6), clamp(o.y + d.y * t, 0, 2.9));
  if (match.phase === 'runup') match.early = true;
  hint('');
}

function cpuShoot() {
  let side = Math.random() < 0.5 ? -1 : 1;
  if (match.early && keeper.dive && Math.random() < level.reAim) side = -Math.sign(keeper.dive.toX || 1);
  let tx, ty;
  if (Math.random() < 0.12) { tx = rand(-0.6, 0.6); ty = rand(1.3, 2.1); }
  else { tx = side * rand(1.4, 3.45); ty = rand(0.15, 2.15); }
  tx += gauss() * level.cpuErr; ty += gauss() * level.cpuErr * 0.8;
  const T = rand(0.55, 0.8);
  launch(new THREE.Vector3(tx, Math.max(R, ty), 0), T, rand(-10, 10));
  sfx.kick(0.7);
  startShot();
}

// ---------------- deciding the result
const LINES = {
  goal: ['No chance for the keeper.', 'Ice in the veins.', 'Sent him the wrong way.', 'Calm as you like.'],
  top: ['Top bins.', 'Right under the bar.', 'Postage stamp.'],
  low: ['Low and hard.', 'Rolled it into the corner.', 'Through the grass.'],
  saved: ['He got a hand to it.', 'Read it all the way.', 'Kept out at full stretch.'],
};
const pick = (a) => a[(Math.random() * a.length) | 0];
function judge() {
  const s = shot, v = ball.vel, p = ball.pos;
  if (s.goal) return 'goal';
  if (s.outside) return s.post ? 'post' : s.outside.y >= GOAL_H ? 'over' : 'wide';
  if (s.touched && ((v.z > 0.4 && p.z > 0.9) || v.length() < 0.8)) return 'saved';
  if (s.post && v.z > 0.3 && p.z > 0.8) return 'post';
  if (s.t > 3.2 || (v.length() < 0.25 && p.y <= R + 0.001)) return s.touched ? 'saved' : s.post ? 'post' : 'short';
  return null;
}
function resolve(kind) {
  shot.done = true; shot.after = 0;
  const mine = match.turn === 'you';
  const scored = kind === 'goal';
  (mine ? match.you : match.cpu).push(scored);
  renderHud();
  const missText = { over: 'Over the bar', wide: 'Wide', post: 'Off the post', short: 'Too soft' }[kind];
  if (mine) {
    if (scored) { banner('Goal!', pick(shot.goalY > 1.7 ? LINES.top : shot.goalY < 0.5 ? LINES.low : LINES.goal), 'good'); sfx.roar(true); cheer.you = 1; }
    else if (kind === 'saved') { banner('Saved', pick(LINES.saved), 'bad'); sfx.groan(); cheer.cpu = 0.7; }
    else { banner(missText, 'The crowd groans.', 'bad'); sfx.groan(); }
  } else {
    if (scored) { banner('They score', 'Shake it off. Next kick.', 'bad'); sfx.groan(); cheer.cpu = 1; }
    else if (kind === 'saved') { banner('What a save!', 'You read that perfectly.', 'good'); sfx.roar(true); cheer.you = 1; }
    else { banner(missText + '!', 'They cracked under pressure.', 'good'); sfx.roar(false); cheer.you = 0.6; }
  }
  startCelebration(kind, mine, scored);
}

// ------------------------------------------------------------------ celebrations
// After every kick: a short celebration, then (for your goals and your
// saves) a slow-motion replay from a side camera. Tap or press space to skip.
let post = null, party = false;
function startCelebration(kind, mine, scored) {
  post = { t: 0, kind, mine, scored, fx: [], run: null, cheerAt: -1,
    replay: (mine && scored) || (!mine && kind === 'saved'), dur: 1.9 };
  const at = (time, fn) => post.fx.push({ time, fn });
  if (mine && scored) {
    post.dur = 3.6;
    at(0.15, () => { burstConfetti(-13, 6, -11, 10, 280, GOLD, 9); flashRate = 40; });
    at(0.35, () => firework(0xf2c230)); at(0.9, () => firework(0xffffff)); at(1.5, () => firework(0xf2c230));
    at(1.9, () => burstConfetti(-13, 6, -11, 10, 200, GOLD, 8));
    post.run = { body: striker, from: new THREE.Vector3(0.25, 0, 11.3), to: new THREE.Vector3(-8.6, 0, 1.4), start: 0.8, speed: 7, slide: true, arms: 'plane' };
  } else if (!mine && scored) {
    post.dur = 2.4;
    at(0.15, () => { burstConfetti(13, 6, -11, 9, 180, cpuPal, 8); flashRate = 18; });
    post.run = { body: taker, from: taker.root.position.clone(), to: new THREE.Vector3(7.5, 0, 2.6), start: 0.35, speed: 6.2, slide: false, arms: 'pump' };
  } else if (kind === 'saved') {
    post.dur = mine ? 2.0 : 2.6;
    post.cheerAt = 0.6;
    if (!mine) { at(0.2, () => { burstConfetti(-13, 6, -11, 10, 220, GOLD, 8); flashRate = 26; }); at(0.6, () => firework(0xf2c230)); }
    else at(0.2, () => { burstConfetti(13, 6, -11, 9, 120, cpuPal, 7); flashRate = 10; });
  } else if (!mine) {
    at(0.2, () => { burstConfetti(-13, 6, -11, 10, 120, GOLD, 7); flashRate = 12; });
  }
}
function updatePost(dt) {
  if (replay) { updateReplay(dt); return; }
  post.t += dt;
  post.fx = post.fx.filter((f) => { if (post.t >= f.time) { f.fn(); return false; } return true; });
  if (post.cheerAt >= 0 && post.t >= post.cheerAt && !keeper.cheer) keeper.cheer = { t: 0, x: clamp(keeper.x, -2.6, 2.6) };
  if (post.run && post.t >= post.run.start) runCelebration(post.run, dt);
  if (post.t > 0.5) $('skipTag').hidden = false;
  if (post.t >= post.dur) {
    if (post.replay && rec && rec.frames.length > 20) startReplay(); else finishPost();
  }
}
// A player runs toward their fans: arms out like a plane (and a knee slide),
// or one fist pumping.
function runCelebration(r, dt) {
  const b = r.body;
  if (!r.pos) {
    r.pos = r.from.clone(); r.v = 0; r.phase = 0; r.t = 0;
    b.root.visible = true; b.root.position.copy(r.pos);
    if (b === striker) camGoal = 'celebrate';
  }
  r.t += dt;
  const dx = r.to.x - r.pos.x, dz = r.to.z - r.pos.z, dist = Math.hypot(dx, dz);
  if (r.slide && dist < 2.6) r.sliding = true;
  r.v = r.sliding ? r.v * Math.exp(-dt * 2.4) : Math.min(r.speed, r.v + 16 * dt);
  if (dist > 0.05) {
    const step = Math.min(dist, r.v * dt);
    r.pos.x += dx / dist * step; r.pos.z += dz / dist * step;
    r.face = Math.atan2(-dx, -dz);
  }
  r.phase += r.v * dt * 2.3;
  const run = Math.sin(r.phase);
  const root = b.root;
  if (r.sliding) {
    root.position.set(r.pos.x, lerp(root.position.y, -0.44, 1 - Math.exp(-dt * 10)), r.pos.z);
    root.rotation.set(lerp(root.rotation.x, 0.5, 1 - Math.exp(-dt * 6)), r.face, 0);
    b.hips.forEach((h) => { h.rotation.x = lerp(h.rotation.x, 0, 1 - Math.exp(-dt * 8)); });
    b.shoulders[0].rotation.set(0, 0, 0.75); b.shoulders[1].rotation.set(0, 0, -0.75);
  } else if (dist <= 0.05) {
    root.position.set(r.pos.x, Math.abs(Math.sin(r.t * 7)) * 0.32, r.pos.z);
    b.shoulders[0].rotation.set(0, 0, 0.35 + Math.sin(r.t * 14) * 0.25); b.shoulders[1].rotation.set(0, 0, -0.35);
  } else {
    root.position.set(r.pos.x, Math.abs(run) * 0.06, r.pos.z);
    root.rotation.set(0.12, r.face, 0);
    b.hips[0].rotation.set(run * 0.8, 0, 0); b.hips[1].rotation.set(-run * 0.8, 0, 0);
    if (r.arms === 'plane') { b.shoulders[0].rotation.set(0, 0, Math.PI / 2 - 0.1); b.shoulders[1].rotation.set(0, 0, -Math.PI / 2 + 0.1); }
    else { b.shoulders[0].rotation.set(0, 0, 0.25 + Math.sin(r.t * 12) * 0.2); b.shoulders[1].rotation.set(-run * 0.6, 0, -Math.PI + 0.2); }
  }
}
function finishPost() {
  endReplayLook();
  post = null; replay = null; rec = null; shot = null;
  keeper.cheer = null;
  striker.root.visible = false;
  nextTurn();
}

// ------------------------------------------------------------------ replays
// While a kick is live, every frame stores where the ball, keeper and taker
// are. A replay plays those frames back at half speed from a side camera.
let rec = null, replay = null;
function startRecording(mine) {
  rec = { mine, frames: [], events: [], t: 0, body: keeper.body, taker: mine ? striker : taker };
  if (mine) {
    // You are never seen running up while aiming, so the replay adds that run-up in front.
    for (let t = 0; t < RUNUP; t += 1 / 60) {
      rec.frames.push({ t, b: [0, R, SPOT_Z], q: ball.mesh.quaternion.clone(), k: [keeper.x, keeper.y, keeper.tilt, keeper.arms], tk: t });
    }
    rec.t = RUNUP;
  }
}
function recordFrame(sdt) {
  rec.t += sdt;
  const tk = !rec.mine && match.phase === 'runup' ? match.timer : RUNUP + 0.01;
  rec.frames.push({ t: rec.t, b: [ball.pos.x, ball.pos.y, ball.pos.z], q: ball.mesh.quaternion.clone(), k: [keeper.x, keeper.y, keeper.tilt, keeper.arms], tk });
  if (rec.frames.length > 900) rec.frames.shift();
}
function startReplay() {
  const fr = rec.frames;
  const lastF = fr[fr.length - 1];
  replay = { t: fr[0].t, end: lastF.t, i: 0, ev: 0, side: Math.sign(lastF.b[0]) || 1 };
  ball.moving = false;
  net.bulges = [];
  keeper.cheer = null;
  striker.root.visible = rec.mine; taker.root.visible = !rec.mine;
  rec.taker.root.position.y = 0;
  stage.classList.add('replaying');
  $('replayTag').hidden = false; $('skipTag').hidden = false; $('skipTag').classList.remove('low');
  camGoal = 'replay';
  updateReplay(0);
  camPos.copy(wantPos); camLook.copy(wantLook);
}
function updateReplay(dt) {
  replay.t += dt * 0.5;
  const fr = rec.frames;
  while (replay.i < fr.length - 1 && fr[replay.i + 1].t <= replay.t) replay.i++;
  const a = fr[replay.i], b = fr[Math.min(replay.i + 1, fr.length - 1)];
  const u = b.t > a.t ? clamp((replay.t - a.t) / (b.t - a.t), 0, 1) : 0;
  ball.pos.set(lerp(a.b[0], b.b[0], u), lerp(a.b[1], b.b[1], u), lerp(a.b[2], b.b[2], u));
  ball.mesh.position.copy(ball.pos);
  ball.mesh.quaternion.copy(a.q).slerp(b.q, u);
  keeper.x = lerp(a.k[0], b.k[0], u); keeper.y = lerp(a.k[1], b.k[1], u);
  keeper.tilt = lerp(a.k[2], b.k[2], u); keeper.arms = lerp(a.k[3], b.k[3], u);
  poseKeeper(keeper);
  animateRunup(rec.taker, lerp(a.tk, b.tk, u));
  while (replay.ev < rec.events.length && rec.events[replay.ev].t <= replay.t) {
    const e = rec.events[replay.ev++];
    bulgeNet(e.at, e.dir, e.s, true);
  }
  // low side camera on the side the ball went, following the ball
  wantPos.set(replay.side * 8.2, 1.2, lerp(6.5, 3.2, clamp((SPOT_Z - ball.pos.z) / SPOT_Z, 0, 1)));
  wantLook.set(ball.pos.x * 0.8, Math.max(0.7, ball.pos.y), ball.pos.z);
  if (replay.t >= replay.end + 0.4) finishPost();
}
function endReplayLook() {
  stage.classList.remove('replaying');
  $('replayTag').hidden = true; $('skipTag').hidden = true; $('skipTag').classList.add('low');
}

function endMatch(w) {
  match.phase = 'end';
  const gy = match.you.filter(Boolean).length, gc = match.cpu.filter(Boolean).length;
  const sd = match.you.length > 5;
  $('endEyebrow').textContent = sd ? 'Decided in sudden death' : 'Full time';
  $('endTitle').textContent = w === 'you' ? 'You win' : (match.mode === 'cup' ? `${match.opp.name} win` : 'They win');
  $('endScore').textContent = `${gy} – ${gc}`;
  if (match.mode === 'cup') {
    $('endNote').textContent = cupAfterMatch(gy, gc);
    $('again').textContent = 'Continue'; $('toMenu').hidden = true;
  } else {
    $('endNote').textContent = w === 'you'
      ? (match.level === 'legend' ? 'You beat a Legend. That is the hardest win in the game.' : 'Ready for a tougher keeper?')
      : 'Mix up your corners, and try a curved swipe to fool the keeper.';
    $('again').textContent = 'Play again'; $('toMenu').hidden = false;
    const record = loadRecord(); record[w === 'you' ? 'w' : 'l']++; saveRecord(record);
  }
  hint(''); sfx.whistle(); if (w === 'you') { sfx.roar(true); party = true; flashRate = 40; }
  setTimeout(() => { $('end').hidden = false; $('hud').hidden = true; }, 900);
}

function loadRecord() {
  try { return JSON.parse(localStorage.getItem('penaltyNight.record')) || { w: 0, l: 0 }; } catch (e) { return { w: 0, l: 0 }; }
}
function saveRecord(r) { try { localStorage.setItem('penaltyNight.record', JSON.stringify(r)); } catch (e) { /* storage unavailable */ } }
function showRecord() {
  const live = tour && tour.stage !== 'champion' && tour.stage !== 'out';
  $('tourLabel').textContent = live ? 'Continue cup' : 'Night Cup';
  $('tourStatus').textContent = !live ? '8 teams · knockout'
    : tour.stage === 'group' ? `Matchday ${tour.day + 1} of 3`
    : tour.stage === 'semi' ? 'Semifinal next' : 'The final is next';
  const r = loadRecord();
  let cups = 0; try { cups = +localStorage.getItem('penaltyNight.cups') || 0; } catch (e) { /* storage unavailable */ }
  $('record').textContent = r.w + r.l || cups
    ? `${r.w}W · ${r.l}L${cups ? ` · ${cups} cup${cups > 1 ? 's' : ''}` : ''}`
    : '';
}

// ------------------------------------------------------------------ the Night Cup
// Eight teams, two groups of four, every match a shootout. Three points for
// a win; ties in the table go to goal difference, then goals scored.
// The top two of each group meet in the semifinals: A1 v B2 and B1 v A2.
const CUP = [
  { name: 'You', code: 'YOU', color: 0xf2c230, rating: 0.5 },
  { name: 'Lakeside Athletic', code: 'LAK', color: 0x3b82f6, rating: 0.2 },
  { name: 'Northgate Rovers', code: 'NOR', color: 0xd94a4a, rating: 0.32 },
  { name: 'Harbor City', code: 'HAR', color: 0x2fc6b4, rating: 0.44 },
  { name: 'Ironvale', code: 'IRV', color: 0x9aa3b5, rating: 0.55 },
  { name: 'Redwood United', code: 'RED', color: 0xe07b39, rating: 0.64 },
  { name: 'Port Azure', code: 'AZU', color: 0x8b6cff, rating: 0.78 },
  { name: 'Kingsbridge', code: 'KIN', color: 0xf0f0f0, rating: 0.92 },
];
// Matchday pairings inside a group of four (positions 0-3). You are always
// position 0, and your group is drawn weakest first, so the cup gets harder.
const DAYS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const LEVEL_KEYS = ['react', 'err', 'shift', 'gamble', 'readSpin', 'cpuErr', 'reAim'];
function paramsFor(r) {
  const [a, b, t] = r < 0.5 ? [LEVELS.amateur, LEVELS.pro, r / 0.5] : [LEVELS.pro, LEVELS.legend, (r - 0.5) / 0.5];
  const o = {};
  LEVEL_KEYS.forEach((k) => { o[k] = lerp(a[k], b[k], t); });
  return o;
}
let tour = loadCup();
function loadCup() { try { return JSON.parse(localStorage.getItem('penaltyNight.cup')); } catch (e) { return null; } }
function saveCup() { try { localStorage.setItem('penaltyNight.cup', JSON.stringify(tour)); } catch (e) { /* storage unavailable */ } }
function newCup() {
  const take = (arr) => arr.splice((Math.random() * arr.length) | 0, 1)[0];
  const top = [6, 7], upper = [4, 5], lower = [2, 3];
  const A = [0, take(lower), take(upper), take(top)];
  const B = [1, lower[0], upper[0], top[0]];
  const table = {};
  for (let i = 0; i < CUP.length; i++) table[i] = { p: 0, w: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  tour = { A, B, table, day: 0, stage: 'group', semis: null, final: null, ko: [], news: 'Eight teams, two groups. Win your group games and the top two go through to the semifinals.' };
  saveCup();
  party = false;
}
// A shootout between two computer teams: the better side scores more often.
function simShootout(a, b) {
  const ra = CUP[a].rating, rb = CUP[b].rating;
  const pa = clamp(0.74 + 0.22 * (ra - rb), 0.5, 0.93), pb = clamp(0.74 + 0.22 * (rb - ra), 0.5, 0.93);
  let ga = 0, gb = 0;
  for (let i = 0; i < 5; i++) { ga += Math.random() < pa; gb += Math.random() < pb; }
  while (ga === gb) { ga += Math.random() < pa; gb += Math.random() < pb; }
  return [ga, gb];
}
function addGroupResult(a, b, ga, gb) {
  const ta = tour.table[a], tb = tour.table[b];
  ta.p++; tb.p++; ta.gf += ga; ta.ga += gb; tb.gf += gb; tb.ga += ga;
  if (ga > gb) { ta.w++; tb.l++; ta.pts += 3; } else { tb.w++; ta.l++; tb.pts += 3; }
}
function standings(group) {
  return group.slice().sort((x, y) => {
    const a = tour.table[x], b = tour.table[y];
    return (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf) || (CUP[y].rating - CUP[x].rating);
  });
}
function cupFixture() {
  if (tour.stage === 'group') return { opp: tour.A[DAYS[tour.day][0][1]], label: `Group A · Matchday ${tour.day + 1}` };
  if (tour.stage === 'semi') { const tie = tour.semis.find((t) => t.includes(0)); return { opp: tie[0] === 0 ? tie[1] : tie[0], label: 'Semifinal' }; }
  if (tour.stage === 'final') return { opp: tour.final[0] === 0 ? tour.final[1] : tour.final[0], label: 'Final' };
  return null;
}
function playCupMatch() {
  const fx = cupFixture();
  if (!fx) return;
  const t = CUP[fx.opp];
  startMatch({ mode: 'cup', name: t.name, code: t.code, color: t.color, params: paramsFor(t.rating), label: fx.label });
}
const nm = (i) => CUP[i].name;
// Records your result, plays the other matches of the round, and moves the cup on.
// Returns one line for the end-of-match screen.
function cupAfterMatch(gy, gc) {
  const fx = cupFixture();
  const opp = fx.opp, won = gy > gc;
  const others = [];
  if (tour.stage === 'group') {
    addGroupResult(0, opp, gy, gc);
    const [c, d] = DAYS[tour.day][1].map((k) => tour.A[k]);
    const [gcA, gdA] = simShootout(c, d); addGroupResult(c, d, gcA, gdA); others.push(`${nm(c)} ${gcA}–${gdA} ${nm(d)}`);
    for (const [x, y] of DAYS[tour.day].map((pr) => pr.map((k) => tour.B[k]))) {
      const [gx, gyB] = simShootout(x, y); addGroupResult(x, y, gx, gyB); others.push(`${nm(x)} ${gx}–${gyB} ${nm(y)}`);
    }
    tour.day++;
    if (tour.day === 3) {
      const a = standings(tour.A), b = standings(tour.B);
      tour.semis = [[a[0], b[1]], [b[0], a[1]]];
      tour.stage = a.slice(0, 2).includes(0) ? 'semi' : 'out';
      tour.news = tour.stage === 'semi'
        ? `Through to the semifinals as group ${a[0] === 0 ? 'winners' : 'runners-up'}. Elsewhere: ${others.join(', ')}.`
        : `Out in the group stage, finishing ${['first', 'second', 'third', 'fourth'][a.indexOf(0)]}. Elsewhere: ${others.join(', ')}.`;
      if (tour.stage === 'out') finishCupForOthers();
    } else {
      tour.news = `${won ? 'Three points.' : 'A defeat, but the group is still open.'} Elsewhere: ${others.join(', ')}.`;
    }
  } else if (tour.stage === 'semi') {
    tour.ko.push({ round: 'Semifinal', a: 0, b: opp, ga: gy, gb: gc });
    const other = tour.semis.find((t) => !t.includes(0));
    const [g1, g2] = simShootout(other[0], other[1]);
    tour.ko.push({ round: 'Semifinal', a: other[0], b: other[1], ga: g1, gb: g2 });
    const otherWinner = g1 > g2 ? other[0] : other[1];
    if (won) { tour.final = [0, otherWinner]; tour.stage = 'final'; tour.news = `Into the final! ${nm(otherWinner)} are waiting after beating ${nm(g1 > g2 ? other[1] : other[0])} ${Math.max(g1, g2)}–${Math.min(g1, g2)}.`; }
    else { tour.stage = 'out'; tour.news = `Knocked out in the semifinal by ${nm(opp)}.`; finishCupForOthers(opp, otherWinner); }
  } else if (tour.stage === 'final') {
    tour.ko.push({ round: 'Final', a: 0, b: opp, ga: gy, gb: gc });
    tour.stage = won ? 'champion' : 'out';
    tour.news = won ? 'Champions of the Night Cup.' : `Beaten in the final by ${nm(opp)}. So close.`;
    if (won) { try { localStorage.setItem('penaltyNight.cups', String((+localStorage.getItem('penaltyNight.cups') || 0) + 1)); } catch (e) { /* storage unavailable */ } }
  }
  saveCup();
  if (tour.stage === 'champion') return 'You won the Night Cup!';
  if (tour.stage === 'out' || tour.stage === 'final') return tour.news;
  return won ? 'On to the next one. Continue to see the table.' : 'Continue to see where that leaves you.';
}
// Once you are out, the rest of the cup is played so the hub can show a champion.
function finishCupForOthers(semiWinnerA, semiWinnerB) {
  let w1 = semiWinnerA, w2 = semiWinnerB;
  if (w1 === undefined) {
    const [s1, s2] = tour.semis;
    const [a1, b1] = simShootout(s1[0], s1[1]); tour.ko.push({ round: 'Semifinal', a: s1[0], b: s1[1], ga: a1, gb: b1 });
    const [a2, b2] = simShootout(s2[0], s2[1]); tour.ko.push({ round: 'Semifinal', a: s2[0], b: s2[1], ga: a2, gb: b2 });
    w1 = a1 > b1 ? s1[0] : s1[1]; w2 = a2 > b2 ? s2[0] : s2[1];
  }
  const [f1, f2] = simShootout(w1, w2);
  tour.ko.push({ round: 'Final', a: w1, b: w2, ga: f1, gb: f2 });
  tour.final = [w1, w2];
  tour.news += ` ${nm(f1 > f2 ? w1 : w2)} won the cup.`;
}
function showHub() {
  if (!tour) newCup();
  $('end').hidden = true; $('menu').hidden = true; $('hud').hidden = true; $('hub').hidden = false;
  hint('');
  match.phase = 'menu'; camGoal = 'menu';
  party = tour.stage === 'champion';
  if (party) flashRate = 30;
  const sw = (i) => `<span class="sw" style="background:#${new THREE.Color(CUP[i].color).getHexString()}"></span>`;
  const stageName = { group: 'Group stage', semi: 'Semifinals', final: 'Final', champion: 'Champions', out: 'Knocked out' }[tour.stage];
  $('hubEyebrow').textContent = `The Night Cup · ${stageName}`;
  $('hubTitle').textContent = tour.stage === 'group' ? `Matchday ${tour.day + 1} of 3`
    : tour.stage === 'semi' ? 'Semifinal' : tour.stage === 'final' ? 'The Final'
    : tour.stage === 'champion' ? 'Champions!' : 'Knocked out';
  $('hubNews').textContent = tour.news;
  const fx = cupFixture();
  $('hubFixture').hidden = !fx;
  if (fx) {
    const r = CUP[fx.opp].rating, stars = Math.max(1, Math.round(r * 5));
    $('hubFixture').innerHTML = `<div class="who"><small>${fx.label} · next match</small>${sw(fx.opp)}${nm(fx.opp)}</div>
      <div class="stars">Keeper <b>${'●'.repeat(stars)}${'○'.repeat(5 - stars)}</b></div>`;
  }
  const table = (title, group) => {
    const order = standings(group);
    const rows = order.map((i, k) => {
      const t = tour.table[i];
      const gd = t.gf - t.ga;
      return `<tr class="${k < 2 ? 'through' : ''} ${i === 0 ? 'me' : ''}"><td>${sw(i)}${CUP[i].code}</td><td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${gd > 0 ? '+' + gd : gd}</td><td>${t.pts}</td></tr>`;
    }).join('');
    return `<div><table class="cup-table"><caption>${title}</caption><thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  $('hubTables').innerHTML = table('Group A', tour.A) + table('Group B', tour.B);
  const ko = $('hubKo');
  ko.hidden = !tour.semis;
  if (tour.semis) {
    const played = (a, b) => tour.ko.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
    const line = (round, a, b) => {
      const m = played(a, b);
      const score = m ? (m.a === a ? `${m.ga}–${m.gb}` : `${m.gb}–${m.ga}`) : 'to play';
      return `<div class="tie"><span><span class="rnd">${round}</span>${sw(a)}${nm(a)} v ${sw(b)}${nm(b)}</span><b>${score}</b></div>`;
    };
    let html = '<div class="lbl">Knockout</div>' + tour.semis.map((t) => line('Semifinal', t[0], t[1])).join('');
    if (tour.final) html += line('Final', tour.final[0], tour.final[1]);
    ko.innerHTML = html;
  }
  const done = tour.stage === 'champion' || tour.stage === 'out';
  $('hubPlay').hidden = done;
  $('hubRestart').textContent = done ? 'Play the cup again' : 'Start a new cup';
  $('hubRestart').className = done ? 'go' : 'ghost';
}

// ---------------- menus
function setLevel(name) {
  match.level = name;
  document.querySelectorAll('#levels button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === name)));
  $('levelNote').textContent = { amateur: 'Easy keeper', pro: 'Sharp keeper', legend: 'Elite keeper' }[name];
}
document.querySelectorAll('#levels button').forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level)));
$('kickoff').addEventListener('click', () => { initAudio(); startMatch(quickOpponent()); });
$('again').addEventListener('click', () => {
  initAudio();
  if (match.mode === 'cup') showHub(); else startMatch(quickOpponent());
});
$('tourBtn').addEventListener('click', () => { initAudio(); if (!tour || tour.stage === 'champion' || tour.stage === 'out') newCup(); showHub(); });
$('hubPlay').addEventListener('click', () => { initAudio(); playCupMatch(); });
$('hubMenu').addEventListener('click', () => { $('hub').hidden = true; party = false; showPicker(); });
$('hubRestart').addEventListener('click', () => { newCup(); showHub(); });
$('toMenu').addEventListener('click', () => { $('end').hidden = true; match.phase = 'menu'; party = false; showPicker(); });

// ---------------- title: lights on, camera sweep, tap to play
let intro = null;
function startIntro() {
  $('menu').hidden = false; $('attract').hidden = false; $('picker').hidden = true;
  $('logo').classList.remove('show'); $('tapToPlay').classList.remove('show');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  intro = { t: reduce ? 9 : 0 };
  towers.forEach((tw) => { tw.on = reduce ? 1 : 0; });
  camGoal = 'intro';
}
function showPicker() {
  intro = null;
  towers.forEach((tw) => { tw.on = 1; });
  $('menu').hidden = false; $('attract').hidden = true; $('picker').hidden = false;
  if (camGoal !== 'pick') camGoal = 'pick';
  showRecord();
}
$('attract').addEventListener('click', () => {
  initAudio(); sfx.roar(false);
  showPicker();
});
setLevel('pro');
showRecord();

// ------------------------------------------------------------------ camera
let camGoal = 'menu', baseFov = 50;
const camPos = new THREE.Vector3(-3.5, 2.1, 16.7), camLook = new THREE.Vector3(-4.2, 1.6, 0);
const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
function updateCamera(dt, time) {
  if (camGoal === 'intro' && intro) {
    // from high above the far end, sweeping down to a low angle on the goal
    const p = clamp(intro.t / 4.4, 0, 1), e = p * p * (3 - 2 * p);
    const a = lerp(0.9, -0.42, e), r = lerp(70, 22.5, e);
    camPos.set(Math.sin(a) * r, lerp(40, 4.2, e), Math.cos(a) * r);
    camLook.set(0, lerp(0, 1.4, e), lerp(14, 0, e));
    wantPos.copy(camPos); wantLook.copy(camLook);
    if (p >= 1) { intro.orbit = intro.orbit || 0; intro.orbit += dt; }
    if (intro.orbit !== undefined) {
      const o = -0.42 + Math.sin(intro.orbit * 0.12) * 0.5;
      camPos.set(Math.sin(o) * 22.5, 4.2 + Math.sin(intro.orbit * 0.2) * 0.4, Math.cos(o) * 22.5);
      wantPos.copy(camPos);
    }
    camera.position.copy(camPos); camera.lookAt(camLook);
    return;
  } else if (camGoal === 'pick') {
    const a = time * 0.25;
    wantPos.set(Math.sin(a) * 0.25, 1.32, 15.6); wantLook.set(Math.sin(a * 0.8) * 0.3, 1.25, 0);
  } else if (camGoal === 'menu') {
    // a slow drift that keeps the floodlit goal on the right, clear of the title
    const a = time * 0.12;
    wantPos.set(-3.5 + Math.sin(a) * 1.5, 2.1 + Math.sin(a * 0.7) * 0.3, 15.5 + Math.cos(a) * 1.2);
    wantLook.set(-4.2 + Math.sin(a) * 0.8, 1.6, 0);
  } else if (camGoal === 'shoot') {
    if (match.phase === 'flight' && shot) {
      wantPos.set(ball.pos.x * 0.3, 1.4, Math.max(ball.pos.z + 5, 6.2)); wantLook.set(ball.pos.x * 0.5, 1.1, 0);
    } else { wantPos.set(0, 1.45, 14.7); wantLook.set(0, 1.15, 0); }
  } else if (camGoal === 'celebrate' && post && post.run && post.run.pos) {
    // behind and beside the scorer, looking past him at his fans
    const r = post.run, dx = r.to.x - r.from.x, dz = r.to.z - r.from.z, L = Math.hypot(dx, dz);
    const fx = dx / L, fz = dz / L;
    wantPos.set(r.pos.x - fx * 4 - fz * 2.4, 1.9, r.pos.z - fz * 4 + fx * 2.4);
    wantLook.set(r.pos.x + fx * 2.5, 1.0, r.pos.z + fz * 2.5);
  } else if (camGoal === 'replay') {
    // wantPos / wantLook are set by updateReplay
  } else if (camGoal === 'keeper') {
    wantPos.set(0, 3.5, -6.4); wantLook.set(0, 0.7, 10);
  }
  const rate = camGoal === 'menu' ? 1.5 : camGoal === 'pick' ? 1.8 : camGoal === 'replay' ? 6 : camGoal === 'celebrate' ? 4 : 3.2;
  const k = 1 - Math.exp(-dt * rate);
  camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
  const fov = camGoal === 'replay' ? baseFov * 0.66 : baseFov;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 5)); camera.updateProjectionMatrix(); }
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = w / h < 1 ? clamp(50 / (w / h) * 0.72, 50, 78) : 50;
  camera.fov = camGoal === 'replay' ? baseFov * 0.66 : baseFov;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  trail.width = w * dpr; trail.height = h * dpr;
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ main loop
let last = performance.now(), time = 0, timeScale = 1;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  time += dt;

  // slow motion when the ball meets the keeper
  let slow = false;
  if (shot && !shot.done && ball.pos.z < 2.6 && ball.pos.z > -0.4 && keeper.active) {
    const g = keeperSpheres(keeper);
    slow = Math.min(g[5].c.distanceTo(ball.pos), g[6].c.distanceTo(ball.pos)) < 1.4;
  }
  timeScale = lerp(timeScale, slow ? 0.33 : 1, 1 - Math.exp(-dt * 10));
  const sdt = dt * timeScale;

  if (match.phase === 'runup') {
    match.timer += sdt;
    animateRunup(taker, match.timer);
    if (match.timer >= RUNUP) cpuShoot();
  }

  if (keeper.pending && shot) {
    keeper.pending.at -= sdt;
    if (keeper.pending.at <= 0) {
      const pd = keeper.pending; keeper.pending = null;
      if (pd.read) {
        const c = predictCrossing(level.readSpin);
        planDive(keeper, c.x + gauss() * level.err, clamp(c.y + gauss() * level.err * 0.6, 0, 2.8));
      } else planDive(keeper, pd.x, pd.y);
    }
  }
  if (!replay) updateKeeper(keeper, sdt, time);

  if (ball.moving) {
    const steps = Math.max(1, Math.ceil(sdt / (1 / 240)));
    const h = sdt / steps;
    for (let i = 0; i < steps; i++) {
      stepBall(ball, h);
      if (shot) shot.cool -= h;
      collide(h);
    }
    ball.mesh.position.copy(ball.pos);
    ball.mesh.rotation.y += ball.spin * sdt;
    ball.mesh.rotation.x -= (ball.vel.z / R) * sdt * 0.15;
  }

  if (shot && !replay) {
    shot.t += sdt;
    if (!shot.done) { const k = judge(); if (k) resolve(k); }
  }
  if (rec && !replay && (match.phase === 'runup' || match.phase === 'flight') && (!post || post.t < 0.7)) recordFrame(sdt);
  if (post) updatePost(dt);

  if (party && Math.random() < dt * 1.6) firework(Math.random() < 0.5 ? 0xf2c230 : 0xffffff);
  if (party && Math.random() < dt * 0.6) burstConfetti(-13, 6, -11, 12, 120, GOLD, 8);
  updateConfetti(dt, time);
  updateFireworks(dt);
  updateFlashes(dt);
  updateNet(replay ? dt * 0.5 : sdt);
  cheer.you *= Math.exp(-dt * 0.7); cheer.cpu *= Math.exp(-dt * 0.7);
  updateCrowd(time);
  if (boardTex) boardTex.offset.x = (time * 0.025) % 1;

  if (intro) {
    intro.t += dt;
    towers.forEach((tw, i) => {
      const at = 0.6 + i * 0.42;
      tw.on = intro.t < at ? 0 : intro.t < at + 0.22 ? (Math.random() < 0.55 ? 1 : 0.15) : 1;
    });
    if (intro.t > 2.5) $('logo').classList.add('show');
    if (intro.t > 3.6) $('tapToPlay').classList.add('show');
  }
  updateTowers(dt);
  updateCamera(dt, time);
  renderer.render(scene, camera);
  drawTrail(dt);
  requestAnimationFrame(frame);
}

function drawTrail(dt) {
  const w = stage.clientWidth, h = stage.clientHeight;
  tctx.clearRect(0, 0, w, h);
  const pts = swipe || lastTrail;
  if (swipe) lastTrail = swipe; else trailFade = Math.max(0, trailFade - dt * 2.5);
  if (!pts || pts.length < 2 || trailFade <= 0) return;
  tctx.lineCap = 'round'; tctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = i / pts.length;
    tctx.strokeStyle = `rgba(246,231,168,${0.85 * a * trailFade})`;
    tctx.lineWidth = 2 + 7 * a;
    tctx.beginPath(); tctx.moveTo(pts[i - 1].x, pts[i - 1].y); tctx.lineTo(pts[i].x, pts[i].y); tctx.stroke();
  }
}
let lastTrail = null;

// opening scene: both keepers hidden, the CPU keeper waiting on his line
hideKeeper(keepers.you); taker.root.visible = false;
keeper.active = true; poseKeeper(keeper);
placeBall();
startIntro();
requestAnimationFrame(frame);
}
