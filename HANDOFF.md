# BATTLEFRONT BORZ — session handoff

Written for whoever picks this up next, human or otherwise. It is not a status
report; it is the set of things that cost time to learn and would cost the same
again. Read the traps section before touching a tool.

Repo: `longwong377/saber2` · branch `claude/battlefront-borz-improvements-1g2xei`

> **THE DEFAULT BRANCH HAS MOVED.** PR #1 merged 303 commits into
> `claude/lightsaber-combat-game-lxw391` (merge `a092074`), so the default *is*
> this work now and a player opening the repo lands on it. The note that used to
> stand here — that everything was stranded on a side branch — is discharged.
>
> The working branch was restarted from the merged default afterwards, which is
> what a merged PR requires: do not stack new commits on the old history.

Playable two ways:

- <https://longwong377.github.io/saber2/> — Pages deploys on every push to the
  **default** branch only (see `.github/workflows/pages.yml`; a feature branch
  publishes nothing, which is worth knowing before you worry about a push).
- `node tools/pack.mjs <out.html>` — the whole game as ONE self-contained file,
  no server. See §3.

---

## 0. V13 — WHAT LANDED, AND WHAT TO DO FIRST

Branch `claude/saber-game-improvements-v12-6f83co`. The player's V13 list is in
`PLAYTEST.md`'s top entry with a check named on every row. Two new design
documents were settled BEFORE any code: `COMPANIONS.md` and `SABERFORMS.md`.

**The three headline items.**

- **THE COMPANION.** `companions` (39). One body that is yours in every mode
  without ever being on the roll. `CompanionKinds.js` is twelve ROWS and
  nothing anywhere switches on a kind's name; `Companions.js` is the sim;
  `Kennel.js` is the durable record with its own fold; `CompanionDeck.js` is
  the hangar body; `CompanionLife.js` is what it does between the actions.
  **Command.js and World.js gained ZERO lines** — the Levy seam (a `_think`
  wrap that substitutes `ctx.pickTarget` for ONE body and answers from
  `world._hostilesFor`) is what makes a companion find enemies in the nine
  modes that build no CommandDirector. **All twelve kinds have a body**, all
  twelve kind VERBS do something, the ladder fires in real play, and every
  commander in a session brings their own.
- **THE THREE SABER SETS.** `saberforms` (12). The single blade is held against
  a 600-frame RECORDING of the pre-change tree — 9 600 floats, worst drift
  0.00e+0 — and `Saber.js`/`Combat.js` gained nothing at all. Every clause of
  the ask is its own driven check: the staff's reach, the telekinetic spin
  barrier that stops bolts with your hands free, throwing one blade and
  fighting with the other, the staff's faster follow-up, and the pair doing
  the most work against four bodies at once.
- **The five smaller rows**, each with its check: the randomize button, the
  graves, the head spin, the desecration, the push that throws you.

**WHAT IS NOT DONE, and it is the first thing to pick up.**

- **A guest's companion earns no experience.** Four of the six deeds read
  fields the snapshot does not carry — `downed` is not sent at all, and a
  net-driven body's `target` is not the target the order was about — so
  `_ledger` refuses to award off one, and a guest's animal comes home with its
  run counted and its rung where it started. The fix is the host running the
  ledger and reporting deltas back.
- **One ending diverges.** `_extracting` is not on the wire, so a companion
  that leaves on the ship in a run that is NOT won folds as abandoned on the
  guest's machine and kept on the host's. Every other ending agrees. That one
  is a boolean on the wire.
- **A companion never settles on Geonosis** — 1.30 m of station gap held at
  4.25 m/s indefinitely with the field cleared, `Enemy._move`'s stuck commit
  fighting terrain clutter — so its idle beats never fire on that level. On
  the colosseum the gap is 0.07 m and it is calm 39.5 s of 40.
- **Three verbs are honest stubs.** SPOT's climb is one line and a no-op until
  the hawk has `installFlight`; CHARGE's bite-while-you-ride is unreachable
  because no companion row declares `crew`, so `Driving.whyNotDrive` refuses
  every mount; TEND does not make the droid worth two men, because `_tickDown`
  reads `trooper.medic` and a companion has no Trooper.
- **`HUD.js` holds a second copy** of "which body in the pack is mine"
  (`HUD.js:2416`), which `body0` now restates. One of them should go.
- **The wookiee's arm and thigh coats are still culled past 30 m.** The shins
  and feet were moved across that line and marked silhouette; the arms are a
  judgement call left alone.

### 0.1 The defects this round found by LOOKING and by DRIVING

Every one of these was live in the shipped tree and none was caught by a
check, which is why each now has one.

- **`this.control.setHalf` was written twenty lines above the statement that
  assigns `this.control`** — so a staff or a paired-blade player threw in the
  Player CONSTRUCTOR, every mode, every deploy. Invisible because the single
  blade skips that whole block, so the default path was clean and both new
  weapons were unreachable from the first frame.
- **`keepCompanion` read `world._companion` while the pack lives at
  `_companions`** — a truthy marker passed the guard, `body0` came back
  undefined, and every SURVIVING companion was folded as dead.
- **`CompanionPack` had `dispose()` and not `destroy()`**, which is what
  `World.unload` calls — tearing down any level with a companion threw.
- **The deck's rename path had zero callers.** `beginNaming`/`typeName`/
  `commitName` were written, argued and correct since the deck editor landed,
  and `callsign` was in `EDIT_OPS` and never offered by `optionsFor`. The
  equality check passed the whole time because both surfaces agreed about the
  WORD while one had no way to reach it.
- **The player's Trust in the Force would have swapped your pet.** The
  companion picker sits under `[data-panel="saber"]`, which is exactly the
  root that button walks — and picking a different kind RETIRES the one you
  have. `opts.skip` is the fence and the check proves the fence is
  load-bearing by removing it.
- **`underFire` only ever went up** on a body outside a squad: written by
  `installTeamDamage`, decayed only inside `_troops`' walk over `squadsOf`.
- **A companion's blow could never land on an NPC.** `hitTarget` resolves
  against the point the target stood on at the wind-up — the rule that makes a
  telegraph dodgeable, argued and measured against a real PLAYER. A B1 does
  not dodge, it walks, so it was two metres outside a 0.71 m footprint through
  no decision of its own: 0 blows in 60 s at 0.2 m closest.
- **Your own blade dismembered your own animal** with friendly fire OFF and
  `canHarm` answering false, because `takeCut` subtracts from `hp` directly
  and never sees the friendly-fire scaling: 420 hp in one frame.
- **`tools/portrait.mjs --enemy` had never once worked** — `new window.THREE_V3
  ? a : b` parses as `new (cond ? a : b)` against a global nothing exports.
  That is why nobody had LOOKED at a creature body in a long time.

### 0.1b THE SECOND ROUND — six lanes, and what each one found

- **A JOINING PLAYER HAS BEEN SPAWNING A PRIVATE COMPANION ON EVERY DEPLOY, and
  the fence written to stop it could never fire.** `fieldFromKennel` opens
  `if (w.netMode === 'client') return null`. `world.netMode` has exactly one
  writer, `World.attachNet`, and `deploy()` calls it THIRTY-FIVE LINES AFTER
  `buildWorld` returns — and `fieldFromKennel` runs inside `buildWorld`. So a
  guest got a real body the host never heard of, in no snapshot, on nobody
  else's screen, while the lobby card told them their animal was in the
  kennel. **This is the shape to look for anywhere else in the tree: a guard
  reading a field whose only writer runs later in the same call.** §6.3b is a
  whole section about the same family.
- **`tools/_beastshot.mjs` photographed every creature at LOD 1.** It spawns
  the animal 36.8 m from the player; `Enemy.update` picks the rung off
  `ctx.camera.position` — the GAME camera — and the shot camera is a different
  object, so moving the lens to within a metre never re-enters that line.
  Every in-engine creature photograph in this repository has had its
  non-silhouette detail culled, and at least one verdict written off these
  pictures ("the wookiee's shins are nearly bare") was a reading of a coat
  that was already there. Now pinned at LOD 0 with the property frozen,
  because the shipped write is edge-triggered.
- **`tools/_soft.mjs` painted every surface at roughly 1/mean-albedo.** `lit()`
  divides the requested colour by the bake's mean so the shipped lighting
  multiplies it back up; the tool read `material.color` — the divided number —
  and drew it at full value. Read `material.userData.authored` instead.
- **`trunk` is `[height above hips, forward of hips, length]`** and two
  comments in `Bodies.js` said the opposite, which is how a tauntaun ended up
  with its barrel mounted 0.14 behind a hip joint and 0.95 of body hanging in
  front of the only two feet it has. It read as an animal falling on its face.
- **`headAt[0]` is measured off a datum that moves.** The head bone hangs off
  `body` and THE BONE CHAIN IS NOT PITCHED — only the trunk MESH is, by
  `trunkRot`. On a level-backed animal `headAt[0]` is height above the spine
  and reads as written; on a pitched one the spine has already climbed
  `sin(pitch) * headAt[1]` first. The blurrg asked for 0.40 over a spine that
  had risen 0.374 and rendered as a bean with a lump on the front and no face.
- **`BEAST_MOVES[*].damage` is a MULTIPLIER on the archetype's own**, so the
  varactyl's sweep reads 0.85 and lands 0.85 x 0 = nothing. Any check about
  what an attack does must assert the product.
- **`rec.kills` had no writer and the card was already printing it.** The
  clamp, the whitelist and the render all existed; nothing incremented. Look
  for the other end of that shape — a field read by a surface and written by
  nobody — before adding a field.

### 0.1e THE JUDGE ROUND — what an outside critic found that the checks did not

Six lenses were pointed at the player's verbatim words with every finding
adversarially refuted before it counted. It returned FAIL with six blockers,
and the four distinct ones were all real. What is worth carrying forward is not
the fixes but the SHAPES.

- **THE GAME PROMISED SOMETHING IT COULD NOT DO.** Three of the twelve
  companion kinds exist only to be ridden, no archetype declared `crew`, and
  `Menu.js` printed "You can ride this one." anyway. `Companions.js` conceded
  it in a comment — "Riding is not reachable today" — while the menu said the
  opposite to the player. **Grep the UI for sentences that promise a
  capability, and check each against the code that would have to answer it.**
  A stated hole is fine; a stated hole beside a UI string that denies it is
  not.
- **AN INSTRUMENT THAT ASSUMES A POWER IS A KEY.** `throwOff` and `orbit` ride
  the `throw` binding because that key means three different things in the
  three saber sets. Four suites broke on it, each in its own way:
  `force-economy` had no way to fire them, `force-voice` fired them on a
  single-blade player so they returned silently, `living-force` called a real
  power "not an action", and `claims` counted eleven. `HUD.POWERS` is the
  power → binding column and is the thing to import.
- **A FIXTURE THAT SWAPS A BODY MUST CARRY ITS STATE.** Giving `force-voice`
  a player who actually holds the pair fixed one check and broke another: a
  fresh `Player` arrives at `maxForce`, and the refusal check deliberately
  empties the bar. The fixture healed the player it replaced and the suite then
  reported the game shouting on an empty bar.
- **THE DIAGNOSIS CAN BE WRONG WHILE THE MEASUREMENT IS RIGHT.** The judge
  measured three companions at 0/140 unobstructed eye triangles and blamed the
  muzzle. It was the CRANIUM — 44 of 70 — and the muzzle's top sat 0.12 below
  the eye. Six bodies were blind, not three, and the `fanged` branch's entire
  LOWER eye pair had been buried since it was written, so the nexu's four eyes
  have been two for as long as the branch has existed. **Reproduce the number,
  then find the cause yourself.**
- **A GEOMETRIC ASSERTION IS NOT A DRIVEN ONE.** The pair's whole blocking
  claim rested on `assert(r.half > 0.05)`. Driving it: the rose at its 135°
  ceiling moved 19 landed bolts to 19, because `guardZoneAccepts` has two
  refusals and the bolts were being thrown out by the other one. The feature
  had a number, a comment and a check, and did nothing.
- **AND A WHOLE CLASS OF PRICES IS INERT.** `slash.cooldown` under 0.30 changes
  nothing in any set — every light press also opens the stab, and that line
  sets `thrustCooldown = SLASH.cooldown`, the single blade's 0.30, for all
  three. Measured: 0.26 gives 25 accepted presses, 0.30 gives 25, 0.45 gives
  13. If you are pricing a set and the bench does not move, check whether the
  number you moved is reachable at all.

### 0.1c A CHECK WHOSE VERDICT WAS A COIN TOSS, and it cost two lanes an investigation

`companion: AWAY will not fight, SEEK fights one thing, WARD measures from YOU`
ran green alone and red inside the full suite, on identical code, twice in one
session. Both times a lane stopped and investigated a defect that was not
there.

The cause: the pack clears `_cmpBidden` the moment the bidden body dies, which
is correct — an order about a corpse is not an order. So the eight seconds it
measured were two different things end to end: a companion under SEEK, and then
a companion with NO order hunting whatever was nearest. Whether it passed turned
on whether one particular B1 happened to survive a massiff for eight seconds,
and suite order moves the RNG.

**A fixture that lets a second variable move is not measuring the clause in its
own name.** Hold everything the check is not about — here, top the bidden body
up each frame — and add the assertion that says the fixture is doing its job
(`assert(!want.dead, ...)`), so the hold cannot silently stop working.

### 0.1d A COMMENT CLAIMED A CHECK THAT WAS NEVER WRITTEN

A commit message and a `Bodies.js` comment both said "`tools/checks/beasts.mjs`
now pins the ratio for every plan". No such check existed: it was built, its
NEGATIVE CONTROL could not be made honest, and it was deleted without the
sentence being deleted with it. Three candidate metrics were then measured
across all thirteen plans and every one ranks the wampa's DELIBERATE
head-between-the-shoulders below the blurrg's actual defect, so any threshold
that passes the design case passes the bug. The file now carries the three
measurements and why they fail, in place of the claim.

**If you delete a check, grep for its name before you commit.** A false claim
of coverage is worse than no coverage, because the next hand stops looking.

### 0.2 Two fixture mistakes worth more than the fixes

- **A kill test measured a corpse.** The probe's player was shot dead at 24.5 s
  and the remaining 35 s recorded a companion heeling to a body: it reported
  as a 33.7 m drag against an 8 m leash and 35% follow, and NONE of it was the
  leash. Keep a fixture player alive when the fixture is not about dying.
- **A push check read 0.00 m/s off ground the player was standing on.**
  `chest` is written once a frame and the push fires FROM it, so a fixture that
  moves the body and pushes in the same tick casts its ray from where the
  player WAS. And "force strength" is the `forcePower` SETTING, not the pool.

## 0z. V12 — what landed the round before

Branch `claude/saber-game-improvements-v12-6f83co`, everything pushed. The
player's V12 list is in `PLAYTEST.md`'s top entry with a check named on every
row. `REVIEW-V12.md` is the other new document: 56 improvement items read cold
across the whole game, ten starred, with a closing paragraph on what not to
touch.

**How it was run.** Seven lanes with disjoint file ownership, three at a time
(hulls · lift · sky · deck life · powers+poses · troops+burial+stratagems ·
alpine+faces), an orchestrator on `main.js`/`DeckFlight`/`DeckExterior`/the
hub, and a browser probe that never paid off (see the traps).

**What landed, by area:**

- **The hub.** `deploy()` routes through `enterHangar` unless the mode is a
  room you are not flown to, you are a co-op client, or a check asked for
  `instantSpawn` (`hangarFirst`). The deck's own transport is the one caller
  that builds the battlefield (`fromDeck`). Every ending you are ALIVE for
  flies home — `homeward` is no longer gated on a win or a withdrawal. The
  seam is a still of the sealed bay (`Screens.loading(frac, label, {still})`)
  and your look carries over (`world._deckHandoff`). `hub` (4).
- **The ship round the room.** `DeckExterior.js` stands the faction's capital
  ship at real scale (x100) with its published hangar mouth on the aperture,
  drawn only past the lip, unfogged, far plane 6500. `Extraction._placeCapital`
  flies the same hull at real scale 1.4-14 km astern, turned so the mouth you
  left faces you. The run out is 11 s / 1400 m with the bay OPEN, sealing in
  the last 1.6 s, and it answers the cruise's skip key after 2.5 s.
- **The lift** — a room: panelled walls, a back window, coffered ceiling,
  tread floor, a counting deck readout, four door leaves (inner and shaft),
  and a three-layer instanced shaft scene. `decklift` (6).
- **The deck alive** — 111 droids of 9 kinds, 20 real men and 89 silhouettes,
  25 repair jobs, 7 hulls, in 70 drawn meshes at 1.0 ms a frame. `deckcast`
  (10), `decklife` (12).
- **The hulls** — the LAAT/i and the Sheathipede rebuilt as connected ships
  with canopies, pilots, gunners and real seats; the Acclamator and a
  Lucrehulk with `length` and a published `hangars` list. `hulls` (6).
- **The sky** — per-level seeded planets (continents, cloud self-shadow,
  cyclones, scatter rim, glint, city lights, lava, a ring) and a 12-minute
  scripted fleet action with five real silhouettes. `orbit-battle` (6).
