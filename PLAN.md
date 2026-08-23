# THE LINE — corrected after audit

The first version of this document was sent back. It was built on four claims
that are false against this repository, and a hostile audit found all of them.
This version states what was wrong, then plans the work that the measurements
actually support.

---

## 0. What the audit killed

**1. The core loop was already measured, and it pays nothing.** `NEXT.md` §Step 2
is a seeded four-arm test on this branch. Fifteen of fifteen rows, every seed:
same waves cleared, same area taken, same enemies killed, with or without a Jedi
on the field. What changes is that **seven of your men die who would otherwise
have lived**, and a Jedi a hundred metres away costs the line exactly as many as
one standing in it — 6.33 against 6.33. The Jedi's kills *substitute* for the
line's rather than adding to them.

The old plan's centrepiece was presence: raise morale where you stand, sprint
between collapsing lanes, a propagating aura, a co-op mode built on lanes
degrading without a Force user in them. **It stretched a loop measured at zero
effect over 14 m across three 120 m lanes on a 500 m field**, and contained no
test for the thing that had already failed. I had not read `NEXT.md`.

**2. The measurements were the wrong measurements.** `PERF.md` was taken headless
at quality **low** with no render pass. `tools/checks/frame-ledger.mjs` measures
the same thing at quality high with `process.cpuUsage()`: **29.35 ms CPU for ~48
bodies**, of which physics is 13.8 ms. My curve says ~11 ms for that population.
**The two disagree by 2.7× and the plan cited only the cheaper one.** The harness
was never committed, so the numbers could not be re-run — failing the plan's own
guardrail on the numbers that set its budget.

**3. Two rendering rungs already ship, and the plan proposed to rebuild them with
a technique this codebase documents as incompatible.** `MergedSkin.js` (L2) and
`Cohorts.js` (L3) are shipped and measured: **168 bodies at 27 draw calls.**
And `Cohorts.js` already wrote down why a vertex-shader walk cannot work here —
`Ink.js:554` sets `scene.overrideMaterial`, so a body animated in its own vertex
shader **would have its outline drawn at the un-walked pose**. Cohorts escapes
this by living past 137.8 m where no outline is drawn. My Tier 2 began at 60 m,
squarely inside the ink band.

**4. The problem statement was stale and the capability audit was wrong.**
`maxAlive` is not 26 in the flagship modes — `Levy.js` is live and makes it
**66**. There are **37** archetypes, not the 16 I counted from the wrong reader.
`theline` already exists as a mode, with `Battlefield.js` generating ground
around a bezier front and `Front.js` drawing it. `Morale.js` and `Nerve.js` are a
shipped two-branch morale model; the plan specified a third without mentioning
either.

Also correct and accepted: the simulation is **not** linear in the mode this plan
needs (`World.js:2743` is an O(bodies²) cross-army pass, gated on mode, and my
benchmark ran in the configuration where it does not execute); 100 draw calls is
not a budget when an empty field costs 801; and the tier populations exceeded the
plan's own millisecond ceiling by 2.7×.

**Verdict accepted.** The rest of this document is the shorter, honest plan.

---

## 1. The real problem, which the repo already isolated

Three measurements from `NEXT.md`, in order:

**The fire that kills your men is your own.** One Command battle, every hit on a
friendly body counted at `World._boltHitTest` with the owner's team read off the
bolt:

    47 hits · 569.8 damage · every one fired by the player's OWN team
    0 hostile bolts reached a trooper at all

Taken three times on three builds — 47 / 30 / 22 hits, **always 100% own-team.**

**The men who die are not near the Jedi.** Of 30 casualty-bolts, 3 had the victim
inside `MORALE.NEAR`, 2 inside a guard's arc, and **zero inside both.** Victim
distances run 11 m to 58 m.

**Because the line is not with him.** The share of living men within 14 m of the
Jedi is **19.7%**, and the median man goes 12.6 → 16.1 → 17.4 → 23.3 → 31.2 →
45.7 m over the first thirty seconds. *The Jedi holds station on the centroid of
his own roster and the roster walks away from itself.*

`NEXT.md` names the open question and it is the right one:

> **"The thing to answer next is not 'what should a Jedi do for the line', it is
> 'why is the line thirty metres wide'."**

### The answer this plan proposes

**Because nothing holds it together, and a dispersed rank shoots itself.**

That single fact reframes the whole design. Everything the old plan wanted —
a front that moves, a general who matters, a battle with shape — is downstream of
a line that stays a line. And it explains every failed mechanic in the log:
presence, OPEN, SCREEN and BREAK all pay out inside a radius, and four fifths of
the line is never in any radius.

So the work is not to make presence worth more. It is to **make the line
cohere**, and then re-take the measurement.

---

## 2. Act I — three experiments, on the population that already exists

No new architecture. No tiers, no worker, no VAT, no influence field. The
existing ~66-body Command population, the existing four-arm Dead Jedi instrument,
and three changes measured against it.

**If none of these moves the `fallen` column, none of the rest of this document
is worth building, and we will know in weeks rather than in years.**

### E1 — Hold fire through your own line

100% of friendly casualties are own-team bolts. A rank firing into a melee fires
through its own men, and nothing stops it.

The change: a trooper does not take a shot whose line passes within a body's
width of a friendly, and `Waves.holdFire` already exists as the door. An explicit
**Hold Fire** order gives the player the same lever deliberately.

*Acceptance: own-team casualty bolts fall by ≥ 70% across five seeds, and the
`fallen` column moves against the four-arm table.*

This is the cheapest change in the document and the measurement says it should be
worth almost all seven men.

### E2 — Cohesion: why the line is thirty metres wide

Men leave formation to chase targets and never re-form. The measurement to take
first is *why*: whether it is the target selection, the formation slot being
advisory, or the advance outrunning it.

