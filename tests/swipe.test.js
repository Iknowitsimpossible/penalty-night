import { describe, it, expect } from 'vitest';
import { readSwipe, screenUnit, SWIPE, keyboardKick, flightTime } from '../src/input/swipe.js';

// Build a gesture in screen units on a given screen: points along a path,
// optionally bowed sideways, spread evenly over durMs, with optional holds.
function gesture({ w, h, dx = 0, up = 0.4, bow = 0, durMs = 150, holdStart = 0, holdEnd = 0, n = 12 }) {
  const U = screenUnit(w, h);
  const x0 = w / 2, y0 = h * 0.85;
  const pts = [];
  let t = 1000;
  if (holdStart) { pts.push({ x: x0, y: y0, t }); t += holdStart; }
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const side = Math.sin(u * Math.PI) * bow;
    pts.push({ x: x0 + (dx * u + side) * U, y: y0 - up * u * U, t: t + durMs * u });
  }
  if (holdEnd) { const last = pts[pts.length - 1]; pts.push({ ...last, t: last.t + holdEnd }); }
  return pts;
}
const kick = (opts) => readSwipe(gesture(opts), opts.w, opts.h).kick;

const PHONE = { w: 375, h: 812 }, DESKTOP = { w: 1280, h: 800 }, LANDSCAPE = { w: 844, h: 390 };

describe('readSwipe', () => {
  it('gives the same kick for the same gesture on any screen', () => {
    const base = kick({ ...PHONE, dx: 0.15, up: 0.35, bow: 0.04 });
    for (const screen of [DESKTOP, LANDSCAPE]) {
      const k = kick({ ...screen, dx: 0.15, up: 0.35, bow: 0.04 });
      expect(k.aimX).toBeCloseTo(base.aimX, 6);
      expect(k.aimY).toBeCloseTo(base.aimY, 6);
      expect(k.T).toBeCloseTo(base.T, 6);
      expect(k.spin).toBeCloseTo(base.spin, 6);
    }
  });

  it('ignores holding still before and after the swipe', () => {
    const quick = kick({ ...DESKTOP, durMs: 160 });
    const held = kick({ ...DESKTOP, durMs: 160, holdStart: 900, holdEnd: 400 });
    expect(held.T).toBeCloseTo(quick.T, 6);
    expect(held.aimY).toBeCloseTo(quick.aimY, 6);
  });

  it('kicks harder (shorter flight) for a faster swipe', () => {
    const slow = kick({ ...PHONE, durMs: 600 });
    const fast = kick({ ...PHONE, durMs: 120 });
    expect(fast.T).toBeLessThan(slow.T);
    expect(fast.power).toBeGreaterThan(slow.power);
  });

  it('stays inside the power range at the extremes', () => {
    expect(kick({ ...PHONE, durMs: 5000 }).T).toBeCloseTo(SWIPE.softT, 6);
    expect(kick({ ...PHONE, durMs: 40 }).T).toBeCloseTo(SWIPE.hardT, 6);
  });

  it('aims higher for a longer swipe and wider for a slanted one', () => {
    expect(kick({ ...PHONE, up: 0.45 }).aimY).toBeGreaterThan(kick({ ...PHONE, up: 0.2 }).aimY);
    expect(kick({ ...PHONE, dx: 0.2 }).aimX).toBeGreaterThan(0);
    expect(kick({ ...PHONE, dx: -0.2 }).aimX).toBeLessThan(0);
    expect(Math.abs(kick({ ...PHONE, dx: 0 }).aimX)).toBeLessThan(1e-9);
  });

  // Positive spin pushes the ball toward -x as it flies, and the launch
  // aims out to +x to compensate, so its path bows right: like the swipe.
  it('bends the ball along the shape of the swipe', () => {
    const right = kick({ ...PHONE, bow: 0.06 });
    const left = kick({ ...PHONE, bow: -0.06 });
    expect(right.spin).toBeGreaterThan(0);
    expect(left.spin).toBeLessThan(0);
    expect(kick({ ...PHONE, bow: 0 }).spin).toBeCloseTo(0, 6);
  });

  it('rejects taps and downward or tiny swipes with a reason', () => {
    expect(readSwipe([{ x: 10, y: 10, t: 0 }], 375, 812)).toEqual({ kick: null, reason: 'tap' });
    expect(readSwipe(gesture({ ...PHONE, up: 0.02 }), 375, 812).reason).toBe('short');
    expect(readSwipe(gesture({ ...PHONE, up: -0.2 }), 375, 812).reason).toBe('down');
  });
});

describe('keyboardKick', () => {
  it('uses the same power curve as swiping', () => {
    expect(keyboardKick(1, 1, 0.5, 0).T).toBeCloseTo(flightTime(0.5), 9);
    expect(keyboardKick(1, 1, 1, 1).spin).toBe(SWIPE.maxSpin);
  });
});
