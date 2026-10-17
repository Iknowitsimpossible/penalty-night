import * as THREE from 'three';
import { readSwipe } from './input/swipe.js';
import { createPointerInput } from './input/pointer.js';
import { createKeyboardAim } from './input/keyboard.js';
import { R, SPOT_Z, KEEPER_Z, RUNUP, COMMIT } from './core/constants.js';
import { clamp, lerp } from './core/math.js';
import { createRng } from './core/random.js';
import { createWorld } from './render/world.js';
import { createEffects, GOLD } from './render/effects.js';
import { makePerson, KITS, animateRunup, newKeeper, poseKeeper, hideKeeper, planDive, updateKeeper, keeperSpheres } from './render/people.js';
import { createBallState, launchVelocity, stepBall, predictCrossing } from './physics/ball.js';
import { newShot, coolDown, collideStep, judge } from './physics/collisions.js';
import { createBallMesh, createBallTracking } from './render/ball.js';
import { createCameraDirector } from './render/camera.js';
import { createReplays } from './render/replay.js';
import { createQualityGovernor } from './render/quality.js';
import { createAudio } from './audio/sfx.js';
import { shootoutWinner, goals } from './rules/shootout.js';
import { planShot, reconsider, executeShot } from './ai/taker.js';
import { keeperPlan, readDive } from './ai/keeper.js';
import { STYLE_KEYS, styleOf } from './ai/styles.js';
import { LEVELS } from './ai/levels.js';
import { explainKick, explainSave } from './feedback/explain.js';
import { LESSONS, checkLesson } from './practice/lessons.js';
import { STAGES, startStage, drillPlan, recordAttempt, SHOTS_PER_STAGE } from './practice/keeper-drills.js';
import { createFeedbackCard } from './ui/feedback-card.js';
import { createSettingsPanel } from './ui/settings-panel.js';
import { hubView } from './ui/cup-hub.js';
import { createHud } from './ui/hud.js';
import { loadSettings, saveSettings, shouldAutoReplay, celebrationLength, reducedMotion } from './ui/settings.js';
import { TEAMS, createCup, recordResult, currentFixture } from './tournament/cup.js';

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
// The camera director (render/camera.js) picks and glides between shots.
const cam = createCameraDirector(camera);
// Net bulges are recorded so a replay can show them again.
function bulgeNet(at, dir, strength) {
  replays.noteNet(at, dir, strength);
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
const withLanding = (k) => { k.onLand = () => sfx.land(); return k; };
let keeper = withLanding(newKeeper(keepers.cpu));

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

// ------------------------------------------------------------------ collisions (physics/collisions.js)
function collide() {
  if (!shot) return;
  collideStep(ball, shot, keeper.active ? keeperSpheres(keeper) : null, rng, {
    post: () => { sfx.post(); cam.shake(0.06); },
    save: () => { sfx.save(); cam.shake(0.035); },
    net: (p, v, strength) => { bulgeNet(p, v, strength); sfx.net(); cam.shake(0.02); },
  });
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

const hud = createHud($);
const renderHud = () => hud.score(match.you, match.cpu, match.stageLabel);

const { banner, hint, clearBanner } = hud;

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
  party = false; post = null; replays.clear(); endReplayLook();
  match.you = []; match.cpu = [];
  const practicing = o.mode === 'practice' || o.mode === 'keeper';
  $('menu').hidden = true; $('end').hidden = true; $('practiceDone').hidden = true;
  $('hud').hidden = practicing; $('practice').hidden = !practicing; $('pauseBtn').hidden = false;
  if (!practicing) showScout(o, 6);
  sfx.whistle();
  nextTurn();
}

function nextTurn() {
  if (match.mode === 'keeper') return trainingStage.done ? finishTraining() : setupCpuKick();
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

// Before each kick: the referee's signal and a hush in the crowd.
function lineUp() {
  if (match.you.length + match.cpu.length > 0 || match.mode === 'practice') sfx.signal();
  sfx.hush(true);
}
function setupYourKick() {
  match.turn = 'you'; match.phase = 'aim'; shot = null;
  lineUp();
  keys.reset(1.2);
  hud.diveMeter(null);
  placeBall();
  hideKeeper(keepers.you); keepers.cpu.root.visible = true;
  keeper = withLanding(newKeeper(keepers.cpu)); keeper.active = true; keeper.maxShift = level.shift;
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

const showScout = (o, seconds) => hud.scout(o.style, seconds);

// The dive timing bar shows while you can still dive on their kick.
function renderDiveMeter() {
  const active = match.turn === 'cpu' && (match.phase === 'runup' || (match.phase === 'flight' && shot && !shot.done));
  hud.diveMeter(active ? { t: match.phase === 'runup' ? match.timer : RUNUP, dive: match.dive } : null);
}

function setupCpuKick() {
  const training = match.mode === 'keeper';
  match.turn = 'cpu'; match.phase = training ? 'ready' : 'runup'; match.timer = 0; shot = null;
  lineUp();
  match.plan = training ? drillPlan(trainingStage, rng) : planShot(match.opp.style, rng);
  match.dive = null; match.committed = false;
  keys.reset(1.0);
  placeBall();
  hideKeeper(keepers.cpu); keepers.you.root.visible = true;
  keeper = withLanding(newKeeper(keepers.you)); keeper.active = true; keeper.maxShift = 1.85;
  taker.root.visible = true; striker.root.visible = false;
  animateRunup(taker, 0);
  startRecording(false);
  cam.goal = 'keeper';
  if (training) {
    renderTraining();
    hint('');
    $('readyBtn').hidden = false;
    // Stage 1 shows where the shot is going.
    if (match.plan.shown) { cornerHint.position.set(match.plan.x, match.plan.y, 0.05); cornerHint.visible = true; }
  } else if (match.mode === 'practice') {
    banner(LESSONS[practice.step].title, `Lesson ${practice.step + 1} of ${LESSONS.length}`, 'info', 1100);
    hint('');
  } else {
    banner('Save it', 'Wait for the gold bar, then tap where to dive', 'info', 1100);
    hint(kb.active ? 'Arrows to aim, Space to dive, A / D to step.' : 'Tap a spot in the goal to dive there.');
    if (match.cpu.length === 0) showScout(match.opp, 4);
  }
  renderDiveMeter();
}

// ---------------- input (input/pointer.js, input/keyboard.js)
let coached = false;
try { coached = storage.getItem('penaltyNight.coached') === '1'; } catch (e) { /* storage unavailable */ }
// During the after-kick card, a tap continues (after a short moment).
function trySkip() {
  if (post && (replays.playing || post.t > 0.5)) { finishPost(); return true; }
  return !!post;
}
const canDive = () => match.turn === 'cpu' && (match.phase === 'runup' || match.phase === 'flight') && !keeper.dive && !post;
// Where a screen point lands in the goal mouth (the keeper's plane), or null.
function screenToGoal(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin: o, direction: d } = raycaster.ray;
  if (Math.abs(d.z) < 1e-4) return null;
  const t = (KEEPER_Z - o.z) / d.z;
  if (t <= 0) return null;
  return { x: clamp(o.x + d.x * t, -4.6, 4.6), y: clamp(o.y + d.y * t, 0, 2.9) };
}
// Mouse hover while keeping: a ring previews exactly where a click will dive.
const hover = { x: 0, y: 1, on: false };
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const keeping = match.turn === 'cpu' && (match.phase === 'ready' || match.phase === 'runup' || match.phase === 'flight');
  const g = keeping ? screenToGoal(e.clientX, e.clientY) : null;
  hover.on = !!g;
  if (g) { hover.x = g.x; hover.y = g.y; kb.active = false; }
});
canvas.addEventListener('pointerleave', () => { hover.on = false; });

