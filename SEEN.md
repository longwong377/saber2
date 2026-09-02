# THE WAR YOU CANNOT SEE

What to build next, and the argument that it is not a twelfth mode.

Written 2 Sep against the shipped tree, after the V12 gate. Sixty-two agents
read this repository for it: ten mapping what the engine affords, twelve
digging the playtest log and the design record, twelve pricing candidate modes
against real code, eight trying to kill every one of them, sixteen on a single
seam, and four writing full designs. Every number below is quoted from this
repository's own measurements, with the file it lives in. Nothing here is
estimated.

---

## 0. The answer, in five lines

**The giant battle you have asked for five times exists. It has existed since
27 August. You cannot see it, and the reason is written down in two places in
this repo that contradict each other.**

So the work is not a new mode. It is three moves: put the camera where the
spec always said to put it, give authored content a second axis so every big
idea ships as a mission instead of a menu card, and build the one seam that
turns the mass battle from a painting into a place you can walk into.

Underneath them sits a ledger of five measured defects, and one of them is a
decision only you can make.

---

## 1. The battle was built, and deleted with its best piece missing

`src/game/Mass.js` — 1363 lines, plus a 702-line check suite and two
measurement probes — is one commit back in git (`9480d21^`). What it did:

- **480 men, 240 a side, laid six frames after you landed, every one of them
  inside the camera frustum.**
- 240 instanced men plus the whole world update at **6.05 ms in 7 draw bins**,
  against ~31 ms and several hundred draw calls for the same count of real
  bodies.
- The bolts were **real** — fired through `BoltPool.fire`, the same door
  `Enemy._fire` uses, with a real team and real damage. A rank two hundred
  metres away could kill you and you could deflect its fire back.
- The casualties were **real** — rank men swept against live bolts every
  frame, so shooting into a distant line thinned it visibly.
- **And the front moved.** Whichever mass had more men standing advanced and
  the other gave ground, so you could look up from what you were doing and
  read whether the war was going your way.

Then you played it and said *"get rid of The Front mode entirely"*. And the
handoff had already written down why, before you said it:

> *"The near fight in `thefront` is thin — the mass battle is there and real
> bodies at your elbow are not yet. That is the mode's next piece."*

And `Mass.js`'s own header says it more plainly than any of us could, on
purpose, so that no reader could be fooled:

> *"PROMOTION IS NOT HERE YET. The intended end state is that a rank you walk
> toward dissolves into real `Enemy` bodies before you reach it, and folds back
> into a rank behind you. The seam is the hard part and it deserves its own
> pass with its own checks; until it exists, `PROMOTE` is enforced the blunt
> way — ranks are never planted inside it, so the near fight is the real
> bodies' and the far battle is the mass's, and the two do not overlap.
> Writing that down is the point: a reader must not think the seam is solved."*

**The battle was a painting.** You could look at it and you could not walk into
it, because a keep-out radius of 90 m stood between the two halves and nothing
crossed it. That is exactly what "thin" means. The one piece that would have
fixed it was named, described in a paragraph, and never built.

---

## 2. The finding underneath it: you are standing where you cannot see the war

This is the more important half, and it is not about The Front at all. It is
true in every mode, today, in the build you are playing.

**The armies are there and they are the size they were designed to be.**
Measured: peak **48 hostiles / 58 live bodies** in The Line, 49/56 in Command,
51/57 in Skirmish, against FLAGSHIP §4's designed 40–60. The playtest log
records the finding beside them:

> *"What is missing is that you cannot SEE it — six seconds after deploy,
> **zero** are inside the camera frustum in either mode. The armies exist; the
> presentation of scale does not."*

And the cause is a direct contradiction between two files that were both
written here.

**FLAGSHIP.md §4 states the rule:**

> *"The battlefield must not be flat. At 2.1 m on a plain both armies compress
> into a 40-pixel band at the horizon — a raindrop cannot see a war. At 15 m
> looking down a shallow slope you see into the depth of both lines. Every
> reference plate is shot from a rise or across a bowl. **The generator must
> put the player on the lip of one, front at the bottom, 12–18 m of fall.**"*

**And the generator does the opposite, deliberately, and measured it:**

