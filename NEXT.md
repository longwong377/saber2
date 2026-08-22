# START HERE — after the second playtest, with the kill tests answered

Written 21 Aug, end of the second playtest session. Short on purpose.
Everything it points at is long.

---

## The master list is `BACKLOG.md`

Everything outstanding — the unfinished part of V3, all of V5, and the Flagship
rungs — is merged into one ordered list in **`BACKLOG.md`**, with the reasoning
for the order and the evidence for anything already ticked. The player asked for
exactly that: *"maybe it wouldn't hurt to get them all on the same list for
future easy reference (in smart order). We will make sure nothing is missed."*
Read it after this file and work from it.

---

## Read these five, in this order

1. **`HANDOFF.md` §2** — the traps. §2.1 will silently invalidate every
   measurement you take if you skip it. §2.2b is why parallel lanes keep
   committing each other's files, and it bit again this session (see below).
2. **`PLAYTEST.md`** — what the player found by playing. **This outranks every
   measurement in the repo.** Its newest section now carries a "what came of
   it" table: one line per finding with the number that decided it.
3. **`assets/flagship/README.md`** — the three kill tests' artefacts, and the
   only place the Step 1 answer key is written. **Do not read the answer key
   before you show the plates to somebody.**
4. **`FLAGSHIP.md`** — the design for THE LINE. §14's three kill tests have now
   been RUN; the verdicts are below and they change what §14 says to do next.
5. **`ROADMAP.md` PART TWO** — why progression died here twice.

Do not read the rest of `HANDOFF.md` cover to cover. It is a reference.

---

## The kill tests are answered. This is the headline.

`FLAGSHIP.md` §14 says a "no" is a good outcome bought cheaply. Two of the
three came back qualified and the third came back with a sign nobody expected.

### Step 0 — crater persistence: **NO, and the reason is measurable**

The mechanism is exact and nearly free. One fought Command area logs **539
craters**, replays onto a freshly generated world with **max |Δh| = 0** across
all 33,856 cells, costs **15.8 kB against a 406 kB grid (26×)** and replays in
**2.5 ms** headless, 23 ms in the browser.

What it cannot do is show. 520 of those 539 are a bolt hitting sand and
Geonosis' heightfield cell is **2.47 m**, so `Terrain.crater` widens anything
under 1.35 cells and shallows it to conserve volume: a bolt scuff lands as
**3.35 m × 1.6 mm** and the biggest mark an ordinary battle makes is **3.35 m ×
133 mm**. Between the before and after plates **1.9%** of pixels differ in the
wide shot and **0.5%** at eye height. Twenty sorties reads as **dunes, not
shelling**.

**So visit two reads as the same ground, and not as ground after a battle.**
The battlefield's visible marks live in `Surface` — a transient 24 m window
that follows the player — and in decals, and the crater log carries neither.
That is the thing to fix if this is worth another day: persist what is DRAWN,
not only what is dented.

> **DONE, AND THE VERDICT TURNS OVER.** `Terrain.scars` is a second
> `SurfaceField` with three of its rules inverted — it is the whole map rather
> than a 29 m window, it never ages, and its burns STACK — so a square metre
> hit forty times is black where one hit once is a scuff. It costs one extra
> `texture2D` on the ground and 1.77 MB a Terrain at a 1.6 m cell that does not
> move with the quality tier (what the ground remembers is not allowed to be a
> settings slider, for the same reason `CraterLog` refuses to snapshot a grid).
> `Terrain.burn` and `Terrain.crater` feed it by construction, so every call
> site that already marks this ground got the permanent half for free, and
> `Terrain.scorch` is the new verb for a mark with no fire behind it.
>
> The same log, the same seed, the same camera:
>
> | | before | after |
> |---|---|---|
> | wide shot, one fought area | 1.9% | **13.2%** |
> | eye height, one fought area | 0.5% | **11.0%** |
> | eye height, twenty sorties | — | **33.4%** against the one-area plate |
>
> The log grew a second list for the marks that were only ever DRAWN — the bolt
> that scorched the sand without moving it — and `CraterLog` wraps `scorch` the
> way it already wrapped `crater`. v2 files carry both lists and a v1 file still
> loads. Replaying from the live log is exact to the bit on BOTH channels; the
> JSON round trip's centimetre of rounding flips four cells in sixteen hundred
> at a bowl rim, which is a number the check reports rather than hides.
>
> **Ask a person again.** `assets/flagship/step0/` has the new plates.

### Step 1 — the marching front: **qualified YES**

Pixels differing between plates: **1↔3 = 7.0%, 3↔5 = 17.2%, 1↔5 = 21.0%.**
Monotone, so there is a real ordering signal. Engagement 5 is unmistakable — a
wall of smoke and a band of hulls at 40–80 m. Engagement 3 differs from
engagement 1 only by a pale haze at 100 m, because the smoke columns' tip
colour is the fog's and Geonosis' fog is a cold grey-blue (§11's
biggest-visual-defect, confirmed live).

**Hand `assets/flagship/step1/plate-alpha|bravo|charlie.png` to the player and
ask them to put the three in order.** That is the test; it has not been run on
a person yet.

> **RE-TAKEN. The weakest pair tripled and the variable is now on the GROUND.**
>
> | pixels differing | before | after |
> |---|---|---|
> | 1 ↔ 3 | 7.0% | **20.5%** |
> | 3 ↔ 5 | 17.2% | **28.8%** |
> | 1 ↔ 5 | 21.0% | **45.2%** |
>
> Four changes on the ground and one in the air. The craters paint as well as
> dig (Step 0 above). `Front.burnBand` lays the line's own burnt swath into the
> scar field, additive per engagement — so ground beyond engagement 1's line
> carries five bands by engagement 5 and ground just past engagement 5's carries
> one, and that gradient is not authored, it is what *fought over five times*
> means. `src/world/Fallen.js` is §12.4's 520 prone instanced figures, the one
> of `Front.js`'s five ground marks that was listed as **absent and not faked**:
> two poses, two draw calls, per-instance tone, 103 triangles a body. And the
> smoke's alpha is banded into five steps, which is §11's third named art
> defect ("the one un-cel thing in the frame").
>
> **What is NOT fixed, and it is §11's biggest one.** Measured live on
> Geonosis: the authored `fogColor` is `#d0a473` at hue 26°, and what actually
> renders is `#a6adb2` at **207°** — a cold blue-grey, 181° round the wheel
> from the level's own dust, at luminance 0.676 against a smoke body at 0.023.
> The cause is `Engine.hazeRadiance`, which takes 88% of the haze's hue from
> the DRAWN sky, and the drawn dome is a Preetham blue held at `uSkyTurn`
> identity on purpose — Engine.js argues in place that the dome must match what
> is painted and that a level's `gain` is where its author put the orange.
> §11 says to turn the dome, the fog and the aerial tint together. **That is a
> lighting-layer decision across all seven levels and it was left alone.** The
> front now reads without it.

### Step 2 — the Dead Jedi test, RE-TAKEN: **the presence loop is, in the numbers, a pure cost**

The original table was measured through two broken instruments and both are
fixed. `foeDown` was a **corpse census** — `world.enemies.filter(e => e.dead)`
at the sampling instant, with `Corpses` disposing bodies as the run went on and
the three arms running for wildly different lengths, so the shortest arm was
reported as killing three times more when all it had was fresher bodies. And
morale read a saturated **1.000** in both player arms, so the channel §7's
whole argument depends on could not move at all.

Re-run on the same five seeds with kills counted at `onEnemyKilled` and morale
unpinned. **15 of 15 rows, every seed, every arm:**

| | no player | with blade | blade disabled |
|---|---|---|---|
| waves cleared of 3 | **3** | **3** | **3** |
| areas taken | **1** | **1** | **1** |
| enemies killed | 37.4 | 36.8 | 36.4 |
| fallen (your men) | **0** | **7.2** | **7.4** |
| game-seconds | 207 | 321 | 467 |
| morale | 0.87 | 0.84 | 0.84 |

**The outcome is identical in all three arms and it is identical on every
single seed** — same three waves, same area, same number of enemies dead. What
changes is that the fight takes half again as long with a Jedi in it, more than
twice as long with one who cannot cut, and that **seven of your men die who
would otherwise have lived**.

The sharpest way to say it: the script Jedi does real work — 867 to 2,177
points of blade damage a run — and the enemy body count does not move. **Its
kills SUBSTITUTE for the line's rather than adding to them.** Take the blade
away entirely and the body count still does not move; only the clock and the
casualty list do.

That is a far stronger statement of §7's problem than "costs 7.5 men", and it
is the thing to answer before building the mode. Presence has to buy the line
something a number can see — faster, or further, or fewer of them dead — and at
the moment it buys none of the three.

**AND THE FOURTH ARM SEPARATES THE TWO EXPLANATIONS.** A Jedi alive, armed,
fighting whatever reaches him, holding station **a hundred metres from the
line** — same script, same guard, only the station moves. Three seeds:

| | no player | with blade | blade disabled | **a hundred metres off** |
|---|---|---|---|---|
| fallen (your men) | 0 | 6.33 | 7 | **6.33** |
| game-seconds | 196 | 362 | 445 | **245** |
| waves / areas | 3 / 1 | 3 / 1 | 3 / 1 | 3 / 1 |

**A Jedi a hundred metres away costs the line exactly as many men as a Jedi
standing in it** — 6.33 against 6.33, which puts `far` at 1.00 on the
none→blade axis. So the seven men are **not** the price of presence. They are
the price of a player EXISTING on the field for the horde to walk toward.

What standing WITH the line actually costs is **117 seconds** (362 against
245) and it buys nothing measurable. On these numbers, holding station on your
own formation is strictly worse than fighting away from it.

