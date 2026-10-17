import * as THREE from 'three';
import { readSwipe, keyboardKick } from './input/swipe.js';
import { HALF, GOAL_H, POST_R, R, PX, BAR_Y, SPOT_Z, NET_D0, NET_D1, KEEPER_Z, REACH, RUNUP, COMMIT, netDepth } from './core/constants.js';
import { clamp, lerp } from './core/math.js';
import { createRng } from './core/random.js';
import { rand, gauss } from './core/visual-random.js';
import { createWorld } from './render/world.js';
import { createEffects, GOLD } from './render/effects.js';
import { makePerson, KITS, animateRunup, newKeeper, poseKeeper, hideKeeper, planDive, updateKeeper, keeperSpheres } from './render/people.js';
import { createBallState, launchVelocity, stepBall, predictCrossing } from './physics/ball.js';
import { createBallMesh, createBallTracking } from './render/ball.js';
import { createCameraDirector } from './render/camera.js';
import { createAudio } from './audio/sfx.js';
import { shootoutWinner, goals } from './rules/shootout.js';
import { planShot, reconsider, executeShot } from './ai/taker.js';
import { keeperPlan, readDive } from './ai/keeper.js';
import { STYLE_KEYS, styleOf } from './ai/styles.js';
import { explainKick, explainSave } from './feedback/explain.js';
import { LESSONS, checkLesson } from './practice/lessons.js';
import { createFeedbackCard } from './ui/feedback-card.js';
import { createSettingsPanel } from './ui/settings-panel.js';
import { loadSettings, saveSettings, shouldAutoReplay, celebrationLength, reducedMotion } from './ui/settings.js';
import { TEAMS, YOU, createCup, recordResult, standings, currentFixture, goalDifference, teamName } from './tournament/cup.js';

export function startGame() {
const $ = (id) => document.getElementById(id);

// Gameplay randomness is seedable (see core/random.js); visual randomness is not.
const rng = createRng();
// localStorage can throw (private windows, blocked storage); fall back to memory.
const storage = (() => {
  try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  }
})();
const settings = loadSettings(storage);
const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let motionReduced = false;

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
const effects = createEffects(world, { behindGoal: () => cam.goal === 'keeper', onFirework: () => sfx.pop() });
const { updateConfetti, updateFireworks, updateFlashes } = effects;
// With reduced motion: no confetti, fireworks or camera flashes.
const burstConfetti = (...args) => { if (!motionReduced) effects.burstConfetti(...args); };
const firework = (color) => { if (!motionReduced) effects.firework(color); };
const flash = (rate) => effects.setFlashRate(motionReduced ? 0 : rate);

function applyMotion() {
  motionReduced = reducedMotion(settings, motionQuery && motionQuery.matches);
  stage.classList.toggle('reduce-motion', motionReduced);
}
if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', applyMotion);
applyMotion();

// ------------------------------------------------------------------ people (render/people.js)
const keepers = { cpu: makePerson(scene, KITS.cpuKeeper), you: makePerson(scene, KITS.youKeeper) };
const taker = makePerson(scene, KITS.cpuTaker);
const striker = makePerson(scene, KITS.youTaker);   // you: only seen in replays and celebrations
striker.root.visible = false;
let keeper = newKeeper(keepers.cpu);

// ------------------------------------------------------------------ ball (physics/ball.js, render/ball.js)
const ball = { ...createBallState(), mesh: createBallMesh(world) };
const ballTracking = createBallTracking(world);
let goalFade = 0;
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
        if (!shot.touchAt) shot.touchAt = { x: p.x, y: p.y };
        shot.touched = true; shot.cool = 0.1;
        sfx.save();
        break;
      }
    }
  }
  // crossing the goal line
  if (shot && !shot.crossed && shot.prevZ >= 0 && p.z < 0) {
    shot.crossed = true;
    shot.lineAt = { x: p.x, y: p.y };
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
  if (shot && shot.cool <= 0) { if (!shot.postAt) shot.postAt = { x: ball.pos.x, y: ball.pos.y }; shot.post = true; shot.cool = 0.08; sfx.post(); }
}

// ------------------------------------------------------------------ audio (audio/sfx.js)
const audio = createAudio();
const sfx = audio.sfx;
const initAudio = audio.init;
function applySound() {
  audio.setMuted(!settings.sound);
  $('mute').textContent = settings.sound ? 'Sound on' : 'Sound off';
}
$('mute').addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveSettings(storage, settings);
  applySound();
  settingsPanel.sync();
});
applySound();

