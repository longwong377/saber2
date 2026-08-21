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

### The mode's own open question, and it is the biggest thing on this list

**A ten-man roster is wiped out inside the first engagement, on every seed, in
both army modes.** Measured with the Jedi held unkillable so survival is not a
variable:

    theline  seed 1  155s   roster 0/10   theline  seed 2  113s  0/10
    command  seed 1  ~120s  roster 0/10   command  seed 3  ~180s 0/10

— and the muster is never reached, so the mode's whole between-engagements beat
is unreachable in play. This was always true of Command; nothing surfaced it,
because losing the army ended nothing. The Line makes it a loss, which is the
point of the inversion, and it also means **the mode cannot currently be won**.

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
idle or scripted player, which is a corpse with a delay. That measurement is
the next thing anybody should take: `tools/_linetoll.mjs` is the bench and
takes `<mode> <seeds>`.

### A contradiction two lanes should resolve before either number is used

The presence lane reports **19.7% of living men inside `MORALE.NEAR`, and the
median man going 12.6 m → 45.7 m in thirty seconds** — and builds its whole
conclusion on it ("the question is no longer what a Jedi does for the line, it's
why the line comes apart to thirty metres wide").

Measured on the mainline the same afternoon, both modes, idle and scripted
players, sampling every five seconds for two minutes: **the median man is
6–19 m from the player and 50–100% of the living are inside `NEAR`.** The
maximum reaches 22–38 m in bursts and settles back. The line does not come
apart here.

The two readings cannot both describe the same build. Until somebody says which
build each was taken on, **neither is safe to design against** — and the
presence lane's negative result does not depend on it, so the conclusion stands
either way.

### And the opening wave is 2 bodies on one ground and 49 on another

`theline.11` boots every ground in the mode and reports what area 1 composes at
one seed:

    colosseum 2 · scoria 3 · mustafar/wood/drifts/alpine 8 · geonosis 49

All seven are handed the same budget of **8.0**. Two things make the spread:
the levy is geonosis-only, which is 40 of that 49; and a pool with expensive
bodies in its unlocked set spends the whole budget on two or three of them —
the Colosseum opens on a stalker. A mode about a LINE opening against two
bodies is a defect, and it is a composer question rather than a mode question,
which is why the check asserts legality and reports the spread rather than
hiding the number inside a red bar.

### FLAGSHIP §16 is closed

All six live bugs the design exercise found in the shipped game. The last open
one was the bolt broad phase, and it was worse than the document said —
**16.43 ms a frame at 39 bodies**, a quarter of a 60 Hz frame at a fifth of the
body count §16 measured, now **0.57 ms**. The 13,320-bolt fan that licenses the
optimisation found a live bug of its own: every droideka in the game presented
**three leg capsules with a non-finite endpoint**, so its legs could not be shot
off or cut off and the topple at two legs lost was unreachable.

### And the sitting is more than twice as long as the card promises

`tools/_linelength.mjs` holds both the Jedi and every named trooper on their
feet and drives a whole sitting. That is not a prediction of how long a run
takes — it is a **lower bound**, because an army that cannot be killed clears
waves as fast as this build can clear them.

    seed 1 · push · 3 stages · the deploy card says 18-25 min · FLOOR 45.7 min · ended WON

So a Push cannot be played inside the band its own card prints, even by an army
that cannot die. §5's promise — "20–40 min", Raid 10–15 · Push 18–25 · Grind
30–45 — is printed on the deploy card as a promise to the player, and the mode
cannot keep it.

It is **not** the fight being hard: this arm's line is immortal, so what is long
is the number of waves an area asks for, not how long each takes to win. The
lever is `AREAS[*].waves` and the escalation under it, and the honest fix is
either fewer waves an area or a card that stops naming minutes. Nobody should
tune the length and the attrition in the same pass — fewer casualties means more
rifles firing, which shortens every wave, so the two move each other.