const pointer = createPointerInput({ stage, canvas, trail: $('trail') }, {
  onPress(p, e) {
    initAudio();
    kb.active = false;
    if (trySkip()) return 'done';
    if (match.phase === 'ready') return 'done';
    if (match.phase === 'aim' && match.turn === 'you') return p.y < stage.clientHeight * 0.3 ? 'done' : 'swipe';
    if (canDive()) playerDive(e);
    return 'done';
  },
  onSwipe: (pts) => takeKick(pts),
});

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
  sfx.kick(kick.power); sfx.hush(false);
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
  shot = newShot(ball);
}

// ---------------- their kick: you dive
const raycaster = new THREE.Raycaster();
function playerDive(e) {
  const g = screenToGoal(e.clientX, e.clientY);
  if (g) diveTo(g.x, g.y);
}
// Your dive, recorded with its timing: before the plant foot (COMMIT) is
// early and lets the taker switch; after the strike, timing is measured
// against the ball's flight.
function diveTo(x, y) {
  planDive(keeper, x, y);
  sfx.dive();
  const at = match.phase === 'runup' ? match.timer : RUNUP + (shot ? shot.t : 0);
  match.dive = { x, y, at, early: at < COMMIT };
  // Instant confirmation that the dive registered: a pulse where you aimed
  // (red if it was before the gold bar) and a tiny buzz on phones.
  pulseDive(x, y, match.dive.early);
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* not allowed */ } }
  hint('');
}

