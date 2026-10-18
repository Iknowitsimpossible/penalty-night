// The animated (skinned) goalkeeper. It is only a picture: the game's keeper
// is still the simple body in people.js, which decides every save and runs
// in the headless simulator. Each frame this model reads that keeper and
// poses itself to match:
//   - standing and stepping: idle and side-step clips, blended by how fast
//     the keeper is moving, with the step clip played at the speed that
//     keeps its feet planted
//   - a dive: the dive clip for that side and height, sped up so full
//     stretch lands exactly when the game's dive does, with its sideways
//     travel scaled to cover the game's distance
//   - arm IK pins each glove onto the game's glove sphere, and the body is
//     nudged (while airborne) if a glove is out of the arm's reach
// So what you see is what the ball hits, without the art changing the rules.
import * as THREE from 'three';
import { KEEPER_Z, REACH } from '../core/constants.js';
import { DIVE_HOLD, DIVE_LAND } from './people.js';
import { extractRootMotion, sampleCurve, warpTime, measureDive } from './clip-tools.js';
import { solveTwoBone } from './ik.js';

// The clips the model needs, by role. step_L / dive_*_L move towards +x
// (the keeper's own left, since the keeper faces +z).
export const CLIP_ROLES = ['idle', 'step_L', 'step_R', 'dive_high_L', 'dive_high_R', 'dive_low_L', 'dive_low_R', 'catch', 'getup'];

const FADE_IN_DIVE = 0.12;   // seconds to blend from standing into a dive
const FADE_OUT = 0.3;        // seconds to blend back to standing
const PALM = 0.08;           // wrist to the middle of the glove (m)
const ELBOW_POLE = new THREE.Vector3(0, -1, -0.4).normalize();   // elbows point down and back
// Bones that can touch the grass, with how far their surface sits below the bone (m).
const GROUND_PARTS = [['LeftToeBase', 0.02], ['RightToeBase', 0.02], ['LeftFoot', 0.05], ['RightFoot', 0.05],
  ['LeftHand', 0.05], ['RightHand', 0.05], ['LeftHandMiddle1', 0.05], ['RightHandMiddle1', 0.05],   // with the gloves on
  ['Head', 0.11], ['Hips', 0.11], ['Spine2', 0.12], ['LeftLeg', 0.06], ['RightLeg', 0.06]];

// Kit meshes in the Mixamo footballer, and which kit colour each takes.
const KIT_PARTS = [[/Shirt$/, 'shirt'], [/Shorts$/, 'shorts'], [/Socks$/, 'socks']];

// Find a bone by the end of its name: Mixamo prefixes vary (mixamorig5Hips,
// mixamorig:Hips), and the GLB export will name them its own way.
function findBone(root, suffix) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.isBone && (o.name === suffix || o.name.endsWith(suffix) && !/[A-Za-z]$/.test(o.name.slice(0, -suffix.length)))) hit = o; });
  if (!hit) throw new Error(`keeper model: no bone ending in "${suffix}"`);
  return hit;
}