**Caveats, and they are real.** The player is a **script**, so this measures
what a body standing in a formation and swinging is worth, not what a person
is. Three to five seeds. And the `none` arm is genuinely an easier fight,
which is the thing the `far` arm exists to control for rather than to deny.

### …and then §7's OPEN verb was wired, and SCORED — it does not pay

> **THE FIRE-SHARE HALF OF THIS SECTION IS WITHDRAWN — the 0.08 was the
> instrument.** The table below and the four-arm pair above still stand; the
> `targetFor` diagnosis under them does not. See "OPEN: the line was never
> starved of the target" at the end of this file for the corrected numbers and
> for what actually bounds the verb.

`grep -rn 'openness(' src/` returned one call site — the blade's own slash rate
— so "the Force is a multiplier on other people's guns" had never been wired to
a gun. It is wired now, at `World._boltHitTest`, and the mechanism is proven
directly: same bolt, same body, two droids side by side, **38.0 hp standing
against 114.0 hp held — 3.00× against a stated 3.00×** (`force.mjs`).

**It does not show up in a battle.** Two worktrees off the SAME commit,
differing by one line — `const open = openness(e)` against `const open = 1` —
same five seeds, nothing landing in the tree while they ran. Values are
`OPEN off → OPEN on`:

| | no player | with blade | blade disabled | a hundred metres off |
|---|---|---|---|---|
| fallen | 0.2 → 0.4 | 7.0 → 6.8 | 8.2 → 8.0 | 5.8 → 6.2 |
| enemies killed | 35.2 → 31.6 | 30.4 → 29.0 | 29.8 → 29.0 | 31.2 → 31.0 |
| game-seconds | 192 → 181 | 270 → 344 | 466 → 451 | 245 → 248 |
| areas taken | 1 → 1 | 1 → 0.8 | 0.8 → 0.8 | 1 → 1 |

**No arm improves beyond noise, and the only movement worth a sentence is in
the wrong direction** — the `blade` arm got 27% longer and lost an area in one
seed of five.

**Why it cannot pay, and this is the useful part.** `OPEN_STATES` fires while a
body is `gripped`, `yankT > 0`, or `toppled || stunTimer > 0`. In a
270-second battle a script Jedi holds one droid at a time for a few seconds
each, so the share of enemy-seconds spent open is tiny — a 3× multiplier on
almost none of the fight. The verb is not wrong; it is too rare to matter at
the scale §7 wants it to matter at. **The measurement that would settle it is
open-seconds as a fraction of enemy-seconds**, and it has not been taken.

**A correction to an earlier reading in this file.** When the `none` arm moved
between two runs, that was put down to a roster change landing in between. It
is simpler than that: `stunTimer > 0` is an open state, your own troopers stun
droids all battle, and **OPEN is symmetric** — it reaches the arm with no
player in it. The no-player arm moving is evidence the verb is live, not
evidence the runs were uncontrolled.

Left standing rather than reverted: it implements a documented design intent
and the mechanism is correct. What is wrong is the expectation §7 sets for it.

---

### …and then SUPPRESSION was built, and it does not pay either — but the reason is new, and it is the answer

`FLAGSHIP.md` §6 hands the presence problem one candidate: a bolt answered by
the player is a bolt that did not arrive, and today a bolt is only answerable if
it is aimed at the PLAYER. A Jedi standing in a rank could answer exactly one
bolt in the whole battle — the one aimed at his own chest — and the men either
side of him were on their own. That is built now (**THE SCREEN**, `SCREEN` in
`src/game/Combat.js`, `screenIntercept` in `Bolts.js`, `World._screenFor`, eight
checks in `tools/checks/screen.mjs`), it works, and it changes nothing at battle
scale. Three measurements say why, and they are worth more than the mechanic.

**1. THE FIRE THAT KILLS YOUR MEN IS YOUR OWN.** One Command battle on Geonosis,
seed 3, 150 game-seconds, every hit on a body of the player's own side counted at
`World._boltHitTest` with the owner's team read off the bolt:

    47 hits · 569.8 damage · every one of them fired by the player's OWN team
    0 hostile bolts reached a trooper at all

Taken three times on three builds, 47 / 30 / 22 hits, always 100% own-team. This
re-reads the whole Dead Jedi table. The seven men are not hostile fire the Jedi
failed to stop; they are **your own rank shooting through itself**, because a
Jedi standing in a formation is what brings the horde in among it and a rank
firing into a melee fires through its own men. It is also why the arm with no
player loses fewest: with nothing to walk toward, the fight stays a firing line
at range and no man is ever between another man and a target.
`TEAM_DAMAGE_DEFAULT` is 0.35 and Command has had friendly fire on by design
since the mode was written; nobody had counted what it was doing.

**2. AND THE MEN WHO DIE ARE NOT NEAR THE JEDI.** The screen's reach is
`MORALE.NEAR` — the radius the game already owns for "this Jedi is with these
men". Of **30 casualty-bolts in a 150-second battle, 3 had the victim inside
that radius, 2 inside the arc a guard covers, and ZERO inside both.** The sorted
distances of the victim from the Jedi:

    11 · 11.4 · 11.5 · 14.5 · 19 · 23 · 23.5 · 25 · 27.4 · 29.2 · 29.9 · 30.1
    30.9 · 33.4 · 36 · 36.3 · 37.7 · 37.9 · 39.3 · 40.3 · 42.4 · 42.7 · 46.1
    46.2 · 46.5 · 46.6 · 47.7 · 48.7 · 50.4 · 58.1

**3. BECAUSE THE LINE IS NOT WITH HIM.** Sampled every five game-seconds over
the same battle, the share of your LIVING men standing inside 14 m of the Jedi
is **19.7%**, and the median man goes 12.6 m → 16.1 → 17.4 → 23.3 → 31.2 →
45.7 m over the first thirty seconds. The Jedi holds station on the centroid of
his own roster and the roster walks away from itself.

**So the presence loop cannot be fixed by making presence worth more.** Every
term in it — `MORALE.JEDI_NEAR`, `NERVE.BLADE`, the screen — is a local good
inside a radius, and four fifths of the line is never inside any radius. A
mechanic that pays out at fourteen metres pays out to two men of ten. Widening
the radius until it covers the line is the flat aura all three constraints
forbid, and it would not be presence any more: it would be a passive.

**The thing to answer next is therefore not "what should a Jedi do for the
line", it is "why is the line thirty metres wide".** One of the two obvious
candidates is already dead: it is NOT the arrivals. Tagging every own-team body
the frame it first appears and reading the tag at `onEnemyKilled` — same battle,
same seed — **ten bodies ever existed, no reinforcement ever arrived, and all
ten died**, at these ages and distances from the Jedi:

    14s@13m · 23s@25m · 35s@16m · 40s@22m · 42s@26m
    44s@27m · 50s@26m · 65s@34m · 67s@26m · 68s@15m

The men who die are the men who started the battle, and by the time they die the
median one is **26 m from the Jedi**, against a presence radius of 14. So the
line does not arrive strung out; it comes apart while it fights. That leaves the
formation slots and the steering — `FORMATIONS.line` puts ten men over 24 m
before anybody moves, and every formation carries a `leash` multiplier that lets
them go and get it. Until that is answered, §7's four verbs are all being asked
to pay out to a formation that is not there.

**THE VERDICT ON THE INSTRUMENT §14 NAMES.** Two `git worktree`s pinned to one
commit, differing by one line — `World._screenFor` returning `null` in the
control — six seeds, one engagement, four arms, 24 rows each, run side by side
so nothing could land in the tree between them. Mean `fallen` ± population sd:

| | none | blade | dead | far | screened, blade arm |
|---|---|---|---|---|---|
| **screen ON** | 3.50 | **6.67** ±3.14 | 5.50 ±3.25 | 5.33 | 6.3 |
| **screen OFF** | 3.50 | **4.50** ±2.50 | 6.83 ±2.91 | 5.67 | 0 |

The two no-player arms land on the same 3.50, which is the control working. The
blade arm does not improve; it reads worse by 2.2 men against a standard error
of about 1.2, while the `dead` arm moves 1.3 in the opposite direction. **The
screen's effect at battle scale is not distinguishable from the noise, and the
mechanic only fires six times in a battle.** Stated plainly: on the axis
FLAGSHIP §14 asks for, the mechanism has failed, and the three measurements
above are why.

**What the screen actually is, for whoever picks it up.** It is not reverted,
because the mechanic is correct, priced, bound and legible, and it is the right
answer to a line that stands together:

- A bolt on its way into one of your own men, crossing ground you are standing
  on, inside the arc a guard covers, is a bolt you can take. Four gates, all
  four required.
- The price is Force **by the metre**, derived rather than chosen:
  `GUARD_COST.unanswered` already prices one bolt the Force answered for you at
  `CATCH.autoRadius`, and this is the same event further out. Measured through
  the shipped bill, 1.18 Force for a man at 2.9 m against 4.81 at 12 m.
- `screenReach` is that formula solved the other way, so **the reach IS the
  bar**: the screen collapses toward the Jedi as the Force drains and comes
  back as it refills. No new HUD element — the Force bar is the readout.
- It is not an aura. A bolt aimed two metres wide of a man is not answered and
  not charged for, tested against the body's own `capsules()` fan. The first cut
  used the body's bound sphere, which stands a metre off the chest, and that was
  **128 bolts screened for 8 fewer arriving** — sixteen near misses answered for
  every shot that was going to land.
- On a rank that DOES stand together it is decisive. Four men, 1.5 aimed bolts a
  second each, twelve seconds, one variable between the arms — a full Force bar
  against an empty one:

  | | bolts that arrived | men standing |
  |---|---|---|
  | full bar | **0%** | **4 of 4** |
  | empty bar | 40% | 1 of 4 |

### The Dead Jedi instrument has lost its axis, and it is worth knowing before the next run

