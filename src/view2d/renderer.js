// The 2D renderer: one canvas, one pinhole camera per view (views.js).
// Each frame copies the baked stadium for the current view, then paints
// shadows, and then the players, ball, net and frame from far to near
// (the painter's algorithm), then markers and effects on top.
import { viewCamera } from './views.js';
import { project } from './projection.js';
import { bakeStadium, drawNet, drawFrame } from './stadium.js';
import { bodyPose, kitFor, drawShadedFigure } from './figures.js';
import { drawBall, drawBallShadow, drawGroundShadow } from './ball.js';

const _p = { x: 0, y: 0, s: 0, d: 0 };
const depth = (cam, x, y, z) => (x - cam.eye.x) * cam.fwd[0] + (y - cam.eye.y) * cam.fwd[1] + (z - cam.eye.z) * cam.fwd[2];

export function createRenderer2D(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 1, h = 1, dpr = 1;
  let view = 'menu', cam = viewCamera(view, w, h);
  let cpuColor = '#2fc6b4', lights = 1;
  const bakes = new Map();

  const bakeKey = () => `${view}|${w}x${h}@${dpr}|${cpuColor}|${lights > 0.5 ? 1 : 0}`;
  function background() {
    const key = bakeKey();
    let b = bakes.get(key);
    if (!b) {
      if (bakes.size > 8) bakes.clear();
      b = bakeStadium(cam, w, h, dpr, { view, cpuColor, lights });
      bakes.set(key, b);
    }
    return b;
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
    setLights(on) { lights = on; },
    rebake() { bakes.clear(); },
    resize(cw, ch, ratio) {
      // A hidden container reports 0x0; keep the last good size.
      if (!(cw > 0 && ch > 0)) return;
      w = cw; h = ch; dpr = ratio;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      bakes.clear();
      cam = viewCamera(view, w, h);
    },

    // f: { figures: [{ body, role, fwd, kneeOut }], ball: { pos, roll, visible }, net,
    //      goalFade (0..1: the goal is in front of the camera, so it fades), markers: [...], shake: [dx, dy], under(ctx, cam), over(ctx, cam) }
    render(f) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      const [jx, jy] = f.shake || [0, 0];
      ctx.drawImage(background(), jx - 2, jy - 2, w + 4, h + 4);   // a little bleed so a shake shows no edge
      ctx.translate(jx, jy);
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
      const b = f.ball;
      if (b && b.visible !== false) {
        drawBallShadow(ctx, cam, b.pos);
        items.push({ d: depth(cam, b.pos.x, b.pos.y, b.pos.z), draw: () => drawBall(ctx, cam, b.pos, b.roll) });
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