> *"…returns a height closure in which **the high ground FLANKS the line and
> never sits on it**, with exactly one chokepoint and a ridge field running
> along the advance. Measured across five reasons and two seeds: **nearest
> high ground 63–166 m from the line** against standoffs of 38–58 m, **zero
> exceptions.**"* — `src/game/Waves.js`, the note over `MODES.theline.seedsGround`

The spec says stand him on the lip. The generator puts the lip sixty-three to
a hundred and sixty-six metres away from the fighting, every single time,
without exception, on purpose. **The generator won, and nobody noticed the
spec had lost.**

Two more things compound it:

- **The army arrives in threes, forever.** `MAX_CONCURRENT = 3` in
  `src/game/Arrivals.js:280` — *"Three is a busy sky; four is a queue"* —
  against waves that peak near 48. The giant battle cannot land in one shot
  because the sky is rationed.
- **The fifty seconds from Deploy to the first enemy is an on-rails flight
  with the camera under authorial control**, and it is spent on scenery. It is
  a free director's shot, once a run, and it does not show you the war it is
  flying you into.

---

## 3. The field, and why every candidate died

Twelve candidate modes were priced against the real code and then attacked by
eight hunters, each hunting one failure. The result was close to unanimous.

| Candidate | Verdict | The kill |
|---|---|---|
| Order 66 | expensive | It is `e.team = 1`. A clone trooper is **46 hp**, the softest body on the roster; the premise needs your men to be terrifying and the numbers say they are the least dangerous thing the game can spawn. And it can only be played once, because it eats the company. |
| The Colossus | expensive | It is an archetype and a `SET_PIECE` row, not a mode — and the repo already measured that big bodies *"are the same act to fight as a B1 with more hit points"*. |
| Both Sides | expensive | Half ships already (pick the Sith order). The other half is barred: `RapierWorld.step` derives its substep count from real frame time, so this world cannot be re-derived. |
| The Trooper's Eye | expensive | 6 new files, ~3,110 lines, 11 existing files touched including the two largest in the repo. Not blocked — just not available at the size you asked for. |
| The order you should refuse | **moderate — and already built** | `src/game/FireMission.js` is **861 lines of exactly this design**, shipped: the ellipse, the twelve-second read at 3× under Force sense, shells that pay full damage on your own men, the after-action line *"by your own fire mission"*. And a green check refuses to let it become a second mode. |
| The Night | expensive | The sight half is nearly free; the renderer half is not. The ink is a light source at a fixed luminance and does not know what dark is. |
| The Siege | moderate | Four fifths of it is reachable today: Skirmish, one ground, nine engagements. |
| The Column | expensive | Inverts the premise the whole front apparatus rests on: *"THE PLAYER DOES NOT MOVE BETWEEN ENGAGEMENTS. That is the whole point."* |
| From the Bridge, The Memorial, The Asymmetric Duel, The Gauntlet | various | Each is a flag, a condition, or a presentation of something that exists. |

**And then all eight hunters, independently and without being asked to agree,
returned the same verdict about the whole exercise: do not add a card.**

Their evidence:

- **The menu is physically full.** Ten cards, **788 px of them into a band
  measured at 466 px** at 1920×1080 and 368 px at 1280×720; three of six mode
  cards once measured **0.000 visible** at `scrollTop 0`.
- **You cannot already tell the modes apart.** *"explain the difference between
  trail of waves and path of the blade"*, and *"explain to me what campaine
  mode is? the only map is colosseum I'm just confused what it is"*.
- **This repo's last five design wins were all subtractions**: six levels, four
  rooms, the Descent, the dojo, The Front.
- **The mode this project last added, you deleted.**

The governing line is the repo's own, from the roster cut: *"a menu is judged
by what a player can pick wrong."*

---

## 4. THE PLAN — three moves

### MOVE 1 — Land him on the lip *(small; the thing you asked for five times)*

Reconcile the spec and the generator, in the generator's favour on shape and
the spec's favour on where the player stands.

1. **`Battlefield.js` gains a stand.** The height closure already lays a bezier
   front and a ridge field; it gains one more decision — a lip on the player's
   side of the line, **12–18 m above the front, 60–90 m back**, which is the
   figure FLAGSHIP §4 already specifies and the only figure in the two
   documents that neither of them disputes. The high ground still flanks; it
   simply also has a place to stand on.
