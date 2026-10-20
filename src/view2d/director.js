// The 2D camera director: picks a fixed shot for each moment of the game
// and cuts between them, like a TV broadcast. (The 3D game glided; with
// the stadium painted once per shot, cuts keep every frame cheap.) It also
// keeps a small screen jolt for when the ball hits the frame.
const SHOTS = { intro: 'menu', menu: 'menu', pick: 'pick', shoot: 'shoot', celebrate: 'shoot', keeper: 'keeper' };

export function createDirector() {
  let shake = 0;
  const jolt = [0, 0];
  const director = {
    goal: 'menu',
    replaySide: 1,         // set by the replay: which side of the pitch the side camera stands
    // the view (views.js) for the current goal
    get view() {
      if (director.goal === 'replay') return director.replaySide < 0 ? 'replayL' : 'replayR';
      return SHOTS[director.goal] || 'menu';
    },
    // s: { reduced }
    update(dt, time, s) {
      shake = s.reduced ? 0 : shake * Math.exp(-dt * 9);
      // the old 3D jolt was in metres at the camera; about 400 px per metre on screen
      const k = Number.isFinite(shake) ? shake * 400 : 0;
      jolt[0] = Math.sin(time * 61) * k; jolt[1] = Math.sin(time * 47 + 1) * k;
    },
    get jolt() { return jolt; },
    snap() {},
    shake(amount) { if (Number.isFinite(amount)) shake = Math.max(shake, amount); },
  };
  return director;
}