The change follows the measurement. Candidates, in the order the data will
probably rank them: a formation slot that is a real attractor rather than a
suggestion; an engagement leash so a man does not walk 30 m to a target; squad
cohesion as a morale term, so a scattered squad is a nervous one.

*Acceptance: share of living men within `MORALE.NEAR` rises from 19.7% to ≥ 50%,
and the median man's 30-second dispersion falls from 45.7 m to under 20 m.*

### E3 — Crewed capability: a payout the Jedi cannot substitute for

The Dead Jedi finding is that the Jedi's kills *substitute* for his men's. So
every mechanic that pays in kills is dead on arrival. **A gun only a trooper can
crew pays in a currency the Jedi structurally cannot provide.**

One capability objective on the field — the Battery, a SPHA-T that fires where
you designate and needs a squad assigned to work. Lose the crew and it stops,
whoever is standing beside it.

All four blind researchers converged on this independently, and it is the only
mechanic in the old plan that answers the measured failure. It was scheduled in
Phase 4, behind everything. It is first now.

*Acceptance: the player's men are worth keeping alive for a reason the
instrument can see — a run with the Battery crewed differs measurably in enemies
killed from one where the crew died.*

### Also in Act I, because they are cheap and unambiguous

- **Attack tokens** (`Game AI Pro`, "Beyond the Kung-Fu Circle"). There is no
  crowd-attack limiter anywhere in `src/`. A Jedi in forty bodies should face
  three or four live attacks, not forty. Cheap, well-documented, and it fixes a
  legibility problem that gets worse with any density increase.
- **Pooled ragdolls and instanced corpses.** `frame-ledger.mjs` measured physics
  at **47% of a real frame**, driven by "288 rigid bodies of which 287 awake, 180
  ragdoll joints, against 39 living enemies" — corpses. This is worth more than
  the Rapier version bump the old plan ranked above it.
- **Fix extraction boarding** (0–2 of 10 men reach the ramp). It gates company
  persistence, and it is the same problem class — many capsules converging on one
  goal — that any crowd work would hit at scale.
- **Commit the perf harness**, re-taken at quality high, with `cpuUsage`, with
  load average recorded per HANDOFF §2.6b, and with the cross-army loop enabled.

---

## 3. Act II — only if Act I pays

Written short deliberately. Detail here before Act I reports is detail spent on a
hypothesis.

**If cohesion and hold-fire move the `fallen` column**, then a line that holds is
a line worth commanding, and the following become worth their cost, in this
order:

1. **The vulnerability map.** `tension − |A − B|` over a coarse influence grid —
   two subtractions, and a *computed* answer to "where am I needed" instead of an
   authored one. It survives even if nothing else in the old §4 does.
2. **The rest of the capability objectives** — Relay, Pad, Spire, Foundry,
   Shield — with off-map power gated on a spotter's line of sight, and vehicles
   costing bodies out of the line.
3. **Reconcile the two front models.** `theline` + `Battlefield.js` + `Front.js`
   already draw a marching front. An influence contour is a *second* front model
   beside a shipped one with an acceptance test. One of them dies; that is a
   decision, not an implementation.
4. **The company**, gated on extraction working.
5. **Scale**, and only then. Using `MergedSkin`/`Cohorts` — the shipped ladder —
   with the real problem named in `Cohorts.js` itself: *"every instance of one
   cohort wears one pose."* Animating the instanced rung is a smaller, better-
   defined job than a VAT renderer, and it must solve the ink prepass first.

**The requested battle** — dozens of Force users, hundreds of troops, transports,
a front that moves — sits at the end of that chain, not the start. The old plan
put it first and priced it at nine tidy phases; the audit priced it at 2.5–4
years for one engineer, and that estimate is more honest than mine was.

---

## 4. Guardrails, revised

The old set was fine except that the plan broke three of them. The additions:

1. **Read the measurement log before proposing a mechanic.** `NEXT.md`,
   `HANDOFF.md`, `BACKLOG.md` and `FLAGSHIP.md` record four mechanics already
   built, measured and found not to pay. A fifth proposed without reading them is
   a fifth that will not pay either.
2. **Never quote a millisecond from quality low, headless, without the load
   average, or from an uncommitted harness.** All four applied to the last set.
3. **Check the roster with `tools/state.mjs`, not by guessing a reader.** The
   count was wrong by more than half and it set the scope of the plan.
4. **Before proposing a system, grep for it.** `Cohorts`, `MergedSkin`, `Levy`,
   `Battlefield`, `Front`, `Morale`, `Nerve` and `theline` all existed and none
   were named.
5. **Price a check before adding it.** The old Phase 2 acceptance — 24 seeded
   twenty-minute battles — is roughly six hours of wall clock for one suite,
   against a gate that already takes 18.7 minutes.
6. **An acceptance number that tests legibility is not a test of whether the
   mechanic pays.** Both are needed, and the second is the one that matters.

---

## 5. What survives from the first draft

Kept, because the audit endorsed them and they are cheap:

- **Capability objectives**, promoted from Phase 4 to first.
- **Attack tokens**, absent from the codebase and correct.
- **The vulnerability map**, two subtractions for a computed answer.
- **Pooled ragdolls and instanced corpses**, which the frame ledger already
  argues for.
- **The pose/think split as a finding** — `_think` 12 µs against `_pose` 81 µs is
  the right boundary, once it is re-measured honestly.

Dropped:

- The three-tier rearchitecture, until something needs it.
- VAT, in favour of animating the shipped instanced rung.
- The simulation worker. `Net.js` already states the constraint: *"the blade
  cannot tolerate a single frame of interpolation."*
- A third morale model.
- A second front model, until §3.3 decides which one lives.
- Every acceptance test that cannot finish inside the gate.