// ------------------------------------------------------------------ match
const match = { level: 'pro', you: [], cpu: [], turn: 'you', phase: 'menu', timer: 0, plan: null, dive: null, committed: false };
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
function clearBanner() {
  clearTimeout(bannerTimer);
  $('bannerText').textContent = ''; $('bannerSub').textContent = '';
}

// The opponent decides how good their keeper and takers are, their kit,
// and the colour of their half of the crowd.
// A quick match draws a random playing style so every match has habits to spot.
function quickOpponent() {
  return { mode: 'quick', name: 'CPU', code: 'CPU', color: 0x2fc6b4, params: LEVELS[match.level], label: '', style: rng.pick(STYLE_KEYS) };
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
  const practicing = o.mode === 'practice';
  $('menu').hidden = true; $('end').hidden = true; $('practiceDone').hidden = true;
  $('hud').hidden = practicing; $('practice').hidden = !practicing; $('pauseBtn').hidden = false;
  if (!practicing) showScout(o, 6);
  sfx.whistle();
  nextTurn();
}

function nextTurn() {
  if (match.mode === 'practice') {
    if (practice.step >= LESSONS.length) return finishPractice();
    renderPractice();
    return LESSONS[practice.step].role === 'shoot' ? setupYourKick() : setupCpuKick();
  }
  const w = winner();
  if (w) return endMatch(w);
  renderHud();
  if (match.you.length === match.cpu.length) setupYourKick(); else setupCpuKick();
}

function setupYourKick() {
  match.turn = 'you'; match.phase = 'aim'; shot = null;
  kb.x = 0; kb.y = 1.2; kb.curl = 0; kb.power = 0; kb.charging = false;
  $('diveMeter').hidden = true;
  placeBall();
  hideKeeper(keepers.you); keepers.cpu.root.visible = true;
  keeper = newKeeper(keepers.cpu); keeper.active = true; keeper.maxShift = level.shift;
  taker.root.visible = false; striker.root.visible = false;
  cam.goal = 'shoot';
  if (match.mode === 'practice') {
    banner(LESSONS[practice.step].title, `Lesson ${practice.step + 1} of ${LESSONS.length}`, 'info', 1100);
    hint('');
    return;
  }
  const round = match.you.length + 1;
  banner(round <= 5 ? 'Your kick' : 'Sudden death', round <= 5 ? `Kick ${round} of 5` : 'Score and they must answer', 'info', 1100);
  hint(kb.active ? 'Arrows to aim, hold Space for power. Z / X to curl.' : 'Swipe up from the ball. Curve the swipe to bend it.');
  if (!coached) $('coach').hidden = false;
}

// A short scouting card about the opponent's style.
let scoutTimer = 0;
function showScout(o, seconds) {
  const st = styleOf(o.style);
  $('scoutLabel').textContent = st.label;
  $('scoutText').textContent = st.scout;
  $('scout').hidden = false;
  clearTimeout(scoutTimer);
  scoutTimer = setTimeout(() => { $('scout').hidden = true; }, seconds * 1000);
}

// The dive timing bar: fills during the run-up; red until the plant foot
// (COMMIT), gold after it. Diving in the red lets the taker switch sides.
$('diveMeter').style.setProperty('--commit', String(COMMIT / RUNUP));
function renderDiveMeter() {
  const el = $('diveMeter');
  const active = match.turn === 'cpu' && (match.phase === 'runup' || (match.phase === 'flight' && shot && !shot.done));
  el.hidden = !active;
  if (!active) return;
  const t = match.phase === 'runup' ? match.timer : RUNUP;
  el.style.setProperty('--fill', String(clamp(t / RUNUP, 0, 1)));
  const locked = t >= COMMIT, d = match.dive;
  el.classList.toggle('locked', locked && !d);
  el.classList.toggle('dived', !!d && !d.early);
  el.classList.toggle('early', !!d && d.early);
  $('diveLabel').textContent = d ? (d.early ? 'Early!' : 'Dived') : locked ? 'Dive!' : 'Wait';
}

