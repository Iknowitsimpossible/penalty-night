// The net as a grid of knots (back, roof and both sides). A goal pushes a
// bulge into it that wobbles and settles; drawGoal() in stadium.js draws
// whatever shape it is in. Plain numbers only, so it runs anywhere.
import { HALF, GOAL_H, NET_D1, netDepth } from '../core/constants.js';

export function createNet() {
  const net = { base: [], segs: [], bulges: [], cur: null, screen: null };
  function grid(nu, nv, fn) {
    const start = net.base.length;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) net.base.push(fn(i / nu, j / nv));
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const k = start + j * (nu + 1) + i;
      if (i < nu) net.segs.push(k, k + 1);
      if (j < nv) net.segs.push(k, k + nu + 1);
    }
  }
  grid(40, 13, (u, v) => { const y = v * GOAL_H; return [-HALF + u * 2 * HALF, y, -netDepth(y)]; });
  grid(40, 6, (u, v) => [-HALF + u * 2 * HALF, GOAL_H, -v * NET_D1]);
  for (const s of [-1, 1]) grid(9, 13, (u, v) => { const y = v * GOAL_H; return [s * HALF, y, -u * netDepth(y)]; });
  net.cur = net.base.map((p) => p.slice());
  net.screen = new Float32Array(net.base.length * 2);

  // at, dir: {x, y, z} (THREE.Vector3 is fine). strength: metres of push.
  net.bulge = (at, dir, strength) => {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    net.bulges.push({ at: [at.x, at.y, at.z], dir: [dir.x / l, dir.y / l, dir.z / l], a: strength, t: 0 });
  };
  let dirty = false;
  net.update = (dt) => {
    if (!net.bulges.length) {
      if (dirty) { net.base.forEach((p, k) => { net.cur[k][0] = p[0]; net.cur[k][1] = p[1]; net.cur[k][2] = p[2]; }); dirty = false; }
      return;
    }
    dirty = true;
    net.bulges.forEach((b) => { b.t += dt; });
    net.bulges = net.bulges.filter((b) => b.t < 2.2);
    for (let k = 0; k < net.base.length; k++) {
      const p = net.cur[k], q = net.base[k];
      p[0] = q[0]; p[1] = q[1]; p[2] = q[2];
      for (const b of net.bulges) {
        const amp = b.a * Math.exp(-b.t * 3.0) * Math.cos(b.t * 9);
        const dx = p[0] - b.at[0], dy = p[1] - b.at[1], dz = p[2] - b.at[2];
        const push = amp * Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.6);
        p[0] += b.dir[0] * push; p[1] += b.dir[1] * push; p[2] += b.dir[2] * push;
      }
    }
  };
  return net;
}
