# FLAGSHIP.md §14 — the kill tests' artefacts

Everything here was produced by two probes and nothing here is hand-made:

    node --import ./tools/register.mjs tools/_flagship.mjs  step0|step1|step2
    node --import ./tools/register.mjs tools/_frontshot.mjs step0|step1

`_flagship.mjs` fights the battles headlessly and writes the crater logs and
the numbers into `.flagship/`. `_frontshot.mjs` boots the real game in a real
browser, replays those logs and writes the plates. Both are re-runnable and
both take their seed on the command line; everything below is seed 7.

The plates are rendered at 1280×720, quality `medium`, from ONE boot of the
game with the camera rig switched off and the eye pinned to six numbers, so
every plate in a set is the same viewpoint to the pixel. The mode is `sandbox`
with `sandboxCount: 0` — the field is empty, so what a plate shows is the
GROUND and the dressing on it and nothing else.

---

## step0/ — does visit two read as the same ground after a battle?

Ask a person this, and show them the two plates in the order given.

| plate | what it is |
|---|---|
| `step0-a-visit-one-arrival.png` | the ground as the deployment finds it, before anything happens |
| `step0-b-visit-two-arrival.png` | the SAME ground on a second visit, with one fought Command area's crater log replayed onto it |
| `step0-c-near-pristine.png` | eye height, 30 m out, no craters |
| `step0-d-near-after.png` | the same, after one fought area |
| `step0-e-near-twenty-sorties.png` | the same, after twenty sorties (§4's saturation experiment) |

`step0-seed7.json` holds the numbers; `step0-seed7-manifest.json` holds the
camera, the replay and the pixel differences between the pairs. The `.log.json`
files are the crater logs themselves — replay one onto a fresh Geonosis and
you get the ground in the plate, exactly.

**THESE PLATES HAVE BEEN RE-TAKEN, AND THE ANSWER MOVED.** The first set is
what `NEXT.md`'s Step 0 verdict was written about: the replay was exact to the
bit and **1.9%** of pixels differed in the wide shot, **0.5%** at eye height,
because a battlefield's visible marks were never in the heightfield. They lived
in `Surface` — a 29 m window that follows the player and forgets — and in the
decal ring, and the log carried neither. `Terrain.scars` is the second field
that does carry them, and the same log on the same seed now reads:

| | before | after |
|---|---|---|
| wide shot, one fought area | 1.9% | **13.2%** |
| eye height, one fought area | 0.5% | **11.0%** |
| eye height, twenty sorties against one area | — | **33.4%** |

`step0-c-near-pristine.png` is also shot DIFFERENTLY now, and the old way was
wrong the moment the scar field existed. It used to be made last, by replaying
the log with every depth negated — `Terrain.crater` takes a negative depth by
design, so the inverse of a bowl is a mound and the heightfield came back to
within its accumulation clamp. A crater now also lays soot, which is a stacking
record with no inverse, so a negated replay laid a SECOND set of marks: the
"pristine" plate would have been the most cratered one in the set. It is shot
before the replay instead, which costs one camera move and is exact.

## step1/ — put these three in order

**`step1-seed7-ANSWER-KEY.json` is the answer. Do not show it to the person
being tested.**

Hand over `plate-alpha.png`, `plate-bravo.png` and `plate-charlie.png` — the
names are deliberately neutral and deliberately not in the true order — and ask
for them earliest-to-latest. They are engagements 1, 3 and 5 of a five-
engagement deployment on one Geonosis, from the same spot facing the same way.

`step1-seed7-manifest.json` records what was put on the ground at each of the
five engagements; `step1-seed7-e*.log.json` are the cumulative crater logs the
plates were dressed with.

**RE-TAKEN, for the reason the Step 1 verdict gave.** The first set came back a
qualified yes — monotone, so there was a real ordering signal, but engagement 3
differed from engagement 1 only by *a pale haze at 100 m*, because the whole of
the difference was in the SKY. Four things changed on the ground and one in the
air: the crater log now paints as well as digs, the front lays its own burnt
swath (`Front.burnBand`), the dead lie on the line (`src/world/Fallen.js`,
§12.4's 520 prone instanced figures, two draw calls), and the smoke's alpha is
banded into five steps (§11's third named art defect).

| pixels differing | before | after |
|---|---|---|
| 1 ↔ 3 | 7.0% | **20.5%** |
| 3 ↔ 5 | 17.2% | **28.8%** |
| 1 ↔ 5 | 21.0% | **45.2%** |

Still monotone, and the weakest link — the pair the verdict named — is three
times what it was. **The test has still not been run on a person.**

## step2/ — the Dead Jedi test

`step2.json`: fifteen driven Command worlds — three arms (`none`, `blade`,
`dead`) × five seeds × three engagements — with the per-run rows and the
computed verdict. There are no plates; this one is a table.
