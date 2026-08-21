# THE LINE — the flagship mode

Design settled by a five-lane committee, 20 Aug. Every number below was
measured against this tree, not estimated. Where two lanes disagreed the
disagreement is recorded rather than smoothed.

**Read `HANDOFF.md` §2 and `ROADMAP.md` PART TWO before designing anything
further.** This document assumes both.

---

## 1. What it is, in five lines

You are one Jedi in somebody else's war. One planet, one ground, one sitting of
20–40 minutes. Up to four of you drop in with a named squad cut from one roster
and fight three to five engagements on the same field, and between them the
**front moves across the ground you are standing on**. Your dead do not come
back. Nothing carries to the next session but a record and a plan.

The war is won and lost by the army. Your job is not to kill everything — it is
to be the reason the line is still standing when it takes the ridge.

---

## 2. The inversion the design rests on

**You are not the protagonist. The squad is.**

Every game of this kind makes the player the Jedi and the troopers wallpaper.
Invert it and four hard problems dissolve at once:

- **Jedi versus infantry.** You are not there to kill everything, so a run that
  kills three hundred droids and loses the squad is a loss.
- **The bond.** Not decoration — the win condition.
- **Co-op.** One roster, four squads, one shared purse. Your friend's
  recklessness kills *your* people. That is the reason to talk to each other.
- **The roguelike build.** The squad IS the build. Three ARCs and a brave
  sergeant plays nothing like ten green conscripts.

And it earns the brief's own phrase: you are a raindrop **because you cannot
save everyone.**

---

## 3. What the committee converged on without being told to

Five lanes, separate briefs, no shared context. They arrived at the same five
answers, which is worth more than any one of the arguments for them.

| Convergence | Who found it | Why it matters |
|---|---|---|
| **One ground. No sector map.** | war lane, red team | A front across sectors you never visit is *a fact about a map a sector cannot show you from the inside* — the Spire's post-mortem with one noun changed |
| **~40–60 live bodies, thousands instanced beyond** | scale, hands, red team | Independently measured three ways |
| **The front line is the one-way visible variable** | war, scale, red team | It is a fact about a place you can stand on |
| **The name list is a SECOND one-way variable** | war, troops | It only shrinks, it is on the HUD always, and it needs no scenery — so if the front fails to read, the mode still has a spine |
| **Persist the crater LOG, not the grid** | war, red team | Resolution-free, replays exact, 39–70 ms, ~125–188 KB against 1.5 MB |

---

## 4. The measured constraints that shape everything

Do not re-litigate these without re-measuring.

**Bodies.** `World.update` headless, no render: 40 bodies 7.03 ms · 80 bodies
17.09 ms · 120 bodies 24.53 ms. `maxAlive = 26` is honest.

**But the cost is the SKELETON, not the brain.** `Enemy._think` is 3.8 µs/body.
`BipedAnimator.update` is 46.4 µs — twelve times more. At 60 bodies,
`updateMatrixWorld` + `multiplyMatrices` is 28.8% of the frame and `_think` is
1.6%. **Hundreds of soldiers can each run a full brain. What they cannot each
have is a walk cycle.**

**The crowd is free and already shipping.** The colosseum draws **7,864
instanced figures, 1.10 M triangles, in 24 draw calls** — 140 triangles a
figure. Rebuilt as a battle in the real engine: **3,910 standing troops + 520
dead + 9 distant blades in 8 draw calls** at `high` on Geonosis
(`/tmp/borzprobe/raindrop.png`).

**A CUTTABLE body cannot be instanced.** `sliceGeometry` mutates a body's own
geometry — sliceability is precisely why nothing can be shared. A trooper who
walks, shoots, takes cover and can be cut in half costs **26 draw calls at
every distance, forever**. 500 of those is 13,000 calls against a 520 budget.

  → **This is the whole architecture.** The crowd is scenery with a state. The
  fight is 40–60 real bodies. A body **promotes** from crowd to real when the
  director decides it is joining the fight — and a body that changes rung
  should also change what it is doing, because nobody notices a LOD pop on a
  droid that just turned and started running at them.

**Wire.** 1.05 KB/s per body per peer, measured end-to-end on two real Worlds
with the shipped packer. Today's Command peak (50 bodies) already costs
1.37 Mbit/s — co-op is at ~45% of its ceiling now. Honest maximum for the
protocol as written: **~120 bodies**. Four private armies (96 allies + a wave)
is ~500 KB/s upstream and is dead on arrival. One shared roster is ~200 KB/s
and is comfortable.

**Persistence saturates.** 20 sorties × 400 craters on Geonosis: walkability
moves **0.2 points** and cratered coverage stops growing by sortie 10. Ruined
ground is a superb texture and a **dead spine**. Rubble is worse — static boxes
are walked linearly per body per frame: 1,608 boxes = 16.14 ms of sim with
nothing rendered. Ceiling ~1,000 boxes. **Persist the silhouette, never the
debris.**

> **AND THE SILHOUETTE IS NOT IN THE HEIGHTFIELD.** This paragraph was measured
> on WALKABILITY, which is a fact about the grid, and §14 Step 0 then found the
> grid is the wrong place to look: 520 of 539 marks are a bolt hitting sand, the
> cell is 2.5-3.4 m, and `crater` widens anything under 1.35 cells and shallows
> it to conserve volume — so twenty sorties of exact replay read as dunes. The
> mark that shows is ALBEDO, and albedo has no minimum feature size.
> `Terrain.scars` is a whole-map, non-decaying, stacking scar field at a 1.6 m
> cell: one extra texture tap, 1.77 MB a Terrain, and it takes the wide plate
> from 1.9% to 13.2% of pixels moved on the same log. The saturation warning
> still holds for the DENT; it never applied to the stain.