2. **The insertion lands on it.** `Extraction`'s twelve phases already own the
   camera. The last one arrives over the lip with both lines formed and in
   frame at touchdown. The fifty seconds stop being scenery and become the
   establishing shot of the battle you are about to be in.
3. **The wave lands in one shot.** `MAX_CONCURRENT` scales with the quality
   tier instead of being a constant 3, so a 48-body wave arrives as a wave.

**What it costs:** one new decision in a generator that already makes six, one
landing mark, one constant made a function of the tier.
**What it buys:** the first thing you see on every deploy, in every mode that
generates ground, is a war.
**The kill test, day one:** boot the generator on five reasons and two seeds
and count the men inside the camera frustum six seconds after touchdown. It is
zero today. If the lip does not take it past forty, the lip is not the answer
and this move is wrong.

### MOVE 2 — The mission axis *(medium; unlimited content, zero new cards)*

**A mode in this game is a row of flags.** `MODES` in `src/game/Waves.js`,
thirty declarable fields — `crossing`, `holdTheLine`, `lineAdvances`,
`objectives`, `fireMissions`, `downed`, `seedsGround`, `battles`, `meeting`,
`solo`, `ladder`, `insertion`… Sixty-one places in the tree read that table,
and **every one of them reads a flag, not a mode name.** Each field carries a
comment saying it is a field precisely so that *"the day a fourth crossing is
authored it lights itself"*.

**Ten modes were built out of that vocabulary. Nobody has ever written the
eleventh row from it.** And the container for authored content sits nearly
empty: `CAMPAIGNS` holds **one campaign with two missions**, and a mission is
six fields — `{ level, name, brief, engagements, pressure, strength }`.

So: **let a mission declare the mode-flag vocabulary.** That is the whole move.

The moment a mission can say `lineAdvances: false, objectives: ['shield','battery']`:

- **The Siege** is a mission.
- **The Column** is `lineAdvances` with a hull in the formation.
- **The Night** is a mission with the sun under the horizon and `beasts`.
- **The Colossus** is a `SET_PIECE` row plus `pressure`.
- **Order 66** is a `holdTheLine` mission that flips the roster at the ramp —
  and a mission is *allowed* to happen once, which is exactly where a one-shot
  belongs and exactly why it fails as a mode.

Nothing is invented. Every flag is read by `World.loadLevel` and
`CommandDirector` today. And it fixes the standing scandal underneath:
**the four best systems in the game are flags on one mode.** `objectives`,
`fireMissions`, `lineAdvances` and `holdTheLine` are declared on `MODES.theline`
alone. `FireMission.js` is 861 lines of the best design in this repository and
it is reachable from exactly one card.

**Second half of the move, and it is what makes the first half a game rather
than a playlist: give the run a shape instead of a counter.** `planStages`
walks `AREAS` in order. A Grind has no fork anywhere in it; a Raid has none; a
Push has exactly one, and half of all seeds are Pushes — so **half of all
sittings contain one decision about their own shape and half contain zero.**
Two nodes with a visible type and unknown contents before each engagement —
assault, hold, column, cache, duel, evac — is `SCOPE.md` §4's first absence,
and the fork machinery (`routeChoices`/`takeRoute`) is **already built and
starved of table**: five hand-written `AREAS` rows can offer at most one
alternative, only in the middle.

**The kill test, day one:** author one mission that declares three flags it
does not own today and play it. If it needs a single line of `mode === '...'`
anywhere in the tree, the axis does not exist and this move is wrong.

### MOVE 3 — The seam *(the one genuinely new mechanism)*

Restore `Mass.js` and build the piece its own header says is missing: a rank
you walk toward becomes twenty real bodies, and folds back into a rank behind
you.

Four designers took this independently and **all four found the same seam**:

**The swap happens where the renderer already cannot tell the difference.**
`INK.edgeFade` fades the silhouette to nothing by ~130 m and `L3_AT` starts the
instanced rung at 137.8 m. In the band between, an instanced man and a real
merged-skin body are the same picture — so a swap there is invisible **by
construction rather than by tuning.**

