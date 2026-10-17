import { describe, it, expect } from 'vitest';
import { explainKick, explainSave, describeSpot } from '../src/feedback/explain.js';
import { RUNUP } from '../src/core/constants.js';

const intent = (o = {}) => ({ aimX: 2.5, aimY: 1.2, power: 0.7, curl: 0, ...o });

describe('describeSpot', () => {
  it('names corners from the shooter side, and mirrors for the keeper', () => {
    expect(describeSpot(3, 2)).toBe('top right');
    expect(describeSpot(-3, 0.3)).toBe('low left');
    expect(describeSpot(0, 1)).toBe('down the middle');
    expect(describeSpot(3, 2, 'keeper')).toBe('your top left');
  });
});

describe('explainKick', () => {
  it('tells you to shorten the swipe when you aimed over', () => {
    const e = explainKick({ kind: 'over', intent: intent({ aimY: 3.1 }), ball: { x: 2.5, y: 3.1 }, keeper: null });
    expect(e.advice).toMatch(/Shorten your swipe/);
    expect(e.marks.map((m) => m.type)).toEqual(['aim', 'ball']);
  });

  it('blames curl when the aim was inside the post but it bent wide', () => {
    expect(explainKick({ kind: 'wide', intent: intent({ aimX: 3.2, curl: 0.9 }), ball: { x: 3.9, y: 1 } }).advice).toMatch(/Less curl/);
    expect(explainKick({ kind: 'wide', intent: intent({ aimX: 4.5 }), ball: { x: 4.5, y: 1 } }).advice).toMatch(/Swipe straighter/);
  });

  it('explains a guessing keeper', () => {
    const e = explainKick({ kind: 'saved', intent: intent(), ball: { x: 2.4, y: 1.1 }, keeper: { kind: 'gamble', target: { x: 2.2, y: 1 } } });
    expect(e.advice).toMatch(/guessed your side/);
    expect(e.marks.at(-1)).toEqual({ type: 'keeper', x: 2.2, y: 1 });
  });

  it('asks for a faster swipe after a slow shot is read', () => {
    const e = explainKick({ kind: 'saved', intent: intent({ power: 0.2 }), ball: { x: 2.6, y: 0.3 }, keeper: { kind: 'read', target: { x: 2.4, y: 0.4 } } });
    expect(e.advice).toMatch(/Swipe faster/);
  });

  it('says too soft for a short shot', () => {
    expect(explainKick({ kind: 'short', intent: intent({ power: 0 }), ball: { x: 1, y: 0.1 } }).advice).toMatch(/faster/);
  });
});

describe('explainSave', () => {
  const shot = { x: -2.5, y: 0.5 };
  it('says you dived too early when the taker switched', () => {
    const e = explainSave({ kind: 'goal', shot, dive: { x: 2.5, y: 0.6, at: 0.4, early: true }, switched: true, flight: 0.6 });
    expect(e.advice).toMatch(/You dived too early/);
    expect(e.marks.map((m) => m.type)).toEqual(['ball', 'dive']);
  });

  it('says too late when the dive came well after the strike', () => {
    const e = explainSave({ kind: 'goal', shot, dive: { x: -2.4, y: 0.5, at: RUNUP + 0.5, early: false }, switched: false, flight: 0.6 });
    expect(e.advice).toMatch(/Too late/);
  });

  it('points at a style habit after a wrong-way dive', () => {
    const e = explainSave({ kind: 'goal', shot, dive: { x: 2.5, y: 0.5, at: 0.9, early: false }, switched: false, flight: 0.6, style: 'rightFooted' });
    expect(e.advice).toMatch(/favour your right/);
  });

  it('coaches the height when the side was right', () => {
    const e = explainSave({ kind: 'goal', shot: { x: -2.5, y: 2.1 }, dive: { x: -2.5, y: 0.4, at: 0.9, early: false }, switched: false, flight: 0.6 });
    expect(e.advice).toMatch(/Dive higher/);
  });

  it('asks you to dive at all', () => {
    expect(explainSave({ kind: 'goal', shot, dive: null, switched: false, flight: 0.6 }).advice).toMatch(/Tap where to dive/);
  });

  it('praises a well-timed save', () => {
    const e = explainSave({ kind: 'saved', shot, dive: { x: -2.5, y: 0.5, at: 0.9, early: false }, switched: false, flight: 0.6 });
    expect(e.title).toBe('Saved');
    expect(e.advice).toMatch(/Perfect timing/);
  });
});
