# THE LINE — the next phase, in full

This is the plan for what the game becomes. It is written to be built from, not
admired. Every system names what it changes, what it costs, and the measured
number that says it works.

Behind it: `SCOPE.md` (four blind researchers on what this game could be),
`PERF.md` (what the engine actually costs, measured on this branch), and four
further research passes on frontline simulation, browser crowd rendering, and
dynamic battlefields.

---

## 0. The problem, stated honestly

The game is a wave-clearer with unusually good bones. Sixteen archetypes, twenty
vehicles, seven battlefields, a real army with ranks and permadeath, physics with
dismemberment, terrain that remembers damage, a Force contest with a real
rulebook, five duelling forms — and it spends almost none of it.

`WaveDirector.maxAlive` is **26**. That number is the game.

The brief is a battle of hundreds with dozens of Force users, a front that moves,
and a general who must choose which part of his own collapse to attend to. The
gap between those two sentences is this document.

---

## 1. Ground truth

### 1.1 What a body costs (measured headless, this branch, 2026-08-23)

| | µs/body | share |
|---|---|---|
| `_pose` — skeletal animation | **81** | 40% |
| physics step | 38 | 19% |
| `_move` | 27 | 13% |
| `_think` — the AI | **12** | 6% |
| World's per-enemy loops | ~40 | 20% |
| **total** | **~198** | |

Linear in body count. Ceiling at a 16.7 ms frame with 4.2 ms of world overhead:
**63 bodies**. Distance buys 10% — a body at 200 m costs 178 µs against 198 µs
at 12 m. **There is no behaviour LOD.**

Measured, not calculated:

    full body                155 µs/body    ceiling  80
    no _pose                  60 µs/body    ceiling 207
    no _pose, no rigid body   53 µs/body    ceiling 233

**The thing that makes a body a soldier costs 12 µs. The thing that makes it a
puppet costs 81.**

### 1.2 What the industry gets for the same problem

- **AC Unity** (GDC 2015): three tiers — 40–60 autonomous, puppet bulk, lo-res
  bulk beyond 40 m. Hard caps **40 real AIs, 120 hi-res models**, producing
  scenes of 10,000 NPCs. Cost per bulk **~25 µs lo-res vs ~150 µs puppet**,
  roughly **100:1** against a full AI. **11 bones far, ~300 near.**
- **Space Marine 2** Swarm Engine — the closest published analogue to this brief:
  ~200 real foreground enemies, ~500 on screen, thousands as vista, and
  background hordes **promoted** into real foreground enemies.
- **Hitman** Glacier 2: 1,200 crowd NPCs at 30 fps on 2012 consoles; >300
  behaviour trees with distant ones ticking less often.
- **VAT crowds**: GPU Gems 3 rendered **10,000 independently animated characters
  at 30 fps on 2007 hardware**; a modern reimplementation does 10,000 in **20
  draw calls** and runs 10,000 on an iPhone 7.

Our 198 µs full body against AC Unity's 150 µs puppet is the right order. Our
problem is that we have exactly one tier.

### 1.3 Constraints that are fixed and not negotiable

- **Deploy is GitHub Pages.** It cannot set COOP/COEP headers, so
  **SharedArrayBuffer is unavailable** and Rapier's multithreaded build is off
  the table. Physics is single-threaded, permanently.
- **three r169, Rapier vendored.** `WebGPURenderer` is still frequently slower
  than WebGL in three; a port is a separate project, not this one.
- **Worker communication is transferable `ArrayBuffer` ping-pong.** At 600 units
  × ~40 bytes that is **24 KB/frame** — trivial, and needs no headers.
- **Draw-call budget: under 100/frame.** The diagnostic for being draw-call
  bound is *low FPS with low GPU usage*.
- **Shadows roughly double submitted geometry per cascade.** At 600 soldiers
  this is the second cost after skinning.

---

## 2. Architecture: three tiers, and the seam

### 2.1 The tiers

**Tier 1 — EMBODIED.** Full skeleton, pose, cloth, rigid body, dismemberment.
**155 µs.** Budget **40–48**, matching AC Unity's shipped 40. Who qualifies, in
priority: every Force user within 80 m; everything within ~35 m of the player;
anything the player is fighting; anything a Tier-1 body is fighting.

**Tier 2 — LEVY.** No `SkinnedMesh`, no `AnimationMixer`, no rigid body. Drawn
as **VAT instances**: animation baked into a texture, sampled in the vertex
shader from `gl_InstanceID`, one float uploaded per instance per frame (its
animation time). `_think` and `_move` still run — these are real soldiers with
real targets, real morale and real deaths. **~53 µs.** Budget **220–260**.

