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

## step2/ — the Dead Jedi test

`step2.json`: fifteen driven Command worlds — three arms (`none`, `blade`,
`dead`) × five seeds × three engagements — with the per-run rows and the
computed verdict. There are no plates; this one is a table.
