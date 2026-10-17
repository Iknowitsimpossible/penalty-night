// The after-kick card: a small goal with marks (where you aimed, where it
// went, where the keeper dived), one line of advice, and a Replay button.
// It moves on by itself; tapping anywhere else continues straight away.
import { HALF, GOAL_H } from '../core/constants.js';

const S = 14;            // SVG units per metre
const GX = 60, GY = 46;  // centre of the goal line in the SVG
const W = 120, H = 56;

const LEGEND = {
  aim: 'Aimed',
  ball: { shooter: 'Went', keeper: 'Their shot' },
  keeper: 'Keeper dived',
  dive: 'Your dive',
};

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function markShape(m, view) {
  const x = Math.max(3, Math.min(W - 3, GX + (view === 'keeper' ? -m.x : m.x) * S));
  const y = Math.max(3, Math.min(H - 3, GY - m.y * S));
  if (m.type === 'aim') return el('circle', { cx: x, cy: y, r: 4.2, class: 'fb-aim' });
  if (m.type === 'ball') return el('circle', { cx: x, cy: y, r: 3.2, class: 'fb-ball' });
  const g = el('g', { class: m.type === 'dive' ? 'fb-dive' : 'fb-keeper' });
  g.append(el('path', { d: `M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}` }));
  return g;
}

export function createFeedbackCard({ root, svg, title, detail, advice, legend, replay, timer }, { onReplay }) {
  replay.addEventListener('click', (e) => { e.stopPropagation(); onReplay(); });

  function drawGoal(marks, view) {
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.append(el('line', { x1: 0, y1: GY, x2: W, y2: GY, class: 'fb-ground' }));
    for (let i = 1; i < 6; i++) {
      const x = GX - HALF * S + (i / 6) * 2 * HALF * S;
      svg.append(el('line', { x1: x, y1: GY - GOAL_H * S, x2: x, y2: GY, class: 'fb-net' }));
    }
    svg.append(el('path', { d: `M${GX - HALF * S} ${GY}V${GY - GOAL_H * S}H${GX + HALF * S}V${GY}`, class: 'fb-frame' }));
    for (const m of marks) svg.append(markShape(m, view));
  }

  return {
    show(expl, { canReplay }) {
      title.textContent = expl.title;
      detail.textContent = expl.detail;
      advice.textContent = expl.advice || '';
      advice.hidden = !expl.advice;
      drawGoal(expl.marks, expl.view);
      legend.replaceChildren(...expl.marks.map((m) => {
        const li = document.createElement('li');
        li.className = `fb-key-${m.type}`;
        const label = LEGEND[m.type];
        li.textContent = typeof label === 'string' ? label : label[expl.view];
        return li;
      }));
      replay.hidden = !canReplay;
      root.hidden = false;
    },
    progress(f) { timer.style.setProperty('--left', String(Math.max(0, 1 - f))); },
    hide() { root.hidden = true; },
    get visible() { return !root.hidden; },
  };
}
