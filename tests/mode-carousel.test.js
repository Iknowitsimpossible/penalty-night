import { describe, it, expect } from 'vitest';
import { ringOffset, stepIndex, cardPose, dragDecision } from '../src/ui/mode-carousel.js';

describe('mode carousel', () => {
  it('places the selected card in the middle and its neighbours either side, wrapping around', () => {
    expect([0, 1, 2, 3].map((i) => ringOffset(i, 0, 4))).toEqual([0, 1, 2, -1]);
    expect([0, 1, 2, 3].map((i) => ringOffset(i, 3, 4))).toEqual([1, 2, -1, 0]);
  });

  it('steps both ways and wraps', () => {
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(0, -1, 4)).toBe(3);
    expect(stepIndex(1, 1, 4)).toBe(2);
  });

  it('draws the middle card full size and the side cards smaller, dimmer and to the side', () => {
    const mid = cardPose(0), left = cardPose(-1), right = cardPose(1), gone = cardPose(2);
    expect(mid).toMatchObject({ x: 0, scale: 1, opacity: 1, front: true });
    expect(left.x).toBeLessThan(0); expect(right.x).toBeGreaterThan(0);
    expect(right.scale).toBeLessThan(1); expect(right.opacity).toBeLessThan(1);
    expect(gone.opacity).toBe(0);
  });

  it('turns a long or quick drag into a move, and a small one into nothing', () => {
    expect(dragDecision(-120, 300, 440)).toBe(1);     // dragged left: the next card
    expect(dragDecision(120, 300, 440)).toBe(-1);
    expect(dragDecision(-40, 50, 440)).toBe(1);       // a quick flick
    expect(dragDecision(-30, 400, 440)).toBe(0);      // a slow nudge
  });
});
