import { describe, it, expect } from 'vitest';
import { createCup, recordResult, standings, currentFixture, addGroupResult, goalDifference, YOU } from '../src/tournament/cup.js';
import { createRng } from '../src/core/random.js';

const sumTable = (tour) => Object.values(tour.table).reduce((s, r) => ({ gf: s.gf + r.gf, ga: s.ga + r.ga, w: s.w + r.w, l: s.l + r.l }), { gf: 0, ga: 0, w: 0, l: 0 });

describe('group stage', () => {
  it('keeps the table consistent: goals for = goals against, wins = losses', () => {
    const rng = createRng(3);
    const tour = createCup(rng);
    for (let d = 0; d < 3; d++) recordResult(tour, 3, 1, rng);
    const s = sumTable(tour);
    expect(s.gf).toBe(s.ga);
    expect(s.w).toBe(s.l);
    for (const row of Object.values(tour.table)) {
      expect(row.p).toBe(3);
      expect(row.pts).toBe(row.w * 3);
    }
  });

  it('records simulated scores that a real shootout could produce', () => {
    const rng = createRng(11);
    for (let n = 0; n < 50; n++) {
      const tour = createCup(rng);
      recordResult(tour, 3, 0, rng);
      for (const row of Object.values(tour.table)) {
        // In five kicks each plus sudden death, a side that wins 6-0 is impossible:
        // the shootout stops at 3-0.
        if (row.p) expect(Math.abs(goalDifference(row))).toBeLessThanOrEqual(3);
      }
    }
  });

  it('sorts by points, then goal difference, then goals scored', () => {
    const tour = createCup(createRng(5));
    const [me, b, c, d] = tour.A;
    addGroupResult(tour, me, b, 3, 0);  // me +3
    addGroupResult(tour, c, d, 5, 4);   // c +1
    addGroupResult(tour, b, c, 4, 2);   // b +2-3 = -1, c +1-2 = -1, b 4gf, c 7gf
    // points: me 3, c 3, b 3, d 0 -> GD: me +3, c -1, b -1 -> gf: c 7 > b 4
    expect(standings(tour, tour.A)).toEqual([me, c, b, d]);
  });

  it('refuses a level shootout', () => {
    const tour = createCup(createRng(5));
    expect(() => addGroupResult(tour, 0, 1, 2, 2)).toThrow();
  });
});

describe('qualification and knockouts', () => {
  it('sends the top two of each group to crossed semifinals', () => {
    const rng = createRng(8);
    const tour = createCup(rng);
    for (let d = 0; d < 3; d++) recordResult(tour, 3, 0, rng); // win every group game
    expect(tour.stage).toBe('semi');
    const a = standings(tour, tour.A), b = standings(tour, tour.B);
    expect(a[0]).toBe(YOU);
    expect(tour.semis).toEqual([[a[0], b[1]], [b[0], a[1]]]);
  });

  it('knocks you out after three group defeats and still crowns a champion', () => {
    const rng = createRng(9);
    const tour = createCup(rng);
    for (let d = 0; d < 3; d++) recordResult(tour, 0, 3, rng);
    expect(tour.stage).toBe('out');
    expect(currentFixture(tour)).toBe(null);
    expect(tour.ko.filter((m) => m.round === 'Final')).toHaveLength(1);
    expect(tour.champion).not.toBe(YOU);
  });

  it('runs a full cup to the title', () => {
    const rng = createRng(10);
    const tour = createCup(rng);
    for (let d = 0; d < 3; d++) recordResult(tour, 4, 2, rng);
    expect(currentFixture(tour).label).toBe('Semifinal');
    recordResult(tour, 5, 4, rng);
    expect(tour.stage).toBe('final');
    expect(recordResult(tour, 1, 0, rng)).toBe('You won the Night Cup!');
    expect(tour.stage).toBe('champion');
  });

  it('is reproducible with the same seed', () => {
    const play = (seed) => { const rng = createRng(seed); const t = createCup(rng); recordResult(t, 3, 2, rng); return t; };
    expect(play(77)).toEqual(play(77));
  });
});
