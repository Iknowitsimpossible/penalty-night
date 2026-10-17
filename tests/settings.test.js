import { describe, it, expect } from 'vitest';
import { loadSettings, saveSettings, shouldAutoReplay, celebrationLength, reducedMotion, DEFAULTS } from '../src/ui/settings.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('settings storage', () => {
  it('starts from defaults and round-trips', () => {
    const st = memoryStorage();
    expect(loadSettings(st)).toEqual(DEFAULTS);
    saveSettings(st, { ...DEFAULTS, replays: 'off', sound: false });
    expect(loadSettings(st)).toMatchObject({ replays: 'off', sound: false });
  });

  it('ignores unknown or broken values', () => {
    const st = memoryStorage();
    st.setItem('penaltyNight.settings', JSON.stringify({ replays: 'sometimes', motion: 'reduced', sound: 'yes' }));
    expect(loadSettings(st)).toEqual({ ...DEFAULTS, motion: 'reduced' });
    st.setItem('penaltyNight.settings', '{not json');
    expect(loadSettings(st)).toEqual(DEFAULTS);
  });
});

describe('what settings mean', () => {
  it('replays highlights only by default', () => {
    const s = DEFAULTS;
    expect(shouldAutoReplay(s, { mine: true, kind: 'goal' })).toBe(true);
    expect(shouldAutoReplay(s, { mine: false, kind: 'saved' })).toBe(true);
    expect(shouldAutoReplay(s, { mine: true, kind: 'saved' })).toBe(false);
    expect(shouldAutoReplay({ ...s, replays: 'always' }, { mine: true, kind: 'wide' })).toBe(true);
    expect(shouldAutoReplay({ ...s, replays: 'off' }, { mine: true, kind: 'goal' })).toBe(false);
  });

  it('keeps celebrations short outside the cup on auto', () => {
    expect(celebrationLength(DEFAULTS, 'cup')).toBe('full');
    expect(celebrationLength(DEFAULTS, 'quick')).toBe('short');
    expect(celebrationLength(DEFAULTS, 'practice')).toBe('short');
    expect(celebrationLength({ ...DEFAULTS, celebrations: 'full' }, 'quick')).toBe('full');
  });

  it('follows the system motion setting unless overridden', () => {
    expect(reducedMotion(DEFAULTS, true)).toBe(true);
    expect(reducedMotion(DEFAULTS, false)).toBe(false);
    expect(reducedMotion({ ...DEFAULTS, motion: 'full' }, true)).toBe(false);
    expect(reducedMotion({ ...DEFAULTS, motion: 'reduced' }, false)).toBe(true);
  });
});