**Tier 3 — ABSTRACT.** Not a body. A record in a lane's roster: name, serial,
rank, health, morale, band. Resolved by an attrition model on the slow tick.
**~0 µs.** Unbounded.

**On the field: 300–500 named soldiers.**

### 2.2 Killing per-character `SkinnedMesh` is the whole ballgame

three.js is CPU-bound on skinning long before the GPU cares — past roughly
twenty avatars a page cannot hold 60 fps, and `updateMatrixWorld` is repeatedly
the top profile entry. The three.js `InstancedSkinnedMesh` PR measured that
**updating bones for ~200 instances costs slightly more than rendering them.**

So Tier 2 is not "the same body with animation turned off". It is a different
rendering path. Budget for a 20-bone soldier with 20 s of clips at 30 fps:
**~768 KB** of texture, twelve rows at 4096 wide. `MAX_TEXTURE_SIZE` is never
the constraint.

**What is given up, stated plainly:** no IK, no procedural aim, no blend trees
below hero tier; no cloth (hero-only, 20–40 live); no dismemberment (Tier 1 only
— Tier 2 dies into the existing instanced `Fallen` corpses); no per-soldier
rigid body; no universal shadow casting.

### 2.3 The seam, which is the hard part

The literature answer is **alibi generation** (Sunshine-Hill, *Game AI Pro* ch.
37): generate detail lazily, when first required, constrained to be consistent
with everything the player has already observed.

Four rules, and the first is the one that makes it sound:

1. **The abstract model is authoritative for OUTCOMES; the concrete model only
   for PRESENTATION.** The attrition model decides that squad 14 loses three men
   over the next eight seconds. On realisation nothing is re-rolled — those three
   deaths are *scheduled*, and the concrete simulation chooses who and how. This
   is the only way the two tiers cannot disagree.
2. **Conserve invariants at the boundary, not state.** Count, facing, morale,
   ammunition and a per-squad kill-debt are conserved. Individual positions and
   health are re-derived, because the player has never seen them.
3. **Promote outside perception, with hysteresis.** Frustum + distance +
   occlusion. **Promote at 60 m, demote at 90 m**, so a panning camera cannot
   thrash the boundary.
4. **A body the player has personally touched is PINNED to concrete** for the
   rest of the battle. Interaction is what makes continuity observable.

And the fiction that converts a technical limit into a diegetic one, taken
wholesale from Bannerlord: **the rest of the army is behind the ridge.**
Reinforcement waves are how off-tier mass arrives, so a cap reads as an order of
battle rather than as a budget.

**Highest-risk item in the plan.** Built first, with an adversarial suite that
drives a player across a whole field for twenty minutes and asserts no roster
record is ever duplicated, lost, or teleported.

### 2.4 Movement and AI at scale

**Flow fields, not per-agent pathfinding.** One propagation pass, then every
agent reads its direction in O(1) — per-agent cost *falls* as the crowd grows.
Measured in a UE5 reimplementation: 200 units at **1.6 ms** against a stock
pathfinder's 6.3 ms, and the propagation itself (254–400 µs) **does not scale
with unit count at all**. Crossover against per-agent pathing is 20–50 units.

**Spatial hash, non-negotiable.** 600 soldiers doing naive neighbour queries is
360,000 pair tests a tick. Everything that needs neighbours — separation, panic
contagion, attack tokens — reads the same grid.

**Simulation in a worker, rendering on main.** The bottleneck is simulation, so
that is what moves. Two transferable buffers ping-ponged.

### 2.5 Physics

Bodies are **not created** for Tier 2 and 3 — they move kinematically on the
flow field with a spatial-hash shove. Ragdolls are a **pooled resource**, ~30–40,
recycled. Corpses freeze and convert to the existing instanced `Fallen` mesh.

Rapier's current npm builds are reported **2–5× faster than 2024 builds**. The
vendored copy is unversioned and predates that. **Re-vendoring against
`rapier3d-simd` is the cheapest single win available** — no API change, measured
before and after. (The deterministic build exists but there is no
`simd-deterministic`; speed or determinism, not both. We take speed — see §11.)

---

## 3. THE COLUMN — what a run is

A run stops being "pick a mode, clear waves". A run is **a front**.

You are a Jedi General given a theatre: **7–9 regions**, with a front line drawn
through them. Each region is one battle. Win and the front advances; lose and it
recedes. The campaign ends when the front reaches one capital.

Three things make it a structure rather than a level select:

