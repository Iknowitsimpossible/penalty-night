import { describe, it, expect } from 'vitest';
import { createQualityGovernor, STEPS } from '../src/view2d/quality.js';

const run = (g, fps, seconds) => {
  const changes = [];
  for (let t = 0; t < seconds; t += 1 / fps) { const r = g.update(1 / fps); if (r) changes.push(r); }
  return changes;
};

describe('adaptive resolution', () => {
  it('keeps full resolution while frames are smooth', () => {
    const g = createQualityGovernor(2);
    expect(run(g, 60, 20)).toEqual([]);
    expect(g.ratio).toBe(2);
  });

  it('steps down one level at a time while frames are slow', () => {
    const g = createQualityGovernor(2);
    const changes = run(g, 24, 20);
    expect(changes[0]).toBe(1.75);
    expect(changes.length).toBeGreaterThan(1);
    expect(g.ratio).toBeLessThan(1.5);
  });

  it('does not bounce back to a level it had to leave', () => {
    const g = createQualityGovernor(2);
    run(g, 24, 6);                       // slow: steps down
    const settled = g.ratio;
    expect(run(g, 60, 30)).toEqual([]);  // smooth again, but stays put
    expect(g.ratio).toBe(settled);
  });

  it('starts at the device ratio when it is lower than the top step', () => {
    expect(createQualityGovernor(1).ratio).toBe(1);
    expect(createQualityGovernor(1.5).ratio).toBe(1.5);
    expect(STEPS.at(-1)).toBe(1);
  });

  it('ignores long gaps such as a paused tab', () => {
    const g = createQualityGovernor(2);
    expect(g.update(3)).toBe(null);
    expect(g.ratio).toBe(2);
  });
});
