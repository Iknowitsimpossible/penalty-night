// The cup hub: what to show between cup matches (stage, news, next
// fixture with scouting, both group tables, and the knockout bracket).
// hubView() is a pure function of the cup state, so it can be tested.
import { TEAMS, YOU, currentFixture, standings, goalDifference, teamName } from '../tournament/cup.js';
import { styleOf } from '../ai/styles.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const swatch = (i) => `<span class="sw" style="background:${hex(TEAMS[i].color)}"></span>`;
export const signed = (n) => (n > 0 ? `+${n}` : String(n));

const STAGE_NAMES = { group: 'Group stage', semi: 'Semifinals', final: 'Final', champion: 'Champions', out: 'Knocked out' };

function tableHtml(tour, title, group) {
  const rows = standings(tour, group).map((i, k) => {
    const t = tour.table[i];
    const cls = [k < 2 ? 'through' : '', i === YOU ? 'me' : ''].join(' ').trim();
    return `<tr class="${cls}"><td>${swatch(i)}${TEAMS[i].code}</td><td>${t.p}</td><td>${t.w}</td><td>${t.l}</td><td>${signed(goalDifference(t))}</td><td>${t.pts}</td></tr>`;
  }).join('');
  return `<div><table class="cup-table"><caption>${title}</caption><thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function knockoutHtml(tour) {
  const played = (a, b) => tour.ko.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  const line = (round, a, b) => {
    const m = played(a, b);
    const score = m ? (m.a === a ? `${m.ga}–${m.gb}` : `${m.gb}–${m.ga}`) : 'to play';
    return `<div class="tie"><span><span class="rnd">${round}</span>${swatch(a)}${teamName(a)} v ${swatch(b)}${teamName(b)}</span><b>${score}</b></div>`;
  };
  let html = '<div class="lbl">Knockout</div>' + tour.semis.map((t) => line('Semifinal', t[0], t[1])).join('');
  if (tour.final) html += line('Final', tour.final[0], tour.final[1]);
  return html;
}

export function hubView(tour) {
  const fx = currentFixture(tour);
  let fixtureHtml = null;
  if (fx) {
    const team = TEAMS[fx.opp], st = styleOf(team.style);
    const stars = Math.max(1, Math.round(team.rating * 5));
    fixtureHtml = `<div class="who"><small>${fx.label} · next match</small>${swatch(fx.opp)}${team.name}</div>
      <div class="stars">Keeper <b>${'●'.repeat(stars)}${'○'.repeat(5 - stars)}</b></div>
      <p class="scouting"><b>${st.label}.</b> ${st.scout}</p>`;
  }
  return {
    eyebrow: `The Night Cup · ${STAGE_NAMES[tour.stage]}`,
    title: tour.stage === 'group' ? `Matchday ${tour.day + 1} of 3`
      : tour.stage === 'semi' ? 'Semifinal' : tour.stage === 'final' ? 'The Final'
      : tour.stage === 'champion' ? 'Champions!' : 'Knocked out',
    news: tour.news,
    fixtureHtml,
    tablesHtml: tableHtml(tour, 'Group A', tour.A) + tableHtml(tour, 'Group B', tour.B),
    koHtml: tour.semis ? knockoutHtml(tour) : null,
    done: tour.stage === 'champion' || tour.stage === 'out',
  };
}