function setupCpuKick() {
  match.turn = 'cpu'; match.phase = 'runup'; match.timer = 0; shot = null;
  match.plan = planShot(match.opp.style, rng); match.dive = null; match.committed = false;
  kb.x = 0; kb.y = 1.0;
  placeBall();
  hideKeeper(keepers.cpu); keepers.you.root.visible = true;
  keeper = newKeeper(keepers.you); keeper.active = true; keeper.maxShift = 1.85;
  taker.root.visible = true; striker.root.visible = false;
  animateRunup(taker, 0);
  startRecording(false);
  cam.goal = 'keeper';
  if (match.mode === 'practice') {
    banner(LESSONS[practice.step].title, `Lesson ${practice.step + 1} of ${LESSONS.length}`, 'info', 1100);
    hint('');
  } else {
    banner('Save it', 'Wait for the gold bar, then tap where to dive', 'info', 1100);
    hint(kb.active ? 'Arrows to aim, Space to dive.' : 'Tap a spot in the goal to dive there.');
    if (match.cpu.length === 0) showScout(match.opp, 4);
  }
  renderDiveMeter();
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
try { coached = storage.getItem('penaltyNight.coached') === '1'; } catch (e) { /* storage unavailable */ }
function trySkip() {
  if (post && (replay || post.t > 0.5)) { finishPost(); return true; }
  return !!post;
}
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  kb.active = false;
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
  try { storage.setItem('penaltyNight.coached', '1'); } catch (err) { /* storage unavailable */ }
}
function shoot(kick) {
  markCoached();
  const { aimX, aimY, T, spin } = kick;
  startRecording(true);
  // Keyboard aim is pixel-perfect, so harder keyboard kicks spread a little.
  const spread = kick.spread || 0;
  launch(new THREE.Vector3(aimX + rng.gauss() * spread, Math.max(0.11, aimY + rng.gauss() * spread * 0.7), 0), T, spin);
  sfx.kick(kick.power);
  startShot();
  shot.intent = kick;
  // The keeper's one decision: a guess at the strike or a read after its reaction time.
  if (match.mode === 'practice') {
    shot.keeper = null;               // the keeper stands still in shooting lessons
  } else {
    keeper.pending = keeperPlan(level, match.opp.style, rng);
    shot.keeper = { kind: keeper.pending.kind, target: null };
  }
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
  diveTo(clamp(o.x + d.x * t, -4.6, 4.6), clamp(o.y + d.y * t, 0, 2.9));
}
// Your dive, recorded with its timing: before the plant foot (COMMIT) is
// early and lets the taker switch; after the strike, timing is measured
// against the ball's flight.
function diveTo(x, y) {
  planDive(keeper, x, y);
  const at = match.phase === 'runup' ? match.timer : RUNUP + (shot ? shot.t : 0);
  match.dive = { x, y, at, early: at < COMMIT };
  hint('');
}

function cpuShoot() {
  const k = executeShot(match.plan, match.opp.style, level, rng);
  launch(new THREE.Vector3(k.target.x, k.target.y, 0), k.T, k.spin);
  sfx.kick(0.7);
  startShot();
  shot.cpu = { target: k.target, T: k.T, plan: match.plan };
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
  $('diveMeter').hidden = true;
  const mine = match.turn === 'you';
  const scored = kind === 'goal';
  if (match.mode === 'practice') return resolvePractice(kind, mine);
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
  post.feedback = explainShot(kind, mine);
}

// Practice: check the lesson, explain, and move on only after a valid attempt.
function resolvePractice(kind, mine) {
  const lesson = LESSONS[practice.step];
  const res = checkLesson(lesson.id, {
    kind, spot: ballSpot(), intent: shot.intent, dive: match.dive, flight: shot.cpu ? shot.cpu.T : 0.65,
  });
  if (res.ok) { banner('Nice!', lesson.title + ' done', 'good'); sfx.roar(false); practice.step++; }
  else { banner('Try again', lesson.title, 'info', 1200); }
  startCelebration(kind, mine, kind === 'goal');
  post.autoReplay = false;
  const base = explainShot(kind, mine);
  post.feedback = { ...base, title: res.ok ? `${lesson.title}: done` : 'Try again', advice: res.ok ? lesson.success : res.reason };
}

// Where the ball ended up for the diagram: stopped by the keeper, off the
// frame, across the line, or wherever it rolled to a stop.
function ballSpot() {
  const p = shot.touchAt || shot.postAt || shot.lineAt || { x: ball.pos.x, y: ball.pos.y };
  return { x: p.x, y: p.y };
}
function explainShot(kind, mine) {
  if (mine) return explainKick({ kind, intent: shot.intent, ball: ballSpot(), keeper: shot.keeper, style: match.opp.style });
  return explainSave({
    kind, shot: ballSpot(), dive: match.dive, switched: !!(match.plan && match.plan.switched),
    flight: shot.cpu ? shot.cpu.T : 0.65, style: match.opp.style,
  });
}