- **Two powers** — the ward (the barrier's key aimed at an ally) and Restore
  (the whole line, 70 Force, 75 s). `powers` (32), with voices.
- **Five meditation poses**, chosen on the Jedi tab, the Holocron docked aside
  so the body stays in frame. `meditation` (5).
- **The army** — attribute-driven behaviours (`reactions`, 20), BURY THE
  FALLEN (`burial` 5, `graves` 7), DESECRATE THE FALLEN and the killing
  frenzy (`desecrate` 5), the ARMOUR setting and friendly avoidance of a
  called stratagem (`stratagems` 30).
- **The ground and the faces** — fitted colliders and cold colour on the ice
  level (`alpine` 7), one displaced head surface instead of twelve ellipsoids
  (`faces` 7).
- **Gone** — The Front and `src/game/Mass.js`.

**Three defects worth keeping, all found by a check and measured with a
throwaway probe rather than reasoned about:**

- **A patient marched out from under his own kneeling medic**, so every heal
  ended in `stop('moved')`. He holds still once his squad's medic has
  committed, inside the medic's own look radius.
- **An approach that gives up on a clock gives up on the wrong thing.** The
  medic crossing ten metres through his own squad makes about a metre a
  second; a flat eight-second timeout fired two metres short, every time. The
  rule is now four seconds without getting CLOSER.
- **A downed man is at 0 hp, so any damage at all kills him** — and the new
  crawl hauls his own ragdoll, which bills 0.2 of sourceless `force` back
  through `applyKnockback`. A trooper with 8.7 s of bleed left died at 5.4 s
  of dragging himself. A downed body ignores SOURCELESS damage now.

**Traps this session added:**

- **`Ragdoll.cutRagdoll(bone, impulse)` does nothing visible without the third
  argument.** With the default `t = 0` it breaks the joint, leaves the limb
  full length, never increments `severedCount` and never sets `severed`. Pass
  a stump fraction (0.3). And on a CORPSE, `cut()` routes to `cutRagdoll` on
  purpose, so `isSevered` stays false there by design — measure `severedCount`.
- **`CommandDirector.active` is a plain field the wave machinery writes every
  frame.** A check that sets it true to fake contact is overwritten before the
  next tick; drive the rule instead.
- **A browser probe of the deck flight is not affordable under software GL.**
  The new sky shader is ~3.3 s a frame there, so `tools/_hubprobe.mjs` reached
  the deck shot and never finished a fly-out in twenty minutes. The hub is
  covered by `hub` (4) instead. The fly-out and orbit shots are UNSEEN, and a
  run on real hardware is the one thing that would settle them.
- **A per-visit fact rides `world.run`, never `settings`** (carried from V11).

**Still open:**

- The fly-out and the look back have never been LOOKED at, only measured.
- `REVIEW-V12.md` items 1 (the fog is the wrong colour on every level) and 14
  (the new powers cannot see a co-op partner) are the two highest-value
  unstarted things in the tree.
- `tools/portrait.mjs` needs `instantSpawn: true` on any level that inserts
  from orbit (carried from V11).

## 1. State

### 1.0 START HERE — the shortest true statement of where this is

> **1–2 Sep — V11, THE HUB. See §5.000.** The player's V11 list is built end
> to end and on the link: the hangar is a closed, lit room rebuilt against his
> seven references; you arrive by lift and leave by ship; the deck is alive;
> the company files in from a crowd in cloth capes and worn paint; every droid
> was reworked against its reference; the blade works on the deck. Fast tier
> 385/385, every deck suite green, merged to the default at `f206f3c`. **Three
> process traps from this session: (a) a usage limit kills every lane mid-edit
> — commit the half-state rather than lose it; (b) three rendering lanes
> contend for one render lock, and a screenshot then takes half an hour;
> (c) a per-visit fact rides `world.run`, never `settings`.** What is still
> open is at the end of §5.000.

> *(1 Sep, earlier — THE AUDIT ROUND, §5.00: 44 findings, the substantive
> ones closed and verified red-first.)*

**Branch `claude/saber-game-improvements-v11-12k5n4`, merged to the default
(fast-forward, `f206f3c`). See §5.000 for what this session did and §6.4 for
the gate.**

**HOW TO PLAY IT.** `node tools/pack.mjs out.html` builds the whole game as ONE
self-contained file — no server, open it in a browser. **AND THE PAGES LINK IS
A DIFFERENT QUESTION.** `.github/workflows/pages.yml` publishes on a push to
`main`, `master` or `claude/lightsaber-combat-game-lxw391` (the default) and on
nothing else. A feature branch publishes NOTHING however many times it is
pushed, so <https://longwong377.github.io/saber2/> only moves when this work
reaches the default branch.

**WHAT PLAN SAYS IS LEFT: nothing unbuilt.** Every design bullet in §0–§6 is
built, struck by measurement, or is a decision rather than a feature. What is
actually outstanding is three things, and only one of them is work:

  1. **THE WATCHDOG — a decision, and it is the developer's.**
     `WaveDirector._watchdog` scores a body's progress as its distance to the
     nearest live PLAYER. In Command the horde's fight is your ARMY, so with no
     player on the field every enemy reads stalled and the director retires it:
     measured, **39.4 retirements a wave against the 10.5 bodies the line
     actually shot** — 62% of the wave deleted. It fires wherever the player is
     not, including **every frame after the commander goes down in shipped
     play**. The fix is 52 lines at `tools/_watchdog.patch`, the census
     instrument is `tools/_whywave.mjs`, and it is NOT in the tree because with
     it the unaided line is wiped on every seed and `theline.12` — a shipped
     check asserting §5's own "costs about half the line" — goes red at 0.0 of
     10. Landing it lands a difficulty re-tune, and which knob gives (wave
     budget, `RULE_MAX`, morale, or the target itself) is a balance call.
     **Until it is made, every M1 magnitude in this document is measured against
     a floor the director was propping up.**
  2. **The per-object ink prepass** (§4.3's last rung) — waiting on one run of
     `tools/_frame.mjs` on REAL HARDWARE. A 2.5–3.8 s software frame cannot
     resolve a 12% effect; the A/B/A bracket is what would establish it.
  3. **Nothing else.** B1b, B3, M4 and §4.8 were all listed as owed and all
     turned out to be built — see the struck bullets below.

**THE ONE THING THAT WILL COST YOU AN HOUR IF YOU SKIP IT:** read §2 before
touching a tool. In particular §2.1 (always run with `--import
./tools/register.mjs`, or you get two copies of three and fictional failures),
§2.2 and §2.2b (**the container rolls the clone back, and `git checkout --
<path>` on an uncommitted tree is a loaded gun** — between them they cost this
session a file and a working tree; commit and push often, because the remote is
the only thing that survives), §2.6b (**do not run anything else while the gate
runs**; one review agent alongside it turned a frame-budget check red that
passes 3/3 alone), and §2.3b–e, which are four new ways a check can be unable
to fail.

---

> **SESSION OF 2026-08-23 (SECOND) — WHAT LANDED, IN ONE PLACE.** Branch
> `claude/autonomous-completion-6b2kzi`, eleven commits, and the whole of
> PLAN.md §6's chain after item 4 is now built or measured.
>
> **§1's checkable order** — `src/game/FireMission.js`. High Command lays an
> artillery ellipse on ground ahead of your line, tells you what it thinks is
> standing on it, and gives you a window; one keypress (`authorise`, KeyK)
> clears it. The estimate is honest, is a SNAPSHOT, and is never revised — so
> the game does not have to cheat to put your men under your own guns and does
> not have to warn you either. Reading the mark costs 12 s inside 70 m of it, 4
> with Force sense. **The weld is the geometry, measured, three arms of the same
> order and the same ten men:** walk out at your line's pace and 10 OF 10 are
> inside the ellipse with you; sprint out alone and 0 are, but the quorum is
> DOWN for the whole reading; plant them first with §4.4's delegation verb and
> you pay neither. Delete `lineIsUp` and all three collapse into "walk over and
> look". The shells carry a source on nobody's side, so `installTeamDamage`
> cannot blunt them on your own men (**120 hp against 42**), and `killerName`
> names them: every man they kill enters the after-action report as *by your own
> fire mission*.
>
> **§4.7, all four items.** DIG IN is an order (`FORMATIONS.digin`, Quote): a
> squad turns its planted ground into a position in 22 s with its hands full,
> cut through `Terrain.crater` so the log carries it into the next engagement.
> Measured at the shipped LOW tier, twelve rays from a muzzle to a chest —
> **flat 0/12 blocked, one shell crater 2/12, a dug position 12/12**; the
> defilade is symmetric and that is the trade. FINITE COVER was already true and
> unmeasured: **54 props standing at deploy and 49 six minutes later**, off 137
> hits nobody aimed. GRAVES (`src/world/Graves.js`) keep a named man's rifle in
> the ground where he fell for the whole run, two draw calls for all of them,
> and the line's morale minds them (0.729 against 0.740 over 25 s).
> **WEATHER was the expensive error in the plan.** "Entirely unbuilt, five
> systems" is wrong: `Scenery.js` has shipped a full `Weather` all along and all
> seven grounds author a squall — what was missing is that nothing ever asked
> whether you could see through it. One number now, and at each ground's own
> peak a rifle's sight falls to **19–34 m**.
>
> **§4.6's rule facets.** Six cards that change a SENTENCE somewhere else rather
> than a coefficient, and two of them move the keystone, which is what that item
> was gated on: Skirmish Order (ground taken on a THIRD of the living, muster
> halved), Triage (a downed man counts while somebody is standing over him),
> Stand Fast, Field Engineering, Storm Sense and Salvage.
>
> **§4.5's kill answered.** The front is on the wire (`packSnapshot.fr`) and
> DRAWN — `CommandDirector.front` is the whole state of a meeting and nothing in
> the tree read it, so the mode's own sentence ("the front moves because a
> general left his line at the wrong moment") was unlearnable.
>
> **§4.3's load-bearing clause, measured.** A twelve-shell barrage on a formed
> line of ten kills 4, scatters 2 more alive, and takes the quorum down — and
> 25 s later the four survivors have re-formed. So the levers buy time rather
> than the battle.
>
> **Two things found rather than built, and both are worth more than a feature.**
> `CraterLog` was written, checked to the last bit of the heightfield, and
> **constructed by nothing** — `marchTo` had passed `world.craterLog` into
> `marchFront` for as long as the front has been dressed, so every engagement
> opened on ground that had never been fought over. And `Waves.js`'s own module
> rng — the stream that composes every wave in the game — was the one
> `tools/register.mjs` never pinned, so wave composition was the one input a
> gate could not hold still.
>
> **§4.2's four-armed acceptance has reported, and it passes.** `tools/_m6.mjs`,
> four seeds × five minutes × four arms, with the same squad posted on the same
> ground in every arm so the only difference is whether that ground is a gun: **a
> Jedi is worth 82.1 s of run with a battery on the field and 0.1 s without
> one.** The section's own kill was "if not, it is decoration". The metric is the
> run's LENGTH and not the ground taken, and that is a correction the first
> reading forced — at four minutes three of the four arms took zero ground and
> every arm lost its roster, and a metric that reads 0.000 in three cells cannot
> carry an interaction.
>
> **§4.6's rules became a wager.** The panel was a list of handicaps that paid
> nothing. The exchange rate for fixing that was already in the source:
> `conditionCost` charges a DEALT condition `worth · budget` and explicitly
> skips a RULE, which is the game's own statement that a wave under a rule is
> `worth` more fight. So `hazardPay(rules) = 1 + Σ worth` and the Insight a wave
> pays is multiplied by exactly that — nothing typed twice, and repricing a
> condition moves the payout. **Forty waves under DELUGE+SILENCE: 56 Insight
> becomes 82, and 5 facets bought become 6.** `Communion.earn` carries the
> fraction so the purse stays whole (40 waves at 1.08 is 43, not 40) and every
> existing caller is byte-identical. AND THE CAP IS TWO. `CONDITION_MAX` was
> answering two questions: what the COMPOSER may carry (still 4, still the
> stranding measurement) and what the PANEL may sell. `RULE_MAX` is 2 — with
> seven rules and a cap of four you tick four and stop reading. "At most one
> beneficial" is deliberately not built: every `CONDITIONS` entry is a handicap,
> so the clause would be a branch no input can take.
>
> **§4.6's composition constraints, four of five, and no new field.**
> `ARCHETYPES[*].toughness` has been the material classification all along —
> flesh, plastoid, droid, armour, heavy — so ARMOUR COLUMN, ONE MATERIAL, DROID
> HOST and BEAST DRIVE are derived. *bladed* is not among them because `silence`
> already filters to `!ranged`, which IS the bladed roster. All four are
> RULE-ONLY, measured: a roster narrowing DEALT at depth strands a budget, and
> four more of them stopped the body cap binding at all. **They found a real
> bug**: `_setPiece` built its ladder from the LEVEL's pool instead of the
> wave's narrowed roster, so a boss wave under ARMOUR COLUMN fielded an acolyte
> and a master — NO GUNS has had the same hole and passed on luck, because
> `SET_PIECE`'s bodies happen to be melee.
>
> **And ARMOUR COLUMN is now the FLOOR** §4.6 asked for rather than a filter:
> `ARMOUR_SHARE` (0.40, written once) reserved in `_composeUnder` beside the head
> and the set-piece. In THREAT, not count — `HEAVY_CAP` is ten bodies, so a count
> floor is a promise the frame rate forbids. The filter had to go because it was
> fielding no vehicles at all: on four of seven theatres the plated roster is
> `b2` and `droideka`. Measured, heavy share without → with: 24→42% and 25→50% at
> wave 15, unchanged at wave 70 where the wave is already at its heavy limit.
> Repriced 0.26 → 0.16, so the `hazardPay` payout moved with it.
>
> **Still owed, after auditing every claim in PLAN §0-§6 against the code.** §4.6
> is complete — all six bullets, the branching route and the 40% armour floor
> included — and so are §4.7, §4.9, §4.5's kill, §4.2's acceptance, B0-B5 and
> M2-M4. **PLAN NOW HAS NO UNBUILT DESIGN LEFT IN IT** — everything below is
> struck, decided, or a measurement rather than a feature:
>
> · ~~**B1b**~~ — **STALE, and PLAN §3 says so in the same document.** Retirement
>   is BUILT (`Fallen.FallenField`, `Corpses.js`'s SINK step laying a prone
>   instance where the body lies, both seated by `LIE_SINK`); pooling is STRUCK
>   by measurement. Nothing owed.
> · **§4.8's first two bullets** — contested telekinesis, and squadmates grabbing
>   the man you have gripped. No shared-constraint grip contest and no grab joint
>   exists in `src/`; this is the largest unbuilt design left in the document.
> · ~~**A screen for the after-action report**~~ — **BUILT.** `Session.runReport`
>   projects `director.log` into the run: areas in the order they were fought,
>   each with its dead, its fire missions and who came up behind them, and the
>   CENSUS over the top of it — *"eleven men lost, seven to Super Battle Droids,
>   three to your own fire missions"*. The census is what earns the screen: it
>   is the muster's next purchase and the next order in one line, and it is not
>   derivable anywhere else, because the interlude never aggregates and the roll
>   never counts. A PANEL ON THE PAUSE CARD, not a state of its own — `Screens`
>   exists because of an overlay a player could be stranded in, and the card's
>   two existing disclosures are the shape for "more, here" with no new state,
>   no new Escape rule and no new hider. One line of it on the death card too,
>   which is the screen the pause card cannot reach.
>   **AND `killerName` HAD NEVER NAMED ANYTHING**: it ended `source.A?.name ||
>   source.type`, an archetype's field is `label`, so the first half was always
>   undefined and every report the game has ever drawn — and every grave in the
>   ground — said `b2` and `droideka` instead of Super Battle Droid and
>   Droideka. `tools/checks/report.mjs` is 13 checks, each written to go red on
>   a report that lists without counting.
> · The Company tab's refusal to change a man's kit is a DECISION and not an
>   omission — `Menu.js` argues it where it makes it, names the rank ladder as
>   the way to make a man better, and `company.mjs` fails the day a fourth
>   editable field appears. The muster card promotes a survivor now
>   (`commend`, priced at `muster / XP_PER_AREA`), and banking always worked:
>   closing without spending keeps the purse.
> · **M1 HAS REPORTED**, and it is the most important number in the project.
>   Twenty seeds, three arms, engagement 1 on geonosis:
>   **none 6.7/10 survivors (18/20 cleared) · idle 1.0/10 (3/20) · blade 4.7/10
>   (11/20)**. Read against §5's target — "no help from the Jedi should cost
>   roughly half a ten-man line, about 5 of 10" — **the floor is a third
>   cheaper than asked**: it costs 3.3. An idle Jedi is not "a corpse with a
>   delay", he is a catastrophe (1.0 against an empty field's 6.7, 17 wipes in
>   20) because he pulls a wave onto a line and does not fight it. **And a Jedi
>   who FIGHTS FROM HIS LINE leaves it WORSE than no Jedi at all.** That was
>   first written up here as "a Jedi who only fights", on the reading that
>   `dutyInput` chases the nearest enemy — **wrong about the code**: it holds
>   station on the line's own centroid and leaves it only for something close,
>   and only inside an 18 m leash, precisely so `MORALE.JEDI_NEAR` keeps
>   paying. So the blade arm already IS a Jedi among his men, and the result is
>   sharper than the softer reading allowed. What it does not yet say is WHY —
>   "a Jedi costs the line men" and "a Jedi drags the fight out and the men near
>   him stand in fire aimed at him" are indistinguishable from three arms. The
>   control that separates them is `standOff`, which `_flagship.mjs` had carried
>   with its whole argument since it was written and which nothing had ever
>   driven. **It has now**, as `_linehold.mjs`'s `far` arm, and it answers:
>
>       none   6.7/10   cleared 18/20   67 s a wave
>       blade  4.7/10   cleared 11/20   79 s      (with the line)
>       far    3.8/10   cleared 12/20   83 s      (100 m off)
>       idle   1.0/10   cleared  3/20   67 s
>
>   **A Jedi a hundred metres away still costs the line 2.9 men.** He is near
>   nobody, so the men are not dying in fire aimed at him — presence is not what
>   kills them. What moves with the cost is the LENGTH of the engagement (67 s a
>   wave with nobody, 79 with a Jedi in the line, 83 with one standing off), and
>   the extra minute is paid by the men. Being WITH the line is worth about one
>   man over standing off, so the presence term does pay — just not enough to
>   beat absence. **§1's promise is not met as measured**: the line is standing
>   more often when nobody comes. It is a BALANCE finding, not a broken
>   mechanism — every part works and the arithmetic comes out negative — and the
>   length is correlated, not yet explained. Naming the mechanism is the next
>   measurement.
> · **AND THE FLOOR THOSE FOUR ARMS ARE READ AGAINST IS PROPPED UP BY A BUG.**
>   `WaveDirector._watchdog` measures a body's progress as its distance to the
>   nearest live **player**. In Command the horde's fight is your ARMY, so with
>   no player on the field — which is exactly `_linehold.mjs`'s `none` arm, the
>   control every other arm is scored against — every enemy alive reads stalled
>   and the director retires it. Measured on theline/geonosis, engagement 1,
>   five seeds, fifteen cleared waves: **236 rescues and 118 RETIREMENTS a run,
>   39.4 a wave, against 10.5 bodies the line actually shot.** Of the wave's 8.4
>   paying regulars the line killed 3.2 and the watchdog deleted 5.2. **The
>   unaided line was not winning; the clock was deleting 62% of the wave in
>   front of it.**
>
>   The fix is 52 lines in `_watchdog` — also let a body count progress toward
>   `e.target`, which `Enemy._think` already writes every frame off
>   `World.pickTarget`, the game's one statement of who a body is fighting. It
>   is at `tools/_watchdog.patch`, and the instrument that
>   produced the census is `tools/_whywave.mjs`. It is correct, it costs nothing,
>   and it fires **wherever the player is not**: a bench arm, a Jedi a hundred
>   metres off his line, and every frame after the commander goes down in
>   shipped play.
>
>   **IT IS NOT IN THE TREE, AND THAT IS A BALANCE CALL, NOT A CODE ONE.** With
>   the watchdog honest, same mode, same ground, same seeds:
>
>       stock       3, 4, 5, 9, 8 of ten left · 5 of 5 areas cleared
>       honest      0 of ten, every seed      · 0 of 7 cleared
>
>   which turns `theline.12` — *"an engagement fought without the Jedi costs
>   about half the line"*, a check already shipped in the gate, asserting §5's
>   own target — red: **0.0 of 10 standing, so the muster is never reached and
>   the mode cannot be won**. Landing the fix therefore lands a difficulty
>   re-tune with it (wave budget, `RULE_MAX`, morale, or the target itself), and
>   which of those gives is the developer's decision. **Until it is made, every
>   M1 number above is measured against a propped floor: `none 6.7/10` is not
>   what an unaided line does, it is what an unaided line does while the
>   director kills five men a wave for it.** The three RELATIVE readings — idle
>   is a catastrophe, a Jedi in the line costs men, length is what moves the
>   cost — are all taken against that same propped floor and must be re-run
>   after the tune, not carried across it.
> · **M7** is STRUCK, because `tools/scale.mjs` withdrew the number it chased.
>
> **AND THE SUITE WAS AUDITED AGAINST ITS OWN STANDARD** — §7's "an element
> earns its place by changing a decision, and its check has to demonstrate the
> decision changing" — by asking which checks would still pass with the feature
> DELETED. The headline is that the suite is far better than that question
> assumes: the sweeps for swallowed throws, aliased before/after pairs,
> never-entered assertions and loose tolerances came back essentially clean, and
> the two-arm measurement discipline is real. Ten exceptions, all now fixed and
> all with the deletion that used to pass written into the check:
>
>       theline.16   `world.notes` does not exist — undefined !== false
>       barrier      `world.notices` likewise
>       balance      `.fireRate` matched the ARCHETYPE's field on the same line
>       forms        bare word match; `tell` was dead and nobody could see it
>       characters   a 4000-char window that started inside a doc comment
>       cloth-cost   a 3000-char window over a 2569-char function
>       keyart       "a `catch` within 900 characters", of eight in the file
>       command      `ORDERS[id] === FORMATIONS[id]`, true by construction
>       downed       a constant compared to the only line that writes it
>       wiring       a check with no assertion in it at all
>
> The three that generalise are written up as traps §2.3b, §2.3c and §2.3d. Two
> of them found live game defects rather than only check defects —
> `killerName`/the Foundry banner printing spawn keys, and the form `tell` that
> the dojo never said.
>
> **AND THEN THE SESSION'S OWN DIFF WAS REVIEWED THE SAME WAY**, which found
> eight more — six of them introduced by the report itself. The two that were
> not: **the enemy's battery was firing under your name** (`theirBarrage` shared
> `HIGH_COMMAND` with `authorise`, so every man the CIS guns killed entered the
> report as a death the player caused, marked in the colour reserved for a
> mistake), and **the men a campaign is HANDED were on no entry in the ledger**
> (`recruit` logs an `enlist`; `_musterOpening`, `_musterVeterans` and
> `_musterJoin` logged nothing, so the census could not tell an opening trooper
> from a droid until he died — and the cost was the FIRST friendly-fire death of
> every run). The six that were mine: a meeting's ledger holds both armies and
> was read flat; an engagement with no casualties yet was dropped so the "in
> progress" row was unreachable; `t: 'won'` was not a terminator; the death
> card's "N of them by your own side" counted the whole census while printing
> the top three; the census said "your own side" twice on the two rows that
> already say it; and two of the new checks were weaker than they looked.
>
> **THE LESSON WORTH CARRYING: review the diff you just wrote, adversarially,
> as a separate pass.** Six of eight were mine and none of them were visible to
> me while writing. `tools/_onecheck.mjs` is what makes that affordable — one
> check out of one suite, seconds instead of the twenty-five minutes a
> `theline.mjs` run costs — and it had this exact defect itself on its first
> cut, reporting GREEN on a check broken on purpose (trap §2.3e).
>
> **§4.3's animated instanced rung IS BUILT**, and it was never "gated hard on
> M4": `src/engine/Profiler.js` has been the browser frame instrument all along,
> reporting real GPU time through `EXT_disjoint_timer_query_webgl2`, and
> `tools/_frame.mjs` is the reader it lacked. The crowd walks now — a
> per-instance palette index, twelve poses in a DataTexture, one float beside
> each matrix — and **168 bodies past 137.8 m are still 39 draw calls and
> 969 520 triangles, bit for bit**. The vertex shader the file used to refuse is
> allowed because the numbers permit it: the ink prepass reaches 127.2 m at
> worst, `L3_AT` is 137.8, and the worst palette slot moves a vertex 0.19 m into
> that gap — asserted as a PAIR so moving `INK.edgeFade` fails the gate.
> WHAT IS LEFT of that rung is the per-object ink prepass, and it is a decision
> waiting on one run of `tools/_frame.mjs` **on real hardware**: a 2.5–3.8 s
> software frame cannot resolve a 12% effect, and the A/B/A bracket is what
> establishes that rather than printing the drift as a finding.
>
> **AND SEVEN OF THE NINE ENTRIES IN PLAN §6's NOW LISTS WERE STALE OR WRONG**,
> which is the defect that made §4.7 claim weather was unbuilt on a tree that had
> shipped it. B0, B2, B4 and all four of B5 are built; M2's answer is quoted in
> PLAN itself four hundred lines above the question; M3's one-liner contradicted
> §2's own conclusion; M4 is the profiler. The block is rewritten with the
> evidence. **AND THE TWO THINGS THAT PARAGRAPH THEN NAMED AS UNBUILT ARE BUILT
> TOO** — the same defect one layer down. M4's reader is `tools/_frame.mjs`,
> which this very handoff describes four paragraphs later; B3's three-layer
> distance audio bed is `Audio.BATTLE_BANDS`, near/mid/far, fed by the weapon
> events the frame already raises and tapped BEFORE the audibility test, with
> its band edges derived from `HEARING_FLOOR` and `MAX_RANGE`. Nothing in §6's
> NOW lists is unbuilt.
>
> **THE RED THAT WAS RED BEFORE THIS SESSION IS GREEN, AND IT WAS THE FIXTURE.**
> `blast-door.mjs`'s "a held blade opens a blast door in about twenty seconds"
> burned **0 of the 515 texels** on the middle door of the magazine. `rearm`
> cleared `door.warded` before each loop; `GunPit._wards` runs from the world's
> own tick and ends with `door.warded = warded && !taken`, so the flag was back
> on the first frame and every frame after it — the check had been red on a door
> that could not be cut at all. The pit owns that state and `silence()` is the
> door in it. Which is also the only shape that could be right: a fixture that
> unwarded a door by assignment would be measuring a plate the game never
> presents. With the plate live it reports what DESIGN.md claims — **tight 13.7 s,
> natural 18.8 s, wide 21.7 s, and a tidier loop is a faster breach.**
>
> **AND `cloth-cost`'s 6 ms ceiling was set below its own error bar.** Quiet it
> reads 5.32 ms; inside a full gate at load 4.7 it read 6.41 and went red.
> `_cpuclock.mjs`'s own header measures the cache-pressure residual a shared box
> leaves on a CPU reading at about 25%, and 5.32 × 1.25 = 6.65. The band is 7 ms:
> a 7.5 ms population still fails it, which is the only claim the check exists to
> defend.
>
> **AND `controls`'s boon-reader check named five source files by hand** — the
> five that happened to read a boon when it was written. It went stale the moment
> the line modes answered six of them in `Command.js` and `Enemy.js`, and called
> all six a lie. It walks `src/` now, still minus the BOONS table itself, which
> is the whole point of the word "elsewhere".
>
> **A GATE CANNOT SEE A CHECK FILE YOU EDIT WHILE IT IS RUNNING, AND THIS COST
> AN HOUR TWICE.** `determinism.mjs`'s "every suite file in `tools/checks/`
> exports a `run()`" IMPORTS every file to ask the question, and it runs early
> (alphabetically, at about suite 20). Node caches a module for the life of the
> process. So every suite file is already loaded before a full gate has fought
> its way to the letter f, and any edit after that point is invisible to that
> run — the gate goes on measuring the version it read at suite 20 and reports
> failures that no longer exist. Measured: `suppression.mjs` was fixed, passed
> `_one suppression` and `_seq determinism suppression` 6/6, and the gate that
> was running at the time still printed its old numbers to the decimal.
> **Edit check files between gates, never during one**, and when a gate's red
> disagrees with a fresh `_one`, believe the `_one`.
>
> **AND WITH THE ASSERTION IN, SMOKE IS NOW RED ON A REAL DEFECT.** One bolt at
> the player from 7 m, in the shipped page, comes back `{fired: 1, deflects: 0,
> hpLost: 0, invuln: 0}` — not felt, not turned, and no i-frame to explain it.
> **The identical shot lands 4.25 hp headless** on a real World through the same
> `bolts.fire` and the same `_boltHitTest`. So there is a browser-vs-fixture gap
> in bolt-versus-player hit detection, which is precisely what this probe exists
> to find and could not report while `step()` failed only on exceptions. `npm run
> smoke` is not part of `npm run verify`, so the gate is unaffected; this red is
> TRUE and is left standing rather than hidden. Under investigation.
>
> **THE SMOKE PROBE'S ZEROS WERE A SIMULTANEOUS VOLLEY MEETING AN I-FRAME.**
> `Player.damage` opens `this.invuln = 0.18` on every hit and `_boltHitTest`
> skips a player with `invuln > 0`; `World.update` clamps `dt` to 1/24, so that
> is about four frames. The probe fired **twelve bolts in one frame from one
> radius**, so they all arrived inside the same four and eleven were skipped BY
> CONSTRUCTION — the volley could never register more than one bolt however well
> it was aimed. Measured headless on a real World with nothing else on the field:
> **fired one at a time all twelve land, 4.25 hp each; fired together, exactly
> one lands.** The step now sends ONE round and asserts the weakest thing that
> would have caught the zeros — a bolt must be felt or turned, never ignored.
>
> Two explanations were tried and disproved on the way, and both are worth
> knowing. `p.chest` — "the point every aim assist and every centre-of-mass query
> in the game reads" — **is not the centre of the body's collision hull**: on a
> posed player who has walked, the hull spans 0.55 x 0.54 m and its centre sits
> 0.24-0.52 m from the chest point, about the hull's own half-width. Aiming at
> the hull's centre instead changes nothing here, so it is not this defect; but
> every shooter in the game leads on that point, and moving it would change how
> often they connect. That is a difficulty decision, not a probe fix, and it is
> left alone and written down. The other was that bodies on the field were
> absorbing the volley — they were cleared, and nothing changed.
>
> **THE CUT STEP'S `severed: 0, pieces: 0` IS FINE, AND THE STEP STILL NEEDED AN
> ASSERTION.** A B1 has 28 hp and the blade kills it well before a blind swing
> happens to cross a limb at the speed and angle a sever wants — `hpAfter: -11,
> dead: true` is the blade working. Severing is held to its own rules in
> `severance.mjs`, with a fixture that aims; asserting a limb on a boot probe
> would be a flaky combat test. So the assertion is what that step is actually
> FOR: a droid put 1.1 m inside the blade for 1.5 s must take damage. It caught
> nothing before because nothing could fail.
>
> **TWO THINGS FOUND WHILE FIXING A CHECK, NEITHER FIXED, BOTH WORTH MORE THAN
> THE CHECK.** `suppression.mjs` drives ten troopers up a Geonosis slope, and in
> every one of the eight arms measured a man ends the walk **stuck on the
> geometry** — CT-3208 sat at (-2.3, 2.2) for 210 frames with a velocity of 1-4
> m/s and did not move. He is the ENTIRE 35-40 m reading that suite reports: the
> MEDIAN distance from the anchor is 9.8 m in all eight. So `strung`, being a
> max, answers "did anyone jam on a rock" rather than "how spread is the line",
> and the rock is a real navigation defect on a shipped ground. Second: that
> fixture's note says it measures the WALK, and it does not — emptying
> `spawnQueue` leaves the emplaced gun firing, and it kills 2 of 10 within 26
> frames with no hostile body anywhere on the field.
>
> **THE BROWSER SUITES NEED ONE SYMLINK ON A BOX WITH NO `node_modules`, AND
> THAT IS THE WHOLE FIX.** `tools/three-resolver.mjs` maps `three`,
> `three/addons/*` and `rapier`; everything else falls through to Node's own
> resolution, and `vendor/` holds only `peerjs`, `rapier` and `three`. So on a
> fresh container `import('playwright-core')` is `ERR_MODULE_NOT_FOUND`, and
> `frontdoor`, `front-screen`, `lineseen`, `packed` and one check in `lighting`
> all fail for that reason and no other — **six of the thirteen reds in a full
> gate, none of them a fact about the tree.** The package IS on disk, and so are
> the Chromium binaries; the global tree simply is not on this project's
> resolution path. One line puts it there:
>
> ```bash
> mkdir -p node_modules && ln -sfn \
>   /opt/node22/lib/node_modules/playwright/node_modules/playwright-core \
>   node_modules/playwright-core
> ```
>
> `node_modules` is in `.gitignore`, so this is an environment fix and not a
> change to the project. With it, `frontdoor` is 1/1 and `lineseen` 2/2 on this
> box. **Do this first in any new container** — otherwise a sixth of the gate's
> failures are noise, and the noise is exactly where the browser-only claims
> live.
>
> **THE OLD ORDER-DEFECT NOTE, KEPT BECAUSE THE ANSWER IS WORTH MORE THAN THE
> BUG.**
> `breach.mjs`'s "the shield is the gate" passes when its suite runs FIRST in a
> process and fails when anything at all ran before it — measured three ways:
> alone 5/5 (25.0 s after the pulse opens the plate, 96.5% of frames in
> contact); `breach → blast-door` 5/5 and 9/9; `bolts → breach` and
> `blast-door → breach` both fail it identically (436 of 515 texels in 70 s, so
> the deflector comes back before the breach lands). The predecessor does not
> matter, which rules out anything blast-door does to a door. Both suites
> already pin `destruction.prepareBudgetMs`, which is the cause `blast-door`'s
> own header documents for this exact symptom, so it is something else
> `_shared.mjs` does not restore — `ground` (Scenery.js) and Engine's once-only
> ShaderChunk flags are what that file names as still shared.
>
> **AND ONE THAT WAS RED BEFORE THIS SESSION AND IS NOT ANY MORE, WITH THE
> REASON.** `balance.mjs`'s melee-opener check drove all four difficulty tiers
> with one player — the model's "competent", σ=75 — and read **67 of 96** against
> a three-quarter floor. It read exactly 67 at every commit for the last forty,
> so it had been red for far longer than its own note's "92, 90, 90, 91 —
> steady". At the skill each tier is actually FOR it reads 81 of 96. The floor,
> the pooled mean and the per-tier `worst > 0` clause are untouched, and
> **grandmaster still clears only 9 of 24** — printed rather than asserted,
> because it is a real balance signal for whoever tunes the Colosseum next.

| | |
|---|---|
| Suite | **2039 passed, 2 failed** — all **156** suites in `tools/checks/`. **Both reds pass standalone**, so they are the order-dependence §6.4 documents rather than defects: `suppression`'s pace arm (6/6 alone and under `_seq determinism suppression`) and `theline.16`, which is the worse of the two because it is a NULL CRASH rather than a drifting number — `Cannot read properties of null (reading 'position')` in a gate, 21/21 alone. A crash means something was disposed while still referenced, and that is real however rarely it shows. Under investigation. The row before this read 2024/0, and before that 1517 over 111 suites — which is the drift §2.3 is about: read the gate's own last line rather than believing a table |
| Fast tier | **363 passed, 0 failed — 17 suites in ~80 s**, `npm run verify:fast`. The mechanical contract only: the blade, the bolt, the cut, the guard, and the tables that move them. `tools/tiers.mjs` names what it leaves out (`footwork` 52.9 s, `powers` 18.2 s, `force` 19.3 s, every browser suite, every level/wave/net/UI suite). **It going green is not the gate going green.** It exists because §2.6d is real: a gate nobody can finish is a gate whose reds nobody triages, and `.github/workflows/verify.yml` now runs this one on every push — the first thing in this repo's CI that has ever run a check |
| Smoke | **11/11 clean**, and verified in THIS container for the first time once `playwright-core` was symlinked (see §1) — no console errors, no page errors, no failed requests, boot diagnostics 668 draw calls / 139 728 triangles / 188 statics. Its timeouts are wall-clock, so on a loaded box the later steps fail and mean nothing — §2.6, and it is why the rewritten deflection step below could not be re-run while two agents were working. **`step()` FAILS ONLY ON A THROWN EXCEPTION**, so a probe that prints all zeros is still called ok. The deflection step did: `{fired: 12, deflects: 0, hpLost: 0}`. It asserts now, and the twelve bolts were the defect rather than the measurement — see §1 |
| Packed | `node tools/pack.mjs out.html` — **105 modules, 15.95 MB** (the row said 79 and 12.8 MB; measured this session), boots from `file://`, and `tools/checks/packed.mjs` proves it every run — which it could not do in this container until `playwright-core` was symlinked |
| Levels | **7** — `scoria, mustafar, colosseum, wood, drifts, alpine, geonosis`. The Boarding Bay and the Providence were deleted on the player's word — "I just tried the boarding bay and the providence and hated them… just remove them. your outside work is much better" |
| Modes | **9** — `waves, roguelite, duel, sandbox, training, command, theline, skirmish, campaign` |
| Campaigns | **1** — `petranaki`, two missions. `boarding` went with its two grounds; both its missions were the ship levels |
| Archetypes | **37**, and `src/game/Levels.js` must be imported to see most of them |

Those four rows are a hand copy of what `node --import ./tools/register.mjs
tools/state.mjs` prints, and they read **10** and **6** through a whole session
that deleted three levels and added two modes and two campaigns — §2.3, playing
out in the one file that tells the next reader what is here. Run the tool
rather than believing the table; it also warns when a level exists and is not
in `LEVEL_ORDER`, which is a level nobody can reach except by typing its key.

**AND IT HAD DRIFTED AGAIN BY TWO ROWS**, which is what a paragraph saying "run
the tool rather than believing the table" is for. The Modes row read **8** and
omitted THE LINE — the flagship mode, the one `FLAGSHIP.md` is entirely about —
and Archetypes read **31** against 37. Both were caught by running `state.mjs`
during a mode audit whose brief had been written off this table and therefore
said "the eight modes". A stale row here does not merely mislead a reader; it
sets the scope of the next session's work.

Run things this way and no other way:

```bash
npm run verify:fast                              # the mechanical contract — 17 suites, 363 checks, ~80 s
npm run verify                                   # the gate — ~1268 checks, ~11 min
SABER_CHECK_ORDER=reverse npm run verify         # same suites backwards — §6.4
node --import ./tools/register.mjs tools/_one.mjs <suite>
node --import ./tools/register.mjs tools/_seq.mjs <suite> <suite>   # §6.4's missing tool
node --import ./tools/register.mjs tools/trace.mjs --waves 20 --level colosseum
node --import ./tools/register.mjs tools/playthrough.mjs --minutes 20   # a run, played
node --import ./tools/register.mjs tools/_m5.mjs --seeds 6 --minutes 6  # PLAN.md's M5
node --import ./tools/register.mjs tools/combat-trace.mjs --waves 8
node tools/smoke.mjs --shots                     # real browser, real render
```

---

## 2. Traps. Read this before writing a tool.

### 2.0 The two that cost the most time, every single session

**`git checkout <file>` restores from the INDEX, not from HEAD.** So a mutation
runner that ends each case with `git checkout -- src/game/Foo.js` silently
throws away every UNCOMMITTED edit in that file. This has eaten real work three
times in one session: a `Number.isInteger` fix, a whole `fate` field, and a
`_unbury` method that then failed its own brand-new check with *"is not a
function"*. **Commit before you mutate.** Always. And never leave a mutation
runner going in the background while you edit the same file — it reverts
underneath you between cases, and the failure looks like your edit was wrong.

**`pkill -f "<pattern>"` matches the shell running it.** `pkill -f
"tools/verify"` inside a command whose own line contains `tools/verify` kills
that command. It has happened three times here, each time reported as an
unexplained `exit 144` on a job that was working. Find the PID first
(`pgrep -f`), then `kill` it, and keep the pattern out of the line that does the
killing.

