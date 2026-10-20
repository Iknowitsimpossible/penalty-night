// The mode picker as a carousel: one big card in the middle, its
// neighbours peeking in at the sides, smaller and dimmer. Swipe or drag,
// click the arrows or a side card, press the arrow keys, or scroll to move
// between modes; the dots show where you are. It wraps around.
//
// The maths (which card sits where) is plain functions, so it is tested;
// createModeCarousel() wires it to the page.

// The shortest signed distance from the selected card to card i, on a ring
// of n cards: 0 is the middle, -1 the left neighbour, +1 the right one.
export function ringOffset(i, selected, n) {
  let d = (((i - selected) % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

// Index after moving by dir (+1 / -1), wrapping around.
export const stepIndex = (index, dir, n) => (((index + dir) % n) + n) % n;

// Where a card is drawn: its offset from the middle (plus any live drag, in
// card widths) becomes a slide, a shrink and a fade. Cards more than one
// place away are hidden.
export function cardPose(offset) {
  const a = Math.abs(offset);
  return {
    x: Math.sign(offset) * Math.min(a, 1.6) * 0.78,   // card widths
    scale: 1 - 0.18 * Math.min(a, 1),
    opacity: a <= 1 ? 1 - 0.45 * a : Math.max(0, 0.55 - (a - 1) * 1.1),
    dim: Math.min(a, 1),
    front: a < 0.5,
  };
}

// A horizontal drag (px) becomes a move when it is long enough or quick enough.
export function dragDecision(dx, ms, cardWidth) {
  const far = Math.abs(dx) > cardWidth * 0.18;
  const flick = Math.abs(dx) > 24 && Math.abs(dx) / Math.max(ms, 1) > 0.5;
  return far || flick ? (dx < 0 ? 1 : -1) : 0;
}

// els: { root, track, cards: [...], prev, next, dots }. start: first index.
// onChange(index): when the selection changes (to remember it).
export function createModeCarousel(els, { start = 0, onChange = () => {} } = {}) {
  const { track, cards, prev, next, dots } = els;
  const n = cards.length;
  let index = ((start % n) + n) % n;
  let drag = null;   // { x0, t0, dx, id }
  let wheelLock = 0;

  function layout(dragCards = 0) {
    const w = cards[index].offsetWidth || 1;
    cards.forEach((card, i) => {
      const off = ringOffset(i, index, n) + dragCards;
      const p = cardPose(off);
      card.style.transform = `translateX(${p.x * w}px) scale(${p.scale})`;
      card.style.opacity = String(p.opacity);
      card.style.setProperty('--dim', String(p.dim));
      card.style.zIndex = String(10 - Math.round(Math.abs(off) * 2));
      const active = i === index;
      card.classList.toggle('active', active);
      card.inert = !active;                 // only the middle card's buttons can be tabbed to or pressed
      card.setAttribute('aria-hidden', String(!active));
    });
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    track.classList.toggle('dragging', !!dragCards);
  }
  function go(i) {
    const was = index;
    index = ((i % n) + n) % n;
    layout();
    if (index !== was) onChange(index);
  }
  const move = (dir) => go(stepIndex(index, dir, n));

  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));

  // Swipe or drag the cards. A short tap on a side card picks it (side
  // cards are inert, so the tap lands on the track and is matched by position).
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    drag = { x0: e.clientX, t0: performance.now(), dx: 0, id: e.pointerId, moved: false };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(drag.dx) > 8) { drag.moved = true; try { track.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ } }
    if (drag.moved) layout(drag.dx / (cards[index].offsetWidth * 0.78 || 1));
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (d.moved) {
      const dir = dragDecision(d.dx, performance.now() - d.t0, cards[index].offsetWidth);
      if (dir) move(dir); else layout();
      return;
    }
    // a tap: on a side card, bring it to the middle
    for (let i = 0; i < n; i++) {
      if (i === index || Math.abs(ringOffset(i, index, n)) !== 1) continue;
      const r = cards[i].getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { go(i); return; }
    }
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; layout(); } });

  // Scroll: one card per notch (or per trackpad swipe), sideways or up/down.
  els.root.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 4) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 380;
    move(d > 0 ? 1 : -1);
  }, { passive: false });

  window.addEventListener('resize', () => layout());
  layout();

  return {
    get index() { return index; },
    go, move, layout,
    // Arrow keys while the picker is showing. Returns true when used.
    keydown(e, k) {
      if (els.root.hidden) return false;
      if (k === 'ArrowLeft') { e.preventDefault(); move(-1); return true; }
      if (k === 'ArrowRight') { e.preventDefault(); move(1); return true; }
      return false;
    },
  };
}
