# THE LINE, on a screen, for the first time

`MODES.theline` is the flagship mode and until these plates were taken **it had
never been drawn**. Everything proven about it — the win rule, the seeded and
generated ground, the marching front, the levy of forty, the LOD ladder — was
measured headless, and `tools/checks/frontdoor.mjs`, the only check in the tree
that boots the real page, presses Ignite on whatever the default profile has
selected, which is `roguelite` and never this.

Nothing here is hand-made. One command, one boot of the shipped tree:

    node --import ./tools/register.mjs tools/_lineeye.mjs --seed 5 --secs 3 --instant

The route is a player's: the Deploy panel, the Mode column scrolled down to the
card that says **The Line**, `5` typed into the seed box, **Instant arrivals**
ticked in Options, Ignite, the deploy card, Drop. Nothing is set through
`localStorage` except the two volume sliders, because the route is part of what
is under test. 1280×720, quality `high`, the shipped defaults otherwise.

Seed 5 rolls **Geonosis**, which is the one ground of the seven that publishes
`world.strewWrecks` and `world.smokeAir` — so these plates are the mode at its
best-dressed, not its typical.

| plate | what it is |
|---|---|
| `01-front-screen-1280x720.png` | the front door on a fresh profile. The Mode column shows two of nine cards; **The Line is the seventh**, 340 px below the fold of a 362 px band. The column scrolls and the card is reachable — it is not on screen when the player first looks. |
| `02-the-line-picked.png` | The Line selected. The Theatre column greys and prints the mode's own sentence; the seed box holds 5. |
| `03-deploy-card.png` | FLAGSHIP §5's 0:00, and it is all there: `GRIND · 5 ENGAGEMENTS · 30–45 MIN`, `GEONOSIS`, the five stages, the ten names, `SEED 5`, `STANDING 10`. |
| `04-first-frame-on-the-ground.png` | the first frame after Drop. The HUD is right and the roster panel carries all ten names. **The frame contains none of the mode's content**: no trooper (0 of 10 are inside it — they stand 83–179° off centre at 4–8.4 m), no burn band, no smoke, no wrecks, no fallen. The front is 171 m away and **151° behind the camera**. |
| `05-look-front.png` | the same instant, the camera turned to face the front through `Front.frontCamera`. |
| `06-look-right.png` · `07-look-back.png` · `08-look-left.png` | and the other three quarters, so where the mode's content is standing is a picture rather than a number. |

## the one number the plates are about

`Player`'s rig opens at `yaw = Math.PI` and nothing on the solo path writes it
again; the front's bearing is a seed roll. Over the 169 seeds of 200 that roll a
ground carrying a plan, measured through `battlefieldGround` → `engagementFront`
→ `frontCamera` against a half-horizontal FOV of 45.7° at the shipped `fov: 60`
on 16:9:

    38 of 169 seeds — 22% — open with the front anywhere inside the frame

    seed 1  alpine    front 204 m,   52° off
    seed 2  drifts    front 163 m, -179° off
    seed 3  mustafar  front 164 m,  145° off
    seed 5  geonosis  front 171 m, -151° off

§5's 0:24 beat is "**You can see the front.**" Four runs in five open looking at
clean ground with it behind them.

## why the frame is empty — measured, not inferred

`tools/_linelook.mjs` prints every body's range and bearing off the camera's own
centre line, its LOD rung, whether its rig is parented to the scene, whether a
merged skin or a cohort has it, and whether the **renderer's own frustum**
contains it. Seed 5, Geonosis, instant arrivals, nobody driving:

    t = 0.03 s   10 alive   4.0–8.4 m    every one 83°–180° off centre
                 lod 0, 0 detached, 0 merged, 0 cohorted    0 of 10 IN FRAME
                 1 hostile at 87 m, in frame

    t = 10 s      8 alive   3.5–10.6 m   121°–180° off       0 of 8  IN FRAME
                 49 hostiles, 30–90 m, 15 in frame, none past L3_AT (137.8 m)
                 lod census {0:2, 1:24, 2:23}, 0 detached

    t = 30 s      7 alive   8.3–25.9 m                       1 of 7  IN FRAME
                 20 hostiles, 12–146 m, 13 in frame, 1 past L3_AT

Nothing is missing and nothing is culled. It is **placement**:

- `DEFAULT_FORMATION` is `behind` — *"In column behind you. You are the point of
  the spear"* — whose slot is `z = -(3.0 + rank·2.2)`, every trooper at negative
  local Z.
- The formation's frame is the commander's held **body heading** (`headingOf`,
  slewed on a 40° deadband), not the aim — so turning the camera does not bring
  them round; they re-form behind whatever direction the player commits to.
- `Player` opens its rig at `camera.yaw = Math.PI` and nothing on the solo path
  writes it again, so at 0:00 the body heading and the camera agree.
- Half the horizontal frame is 45.7° at the shipped `fov: 60` on 16:9.

The mode's entire named army is in the half of the world the camera does not
cover, on the frame the player first sees it — and the front is in that half
too. The "49 remaining" on the wave counter is the QUEUE, not the field: the
queue drains to 49 standing by t = 10 s.