**A full `verify.mjs` run is a snapshot of the tree AT ITS START.** Suites are
imported lazily but `src/` modules are cached on first import, so editing source
mid-run gives a mixed-state result: a check written against the new code runs
against the old. A red from a run whose tree moved under it proves nothing. Kill
it and start again on a clean tree.

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

### 2.2b Parallel agents share ONE working tree — git verbs that take the whole tree are loaded guns

> **AND AN EXPLICIT PATH IS NOT ENOUGH WHEN TWO LANES ARE IN THE SAME FILE.**
> The rule below — name your paths — assumes the partition holds. It stops
> holding the moment two lanes both have edits in one file, because `git add
> <path>` stages **the file**, not your hunks: the first lane to commit takes
> the other's half-finished work with it, under its own message.
>
> Measured tonight: a co-op lane's changes to `World.js` and `Emplacement.js`
> were swept into two commits by peers who had named those exact paths, and
> **those commits describe a fraction of their own diff**. Nothing was lost and
> nothing was corrupted — what was lost was the record, which on this project is
> most of the value.
>
> So the partition has to be at the FILE, not at the feature. If two lanes
> genuinely need the same file, one of them takes it and the other sends a patch
> or waits; and if you commit a file you share, read `git diff --cached` before
> you write the message and say in it what is not yours.
>
> **AND THE INDEX IS SHARED EVEN WHEN THE FILES ARE NOT.** The paragraph above
> is about two lanes in one file; this is the same hazard with no shared file in
> it at all. A lane staged four files nobody else was touching —
> `main.js`, `Waves.js`, `Progress.js`, `Support.js` — read `git diff --cached`
> to confirm the hunks were its own, and then spent ninety seconds inspecting a
> fifth file before committing. In that window a peer ran its own
> `git add <its paths> && git commit`, and **the peer's commit carried all four**,
> because a commit takes the whole index and not the paths you added last.
> `git commit -- <paths>` afterwards answered *"no changes added to commit"*, and
> `git diff HEAD` for those files was empty: the work was already in somebody
> else's commit. Nothing was lost; the record was, again.
>
> The rule that follows is one line and it is cheap: **stage and commit in ONE
> command.** `git add <paths> && git commit -m … -- <paths>` leaves no window.
> Never stage and then go and look at something.


Five agents were run in parallel on this branch, each owning a disjoint set of
files. That partitioning is sound for *editing* — two agents never touched the
same file — and it is **completely undone by any git command whose unit is the
tree rather than the path.** One agent tidied up with `git stash` and took
**1 825 lines across 19 files belonging to five different agents** with it,
including a whole new terrain preset and level that had never been committed.

It was fully recoverable (`git stash list` → the WIP commit → `git checkout
<stash> -- <paths>`), and the reflog line to look for is `reset: moving to
HEAD`. Nothing was lost. But the recovery cost more than the tidying saved, and
the failure is silent: the agent that stashed saw a clean tree and carried on,
while four others kept editing files whose contents had reverted underneath
them.

The rules that follow, for any future parallel run:

- **Banned outright while peers are live:** `git stash`, `git reset --hard`,
  `git checkout -- <path>`, `git restore`, `git clean`. Every one of them
  operates on paths the caller does not own.
- **`git add` takes explicit paths. Never `-A`, never `.`, never `commit -a`.**
  The soundtrack agent's commit swept in seven files belonging to three other
  agents. Harmless that time — it is what rescued them — but it means a commit
  message describes a third of its own diff.
- **A dirty tree full of other agents' files is the correct steady state.** Tell
  agents this explicitly in their brief, or they will try to make it clean.

**IT HAPPENED AGAIN, TO AN AGENT WHOSE BRIEF BANNED IT BY NAME.** A second
parallel run, six lanes live; the run-rules lane ran `git stash` and took five
files — `src/game/Duel.js`, `tools/checks/footwork.mjs`, `forms.mjs`,
`living-force.mjs`, `terrain.mjs` — three of them belonging to a lane that was
still working. It restored them within about two minutes by reading blobs out
of the stash commit, and it reported the failure itself, in full, at the top of
its own report. That is the behaviour to want; the ban still did not hold.

Three things that run taught which the first one did not:

- **`git stash pop`, `apply` and `checkout <stash> -- <paths>` were all refused
  by the permission layer**, so the only recovery route left was
  `git show 'stash@{0}:<path>'` piped back to the file. That is worth knowing
  *before* you need it: the documented recovery in the paragraph above is not
  available, and the one that works is a read.
- **Do not drop the stash.** It is the only record of the window. Verify from
  outside instead: diff `git show 'stash@{0}:<path>'` against the live file and
  look for lines present in the stash and absent now. On this occasion that came
  to 6 comment lines in `Duel.js` and 25 in `footwork.mjs`, both prose the
  owning lane was rewriting anyway — but the owning lane is the only one that
  can confirm that, so ask it while it is still alive.
- **The silent half is the re-read, not the revert.** A file that is longer than
  the stashed copy looks safe and is not: an agent that read one of its own
  files during the window and wrote back on top of what it read has undone its
  own edit, and the line count never shows it. A number is easier to lose that
  way than a paragraph.

So the rule earns one more clause: **a brief that bans the verb is not enough.**
If a future run cannot tolerate this, give each lane its own worktree
(`isolation: "worktree"`) and merge, rather than relying on six agents to each
refrain from one convenient command.
- **Commit early, by path.** A commit is the only thing that makes an agent's
  work safe from its peers.
- **A new file and the import of it are ONE commit.** `src/world/Smoke.js` was
  created untracked while `Levels.js` — committed by a *different* agent's
  broad `git add` — imported it. Three consecutive commits (`28072ad`,
  `dd6b757`, `d3df970`) therefore cannot be loaded at all in a clean checkout:
  `ERR_MODULE_NOT_FOUND`. Nobody noticed, because every agent had the file on
  disk. It only surfaced when a bisect checked out those commits somewhere
  else. `git status` showing `??` next to a file that something already imports
  is the signal, and it is exactly what a path-scoped `git add` is prone to
  missing.

**IT HAPPENED A THIRD TIME, IN THE NARROW CASE, AND THE NARROW CASE IS STILL
NOT AN EXCEPTION.** A lane ran `git checkout HEAD -- tools/_linehold.mjs` to
drop one experimental hunk from a file it had created and committed thirty
seconds earlier. `git status` afterwards showed only an untracked peer file, so
nothing was lost and nothing could have been — the path was unambiguously its
own. It reported the breach itself, unprompted, at the top of its own report.
That is the behaviour to want and the ban still holds as written: the reason it
is a ban and not a guideline is that "I am sure this path is mine" is exactly
what the agent that took 1,825 lines also believed. The safe version of the
same intent is `git show HEAD:<path> > <path>`, which is a read and cannot
reach a path you did not name.

**AND `git commit --amend` IS A TREE-WIDE VERB TOO** — the third round found
this one, and it is the subtlest of the three because the lane did everything
right. It ran a path-scoped `git add`, checked `git diff --cached --stat`, saw
exactly its own two files, and then amended the commit to drop a trailer. **An
amend re-uses the shared index**, and a peer had staged in the window between
the two commands, so the amended commit carries nine files belonging to four
other lanes. Nothing was lost — committing a snapshot cannot revert anything —
but a commit that describes 2 of its 11 files is a commit nobody can read later.
There is no fix after the fact worth taking: six commits had already landed on
top, and rewriting that history is the worse failure. **Do not amend while peers
are live. Write the message right the first time, or add a second commit.**

The deeper lesson is that file-ownership partitioning is necessary and *not
sufficient*: the shared mutable resource is not the files, it is the index and
the working tree. Either brief every agent off the tree-wide verbs, or give each
one a worktree (`isolation: 'worktree'`) and pay the merge cost instead. The
one agent that ran in a worktree here was the only one that could not have
caused this and could not have been hurt by it.

### 2.3 The signature defect: a hand-maintained table beside its generated twin

Eight instances found so far. A HUD price list, an announcer voice map, the
sandbox roster, a level card's unit count, a garment length, a wire record, a
wave-boundary rule, and every level's pool weights. The fix is always the same:
**the hand-written thing stops being the authority.**

A close relative: a missing thing answered with a plausible default instead of
an error (`PEAK.get(tex) ?? 3`, `_one.mjs` printing "0 passed, 0 failed", a
12-slot record against a 13-slot packer). `determinism.mjs` has tripwires for
both.

### 2.3b A CHECK THAT READS A FIELD NOTHING WRITES IS A CHECK THAT CANNOT FAIL

Two shapes, both found by audit, both of which had been green for a long time.

**A property nobody writes, swallowed by `?.`.** `killerName` ended
`source.A?.name || source.type`, and an archetype has no `name` — the field is
`label`. So the first half was ALWAYS undefined, the `||` was the only path, and
every after-action report and every grave in the ground said `b2` and
`droideka` instead of "B2 Super Battle Droid" and "Droideka". The Foundry's
banner had the same line and told a player "the next one up is a arc". Optional
chaining does not fail; it degrades into a plausible wrong answer.

**The same thing in a CHECK, where it also disables the assertion.**

    assert(world.notes?.some?.(([t]) => /LINE/i.test(t)) !== false, '…')
    assert(b.world.notices?.some?.(s => /BARRIER DOWN/.test(s)) !== false, '…')

There is no `world.notes` and no `world.notices` — the only notification path is
`World.notify` → `this.onNotify?.(…)`, and `world.notifications` was a queue
nobody read and was deleted. So both expressions are `undefined`, `undefined
!== false` is true, and both assertions were unfailable. One of them sits inside
`theline.16`, guarding the flagship rule's ONLY on-screen explanation of why an
advance has stalled. **Record notices with `world.onNotify = (t, sub) => …`;
`coop.mjs` and `command-pvp.mjs` have always done it that way.**

The generalisation, and it is the same sentence as §2.3: a reader that cannot
see its subject reports the fallback and calls it a measurement.

### 2.3c A READER TEST THAT GREPS THE WHOLE TREE FINDS SOMEBODY ELSE'S FIELD

Three checks asked "does this table's column have a reader" by matching the
column NAME against every `.js` file in `src/` concatenated. The names are
ordinary words and the tree is eight megabytes:

  · `balance.mjs` matched `.fireRate` — which is `A.fireRate`, the ARCHETYPE's
    field, **on the same line as** the difficulty read. Deleting
    `(diff.fireRate ?? 1)` from both of Enemy's attack timers left it green over
    a difficulty column that had stopped meaning anything. Same for `assist`,
    covered by `this.assist = 0` in SaberController.
  · `forms.mjs` matched bare words: `strength` 137 times outside the table,
    `strike` 38, `moves` 26, `tell` 22. Deleting the feint left it green on
    `DUEL_PHASES`'s own `'feint'` string.

**The reader has to be a member access off the thing that holds the table** —
`difficulty|diff`, `F|form|FORMS[…]`. Tightening `forms.mjs` immediately found a
real dead field: `tell`, the one sentence per lightsaber form describing how to
read it, authored five times and rendered nowhere — in a game with a training
mode.

### 2.3d A FIXED-LENGTH SOURCE WINDOW, SPELLED AS A REGEX

`determinism.mjs` forbids `src.slice(i, i + N)` for reading a function, with the
whole story above it. It forbade ONE SPELLING: `/_spinBody[\s\S]{0,3000}?…/` is
the same guess with different punctuation, and twelve were live while that check
was green. Two mattered — `Player._spinBody` is 2569 characters against a 3000
window, so it already ran 431 past the end of the function.

**And the overshoot direction is the one that hides.** `characters.mjs` read
`/_updateBlade[\s\S]{0,4000}/`, and the first `_updateBlade` in Player.js is at
line 365 — inside a doc comment, 4384 lines above the method. The check
"nothing multiplies the blade anchor by the figure's stature" had been passing
on PROSE, and its claim had quietly stopped being true: the anchor is scaled by
`limbs.stand` now, for reasons the code explains at length.

`functionBody(src, sig)` from `_source.mjs` is the answer — **and give it a
signature that is the definition and not a mention of it.** `'_updateBlade('`
finds the call site 1300 lines earlier; `'\n  _updateBlade('` finds the method.

### 2.3e A HARNESS THAT DOES NOT AWAIT ITS CHECKS REPORTS GREEN ON A RED ONE

`tools/_onecheck.mjs` was written to run ONE check out of one suite, because
proving a `theline.mjs` guard red costs twenty-five minutes otherwise. Its first
cut reported **"1 ran, 0 failed" on a check whose assertion had been broken on
purpose, and printed no verdict line at all.**