**No completely indoor places. Ever.** Player instruction, 20 Aug, after
playing them: *"I just tried the boarding bay and the providence and hated them,
you completely missed the ball so just remove them. your outside work is much
better."* Both levels were deleted and the `boarding` campaign with them. THE
LINE is fought outdoors, under a sky, with weather and distance and a horizon —
those are the things the engine is good at and the things the reference plates
are made of. An interior may exist as a *feature on an outdoor field* — a bunker
you breach, a downed cruiser you fight through, a gun emplacement — but the
player must always be able to see out, and no engagement may take place in a
sealed room.

**The battlefield must not be flat.** At 2.1 m on a plain both armies compress
into a 40-pixel band at the horizon — a raindrop cannot see a war. At 15 m
looking down a shallow slope you see *into* the depth of both lines. Every
reference plate is shot from a rise or across a bowl. The generator must put
the player on the lip of one, front at the bottom, 12–18 m of fall.

---

## 5. The session

**One sitting = one deployment = one seed = one ground = 20–40 min.** Length is
itself a seed roll: Raid (2 engagements, 10–15 min) · Push (3, 18–25) · Grind
(5, 30–45).

- **0:00** Deploy card. The seed, the ground, and **your ten names, readable
  before you land** — `seedCommand(seed)` already mints them deterministically.
- **0:12** You come down in a LAAT with your ten. `MORALE.JEDI_NEAR` starts
  paying the moment you are among them.
- **0:24** **You can see the front.** One side clean, standing spires, smoke
  columns at 200 m. The other your own craters, your own wrecks, your own dead,
  columns at 90 m and closing.
- **0:32** First contact walks in over the far edge. Nothing spawns near you
  that you could not have watched arrive.
- **1:00** Wave 1. You are a raindrop and the wave is not the war — it is the
  part of the war that has noticed you.
- **Between engagements:** the muster. 60–90 s. Points in, bodies out, the roll
  of who lived, who was promoted, and who is on the fallen list. **This quiet is
  where the run becomes a story. It must be real and it must have no input.**

**Nothing carries between sessions.** That is `Progress.js`'s written law — *"no
cross-run power … the hundredth run starts exactly where the first did."* What
crosses is a record and a plan. No resume: a run you can put down is a campaign,
and this is not a campaign.

---

## 6. The Jedi-versus-infantry answer: suppression

Measured: one B1 does **2.17 dps** to a moving player — 46 seconds to kill you.
Wave 20 does **353.8 raw dps** — 0.28 seconds. There is no middle, and
deflection is a percentage so it scales the problem rather than solving it.

**So bolts cost the guard, not the health.**

| grade | cost |
|---|---|
| BLOCK (blade nearly still) | 1.2 stamina |
| DEFLECT (blade driven, >3.2 m/s) | 0.4 |
| RETURN / PERFECT | **0** |
| arrived in the auto-guard cone, unanswered | 0.5 Force |

Twenty B1s fire 18 bolts/s. At 1.2 that is **21.6 stamina/s against a 16/s regen
and a 100 pool** — underwater in about twelve seconds. At zero stamina there is
no dash (18), no dive (18), no sprint. **The crowd does not kill you. It nails
your feet to the floor, and then the four B2s at 5.85 dps each kill you.**

It is legible (the bar is already on screen), fully answerable by skill (a
PERFECT costs nothing), and it converts volume of fire from a damage source into
**terrain** — a beaten zone is a place you cannot stand. That is what a
battlefield is.

**And the objective advances at the pace of the slowest friendly inside 14 m.**
You can sprint 200 m into their rear; the line does not come with you, and you
arrive alone on an empty bar. Killing stays fast and fun and advances nothing.
Measured, and nobody designed it: walking 35 m forward drags the whole formation
with you and costs **4 of 10 men**.

**Third body class: the conscript.** 6 hp, **0.7 dps**, one pass, **worth 0
score and 0 Insight**. The lawnmower is only a lawnmower when mowing pays.
Forty conscripts that pay nothing are weather.