And all four converged on the mechanism: **not a spawn, a lease.** A warm pool
of pre-built chassis is lent to a rank's men while they are inside the band and
handed back outside it. Construction is the expensive part and the pool removes
it. The exchange rate is measured off `Mass.js`'s own four rows — 26 → 6.4 ms,
120 → 15.0, 200 → 25.5, 320 → 42.8 — which fit to **0.124 ms a real body over
a 3.2 ms world intercept, against 0.0119 ms an instanced man. One real body
costs ten instanced men.** The seam may not raise the 40–60 ceiling; it only
decides which bodies are real.

**Their honest doubts, kept rather than buried:**

- **Demotion is harder to hide than promotion.** A body put exactly where its
  instance was is invisible; a body that has been real for thirty seconds has
  walked out of its file, been shoved, and is aiming somewhere its block is
  not. Nobody claims to have solved this.
- **The behavioural seam is not the rendering seam.** `Rank.place` is a rigid
  5×4 grid re-seated every frame, one facing, no collision, no reaction. A real
  `Enemy` steers, avoids and reacts. The picture matches at 134 m; the
  behaviour does not, and no design proved it invisible.
- **The first frame of twenty bodies entering `world.enemies` together** has
  never been measured.

**The kill test, day one, before a line of the seam is written:** boot the
front as it shipped, lay it on Geonosis, and add real bodies one at a time at
40 m taking the median world update after each. That gives the exchange rate
directly. Then the pixel test: twenty real bodies and twenty instances of the
same archetype in the same 5×4 grid at 134 m, and diff the frames. If they are
distinguishable, the whole approach is wrong and it costs a day to find out
instead of a week.

---

## 5. The ledger underneath, and one decision that is yours

None of these is a feature. All five are measured, all five are live in the
build you are playing, and the first two outrank everything above.

**1. The presence loop is a pure cost, and it has been measured three times.**
FLAGSHIP §2 says the whole design rests on *"You are not the protagonist. The
squad is… your job is to be the reason the line is still standing."* Five
seeds, three arms — no player, player with blade, player with the blade
disabled — **15 of 15 rows identical**: 3/3/3 waves cleared, 1/1/1 areas taken,
37.4 / 36.8 / 36.4 enemies killed. The only columns that move are the clock
(207 → 321 → 467 s) and **your own dead (0 → 7.2 → 7.4)**. Put the other way
round, which is the way that stings: an engagement fought with no Jedi at all
leaves **6.7 of ten men standing; with a Jedi in the line, 4.7.** The line is
standing more often when nobody comes. A Jedi holding
station a hundred metres away costs the line exactly as many men as one
standing in it. Three separate fixes were built against this — OPEN, THE
SCREEN, BREAK — and all three measured flat or negative; BREAK fires at 0.00%
of enemy-seconds. **On the shipped numbers, standing with your line is strictly
worse than fighting away from it.**

**2. And the reason your men die is your own army.** One Command battle, every
hit on a friendly body counted at the door: **47 hits, 569.8 damage, 100% of it
fired by the player's own team. Zero hostile bolts reached a trooper at all.**
Taken three times on three builds — 47 / 30 / 22 hits — always 100% own-team.
`TEAM_DAMAGE_DEFAULT` is 0.35 and has been on since Command was written, and
nobody had counted what it was doing. **A rank that will not fire through its
own men is the single highest-value change on this page.**

**3. The wave director is deleting 62% of every wave in Command — and the
decision is yours.** `WaveDirector._watchdog` scores a body's progress as its
distance to the nearest live *player*; in Command the horde's fight is your
*army*, so with no player near them every enemy reads stalled and is retired.
Measured: **39.4 retirements a wave against the 10.5 bodies the line actually
shot.** It fires every frame after the commander goes down. **The fix is 63
lines and it is already sitting in the tree at `tools/_watchdog.patch`.** It is
not applied because with it the unaided line is wiped on every seed and a
shipped check goes red at 0.0 of 10 — so landing it lands a difficulty re-tune,
and which knob gives (wave budget, `RULE_MAX`, morale, or the target) is a
balance call. **That call is yours and nobody else's. Until it is made, every
balance figure in this repo sits on a floor the director was propping up.**