function cpuShoot() {
  const k = executeShot(match.plan, match.opp.style, level, rng);
  launch(new THREE.Vector3(k.target.x, k.target.y, 0), k.T, k.spin);
  sfx.kick(0.7); sfx.hush(false);
  startShot();
  shot.cpu = { target: k.target, T: k.T, plan: match.plan };
}

// ---------------- deciding the result
const LINES = {
  goal: ['No chance for the keeper.', 'Ice in the veins.', 'Sent the keeper the wrong way.', 'Calm as you like.'],
  top: ['Top bins.', 'Right under the bar.', 'Postage stamp.'],
  low: ['Low and hard.', 'Rolled it into the corner.', 'Through the grass.'],
  saved: ['A hand to it.', 'Read it all the way.', 'Kept out at full stretch.'],
};
const pick = (a) => a[(Math.random() * a.length) | 0];
function resolve(kind) {
  shot.done = true; shot.after = 0;
  $('stepper').hidden = true;
  hud.diveMeter(null);
  const mine = match.turn === 'you';
  const scored = kind === 'goal';
  if (match.mode === 'practice') return resolvePractice(kind, mine);
  if (match.mode === 'keeper') return resolveTraining(kind);
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
  if (res.ok) { banner('Nice!', lesson.title + ' done', 'good'); sfx.roar(false); sfx.chime(); practice.step++; }
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
const canReplay = () => replays.canPlay();
function requestReplay() {
  if (!post || replays.playing || !canReplay()) return;
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
  if (replays.playing) { if (replays.update(dt, keeper)) finishPost(); return; }
  post.t += dt;
  post.fx = post.fx.filter((f) => { if (post.t >= f.time) { f.fn(); return false; } return true; });
  if (post.cheerAt >= 0 && post.t >= post.cheerAt && !keeper.cheer) keeper.cheer = { t: 0, x: clamp(keeper.x, -2.6, 2.6) };
  if (post.run && post.t >= post.run.start) runCelebration(post.run, dt);
  if (post.feedback && post.t >= 0.55 && !feedbackCard.visible && !post.cardShown) {
    post.cardShown = true;
    feedbackCard.show(post.feedback, { canReplay: canReplay() });
    sfx.blip();
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
  post = null; replays.clear(); shot = null;
  keeper.cheer = null;
  striker.root.visible = false;
  nextTurn();
}

// ------------------------------------------------------------------ replays (render/replay.js)
const replays = createReplays({
  ball, poseKeeper, animateRunup, cam, reduced: () => motionReduced,
  bulgeNet: (at, dir, s) => world.bulgeNet(at, dir, s),
});
function startRecording(mine) { replays.start(mine, keeper, mine ? striker : taker); }
function startReplay() {
  ball.moving = false;
  net.bulges = [];
  keeper.cheer = null;
  striker.root.visible = replays.mine; taker.root.visible = !replays.mine;
  stage.classList.add('replaying');
  $('replayTag').hidden = false; $('skipTag').hidden = false; $('skipTag').classList.remove('low');
  cam.goal = 'replay';
  replays.begin(keeper);
}
function endReplayLook() {
  stage.classList.remove('replaying');
  $('replayTag').hidden = true; $('skipTag').hidden = true; $('skipTag').classList.add('low');
}

let endTimer = 0;
function endMatch(w) {
  match.phase = 'end';
  sfx.hush(false);
  hud.diveMeter(null); hud.hideScout();
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
  const cleared = Math.min(+storage.getItem('penaltyNight.keeperStage') || 0, STAGES.length);
  $('trainingNote').textContent = cleared ? `${cleared} of ${STAGES.length} stages cleared` : `${STAGES.length} stages · save 3 of 5`;
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
  const v = hubView(tour);
  $('hubEyebrow').textContent = v.eyebrow;
  $('hubTitle').textContent = v.title;
  $('hubNews').textContent = v.news;
  $('hubFixture').hidden = !v.fixtureHtml;
  if (v.fixtureHtml) $('hubFixture').innerHTML = v.fixtureHtml;
  $('hubTables').innerHTML = v.tablesHtml;
  $('hubKo').hidden = !v.koHtml;
  if (v.koHtml) $('hubKo').innerHTML = v.koHtml;
  const done = v.done;
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
  $('doneEyebrow').textContent = 'Practice complete';
  $('doneTitle').textContent = "You're ready";
  $('doneLede').textContent = 'Low, high and curved shots, and a keeper who waits for the plant foot. Every kick after this gets a short card telling you what to change.';
  $('practiceAgain').textContent = 'Practice again';
  match.phase = 'end';
  $('practice').hidden = true; $('pauseBtn').hidden = true; hud.diveMeter(null);
  hint(''); sfx.whistle(); sfx.roar(true);
  $('practiceDone').hidden = false;
  $('practicePlay').focus();
}
$('practiceBtn').addEventListener('click', () => { initAudio(); startPractice(); });
$('practicePlay').addEventListener('click', () => { initAudio(); $('practiceDone').hidden = true; startMatch(quickOpponent()); });
$('practiceAgain').addEventListener('click', () => {
  $('practiceDone').hidden = true;
  if (match.mode === 'keeper') startTraining(0); else startPractice();
});
$('practiceMenu').addEventListener('click', () => { $('practiceDone').hidden = true; match.phase = 'menu'; showPicker(); });

// ---------------- keeper positioning, markers and dive feedback
// Step along the line (A / D or the on-screen arrows) until the plant foot.
// Stepping toward a side shows the taker your plan, like an early dive.
const STEP_SPEED = 2.0, STEP_MAX = 1.0;
let stepping = 0;                         // -1, 0, 1 from the on-screen buttons (screen direction)
const canStep = () => !paused && !post && match.turn === 'cpu' && !keeper.dive &&
  (match.phase === 'ready' || (match.phase === 'runup' && match.timer < COMMIT));
function updateStepping(dt) {
  const allowed = canStep();
  $('stepper').hidden = !allowed;
  if (!allowed) return;
  const dir = stepping || keys.stepDir();
  // facing the taker, screen right is world -x
  keeper.homeX = clamp(keeper.homeX - dir * STEP_SPEED * dt, -STEP_MAX, STEP_MAX);
}
for (const [id, dir] of [['stepLeft', -1], ['stepRight', 1]]) {
  const b = $(id);
  const stop = () => { stepping = 0; b.classList.remove('held'); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); initAudio(); stepping = dir; b.classList.add('held'); b.setPointerCapture(e.pointerId); });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
}