> **THE GUN WAS 1.4 AND IT IS HALVED, AND THE PARAGRAPH ABOVE IS WHY THE
> HALVING COSTS NOTHING.** Every price on this page is quoted against A MOVING
> PLAYER — one with a guard, a dash and a dive — and until §16.3 was fixed that
> was the only reader there was: `World._boltHitTest` skipped its whole enemy
> loop for hostile bolts and your own troopers live in that array, so no rifle
> on the other side could touch your army. The same field now also prices what
> a round does to a clone trooper with 46 hit points and a slot to stand in,
> who can do none of those three things, and the two readings want different
> numbers. What does NOT move is the argument: this section's answer to a crowd
> is suppression, and suppression is billed PER BOLT — `GUARD.stamina` is
> `[1.2, 0.4, 0, 0]` by grade and an unanswered bolt costs Force, and not one
> of those numbers reads `damage`. Same forty bodies, same cadence, same bolts,
> same bar. A conscript is now more purely the thing this section says it is.
>
> **AND THE LEVY BEING FREE OF THE THREAT BUDGET IS HALF A SENTENCE.** The
> budget is the mechanism that keeps a wave honest, and it is honest about the
> PLAYER's two ledgers only: `src/game/Levy.js` argues the exemption at length
> and every word of that argument is about score and about threat. A body that
> costs the wave nothing still shoots your men. Measured on the flagship mode's
> own ground, one engagement driven to its muster with no Jedi on the field,
> five seeds — the two sources of fire the budget never pays for are **five of
> the eight names an engagement costs**, and they are the only two whose output
> does not shrink as the line shrinks:
>
> | | survivors of ten, at the muster |
> |---|---|
> | as shipped | **1.8** |
> | the levy off the field | 4.0 |
> | the gun pit silenced | 4.8 |
> | every hostile bolt ×0.65 on a man with a roster record | **2.8**, two seeds of five WIPED |
>
> That last row is the one to read. Fifty-four per cent more effective health
> on every man bought one survivor and lost two runs, because
> `CommandDirector.allyScale` prices the wave per LIVING body: **a line that
> lives longer meets a wave composed for a line that lived.** Everything on the
> ledger behaves that way from either end — deleting the army surcharge
> outright is the same 2.8 — so the only levers that move this number are the
> two the ledger cannot see. Both are halved (`GUN.every` 7.0 → 14.0 and the
> round above), which takes an engagement fought without the Jedi from 1.8 of
> ten to **5.4**, and `theline.12` holds it there.

---

## 7. What a raindrop does — four verbs, none of them "kill everything"

- **BREAK** — morale is fully built and barely used. Walk into the front of a
  formation and it comes apart. `unleash`, `dread`, then stand there so
  `JEDI_NEAR` holds your nerve while theirs goes.
- **TURN** — a returned bolt that kills its firer counts on *their* morale
  ledger. Every bolt sent home deletes a rifle and breaks a nerve. Only 5%
  RETURN / 9% PERFECT by speed alone: a hundred hours will not exhaust it.
- **OPEN** — `openness()` is the most under-used system in the tree (held ×3.0,
  yanked ×2.0, downed ×1.5) and its own comment says it is invisible. Grip a B2
  and the ten riflemen who needed 17 seconds need six. **The Force is a
  multiplier on other people's guns.**
- **BREACH** — the one thing on the field only a Jedi can touch. Twenty seconds
  of held blade, deflecting nothing, away from your line, both bars draining.

---

## 8. The four ways to play

Different resource, different range band, different read of the screen.

| | axes | band | spends | job | loses by |
|---|---|---|---|---|---|
| **Vanguard** | blade + body | 0–3 m | stamina | BREAK | getting surrounded |
| **Sentinel** | guard + bond | 5–25 m | the guard flick | TURN | — |
| **Consul** | force + bond | 10–40 m | Force (2.63 s of Focus, 13.3 s to refill) | OPEN | an empty bar at the wrong moment |
| **Shadow** | dark + blade | alone | your own health | BREACH | any loss is 25% of a five-man force |

**Warning, and it is a real one:** `attune-force` measures **Δ0.000** and 17 of
40 boons read UNMODELLED because `balance.mjs` has no Force powers in it.
`Soresu` 0.000, `Tutaminis` 0.036, `Aegis` 0.165 are the weakest cards in the
table *because model depth is the only metric*. **If the Sentinel ships,
`balance.mjs` needs an "allies preserved" axis**, or the whole playstyle reads
as the worst build in the game and nobody picks it twice.

---

## 9. Co-op — one roster, four squads

`SQUAD = 5` is already the unit and `CommandRoster.squads()` already slices the
living list into fives. Four players take four squads out of one roster of up
to 24.

Four private armies is reachable today and **produces two defects**, both found
by driving it:

1. **Name collision.** 40 named bodies, **39 distinct names** — `taken` is
   per-roster, so two rosters mint the same `CT-8479`. In the one mode whose
   subject is names you recognise.
2. **An orphaned Commander.** `peer-left` removes the RemoteAvatar and
   **nothing removes its `Commander`**. Its army goes on being steered off a
   disposed body.

One roster fixes both by construction, drops the wire to ~200 KB/s, and buys
the actual co-op mechanic: **the purse is shared**, so *"a Heavy for your squad
or an ARC for mine"* is a conversation at every muster.

Host drop still ends the session. There is no host migration and `main.js` says
there is not going to be one. **Say so on the card.**

---

## 10. The soldiers

**The diagnosis, measured over 60 s of a real Command world: nobody has a job.**
All 20 ranged archetypes run the same 14-line `_rangedBrain`. Result: 55–60%
running, 27–52% standing, **4–7% firing**. A watcher sees identical white
figures jogging.

**And morale is inert exactly when you are watching.** It works and moves
properly — 0.72 → 0.14, two broken by 50 s — *only when the player leaves*.
`JEDI_NEAR` +0.085/s pins every record at 1.000 in four seconds while you stand
among them. This needs solving before any of §7's BREAK verb means anything.

**The trait model.** Five axes — nerve, aggression, marksmanship, discipline,
bond — and **the nickname is the trait readout**: the game gives you the name
you had already decided to call him. Four kinds of disobedience, with one rule
that keeps it dramatic rather than annoying: **a retreat can never be refused.**