**4. Four systems step on a co-op client with no gate at all.**
`this.objectives?.update(...)`, `this.fireMissions?.update(...)` and
`this.graves?.update(...)` run at `World.js:3880`, `:3886` and `:3890` — sixty
lines *above* the `netMode !== 'client'` guard at `:3952` that correctly gates
what comes after them. `FireMission.js` contains
the string `netMode` **zero times**, and `Support.js` contains no reference to
the net at all. `Support.js` claims *"AND IT IS SHARED. In
co-op it is one pool for the party"* — and there is no code behind that
sentence and no check pointed at it.

**5. A player at 6 fps is in silent slow motion, and the instrument to stop it
already exists.** `main.js:2837` clamps game time instead of quality.
`Profiler.js` is always-on by design and computes the frame, the GPU time, the
p99, the 1% low and the session's worst frame — *"because the player's
complaint was that it got worse the longer they played"* — and its **only
consumer in the entire tree is a text panel.** `Engine.setResolutionScale` is
written, clamped and has one caller: the settings slider. The wire between the
reading and the knob does not exist. Both of your sub-10-fps reports were
reports of a game that had quietly stopped running in real time, and nothing in
the build could have told you.

---

## 5b. What is actually absent, and the death all three deleted modes died

Eleven modes are **eleven win conditions over one verb.** In every playable
mode you are a Force user on foot, outdoors, killing bodies that walk at you,
until a counter says stop. What differs between two modes is a boolean.

The absences are not content. They are registers:

- **Objective variety.** Every engagement in every mode is *clear what
  arrives.* There is no escort, no retrieval, no timed escape, no destruct
  target, no pursuit, no defence-of-a-thing. **This is exactly what Move 2
  delivers** — an objective is a flag a mission declares.
- **Downtime.** The whole game's rest state is 5.5 seconds. The one place built
  for a quiet register — the Flight Deck, with 111 droids, 20 real men, 89
  silhouettes and 25 repair jobs — is `hidden: true`, has *"no wave, no enemy
  and no ending"*, and gives you nothing to do standing in it.
- **Choice of risk.** One binary fork exists in the whole game, in half the
  seeds of one mode.
- **The chase.** Ten hours produces a list of personal bests in localStorage.
  Seeds are shareable and nothing compares two.
- **Who you are.** Always the same body: a saber and fifteen Force keys.

**And the warning that binds the whole plan.** Three things have been deleted
from this game — the Descent, The Front, and six indoor levels — and *all three
died the same death: their content was a place or a picture rather than a rule
or a roster.*

**Move 1 is a picture.** That is its risk, stated plainly: making the existing
battle visible is not the same as giving you something to do in it, and a mode
that stopped there would die the way the other three did. The repo's own phrase
for the difference is the best sentence anyone produced for this document:

> **A wall you look at is a diorama. A wall you can run into is a moment.**

Move 1 makes the war visible. Move 2 gives it things to be about. Move 3 lets
you run into it. None of the three is worth building alone.

---

## 5c. The five moments this engine could produce and does not

Every one is built from parts that already ship, and the two hard lessons under
them are the same: **the frame is 93–99% draw, so scale is bought in draw calls
and never in bodies** — any proposal that adds simulated bodies is spending on
the wrong axis — and a diorama is not a moment.

1. **The far army becomes real men under your blade.** Two hundred instanced
   troopers marching at two hundred more at 200 m, firing real bolts you can
   deflect; you sprint at the line and twenty of them resolve into full,
   cuttable bodies as you arrive. **This is Move 3, and it is the single
   highest-value image in the game.**
2. **A capital ship comes down on the ground you are standing on.** The same
   752 m hull whose hangar deck you walk, whose aperture you fly out of, whose
   flank you look back at — burning, listing, breaking, and then being the
   terrain for the rest of the sitting.
3. **A hundred-metre animal walks through the line.** The Zillo — already
   starred in this repo's own backlog as *"⭐ RECOMMENDED, and it is the honest
   reading of the note"*, because the audit of your giants request found that
   *"five machines were built and no creature."*
   Its plates are proof against blaster fire, so the whole army's volume of
   fire does nothing; its underbelly is not; and its death is a topple.
