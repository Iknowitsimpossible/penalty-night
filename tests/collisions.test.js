import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createBallState, launchVelocity, stepBall } from '../src/physics/ball.js';
import { newShot, collideStep, judge } from '../src/physics/collisions.js';
import { createRng } from '../src/core/random.js';
import { HALF, GOAL_H, PX, BAR_Y } from '../src/core/constants.js';

// Play one kick to its result with the same fixed-step loop the game uses.
function play(target, T, spin = 0, keeperSpheres = null) {
  const ball = createBallState();
  launchVelocity(ball.pos, new THREE.Vector3(target.x, target.y, 0), T, spin, ball.vel);
  ball.spin = spin;
  const shot = newShot(ball);
  const rng = createRng(1);
  const events = [];
  const h = 1 / 240;
  for (let i = 0; i < 240 * 5; i++) {
    stepBall(ball, h);
    shot.cool -= h;
    collideStep(ball, shot, keeperSpheres, rng, { post: () => events.push('post'), save: () => events.push('save'), net: () => events.push('net') });
    shot.t += h;
    const kind = judge(shot, ball);
    if (kind) return { kind, shot, events };
  }
  return { kind: null, shot, events };
}

describe('judging a kick', () => {
  it('scores a shot inside the frame and bulges the net', () => {
    const r = play({ x: 2.5, y: 1.0 }, 0.6);
    expect(r.kind).toBe('goal');
    expect(r.shot.lineAt.x).toBeCloseTo(2.5, 0);
  });

  it('calls a shot above the bar "over" and one outside the post "wide"', () => {
    expect(play({ x: 1, y: GOAL_H + 0.6 }, 0.6).kind).toBe('over');
    expect(play({ x: HALF + 0.8, y: 1 }, 0.6).kind).toBe('wide');
  });

  it('rings the post when the ball meets it', () => {
    const r = play({ x: PX, y: 1.0 }, 0.6);
    expect(r.events).toContain('post');
    expect(['post', 'goal', 'wide']).toContain(r.kind);
  });

  it('rings the bar too', () => {
    const r = play({ x: 0.5, y: BAR_Y }, 0.6);
    expect(r.events).toContain('post');
  });

  it('a keeper body in the way saves the shot', () => {
    const body = [{ c: new THREE.Vector3(2.4, 1.0, 0.35), r: 0.3 }];
    const r = play({ x: 2.4, y: 1.0 }, 0.6, 0, body);
    expect(r.kind).toBe('saved');
    expect(r.events).toContain('save');
    expect(r.shot.touchAt).not.toBe(null);
  });

  it('the same keeper does nothing to a shot in the other corner', () => {
    const body = [{ c: new THREE.Vector3(2.4, 1.0, 0.35), r: 0.3 }];
    expect(play({ x: -2.6, y: 0.5 }, 0.6, 0, body).kind).toBe('goal');
  });
});
