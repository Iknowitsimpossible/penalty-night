// The 2D renderer: one canvas, one pinhole camera per view (views.js).
// Each frame copies the baked stadium for the current view, then paints
// shadows, and then the players, ball, net and frame from far to near
// (the painter's algorithm), then markers and effects on top.
import { viewCamera } from './views.js';
import { project } from './projection.js';
import { bakeStadium, drawNet, drawFrame, drawTowers } from './stadium.js';
import { bodyPose, kitFor, drawShadedFigure } from './figures.js';
import { drawBall, drawBallShadow, drawGroundShadow } from './ball.js';

const _p = { x: 0, y: 0, s: 0, d: 0 };
const depth = (cam, x, y, z) => (x - cam.eye.x) * cam.fwd[0] + (y - cam.eye.y) * cam.fwd[1] + (z - cam.eye.z) * cam.fwd[2];

export function createRenderer2D(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 1, h = 1, dpr = 1;
  let view = 'menu', cam = viewCamera(view, w, h);
  let cpuColor = '#2fc6b4';
  const bakes = new Map();

  // The stadium for this view, size and opponent, painted once (stadium.js).
  const bakeKey = () => `${view}|${w}x${h}@${dpr}|${cpuColor}`;
  function background() {
    const key = bakeKey();
    let b = bakes.get(key);
    if (!b) {
      if (bakes.size > 6) bakes.clear();
      b = bakeStadium(cam, w, h, dpr, { view, cpuColor });
      bakes.set(key, b);
    }
    return b;
  }

  // The stands: still, or (while an end cheers) without their crowd, which
  // is then stamped back in small pieces that bob on their own beats.
  function stands(b, f, jx, jy) {
    const cheer = f.cheer || { you: 0, cpu: 0 };
    if (Math.max(cheer.you, cheer.cpu) < 0.01) {
      ctx.drawImage(b.back, jx - 2, jy - 2, w + 4, h + 4);   // a little bleed so a shake shows no edge
      return;
    }
    ctx.drawImage(b.bare, jx - 2, jy - 2, w + 4, h + 4);
    const t = f.time || 0;
    for (const tile of b.tiles) {
      const amt = tile.side === 'you' ? cheer.you : cheer.cpu;
      const hop = Math.max(0, Math.sin(t * 11 + tile.phase)) * 0.28 * amt * tile.s;
      ctx.drawImage(tile.canvas, tile.x + jx, tile.y + jy - hop, tile.w, tile.h);
    }
  }

  // A ring in the goal mouth: the keyboard target, the hover preview, the dive pulse.
  function ring(m) {
    const p = project(cam, m.x, m.y, m.z, _p);
    if (!p) return;
    const r = (m.size / 2) * p.s * (1 - 12 / 128 * 2);
    ctx.globalAlpha = m.opacity ?? 1;
    ctx.strokeStyle = m.color; ctx.lineWidth = Math.max(1.5, m.size * p.s * 9 / 128);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    if (m.dot) { ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, m.size * p.s * 9 / 128), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  return {
    get camera() { return cam; },
    get view() { return view; },
    get size() { return { w, h, dpr }; },
    setView(name) { if (name !== view) { view = name; cam = viewCamera(view, w, h); } },
    setCpuColor(hex) { cpuColor = hex; },
    rebake() { bakes.clear(); },
    resize(cw, ch, ratio) {
      // A hidden container reports 0x0; keep the last good size.
      if (!(cw > 0 && ch > 0)) return;
      w = cw; h = ch; dpr = ratio;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      bakes.clear();
      cam = viewCamera(view, w, h);
    },

    // f: { time, cheer: { you, cpu }, towers: [{ shown, flare }], figures: [{ body, role, fwd, kneeOut }], ball: { pos, roll, visible }, net,
    //      goalFade (0..1: the goal is in front of the camera, so it fades), markers: [...], shake: [dx, dy], under(ctx, cam), over(ctx, cam) }
    render(f) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      const [jx, jy] = f.shake || [0, 0];
      const b = background();
      stands(b, f, jx, jy);
      ctx.drawImage(b.front, jx - 2, jy - 2, w + 4, h + 4);
      ctx.translate(jx, jy);
      // floodlights: the stadium is dark until they are on (the title sequence)
      const towers = f.towers || [];
      const lit = towers.length ? towers.reduce((a, t) => a + t.shown, 0) / towers.length : 1;
      if (lit < 0.999) { ctx.globalAlpha = (1 - lit) * 0.72; ctx.fillStyle = '#02040c'; ctx.fillRect(-4, -4, w + 8, h + 8); ctx.globalAlpha = 1; }
      drawTowers(ctx, cam, towers);
      if (f.under) f.under(ctx, cam);

      // gather everything that has to be sorted by distance
      const items = [];
      for (const fig of f.figures) {
        if (!fig.body.root.visible) continue;
        const bp = bodyPose(fig.body, cam, fig);
        if (!bp) continue;
        items.push({ d: bp.depth, draw: () => drawShadedFigure(ctx, bp.pose, kitFor(fig.body, fig.role), bp.ox, bp.oy, bp.px, { back: bp.back, face: bp.face, faceDir: bp.faceDir, light: 1 }, dpr) });
        // two soft shadows, one per floodlight bank; fainter when the body is in the air
        const fade = 1 / (1 + bp.foot.lift * 3);
        drawGroundShadow(ctx, cam, bp.foot.x, bp.foot.z, bp.foot.half + 0.22, 0.3, 0.38 * fade);
        drawGroundShadow(ctx, cam, bp.foot.x + 0.7, bp.foot.z - 0.4, bp.foot.half + 0.18, 0.24, 0.2 * fade);
      }
      const ball = f.ball;
      if (ball && ball.visible !== false) {
        drawBallShadow(ctx, cam, ball.pos);
        items.push({ d: depth(cam, ball.pos.x, ball.pos.y, ball.pos.z), draw: () => drawBall(ctx, cam, ball.pos, ball.roll) });
      }
      const fade = f.goalFade || 0;
      items.push({ d: depth(cam, 0, 1.2, -1.6), draw: () => drawNet(ctx, cam, f.net, 1 - 0.76 * fade) });
      items.push({ d: depth(cam, 0, 1.2, 0), draw: () => drawFrame(ctx, cam, 1 - 0.65 * fade) });
      items.sort((a, c) => c.d - a.d);
      for (const it of items) it.draw();

      for (const m of f.markers || []) if (m.visible) ring(m);
      if (f.over) f.over(ctx, cam);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
}
