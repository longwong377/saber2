# Battlefront Borz — gap fixes, and procedural levels you progress through

## Context

Two things prompted this. A comparison against a genre wishlist turned up nine
real gaps, and the finding was that most are **broken or unreachable, not
missing** — code that exists and never fires. And you want to explore
**procedural levels the player progresses through in a run**.

Written to be picked up cold, later, possibly by someone else. Every claim is
verified with `file:line`.

**Read `HANDOFF.md` §2 first.** Two rules bear on all of this: never restate a
rule the game already owns — call it (§2.4); and a check that cannot fail is
worse than no check (§2.3).

## Status — three of the four defects are closed

Verified against the tree, not remembered. Left in place rather than deleted,
because the reasoning under each is what the next reader needs and because a
list that only ever grows teaches nobody which of its arguments won.

| # | Then | Now |
|---|---|---|
| 1 | a thrown body did no damage | **closed** — the enemy branch calls `_trackHurl(e, speed, { body: true })`, with the separate coefficient item 1 asks for |
| 2 | a released grip walked forever, ragdolled | **closed** — `Actor.recover()` exists and is the recovery ending, not the cheap one |
| 3 | `Destruction.explosion()` had no caller | **closed** — `Destruction`'s constructor wraps `world.onExplosion`, so the blast reaches the destructible world through the door that already existed |
| 4 | contact dispatch lost in the Rapier migration | **open**, and still the structural one. `RapierWorld` stores `onContact` at `:338` and `:1084` and dispatches it nowhere |
| 5 | features that exist and cannot be reached | partly closed — read the section, several of its bullets have been done since |

Items 1–3 were the ones item 4 was blamed for. It is worth knowing that they
were each fixable without it: the contact system is still worth building, but it
is no longer holding three visible defects hostage.

---

# PART ONE — The gap fixes

Ordered by (player-visible value ÷ cost). Items 1–4 are defects, 5 is dead
wiring, 6 is new capability.

## 1. Thrown bodies do no damage to what they hit

`src/game/Player.js:4652-4662`. Hurling a *living* enemy applies knockback and
stun to the body you threw and never calls `_trackHurl` — the function that
makes a thrown object damage what it lands on. The prop branch three lines above
(`:4648`) does call it. **A crate is a deadlier projectile than a person**, and
bowling a droid into a squad does nothing to the squad.

**Fix:** call `_trackHurl(e, speed)` on the enemy branch. `_updateHurled`
(`:4692-4727`) already does the sweep — `clamp(mass·v²·0.0006, 8, 140)`, one hit
per victim per throw, 2.6 s window.

**Care:** a body's mass is far above a crate's, so the 140 cap will saturate
constantly. Tune a separate coefficient for bodies or the throw becomes a
one-shot crowd-clear. Price it against `IMPULSE_AS_HP` so a throw costs what
every other impulse in the game costs.

**Check:** thrown body damages what it strikes; both bodies take a share;
damage scales with mass and speed and is bounded. Extend
`tools/checks/telekinesis.mjs`.

## 2. Grip an enemy, release, and they are a broken puppet forever

`Enemy._move:4442` ragdolls a gripped living enemy. `Actor.ragdolled` is written
`true` in exactly one place (`Ragdoll.js:243`) and `false` only in the
constructor (`:149`) — **nothing un-ragdolls, anywhere**. On release `gripped`
clears so `_move` returns to walking, but `_pose` (`Enemy.js:4645`) returns early
forever: meshes hang off loose physics bodies and slide.

**Two honest fixes:**
- *Recovery* — `Actor.recover()`: re-parent meshes to the rig, clear
  `ragdolled`, restore the pose path, give a get-up beat (the stun timer is the
  natural window). This is what "ragdolled mid-air and then recovered" means and
  it is the version worth having.
- *Coherence only* — drop the walking capsule the way `topple()` does
  (`Enemy.js:2742-2746`) so a released body stays down. Much cheaper, strictly
  better than today.

**Check:** grip a living enemy, release without killing it, step the world —
assert it is animating again, or genuinely down, never walking while ragdolled.
Nothing covers release-while-alive today.

## 3. Explosions never touch the destructible world

