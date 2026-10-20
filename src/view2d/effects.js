// Celebration effects in 2D: confetti, fireworks and phone flashes in the
// stands. Particles live in world space (metres), exactly as in the 3D
// game, and are projected through the current camera when drawn.
import { rand, gauss } from '../core/visual-random.js';
import { project } from './projection.js';
import { crowdPoint } from './stadium.js';

export const GOLD = [0xf2c230, 0xffe08a, 0xffffff, 0xf6e7a8];
const css = (n) => '#' + n.toString(16).padStart(6, '0');

// A soft glowing dot, one per colour, drawn once and stamped with 'lighter'.
const glows = new Map();
function glow(color) {
  let c = glows.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, '#ffffff'); r.addColorStop(0.25, color); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
    glows.set(color, c);
  }
  return c;
}

// opts.behindGoal(): true when the camera looks out from behind the goal,
// so fireworks go up over the far stand instead. opts.onFirework(): sound.
export function createEffects(opts) {
  // Confetti: small paper rectangles that tumble and drift down.
  const CONF_N = 900;
  const conf = Array.from({ length: CONF_N }, () => ({ life: 0, p: [0, 0, 0], v: [0, 0, 0], r: 0, w: 0, flip: 0, fw: 0, color: '#fff' }));
  let confNext = 0, confAlive = 0;
  function burstConfetti(cx, cy, cz, spread, count, colors, up) {
    for (let n = 0; n < count; n++) {
      const c = conf[confNext]; confNext = (confNext + 1) % CONF_N;
      c.life = rand(3.5, 5.5);
      c.p[0] = cx + rand(-spread, spread); c.p[1] = cy + rand(-1, 1); c.p[2] = cz + rand(-spread * 0.4, spread * 0.4);
      c.v[0] = rand(-2.5, 2.5); c.v[1] = rand(up * 0.5, up); c.v[2] = rand(0, 3.5);
      c.r = rand(0, 6); c.w = rand(-9, 9); c.flip = rand(0, 6); c.fw = rand(-9, 9);
      c.color = css(colors[(Math.random() * colors.length) | 0]);
    }
    confAlive = CONF_N;
  }
  function updateConfetti(dt, time) {
    if (!confAlive) return;
    let alive = 0;
    for (let i = 0; i < CONF_N; i++) {
      const c = conf[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v[1] -= 7 * dt;
      const drag = 1 - 1.8 * dt;                  // air drag makes paper flutter instead of fall
      c.v[0] *= drag; c.v[1] *= drag; c.v[2] *= drag;
      c.v[0] += Math.sin(time * 3 + i) * 1.2 * dt;
      c.p[0] += c.v[0] * dt; c.p[1] += c.v[1] * dt; c.p[2] += c.v[2] * dt;
      c.r += c.w * dt; c.flip += c.fw * dt;
      if (c.p[1] < 0.02) c.life = 0;
      if (c.life > 0) alive++;
    }
    confAlive = alive;
  }

  // Fireworks: glowing points that burst outward, fall, and fade.
  const FW_N = 1600;
  const fw = Array.from({ length: FW_N }, () => ({ life: 0, max: 1, p: [0, 0, 0], v: [0, 0, 0], color: '#fff' }));
  let fwNext = 0, fwAlive = 0;
  function firework(colorHex) {
    const behind = opts.behindGoal();
    const ax = rand(-26, 26), ay = behind ? rand(15, 21) : rand(24, 33), az = behind ? rand(48, 58) : rand(-34, -24);
    const base = [(colorHex >> 16) & 255, (colorHex >> 8) & 255, colorHex & 255];
    for (let n = 0; n < 140; n++) {
      const f = fw[fwNext]; fwNext = (fwNext + 1) % FW_N;
      f.life = f.max = rand(1.1, 1.9);
      let dx = gauss(), dy = gauss(), dz = gauss();
      const l = Math.hypot(dx, dy, dz) || 1, sp = rand(7, 11);
      f.v[0] = dx / l * sp; f.v[1] = dy / l * sp; f.v[2] = dz / l * sp;
      f.p[0] = ax; f.p[1] = ay; f.p[2] = az;
      // the burst's colour, some of it washed toward white (four shades, so the glow cache stays small)
      const t = [0, 0.12, 0.24, 0.35][(Math.random() * 4) | 0];
      f.color = css(base.reduce((a, v, k) => a | (Math.round(v + (255 - v) * t) << (16 - k * 8)), 0));
    }
    fwAlive = FW_N;
    opts.onFirework();
  }
  function updateFireworks(dt) {
    if (!fwAlive) return;
    let alive = 0;
    for (let i = 0; i < FW_N; i++) {
      const f = fw[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      f.v[1] -= 5 * dt;
      const drag = 1 - 1.1 * dt;
      f.v[0] *= drag; f.v[1] *= drag; f.v[2] *= drag;
      f.p[0] += f.v[0] * dt; f.p[1] += f.v[1] * dt; f.p[2] += f.v[2] * dt;
      if (f.life > 0) alive++;
    }
    fwAlive = alive;
  }

  // Phone camera flashes popping in the stands.
  const FLASH_N = 60;
  const flashes = Array.from({ length: FLASH_N }, () => ({ p: crowdPoint(Math.random), level: 0 }));
  let flashRate = 0, flashesLit = false;
  function updateFlashes(dt) {
    flashRate *= Math.exp(-dt * 0.5);
    if (flashRate < 0.05 && !flashesLit) return;
    let lit = false;
    for (const f of flashes) {
      if (Math.random() < flashRate * dt / FLASH_N * 6) f.level = 1;
      else f.level *= Math.exp(-dt * 16);
      if (f.level > 0.01) lit = true;
    }
    flashesLit = lit;
  }

  const _p = { x: 0, y: 0, s: 0, d: 0 };
  function draw(ctx, cam) {
    if (flashesLit || fwAlive) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (flashesLit) {
        const img = glow('#ffffff');
        for (const f of flashes) {
          if (f.level < 0.02) continue;
          const p = project(cam, f.p[0], f.p[1], f.p[2], _p);
          if (!p) continue;
          const r = Math.max(3, 0.55 * p.s);
          ctx.globalAlpha = f.level;
          ctx.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
        }
      }
      if (fwAlive) {
        for (const f of fw) {
          if (f.life <= 0) continue;
          const p = project(cam, f.p[0], f.p[1], f.p[2], _p);
          if (!p) continue;
          const r = Math.max(1.5, 0.8 * p.s);
          ctx.globalAlpha = Math.max(0, f.life / f.max) * (0.75 + 0.25 * Math.random());
          ctx.drawImage(glow(f.color), p.x - r, p.y - r, r * 2, r * 2);
        }
      }
      ctx.restore();
    }
    if (confAlive) {
      // each piece gets its own rotation on top of the frame's transform (pixel ratio and shake)
      const base = ctx.getTransform(), a = base.a;
      for (const c of conf) {
        if (c.life <= 0) continue;
        const p = project(cam, c.p[0], c.p[1], c.p[2], _p);
        if (!p || p.s < 2) continue;
        // a 10 x 15 cm paper square, turning in the plane and flipping (its width shrinks as it turns edge-on)
        const w = 0.1 * p.s * Math.abs(Math.cos(c.flip)) + 0.4, h = 0.15 * p.s;
        const cs = Math.cos(c.r), sn = Math.sin(c.r);
        ctx.setTransform(a * cs, a * sn, -a * sn, a * cs, base.e + a * p.x, base.f + a * p.y);
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.min(1, c.life * 2);
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      ctx.setTransform(base);
      ctx.globalAlpha = 1;
    }
  }

  return {
    burstConfetti, updateConfetti, firework, updateFireworks, updateFlashes, draw,
    setFlashRate: (r) => { flashRate = r; },
  };
}