const ringTex = (color) => world.canvasTexture(128, 128, (c, w, h) => {
  c.strokeStyle = color; c.lineWidth = 9;
  c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2); c.stroke();
});
const makeRing = (tex, size) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sp.scale.set(size, size, 1); sp.visible = false; sp.renderOrder = 11;
  scene.add(sp);
  return sp;
};
// Stage 1 of keeper training: where the shot is going.
const cornerHint = makeRing(ringTex('#2fc6b4'), 0.75);
// The confirmation pulse when a dive registers.
const pulse = { sprite: makeRing(ringTex('#ffffff'), 0.5), t: 1 };
function pulseDive(x, y, early) {
  pulse.sprite.position.set(x, y, KEEPER_Z + 0.08);
  pulse.sprite.material.color.setHex(early ? 0xef5a5f : 0xf2c230);
  pulse.t = 0; pulse.sprite.visible = true;
}
function updateKeeperMarkers(dt) {
  if (pulse.sprite.visible) {
    pulse.t += dt;
    const k = Math.min(pulse.t / 0.45, 1);
    pulse.sprite.scale.setScalar(0.45 + 0.9 * k);
    pulse.sprite.material.opacity = 1 - k;
    if (k >= 1) pulse.sprite.visible = false;
  }
  if (match.turn !== 'cpu' || post) cornerHint.visible = false;
}