**Five free things already in the tree:**

1. Every enemy passes `crouch: 0` into an animator that already drops the hip
   and shortens the capsule. **A kneeling firing line is one float.**
2. The Z-6 is modelled and unreachable — `buildBlaster`'s third branch is never
   called.
3. **`capsules()` has no broad phase**: 12,456 objects rebuilt per frame,
   **26.7 ms = 39% of the frame** at 213 bodies. ~15 lines for a per-frame cache
   and a body-sphere reject, ~200:1 rejection. *This is a live bug today.*
4. `underFire` only fires on an actual hit; a gunner's declared suppression lane
   is one segment, no second bolt pass.
5. `sayWords` works, in real English, and is gated away from allies by one
   condition (`!opts.self`).

---

## 11. Art direction

**The crowd holds.** Two flat tones and an ink line make a 140-triangle figure
convincing at 24 m. A photoreal renderer would need ten times the geometry.

**The sky was blue and the ground orange, and it was the biggest visual defect
in the game. FIXED — but NOT by the mechanism this paragraph proposed, so read
the rest of this before touching `uSkyTurn`.**

The diagnosis was right: measured live fog on Geonosis `#a6adb2`, a cold
grey-blue, from a physical Preetham dome that stays blue at turbidity 10. The
proposed fix was to turn the dome, the fog and the aerial tint by
`skyProbeTurn`'s rotation.

**That was tried on the haze and `cel.mjs` refused it, correctly.** `uGain` is a
composite pass over the WHOLE FRAME, so a level's grade already moves the drawn
dome and what distance converges on together — measured, every level's haze
tracks its own skyline within 6°. Turning one of them alone makes a veil with a
colour the sky does not have, which is the "grey fog" rule 3 of
`src/toon/REFERENCE.md` forbids. `skyProbeTurn`'s own note says so in advance:
the drawn dome, the fog and the aerial tint "have to match what is actually
painted on screen", and the Ember Shelf's orange comes from its `gain`.

**The real defect was that Geonosis had no grade at all**, while its own
atmosphere block promised one — *"the ORANGE comes from the sun, the cloud deck
and the grade"*. The drawn skyline's hue against the hue each level authored:

    drifts     authored 220°  drawn 202°   Δ  18°
    colosseum  authored 220°  drawn 205°   Δ  15°
    scoria     authored  10°  drawn  62°   Δ  52°
    mustafar   authored   6°  drawn  59°   Δ  52°
    geonosis   authored  25°  drawn 205°   Δ 180°

Every other level within 52° of its own sky; this one on the opposite side of
the wheel. `gain: [1.18, 1.00, 0.68]` puts the skyline at 54° and the haze at
47°, with luminance moving 0.414 → 0.416.

**So `uSkyTurn` stays at identity for the drawn dome, deliberately.** It turns
the environment probe and nothing else, which is the half no grade can reach.

**Three more, in order:**

- **Value, not hue, at scale.** At 6–19 px only value survives. Three bands with
  ≥0.18 luma separation; scale carries rank (officers 1.15×).
- **Quantise the smoke. DONE.** `Smoke.js` used a soft vertex-alpha gradient —
  the one un-cel thing in the frame. At 7 columns you get away with it; at 20 it
  dominates the sky, and the marching front puts 9-10 up by engagement 5. The
  alpha is snapped to five nodes now, on `saberCelQuant` and not
  `saberCelBand1`: the plateau-centre form never returns 0, so a transparent tip
  would come back 10% opaque and veil the whole sky. The hook WRAPS `makeSoft`'s
  rather than replacing it, and `CEL_BAND_GLSL` is *not* pasted in —
  `installCelShading` already appends it to three's `<common>`, which a
  MeshBasicMaterial includes, so a second copy is a duplicate definition and the
  column would not compile at all.
- **Never extend the ink for the crowd.** At 138 m a figure is 8.5 px and a 1 px
  outline is 12% of its height. The ink prepass far plane is 138 m and must
  stay: everything beyond is drawn once, flat, **so the far battle costs one
  rasterisation, not two.**

**Gruesome without gore.** The reference plates are brutal and have almost no
blood. What does it: the **quantity of the fallen**, the **indifference** of the
living walking past, **parts rather than wounds** (a severed arm reads at 4 m; a
wound reads as texture), and **mismatch of scale**. Two hard rules:

- **No gore effect may have a soft edge.** `Injury.js` already got this right —
  a mark is a nine-sided polygon, one flat colour, hard edge.
- **Nothing bloody may out-saturate a lightsaber.** The moment blood beats a
  blade for chroma it stops being a war painting and becomes a horror game.

**Persistence beats intensity.** One flat dark stain still on the sand when you
come back past is more brutal than a spray that fades.

---

## 12. Procedural battlefields

Generate the battle, then the ground that explains it.

1. **A reason, from a table of five** — a pass, a ford, a landing zone, a gun
   line, a wreck field. One seeded choice, not a continuous parameter space.
   That is how you avoid slop.
2. **The FRONT, before the ground.** A bezier from one map edge to another, 3–5
   control points, two axes of advance crossing it. Six numbers.
