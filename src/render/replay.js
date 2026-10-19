// Replays. While a kick is live, every frame stores where the ball, the
// keeper and the taker are (plus net bulges). Playback runs those frames at
// half speed from a low side camera on the side the ball went.
import { R, SPOT_Z, RUNUP } from '../core/constants.js';
import { clamp, lerp } from '../core/math.js';

const MAX_FRAMES = 900;

// deps: { ball, poseKeeper, animateRunup, bulgeNet, cam, reduced: () => bool,
//         captureModel(keeper), poseModel(a, b, u) } (the last two optional: the animated keeper)
export function createReplays(deps) {
  const { ball, poseKeeper, animateRunup, bulgeNet, cam } = deps;
  let rec = null, play = null;

  const snapshot = (t, keeper, tk) => ({
    t, b: [ball.pos.x, ball.pos.y, ball.pos.z], q: ball.mesh.quaternion.clone(),
    k: [keeper.x, keeper.y, keeper.tilt, keeper.arms], tk,
    m: deps.captureModel ? deps.captureModel(keeper) : null,
  });

  return {
    get recording() { return !!rec; },
    get playing() { return !!play; },
    get mine() { return rec && rec.mine; },
    canPlay: () => !!(rec && rec.frames.length > 20),

    // mine: your kick (you are never seen running up while aiming, so the
    // replay adds that run-up in front). taker: the body that kicks.
    start(mine, keeper, taker) {
      rec = { mine, frames: [], events: [], t: 0, taker };
      if (mine) {
        for (let t = 0; t < RUNUP; t += 1 / 60) {
          const f = snapshot(t, keeper, t);
          f.b = [0, R, SPOT_Z];
          rec.frames.push(f);
        }
        rec.t = RUNUP;
      }
    },
    // runupTimer: the CPU taker's run-up clock, or null once the ball is struck.
    record(sdt, keeper, runupTimer) {
      if (!rec) return;
      rec.t += sdt;
      rec.frames.push(snapshot(rec.t, keeper, runupTimer ?? RUNUP + 0.01));
      if (rec.frames.length > MAX_FRAMES) rec.frames.shift();
    },
    noteNet(at, dir, s) { if (rec && !play) rec.events.push({ t: rec.t, at: at.clone(), dir: dir.clone(), s }); },

    begin(keeper) {
      const fr = rec.frames, last = fr[fr.length - 1];
      play = { t: fr[0].t, end: last.t, i: 0, ev: 0, side: Math.sign(last.b[0]) || 1 };
      rec.taker.root.position.y = 0;
      this.update(0, keeper);
      cam.snap();
    },
    // Advances playback; returns true when it has finished.
    update(dt, keeper) {
      play.t += dt * 0.5;
      const fr = rec.frames;
      while (play.i < fr.length - 1 && fr[play.i + 1].t <= play.t) play.i++;
      const a = fr[play.i], b = fr[Math.min(play.i + 1, fr.length - 1)];
      const u = b.t > a.t ? clamp((play.t - a.t) / (b.t - a.t), 0, 1) : 0;
      ball.pos.set(lerp(a.b[0], b.b[0], u), lerp(a.b[1], b.b[1], u), lerp(a.b[2], b.b[2], u));
      ball.mesh.position.copy(ball.pos);
      ball.mesh.quaternion.copy(a.q).slerp(b.q, u);
      keeper.x = lerp(a.k[0], b.k[0], u); keeper.y = lerp(a.k[1], b.k[1], u);
      keeper.tilt = lerp(a.k[2], b.k[2], u); keeper.arms = lerp(a.k[3], b.k[3], u);
      poseKeeper(keeper);
      if (deps.poseModel) deps.poseModel(a.m, b.m, u);
      animateRunup(rec.taker, lerp(a.tk, b.tk, u));
      while (play.ev < rec.events.length && rec.events[play.ev].t <= play.t) {
        const e = rec.events[play.ev++];
        bulgeNet(e.at, e.dir, e.s);
      }
      if (deps.reduced()) {
        // a fixed side view instead of following the ball
        cam.wantPos.set(play.side * 9, 1.6, 5.5); cam.wantLook.set(play.side * 0.8, 1, 4);
      } else {
        cam.wantPos.set(play.side * 8.2, 1.2, lerp(6.5, 3.2, clamp((SPOT_Z - ball.pos.z) / SPOT_Z, 0, 1)));
        cam.wantLook.set(ball.pos.x * 0.8, Math.max(0.7, ball.pos.y), ball.pos.z);
      }
      return play.t >= play.end + 0.4;
    },
    clear() { rec = null; play = null; },
  };
}