`Destruction.explosion()` (`src/world/Destruction.js:2500-2511`) has **no caller
anywhere in `src/`**. `World.onExplosion` (`src/game/World.js:1207-1246`) does
particles, audio, knockback, damage and a terrain crater, and never touches
`world.destruction`. `Destruction.js:43` claims it is wired.

**Fix:** call it from `World.onExplosion`. Force push already reaches the same
system (`Player.js:4203` → `Destruction.forceBlast`), so the pattern exists.

## 4. Contact dispatch was lost in the Rapier migration — the structural one

The retired bespoke solver dispatches `onContact` at five sites
(`src/physics/Physics.js:524, 525, 551, 596, 597`). The current engine only
*stores* it (`src/physics/RapierWorld.js:338, 1084`). The consumers went too —
**zero handlers are passed anywhere today**, so this is not a one-line restore.

It is the root cause of #1 and #3, and of the fact that **only the player's
throws** damage anything: a crate knocked into a droid by a collapse, a blast or
another droid does nothing.

**Order:** (1) dispatch contacts in `RapierWorld.step` from Rapier's own contact
events, behind a per-body opt-in so the common case costs nothing; (2) wire one
consumer — the hurled body — and **retire** `_updateHurled`'s hand-rolled sweep
rather than keeping two systems; (3) wire debris and collapse chunks.

**Care:** highest-risk item here. Contact events fire at physics rate against
everything; unfiltered, it is a frame-budget disaster. Budget against
`tools/checks/frame-budget.mjs` and `prefracture-budget.mjs` before the second
consumer.

## 5. Features that exist and cannot be reached

- **Free PvP duels** — rounds, health, round time, boons
  (`Player.js:1574-1585`), `DuelMatch`, a whole suite in `tools/checks/pvp.mjs`.
  **No menu control ever sets `settings.pvp`.** The only writer is
  `World.js:644`, the Command-meeting branch, hard-coded to one round. *Fix:* a
  control in the Co-op tab.
- **Hold-fire** — the formation table documents `fire` as "0 is `holdFire`"
  (`Command.js:552-553`) and all six formations declare `fire: 1`, so
  `if (F.fire <= 0) holdFire(e)` (`:2543`) is unreachable. *Fix:* give one
  formation `fire: 0`, or delete the field and the claim.
- **Duel ignores run rules while still offering them** — `_compose` returns into
  `_composeDuel` before conditions are assembled (`Waves.js:2513`) and
  `Menu._syncRules` does not gate by mode. *Fix:* grey the column with a reason,
  as theatre vetoes already do.

## 6. New capability, if wanted

- **Stasis that holds a person** — `_stasisCapture` (`Player.js:5453-5464`)
  skips `LAYER.ENEMY` and needs `v² ≥ 4`. The marquee time-stop is a bolt
  freezer.
- **Multi-target grip and slam** — `gripBody`/`gripEnemy` are two scalars
  (`:4510-4517`). A held *set* plus a bring-them-together release is the best
  single moment on the wishlist.
- **Tutaminis redirect** — one boolean and two lines today
  (`World.js:2418-2421`). Absorb works; sending the bolt back is the half people
  remember.
- **Weather that means something** — `Enemy.js` has no fog or visibility term, so
  a whiteout cutting sight to 47 m changes nothing. A sight multiplier off
  `weather.localAt` is a few lines.

---

# PART TWO — Procedural levels you progress through

## Read this before designing anything

**This project has killed progression-through-levels twice, and neither death
was a code failure.**

- **The Spire** — four outdoor arenas at four altitudes. Your verdict, recorded
  in the deleted `Run.js`: *"it reads as a canyon and does not work."* The
  post-mortem: *"altitude is a fact about a place that a place cannot show you
  from the inside, and four unrelated landscapes in a row is a tour, not a
  climb."*
- **The Descent** — four rungs through an industrial complex. `Waves.js:142-145`:
  *"the reason is not that the ladder was broken — it worked. Three of its four
  rungs were the three interiors the player named as the worst rooms in the
  game… A ladder is only as good as the rooms on it."*

Both failed because **a sequence of places did not read as a sequence.** The one
thing that did work, per the deleted header, was: *a rung BORROWS a level and
changes only its air* — one building, one palette, one monotone visible variable
that only ever goes one way. The Descent's last two rungs were **the same level
entered twice, once lit and once with the power off**, and the header calls that
*"not a saving, it is the point."* Command's five areas never rebuild the world
for the same reason.