// ---------------- keeper training
// Five stages that add one difficulty at a time (practice/keeper-drills.js).
let trainingStage = null;
function trainingOpponent(stageIndex) {
  return { mode: 'keeper', name: 'Coach', code: 'PRA', color: 0x2fc6b4, label: '', style: 'balanced',
    params: { ...LEVELS.pro, cpuErr: 0.08, reAim: STAGES[stageIndex].reAim, cpuPace: 0 } };
}
function startTraining(stageIndex = 0) {
  trainingStage = startStage(stageIndex, rng);
  startMatch(trainingOpponent(stageIndex));
}
function renderTraining() {
  const st = STAGES[trainingStage.index];
  $('practiceStep').textContent = `Keeper training · Stage ${trainingStage.index + 1} of ${STAGES.length}`;
  $('practiceTitle').textContent = st.title;
  $('practiceHow').textContent = st.how;
  $('practiceDots').replaceChildren(...Array.from({ length: SHOTS_PER_STAGE }, (_, i) => {
    const li = document.createElement('li');
    const r = trainingStage.results[i];
    li.className = r === undefined ? (i === trainingStage.attempt ? 'now' : '') : r ? 'goal' : 'miss';
    return li;
  }));
}
// The run-up starts when you are ready.
function startRunup() {
  if (match.phase !== 'ready') return;
  $('readyBtn').hidden = true;
  match.phase = 'runup'; match.timer = 0;
  initAudio();
}
$('readyBtn').addEventListener('click', startRunup);
function resolveTraining(kind) {
  startCelebration(kind, false, kind === 'goal');
  post.autoReplay = false;
  post.feedback = explainSave({
    kind, shot: ballSpot(), dive: match.dive, switched: !!(match.plan && match.plan.switched),
    flight: shot.cpu ? shot.cpu.T : 0.7, style: 'balanced', precise: true,
  });
  if (kind !== 'goal' && kind !== 'saved') {
    banner('They missed', 'That one does not count', 'info', 1300);
    return;
  }
  const outcome = recordAttempt(trainingStage, kind === 'saved');
  renderTraining();
  if (kind === 'saved') { banner('Saved!', `${trainingStage.saves} of 3`, 'good'); sfx.roar(false); }
  else banner('Goal', `${trainingStage.saves} of 3 saves`, 'bad', 1300);
  if (outcome === 'passed') {
    sfx.chime();
    banner('Stage cleared', STAGES[trainingStage.index].title, 'good', 1800);
    storage.setItem('penaltyNight.keeperStage', String(Math.max(trainingStage.index + 1, +storage.getItem('penaltyNight.keeperStage') || 0)));
    trainingStage = trainingStage.index + 1 < STAGES.length ? startStage(trainingStage.index + 1, rng) : { done: true };
    if (!trainingStage.done) level = trainingOpponent(trainingStage.index).params;
  } else if (outcome === 'failed') {
    banner('Not this time', 'The stage starts again', 'bad', 1800);
    trainingStage = startStage(trainingStage.index, rng);
  }
}
function finishTraining() {
  match.phase = 'end';
  $('practice').hidden = true; $('pauseBtn').hidden = true; hud.diveMeter(null);
  hint(''); sfx.whistle(); sfx.roar(true);
  $('doneEyebrow').textContent = 'Keeper training complete';
  $('doneTitle').textContent = 'Safe hands';
  $('doneLede').textContent = 'You can read a marked corner, react to slow and quicker shots, and use a habit at match pace. Wait for the gold bar, then the strike.';
  $('practiceAgain').textContent = 'Train again';
  $('practiceDone').hidden = false;
  $('practicePlay').focus();
}
$('trainingBtn').addEventListener('click', () => { initAudio(); startTraining(0); });

// ---------------- keyboard play (input/keyboard.js)
const keys = createKeyboardAim({
  mode: () => {
    if (paused || post) return null;
    if (match.turn === 'you' && match.phase === 'aim') return 'shoot';
    return canDive() ? 'keep' : null;
  },
  on: { shoot: (kick) => shoot(kick), dive: (x, y) => diveTo(x, y), wake: () => initAudio() },
});
const kb = keys.state;
// The keyboard target: a ring in the goal mouth.
const markerTex = world.canvasTexture(128, 128, (c, w, h) => {
  c.strokeStyle = '#f6e7a8'; c.lineWidth = 9;
  c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#f6e7a8'; c.beginPath(); c.arc(w / 2, h / 2, 9, 0, Math.PI * 2); c.fill();
});
const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthTest: false, fog: false }));
marker.scale.set(0.55, 0.55, 1); marker.visible = false; marker.renderOrder = 10;
scene.add(marker);
function updateKeyboard(dt) {
  const m = keys.update(dt);
  const keepingNow = match.turn === 'cpu' && !keeper.dive && !post &&
    (match.phase === 'ready' || match.phase === 'runup' || match.phase === 'flight');
  if (kb.active) {
    marker.visible = !!m;
    marker.position.set(kb.x, kb.y, m === 'keep' ? KEEPER_Z + 0.05 : 0);
  } else {
    // mouse hover preview of where a click will dive
    marker.visible = hover.on && keepingNow;
    marker.position.set(hover.x, hover.y, KEEPER_Z + 0.05);
  }
  if (match.mode === 'practice' && kb.active !== kb.shownAsKeys && practice.step < LESSONS.length) { kb.shownAsKeys = kb.active; renderPractice(); }
  hud.powerMeter(kb.active && m === 'shoot' ? kb : null);
}
document.addEventListener('keyup', (e) => keys.keyup(e));

