# Penalty Night

A floodlit penalty shootout on the Moon (Earth hangs over the far stand), drawn on a 2D canvas and built
with Vite. The look follows the art direction in
[`docs/art-direction/concept-v1.html`](docs/art-direction/concept-v1.html).
Take penalties with a swipe (or the keyboard), then dive to save theirs.
Quick matches, an eight-team cup, a practice mode that teaches both roles,
and a five-stage keeper training mode.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
npm run balance    # headless balance report (see below)
```

## Controls

| | Touch / mouse | Keyboard |
|---|---|---|
| Aim | Swipe up from the ball: angle = direction, length = height | Arrows move the target |
| Power | How fast you swipe (holding still does not count) | Hold Space, release to shoot |
| Curl | Bend the swipe; the ball follows the curve | Z / X |
| Dive | Tap a spot in the goal (a ring previews it under the mouse) | Arrows, then Space |
| Step (keeping) | Hold ◀ ▶ until the plant foot | A / D |
| Pause | ⏸ button | P or Esc (R restart, Q quit, S settings) |
| Replay | Replay button on the result card | V |

The dive bar is red while the taker can still change their mind and turns
gold at the plant foot. Diving in the red lets them switch sides.

## How the code is organised

Each folder is one system. Files outside `view2d/`, `ui/`, `audio/` and
`input/pointer.js` do not touch the screen, so they are unit tested (and so
are the camera maths in `view2d/projection.js` and `view2d/views.js`).

| Folder | What it does |
|---|---|
| `core/` | Units and constants, maths helpers, seedable randomness |
| `physics/` | Ball flight (gravity + curl) and collisions, plus `judge()` for the result |
| `input/` | Swipe reading (screen-size independent), pointer capture, keyboard aim |
| `ai/` | CPU keeper and taker decisions, difficulty levels, playing styles |
| `rules/` | Shootout rules shared by played and simulated matches |
| `tournament/` | The Night Cup: groups, tables, qualification, knockouts |
| `practice/` | The practice lessons and keeper training drills, and what counts as a valid attempt |
| `feedback/` | The plain-words explanation and advice after each kick |
| `sim/` | A headless kick (real physics, keeper body, collisions) for balance reports and acceptance tests |
| `body/` | The players' jointed bodies, the run-ups and the keeper's stance, dives and celebration, the keeper's collision spheres, and replay recording |
| `view2d/` | Everything you see: a pinhole camera and its fixed shots, the stadium (painted once per shot), the concept-style players, ball, net, effects, adaptive resolution, and the dev-only collision view |
| `ui/` | HUD, result card, cup hub, settings |
| `audio/` | Synthesized sound (nothing to download) |
| `game.js` | The match flow that connects all of the above |

## Testing tools

- `npm test` covers swipe reading, physics and collisions, CPU decisions,
  shootout and cup rules, feedback text, practice lessons, settings,
  keyboard aim and adaptive resolution, plus acceptance tests showing a
  keeper who follows each training stage's instructions saves reliably,
  and that every save or goal matches the keeper's actual body.
- `npm run balance [kicks]` plays thousands of kicks with the real physics,
  keeper body and AI and prints scoring rates per level and style. Use it
  after changing `src/ai/levels.js` or the keeper's dive.
- In development, `window.__pn` steps the game at a fixed rate for exact,
  repeatable browser checks: `__pn.freeze()`, `__pn.seed(1)`,
  `__pn.step(1.5)`, `__pn.state`, `__pn.kick(x, y)` (a kick without a swipe),
  `__pn.project(x, y, z)` (where a world point lands on screen),
  `__pn.intro()` and `__pn.bench()`. It is not in production builds.
- In development, press **C** for the collision debug view: the keeper's
  collision spheres, the posts and bar, and the ball as outlines. While
  it is on, the game freezes the first time a kick touches the frame or the
  keeper and marks the contact (red); any key or click carries on.

## How the 2D drawing works

- **One camera, fixed shots.** `view2d/projection.js` is a pinhole camera:
  a world point in metres becomes a screen point. `view2d/views.js` sets up
  the shots (behind the taker when you shoot, behind the goal when you keep,
  a low side view for replays, and the menu). The game cuts between them.
  A tap on the goal runs the projection backwards to find where you aimed.
- **The stadium is painted once.** Stands, crowd, boards, pitch and lines
  are drawn into offscreen canvases per shot and screen size, then copied
  every frame. While an end celebrates, its crowd is drawn as small pieces
  that bob up and down.
- **What you see is what saves.** The players are still the jointed
  bodies in `body/people.js`, kept in three.js objects for their maths (no
  WebGL). `view2d/figures.js` projects their hips, shoulders, gloves, feet
  and head and draws the concept's figure through them, so the gloves on
  screen are the gloves the collision spheres come from.
- **Speed.** `__pn.bench()` reports milliseconds per frame. On an M2 with
  the GPU (Chrome, pixel ratio 2), drawing a frame takes about 1.2 to 2.9 ms
  at 1280x800 and under 1 ms at 375x812, and stays under 3 ms with the CPU
  slowed 4 to 6 times to stand in for a phone.
