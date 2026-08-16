# BATTLEFRONT BORZ — session handoff

Written for whoever picks this up next, human or otherwise. It is not a status
report; it is the set of things that cost time to learn and would cost the same
again. Read the traps section before touching a tool.

Repo: `longwong377/saber2` · branch `claude/battlefront-borz-improvements-1g2xei`

> **The default branch is still `claude/lightsaber-combat-game-lxw391`.** Everything
> from this session is on the branch above, and a player opening the repo lands
> on the default and sees none of it. That cost a round trip; it will cost the
> next one too unless the default moves.
Playable: <https://longwong377.github.io/saber2/> (Pages deploys on every push
to that branch; all recent runs green)

---

## 1. State

| | |
|---|---|
| Suite | see below — run it, the number moved a lot this session |
| Smoke | 11/11 steps clean, ~2 min |
| Levels | **7**, down from 13 — six deleted on the player's word |
| Modes | **5** — the Descent is deleted, and `Run.js` with it |

Run things this way and no other way:

```bash
npm run verify                                   # the gate — 1142 checks
node --import ./tools/register.mjs tools/_one.mjs <suite>
node --import ./tools/register.mjs tools/trace.mjs --waves 20 --level colosseum
node --import ./tools/register.mjs tools/combat-trace.mjs --waves 8
node tools/smoke.mjs --shots                     # real browser, real render
```

---

## 2. Traps. Read this before writing a tool.

### 2.1 Two copies of three

`npm run verify` is `node --import ./tools/register.mjs tools/verify.mjs`. The
hook maps the bare specifier `three` onto `vendor/three`, which is what the
browser loads.

Run it as plain `node tools/verify.mjs` — the obvious thing to type — and Node
resolves `three` out of `node_modules` instead. `dom-shim.mjs` registers the
hook, but it does so while it *evaluates*, and the static graph is linked before
that. **It does not crash. It reports.** Measured back to back on a clean tree:

```
with the loader     1139 passed, 0 failed
without             1137 passed, 2 failed        ← both failures fiction
```

The loudest read *"56 of 56 geometries survived the corpse"* — every corpse in
the game leaking its materials, and nothing of the kind happening. `lifecycle`
patches `BufferGeometry.prototype.dispose`; the bodies belong to the other copy.
An afternoon went into bisecting that for order-dependence that was never there.

Both harnesses now refuse to start that way. The test is **namespace identity** —
`(await import('three')) !== THREE`. `import.meta.resolve` cannot answer it: it
says vendor either way, because by the time anything can ask, the hook is in.

A static edge from a *check* to `Engine.js` has the same shape — `Engine`
rewrites three's ShaderChunks behind once-only flags, so patching the wrong copy
burns the flag silently. Import `World.js` and `Engine.js` **dynamically**,
inside a function body.

### 2.2 The container rolls the clone back

It happened **three times** in one session, once by 40 commits. Everything
survived only because it was already on `origin`.

- **Commit and push early and often.** Do not hold a large change locally.
- Recovery: `git fetch origin <branch> && git merge --ff-only origin/<branch>`.
  Never `reset --hard`; save local edits aside first, then re-apply.
- The scratchpad is *not* durable — files written there vanished mid-session.
  Anything worth keeping goes in a commit.

### 2.3 The signature defect: a hand-maintained table beside its generated twin

Eight instances found so far. A HUD price list, an announcer voice map, the
sandbox roster, a level card's unit count, a garment length, a wire record, a
wave-boundary rule, and every level's pool weights. The fix is always the same:
**the hand-written thing stops being the authority.**

A close relative: a missing thing answered with a plausible default instead of
an error (`PEAK.get(tex) ?? 3`, `_one.mjs` printing "0 passed, 0 failed", a
12-slot record against a 13-slot packer). `determinism.mjs` has tripwires for
both.

### 2.4 Never restate a rule; call it

