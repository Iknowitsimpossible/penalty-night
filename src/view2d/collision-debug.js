// Development only (loaded from game.js under import.meta.env.DEV, so it is
// never part of a production build). Press C to see what the physics sees:
// the keeper's collision spheres, the posts and bar, and the ball, drawn as
// outlines on top of everything through the same camera as the game. While
// it is on, the game freezes the first time a kick touches the frame or the
// keeper and marks the contact, so you can check that it really touched.
// Any key or click carries on.
import { POST_R, R, PX, BAR_Y } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { project } from './projection.js';

const COLORS = { body: '#ffe14d', glove: '#4de1ff', frame: '#ff8a3d', ball: '#ffffff', contact: '#ff2d55' };

export function createCollisionDebug() {
  let on = false;
  let spheres = [];             // copies: [x, y, z, r, isGlove]
  let ball = [0, 0, 0];
  let markers = [];             // { ball: [x, y, z], point: [x, y, z] | null }
  let markedShot = null;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9999;padding:6px 10px;border-radius:6px;' +
    'background:rgba(0,0,0,.72);color:#fff;font:12px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre';
  label.hidden = true;
  document.body.appendChild(label);
  const showLabel = () => {
    label.hidden = !on;
    label.textContent = debug.halted
      ? `Collision debug: FROZEN on ${debug.halted} contact\nAny key or click to carry on`
      : 'Collision debug (C to hide)\nyellow body · cyan gloves · orange frame';
  };

  // The nearest point on a collider's surface to the ball's centre, and the gap to it.
  function surfacePoint(b, list, kind) {
    let best = null, bestGap = Infinity;
    const consider = (c, radius) => {
      const d = Math.hypot(b.x - c[0], b.y - c[1], b.z - c[2]) || 1;
      const gap = d - radius - R;
      if (gap < bestGap) {
        bestGap = gap;
        best = [c[0] + (b.x - c[0]) / d * radius, c[1] + (b.y - c[1]) / d * radius, c[2] + (b.z - c[2]) / d * radius];
      }
    };
    if (kind === 'keeper' && list) for (const s of list) consider([s.c.x, s.c.y, s.c.z], s.r);
    if (kind === 'frame') {
      for (const s of [-1, 1]) consider([s * PX, clamp(b.y, 0, BAR_Y), 0], POST_R);
      consider([clamp(b.x, -PX, PX), BAR_Y, 0], POST_R);
    }
    return { point: best, gap: bestGap };
  }

  const circle = (ctx, cam, x, y, z, r, color, fill = false) => {
    const p = project(cam, x, y, z);
    if (!p) return;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, r * p.s), 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.stroke(); }
  };
  // a post or the bar: the outline of a cylinder of radius POST_R between two points
  const beam = (ctx, cam, a, b) => {
    const pa = project(cam, ...a), pb = project(cam, ...b);
    if (!pa || !pb) return;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(pa.x + nx * POST_R * pa.s, pa.y + ny * POST_R * pa.s); ctx.lineTo(pb.x + nx * POST_R * pb.s, pb.y + ny * POST_R * pb.s);
    ctx.moveTo(pa.x - nx * POST_R * pa.s, pa.y - ny * POST_R * pa.s); ctx.lineTo(pb.x - nx * POST_R * pb.s, pb.y - ny * POST_R * pb.s);
    ctx.strokeStyle = COLORS.frame; ctx.stroke();
  };

  const debug = {
    get on() { return on; },
    halted: null,   // 'keeper' | 'frame' while frozen on a contact
    toggle() {
      on = !on;
      if (!on) { markers = []; debug.halted = null; }
      showLabel();
    },
    resume() { debug.halted = null; showLabel(); },
    // Every frame: follow the keeper's spheres (null when no keeper) and the ball.
    update(list, ballPos) {
      if (!on) return;
      spheres = list ? list.map((s, i) => [s.c.x, s.c.y, s.c.z, s.r, i === 5 || i === 6]) : [];
      ball = [ballPos.x, ballPos.y, ballPos.z];
    },
    // Called from the collision callbacks. Freezes on the first contact of
    // each kind in a kick. Returns true when the game should stop ticking.
    contact(kind, shot, ballPos, list) {
      if (!on) return false;
      if (shot !== markedShot) { markers = []; markedShot = shot; shot.debugSeen = {}; }
      if (shot.debugSeen[kind]) return false;
      shot.debugSeen[kind] = true;
      const { point, gap } = surfacePoint(ballPos, list, kind);
      markers.push({ ball: [ballPos.x, ballPos.y, ballPos.z], point });
      debug.halted = kind;
      // gap is about 0 after the bounce pushed the ball out to the surface
      console.info(`[collision debug] ${kind} contact at`, ballPos.toArray().map((v) => +v.toFixed(3)), 'gap', +gap.toFixed(4));
      showLabel();
      return true;
    },
    // Drawn last, over everything (renderer.js `over`).
    draw(ctx, cam) {
      if (!on) return;
      ctx.save();
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
      for (const [x, y, z, r, glove] of spheres) circle(ctx, cam, x, y, z, r, glove ? COLORS.glove : COLORS.body);
      for (const s of [-1, 1]) beam(ctx, cam, [s * PX, 0, 0], [s * PX, BAR_Y, 0]);
      beam(ctx, cam, [-PX, BAR_Y, 0], [PX, BAR_Y, 0]);
      circle(ctx, cam, ...ball, R, COLORS.ball);
      ctx.lineWidth = 2.5;
      for (const m of markers) {
        circle(ctx, cam, ...m.ball, R, COLORS.contact);
        if (m.point) circle(ctx, cam, ...m.point, 0.025, COLORS.contact, true);
      }
      ctx.restore();
    },
  };
  return debug;
}
