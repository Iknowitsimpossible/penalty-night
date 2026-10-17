// Everything drawn over the stadium during play: the LED scoreboard, the
// result banner, the hint line, the scouting card, and the dive and power
// meters. It only displays what it is told; the match decides the values.
import { goals } from '../rules/shootout.js';
import { styleOf } from '../ai/styles.js';
import { COMMIT, RUNUP } from '../core/constants.js';

const CURL_TEXT = { '-1': ' · curl ←', 0: '', 1: ' · curl →' };

export function createHud($) {
  let bannerTimer = 0, scoutTimer = 0;
  $('diveMeter').style.setProperty('--commit', String(COMMIT / RUNUP));

  const fillDots = (el, arr) => {
    const n = Math.max(5, arr.length + (arr.length >= 5 ? 1 : 0));
    el.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const li = document.createElement('li');
      if (i < arr.length) li.className = arr[i] ? 'goal' : 'miss';
      return li;
    }));
  };

  return {
    // The scoreboard: one dot per kick, the score, and the round.
    score(you, cpu, stageLabel) {
      fillDots($('dotsYou'), you);
      fillDots($('dotsCpu'), cpu);
      $('scoreLine').textContent = `${goals(you)} – ${goals(cpu)}`;
      const round = you.length === cpu.length ? you.length + 1 : you.length;
      $('round').textContent = (stageLabel ? stageLabel + ' · ' : '') + (round <= 5 ? `Round ${round} of 5` : `Sudden death · kick ${round - 5}`);
    },
    banner(text, sub, tone, holdMs) {
      const el = $('banner');
      $('bannerText').textContent = text; $('bannerSub').textContent = sub || '';
      el.className = tone; void el.offsetWidth; el.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { $('bannerText').textContent = ''; $('bannerSub').textContent = ''; }, holdMs || 1700);
    },
    clearBanner() {
      clearTimeout(bannerTimer);
      $('bannerText').textContent = ''; $('bannerSub').textContent = '';
    },
    hint(t) { $('hint').textContent = t; },
    // A short card about the opponent's playing style.
    scout(styleKey, seconds) {
      const st = styleOf(styleKey);
      $('scoutLabel').textContent = st.label;
      $('scoutText').textContent = st.scout;
      $('scout').hidden = false;
      clearTimeout(scoutTimer);
      scoutTimer = setTimeout(() => { $('scout').hidden = true; }, seconds * 1000);
    },
    hideScout() { clearTimeout(scoutTimer); $('scout').hidden = true; },
    // The dive timing bar: red until the plant foot, gold after it.
    // state: null to hide, or { t (seconds into the run-up), dive: { early } | null }
    diveMeter(state) {
      const el = $('diveMeter');
      el.hidden = !state;
      if (!state) return;
      const locked = state.t >= COMMIT, d = state.dive;
      el.style.setProperty('--fill', String(Math.min(1, Math.max(0, state.t / RUNUP))));
      el.classList.toggle('locked', locked && !d);
      el.classList.toggle('dived', !!d && !d.early);
      el.classList.toggle('early', !!d && d.early);
      $('diveLabel').textContent = d ? (d.early ? 'Early!' : 'Dived') : locked ? 'Dive!' : 'Wait';
    },
    // The keyboard power meter. state: null to hide, or { power, charging, curl }
    powerMeter(state) {
      const el = $('powerMeter');
      el.hidden = !state;
      if (!state) return;
      el.style.setProperty('--fill', String(state.power));
      $('powerLabel').textContent = (state.charging ? 'Power' : 'Hold Space') + CURL_TEXT[state.curl];
    },
  };
}