3. **The height function derives from the front.** `Terrain` only ever calls
   `preset.height(x, z)`, so a closure slots in with **zero Terrain changes**.
   High ground *flanks* the front and never sits on it; exactly one chokepoint
   (two reads as a maze); the ridge field goes anisotropic along the advance
   bearing, which turns noise into *ground that moves in a direction*.

   *(1–3 are BUILT — `src/world/Battlefield.js`, bound by
   `tools/checks/battlefield.mjs`, which builds a real `Terrain` off the
   generated preset and measures each clause on the baked grid. It is a
   **layer, not an eighth seed**: the preset row is an authored one spread
   whole with `height` replaced, which makes §5 a construction rather than a
   discipline and means §13.5 cannot break — the generated key is never in
   `LEVEL_ORDER` and `installGround` refuses to shadow an authored name.
   Measured over five reasons × two seeds: the nearest high ground is 63–166 m
   from the line against standoffs of 38–58; the crossing notch is 9–28 m
   below the median climb against a next-best way through of 0.3–8.8 m, a
   ratio of 2.4–34; the ridge field's directional variogram bottoms 0–7° off
   the advance bearing at 2.5–18× max/min. Two things the measurements moved,
   both argued at their call sites: a flank built as `crest × ridge` is not a
   wall but a row of hills with a draw between every pair — and the draws run
   toward the line, because that is what the anisotropy asks for — so 45% of
   the crest is upland the ridges ride on; and a choke notched in arc length
   along the line is a notch in the near wall rather than a way through, which
   put the lowest crossing on a gun line 262 m from the chokepoint the plan
   had named.)*
4. **Dressing follows the front, not the disc.** `strewGround` must take a
   **density, not a count** — that deletes the `landmarks: 3.4` magic number on
   every level at once. `strewWrecks` has no density field at all and is the
   biggest line item on Geonosis (112 of 225 draw calls); wrecks belong on the
   fighting line. A **walking barrage** is 8 craters at 14 m on one azimuth, and
   says *a thing happened, in a direction, at a time* — which a thousand
   scattered rocks cannot. **The dead mark the front**: 520 prone instanced
   figures in a 26 m band, thickest at the choke, one draw call. *(Built —
   `src/world/Fallen.js`. It is TWO calls and not one, and the second is the
   honest price of not repeating one silhouette four hundred times: two poses,
   103 triangles a body, per-instance tone, and 100% of them inside the 26 m
   band. `Front.burnBand` is the burnt swath the same paragraph implies and
   does not name.)*
5. **Do not generate the palette.** Pick from authored sets.

**Clark–Evans cannot see a line, and that is a hole in our checks.** Measured:
isotropic clumps R = 0.664, a battle front R = 0.668 — indistinguishable. The
new statistic is directional banding: sweep 36 bearings, project onto the
normal, histogram in 16 m bins, take max/min of the coefficient of variation.
Uniform ≈ 2, a front ≈ 6–7.

*(Built — `banding()` in `tools/checks/ground-cover.mjs`, beside `clarkEvans`,
and the two quoted figures were checked on this build rather than trusted. The
claim holds; one figure needs a correction. Over eight seeds, with the front
taken from the shipped `addFallen` and the clumps matched to it on count and
tuned on σ until Clark–Evans could not separate them: **Clark–Evans is blind
exactly as claimed** — front 0.631, clumps 0.638, ranges overlapping on every
seed. **A front bands at 7.1–11.7**, so "≈6–7" reproduces at its floor and
runs higher. **But "uniform ≈ 2" is not a uniform scatter** — a Poisson field
on the same disc measures 1.15–1.44 and never reaches 2; what sits at ≈2
(1.66–2.20, median 1.91) is the isotropic CLUMP control, which is the thing a
front actually has to be told apart from. The one convention this paragraph
leaves open — what range the 16 m bins cover — decides the whole statistic and
is argued at the function: binning each bearing over its own span makes the
one bearing that carries the whole signal report none of it.)*

---

## 13. How this survives the Spire and the Descent

The post-mortem: *a sequence of places did not read as a sequence*, and the one
thing that worked was *a rung borrows a level and changes only its air*.

1. **There is no sequence of places.** One ground for the whole deployment.
   Command already ships five stages on one Geonosis and nobody has called it a
   tour, because `AREAS` never rebuilds the world.
2. **The engagements borrow the same level and change only the front.**
3. **The variable is a fact a place can show you from the inside.** The Spire's
   exact indictment was that *altitude is a fact a place cannot show you from
   the inside*. A burn line is the opposite — you can stand on it.
4. **There is a second spine that needs no scenery: the name list.** It only
   shrinks and it is on the HUD every second. **If the front fails to read, the
   mode still has one.** That is the difference between this and the Spire,
   whose entire content was the thing that did not read.
5. **No room's deletion deletes the mode** — every level in `LEVEL_ORDER` is a
   legal seed. That is exactly what killed the Descent.

**The red team's dissent, recorded because it may be right:** a front the player
feels across sectors they never visit is the Spire with one noun changed, and
the only cure is a map screen, which is the tour. **The design answers it by
deleting the sectors** — one ground, and the front is a physical line on it.

---

## 14. Build order — each step ends in a test that can kill it

**Step 0 — before anything (1 day).** Fight one Command area, dump the crater
log, reload, replay, fight again. **Ask a person: does visit two read as *the
same ground after a battle*, or *a level with holes in it*?** That is the
Spire's question asked correctly, and it is one day.