Two things about `tools/_flagship.mjs` step 2 on this tree, both measured while
running the A/B above in two `git worktree`s pinned to one commit and differing
by one line:

- **`fallen` is saturated at three engagements.** Every arm loses exactly 10 of
  14 and ends with exactly 4 standing — no player, a Jedi in the line, a Jedi a
  hundred metres off. It moved when §14 was written (0 / 7.2 / 7.4); it does not
  now. So the probe grew `boltsIntoLine` and `damageIntoLine`, counted at
  `_boltHitTest`, and reports `screened` beside them.
- **The arms are no longer reproducible seed for seed.** Two `none` arms — no
  player in the world at all, identical code, identical seed — read `fallen` 5
  against 8, and 2 against 4, and `damageIntoLine` 307 against 373. Whatever
  used to make this probe deterministic per seed is gone, and three or five
  seeds can no longer resolve a difference of one or two men. Anybody reading a
  step-2 table from here on needs that number in front of them.

### FLAGSHIP §7's BREAK verb is on the wire, and it is 0.00% of a battle

`Nerve.js` was built last session and nothing called it. It is called now —
`nerveTick` in `World.update`'s per-frame pass over the roster, `witnessDeath`
at `onEnemyKilled`, `turnedHome` at `World._boltHitTest`, and `nerveAim` /
`nerveBroken` / `nerveRefusing` read by `Enemy.aimQuality` and `Enemy`'s steering
— and every unit-scale check of it passes: a rank frozen inside `BLADE_REACH`
comes apart in the eleven seconds the table says it should.

What none of those can say is what share of a real battle a real horde spends
broken. Measured, Geonosis, Command, the Jedi walked onto his own line's
centroid every frame with the blade lit and never leaving it — the kindest
condition `NERVE.BLADE` can be given:

    2043 hostile body-seconds · broken 0.00% · refusing 0.00%
    steadiest-shaken body on the field 0.863, against a 0.24 line

Not small. None. The arithmetic is the table's own: `BLADE` is −0.115/s against
a +0.05 rally, so a full-nerve body needs **eleven and a half seconds standing
inside 6.5 m of a lit blade** to cross `BREAK` — and a body that stands inside
6.5 m of a Jedi for eleven seconds is a body the Jedi has killed.
`COMRADE_FELL` is −0.055 against a rally that erases it in 1.1 s, so it takes
fourteen deaths inside 11 m inside about a second to break the man beside them,
and a wave does not die like that. The check
(`tools/checks/break.mjs`) asserts the wiring and reports the share, because a
bound on the share would be a bound on the wave composer and the spawn cadence
at once.

---

## Where the tree is

- **7 levels, 8 modes, 1 campaign, 35 archetypes.** Run `tools/state.mjs`
  rather than believing that sentence — it printed those four numbers a moment
  before this line was written, and four more archetypes arrived since the last
  time somebody typed them here.
- Gate was ~1553 two sessions ago, ~1620 one session ago, and **1718 passed / 0
  failed** at the end of this one. **Re-run it before trusting anything.**
- **The live link follows the default branch.** This session's work is on
  `claude/borz-menu-transport-ship-r29efk`. If it has not been merged, the
  player has not seen any of it.
- **`tools/checks/frontdoor.mjs` is new and is the one that opens the page a
  player opens** — the shipped tree in a real browser, not the packed build.
  It caught a broken deploy the same day it was written.

---

## What this session did — V5, and everything under it

**The V5 list is closed.** Fourteen notes, each with the measurement that
settles it, in `PLAYTEST.md`'s newest "what came of it" table. The two worth
knowing about:

- **The Force barrier had never been built.** The player asked for it in an
  earlier list and asked again — *"i'd already asked for it but I could have
  missed it"* — and they had not: there were eleven Force verbs in `POWER_COST`
  and none of them shielded anything. It exists now, as a held channel rather
  than a timer: 18 to raise, 6/s to hold, 4 a bolt, regen paused while it is up.
  Bolts die on the SURFACE of the sphere, a muzzle already inside the radius
  still shoots the man in it, and blades come through blunted by 35%.
- **The saber catch was 38 centimetres of arithmetic between two correct
  files.** The pick-up measured to `player.position` — the FEET — while
  `_updateGrip` clamps what it holds to 1.4 m in front of the CHEST. 1.98 m
  against a 1.6 m reach: the closest the Force could ever bring your own weapon
  was permanently, and silently, out of your hand. This is the shape of defect
  this repository keeps finding, and it is worth more than the fix.

Also landed: the giants (five machines at canon dimensions, each with a derived
weak point); eighteen support calls, renamed off Helldivers' word and released
along a ladder inside one run; the Separatist transport; drivable vehicles —
the four with a CREW, because a hailfire has nobody in it to displace; a line
for every Force power through the synthesised larynx; and the whole of the
muster, the blast door, the puppet line and the L2 rung.

Four things came out of `NEXT.md`'s own open list rather than the player's:
grenades on the wire, morale unpinned, a felled trunk giving a floor (0 of 9
did), and a `boxTopAt` that is exact for a rotated box.

Gate at the end: **1718 passed, 0 failed.**

---

## What the session before it did

**Stream A — the player's list, finished.** Every item, with the numbers, is in
`PLAYTEST.md`'s "what came of it" table. The four that were repeats:

- **Invisible troops.** A hold was a LATCH — only `releaseGrip` cleared it — so
  a gripper who died left a body limp, brainless, suspended and invisible for
  the rest of the level. It is a lease now (`Enemy.hold`), and
  `Enemy._auditVisible` asks three times a second whether a living body draws
  anything at all, so the next way to hide one is covered too.
- **Forest invisible walls.** `STEP_UP` is 0.45 m and the median trunk in that
  wood lies 0.55 m off the ground: **half the timber was a wall by ten
  centimetres.** Logs are climbable, their colliders are the shape of the wood,
  and a cut stump is solid — a 25.1 m trunk cut at 23.1 m used to leave a spar
  you walked straight through.
- **Force lightning.** It drew nothing when it hit nothing, which is what a
  player tries first.
- **The attunement star chart.** Gone, rebuilt as six plates of rungs.

**Stream B — the kill tests, run.** Above.

---

## Open, and worth a decision

### Closed since this list was written

- ~~**Grenades are not networked.**~~ They cross now, as events rather than as
  state — recorded at `GrenadeField.throw`, replayed at the far end, and the
  guest's copy is a PICTURE: it flies, it bangs, men dive from it, it leaves the
  hole, and it does no damage, because the host already did that and the result
  arrives as hp. `coop.mjs` measures both halves.
- ~~**`JEDI_NEAR` saturates morale at 1.000.**~~ Two terms, and the first was
  not enough on its own. Presence tapers out at a ceiling of `1 + COMRADE_FELL`
  — so the ordinary worst thing that happens to a man lands on the steadiest
  soldier in the line IN FULL rather than being clipped — and elation wears off
  ABOVE that ceiling, because morale was a one-way ratchet in a battle you are
  winning (`WAVE_CLEAR` +0.34, `AREA_HELD` +0.5, and nothing ever took any of it
  back). With only the taper in, the probe still read 0.98/0.96/0.92 including
  the arm with no player in it, which is what says the ceiling was never really
  about the Jedi. `Enemy.aimQuality` was re-anchored on the resting point at the
  same time, or unpinning morale would have made every allied trooper 12.5%
  worse for free.
- ~~**`works()` and `BlastDoor` on no level.**~~ Sited, and the drive is stable:
  tight 19.1 s · natural 18.8 s · wide 21.7 s, five byte-identical runs. The
  flap was neither the streams nor the door — `Destruction._prepare` does as
  much pre-fracture as fits in a REAL-TIME budget per frame, so the frame the
  revetment finished, a fact about the machine, moved every number. The closed-
  loop breach rule was then measured at **0 enclosed area on all 24 samples** and
  deleted: a blade across a plate lays a bar, not a line.
- ~~**Muster-anywhere is the small honest version.**~~ All three gaps closed,
  and a live bug found underneath the second — turning allies on made a Sith
  fight their own Confederacy hardware on 6 of 7 grounds.

- ~~**The composite grade crushes dark levels.**~~ Closed in `a446c5c`, and the
  diagnosis is worth carrying: the tone curve had no TOE under it. A black
  point that subtracts, a hermite S inflected at 0.5 and a contrast pivoted on
  0.5, all applied over the whole range, take more of a pixel the darker it is
  — 0.20× at 0.06 against 1.04× at 0.71. That is not a curve that is too
  strong; it is a curve whose strength is a function of how dark the level is
  authored, and the exposure meter deliberately leaves each level as dark as it
  was authored, so the two compound. Near-field gain across the seven levels
  went 0.54–0.97× to 0.86–0.99×. The Ember Shelf was losing a third of its whole
  ground; the Colosseum was losing three per cent.

### Still open

- **The presence loop buys the line nothing a number can see — and the reason
  is now measured.** It is not that presence is worth too little; it is that
  **four fifths of the line is never inside any presence radius.** 19.7% of your
  living men are within `MORALE.NEAR` of the Jedi at any moment, the median
  casualty dies 26 m from him, and of 30 casualty-bolts in one battle ZERO were
  fired at a man both inside that radius and inside the arc a guard covers. Two
  mechanics have now been built and scored against this and neither paid — OPEN
  (3.00× on almost none of the fight) and the SCREEN (six intercepts a battle) —
  and both failed the same way, by being local goods in a fight that is not
  local. **The question to answer is no longer "what should a Jedi do for the
  line". It is "why does the line come apart to thirty metres wide".** It is not
  the arrivals: ten bodies start the battle, no reinforcement ever arrives, and
  all ten die spread from 13 m to 34 m. That leaves the formation slots and the
  steering. See the suppression section above.