`tools/trace.mjs` reimplemented `isDraftWave` as `w % DRAFT_EVERY === 0`. The
shipped rule is `w % DRAFT_EVERY === 0 || this.isBossWave(wave)`. The trace
therefore showed no draft on waves 5/15/25/35, four judges concluded half the
boss waves pay nothing, and it was then "verified" by writing the *same wrong
arithmetic a second time* in a probe. It was reported to the user as fact,
twice. **The game was right throughout.**

An instrument that restates a rule will eventually disagree with it, and it
fails in the direction nobody checks: it *manufactures* defects.

### 2.5 Re-run clean before believing a result that flatters the hypothesis

"Retreating starves the spawn queue" came from a probe whose second condition
reused a world with eight bodies still standing in it. Fresh world per
condition, same seeded wave: the queue drains identically whether the player
moves or not. The confound was visible in the probe's own output — the
retreating run opened with eight enemies alive, which a fresh wave cannot do.

**Four of one day's apparent game defects were harnesses lying.** Two-copies-of-
three, the draft cadence, the smoke probes, and this. Budget for it.

### 2.6 Frames are not seconds — there is no GPU here

Everything renders through swiftshader on the CPU. Measured on an **empty**
field (801 draw calls, 1.6 M triangles at 1280×720): **one frame takes 4151 ms.**

The smoke test's probes counted rendered frames when they meant game-seconds, so
"90 frames" was six and a quarter minutes — and since `main.js` clamps `dt` to
0.1 s, it also handed the game *nine* seconds of play instead of 1.5. Wrong in
both directions at once. Use `window.__play(gameSeconds, …)`, not a frame count.

Timing checks (`prefracture`, `frame-budget`) will blow if anything else is
using the CPU. Don't run the suite next to a browser.

### 2.7 Bash has a 10-minute cap

A full `verify` run takes ~12 min. Use `run_in_background: true`. Foreground
`sleep` is blocked; use an `until` loop in a background command to wait.

---

## 3. The instruments, and what each is for

| Tool | Answers | Blind to |
|---|---|---|
| `verify.mjs` | is it **correct** | whether it is tuned or fun |
| `balance.mjs` | is it **tuned** | anything a player presses |
| `trace.mjs` | what a run **contains** | combat |
| `combat-trace.mjs` | what a fight **contains** | anything past a stationary floor |
| `smoke.mjs` | does the real page **boot and render** | mechanics |

**Why `trace.mjs` exists.** 1142 checks and two adversarial audits share one
shape: *the code claims X and does Y*. A finding needs a line to be wrong about,
so a source sweep finds broken promises and **cannot find absences**. The
judging pass built on `trace.mjs` found things no audit had, precisely because
the judges were forbidden from reading source.

**Both traces have no opinions on purpose.** No bars, no assertions. The moment
one scores something it becomes another check with a hand-written bar, which is
the shape this project keeps removing.

**`combat-trace.mjs` deliberately does not press powers.** A "kit user" firing
each power when affordable would produce output indistinguishable from a
measurement of whether the kit is worth using — and it would be a measurement of
the script. Powers are reported as *opportunity* (what each could reach, what it
would cost), never usage. The Force pool never leaving its maximum is the proof
nothing fired.

---

## 4. How the judging pass worked, and how to repeat it

Four judges, each given **only** a trace file, one named reference point, and
one dimension. Each was explicitly forbidden from opening `src/`. Then every
finding was verified against the shipped code before anything was acted on.

That last step is not optional — the judges were right about the *shape* of four
things and wrong about the *magnitude* of one (they said epics were 2.1% of
draft slots from a single seed; over 40 seeded runs it is 41.2%).

Scale honestly: audits have diminishing returns here. Audit 3's refuters
corrected *me* more often than they corrected the finders.

---

## 5. What the LAST session changed

- **13 of 13 levels compose distinctly**, where six were byte-identical. Pool
  repeats are weights now — `_pickType` already weighed per entry, but the pool
  was only ever a membership filter, so `acolyte acolyte acolyte` did nothing.