**Step 1 — the front reads, or it does not (4 hours).** One Geonosis, five
engagements behind a debug key. Between each: replay the crater log (70 ms,
measured exact), re-dress at `seed + engagement`, march the smoke columns in
(`rmin: 220 − 40·n`), and grow wrecks on the burnt side only.

> **The kill test, stated so a coincidence cannot satisfy it:** three
> screenshots from the **same spot facing the same way** at engagements 1, 3 and
> 5. Shuffle them. Hand them to the player. **They put them in order, or the
> variable is not visible.**
>
> If they cannot: the moving front is the Spire in a hat. Stop. Fall back to the
> roster as the sole spine — Command with a seeded ground, seeded length, the
> shared-squad co-op split and the crater log for texture. ~600 lines, all
> low-risk, and it still delivers short seeded sessions with friends on ground
> that remembers.

**Step 2 — the Dead Jedi test (1 evening).** Boot Command on Geonosis and change
exactly one thing: **the player cannot deal damage** (`boonMods.cutPower = 0`,
blade out of `bladeTargets`). Keep Force, orders, presence, morale, stratagems.
Play three engagements. **Did you have anything to do?**

> Three arms — *no player*, *player with blade*, *player without blade* — and
> compare `fallen` and areas taken. If "no blade" sits nearer "with blade" than
> "no player", the presence loop carries real weight. If it sits nearer "no
> player", §7 is wrong and the honest answer to what a raindrop does is still
> "kill everything".

**Step 3 — the Puppet Line (half a day).** 40 `inert` bodies on a hand-authored
60-second timeline, no AI at all. Isolates the only uncertain question — does
the *output* read as a battle: posture, silhouette, timing. **The script that
reads well IS the role taxonomy, written as acceptance criteria.**

**Step 4 — L2, the merged rigid-skin rung. BUILT AND MEASURED — see
`src/game/MergedSkin.js`.** The single highest-value engineering item.
`_collectLodParts` already partitions each body into primary/silhouette and
detail; L2 merges the kept set into a `SkinnedMesh` with weight 1.0 per vertex,
derivable from the existing rig with **no re-authoring, and the silhouette
identical by construction so the seam is invisible**.

The estimate said 42 bodies = 1,040 draw calls today, 394 with it. Measured on
a real `high` World on geonosis, 42 mixed bodies at 100–154 m: **1,064 today
and 194 with it**, a 5.5× cut. The "today" figure was honest to 2%. The "with
it" was pessimistic by 2×, and the reason is the one thing this paragraph got
wrong: the merge is **one SkinnedMesh per MATERIAL BIN, not one per body**. A
trooper's 26 kept meshes wear four distinct materials, so a trooper is four
calls and not one — and one call was never reachable, because the four bins
differ by which of the texture foundry's maps they sample. `color` folds into a
per-vertex attribute exactly; `roughness` and `metalness` are dropped because
the cel model deletes every term that reads them. Whole rigged roster: 796 kept
meshes → 136 calls.

Bound by `tools/checks/frame-budget.mjs` §6, five checks — the draw-call cut on
a real World at a real distance, a vertex-for-vertex identity against the
meshes it replaced after the rig is re-posed and re-placed, the ink (once,
never twice, never none), the shader read that licenses dropping roughness and
metalness, and the teardown when a body is cut apart.

**Step 5 — L3 instanced cohorts. BUILT AND MEASURED — see
`src/game/Cohorts.js`.** Beyond the distance the ink reaches, where a leg is
3.9 px and there is no gait to lose. One `InstancedMesh` per (archetype · elite
· scale) × material bin, holding every body of that kind in the band.

**The band is 137.8 m, not 140, and it is derived rather than chosen.**
`OutlinePass.prepass` narrows its own camera to `min(uHaze.y, uEdge.y) · 1.06`
and `INK.edgeFade[1]` is 130 — so the game already draws **no outline on
anything past 137.8 m**, which is the one thing an instanced body cannot carry.
Measured over all 7 levels × 4 tiers, the prepass reaches furthest on
scoria/low at 127.2 m. The 3.9 px figure above is confirmed exactly: 4.52 px/m
at that range on a 720 px frame.

**"Animation moves to a per-instance phase in the vertex shader" cannot work in
this renderer**, and the reason generalises: the ink prepass renders with
`scene.overrideMaterial`, so a displacement living in a body's own material is
not in the shader the outline is drawn from — the outline would be drawn at the
un-walked pose. The animation is in the INSTANCE MATRIX instead: position,
facing and scale, rewritten every frame. Bodies still march, wheel and close.
What is dropped is the gait, and it is dropped on a measurement — the frozen
pose sits **0.98× at worst** of the distance the live body sits from *itself*
one gait frame later, so a cohort body cannot be told from a frame of the
animation it replaces.

The whole ladder, three readings of one field one line apart:

| rung | 42 bodies | 84 bodies |
|---|---|---|
| cull only (LOD 1) | 1,064 draw calls | 2,130 |
| merged skins (LOD 2) | 194 | 390 |
| **cohorts (LOD 3)** | **38** | **38** |

L2 is ~4.6 calls a body; L3 is ~4.4 calls an *archetype*. Bound by
`tools/checks/frame-budget.mjs` §7.

**Then, and only then, the mode. BUILT — `MODES.theline`, and the estimate was
close.** ~1,100 lines of spine against ~12,000 lines of existing machinery, and
the spine came in well under that because the rungs above it had already been
built against this document: the seeded length, the deploy card, the marching
front and the muster were all in Command before the mode existed.

