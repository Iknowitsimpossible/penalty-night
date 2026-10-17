// Player settings, saved in localStorage. Pure helpers below decide what
// each setting means in a given situation, so they can be tested.
export const DEFAULTS = {
  replays: 'highlights',   // 'always' | 'highlights' | 'off'
  celebrations: 'auto',    // 'auto' (short in practice and quick matches) | 'full' | 'short'
  motion: 'system',        // 'system' (follow the OS setting) | 'full' | 'reduced'
  sound: true,
};
export const OPTIONS = {
  replays: [['always', 'Always'], ['highlights', 'Highlights'], ['off', 'Off']],
  celebrations: [['auto', 'Auto'], ['full', 'Full'], ['short', 'Short']],
  motion: [['system', 'System'], ['full', 'Full'], ['reduced', 'Reduced']],
};

const KEY = 'penaltyNight.settings';

export function loadSettings(storage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY)) || {};
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const v = saved[k];
      if (OPTIONS[k] ? OPTIONS[k].some(([val]) => val === v) : typeof v === typeof DEFAULTS[k]) out[k] = v;
    }
    return out;
  } catch (e) {
    return { ...DEFAULTS };
  }
}
export function saveSettings(storage, s) {
  try { storage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
}

// Should this kick get an automatic replay?
// highlight: your goals and your saves (the moments worth watching again).
export function shouldAutoReplay(settings, { mine, kind }) {
  if (settings.replays === 'off') return false;
  if (settings.replays === 'always') return true;
  return (mine && kind === 'goal') || (!mine && kind === 'saved');
}

// Celebrations: full in the cup, short in practice and quick matches, unless overridden.
export function celebrationLength(settings, mode) {
  if (settings.celebrations === 'full') return 'full';
  if (settings.celebrations === 'short') return 'short';
  return mode === 'cup' ? 'full' : 'short';
}

export function reducedMotion(settings, systemPrefersReduced) {
  if (settings.motion === 'reduced') return true;
  if (settings.motion === 'full') return false;
  return !!systemPrefersReduced;
}
