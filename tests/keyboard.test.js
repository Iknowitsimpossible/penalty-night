import { describe, it, expect } from 'vitest';
import { createKeyboardAim, CHARGE_TIME } from '../src/input/keyboard.js';
import { flightTime } from '../src/input/swipe.js';

const ev = (key, repeat = false) => ({ key, repeat, preventDefault() {} });

function setup(initialMode = 'shoot') {
  let mode = initialMode;
  const shots = [], dives = [];
  const k = createKeyboardAim({ mode: () => mode, on: { shoot: (kick) => shots.push(kick), dive: (x, y) => dives.push({ x, y }), wake() {} } });
  return { k, shots, dives, setMode: (m) => { mode = m; } };
}

describe('keyboard aim', () => {
  it('moves the target with arrows and mirrors left/right when keeping', () => {
    const { k, setMode } = setup('shoot');
    k.keydown(ev('ArrowRight'), 'ArrowRight'); k.update(0.5); k.keyup(ev('ArrowRight'));
    expect(k.state.x).toBeGreaterThan(1);
    setMode('keep'); k.reset();
    k.keydown(ev('ArrowRight'), 'ArrowRight'); k.update(0.5); k.keyup(ev('ArrowRight'));
    expect(k.state.x).toBeLessThan(-1);   // screen right is world -x for the keeper
  });

  it('power grows with how long Space is held, and key repeat does not restart it', () => {
    const { k, shots } = setup('shoot');
    k.keydown(ev(' '), ' ');
    k.update(CHARGE_TIME / 2);
    k.keydown(ev(' ', true), ' ');        // auto-repeat while held
    k.update(CHARGE_TIME / 4);
    k.keyup(ev(' '));
    expect(shots).toHaveLength(1);
    expect(shots[0].power).toBeCloseTo(0.75, 5);
    expect(shots[0].T).toBeCloseTo(flightTime(0.75), 5);
    expect(shots[0].input).toBe('keyboard');
  });

  it('Z and X toggle curl', () => {
    const { k } = setup('shoot');
    k.keydown(ev('x'), 'x'); expect(k.state.curl).toBe(1);
    k.keydown(ev('x'), 'x'); expect(k.state.curl).toBe(0);
    k.keydown(ev('z'), 'z'); expect(k.state.curl).toBe(-1);
  });

  it('Space dives to the target when keeping', () => {
    const { k, dives } = setup('keep');
    k.keydown(ev(' '), ' ');
    expect(dives).toEqual([{ x: 0, y: 1.2 }]);
  });

  it('A and D report a step direction while held', () => {
    const { k } = setup('keep');
    expect(k.stepDir()).toBe(0);
    k.keydown(ev('d'), 'd'); expect(k.stepDir()).toBe(1);
    k.keyup(ev('d'));
    k.keydown(ev('a'), 'a'); expect(k.stepDir()).toBe(-1);
    k.keyup(ev('A'));                     // released with Shift held still clears it
    expect(k.stepDir()).toBe(0);
  });

  it('does nothing with Space when no kick is live', () => {
    const { k, shots, dives } = setup(null);
    expect(k.keydown(ev(' '), ' ')).toBe(false);
    k.keyup(ev(' '));
    expect(shots).toHaveLength(0); expect(dives).toHaveLength(0);
  });
});