const feedbackCard = createFeedbackCard({
  root: $('feedback'), svg: $('fbGoal'), title: $('fbTitle'), detail: $('fbDetail'), advice: $('fbAdvice'),
  legend: $('fbLegend'), replay: $('fbReplay'), timer: $('fbTimer'),
}, { onReplay: requestReplay });
const canReplay = () => !!(rec && rec.frames.length > 20);
function requestReplay() {
  if (!post || replay || !canReplay()) return;
  post.replayed = true;
  feedbackCard.hide();
  startReplay();
}

// ------------------------------------------------------------------ celebrations
// After every kick: a short celebration, then (for your goals and your
// saves) a slow-motion replay from a side camera. Tap or press space to skip.
let post = null, party = false;
function startCelebration(kind, mine, scored) {
  post = { t: 0, kind, mine, scored, fx: [], run: null, cheerAt: -1,
    autoReplay: shouldAutoReplay(settings, { mine, kind }), replayed: false, dur: 1.9 };
  const at = (time, fn) => post.fx.push({ time, fn });
  if (mine && scored) {
    post.dur = 3.6;
    at(0.15, () => { burstConfetti(-13, 6, -11, 10, 280, GOLD, 9); flash(40); });
    at(0.35, () => firework(0xf2c230)); at(0.9, () => firework(0xffffff)); at(1.5, () => firework(0xf2c230));
    at(1.9, () => burstConfetti(-13, 6, -11, 10, 200, GOLD, 8));
    post.run = { body: striker, from: new THREE.Vector3(0.25, 0, 11.3), to: new THREE.Vector3(-8.6, 0, 1.4), start: 0.8, speed: 7, slide: true, arms: 'plane' };
  } else if (!mine && scored) {
    post.dur = 2.4;
    at(0.15, () => { burstConfetti(13, 6, -11, 9, 180, cpuPal, 8); flash(18); });
    post.run = { body: taker, from: taker.root.position.clone(), to: new THREE.Vector3(7.5, 0, 2.6), start: 0.35, speed: 6.2, slide: false, arms: 'pump' };
  } else if (kind === 'saved') {
    post.dur = mine ? 2.0 : 2.6;
    post.cheerAt = 0.6;
    if (!mine) { at(0.2, () => { burstConfetti(-13, 6, -11, 10, 220, GOLD, 8); flash(26); }); at(0.6, () => firework(0xf2c230)); }
    else at(0.2, () => { burstConfetti(13, 6, -11, 9, 120, cpuPal, 7); flash(10); });
  } else if (!mine) {
    at(0.2, () => { burstConfetti(-13, 6, -11, 10, 120, GOLD, 7); flash(12); });
  }
  // Short celebrations keep the first burst of colour but skip the run to the
  // fans and the later fireworks. Either way the card stays up long enough to read.
  if (motionReduced || celebrationLength(settings, match.mode) === 'short') {
    post.run = null;
    post.fx = post.fx.slice(0, 1);
    post.dur = 2.6;
  } else {
    post.dur = Math.max(post.dur, 2.8);
  }
}
function updatePost(dt) {
  if (replay) { updateReplay(dt); return; }
  post.t += dt;
  post.fx = post.fx.filter((f) => { if (post.t >= f.time) { f.fn(); return false; } return true; });
  if (post.cheerAt >= 0 && post.t >= post.cheerAt && !keeper.cheer) keeper.cheer = { t: 0, x: clamp(keeper.x, -2.6, 2.6) };
  if (post.run && post.t >= post.run.start) runCelebration(post.run, dt);
  if (post.feedback && post.t >= 0.55 && !feedbackCard.visible && !post.cardShown) {
    post.cardShown = true;
    feedbackCard.show(post.feedback, { canReplay: canReplay() });
  }
  if (post.cardShown) feedbackCard.progress((post.t - 0.55) / (post.dur - 0.55));
  if (post.t >= post.dur) {
    if (post.autoReplay && !post.replayed && canReplay()) { post.replayed = true; feedbackCard.hide(); startReplay(); } else finishPost();
  }
}
// A player runs toward their fans: arms out like a plane (and a knee slide),
// or one fist pumping.
function runCelebration(r, dt) {
  const b = r.body;
  if (!r.pos) {
    r.pos = r.from.clone(); r.v = 0; r.phase = 0; r.t = 0;
    b.root.visible = true; b.root.position.copy(r.pos);
    if (b === striker) cam.goal = 'celebrate';
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
  feedbackCard.hide();
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
  cam.goal = 'replay';
  updateReplay(0);
  cam.snap();
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
  if (motionReduced) {
    // a fixed side view instead of following the ball
    cam.wantPos.set(replay.side * 9, 1.6, 5.5); cam.wantLook.set(replay.side * 0.8, 1, 4);
  } else {
    cam.wantPos.set(replay.side * 8.2, 1.2, lerp(6.5, 3.2, clamp((SPOT_Z - ball.pos.z) / SPOT_Z, 0, 1)));
    cam.wantLook.set(ball.pos.x * 0.8, Math.max(0.7, ball.pos.y), ball.pos.z);
  }
  if (replay.t >= replay.end + 0.4) finishPost();
}
function endReplayLook() {
  stage.classList.remove('replaying');
  $('replayTag').hidden = true; $('skipTag').hidden = true; $('skipTag').classList.add('low');
}

let endTimer = 0;
function endMatch(w) {
  match.phase = 'end';
  $('diveMeter').hidden = true; $('scout').hidden = true;
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
  hint(''); sfx.whistle(); if (w === 'you') { sfx.roar(true); party = true; flash(40); }
  $('pauseBtn').hidden = true;
  endTimer = setTimeout(() => { $('end').hidden = false; $('hud').hidden = true; $('again').focus(); }, 900);
}

function loadRecord() {
  try { return JSON.parse(storage.getItem('penaltyNight.record')) || { w: 0, l: 0 }; } catch (e) { return { w: 0, l: 0 }; }
}
function saveRecord(r) { try { storage.setItem('penaltyNight.record', JSON.stringify(r)); } catch (e) { /* storage unavailable */ } }
function showPracticeEntry() {
  const done = practiced();
  $('practiceBadge').hidden = done;
  $('practiceNote').textContent = done ? 'Replay the four lessons any time' : 'Learn shooting and keeping · 4 lessons';
}
function showRecord() {
  showPracticeEntry();
  const live = tour && tour.stage !== 'champion' && tour.stage !== 'out';
  $('tourLabel').textContent = live ? 'Continue cup' : 'Night Cup';
  $('tourStatus').textContent = !live ? '8 teams · knockout'
    : tour.stage === 'group' ? `Matchday ${tour.day + 1} of 3`
    : tour.stage === 'semi' ? 'Semifinal next' : 'The final is next';
  const r = loadRecord();
  let cups = 0; try { cups = +storage.getItem('penaltyNight.cups') || 0; } catch (e) { /* storage unavailable */ }
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
    const t = JSON.parse(storage.getItem('penaltyNight.cup'));
    return t && t.table && t.A && t.B ? t : null;
  } catch (e) { return null; }
}
function saveCup() { try { storage.setItem('penaltyNight.cup', JSON.stringify(tour)); } catch (e) { /* storage unavailable */ } }
function newCup() {
  tour = createCup(rng);
  saveCup();
  party = false;
}
function playCupMatch() {
  const fx = currentFixture(tour);
  if (!fx) return;
  const t = TEAMS[fx.opp];
  startMatch({ mode: 'cup', name: t.name, code: t.code, color: t.color, params: paramsFor(t.rating), label: fx.label, style: t.style });
}
const nm = teamName;
// Records your result and moves the cup on. Returns one line for the end screen.
function cupAfterMatch(gy, gc) {
  const line = recordResult(tour, gy, gc, rng);
  if (tour.stage === 'champion') {
    try { storage.setItem('penaltyNight.cups', String((+storage.getItem('penaltyNight.cups') || 0) + 1)); } catch (e) { /* storage unavailable */ }
  }
  saveCup();
  return line;
}
function showHub() {
  if (!tour) newCup();
  resetScenery();
  $('end').hidden = true; $('menu').hidden = true; $('hud').hidden = true; $('hub').hidden = false;
  hint('');
  match.phase = 'menu'; cam.goal = 'menu';
  party = tour.stage === 'champion';
  if (party) flash(30);
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
      <div class="stars">Keeper <b>${'●'.repeat(stars)}${'○'.repeat(5 - stars)}</b></div>
      <p class="scouting"><b>${styleOf(TEAMS[fx.opp].style).label}.</b> ${styleOf(TEAMS[fx.opp].style).scout}</p>`;
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
  (done ? $('hubRestart') : $('hubPlay')).focus();
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

// ---------------- practice
const practice = { step: 0 };
function practiceOpponent() {
  // A steady taker who never switches and rarely misses, and a keeper who stands still.
  return { mode: 'practice', name: 'Coach', code: 'PRA', color: 0x2fc6b4, label: '', style: 'balanced',
    params: { ...LEVELS.pro, cpuErr: 0.15, reAim: 0, gamble: 0 } };
}
function startPractice() { practice.step = 0; startMatch(practiceOpponent()); }
function renderPractice() {
  const lesson = LESSONS[practice.step];
  $('practiceStep').textContent = `Practice · ${practice.step + 1} of ${LESSONS.length}`;
  $('practiceTitle').textContent = lesson.title;
  $('practiceHow').textContent = lesson.how[kb.active ? 'keyboard' : 'swipe'];
  $('practiceDots').replaceChildren(...LESSONS.map((l, i) => {
    const li = document.createElement('li');
    li.className = i < practice.step ? 'goal' : i === practice.step ? 'now' : '';
    return li;
  }));
}
const practiced = () => storage.getItem('penaltyNight.practiced') === '1';
function finishPractice() {
  storage.setItem('penaltyNight.practiced', '1');
  match.phase = 'end';
  $('practice').hidden = true; $('pauseBtn').hidden = true; $('diveMeter').hidden = true;
  hint(''); sfx.whistle(); sfx.roar(true);
  $('practiceDone').hidden = false;
  $('practicePlay').focus();
}
$('practiceBtn').addEventListener('click', () => { initAudio(); startPractice(); });
$('practicePlay').addEventListener('click', () => { initAudio(); $('practiceDone').hidden = true; startMatch(quickOpponent()); });
$('practiceAgain').addEventListener('click', () => { $('practiceDone').hidden = true; startPractice(); });
$('practiceMenu').addEventListener('click', () => { $('practiceDone').hidden = true; match.phase = 'menu'; showPicker(); });

// ---------------- keyboard play
// Arrows move a target in the goal (the same keys for both roles).
// Shooting: hold Space to fill the power meter, release to shoot; Z / X curl.
// Keeping: Space dives to the target.
const kb = { x: 0, y: 1.2, held: new Set(), charging: false, power: 0, curl: 0, active: false };
const markerTex = world.canvasTexture(128, 128, (c, w, h) => {
  c.strokeStyle = '#f6e7a8'; c.lineWidth = 9;
  c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#f6e7a8'; c.beginPath(); c.arc(w / 2, h / 2, 9, 0, Math.PI * 2); c.fill();
});
const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthTest: false, fog: false }));
marker.scale.set(0.55, 0.55, 1); marker.visible = false; marker.renderOrder = 10;
scene.add(marker);
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const kbShooting = () => match.turn === 'you' && match.phase === 'aim' && !post;
const kbKeeping = () => match.turn === 'cpu' && (match.phase === 'runup' || match.phase === 'flight') && !keeper.dive && !post;
const CURL_TEXT = { '-1': ' · curl ←', 0: '', 1: ' · curl →' };
function updateKeyboard(dt) {
  const shooting = kbShooting(), keeping = kbKeeping();
  if (shooting || keeping) {
    let dx = (kb.held.has('ArrowRight') ? 1 : 0) - (kb.held.has('ArrowLeft') ? 1 : 0);
    const dy = (kb.held.has('ArrowUp') ? 1 : 0) - (kb.held.has('ArrowDown') ? 1 : 0);
    if (keeping) dx = -dx;          // facing the taker, screen right is world -x
    kb.x = clamp(kb.x + dx * 3.2 * dt, -4.3, 4.3);
    kb.y = clamp(kb.y + dy * 2.4 * dt, 0.15, 2.9);
  }
  if (kb.charging) kb.power = Math.min(1, kb.power + dt / 0.9);
  marker.visible = kb.active && (shooting || keeping);
  if (match.mode === 'practice' && kb.active !== kb.shownAsKeys && practice.step < LESSONS.length) { kb.shownAsKeys = kb.active; renderPractice(); }
  marker.position.set(kb.x, kb.y, keeping ? KEEPER_Z + 0.05 : 0);
  const pm = $('powerMeter');
  pm.hidden = !(kb.active && shooting);
  if (!pm.hidden) {
    pm.style.setProperty('--fill', String(kb.power));
    $('powerLabel').textContent = (kb.charging ? 'Power' : 'Hold Space') + CURL_TEXT[kb.curl];
  }
}
function keyboardShoot() {
  kb.charging = false;
  const kick = keyboardKick(kb.x, kb.y, kb.power, kb.curl);
  kick.spread = 0.1 + 0.3 * kb.power * kb.power;
  kb.power = 0;
  shoot(kick);
}
function handlePlayKey(e, k) {
  if (ARROWS.includes(k)) { kb.held.add(k); kb.active = true; e.preventDefault(); return true; }
  if (k === ' ' && kbShooting()) {
    e.preventDefault(); kb.active = true;
    if (!kb.charging && !e.repeat) { kb.charging = true; kb.power = 0; initAudio(); }
    return true;
  }
  if (k === ' ' && kbKeeping()) { e.preventDefault(); kb.active = true; initAudio(); diveTo(kb.x, kb.y); return true; }
  if ((k === 'z' || k === 'x') && kbShooting()) {
    const want = k === 'z' ? -1 : 1;
    kb.curl = kb.curl === want ? 0 : want; kb.active = true; e.preventDefault(); return true;
  }
  return false;
}
document.addEventListener('keyup', (e) => {
  kb.held.delete(e.key);
  if (e.key === ' ' && kb.charging) { e.preventDefault(); if (kbShooting() && !paused) keyboardShoot(); else kb.charging = false; }
});

// ---------------- pause, restart, quit, settings
let paused = false;
const inMatch = () => match.phase === 'aim' || match.phase === 'runup' || match.phase === 'flight';
function pause() {
  if (paused || !inMatch()) return;
  paused = true; swipe = null; kb.charging = false; kb.held.clear();
  audio.suspend();
  $('pauseEyebrow').textContent = match.mode === 'cup' ? `Paused · ${match.stageLabel}` : match.mode === 'practice' ? 'Paused · Practice' : 'Paused';
  $('pauseTitle').textContent = match.mode === 'practice' ? LESSONS[Math.min(practice.step, LESSONS.length - 1)].title : `${goals(match.you)} – ${goals(match.cpu)}`;
  $('restartBtn').firstChild.textContent = match.mode === 'practice' ? 'Restart practice ' : 'Restart match ';
  const st = match.opp && match.opp.style && match.mode !== 'practice' ? styleOf(match.opp.style) : null;
  $('pauseScout').textContent = st ? `${st.label}: ${st.scout}` : '';
  $('quitBtn').firstChild.textContent = match.mode === 'cup' ? 'Back to cup ' : 'Quit to menu ';
  $('pause').hidden = false;
  $('resumeBtn').focus();
}
function resume() {
  if (!paused) return;
  paused = false;
  $('pause').hidden = true; $('settings').hidden = true;
  audio.resume();
  last = performance.now();
}
// Clear everything a kick leaves behind, so a restart or quit starts clean.
function clearPitch() {
  post = null; replay = null; rec = null; shot = null; swipe = null; party = false;
  clearTimeout(endTimer);
  endReplayLook(); feedbackCard.hide(); clearBanner(); hint('');
  $('diveMeter').hidden = true; $('scout').hidden = true; $('coach').hidden = true;
  keeper.cheer = null; keeper.pending = null; keeper.dive = null;
  striker.root.visible = false; taker.root.visible = false;
  net.bulges.length = 0;
  placeBall();
}
function restartMatch() {
  const o = match.opp;
  if (o.mode === 'practice') practice.step = 0;
  resume(); clearPitch();
  startMatch(o);
}
// Quitting a cup match leaves the fixture unplayed: back to the hub.
function quitMatch() {
  const cup = match.mode === 'cup';
  resume(); clearPitch();
  $('hud').hidden = true; $('practice').hidden = true; $('pauseBtn').hidden = true;
  match.phase = 'menu';
  if (cup) showHub(); else showPicker();
}
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', restartMatch);
$('quitBtn').addEventListener('click', quitMatch);

const settingsPanel = createSettingsPanel($('settingsList'), settings, (key) => {
  saveSettings(storage, settings);
  if (key === 'sound') applySound();
  if (key === 'motion') applyMotion();
});
let settingsReturn = null;
function openSettings() {
  settingsReturn = document.activeElement;
  settingsPanel.sync();
  $('settings').hidden = false;
  $('settingsDone').focus();
}
function closeSettings() {
  $('settings').hidden = true;
  if (settingsReturn && settingsReturn.focus) settingsReturn.focus();
}
$('settingsBtn').addEventListener('click', openSettings);
$('pauseSettingsBtn').addEventListener('click', openSettings);
$('settingsDone').addEventListener('click', closeSettings);

// The game pauses itself when you switch tabs or windows.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

document.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!$('settings').hidden) { if (k === 'Escape') { e.preventDefault(); closeSettings(); } return; }
  if (paused) {
    if (k === 'Escape' || k === 'p') { e.preventDefault(); resume(); }
    else if (k === 'r') { e.preventDefault(); restartMatch(); }
    else if (k === 'q') { e.preventDefault(); quitMatch(); }
    else if (k === 's') { e.preventDefault(); openSettings(); }
    return;
  }
  if ((k === 'Escape' || k === 'p') && inMatch()) { e.preventDefault(); pause(); return; }
  if (post) {
    if (k === ' ' || k === 'Enter') { e.preventDefault(); trySkip(); }
    else if (k === 'v') { e.preventDefault(); requestReplay(); }
    return;
  }
  handlePlayKey(e, k);
});

// ---------------- title: lights on, camera sweep, tap to play
let intro = null;
function startIntro() {
  $('menu').hidden = false; $('attract').hidden = false; $('picker').hidden = true;
  $('logo').classList.remove('show'); $('tapToPlay').classList.remove('show');
  const reduce = motionReduced;
  intro = { t: reduce ? 9 : 0 };
  towers.forEach((tw) => { tw.on = reduce ? 1 : 0; });
  cam.goal = 'intro';
}
// Menus show an empty pitch: the home keeper waiting on the line, ball on the spot.
function resetScenery() {
  hideKeeper(keepers.you); taker.root.visible = false; striker.root.visible = false;
  keepers.cpu.root.visible = true;
  keeper = newKeeper(keepers.cpu); keeper.active = true; poseKeeper(keeper);
  marker.visible = false;
  placeBall();
}
function showPicker() {
  intro = null;
  resetScenery();
  towers.forEach((tw) => { tw.on = 1; });
  $('menu').hidden = false; $('attract').hidden = true; $('picker').hidden = false;
  if (cam.goal !== 'pick') cam.goal = 'pick';
  showRecord();
}
$('attract').addEventListener('click', () => {
  initAudio(); sfx.roar(false);
  showPicker();
});
setLevel('pro');
showRecord();

// ------------------------------------------------------------------ camera (render/camera.js)
const cam = createCameraDirector(camera);
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  cam.resize(w, h);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  trail.width = w * dpr; trail.height = h * dpr;
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ main loop
let last = performance.now(), time = 0, timeScale = 1;
let devFrozen = false;   // development only: stop real time so tests can step exactly
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
  timeScale = lerp(timeScale, slow && !motionReduced ? 0.33 : 1, 1 - Math.exp(-dt * 10));
  const sdt = dt * timeScale;

  if (match.phase === 'runup') {
    match.timer += sdt;
    animateRunup(taker, match.timer);
    // The plant foot: the taker's last look at the keeper, then the shot is locked.
    if (!match.committed && match.timer >= COMMIT) {
      match.committed = true;
      match.plan = reconsider(match.plan, match.dive && match.dive.early ? match.dive : null, match.opp.style, level, rng);
    }
    if (match.timer >= RUNUP) cpuShoot();
  }
  if (match.turn === 'cpu' && (match.phase === 'runup' || match.phase === 'flight')) renderDiveMeter();

  if (keeper.pending && shot) {
    keeper.pending.at -= sdt;
    if (keeper.pending.at <= 0) {
      const pd = keeper.pending; keeper.pending = null;
      const target = pd.kind === 'read' ? readDive(predictCrossing(ball, pd.readSpin), level, match.opp.style, rng) : { x: pd.x, y: pd.y };
      planDive(keeper, target.x, target.y);
      shot.keeper.target = target;
    }
  }
  updateKeyboard(dt);
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
  if (motionReduced) { cheer.you = 0; cheer.cpu = 0; }
  cheer.you *= Math.exp(-dt * 0.7); cheer.cpu *= Math.exp(-dt * 0.7);
  updateCrowd(time);
  const boardTex = world.getBoardTex();
  if (boardTex && !motionReduced) boardTex.offset.x = (time * 0.025) % 1;

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
  cam.update(dt, time, { intro, flying: match.phase === 'flight' && !!shot, ball: ball.pos, run: post && post.run, reduced: motionReduced });
  // Keeper view: fade what blocks the view and highlight the ball.
  const keeperView = cam.goal === 'keeper' ? 1 : 0;
  goalFade += (keeperView - goalFade) * Math.min(1, dt * 6);
  world.setGoalFade(goalFade);
  ballTracking.update(ball.pos, ball.moving && !replay, 0.45 + 0.55 * keeperView, dt);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused && !devFrozen) tick(dt);
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
    freeze(on = true) { devFrozen = on; },
    get paused() { return paused; },
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
