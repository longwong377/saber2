# THE LINE — the next phase

Third draft. The first two were sent back by audit and both failed the same way:
they reasoned from numbers in `NEXT.md` without reading to the last word written
about those numbers. Draft 1 built on a null result. Draft 2 built on the
retraction's *premise* and missed the retraction. This draft is written against
the current frontier and cites the section that settles each claim.

**The rule that both drafts lacked, and the most important line in this
document: a number from the working log is not usable until you have found the
last thing written about it.** `NEXT.md` is 2115 lines and carries its
retractions inline.

---

## 0. What is actually true, as of the tuned build

**The game's central claim has turned positive, and it is worth about one man of
ten with a spread that includes zero.** `FLAGSHIP.md` §1 — "your job is not to
kill everything, it is to be the reason the line is still standing when it takes
the ridge" — measured false through five readings.

Draft 3 led with `_muster.mjs`'s "**worth four to five men an area**" (no player
2–3 of ten, a Jedi 4–8). **That is the pre-tuning number and it is stale.**
255 lines later, on the tuned build, the same seed list, six seeds:

    no player at all              4.5 of ten
    a scripted Jedi who fights    5.5 of ten  ·  8 of ten on four of six

> "Six seeds is not a result — **the spread is 0 to 8** — but it is the first
> time the sign has been positive."

**The no-player baseline moved 2–3 → 4.5** because `GUN.every: 34.0` and the
conscript's round landed in between. The Jedi's apparent worth collapsed from
+4–5 to **+1.0 not because he got worse but because the floor came up under
him** — the earlier figure was measured on a build where the line was dying
anyway. The log states the general rule itself: *"The chest fix made every
constant in this document stale."*

And a third arm nobody has accounted for: that six-seed Jedi is **held on his
feet** — immortal. With the healing off, the same seeds read **0, 9, 8, 6, 6**.

So the honest statement of the premise is: **the sign is positive at n=6 and
worth about +1.0 against a 4.5 baseline; M1 decides whether that is real.** If M1
returns +1.0, that is the expected result and not a regression — draft 3 would
have read it as one.

**M1 HAS SINCE RETURNED, AND THE SIGN IS NEGATIVE: −2.0, not +1.0.** See M1 in
§6. Read that with its own caveat: the baseline it is measured against is
propped up by `_watchdog`, which retires the wave when no player is on the
field, so the magnitude is not yet trustworthy even though the sign has held
across four arms.

The mechanism, which is the part that has held across readings: with the Jedi
present, fire arriving on the line **halves** — 0.94–1.72 hp/s down to
0.43–0.97. *He is removing bodies before they fire.*

**The keystone is built — and it is NOT PROVEN.** `MODES.theline.lineAdvances`
/ `CommandDirector.lineIsUp`: an area does not close until half the living are
inside `MORALE.NEAR`.

> "It is not a reward for standing still and it does not punish having left. It
> declines to advance until the army that is supposed to be taking this ground is
> standing on it… **It makes all four of the failed mechanisms pay at once
> without changing any of them**, because each keeps men alive and near you and
> that is now what advances the run."

**And the very next paragraph, which draft 3 quoted around:**

> "**Not proven: that it changes how the mode is played** — and the re-run found
> something that outranks the question. Every run of that arm read `line 0/10`:
> the roster was dead before the area closed, and `lineIsUp` steps aside for a
> dead army rather than hang the run, **so the rule was mostly bypassed.** …The
> rule engages harder on the tuned build: `rule=ON standOff=0` took 6 of 6
> areas, mean 282 s, a mean of 14 s waiting. **And every row still reads
> `line 0/10`.**"

So the load-bearing claim of this document is the one claim with no experiment
behind it. That is guardrail 1 satisfied on citation and violated on substance —
the last word was found and the top half of it was quoted. **M5 exists because of
it, and nothing in §4 may be built before M5 reports.**

**What is retracted, and what both earlier drafts wrongly used:**

| Retracted claim | The last word |
|---|---|
| "the line comes apart to thirty metres wide" (19.7% inside NEAR) | §"RESOLVED: the line does not come apart — it falls behind". Both benches ran an **unticked input script** — a statue on the deploy mark. Re-taken: **37.1% inside NEAR, band width mean 6.9 m.** "The line holds together to within about seven metres — **it is the PLAYER who leaves.**" |
| "100% of friendly casualties are own-team bolts" | `_boltHitTest`'s early-out was fixed, so hostile bolts reach troops "**for the first time**… before that the line was immortal to gunfire and every number about it was fiction." Current: **bolt 99.3%, friendly fire 0.7%** |
| "the Jedi is worth nothing / his kills substitute" | Superseded by the table above |
| "the sim is linear at 198 µs/body, ceiling 63" | Retracted, **and so is its replacement.** `scale.mjs`'s first version fitted a line to a curve and printed a bend from two points; re-run four times it read ×1.65, ×4.15, ×2.51 and ×0.09. It now takes `--repeat`, measures a 0-body row rather than extrapolating to one, and **refuses to name a bend from fewer than three gaps.** See below for what survives |

**And one live defect that outranks the plan.** `tools/scale.mjs`, quality high,
in `command` so the cross-army pass runs, medians of repeated takes:

     0 alive      5.74 ms CPU   [4.79–5.74]      ← RETRACTED
    16 alive     13.27 ms CPU   [12.12–13.27]     ← RETRACTED
    30 alive     18.11 ms CPU   [13.42–18.11]     ← RETRACTED
    54 alive     25.49 ms CPU   [23.71–25.49]     ← RETRACTED

**THE INSTRUMENT WITHDREW THIS TABLE ITSELF, and the paragraph that stood here
is void.** It read "the empty world costs 5.74 ms — 34% of a 16.67 ms frame with
no soldier in it, and the simulation goes over budget between 16 and 30 bodies",
and `tools/scale.mjs`'s own header now says why that was wrong: the run sampled
after 90 warm-up frames, and fifty-two dressing props were still coming to rest.
**The settled empty world is about 2.5 ms and still falling, and every per-body
number the old table printed carried a share of somebody else's crates settling.**
`WARM` is 1200 frames now.

So there is no 34% floor, there is no 16-30 body knee, and **M7 exists to chase a
number its own instrument has withdrawn.** `PERF.md` was still publishing the
same retracted run as a 23-body ceiling. What §4.3 is actually downstream of is
the measured ladder: 160 bodies in the two-army front layout, 120 of them at
16.60 ms.

**What already ships and both drafts failed to name:** `Cohorts.js` — **168
bodies at 27 draw calls** past 137.8 m. `MergedSkin.js` at ~4.6 calls/body.
`Levy.js`, forty free bodies off the threat budget. `Battlefield.js`, ground
generated around a seeded bezier front. `Front.js`, that front drawn, with a
measured ordering test. `Fallen.js`, 520 prone figures at two draw calls.
`Extraction.js`, thirteen phases across two legs (the withdrawal reuses nine).
`Morale.js`/`Nerve.js`. 37 archetypes, 8 vehicle archetypes across 14 hull
builders — the "20 vehicles" this line carried is in no table anywhere —
7 grounds, 9 modes.

---

## 1. The design

### The keystone

**`lineIsUp` is the keystone.** The ground is taken by the line standing on it,
not by the Jedi killing everything two hundred metres ahead. That one rule
converts every other system from a bonus into a requirement: keeping men alive
matters because live men take ground; being near them matters because near men
take ground; a gun that needs a crew matters because the crew are men who must be
alive and near. The Jedi's job stops being damage and becomes **making it
possible for the line to arrive** — a job no volume of rifle fire can substitute
for, which is exactly what five previous readings proved was needed.

And it is, as far as six research passes could establish, **without precedent**:
*the run does not advance until half your living men are inside the radius your
morale system already uses, in a real-time game with a demigod protagonist and
permadeath.* Escort missions gate on one NPC. Total War has zones of control.
Nothing does this. It is not a mechanism in this design — it is the pitch.

### TWO lines make the front, and it is one deleted line of code

This is the largest thing the brief asked for and it is nearly free.

`CommandDirector.lineIsUp(c = this.commander)` **already takes a commander
argument.** `formUp` already fields two commanders with two armies at
`VERSUS_SEPARATION = 120` m. `MODES[s.mode].meeting` and `commandVersus` already
exist. And `Command.js:5721` reads:

```js
if (this.versus) { this._troops(dt, ctx); return; }
```

**Versus returns early and never runs the area or advance logic at all.** It is a
two-army deathmatch, not a battle. Delete that early return, run areas for both
sides, and ask `lineIsUp(a)` and `lineIsUp(b)`:

- Ground between the two lines is claimed by whichever commander has his line up
  on it.