**So the design that fails is "generate ten landscapes and walk through them."**
That is the tour, twice proven. The design that has evidence behind it is **one
generated place that changes as you go down through it.**

## What to build

**A generated descent through one location.** N floors (start with 4), one
terrain family, one palette, one kit — and one visible variable that moves in
one direction only (light dying, water rising, heat climbing; pick one and let
it be the whole read).

Each floor is a fresh *shape* from a seeded generator and the *same place*: same
swatches, same prop kit, same architecture vocabulary. The player should be able
to say "I am further down the same works" and never "I am on level 3 of 10."

## What is already built (most of it)

| Asset | Where | Note |
|---|---|---|
| Analytic terrain, regenerated every load | `Terrain.js:3296-3302` | no baked arrays; `preset.height(x,z)` is called per vertex |
| **Landform analysis that self-normalises to any height function** | `Terrain.js:3394-3417` | four channels each normalised by their own σ across the map — so a *new* generator's material bands land in range automatically. This is the single most generator-friendly thing in the codebase |
| Placement primitives, explicitly generator-oriented | `Levels.js:109-246, 1106, 1151` | `polar`, `siteOk`, `findSite`, `cluster`, `drift`, `run`, `bay`, `island`. Header: *"the single biggest reason a procedural level reads as a toy is UNIFORM SCATTER"* — `drift` rejection-samples against a density field, with measured Clark–Evans ratios |
| Five group composers | `Levels.js` — `strewGround`, `strewWrecks`, `roof`, `works`, `templeColonnade` | `works` is a whole parameterised room, already built for two depths, and it now takes its gantry stations as an argument as well. **`cut` was a sixth and is gone** — a whole mine, and this row used to sell it as "orphaned, whole, callable", which is the argument for keeping dead code that every codebase makes once. It had no caller anywhere in `src/`, `tools/`, `index.html` or any level table, so nothing exercised it and nothing would have told you the day it stopped working. Git has it: `git show 08aeaf3:src/game/Levels.js` |
| A seeded dressing entry point | `Levels.js:276-295` | `beginDressing(world, seed)` already takes a seed and resets occupancy + the stone field. **Threading a run seed is a one-argument change** |
| A live hook for a run's depth | `Levels.js` — `groundMight()` | It read `world.run.tier` and `world.run.boons`, for a `run` that has not existed since `Run.js` was deleted, so two of its three terms were a constant zero. It reads `director.wave`, `campaign.index` and `takenBoons` now — the counters the game actually keeps — so the hook is live rather than notional |
| "This mode owns its ground" | `Waves.js:215`, `Menu.js:2709-2719` | `MODES.*.level` + `fixedTheatre` + `_syncTheatre`, complete and tested; built for the Descent, kept alive by Command |
| Run-seed plumbing | `Waves.js`, `Arrivals.js` | `seedWaves` / `seedArrivals` exist and take a seed; there is now a seed box on Deploy |
| **The old `Run` class, verbatim** | `git show a8fa3e2^:src/game/Run.js` | 295 lines. Carried seed, tier, wave, score, kills, `boons` *as a list with repeats* replayed into a fresh body, `hpFrac` as a **fraction** (because max hp is itself something boons move), and the Insight ledger as plain numbers |
| A stage-progression lifecycle to copy | `Command.js:742-768, 2578-2614` | ordered records with per-stage multipliers, a clear-hook that pays out and advances, an explicit end, and a durable record object that outlives every body |

## What actually has to be written

1. **Parameterised height functions.** `height(x, z)` takes only x and z; there
   is no seed and no parameter object, and `fbm2`/`ridged2` have **no seed
   argument at all** (`MathUtil.js:120, 131`) — the only seeding is hard-coded
   coordinate offsets. The seam: a preset row whose `height` is a *closure built
   from parameters* — `makeWorksHeight({ bays, span, drop, seed })`. `Terrain`
   only ever calls `preset.height(x, z)`, so this slots in with **zero changes to
   Terrain**.