- **`beast` reachable** on the Colosseum/Arena/Deeps. It, `bodyguard` and
  `master` were kept out of ordinary waves by an *absence* (no `unlockAt`)
  indistinguishable from an oversight. The two that are meant to be boss-only
  now declare `setPieceOnly: true`; the Acklay never was.
- **Heavy share holds ~13%** instead of halving across a run. `heavyLimit` rides
  the budget, capped per-blade by `HEAVY_CAP` (a frame-rate number — a walker is
  66 meshes — not a taste one).
- **Attunement of the Bond** — bond had a mastery and no attunement, so a bond
  build was offered five permanent choices at every boss wave and none was
  theirs.
- **The open-state readout** — `openness()` pays 3×/2×/1.5× through held/yanked/
  downed bodies and nothing on screen said so.

---

## 6. Open

### 6.0 The first-person grip is OVER-CONSTRAINED — and this is the live one

Third report of "the first person hand/hilt looks like jumbled garbage", and
the first one with a number against it. `tools/_fpgeom.mjs` (new) projects
every arm joint and 31 samples along the hilt into NDC in about a second,
where `fpview.mjs` costs twenty minutes:

```
arms cover                    5.8% of the frame
hilt on screen               27.7% of frame height
of that, behind the fists              91%
```

The arms are **not** the mess and have not been since the shoulders were moved
off the ribcage. The hilt is *bigger* in frame than the reference the player
supplied (`assets/reference/first-person/`). What is wrong is that nine tenths
of it is behind a glove: `GRIP_AT` puts both fists at +0.050 and −0.015 on a
shaft whose metal spans −0.092 to +0.158.

Sliding the fists down the shaft works — 91% → 40%, and the render shows the
shroud and neck rings clear of the hand for the first time. **It also fails two
checks, and both were written for earlier rounds of this same complaint:**
raise the hilt to keep the hands in frame and looking up brings `elbowL` inside
the 100 mm the deltoid needs against a 45 mm near plane (`viewmodel.mjs`); skip
the raise and the off hand leaves the bottom of the frame (`first-person.mjs`).
Swept as a pair over grip −0.020…−0.105 against rise +0…+0.070, **nothing
satisfies both.**

The way out is what the reference shows: **one hand on the hilt in first
person**, which removes the second occluder and the folded left arm together.
That is a decision about what a first-person grip IS. Ask before doing it.

### 6.1 Held for reference images

The player asked for these to wait, and the folders are `assets/reference/`:

- **Geonosis** — the Command mode (lead named troops with permadeath and
  promotion, squads, formations, mechs, jet troopers) is built on it.
- **The Coruscant Jedi Temple** — as a level, ending in the younglings. The
  references are in and they answer the BOX problem outright, which is the
  lesson worth carrying to every interior: in
  `coruscant-temple/temple 1.jpg` the sense of place is made entirely of
  DEPTH — arcade behind arcade behind arcade, columns running up out of frame,
  light raking in from windows too high to see — and not by a ceiling and four
  walls. Every interior this project has shipped read as a cube because the eye
  could find the far wall. The fix is not more detail on the walls; it is
  putting three more colonnades between the player and them.
- **The real Mustafar** — the current one is renamed *The Ember Shelf*; its
  molten sea is still a lava sea and the player wants it changed to something
  that is not Mustafar's.
- **A flagship** — to replace the deleted *Invisible Hand*.
- **Kamino's platforms** — one slab where it should be a series of tall
  connected decks. I built the colony and rolled it back on instruction; the
  work is in the reflog if it is wanted.
- **The Drowned Wood's ground** — the last surface still drawn outside the cel
  pipeline, and the reason the meadow was deleted rather than tuned. The
  references are in and they change the JOB: `drowned-wood/dagobah.jpeg` has
  **no grass in it at all.** A swamp floor is standing water, buttress roots,
  matted litter and fallen branches — the "ground cover" is ROOTS, not blades.
  So the fix is not a better grass shader, which is what the last three
  attempts were; it is a different ground-cover kind. That also explains why
  the level reads as two games stitched together: a grass field is the one
  surface a bog cannot have, so no amount of tuning it was ever going to sit
  in the frame. `makeCoverField` already takes a kind; this wants a new one.
