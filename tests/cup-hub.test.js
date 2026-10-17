import { describe, it, expect } from 'vitest';
import { hubView, signed } from '../src/ui/cup-hub.js';
import { createCup, recordResult } from '../src/tournament/cup.js';
import { createRng } from '../src/core/random.js';

describe('cup hub view', () => {
  it('signs goal differences', () => {
    expect(signed(2)).toBe('+2');
    expect(signed(0)).toBe('0');
    expect(signed(-1)).toBe('-1');
  });

  it('shows the next fixture with a scouting line before the first match', () => {
    const v = hubView(createCup(createRng(1)));
    expect(v.title).toBe('Matchday 1 of 3');
    expect(v.fixtureHtml).toMatch(/next match/);
    expect(v.fixtureHtml).toMatch(/class="scouting"/);
    expect(v.koHtml).toBe(null);
    expect(v.done).toBe(false);
  });

  it('marks the top two of each group and your row', () => {
    const rng = createRng(2);
    const tour = createCup(rng);
    recordResult(tour, 3, 0, rng);
    const v = hubView(tour);
    expect((v.tablesHtml.match(/class="through/g) || []).length).toBe(4);
    expect(v.tablesHtml).toMatch(/class="[^"]*me"/);
  });

  it('shows the bracket after the groups and ends with no fixture', () => {
    const rng = createRng(3);
    const tour = createCup(rng);
    for (let d = 0; d < 3; d++) recordResult(tour, 0, 3, rng);
    const v = hubView(tour);
    expect(v.title).toBe('Knocked out');
    expect(v.fixtureHtml).toBe(null);
    expect(v.koHtml).toMatch(/Final/);
    expect(v.done).toBe(true);
  });
});