- ~~**Presence is a FLOOR, not a gradient.**~~ It falls off with distance now:
  full at the shoulder, `MORALE.EDGE` (0.35) at the rim of `NEAR`, nothing past
  it, linear in metres rather than in area. 0.085/s at the shoulder against
  0.030 at fourteen metres. It did not move the Dead Jedi outcome, which is
  itself worth knowing — the problem there is not the shape of the term.
- ~~**Is a Jedi expensive, or merely a magnet?**~~ A magnet. The `far` arm costs
  the line the same 6.33 men as a Jedi standing in it, so presence is not the
  mechanism — a player on the field is. What presence costs is 117 seconds.
- **Standing with your line is strictly worse than fighting away from it**, on
  the numbers as they were: same men lost, half again the time, nothing bought.
  That is §7's problem stated as sharply as this instrument can state it, and it
  is the thing to answer before the mode is built. **On this tree the instrument
  can no longer state it at all** — `fallen` saturates at 10 of 14 in every arm
  over three engagements, and two `none` arms off identical code and one seed
  read 5 against 8. Step 2 grew `damageIntoLine` for that reason; read the note
  in the suppression section before trusting any step-2 table.
- **The horde's nerve is on the wire and spends 0.00% of a battle broken.**
  2043 hostile body-seconds, the Jedi held on his own line's centroid with the
  blade lit throughout, steadiest-shaken body 0.863 against a 0.24 line.
  `NERVE.BLADE` needs 11.5 s inside 6.5 m and a body that stands there that long
  is a body the Jedi has killed. FLAGSHIP §7's first verb is wired, checked and
  inert; it needs a different shape, not a bigger number.
- ~~**OPEN is wired, measured at 3.00×, and does not pay at battle scale**, and
  the cheap fix is a target preference.~~ **Answered, and the diagnosis was an
  instrument fault.** The share of enemy-seconds is **0.90%** — the 2% case, so
  the multiplier is worth about what it is measured to be worth, **+5.1%** of
  the line's damage. The line is not starved of the open body: it AIMS 9.03% of
  its shots at bodies that are open 0.90% of the time. A target preference was
  the recorded next step and it has nothing left to buy. What bounds the verb is
  the WINDOW, and widening it is a design change, not a tuning one. Full
  numbers at the end of this file.
- **First person should be one-handed**, and `HANDOFF.md` §6.0 says to ASK
  before doing it, because it is a decision about what a first-person grip IS.
  The wrist lane's sweep this session is the strongest evidence yet: first
  person barely improves and the elbow cannot reach it, because the arm is
  near-straight and the swivel cone collapses. It has been put to the player and
  is waiting on them.
- **A Command wave was seen sitting `active` with an empty queue, no inbound
  arrival and zero hostiles standing, from 200 s to 350 s.** FLAGSHIP §16's bug
  3. A watchdog in the flagship probe fired zero times across 15 recorded runs,
  so it is reported as seen once and not as reproducible.
- **`topOfProps`' sibling problem, unfixed:** a log that has settled BELOW the
  ground it fell on. Of nine trunks realised in the wood, four had surfaces
  under the terrain and one had fallen to −179 m. The floor query is right about
  all of them; the solver put them there.
- **A joining player bills the host for the HOST'S OWN bolts, and the horde
  pays a ~50% surcharge for it.** Found while chasing a `command-pvp` flake and
  NOT fixed — it is pre-existing, it is core net code, and it moves attrition,
  which another lane is tuning. The road: `_spawnNetBolts` fires the host's
  replicated bolts into the client's own pool as real bolts (deliberately — a
  guest must be able to deflect them), `_boltHitTest` resolves them against the
  client's own mirrors, and `_reconcileClaims` then bills the host for every
  hp its mirror lost "whatever dealt it". So one round fired by a host trooper
  is simulated on both machines and charged twice. Measured on a real co-op
  Command pair on geonosis, 45 s, **the joining player holding `idleInput` and
  firing nothing**: 813 claims reaching the host asking for 15 787 hp, and on
  the horde the host applied **110.6 hp of its own bolt damage and 57.0 hp more
  on the peer's word**. Your own named troopers are spared only because
  `applyClaim`'s `canHarm` gate refuses a peer who may not harm them — 0.0 hp
  of the same road landed on a trooper in the same run, which is the gate
  working. The shape of a fix is that a bolt whose owner is a replicated body
  and which no local blade has touched is the host's own fire and its damage is
  not this machine's to claim; `deflected`/`turned` already mark the bolts that
  ARE. Sizing it first matters: co-op is currently about 50% easier than the
  single-machine numbers every tuning pass was taken on.

---

## How to run lanes in parallel without losing work

This session ran five agents on one tree and **§2.2b bit twice**: one lane
overwrote three files from its own backups to A/B against HEAD and restored
them, leaving a ~40 s window per restore in which a peer's uncommitted edit
could have been reverted; another was 240 lines into an unfinished feature when
a peer considered `git add -A`.

- **Never `git add -A` while another lane is live.** Stage by path, or
  `git apply --cached` your own hunks. Every lane that did this kept its work.
- **Partition by FILE, not by topic**, and say so in the brief. The five lanes
  that shared no files finished clean.
- **A wall-clock bound inside a check is a coin toss** while lanes are running.
  Two checks failed this session at 19–30 ms against a 12 ms bound and passed
  at 7 ms on a quiet box, on identical code. Count the work instead
  (`reactions: none of this costs anything when there is no grenade` is the
  worked example).

---

## How the player wants to be talked to

`CLAUDE.md`, and it is short. Lead with the point. Cut supporting detail unless
asked. One number beats five. They will tell you when they want depth — and
when they do, they want it deep.

**And get it in front of them.** The live link is GitHub Pages off the default
branch. Ten minutes of them playing is worth more than this document.

---

## OPEN: the line was never starved of the target — and TURN, priced

Two of FLAGSHIP §7's four verbs, re-scored. One of them was being measured by
an instrument that had invented the defect it was reporting.

### The 0.08 was the instrument. Corrected, `held` draws 9× the aim it deserves

The recorded diagnosis was that `targetFor` picks the NEAREST hostile, that a
grip drags its victim out of the line's envelope, and that "the one body the
Jedi just made three times as killable is the body nobody is shooting at" —
`held` at **0.08** of its fair share of the line's fire. The next step it
proposed was a target preference.

**There is nothing there to fix.** `tools/_open.mjs` divided bolts landing on
ANY body by the horde's seconds alone, and in Command your own line stands in
`world.enemies` and is shot at all battle: on seed 3, **123 bolts landed on a
body and 19 of them were your line's landing on the horde.** Five sixths of
that ratio was fire going the other way. HANDOFF §2.4, again, and again in the
direction that manufactures a defect.

Counted against the horde alone — two seeds, two engagements, geonosis,
`knight`, `_flagship.mjs`'s scripted Jedi, `grip` and `blade` arms:

| | share of enemy-seconds | of the line's SHOTS | of the bolts that LAND |
|---|---|---|---|
| all open states | 0.90% | 9.03% | 7.38% |
| `held` | 0.513% | **9.12× its share** | 1.95× its share |
| `downed` | 0.388% | 11.97× | 17.65× |

The line aims **nine times** its fair share of fire at a body you are holding.
It was over-committed to it, not starved of it. Three independent readings say
the same thing: 2.52 of 9.9 living troopers had the held body as their pick on
any given frame while the nearest other hostile averaged 33 m against the held
body's 15 m; 67 of 185 trooper shots in one 200 s run were fired at a held
body; and the corrected probe reads 9.12×.

