// The ball in 2D: a shaded white disc with dark panels that turn as it
// rolls, its shadow on the grass, and (to make a fast, small ball easy to
// follow) a soft glow and a short fading trail.
import { R } from '../core/constants.js';
import { project } from './projection.js';

const _p = { x: 0, y: 0, s: 0, d: 0 }, _g = { x: 0, y: 0, s: 0, d: 0 };

// A soft round shadow, painted once and stretched into ellipses.
let shadowSprite = null;
export function softShadow() {
  if (shadowSprite) return shadowSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.55, 'rgba(0,0,0,0.6)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  shadowSprite = c;
  return c;
}
// A shadow on the grass under world point (x, z): rx, ry in metres.
// The ellipse is the screen box around the four ends of the patch, so it is
// foreshortened correctly from any camera.
export function drawGroundShadow(ctx, cam, x, z, rx, rz, alpha) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, pz] of [[x - rx, z], [x + rx, z], [x, z - rz], [x, z + rz]]) {
    const p = project(cam, px, 0.01, pz, _g);
    if (!p) return;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(softShadow(), x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  ctx.globalAlpha = 1;
}

export function drawBallShadow(ctx, cam, pos) {
  // fainter and wider the higher the ball is
  const h = Math.max(0, pos.y - R);
  drawGroundShadow(ctx, cam, pos.x + h * 0.15, pos.z, R * (1.3 + h * 0.3), R * (1.3 + h * 0.3), 0.45 / (1 + h));
}

// roll: radians the panels have turned.
export function drawBall(ctx, cam, pos, roll) {
  const p = project(cam, pos.x, pos.y, pos.z, _p);
  if (!p) return;
  const r = Math.max(2.5, R * p.s);
  const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#eceef0'); g.addColorStop(1, '#b9bec6');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  if (r < 4) return;
  // panels: a pentagon in the middle and parts of five around it, all turning with the roll
  ctx.save();
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(p.x, p.y); ctx.rotate(roll);
  ctx.fillStyle = '#1b1c22';
  const pent = (cx, cy, size) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size); }
    ctx.closePath(); ctx.fill();
  };
  const off = Math.sin(roll * 0.7) * r * 0.25;
  pent(off, 0, r * 0.36);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + Math.PI / 2;
    pent(off + Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3);
  }
  ctx.restore();
}

// The glow and trail. emphasis 0..1: how strongly to highlight (stronger when you keep goal).
const TRAIL_N = 18;
export function createBallTracking() {
  const history = [];
  let strength = 0;
  return {
    update(pos, moving, emphasis, dt) {
      strength += ((moving ? emphasis : 0) - strength) * Math.min(1, dt * 10);
      if (moving) { history.unshift([pos.x, pos.y, pos.z]); if (history.length > TRAIL_N) history.pop(); } else history.length = 0;
    },
    draw(ctx, cam, pos) {
      if (strength < 0.02) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      let prev = null;
      for (let i = 0; i < history.length; i++) {
        const h = history[i], q = project(cam, h[0], h[1], h[2]);
        if (!q) { prev = null; continue; }
        if (prev) {
          const k = strength * (1 - i / TRAIL_N) * 0.8;
          ctx.strokeStyle = `rgba(255,235,180,${k})`;
          ctx.lineWidth = Math.max(1.5, R * q.s * 1.4 * (1 - i / TRAIL_N));
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        prev = [q.x, q.y];
      }
      const p = project(cam, pos.x, pos.y, pos.z, _p);
      if (p) {
        const r = Math.max(14, 0.45 * p.s);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,244,208,${0.55 * strength})`); g.addColorStop(1, 'rgba(255,244,208,0)');
        ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.restore();
    },
  };
}