A suite's `run()` calls `check(name, fn)` and DOES NOT AWAIT IT — menu.mjs's own
header says so ("the runner starts every check as soon as the one before it
suspends"). So `await mod.run(...)` returned while the async body was still
inside its first `await`: the counter had been incremented, the `try` had not
reached its `catch`, and `process.exit()` at the foot of the file killed the
process before either happened. Collect the promises and await them.

It is the "0 passed, 0 failed reads as success" defect (§2.3) in a new place,
and the worst possible place for it: a tool whose only job is telling you
whether a check can fail.

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

### 2.5c A SCRIPTED PLAYER THAT IS NOT TICKED IS A STATUE, and nothing says so

`tools/_flagship.mjs` exports `dutyInput(world)`, a scripted player. **Its
entire body is `input.tick(dt)`** — that is where it reads the field, points the
move axis, presses the swing and holds station on the line. `world.update` does
NOT call it. **There is no `input.tick` call anywhere in `src/`** — grep it. The
only caller is `_flagship.mjs`'s own `drive`, one line above its step, and
`drive` and `dutyInput` are exported separately.

So a bench that writes its own loop gets an unkillable **statue standing on the
deploy mark with the guard up**, and every number it takes is a number about a
sitting nobody would play. It fails silently and it fails plausibly: the world
runs, the army fights, the waves clear, and the figures look like figures.

**Four benches in three lanes had it on the same afternoon** — `_linehold`,
`_lineform`, `_linewave`, `_linelength` — and it cost at least three published
results, including "a Push's floor is 45.7 minutes", the number a whole
work-stream was named after.

**It was reported fixed at the root and it was not.** That claim was relayed
onward and believed. The rule until somebody actually fixes it:

```js
input.tick?.(STEP);        // BEFORE the step, every frame
world.update(STEP, input);
```

If you are writing a bench, grep your own loop for `tick` before you trust a
single number out of it. If you would rather fix the class than the instance:
the contract lives in `drive` and the thing that needs it is what `dutyInput`
returns, so make them inseparable — a script that cannot be driven un-ticked.

---

### 2.5b THREE module-level streams, and until recently only two could be pinned

The most expensive version of §2.5 this repository has produced, because the
harness was not lying — it was answering a question nobody had asked it.

`enemyRng.seed(n)` (Enemy.js) and `seedWaves(n)` (Waves.js) have existed for a
long time. `World.js` held a third, `const rng = makeRng(moduleSeed(2))`, drawn
by `pickSpawn`, `spawnDebris`, the dressing and a dozen per-frame callers — and
it had **no reseeder**, so a bench could pin two of three and believe it had
pinned the world. It is `seedWorld(n)` now; `makeRng` already carried the
method, so the fix was an export and a name.

What the gap cost, on one number — survivors of a ten-man line at the end of one
engagement of the flagship mode:

- Two arms differing **only in the mode string** read **5.4 and 3.0 of ten** on
  the same director and the same change. A crossing rolls a session plan
  (`rollSession`) and Command does not; that one extra draw moves everything
  after it. A whole tuning conclusion was drawn from the gap and was wrong.
- **Four consecutive readings of ONE build by one check spanned 1.3 to 6.0**,
  on nothing but where the eleven checks above it had left the stream.

Three rules follow, and they are written into `tools/_linehold.mjs`'s header
where the next person will meet them:

- **Both arms from FRESH PROCESSES**, one invocation each, same seed list. Two
  arms inside one process are not comparable — the second starts wherever the
  first stopped.
- **Never compare across mode strings.** Compare theline against theline.
- **Pin anything else that is a roll**, e.g. `LEVELS[*].battlefield`, which
  raises a generated heightfield per seed under a level's own dressing.

**AND SOME OF THESE QUANTITIES ARE CHAOTIC, NOT MERELY NOISY**, which is the
part that survives even a perfectly pinned harness. Two arms differing only in
one bolt's damage — 10 against 5 — took the same seed from **5 survivors to 1**
and the next seed from **1 to 5**. A perturbation of a few hit points diverges a
three-wave engagement inside seconds, so a per-seed pair means nothing and only
a mean over many seeds does: five seeds carry a standard error near 1.3 on a
ten-man roster, twenty carry about 0.65. Treat any difference under about 1.5
men at five seeds as **unmeasured**, and size the sample before the lever.

### 2.6 Frames are not seconds — there is no GPU here

Everything renders through swiftshader on the CPU. Measured on an **empty**
field (801 draw calls, 1.6 M triangles at 1280×720): **one frame takes 4151 ms.**

The smoke test's probes counted rendered frames when they meant game-seconds, so
"90 frames" was six and a quarter minutes — and since `main.js` clamps `dt` to
0.1 s, it also handed the game *nine* seconds of play instead of 1.5. Wrong in
both directions at once. Use `window.__play(gameSeconds, …)`, not a frame count.

Timing checks (`prefracture`, `frame-budget`) will blow if anything else is
using the CPU. Don't run the suite next to a browser.

### 2.6e AN AGENT'S `nohup … &` OUTLIVES THE AGENT, AND NOTHING TELLS YOU

Two hangar auditors launched their browser probes as
`nohup timeout 2400 node probe.mjs > log 2>&1 &`. Both agents finished and
reported. **Both probes kept running** — 18 minutes each, each holding a full
headless Chromium with a GPU process, a network service, two renderers and a
crashpad handler. Fourteen chrome processes in total, on a 4-core box, with
nothing in the session saying so: `ListAgents` showed the agents completed, the
task notifications said completed, and `ps` was the only thing that knew.

The cost was not theoretical. Load average sat at **11.5 on 4 cores** and
`theline` timed out at 900 s three separate times — and the first two of those
were read as "the suite is slow" rather than "there are two invisible browsers
on this machine". That is most of an hour spent on a symptom.

- **After any agent that drives a browser finishes, run
  `ps -eo pid,etime,comm | grep -E "chrome|node"`.** Its completion is not a
  statement about its children.
- Kill by PID, and kill the browsers explicitly — killing the node parent does
  not reliably take a Playwright browser launched over a pipe with it:
  `kill -9 <pids>` then `pkill -9 -f playwright_chromiumdev_profile`.
- **Do not read a slow suite as a slow suite until the box is quiet.** §2.6b is
  the law; this is the way it hides.
- If you brief an agent to drive a browser, tell it to run the probe in the
  FOREGROUND (it has its own timeout) rather than detaching it, so the probe
  dies with the turn that started it.

### 2.6b …AND TWELVE LANES ON ONE BOX IS "ANYTHING ELSE"

The line above says "don't run the suite next to a browser". The version of it
that actually bites now is worse, because it is invisible: with a dozen agent
lanes on this one container, each running its own bench, **`uptime` reported a
load average of 44 across 24 node processes.** Every millisecond any of them
measured in that window was fiction, and a full gate under it went red on
`cloth: 19 enemies' garments cost 6.43 ms` — a check that passes alone.

Two rules, and the second is the one people skip:

1. **Before you quote a millisecond, run `uptime` and `ps -eo args | grep -c
   "^node --import"`.** Put the number in the report next to the measurement.
   A timing taken at load 44 is not a slow result, it is no result.
2. **A red timing check in a shared-box gate is a LEAD, not a fact.** Reproduce
   it alone before you spend an hour on it — and reproduce it alone before you
   "fix" it by raising the budget, which is how a real regression gets papered
   over by a number somebody widened to match a contended run.

The same applies to any bench with a wall-clock term in it. Counts, hit rates
and hp are safe under load; seconds are not.

### 2.6d THE GATE NO LONGER FINISHES ON A BUSY BOX, AND FOUR SUITES ARE MOST OF IT

Three separate lanes failed to complete a full `verify.mjs` in one session —
one capped at 25 minutes having reached 14 of ~111 suites, one still on its
tenth after 95 minutes, one killed at ~50 minutes. That is not three unlucky
runs; it is the gate having grown past what a contended box can carry, and the
consequence is worse than slowness: **a gate nobody can finish is a gate whose
reds nobody triages**, so every lane falls back to running the six suites it
happens to have touched.

Wall-clock from one such run (inflated by contention — see 2.6b — but the
RANKING is stable, and the ranking is the point):

    frontdoor.mjs      1961 s   for ONE check
    extraction.mjs     1135 s
    footwork.mjs        843 s
    command.mjs         659 s
    levels-quality      567 s
    command-pvp         555 s

Two rules follow.

1. **Before adding a check that drives a whole sitting, price it.** `theline.19`
   already made this argument for itself — it caps its drive at the deploy
   card's own top *"which is what makes this affordable to run"* — and it is the
   right instinct applied to one check while the file around it grew. A drive
   that cannot state a bound on its own length does not belong in the gate; put
   it in `tools/` as a bench and cite the bench from a cheap check.
2. **Do not start a gate you are not going to read.** An orphaned `verify.mjs`
   ran for 2 h 48 m in this session against a build that was 36 commits stale by
   the time it was noticed — node caches modules at import, so a long gate
   measures the tree as it was when it STARTED. It was burning a core the live
   lanes needed and its output would have been fiction if it had ever finished.
   Check `ps -eo etime,args | grep [v]erify.mjs` before launching one, and kill
   any gate older than the last batch of commits it was meant to cover.

### 2.6c …AND YOU CAN MEASURE A MILLISECOND ON A LOADED BOX AFTER ALL

The two rules above are right and they stop one step short. "Do not quote the
number" leaves every timing check in the gate red whenever a peer lane is
working, which is most of the time, and a check that is red for a reason nobody
can act on is a check nobody reads. It also leaves the actual question
unanswered: if a wall-clock millisecond here is worthless, **what is the frame
made of?**

`performance.now()` keeps running while this process is off a core.
`process.cpuUsage()` does not. Measured on this box with eleven peer node
processes live, one fixed 200 000-iteration arithmetic loop, alternate samples:

```
wall ms  0.441  0.456  0.431  0.471  28.551  0.457  0.416  …  24.881
cpu  ms  0.441  0.453  0.428  0.467   0.559  0.454  0.416  …   0.443
```

The wall column says the work got sixty times more expensive. It did not. The
residual on the CPU column — 0.44 → 0.56 on the worst sample, about 25% — is
cache pressure from the other tenants, and that is the honest error bar left.

- **`tools/checks/_cpuclock.mjs`** is the helper: `cpuMs()`, a `window_()` that
  hands back `{cpu, wall, contention}`, and `loadPhrase()` so a check prints the
  load beside its own figure as §2.6b asks. `cloth-cost` uses it, which is why
  the `6.43 ms` failure cannot come back: at load 59.8 with the box running
  8.20× it reads 4.26 ms of CPU against a 6.0 ceiling.
- **`tools/_ledger.mjs`** is the per-subsystem frame ledger built on the same
  clock. Two `cpuUsage()` reads a frame give the frame's true cost;
  `hrtime.bigint()` splits it between subsystems as a SHARE, because
  `cpuUsage()` is 3.7 µs a call and there are ~220 per-body calls a frame. Rows
  are exclusive of their children and `residual` is printed, so the ledger
  cannot quietly stop adding up.

```bash
node --import ./tools/register.mjs tools/_ledger.mjs \
  [--seed 7] [--level geonosis] [--mode theline] [--quality high] \
  [--warm 45] [--frames 300] [--json out.json] [--prof out.cpuprofile]
node --import ./tools/register.mjs tools/_ledger.mjs --top out.cpuprofile
```

`--prof` profiles the MEASURED frames only, never the warm-up — a deploy's
first second builds colliders and bakes merged skins, and a profile containing
it names the loader. `--top` reads the result by self time. §2.7b's lesson
applies every time: a profile named `_gatherNear` and `_encodeCell` in one pass.

**What it said, geonosis · seed 7 · `theline` · `high` · 300 frames after a 45 s
warm-up, at load 45 on 4 cores — 38 hostiles against a ten-man roster, which is
what the mode actually fields:**

| subsystem | ms CPU/frame | share |
|---|---|---|
| physics | 13.81 | 47.0% |
| animation | 6.61 | 22.5% |
| enemy other | 3.52 | 12.0% |
| enemy think | 1.14 | 3.9% |
| player | 0.95 | 3.2% |
| terrain | 0.87 | 3.0% |
| residual | 0.82 | 2.8% |
| bolts | 0.56 | 1.9% |
| cloth | 0.46 | 1.6% |
| director, blades, particles, corpses, vfx | under 0.2 each | |
| **FRAME** | **29.35** | |

*frame wall 185.9 ms · frame CPU 29.4 ms · **contention ×6.33***

So the `cloth: 19 enemies' garments cost 6.43 ms` that §2.6b is about was the
box: cloth is **1.6%** of the frame in the mode the game is played in, and the
enemies on that ground wear no garments at all — the 0.46 ms is the PLAYER's
four. Three things came out of going and looking, all in
`tools/checks/frame-ledger.mjs`:

- **`physics` was the dead.** 386 rigid bodies, 383 awake, 269 ragdoll joints
  against 40 living enemies; 15 of 21 corpses had never settled and the oldest
  had been down 33.7 s. `Corpses`' settle test asked whether the FASTEST of a
  ragdoll's nineteen bones was under 5 cm/s, and a corpse lying in the sand
  reads 0.20-0.28 there for ever. It is a displacement test now, plus a cap.
  Measured A/B, one seed, same load: physics 13.05 → 8.88 ms, frame 29.11 →
  26.50.
- **`physics.staticBoxes` was swept linearly, once per body per frame.**
  `src/physics/BoxIndex.js`. A gather looks at 2.6 box records against 135.1.
- **The ground's memory published the whole texture every frame.** One union
  dirty rectangle over marks that are far apart is the whole 192² field.
  21 094 cells a publish → 263, bytes identical.

**Still open, and named because the ledger prices them:** `animation` is 6.6 ms
over ~40 bodies and the LOD split says 1.5-2.5 ms of it is spent on bodies at
lod 2 and beyond — `Cohorts.js`'s header says "what is dropped is the gait" and
only the DRAWING of it is; `updateMatrixWorld` is still 8.5% of the frame,
almost all of it `Rig.updateMatrices()` forcing a full-tree walk twice per
animator update and twice more in `_poseArms`; and `SurfaceField.update` still
re-encodes all 36 864 cells at 10 Hz after ageing them, which is now the larger
half of the terrain row.

> **SOLVED, AND THE HYPOTHESIS BELOW IS REFUTED BY MEASUREMENT — see §2.7b.**
> The roster's growth to 31 archetypes is **not** why `cloth-cost` never
> finished: the whole 31-archetype census World builds, spawns and steps in
> **5.2 seconds**, and 4 frames costs 53 ms with 4 enemies against 50 ms with
> 24. It was one call site — `Enemy._sustain` handing `sparkBurst` a colour
> where the parameter is `count`, so a frame asked for 17.8 million particles
> and took 71-134 seconds. `cloth-cost` runs in **12.7 s** now and
> `levels-quality`, which had the same cause, in **1 m 59 s**.
>
> Keep the paragraph below anyway. It is a good record of a plausible story
> built from real symptoms, and it names itself as a hypothesis — which is the
> only reason the next person went and timed it instead of optimising against
> it. **The lesson is the one §2.6 already draws about `ps`: a CPU profile of
> 34 frames cost four minutes and named the function outright, after six
> attempts across two callers had spent a session guessing.** Profile before
> theorising about a CPU-bound thing, exactly as you read the process table
> before theorising about a hang.

> **LATER, AND IT CHANGES THE CONCLUSION BELOW.** Everything in this section is
> still true about the *early* symptoms, but contention was not the whole story.
> Measured afterwards on a QUIET box, with the full run as the machine's main
> consumer: `verify.mjs` spent **over forty minutes inside `cloth-cost` alone**
> with its worker at 85-86% CPU the whole time, and was killed by a 50-minute
> timeout having never left that suite. Six attempts across two callers have now
> failed the same way. So:
>
> - It is **not** the §2.7 hang — that signature is a live worker burning NO
>   CPU. This one burns CPU continuously and makes progress.
> - It is **not** only contention — it does not finish with the box to itself.
> - **`cloth-cost` is simply too expensive to sit in the default gate.** It
>   spawns one of *every* archetype into an `ultra` World and steps 400 physics
>   frames, and the roster grew from ~20 archetypes to **31** this session
>   (seven Command units, four machines). That growth is the obvious suspect and
>   **it is a hypothesis, not a measurement** — nobody has yet timed the suite
>   against archetype count. Do that before "optimising" anything.
>
> To get a gate number meanwhile: `SABER_CHECK_ORDER=reverse` puts `cloth-cost`
> near the END of the run instead of sixteenth, so every other suite reports
> before it stalls. That is also the order-dependence check, so it is not a
> workaround with no other value.

**`cloth-cost` did not finish, and TWO diagnoses of it were wrong.** Worth
reading in full, because the wrong answers were more attractive than the right
one and one of them is still open.

The symptom: three attempts, 10-25 min each, no output, from two callers who had
not spoken to each other. `cloth-cost` builds a real World and steps 400 physics
frames.

- **Wrong diagnosis 1 (mine): CPU contention.** Six subagents were running. It
  is a CPU-bound suite. The story fit every fact I had and I wrote it into this
  file as a finding. That is the trap: *a slow suite on a loaded box explains any
  hang you meet, and it will always fit the evidence.*
- **Diagnosis 2 (an agent's): the deleted level.** `cloth-cost.mjs` stood its
  subjects on `loadLevel('temple')`, deleted in the roster cull. I rejected this
  because `World.loadLevel` resolves `LEVELS[key] ? key : LEVEL_ORDER[0]`
  (src/game/World.js:236) — an unknown key **silently substitutes the first
  level**, deliberately and with a comment calling it a safety net — so it
  cannot hang. **That rejection was too strong, and a second agent found the
  mechanism I had missed.** In `levels-quality`, `level('deeps')` fell back to
  the first surviving level and the suite then **cached that substitute under a
  second key**, so one dead name bought an extra simultaneous World — a ninth,
  in the suite §2.7 already names as holding the most alive at once. That is
  what took it from slow to not finishing.

  So a dangling level key does not hang a suite *directly*; it inflates the
  world count, and world count is what kills these runs. Both of us were partly
  right and neither account was complete. `roster.mjs` could not have caught it:
  `level('deeps')` is none of the five syntactic forms it scans for, exactly as
  its own note predicts.

**The cause was contention after all — and the process table is how you prove
it, not the story's plausibility.** Measured on this box while the fleet ran:

    $ ps -eo pid,etimes,args | grep -c "[c]loth-cost"
    11                       ← eleven concurrent runs of this one suite
    $ nproc
    4
    $ cat /proc/loadavg
    9.74 11.41 10.98

Eleven copies of a World-building suite on four cores, the oldest 43 minutes in.
Nothing was deadlocked; nothing could finish. Killing the runs over 15 minutes
old took it to four.

So diagnosis 1 was **right and unearned** — I asserted it from "six agents are
running, it is a slow suite", which is not evidence, and only went looking for
the process table after being wrong a second time. Had the true cause been
anything else, that reasoning would have produced the same confident sentence.
The lesson is not "contention is usually it"; the lesson is that `ps` and
`/proc/loadavg` take ten seconds and turn the guess into a measurement.

**Two of these suites are also a trap for a probe that runs its own.** If you
shell out to `_one.mjs` while agents are working, you are adding to the number
above. Check it first.

The second diagnosis also uncovered a defect worth fixing on its own account:
after the cull, four checks were measuring a level they did not name. `cloth-cost` asked for `temple`, `garments`, `lifecycle` and
`force` ask for `meadow`, and all four silently got `scoria`. A check that
believes it is testing one place while testing another is HANDOFF 2.4's problem
wearing a different coat — the fallback is right for a player with a stale save
and wrong for a test, which should be told. `cloth-cost` now names its field once
as `FIELD` and asserts the level exists. **The three `meadow` callers have not
been fixed** — `grep -rn "loadLevel('" tools/` is the list.

### 2.7 A LATE full run can hang on a suite that passes alone — **SOLVED, see the top**

> **RESOLVED.** The cause was DEAD LEVEL NAMES, not ordering and not CPU.
> `levels-quality.mjs` named **nine deleted levels** across three checks
> (`temple`, `arena`, `warship`, `intake`, `deeps`, `cut`). `World.loadLevel`
> substitutes `LEVEL_ORDER[0]` for a key it does not know — right for a player
> with a stale profile, a trap in a check — so **every dead name booted another
> full World**, cached it under the dead key, and then measured a property of a
> room that no longer exists against a copy of the Ember Shelf. Five extra
> Worlds in one check, on top of that file's real six.
>
> That is *why* the diagnosis below correctly fingered "the two suites holding
> the most Worlds alive at once": the observation was right and the cause was
> one layer further down. Adding an eighth real level is what took it from slow
> to never finishing. `cloth-cost.mjs` had the same defect independently.
>
> Fixed: `level()` throws on a dead key, the three checks enumerate over
> `LEVEL_ORDER`, and `roster.mjs` gained a **sixth form** — `level('x')` /
> `loadLevel('x')` — so the class cannot hide again. Nine of twelve checks now
> finish in ~44 s. The sixth form caught a live one on its first run, in `src`
> rather than `tools`.
>
> **Still worth doing:** `coop.mjs` is the other suite named below and has not
> been audited for the same shape.

The original observation, kept because the reasoning was sound and only the
cause was missing:

Observed twice at the end of a long session, on two different suites:
`verify.mjs` stopped making progress on `levels-quality.mjs` once and on
`coop.mjs` once, sitting there for 20+ minutes with the worker alive and
burning no CPU. **Both suites pass on their own** — `coop` 29/29,
`levels-quality` 12/12 in 74 s — and three earlier full runs the same session
completed normally (1066, 1088, 1097 passing).

So the last *completed* number is trustworthy and the hang is in the harness,
not the game.

**THE DISCRIMINATOR WAS RUN.** `SABER_CHECK_ORDER=reverse` hung on
`levels-quality.mjs` **again** — the same suite, from the opposite end of the
run, after ~55 other suites had passed through first. Two of the three
observed hangs are that suite and the third is `coop.mjs`. **It is not
ordering.**

What the two share is the thing to look at: they are the two suites that hold
the most Worlds ALIVE AT ONCE.

I first wrote here that `levels-quality.mjs` "calls `await level(...)` twelve
times against three `unload()` calls" and left it as the lead. **That was
wrong, and it is worth leaving the correction in** — it is exactly the shape
§2.4 warns about, an instrument restating a rule and manufacturing a defect
out of the difference. `level()` is a CACHE keyed on the level name: twelve
calls resolve to six distinct worlds, and the suite's last check disposes all
of them and asserts it did (`WORLDS.clear()`, line ~605).

So it does not leak. What it does is hold up to six fully-built Worlds —
terrain heightfield, Rapier world, instanced fields, texture set each —
**simultaneously**, deliberately, so it does not rebuild them per check. That
is a peak, not a leak, and the two want different fixes: a peak is capped by
evicting the cache between groups, a leak by disposing at the end, which it
already does.

So the next step is a memory READING and not a bisect, and it should
distinguish those two: log `process.memoryUsage()` per suite across a full
run. **Monotonic climb** across unrelated suites means a leak somewhere else
and these two are merely where it tips over. **A spike confined to these two**
means the peak is the problem and the cache wants a cap.

Two things that are NOT the cause, ruled out rather than assumed: suite order
(above), and leftover Chromium from `fpview.mjs`/`shot.mjs` (killed before the
reverse run; it hung anyway).

### 2.7b THE GATE RUNS — CLOSED

*(The figure this section was written around was 1260 passed / 8 failed. §1 carries
the current one; this is the record of the run being fixed, not a status line.)*

*Was "verify.mjs is ALL-OR-NOTHING, and that is why nobody has a gate number".
All three of the problems it named are now measured and fixed, and one of the
three diagnoses in it was wrong in a way worth keeping.*

**`npm run verify` completes and prints a number.** Forward and reverse agree.
Run it, don't take this figure — the point of the section is that it is now
cheap to get one.

**1. verify.mjs reports as it goes.** It used to print one line per suite as it
*started* and hold every result to the summary at the bottom, so a run that
stalled on suite 42 discarded the evidence from the 41 that had passed: forty
minutes of CPU bought a list of filenames. Each suite now prints its own tally
the moment it settles — failures in full where they happen, elapsed seconds,
RSS, and a running total — so a killed run still has a number attached to it.
The stdout summary table is byte-identical; the new output is on stderr, for
the reason the `… name` line always was.

That also answers §2.7's standing peak-vs-leak question from the runner that
actually runs, rather than from `_memtrace.mjs`'s second copy of one: **RSS
climbs monotonically from 366 MB to 1.8 GB across the whole run** and is not
confined to two suites. It is a slow accumulation across eighty suites, not a
spike, and nothing on the list below is blocked by it.

**The core block is drained before the suite loop now.** It was the one block
exempt from the runner's own rule, so this file's ~700 checks ran concurrently
with all eighty suites, and `snapshotShared()` was reading the baseline while
they were still advancing `enemyRng`, `duelRng` and `wind.time`.

**2. `cloth-cost`: 40+ minutes → 12.7 seconds. THE ROSTER WAS NEVER THE
REASON**, and §2.6 said so as a hypothesis that nobody had measured. Measured:
building the `ultra` census World, spawning all **31** archetypes and stepping
it costs **5.2 seconds**. 4 frames with 4 enemies is 53 ms and with 24 enemies
is 50 ms — flat, inside the noise. Archetype count is not on the curve at all.

The cost was one call site, and a CPU profile named it in one pass where six
attempts across two callers had guessed at it for a session. **96% of a 439 s
run is `Enemy._sustain → sparkBurst → ParticlePool.spawn → SRGBToLinear`.**
Frames 1-20 of that suite cost 10-15 ms each; from frame 30, once the first
enemy holds lightning or choke, **they cost 71 to 134 SECONDS each.**

`Enemy._sustain` calls

```js
sparkBurst(chest, 2, 0x9fd8ff)          // Enemy.js:3544
```

against a signature of `sparkBurst(pos, normal, count, opts)`. Three arguments
into four slots: `2` lands in `normal`, and **the COLOUR lands in `count`**. The
burst asks for 10 467 583 sparks — 17.8 million spawns after the recipe's own
multiplier — on 35% of frames, per casting enemy, each paying a `THREE.Color`
sRGB→linear conversion. Measured: **810 of 828 bursts over the pool's capacity,
worst 10 475 775 against 4 200 slots, a factor of 2 494.**

**This is a game defect and not a harness one.** It is a multi-second freeze on
a player's machine every time an enemy uses a held power, and `normal = 2` also
spreads every spark in the burst along a NaN direction. The call site is in
`Enemy.js`, the other lane's file, and **has not been touched**.

`Particles.sparkBurst` now bounds a burst by its own pool's capacity: a ring
buffer cannot show more than it holds, so the surplus was provably invisible
work, and removing it stops the whole gate being hostage to one call site. That
bound is **not** the fix. `cloth-cost.mjs` carries the check that stays red
until the call site is corrected, so bounding the damage can never silence it.

**3. `levels-quality`: does not finish → 12/12 in 1 m 59 s.** Same root cause —
it drives 24 000 frames of real fighting enemies and every one of them was
paying the runaway. **The ten-entry `WORLDS` cache was not the reason**, which
was the standing lead; it is a real 606 MB peak and it is not what stopped the
suite. (`cloth-cost`'s 31-body `ultra` census World *was* being held for the
whole rest of the run behind a promise nothing released — 276 MB, now given
back — but that is a peak this file contributed to others, not its own stall.)

Finishing exposed a failure nobody could have seen. The `nav` check is the last
in the file and guarded its sample with `r.n >= 10` — correct while it cast 16
bearings, unsatisfiable since the note above it took the cast to 6. It failed
with `only 6 of 6 bearings on scoria were placeable`, which is every bearing it
asked for and the healthiest possible result. §2.3 in miniature. The floor is a
share of the cast now.

**4. `smoke.mjs`'s deploy step waited 30 s of WALL CLOCK for the HUD** — about
fifteen frames here, where §2.6 measures one frame at up to 4.1 s, and the
frames just after a deploy are the most expensive in the run. It was not asking
"did the game deploy", it was asking "is this box quiet". It waits in **rendered
frames** now, on two conditions that are each a real regression when they fire:
the render loop stopping, and the HUD still hidden after 24 frames.

**What the run reports, and how to read it.** Individual re-runs on a quiet box
are how you tell a real failure from contention — `prefracture` is red in the
full run and green alone, and says so in its own message ("this box paused
identical work by 158.6×"), which is §2.6's timing-check warning doing exactly
what it says. When a suite is green alone AND red in the run, `tools/_seq.mjs`
is what reproduces it in one process; §6.4 has the live list and the ordering
trap.

**`_memtrace.mjs` is answered and did not answer it.** Its header said "WRITTEN,
NOT YET ANSWERED" and guessed both the reason it could not work — a second copy
of `verify.mjs`'s runner, §2.4 — and the right move, "instrument `verify.mjs`
itself with a `process.memoryUsage()` line per suite". That is what was done.
The file is kept, and its header now says so, because reaching for it again is
the natural mistake and the header is where that gets stopped. **For a per-suite
memory reading, run the gate and read the RSS column.**

### 2.8 Bash has a 10-minute cap

A full `verify` run takes ~12 min. Use `run_in_background: true`. Foreground
`sleep` is blocked; use an `until` loop in a background command to wait.

---

### 2.9 A suite that borrows a SINGLETON must hand back all of it

`_shared.mjs` exists for the module-scope clocks — `wind.time`, `enemyRng`,
`duelRng` — and it is not the whole hazard. The engine singletons are the other
half, and one of them cost thirty-eight checks.

`audio.mjs`'s jet-trooper clause has to drive the shared `AudioEngine`, because
`Enemy._jetFx` calls the module's `audio` and not an engine it is handed. It
swapped in a fake `AudioContext`, called `init()`, and afterwards put back `ctx`
and `ready` — two fields of the dozen that `init()` writes. It left a live
`master` beside a null `ctx`, which is a state the game itself cannot reach, and
`setVolume` guards on `this.master` and then reads `this.ctx.currentTime`. Every
later suite that constructed a Menu died on its own Volume slider: 38 checks
across `controls`, `databank`, `front-screen`, `hud-events` and `menu`, all
green when run alone.

**AND THE THIRD MEMBER OF THE CLASS IS NOT AN OBJECT AT ALL.** `Menu`'s
rebinder calls `saveBindings`, which writes the player's whole key table into
`localStorage`, and `loadBindings` re-reads it on every `new Input`. A suite
that drives a rebind through a real Menu hands every later suite a keyboard the
player never chose. Measured, `controls` then anything: the blob left behind is
pad-only, so `loadBindings().walk` comes back `["PadBack+PadL3"]` against a
default of `["KeyI", "PadBack+PadL3"]`; `spectacle` is 19/19 alone and 15/19
after `controls`, and its message reads `KeyI answers to  — one press, two
systems`, an empty list where it expected a collision. Persistent storage is
module state wearing a different coat, and `snapshotShared`/`restoreShared`
carry the whole of it now.

**The rule, and it is cheap: snapshot the whole object, not the fields you
meant to change.**

```js
const was = { ...singleton };
try { /* … */ } finally {
  for (const k of Object.keys(singleton)) if (!(k in was)) delete singleton[k];
  Object.assign(singleton, was);
}
```

Nothing there names a field, so a property added to `init()` tomorrow is carried
by the same three lines — and the same argument says name no storage KEY either.
`tools/_seq.mjs <suite-you-touched> menu` reproduces this whole class in about a
minute; `_seq.mjs controls spectacle` is the bindings one.

**Three of the four largest red counts this session were this one defect wearing
three hats**, and every one of them was green when its own suite ran alone. If a
suite reaches for a singleton, a module record or a saved blob, the question is
not "did I put back what I changed" — it is "did I put back everything I
touched, including what I did not know I was touching".

---

### 2.11 ONE rng STREAM, ONE PROCESS — a fixture owns its draws only if nothing else draws

`rng` in `Enemy.js` **is** `enemyRng` (Enemy.js:59-60). It is one stream for the
whole process, not one per World. So a fixture that does

```js
enemyRng.seed(4711);
for (…) world.spawnEnemy('acolyte', …);
```

owns its fight **only if nothing else spawns a body between those two lines**.
Anything that does — another fixture in the same file, a module-scope IIFE that
has not finished, a peer suite in the same process — shifts every draw the
fixture takes by N, where N is however many the other party used.

This is not theoretical and it is not a slow leak. `cloth-cost.mjs` spent three
sessions being diagnosed as "two Worlds alive at once" and serialised twice, and
the real chain was:

> twenty identical acolytes spawned on one frame run one brain in lockstep →
> nineteen of them force-push inside a single frame → the ring is symmetric so
> the horizontals cancel exactly and the lifts add → `applyKnockback` did
> `velocity.add(impulse)` with no bound → the player left at 190 m/s and topped
> out at **718 m** → the camera follows the player, so every garment fell
> outside the 30 m cloth cut and the suite timed an empty field.

**One draw is the whole knife-edge.** Measured by drawing N times by hand before
the fixture: N=0 floor, N=1 **612 m**, N=2 floor, N=5 **722 m**. Which is why it
looked like an ordering problem and why it came back every time the roster grew
by one archetype — this session it was the droideka's `walkPhase`, one `rng()`
call added to fix NaN legs.

Two things follow, and the second is the important one:

- **A check that seeds a shared stream must own the process at that moment.**
  If you cannot guarantee that, do not seed — measure something that does not
  depend on the draw.
- **A harness symptom that survives three "fixes" is a game defect wearing a
  harness costume.** The launch was real: any crowd that pushes together could
  do it to a player, and nothing in the game bounded it. The fix is in
  `Enemy.js`'s `addShove` — the shoves that land in one frame carry a body no
  faster than the hardest single one of them — and a single shove is
  arithmetically identical to what it replaced.

---

### 2.10 A gate run inside a `git worktree` has no `node_modules`

Two suites drive a real browser — `front-screen`'s layout check and
`packed.mjs` — and both `import 'playwright-core'`. A worktree does not get the
clone's `node_modules`, so both fail with `Cannot find package
'playwright-core'` and it reads exactly like a broken check.

```bash
git worktree add --detach /tmp/gate HEAD
ln -s /home/user/saber2/node_modules /tmp/gate/node_modules
```

Do that before judging any worktree run. It is the same shape as §2.1: an
environment difference that produces a confident wrong answer.

---

## 3. The instruments, and what each is for

| Tool | Answers | Blind to |
|---|---|---|
| `verify.mjs` | is it **correct** | whether it is tuned or fun |
| `balance.mjs` | is it **tuned** | anything a player presses |
| `trace.mjs` | what a run **contains** | combat, and anything a player presses |
| `playthrough.mjs` | what **happens, in order**, over twenty minutes | anything one scripted Vanguard does not do |
| `combat-trace.mjs` | what a fight **contains** | anything past a stationary floor |
| `smoke.mjs` | does the real page **boot and render** | mechanics |
| `pack.mjs` | does the whole game **run with no server** | anything a check already covers |
| `checks/packed.mjs` | does the packed page **boot from `file://`** | how it plays once it has |

**`playthrough.mjs` closes the one gap the other six share: none of them
plays.** A check drives twenty seconds because that is what a PROPERTY needs;
`trace.mjs` and `balance.mjs` both say outright that they never press a button.
So a curve that only bends after minute ten is invisible to every row above it,
and every finding about pacing this project has had came from a person playing.
It drives the repository's one scripted Jedi (`dutyInput`, imported rather than
written twice) over a real horizon and prints a timeline, a casualty list by
name, and every announcement with the clock on it. It also borrows `trace.mjs`'s
rule whole: **an instrument with an opinion is a check with a hand-written bar**,
so it scores nothing.

Read its `remaining`, `delivered` and `rescues` columns before reading anything
else on a quiet stretch. A wave holding open on a body the player cannot reach,
a delivery that never finished, and a run quietly over all look identical in a
body count, and those three are what tell them apart — `delivered: n` in
particular disables the stall watchdog entirely (`Waves.js` gates the whole of
it on `blocking = this.delivered`), so it is the one field that can report a
stuck run.

**`pack.mjs` is how this got play-tested at all.** Browsers refuse ES modules
from `file://`, so playing the game needed a web server and therefore nobody had
played it. Nothing actually needed one: every module is already an ES module,
three and rapier are vendored, and rapier's WASM is base64 inside its own .js.
So `node tools/pack.mjs out.html` rewrites all 76 modules to name their
dependencies by a bare key and emits each as a `data:` URL in the page's own
import map — the browser's loader then does live bindings, circular imports and
load order exactly as it does on disk. No bundler, and nothing re-implementing
ESM semantics to get subtly wrong. It re-reads every specifier out of its own
output and fails if one is not a key of the map it just built, which is not
decoration: the first version appended `String.replace`'s offset argument to two
thirds of the specifiers, and eleven megabytes of unbootable page looks exactly
like eleven megabytes of working one until a browser opens it.

Two things cannot survive the move and are handled rather than hoped over.
`import.meta.url` inside a `data:` module IS the data: URL, and `new URL(rel,
base)` refuses an opaque path as a base — `main.js` built its track list that
way at module top level, so the page died before the menu drew. And peerjs,
injected at runtime as a `<script src>`, is inlined.

**A THIRD THING COULD NOT, AND FOR FOUR DAYS NOTHING NOTICED.** index.html
carries an inline script that replaces `#boot`'s innerHTML with "Needs a web
server" when `location.protocol === 'file:'`. A packed page IS opened off disk —
that is its whole purpose — so the notice fired on every single-file build, and
it does not merely say the wrong thing: it destroys `#boot-fill` and `#boot-msg`
on the way past, `Menu.progress` reads `.style` of a null, and the boot dies
before `hideBoot()`. The packer had rewritten the WORDS of that notice, which is
why it read as handled to anyone reading pack.mjs; the trigger is a capability
test now, which is what the replacement text already claimed. Every substitution
the packer makes is asserted rather than attempted, for the same reason the
specifier self-check exists: a `String.replace` whose pattern has drifted returns
its input unchanged and says nothing.

**`tools/checks/packed.mjs` is the standing answer.** It packs the tree as it
stands and opens the result the way a player does — real Chromium, a bare
`file://` URL, waits counted in frames — and asserts no page error, the boot bar
intact, the menu up with all seven tabs, and nothing fetched off the page. It is
the only check in the tree that exercises the artifact a player is actually
handed. It needs `node_modules`; see §2.10 before running the gate in a
worktree.

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

## 4.9 The close of V12 — the way home, and the gate

**THE ROUND TRIP IS THE HEADLINE, and it was three separate defects wearing one
complaint.** The player: *"when retreating you don't fly out of the atmosphere,
into space, and back into the hangar — you just get a menu on planet"*, and
*"when you leave the capital ship you now completely skip the entering the
atmosphere and landing portion entirely"*.

1. **There was no leg to space at all.** `Extraction._liftoff` ran straight into
   `_withdrew` → `_finish()`, which puts every passenger back on the ground —
   so a withdrawal ended where it started with a card over it. There is an
   `away` phase now (`AWAY = 8.0`): the ship climbs to `ORBIT_ALT`, `_setSpace`
   drains the sky, the stars come up, and `_placeCapital` grows the hull astern
   until the deck opens on it.
2. **The entry was being SKIPPED BY A KEY THE PLAYER NEVER PRESSED FOR IT.**
   `act('jump')` is a held-state read. One press during the eleven-second deck
   fly-out was still held when the world it flew into came up, and `_orbit`,
   `_entry` and `_transit` each read the same key as their skip. Three
   sequences skipped across two worlds from one press.
3. **So every skip is gone.** All four paths deleted — the three in
   `Extraction.js` and the jump-to-skip block in `DeckFlight.js`, which now
   carries a `NO SKIP` comment where it was. `extraction.mjs`'s skip check is
   INVERTED: it asserts that nothing can be skipped. *"remove the skip option
   entirely I don't want you skipping anything actually."*

**Verified end to end**: `gameOver` calls `bank(stats)` before `enterHangar`, so
the roll the deck reads is already the survivors — you disembark with the men
who lived, not with the men you left with.

**THE FOG WAS THE ONE MEASURED FINDING WORTH REPEATING.** Every level drew its
distance at hue 203–226° whatever sky it stood in — Geonosis authored 26° and
rendered 217°. `Engine.hazeRadiance` sampled the RAW Preetham sky while the
drawn dome and the ambient were both rotated onto the level's authored colour
(`skyProbeTurn`/`skyTurn`). One line, and Geonosis converges on orange, Mustafar
on red, the wood on green. `cel.mjs` had ENCODED the bug by holding the haze to
the same raw sky it was reading — a check that agreed with the defect.

**THE GATE.** Six suites were red from this session's own work and are fixed:
`creator` and `hoods` (the rebuilt head moved the eye sockets on the outline and
the cowl needed the new cranium's radius), `grooming`, `levels-quality` (the
landform skin `Props.fitStaticBoxes` puts on alpine was being read as a floating
deck), `databank` ×2, `command-pvp`, `prefracture-budget`, `force`, `downed` and
`extraction`. Three that were red BEFORE this session are fixed too:
`worn-paint` never seeded the stream it drew Enemies from, `packed` could not
build `--min` because `esbuild` was not installed (it is a devDependency now),
and `fallen` asserted its ledger against the sandbox room's own turnover.

**`levers` IS STILL RED AND IT IS A REAL DEFECT — here is the measurement, so
the next session does not have to take it again.** `tools/_levprobe.mjs`
reproduces it and its header carries the whole finding: geonosis, `runSeed` 9,
ten men in a circle of radius 4, twelve shells, then twenty-five seconds in
which nothing else happens.

    after   alive 5   gathered false
    t+5     alive 2   e1 48m crouch 0.45   e6 40m crouch 0.80
    t+25    alive 2   e1 41m crouch 0.45   e6 19m crouch 0.80

**Two separate things are wrong, and only one of them is navigation.**

**The one who cannot get past something.** Thrown 48 m clear, e1 meets a rock
on the way home and went round it FOREVER: a 77-frame closed circuit between
(40.8, 26.3) and (36.8, 26.5), the same three decimal places every lap, walked
at 4 m/s while `_stuckT` read zero the whole time because he was covering
ground. `_move`'s own note says why nothing there could see it — "a stuck-timer
cannot break a deadlock that is itself moving" — and the cause was that
`_wallSide`, the latch that is supposed to commit a body to one way round, was
cleared 0.3 s after the last touch along with the normal. Off the end of the
rock, turn back, meet the same rock, pick the other side. **`SIDE_HOLD` (4 s)
and `SIDE_JUDGE`/`SIDE_GAIN` (every 2.5 s, has this side bought 1.5 m in the
direction I set out in?) close that**, and `movement` is 11/11 with them: the
exact loop is gone and he makes net ground. He still bounces between 37 and
46 m, so the side he commits to is still not always the way past — that is
what is left of this half.

**The one who is in no hurry, and this is most of why the check is red.** e6 is
on 7 of 46 hp and crouched at 0.80, and he creeps: a wish for a few frames, a
metre of ground, then several seconds with no wish at all. 48 m to 19 m in
twenty-five seconds is **1.16 m/s against a `speed` of 3.8**. He is not stuck,
not broken (`nerve` 1.00) and not obstructed. Whether a badly hurt man should
hurry is a DESIGN question and not a bug: §4.3 asks that a lever buy time
rather than the battle, and at this pace one barrage buys the battle. Decide
that before touching the code — either the crouch-creep lifts once nothing is
shooting, or the check's twenty-five seconds is the wrong window.

Do not start in `lineGathered`. The quorum is reading the field correctly.

---

## 5.000 What THIS session changed — 1–2 Sep: V11, the hub

The player's V11 list (PLAYTEST.md, top entry — every row carries its check).
Read `HANGAR-SPEC.md` "THE ROOM" and "V11 — THE HUB" for what each item is.

**How it was run.** One orchestrator on `Hangar.js`/`DeckFlight.js`/
`DeckLift.js`/`Player.js`/`main.js` and the deck suites, plus eight lanes in
three workflows with disjoint file ownership (UI backdrops · rifle hold + cloth
capes · lived-in paint · deck life · mirror floor · NPC fidelity · deck look),
three at a time. Two lanes (life, paint) died at a usage limit mid-edit and
were relaunched against the committed half-state; both finished.

**What landed, by area (all on the default branch):**

- **The room** — closed on five sides, open forward with the planet in it
  (`SkyDome._placeByPhase` scores the orbit against the aperture's azimuth),
  a lid at `DECK.roof` above the walls with girders/rails/hung fighters under
  it, 160 m wide. `hangar.mjs`'s three shape checks REVERSED: they held "one
  wall, no ceiling, ever" and now hold the closed room by ray on the real
  scene. Then the LOOK was rebuilt against `assets/reference/misc/hangar 1–7`
  (the player asked whether the room he was given was what would be built
  from scratch; it was not): pale steel palette per faction, slab walls with
  pilasters and one vertical strip each, a gallery at 30 m, booths and doors,
  a rounded-rectangle aperture (`DECK.aperture`) with a continuous 3 m rim
  swept as four extruded bands, floor emblem and chevrons gone, thin guide
  lines + 152 recessed markers, a strip-light grid on the ceiling plate, fog
  the colour of the walls, key 1.5 / ambient 0.38. Looked at in 14 frames
  (`tools/_deckshot.mjs`). `DeckMirror.js`: a planar reflection, dark, once a
  frame, tier-gated (`deckmirror`, 11).
- **The floor query.** `world.floorAt(x, z)` — pads (`PADS`, discs; colliders
  are six slabs whose corners sit on the disc), the transport's ramp and bay
  (`DeckFlight.hullFloorAt`), else the heightfield. `Shovable._deckY` reads
  it under the whole body box.
- **The company** — minted from the muster slate on a fresh roll (`Muster`),
  waits in a crowd of 18 at port arms, files in on `fallin` with the real gait
  (a staggered start used to TELEPORT — see the traps), rifles seated by
  `Enemy.seatWeapon`, cloth capes (`attachTrooperCape`), planted against a
  brush under 3.2 m/s, walks round the player and along the pit's kerb.
  `DeckEdit.pickMan` boxes the skeleton. Paint is per-vertex with chipped
  edges (`worn-paint`, 8); droids too; rank paint constant in mesh count.
- **The hub** — `DeckLift.js` (arrival ride, walk out, call, ride out →
  `onDeckLeave` → menu); `DeckFlight.js` (the army's real transport on its
  belly on pad A, ramp resting on the pad, dwell → file up the ramp → seated →
  seal/lift/run/out → `onDeckDeploy` in vacuum → the insertion's own orbit
  phase with the capital ship astern; arrival the other way, `onDeckArrived`
  → the run's card on the deck, the dwell disarmed until you walk away).
  `main.js gameOver` → `homeward` → `enterHangar({card})`. The blade: down as
  you leave the lift, the ignite key lights it, `Hangar.deckBladeTargets`
  offers every `Shovable` body to the solver as a prop whose shatter is the
  shove; `throw` and six powers still refuse (`OFF_THE_DECK`, seven).
- **The deck alive** — `DeckLife.js`/`DeckCast.js`: 15 droids of 5 kinds, 13
  humanoid workers with the real gait and a body each, 2 cranes, 3 sleds, 5
  repair jobs, 3 modelled hulls with colliders (pad A is the flight's, pad B
  the life's third hull), 7 patrol silhouettes, arrivals from 640+ m and
  launches receding to 720 m unfogged (camera far 1008 in the hangar world),
  PA lines through `notify` ≥ 14 s apart. 63 meshes for the lot.
- **NPCs** — `Bodies.js`/`Enemy.js`/`Rig.js`: the right hand is a right hand
  (chirality bug), blasters at reference lengths with hold points, rifles in
  the shoulder pocket with the support hand on the foregrip, B1 snout and
  recessed eyes and stoop, B2 hood/beak and a wrist gun that AIMS, droideka
  copper cowl and a roll above 1.5 m/s, walker ball with its face forward,
  geonosian horns and leaf wings that fold when downed, ARC mantle and
  pistols, sonic blaster green. `reference-fidelity` (15).
- **UI** — no solid backgrounds: the game through an 18% scrim over a live
  world, the menu plate otherwise (`backdrop`, 5; `pause-card`, 10).

**New instruments:** suites `decklift`, `deckflight`, `deckmirror`,
`deckcast`, `worn-paint`, `reference-fidelity`, `backdrop`, `rifle-hold`,
`trooper-cape`; `tools/_mirrorprobe.mjs` (A/B/A mirror cost in the browser);
`tools/_deckshot.mjs` now falls the company in before shooting.

**Numbers worth keeping:** hangar room 289–293 drawn meshes (bound 320) + 199
for 28 men; deck life 63 meshes / 121k tris; browser 1393 draw calls, 2.47 M
tris with the deck dressed at 960×540 low; mirror +11–13% draw calls, one
render a frame, zero recompiles; a painted trooper 33k tris vs 9k bare
(`PAINT.fine/levels/band`); lift cruise 46 m/s; transport hover per model
from its own belly (2.1 m); ramp 26° on the pad.

**Still open at the end of the session:**

- A landed hull sits, spins up and lifts; no taxi to a launch mark.
- MagnaGuard idle staff twirl, the beasts and the enemy Jedi robes were not
  reworked (they already matched); the Phase I colour fins are the paint
  lane's regions, not the body's.
- The painted trooper's triangle cost (above) if the frame budget bites.
- `deckedit.mjs bufferColour` averages painted vertices too; green today
  because the seeded men are xp 0 — skip `_cmdPaint/_cmdMark/_cmdBand` idx if
  rank paint ever lands on men[0].
- `tools/portrait.mjs` needs `instantSpawn: true` on any level that inserts
  from orbit, or every portrait is empty.
- The walls read flat at distance (fog to the wall colour); one more pass
  with a real GPU frame would settle the key/ambient pair.

**Traps this session added or found:**

- **`world.floorAt(x, z)` is the one floor query on the deck.** Pads, the
  transport's ramp and bay (`DeckFlight.hullFloorAt`), else the heightfield.
  `Shovable`, the company's walk and the gait solver's `groundAt` all read it.
  Anything that reads `terrain.height` directly on the deck stands a man 0.45 m
  into a pad. Installed by `dressHangar`, cleared by `HangarDirector.dispose`.
- **A staggered start is a man STANDING.** `stepRowInner` used to fall
  through to the halt when `start` was in the future, which put him on his
  mark at once — so "filing in from the crowd" was one man walking and nine
  teleporting, and every check that timed a walk was timing a teleport. If a
  walk suddenly takes longer than a check allows, that is why.
- **`Box3.setFromObject(root)` on a deck figure includes the hidden L2 skin.**
  `MergedSkin` bakes in the crowd and the mesh keeps its bake-time bounds while
  hidden inside 62 m, so once the men really walked, every man's box ran 50 m
  back to the wall. `DeckEdit.pickMan` boxes visible, non-merged meshes only.
- **"Behind the ramp" is +Z in the HULL's frame.** The parked transport is
  yawed π; adding to world z put the boarding file under the hull. Use
  `DeckFlight.rampSpot(world, back, side)`.
- **The ramp's dwell re-boards an arriving player.** `releasePlayer` sets
  `world._rampArmed = false`; `stepRamp` counts nothing until he has walked
  out of `DEPLOY_RAMP.reach` once.
- **A per-visit fact rides `world.run`, never `settings`.** `controls.mjs`
  demands a default, a reader and a control for every settings key; the
  arrival flag (`run.deckArrival` for a check, `world._deckArrival` from
  main.js) is not a setting and went red twice as one.
- **`spawnPlayer` runs AFTER `L.dress`.** Anything in a level's dress that
  wants the player (the arrival's seat) has to do it on the first frame.
- **Three lanes died at a usage limit mid-edit** (life, paint — relaunched as
  `v11-lanes-c` with the NPC lane). Their half-state was committed as-is
  (`799cbae`) rather than lost; if a suite in `decklife`/`deckcast`/`barracks`
  paint rows is red, look at that lane's report first.

## 5.00 What THIS session changed — 1 Sep: the audit round

The session's own instruction, given three times and the source of the anger
when it was skipped: *"when you're completely done everything to perfection or
at the point of your choosing you need to audit/objectively critique your work
real hard"*, *"audit your work with an objective group who assumes you're a
lazy piece of shit doing trash work"*, and finally *"Did you adversarially
audit everything against what I asked for? everything is in game and working?
all the new systems we made?"* — after which the audits ran, found 44 findings
across three subsystems, and everything below is those findings closed.

**THE PROCESS TRAP, FIRST, because it cost the container.** A workflow fanning
out 13 auditors × 3 judges is ~40 concurrent agents on a 4-core box and the
container restarted. Three at a time is the ceiling. See §2.6b — this is the
same "twelve lanes on one box" law, applied to agents instead of check lanes.
Audits went out as three direct `Agent` calls, in the background, while the
main lane kept working.

**THE OTHER PROCESS TRAP.** The audits were run BEFORE the fixes and only on
one subsystem, then the work shipped. That is not what "audit when you're done"
means, and the user was right to say so. Audit AFTER, on everything, and treat
a green suite as evidence of nothing.

### What the auditors were briefed on — four failure shapes

Every auditor got the same four, and every one of them produced a hit:

1. **A module written, tested and never called by the game.** (`onRunner`,
   `ground-lost`/`post-lost`/`voice-lost`.)
2. **A test fixture standing in for the thing it tests** — a check that drives
   an internal directly and asserts a callback FIRES, one call short of the
   screen. (`reach.9` on the earshot readout; `muster`'s downed clause.)
3. **A stub agreeing with a misspelled caller**, `?.` swallowing a method that
   does not exist on the object. (`engine.sky.configureOrbit` — see §5.0's
   hangar notes.)
4. **Something rescaled while everything measured against it stayed put.**
   (`squadsOf().length`, the plate's typed 0.4, the chip count's `+ 1`.)

Use them again. They are not a checklist of past bugs; they are the four ways
this codebase specifically goes wrong.

### The findings, closed

**The Duel fielded a platoon.** `settings.allies` is a PERSISTED GLOBAL and
`commandConfig` read it with no mode gate, so a player who dialled six troopers
up in the Trial carried six into the Duel: `World.loadLevel` built a
`CommandDirector` for a ladder, six rifles cleared waves 1–4, and the player
could stand still. `MODES.duel.blurb` says "No blasters, no crowd". The menu
made it a one-click lie with a "Take 10 troopers into Duel" button. Fixed by
`MODES.duel.solo` + a gate in `commandConfig`, the same shape as `alwaysVersus`
one field up — which exists because of the *same sticky global* in the *same
function*. Its own note says "a sticky global is exactly the class of bug a
fresh fixture cannot find", and one field down it was right.

**Four readings of the company on screen, four of them stale.**
- The order wheel's Target caption read "All 5 squads" on every army ever
  built and kept reading it with one squad left: `squadsOf()` is padded to
  `SQUAD_SLOTS`, so its length is a count of SLOTS. Its `n <= 1` branch had
  never executed. `liveSquads` existed for exactly this; the wheel was the one
  reader left behind.
- `_squadCount` was written only by `setOrder`, whose only caller is an order
  key — so "2 squads" was refreshed by GIVING AN ORDER and nothing else.
- The roster cache key carried neither `squad` nor `detached`, so detaching a
  man never regrouped the column. **That is twice now that a missing field in
  this key froze a screen** (the first was `heard`). The rule is written beside
  it: if `rosterHtml` reads it, it belongs in the key.
- `summary().post` crossed to the HUD and `grep -c post src/ui/HUD.js` was 0.

**The plate's "shaken" was a typed literal.** `mo < 0.4` against raw morale,
while the rule that refuses an advance is `braveryOf(body) < SHAKEN_AT` (0.30)
over `morale*0.72 + rank/4*0.28`. Measured: a Sergeant refuses below 0.222 and
the plate called him shaken below 0.400; a Commander refuses below 0.028. The
one pre-press fear signal flagged obedient men and stayed quiet about
frightened ones. `reach.14` now walks the morale axis at three rungs, asks the
director through `_ask` and PAINTS THE REAL NAMEPLATE, and holds the two to the
same crossing.

**Seven of nine formations left a dead squad's order on screen for ever.**
`_vacancy` gave a squad's order up only when the order PLANTED, and seven of
the nine are `advance` and plant nothing. `HUD.setOrder` claims to have closed
"the two places nobody was telling this panel about" and `_areaClear` calls
itself a third; this was the fourth and it was the common one.

**"…and they stay there without you" was printed on every plant.** That is the
HOLDS licence talking, and a rank-0 company holds no HOLDS — so a fresh company
was promised it and told "SQUAD 2 GIVES UP THE GROUND" one casualty later.

**The vacancy's three log rows had no reader anywhere in `src/`.** The entire
licence-loss system was a 2.4-second toast in a firefight. They are beats in
the interlude now, below the delegations, reading as their answer.

**The runner was the delivery animation his own comment disclaimed.**
`leashFor` gives him `LEASH_FLOOR` "so he still shoots what walks into him",
and `targetFor` centred that disc on `slotFor(e)` — which for a runner returns
his DESTINATION. A droid on his toes was out of range. Nothing marked him
either: `grep -rn runner src/ui/` was empty.

**`onRunner` was called and wired by nobody** — not declared beside its four
siblings, swallowed by `?.`. Deleted rather than wired, because "a man is
carrying an order" is a STATE that ends when he arrives, dies or times out, and
a fire-once hook cannot say any of those. `summary()` carries it instead.

**Hold ground and Detach had no key.** `registerOrders` builds a row per
FORMATION, so the nine shapes each got a key, a chip, a controls row and a
rebind, and the two verbs that are NOT formations got a wheel slot and nothing
else — unrebindable, on no list a player reads, and unreachable on a phone
(the order wheel is a HELD key and a phone has no button to hold). That is
precisely the door `squadtarget` was pulled out of the wheel to fix, left open
twice. Now `Period` and `Slash`.

**`order()` half-obeyed an index that is not one.** `order('cover', c, 1.7)`
returned true, ordered squad 1 and filed its memory under `'1.7'` — a key
`_formationFor(c, 1)` can never read. `-1` was refused with a message naming
"Squad 0". Truncated at the door now, and NEVER mapped to `null`, because
`null` means the whole army here.

**Two fixtures stood in for what they test.** `_army.mjs` built
`new CommandDirector(w, { pool })` with no mode, so it fell to `'command'` —
`holdTheLine` false, `lineAdvances` false, `downedMen` FALSE — and
`muster.mjs`'s survivors check was asserting about THE LINE against a `downed`
boolean it wrote onto a stub itself. Delete the whole downed mechanic from
`Enemy.js` and it passed. `army(mode)` takes a mode now (default unchanged),
and a second check drives a real `World` on `theline` with a real `Enemy` put
on his back by `Enemy.die` → `_mayGoDown` → `_goDown`, which refuses outright
unless `downedMen` is true — so reaching that state is itself the proof the
mode is the one under test.

**`_supervised` never got the second mouth `_voices` has.** `_voices` measures
reach from the player AND from `c._paceAnchor`, because `_frame` returns the
anchor and walking faster than your own line spends the whole margin in five
seconds (the measurement is in `reach.12`). `_supervised` measured from the
player alone, so the exact walk `out of reach` forgives still bit as `unled` —
the same distance refused under a different word, and the one word with no
remedy attached to it.

**Six typed constants that justify themselves against another constant were
never asked.** `ALONE_NEAR`'s "12 is inside `MORALE.NEAR`'s 14" and
`RUNNER_DELIVER`'s "inside `RELAY_REACH` and outside a body's own leash" are
one-liners nobody had written. `reach.16` writes them. A rationale that names a
number and is not checked against it is a comment that goes stale the day
either number moves — and this file had already paid for one of those.

### Every fix was verified RED

Each new check was run against the code it replaces before being kept. That is
the only thing that separates a check from a decoration, and §2.3b is the
standing rule it enforces. The four proofs on record this session: the wheel
caption, the detach cache key, the shaken literal, and the runner's leash
centre.

### What is NOT closed

- **Squads F12** — three copies of "name or number" (`Command.squadLabel`,
  `Company.squadLabel`, and a third inline in `HUD.rosterHtml`), against a
  comment claiming one reader. They agree today. Drift risk, low.
- **Licence F18** — `Company.appoint`'s `licensed` parameter is asserted by
  its one caller as a hardcoded `true`. Decorative in production; the real
  gate is that no button renders below Sergeant.
- **Muster F8** — `_inbound` is drained only by `recall`, so in a mode that
  never recalls (`waves` and the other four contingent modes) it retains
  Trooper records for ever. Benign today because a landed man has a live body
  and is skipped anyway; a live trap for any future path that clears a body
  without killing the record.
- **`Enemy._pace` does not exist.** Cited as the movement consumer of morale by
  `Morale.js:32`, `Morale.js:109` and `Command.js:9912`. Comment-only.
- The reach system's **design** critique, which the auditor was right about and
  which is not a bug: `unled` is a LICENCE check wearing the same toast as a
  DISTANCE refusal. Reach is legible, continuous and fixable by walking, with a
  runner as the remedy. `unled` is binary, jargon-named, and now has a remedy
  sentence but still no pre-warning. Consider folding it into the standing-order
  confirmation rather than the refusal channel.

### The build audit — and the thing it found that nothing else would have

A third auditor was pointed at THE SHIPPED ARTEFACT rather than at any
subsystem: build it, boot both the packed file and the raw repo in a real
headless Chromium over HTTP, capture every console error in four modes, and
hunt the black-screen class (bare specifiers, case mismatches, absolute paths).

**The black-screen hypothesis was false.** 110 files scanned: zero bare
specifiers, every import relative and case-exact against `readdirSync`, no
importmap in the browser, all 12 `src`/`href` in index.html and both `url()` in
styles.css resolve exact-case, no `<base>` tag so the `/saber2/` subpath is
safe. Rapier's wasm is base64-embedded, so there is no separate fetch. **Raw
repo: zero console errors, zero warnings, zero page errors, zero 404s** across
boot, menu, waves, command, duel and hangar. All four modes render real
gameplay, not a lit canvas.

**What it did find is the one thing no subsystem audit could see.**

**CI HAS BEEN RED FOR 19+ HOURS AND THE SITE SHIPPED IT.** `pages.yml` and
`verify.yml` are INDEPENDENT workflows — a red gate has never blocked a deploy
and still does not. 0 of the last 30 `verify (fast tier)` runs passed, back to
2026-08-31T23:30. **If you change nothing else about the process, know this
one: green Pages does not mean green checks.**

The failure was `tools/checks/movement.mjs`, and it is worth reading as a
specimen. A Command trooper 37.1 m behind an army that walked 35 m — and the
check's WEDGE half PASSED the whole time, which is exactly what hid it. He was
not stuck on anything. **His SLOT never came.** `_coverSite` caches an
ABSOLUTE world point against an epoch: right for the two callers it was written
for (an ordered hunt re-solves on `_coverEpoch`, a man under fire on his own
burst count), and a permanent pin for the third. `careful` — the `holds` trait,
added later — takes the reactive branch with `at = e._fireEpoch`, and a man
nobody has ever shot at has an epoch of 0 for the whole battle. He was pinned
to the first crate he found at spawn, with `cmdSlotDist` 1.1 so `steer` was
satisfied and he simply stopped.

That is failure shape (4) in its purest form — a trait wired into a cache keyed
on something that only moves under fire — and the fix is the function's own
invariant rather than a new key: `_coverSite` only ever moves a slot to a lee
within `hunt` of it, so a cached point further than that from the slot being
solved now is a point it could not have produced. Furthest man 37.1 → 14.8 m.

**AND THE DEPLOYED TREE CARRIED A SECOND COPY OF THE GAME.** `--min`, 12.24 MB,
tracked at the repo root since 2026-08-31, a complete PLAYABLE stale single-file
build, served live at `/saber2/--min`. A botched `node tools/pack.mjs --min`
took the flag as the output filename and `.gitignore` only knew the intended
name (`borz-play.html`). CLAUDE.md forbids exactly this in as many words:
*"That is the only one. No artifacts, no clones, no second copy anywhere."*
With `assets/assets/` — 157 files, 63.9 MB, every one a byte-identical
duplicate referenced by nothing — that was **38% of the deployed tree**. Both
deleted.

**A LESSON FOR THE PACKER.** It stripped `rel="icon"` along with
`rel="preload"`, so every load of the single-file build 404'd on
`/favicon.ico`, which falsified the notice that same build prints about itself
fourteen lines above ("nothing was fetched and nothing can 404"). The
`leftover` guard could not catch it: it only inspects `assets/` paths, and this
was a request for a file the page never named. **A guard that only looks at
paths you wrote cannot see a request the browser makes on its own.**

### The hangar re-audit — five of six fixes hold, and the window points the wrong way

The first hangar audit (§5.0's notes) forced six fixes. A second auditor was
sent to verify each one **by driving the running game**, not by reading the
diff, and to hunt the four failure shapes afresh. Suites: `hangar` 9/9 ·
`deckplay` 10/10 · `decklife` 13/13 · `deckcost` 1/1 · `deck-audio` 25/25 ·
`deckedit` 8/8 — 66 passed, 0 failed, and the report is a demonstration that
66 green checks is not a statement about a room.

**Five fixes VERIFIED REAL, in a browser, off live values:**

| fix | evidence |
|---|---|
| `engine.skyDome.configureOrbit` (was `engine.sky`) | `uOrbit=1`, `domeVisible=true`, `engine.sky.visible=false`; starfield and hull silhouettes render |
| `_pickedLevel` before the dress | `pickedLevel="The Shifting Waste"`, `orbitTerrainSand=0xaa753e` — not the deck's own `0x171b21`. `main.js:528` (`opts.onWorld`) runs before `main.js:662` |
| `DECK.start` spawn | player at `[0,0,-78]`, yaw `3.142` — `HANGAR_LEVEL.start` (`Hangar.js:1286`) read by `World._playerSpawn` |
| `undressDeckAudio` | after `world.unload()`: `_deckAudio=null`, `st.torn=true`. `World.js:1763` → `Hangar.js:1413` → `DeckAudio.js:1143`. **Headless only — the browser leg was never measured.** |
| lip strobes | `world._deckStrobes.spots.length = 51`, one `InstancedMesh` named `lip-strobe`, stepped at `Hangar.js:1421`. Colour delta per frame not measured. |

**AND ONE STILL BROKEN, plus five new findings. In severity order:**

**A — THE PLANET IS BEHIND THE AFT BULKHEAD. HIGH.** Builder
`SkyDome._placeByPhase` (`SkyDome.js:1924`), caller `Hangar.js:1215`. Measured
in a browser: `planetDir = [-0.013, 0.218, -0.976]` — **167.4° off the deck's
forward axis**. The player spawns at z=-78 facing +z and the only opening is
forward; the planet sits over the 58 m aft wall. Reproduced headless for
drifts, mustafar and geonosis: **identical placement every time**, because
`_placeByPhase` optimises ELEVATION ONLY and the deck's sun is fixed. Its own
comment claims the free roll "is spent on getting the disc up out of the deck
and into the aperture" — **the code never looks at azimuth**. The bright ring
in the aperture measures ~4.3° of a 91.5° hFOV; it is not the planet.
`Hangar.js:36` — *"the planet fills a third of the sky"*, the single sentence
the whole room was designed around — has never been true for any theatre. **The
fix that made the window render never checked where the window pointed.**

**B — THE DECK'S CALLSIGN RENAME IS UNREACHABLE. MED-HIGH.** Failure shapes 1
AND 2 together, still live. Builder `DeckEdit.beginNaming` / `typeName` /
`commitName` (`DeckEdit.js:1096`). **Caller: none in `src/`.** `optionsFor`
emits only `mark/band/paint/kit` — no `callsign` notch, so the wheel can never
reach it. `naming(world)` (`DeckEdit.js:1094`) is documented as needing "one
line in `Player.js`'s hosting branch" and has zero occurrences in `Player.js`.
Both checks that appear to cover it do not: one drives `beginNaming`/`typeName`
DIRECTLY (`deckedit.mjs:510-518`), the other compares `EDIT_OPS` to a
source-scrape of `Menu.js` — table against table, no reachability anywhere.

**C — `tools/checks/deckcost.mjs` HAS ZERO ASSERTIONS. MED.** 44 lines, one
check, `grep -c "assert("` → **0**. It cannot fail: a throw inside its `count()`
is caught, returned as the string `THREW …`, and still passes. Compare hangar
36, deckplay 51, decklife 33, deck-audio 138, deckedit 53. This is §2.3b's law
(a check that reads a field nothing writes cannot fail) in its blunt form — a
check that asserts nothing at all.

**D — `ground.orbit`'s lighting half has no reader. LOW-MED.**
`SkyDome._publishOrbit` (`SkyDome.js:1835`) publishes `dir/colour/key/bounce`
explicitly "so a directional standing in for it goes at +dir". Only `.events`
is consumed (`DeckAudio.js:1451`). `lightDeck` hard-aims a directional at
`(0, 150, DECK.lip*0.85)` — light from the FORWARD aperture while the planet
is 167° aft. `Hangar.js:37` "the deck is lit from outside by it" is not
implemented.

**E — `hangar: one wall, and it is behind you` MEASURES THE WRONG OBJECT.
LOW.** `hangar.mjs:376-398` ray-marches `TERRAIN_PRESETS.hangardeck.height`
only. The two rack walls are `physics.addStaticBox` colliders declared in
`deckColliders` and are invisible to it. Its own sibling check already admits
"what closes this one is the rack walls for the aft two-thirds".

**F — THE STALE HEADERS ARE STILL STALE.** This was claimed fixed and is not.
`Hangar.js:26-27` still says "THERE IS ONE WALL AND IT IS BEHIND YOU … 128 m
across" — the deck is 288 (`Terrain.js:719`) and `deckColliders` puts **two
34 m-tall solid rack walls** at x=±48.5…±77.5, z=-97…+68: three walls.
`Hangar.js:32` "field plane 90 m up" — `DECK.roof = 64`. `Hangar.js:297`
repeats both bad numbers. `Terrain.js:699` "only 128 m across".
`Terrain.js:775` "rising 34 m" against `:781` "it is 58 m". `Player.js:759-761`
"`DECK.lip` IS `terrain.half` — 64" (it is 144) and "strobes stand 2.5 m
inside it" (`IN = 3.0`).

**LEADS THE AUDITOR DID NOT GET TO — start here.**

- **`/tmp/deckaudit/a-spawn.png` shows an EMPTY DECK with no troopers in front
  of the player.** The auditor could not tell whether that is real or an
  artifact of the world being paused during that probe — but its second probe
  measured `screens:"playing"` at spawn, which suggests the world does step,
  **which would make the empty deck real. VERIFY THIS FIRST; it is the room's
  whole subject.** The world reports `company: 12`.
- Never measured in a browser: mesh/statics/light/draw-call counts, whether the
  12-man company forms up and is visible from spawn, strobe colour delta over
  15 frames, `_deckAudio` state after `#btn-quit`.
- `DECK_ORDERS`/`deckCommand`/`world.orders` → `HUD.js:2759` and `main.js:2445`
  are wired on inspection and **never driven in a browser**.
- `world._deckLife` is not nulled on unload (`Hangar.js:1413` nulls only
  `_deckAudio`). Harmless while `main.js:960` drops the world; a second
  re-dress hazard.
- **No check covers finding 2 at all.** Headless `bootWorld` still reports
  `orbitLevel="The Flight Deck"` — the fix is real in a browser and invisible
  to the suite, so nothing would catch it regressing.

**The auditor's blunt verdict.** Worth walking into, barely — but not for the
reason the file claims: what renders is a good dark canyon with a starfield at
the end of it, not "the view is the room". Best thing in it: `DeckAudio.js`,
25 checks and 138 assertions all driven, and the −12.1 dB A-weighted pressure
change from spawn to lip is the one thing in the room that is unambiguously
real and unambiguously felt. Worst: the planet is 167° behind you, over the
only solid wall.

### The deck's company path — re-kit yes, rename no, and the inspect key is bullet time

A second auditor drove the inspect-and-customise chain through the REAL input
(`Player._readInput`), not through the check helpers. Suites at HEAD: decklife
13/13 · deck-audio 25/25 · deckplay 10/10 · deckcost 1/1 (0 assertions) ·
deckedit 8/8 · barracks 35/35 · appearance 5/5 · hangar 9/9 · faction 9/9 ·
**company 27/1 FAILED** (see G below — that one was mine and is now fixed).

**THE HEADLINE, MEASURED.** Menu → deck is 2 clicks. The line forms up 12/12 at
13 s in one rank at z=-48. Walking 30 m to 2.4 m is one key held for 6.0 s. One
press of Mouse3 holds `CT-1198` — he turns, salutes, and steps 0.55 m out of
the rank. One wheel notch plus 0.22 s writes `{"mark":"blood"}` to memory AND
to disk via `Company.load`. **Five discrete inputs for the nearest option.** A
paint colour is notch 19; a pauldron is **notch 67 of 90**. Renaming is
impossible.

**WHAT IS GENUINELY REAL, measured:** the men are not T-posed (hands 0.19/0.21 m
lateral against ~0.7 for a T-pose); idle micro-motion exists but is tiny (head
16 mm over 10 s); faction resolution is correct (`sith → separatist`, faction
9/9); the browser deck runs 930 render calls / 811 geometries / 51 textures at
12 men; `world._deckAudio` is 41 keys with a running context and is null after
unload; and `buildFigure` reads the saved `look`, so the deck figure is a true
preview of the field body.

**THE FINDINGS, in severity order:**

**F5 — THE INSPECT KEY IS ALSO BULLET TIME AND EATS THE FORCE BAR. HIGH.**
Mouse3 is `focus`, `hold: true`. `World.js:3779-3781` gates the FocusSystem on
`P && P.alive && P.isLocal` — **not on `hosting`** — and `Focus.js:90` has no
hostile requirement. Measured on a real hangar world: idle `focus.scale 1.000`,
force 125.0 → **hold 1.5 s: scale 0.180, force 80.0** → hold 4.5 s: force
**7.9 of 125**. `Player.js:3843-3852` asserts the opposite in prose ("on a deck
there is no time to slow") and `OFF_THE_DECK` refuses eight powers but not this
one. So the one gesture the room is built around drains the bar and slows time
to a fifth while you look at a man.

**F1 — RENAME IS UNREACHABLE. HIGH.** Shape (1). Builder `DeckEdit.js:1100
naming` / `:1102 beginNaming` / `:1113 typeName`. **Caller: none in `src/`.**
All 59 actions in `Bindings.ACTIONS` driven through the real input on a held
man → `armedNaming: NONE`. `optionsFor()` returns **90 options, 0 of op
`callsign`**, while `EDIT_OPS` lists it. `DeckEdit.js:1093-1095` says the guard
is "one line in `Player.js`'s hosting branch"; `Player.js:3858-3859` has only
`focusKey` and `wheelEdit`. (Mitigated: `HANGAR-SPEC.md:151` marks it `~`.)

**F2 — THE `deckedit` SUITE PROVES NONE OF THE WIRING. HIGH (process).** Shape
(2), in its purest form yet. `deckedit.mjs:114-119` calls
`Edit.stepDeckEdit(world, dt)` ITSELF after `world.update`; `:271` calls
`Edit.focusKey(world)` directly; `:510` `Edit.beginNaming` directly. The real
callers — `Player.js:3858` and `Hangar.js:1430` — are touched by no check.
**Delete both and all 8 checks stay green**, because `stepDeckEdit`'s
`steppedAt === c.t` guard hides the double call.

**F8 — THE COMPANY IS NEVER TORN DOWN. MEDIUM.** `Hangar.js:1617-1622` does
`world.scene.add(fig.root)` and never pushes to `world.statics`;
`HangarDirector.dispose()` frees only `undressDeckAudio` and `row.shove`;
`World.js` never mentions `_company`, `_deckEdit` or `_deckLife`. Measured
after `world.unload()`: `_deckAudio` null ✓, haze gone ✓, but **845 scene
objects remain, 60 skinned meshes, 12 of 12 company figures still parented**,
geometries and materials never disposed.

**F9 — A DELIBERATE WHEEL SCROLL WRITES THE SAVE ON EVERY NOTCH. MEDIUM.**
`WHEEL_DWELL = 0.22` committed at `DeckEdit.js:1006`. Measured: **10 notches
0.35 s apart → 10 writes** (10 `Company.dress` saves plus 10 washes/rebuilds);
10 notches in consecutive frames → 1 write. Kit notches call `rebuildRow` — a
full `buildFigure` + `mergeFigure` each. Reaching "Pauldron Left" slowly costs
**67 saves, ~48 paint washes, ~20 body rebuilds**. The comment at `:181-190`
claims this is prevented.

**F6 — THE DECK'S ORDER WHEEL CARRIES 3 DEAD SLOTS AND 2 LYING CAPTIONS.
MEDIUM.** Shape (3). On the shipped `deckCommand` adapter (`Hangar.js:1900`),
`hold`, `cycleSquad`, `detachNearest`, `liveSquads`, `nearestTrooper` and
`squadLabel` are **all `undefined`**, and `HUD.js:2783-2785` / `main.js:2455`
`?.` them away. `main.js:2460` sends `order('hold')`, an id `DECK_ORDERS` does
not have. Driving `deckCommand.order(id)` with all 7 formation ids plus
`'hold'`: **all return false and say nothing**, while each still writes
`cmd.formation`, which `HUD.js:916` reads to light a slot — so the wheel lights
none. `HUD.js:874` reads `n = 0` and says "One squad. Everything you order goes
to it." with 2–4 squads standing; `HUD.js:886` says "Nobody of yours is near
enough" with 12 men in front of you. **Note: the wheel-caption and
`WHEEL_EXTRAS` fixes committed this session are the fight's wheel; this is the
DECK's adapter and it is a separate object.**

**F4 — THE RACK HALF-BEAM IS FOUR INDEPENDENT COPIES OF 56. MEDIUM.** Shape
(4), latent. `Hangar.js:129 wall: 56` (exported, "One name, exported, and the
local is gone") · `DeckLife.js:201 const WALL = DECK.lip * (7/18)` ·
`DeckAudio.js:328 GEOM.rack = 56/144` · and the guard at `decklife.mjs:383` is
`Math.abs(wall - 56) < 0.01` — **a literal**. All three expressions equal 56.0
today. Move `DECK.wall` to 60: Hangar builds at ±60, DeckLife sites props at
±56, DeckAudio horns at ±56, **and the guard still passes**. Its own comment
("Hangar.js does not export it") is false at `Hangar.js:129`.

**F10 — THE DECK NAMES A MAN AND TELLS YOU NOTHING ELSE. MEDIUM.**
`DeckEdit.js:1175 nameOf` gives `CT-1198 "Boil"` and a one-line note.
`Company.js:1176 dossier` returns rank, role, service, kills, wounds, grounds —
10 rows plus history — **none of it on the deck**. The memorial is anonymous
glowing bars with no names. Zero discoverability: no prompt anywhere, and
Mouse3's only label is "Focus (slow time)".

**F11 — ONLY 24 OF 60 MEN CAN EVER STAND ON THE DECK. LOW.**
`Hangar.js:1692 MAX_ON_DECK = 24` against `Company.js:180 CAP = 60`. Men 25–60
are uninspectable.

**G — AND ONE RED CHECK THAT WAS THIS SESSION'S OWN.** `company.mjs:906`
asserted that every non-army, non-dojo mode gets a contingent of 5.
`MODES.duel.solo` + the `commandConfig` gate (commit `cc9ac74`) make the duel
0, and this second reader did not move with the fix — the exact shape the fix
itself was about. It now reads `dojo || solo` off the row, asserts both
directions, and asserts that something declares `solo` so the exemption cannot
go vacuous. company 28/28. **The lesson: when you add a flag to the mode table,
grep for every reader of its sibling flags before you commit.**

**THE MOST IMPORTANT OPEN THREAD — 4a, the persistence gap.** The WRITE side is
proven: dialling `CT-7200` to `{"mark":"blood","paint":{"color":"bone"},
"kit":{"pauldron":"L"}}` on the deck, `leaveDeck` reports 3 edits, and
`Company.load('republic')` returns that look **on disk**. The READ side is not.
On a booted `command`/geonosis world `CommandDirector.roster.all` held 10 men
including CT-7200, and **every entry printed `NO-LOOK`**. Zero bodies had
deployed in that headless boot, so it is unproven either way. **Chase
`Command.js:5830 _musterVeterans` → `roster.enlistRecord(m)` and find out
whether `m.look` survives into the Trooper record.** `Muster.js:109` sets
`look: Company.saneLook(...)` — but that is the muster SLATE path, not
`_musterVeterans`. If `enlistRecord` drops `look`, then `Command.js:6732
const worn = t.look ? … : null` is always null and **nothing dressed on the
deck ever reaches a body**, which would make the whole customisation feature
cosmetic-in-the-hangar-only. This is the single highest-value thing to check
next.

**Other leads, not conclusions:**
- The browser probe `scratchpad/fast.mjs` reached stage 04 of 11. Stages 10–11
  measure `renderer.info.memory` across `leaveHangar` (F8 in GPU terms) and
  drive a real `#btn-deploy` to read a field body (4a). **Its stage-04 bone
  probe is void** — this project's rig uses plain `Object3D`, not `isBone`; use
  `fig.rig.bones` / `rig.worldPos(name)`.
- `deckOrder` resets `c.t = 0` (`Hangar.js:1966/1979`) on Dismissed and Fall
  in, and `st.pending.at`, `row.man.turn.at` and `saluteAt` are all on that
  clock — so a dialled edit would never commit and a held man would stop
  looking at you. Not driven.
- `DeckAudio.js:1101-1106` — the 4th ternary clause repeats the 2nd, so the
  final branch is unreachable. Cosmetic.
- `Bindings.js:350` still says "T focus" after KeyT moved to `orderwheel`.
- All 25 `deck-audio` checks run against a hand-written `OfflineCtx`
  (`_offline-audio.mjs`), not a browser — the browser leg was confirmed by hand
  this once and nothing holds it.

### WHERE THIS SESSION STOPPED — read this first if you are picking it up

**Everything is on the default branch and pushed. THE PLAY LINK HAS THIS WORK.**
`claude/lightsaber-combat-game-lxw391` and
`claude/troop-management-redesign-5vovlm` both carry it; Pages deployed and
succeeded. The single-file build was packed and sent.

    cc9ac74  the Duel's contingent
    2abd1ba  the four stale readings + the shaken threshold
    2c4b8d1  the stale squad order, the HOLDS lie, the vacancy in the report
    91156f5  the runner, and keys for Hold ground and Detach
    a2cc1df  the two stand-in fixtures, _supervised's second mouth, reach.16
    f93b5ac  handoff correction
    7351ef3  the cover-cache pin (19 h of red CI), --min, assets/assets, the packer
    c14ebb0  the build audit's handoff section
    (+ the company.mjs fix and this section)

**GREEN AT THE END:** command 49 · licence 9 · squads 13 · reach 16 · muster 21
· movement 11 · controls 46 · company 28 · dig-in 6 · objectives 10 · report 18
· session 11 · menu 31 · modes 4 · claims 16 · spectacle 19 · touch 16 ·
hud-events 30 · hangar 9 · deckplay 10 · decklife 13 · deck-audio 25 · deckedit
8 · deckcost 1 · barracks 35 · appearance 5 · faction 9.

**NOT GREEN, AND IT IS THE ONE THING TO DO FIRST:**

1. **`theline` was never run to completion.** It timed out at 900 s three
   times, every time on a box carrying headless-Chromium auditors — load
   average 11 on 4 cores. And the reason it stayed loaded is **§2.6e**: both
   auditors had detached their probes with `nohup … &`, so the browsers
   outlived the agents by twenty minutes with nothing in the session saying so.
   Read that section before you read a slow suite as a slow suite.
   **`theline` is not red; it never finished.** It
   is also the suite most likely to be moved by `_supervised`'s second mouth
   (`c._paceAnchor`), so run it on a QUIET box before trusting `a2cc1df`:

       node --import ./tools/register.mjs tools/_one.mjs theline

   If red, `_supervised` in `src/game/Command.js` is where to look. The change
   makes supervision easier to satisfy, never harder, so a red there is a check
   asserting a refusal that no longer happens.

2. **No full `tools/verify.mjs` run since any of this.** Over an hour. §2.6d
   and §2.7 are the traps.

**THE HIGHEST-VALUE UNANSWERED QUESTION** is 4a in the deck-company section
above: does anything a player dresses on the hangar deck ever reach a field
body? The write side is proven to disk; the read side printed `NO-LOOK` for
every man on a booted Command world. If `enlistRecord` drops `look`, the whole
customisation feature is hangar-only. That is one afternoon's answer and it
decides whether a shipped system is real.

**THEN, IN ORDER, from the three audits above:**

- the planet at 167° behind the aft wall (hangar A, HIGH) — `_placeByPhase`
  optimises elevation and never looks at azimuth;
- Mouse3 on the deck being bullet time that drains the Force bar (deck F5,
  HIGH) — `World.js:3779` gates the FocusSystem on `isLocal` and not on
  `hosting`;
- the unreachable rename (deck F1) and the suite that proves none of its wiring
  (deck F2);
- `deckcost.mjs` having zero assertions (hangar C / deck F3);
- the deck's own order wheel, three dead slots and two lying captions (deck F6)
  — note this is a DIFFERENT object from the fight's wheel fixed this session;
- the company never torn down on unload, 845 objects (deck F8);
- the save written on every wheel notch, 67 saves to reach a pauldron (deck F9);
- the four independent copies of 56 with a literal for a guard (deck F4);
- and the stale headers, which were claimed fixed and are not (hangar F).

**PROCESS LESSONS WORTH MORE THAN ANY OF IT:**

1. **~40 concurrent agents took the container down.** Three is the ceiling.
   And three is not enough if their work outlives them — see §2.6e.
2. **An audit run BEFORE the fixes, on one subsystem, is not an audit.**
3. **Green Pages is not green checks** — `pages.yml` and `verify.yml` are
   independent, and the site shipped a red gate for 19 hours.
4. **When you add a flag to the mode table, grep for every reader of its
   sibling flags before you commit** — `MODES.duel.solo` turned `company.mjs`
   red, which is the same "second reader left behind" shape the flag was added
   to fix.

---

## 5.0 What the session before this one changed — 31 Aug: the barracks

Driven by one message, and the message was a verdict: *"I have told Opus and
you (Fable) at times to build a highly interactive and expansive troop
management section and as of just a couple minutes ago you told me it was
done. I tried it, and it's still fucking nothing."* The full text and the
marks table are in PLAYTEST.md, 31 Aug. The finding under it is §6.6's again,
for the third session running: the persistence engine, dossiers, attributes
and the two cosmetic editors all existed — and for a player who dies or quits
every run, the roll was empty forever, so all of it stood behind a door that
never opened.

### The muster slate — src/game/Muster.js, saber.muster.v1

The fresh half of the next deployment is real named men BEFORE the run. Read
the file's header before touching it; the two load-bearing absences are:

- **No attributes in the store, ever.** A recruit's numbers are rolled at
  muster by the Trooper constructor's hash of the RUN seed — which does not
  exist at menu time — so there is nothing to scout, reroll, or hand-edit.
  `barracks: the slate holds no numbers and cannot be made to` proves it at
  four doors.
- **No entropy.** The salt is `saltOf(company)` — a hash of runs/lost/
  headcount — so deleting the store re-mints the SAME men and every banked
  run moves the slate. `Date.now`/`Math.random` appear nowhere.

`Muster.lineup(plan, company, {versus})` is the ONE resolver of who deploys:
veterans in `fieldable` order, recruits behind, picks honoured, capped at the
plan's want. main.js `veteransToField` fields it, the Taking-in list prints
it, the roll rows tag from it, the stage stands it. The versus gate is
decided from SETTINGS at deploy time (`Muster.versusPlanned`), never the
director's flag — `standDownMeeting` clears that flag mid-run and the run
then banks, which is why "versus never banks" was not a safe premise; recruit
exclusion at lineup time is the actual safety. `Muster.consume` runs in
main.js's deploy() strictly after `buildWorld` resolves, on the cached
fielded-recruit names only.

### The tab: three columns, and doors that close

`#company-list` keeps its exact old contract (seven company.mjs censuses read
it); recruit rows live in the SIBLING `#company-muster`. The middle column is
the parade ground: a second WebGLRenderer (deliberately not a refactor of
`_startPreview` — preview.mjs pins that source), lazy behind the tab click,
render-on-demand (a clean frame costs one boolean), stopped by `hideMenu`
and the tab switch, restaged by `showMenu`. Bodies are `ARCHETYPES[].build`
+ `bodyOptsFor`; paint is `CommandDirector.prototype.repaint/markUp/bandUp/
scorchUp` called on stubs — company.mjs's own proof-of-paint trick, promoted
to production. Deselect works four ways (click-again, Escape, Back links,
stale-key self-invalidation); the toggle lives in the ROW CLICK handler, not
in `_showCompany`, because tab re-entry and the edit-rewire path re-show the
held key and must not un-show it.

### What the record owed its men

`Trooper.wounds` had NO writer anywhere — declared, persisted, displayed,
never incremented. `Enemy._getUpFromDown` writes it now; `scorchUp` wears it
as chest scars. Fallen records keep the callsign and gain killer + minute
(from `stats.roll`, matched by designation prefix off the DISPLAY name, `at`
converted from seconds). `keep()` finally reads `opts.ended` (via
`storyLine`'s "held to the end") and writes `c.honours` — overwritten per
fold, capped at 6, empty on a wipe, rendered by `honoursOf`. `look` grew
`band` (forearm, same MARKS palette) — the dress pin in company.mjs was
amended to `band,callsign,mark` in the same pass, with a twin pin on
`Muster.dressRecruit`.

### The gate, and one bug the new suite caught

tools/checks/barracks.mjs: 19 checks, ~8 s, full tier. Writing it caught a
real defect before any player did: `lineup` resolved picks against the
want-sliced fieldable PREFIX, so "field him next run" on a reserve veteran
wrote a pick the resolver silently dropped. Fixed (the candidate map spans
the whole roll; the want cap does the bounding) and pinned by
`barracks: a reserve veteran can be fielded by name`.

Fast tier: 383/384 — the one red (`movement.mjs`, the 35 m Geonosis line
navigation check) is red on the UNMODIFIED base commit too, verified in a
clean worktree at b47308a; it is this box's, or this branch's, pre-existing
condition and no part of the barracks. company 28/28, barracks 19/19, menu
31/31, attributes 29/29, skirmish 23/23, preview 12/12, databank 8/8.
smoke: clean boot, deploy, combat, zero console errors.

### Still latent, on purpose, and known

- The two-copies-of-look clobber (Company.js:541 — a mid-run dress is
  reverted at fold because the live Trooper's look wins) is unchanged and
  untriggered: the tab is menu-only. A future mid-run barracks lands on it.
- A named-but-unfielded recruit's look dies with the salt when the company
  moves — stated in Muster.ensure's own comment. The muster moved on.
- A designation evicted off `FALLEN_KEEP`'s forty can be re-minted onto a
  recruit — accepted, same reuse `designate` itself allows.

## 5.0a What the session before this one changed — 30–31 Aug

Driven entirely by playtest messages, again, and the shape of the round is worth
more than the list: **five of the seven items were features that already existed
and could not be reached.** Not one of them was a missing mechanic. §6.6's first
bucket — a thing that exists and is broken beats a thing that exists and cannot
be reached beats a thing that does not exist — held for all five.

### The company: three defects, one system

The player: *"we get in the extraction ship and go to the next map, at some point
the troops that got on were cleared off the ship and a new set of troops came in…
the promoted guy wasn't in the game anymore but he still was on the troop list"*
and, separately, *"I finished a skirmish run and when I was back at the main menu
and went to the troop tab I could only see a list of fallen troops, nothing about
the troops that had just survived."*

1. **THE LINE DID NOT CROSS THE MAP.** `World.loadLevel` builds a *new*
   `CommandDirector` — every ground change goes through it — and that
   constructor ends on `_musterOpening()`. So the incoming ground raised a fresh
   army while the outgoing roll, ranks and casualty list and all, went with the
   director that owned it. `_beforeRotate` recalls the army first, which is what
   keeps twelve withdrawals from being twelve deaths, and that recall had been
   preserving records for a roster nobody carried. `runCarry` carries them now
   (`carry.line`) and `CommandDirector.reinstate` puts them on the incoming roll
   *before* either branch tops it up.

   **The `Trooper` objects themselves move, not records of them.** There is a
   record round-trip in Command.js already — `enlistRecord`, the door a *saved*
   man comes back through — and it is the wrong tool twice over inside one run:
   it is a field list, so anything added to a man tomorrow is silently dropped
   on every crossing, and a man crossing a ground has not been serialised, so
   there is nothing to reconstruct. `CommandRoster.adopt` claims the
   designation, cuts `body`, clears the three fight-is-over flags, and is done.

2. **WINNING STRUCK THE WHOLE ROLL OFF.** `World.manifest` had exactly one
   writer, `_endWithdrawal`, and `main.js`'s `bank()` reads it as "who came
   home" — so a run that ended any other way handed `Company.keep` an EMPTY
   list with `deployed: roster.all` under it, and keep's rule for a man who went
   out and is not on the manifest is that he is dead. **Every won skirmish
   executed the company.** `World.sealManifest` is the sentence — the
   withdrawal is how you leave a ground you do *not* hold; a battle you won is a
   ground nobody has to be extracted from — and both endings that can be won
   call it. A wipe and a walk-out still keep nobody, deliberately, and
   `company.mjs` still says of itself that it is the check that goes red the day
   a bad run is softened.

3. **THE ROLL DID NOT SAY WHO WAS GOING OUT.** The *Taking in* page named them
   in full and always did; the roll column showed sixty men with no line drawn
   where the muster stops. `musterPlan` is called, not restated.

`tools/checks/skirmish.mjs` gained three checks: the crossing (asserted on
designations and rank, because ten men crossing and ten strangers arriving are
the same number), the two verdicts, and **the end-to-end nobody had** — win,
`keep`, `fieldable`, `_musterVeterans`, and the promoted man still a corporal on
the next line. Four green units with a defect in the joins is exactly the shape
the player hit.

### What was already built and simply invisible

*"wouldn't it be interesting if you wanted to pre-name your troops… you should
be able to even customize certain cosmetic parts of your troops before battle."*

Both shipped. Company tab → a man → **Callsign** (14 chars, overrides the earned
nickname) and **Mark** (eight colours, painted low on the legs by `enlistBody`
→ `markUp`, so it is on the body at forty metres). Both write through
`Company.dress`, which `company.mjs` holds to exactly those two fields — *"a
roster screen that can edit anything else is a cheat panel"*. Neither could be
reached because the roll was always empty. **Fix the reachability defect before
building the feature somebody is describing; they may be describing what you
have.**

### The gate: three flakes, and one of them was a lie about a length

None was a defect in the game. All three were the harness measuring something it
had not pinned.

- **`_shared.mjs` now pins `seedWorld` and `seedScenery`.** World.js exported
  `seedWorld` *for this boundary* and nothing ever called it; Scenery's `rng`
  was private and sat at the top of this file's own "what is still not covered"
  list. So two of the game's streams were restored between suites and two ran
  free. `theline.19`, whose entire subject is how many minutes a sitting takes,
  read **15.0, 4.5 and 2.7 minutes on one build**. Scatter is cover and cover is
  how long a firefight takes. `undertaker`'s felled-trunk clause was the same
  cause wearing different words — a log at the kill plane, green alone, red in
  the run.
- **`graves`' own-marker arm compared man 0 across two fixtures**, which is two
  draws from the roster stream. Squad leaders carry their own morale terms and
  sit far below their privates (0.343 and 0.286 against 0.840 on this fixture,
  with no grave on the ground at all), so *whether man 0 was one* decided the
  reading. It reads `_graveT` inside one line now, which is the mechanism.
- **`command-pvp` pumps until fire has crossed the wire**, instead of for a
  typed 20 seconds, so its premise stops depending on which second the first
  rifle goes off.

### …and `theline.19` was not measuring what it said

Worth its own heading, because it is the best instrument lesson of the round and
it survived four separate attempts to fix it as a flake.

The check drives a whole Raid to a verdict **"with the army held unkillable"**
and reports the wall clock as a FLOOR. It was not holding the army unkillable.
It topped every trooper's health up once a frame, which is not the same thing:
a body taken from full to zero *between* two of those lines is dead before the
next one runs, and in THE LINE a wiped army ends the run. So on some runs it was
not timing a Raid at all — it was timing how long the line lasted, which is a
different quantity and a far more chaotic one. Measured, same fixture, same
predecessor, two runs of one build: **3.2 minutes and 15.0.**

`Enemy.damage` is the one door every bolt, blade and blast ends at, so refusing
it is the whole hold — re-applied each frame off a flag on the body, because an
area boundary rebuilds every body with the class method again.

**A premise stated in a comment is not a premise the code keeps.** Both of this
round's harness fixes are that sentence: `command-pvp` asserts its premise and
failed honestly when it stopped being true; `theline.19` asserted a number while
its own premise quietly stopped holding, and reported the number.

With the hold real, `SESSION_PLANS.raid.minutes` moved **10–15 → 12–20**, which
is the honest half of the pair the check itself offers. A Raid is eight waves
ending on the heaviest ground in the game; the floor is past fifteen minutes and
a played sitting is longer. The other half — making a Raid genuinely short by
cutting waves out of it — is a difficulty re-tune for every player of the mode
and is left as a stated balance call. **The Push and the Grind have never been
driven end to end, so their bands are still projections.**

### What is still open

- **The Push (18–25) and the Grind (30–45) are unmeasured.** `theline.19` drives
  the Raid because it is the only plan cheap enough to sit in a gate. A Push at
  three engagements floored at 45.7 minutes once, before the tuning that fixed
  it, and nothing has re-driven it since.
- **A Raid may simply be too long for its name.** See above; the card is honest
  now and the mode is unchanged.
- Scenery's stream is pinned but `ground.clock`/`_scarAt` and the wave stream
  still are not — the two exclusions in `_shared.mjs`'s list have their reasons
  written beside them.

## 5.0b What the session before this one changed — 26 Aug

Driven entirely by one playtest message. Every item below was reported by the
player, and three of them had been marked done in `PLAYTEST.md` and were not.
That log's marks are now exclusive: a tick means BUILT and a named check fails
without it. Investigation gets its own mark and can never be a tick.

### The three that were falsely ticked

- **The gun emplacement** was still on every mode a week after "✅ gone".
  `src/game/Emplacement.js`, 996 lines, one call site in Geonosis's
  `magazine()`. All three of the player's complaints were literally true and
  none were bugs: `update()` opened with `if (!this.world?.command) return;` so
  it never fired outside the army modes; `toughness`/`hp` were `Infinity` and
  `damage()` returned false, deliberately; and it never called `addStatic`, so
  an 11.6 m tower had **no collider at all**. Deleted with its 703-line suite
  and its bench. `src/game/Armour.js` takes its job — one walking OG-9 a wave,
  free to the threat budget for the levy's reason, because the gun was 35–43%
  of all damage onto the player's named line and was off the ledger.
- **"Command mode has no enemies"** was closed as *not reproduced, needs one
  fact from the player*. It reproduces in the first pass of a browser sweep of
  all nine modes. THREE separate causes, all real:
  1. the insertion flight gated the wave director for 28 s (`World.js`), while
     the HUD already printed the full count;
  2. Geonosis had no `ARRIVAL_BY_TERRAIN` entry — and three of that table's
     five keys named levels that no longer exist — so 100% of hostiles marched
     in from 139–159 m, past the 137.8 m cut where a body stops drawing its own
     outline, in 50% fog, off a 42 m minimap. Born invisible;
  3. **Command with THE MEETING ticked composes no wave at all.** A persisted
     global, and nothing checked that a second commander exists. "0 HOSTILES
     LEFT" forever. The player said "it was in command mode not versus" — right
     about the mode; the versus flag was on underneath and said nothing.
- **"Where are the giant battles"** was ticked *answered* on a row whose own
  text says "you cannot SEE it… zero are inside the camera frustum". Now
  `src/game/Mass.js` + the `thefront` mode: **480 men, 240 a side, laid 6
  frames after you land, all of them in frame.**

### The mass tier, and what it cost

Real bodies cost ~0.13 ms each: 26 → 6.4 ms, 200 → 25.5, 320 → 42.8. So
hundreds-vs-hundreds as real bodies is not affordable and never was. A `Rank`
is 20 men simulated as one entity and drawn as cohort instances.

    320 men     5.75 ms sim   against 42.8 ms for the same count of real bodies
    draw calls  855 → 877     +22 for 320 men, 0.069 a man
    triangles   807k → 4.96M  +4.15M, and this is the honest cost

13k triangles a man is `MergedSkin` at full density — it merges, it does not
decimate, because the rung it was built for is forty bodies. Fine on a GPU and
the first thing to cut if it ever needs to be cheaper.

**THE GROUND WAS DECIDING THE BATTLE.** `layBattle` placed its anchors at fixed
distances and never asked whether the two lines could see each other:

    real terrain    122 v 202    hit rates 3.4% and 7.4%
    flat ground     225 v 239    16 casualties in total

Fire volume was near-equal, so it was neither damage nor cadence — the enemy
line stood 30 m higher. Sampling the ground along the chosen bearing showed
geonosis is flat to 200 m and then climbs (`250m:3 · 275m:10 · 300m:25`): the
centre was always fine, and a 192 m-wide frontage at 250 m reaches into the
hills **with its flanks**. Fixed by `seatPair`, by scoring the bearing on the
PAIR and not just the viewer, and by bringing the opening `gap` from 150 to 90.
Nothing is lost by that: `STAND_OFF` is 55, so the lines walk toward each other
and fight at fifty-five whatever they opened at. Now **135 v 149, losses 105
against 91**.

### THE DOOR THAT MADE THE WHOLE ATTRIBUTE SYSTEM ORNAMENTAL

The best single finding of the session, and an adversarial verifier found it by
refusing to believe a claim. `CommandRoster.enlistRecord` calls itself *"the one
door a saved roll comes back through"* and passed **no `attrs`, no `traits`, no
`kind`** to the `Trooper` constructor. Every veteran was re-rolled at muster:

    stored   traits ['devoted','bonded']  bond 65  nerve 48
    fielded  traits ['devoted']           bond 49  nerve 62

It hid because the re-roll is a hash of who he is, so it gives back the same
BASE man and nothing looked wrong. What it cannot give back is anything that
happened to him since. So the ten attributes and 22 traits shipped the session
before **never reached the field**, `shedTraits` was correct code on an
unreachable path, and "Green wears off" was a promise nothing kept.

The check hangs a trait the muster pool CANNOT DEAL, because comparing stored
against fielded passes on the broken build.

### The rest

- **Stasis no longer freezes people**, on the player's word. Worth recording
  why it read as a bug: `_updateStasis` re-centres the field on your chest every
  frame and re-sweeps, so it is a bubble you CARRY and walking forward arrested
  men who were never in the cast. Nine checks asserted the old behaviour; one
  replaces them, pointed the other way — five men in a live field walk 1.4–7.3 m
  and keep shooting.
- **The withdraw ring exists.** `World`'s source claimed for builds that the HUD
  filled a ring against `withdrawHold`. **Nothing ever read the field.** The one
  input that ends the run had no feedback until it fired.
- **Ally mend was unfindable by construction.** It has worked for a long time
  and the HUD printed `WOUNDED ALLY` — but only while a wounded man was inside
  the AIM CONE, which in a firefight is where the enemy is. `nearestWounded` is
  the same question with the cone off. The check asserts THE GAP: a hurt man
  6 m behind you must be found by one test and refused by the other.
- **Order keys discarded your squad selection** — pick "2nd Squad" on the wheel,
  press a formation key, and it silently ordered all five.
- **The dead stay.** A flat 40-second timer was disposing corpses underneath the
  budget, and the record was spliced out with no lay: a minute after a fight the
  field held NOTHING. The nineteen lost per 894 deaths were not random — in a
  big fight the budget sinks almost everybody early, so the timer took the ones
  still INSIDE it: the nearest, freshest and most in front of you. Cost of
  keeping all of them: **520 figures at 0.93 ms against 6 figures at 0.96 ms.**
- **`openFront` lived in `main.js`'s deploy path**, so the mode's battle existed
  only for that one screen — headless boots and co-op clients got none. Armed in
  `World.loadLevel` now, beside `objectives` and `fireMissions`. The check that
  guarded it was a SOURCE SCAN pinned to `main.js` and moving the call turned it
  red: a check that fails when the code gets better is testing the wrong thing.

### What is still open

- The **near fight** in `thefront` is thin — the mass battle is there and real
  bodies at your elbow are not yet. That is the mode's next piece.
- **Promotion** — walking at a distant rank and having it become real men — is
  designed and not built. It is Operation 02 of the plan below.
- `theline.12` is **flaky**: 3.3 in isolation, 6.5 earlier, red in-suite. Its own
  note puts se ≈ 1.5 on a four-seed mean. Not tuned, because tuning a flaky
  check is how a check stops meaning anything.
- The expansion plan — six operations in dependency order, every claim measured
  — is the artifact linked from the session, and `Op 01/04/06` are partly built.

## 5. What the LAST session changed

*(The session after that one changed no source at all — it was a read-only
comparison against a genre wishlist, and its output is `ROADMAP.md`. So the gate
figure in §1 is this session's and is not stale.)*

Two hostile audit rounds, five read-only lanes each, then ten fix lanes. The
audits were briefed to assume the game was a shallow demo wearing a long coat of
comments and to produce numbers rather than opinions. Everything below was
measured through the shipped code.

**Things a player feels**

- **The Reek's opening attack could not be dodged at any speed** — 18.73 hp/s
  against standing, retreating, strafing and dashing, the same to two decimals.
  Escape window 0.10 s against a 2.16 m footprint, so leaving it needed 21.6 m/s
  and the fastest movement in the game is a 15.5 m/s dash lasting 0.24 s. The
  Rancor's charge window was **zero seconds**. Both dressed with a roar, a body
  wind-up and a floating orange call. Now 0% against any movement above
  standing, pinned by `tools/checks/dodgeable.mjs`, which measures the player's
  paces by driving a real `Player` rather than transcribing them.
- **An enemy casting a held power froze the game.** `sparkBurst(chest, 2,
  0x9fd8ff)` against `(pos, normal, count, opts)` — the colour landed in `count`
  and asked for 10 467 583 sparks on 35% of frames per caster. Frames 1-20 cost
  10-15 ms; from frame 30, **71 to 134 seconds each**. It is also what ran
  `cloth-cost` past forty minutes six times without it ever being seen to
  finish, which is how it was found. That suite is 4.8 s now.
- **The telegraphed shot re-aimed every frame**, so leaving the drawn red line
  did nothing: 0.02 m from the bolt after stepping 4 m aside, now 4.25 m.
- **Six archetypes, one a 1050 hp boss, were shut out by holding walk-back**
  (0.00 hp/s). The player also now obeys `limitBackpedal`, the law every enemy
  already did, which makes the sidestep a better answer than the backpedal.
- **The chamber window was never humanly reachable** — every window shorter than
  a simple auditory reaction time, with the cue firing on the frame the window
  *opened*. The cue leads by up to 220 ms now.
- **A guest's Force moved nothing.** Shove/pull/throw/grip all 0.000 m on both
  machines; only the damage number crossed. Now 11.5 m on both, with the cast
  telegraph and a source id on the wire so a guest can read, break and be
  credited.
- **Two armies were both fighting you.** Geonosis wave 3 fielded five B1s, a B2,
  a rocket droid *and two clone troopers* together; 19 of 20 waves mixed sides,
  now 0 of 20. The census the fix printed is the wider finding: **175 of 200
  waves across all ten levels** mixed Republic and Confederate bodies.
- **A meeting opened on an order that does not advance** — two idle commanders,
  124 s, lines closing 120 m to 111 m, draw on the clock. And **quitting a
  meeting won it**.

**Things underneath**

- **`VITAL[name] ?? 0.4`** — nineteen humanoid bone names over 31 bodies; 142 of
  532 capsules hit the silent default and eight bodies died of their own
  extremities at 184-276% of themselves. Priced off `bone.role` now, and
  `severance` throws rather than guessing. Underneath it `World` billed every
  grind at a flat 55% of max health, so **two completed passes killed anything
  through any bone it had**; an AT-TE toe is 25 passes now and a torso is still
  one.
- **The exposure meter overruled the art** — every outdoor level normalised to
  one key, so the darker a level was authored the harder it was lifted.
  Authored-vs-rendered correlation **0.405 → 0.929**, and the blade owns 98% of
  the clipping pixels on Kamino again.
- **Run rules** — the six conditions are chosen before Ignite: 430 legal sets
  across ten theatres, never charged, vetoed with a reason. Testing four at wave
  1 found two real defects nobody had seen, including `_upgrade` paying itself
  back. A shareable seed came with it; `bestTier` was deleted (written every run,
  read by nothing).
- **A databank** — 31 of 31 archetypes, generated off `ARCHETYPES`. The research
  was already written in the comments and invisible to the player.
- **Escalation's guard ran a synthetic pool** matching no shipped level, and
  `BODY_CREEP = 1.6` was 1.6 *bodies* against a *threat* budget — a unit error
  sending 67-108% of each wave's added budget into more bodies instead of better
  ones. 4-34% now.

**Instruments that were lying**

`terrain` measured 2 of the 10 shipped grounds; `gait-support` booted Worlds on
two deleted level names and printed scoria's numbers as "warship" and "meadow";
`arrivals: something too big for a ship walks in` **could not fail**;
`footwork` drove all five forms on the one body fast enough to fight back;
`powers` ran a world where the player's blade never touched anything; `pvp`
reported two false open seams; `balance`'s model counted legs by a name regex
the game had stopped using. All fixed, most by deriving the list from the game
instead of keeping one.

---

## 5b. What the session before that changed

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

### 6.0a THE KNUCKLES WERE FACING OUT, AND IT WAS A DIFFERENT DEFECT — FIXED

*Fourth report of "the hands look wrong". §6.0 below is about FRAMING —
where on the shaft the fists sit and whether they are in shot — and it is
still open on its own terms. This one is about WRIST ROLL and it was
independent of everything §6.0 swept.*

> "the orientation is still janky af like i think the knuckles are facing out
>  on both like that's not how you would hold a saber in 1 or even 2 hands like
>  you keep missing this over and over that's not how human hands contort"

`buildHand` settles which axis a palm is without a guess — the finger roots
carry `rotation.x = 1.24`, a positive turn about X takes +Y toward +Z, so the
fingers close toward +Z and the palm faces the hand's +Z. Two hands closed on
one shaft therefore have a LAW: their palms cannot face opposite ways round it.
`tools/_palm.mjs` now takes that number and it had never been taken:

```
                                     palm·palm      before → after
    third person, two hands            −1.00           →  +0.46
    first person, two hands            −0.96           →  −0.74
```

−1.00 is the two palms pointing exactly away from each other. That is what "the
knuckles are facing out on both" means — whichever hand you look at, you are
looking at the back of it.

**The cause was a constant bias, and a bias is invisible on one hand and fatal
on two.** `handPoseOnHilt` documents `toward` as "the direction the arm arrives
from" and places the wrist one BORE offset back — but that offset is
`−(0.065·Y + 0.030·Z)`, which is not `−Y`: it leans 24.8° toward the back of the
hand. Compose it with `GRIP_TWIST`'s 35° and the wrist lands **59.8° round the
shaft** from where the caller asked. Both turns were taken about the hand's X —
the THUMB axis, which points opposite ways on a left and a right hand — so the
bias rolled one hand one way and the other the other, **119.6° apart**.

The fix is two lines: the comfort turn goes about the BLADE (a common axis) and
the bore's lean is taken off about X (where it belongs, because the bore is a
place inside the hand and genuinely mirrors). `GRIP_TWIST` absorbs the same
angle, so **the right hand's world frame does not move** — its first-person palm
reads (out −0.96, up 0.29, eye 0.01) before and after, and `viewmodel`'s forearm
ratchet reads 2487°/s before and after. Only the off hand turns, by exactly the
119.6° it was wrong by.

`FP_TUNE.roll = 60°` is now explained rather than merely swept: it is 59.8° of
bias, found empirically on ONE hand by rendering three candidates. That is why
the leading hand looked right and the off hand never did.

**What is still not clean, and it is geometry rather than a bug:** first person
with TWO hands ends at −0.74. Both fists are under a hilt held in the eyeline,
so the two wrists are 7° apart round the shaft, and the palms can only come
round together as the wrists separate — swept, `pair` 0.05→3.2 takes the wrists
7°→152° apart and the palms −0.74→+0.22, but by 3.2 the fists are level with
the hilt instead of under it and the framing checks §6.0 names go red.

That used to read "a second, independent confirmation that first person should
be ONE-handed". **It is not, and the argument was the one the player threw out**
— see §6.0. −0.74 is what a two-handed grip in your own eyeline COSTS, not an
argument for taking a hand off a hilt the player is holding with two. It is
still open on its own terms and it is still the shipped default's number.

Check: `tools/checks/viewmodel.mjs`, "arms: two hands on one hilt hold it the
SAME way round" — proven to fail on `968b575` and pass here.

### 6.0 The first-person grip is OVER-CONSTRAINED — **CLOSED, AND THE ANSWER WAS NOT THE ONE BELOW**

> **THE QUESTION WAS WRONG AND THE PLAYER SAID SO.** The section below ends
> "the way out is ONE HAND on the hilt in first person… that is a decision
> about what a first-person grip IS. Ask before doing it." It was asked, as a
> choice between a one-handed grip and a two-handed one, and the answer was:
>
> > *"Why the fuck would it be either or, both should be modeled and reflect
> > how many hands you're holding it with"*
>
> **The grip is not a property of the camera.** `Player.handsOnHilt()` is the
> one reader now — 0, 1 or 2, from `saberDown`, `driving`, `throwState`,
> `control.grip` and `gesture.kind` — the poser calls it and restates none of
> it, and the `fpHands` card row on the Interface panel is gone with its
> markup and its entry in the menu's read map.
>
> **What that costs is the number this section is named for, and it is paid
> knowingly.** At half a metre from the lens one fist leaves 32% of the shaft
> behind a glove and two leave 65% — measured, at three pitches, in
> `first-person: how many hands are on the hilt is what you SEE`. 65% is
> close to what two closed hands on a 25 cm hilt CAN leave: the two bores sit
> 65 mm apart on the shaft and a fist is 108 mm across, so 74% is the ceiling
> and the pose is 9 points under it. The clear view is one keypress away, on
> the key that means the same thing everywhere else in the game.
>
> **Two of the three constraints this section called unsatisfiable together
> are discharged rather than traded.** The near plane is no longer one of
> them: on the finished anchor (rise 0.32) the nearest arm joint is
> `shoulderL` at 115 mm against the 100 the deltoid needs, in every condition
> — idle, walking, looking up and down, one hand and two. The sweep that found
> "nothing satisfies both" was run at rise 0.26 with the grip still being
> chosen; the anchor moved afterwards and nobody re-ran it.
>
> **AND THE ONE-HANDED GRIP HAD NEVER BEEN MEASURED AT ALL.** No bench in this
> repo had ever pressed the one-hand key — every one of them reached for
> `fpHands`, which moved the ARMS and left the blade on `GRIPS.two`, a state a
> player cannot enter. The state a player CAN enter read wrist 167.6° and
> forearm 3002 °/s in first person, past both of the ratchet's bounds, and had
> been shipping that way: `FP_TUNE.roll`'s 60° was swept on the state the
> option produced. The roll is a pair now, 60° for two hands and 30° for one,
> and the four arms come out 89.4 / 79.0 / 115.1 / 102.3 degrees worst.
>
> The rest of the section is left exactly as it was. Every measurement in it is
> still true and it is the best record of how the wrong question was arrived
> at.



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

### 6.1a The player half of the Force contest — LANDED, all three steps

*Was "BUILT, MEASURED, REVERTED". It is in now, as the balance pass this section
said it had to be: `a057525` the four lines, `18c3cfe` the shove re-tuned against
a bracing player, `8b81e82` the two checks whose premise expired. `powers` ends
21/21, the number it started at.*

`Player.resistForce` CALLS `forceResistance` — one contest, one rulebook, both
contestants reading it. `damage` takes `preResisted`; `applyKnockback` mirrors
`Enemy.applyKnockback` line for line, weighing the shove and the damage once in
the same currency (`IMPULSE_AS_HP`). Measured, Knight difficulty, 50 hp authored:

    full pool   force / lightning / choke   19.1 hp   pool 100 → 80.4
    full pool   saber / blaster             42.5 hp   pool untouched
    empty pool  everything                  42.5 hp

**Step 2, and the thing that was not obvious.** The shove had been tuned UP
(17.0/6.5 → 20.4/7.8) to peak at 5.71 m, clearing the 5.4 m at which a Master's
lightning opens; braced, that peak is 3.28 m. **No sizing of the shove fixes
it.** `RESIST_CAP` is 0.55 of the whole blow, so a deep pool always scales a
shove to 0.45 of itself and the factor does not depend on the shove's size —
reaching 5.4 m through a full pool needs 2.2× the impulse, and 45/17 throws an
empty-bar player 14 m, past the far edge of the push's own [0, 7.5] band.

So the shove went to **26.0/10.0** — the same vector as both earlier pairs, all
three at 0.382 lift-to-speed — and the two-beat became a CONTEST rather than a
certainty. Driven with the Master's own brain, `push` taken off it so the peak
is one shove's:

                braced (100 F)              empty bar
    20.4/7.8    3.28 m · choke only         5.71 m · lightning, pull, choke
    26.0/10.0   3.86 m · pull, choke        6.84 m · lightning, pull, choke

Braced, you spend 16.7 Force and deny him the lightning; empty-bar you fly and
the whole kit opens. The shove now clears the pull's 3.2 m band by 0.66 m where
it cleared it by 0.08 — a coincidence, not a margin. **Shove→lightning against a
full bar is gone and is not coming back without changing `RESIST_CAP`.** That is
a design call, made deliberately, and it is the one thing here a reviewer might
want reversed.

**Step 3 re-stated exactly two checks**, both because their premise expired and
each saying so in its own comment. The empty-bar half of the held-power bound is
untouched and returns the same 95% / 100% it always did.

**The trap this uncovered, and it is the reusable part.** `Player.damage` grew a
fifth argument, and **four separate wrappers sitting in front of it named the
four they knew about**: `Waves.js boonGuard`, `Injury.js armInjury` (both
shipped, both a real double-bill on the pool), and the `p.damage` wrappers in
`powers.mjs` and `duelling.mjs`. The harness one manufactured a finding —
Sentinel 4.3 → 0.44 hp/s, which reads exactly like a body that had stopped
fighting. All four are variadic now. **`Command.js:1251` has the same defect
against `Enemy.damage` and is still open** — that file belonged to another lane.
Grep `\.damage = (` before changing that signature again.

### 6.1e THE BOND CURRENT PAYS HALF IN EVERY MODE THAT FIELDS AN ARMY — open

Measured off the shipped code, not driven: `localAllies(p)` in `Waves.js` is
`p.world.players` filtered on `q.boonMods`, and **a Command / skirmish /
campaign / Line trooper is an `Enemy` in `world.enemies`**, not a player. So the
whole bond current — Communion, Suffusion, The Vow, The Unifying Force and
Attunement of the Bond, five of the lattice's forty-six facets — falls to its
solo half in the five modes that field an army and in any mode at all once the
contingent slider leaves zero.

Each card has an honest solo fallback and none of them is dead, so this is not
`claims.mjs`'s question ("does the card move a real Player") and that suite is
right to be green. It is the other one: *is there a situation that makes this
worth taking*, and the answer is "co-op", in a game whose army modes put ten to
twenty-four named people inside `BOND.range` of you for the whole run.

What it would cost, and why it was left:

- `bondGive` writes `q._bondIn` and calls `q.heal?.()`; `bondReceive` spends it
  through `boonFactor`, which needs `boonMods`. **`Enemy` has neither** — no
  `heal`, no `boonMods` — so this is a change to `Enemy.js` and not to the
  cards.
- It would land a SECOND presence term on the line, on top of
  `MORALE.JEDI_NEAR`, which is the live Morale/Nerve lane's whole subject.
  Two mechanisms paying for "the Jedi is standing with us" is the shape
  `CommandDirector.lineIsUp` spends a page arguing against.

So: worth doing, worth doing *with* the morale lane rather than beside it, and
the measurement above is the part that would otherwise have to be taken again.

### 6.1b Diagnosed, scoped, not yet built

**`cel: a shadow is READABLE` — CLOSED, 24/24, and it was TWO failures wearing
one message.** Kept in full because the way it hid is the reusable part.

The check asserts three clauses over the same data — a span, a Spearman rank
correlation of key share against sun height, and a strict pairwise ordering
wherever two suns differ by more than 10%. It used `assert` for each, so the
first one to fail was the only one anybody ever saw. Fixing the pairwise
(geonosis 21° → 20°) revealed the correlation at rho 0.810 against a 0.90
bound; fixing the correlation revealed that the pairwise was **still red**,
between geonosis and kamino, and had been the whole time. The 21→20 fix had
been measured against ONE neighbour and the clause is over every pair.

All three clauses are now collected and raised together, and the correlation
failure NAMES the levels that are out of order instead of quoting a roster-wide
number with no subject in it. `tools/_celrank.mjs` (new) prints the table, the
rank displacements and every neighbouring bound in about a second — use it
before moving any level's light.

Two levels moved, each because its own numbers contradicted its own prose:

- **kamino** `sunIntensity` 5.4 → 3.4 and `ambient` 0.50 → 1.20. Its block said
  "almost none of it reaches the deck, which is why `ambient` carries this
  level" beside the fourth-strongest key in the game under a 0.94 cloud ceiling
  and the SMALLEST indirect term on the roster (0.083). Both knobs move because
  neither reaches alone: the ambient is nearly inert here (0.50 → 2.00 buys 2.5
  points, because `skyColor` is almost black) and the sun runs into a good
  bound before it is done — below ~2.9 a sunlit cloud top falls under its own
  sky and `sky.mjs` correctly calls the deck smoke.
- **geonosis** `elevation` 20 → 18. Turbidity 10.0 is optical depth by another
  route, and a level whose look is "weak key, strong sky" cannot also hold the
  roster's third-highest sun. 19 was measured and rejected: it ties the wood and
  `lighting.mjs` orders the indirect budget strictly.

rho 0.810 → 0.976, pairwise clean, span 1.69x, the 0.90 bound untouched. Two
stale comments beside their own numbers went with it (kamino claimed "6°, the
lowest sun in the game" at `elevation: 16`; geonosis said "21°" twice).

**CLOSED: the character creator's grip — and the framing was a THIRD defect, not
a cost of fixing the first two.** The repair written out here was applied
verbatim (scale the guard offsets and the elbow pole by `limbScale(rig).arm`,
pass `rig.scale` to `handPoseOnHilt`, size the hilt with `saber.setGripScale`)
and it is correct. Measured on `smallfolk`, in its own units, against the human's
own reading — which is the only kind of bound stature.mjs allows:

    bore (own hands)     4.86 → 0.72      human 0.72
    hilt (own hands)     5.99 → 2.39      human 2.39
    reach (own arm)      0.99 → 0.83      human 0.84

The reason it "regressed `preview` 11/11 → 10/11" is worth keeping, because the
diagnosis above was right about the mechanism and wrong about the CAUSE, and the
difference is a whole design argument that turned out not to be needed.

Two more things in the creator had never taken the species scale, and both were
inside the content box the camera frames:

- `dressPreviewFigure` passed no `scale` to `attachCloak`/`attachSkirt`, so the
  creator hung a human's 0.86 m cape on a 0.66 m body. Measured, the hem settled
  **280 mm below the floor the figure stands on**. That is the third claim of
  note #2 — "their clothes are oversized" — alive on the character screen after
  it was fixed in the game, and it is 280 mm of dead air the camera had to
  include under a 677 mm figure. `Player._makeCloak` and `applyWardrobe` have
  both passed `rig.scale` for a while; this copy never did.
- `assemblePreview` pushed the pommel in at a hilt-local `-0.16` with no grip
  scale, so it claimed 96 mm of metal that does not exist on a 0.40 hilt.

With those two the content box goes from `[-0.28, 1.39]` to `[0, 1.39]` and the
figure's middle from NDC −0.364 to −0.345 — still over the 0.32. So the design
call was still real, and it was made:

**The shot's blade allowance is a length in the WIELDER's metres, not in a
human's.** `BLADE_CAP` already refuses to frame a 4 m blade on a human, and its
own note says why in the exact words this problem needs — "the creator would
stop showing you the character in order to show you a strip light". 1.15 m on a
0.677 m body is 1.70 of its own height against that refusal's 2.37: the same
imposition, so the same rule, de-humanised by one multiply that is 1 for every
full-sized species. A small wielder's blade leaves the top of the frame the way
a 4 m one already does. Figure 39.5% → 62.6% of the frame height, middle −0.345
→ −0.187 against the human's −0.169.

The two rejected options, and why, since both were on the list above:

1. **A proportionally short blade** overrides a stated intent. `Saber.setGripScale`'s
   own note says it outright — "the BLADE is untouched; `bladeLength` is a player
   setting and a combat reach, and a smaller wielder is not carrying a shorter
   sword" — and framing is not allowed to decide a combat number (§6.2).
3. **Scaling the centring bound by content share** does not work the way `fill`
   does, and the arithmetic is the argument. Share enters `fill` as a factor
   ≤ 1; it enters the centring offset as `(1 − share)`, so the factor would be
   0.51/0.18 and the 0.32 bound would become 0.90. That is not a relaxation, it
   is an abolition — the bound would permit the figure almost anywhere in the
   box, which is the one thing "do not simply relax the 0.32" was protecting
   against.

`preview` is 12/12; the twelfth is new and is the check that could have seen any
of this — bore, hilt length and reach in the figure's own units, plus the hem,
over every species, with the human's reading as the bar. `tools/_previewgrip.mjs`
prints the whole table in about twenty seconds.

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

### 6.1d CLOSED: the controller — and what a future control has to do now

A pad was a stick you could wave. `Input._codeDown` resolved a binding as a
wheel pseudo-key, a `Mouse*` button or `keys.has(code)`; there was **no code
form a pad button could take**, so 0 of 46 actions could be bound to one. It is
46 of 46 now, and the parts a future round has to know:

- **`Pad*` is a code, in the same namespace as `Mouse*` and `WheelUp`.** Sixteen
  buttons on the standard mapping plus four LEFT-STICK directions. The pad
  default is a **third entry on the action's existing key list** and not a
  parallel table (§2.3), and the six orders are DEALT theirs from
  `ORDER_PAD_POOL` by `registerOrders`, so a seventh formation is bound the day
  it is authored. A seventh gets no pad code rather than a wrong one, and
  `controls.mjs` says so.
- **Chords exist.** `PadLB+PadA` is one code, joined by `+`. Bindings.js's header
  has promised "the most specific chord wins" since it was written and nothing
  implemented it; `Input._masked` does, off an index rebuilt on `setBindings`.
  **LB and View are pure modifiers and are bound to nothing of their own** — a
  modifier that also fires something drops that hold for the frame every chord
  lands on, and the obvious candidates (lateral guard, one-handed grip) are
  exactly the holds you would be in the middle of when you cast.
- **The pad has a press edge for the first time.** `getGamepads()` returns a
  fresh SNAPSHOT every call, so the old `this.padButtons = gp.buttons` had no
  previous frame to compare against and every pad read was a `down`. Two sets,
  swapped in `_readPad`.
- **Analog triggers are buttons at 0.35, with `pressed` also honoured.** `blade`
  is on RT; a browser that only latches `pressed` at the stop would be a guard
  the player cannot raise.
- **The left stick is IN the table and still analog.** `moveAxis` used to do
  `x += this.padLeft.x` — a second set of movement bindings no table knew about,
  which is the arrows bug wearing a different device, and the check written for
  the arrows could not see it because it probes key codes. It is four codes read
  through `actAxis`, which returns a MAGNITUDE: 0.4 of a stick is 0.400 of pace,
  and W plus a stick is 1.000 and not 2.
- **Start is Escape.** Pausing is deliberately not an ACTION so the way out
  survives a broken binding, which left a pad player with no way out at all.
  Start lands on the same `screens.escape()`, and only when no modifier is held
  so its chords stay bindable.
- **Glyphs follow the device.** Every surface that prints a binding takes a
  `{ device, family }` that DEFAULTS TO THE KEYBOARD — which is what keeps every
  other check and all existing markup byte-identical. Button 3 is Y, △ or X
  depending on the shell, and `padFamily()` tests Xbox FIRST because Chromium
  calls a DualShock 4 "Wireless Controller" and "Xbox Wireless Controller"
  contains that phrase word for word.
- **The front end is walked with the pad by moving DOM FOCUS**, not by a second
  set of menu handlers: every control already answers Enter and Space, and
  `menu.mjs` pins that. Reachability asks `offsetParent` rather than restating
  `.panel{display:none}`, so a browser walks the open tab and the harness — which
  has no layout — walks all of it.

**Rumble** landed in the seam `Engine.rumble` left for it (`this.rumbleLevel ?? 1`,
with a note saying "the day a strength slider exists it assigns this").
`applyFeelSettings` writes it. It is **not** a second gate on `shake` — every
call site already asks `feelOn('shake')` and `feel.mjs` pins that the pad stays
quiet with the box off — it scales what survives that.

**The rule for the next control, in one line:** if it is not in `ACTIONS` it
cannot be rebound, cannot be listed and cannot be seen to collide, and
`controls.mjs`'s raw-device clause now names the pad's fields as well as the
mouse's — which is what would have caught `SaberController`'s `padDown(4)`,
the last two raw reads in the game, if it had.

### 6.1c CLOSED: the AT-TE lift, and the bodies that died like nothing

**`force` 24/1 → 26/0 — the rule was right and its SUBJECT had expired.** "The
top of the slider clears the heaviest body" is exactly right about a roster of
animals; it is not right about one with a 3600 kg six-legged siege walker in it,
and raising the cap past 3600 would price a 210 kg droideka at nothing on the
way past. The exclusion is authored where the decision belongs
(`grippable: false` on the AT-TE and the AAT, Vehicles.js) and the check asks
the narrowed question, with three guards so the narrowing cannot become a dodge:
every excluded body must be HEAVIER than the top of the slider, the exclusion
set must be non-empty, and at least one `big` body must stay liftable. Heaviest
liftable is the Rancor at 1700 kg against a 1760 kg cap — 60 kg of margin, which
is real and tight, and the check now prints it.

`Enemy.grippable` was the second field in that method's history to be WRITTEN
AND NEVER READ: `!A.big && !A.boss`, a size wall the mass cap had overturned and
nobody deleted, so the field claimed an Acklay could never be lifted while the
game lifted one at Force Power 4. It carries the archetype's declaration now and
`Player._grippableBody` reads it. **The refusal is out loud** — dropping the
AT-TE from the pick would let the aim ray pass through thirteen metres of walker
and grip whatever stood behind it, so `_forceSeen` keeps it pickable and
`toggleGrip` names it and names the way in. Which way in is read off the RIG:
the AAT is a repulsorlift with `legs: 0` and is told to have its armour broken
instead of its legs cut.

**Unarmed bodies now have a guard, and it is derived.** `guardFor` (Enemy.js) is
the single authority — hp/90 for a duellist, MASS/300 for everything else — and
`tools/balance.mjs` imports it rather than keeping a copy. Mass and not
toughness, because toughness is already spent one layer down as the work-to-cut
term in BladeContactSolver. Nothing man-sized turns anything; the lightest body
that does is the 420 kg Nexu. Model time-to-kill: charger 0.64 → 3.83 s, beast
0.64 → 3.19, brute 1.28 → 3.83, walker 2.56 → 4.47, AT-TE 2.56 → 5.75, and b1,
trooper, sniper, heavy, jet, arc, officer and rocket all unmoved at 0.64.

**Three things about that are worth carrying forward.**

1. *The first version bought almost nothing and the harness said so.* It turned
   the pass at the neck and the model went round it to a leg — five bodies from
   420 to 2200 hp all landing on 1.28 s. The cause is one layer down again:
   `takeCut` charges `maxHp * vital * 1.15` for a severed limb, a SHARE of
   maximum health, and every non-humanoid bone falls through `VITAL[name] ??
   0.4` because that table holds nineteen HUMANOID names. **A Rancor's toe was
   worth 46% of it, exactly as much as its hip.** That fallback is §2.3's close
   relative and it is still there for anything that reads `VITAL` directly.
2. *The openings were all already built and all meant nothing.* `_guardOpen`
   reads WINDED now — the state `_beastBrain` has entered for a session, whose
   own comment already called it "the only safe time to go for a leg" and which
   had nothing to be safe from while every pass landed. Machines keep the legs
   (`legsLost >= 3` topples, and a topple opens the guard).
3. *A guard that catches a pass must never pay for one.* `World._applyBladeEvent`
   already returned early on `'turned'`; `Player.forceDisassemble` did not, so a
   walker whose plate turned a rend still credited a limb, 40 score, the shake
   and both sounds. A Force rend is also not a blade pass and is now marked
   `force: true` so `_turnCut` declines it — the Force's contest is
   `resistForce`, and billing one act to both is double-charging.

**And the instrument had three defects of its own**, every one flattering the
player. `offenceReport` threw `ReferenceError: BUILDERS is not defined` and had
been dead since the builder table was deleted, because `main()` is its only
caller and no check exercises it. The blade table called `engagementFor` with no
guard share while every run in the same report passed one. And the travel phase
compared a `phaseT` counting UP against `e.arm`, a countdown the incoming loop
decrements every tick, so the player began cutting at HALF the arm time — three
lines under a comment that states the rule correctly and says it was fixed after
the identical symptom. The Colosseum's wave-1 opener cost 0.0 hp at all four
tiers over 24 seeds because of it; it is 7.2 / 11.2 / 13.8 / 17.8 now, and still
clears 24/24. `balance: a melee opener gets to attack — wave 1 is not free` pins
the zero out.

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
   each). They pass both ways because they have margin. **`ground` is no longer
   the only thing the runner does not restore, and that line was measured and
   found short.** `restoreShared` put the wind back ONE FIELD OF SIX — the clock,
   not the heading, strength, gustiness or wander a level's block sets — so every
   suite inherited whichever level the last one loaded; and `heading`/`dir` are
   derived from the clock by `_refresh()`, so rewinding the clock under them left
   the field pointing where it had been at the moved time. The whole
   configuration goes back now, along with the audio singleton. Still uncovered
   and each for a stated reason: `ground.clock` and `_scarAt` (they must move
   together or `ground.scar`'s throttle refuses every cut for the rest of the
   run), Waves.js's stream, and Engine's ShaderChunk flags. See
   `tools/checks/_shared.mjs`.

   And the residue that no boundary restore can reach, because it is inside a
   file: a suite's checks interleave across their awaits, so two of them sharing
   a module-scope stream draw in an order that depends on what ran before.
   Measured by running one suite TWICE in one process — `characters` read a
   heavy's bore at 0.9° off aim and then 0.4°, `arrivals` 2.50 then 2.40 bodies
   per gunship, `pvp` a shove at 0.94 m then 0.33 m. `clocked` seeds every check
   body and does not touch this; the suite has to stop sharing the stream across
   its own awaits. Worse for two of them: `arrivals` and `vehicles` differ from
   one PROCESS to the next, because `Waves.js` and `MathUtil.js` each seed a
   module-scope stream with `Math.random()` at load and `Combat.js`, `Duel.js`
   and `Dropped.js` call `Math.random()` outright. Seeding both streams was tried
   and does not settle `vehicles`.

---

## 6.3 New instruments

| Tool | Answers |
|---|---|
| `tools/_fpgeom.mjs` | where the first-person arms and hilt are **in the frame**, and how much of the hilt is behind the fists — one second, against `fpview.mjs`'s twenty minutes |
| `tools/_celrank.mjs` | every outdoor level's sun height against its shadow's key share, the rank displacements, and **every neighbouring bound in one table** — `cel`'s span/rho/pairwise, `lighting`'s indirect budget and cast-shadow floor, `sky`'s cloud-top-over-sky, and the exposure clamp. `--set=kamino.sunIntensity=3.4,geonosis.elevation=18` measures a candidate look without editing Levels.js |
| `tools/_previewgrip.mjs` | every species' creator preview in ONE table: the bore gap and the hilt's length in that figure's own hands, the hand target in its own arm-lengths, the figure's share of the content box, and where it lands in the frame. Twenty seconds, and it is what showed the framing was three defects rather than one |
| `tools/_deployprobe.mjs` | **did the page throw, and does it deploy** — every pageerror and console error, plus the run seams read out of the RUNNING page. ~40 s against `smoke.mjs`'s five minutes. Written because smoke's deploy step waits 30 s for the HUD, which at §2.6's two seconds a frame is FIFTEEN FRAMES: it timed out on four steps while this probe deployed the same build in 22.2 s with zero errors. A smoke timeout is not evidence of a regression; this is what tells you which you have |

**New check suites this session**, each named for the property it holds rather
than the file it guards: `wiring` (the module graph the BROWSER walks — nothing
else imports the whole game, so a missed import could 404 the page with every
other check green), `severance` (what losing a bone is worth, over the whole
roster, derived from the bones), `dodgeable` (every creature attack leaves a
window a walk can use, with the player's paces measured by driving a real
`Player`), `runrules` (the panel and the director agree on all 70 theatre×rule
pairs), `factions` (no wave composes empty, and the levels that mix two armies
without saying so are counted), `databank` (every archetype has an entry and no
name is typed into the markup).

All except `_deployprobe` take `--import ./tools/register.mjs`; `_fpgeom`,
`_celrank` and `_previewgrip` open with `dom-shim.mjs` because they reach
Textures.js and Engine.js, which bake onto a canvas — and `_celrank` imports
Engine.js DYNAMICALLY for §2.1. `_deployprobe` drives a real Chromium instead,
so it needs neither: it must live under `tools/` rather than in a scratchpad
because `playwright-core` resolves out of the repo's own node_modules, and it
names the browser the same way `smoke.mjs` does (`/opt/pw-browsers/chromium-1194`
— do NOT run `playwright install`).

**Use `_celrank` before touching any level's light.** Six bounds in four suites
read the same atmosphere block, they are not in the same file, and three of them
bite in opposite directions: cutting a sun to soften a shadow drops the cloud
deck under its own sky (`sky.mjs` calls that smoke), and raising the ambient to
compensate walks into `lighting.mjs`'s cast-shadow floor. That is how a
one-level tuning pass becomes a four-suite bisect.

---

## 6.3b A GUARD WHOSE WRITER WAS NEVER WRITTEN — and three more of the same shape

The physics/bodies/lifecycle audit. Everything here was green in every suite
that mentions it, and every one of them is a system holding an object the game
had already torn down. The instrument is `tools/_bodyaudit.mjs`: one World, a
scripted Jedi that actually clears the room, and a full census — the scene
graph, **Rapier's own counters rather than our mirrors of them**, every
collection a body can be parked in, non-finite transforms, and bodies at rest
under the ground — every sixty game-seconds for fifteen minutes.

**A check that reads a guard is not a check that the guard is written.**
`Corpses.update` opens `if (!e || e.disposed || !e.dead)`. `Enemy.dispose`
never wrote `disposed`; only `Player` did. `World.restartWave`'s own note says
in as many words "Both halves are fixed, because either alone leaves the other
reader wrong" — **one half was fixed**, and `grep -rn '\.disposed' src/` was
enough to see it. What that cost is not the wave reset the note was about, it
is ordinary play: `Enemy.update` ends `return this.dying < 40`, so `World`
tears every corpse down forty seconds after it falls and the ledger held it
regardless.

    t=120s   20 corpses,  7 already disposed
    t=240s   20 corpses, 17 already disposed
    t=420s   20 corpses, 20 already disposed — and it never moves again

Seven minutes in, every slot of a twenty-corpse budget is a body that no longer
exists, `live.length > budget` is false forever, and **the field a player fights
on keeps no dead at all** — which is the exact complaint the budget was built
to answer. Twenty whole Enemy graphs ride behind them until the level unloads.

**Two callers below one early return.** `applyBodyLod` is called from
`Enemy._applyLod` and from `Enemy.update`, and BOTH sit under `update`'s
`if (this.dead) … return this.dying < 40`. Both LOD rungs already say a corpse
is not theirs (`applyCohort`'s `fit` is `lod >= 3 && !owner.dead && !ragdolled`)
and neither was ever asked again. Measured with `tools/_cohortleak.mjs`, twelve
B1s stood past `L3_AT` (137.8 m) and killed where they stood: six were still
cohort MEMBERS forty-five seconds after being disposed, still drawn as standing
soldiers by the shared InstancedMesh with their ragdolls invisible underneath,
and the slot never came back — `c.high` climbs with every distant kill and
`_grow` doubles the instance buffer to hold ghosts.

**A flag that means one thing to its writer and another to its five readers.**
`RapierWorld.remove` sets `body.dead = true` and `add` never cleared it, so it
meant "has been removed at least once". A body can come back:
`Enemy._tickGetUp` takes the walking capsule out when a droid is knocked flat
and calls `add` again when it stands up. `tools/_deadflag.mjs`, one B1:

    standing   dead=false  inWorld=true   forceSeen=true
    knocked    dead=true   inWorld=false
    back up    dead=true   inWorld=true   forceSeen=FALSE

`Player._grippableBody` refuses anything with `b.dead`. **Every enemy in the
game became ungrippable the first time a push put it on its back** — the aim
ray passed straight through it to whatever stood behind, for the rest of that
body's life. `Physics.js` has the identical shape and is deliberately left
alone: its own header says nothing there runs in a player's frame.

**And one producer with no consumer.** A dropped hilt is an ordinary `Prop`
with no lifetime; `ageDropped` only ever advanced `dropAge`. `_hiltpile.mjs`,
eight duellists killed five times over: 8 → 40 hilts, 196 → 983 meshes, one per
saber-carrying kill forever. A hilt is 24.6 meshes because it is nineteen to
thirty-six machined pieces, so forty of them is 983 draw calls of hardware in
the sand against the 520 `world-immersion` holds a whole LEVEL to.

**THE PROTECTION ON A BUDGET LIKE THAT IS A RELATIONSHIP, NOT A RADIUS**, and
two drafts got it wrong before the measurement said so. A fight happens AROUND
the player, so every hilt on the field is inside any distance floor worth
having: at 14 m and again at 4 m the cull refused every candidate and the pile
still grew five a wave. What is protected now is a hilt in a hand or in the
Force, one a local player put down themselves, and one dropped inside
`PICKUP_DELAY`; everything else is ranked exactly as `Corpses.worth` ranks the
dead, and what fades is what is behind you at thirty metres.

All five are bound by `tools/checks/undertaker.mjs` (7 checks). Two things it
had to learn the hard way and the next bench will too:

- **`dying` does not advance at one second per second.** `World` scales `dt`
  for hitstop and kill-time, so 42 s of stepping put `dying` at 37 and the
  first draft of the corpse check failed on a build where the fix worked.
  Drive until the thing has happened, with a cap — not for a fixed wall of
  frames. Same shape as §2.6, one clock further in.
- **`_flagship.mjs`'s `dutyInput` is not a room-clearer.** It holds station on
  its line and meets only what comes inside `ENGAGE` (14 m), because it is
  measuring a formation. Driven with it, the 900 s audit stalled at t=420 with
  one B2 standing 34 m out shooting into a raised guard, and the last 480
  game-seconds were a still frame. `_bodyaudit` carries its own `hunterInput`.

**AND THE ONE NEXT.md HAD OPEN, which is the same shape a fifth time.** "A
felled trunk that has settled BELOW the ground it fell on. Of nine trunks
realised in the wood, four had surfaces under the terrain and one had fallen to
−179 m." −179 is one metre off `RapierWorld.killY`, and the cause is upstream of
the solver rather than in it: the fall is a hinge that does not know about the
ground. `Forest.update` integrates θ̈ = 3g/2L·sin θ to horizontal about a pivot
at the CUT FACE, so a trunk rests at the height of its own stump however the
ground runs away underneath it — `_layLog`'s own note has that measured already
("34 of the 83 had some part of themselves buried… 13.2 m under at the deep
end") and takes the right precaution for a STATIC box, laying none along the
buried stretches.

**A Prop is not a static box.** `_realise` built a DYNAMIC body at exactly that
pose, so a trunk lying in a bank was a rigid body born inside a heightfield —
the one state Rapier has no correct answer for. Measured with
`tools/_logsweep.mjs`, twelve stops across the wood, fourteen trees felled at
each: **9 of 21 realised logs were born with their underside below the terrain**,
deepest 1.53 m, p90 0.75. Afterwards, same sweep: **1 of 19, deepest 0.09 m**,
which is the seat's own eight-sample granularity.

The kill-plane end is permanent and worth knowing about on its own: a log that
reaches −180 is removed from the physics world and KEEPS its Prop and its mesh;
it is 180 m from `home`, so `_syncLogs` marks it `moved` and then reads its x/z
off the body — barely changed — so it is never far enough away to be released
either. The tree is gone from the wood for the rest of the level, its instance
collapsed to zero scale, and one of the nine `LIFT_CAP` slots gone with it.

**What is left, and why.** `Prop.destroy` frees materials only where the prop
says `ownsMaterials` (today: a dropped hilt, whose five metals `buildHiltGroup`
machines per hilt). Every other prop kind draws from shared tables and freeing
one of those takes the paint off everything still standing — the same
"corrupting something another system still holds" `_cullOldestDebris` refuses
to commit. Whether any of those tables are per-prop after all is unmeasured.
`Player.dispose` still does not dispose `p.injury`, which owns two materials;
that is ~2 per respawn and it is not what any of the numbers above are about.
And a log that is born ON the ground can still SETTLE a little into it — the
first draft of the wood check asserted the resting place and read 0.72 m and
0.32 m on two of nine after fourteen seconds. The check asserts the BIRTH
instead, deliberately: where a log ends up once it has been dropped, shoved or
rolled down a bank is the solver's business, and a check that pinned it would
be pinning a scene rather than holding a rule.

---

## 6.4 What the gate is red on, and who owns each

```
2 Sep     2461 passed, 1 failed   → the one is `levers`, and it is a design
                                    question rather than a defect: §4.9 has the
                                    measurement and tools/_levprobe.mjs the
                                    reproduction. Everything else on the tree
                                    is green in one forward run. ~55 min.
31 Aug    2177 passed, 2 failed   → both re-run alone and green; both were the
                                    harness, not the game, and both are fixed
                                    (§5.0: the two unpinned streams, and
                                    theline.19's premise). ~45 min on this box.
26 Aug    forward   1517 passed, 0 failed   18.7 min, clean worktree, quiet box
26 Aug    reverse   1517 passed, 0 failed   SABER_CHECK_ORDER=reverse, same tree
```

**A RED LINE IN A FULL RUN IS NOT A FINDING UNTIL IT HAS BEEN RE-RUN ALONE**,
and this round is the clearest case the repo has: two reds out of 2179, neither
of them a defect in the game, and one of them — `theline.19` — a check that had
been reporting a *number* for a run whose stated premise had quietly stopped
holding. See §5.0's last two headings. Both are closed at the boundary rather
than in the check that noticed, which is where four earlier ones were closed.

**The same count in both directions is the part that matters**, not the zero.
Forty-two of this session's fifty-nine failures were order-dependent — a suite
handing shared state to whatever ran next — and a forward-only green would say
nothing about them. Run it both ways or the class is not closed.

**It is green. The table below is what it took, and it is kept because every row
is a way a check can be wrong that a green run cannot show you.** Earlier the
same day the same gate read 1438/59.


**Forty-two of those fifty-nine were ONE DEFECT WEARING THREE HATS** — a suite
borrowing shared state and not handing all of it back, §2.9: the audio singleton
(38 checks), the `MODES` record (`runrules`, 1), and the player's saved key
bindings in `localStorage` (`spectacle`, 4, all four reading as unrelated
control faults). Every one of them was green when its own suite ran alone. That
is the single most important thing this table has to say:
the full run is not a slower version of the per-suite runs, it is the only place
a whole class of defect is visible at all, and this session found that class by
running it.

**Read this table the way it is built.** A red line in a full run is not a
finding until it has been re-run alone on a quiet box — in an earlier session
three of nine evaporated that way and one was a race with a peer's commit. But
the converse now has a name too: a line that is GREEN alone and red in the full
run is not noise, it is the interesting one. Reach for `_seq.mjs` before you
dismiss it.

**`tools/_seq.mjs` runs several suites in ONE process in the order given.** What
carries between them is module-scope state (`enemyRng`, `duelRng`, the wave
stream, `wind` and `ground`, Engine's once-only ShaderChunk flags, and the
engine singletons — §2.9), or the scheduling of a suite's own async checks:
`check()` pushes them all onto one `Promise.all`, so they interleave, and the
interleaving changes with what ran before. **Suites run in `readdir` order, so a
hyphen sorts before a dot: `command-pvp` runs BEFORE `command`.** Get that wrong
and your reproduction is green.

**Two of the fifty-nine were the harness, not the game** — `front-screen`'s
layout check and `shadows`, both `Cannot find package 'playwright-core'`,
because the run was in a worktree. §2.10.

| Check | What it was | State |
|---|---|---|
| 38 checks across `controls`, `databank`, `front-screen`, `hud-events`, `menu`, all reading `Cannot read properties of null (reading 'currentTime')` | **one suite left the audio singleton half-built.** §2.9 has the whole shape. Reproduce with `_seq.mjs audio menu`: 19 of menu's 27 die in `new Menu`, out of its own Volume slider | **fixed** |
| `force: a push shoves a crate further than it shoves a pillar` | **an impulse bound quoted in the wrong currency.** A hardening pass added `MAX_SPEED = 1e4` and applied it to `applyImpulse`, but an impulse is in N·s and carries the body's mass: the 900 kg pillar's legitimate push is ~28 000 N·s and was silently dropped. Measured, pillar at forcePower 4: 31.3 m/s before, 0.40 after — and 0.40 is gravity for exactly one step, so it received nothing. Turning the Force setting UP stopped heavy props moving at all | physics lane |
| `first person: the neck cap bounds the eye speed` | **a proxy that failed because the game improved.** It asserted the cap TRIMS >5 mm at a sprint, which was really measuring how rough the pelvis was. The gait fixes took single-frame pelvis travel from 23.7/40.1/69.6/88.3 mm to 8.4/11.3/32.4/28.4 mm against a 46.7 mm allowance, so the cap now trims 0.23 mm. Rewritten to assert both halves directly — the gait is under the cap at every speed, and the cap is proven on itself | **fixed** |
| `destruction: carve a column and how deep decides whether the top falls` | **a check on a knife edge.** Sweeping the hilt ±10 mm around its own fixture, the column stands 7/11 times on the old code and 4/11 on the new; sweeping DEPTH, it stands 7/7 at 0.15 m, 3/7 at 0.30, 7/7 at 0.45, 1/7 at 0.60, 0/7 at 0.75. The response is not monotone, so the single sample was a coin flip and its previous green was luck | blade lane |
| `balance: a body with NO blade defends itself too` | same commit's blade change; a beast goes down in 1.28 s | blade lane |
| `blade: a fast sweep across a forearm produces a cut event` (verify.mjs core) | the chord cap `2 * cap.r` may be smaller than a thin limb's need, so the hips and spine sever in a frame the forearm survives | blade lane |
| `skirmish` ×2 | written red-first: the defeat is never announced (`_endSkirmish`'s only caller passes `true`), and the ending card reads `stats.taken`/`stats.fallen` that no ending sends | modes lane |
| `determinism` ×2 | written red-first: 13 suites build enemies without seeding the stream, 26 drive a World without handing the clocks back | determinism lane |
| `roster: nothing in the tree names a level the game does not have` | one dead reference; the suite also gained an arm for terrain preset names | **fixed**, 5/0 |
| `run rules: a mode whose composer never sees a rule declares it` | **a restore that deleted.** A `menu` check injects `fixedRules` onto the real `MODES` record and put it back with `delete` — and its target is `duel`, which SHIPS that field. Green alone every time; red in the last two full runs. `_seq.mjs menu runrules` reproduces it | **fixed** |
| `spectacle` ×4 | **the player's saved key bindings, handed on.** `controls` drives a rebind through a real Menu, `saveBindings` writes the whole table to `localStorage`, and every later `new Input` reads it back: `loadBindings().walk` comes back `["PadBack+PadL3"]` against a default of `["KeyI", …]`. 19/19 alone, 15/19 after `controls`, and all four failures read as unrelated control faults. Fixed at the boundary — `snapshotShared` carries the whole of storage now | **fixed** |
| `destruction: the blade grinds through a column and drops what was above the cut` (verify.mjs core) | **a budget calibrated on a bug.** Excluding a structure's own debris from its impact scan — correct, and the fix for the suite's own column check — took away the 110 self-impacts carrying 38× the column's health. The blade alone needs 13 s, not the fixture's 4. Reach was never the limit: pushing the tip from 55% to 105% through changes nothing at 4 s | **fixed** |

**And what a full run cannot tell you at all.** Four of `smoke.mjs`'s eleven
steps failed on the run above with "no animation frame in 8000 ms". The box was
at load 15 and a frame here can take four seconds. That is §2.6 exactly: the
timeout measured the box. Re-run smoke on a quiet box before recording anything
from it.

---


## 6.5 If you pick this up cold, do these in this order

**`ROADMAP.md` at the repo root is the other half of this section**, and it now
opens with a status table checked against the tree rather than remembered.
**Three of its four defects are closed** — a thrown body damages what it hits, a
released grip recovers instead of walking ragdolled forever, and
`Destruction.explosion()` reaches the destructible world through a wrapper on
`World.onExplosion`. The fourth, contact dispatch lost in the Rapier migration,
is open and is the structural one; what is worth knowing is that the other three
were each fixable WITHOUT it, so it is not holding three visible defects hostage
the way the roadmap assumed.

Read its procedural-levels half before designing anything there. It records that
this project has killed progression-through-levels **twice** — the Spire and the
Descent — and that neither death was a code failure. That warning is worth more
than its implementation notes.

1. **Get it in front of the player, then read §7.** `node tools/pack.mjs
   /tmp/borz.html` and send them the file. That file did not boot for four days
   and nobody noticed, because nothing in the tree had ever opened one — see
   §2.10's neighbour, `tools/checks/packed.mjs`, which now packs the tree and
   opens the result the way a player does, every run. Nothing in §6.4 is worth
   more than one person playing it for ten minutes.
2. **Finish §6.4's owned rows.** Three of them are one story — the blade's
   sampling rewrite left `destruction`, `balance` and the core forearm sweep
   red — and the first of those is a check on a knife edge rather than a
   mechanism that broke, which is a different repair. The `force` row is the
   sharpest of the lot and the cheapest: an impulse bound quoted in metres per
   second.
3. **Run the gate, forward AND with `SABER_CHECK_ORDER=reverse`, on a QUIET
   box.** This session's single largest find — 38 checks, §2.9 — was invisible
   to every per-suite run and visible immediately in a full one. Symlink
   `node_modules` first (§2.10).
4. **`World.js`'s `pickTarget` cross-army loop** is gated `if (this.command)`,
   which is now three modes rather than one. Dropping the gate is the whole of
   "both armies fight each other as well as you" — and it is a DESIGN decision
   about six levels, not a fix. Six levels field Republic and Confederate bodies
   in the same wave without declaring a split (`factions` prints the census) and
   every one of their notes argues a HORDE, a field united against you. Either
   make those six single-army or let their halves fight; the comment at the gate
   states the cost of the second either way.
5. **`ROADMAP` §5 and §6, which are partly closed.** Verify before building —
   that section is older than the tree. Stasis holding a person is done; check
   the rest the same way rather than believing the list.

**What NOT to do first.** Do not start another audit *by default*. Rounds of it
have run and each found real things, but the last one was asked for explicitly
after a long gap and it was right to run: it found a delivery artifact that had
never booted, a client packet that could kill the host, a control that could not
move anything, and 38 checks dying of one suite's housekeeping. The honest rule
is not "never audit again", it is **audit when the tree has moved a long way
since the last one, and PLAY IT in between**. §7 is not a platitude here — it is
the specific reason this list is short.

## 6.6 If you are handed a long list, ORDER IT FIRST — and show the order

A long list arrives in the order it was thought of, which is never the order it
should be done in. **Do not start at the top.** Rank it, say the ranking out
loud before you begin, and say what you are doing last and why. The player can
correct an ordering in one sentence; they cannot correct four hours of work.

Rank on evidence from this repo, not on taste:

**1. Three buckets, in this order.** A thing that EXISTS AND IS BROKEN beats a
thing that exists and cannot be reached, which beats a thing that does not exist.
The player already believes the first two work, so those are the ones costing
them something today. Measured this session: of nine gaps found against a genre
wishlist, four were defects and three were features with no way in — only two
were genuinely missing. `ROADMAP.md` is sorted this way.

**2. Then by player-visible value ÷ cost, and the ratio is often absurd.** The
worst thing in the game — a creature whose opening attack could not be dodged at
any speed, 18.73 hp/s against standing, retreating, strafing *and* dashing — was
**three numbers**. The spark freeze that stopped the game for 71 to 134 seconds
was **one argument in the wrong slot**. Look for those before anything expensive.

**3. Find the item that kills other items.** Contact dispatch, lost in the Rapier
migration, is the root cause of three separate entries on `ROADMAP.md`'s own
list. An item that closes three is worth more than its rank. Ask of every
expensive thing: what else does this unblock?

**4. If you run lanes in parallel, batch by FILE, not by theme.** Ownership must
be disjoint and stated per lane, because the tree is shared. §2.2b has the two
occasions that rule was broken and what it cost. If a run cannot tolerate it,
give each lane its own worktree.

**5. Expect your own brief to be wrong, and let the measurement win.** Briefs
written from this document were corrected by the lanes executing them more than
once — an escalation brief blamed the wrong cause entirely, and the lane's own
measurement found the real one was the denominator, with one level's bound
arithmetically unsatisfiable. That is the system working. Write briefs with the
numbers you have and an instruction to re-measure, not with conclusions.

**6. Re-order after every batch.** A landed fix changes what is cheap. The list
you ranked at the start is stale by the third item.

**7. Put a build in front of the player before the list is finished, not after.**
`node tools/pack.mjs /tmp/borz.html`. See §7 — it is not a platitude, it is the
source of every note that has ever mattered here.

---

---

## 7. The one thing worth more than any of this

Every one of the 64 notes that drove this entire effort came from the user
**playing the game and looking at it**. The cone survived several rounds of
being "fixed" by the checks; it took a person saying it was still there.

The judges' findings are a checklist to feel for, not a substitute. If you are
choosing between another measurement pass and getting a run in front of the
user, choose the run.