- **The front moves because a general left his line at the wrong moment** —
  which is the measured behaviour the log spent five readings establishing ("the
  player is the one who leaves"), converted from an embarrassment into the win
  condition.
- **Reinforcements at certain moments** becomes: both sides draw from a visible
  pool and choose when to spend it. The front pushes back because one pool
  empties. That is a scalar per side and a commitment UI; `Waves.js` already
  composes to a threat budget and `Arrivals.js` already lands the gunships.
- **"Generals coming in and out where they're needed"** stops being flavour. It
  is the only way to move the front.
- Co-op and versus are the same code.

That delivers the frontline push-and-pull, the meeting engagement, the reason the
enemy general matters, versus, co-op, and the tug-of-war shape of the whole
battle — from a function that is already parameterised and a mode that already
exists. **It is a smaller change than M3 and it is the largest single thing
missing from the brief, so it is in the `now` column.**

### Command scales by delegation, or it does not scale

Seven formation orders solved around your body is the right interface for ten
men. It is not an interface for three hundred, and no amount of density work
makes it one. *Dozens of Force users leading hundreds of troops* is a **command**
problem before it is a rendering problem.

The verb that scales exists in fragments already: `squads()`, `order(id, cmdr,
squad)`, five ranks, and §4.4's own rule that a Sergeant accepts a standing order
and a Corporal does not. Finish it: **you give a squad's sergeant a piece of
ground and a standing order, and his rank decides how well he holds it
unsupervised.**

Four things fall out, and the third is load-bearing:

1. The Company screen stops being a scrapbook. You are not collecting men, you
   are collecting **officers** — and losing a Sergeant costs you a squad you can
   no longer aim.
2. Rank becomes the progression the brief asked for, with no stat inflation,
   which §4.4 already forbids.
3. **`lineIsUp` generalises.** A *squad* is up when it is near its sergeant; the
   army is up when its squads are. Without this the quorum breaks the moment
   density arrives — a collision between §4.3 and the keystone that draft 3 did
   not notice.
4. Refusal (Close Combat's anxiety index) lands on squads rather than
   individuals, where it is legible and where a player will accept it.

### The thesis, as one keypress

*Save your men or lead them to their deaths* is the brief's own sentence, and
**the order you can check** is it as a mechanic. High Command designates an
artillery ellipse. Force sense shows what is inside it, including friendly IFF.
Obeying is faster and rewarded; verifying costs twelve seconds under fire.
Sometimes your own men are in it and the game never says so.

It is the most composed idea in this document, which is why it is here and not
filed under curiosities: it needs `lineIsUp` (your men are in the ellipse
*because* the rule keeps them near you), permadeath, the Company screen (the men
you killed have cards), §4.2's Spire (vision gating is the same mechanism), and
§4.9's after-action report — which names you as the killer. The Umbara arc has
**zero adaptations in any game**.

### The test to apply to every system below

**Delete `lineIsUp` — does this section change?** If not, it is not melded yet.
Draft 3 asserted the melding; this is how to check it.

---

## 2. Running now — the measurements that gate building

**M1 — the twenty-seed reference arm.** *Running as this is written.*
`NEXT.md` asks for it by name: "Six seeds is not a result — the spread is 0 to 8
— but it is the first time the sign has been positive, and **it is now worth
twenty seeds from somebody.**" `tools/_linehold.mjs theline 1..20`, all three
arms, fresh process each (HANDOFF §2.5b).
*Kills:* if the sign does not hold at n=20, §1 is false and this document is
void. *Licenses:* everything.

**M2 — the teamDamage bound, one hour.** `teamDamage` is already a slider
(`TEAM_DAMAGE_DEFAULT = 0.35`). Run the instrument at `teamDamage: 0` and the
entire ceiling of any friendly-fire work is known with no code written. Draft 2
proposed weeks of hold-fire work without taking this bound.

**M3 — density. One constant, and draft 4's version of this was backwards.**
Draft 4 said to drop the `if (this.command)` gate at `World.js:2761` "so two
armies actually fight each other". **They already do.** That comment's own text:
`World.loadLevel` builds a CommandDirector for `command`, `skirmish` and
`campaign` alike, "so all three get the cross-army pass" — and dropping the gate
"would set those two halves on each other in the Trial and in Path of the Blade",
six levels whose notes each argue for a horde. It is a design decision about six
levels, not a benchmark switch, and my own `PERF.md` says the pass runs here.

So: **raise `LEVY_STRENGTH` and run `scale.mjs` in `command` at the raised
population.** Leave the gate alone. That is the honest reading of the cross-army
pass at real density, and it is one constant.

**M5 — does `lineIsUp` change how the mode is played?** The gate on everything
in §4, and the measurement draft 3 did not have. Two player scripts (fights near
the line / fights ahead of it) × the rule on and off, toggled on the DIRECTOR so
the mode string and the rng stream stay identical (HANDOFF §2.5b). Read **bodies
standing**, not the `line` column — that column read `0/10` on every run of every
arm because the roster is torn down between areas, and a bench reporting zero on
all four arms is a bench reporting on itself. The arms must run on a build where
the roster survives the area, or the rule is bypassed and the test measures
nothing.
**And it must run the log's own rule-outs first, in the log's order.** Draft 4
asserted a single cause for the `line 0/10` column that is *not one of the three
`NEXT.md` names*. The caution written for whoever re-runs this bench lists them
and says they are "worth ruling out in this order": an engagement here **is** an
area, not a wave; the muster is **held open and not taken**, so the reading is
before replacements; and **a mortal Jedi is a different arm from one held on his
feet** — the same six seeds read 0, 9, 8, 6, 6 with the healing off. M5 declares
its mortality up front and rules out all three before reporting anything.

*Kills:* if standing with the line and fighting ahead of it produce the same run,
`lineIsUp` is inert and §1 needs a different keystone.

> **M5 REPORTED. THE GATE IS OPEN.** `tools/_m5.mjs --seeds 3 --minutes 5`,
> 2081 s of CPU, four cells:
>
> | station | rule | areas/min | kills | living | fallen | waiting(s) |
> |---|---|---|---|---|---|---|
> | near | on | 0.158 | 37.7 | 4.0 | 8.7 | 6.4 |
> | near | off | 0.172 | 19.7 | 5.7 | 7.0 | 0.0 |
> | far | on | 0.149 | 52.0 | 4.0 | 8.7 | 29.1 |
> | far | off | 0.227 | 56.0 | 5.3 | 8.7 | 0.0 |
>
> **The rule costs a player who LEAVES 34.1% of their ground and a player who
> STAYS 8.2%** — a four-fold separation, in the direction and of the shape M5
> was written to require: "the far pair differ and the near pair do not by
> much." The `waiting` column is the same finding measured directly and not
> derived: the run spent 29.1 s refusing to credit ground to a Jedi who left,
> against 6.4 s for one who stayed, and 0.0 in both `off` arms by construction.
> The far/off arm is also the only cell that took a whole area in every seed,
> which is the sentence FLAGSHIP §6 asks for — *"killing stays fast and fun and
> advances nothing"* — with the rule turned off so that it does advance
> something.
>
> `lineIsUp` is not inert. §4 is licensed. The one caution worth keeping beside
> the number: `areas` spread 0–1 over five minutes, so areas/min is coarse and
> the confirming arm is a longer, wider run rather than a tighter reading of
> this one.

**M4 — the browser frame.** There is no draw-call instrument. The diagnostic is
low FPS *with* low GPU usage (draw calls / JS) versus high GPU time (skinning,
shadows, overdraw). Until this exists, no rendering decision is licensed.

---

## 3. Building now — licensed by measurements already taken

These do not wait on M1–M4. Each names what already licenses it.

**B1 — the frame, and draft 3 quoted a fix as a defect.** The "physics is 47% of
the frame and it is spent on the dead" line is the **problem statement of commit
`06df3ee`**, which landed the fix — `Corpses.js` settles on centre displacement
now with a hard `SETTLE_CAP` for bodies that never settle. Promising "roughly
doubles the live budget" from it was quoting a commit message as live state.

So it splits:

- **M6 — re-measure physics against the post-`06df3ee` tree** before any of this
  is scoped.
- **B1a — index the cross-army pass. BUILT.** `src/game/ArmyIndex.js` is the
  broad phase, built on `BoxIndex`'s contract exactly as this line predicted,
  consumed by `World.js`'s cross-army pass (which is at `World.js:2989-3018`
  now, not the 2743 this bullet cites), and held by
  `tools/checks/army-index.mjs`.
- **B1b — ragdoll pooling and `Fallen` retirement.** SPLIT BY MEASUREMENT, and
  only one half survived it. **Retirement is built** — `Fallen.js` grew a
  `FallenField` and `Corpses.js`'s SINK step lays a prone instance where the
  body lies instead of deleting it, so the budget demotes the dead rather than
  losing them. **Pooling is struck**, and the measurement that strikes it is
  the deliverable; see §6's B1 entry for both sets of numbers.

**B2 — attack tokens. BUILT.** *This bullet was licensed by absence — "no
crowd-attack limiter exists in `src/`" — and `src/game/Tokens.js` is one:*
`TokenPool`, `WEIGHT` per attack kind, `capacityFor`, a FIFO queue and a cooldown,
constructed on the `World` and consumed by `Enemy`. A Jedi in forty bodies faces
three or four live attacks instead of forty, which is what this asked for.

**B3 — scale that costs no draw calls. ALL THREE BUILT.** The three-layer
distance audio bed is `Audio.BATTLE_BANDS` — near / mid / far, fed by the weapon
events the frame already raises and TAPPED BEFORE the audibility test, so the
rounds past 82 m that the per-source path throws away become the bed instead of
nothing; band edges derived from `HEARING_FLOOR` and `MAX_RANGE` rather than
chosen; O(bands) a frame on nine nodes. `Fallen` fields on the horizon are
`Battlefield.addFallen`'s ±150 m band; atmospheric perspective per ground is
`Scenery.Haze`; the parallaxing foreground is the 170/250/340 m ranges. "Truly
immense sense of scale" at zero frame cost, and now measured as such.

**B4 — extraction boarding. BUILT.** The "0–2 of ten men reaching the ramp" in
this line is the PROBLEM STATEMENT and it is kept in `Extraction.js` beside the
three fixes for it. The manifest is 10 of 10 on the drifts, the Colosseum and
alpine, and 6 on geonosis, whose spawn ring is 58–96 m against everybody else's
26–60. `Company.js` consumes it, so the gate it was meant to open is wired.

**B5 — the four open playtest defects. ALL FOUR FIXED**, each with a check.
Illegibility at range and the missing value separation are one file,
`src/world/Contact.js`, held by `cel.mjs` against WCAG contrast on seven
theatres; Command's theatre is declared (`fixedTheatre`) and honoured; the camera
in trunks is `Trees.js`'s `EYE_CLEAR`, which thins the DRAWN trunk and leaves the
collider where it was.

---

## 4. The game, designed in full

Written now rather than after M1, because measurement gates *building* and not
*designing*, and because "I don't want to go back and add anything" is
incompatible with a five-bullet promise. Each system names its **licence** (the
measurement that permits it) and its **kill** (what would prove it wrong).

### 4.1 A reason to stand, and a reason to leave

`lineIsUp` gives the reason to stand. The design needs the countervailing pull or
there is no decision — and `NEXT.md` names the open one: *"whether the mode gives
a player any reason to stand still, and today it does not: killing is fast,
killing is where the targets are."*

So the tension is explicit: **the line takes ground; the Jedi takes
opportunities.** Everything the Jedi can do that the line cannot is time-limited
and elsewhere. Leaving is correct, *and* the ground does not close while you are
away.

**And the "elsewhere" is already built.** Draft 4 said this needed no new
mechanic and then listed none that existed. `Sorties.js` ships — craft crossing
the sky on real paths at real cadences — and it is named nowhere in any previous
draft. **A strafing run you must mark from the ground, in person, away from your
line** is exactly a time-limited opportunity elsewhere, it composes with §4.2's
vision gate, and it is the same shape as the order you can check, which is an
artillery ellipse by another name. That closes "air support and ground support as
things you command", which every draft so far left as a table row.

*Kill:* a two-arm run on shipped code — does a script that never leaves the line
beat one that takes opportunities? **If they tie, there is no decision here and
this section is a story about the game rather than a mechanic in it.** Draft 4's
kill pointed at M1, which tests the Jedi rather than the tension.

*Licence:* `lineIsUp` is built and engages (6/6 areas, 14 s mean waiting).
*Kill:* if M1 shows the Jedi is worth nothing, the tension has no stakes.

### 4.2 Capability objectives — the currency the Jedi cannot provide

The set, all buildable from shipped content:

| Objective | Held | Lost |
|---|---|---|
| **Battery** (SPHA-T) | Artillery where you designate. **Needs a crew** | It fires for them |
| **Relay** | Stratagem cooldowns halved | Long clock |
| **Pad** | Gunship passes | Their gunship, on you |
| **Spire** | Vision: true front and their order of battle | You fight blind |
| **Foundry** | Reinforcement waves bring a heavy | Theirs do |
| **Shield** | One approach uncrossable until it is down | An approach you cannot use |

**A gun without a crew is scenery.** This is the mechanism that makes specific
named men load-bearing — the Jedi cannot crew a battery and fight at once. All
four blind researchers converged on it independently.

**And crewing a gun takes those men OUT OF THE QUORUM.** That is the sentence
that welds this section to the keystone rather than leaving it a good idea
sitting beside one: every objective you hold is ground you cannot advance onto,
because the men holding it are not standing with the line. Artillery is bought
with the same currency as movement, and the decision is which you need this
minute. Without this clause §4.2 reads identically with `lineIsUp` deleted.

**Off-map power is gated on vision** — the aim point must be inside territory
someone can see, which makes the spotter a man worth protecting.

*Licence:* the substitution problem is real even on the tuned build (his output
is 5.9–10.1 hp/s against the line's 2.5–5.2 — he still does most of the killing).
*Kill:* four-armed test — does the Jedi arm beat the no-player arm *more* with the
Battery on the field than without? If not, it is decoration.

### 4.3 The battle the brief asked for

**Draft 4's version of this section read identically with `lineIsUp` deleted** —
it was density plus a renderer, which is "make it bigger". The developer's
centrepiece was the one section in the plan that did not meld. This is it
rewritten around the front.

**The battle is large because two quorums are contesting the same ground.** B0
put both commanders under the same rule; this is what that produces at scale.

- **Mechs, air and reinforcements are the levers each general spends to break the
  other's quorum.** Not spectacle — the only ways to make half of a man's living
  army stop standing where it needs to stand. A walker driven into a formation
  scatters it; a strafing run does; artillery does. Each is *how you stop them
  taking ground*, which is a sharper reason to field one than "it looks right".
- **Squads meeting squads is delegation under contact.** A sergeant holding a
  piece of ground with a standing order, against another sergeant doing the same,
  while both generals are somewhere else. That is what three hundred men look
  like when the command interface is delegation rather than seven formations
  around one body.
- **Vehicles are how you move a quorum.** A Juggernaut or AT-TE is a piece of
  "near" that moves: men riding it are near each other and near you, so armour
  becomes how a line crosses open ground under fire — and losing it strands the
  quorum mid-field. `Riders.js` already makes a rider an ordinary body whose
  position is taken over by its mount, so one rule welds the eight shipped vehicle
  archetypes
  to the keystone. This is the answer to "make use of vehicles", which every
  previous draft left as a noun.
- **Transports arriving are the reinforcement pool made visible.** Both sides
  watch the other's ships come in and can contest the landing.

*Route to it:* density is M3 — one constant. The rendering ladder ships
(`Cohorts` 168-at-27 past 137.8 m, `MergedSkin` nearer); the missing piece is
named in `Cohorts.js` itself — *"every instance of one cohort wears one pose"* —
and animating that rung **was gated hard on M4**, because the honest ink fix is
per-object prepass materials and the prepass is already 118 of the meadow's 214
draws. THE INSTRUMENT EXISTS AND IS NOW READ — `src/engine/Profiler.js` reports
frame, JS and real GPU time with p99 and the 1% low, always on, and
`tools/_frame.mjs` pulls it out of a real Chromium and prints the split. The
first move on this rung has been taken: the frame here is 93–99% draw and 1.3–3%
our JS, and the reader carries an A/B/A rung that switches `OutlinePass.prepass`
off and back on to price the second rasterisation directly. On THIS box that
bracket lands inside its own noise band — a 2.5–3.8 s software frame cannot
resolve a 12% effect — so the prepass has a tool and still has no price, and
getting one means running `tools/_frame.mjs` where there is a GPU. The pose is
the second move and is not blocked on it.

**The front already exists.** `Battlefield.js` generates ground around a seeded
bezier front; `Front.js` draws it. Do not build a second front model.

**Dozens of Force users, honestly:** heroes rotate off by themselves if health
drains and only kills restore it. A duel claims physical space — an exclusion
radius troop AI will not path into — and pays out as a morale swing on both
retinues, which is how twenty of them stay legible.

*Licence:* M3 for density, M4 for the frame, M5 for the keystone this now rests
on. *Kill, written before M3 reports so that it can fail:* **the battle needs 120
simultaneous fully-simulated bodies with two real armies.** Below that it is not
the battle in the brief, and calling the shortfall atmosphere would be this
document pre-authorising itself not to deliver its centrepiece.

**And that kill may already have fired.** `scale.mjs` reads over budget between
16 and 30 bodies — **and that reading is retracted; see §0.** The instrument
warmed for 90 frames while fifty-two dressing props were still settling, so the
floor it found was somebody else's crates; the settled empty world is about
2.5 ms and `WARM` is 1200 frames now. **M7 IS STRUCK**: it existed to chase that
floor, and there is no floor. B1a is done (`ArmyIndex`), and the ladder has since
run to 160 bodies with 120 of them at 16.60 ms — so 120 is not unreachable, it is
measured. What remains true and worth stating is the direction of the bias:
`frame-ledger` blames 47% of a real frame on 288 rigid bodies against 39 living,
so a bar set on a benchmark that excludes the dead is optimistic — which is
exactly why B1b's corpse retirement was worth building and its ragdoll pool was
not.

### 4.4 The company — and it must work on a losing run

The developer's own diagnosis: *"you're either dying or quitting 99% of the
time."* So persistence gated on victory is persistence that never happens.

**Extraction is callable at any moment.** The transport has N seats; boarding
takes time under fire; men left behind are **MIA, not KIA** — recoverable next
run or lost for good. Every run becomes *which men do I spend this window on*,
and the layer functions on the runs that actually happen.

**The Company screen:** the roll (crest, serial, nickname, kills, runs survived),
the memorial (every man lost and the ground he fell on), and a per-man card with
his history and two things you may change — his kit, from `COMMAND_UNITS`, and
his appearance.

**Rank changes what a man can be ordered to do, never his health bar.** A
Sergeant accepts a standing order; a Corporal does not. Purchasable stats break
wave tuning permanently.

**Armour paint is permission you grant** (canon: Jedi Generals *allowed* the
clones to paint; unpainted rookies are shinies). Free consequence: you read your
army's veterancy across a battlefield at a glance and watch it get younger over a
losing campaign, with no UI.

**Nicknames are earned from a logged event** and the card prints the sentence
that earned it.

**And the between-run layer is the MUSTER, which already exists with the choice
taken out of it.** The developer asked for "a whole new minigame, like keeping
track of companions" and every draft so far answered with a screen. *This paragraph
described a screen that now exists.* `Screens.muster` raises a real card with
`recruit` AND `route` callbacks on it, `main.js` wires `d.onMuster` to it, and
`autoMuster` is the documented FALLBACK for when no card can be raised. The purse
is per-area and runs 11 / 14 / 17 / 26 / 30 across the five grounds — the "22
points" here is no rung of that ladder; the 5 a trooper is right. What the card
does NOT yet offer is promoting a survivor or banking the purse, and those two
are what is left of this bullet.

*Kill:* if players take the same option every time, it is a dialog and not a
decision, and `autoMuster` should keep it.

*Licence:* `Command.js` ships designations, five ranks, promotions and nicknames;
`Progress.js` ships the localStorage record; `Extraction.js` ships thirteen
phases. **The wire between them exists now**: `Company.js` consumes
`Extraction.manifest` through `World._endWithdrawal`, and `Menu.js` ships a full
Company tab — the roll, the fallen rows, a per-man dossier, a mark and a
callsign — held by `tools/checks/company.mjs`. What that tab does not let you
change is his KIT out of `COMMAND_UNITS`, and that is the only part of this card
still owed.

### 4.5 Co-op and versus, first class

**Two generals is the path to X-vs-X, and X starts at 2.** `Net.js` already runs
a second commander with an army; `assignArmies` already exists, and what this
line called "a documented defect (it ignores the peer's chosen side)" is a
documented and MEASURED omission: it gives the first commander what they ask for
and resolves every conflict after that against what is already taken, and with
only two armies on the field the peer's real order changes the assignment in **0
of 28** cases. It becomes worth sending the day there is a third army.

A Sith general who is *also* directing a line, who leaves his line for exactly
the reasons you leave yours, makes the battle turn on **who was somewhere else at
the wrong moment.** One extra `Player`-class body; no rendering work.

**And it is the co-op mode for the same code.** Your friend is the second general
on your side, or the one opposite. Two generals cover more of the field than one
can — which is genuinely better with friends rather than a scaling multiplier.

*Licence:* `Net.js` is divergence-tolerant by design (host reconciles by hp
delta, not trajectory). *Kill:* if two commanders cannot be kept in agreement on
`lineIsUp`, the mode's win condition desyncs and it needs a host authority.

### 4.6 Variance — and it costs no new content

Licensed by nothing needing measurement, and it is the developer's most repeated
request:

- **The holocron offers three of the currently-legal facets, not all 52.** Same
  52 nodes, same adjacency; only the *offer* changes. (Written as 46 when the
  table had 46; it has 52, and two comments inside `LivingForce.js` still say 46
  as well.) A solved build order
  becomes a found one.
- **Eight facets that change rules rather than numbers.** *Push ragdolls allies
  too. The saber absorbs instead of deflecting. Shattering a prop refunds
  Insight.* **At least two of the eight must change the QUORUM** — *advance on a
  third of the living, but the muster is halved; a downed man counts if a medic
  is on him.* Variance that cannot touch the keystone is variance in a side
  pocket, and this is the difference between melded and parallel.
- **A branching route** over the five Command areas that already exist, with
  partial information: you see the ground, the weather and the garrison weight,
  not the contents.
- **Player-authored difficulty** driving Insight income — pick which axes get
  harder, get paid for it. Not Easy/Normal/Hard.
- **Composition constraints**, not just budget size: *armour column* (40% must be
  vehicles), *mono-kin*, *bladed*, *droid host* (no dismemberment, no morale, but
  `rend` is devastating), *beast drive*.
- **Modifiers with caps**: at most two, at most one beneficial, one guaranteed
  clean battle per rotation, pairwise blacklist. **A modifier that only
  multiplies enemy health is not content; one that removes or delays a verb is.**

Seven grounds × `Battlefield.js`'s seeded fronts × 37 archetypes × the above.

### 4.7 The battlefield changes, and you change it

*Licence:* the crater persistence verdict **turned over for the drawn channel** —
`Terrain.scars`, 13.2% of pixels wide-shot and **33.4% at eye height over twenty
sorties**. The *geometry* claim stayed dead: "cratered coverage stops growing by
sortie 10 and walkability has moved 0.2 points by sortie 20."

So: **the ground remembers visually, and `Dig In` is what makes it cover.** A
sapper turning a crater into a real position is the only thing that produces
defilade, because artillery measurably does not. And it is the necessary
companion — *Fracture* (2008) made terrain deformation its whole pitch and failed
because the AI ignored the ground the player sculpted.

**Cover is finite.** Pre-fractured props degrade over a long battle, so a late
act is more lethal than an early one with no number changing.

**Weather disables one verb and enables another.** *This paragraph used to read
"there is no `Weather.js`; snow is level dressing. **Weather is entirely
unbuilt**, five systems… it moves to the back of the graph and it is the section
most likely to be cut", and every clause of that was false when it was written.*
`src/world/Scenery.js` exports a full `Weather` class and a `weather` singleton;
all seven grounds author a squall; snow FALLS at its own terminal speed with the
wind raking it over. The one thing genuinely missing was that nothing ever asked
whether you could SEE through it, and that is built too: `Smoke.setAir` puts what
the storm adds to the level's own fog into the optical-depth model that
`Enemy._canSee` and `_aimedShot` already read, and at each ground's own peak a
rifle's sight falls to 19-34 m. §6 retracted this sentence and this section kept
it, which is the whole failure mode in one place — the retraction is where a
reader is not looking, and the section is where they set their scope. What is
still owed is the OTHER verbs below. The design: sandstorm
kills ranged fire both ways and leaves Force sense working, so you become your
army's eyes; blizzard costs sightlines but carries sound; ash grounds air and
speeds fire; rain conducts lightning between men in contact. **No dark maps** —
the player owns the canvas and a gamma slider defeats darkness; use fog and dust,
which are in-world occluders.

### 4.8 The rest of the unprecedented set

`lineIsUp`, the two-line front and the order you can check are in §1 because they
are the design rather than additions to it. These three are the remainder, each
researched as having no shipped precedent. The last is honestly bolted on — it is
cheap, it is good, and it does not compose with anything; that is stated rather
than dressed up:

- **Contested telekinesis.** Two Force users gripping one rigid body as a shared
  constraint, both spending pool, the object shuddering between them. Break his
  guard and the resistance cap collapses from a half to a FIFTH — *already in the
  code* — and it becomes a projectile with his name on it. In Psi-Ops, Half-Life
  2, The Force Unleashed and Control, exactly one entity owns an object.
- **Squadmates grab the man you are gripping.** One joint, one break force: a
  gripped body reaches for the nearest collider and a squadmate grabs *him*. Grip
  one, drag two, the contest resolving against combined mass.
- **Graves at true coordinates**, and this is **one system with §4.7's ground
  memory, not two.** `Terrain.scars` already persists visually across sorties —
  33.4% of pixels at eye height over twenty. The ground remembering *and* the
  dead being on it is a single mechanism: a marker where each man of the company
  fell, on that ground, in later runs, with the surviving squad's morale
  reacting when they walk past it. Nobody has persisted the geography of your own
  losses.

### 4.9 Making real-time permadeath survivable

**Downed, not dead** — a bleed-out window; an enemy reaching the body finishes
it; a medic or your Heal saves him. The interruption that makes you break off a
duel, and it means the last word on every death is the player's.

**And a downed man does NOT count toward the quorum.** This is a decision, it is
free to take, and it decides whether this section is a feature or the game. If a
bleeding man still counted, dragging would be optional and the bleed-out window
would be decoration. He does not count — so the quorum rule and the bleed-out
window are in direct tension, **and that tension is the game**: to advance you
must physically recover your wounded, under fire, while the thing that wounded
them is still there. `Command.js` already has troopers dragging comrades to
safety; this is what makes that behaviour matter.

**The after-action report** — who killed whom, from what direction, at what
minute. No death is mysterious, so no death is the AI's fault. It is also the
ending beat every session needs.

---

## 5. The decision that is the developer's, and the log says so

> "The decision that is still nobody's to take unilaterally: **how much of a
> ten-man roster one engagement should cost.** It is load-bearing now (The Line
> loses the run on a wipe) and **it belongs to the player**, not to a constant in
> the composer."

Currently an engagement costs roughly three to four men of ten without a Jedi,
and two to none with one. **This sets whether the game is a grinder or a
campaign, and it needs an answer before §4.4's persistence is tuned.**

---

## 6. Order

Draft 3's `then` bucket was seven parallel workstreams with no dependencies drawn
between them, which is where comprehensiveness goes to be indefinitely partial.
This is a graph.

```
NOW — measurements
  M5  does lineIsUp change play? ......... REPORTED — see §2. 34.1% of a
      leaving player's ground against 8.2% of a staying one. The gate is
      open and the chain below is licensed.
  M1  twenty-seed reference arm ........... **REPORTED.** `tools/_linehold.mjs`,
      theline on geonosis, engagement 1, twenty seeds, three arms:

          none   survivors 6.7/10   cleared 18/20   median 202 s
          idle   survivors 1.0/10   cleared  3/20   median 185 s
          blade  survivors 4.7/10   cleared 11/20   median 239 s

      THREE READINGS, AND TWO OF THEM ARE UNCOMFORTABLE.

      **The floor is easier than the target.** §5's own words are "an
      engagement fought with no help from the Jedi should cost roughly HALF a
      ten-man line — about 5 of 10". It costs 3.3. The line alone clears 18 of
      20 engagements, so the ground the mode is built on is about a third
      cheaper than it was asked to be.

      **An idle Jedi is far worse than the phrase for him.** `Levy.js` says "an
      idle Jedi is not a Jedi; it is a corpse with a delay" — measured, he is a
      catastrophe: 1.0 survivor against the empty field's 6.7, and 17 wipes in
      20. He is a body the levy walks at, so he pulls a wave onto a line and
      then does not fight it. That is the mode's own thesis about presence,
      and it is much sharper than anyone had written down.

      **AND A JEDI WHO FIGHTS FROM HIS LINE IS STILL A NET NEGATIVE.** 4.7
      against 6.7: the line does BETTER with nobody there than with a blade on
      the field. This was first written up here as "a Jedi who ONLY FIGHTS",
      on the reading that `dutyInput` chases the nearest enemy and is therefore
      M5's bad player — **and that was wrong about the code.** The script holds
      station on the line's own CENTROID and leaves it only for something
      inside `ENGAGE`, and only while he is inside an 18 m `LEASH`; its own
      note says it holds station there "so when the formation advances the
      Jedi advances with it and `MORALE.JEDI_NEAR` keeps paying". So BLADE
      already IS a Jedi who stays with his men and fights from among them, and
      the result is sharper than the softer reading allowed.

      **AND THE CONTROL HAS NOW RUN, AND IT ANSWERS THE WHY.** `standOff` — the
      same script, the same guard, the same keep-alive, holding station a
      hundred metres off — existed in `_flagship.mjs` with this exact argument
      attached and had never been driven. Twenty seeds:

          none   6.7/10   cleared 18/20   67 s a wave
          blade  4.7/10   cleared 11/20   79 s      (with the line)
          far    3.8/10   cleared 12/20   83 s      (100 m off)
          idle   1.0/10   cleared  3/20   67 s

      **A Jedi a hundred metres away still costs the line 2.9 men.** He is not
      near anybody, so the men are not dying in fire aimed at him: PRESENCE IS
      NOT WHAT KILLS THEM, and the other explanation is the one left standing.
      What moves with the cost is the LENGTH of the engagement — 67 s a wave
      with no Jedi, 79 with one in the line, 83 with one standing off — and the
      extra minute is paid by the men. A Jedi makes the fight longer and the
      line pays for the time.

      **Being WITH the line is worth about one man** over standing off (4.7
      against 3.8), so `MORALE.JEDI_NEAR` and the rest of the presence term do
      pay — they simply do not pay enough to beat not being there at all.

      SO §1's PROMISE IS NOT MET AS MEASURED. "Your job is to be the reason the
      line is still standing when it takes the ridge" — and the line is still
      standing more often when nobody comes. That is the sharpest thing this
      document now contains, and it is a BALANCE finding rather than a broken
      mechanism: every part works, and the arithmetic of what a Jedi is worth
      against what his presence costs comes out negative. The mechanism behind
      the length is not proven, only correlated, and naming it is the next
      measurement: whether the director paces on a player, whether the levy
      walks at him, or whether a wave simply survives longer with one blade
      pulling bodies off the line's guns.

      **AND THE FIRST OF THOSE THREE IS THE ANSWER — WITH A COST.** The
      director DOES pace on a player. `WaveDirector._watchdog` scores a body's
      progress as its distance to the nearest live PLAYER, which was the whole
      question when the only thing on your side of the field was you. In
      Command it is not: the horde's fight is your ARMY. So on the `none` arm —
      no player on the field, the CONTROL every other arm here is read against
      — every living enemy reads stalled and the director retires it.
      `tools/_whywave.mjs`, theline/geonosis, engagement 1, five seeds, fifteen
      cleared waves:

          236 rescues and 118 RETIREMENTS a run — 39.4 a wave, against
          10.5 bodies the line actually shot. Of the wave's 8.4 paying
          regulars the line killed 3.2 and the watchdog DELETED 5.2.

      **The unaided line was not winning. The clock was deleting 62% of the
      wave standing in front of it.** The fix is 52 lines: let a body also
      count progress toward `e.target`, which `Enemy._think` writes every frame
      off `World.pickTarget` — the game's one statement of who a body is
      fighting, already aware of the other army, the team gate and the leash.
      It is written, measured and NOT IN THE TREE, at
      `tools/_watchdog.patch`. It fires wherever the player is not: a
      bench arm, a Jedi a hundred metres off his line, **and every frame after
      the commander goes down in shipped play.**

      IT IS OUT BECAUSE IT IS A BALANCE DECISION, NOT A CODE ONE. Same mode,
      same ground, same seeds:

          stock       3, 4, 5, 9, 8 of ten left · 5 of 5 areas cleared
          honest      0 of ten, every seed      · 0 of 7 cleared

      — and `theline.12`, *"an engagement fought without the Jedi costs about
      half the line"*, a check already in the gate asserting §5's own target,
      goes red at **0.0 of 10 standing: the muster is never reached and the
      mode cannot be won.** Landing the fix lands a difficulty re-tune with it,
      and which knob gives — wave budget, `RULE_MAX`, morale, or §5's target
      itself — is the developer's call.

      **SO EVERY NUMBER IN THIS ENTRY IS MEASURED AGAINST A PROPPED FLOOR.**
      `none 6.7/10` is not what an unaided line does; it is what an unaided
      line does while the director kills five men a wave on its behalf. The
      three readings above are RELATIVE to that floor and survive as
      directions, not magnitudes: idle is a catastrophe, a blade in the line
      still costs men, and LENGTH is what moves the cost. All of them must be
      re-run after the tune rather than carried across it. The length finding
      in particular is now suspect from both ends: a longer engagement is also
      one the watchdog has had longer to prune.
  M2  teamDamage bound ................... ANSWERED, and this document quotes
      the answer four hundred lines above the question — §2's dealer census
      reads "bolt 99.3%, friendly fire 0.7%". 0.7% IS the ceiling on any
      friendly-fire work, and `command.mjs` already drives `teamDamage: 0`
      and asserts it is exactly nothing.
  M3  density ............................ RUN, and the one-liner contradicted
      §2's own conclusion. §2 says "leave the gate alone" and `World.js`'s
      cross-army pass carries that decision in writing; `tools/scale.mjs` has
      since run the ladder in the two-army front layout to 160 bodies, 120 of
      them at 16.60 ms. AND `LEVY_STRENGTH` IS ALSO ALREADY DECIDED, against
      raising it, in `Levy.js`'s own note and with the arithmetic beside it:
      a levy's cost is linear in bodies at every rung of the ladder — no levy
      is 18 bodies and 767 body draw calls, levy 40 is 64 bodies and 1 415,
      which is 14 calls a body against the 45 a contact body costs because
      most of the mass is still crossing at L1 and L2 — so eighty is 2 830
      calls at the same peak and there is nothing in the ladder that bends.
      Both halves of this entry are decisions with numbers under them, not
      omissions, which is why the label read as work and was not.
  M4  browser frame instrument ........... BUILT AND NOW READ.
      `src/engine/Profiler.js` reports frame, our own JS, REAL GPU time through
      `EXT_disjoint_timer_query_webgl2`, p99 and the 1% low; it is always-on,
      `Engine` constructs it, the HUD reads it and `tools/checks/profiler.mjs`
      holds it. The reader it never had is `tools/_frame.mjs`: boots the shipped
      page in Chromium, deploys into `theline` on geonosis, plays a stated
      number of frames and prints the split, on a ladder of rungs that share one
      boot. FIRST RESULT, and the one that unblocks 9 below: THE TIMER QUERY
      RESOLVES here — ANGLE on SwiftShader-Vulkan answers it on every frame — so
      §4.3's "GPU-bound or JS-bound" is answerable by tool rather than by
      argument, on this box and on any player's. What it answers HERE is that
      our JS is 1.3–3.0% of the frame and the draw is 93–99% of it, at 2.5–3.8 s
      a frame, which is a software rasteriser being a software rasteriser: the
      SHARE is a real reading of this machine and is not a prediction of anyone
      else's. The counts are: 12 living men on geonosis draw ~2400 calls and
      ~1.9 M triangles a frame at quality high, and 40 more men add ~2430 calls
      and ~618k triangles. The millisecond deltas resolved at load 5 on four
      cores (+400 ms for those 40 men, 10 ms a body) and did NOT at load 8; the
      tool prints its own noise band and says which.

NOW — building, licensed by measurements already taken
  B0  TWO LINES MAKE THE FRONT ............ BUILT. `CommandDirector._front`
      reads BOTH commanders, gates each on `lineGathered(c)` — which is the
      split that fixed the real bug, since `lineIsUp` opens with a clause that
      answered true for both sides and made the gathered test dead — pushes a
      shared `front` scalar, and ends the meeting through `World._endMeeting`
      at a baseline. The scalar is on the wire and drawn (see 8 below).
  B1  pooled ragdolls, instanced corpses .. CLOSED, and half of it by
      DELETION. `ArmyIndex` is the broad phase and `Corpses.js` bounds settle,
      cap and budget, which is why 120 bodies fit a 16.60 ms frame. The two
      halves left were priced separately and only one of them was worth
      building.

      RETIREMENT — BUILT. `src/world/Fallen.js` grew a `FallenField` (a
      preallocated pair of `InstancedMesh`, `GraveField`'s shape) and
      `Corpses.js`'s SINK step now lays a prone instance where the body lies —
      under a settled corpse as the fade STARTS, so it dissolves off a figure
      already there, and on the last frame for one the cap ended while it was
      still travelling. The budget stops deleting the dead and starts demoting
      them. Licensed by a draw-call reading nobody had taken —
      `tools/_farcorpse.mjs`, a B1 on geonosis, shipped build:

          100 m   alive  4 meshes (the L2 merged skin)   dead  44
          163 m   alive  0 meshes (the L3 cohort)        dead  44

      A body gets CHEAPER as it walks away and eleven times DEARER the moment it
      falls, because `MergedSkin`'s staleness drops the L2 bake on
      `actor.ragdolled` — correctly — and `Enemy.update` returns on `dead` above
      the line that would re-ask for the cohort. There was no rung below a
      corpse, so everything past `CORPSE_BUDGET.high` — twenty — had to be
      deleted. There is a rung now, at two draw calls for the whole field
      however many are in it. `undertaker.mjs` holds the property
      and reports the trade it measured: five B1 corpses drawing 225 meshes
      against one instanced draw call.

      POOLING — STRUCK, and the measurement is the deliverable.
      `tools/_ragdollcost.mjs` on `lifecycle.mjs`'s own fixture, 30
      build/ragdoll/dispose cycles after 6 warm-up, CPU (three runs, load
      4.7-5.9 on 4 cores — the contention is why these are a range):

          one ragdoll        19 rapier rigid bodies, 19 colliders, 18 joints
          goRagdoll()        1.78 - 2.76 ms median
            physics.add      0.72 - 0.77   (the WASM: createRigidBody + collider)
            addJoint         0.12 - 0.13
            three.js         0.82 - 0.83   (holders, reparenting, matrices)
          dispose()          0.34 - 0.40 ms
            physics.remove   0.16 - 0.19
          end to end         2.17 - 3.10 ms per death

      **Nothing leaks.** Rapier's own counters — `world.bodies.len()`,
      `colliders.len()`, `impulseJoints.len()` — come back to exactly where they
      started over all 30 cycles, and so do the wrapper's arrays.

      A death is an EVENT and not a load, so the figure has to be multiplied by
      a rate before it can be compared to a frame, and §2's M5 table is five
      real minutes a cell: 19.7-56.0 kills and 7.0-8.7 own fallen, so
      **0.1-0.25 deaths a second**. At that rate the whole of construction and
      teardown is **0.02-0.08% of every frame** — and at ten a second, forty
      to a hundred times the measured rate, it is 2-3%. A pool's ceiling is the 0.90-0.92 ms
      that crosses into WASM, so **0.009-0.023%** of a frame, and that ceiling
      is generous: it assumes a pooled body needs no re-seating at all.

      And it could not return even that. `Body._unbind` is
      `world.removeRigidBody` — taking a body out of the Rapier world DESTROYS
      it — so a pooled ragdoll has to keep its nineteen bodies IN the world,
      which is exactly the **573 → 33** bodies `Corpses`' SETTLE step exists to
      remove and the 47%-of-`world.update` physics line that step bought back.
      A pool would pay that to save 0.01-0.02% of a frame. It is not a small
      win, it is a negative one.
  B2  attack tokens ...................... BUILT. `src/game/Tokens.js`, a
      `TokenPool` on the World, consumed by `Enemy`.
  B3  audio distance bed, horizon, haze ... BUILT, all three thirds. The two
      visual ones already shipped — `Scenery.Haze` and the 170/250/340 m
      parallaxing bands, and `Battlefield.addFallen`'s horizon dead. THE AUDIO
      THIRD IS `Audio.js`'s `BATTLE_BANDS`: three sustained layers at near /
      mid / far, gains driven by the weapon events the frame ALREADY raises
      (`blaster`, `boltHit`, `explosion`) binned by distance to the listener.
      The band edges are derived, not chosen — 82 m is where a rifle round
      drops under HEARING_FLOOR and 190 m is MAX_RANGE, so the bands are
      exactly the three regimes the per-source path already has, and the bed
      carries the two it throws away. Measured through the shipped engine
      (`tools/checks/audio.mjs`): six rounds a second holds 0.019/0/0 at 20 m,
      0/0.056/0 at 120 m and 0/0/0.084 at 240 m; an empty field costs zero
      automations; 9,000 weapon events on top of a live engagement cost one.
      Nine nodes, built at init. It is still scale at zero frame cost, and now
      it is measured as such.
  B4  extraction boarding ................. BUILT and measured. The "0-2 of ten
      men reaching the ramp" in this line is the PROBLEM STATEMENT, kept in
      `Extraction.js` beside the three fixes for it; the manifest is 10 of 10
      on the drifts, the Colosseum and alpine, and 6 on geonosis, whose spawn
      ring is 58-96 m against everybody else's 26-60. `Company.js` already
      consumes it, so the gate this was supposed to open is wired.
  B5  four open playtest defects .......... ALL FOUR FIXED, each with a check.
      Illegibility at range and the missing value separation are one file,
      `src/world/Contact.js`, held by `cel.mjs`; Command's theatre is declared
      (`fixedTheatre`) and honoured; the camera in trunks is `Trees.js`'s
      `EYE_CLEAR`, which thins the drawn trunk and leaves the collider alone.

**SEVEN OF THE NINE ENTRIES ABOVE WERE STALE OR WRONG**, and that is the same
defect §4.7 carried when it called weather "entirely unbuilt, five systems" on a
tree that had shipped a full `Weather` and seven authored squalls. A plan is
read to set the scope of a session; an entry that describes work already done
buys a session of rediscovery, and one that describes the code wrongly buys
worse. Both of the entries that were genuinely unbuilt when this block was
rewritten have since been built: B3's audio bed, and M4's reader
(`tools/_frame.mjs`), which is what unblocks 9 below — HANDOFF had been carrying
that rung as "gated hard on M4" since before the profiler existed.

**AND THE SAME AUDIT WAS THEN RUN OVER §0-§4, WHERE IT FOUND TWENTY-SIX MORE.**
66 claims about the codebase checked, 40 true. §4.7 still said weather was
"entirely unbuilt" — the very sentence this block retracts — because a
retraction lives where nobody looks and the claim lives where everybody does.
§0's physics table is retracted by `scale.mjs` itself (fifty-two dressing props
were still settling after its 90-frame warm-up; the empty world is ~2.5 ms, not
5.74, and `WARM` is 1200 now), so **M7 chases a number that no longer exists and
should be struck.** §3's whole building list and much of §4's prose describe
shipped systems as unbuilt. Each has been corrected in place.

**WHAT IS ACTUALLY LEFT, after both audits**, and it is short:

  · ~~**B1b**~~ — **STALE, and §3 says so six hundred lines above this list.**
    Retirement is BUILT: `Fallen.js` has a `FallenField`, `Corpses.js`'s SINK
    step lays a prone instance where the body lies instead of deleting it, and
    `LIE_SINK` is the seat both use. Pooling is STRUCK by measurement, and the
    measurement is §6's B1 entry. Nothing is owed here.
  · ~~**§4.8's first two bullets**~~ — **both are built.** The contest is
    `gripClaim`/`gripRelease`/`gripSeize` in Enemy.js, resolved by
    `forceResistance` itself so there is no second rulebook; the grab is
    `Reactions.reachForHelp`/`stepGrab`, one joint driven at `DRAG.haul` from
    `DRAG.reach` away with a break force of `DRAG.haul × DRAG.reach`, and one
    combined mass — `Enemy.heldMass` — that the cap gate, `_heft`, `_holdRate`
    and the throw all already read. `tools/checks/grip.mjs` holds both.
    Struck from this list.
  · ~~**A SCREEN for the after-action report**~~ — **BUILT, and building it
    found a defect in the record it draws.** `Session.runReport` projects the
    director's log into the run: areas in the order they were fought, each with
    its dead, its fire missions and who came up behind them, and — the half
    that earns the screen — THE CENSUS. "Eleven men lost. Seven to Super Battle
    Droids, three to your own fire missions" is the muster's next purchase and
    the next order both, it is not derivable from anything else on screen (the
    interlude never aggregates, the roll never counts), and a player who reads
    "by a B2" six times across four musters twenty minutes apart does not add
    them up.
    A PANEL ON THE PAUSE CARD and not a state of its own: `src/ui/Screens.js`
    exists because of an overlay a player could be stranded in, and the two
    disclosures already on that card are the shape this game uses for "more, on
    the card you are already looking at" — no new state, no new Escape rule, no
    new hider. Said again in one line on the death card, which is the one
    screen the pause card cannot reach.
    **AND `killerName` HAD NEVER NAMED ANYTHING.** It ended `source.A?.name ||
    source.type`, an archetype has no `name` — the field is `label` — so the
    first half was always undefined and every death in every report this game
    has ever drawn was attributed to `b2` and `droideka` rather than to a Super
    Battle Droid and a Droideka. The graves in `Terrain` carried the same keys.
    `tools/checks/report.mjs`, 13 checks, every one written to go red on a
    report that lists without counting.
  · The Company tab's refusal to change a man's kit is **a decision, not an
    omission** — `Menu.js` argues it where it makes it ("a roster screen that
    could edit them would be a cheat panel with a casualty list on it"), the
    alternative it names is the rank ladder he can EARN, and `company.mjs` fails
    the day a fourth editable field appears. Struck from this list.
  · **The muster card cannot promote a survivor or bank the purse** — it offers
    replacements and §4.6's road, and those two options are what is left of that
    bullet.
  · ~~**M1**, unrun~~ — **reported, four arms, and it is the sharpest finding
    in this document.** See the entry above. What is left of it is a
    DECISION and not a measurement: `_watchdog` paces on a player, deletes
    62% of the wave when there is none, and the fix that makes it honest
    wipes the unaided line and turns `theline.12` red. Which knob gives is
    the developer's call, and every M1 magnitude is provisional until it is
    made.
  · **M7 is struck** — §4.3 says so where the number it chased used to be.
  · **NOT A FEATURE, BUT IT BELONGS ON THIS LIST: ten checks were not meeting
    §7's own standard**, and two of them were covering live defects. Audited by
    asking which checks would still pass with the feature deleted; the answer
    was ten out of ~1900, which is the real headline, and all ten are fixed with
    the passing deletion written into the check. The three shapes are traps
    §2.3b–d in HANDOFF: a read of a field nothing writes (`world.notes`,
    `world.notices`, `A?.name`), a reader test that greps the whole tree and
    finds somebody else's field (`.fireRate` off an ARCHETYPE), and a
    fixed-length source window spelled as a regex (one of which had been reading
    four thousand characters of doc comment).

AFTER M5 — the chain, in dependency order
  1  §4.4 squad delegation + sergeants ..... BUILT. `c.squadPlanted` gives each
     squad its own ground; `_anchorFor` solves the shape around it; the quorum
     counts a man near WHERE HE WAS TOLD TO BE. Three checks in command.mjs.
  2  §4.2 capability objectives ............ BUILT. src/game/Objectives.js, six
     sites, crewed by whoever stands on them — so the interface is (1)'s
     delegation and there is no new verb. The weld holds: a crewed gun's men
     are out of the quorum, asserted A/B on the same men in the same places.
     AND THE FOUR-ARMED ACCEPTANCE HAS REPORTED — `tools/_m6.mjs`, four
     seeds × five minutes × four arms, the same squad posted on the same
     ground in every arm so the only thing that differs is whether that
     ground is a gun. **A Jedi is worth 82.1 s of run with a battery on
     the field and 0.1 s without one** (225.4 s against 143.3 with;
     177.8 against 177.8 without). This section's own kill was "if not,
     it is decoration".
  3  §4.9 downed-not-dead + after-action ... BUILT, and it has been for longer
     than this line has said otherwise. `Enemy.goDown` and `MODES[*].downed` are
     the state; the quorum's other half is `lineGathered` excluding the downed,
     quoting §4.9 verbatim where it does it; and the after-action record is
     `killerName(source)` plus a bearing and a minute on every entry. Triage
     (§4.6) is the counter-rule that pays a man for standing over one. What is
     NOT built is a SCREEN for the report — the record exists and nothing draws
     it end-to-end.
  4  §4.4 company + Company screen ......... needs B4, 1 and 3
  5  §1 the order you can check ............ BUILT. src/game/FireMission.js.
     High Command lays an ellipse, an honest estimate that is never revised,
     and a window; one keypress clears it. Reading it costs 12 s inside 70 m
     of the mark (4 s with Force sense), and the weld is the geometry rather
     than a clause — measured, three arms, same order and same ten men: walk
     out at your line's pace and 10 OF 10 are inside the ellipse; sprint out
     alone and none are, but the quorum is DOWN for the whole reading; plant
     them first with §4.4's delegation verb and you pay neither. The shells
     carry a source on nobody's side, so `installTeamDamage` cannot blunt them
     on your own men (120 hp against 42) and `killerName` names them: every
     man they kill enters the after-action report as "by your own fire
     mission".
  6  §4.7 Dig In, finite cover, weather, graves ... BUILT, all four.
     DIG IN is `FORMATIONS.digin` and `CommandDirector._digTick`: a squad
     turns its own planted ground into a position in 22 s with its hands
     full (a digging squad holds its fire), cut through `Terrain.crater`
     so `CraterLog` carries it into the next engagement. Measured on a
     real world at the shipped LOW tier, twelve rays from a shooter's
     muzzle to a chest — flat 0/12 blocked, one shell crater 2/12, a dug
     position 12/12. The defilade is SYMMETRIC and that is the trade: a
     chest and a muzzle are 2 cm apart on every body in this game.
     FINITE COVER was already true and nobody had measured it: a real
     sitting stood 54 props at deploy and 49 six minutes later, off 137
     hits nobody aimed at cover.
     GRAVES are `src/world/Graves.js` — a named man leaves his rifle in
     the dirt where he fell, for the run, two draw calls for all of them.
     WEATHER was the expensive error in this section. "Entirely unbuilt,
     five systems" is wrong: `Scenery.js` ships a full `Weather` and all
     seven grounds author a squall. What was missing was that nothing
     ever asked whether you could see through it. One number now — what
     the storm ADDS to the level's own fog — reaches the model that
     already decides what a shooter can see, and at each ground's own
     peak a rifle's sight falls to 19–34 m.
  7  §4.6 variance ......................... SIX RULE FACETS BUILT, and two
     of them move the quorum, which is what this item was gated on.
     Skirmish Order takes the ground on a THIRD of the living and halves
     the muster; Triage counts a man on the ground while somebody is
     standing over him. Beside them: Stand Fast (a rout becomes a place),
     Field Engineering (§4.7's positions in half the time), Storm Sense
     (the one thing allowed to break the sight model's symmetry) and
     Salvage (§4.6's own example — breaking cover pays Insight). Each is
     measured A/B on the same bodies in the same places in
     `tools/checks/variance.mjs`.
     THE HOLOCRON OFFERS THREE of the currently-legal facets and not all
     fifty-two: `offerNow` draws off the run's own seed XOR how much has
     been bought, so a solved build order is a found one, and
     `LOCKED.offer` is why a facet you can afford is not on the table.
     PLAYER-AUTHORED DIFFICULTY AND THE CAPS ARE ONE DECISION, and both
     are built. The rules panel paid nothing, and the exchange rate for
     fixing that was already in the source: `conditionCost` charges a
     DEALT condition `worth · budget` and explicitly skips a RULE, which
     is the game's own statement that a wave under a rule is `worth` more
     fight. So `hazardPay(rules) = 1 + Σ worth`, the Insight a wave pays
     is multiplied by exactly that, and repricing a condition moves the
     payout with it rather than leaving a second table behind.
     **Measured, forty waves under DELUGE+SILENCE: 56 Insight becomes 82,
     and 5 facets bought become 6** — the raise arrives early enough to
     buy something, which is the difference between a decision and a
     bigger number. `Communion.earn` carries the fraction so the purse
     stays whole. AND THE CAP IS TWO: `CONDITION_MAX` was answering two
     questions at once — what the COMPOSER may carry (still 4, still the
     stranding measurement at waves 100/140/200) and what the PANEL may
     sell. `RULE_MAX` is 2, because with seven rules and a cap of four
     you tick four and stop reading. "At most one beneficial" is
     deliberately NOT built: every entry in `CONDITIONS` is a handicap,
     so the clause would be a branch no input can take.
     COMPOSITION CONSTRAINTS, four of the five named, and none of them
     costs a new field: `ARCHETYPES[*].toughness` has been the game's
     material classification all along. ARMOUR COLUMN (everything plated),
     ONE MATERIAL (one kin a wave, a different one next wave), DROID HOST
     and BEAST DRIVE. *bladed* is not among them because `silence` already
     filters to `!ranged`, which IS the bladed roster. All four are
     RULE-ONLY and that is measured rather than tidy: a roster narrowing
     DEALT at depth is what strands a budget — the two already dealt push
     the Colosseum to 51–59% unspent at wave 100, and four more stopped
     the body cap binding at all. THEY FOUND A REAL BUG: `_setPiece` built
     its ladder from the LEVEL's pool rather than the wave's narrowed
     roster, so a boss wave under ARMOUR COLUMN fielded an acolyte and a
     master; NO GUNS had the same hole and passed on luck.
     THE BRANCHING ROUTE IS BUILT. `stages` keeps the length the seed
     rolled and the player picks which grounds fill it: at each boundary
     the legal window is one rung past the ground just held, up to the
     last rung that still leaves room for the slots after it, so the
     route is always forward, always ends on the Core Ship, and always
     runs the promised number of engagements. What is shown is the
     ground, its waves and a garrison BAND — `garrisonBand` ranks
     `budget × (1 + heavy)` against every area's rather than thresholding
     it, so a retune re-deals the words with no second table. What is
     hidden is the composition, and the check asserts the offer's exact
     key set to keep it that way. Measured, one Push seed forked two
     ways: ground, rung, muster (17 against 26), band and total payout
     all move; the engagement count and both ends do not.
     Three limits, stated rather than papered over. **Only a Push forks,
     and only once** — pinned ends plus strictly increasing rungs means a
     fork also needs a non-end slot, and a Grind is five over five while
     a Raid is two ends. That is arithmetic; the lever for more is a
     sixth ground. **Per-area weather does not exist** and was left out
     rather than faked: `Scenery`'s squall is configured once per LEVEL
     and a crossing is one level, so both candidates would carry the
     identical weather, which is an element that changes no decision.
     **A branch moves the run's total wave count** by one on a Push, and
     nothing asserts on that sum.
     AND THE FLOOR IS BUILT, which was the last of it. ARMOUR COLUMN was
     a FILTER — everything plated — and the measurement killed it: on four
     of the seven theatres the whole plated roster is `b2` and `droideka`,
     so the card fielded 0% enormous bodies at every depth while its own
     tell said "some of it drives". It is now `ARMOUR_SHARE`, one named
     constant carrying §4.6's own 40%, reserved in `_composeUnder` beside
     the head and the set-piece and for the head's own reason: `_upgrade`
     spends the budget to nothing, so armour bought after the fill can
     never be afforded. **Measured in THREAT and not in count** — count
     cannot be reserved, because `HEAVY_CAP` is ten bodies and 40% of a
     wave-100 field of ninety is thirty-six walkers. Measured across the
     four theatres that can field it, heavy share of the wave without the
     floor → with it: **24→42% and 25→50% at wave 15, 27→43% and 52→63%
     at wave 30**, and unchanged at wave 70 — where the frame-rate ceiling
     has already bound and the plain wave is carrying the same armour the
     rule would buy. Three theatres lose the card (`needs` now asks for
     something enormous rather than something plated, and scoria, the wood
     and the alpine station nothing enormous at all) and the four that keep
     it get a column that actually has vehicles in it. Repriced 0.26 → 0.16, and
     because `worth` is also the Insight rate the payout moved with it:
     1.26x → 1.16x, which is the direction a card that no longer deletes
     half the roster should move.
  8  §4.5 co-op and versus ................. THE SECOND HUMAN IS IN IT, and
     was before this line was written: `seatAlly`, `beginVersus`,
     `formUp`, four commanders as two sides, orders, musters and purses
     across the wire, all held by `command-pvp.mjs`. What was owed was
     this section's own KILL — "if two commanders cannot be kept in
     agreement on `lineIsUp`, the mode's win condition desyncs and it
     needs a host authority". It has one: `_front` runs in the director's
     own update and a client's director is a shell that never steps. The
     scalar is on the wire now (`packSnapshot.fr`), so both machines read
     the number the host computed — and it is DRAWN, which it never was:
     the whole state of a meeting was a field nothing in the tree read.
  9  §4.3 density → animate the instanced rung → per-object ink prepass
     ....................................... THE RUNG IS ANIMATED. M3, M4 and
     B1 were never the blockers they were written as — the ladder ran to 160
     bodies, the profiler ships, `tools/_frame.mjs` reads it, and the index and
     corpse budget landed. `Cohorts.js`'s own "every instance of one cohort
     wears one pose" is answered by a per-instance PALETTE INDEX: twelve slots
     of rigid 4×4s in a DataTexture, one float per instance beside the matrix,
     three fetches in the vertex shader — viable only because `MergedSkin`
     gives every vertex exactly one bone at weight 1.0, so a pose is
     bones-many matrices and not a vertex field. **The count did not move**:
     168 bodies past 137.8 m are 39 draw calls, 168 instances and 969 520
     triangles before and after, bit for bit, and the palette fills 48 of 48
     slots with 18 distinct poses over 24 instances. The two alternatives
     delete the rung and were priced: a baked cohort per pose is twelve times
     the bins (42 bodies → 456 calls against the merge's 196), and per-object
     CPU skinning counts bodies again.
     THE INK OBJECTION WAS SETTLED BY MEASUREMENT. This file refused a vertex
     shader because the prepass uses `scene.overrideMaterial` and a cohort
     would be outlined un-walked; the prepass's furthest reach over every level
     and tier is 127.2 m, `L3_AT` is 137.8, and the worst palette slot moves a
     vertex 0.19 m into that 10.6 m gap. The check asserts the PAIR, so moving
     `INK.edgeFade` fails the gate rather than quietly outlining a statue.
     STILL OPEN: the per-object ink prepass itself, which is a decision waiting
     on one run of `tools/_frame.mjs` on real hardware — a 2.5–3.8 s software
     frame cannot resolve a 12% effect, and the A/B/A bracket is what says so.
```

**Nothing after M5 starts before M5 reports.** That is the gate draft 3 lacked.

---

## 7. Guardrails

1. **A number from the log is unusable until you have found the last thing
   written about it.** Both earlier drafts failed exactly here. Cite the section
   that settles it, or you have not read it.
2. **Every element must change a decision, and its check must demonstrate the
   decision changing** — not that the feature exists.
3. **An acceptance that tests legibility is not a test of whether it pays.** Both
   are needed; the second is the one that matters. Four arms, not two.
4. **Never quote a millisecond** from quality low, headless, in wall clock,
   without the load average, from a mode that skips the cross-army pass, or from
   an uncommitted harness. All six applied to draft 1.
5. **Check the roster with `tools/state.mjs`**, not by guessing a reader.
6. **Grep before proposing.** `Cohorts`, `MergedSkin`, `Levy`, `Battlefield`,
   `Front`, `Morale`, `Nerve`, `theline` and `Hazard` all shipped unnamed.
7. **Price a check before adding it.** The gate is already 18.7 minutes.
8. **Tick the input script.** HANDOFF §2.5c exists because a bench that steps
   without ticking drives a statue — and that fault produced the number draft 2
   was built on.
9. **No number typed twice.**
10. **Nothing lands red.**