4. **A thirty-five-metre siege gun plants, and you are either driving it or
   underneath it.** The SPHA banks 1.6 s of stillness before it may fire, holds
   station through a 2.6 s charge tone, and **cannot depress its gun.**
5. **Your own barrage walks across your own men and you watch them run out of
   it.** Forty-two metres wide, nine seconds long, seven seconds of warning,
   measured at 21 of 22 bodies — and the ground still black there next
   engagement. **This one is built today and reachable from one mode card.**

---

## 6. Build order — every step ends in a test that can kill it

| # | Step | Ends in |
|---|---|---|
| 1 | Count the men in frame six seconds after touchdown, on five reasons × two seeds | The number. It is zero today. If the lip cannot take it past forty, Move 1 is wrong |
| 2 | The lip in `Battlefield.js`, the landing mark, `MAX_CONCURRENT` by tier | The same count, taken again |
| 3 | Count friendly-fire hits by source in one Command battle | If it is not ~100% own-team on this build, defect 2 is stale and the fix changes |
| 4 | A rank that will not fire through its own men | The count again, and the casualty list |
| 5 | Author one mission declaring three flags it does not own today | Zero occurrences of a new `mode === '...'` anywhere |
| 6 | The route fork: two nodes, visible type, unknown contents | A Grind that contains four decisions instead of none |
| 7 | The exchange rate, measured on the restored front | 0.124 ms a body against 0.0119 an instance, or the seam is off |
| 8 | The pixel test at 134 m, twenty real against twenty instanced | Indistinguishable, or the seam is off |
| 9 | The lease pool, promotion only, no demotion | Walk into a rank. Nothing pops |
| 10 | Demotion, and the behavioural seam | The doubt the designers refused to bury |

Steps 1, 3, 7 and 8 are measurements, cost a day between them, and each can
kill the move above it before any of it is built.

---

## 7. What this deliberately does not do

- **It adds no menu card.** Ten is already 788 px into a 466 px band.
- **It does not reopen `keep()` or the muster.** Permadeath and the pre-run
  slate are the emotional spine and Move 2 goes around them, not through them.
- **It does not touch the blade, the Force economy or the army's brain.** All
  three are the best-argued code in the repo and every move above runs beside
  them.
- **It builds no indoor place**, keeps every arrival and departure a ridden
  transport, adds no cross-session power and no save/resume, and gives the
  player no grenade.
- **It does not resurrect The Front under its own name.** The mass tier comes
  back as the thing a *mission* can ask for, with the seam that was missing
  when you deleted it.

---

## 8. The runners-up, kept warm

- **The Colossus** — ship it as one archetype plus one `SET_PIECE` row and it
  appears in every mode that composes a wave, which is far more play than a
  card would ever get. If the *climb* is the real idea, spend the budget
  there: `Enemy.platform()` returns exactly one axis-aligned box, and
  **`_measurePlatform` opens `if (!this.A.big || !this.rig) return;` — so the
  Acklay, which the code's own comment names as one of the two things you can
  stand on, has no standing surface in the shipped game.** Per-bone oriented
  platforms make the walker and the Acklay climbable the same afternoon, and
  that is a new verb. A bigger monster is a bigger number.
- **Order 66** — as the *ending* of a Line session whose betrayal ledger has
  bottomed out. `MORALE.BETRAYED = -0.20` already fires when you use a Force
  power on your own men; `FireMission`'s `TRUST_LOSS` already tracks how you
  answer High Command. Earned rather than picked, and it needs no card, no
  director and no new flight.
- **Both Sides** — `CommandDirector.log` **already records every order, every
  delegation, every hold, every commander Force cast, every reinforcement buy
  and every enlistment**, written for the after-action report and never used
  for replay. The ghost commander is already in the tree.
- **The Column** — you can already drive the thing you would be escorting.
  `whyNotDrive` has four refusals and no mode axis, and its rule is *"a tank
  your army brought to the field is a tank you are entitled to"*.

---

## 9. The one sentence

You did not need a new mode. You needed to be standing somewhere you could see
the one you already have — and then to be able to walk into it.
