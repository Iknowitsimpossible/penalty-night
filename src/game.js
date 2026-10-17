import * as THREE from 'three';
import { readSwipe } from './input/swipe.js';
import { HALF, GOAL_H, POST_R, R, PX, BAR_Y, SPOT_Z, NET_D0, NET_D1, KEEPER_Z, REACH, RUNUP, netDepth } from './core/constants.js';
import { clamp, lerp } from './core/math.js';
import { createRng } from './core/random.js';
import { rand, gauss } from './core/visual-random.js';
import { createWorld } from './render/world.js';
import { createEffects, GOLD } from './render/effects.js';
import { makePerson, KITS, animateRunup, newKeeper, poseKeeper, hideKeeper, planDive, updateKeeper, keeperSpheres } from './render/people.js';
import { createBallState, launchVelocity, stepBall, predictCrossing } from './physics/ball.js';
import { createBallMesh } from './render/ball.js';
import { createAudio } from './audio/sfx.js';
import { shootoutWinner, goals } from './rules/shootout.js';
import { TEAMS, YOU, createCup, recordResult, standings, currentFixture, goalDifference, teamName } from './tournament/cup.js';

export function startGame() {
const $ = (id) => document.getElementById(id);

// Gameplay randomness is seedable (see core/random.js); visual randomness is not.
const rng = createRng();

const LEVELS = {
  amateur: { note: 'Slow keeper who guesses a lot. Their takers miss often.',
    react: 0.30, err: 0.85, shift: 1.45, gamble: 0.24, readSpin: 0, cpuErr: 0.62, reAim: 0.25 },
  pro: { note: 'Quick keeper who reads straight shots. Their takers are steady.',
    react: 0.21, err: 0.55, shift: 1.7, gamble: 0.2, readSpin: 0.5, cpuErr: 0.42, reAim: 0.5 },
  legend: { note: 'Reads curve and punishes slow kicks. Takers rarely miss.',
    react: 0.14, err: 0.32, shift: 1.95, gamble: 0.12, readSpin: 1, cpuErr: 0.3, reAim: 0.75 },
};

// ------------------------------------------------------------------ stadium (render/world.js)
const stage = $('stage');
const canvas = $('scene');
let world;
try {
  world = createWorld(canvas);
} catch (e) {
  $('fail').hidden = false; $('menu').hidden = true; return;
}
const { renderer, scene, camera, glowTex, net, updateNet, crowdSpots, paintCrowd, updateCrowd, cheer, lighten, towers, updateTowers, dummy, tmpColor } = world;
// Net bulges are recorded so a replay can show them again.
function bulgeNet(at, dir, strength, fromReplay) {
  if (rec && !fromReplay) rec.events.push({ t: rec.t, at: at.clone(), dir: dir.clone(), s: strength });
  world.bulgeNet(at, dir, strength);
}

// ------------------------------------------------------------------ celebration effects (render/effects.js)
let cpuPal = [0x2fc6b4, 0x9ff2e6, 0xffffff];   // confetti for the opponent's fans
const effects = createEffects(world, { behindGoal: () => camGoal === 'keeper', onFirework: () => sfx.pop() });
const { burstConfetti, updateConfetti, firework, updateFireworks, updateFlashes } = effects;

// ------------------------------------------------------------------ people (render/people.js)
const keepers = { cpu: makePerson(scene, KITS.cpuKeeper), you: makePerson(scene, KITS.youKeeper) };
const taker = makePerson(scene, KITS.cpuTaker);
const striker = makePerson(scene, KITS.youTaker);   // you: only seen in replays and celebrations
striker.root.visible = false;
let keeper = newKeeper(keepers.cpu);

// ------------------------------------------------------------------ ball (physics/ball.js, render/ball.js)
const ball = { ...createBallState(), mesh: createBallMesh(world) };
function placeBall() {
  ball.pos.set(0, R, SPOT_Z); ball.vel.set(0, 0, 0); ball.spin = 0; ball.moving = false;
  ball.mesh.position.copy(ball.pos);
}

function launch(target, T, spin) {
  launchVelocity(ball.pos, target, T, spin, ball.vel);
  ball.spin = spin;
  ball.moving = true;
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
        ball.vel.z = Math.max(ball.vel.z, rng.range(1.5, 4));
        ball.vel.x += rng.range(-1.5, 1.5);
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

// ------------------------------------------------------------------ audio (audio/sfx.js)
const audio = createAudio();
const sfx = audio.sfx;
const initAudio = audio.init;
$('mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  $('mute').textContent = audio.muted ? 'Sound off' : 'Sound on';
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
  $('scoreLine').textContent = `${goals(match.you)} – ${goals(match.cpu)}`;
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

const SWIPE_HINTS = {
  tap: 'Swipe up from the ball to shoot.',
  short: 'Swipe further up toward the goal.',
  down: 'Swipe up, toward the goal.',
};
function takeKick(pts) {
  const { kick, reason } = readSwipe(pts, stage.clientWidth, stage.clientHeight);
  if (!kick) { hint(SWIPE_HINTS[reason]); return; }
  shoot(kick);
}
// The coach stays until the first kick that actually counts.
function markCoached() {
  if (coached) return;
  coached = true; $('coach').hidden = true;
  try { localStorage.setItem('penaltyNight.coached', '1'); } catch (err) { /* storage unavailable */ }
}
function shoot(kick) {
  markCoached();
  const { aimX, aimY, T, spin } = kick;
  startRecording(true);
  launch(new THREE.Vector3(aimX, aimY, 0), T, spin);
  sfx.kick(kick.power);
  startShot();
  shot.intent = kick;
  // the keeper's move: either a gamble at the moment of the kick or a read after his reaction time
  if (rng.chance(level.gamble)) {
    keeper.pending = { at: 0.04, x: rng.sign() * rng.range(1.6, 3.2), y: rng.range(0.3, 1.9) };
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
  let side = rng.sign();
  if (match.early && keeper.dive && rng.chance(level.reAim)) side = -Math.sign(keeper.dive.toX || 1);
  let tx, ty;
  if (rng.chance(0.12)) { tx = rng.range(-0.6, 0.6); ty = rng.range(1.3, 2.1); }
  else { tx = side * rng.range(1.4, 3.45); ty = rng.range(0.15, 2.15); }
  tx += rng.gauss() * level.cpuErr; ty += rng.gauss() * level.cpuErr * 0.8;
  const T = rng.range(0.55, 0.8);
  launch(new THREE.Vector3(tx, Math.max(R, ty), 0), T, rng.range(-10, 10));
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
    at(0.15, () => { burstConfetti(-13, 6, -11, 10, 280, GOLD, 9); effects.setFlashRate(40); });
    at(0.35, () => firework(0xf2c230)); at(0.9, () => firework(0xffffff)); at(1.5, () => firework(0xf2c230));
    at(1.9, () => burstConfetti(-13, 6, -11, 10, 200, GOLD, 8));
    post.run = { body: striker, from: new THREE.Vector3(0.25, 0, 11.3), to: new THREE.Vector3(-8.6, 0, 1.4), start: 0.8, speed: 7, slide: true, arms: 'plane' };
  } else if (!mine && scored) {
    post.dur = 2.4;
    at(0.15, () => { burstConfetti(13, 6, -11, 9, 180, cpuPal, 8); effects.setFlashRate(18); });
    post.run = { body: taker, from: taker.root.position.clone(), to: new THREE.Vector3(7.5, 0, 2.6), start: 0.35, speed: 6.2, slide: false, arms: 'pump' };
  } else if (kind === 'saved') {
    post.dur = mine ? 2.0 : 2.6;
    post.cheerAt = 0.6;
    if (!mine) { at(0.2, () => { burstConfetti(-13, 6, -11, 10, 220, GOLD, 8); effects.setFlashRate(26); }); at(0.6, () => firework(0xf2c230)); }
    else at(0.2, () => { burstConfetti(13, 6, -11, 9, 120, cpuPal, 7); effects.setFlashRate(10); });
  } else if (!mine) {
    at(0.2, () => { burstConfetti(-13, 6, -11, 10, 120, GOLD, 7); effects.setFlashRate(12); });
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
  const gy = goals(match.you), gc = goals(match.cpu);
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
  hint(''); sfx.whistle(); if (w === 'you') { sfx.roar(true); party = true; effects.setFlashRate(40); }
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
// Rules and progression live in tournament/cup.js. This part saves the cup,
// turns a team's rating into keeper and taker skill, and draws the hub.
const LEVEL_KEYS = ['react', 'err', 'shift', 'gamble', 'readSpin', 'cpuErr', 'reAim'];
function paramsFor(r) {
  const [a, b, t] = r < 0.5 ? [LEVELS.amateur, LEVELS.pro, r / 0.5] : [LEVELS.pro, LEVELS.legend, (r - 0.5) / 0.5];
  const o = {};
  LEVEL_KEYS.forEach((k) => { o[k] = lerp(a[k], b[k], t); });
  return o;
}
let tour = loadCup();
function loadCup() {
  try {
    const t = JSON.parse(localStorage.getItem('penaltyNight.cup'));
    return t && t.table && t.A && t.B ? t : null;
  } catch (e) { return null; }
}
function saveCup() { try { localStorage.setItem('penaltyNight.cup', JSON.stringify(tour)); } catch (e) { /* storage unavailable */ } }
function newCup() {
  tour = createCup(rng);
  saveCup();
  party = false;
}
function playCupMatch() {
  const fx = currentFixture(tour);
  if (!fx) return;
  const t = TEAMS[fx.opp];
  startMatch({ mode: 'cup', name: t.name, code: t.code, color: t.color, params: paramsFor(t.rating), label: fx.label });
}
const nm = teamName;
// Records your result and moves the cup on. Returns one line for the end screen.
function cupAfterMatch(gy, gc) {
  const line = recordResult(tour, gy, gc, rng);
  if (tour.stage === 'champion') {
    try { localStorage.setItem('penaltyNight.cups', String((+localStorage.getItem('penaltyNight.cups') || 0) + 1)); } catch (e) { /* storage unavailable */ }
  }
  saveCup();
  return line;
}
function showHub() {
  if (!tour) newCup();
  $('end').hidden = true; $('menu').hidden = true; $('hud').hidden = true; $('hub').hidden = false;
  hint('');
  match.phase = 'menu'; camGoal = 'menu';
  party = tour.stage === 'champion';
  if (party) effects.setFlashRate(30);
  const sw = (i) => `<span class="sw" style="background:#${new THREE.Color(TEAMS[i].color).getHexString()}"></span>`;
  const stageName = { group: 'Group stage', semi: 'Semifinals', final: 'Final', champion: 'Champions', out: 'Knocked out' }[tour.stage];
  $('hubEyebrow').textContent = `The Night Cup · ${stageName}`;
  $('hubTitle').textContent = tour.stage === 'group' ? `Matchday ${tour.day + 1} of 3`
    : tour.stage === 'semi' ? 'Semifinal' : tour.stage === 'final' ? 'The Final'
    : tour.stage === 'champion' ? 'Champions!' : 'Knocked out';
  $('hubNews').textContent = tour.news;
  const fx = currentFixture(tour);
  $('hubFixture').hidden = !fx;
  if (fx) {
    const r = TEAMS[fx.opp].rating, stars = Math.max(1, Math.round(r * 5));
    $('hubFixture').innerHTML = `<div class="who"><small>${fx.label} · next match</small>${sw(fx.opp)}${nm(fx.opp)}</div>
      <div class="stars">Keeper <b>${'●'.repeat(stars)}${'○'.repeat(5 - stars)}</b></div>`;
  }
  const table = (title, group) => {
    const order = standings(tour, group);
    const rows = order.map((i, k) => {
      const t = tour.table[i];
      const gd = goalDifference(t);
      return `<tr class="${k < 2 ? 'through' : ''} ${i === YOU ? 'me' : ''}"><td>${sw(i)}${TEAMS[i].code}</td><td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${gd > 0 ? '+' + gd : gd}</td><td>${t.pts}</td></tr>`;
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
// Advance the whole game by dt seconds. Rendering happens separately, so
// tests can step the game at a fixed rate without a screen refresh.
function tick(dt) {
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
        const c = predictCrossing(ball, level.readSpin);
        planDive(keeper, c.x + rng.gauss() * level.err, clamp(c.y + rng.gauss() * level.err * 0.6, 0, 2.8));
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
  const boardTex = world.getBoardTex();
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
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tick(dt);
  renderer.render(scene, camera);
  drawTrail(dt);
  requestAnimationFrame(frame);
}

// Development-only handle for reproducible browser checks: step the game by
// exact amounts and read its state. Vite strips this from production builds.
if (import.meta.env.DEV) {
  window.__pn = {
    step(seconds, dt = 1 / 60) {
      for (let t = 0; t < seconds; t += dt) tick(dt);
      renderer.render(scene, camera);
    },
    seed(n) { Object.assign(rng, createRng(n)); },
    get state() {
      return {
        phase: match.phase, turn: match.turn, mode: match.mode, you: [...match.you], cpu: [...match.cpu],
        post: post && { kind: post.kind, t: post.t }, replay: !!replay, banner: $('bannerText').textContent,
        keeperDive: keeper.dive && { toX: keeper.dive.toX, t: keeper.dive.t }, ball: ball.pos.toArray(),
      };
    },
  };
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
