# Penalty Night

A floodlit penalty shootout in the browser, built with three.js and Vite.
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

Each folder is one system. Files outside `render/`, `ui/`, `audio/` and
`input/pointer.js` do not touch the screen, so they are unit tested.

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
| `render/` | Stadium, people, ball, effects, camera, replays, adaptive resolution |
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
  `__pn.step(1.5)`, `__pn.state`, `__pn.bench()`. It is not in production builds.
- In development, press **C** for the collision debug view: the keeper's
  collision spheres, the posts and bar, and the ball as wireframes. While
  it is on, the game freezes the first time a kick touches the frame or the
  keeper and marks the contact (red); any key or click carries on.
