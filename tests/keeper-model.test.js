import { describe, it, expect } from 'vitest';
import { CLIP_ROLES, createKeeperModel, loadKeeperModel } from '../src/render/keeper-model.js';
import { KITS } from '../src/render/people.js';

// The model itself needs the real GLB (checked in the browser with
// __pn.checkKeeper()); this catches the module failing to load at all, and
// keeps the clip list and the kits in step with what the model expects.
describe('keeper model module', () => {
  it('loads and names every clip the game asks for', () => {
    expect(typeof createKeeperModel).toBe('function');
    expect(typeof loadKeeperModel).toBe('function');
    expect(CLIP_ROLES).toEqual(['idle', 'step_L', 'step_R', 'dive_high_L', 'dive_high_R', 'dive_low_L', 'dive_low_R', 'catch', 'getup']);
  });
  it('every keeper kit has the colours the model tints', () => {
    for (const kit of [KITS.cpuKeeper, KITS.youKeeper]) {
      for (const part of ['shirt', 'shorts', 'socks', 'gloves']) expect(typeof kit[part]).toBe('number');
    }
  });
});
