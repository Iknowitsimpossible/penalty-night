import { describe, it, expect } from 'vitest';
import { LESSONS, checkLesson } from '../src/practice/lessons.js';
import { RUNUP, COMMIT } from '../src/core/constants.js';

const swipe = (curl = 0) => ({ curl, input: 'swipe' });

describe('practice lessons', () => {
  it('teaches both roles: three shooting lessons and keeper timing', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['low', 'high', 'curl', 'keep']);
    expect(LESSONS.filter((l) => l.role === 'shoot')).toHaveLength(3);
  });

  it('low shot: must be on target and low; a lucky high goal does not count', () => {
    expect(checkLesson('low', { kind: 'goal', spot: { x: 2.5, y: 0.3 }, intent: swipe() }).ok).toBe(true);
    expect(checkLesson('low', { kind: 'saved', spot: { x: 2.5, y: 0.3 }, intent: swipe() }).ok).toBe(true);
    const high = checkLesson('low', { kind: 'goal', spot: { x: 2.5, y: 1.9 }, intent: swipe() });
    expect(high.ok).toBe(false);
    expect(high.reason).toMatch(/shorter swipe/);
    expect(checkLesson('low', { kind: 'wide', spot: { x: 4.2, y: 0.3 }, intent: swipe() }).ok).toBe(false);
  });

  it('high shot: over the bar fails with a specific reason', () => {
    expect(checkLesson('high', { kind: 'goal', spot: { x: -2, y: 2.0 }, intent: swipe() }).ok).toBe(true);
    expect(checkLesson('high', { kind: 'over', spot: { x: -2, y: 2.8 }, intent: swipe() }).reason).toMatch(/Over the bar/);
    expect(checkLesson('high', { kind: 'goal', spot: { x: -2, y: 0.9 }, intent: swipe() }).reason).toMatch(/Not high enough/);
  });

  it('curved shot: needs real bend and must stay on target', () => {
    expect(checkLesson('curl', { kind: 'goal', spot: { x: 1, y: 1 }, intent: swipe(0.1) }).ok).toBe(false);
    expect(checkLesson('curl', { kind: 'wide', spot: { x: 4, y: 1 }, intent: swipe(0.8) }).reason).toMatch(/Good bend/);
    expect(checkLesson('curl', { kind: 'saved', spot: { x: 2, y: 1 }, intent: swipe(-0.6) }).ok).toBe(true);
  });

  it('keeper timing: a dive between the gold bar and the ball counts, even without a save', () => {
    const dive = (at) => ({ x: 2, y: 1, at, early: at < COMMIT });
    expect(checkLesson('keep', { kind: 'goal', dive: dive(COMMIT + 0.1), flight: 0.6 }).ok).toBe(true);
    expect(checkLesson('keep', { kind: 'saved', dive: dive(COMMIT - 0.2), flight: 0.6 }).reason).toMatch(/Too early/);
    expect(checkLesson('keep', { kind: 'goal', dive: dive(RUNUP + 0.5), flight: 0.6 }).reason).toMatch(/Too late/);
    expect(checkLesson('keep', { kind: 'goal', dive: null, flight: 0.6 }).ok).toBe(false);
  });

  it('uses keyboard words for keyboard players', () => {
    const r = checkLesson('low', { kind: 'short', spot: { x: 0, y: 0.1 }, intent: { curl: 0, input: 'keyboard' } });
    expect(r.reason).toMatch(/Hold Space/);
  });
});