**Route choice with partial information.** Two or three regions are attackable
at a time. Each shows what it *is* — ground, weather front, garrison weight,
capability objectives — not what it *contains*.

**Position matters, via a lattice.** Regions connect. A region bordering two
enemy regions is a salient — next battle is fought on two fronts. Severing the
enemy's chain means everything behind the cut fights at reduced weight (Company
of Heroes' rule: a point must chain back to base). PlanetSide 2 replaced free
adjacency with a lattice four months after launch **specifically because free
adjacency let players avoid fights and capture empty ground.** That lesson is
taken at both scales — here, and inside the battle (§4.3).

**The clock is the enemy's.** Every battle you fight, the enemy advances
somewhere else. The campaign is a series of choices about what to lose.

**Length:** 7–9 battles at 12–25 minutes. Two to three hours — the run the
company and the extraction persist across.

---

## 4. THE BATTLE

Two sets of transports come in. Both armies land and walk at each other. A front
forms and moves for twenty minutes until one side breaks.

### 4.1 The influence field — the front is a contour, not a set of points

Steel Division's model, which is the best-documented one available.

Every unit **projects an area of influence** into a coarse grid — 4–8 m cells
over a 500 m field, about **64 × 64**, updated at **4–10 Hz in the worker**. The
front is the contour where the two fields meet, rendered as an actual line and
smoothed over ~0.5 s so it never jitters. Standard tactical influence map:
placement, then diffusion, `cell = lerp(cell, max(neighbour) * decay, momentum)`,
**double-buffered** — without that, propagation is order-dependent and visibly
irregular.

Three rules carried straight across:

- **Not everything moves the line.** Recon, spotters and lone infiltrators
  project **zero** influence — they can walk into enemy ground without shifting
  it. Command units project disproportionately.
- **Isolation collapses pockets.** A unit outside friendly influence takes a
  morale penalty *and its own influence circle shrinks* — a positive feedback
  loop. The test: no unsuppressed friendly within **100 m** and no leader within
  **200 m**.
- **Two derived maps come free**, and they are the whole answer to "where am I
  needed":
  - **Tension** = `|A| + |B|` — where the fighting is.
  - **Vulnerability** = `tension − |A − B|` — contested *and* thin. **This is
    where a general arriving actually flips something**, and it is computed, not
    authored.

### 4.2 Lanes, and why the line must be able to bend

Three lanes across the field (left, centre, right), each ~120 m wide, over 24
bands down the long axis. The influence contour is read per lane, giving three
fronts that move independently.

**Enfilade.** A lane whose two neighbours have advanced past it is being shot at
from the side: morale penalty, and hit chance against it rises. A lane that falls
behind falls *faster*. Holding the line straight is work.

**The salient trap.** A lane that races too far ahead is enfiladed the other way.
There is no "just win the centre".

**And this is why the general's body matters.** You raise morale where you stand.
You cannot stand in three lanes. Every ninety seconds the battle asks *which
collapse do you attend to* — and the answer is never free, because the lane you
leave is the lane their Master goes to.

### 4.3 What actually scores

Influence decides **where the line is**. A **lattice of 5–7 objectives** decides
**what is scoreable**, adjacency-gated so territory only flips next to territory
you hold. Capture weight scales with presence and **doubles inside the
strongpoint**; a sergeant counts double, a Force user quadruple.

This is what stops a hero winning by running to the enemy backfield: his power
is *local*, and it can only cash out where the line is. A flank changes the
field's shape immediately but only converts into territory when it links back.

### 4.4 Morale — the numbers

Total War's model, which is the only one with published figures, plus per-agent
contagion from Bannerlord and Close Combat.

**A signed scalar per soldier**, with modifiers of roughly:

| Event | Δ |
|---|---|
| 10% / 50% / 80% of the squad dead | −2 / −8 / −12 |
| One flank threatened / two | −2 / −6 |
| Charged in the flank | −4 |
| Your general dies (first seconds / after) | −8 / −2 |
| Seeing two equal-or-better friendly squads rout | up to −12 |
| Charging | +15 |
| A man near you scores a kill | small + |

**Overlapping state bands, deliberately** — steady / shaken / wavering / broken
with hysteresis, so a unit does not oscillate on a ±1 swing. A wavering unit that
cannot disengage from melee *will* rout.

**The rout counter is the cheap trick.** A squad may rout three times; the
fourth **shatters** it — shattered units never rally and leave the field. This
makes the second half of a battle collapse faster than the first **without
changing a single rate.**

**Panic is per-agent, not per-squad**, because the player must see the collapse
as individuals turning and running past him. Contagion is read out of a **third
channel of the influence grid** — friendly panic density — rather than neighbour
queries, so it costs nothing extra.

