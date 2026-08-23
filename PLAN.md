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

**The game's central claim is TRUE for the first time.** `FLAGSHIP.md` §1 — "your
job is not to kill everything, it is to be the reason the line is still standing
when it takes the ridge" — measured false through five readings and holds on this
build (`NEXT.md` §"WHAT IS ACTUALLY TRUE, from `tools/_muster.mjs`"):

| arm | standing when area 1 falls | after the muster | net on the area |
|---|---|---|---|
| no player at all | 2–3 of ten | 6–7 | −3 to −4 |
| **a Jedi on the field** | **4–8 of ten** | 8–11 | **−2 to +1** |

> "**A Jedi on the field is worth four to five men an area.** … On two of three
> seeds the line ends area 1 **stronger than it landed**. … **The mode is
> winnable.**"

And the mechanism is in the columns beside it: with the Jedi present, fire
arriving on the line **halves** — 0.94–1.72 hp/s down to 0.43–0.97. *He is
removing bodies before they fire.*

**The keystone is built.** `MODES.theline.lineAdvances` / `CommandDirector.
lineIsUp` (`NEXT.md` §"§7's central claim, answered — the ground is taken by the
LINE"): an area does not close until half the living are inside `MORALE.NEAR`.

> "It is not a reward for standing still and it does not punish having left. It
> declines to advance until the army that is supposed to be taking this ground is
> standing on it… **It makes all four of the failed mechanisms pay at once
> without changing any of them**, because each keeps men alive and near you and
> that is now what advances the run."

**What is retracted, and what both earlier drafts wrongly used:**

| Retracted claim | The last word |
|---|---|
| "the line comes apart to thirty metres wide" (19.7% inside NEAR) | §"RESOLVED: the line does not come apart — it falls behind". Both benches ran an **unticked input script** — a statue on the deploy mark. Re-taken: **37.1% inside NEAR, band width mean 6.9 m.** "The line holds together to within about seven metres — **it is the PLAYER who leaves.**" |
| "100% of friendly casualties are own-team bolts" | `_boltHitTest`'s early-out was fixed, so hostile bolts reach troops "**for the first time**… before that the line was immortal to gunfire and every number about it was fiction." Current: **bolt 99.3%, friendly fire 0.7%** |
| "the Jedi is worth nothing / his kills substitute" | Superseded by the table above |
| "the sim is linear at 198 µs/body, ceiling 63" | `tools/scale.mjs`, committed, quality high, in `command`: **fixed overhead 10.98 ms, marginal 238 µs, ceiling 23 — and a bend of ×1.65.** Not linear; `World.js:2743` is O(bodies²) and gated on mode, so the old bench never ran it |

**And one live defect that outranks the plan.** 64 bodies cost **26.53 ms CPU
against a 16.67 ms frame**, before rendering. `Levy` makes `alive` 66 in the
flagship modes. The flagship mode is already over budget on simulation alone.

**What already ships and both drafts failed to name:** `Cohorts.js` — **168
bodies at 27 draw calls** past 137.8 m. `MergedSkin.js` at ~4.6 calls/body.
`Levy.js`, forty free bodies off the threat budget. `Battlefield.js`, ground
generated around a seeded bezier front. `Front.js`, that front drawn, with a
measured ordering test. `Fallen.js`, 520 prone figures at two draw calls.
`Extraction.js`, nine phases. `Morale.js`/`Nerve.js`. 37 archetypes, 20 vehicles,
7 grounds, 9 modes.

---

## 1. The design, in one paragraph

**`lineIsUp` is the keystone, and the whole game is built on it.** The ground is
taken by the line standing on it, not by the Jedi killing everything two hundred
metres ahead. That one rule converts every other system from a bonus into a
requirement: keeping men alive matters because live men take ground; being near
them matters because near men take ground; a gun that needs a crew matters
because the crew are men who must be alive and near. The Jedi's job stops being
damage and becomes **making it possible for the line to arrive** — and that is a
job no volume of rifle fire can substitute for, which is exactly what five
previous readings proved was needed.

Everything below is that sentence, extended until it is a game.

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

**M3 — density, two constants and one conditional.** Raise `LEVY_STRENGTH`; drop
the `if (this.command)` gate at `World.js:2761` on one level so two armies
actually fight each other; run `tools/scale.mjs` and the instrument. This is the
cheapest possible answer to "is density the variable the brief hinges on", and it
also gives the first honest reading of the O(bodies²) pass at real population.

**M4 — the browser frame.** There is no draw-call instrument. The diagnostic is
low FPS *with* low GPU usage (draw calls / JS) versus high GPU time (skinning,
shadows, overdraw). Until this exists, no rendering decision is licensed.

---

## 3. Building now — licensed by measurements already taken

These do not wait on M1–M4. Each names what already licenses it.

**B1 — the frame, which is over budget.** *Licensed by `scale.mjs` and
`frame-ledger.mjs`.* Physics is 47% of the frame and the population making it so
is **the dead**: 288 rigid bodies, 287 awake, 180 ragdoll joints, against 39
living enemies. Pool the ragdolls; retire settled corpses to the instanced
`Fallen` mesh that already exists. This roughly doubles the live budget before
any other work, and it is the precondition for every scale ambition below.

**B2 — attack tokens.** *Licensed by absence:* no crowd-attack limiter exists in
`src/`. Sum of active attack weights against a target may not exceed its
capacity; FIFO queue; cooldown multiplier. A Jedi in forty bodies faces three or
four live attacks instead of forty. Cheap, well-documented, and legibility only
gets worse as density rises.

**B3 — scale that costs no draw calls.** *Licensed by nothing needing
measurement.* A three-layer distance audio bed (weapons at near/mid/far, mixed by
distance) is the single biggest perceived-scale win available and this engine
synthesises every sound already. Plus `Fallen` fields on the horizon,
atmospheric perspective tuned per ground so the far plane reads as far, and
foreground silhouettes that parallax faster than the field. This is "truly
immense sense of scale" for weeks of work and zero frame cost, and draft 2
deleted it for no reason.

**B4 — extraction boarding**, currently 0–2 of ten men reaching the ramp. It
gates the company, and it is the same problem class as any crowd convergence.

**B5 — the four open playtest defects**, which the developer has already seen:
enemies illegible at range; characters with no value separation or contact
shadow; Command discarding the chosen theatre; the camera inside tree trunks.

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
and elsewhere — a gun to spike, a door to cut, a walker to bring down, a flank to
break. Leaving is correct, *and* the ground does not close while you are away.
That is a real decision every ninety seconds and it needs no new mechanic to
exist; it needs the opportunities to be worth the walk.

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

**Off-map power is gated on vision** — the aim point must be inside territory
someone can see, which makes the spotter a man worth protecting.

*Licence:* the substitution problem is real even on the tuned build (his output
is 5.9–10.1 hp/s against the line's 2.5–5.2 — he still does most of the killing).
*Kill:* four-armed test — does the Jedi arm beat the no-player arm *more* with the
Battery on the field than without? If not, it is decoration.

### 4.3 The battle the brief asked for

Two sets of transports, both armies meeting, a front that moves, reinforcements,
mechs, creatures, air, squads meeting squads, generals riding to where it breaks.

**The route to it is density, not architecture** — M3 is two constants. The
ladder to render it already ships: `Cohorts` at 168-for-27 past 137.8 m,
`MergedSkin` nearer. The one missing piece is named in `Cohorts.js` itself:
*"every instance of one cohort wears one pose."* **Animating the instanced rung
is one system, not three**, and it must solve the ink prepass first — `Ink.js:554`
sets `scene.overrideMaterial`, so a body animated in its own vertex shader is
outlined in its bind pose. The honest fix is per-object prepass materials, which
also unblocks every future shader effect.

**The front already exists.** `Battlefield.js` generates ground around a seeded
bezier front; `Front.js` draws it with craters, smoke and wrecks. Do not build a
second front model. Extend this one.

**Dozens of Force users, honestly:** heroes rotate off by themselves if health
drains and only kills restore it, so dozens exist in the transports and four to
six per side are hot at any moment. A duel claims physical space — an exclusion
radius troop AI will not path into — and pays out as a morale swing on both
retinues, which is how twenty of them stay legible.

*Licence:* M3 for density, M4 for the frame. *Kill:* if M3 shows the O(bodies²)
pass makes two real armies unaffordable at any interesting count, the battle is
scoped to what the budget carries and the rest is horizon dressing.

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

*Licence:* `Command.js` ships designations, five ranks, promotions and nicknames;
`Progress.js` ships the localStorage record; `Extraction.js` ships nine phases.
**The wire between them does not exist.** *Kill:* B4 — if boarding cannot be
fixed, the gate does not exist and persistence has to be gated some other way.

### 4.5 Co-op and versus, first class

**Two generals is the path to X-vs-X, and X starts at 2.** `Net.js` already runs
a second commander with an army; `assignArmies` already exists and already has a
documented defect (it ignores the peer's chosen side).

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

- **The holocron offers three of the currently-legal facets, not all 46.** Same
  46 nodes, same adjacency; only the *offer* changes. A solved build order
  becomes a found one.
- **Eight facets that change rules rather than numbers.** *Push ragdolls allies
  too. The saber absorbs instead of deflecting. Shattering a prop refunds
  Insight.*
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

**Weather disables one verb and enables another** (`Hazard.js` ships): sandstorm
kills ranged fire both ways and leaves Force sense working, so you become your
army's eyes; blizzard costs sightlines but carries sound; ash grounds air and
speeds fire; rain conducts lightning between men in contact. **No dark maps** —
the player owns the canvas and a gamma slider defeats darkness; use fog and dust,
which are in-world occluders.

### 4.8 The unprecedented ones, kept

Draft 2 dropped these silently. They are the answer to "genuinely innovative",
each researched as having no shipped precedent:

- **Contested telekinesis.** Two Force users gripping one rigid body as a shared
  constraint, both spending pool, the object shuddering between them. Break his
  guard and the resistance cap collapses from a half to a third — *already in the
  code* — and it becomes a projectile with his name on it. In Psi-Ops, Half-Life
  2, The Force Unleashed and Control, exactly one entity owns an object.
- **The order you can check.** High Command designates an artillery ellipse.
  Force sense shows what is inside it, including friendly IFF. Obeying is faster
  and rewarded; verifying costs twelve seconds under fire. Sometimes your own men
  are in it and the game never says so. Refuse and your stratagem budget is cut.
  The Umbara arc has **zero adaptations in any game.**
- **Squadmates grab the man you are gripping.** One joint, one break force: a
  gripped body reaches for the nearest collider and a squadmate grabs *him*. Grip
  one, drag two, the contest resolving against combined mass.
- **Graves at true coordinates.** A marker where each man of the company fell, on
  that ground, in later runs, with the surviving squad's morale reacting.

### 4.9 Making real-time permadeath survivable

**Downed, not dead** — a bleed-out window; an enemy reaching the body finishes
it; a medic or your Heal saves him. The interruption that makes you break off a
duel, and it means the last word on every death is the player's.

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

```
now ───┬── M1 twenty seeds (running)      ─┐
       ├── M2 teamDamage bound (1 hour)    │ gate on §4.1, §4.2
       ├── M3 density, 2 constants         ─┤ gate on §4.3
       ├── M4 browser frame instrument     ─┘
       │
       ├── B1 pooled ragdolls / corpses   → precondition for all scale
       ├── B2 attack tokens
       ├── B3 audio bed, horizon, haze    → "immense scale", no frame cost
       ├── B4 extraction boarding         → gate on §4.4
       └── B5 four playtest defects

then ──┬── §4.2 capability objectives      (four-armed acceptance)
       ├── §4.4 company + Company screen   (after B4)
       ├── §4.6 variance                   (no gate)
       ├── §4.5 two generals → co-op/versus
       ├── §4.7 Dig In, finite cover, weather
       ├── §4.8 the unprecedented four
       └── §4.3 density + animate the instanced rung + ink prepass
```

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
