// The stadium in the concept's style: night sky, three-tier stands packed
// with a hazy crowd, floodlights, ad boards, a striped floodlit pitch and
// its lines. None of it moves, so it is painted once per view and screen
// size into an offscreen canvas (bakeStadium) and copied every frame.
// The goal and net are drawn live (drawGoal) because the net can bulge and
// because in the keeper view they sit between the camera and the keeper.
import { HALF, GOAL_H, POST_R, PX, BAR_Y, SPOT_Z, NET_D0, NET_D1 } from '../core/constants.js';
import { project, projectPoly } from './projection.js';

// ------------------------------------------------------------------ layout (metres)
// Stand tiers as [distance behind the end line at the front, front height,
// distance at the back, back height], as on the concept page.
const TIERS = [[6, 1.2, 13, 5.5], [13.5, 6.2, 20, 10.2], [20.5, 10.8, 28, 15.5]];
export const FAR_Z = 30;          // the far end line: a compact floodlit ground
const SIDE_X = 34;                // touchlines
const END_W = 70;                 // half-width of the end stands
const BOARD_D = 4;                // boards stand this far behind each end line

// A small seeded generator so a re-bake (new view or size) paints the same crowd.
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// cpuHex: the opponent's colour ('#rrggbb'); fans of each side lean to their colour.
function crowdPalettes(cpuHex) {
  const you = ['#f2c230', '#d9a826', '#f2c230', '#e9b928'];
  const cpu = [cpuHex, cpuHex, mix(cpuHex, '#000000', 0.25), mix(cpuHex, '#ffffff', 0.25)];
  const neutral = ['#e9edf5', '#2b3550', '#3b4766', '#1d2438', '#c0573d'];
  return { you, cpu, neutral };
}
export function mix(a, b, t) {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((p >> s) & 255) + ((((q >> s) & 255) - ((p >> s) & 255)) * t));
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}

// Which parts of the ground a view can see. The keeper view stands inside
// the stand behind the goal, so that end (and its boards) are left out.
const showsNearEnd = (view) => view !== 'keeper';

