// The Night Cup: eight teams, two groups of four, every match a shootout.
// Three points for a win (shootouts cannot be drawn). Ties in the table go
// to goal difference, then goals scored, then the stronger team.
// The top two of each group meet in the semifinals: A1 v B2 and B1 v A2.
// Everything here is plain data in, plain data out, so it can be tested
// and saved to localStorage as JSON.
import { simulateShootout } from '../rules/shootout.js';
import { clamp } from '../core/math.js';

export const TEAMS = [
  { name: 'You', code: 'YOU', color: 0xf2c230, rating: 0.5 },
  { name: 'Lakeside Athletic', code: 'LAK', color: 0x3b82f6, rating: 0.2, style: 'guesser' },
  { name: 'Northgate Rovers', code: 'NOR', color: 0xd94a4a, rating: 0.32, style: 'powerLow' },
  { name: 'Harbor City', code: 'HAR', color: 0x2fc6b4, rating: 0.44, style: 'rightFooted' },
  { name: 'Ironvale', code: 'IRV', color: 0x9aa3b5, rating: 0.55, style: 'wall' },
  { name: 'Redwood United', code: 'RED', color: 0xe07b39, rating: 0.64, style: 'highFlyer' },
  { name: 'Port Azure', code: 'AZU', color: 0x8b6cff, rating: 0.78, style: 'trickster' },
  { name: 'Kingsbridge', code: 'KIN', color: 0xf0f0f0, rating: 0.92, style: 'reader' },
];
export const YOU = 0;

// Matchday pairings inside a group of four (positions 0-3). You are always
// position 0 of group A, and your group is drawn weakest first, so the cup
// gets harder.
export const DAYS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

export const teamName = (i) => TEAMS[i].name;

