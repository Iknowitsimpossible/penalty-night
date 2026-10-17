const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function shotFromSwipe(pts, H) {
  const s = pts[0], e = pts[pts.length - 1];
  const dx = e.x - s.x, up = s.y - e.y;
  if (up < H * 0.06) return null;
  // Preserve the original total-gesture timing during the tooling migration.
  const dur = Math.max(40, e.t - s.t);
  const forward = up / H;
  const aimX = clamp(dx / up, -1.3, 1.3) * 5.2;
  const aimY = Math.max(0.11, (forward - 0.1) * 8.2);
  const T = clamp(0.36 + dur * 0.0011, 0.44, 1.05);
  // Curl: how far the swipe bulged away from a straight line.
  const len = Math.hypot(dx, up);
  let dev = 0;
  for (const p of pts) {
    const c = ((p.x - s.x) * (e.y - s.y) - (p.y - s.y) * (e.x - s.x)) / len;
    if (Math.abs(c) > Math.abs(dev)) dev = c;
  }
  const curl = clamp(dev / len, -0.35, 0.35);
  const spin = (-curl / 0.35) * 28;
  return { aimX, aimY, T, spin };
}
