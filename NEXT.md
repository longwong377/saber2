# START HERE — after the second playtest, with the kill tests answered

Written 21 Aug, end of the second playtest session. Short on purpose.
Everything it points at is long.

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

### Step 2 — the Dead Jedi test: **presence carries real weight, and its sign
is negative**

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
saturation is LIVE, so the channel §7's BREAK verb needs is pinned shut and
cannot be what presence pays through. **Unsaturating `JEDI_NEAR` is the first
thing to try before believing this table.**

---

## Where the tree is

- **7 levels, 8 modes, 1 campaign, 31 archetypes.** Run `tools/state.mjs`
  rather than believing that sentence.
- Gate was ~1553 before this session and is **~1620** now. **Re-run it before
  trusting anything.**
- **The live link follows the default branch.** This session's work is on
  `claude/borz-menu-transport-ship-r29efk`. If it has not been merged, the
  player has not seen any of it.
- **`tools/checks/frontdoor.mjs` is new and is the one that opens the page a
  player opens** — the shipped tree in a real browser, not the packed build.
  It caught a broken deploy the same day it was written.

---

## What the last session did

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

- **Grenades are not networked.** `GrenadeField` is host-side only, so a co-op
  client sees no grenade, no shout and no crater. Not a desync — a gap.
- **`JEDI_NEAR` saturates morale at 1.000** whenever the player is anywhere
  near the line, which pins shut the channel §7's whole presence argument
  depends on. See Step 2 above.
- **A Jedi in the line costs the roster 7.5 men.** If that is not intended, it
  is the most consequential number in this document.
- **`works()` and `BlastDoor`** — the only door hold in the game, on no level.
  A lane was mid-way through siting one on Geonosis when this was written;
  check `git log` before repeating it.
- **The composite grade crushes dark levels** — mustafar's near ground ×0.49. A
  lane was measuring this when this was written; same caution.
- **First person should be one-handed.** Two independent confirmations.
- **Muster-anywhere is the small honest version.** A full one needs a shelf, a
  score ladder that knows how many men you brought, and a co-op run with allies
  that nobody has driven.
- **A Command wave was seen sitting `active` with an empty queue, no inbound
  arrival and zero hostiles standing, from 200 s to 350 s.** FLAGSHIP §16's bug
  3. A watchdog in the flagship probe fired zero times across 15 recorded runs,
  so it is reported as seen once and not as reproducible.

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
