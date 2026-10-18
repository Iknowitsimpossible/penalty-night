# Mixamo downloads: goalkeeper first

The direction is approved (concept v1). Following the brief, we bring in **one goalkeeper**
and check its animation and performance before replacing anyone else.

Sign in at <https://www.mixamo.com> with your Adobe account.

## 1. Pick the character (once)

On the **Characters** tab, choose one body for every player, so every clip shares one skeleton.

Look for:
- realistic adult proportions (matching the 7.5-head lineup in `concept-v1.html`)
- an athletic build in fitted clothes, not baggy (we retexture the kit in Blender anyway)
- no capes, hats, long coats or anything that hides the hands or feet

Click **Download** with:

| Setting | Value |
|---|---|
| Format | FBX Binary (.fbx) |
| Pose | T-pose |

Save it as `keeper_character.fbx`.

## 2. Animations (keep that character selected)

Mixamo retargets every animation onto the selected character, so **don't change character
between downloads**. Search each term below, preview the results, and pick the one that matches
the "Look for" note. Names on Mixamo can differ slightly from mine, so the note is what counts.

| Save as | Search for | Look for |
|---|---|---|
| `keeper_idle.fbx` | Goalkeeper Idle | Knees bent, arms out, bouncing on the toes (the "Idle / ready" pose) |
| `keeper_step_L.fbx` | Left Strafe | One or two short sideways steps, staying low |
| `keeper_step_R.fbx` | Right Strafe | Same, to the right |
| `keeper_dive_high_L.fbx` | Goalkeeper Diving Save | Takes off and stretches to the top corner, lands on the side |
| `keeper_dive_high_R.fbx` | (same clip) | Same clip with **Mirror** ticked |
| `keeper_dive_low_L.fbx` | Goalkeeper Diving Save / Goalkeeper Scoop | Goes down to the grass at the bottom corner |
| `keeper_dive_low_R.fbx` | (same clip) | Same clip with **Mirror** ticked |
| `keeper_getup.fbx` | Getting Up / Stand Up | Gets up from lying on the side to standing |
| `keeper_catch.fbx` *(optional)* | Goalkeeper Catch | Ball straight at the chest (for central kicks) |

Before each download, set:

| Setting | Value | Why |
|---|---|---|
| Format | FBX Binary (.fbx) | Smallest, and converts cleanly to GLB |
| Skin | **Without Skin** | The mesh comes from `keeper_character.fbx`, so each clip carries only bone motion (much smaller files) |
| Frames per second | 30 | Plenty for three.js, which blends between frames |
| Keyframe Reduction | none | Reduction makes feet drift, which breaks "feet stay grounded" |
| In Place (if shown) | **Unticked** | Keep the real travel. I turn it into game movement in code, which is what stops the feet sliding |
| Mirror | Only where the table says | — |

Leave the sliders (Overdrive, Arm Space, Trim) at their defaults unless a preview clearly
clips through the body. If you change one, tell me what you set.

## 3. Where to put the files

Put all the `.fbx` files in `assets-src/mixamo/keeper/` in this worktree. Raw FBX stays out of
git; only the converted `.glb` is committed.

## 4. Install Blender

Install Blender (free, <https://www.blender.org/download/>). We need it for two things: turning
the FBX files into one GLB (mesh, skeleton, textures and all clips together), and painting the
gold-and-black keeper kit onto the body. Once it's installed I can run the conversion from the
command line myself.

## What was actually downloaded (2026-10-18)

Character: **Shannon** (a Mixamo footballer: shirt, shorts, socks, boots). 1.78 m, 48k triangles,
7 meshes, 61 bones, 2 textured materials. Every file uses the bone prefix `mixamorig5`, so the
clips bind to the character by name.

Measured by loading each clip in three.js (hips in metres; +x is the keeper's left):

| File | Mixamo clip | Length | Hips travel | Highest hand | Notes |
|---|---|---|---|---|---|
| keeper_idle | Goalkeeper Idle Without Ball | 4.6 s | ±0.15 | 0.90 | Loops |
| keeper_step_L / _R | Goalkeeper Left / Right Sidestep | 0.5 s | 1.1 / 1.4 | 0.95 | A long lunge-step, not a small shuffle |
| keeper_dive_high_L / _R | Goalkeeper Left / Right Diving Save | 3.4 / 3.2 s | 2.6 / 3.1 | **1.18 / 1.48** | Includes landing and getting up. Mid-height, **not** top corner |
| keeper_dive_low_L / _R | Goalkeeper Left / Right Body Block | 3.4 / 2.5 s | 1.3 / 1.2 | 1.13 / 0.90 | Proper low dives. Include landing and getting up |
| keeper_getup | Standing Up From A Soccer Fall | 1.7 s | 0.8 | — | Spare, for when a dive is cut short |
| keeper_catch | Goalkeeper Catching Ball Medium Height | 1.3 s | 0.4 | 1.37 | Central kicks |

There's no left/right "from the side" get-up on Mixamo, and no true top-corner dive (the bar is at
2.44 m). The left and right clips are separate motion-capture takes, not mirrors, so they
differ in distance and height.

## Later: the taker (not needed yet)

Once the keeper passes the acceptance check (feet grounded, natural dives, no sliding,
floating or snapping), the taker needs: Soccer Idle, a jog/run-up, and Soccer Penalty Kick,
all on the same character.