**Killing an officer routs his unit** (Kingdom Under Fire's one great idea). A
hero kill is a lane event, not a score.

### 4.5 The order of battle

Composed against a budget, per side:

- **2–8 Force users**, one of them the player. Each carries the same presence
  field. See §6 for how dozens exist without twenty simultaneous duels.
- **80–300 troops** in squads of 4–8, named, ranked, permadeath for yours.
- **Vehicles** — all already built and unused: AT-TE, Juggernaut, SPHA-T, AAT,
  Hailfire, snail tank, tri-droid, dwarf spider.
- **Creatures** — the `beast` archetype.
- **Air** — gunships both sides.

---

## 5. Acts, and the clock

### 5.1 Phases (Steel Division's structure, unmodified)

**Phase A — Contact, 10 min.** Infantry only. Transports land, the line forms,
objectives are uncontested.
**Phase B — Weight, 10 min.** Vehicles and first air unlock. Objectives become
worth killing for.
**Phase C — The Break, until the end.** Heavies, orbital stratagems, reserve
Force users.

Income arrives on the minute and rises per phase. **You cannot commit your win
condition in Phase A because it is not unlocked** — which is the answer to
"decided in the first two minutes".

### 5.2 Momentum: the reward for pressure is TIME

Verdun's Frontlines clock, the best anti-drag mechanism found. The attacking
side has a timer, **extended two ways**: reaching a kill threshold, and having at
least one man inside the objective when it expires (**a foothold**). If it runs
out, **roles swap** and the defender attacks.

Applied here: hold your line and your next transport wave arrives sooner. Keep a
Jedi inside their strongpoint and your assault clock extends. A global clock is
the sudden death.

### 5.3 The trough

L4D's Director: after a peak, **stop spawning** — peak fade, then **30–45
seconds of relax**, cut short if the player moves. The dropships are the spawn
valve. The trough is what lets a player walk his line, read the front, and choose
the next place to be. Without it a twenty-minute battle is a flat wall of noise.

### 5.4 Attrition, and the invisible comeback

Ticket bleed on majority, paired with the front moving visibly — **bleed alone
never reads as a push.** Structural losses cost **10–20× a trooper**: a lost
objective, a downed dropship, a dead Force user. That is what makes losing a
position feel like losing a battle rather than losing bodies.

Reinforcements arrive **at the rear of your held bands**, so pushing forward
moves your own arrival point forward and losing ground lengthens your walk.

**The comeback nobody announces** (Bannerlord's rule): when one side is heavily
outnumbered on the field, **that side gets priority filling the reinforcement
cap**. It never says so.

**The earned opening, not the handout.** A side falling badly behind does not get
a buff. A **dormant objective powers up** behind their front — contestable by
both. They get a target, not a bonus.

---

## 6. The hero problem — the part everyone else got wrong

Four failures are documented and all four are avoidable:

- **Dynasty Warriors**: allied AI loses everything you are not personally
  babysitting, so the army exists to be lost.
- **For Honor Breach**: AI heroes respawn endlessly during the climactic duel, so
  it never becomes a duel.
- **Total War: Warhammer**: single entities are untouchable in their band and
  die instantly to focused fire; the meta is hero sniping.
- **SWBF2 Supremacy**: the front is a sequence of points, not a line, so a push
  reads as a spawn-rate change.

### 6.1 Attack tokens — the mechanism that makes a demigod legible

*Game AI Pro*, "Beyond the Kung-Fu Circle". Every attack carries an **attack
weight**; the sum of active weights against a target may not exceed that
target's **attack capacity**. Requests queue **FIFO**; only the head is
considered. A **cooldown multiplier** controls how fast released capacity
returns.

A Jedi wading into forty troopers is *surrounded by forty bodies and facing three
or four live attacks*. That is what makes deflection legible instead of noise —
and it is the same system DOOM (2016) uses.

**Capacity varies with morale and with the tension map**, so the crowd genuinely
presses harder at the breaking point rather than feeling scripted.

### 6.2 Dozens of Force users without twenty simultaneous duels

**Heroes rotate off the field by themselves.** SWBF2's rule: a hero's health
drains continuously and is restored only by kills. A Force user who stops
fighting withdraws. So dozens exist in the transports and in the fiction, and at
any instant **four to six per side are hot** — with no scripting.

**A duel claims space.** Three Kingdoms' rule made physical rather than modal: a
hero already holding another hero's token is *busy*; the two occupy an exclusion
radius the troop AI will not path into; the duel resolves on a bounded timer; and
it **pays out as a morale swing on both retinues**. That last part is what makes
a duel the player is *not* in still matter to him.

### 6.3 Being outnumbered pays out as survival, not victory

For Honor's Revenge, and Ubisoft's stated design goal is exactly right: it is
*not* to let you win the 1v4 — it is to **stall until reinforcements arrive**.

**A hero who can win alone makes the army decoration. A hero who can survive
alone long enough for his squad to reach him makes the army the point.**

Tags accrue only while outnumbered. The payout is defensive.

### 6.4 The macro is felt inside the duel

Dynasty Warriors: Origins' Fortitude — army morale adds or removes an officer's
stagger shields. **A Sith is harder to stagger while his line is winning.** This
is the cleanest way to make the state of a 500-man battle readable from inside a
third-person body.

### 6.5 Mass — the two things the player actually sees

Everything else in this document is inferred by the player. Two things are seen:

**Braced lines shoved back and slowly re-forming.** Knockback resolves against
entity mass; **bracing multiplies mass up to 4×**, formations compress on impact
and decompress over the following seconds. A Jedi pushing a braced line back
three metres and watching it re-form *is* the visual that makes a push read as a
push. With Rapier this is nearly free.

**Routing individuals streaming past you toward the rear.** Per-agent panic
(§4.4) is what produces it.

---

## 7. Capability objectives

The strongest single finding across all six research passes: **the reward is a
capability, not a score.** A flag worth three points a second is not contested. A
working gun with five shells is.

| Objective | Held | Lost |
|---|---|---|
| **The Battery** — a SPHA-T | Artillery on a lane you designate. Must be **crewed** | It fires for them |
| **The Relay** | Stratagem cooldowns halved | Your orbital support is on a long clock |
| **The Pad** | Gunship strafing passes | Their gunship, on you |
| **The Spire** | *Vision*: true front positions and their order of battle | You fight blind and they do not |
| **The Foundry** | Every reinforcement wave brings a heavy | Theirs do |
| **The Shield** | One lane uncrossable until it is down | A lane you cannot enter |

Three rules make these carry the design:

**A gun without a crew is scenery.** Objectives need men assigned. This is the
answer to the demigod problem that four independent researchers named: the Jedi
cannot crew a battery and fight at once, so troopers become irreplaceable **by
capability** rather than by sentiment.

**Off-map power is gated on vision** (Company of Heroes): the aim point must be
inside territory someone can see. Recon becomes a real role, and the spotter
becomes a man worth protecting.

**The Shield moves the objective.** The one Levolution that worked — Siege of
Shanghai — worked because collapsing the tower *moved the capture point*. While
the dome stands, the battle is somewhere else.

**Vehicles cost bodies out of the line.** Squad's crew rule: a walker crewed by
two of your named troopers is a walker *plus a two-man hole in a squad*.

**Air is limited by passes, not cooldowns.** AA **suppresses** rather than kills
— it denies airspace; artillery opens AA; recon finds artillery. The
map-changing ability sits on roughly a one-per-act cooldown (Hell Let Loose runs
its bombing run at 10 minutes in a 90-minute match).

---

## 8. The ground, and the weather

### 8.1 A change matters when it moves an objective or removes cover

The research is unanimous on the dividing line. BF2042's tornado failed because
it was an exclusion zone. Bad Company 2 succeeded because cover got chipped away
and camping stopped working. Battlefield 6's stated rule: destruction must serve
a gameplay purpose, and must be *reliable* enough to plan around.

**Cover is finite, and the machinery exists.** Pre-fractured props plus the
crater log mean the middle of the field degrades over twenty minutes into a
moonscape. Act III is more lethal than Act I with no number changing — an act
structure nobody has to author.

**Artillery writes the ground it will be fought over.** A crater is cover. Your
own bombardment creates the defilade your men will hold. A researcher flagged
this as an unclaimed gap in the whole medium: a powerup written into the terrain
rather than into a stat block.

**`Dig In`, an eighth formation order**, is not optional. *Fracture* (2008) made
terrain deformation its entire pitch and failed because **the AI ignored the
ground the player sculpted**. Player-authored cover is worthless unless squads
garrison it.

**Fire spreads** (Total War: Attila's model) — cell to cell with the wind,
debuffing whoever is in it, continuously and legibly. A second front neither side
controls.

**Craters persist within a campaign.** Fight a region twice and the second battle
opens in the trench system the first one dug.

### 8.2 Weather disables one verb and enables another

Breath of the Wild's template. Not a filter, not a damage multiplier.

| Weather | Disables | Enables |
|---|---|---|
| **Sandstorm** (geonosis) | Ranged fire past ~25 m, both sides | The blade rules. Force sense still works — **you are your army's eyes** |
| **Blizzard** (drifts, alpine) | Speed, sightlines | Sound carries — you *hear* a lane break before you see it |
| **Ash fall** (mustafar, scoria) | Air support: gunships will not fly | Fire spreads twice as fast; lightning arcs further |
| **Rain** (wood) | Cloth soaks and slows | Lightning conducts between men in contact and through standing water |
| **Clear** | nothing | Artillery and snipers at full effect — the most lethal weather in the game |

**No dark maps.** Hell Let Loose's night maps were beaten by players turning up
monitor brightness, and no anticheat can police a display. In a browser the
player owns the canvas outright. Low-information maps are made with **fog, dust
and audio masking** — in-world occluders a gamma slider cannot remove.

---

## 9. Variance

The generative grammar, from the two best-documented systems in the genre:

**Skeleton.** Ground (7) × lane layout (3–4 each) × weather (5) × phase length.
Every combination hand-checked; nothing randomly assembled.

**Guaranteed-quality filler.** XCOM 2's real anti-slop device is the *Plot Cover
Parcel* — randomised cover that fills whatever the generator leaves empty, **so
there is never bare, coverless ground**. Every lane gets one.

**Order of battle** — composed against a budget with **composition constraints**,
not just size: *armour column* (40% of budget must be vehicles), *mono-kin* (one
archetype at triple count), *bladed* (six Force users), *droid host* (no
dismemberment, no morale, but `rend` is devastating), *beast drive*.

**Modifiers, with Deep Rock's caps** — which are the anti-slop device:
- **At most two**, and **at most one is an Anomaly**
- Every rotation guarantees **at least one battle with no modifiers at all**
- A pairwise blacklist (no Ion Storm with a Relay-less field; no Ash Fall with a
  Pad objective)

**Two categories separated by intent, not magnitude:** *Warnings* make it harder
and **pay**; *Anomalies* change the rules neutrally or in your favour and pay
nothing.

**The rule that keeps this from being slop:** a modifier that only multiplies
enemy health is not content. A modifier that removes or delays one of your verbs
is. Destiny 2's Champions are the documented failure — critics say they increase
difficulty mainly by absorbing damage and forcing an approved weapon list, while
**the modifiers themselves are the interesting part.**

---

## 10. New mechanics

Ten, each grounded in something this engine already has, each changing a
decision.

**1. The Presence Field propagates.** Morale is not a radius — it travels from
your body and is **occluded**. Men who can see you steady; men behind a wall do
not. So the craters, wreckage and shield domes you create alter your own command
reach. Standing on a downed walker extends it; dust and ash attenuate it. **A
propagating aura needs a mutable medium, and this game's is permanently mutable
and player-authored.** No shipped game has this.

**2. Command costs your guard.** You are the only commander in games who is
personally in a blade lock. Issuing an order opens a window with your directional
guard down; **Battle Meditation draws from the same Force pool that automatically
blunts incoming Force powers**, so inspiring your line lowers your own duelling
cap.

**3. Contested telekinesis.** Two Force users gripping one rigid body as a shared
constraint, each spending pool to bias its transform, the object shuddering
between them. Break his guard and the cap collapses from a half to a third —
already in the code — and it becomes a projectile with his name on it. **In
Psi-Ops, Half-Life 2, The Force Unleashed and Control, exactly one entity owns an
object at a time. Two-party contested grip exists in no game.**

**4. The Rout Cascade.** §4.4. Adjacent squads check morale against the *sight*
of a break, and a collapse runs down a lane. You stop it by being there.

**5. Crewed capability.** §7.

**6. Lane enfilade.** §4.2. The shape of the line, not just its position.

**7. The Order You Can Check.** High Command designates an artillery ellipse.
Force sense shows what is inside it, including friendly IFF. Obeying immediately
is faster and rewarded; verifying costs twelve seconds under fire. Sometimes your
own men are in it and the game never tells you — it only lets you look. Refuse
and your stratagem budget is cut for the campaign. Grounded in the Umbara arc,
which has **zero adaptations in any game**.

**8. Squadmates grab the man you are gripping.** One joint, one break force: a
gripped body reaches for the nearest collider, and a squadmate within reach grabs
*him*. Grip one and drag two, the Force contest resolving against combined mass.
The Ico bond as pure physics, with no dialogue.

**9. Realised dead.** A man killed in the abstract tier is dead by name at a
coordinate, and his body is there when you walk to it.

**10. Ground memory as progression.** §8.1.

### New troops the line requires

| Unit | What it does that nothing else does |
|---|---|
| **Line sergeant** | Carries a standing order; rank decides how well he executes it unsupervised. This is what makes **Delegate** work |
| **Spotter** | Required for stratagems — line of sight or no strike. Projects **zero influence**, so he can infiltrate. **The single change that makes troopers irreplaceable** |
| **Gun crew** | Crews a Battery or emplacement. Not a fighter |
| **Medic** | Works the downed-not-dead window (§12) |
| **Sapper** | Turns a crater into a real trench, faster than artillery |
| **Jump troop** | Exists as jet troopers. Crosses lanes — the counter to enfilade |
| **Commissar** (enemy) | Stops a rout cascade. Kill him and it runs |

---

## 11. Co-op and versus

**Co-op.** Two to four Jedi, one front, three lanes, built so **one player
physically cannot cover the field**. That is the co-op design, not a scaling
multiplier. A lane with no Force user in it degrades. Presence fields stack where
players converge, which makes converging a tactic and leaving two lanes bare its
cost.

**Versus.** Two commanders, two armies, symmetric. Both rosters persist and take
real losses. Record the killer, so "the man who killed three of yours last week"
is an object in your UI and your men's morale knows him.

**Netcode: cosmetic divergence is fine, and it is stated as a choice.** Rapier is
only *locally* deterministic — the same machine gives the same result, different
machines "may result in completely different results" — and there is no
`simd-deterministic` build, so it is speed or determinism, not both. We take
speed.

The abstract layer is the authoritative one (which §2.3 already forces): squad
positions, counts, HP, orders and hero state sync at 10–20 Hz. Individual
animation phase, ragdoll tumble, cloth and gore are local and allowed to differ.
The existing architecture is already divergence-tolerant — the host reconciles by
hp delta, not by trajectory agreement.

---

## 12. Making real-time permadeath survivable

XCOM's designer said this does not work: with permadeath fundamentally important,
real-time "would never work, because you'd always blame the AI even if it wasn't
responsible." This plan builds the thing he said fails, so the mitigations are
not optional.

**Downed, not dead.** A bleed-out window; an enemy reaching the body finishes it;
a medic or your own Heal saves him. This is the interruption that makes you break
off a duel, and it means the last word on every death is the player's.

**The after-action report.** Who killed whom, from what direction, at what
minute, in which lane, scrubbable against the battle log. No death is mysterious,
so no death is the AI's fault. It is also the *ending beat* the peak-end rule
says every session needs.

**Fall Back To Me** on one key, so any death traces to a decision you could have
made. And visible self-preservation, so troopers are *seen* trying.

---

## 13. The Company

Named men, serials, five ranks, promotion repainting armour, permadeath — **all
built today, and deleted at the end of every run.** A man reaches Commander in
the last area of the last battle and is thrown away. You have never commanded a
Commander.

**Persistence gated on extraction.** The called withdrawal (landed on this
branch) is the only way to keep anyone. Quit or die and you lose everyone.

**Replacements are free and infinite; only veterans are scarce.** You always
deploy full. The question is how many are people you know. No death spiral
possible — you can be poorer, never locked out.

**The dead stay on the roll**, with the ground each was lost on.

**Rank changes what a man can be ordered to do, never his health bar.** The Rogue
Legacy trap: if a veteran is 40% tankier, waves must be tuned for one of the two
and the other feels wrong forever. A Sergeant accepts a standing order; a
Corporal does not.

**Armour paint is permission you grant** — canon-accurate, since Jedi Generals
*allowed* the clones to paint and unpainted rookies are shinies. Free
consequence: **you read your army's veterancy across the field at a glance, and
watch it get younger over a losing campaign, with no UI at all.**

**Nicknames are earned from logged events**, not rolled at spawn — also canon,
where names come from "a habit, a skill, a moment in battle".

---

## 14. Scale

**Audio does the population count, not the renderer.** The GDC work is explicit:
Omaha Beach felt vast because of the ambient bed, "particularly important because
the game could only show a limited number of characters on screen at once", with
weapons recorded at **10, 50 and 300 yards** and layered. This game synthesises
every sound already, so a three-layer distance bed is the single biggest
perceived-scale win available and it costs **zero draw calls**.

**Prioritise sounds rather than playing all of them** — Frostbite's rule, "play
the right sounds instead of all sounds".

**Atmospheric perspective** tuned per map so the far plane always reads as far,
using the existing dust and smoke as depth instrumentation. **Foreground
framing** — near silhouettes that parallax faster than the field.

And compress honestly: Total War: Rome represents tens of thousands with a
4,800-man cap. Three hundred named men, a horizon of dust, and a sound bed of a
thousand is a battle of thousands.

---

## 15. Build order

Nothing proceeds on a phase whose acceptance number has not been measured.

**Phase 0 — instruments.** Finish `playthrough.mjs`. Get a real millisecond
profile in the browser (the diagnostic: low FPS *with* low GPU usage means draw
calls or JS; high GPU time means skinning, shadows or overdraw — that single
reading decides the order of Phase 1). Re-vendor Rapier SIMD and measure before
and after. Fix the extraction boarding bug (0–2 of 10 men reach the ramp).

**Phase 1 — the tiers.** Roster-as-truth. VAT crowd renderer as a **new entity
type alongside `Enemy`, not a refactor of it**. Tier 3 abstract. Promotion with
hysteresis. Flow fields. Spatial hash. Simulation worker.
*Acceptance: 300 named bodies at ≤ 12.5 ms of simulation and < 100 draw calls;
no roster record duplicated, lost or teleported over 20 minutes of a player
crossing the whole field.*

**Phase 2 — the line.** Influence field in the worker, tension and vulnerability
maps, three lanes, enfilade, per-agent panic and the rout counter, the objective
lattice, phases, the momentum clock, the trough, ticket bleed.
*Acceptance: over 24 seeded battles — none decided before minute 6, none past
minute 30, the front reverses direction at least twice in the median battle, and
the vulnerability map's peak coincides with where a human would say the line is
breaking.*

**Phase 3 — the hero layer.** Attack tokens, hero health drain, duels that claim
space, Revenge tags, Fortitude, mass and bracing.
*Acceptance: a Jedi in a crowd of 40 faces 3–5 live attacks; a braced line is
shoved measurably and re-forms; heroes rotate off without scripting.*

**Phase 4 — the objectives.** The six capability objectives, crewing,
vision-gated artillery, air passes, the dormant late objective, `Dig In`.
*Acceptance: an objective changes hands in ≥ 70% of battles; a battle with the
Relay held differs measurably in stratagem count from one without.*

**Phase 5 — the ground.** Finite cover, artillery-written craters, fire spread,
weather rules, cross-battle persistence.
*Acceptance: Act III has measurably less standing cover than Act I; a squad
ordered to Dig In occupies a player-made crater.*

**Phase 6 — the new mechanics.** §10.
*Acceptance: each has a check demonstrating the decision changing, not the
feature existing.*

**Phase 7 — the company.** Persistence, the Company tab, memorial, earned
nicknames, granted paint, downed-not-dead, after-action report.

**Phase 8 — the column.** Theatre map, route choice, supply chains.

**Phase 9 — co-op and versus.**

---

## 16. Guardrails

1. **The no-decoration rule.** Every element must change a decision, and its
   check must demonstrate the decision changing — not that the feature exists. A
   check that asserts a thing was constructed is not a check.
2. **Every acceptance number is measured, never asserted.** No driven run, no
   phase closure.
3. **A perf budget per tier, enforced by a failing check.** Tier 1 ≤ 48 bodies;
   simulation ≤ 12.5 ms at the stated population; draw calls < 100.
4. **No modifier that only multiplies a stat.** Every entry in the modifier table
   must name the verb it removes or delays.
5. **No number typed twice.** This repo's signature defect is a hand-maintained
   table beside its generated twin. Lane counts, band counts, tier budgets, phase
   boundaries and morale thresholds are each exported once and read everywhere.
6. **The seam is checked adversarially**, by a suite that hunts for a body that
   changed identity.
7. **Blind review at the end of every phase**, reviewers given the build and no
   notes.
8. **Nothing lands red.** Fast tier green before every push; full gate before
   every phase closes.

---

## 17. What this plan deliberately does not do

- **No new terrain tech.** 300–560 m is enough.
- **No WebGPU port.** three's `WebGPURenderer` is still often slower and we are
  on r169. Revisit when the crowd tier is GPU-bound, which it will not be first.
- **No SharedArrayBuffer, no multithreaded physics.** GitHub Pages cannot set
  COOP/COEP. Worker + transferable buffers instead.
- **No deterministic lockstep.** Speed over determinism, stated in §11.
- **No destructible everything.** Cover is finite and authored; the crater log
  carries the rest.
- **No dark maps.** §8.2.
- **No purchasable stats.** §13.
- **No enemy Nemesis hierarchy.** Patented to 2036.
- **No galactic strategy layer.** The theatre is the top level.