// ------------------------------------------------------------------ bake
// cam: from views.js. w, h: CSS pixels. dpr: device pixel ratio.
// opts: { view, cpuColor: '#rrggbb', lights: 0..1 (floodlights on) }
export function bakeStadium(cam, w, h, dpr, opts) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = seeded(7);
  const P = (x, y, z) => project(cam, x, y, z);
  const polyPath = (pts) => {
    const s = projectPoly(cam, pts);
    if (s.length < 3) return false;
    c.beginPath();
    s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    return true;
  };
  const fillPoly = (pts, style, alpha = 1) => {
    if (!polyPath(pts)) return;
    c.globalAlpha = alpha; c.fillStyle = style; c.fill(); c.globalAlpha = 1;
  };

  // ---------------- sky
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#02040b'); sky.addColorStop(0.55, '#0a1330'); sky.addColorStop(1, '#16224a');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 160; i++) {
    c.globalAlpha = 0.2 + rnd() * 0.5;
    c.fillRect(rnd() * w, rnd() * h * 0.22, 1.4, 1.4);
  }
  c.globalAlpha = 1;

  // ---------------- stands and crowd
  const pal = crowdPalettes(opts.cpuColor || '#2fc6b4');
  // Each stand is a list of tiers in world space; `at(u, d, y)` places a
  // point u along the stand (-1..1), d metres back from its front line, at height y.
  const stands = [];
  const endStand = (sign, lineZ) => ({
    at: (u, d, y) => [u * END_W, y, lineZ + sign * d],
    len: END_W * 2, kind: 'end', lean: (u) => (u * sign < 0 ? 'you' : 'cpu'),
    centre: [0, 8, lineZ + sign * 16],
  });
  const sideStand = (sign) => ({
    at: (u, d, y) => [sign * (SIDE_X + d), y, (FAR_Z - 6) / 2 + u * (FAR_Z + 6) / 2],
    len: FAR_Z + 6, kind: 'side', lean: () => 'mix',
    centre: [sign * (SIDE_X + 16), 8, FAR_Z / 2],
  });
  if (showsNearEnd(opts.view)) stands.push(endStand(-1, 0));
  stands.push(endStand(1, FAR_Z), sideStand(-1), sideStand(1));
  // far stands first, so nearer ones paint over them
  const dist = (p) => Math.hypot(p[0] - cam.eye.x, p[2] - cam.eye.z);
  stands.sort((a, b) => dist(b.centre) - dist(a.centre));

  const drawStand = (st) => {
    for (const [d0, y0, d1, y1] of TIERS) {
      const A = (u, d, y) => st.at(u, d, y);
      fillPoly([A(-1, d0, y0), A(1, d0, y0), A(1, d1, y1), A(-1, d1, y1)], '#141b2e');
      fillPoly([A(-1, d0 - 0.3, y0 - 0.6), A(1, d0 - 0.3, y0 - 0.6), A(1, d0, y0), A(-1, d0, y0)], '#232c47');
      // the crowd: rows of small round heads, dimmer toward the back
      const rows = 18, step = 0.42;
      for (let r = 0; r < rows; r++) {
        const t = (r + 0.5) / rows, d = d0 + (d1 - d0) * t, y = y0 + (y1 - y0) * t;
        const n = Math.floor(st.len / step);
        const alpha = 0.4 + 0.35 * (1 - t);
        for (let i = 0; i < n; i++) {
          const u = -1 + (i + rnd() * 0.7) * 2 / n;
          const skip = rnd() < 0.08, colPick = rnd(), lean = rnd(), sizeK = rnd(), stand = rnd();
          if (skip) continue;
          const [x, , z] = st.at(u, d, y);
          const p = P(x, y + 0.25, z);
          if (!p || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
          const rr = p.s * 0.14 * (0.8 + sizeK * 0.35);
          if (rr < 0.35) continue;
          const side = st.lean(u);
          const group = side === 'mix' ? (lean < 0.3 ? pal.you : lean < 0.6 ? pal.cpu : pal.neutral)
            : lean < 0.62 ? pal[side] : lean < 0.8 ? pal[side === 'you' ? 'cpu' : 'you'] : pal.neutral;
          c.globalAlpha = alpha;
          c.fillStyle = group[Math.floor(colPick * group.length)];
          c.beginPath();
          c.arc(p.x, p.y - (stand < 0.12 ? rr * 1.4 : 0), rr, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.globalAlpha = 1;
    }
  };
  const ends = stands.filter((s) => s.kind === 'end'), sides = stands.filter((s) => s.kind === 'side');
  ends.forEach(drawStand);

  // camera flashes frozen in the stands, then the night haze over it all
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 26; i++) {
    c.globalAlpha = 0.5 + rnd() * 0.5;
    c.beginPath(); c.arc(rnd() * w, h * (0.05 + rnd() * 0.3), 1 + rnd() * 1.8, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 0.32; c.fillStyle = '#0a1020'; c.fillRect(0, 0, w, h); c.globalAlpha = 1;

  // ---------------- pitch with mowing stripes across
  // (the keeper view stands behind the goal, in the stand's place: grass right up to the lens)
  const z0 = showsNearEnd(opts.view) ? -6 : Math.min(-6, cam.eye.z), z1 = FAR_Z + 6;
  const top = P(0, 0, z1), bottom = h;
  const grass = c.createLinearGradient(0, top ? top.y : 0, 0, bottom);
  grass.addColorStop(0, '#2b7a35'); grass.addColorStop(1, '#1c5a26');
  fillPoly([[-SIDE_X - 6, 0, z0], [SIDE_X + 6, 0, z0], [SIDE_X + 6, 0, z1], [-SIDE_X - 6, 0, z1]], grass);
  for (let z = z0, i = 0; z < z1; z += 2.2, i++) {
    if (i % 2) continue;
    fillPoly([[-SIDE_X - 6, 0, z], [SIDE_X + 6, 0, z], [SIDE_X + 6, 0, Math.min(z + 2.2, z1)], [-SIDE_X - 6, 0, Math.min(z + 2.2, z1)]], '#3b9a45', 0.28);
  }
  // the floodlights' pool of light around the goal mouth and the spot
  const pool = P(0, 0, 6);
  if (pool) {
    const r = Math.max(w, h) * 0.75;
    const g = c.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, r);
    g.addColorStop(0, 'rgba(255,243,196,0.2)'); g.addColorStop(1, 'rgba(255,243,196,0)');
    c.save(); c.translate(pool.x, pool.y); c.scale(1, 0.4); c.translate(-pool.x, -pool.y);
    c.fillStyle = g; c.fillRect(pool.x - r, pool.y - r, r * 2, r * 2);
    c.restore();
  }

  sides.forEach(drawStand);

  // ---------------- ad boards: alternating gold and teal panels
  const boardFont = (px) => `900 ${px}px ${getComputedStyle(document.documentElement).getPropertyValue('--display') || "'Arial Black', sans-serif"}`;
  const boardRun = (from, to) => {
    // a run of panels from `from` to `to` (world [x, z]), 1 m tall
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.round(len / 10));
    const at = (t, y) => [from[0] + (to[0] - from[0]) * t, y, from[1] + (to[1] - from[1]) * t];
    fillPoly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], '#0d1a36');
    for (let i = 0; i < n; i++) {
      const a = (i + 0.04) / n, b = (i + 0.96) / n, gold = i % 2 === 0;
      fillPoly([at(a, 0.15), at(b, 0.15), at(b, 0.85), at(a, 0.85)], gold ? '#f2c230' : '#1fb59f', 0.9);
      const m = P(...at((a + b) / 2, 0.5));
      const pl = P(...at(a, 0.5)), pr = P(...at(b, 0.5));
      if (!m || !pl || !pr || m.s < 3) continue;
      const width = Math.abs(pr.x - pl.x);
      if (width < 30) continue;
      c.save();
      c.fillStyle = '#0d1a36'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = boardFont(Math.min(m.s * 0.4, width / 9));
      c.fillText(gold ? 'PENALTY NIGHT' : 'NIGHT CUP', m.x, m.y + m.s * 0.03, width * 0.92);
      c.restore();
    }
  };
  if (showsNearEnd(opts.view)) boardRun([-60, -BOARD_D], [60, -BOARD_D]);
  boardRun([60, FAR_Z + BOARD_D], [-60, FAR_Z + BOARD_D]);
  for (const s of [-1, 1]) boardRun([s * (SIDE_X + BOARD_D), -BOARD_D], [s * (SIDE_X + BOARD_D), FAR_Z + BOARD_D]);

  // ---------------- pitch lines: real widths, drawn as flat strips on the grass
  const LINE = 0.12;
  c.fillStyle = 'rgba(242,246,238,0.85)';
  const strip = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * LINE / 2, nz = dx / len * LINE / 2;
    const pieces = Math.max(1, Math.ceil(len / 3));
    for (let i = 0; i < pieces; i++) {
      const t0 = i / pieces, t1 = (i + 1) / pieces;
      const p0 = [a[0] + dx * t0, a[1] + dz * t0], p1 = [a[0] + dx * t1, a[1] + dz * t1];
      if (polyPath([[p0[0] + nx, 0.003, p0[1] + nz], [p1[0] + nx, 0.003, p1[1] + nz], [p1[0] - nx, 0.003, p1[1] - nz], [p0[0] - nx, 0.003, p0[1] - nz]])) c.fill();
    }
  };
  const line = (pts) => { for (let i = 1; i < pts.length; i++) strip(pts[i - 1], pts[i]); };
  for (const end of [0, FAR_Z]) {
    const s = end ? -1 : 1;   // into the pitch
    line([[-SIDE_X, end], [SIDE_X, end]]);
    line([[-9.16, end], [-9.16, end + s * 5.5], [9.16, end + s * 5.5], [9.16, end]]);
    line([[-20.16, end], [-20.16, end + s * 16.5], [20.16, end + s * 16.5], [20.16, end]]);
  }
  line([[-SIDE_X, 0], [-SIDE_X, FAR_Z]]); line([[SIDE_X, 0], [SIDE_X, FAR_Z]]);
  // the "D": the part of a 9.15 m circle around the spot outside the box
  const a = Math.acos(5.5 / 9.15), arc = [];
  for (let i = 0; i <= 16; i++) { const t = -a + (2 * a * i) / 16; arc.push([Math.sin(t) * 9.15, SPOT_Z + Math.cos(t) * 9.15]); }
  line(arc);
  // the penalty spot
  const spot = [];
  for (let i = 0; i < 12; i++) { const t = (i / 12) * Math.PI * 2; spot.push([Math.cos(t) * 0.12, 0.004, SPOT_Z + Math.sin(t) * 0.12]); }
  if (polyPath(spot)) { c.fillStyle = 'rgba(242,246,238,0.92)'; c.fill(); }

  // ---------------- floodlight towers (heads, lamps, glow)
  const towers = [];
  if (showsNearEnd(opts.view)) towers.push([-27, 14, -30], [27, 14, -30]);
  towers.push([-27, 17, FAR_Z + 32], [27, 17, FAR_Z + 32]);
  const lights = opts.lights ?? 1;
  for (const [x, y, z] of towers) {
    const p = P(x, y, z);
    if (!p) continue;
    const hw = 2.2 * p.s, hh = 0.8 * p.s;
    c.fillStyle = lights > 0.5 ? '#d9d9d0' : '#3a4052';
    c.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
    c.fillStyle = lights > 0.5 ? '#fffdf0' : '#59607a';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      c.beginPath(); c.arc(p.x - hw * 0.75 + i * hw * 0.5, p.y - hh * 0.45 + j * hh * 0.9, hh * 0.36, 0, Math.PI * 2); c.fill();
    }
    if (lights > 0.5) {
      const r = 9.6 * p.s;
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(255,251,232,0.55)'); g.addColorStop(0.15, 'rgba(255,242,192,0.47)'); g.addColorStop(1, 'rgba(255,242,192,0)');
      c.fillStyle = g; c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
  }
  return canvas;
}