2. **Generate the shape; compose the palette from authored sets.** The 20-swatch
   material half of a preset is hand-tuned with paragraphs of justification
   (`Terrain.js:168-178, 230-259`). Every one of those comments is the record of
   a palette that came out as one hue at three brightnesses — which is *still* a
   live red on Kamino. **Do not randomise swatches.** Pick from authored sets.

3. **A run object.** Recover `Run.js` and adapt it. Its three good decisions:
   boons as a **list with repeats** (so ranks land in order when replayed into a
   fresh body), hp as a **fraction**, and the ledger as **plain numbers with no
   world reference**.

4. **A floor generator** that composes the existing primitives — one `works()`
   or `cut()` per floor with different parameters, not a new room system.

5. **`Terrain.presetKey` for generated levels** (`Terrain.js:3276-3281`) —
   anything needing per-level variation reads it, so two generated floors on one
   base preset would otherwise grow identical grass.

## The real blocker, and the honest answer

**`tools/checks/roster.mjs` asserts `LEVEL_ORDER ≡ LEVELS`** and *"nobody may
name a level that does not exist"* (`:180-186`), scanning the whole tree in five
syntactic forms. **A generated level violates this by construction.**

Do not work around it. The check is right and its reason is good — a level in
`LEVELS` but not `LEVEL_ORDER` is content that shipped and cannot be chosen.
The answer is to make generated floors a **separate, registered kind**: a
`GENERATED` registry the check knows about, with its own invariant ("every
generated floor resolves to a real base preset and a real palette set"). Argue
it in the check, in the house style.

Then the cost tail, in order of pain:
- **~34 checks iterate `LEVEL_ORDER`.** Most work against a registry rather than
  a literal. `levels-quality.mjs` is the exception — it boots a real World per
  key into a `WORLDS` map and its own notes say an eighth level *"took it from
  slow to not finishing."* Generated floors need a sampled subset, argued.
- **`arrivals.mjs` is statistically sensitive to `LEVEL_ORDER.length`**
  (`:172`).
- **The Databank's "where you meet this unit"** (`Menu.js:1367`) has no meaning
  for generated levels. Decide what it says.
- `ARRIVAL_BY_TERRAIN` (`Arrivals.js:195-205`) is keyed by terrain string; a new
  key falls through to defaults.

## Staging — build it in this order

**Spike first, and judge it by eye before writing any of the rest.** One
parameterised height closure, one palette set, four floors generated from one
seed, dropped into the existing `works()` room, reachable from a debug flag. No
run object, no checks, no menu. Play it. **The only question that matters is
whether four floors read as one place** — and that is the exact question this
project has answered "no" to twice. If it does not read, stop; nothing further
is worth building.

Only if it reads: (1) the run object, recovered from `a8fa3e2^`; (2) the
`GENERATED` registry and the `roster.mjs` argument; (3) the stage lifecycle
copied from Command's `_areaClear`; (4) the mode entry with `fixedTheatre`; (5)
the check tail.

**Two traps Command wrote down for you.** Do not put a second index beside your
stage index — `AREAS` carried a `tier` column beside the rung numbers and the two
silently disagreed, so every rung-4 and rung-5 unit arrived a whole area late and
it read as "the good units never show up" (`Command.js:720-736`). And reset the
per-stage wave counter when the campaign ends, or the clear-hook re-enters on
every subsequent wave: *"a five-area campaign degenerated into an endless
roguelite that announced its own ending every ninety seconds"* (`:2616-2650`).

---

# Verification

- **Part One:** per-fix checks in `tools/checks/`, house rule — state the
  property so a coincidence cannot satisfy it, derive lists from the game.
  Re-run `telekinesis`, `destruction`, `physicality`, `sliceable`,
  `prefracture-budget`, `powers`, `pvp`, `command`, `coop`, `frame-budget`.
- **Part Two:** the spike is judged by playing it, not by a suite. After that,
  `roster`, `levels-quality`, `escalation`, `world-immersion`, `terrain`,
  `arrivals`, `cel`, `ground-cover`, `ground-memory`.
- The gate: `npm run verify` — currently **1311 passed, 5 failed, ~13 min**.
- Play it: `node tools/pack.mjs /tmp/borz.html` → one self-contained file, no
  server. Thrown-body damage and grip-release are both felt in ten seconds and
  no check will fully judge either.