**One rule is the whole difference between the two modes**, and it is the rule
§2 is an argument for: Command is won by taking the ground, The Line is won by
the line. `_endCampaign` wrote `won: true` off reaching the last area and never
looked at the roster, and an emptied roster ended NOTHING — the only other
ending in the game counts PLAYERS — so a Jedi standing over ten graves took the
ridge and got the victory card. It is a field now (`holdTheLine`) and a second
ending door (`_checkLine`), with a third card for the ending neither "you won"
nor "you died" describes: the run is over, the army is gone, and you are still
standing there.

**And the mode's first honest measurement was half instrument, which is worth
recording as carefully as the number was.** The first reading said a ten-man
roster is wiped out in 105–170 seconds of the FIRST engagement, on every seed,
in both army modes — so the muster is unreachable and the mode cannot be won.
Two faults were in it, and both flattered the catastrophe:

- **The muster window was invisible.** `_areaClear` ends with "no screen wired
  — muster and press on", so `autoMuster()` and `closeMuster()` both run inside
  one `payWave` call and `director.mustering` is true for **less than a frame**.
  Every bench polled for it, never saw it, and ran on into areas two and three,
  reporting the roster at whatever wipe it eventually reached. Held open with a
  no-op `onMuster`, a line with **no player on the field takes four areas of
  five**.
- **The idle arm was measuring a magnet.** A Jedi held on his feet and not
  playing is an unkillable target standing on the deploy mark, and
  `Levy.installLevyAim` points forty conscripts at whatever blade is on the
  field. Measured five seeds of five: **an idle Jedi is worse for the line than
  no Jedi at all** — 0.0 survivors against 1.8. The reference arm is *no
  player*.

> **UNDER RE-MEASUREMENT — do not act on the tuning numbers below.** The
> before/after tables in this section were **not a controlled comparison**.
> Every arm was a separate process, `World.js` holds one module-level `rng`
> with no reseeder, and two processes that differ in any earlier draw diverge
> completely — `theline` and `command` differ in exactly one such draw, because
> a crossing rolls a session plan and Command does not, so **the mode string
> alone shifts the whole stream**. That is why the same change read 5.4 in one
> mode and 3.0 in the other.
>
> Run properly — both arms from a fresh process, identical module-init phase,
> the generated ground pinned off in both, the only difference being the two
> constants — five seeds give **stock 1.8 `[5 1 2 1 0]` against tuned 3.0
> `[1 5 5 1 3]`**: +1.2 with a standard error near 1.3, **not distinguishable
> from zero**. It is chaotic rather than merely noisy — seed 1 goes 5 → 1 and
> seed 2 goes 1 → 5 under a change of one bolt's damage from 10 to 5 — so
> paired seeds stop being paired within seconds.
>
> Twenty seeds an arm are running. If they say the lever does nothing, the two
> constants come back out and every note quoting them is corrected.
>
> **What survives is method, not tuning:** the muster is invisible to a poll; an
> idle Jedi is worse for the line than no Jedi, five seeds of five; and
> `theline.12`'s four readings of ONE build span 1.3 to 6.0, which is why its
> band is ±4 and why it can only catch catastrophe.

**The line was still far too cheap, and that is the real result.** Corrected
instrument, no player, survivors at the muster: **1.8 of ten**. The user set the
target at about half a ten-man line, and it now measures **4.1 pooled over
seventeen engagements, sd 3.0** — every arm reaching its muster on every seed,
where before four of five did.

**A third instrument fault is folded into that number and is worth its own
line.** The first report of this tuning said 5.4, and 5.4 was one good draw.
Five independent runs of the same arm on identical code read `5.4 · 6.0 · 5.7 ·
3.0 · 2.5` — a swing in the MEAN, not in a seed. `World.js` holds one
module-level `rng` for the whole process and exports no reseeder, so the phase a
run starts from is whatever ran before it, and five-seed arms taken inside one
process share that phase rather than sampling independently. **No run in this
game is reproducible across a code change; only distributions compare.** Every
number in this section is a pooled spread for that reason.

