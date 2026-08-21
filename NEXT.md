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

### Step 2 — the Dead Jedi test: **the channel it was measured through was pinned shut, and is not any more**

15 driven Command worlds, 5 seeds × 3 arms × 3 engagements:

| | no player | with blade | blade disabled |
|---|---|---|---|
| fallen (your men) | 0.2 | 7.8 | **8.6** |
| areas taken | 1.0 | 1.0 | 0.4 |
| waves cleared of 3 | 3.0 | 3.0 | 2.4 |
| game-seconds | 198 | 308 | 588 |

"Dead" sits at **1.11** on the none→blade axis — past blade, nearer blade. By
§14's stated criterion the presence loop carries weight, so §7 survives the
letter of the test. It does not survive the spirit: **a Jedi standing in the
line costs the roster 7.5 men** against a line fighting alone. Take the blade
away and it costs one more, doubles the time to clear the same three waves, and
loses the area in 3 of 5 seeds.

Two caveats, both real and both in the probe's header: the player is a
**script**, and **morale reads 1.000 in both player arms** — §10's `JEDI_NEAR`
saturation was LIVE, so the channel §7's BREAK verb needs was pinned shut and
could not be what presence paid through.

**THE SECOND CAVEAT IS FIXED, AND IT MATTERS MORE THAN THE TABLE.** Morale now
reads **0.87 / 0.84 / 0.84** across the three arms, on the same tree and the
same seeds — see "Closed since this list was written" below for the two terms
that did it. What that means for the numbers above: **the table was taken
through a saturated instrument and has not been re-taken.** On two seeds
afterwards the FALLEN column had flipped sign (no player 8, with blade 2.5–3),
which would reverse the whole reading — but two seeds is not a table, and the
muster lane re-priced allies in the same window, so the arms are not the arms
this table was measured on either. Re-run it before quoting any row of it:

    node --import ./tools/register.mjs tools/_flagship.mjs step2 --seeds 3,5,7,11,13

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

### Still open

- **A Jedi in the line costs the roster 7.5 men.** Still the most consequential
  number in this document, and it may no longer be the number: on two seeds
  after the morale fix and the muster lane's ally re-pricing, the SIGN had
  flipped (fallen: no player 8, with blade 2.5–3). Two seeds is not a table —
  re-run `tools/_flagship.mjs step2 --seeds 3,5,7,11,13` before believing
  either version.
- **Presence is a FLOOR, not a gradient.** Now that morale is unpinned, both
  player arms rest at the same 0.84, because `JEDI_NEAR` is a step at 14 m and
  both arms have a Jedi inside it. Whether it should fall off with distance is
  the next question, and it is now a question the arithmetic can answer.
- **The composite grade crushes dark levels** — mustafar's near ground ×0.49. A
  lane was measuring this when the line above it was written; check `git log`
  before repeating it.
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
