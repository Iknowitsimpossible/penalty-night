import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCameraDirector } from '../src/render/camera.js';

const STATE = { reduced: false };
const isFiniteVec = (v) => [v.x, v.y, v.z].every(Number.isFinite);

describe('camera director', () => {
  it('survives a 0x0 resize (hidden container) followed by a real one', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const director = createCameraDirector(camera);
    director.goal = 'keeper';
    director.resize(0, 0);
    director.update(1 / 60, 0, STATE);
    expect(isFiniteVec(camera.position)).toBe(true);
    director.resize(1280, 720);
    for (let i = 0; i < 30; i++) director.update(1 / 60, i / 60, STATE);
    expect(isFiniteVec(camera.position)).toBe(true);
    expect(Number.isFinite(camera.aspect)).toBe(true);
  });

  it('recovers once the shot is finite again, even after the camera went NaN', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const director = createCameraDirector(camera);
    director.goal = 'keeper';
    camera.aspect = NaN;                       // the old 0/0 bug, forced in
    director.update(1 / 60, 0, STATE);
    expect(isFiniteVec(camera.position)).toBe(false);
    director.resize(1280, 720);
    director.update(1 / 60, 1 / 60, STATE);
    expect(isFiniteVec(camera.position)).toBe(true);
    expect(camera.position.z).toBeLessThan(0);  // behind the goal
  });
});