export function createCup(rng) {
  const take = (arr) => arr.splice((rng.next() * arr.length) | 0, 1)[0];
  const top = [6, 7], upper = [4, 5], lower = [2, 3];
  const A = [YOU, take(lower), take(upper), take(top)];
  const B = [1, lower[0], upper[0], top[0]];
  const table = {};
  for (let i = 0; i < TEAMS.length; i++) table[i] = { p: 0, w: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  return {
    A, B, table, day: 0, stage: 'group', semis: null, final: null, ko: [],
    news: 'Eight teams, two groups. Win your group games and the top two go through to the semifinals.',
  };
}

// A computer team's chance of scoring one kick against another team.
export function kickChance(shooter, keeper) {
  return clamp(0.74 + 0.22 * (TEAMS[shooter].rating - TEAMS[keeper].rating), 0.5, 0.93);
}
export function simulateMatch(a, b, rng) {
  const r = simulateShootout(kickChance(a, b), kickChance(b, a), rng);
  return [r.ga, r.gb];
}

export function addGroupResult(tour, a, b, ga, gb) {
  if (ga === gb) throw new Error('A shootout cannot end level');
  const ta = tour.table[a], tb = tour.table[b];
  ta.p++; tb.p++; ta.gf += ga; ta.ga += gb; tb.gf += gb; tb.ga += ga;
  if (ga > gb) { ta.w++; tb.l++; ta.pts += 3; } else { tb.w++; ta.l++; tb.pts += 3; }
}

export const goalDifference = (row) => row.gf - row.ga;

export function standings(tour, group) {
  return group.slice().sort((x, y) => {
    const a = tour.table[x], b = tour.table[y];
    return (b.pts - a.pts) || (goalDifference(b) - goalDifference(a)) || (b.gf - a.gf) || (TEAMS[y].rating - TEAMS[x].rating);
  });
}

// Your next opponent and a label for it, or null when your cup is over.
export function currentFixture(tour) {
  if (tour.stage === 'group') return { opp: tour.A[DAYS[tour.day][0][1]], label: `Group A · Matchday ${tour.day + 1}` };
  if (tour.stage === 'semi') {
    const tie = tour.semis.find((t) => t.includes(YOU));
    return { opp: tie[0] === YOU ? tie[1] : tie[0], label: 'Semifinal' };
  }
  if (tour.stage === 'final') return { opp: tour.final[0] === YOU ? tour.final[1] : tour.final[0], label: 'Final' };
  return null;
}

// Records your result, plays the other matches of the round, and moves the
// cup on. Returns one line for the end-of-match screen.
export function recordResult(tour, gy, gc, rng) {
  const fx = currentFixture(tour);
  if (!fx) throw new Error('No fixture to record');
  const opp = fx.opp, won = gy > gc;
  const others = [];
  const sim = (x, y) => {
    const [gx, gyy] = simulateMatch(x, y, rng);
    return [gx, gyy];
  };
  if (tour.stage === 'group') {
    addGroupResult(tour, YOU, opp, gy, gc);
    const [c, d] = DAYS[tour.day][1].map((k) => tour.A[k]);
    const [g1, g2] = sim(c, d); addGroupResult(tour, c, d, g1, g2); others.push(`${teamName(c)} ${g1}–${g2} ${teamName(d)}`);
    for (const [x, y] of DAYS[tour.day].map((pr) => pr.map((k) => tour.B[k]))) {
      const [gx, gyB] = sim(x, y); addGroupResult(tour, x, y, gx, gyB); others.push(`${teamName(x)} ${gx}–${gyB} ${teamName(y)}`);
    }
    tour.day++;
    if (tour.day === 3) {
      const a = standings(tour, tour.A), b = standings(tour, tour.B);
      tour.semis = [[a[0], b[1]], [b[0], a[1]]];
      tour.stage = a.slice(0, 2).includes(YOU) ? 'semi' : 'out';
      tour.news = tour.stage === 'semi'
        ? `Through to the semifinals as group ${a[0] === YOU ? 'winners' : 'runners-up'}. Elsewhere: ${others.join(', ')}.`
        : `Out in the group stage, finishing ${['first', 'second', 'third', 'fourth'][a.indexOf(YOU)]}. Elsewhere: ${others.join(', ')}.`;
      if (tour.stage === 'out') finishForOthers(tour, rng);
    } else {
      tour.news = `${won ? 'Three points.' : 'A defeat, but the group is still open.'} Elsewhere: ${others.join(', ')}.`;
    }
  } else if (tour.stage === 'semi') {
    tour.ko.push({ round: 'Semifinal', a: YOU, b: opp, ga: gy, gb: gc });
    const other = tour.semis.find((t) => !t.includes(YOU));
    const [g1, g2] = sim(other[0], other[1]);
    tour.ko.push({ round: 'Semifinal', a: other[0], b: other[1], ga: g1, gb: g2 });
    const otherWinner = g1 > g2 ? other[0] : other[1];
    const otherLoser = g1 > g2 ? other[1] : other[0];
    if (won) {
      tour.final = [YOU, otherWinner]; tour.stage = 'final';
      tour.news = `Into the final! ${teamName(otherWinner)} are waiting after beating ${teamName(otherLoser)} ${Math.max(g1, g2)}–${Math.min(g1, g2)}.`;
    } else {
      tour.stage = 'out'; tour.news = `Knocked out in the semifinal by ${teamName(opp)}.`;
      finishForOthers(tour, rng, opp, otherWinner);
    }
  } else if (tour.stage === 'final') {
    tour.ko.push({ round: 'Final', a: YOU, b: opp, ga: gy, gb: gc });
    tour.stage = won ? 'champion' : 'out';
    tour.news = won ? 'Champions of the Night Cup.' : `Beaten in the final by ${teamName(opp)}. So close.`;
  }
  if (tour.stage === 'champion') return 'You won the Night Cup!';
  if (tour.stage === 'out' || tour.stage === 'final') return tour.news;
  return won ? 'On to the next one. Continue to see the table.' : 'Continue to see where that leaves you.';
}

// Once you are out, the rest of the cup is played so the hub can show a champion.
function finishForOthers(tour, rng, semiWinnerA, semiWinnerB) {
  let w1 = semiWinnerA, w2 = semiWinnerB;
  if (w1 === undefined) {
    const [s1, s2] = tour.semis;
    const [a1, b1] = simulateMatch(s1[0], s1[1], rng); tour.ko.push({ round: 'Semifinal', a: s1[0], b: s1[1], ga: a1, gb: b1 });
    const [a2, b2] = simulateMatch(s2[0], s2[1], rng); tour.ko.push({ round: 'Semifinal', a: s2[0], b: s2[1], ga: a2, gb: b2 });
    w1 = a1 > b1 ? s1[0] : s1[1]; w2 = a2 > b2 ? s2[0] : s2[1];
  }
  const [f1, f2] = simulateMatch(w1, w2, rng);
  tour.ko.push({ round: 'Final', a: w1, b: w2, ga: f1, gb: f2 });
  tour.final = [w1, w2];
  tour.champion = f1 > f2 ? w1 : w2;
  tour.news += ` ${teamName(tour.champion)} won the cup.`;
}