- **The big creatures, and Mandalorians** — "all your monsters look the same,
  sphere with some legs, like you really need to make the big enemies more
  dangerous and more interesting and menacing, they all attack the same way."
  The arena references already in
  (`colosseum/more arena.jpg`, `fighting monster in arena.jpg`) are the brief
  for the first half: three creatures share one frame and no two share a
  BODY PLAN — a bulky horned quadruped, a tall spindly six-legged insectoid, a
  low pouncing cat. Not three skins on one skeleton, which is what
  `buildQuadruped` gives today. The second half — "they all attack the same
  way" — is `Enemy.js`'s move sets, and is a separate job from the meshes.

### 6.1b Diagnosed, scoped, not yet built

**The Colosseum crowd is ONE MESH.** "I like the colosseum map, just increase
the detail for the crowd — right now it looks okay in the distance but anytime
you're near the edge you see how crude they are, make them either alien species
or mixes of aliens."

`addCrowd` (Props.js) builds exactly one figure — an extruded wedge body, a
6×5-segment sphere head, three plates — and instances it three thousand times.
Variation today is scale, garment colour and phase only, so at the rail every
spectator is the same silhouette with the same head. The reference the player
uploaded (`assets/reference/maps/colosseum/detailed arena view.webp`) shows what
the near tier should be: individual alien profiles — domed crests swept back,
horns, antennae, hooded bulk — reading as SHAPES against the sky, while the far
tiers stay a speckled texture.

The fix is four or five head/shoulder variants distributed across as many
InstancedMeshes rather than one, which costs four extra draw calls on a level
that already spends 224 hand-placed ones. It is not a shader problem and it is
not a budget problem; it simply has not been built.

### 6.2 Older design calls — the user's, not yours

Both confirmed exactly as the judges described; both defended by written
reasoning and pinned by existing checks. Do not override a stated intent on a
judge's say-so.

1. The attunement screen offers the same six cards in the same fixed order at
   every attune wave, uncapped and unexcluded. `drawBoons` explains why it is
   all six; a judge wants 3-of-6 excluding the last axis taken.
2. Insight is flat at ~1.4/wave while wave threat goes 24 → 311. The closed form
   is pinned by a check at every wave out to 60, and "no meta-progression" is
   load-bearing in `Progress.js`.

**Technical.**

3. `combat-trace.mjs` measures a stationary floor: the player dies in ~9 s, so
   the field never fills (`peakAlive` 3–4 on waves built for 20+). `--kite`
   was an attempt to fix it and made it *worse* — one body alive, zero kills.
   The cause is inside the kite, not the game (movement does not starve the
   spawner — verified). Prime suspect: `kite()` writes `p.camera.yaw` every
   frame and the stationary run never does. **Untested.**
4. Still unmeasured: power casts, damage dealt/taken per wave, time-to-clear
   under real play. Until those exist, *"is the whole kit worth using"* is
   unanswerable.
5. Order-independence residue: ~40 passing checks whose measured numbers move
   with a shared stream's phase (escalation 5, props 4, presence and co-op 3
   each). They pass both ways because they have margin. `ground` (Scenery.js) is
   the one piece of shared state the runner does not restore between suites.

---

## 6.3 New instruments

| Tool | Answers |
|---|---|
| `tools/_fpgeom.mjs` | where the first-person arms and hilt are **in the frame**, and how much of the hilt is behind the fists — one second, against `fpview.mjs`'s twenty minutes |

Both take `--import ./tools/register.mjs`; `_fpgeom` opens with `dom-shim.mjs`
because it reaches Textures.js, which bakes onto a canvas.

---

## 7. The one thing worth more than any of this

Every one of the 64 notes that drove this entire effort came from the user
**playing the game and looking at it**. The cone survived several rounds of
being "fixed" by the checks; it took a person saying it was still there.

The judges' findings are a checklist to feel for, not a substitute. If you are
choosing between another measurement pass and getting a run in front of the
user, choose the run.