// ------------------------------------------------------------------ the goal
// Two layers, so the renderer can sort them against the keeper and the
// ball: the net (dark backing, mesh, support bars) a metre and a half
// behind the line, and the white frame on it. The net's knots come from
// net.js and move when it bulges. alpha: 1, or less in the keeper view,
// where the goal stands between the camera and the keeper.
export function drawNet(ctx, cam, net, alpha = 1) {
  ctx.save();
  ctx.lineCap = 'butt';
  // the dark backing panel behind the mesh, so the net reads against the crowd
  const back = projectPoly(cam, [[-HALF, 0, -NET_D0], [HALF, 0, -NET_D0], [HALF, GOAL_H, -NET_D1], [-HALF, GOAL_H, -NET_D1]]);
  if (back.length > 2) {
    ctx.globalAlpha = 0.45 * alpha;
    ctx.fillStyle = '#0d1428';
    ctx.beginPath(); back.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  }
  // the mesh: every grid segment in one path
  const scr = net.screen;
  for (let i = 0; i < net.cur.length; i++) {
    const p = net.cur[i], q = project(cam, p[0], p[1], p[2]);
    scr[i * 2] = q ? q.x : NaN; scr[i * 2 + 1] = q ? q.y : NaN;
  }
  ctx.beginPath();
  const segs = net.segs;
  for (let i = 0; i < segs.length; i += 2) {
    const a = segs[i] * 2, b = segs[i + 1] * 2;
    if (Number.isNaN(scr[a]) || Number.isNaN(scr[b])) continue;
    ctx.moveTo(scr[a], scr[a + 1]); ctx.lineTo(scr[b], scr[b + 1]);
  }
  const mid = project(cam, 0, 1, -1);
  ctx.globalAlpha = 0.42 * alpha;
  ctx.strokeStyle = '#e8eef8';
  ctx.lineWidth = Math.max(0.6, Math.min(1.4, (mid ? mid.s : 60) * 0.012));
  ctx.stroke();

  // support bars at the back
  const bar = (a, b, r, color) => {
    const pa = project(cam, ...a), pb = project(cam, ...b);
    if (!pa || !pb) return;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, r * 2 * (pa.s + pb.s) / 2);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  };
  ctx.globalAlpha = 0.9 * alpha;
  for (const s of [-1, 1]) {
    bar([s * PX, BAR_Y, 0], [s * PX, GOAL_H, -NET_D1], 0.025, '#c9ced6');
    bar([s * PX, GOAL_H, -NET_D1], [s * PX, 0.02, -NET_D0], 0.025, '#c9ced6');
  }
  bar([-PX, 0.02, -NET_D0], [PX, 0.02, -NET_D0], 0.025, '#c9ced6');
  bar([-PX, GOAL_H, -NET_D1], [PX, GOAL_H, -NET_D1], 0.025, '#c9ced6');
  ctx.restore();
}

// The frame: posts and bar as solid white quads of their real width, plus a highlight.
export function drawFrame(ctx, cam, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const beam = (a, b, color, r = POST_R) => {
    const pa = project(cam, ...a), pb = project(cam, ...b);
    if (!pa || !pb) return;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, ra = r * pa.s, rb = r * pb.s;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pa.x + nx * ra, pa.y + ny * ra); ctx.lineTo(pb.x + nx * rb, pb.y + ny * rb);
    ctx.lineTo(pb.x - nx * rb, pb.y - ny * rb); ctx.lineTo(pa.x - nx * ra, pa.y - ny * ra);
    ctx.closePath(); ctx.fill();
  };
  for (const s of [-1, 1]) beam([s * PX, 0, 0], [s * PX, BAR_Y + POST_R, 0], '#f6f7f9');
  beam([-PX - POST_R, BAR_Y, 0], [PX + POST_R, BAR_Y, 0], '#f6f7f9');
  beam([-PX - POST_R, BAR_Y + POST_R * 0.5, 0], [PX + POST_R, BAR_Y + POST_R * 0.5, 0], '#ffffff', POST_R * 0.35);
  ctx.restore();
}
