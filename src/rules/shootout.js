// Shootout rules, shared by played and simulated matches.
// you / cpu are arrays of booleans, one per kick taken (true = scored).
// Each side takes five kicks, alternating. The shootout ends early as soon
// as one side cannot catch up with the kicks it has left. After five each,
// it goes to sudden death: one kick each until a round ends unequal.

export const goals = (kicks) => kicks.filter(Boolean).length;

export function shootoutWinner(you, cpu) {
  const ky = you.length, kc = cpu.length;
  const gy = goals(you), gc = goals(cpu);
  if (ky <= 5 && kc <= 5) {
    if (gy + (5 - ky) < gc) return 'cpu';
    if (gc + (5 - kc) < gy) return 'you';
    if (ky === 5 && kc === 5 && gy !== gc) return gy > gc ? 'you' : 'cpu';
    return null;
  }
  if (ky === kc && gy !== gc) return gy > gc ? 'you' : 'cpu';
  return null;
}

// Which side kicks next: the first side ('you') whenever both have taken
// the same number of kicks.
export const nextKicker = (you, cpu) => (you.length === cpu.length ? 'you' : 'cpu');

// Simulate a whole shootout kick by kick with the same rules as a played
// match, so simulated results stop early exactly like real ones.
// pA / pB are each side's chance of scoring a kick. Side A kicks first.
export function simulateShootout(pA, pB, rng) {
  const a = [], b = [];
  let w = null;
  while (!w) {
    if (nextKicker(a, b) === 'you') a.push(rng.chance(pA)); else b.push(rng.chance(pB));
    w = shootoutWinner(a, b);
  }
  return { a, b, ga: goals(a), gb: goals(b), winner: w === 'you' ? 'a' : 'b' };
}