// character: a loaded Object3D with skinned meshes. clips: { role: AnimationClip }.
export function createKeeperModel(scene, character, clips) {
  const root = character;
  // Mixamo FBX comes in centimetres with nothing to say so; the GLB carries
  // its own 0.01 scale on the skeleton. Either way the body should be about
  // 1.8 m tall.
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.scale.setScalar(size.y > 10 ? 0.01 : 1);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);

  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;   // the bind-pose bounds don't follow a dive
    o.material = [].concat(o.material).map((m) => {
      // A GLB's materials are already physically based (and set up for its
      // normal maps); FBX ones are not, so those are rebuilt.
      if (m.isMeshStandardMaterial) {
        Object.assign(m, { roughness: 0.8, metalness: 0, skinning: true });
        return m;
      }
      if (m.map) m.map.encoding = THREE.sRGBEncoding;
      return new THREE.MeshStandardMaterial({
        map: m.map || null, normalMap: m.normalMap || null, color: m.map ? 0xffffff : m.color, roughness: 0.8, metalness: 0, skinning: true,
        transparent: m.transparent, alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite,   // hair cards are cut out
      });
    });
    if (o.material.length === 1) o.material = o.material[0];
  });

  const bone = {};
  for (const n of ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', ...GROUND_PARTS.map((p) => p[0])]) bone[n] = findBone(root, n);
  const armLength = (side) => segment(side + 'Arm', side + 'ForeArm') + segment(side + 'ForeArm', side + 'Hand');
  function segment(a, b) {
    root.updateMatrixWorld(true);
    return bone[a].getWorldPosition(new THREE.Vector3()).distanceTo(bone[b].getWorldPosition(new THREE.Vector3()));
  }
  const reach = { Left: armLength('Left'), Right: armLength('Right') };

  // Root motion out of every clip, then measure the dives.
  const info = {};
  for (const role of CLIP_ROLES) {
    const clip = clips[role];
    if (!clip) throw new Error(`keeper model: missing clip "${role}"`);
    clip.name = role;
    info[role] = { clip, curve: extractRootMotion(clip, bone.Hips.name, bone.Hips.parent.matrixWorld) };
  }
  for (const role of ['dive_high_L', 'dive_high_R', 'dive_low_L', 'dive_low_R', 'catch']) {
    const side = role.endsWith('_L') ? 1 : role.endsWith('_R') ? -1 : 0;
    Object.assign(info[role], measureDive(root, info[role].clip, { hips: bone.Hips, leftHand: bone.LeftHand, rightHand: bone.RightHand, leftFoot: bone.LeftFoot, rightFoot: bone.RightFoot }, side, info[role].curve));
  }
  for (const role of ['step_L', 'step_R']) {
    const { clip, curve } = info[role];
    info[role].speed = Math.abs(sampleCurve(curve, 'x', clip.duration)) / clip.duration;   // m/s
  }

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const role of CLIP_ROLES) {
    const a = mixer.clipAction(info[role].clip);
    a.play(); a.setEffectiveWeight(0);
    actions[role] = a;
  }
  scene.add(root);

  // Gloves: the Mixamo body has bare hands. Each glove is a flattened
  // ellipsoid over the hand plus a strap at the wrist, parented to the hand
  // bone so the animation (and the arm IK) carries it. Hand bones point
  // their y axis along the fingers, x through the palm, z across it. The
  // glove's middle sits PALM along the fingers, where the game's glove
  // sphere is aimed.
  const gloves = ['Left', 'Right'].map((side) => {
    const hand = bone[side + 'Hand'];
    const s = 1 / hand.getWorldScale(new THREE.Vector3()).x;   // metres -> the bone's units
    const mat = () => new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.55, metalness: 0 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat());
    palm.scale.set(0.042 * s, 0.11 * s, 0.07 * s);
    palm.position.set(0, PALM * s, 0);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.048 * s, 0.045 * s, 16), mat());
    strap.position.set(0, 0.01 * s, 0);
    for (const mesh of [palm, strap]) { mesh.castShadow = true; hand.add(mesh); }
    return { palm, strap };
  });

  // What is playing: role -> { t, w }. Poses are built from this, so a replay
  // can store it and pose the model again later.
  let mix = { idle: { t: 0, w: 1 } };
  let fadeFrom = null;   // { mix, a, dur } while blending between two mixes
  const m = {
    x: 0, z: KEEPER_Z, vx: 0, vz: 0, dive: null, ikWeight: 0, corrWeight: 0, corr: new THREE.Vector3(),
    lastIkError: 0, body: null, usedRoot: new THREE.Vector3(), k: null, played: null,
  };

  function blendTo(dur) { fadeFrom = { mix: currentMix(), a: 0, dur }; }
  function currentMix() {
    if (!fadeFrom) return mix;
    const out = {}, e = fadeFrom.a * fadeFrom.a * (3 - 2 * fadeFrom.a);
    for (const [r, v] of Object.entries(fadeFrom.mix)) out[r] = { t: v.t, w: v.w * (1 - e) };
    for (const [r, v] of Object.entries(mix)) out[r] = out[r] ? { t: v.t, w: out[r].w + v.w * e } : { t: v.t, w: v.w * e };
    return out;
  }
  const clampTime = (role, t) => {
    const d = info[role].clip.duration;
    return role === 'idle' || role.startsWith('step') ? ((t % d) + d) % d : Math.min(Math.max(t, 0), d - 1e-3);
  };

  // Pose the skeleton from a mix, place the root, keep it out of the grass,
  // hold planted feet still and pin the gloves. Shared by live play and replays.
  //   corr: { solve: weight } to move the body towards gloves it can't reach,
  //         or { fixed: Vector3 } to apply a known shift (fading one out, replays)
  const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _need = new THREE.Vector3(), _g = new THREE.Vector3();
  function pose(mixNow, rootPos, ikWeight, corr, gloves, dt) {
    for (const role of CLIP_ROLES) {
      const v = mixNow[role];
      const a = actions[role];
      a.setEffectiveWeight(v ? v.w : 0);
      if (v) a.time = clampTime(role, v.t);
    }
    mixer.update(0);
    root.position.copy(rootPos);
    root.updateMatrixWorld(true);

    const targets = gloves && ikWeight > 0 ? wristTargets(gloves) : null;
    // A glove the arm cannot reach moves the whole body towards it (only
    // during the airborne part of a dive, where nobody can see feet slide).
    m.corr.set(0, 0, 0);
    if (corr.fixed) {
      m.corr.copy(corr.fixed);
    } else if (targets && corr.solve > 0) {
      for (let pass = 0; pass < 2; pass++) {
        _need.set(0, 0, 0);
        for (const side of ['Left', 'Right']) {
          bone[side + 'Arm'].getWorldPosition(_s);
          _d.subVectors(targets[side], _s);
          const over = _d.length() - reach[side] * 0.97;
          if (over > 0 && over > _need.length()) _need.copy(_d.normalize().multiplyScalar(over));
        }
        if (_need.lengthSq() === 0) break;
        _need.multiplyScalar(corr.solve);
        m.corr.add(_need);
        root.position.add(_need);
        root.updateMatrixWorld(true);
      }
    }
    if (corr.fixed) { root.position.add(m.corr); root.updateMatrixWorld(true); }
    // Nothing below the grass.
    let low = Infinity;
    for (const [n, r] of GROUND_PARTS) low = Math.min(low, bone[n].getWorldPosition(_g).y - r);
    if (low < 0) { root.position.y -= low; root.updateMatrixWorld(true); }
    m.usedRoot.copy(root.position);

    lockFeet(dt);

    let err = 0;
    if (targets) {
      for (const side of ['Left', 'Right']) {
        const e = solveTwoBone(bone[side + 'Arm'], bone[side + 'ForeArm'], bone[side + 'Hand'], wristTargetsFor(side, gloves), ELBOW_POLE, ikWeight);
        err = Math.max(err, e || 0);
      }
    }
    m.lastIkError = ikWeight >= 1 ? err : 0;
  }

  // Foot locking. Motion capture (and playing it faster) lets a planted foot
  // creep along the grass. While a foot is planted, hold its toe where it
  // touched down: the clip still rolls the foot (heel up on push-off, toes
  // down getting up), so the ankle is aimed at "the pinned toe plus the
  // clip's ankle-to-toe offset" with leg IK (hip -> knee -> ankle), and the
  // foot keeps the clip's angle. When the clip lifts the foot, let go over a
  // few frames; it can lock again only after it has been lifted (re-locking
  // straight away would snap it to wherever the clip has it).
  // A toe the clip drags along the grass (the get-up does) is lifted a
  // little instead, so it steps rather than skates.
  const feet = ['Left', 'Right'].map((side) => ({ side, locked: false, armed: true, toe: new THREE.Vector3(), w: 0, lift: 0, last: null }));
  const KNEE_POLE = new THREE.Vector3(0, 0, 1);   // knees point at the taker
  const LIFTED = 0.06, DRAG_SPEED = 0.6, CLEARANCE = 0.07;
  const _fq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _toe = new THREE.Vector3(), _ankle = new THREE.Vector3();
  function lockFeet(dt) {
    for (const f of feet) {
      const foot = bone[f.side + 'Foot'];
      foot.getWorldPosition(_ankle);
      bone[f.side + 'ToeBase'].getWorldPosition(_toe);
      // how fast the clip itself is moving this toe along the grass
      const speed = f.last && dt > 0 ? Math.hypot(_toe.x - f.last.x, _toe.z - f.last.z) / dt : 0;
      f.last = (f.last || new THREE.Vector3()).copy(_toe);
      const low = _toe.y < 0.045 && _ankle.y < 0.2;
      if (_toe.y > LIFTED) f.armed = true;
      if (low && !f.locked && f.armed && speed < DRAG_SPEED * 2) { f.locked = true; f.armed = false; f.toe.copy(_toe); f.toe.y = Math.max(f.toe.y, 0.02); }
      if (f.locked && (_toe.y > LIFTED || Math.hypot(_toe.x - f.toe.x, _toe.z - f.toe.z) > 0.25)) f.locked = false;
      f.w = f.locked ? 1 : Math.max(0, f.w - dt / 0.1);
      const dragging = !f.locked && _toe.y < CLEARANCE && speed > DRAG_SPEED;
      f.lift = dragging ? Math.min(1, f.lift + dt / 0.06) : Math.max(0, f.lift - dt / 0.12);
      if (f.w <= 0 && f.lift <= 0) continue;
      foot.getWorldQuaternion(_fq);
      let target;
      if (f.w > 0) {
        target = _ankle.clone().sub(_toe).add(f.toe);   // keeps the clip's foot roll
        if (f.w < 1) target.lerp(_ankle, 1 - f.w);
      } else {
        target = _ankle.clone();
      }
      if (f.lift > 0) target.y += Math.max(0, CLEARANCE - _toe.y) * f.lift;
      solveTwoBone(bone[f.side + 'UpLeg'], bone[f.side + 'Leg'], foot, target, KNEE_POLE, 1);
      // keep the foot at the angle the clip had it
      foot.parent.getWorldQuaternion(_pq);
      foot.quaternion.copy(_pq.invert().multiply(_fq));
      foot.updateMatrixWorld(true);
    }
  }
  function unlockFeet() { for (const f of feet) { f.locked = false; f.armed = true; f.w = 0; f.lift = 0; f.last = null; } }

  // The game's gloves are spheres around the middle of the glove; the IK
  // moves the wrist, so aim the wrist a palm's length short of the centre.
  // gloves[0] is on the -x side: the keeper's right hand.
  function wristTargetsFor(side, gloves) {
    const g = side === 'Right' ? gloves[0] : gloves[1];
    g.getWorldPosition(_t);
    bone[side + 'Arm'].getWorldPosition(_s);
    return _t.clone().addScaledVector(_d.subVectors(_t, _s).normalize(), -PALM);
  }
  function wristTargets(gloves) {
    const out = {};
    for (const [side, g] of [['Right', gloves[0]], ['Left', gloves[1]]]) {
      g.getWorldPosition(_t);
      bone[side + 'Arm'].getWorldPosition(_s);
      out[side] = _t.clone().addScaledVector(_d.subVectors(_t, _s).normalize(), -PALM);
    }
    return out;
  }

  function startDive(k) {
    const d = k.dive;
    const big = Math.abs(d.tilt) > 0.5;
    const low = Math.abs(d.tilt) > 1.1;   // planDive tilts low dives nearly flat
    const role = !big ? 'catch' : `dive_${low ? 'low' : 'high'}_${d.side > 0 ? 'L' : 'R'}`;
    const it = info[role];
    // Place the body so that, at full stretch, the clip's hands are where
    // the game's gloves will be. (The game's dive pivots a straight body
    // about the feet, so its gloves end REACH up the tilted body from them;
    // its hips hardly move, so matching hips would be wrong.) The clip's own
    // travel is scaled towards that; whatever scaling can't cover is added
    // gradually while the keeper is airborne.
    const gloveX = d.toX + REACH * Math.sin(d.tilt);
    const want = gloveX - it.handOff - m.x;   // hips travel needed by full stretch
    const travel = it.reach;
    const s = Math.abs(travel) > 0.05 ? THREE.MathUtils.clamp(want / travel, 0.5, 1.6) : 0;
    m.dive = {
      ref: d, role, t: 0, s, startX: m.x, extra: want - s * travel,
      // The clips also travel forward (up to 1 m by full stretch). The game's
      // gloves stay on the line, so take that out while airborne; the landing
      // keeps its forward roll from there.
      startZ: m.z, dropZ: sampleCurve(it.curve, 'z', it.stretch) + (m.z - KEEPER_Z),
      keys: [[0, it.start], [d.dur, it.stretch], [d.dur + DIVE_HOLD, it.stretch + DIVE_HOLD * 0.6]],
      ikUntil: d.dur + DIVE_HOLD, ikFade: big ? DIVE_LAND : 0.3,
    };
    blendTo(FADE_IN_DIVE);
  }

  // Carry on standing from wherever the dive left the body. The blend starts
  // from the pose being shown, so take that before switching.
  function endDive(dur) {
    blendTo(dur);
    m.vx = 0; m.vz = 0; m.dive = null;
    mix = { idle: { t: 0, w: 1 } };
  }

  const rootPos = new THREE.Vector3();
  const model = {
    root,
    info,
    get state() { return { mode: m.dive ? m.dive.role : 'standing', x: m.x, ik: m.ikWeight, ikError: m.lastIkError, corr: m.corr.length() }; },
    bones: bone,
    // What was measured from each clip (seconds, metres): for checking in development.
    get clips() {
      const r2 = (v) => (v === undefined ? undefined : +v.toFixed(2));
      return Object.fromEntries(CLIP_ROLES.map((r) => [r, { dur: r2(info[r].clip.duration), stretch: r2(info[r].stretch), ground: r2(info[r].ground), start: r2(info[r].start), handOff: r2(info[r].handOff), travel: r2(info[r].reach !== undefined ? info[r].reach : undefined), speed: r2(info[r].speed) }]));
    },
    // The game body this model stands in for. Its meshes are hidden; its
    // gloves and visibility still drive the model.
    // kit: { shirt, shorts, socks, gloves } colours, as in people.js KITS.
    attach(body, kit) {
      m.body = body;
      body.root.traverse((o) => { if (o.isMesh) o.visible = false; });
      if (kit) model.setKit(kit);
    },
    // Team colours. The kit meshes have a white texture with the folds and
    // shading in it; each gets its own copy of the material with the team
    // colour multiplied over that texture.
    setKit(kit) {
      root.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const part = KIT_PARTS.find(([re]) => re.test(o.name));
        if (!part) return;
        if (!o.userData.ownMaterial) { o.material = o.material.clone(); o.userData.ownMaterial = true; }
        o.material.color.setHex(kit[part[1]]);
      });
      for (const g of gloves) {
        g.palm.material.color.setHex(kit.gloves || 0xf4f4f4);
        g.strap.material.color.setHex(kit.shirt);
      }
    },
    // k: the game's keeper when it uses the attached body, otherwise null.
    update(k, dt) {
      const wasVisible = root.visible;
      root.visible = m.body.root.visible;
      if (!root.visible || !k) return;
      if (!wasVisible) {
        // Coming back on screen: start where the game's keeper is, standing.
        m.x = k.x; m.z = KEEPER_Z; m.vx = 0; m.vz = 0; m.dive = null; fadeFrom = null; unlockFeet();
        mix = { idle: { t: 0, w: 1 } };
      }
      if (fadeFrom) { fadeFrom.a = Math.min(1, fadeFrom.a + dt / fadeFrom.dur); if (fadeFrom.a >= 1) fadeFrom = null; }

      // A new kick (a new keeper object) while a dive is still playing, as in
      // practice: blend back to standing and step home from where it is.
      if (k !== m.k) { m.k = k; if (m.dive && m.dive.ref !== k.dive) endDive(0.5); }
      // Each dive plays once: the game keeps its dive plan after the clip ends.
      if (k.dive && k.dive !== m.played) { m.played = k.dive; startDive(k); }
      let y = 0;
      if (m.dive) {
        const dv = m.dive;
        dv.t = dv.ref === k.dive ? k.dive.t : dv.t + dt;   // the game clock while it lasts
        const ct = warpTime(dv.t, dv.keys);
        const it = info[dv.role];
        mix = { [dv.role]: { t: ct, w: 1 } };
        // airborne: 0 at take-off, 1 at full stretch (smoothstep), so the extra
        // shift and any reach correction happen with the feet off the grass
        const air = THREE.MathUtils.smoothstep(ct, it.start + 0.35 * (it.stretch - it.start), it.stretch);
        // The clip's own travel at its own size while the feet push off (any
        // other size would make them skate); scaled once airborne.
        const scale = 1 + (dv.s - 1) * air;
        const x = dv.startX + scale * sampleCurve(it.curve, 'x', ct) + dv.extra * air;
        const z = dv.startZ + sampleCurve(it.curve, 'z', ct) - dv.dropZ * air;
        rootPos.set(x, 0, z);
        m.x = x; m.z = z;   // so a dive that starts before this one ends starts from here
        // The arms are pinned to the game's gloves once the push-off is under
        // way, and let go after the hold so the landing is the clip's own.
        const ikIn = THREE.MathUtils.smoothstep(ct, it.start, it.start + 0.6 * (it.stretch - it.start));
        m.ikWeight = dv.t < dv.ikUntil ? ikIn : Math.max(0, 1 - (dv.t - dv.ikUntil) / dv.ikFade) * ikIn;
        m.corrWeight = Math.min(air, m.ikWeight);
        // While the gloves matter the shift is solved each frame; after the
        // hold it is frozen and faded out, so it can't jump about.
        if (dv.t < dv.ikUntil) { m.corrMode = { solve: m.corrWeight }; dv.frozen = null; }
        else {
          if (!dv.frozen) dv.frozen = m.corr.clone();
          m.corrMode = { fixed: _g.copy(dv.frozen).multiplyScalar(Math.max(0, 1 - (dv.t - dv.ikUntil) / dv.ikFade)) };
        }
        if (ct >= it.clip.duration - 0.02) endDive(FADE_OUT);   // back on its feet
      }
      if (!m.dive) {
        // Follow the game's keeper (and come back to the line after a dive)
        // like a critically damped spring, and step at the speed that keeps
        // the feet planted.
        const w = 10, bx = m.x, bz = m.z;
        m.vx = THREE.MathUtils.clamp(m.vx + (w * w * (k.x - m.x) - 2 * w * m.vx) * dt, -3, 3);
        m.vz = THREE.MathUtils.clamp(m.vz + (w * w * (KEEPER_Z - m.z) - 2 * w * m.vz) * dt * 0.25, -1.2, 1.2);
        m.x += m.vx * dt; m.z += m.vz * dt;
        const vx = dt > 0 ? (m.x - bx) / dt : 0, vz = dt > 0 ? (m.z - bz) / dt : 0;
        const v = Math.hypot(vx, vz) * (vx < 0 ? -1 : 1);
        const stepW = THREE.MathUtils.clamp(Math.abs(v) / 0.6, 0, 1);
        const stepRole = v > 0 ? 'step_L' : 'step_R';
        const prev = mix;
        mix = {
          idle: { t: (prev.idle ? prev.idle.t : 0) + dt, w: 1 - stepW },
          step_L: { t: (prev.step_L ? prev.step_L.t : 0) + (stepRole === 'step_L' ? dt * Math.abs(v) / info.step_L.speed : 0), w: stepRole === 'step_L' ? stepW : 0 },
          step_R: { t: (prev.step_R ? prev.step_R.t : 0) + (stepRole === 'step_R' ? dt * Math.abs(v) / info.step_R.speed : 0), w: stepRole === 'step_R' ? stepW : 0 },
        };
        if (k.cheer) y = k.y;   // celebration hops
        rootPos.set(m.x, y, m.z);
        m.ikWeight = 0; m.corrWeight = 0; m.corrMode = { solve: 0 };
      }
      pose(currentMix(), rootPos, m.ikWeight, m.corrMode, m.body.gloves, dt);
    },
    // Replays: what to store each frame, and posing from two stored frames.
    capture() {
      if (!root.visible) return null;
      const now = currentMix(), acts = [];
      for (const [r, v] of Object.entries(now)) if (v.w > 0.001) acts.push([r, clampTime(r, v.t), v.w]);
      return { acts, p: m.usedRoot.toArray(), ik: m.ikWeight };
    },
    applyCaptured(a, b, u, dt = 1 / 120) {
      if (!a) return;
      b = b || a;
      const out = {};
      for (const [r, t, w] of a.acts) out[r] = { t, w: w * (1 - u) };
      for (const [r, t, w] of b.acts) {
        if (!out[r]) { out[r] = { t, w: w * u }; continue; }
        const looping = r === 'idle' || r.startsWith('step');
        const ta = out[r].t, gap = t - ta;
        // loop clips may wrap between frames: take the short way round
        out[r] = { t: looping && Math.abs(gap) > info[r].clip.duration / 2 ? t : ta + gap * u, w: out[r].w + w * u };
      }
      rootPos.fromArray(a.p).lerp(_g.fromArray(b.p), u);
      pose(out, rootPos, a.ik + (b.ik - a.ik) * u, { fixed: _need.set(0, 0, 0) }, m.body.gloves, dt);
    },
  };
  return model;
}

// Load the keeper. Either one GLB holding the character and every clip as a
// named animation (built by scripts/build-keeper-glb.py), or the raw Mixamo
// FBX files: { character: url, clips: { role: url } }.
export async function loadKeeperModel(scene, files) {
  if (typeof files === 'string') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(files);
    const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    return createKeeperModel(scene, gltf.scene, clips);
  }
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const roles = Object.keys(files.clips);
  const [character, ...clipFiles] = await Promise.all([files.character, ...roles.map((r) => files.clips[r])].map((u) => loader.loadAsync(u)));
  const clips = {};
  roles.forEach((r, i) => { clips[r] = clipFiles[i].animations[0]; });
  return createKeeperModel(scene, character, clips);
}