**A target preference is therefore not built, and should not be.** Weighting an
open body above a near one buys nothing when the line is already choosing it
nine times out of its share, and every further increment is fire taken off a
body that is shooting back — the failure the brief for this named ("a trooper
that ignores the B2 about to shoot it in favour of a held body across the field
is worse than one that never noticed"). The design call is that `targetFor`
stays as it is.

### What actually bounds OPEN, and it is the window

Even in the arm where the Jedi grips continuously — retaking the moment the
last body dies or is dropped — a body is in his hands for **19–24% of the
battle** and `held` still only reaches **0.51% of enemy-seconds**, because one
pair of hands holds one body out of a dozen and the choke kills it in about
four and a half seconds. A 3.0× multiplier over that window buys **+5.1%** of
the line's damage, measured directly off the bolts that landed
(`worthOnHits`). That is what the verb is worth and it is what its own
arithmetic always said it was worth.

So §7's sentence is true of one droid and false of a battle: grip a B2 and the
riflemen shooting *that* B2 do need a third of the time, and there are eleven
other B2s. Making OPEN a battle-scale verb means widening the WINDOW — more
bodies open at once, or open for longer, which is `unleash`, a wider `yank`, or
a stun that counts — not a bigger multiplier and not a target preference. That
is a design decision and it is left for the player to make.

**One thing that reads like the cause and is not.** A bolt aimed at an open
body lands 4.1% of the time against 4.8% for one aimed at a closed body (3 of
74 against 16 of 331, seed 3). Holding a body does not measurably hide it.

### A real defect found on the way: a held body reported a dead stop

`Enemy._move` has two branches for a ragdolled body and they gave opposite
answers to one question. The LIMP branch — ragdolled, nobody holding it —
publishes the ragdoll's velocity. The HELD branch wrote `velocity.set(0,0,0)`.
Measured over a Command wave with a Jedi gripping continuously, **a held body
travels 4.75 m/s and `velocity` read 0.00**, and `Enemy._shoot` leads its aim
by `target.velocity * tof` — so a held body was the one target on the field
that nobody in either army led. `Player._updateGrip` had already met the same
lie and worked around it in place.

Fixed as the DISPLACEMENT, not as the chest rigid body: `Ragdoll.suspend`
commands that body at `(target − pos) × 12` and a hanging body sits at a steady
sag under the command, so the chest reads 2.01 m/s while the centre moves 0.09.
Copying it was tried first and is a second lie in the other direction. Bound by
`held.mjs`, which drives a hold point around a 2.5 m arc and compares the
published speed against the body's own travel: 5.29 against 5.29.

It is **not** what starved the verb — see the 4.1% against 4.8% above — and it
is fixed because a field that reports a dead stop for a body crossing the field
at five metres a second is wrong whatever reads it.

### TURN pays, and it pays more than its own table says

The return path was already wired at `World._boltHitTest` (`killed &&
bolt.deflected && bolt.deflector → turnedHome`). What was missing was a price.
`tools/_turn.mjs` takes it, two seeds, two engagements each:

| | seed 3 | seed 5 |
|---|---|---|
| bolts deflected | 206 | 161 |
| returns that killed a droid | 9 | 4 |
| share of deflections that become a kill | 4.4% | 2.5% |
| nerve one turned kill takes off the horde | 0.880 | 0.880 |
| nerve one ordinary bolt kill takes | 0.095 | 0.116 |

**A bolt sent home is worth 8.3× an ordinary casualty to the rank, and
`NERVE.TURNED` against `NERVE.COMRADE_FELL` is only 4×.** The other half is
where it happens: a return is thrown from a blade standing in the middle of a
formation, so `NERVE.SEE` finds four men on average against about one for an
ordinary bolt kill out on the field. `deflection.mjs` separates the two by
killing the same body twice on one rank — six witnesses either way, and the
extra is exactly one `NERVE.TURNED` a man — so the 8.3× is the crowd and not a
double bill.

Six or seven kills in two engagements out of a hundred deaths is the rarity §7
asks for, and each one is worth eight ordinary ones. **TURN is the verb of the
four that pays at the scale its own paragraph claims.**

### Still open after this

- **The line lands about one bolt in twenty.** Every rate above sits on a
  trooper hit rate of 4.1–4.8% against the body it was aiming at, on Geonosis
  at `knight`. `aimQuality`'s own note prices a trooper at 68.7–84.0% against a
  0.35 m torso at its mid band, so a factor of fifteen is going somewhere —
  terrain, cover, bodies in the way, or a target that has moved. Nobody has
  looked, and every fire-share number in this document would change if it
  turned out to be one thing.
- ~~**6 of 39 bolts a trooper fired at a held body struck one of our own men.**~~
  Seen while classifying what the misses hit; the screen lane took the same
  census properly the same day — 47 hits on your own side in 150 s, **every one
  of them fired by your own team** — and answered it. Both readings were taken
  independently, which is the only reason either is worth trusting.

---

## THE LINE is built — BACKLOG 6.7, the last row on the master list

`MODES.theline`. Command and it share a director on purpose — `FLAGSHIP.md`
§14 prices the mode at "~1,100 lines of spine against ~12,000 lines of existing
machinery", and a mode that reimplemented the machinery would be the 12,000
written twice. **One rule separates them**, and it is the rule the whole design
document is an argument for:

> **Command is won by taking the ground. The Line is won by the line.**

`_endCampaign` wrote `won: true` the moment the last area was behind you and
never looked at the roster, so a crossing finished with every name on the
fallen list scored as a victory and read as one. And an emptied roster ended
NOTHING — the only other ending in the game is `World._checkWipe`, which counts
PLAYERS — so a Jedi standing over ten graves kept fighting, took the ridge, and
got the victory card. §2's "a run that kills three hundred droids and loses the
squad is a loss" was a slogan, not a field. `holdTheLine` computes the verdict
off the survivors; `_checkLine` is a second door for a run whose army has ceased
to exist, and it is deliberately a second door, because `_endCampaign` awards
the muster, promotes the living and recalls the survivors — every one of which
is a lie about a run that ended because there are none.

Three things came with it and each closed a hole of its own:

- **A third ending card.** This game had two — you won, you died. The Line has
  one neither describes: the run is over, the army is gone, and **you are still
  standing there**. Telling that player "You are one with the Force" over a row
  reading "Wave reached 4" reports a death that did not happen and asks the
  endless modes' question of a mode that answers a different one.
- **The ground is a seed roll**, across all seven theatres. §13.5: "no room's
  deletion deletes the mode — every level in `LEVEL_ORDER` is a legal seed. That
  is exactly what killed the Descent." The mode was first written with
  `level: 'geonosis'`, which is the Descent's mistake in miniature.
- **`MODES.crossing`** replacing `mode === 'command'` in `World.loadLevel` — a
  mode-name literal in the file whose own notes complain about mode-name
  literals three times on one page. Without it the flagship mode would have been
  handed a plain `WaveDirector`: no roster, no names, no muster, no ending, with
  every menu card still lit.

Eleven checks in `tools/checks/theline.mjs`, and every verdict one drives a real
run to a real ending and reads the summary `onGameOver` delivered.

### The mode's own open question — ANSWERED, and the premise was half instrument

> **CORRECTION, and the passage below is kept because the wrong reading is
> instructive.** This section opened by saying a ten-man roster is wiped out
> inside the first engagement on every seed, that the muster is never reached,
> and that the mode cannot be won. **Two faults were in that measurement and
> both flattered the catastrophe.**
>
> **The muster window was invisible.** `_areaClear` ends with "no screen wired
> — muster and press on", so `autoMuster()` and `closeMuster()` both run inside
> one `payWave` call and `director.mustering` is true for **less than a frame**.
> Every bench polled for it, never saw it, and ran on into areas two and three,
> reporting the roster at whatever wipe it eventually reached. Held open with a
> no-op `onMuster`, a line with **no player on the field takes four areas of
> five**. The muster was always reachable; nothing could see it.
>
> **The idle arm was measuring a magnet.** A Jedi held on his feet and not
> playing is an unkillable target on the deploy mark, and `installLevyAim`
> points forty conscripts at whatever blade is on the field. Five seeds of
> five: **an idle Jedi is worse for the line than no Jedi at all**, 0.0
> survivors against 1.8. The reference arm is *no player*, and every reading
> below that says "idle player held unkillable" is a reading of a magnet.
>
> **The line was still far too cheap, which is the real result**, and it is now
> tuned — see "Attrition is tuned, and the spread is the finding" above. The
> paragraphs that follow are left as they were written.

**The original reading.** A ten-man roster wiped out inside the first
engagement, on every seed, in both army modes, with the Jedi held unkillable:

    theline  seed 1  155s   roster 0/10   theline  seed 2  113s  0/10
    command  seed 1  ~120s  roster 0/10   command  seed 3  ~180s 0/10

**What kills them**, wrapping `Enemy.prototype.damage` at runtime over two
seeds, idle player, geonosis:

    1248 damage onto the line · 20 killing blows
    by kind:   bolt 100.0%
    by dealer: conscript 46.0%   GunPit 42.8%   b1 11.2%
    nearest hostile to a living trooper: median 18.4 m, p10 9.9 m

Three separate causes stack, and all three are correct in isolation:

1. `World._boltHitTest`'s early-out was fixed, so hostile bolts can reach your
   own troops **for the first time** (§16.3). Before that the line was immortal
   to gunfire and every number about it was fiction.
2. The levy puts forty extra rifles on the field, free of the threat budget.
3. The emplacement gun does 43% of all damage onto the line from behind a door
   nobody has opened — since halved, and 36.9% after.

**Nobody has measured it with a Jedi who plays.** Every reading above is an
idle or scripted player, which is a corpse with a delay. *(Taken since, with
the muster window held open and three arms: no player **1.8** survivors, idle
player **0.0**, a fighting `dutyInput` **3.0**. The idle arm is the outlier and
it is the magnet effect above, not a floor.)*

**AND THE TOTAL DID NOT MOVE WHEN BOTH SHARES WERE FIXED, which is the part
that makes this a design question and not a bug hunt.** Re-taken on the branch
head after the levy was retargeted and the pit's cadence halved:

    1266 damage onto the line · 20 killing blows · bolt 99.3% · force 0.7%
    by dealer: b1 38.2%   GunPit 34.8%   conscript 26.3%   trooper 0.7%

against the 1248 above. Each fix worked on its own share and the sum is
unchanged, so **there is no single culprit left to remove** — three sides of a
three-way split are not three bugs, they are an exchange rate. Ruled out
alongside it, on the same build: the engagement band (median 14.6 m, which is
inside both sides' preferred bands), friendly fire (0.7%), and the formation
coming apart (see the resolution above — the line holds to seven metres and it
is the player who leaves).

*(And the "no single culprit" reading was right about the sum and wrong about
what to do with it. The culprit was not on either side of the split: it was that
two of the three sources are **not on the wave's threat ledger at all** — the
emplacement is a prop and never in `world.enemies`, and the levy is exempt by
its own argument — so their output is identical whether you have ten men or two.
Halving both hits the target; effective health does not, because `allyScale`
prices the wave per living body and a line that lives longer meets a wave
composed for the line that lived.)*

**What a LIVE commander is worth, and it is the number this question was
missing.** Both `command` checks that failed on the roster toll were measuring
worlds whose commander had already died — `World.update` gates `director.update`
on `!this.over`, so a run that ends takes the orders, the steering and the
watchdog with it. Held alive, on the same drives:

    HOLD FIRE, idle commander, 45 s   0 of 10 lost   (mortal: the run ended at s32.7)
    TAKE COVER, walking, 90 s         0 of 10 lost   (mortal: the run ended at s52.9, 2 lost)

That is NOT a contradiction of the 0/10 wipes above and must not be read as
one: those are `theline`, 105–240 s, an idle Jedi standing where he spawned;
these are 45 and 90 s with a Jedi who is either in the formation or walking the
line across the field. What the pair says is only that **the toll is steep in
the window where the commander is absent and shallow in the window where he is
present**, which is the presence loop pulling its weight in exactly the mode
that was built to price it — and it means any figure quoted for "what an
engagement costs a roster" has to state whether the Jedi was alive for it.

**The decision that is still nobody's to take unilaterally: how much of a
ten-man roster one engagement should cost.** It is load-bearing now (The Line
loses the run on a wipe) and it belongs to the player, not to a constant in the
composer. Until it is taken, no check asserts a survival rate: `command.mjs`
holds the commander so its two drives measure fire discipline and the watchdog
rather than this, and says so where it does it.

### RESOLVED: the line does not come apart — it falls behind

Two lanes measured the line's spread the same afternoon and got **19.7% of
living men inside `MORALE.NEAR`** against **50–100%**, and this file carried
them as an unreconciled contradiction. They are reconciled, and the fault was
mine.

**Both of my benches stepped the world without ticking the input script.**
`dutyInput` is a script whose entire body is `tick(dt)` — that is where it reads
the field, points the move axis and presses the swing — and `world.update` does
not call it; `_flagship.mjs`'s own `drive` does, one line above its step. A loop
that steps without ticking is driving an unkillable **statue** on the deploy
mark. The formation anchor tracks the player, so of course the line sat on top
of it. Three benches in three lanes had the same omission on the same afternoon,
which is a fact about where the contract lives rather than about three lanes.

Re-taken with a Jedi that moves, every five seconds for two minutes, ten men:

    inside NEAR   37.1% of man-samples (89 of 240), swinging 0/10 to 10/10
    median man    5.8-35.1 m from the player, mean 18.0
    BAND WIDTH    mean 6.9 m, worst 16.5 m
    anchor lag    mean 4.7 m behind the player, max 26.1 m; on him 7 of 24 samples

**The band width is the number that settles it. The line holds together to
within about seven metres — it is the PLAYER who leaves.** The anchor is dead on
him a third of the time and twenty-six metres behind him at worst, in a sawtooth:
he chases a target, the line comes on at the pace of its slowest man, he comes
back, it catches up.

That is not a defect. It is `advancePace` doing exactly what `FLAGSHIP.md` §6
specifies — "the objective advances at the pace of the slowest friendly inside
14 m… you can sprint 200 m into their rear; the line does not come with you" —
and the earlier reading of "why does the line come apart to thirty metres wide"
was a question about something that is not happening.

**But it explains the two negative results, and that is what makes it worth
having.** The SCREEN and OPEN both failed for being local goods; the measured
reason is that a Jedi who plays the way a script plays spends most of the fight
outside his own line. So the open question is not how to make a local good
bigger. It is **whether the mode gives a player any reason to stand still**, and
today it does not: killing is fast, killing is where the targets are, and the
line arrives afterwards.

### The ground is generated now — and scoria cannot carry it

`FLAGSHIP.md` §12's generator (`src/world/Battlefield.js`) has a caller:
`World._groundKeyFor` raises it for a mode that declares `generatedGround`, and
THE LINE declares it. The heightfield you land on is laid out around a bezier
front for the run's seed — a reason drawn from a table of five, high ground that
flanks the line and never sits on it, exactly one chokepoint.

It is a **layer over the rolled theatre and never a theatre of its own**: the
pool, dressing, arrivals, sky and whole palette stay the authored room's (§12.5)
and only the height is replaced, which is what keeps §13.5 true — nothing
generated is reachable except through a room that exists.

**One room could not carry it, and the recorded cause was wrong.** Every ground
was booted with the layer forced on and driven for twenty seconds of a real
engagement:

    mustafar 9/10 · colosseum 10/10 · wood 10/10 · drifts 10/10 · alpine 10/10 · geonosis 10/10
    scoria   0/10 — and four of the ten could not be placed at all

This paragraph used to read "scoria's rocks and wrecks take the standing room
with them when the ground moves under them". **They do not.** Every candidate
point of the deploy ring at seed 3 was attributed to the clause that refused it:

    authored    static boxes refuse   3 of 288   the lava refuses     0    10/10 up
    generated   static boxes refuse  10 of 288   the lava refuses   126     0/10 up

The dressing was worth seven points. **The sea was worth a hundred and
twenty-six.** `battlefieldGround` spreads an authored preset and replaces
`height`; every other field it borrows is a colour or a texture key and cannot
disagree with a heightfield, and `waterLevel` is the one that can — it is a
number in the same metres the height returns, `Spawn.spawnClear` refuses any
point under it on a sheet that burns, and `Hazard` charges 52 HP a second to
anything standing in one. The generated field was written about a datum of zero
under scoria's lava at +0.55, so the basalt shelf the level is named for came
out as a lava plain with the deploy ring in it. Mustafar's 9/10 was the same
arithmetic one notch down: 8% of its ring under a 56 HP/s sheet is the one man
it lost.

**Fixed, and the fix is a shelf rather than a lift.** Raising the whole field
until nothing is wet also works and it deletes the hazard the room is named
for, priced around and lit by. So the battle stands out of the borrowed sheet:
land to one deployment ring beyond the room's own `spawnRadius`, falling to
7.5 m below it, with the radius perturbed into bays and headlands — and the
LINE is land end to end, a causeway, because §12.4's marks go on the front and
dressing under lava is dressing nobody can see. A ground with no sheet gets
none of it and its height function is unchanged term for term. Measured after,
seeds 1/3/7: deploy ring 0% wet, **10/10 standing**, fight disc 7.2% under the
sheet against the authored room's 9.4%, coast 75-85 m out.

**All seven rooms declare `battlefield` now**, so the mode's ground is generated
on every seed rather than on six in seven, and `theline.13` fails if a room
drops out again. The declaration is still the LEVEL's, not the mode's, for the
reason `pool` and `terrain` are the level's: whether a room survives having its
contours replaced is a fact about that room.

Two things the fix needed that the generator could not know and now takes from
its caller: **the deploy point** — scoria opens at (−22, 68) and the front was
being pulled through the origin, 71 m from where anybody stands — and the
room's own fight radius. `battlefield.11` measures all three sea rooms.

### The dressing knows the front is a curve now — one reader, not four

`planBattle` produces a bezier; `Front.js`'s four dressing functions took a
half-plane, and `frontAtChoke` bridged them with the tangent at the chokepoint.
The cost was measured and recorded: the tangent has a reach — 80 m on a tight
seed, 296 on a lazy one — and asked for `burnBand`'s default 260 m it laid three
quarters of the swath on the clean side. Teaching four functions the curve is
four copies of the curve.

**`Battlefield.frontLine` is one copy.** `side(x, z)` gives signed metres from
the line — positive on the burnt side, always — and metres along it; `place(u,
depth)` is the inverse. A half-plane is built as the degenerate case of the same
two, so an authored level dressing a straight front gets the identical ground:
same expression, same `rng` draws in the same order, `crater-log` 18/18
unchanged. It flattens nothing — `plan.curve` was flattened once by
`planBattle` and this reads that table (HANDOFF §2.4).

The burnt-side fraction of the swath, 25 distinct fronts over all five reasons,
measured against the ground's own signed distance:

    tangent at ±260 m    mean  80.0%   worst  30.0%   360 marks
    tangent at ±reach    mean  88.1%   worst  58.4%   207 marks
    the curve at ±260    mean 100.0%   worst 100.0%   356 marks

The middle row buys its score by shrinking the swath, which is a narrower burn
and not a better one. `battlefield.9` binds the third row and reports all three.

**And the chokepoint has a reader.** `World._groundKeyFor` published
`world.battlefield` and nothing in the game read it: `marchFront` dressed the
ground with `frontAt` — a straight line off an unrelated seed — while standing
on a heightfield derived from a bezier, so the burn, the barrage and the dead
landed nowhere near the front the ground was built to explain. It defaults to
the published plan now, with §14's schedule expressed as an **offset of the
curve along its own normal**: the front keeps its shape and advances, rather
than being redrawn each engagement.

What still does not read it is the **gameplay** side. `lineAdvances` measures its
quorum against the commander's own position; the honest version is the
chokepoint — "the line is up when your men are on the ground the plan says this
engagement is about" — and `world.battlefield.choke` is sitting there for it.
`marchTo` also does not pass `strewWrecks`, so the hulls §12.4 puts on the
fighting line are the one mark of the five the mode never lays.

### Attrition is tuned, and the spread is the finding

**Settled, twenty seeds an arm, both from fresh processes at an identical
module-init phase with the contours pinned in both and the only difference being
the two constants:**

    as shipped before this session   1.35 of 10   sd 1.73   10 of 20 reached a muster
    with both halved                 2.80 of 10   sd 2.33   16 of 20 reached a muster
                                     +1.45, se 0.65, z 2.24

**The lever is real, it is small, and the target is not met.** An engagement
fought without the Jedi costs **7.2 of ten**, not the five the target asks for.
The constants stay — `GUN.every` 14.0 and the conscript's round at 5 — because
+1.45 at z 2.24 is a real move in the right direction, but nobody should read
this as the attrition question being answered.

**The second column is the better sentence, and nobody expected it.** What the
halving buys is not really survivors: it is that **four engagements in five
reach their muster instead of one in two.** That is a proportion rather than a
mean, so it carries the same significance with far less variance — and it is the
difference between a mode that has a between-areas beat and a mode that does
not. The muster is where the roster is rebuilt, where the promotions are read
and where §5 says the run becomes a story; an engagement that never reaches one
is an engagement that only subtracts.

**How the earlier numbers went wrong, because it is the transferable part.**
This tuning was reported three times before this one — 5.4, then a ±3.0 band,
then 4.1 pooled — and every one of them was an artefact. `World.js` holds one
module-level `rng` for the process and exported no reseeder, so runs are not
reproducible across a code change and arms taken in one process share a phase
rather than sampling independently. Worse, `theline` and `command` differ in one
earlier draw — a crossing rolls a session plan and Command does not — so **the
mode string alone shifts the whole stream**, which is why one change read 5.4 in
one mode and 3.0 in the other. It is chaotic rather than noisy: seed 1 goes
5 → 1 while seed 2 goes 1 → 5 under a change of one bolt's damage from 10 to 5.

`seedWorld` exists now, `HANDOFF` §2.5b carries the rules and the arithmetic
(five seeds gives se ≈ 1.3 men, so **treat anything under 1.5 men at five seeds
as unmeasured**), the tuning instrument is `tools/_linehold.mjs` with all three
streams pinned, and `theline.12` is a **catastrophe tripwire rather than a
tuning bind** — four of its readings of one build spanned 1.3 to 6.0 before the
reseeder existed, so its band is wide on purpose and it catches only the two
failures that make this a different game: an army gone before its first muster,
and an engagement in which nobody dies.

The user set the target: an engagement fought without the Jedi should cost about
half a ten-man line. **It is not met** — see the settled figures above. One
composed wave meeting one formation is a coin with ten faces: a grenade or a
Hailfire arriving early is two or three names, which is why the spread is wider
than the effect and why five seeds cannot see a lever this size.

The lever was the two sources of fire **the wave's threat budget never pays
for** — `GUN.every` 7.0 → 14.0 on the emplacement and the conscript's round
10 → 5 — which were five of the eight names an engagement cost. It moves an
engagement's clock by about 5% (mean wave 69 s → 70.5 s), so it is not an answer
to the length problem in either direction.

### The opening wave is a wave now, on every ground

`Waves.WAVE_FLOOR` closes it. Composed through the shipped composer, opening
wave of the mode on all seven grounds at one seed, every one of them handed the
same budget of **8.0**:

    before   scoria 2 · colosseum 2 · mustafar/wood/drifts/alpine 8 · geonosis 49
    after    every ground 8 · geonosis 49

It was never five pools being generous or thin — it was ONE rule. The fill drew
uniformly from everything it could afford, so a pool holding a seven-threat body
in its opening set spent seven eighths of the wave on one of them: the Colosseum
opened on a stalker and a droid, and scoria on a sentinel and a droid. The floor
is stated as the COUNT, because the count is what was wrong, and applied as the
same number rearranged — one body of the FILL may not cost more than
`budget / WAVE_FLOOR`, so a wave can always buy three of them. Off the wave's own
budget rather than the running remainder, or a share of what is left would shrink
with every body bought.

**Three and not four**, and the difference is where it stops binding: every
ordinary archetype is threat 16 or under, so a third is inert past a budget of 48
and a quarter past 64 — and the crossing's deepest wave is 56. At a quarter the
Core Ship's last wave could not field the heaviest body on the roster, which is a
difficulty change wearing a body-count fix's coat. The set-piece and the head are
exempt: both ARE single expensive bodies on purpose and both are reserved before
the fill. Every fallback `_composeUnder` had is kept, because "a filter never
empties the field" outranks this.

`theline.18` binds it on every ground in `LEVEL_ORDER` and imports `WAVE_FLOOR`
rather than keeping a copy of the number. `tools/_lineopen.mjs` is the probe and
composes only, so it is seconds. `escalation.mjs` is 30/30 with it in.

**And it took a fifth of the crossing's bulk with it**, which nobody predicted
and which is why it is also half the answer to the section below: the same threat
spent on lighter bodies buys fewer HIT POINTS — a walker is 52 hp per threat
point against a B1's 28 — and hit points are seconds. Same seeds, nothing else
changed, composed bulk of a whole sitting:

    push   14,016 → 10,984 hp        grind   24,604 → 19,324 hp

### FLAGSHIP §16 is closed

All six live bugs the design exercise found in the shipped game. The last open
one was the bolt broad phase, and it was worse than the document said —
**16.43 ms a frame at 39 bodies**, a quarter of a 60 Hz frame at a fifth of the
body count §16 measured, now **0.57 ms**. The 13,320-bolt fan that licenses the
optimisation found a live bug of its own: every droideka in the game presented
**three leg capsules with a non-finite endpoint**, so its legs could not be shot
off or cut off and the topple at two legs lost was unreachable.

### The sitting fits its card now, and the card was never what was wrong

**Where the ten-minute wave actually went, because two of the three plausible
answers are wrong.** A wave that takes ten minutes is either a wave with a great
many bodies in it, a wave only allowed to put a few of them on the field at a
time, or a wave whose bodies take a long time to die. `tools/_lineclock.mjs`
samples all three while the wave runs. On the crossing's LAST wave — area 5,
wave 21 of a Grind, army immortal:

    t+0    queue 63  staging  0  inbound  0  standing  0
    t+9    queue  0  staging 23  inbound 23  standing 20
    t+15   queue  0  staging  0  inbound  1  standing 42
    t+18 … t+120   queue 0, staging 0, inbound 0, standing 41 → 0
    WAVE 21: 124 s total · everything delivered by t+15s · 1,826 hp · 14.7 hp/s

**The whole wave is on the ground in the first fifteen seconds.** The queue
drains in nine, the arrival staging in twelve, and `sat%` — the share of frames
in which `alive + inbound >= maxAlive` was what held the queue back — is **0 on
every wave of every sitting measured**, at either end of a crossing. It is not
the spawn ring, not `MAX_CONCURRENT`, not the 58–96 m march and not the
conveyor. Everything after t+15 is the line killing what arrived.

So **a wave of this mode is its HIT POINTS over the line's throughput**, and
throughput runs 4.7 → 22.2 hp/s across a sitting as the muster takes the line
from nine bodies to thirteen. Which makes the bulk the whole clock, and the bulk
was the escalation: as it stood, an opening wave was 448 hp and the last wave of
a Push 6,166 — **fourteen times** — against a body count that only went 49 to 63,
because `bodyCap` saturates at `BODY_MAX` and every threat point past that goes
through `_upgrade` into a heavier chassis. A walker is 52 hp per threat point
against a B1's 28.

**Two levers, from two lanes, on the same defect.**
`CommandDirector.rampWave` (the attrition lane, arrived at from the wipe at
engagement 3) put the `w^1.62` ramp inside the area instead of across the run.
`Waves.WAVE_FLOOR` (the length lane, above) spends the same threat on more and
lighter bodies. Composed bulk of a whole sitting, same seeds, hit points:

    plan          as it stood    + rampWave    + WAVE_FLOOR
    raid  s11              —          9,162          8,430
    push  s1          30,762         14,016         10,984
    grind s2          88,266         24,604         19,324

and on three seeds a plan, the current build is tight: raid 8,092–8,454 ·
push 10,472–10,984 · grind 17,022–19,324.

**What the clock says now** — `tools/_lineclock.mjs`, one seed a plan, fresh
process each, both sides of the player's army held on their feet so every figure
is a FLOOR and a played sitting cannot be shorter:

    raid  seed 11    8 waves   FLOOR 11.6 min   card 10-15   ended WON
    push  seed  1   12 waves         15.3 min   card 18-25   ended WON
    grind seed  2   21 waves   FLOOR 28.6 min   card 30-45   ended WON

**All three are inside the band their own card prints, and every one of them is
a floor**, which is where a floor belongs: a played sitting is longer than an
unkillable one, so the Push's and the Grind's sitting a little under their
bottoms is the right side to be on.

The Raid's figure is `theline.19`'s, which times the whole drive. The Push's is
a sum of closed wave rows taken before the bench was fixed and is SHORT BY ONE
WAVE — the drive left on `over`, which is raised by the wave that wins the
crossing, so that wave never saw a wave-number change and its seconds were
dropped. Its neighbours ran 89 and 110 s, so a Push floors near **17½ minutes**.

The wave table of that Grind is the shape the whole exercise was for: 38 to
133 seconds a wave over the entire crossing, against 81 s at the front and
606 s at the back before any of this.

**The three levers that were NOT taken, and why each was worse.**

  · **Waves per area.** They are already right. 8/12/21 waves against bands of
    12.5/21.5/37.5 minutes is 94/108/107 seconds a wave, and a measured wave of
    this mode is 51–120 s. Cutting the last area from five waves to four fixes a
    Raid and takes a third off a Push, which puts the Push under its own floor —
    the areas are shared and the plans are not.
  · **`AREAS[*].budget`.** It is the mode's only statement of what an area IS,
    `rampWave` has just promoted it to being the whole between-area escalation,
    and cutting it reaches area 1 — which measures ON TARGET already (engagement
    1 is 3.6–4.9 min against a per-engagement share of 5–7.5) and is the fixture
    the attrition lane tunes against.
  · **`planStages`.** Forbidden, and correct: a Push being the landing, a middle
    and the end is exactly §5.

**What it cost in men, measured, because the other lane's number is the one that
must not move.** `tools/_linehold.mjs theline 1,2,3,5,7 none geonosis 1`, five
seeds, one process, all three streams pinned:

    none  survivors mean 2.4/10  [0 0 1 5 6]  3/5 reached a muster  mean wave 66 s

against that lane's settled **2.80 of 10 over twenty seeds**. Five seeds carry
se ≈ 1.3, so 2.4 against 2.80 is *unmeasured* — nothing moved. The reason is
visible in the composition rather than the survivors: engagement 1 composed over
four seeds, before and after `WAVE_FLOOR`, carries **identical threat — 388.0
both ways** — spread over 580 bodies and 6,572 hp before against 603 bodies and
6,340 hp after. Same fight, 4% more bodies, 3.5% fewer hit points. `rampWave`
does not touch engagement 1 at all: area 1's waves are the crossing's waves 1-3
under either rule.

**The card stands.** `SESSION_PLANS[*].minutes` is unchanged and `deployCard`
prints it unchanged, because the mode now delivers it. `theline.19` is what
holds that: it drives a whole Raid to its verdict and the band's own top is the
loop's deadline, so the check costs exactly what the card offers and a mode that
drifts long fails fast instead of holding the gate open.

**What is still open.** The floors above are floors — a line that loses men
kills slower, so a played sitting is longer than these and nobody has measured
by how much. And `theline.19` binds the Raid only, because it is the only plan
cheap enough to sit in a gate; a Grind is 21 waves and half an hour of game time.

### Two live defects the attrition work found and did not fix

**Every bolt fired at one of your men is aimed at his FEET.** `Enemy._shoot`
leads on `target.chest ?? target.position`, and **only `Player` has a `chest`** —
every other body in the game falls through to `position`, which is at the feet.
It surfaced because a "men crouch under fire" lever measured *worse than
nothing* (0.6 survivors against 1.8): crouching pulls a man toward the aim point.

It is deliberately unfixed, and the reason is the size of it: giving `Enemy` a
chest would roughly double every line's lethality overnight, on both sides, in
every mode, and none of the tuning anywhere in this document was measured
against that. It is the largest single unclaimed change in the combat model and
it should be taken on its own, with the whole balance pass in front of it.

**Engagement 3 wipes a fresh ten-man line in one wave**, before the attrition
tuning and after it: 0 of 10 on five seeds, at about 100 s. Tuning engagement 1
does not reach it. That is the mode's economy rather than a constant — the
muster's replacement rate against a wave budget that keeps climbing — and it is
the next thing between the mode and a run somebody can finish.

### And a process note, because it is the second time

`World.js` holds one module-level `rng` for the process and exports no
reseeder, so **no run is reproducible across a code change**. Only distributions
compare, which is why every attrition number in this document is a five- or
thirteen-run spread rather than a seed-for-seed A/B. This is the same shape as
`HANDOFF` §2.11 (one stream, one process) seen from the other end, and it is
worth a reseeder the day somebody wants a true paired test.

### §7's central claim is still false, and now it is the ONLY thing left

With attrition tuned and every arm reaching its muster, the three-arm reading is:

    no player at all              5.4 survivors · 5/5 areas held · 211 s engagement · 71 s/wave
    a scripted Jedi who fights    5.0 survivors · 5/5 areas held · 341 s engagement · 112 s/wave

**A Jedi who plays is worth nothing to the line and makes the engagement 60%
longer.** That is `FLAGSHIP.md` §1's sentence — "your job is not to kill
everything, it is to be the reason the line is still standing when it takes the
ridge" — measured, and false. It has now survived every attempt to make it true:

- **presence** as a morale term: a Jedi a hundred metres away costs the line the
  same men as a Jedi standing in it, so presence is not the mechanism;
- **OPEN**, the Force as a multiplier on other people's guns: the line already
  aims 9× its fair share at a body you are holding, and the verb still reaches
  0.5% of enemy-seconds;
- **the SCREEN**, taking bolts aimed at the man beside you: 0 of 30
  casualty-bolts landed on a man inside both its reach and its arc;
- **the attrition tuning above**: no lever on the threat ledger moves it, and
  the two levers off the ledger move both arms equally.

The common thread across all four is in the spread reading: the line holds
together to about seven metres and **the player is the one who leaves**, up to
26 m ahead of his own men, because killing is fast and killing is where the
targets are. Every mechanism tried so far has been a local good handed to
somebody who is not local.

**So the question is no longer what a Jedi does for the line. It is what makes a
Jedi stand in it** — and that is a design decision, not a measurement. The
honest options are roughly: make leaving cost something the player feels
immediately; make standing pay something that scales with how many men are
beside you; or accept §8's four playstyles and let the Vanguard be the build
that leaves. Nobody has chosen, and no further instrument work will choose it.

### A dead commander lifts every standing order, and stops the watchdog

`holdFire` is not a flag — `_troops` pushes every trooper's fuse back up every
frame, so it is a POKE — and `World.update` gates `director.update` on
`!this.over`. Put together: **the frame a run ends, every standing order lifts
and the casualty watchdog stops looking.** Measured on real worlds:

    HOLD FIRE, 45 s    mortal commander: run over at 32.7 s, 43-121 bolts out, ALL of it after 32.7 s
                       commander held:   0 bolts out, 10/10 standing
    TAKE COVER, 90 s   mortal commander: over at 52.9 s, 21 rescues, 2 names lost
                       commander held:   no end, 56 rescues, 0 names lost

Two things follow. The small one is that two `command` checks were red for this
and are now driven with the commander's hp held, the way `_linetoll.mjs` already
did. The large one is that **it is not only a post-run artefact**: the TAKE COVER
pair is a mid-fight reading, and a line whose commander has fallen loses its
rescues and its cover order along with him. Whether that is right is a design
question — `census`'s own note argues that losing your general should cost you
your orders and not the battle — but nothing anywhere says the watchdog goes
with him, and the watchdog is what stops a trooper being quietly retired.

### BREACH and attrition are one dial and want one decision

`breach.mjs`'s "twenty seconds at the plate, and the line pays for every one of
them" is the mirror image of the attrition work: the emplacement's cadence was
halved to stop the line dying, and halving it is exactly what made standing away
from the line free.

**And it is MARGINAL rather than red, which is a worse state.** Run once it
fails, run again on the same commit it comes back 4 of 4. The two numbers that
say why:

    isolated arm   one gun, nothing else on the field, 90 s   21 rounds, 1 of 10 names gone
                   against an assertion of `lost >= 1` — passing by exactly one man
    plate arm      1 of 10 lost in 24.9 s at the plate, and 1 of 10 over the same
                   seconds standing in the formation — the control matches

At 0.028 rad of dispersion over 69 m the gun needs two hits on the SAME trooper
to kill one, so whether either arm scores 1 or 0 is a dispersion roll. "The line
loses nothing at the plate" and "the line loses one" are the same coin landing
either way.

**So a second thing is owed besides the dial: `lost >= 1` has to go.** It asks a
yes/no question of a quantity that has no business being yes/no, and no setting
of the dial will stop it flaking — rounds on target, or hits, or names per
minute of its fire, any of which is a count with a distribution rather than a
threshold one roll can cross. That is the same lesson the attrition tuning
arrived at from the other end: **the muster RATE turned out to be a better
instrument than the survivor MEAN**, because a proportion over many runs does
not inherit the variance of a single chaotic draw. Where a check in this game
can be built on a rate or a count rather than on a threshold, it should be.

They are the same constant pulled from opposite ends, and tuning either one
alone will keep breaking the other. Whoever settles the attrition target should
settle this in the same pass: §7 wants BREACH to cost the line something real
while the Jedi is away from it, and §6 wants the line to survive an engagement,
and one number cannot be chosen for one of those and checked against the other.

---

## §7's central claim, answered — the ground is taken by the LINE

Four mechanisms were built to make a Jedi worth something to his line and every
one measured as not paying: presence as a morale term, `openness` as a
multiplier on other people's guns, a bolt SCREEN for the man beside you, and the
attrition levers. The diagnosis this file already carried is that **each was a
local good handed to the one body on the field that does not stay local** — the
line holds together to about seven metres and the player is the one who leaves,
up to 26 m ahead of his own men.

A fifth local good would have failed the same way. What was missing is in §6 and
was never implemented:

> "the objective advances at the pace of the slowest friendly inside 14 m. You
> can sprint 200 m into their rear; the line does not come with you… **Killing
> stays fast and fun and advances nothing.**"

`payWave` took an area on `areaWaves >= area.waves` — a count of cleared waves
and nothing else. So killing everything, alone, two hundred metres in front of
your men, **took the ground**. `advancePace` was built, is correct, and moves the
formation anchor at the slowest man's speed — but it decided where the line
STOOD, not whether the run ADVANCED.

`MODES.theline.lineAdvances` fixes that. `CommandDirector.lineIsUp` asks for a
quorum of the living inside `MORALE.NEAR` — the same radius presence, the pace
rule and the nerve ledger already use, so a player learns one distance and not
four. Half of the living, because a line that has lost men is still a line and a
rule that wanted all of them would make one straggler a wall.

**It is not a reward for standing still and it does not punish having left.** It
declines to advance until the army that is supposed to be taking this ground is
standing on it, which is what "the line takes the ridge" means. And it makes all
four of the failed mechanisms pay at once without changing any of them, because
each keeps men alive and near you and that is now what advances the run.

Two things it needed to be safe, both driven by `theline.16`:

- **It must not dead-end a run.** `advancePace` returns 0 when nobody is inside
  `NEAR`, so a line whose Jedi has left does not come and cannot — the player
  resolves it by walking back, and the check drives both directions to prove the
  refusal is a delay and not a wall.
- **An army that no longer exists did not take this ground.** `lineIsUp` answers
  true for an empty roster (it must, or a wiped army hangs the run), but
  `payWave` calls `_areaClear` synchronously and `_checkLine` does not get its
  frame until the next `update` — so the last wave paid by a dead line logged an
  `area` record on the way out and the defeat card credited ground the army was
  not alive to hold.

### What is proven, and what is not

**Proven: the mechanism engages.** `tools/_stand.mjs` is the 2×2 — two player
scripts (with the line / away from it) × the rule on and off, toggled on the
DIRECTOR so the mode string and therefore the rng stream stay identical (§2.5b).
The rule-on arm spends **a mean of 51 s an engagement with the ground won and
unclaimed**.

**Not proven: that it changes how the mode is played.** Every run of that arm
also read `line 0/10` — the roster was dead before the area closed, and
`lineIsUp` steps aside for a dead army rather than hang the run. So on that
build the rule was mostly bypassed, for exactly the reason the four mechanisms
before it failed. That bench was pinned to a commit that predates the chest fix
and the wave-ramp fix, both of which change whether a line survives an
engagement at all — so **it has to be re-run against the settled tree, and until
it is, this rule is built and engaging and unproven.**