**The lever chose itself by measurement, and it says something about the
budget.** Effective health is self-cancelling — `allyScale` prices the wave per
*living* body, so 54% more health on every man bought one survivor and lost two
runs to a wave composed for the line that lived. Everything on the threat ledger
behaves that way. The two things NOT on it are the emplacement (a prop, never in
`world.enemies`) and the levy (exempt by §6's own argument, every word of which
is about the *player's* ledgers) — and between them they were **five of the
eight names an engagement cost**. Halving both reaches the target; neither does
alone, because survival is a threshold. Neither halving touches what either
thing is for: the levy's job is suppression, which is billed per bolt and reads
no damage at all.

None of this is a regression. It is what §16.3 looked like from the other side:
until this exercise **no hostile bolt could touch your own army at all**, so
every number ever taken about the line was fiction and there was no earlier
state to restore.

---

## 15. What was cut, and why

- **The strategic sector map.** It is the Spire. Two lanes reached this
  independently.
- **500 fighting bodies.** Every technical cliff in the design is a cliff *only*
  because of it. 40–60 real, thousands instanced.
- **Cross-session power.** `Progress.js`'s written law. A skill tree is the most
  common way that promise gets broken.
- **Save / resume.** A run you can put down is a campaign.
- **Grenades for the player.** `grenades: true` sat on the clone archetype its
  whole life with no reader while the Databank sold it. We deleted the field
  rather than build it; adding a Jedi grenade walks straight back in. The game
  already has four higher-fidelity versions (`Stratagems.blast`, `unleash`, a
  hurled body, a pushed crate). **A Jedi who throws a grenade is a Jedi who has
  run out of Force, and that state should be frightening, not equipped.**

**Kept, one exception:** a **dropped rifle** — one magazine, twelve bolts, no
reload, no guard zone while held, saber must be down. It is not a loadout slot.
It is a thing lying on the ground because the man holding it is lying next to it.

---

## 16. Live bugs this exercise found in the shipped game

Not flagship work — these are wrong today.

1. ~~**`capsules()` has no broad phase**~~ — **FIXED, and it was worse than
   this line.** Measured at a FIFTH of the body count: 39 live bodies on a lit
   field cost **463 `capsules()` calls a frame, 8,797 entries and 16.43 ms** —
   a quarter of a 60 Hz frame — because `World._boltHitTest` rebuilt every
   enemy's whole skeleton for every bolt in flight. A sphere per body, measured
   off the capsules the body actually presents and cached, takes it to **10.6
   calls, 201 entries, 0.57 ms**. The first attempt built the sphere out of
   `radius` and `chestY` and was silently wrong: those are a hull width and a
   chest height, neither is a bound, and a fan of 13,320 bolts through 37
   archetypes lost 134 answers, led by the dwarf spider standing its capsules
   2.70 m up. The fan is `tools/checks/bolts.mjs` and it is what licenses the
   optimisation at all — a broad phase that is slightly too small does not
   crash, it deletes hits, and nobody reports that as a bug.
   **It also found a live one.** A droideka's `walkPhase` was initialised in a
   branch it does not take, so `_poseDroideka` ran `undefined + dt` on frame
   one and NaN fed back into itself forever: every droideka in the game
   presented three leg capsules with a non-finite endpoint, `segmentNear`
   answers those with a miss, so **its legs could not be shot off or cut off**
   and the topple at two legs lost was unreachable.
2. ~~**Morale is inert while the player stands in the formation**~~ — **FIXED.**
   `JEDI_NEAR` is unsaturated and presence is a distance gradient rather than a
   floor: full at the shoulder, `MORALE.EDGE` at the rim of `NEAR`, nothing
   past it. 0.085/s at the shoulder against 0.030 at fourteen metres.
3. **Two lines stood 30 m apart for 35 seconds and neither took a casualty.**
   ~~Leash, preferred band, or line of sight — unknown.~~ **FOUND, AND IT IS
   NONE OF THE THREE — FIXED.** `World._boltHitTest` opened its enemy loop with
   `if (bolt.team === 1 && !friendly) continue`: an early-out over the *whole*
   loop for every hostile bolt in the game, on a premise the `canHarm` clause
   thirty lines below it already writes down and contradicts — "Command puts
   your troops in that same array on the PARTY's team". They do, and it skipped
   them too. **No rifle on the other side could touch your army.** Measured on
   a real Command world on Geonosis, ten troopers formed up against a live
   wave: 90 seconds, roster 10 of 10, every man at full health — and a
   synthetic bolt driven straight through a trooper's own capsule by
   `_boltHitTest` returns NO HIT while the identical segment through a droid
   returns the droid. The line could be killed by a blade, a grenade or a
   stratagem, and by nothing that was fired at it. §13 calls the name list the
   mode's second spine, "it only shrinks and it is on the HUD every second";
   it could not shrink to gunfire. After: same world, idle player, **7 of 10
   down in 60 s**. The gate is now the cheap half of the question `canHarm`
   already answers — skip only when the bolt and the body are on the same side.
   **A war that will not fight itself cannot be a war you are a raindrop in**,
   and every number in this document sat on top of it.
4. ~~**`_cullOldestDebris` spends debris only**~~ — **ANSWERED, and the answer
   is that it should.** Debris is the only unbounded producer; everything else
   in the world has an owner that knows how to take it away WHOLE, and a budget
   that evicts one bone of a live corpse is not enforcing a bound, it is
   corrupting an object another system still holds. So the overshoot stands and
   is made visible instead: `stats.overBudget` counts the refusals, and
   `Corpses` drains the batch within a second at every tier.
5. ~~**The orphaned `Commander` on `peer-left`**~~ — **FIXED**, and it was worse
   than an orphan: a departed player's leaderless army kept its standing order,
   kept fighting and kept counting in the census, so on a real pair the peer
   removed at 5 v 9 **wiped the host's line and took the field**. Quitting a
   meeting was the strongest move in it. See `dismissCommander`.
6. ~~**`attune-force` measures Δ0.000**~~ — **ANSWERED with the second axis §8
   asked for.** `tools/balance.mjs` now stands a line of `OPENING_STRENGTH`
   troopers beside the modelled player and reports `Δline` beside `Δdepth`, so
   a build whose whole output is other people's survival is ranked on it rather
   than scored zero. It prints the cards that are below the median on depth and
   above it on the line — which is the list a one-axis ranking called worthless.

**All six are closed.** This section is kept as written rather than deleted:
what it records is that a design exercise found six live defects in a shipped
game by asking what the game would have to be true for, and four of the six
were invisible to every check in the tree until something needed them.
