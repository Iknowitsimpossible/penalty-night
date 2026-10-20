# Penalty Night

A floodlit penalty shootout on the Moon, in the browser. Take penalties with
a swipe (or the keyboard), then dive to save theirs. Quick matches, an
eight-team cup, practice lessons and keeper training.

**[Play it here](https://iknowitsimpossible.github.io/penalty-night/)** (phone or computer, no install).

This project expands on my CMU 15-112 mini project.

## Run it yourself

```bash
npm install
npm run dev
```

Then open the address it prints. `npm test` runs the unit tests.

## Controls

| | Touch / mouse | Keyboard |
|---|---|---|
| Aim and shoot | Swipe up from the ball; bend the swipe to curl it | Arrows to aim, hold Space for power, Z / X to curl |
| Dive | Tap a spot in the goal | Arrows, then Space |
| Step (keeping) | Hold ◀ ▶ before the plant foot | A / D |
| Pause | ⏸ button | P or Esc |

When keeping, wait for the dive bar to turn gold (the taker's plant foot):
diving earlier lets them switch sides. A glowing zone then shows roughly
where the shot is going (it can be turned off in Settings).