// ---------------- pause, restart, quit, settings
let paused = false;
const inMatch = () => match.phase === 'aim' || match.phase === 'ready' || match.phase === 'runup' || match.phase === 'flight';
function pause() {
  if (paused || !inMatch()) return;
  paused = true; pointer.cancel(); keys.release();
  audio.suspend();
  $('pauseEyebrow').textContent = match.mode === 'cup' ? `Paused · ${match.stageLabel}` : match.mode === 'practice' ? 'Paused · Practice' : match.mode === 'keeper' ? 'Paused · Keeper training' : 'Paused';
  $('pauseTitle').textContent = match.mode === 'practice' ? LESSONS[Math.min(practice.step, LESSONS.length - 1)].title
    : match.mode === 'keeper' ? STAGES[trainingStage.done ? STAGES.length - 1 : trainingStage.index].title : `${goals(match.you)} – ${goals(match.cpu)}`;
  $('restartBtn').firstChild.textContent = match.mode === 'practice' ? 'Restart practice ' : match.mode === 'keeper' ? 'Restart stage ' : 'Restart match ';
  const st = match.opp && match.opp.style && match.mode !== 'practice' && match.mode !== 'keeper' ? styleOf(match.opp.style) : null;
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
  sfx.hush(false);
  $('readyBtn').hidden = true; $('stepper').hidden = true; cornerHint.visible = false; stepping = 0;
  post = null; replays.clear(); shot = null; party = false;
  pointer.cancel();
  clearTimeout(endTimer);
  endReplayLook(); feedbackCard.hide(); clearBanner(); hint('');
  hud.diveMeter(null); hud.hideScout(); $('coach').hidden = true;
  keeper.cheer = null; keeper.pending = null; keeper.dive = null;
  striker.root.visible = false; taker.root.visible = false;
  net.bulges.length = 0;
  placeBall();
}
function restartMatch() {
  const o = match.opp;
  if (o.mode === 'practice') practice.step = 0;
  if (o.mode === 'keeper') { resume(); clearPitch(); return startTraining(trainingStage.done ? 0 : trainingStage.index); }
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
document.addEventListener('visibilitychange', () => { if (document.hidden && !devFrozen) pause(); });
window.addEventListener('blur', () => { if (!devFrozen) pause(); });

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
  if (match.phase === 'ready' && (k === ' ' || k === 'Enter')) { e.preventDefault(); startRunup(); return; }
  if (post) {
    if (k === ' ' || k === 'Enter') { e.preventDefault(); trySkip(); }
    else if (k === 'v') { e.preventDefault(); requestReplay(); }
    return;
  }
  keys.keydown(e, k);
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
  marker.visible = false; cornerHint.visible = false; pulse.sprite.visible = false;
  $('readyBtn').hidden = true; $('stepper').hidden = true;
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

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  cam.resize(w, h);
  pointer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
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
      stepping = 0;
      sfx.plant();
      const f = taker.root.position;
      burstConfetti(f.x + 0.15, 0.1, f.z, 0.15, 12, [0x2f6b35, 0x4d8a45, 0x6b5a3a], 2.4);
      match.plan = reconsider(match.plan, match.dive && match.dive.early ? match.dive : null, match.opp.style, level, rng, keeper.homeX);
    }
    if (match.timer >= RUNUP) cpuShoot();
  }
  if (match.turn === 'cpu' && (match.phase === 'runup' || match.phase === 'flight')) renderDiveMeter();
  updateStepping(dt);
  updateKeeperMarkers(dt);

  if (keeper.pending && shot) {
    keeper.pending.at -= sdt;
    if (keeper.pending.at <= 0) {
      const pd = keeper.pending; keeper.pending = null;
      const target = pd.kind === 'read' ? readDive(predictCrossing(ball, pd.readSpin), level, match.opp.style, rng) : { x: pd.x, y: pd.y };
      planDive(keeper, target.x, target.y, target.speed);
      sfx.dive();
      shot.keeper.target = target;
    }
  }
  updateKeyboard(dt);
  if (!replays.playing) updateKeeper(keeper, sdt, time);

  if (ball.moving) {
    const steps = Math.max(1, Math.ceil(sdt / (1 / 240)));
    const h = sdt / steps;
    for (let i = 0; i < steps; i++) {
      stepBall(ball, h);
      if (shot) coolDown(shot, h);
      collide();
    }
    ball.mesh.position.copy(ball.pos);
    ball.mesh.rotation.y += ball.spin * sdt;
    ball.mesh.rotation.x -= (ball.vel.z / R) * sdt * 0.15;
  }

  if (shot && !replays.playing) {
    shot.t += sdt;
    if (!shot.done) { const k = judge(shot, ball); if (k) resolve(k); }
  }
  if (replays.recording && !replays.playing && (match.phase === 'runup' || match.phase === 'flight') && (!post || post.t < 0.7)) {
    replays.record(sdt, keeper, match.turn === 'cpu' && match.phase === 'runup' ? match.timer : null);
  }
  if (post) updatePost(dt);

  if (party && Math.random() < dt * 1.6) firework(Math.random() < 0.5 ? 0xf2c230 : 0xffffff);
  if (party && Math.random() < dt * 0.6) burstConfetti(-13, 6, -11, 12, 120, GOLD, 8);
  updateConfetti(dt, time);
  updateFireworks(dt);
  updateFlashes(dt);
  updateNet(replays.playing ? dt * 0.5 : sdt);
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
  ballTracking.update(ball.pos, ball.moving && !replays.playing, 0.45 + 0.55 * keeperView, dt);
}
const quality = createQualityGovernor(Math.min(window.devicePixelRatio || 1, 2));
let pausedFrames = 0;
function frame(now) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  if (!paused && !devFrozen) tick(dt);
  // While paused the picture is still: draw a couple of frames, then rest.
  pausedFrames = paused ? pausedFrames + 1 : 0;
  if (pausedFrames < 3) {
    renderer.render(scene, camera);
    if (!devFrozen) {
      const ratio = quality.update(raw);
      if (ratio) { renderer.setPixelRatio(ratio); resize(); }
    }
  }
  pointer.draw(dt);
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
    // Average milliseconds for tick + render over n frames (rendering forced each frame).
    bench(n = 120) {
      const gl = renderer.getContext();
      let tickMs = 0, renderMs = 0;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now(); tick(1 / 60);
        const t1 = performance.now(); renderer.render(scene, camera); gl.finish();
        tickMs += t1 - t0; renderMs += performance.now() - t1;
      }
      const info = renderer.info.render;
      return { tick: +(tickMs / n).toFixed(2), render: +(renderMs / n).toFixed(2), calls: info.calls, triangles: info.triangles, dpr: renderer.getPixelRatio() };
    },
    get paused() { return paused; },
    dive: (x, y) => diveTo(x, y),
    get plan() { return match.plan && { ...match.plan }; },
    get training() { return trainingStage && { ...trainingStage }; },
    get homeX() { return keeper.homeX; },
    get camera() { return { pos: camera.position.toArray().map((v) => +v.toFixed(2)), fov: +camera.fov.toFixed(1), near: +camera.near.toFixed(2), aspect: +camera.aspect.toFixed(2), goal: cam.goal }; },
    get state() {
      return {
        phase: match.phase, turn: match.turn, mode: match.mode, you: [...match.you], cpu: [...match.cpu],
        post: post && { kind: post.kind, t: post.t }, replay: replays.playing, banner: $('bannerText').textContent,
        keeperDive: keeper.dive && { toX: keeper.dive.toX, t: keeper.dive.t }, ball: ball.pos.toArray(),
      };
    },
  };
}


// opening scene: both keepers hidden, the CPU keeper waiting on the line
hideKeeper(keepers.you); taker.root.visible = false;
keeper.active = true; poseKeeper(keeper);
placeBall();
startIntro();
requestAnimationFrame(frame);
}
