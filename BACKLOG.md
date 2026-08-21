# The whole of the outstanding work, in one list

**This is the master list.** The player, on 21 Aug:

> *"any session will know that we are working on everything we didn't do in the
> V3 list that was not reverted, the V4 list, the V5 list, and the Flagship mode
> all at once ie. melding them together and in an order that makes sense and
> getting them all done to perfection and deeply… We will make sure nothing is
> missed"*

So this file merges four sources into one ordered backlog:

| Source | Where it lives | What it is |
|---|---|---|
| **V3** | `PLAYTEST.md`, *20 Aug — first play of the post-audit build* | The first play of a build the player could actually reach. Some of it was superseded by V4; the rest is being audited item by item — see §0. |
| **V4** | `PLAYTEST.md`, *20 Aug — second play, and the flagship list* | The second play. **Closed** — every item has an outcome recorded in that file's own "What came of it" table. |
| **V5** | `PLAYTEST.md`, *21 Aug — SABER GAME NOTES AND IMPROVEMENTS V5* | The newest list. Logged verbatim, none of it started except where marked. |
| **Flagship** | `FLAGSHIP.md`, and `NEXT.md`'s headline | THE LINE. §14's three kill tests have been run; the verdicts changed what to build next. |

**Nothing is struck from this file when it is done.** It gets a ✅ and the
evidence — the file, the check suite, and the number that settles it — because
the player has twice asked for an audit of an older list, and a list that
deletes its own history cannot answer one.

---

## The order, and why it is this order

Four rules decided it, in this priority:

1. **A bug the player hit beats a feature they asked for.** They are playing
   this build; every session they spend on a defect is a session they do not
   spend telling us something new.
2. **A thing everything else stands on comes before the things that stand on
   it.** Faction correctness has to land before new hardware, or every new
   vehicle inherits the same defect and has to be revisited.
3. **Cheap and visible beats expensive and invisible**, when neither is
   blocking — a voice line lands in an hour and changes every fight.
4. **The Flagship spine is interleaved, not queued behind everything.** The
   player asked for both streams at once, twice.

---

## §0 — Answer the audit the player asked for

| # | Item | Source | State |
|---|---|---|---|
| 0.1 | **Audit the V3 list item by item.** The player asked by name: *"make sure that everything on that list actually got done… and let me know if we missed anything on it"* | V5 | ✅ **17 items, nothing missing.** 14 DONE with a measurement each, 2 PARTIAL (items 10 and 17 — now §8.1 and §8.2), 1 DONE with a named residue (item 7 — now §8.3). All three "do not regress" items hold. Three items were superseded by later lists and are flagged as such rather than counted done |
| 0.2 | **The Force shield / bubble.** Asked for in an earlier list and never built — confirmed: `POWER_COST` has push, pull, grip, throw, sense, lightning, stasis, heal, compel, rend, unleash, and nothing that shields | V5 | ✅ answered and then built — see 2.2 |

---

## §1 — Bugs the player has hit, in the build they are playing

| # | Item | Source | State |
|---|---|---|---|
| 1.1 | A dead duellist's blade hangs in the air instead of falling | V5 | ✅ `Enemy.die` drops it as a real prop, 2 in 5 still lit; `dropped.mjs` ×3 |
| 1.2 | **You fight your own side's canon hardware** — a Sith fighting Separatist walkers, a Republic player fighting clones. Applies to single NPCs as well as vehicles | V5 | ✅ measured 7 of 7 levels wrong; the enemy side is now the one you are not on. `factions.mjs` ×3 |
| 1.3 | **The Separatists ride Republic transports.** They need their own hull, functionally identical — sit or stand, see out, ramp, side doors, pilots | V5 | ✅ a Sheathipede-line hull with the same interior contract, plus a Providence overhead; `transports.mjs` |
| 1.4 | A recalled saber cannot be caught in the air even at closest approach | V5 | ✅ see 3.1 — it was 38 cm of arithmetic between two files |

---

## §2 — Cheap, visible, and it changes every fight

| # | Item | Source | State |
|---|---|---|---|
| 2.1 | **A line for every Force power**, 3–4 per power so it does not go stale, through the SYNTHESISED voice — the player never uses the spoken-words version | V5 | ✅ `Voice.js` `FORCE_LINES`, 12 pools / 41 lines, all through the larynx; `force-voice.mjs` measures every pair 18% apart in five throats |
| 2.2 | **The Force shield / bubble** (see 0.2). A held bubble that stops bolts, costs Force per second, visible from inside and out | V5 | ✅ `Player.forceShield`, KeyJ / RB+↑. 18 to raise, 6/s to hold, 4 a bolt, regen paused. Bolts die on the SURFACE; a muzzle inside the radius still shoots you; blades come through at 65%. `barrier.mjs`, 5 checks |

---

## §3 — The saber as an object you can put anywhere

| # | Item | Source | State |
|---|---|---|---|
| 3.1 | **Catch a recalled saber out of the air**; and get staggered into dropping it when you are hit with no stamina | V5 | ✅ the pick-up measured to the FEET while the grip clamps to 1.4 m off the CHEST — 1.98 m against a 1.6 m reach, out of range for ever. `hiltDistanceSq` measures to the standing axis; reeling in with an empty hand auto-catches. Disarm at <12 stamina on a >14 blow, never on a fall, never twice in 6 s. `telekinesis.mjs` |
| 3.2 | **Fly the saber with the Force** — lift it, ignite or retract it remotely, and steer it around the battlefield within a radius, at a heavy Force cost | V5 | ✅ two ways. A gripped hilt lights on the ignite key (10 to strike, 9/s to hold) and CUTS on the blade, one cut per 0.4 s; and your own thrown blade takes a third state, `piloted` — press grip in flight and it hangs at the reticle until you recall it or the bar runs dry. `telekinesis.mjs` |

---

## §4 — Faction truth, then hardware

Ordered deliberately: 4.1 first, or every giant built in 4.2 inherits the
defect and has to be revisited.

| # | Item | Source | State |
|---|---|---|---|
| 4.1 | Every archetype and vehicle carries a canon faction, and the composer never fields one against its own side (= 1.2) | V5 | ✅ see 1.2 — all 31 archetypes were already sorted; nothing asked whose side the player was on |
| 4.2 | **The giants.** SPHA (140.2 m, 12 legs), HAVw A6 Juggernaut / Clone Turbo Tank (49.4 m, 10 wheels), Octuptarra Magna Tri-Droid, AT-TE (check the one we have is right), NR-N99 Persuader snail tank. Each accurate, each moving and firing differently. Research what else we are missing. No AT-AT/AT-M6 — wrong era | V5 | ✅ four new machines at their canon dimensions, each with a weak point you can aim at that is derived rather than typed; the AT-TE measured against its own plates |
| 4.3 | **Drive the vehicles it makes sense to drive**, contextually | V5 | ✅ `crew` on the archetype is the whole rule — the AT-TE (6), the AAT (4), the Juggernaut (12) and the SPHA (25); the four droid vehicles have nobody in them and are refused by name. Yours any time, the enemy's under 25%. The machine stays an ordinary `Enemy`: own legs, own grade, own gun, own death. `driving.mjs`, 6 checks |
| 4.4 | The Separatist transport (= 1.3) | V5 | ✅ see 1.3 |

---

## §5 — The support calls

| # | Item | Source | State |
|---|---|---|---|
| 5.1 | **Rename them.** "Stratagem" is Helldivers'. Find our own word and make sure nothing in game says stratagem — every string, not just the code | V5 | ✅ **support calls**. Every rendered string swept, the last being the bindings row; the action id, module and DOM node keep `stratagem` deliberately — it is the key a rebind is saved under |
| 5.2 | **Many more of them**, unlockable through a run, deadly or genuinely useful, and none of them puny | V5 | ✅ eighteen calls, eleven of them released along a ladder inside one run; the Codex prices them in SUPPORT, which is the currency the game actually charges |

---

## §6 — The Flagship, interleaved

`FLAGSHIP.md` §14's kill tests have been RUN. `NEXT.md` carries the verdicts and
they change what to build; read it before starting anything here.

| # | Item | Source | State |
|---|---|---|---|
| 6.1 | §14 Step 0 — crater persistence | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.2 | §14 Step 1 — the marching front | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.3 | §14 Step 2 — the Dead Jedi test | Flagship | ✅ run; verdict in `NEXT.md` |
| 6.4 | §14 Step 3 — the Puppet Line: 40 inert bodies on a hand-authored 60-second timeline, no AI. Isolates whether the OUTPUT reads as a battle | Flagship | open |
| 6.5 | §14 Step 4 — **L2, the merged rigid-skin rung.** The single highest-value engineering item: 42 bodies = 1,040 draw calls today, 394 with it | Flagship | ✅ built. Measured, not taken: 42 mixed bodies at 100–154 m on geonosis cost **1,064** and cost **194** with it — 5.5×, where the estimate promised 2.6×. `src/game/MergedSkin.js`; bound by `frame-budget.mjs` §6 |
| 6.6 | §14 Step 5 — L3 instanced cohorts past 140 m | Flagship | open |
| 6.7 | The mode itself, after the rungs above | Flagship | open |

---

## §8 — Open, found by audit rather than by the player

Neither of these is on a list. Both came out of auditing the V3 list against the
shipped code, and they are here so they are not lost.

| # | Item | Found by | State |
|---|---|---|---|
| 8.1 | ✅ **Crossing a felled trunk is not finished.** The climb works — a body gets onto a log and stalls there. On the pinned deck, 24 ten-second walks in the wood: 71 stalls, 21 of them logs, worst 4.22 s against wood 0.85 m high with the body's feet ALREADY at that height. One attempt at a fix (widening the support sample for a climbable box by 0.25 m) made it worse — 71 stalls to 88 — so it is open rather than half-done | V3 audit | ✅ **and it was never the climb.** The body on the log is grounded, not climbing, its support query answers with the log's own top and its velocity leaves `_collide` untouched — what cancelled the walk was the SHOVE. `Player._collide` tested dynamic props as a SPHERE of `boundingRadius`, the half-diagonal of the prop's box, so a realised 12 m trunk pushed the body radially out to six metres of nothing: 0.0552 m of walk against 0.0551 m of shove on the stalling frame. Resolved against the prop's own box (`extent`, the shape `topOfProps` already reads): **71 stalls → 50, logs 21 → 15**, the 4.22 s log stall gone, seconds-stopped 53.3 → 31.6 s of 240, and both walks that never made 4 m now get out. Guard: `standing: a felled trunk is a log, not a six-metre bubble`, red at 5.30 m on the parent |
| 8.2 | ✅ **Muster-anywhere is wired everywhere and is thin.** Three gaps, named by `muster.mjs`'s own header and confirmed: you cannot compose the contingent (it is `opening` bodies of the cheapest rung); allies are always the side your ORDER names, so the Wood and the Drifts get a Republic platoon whatever the ground is; and on small ground `deploy` silently drops men — four asked, two placed on the Colosseum | V3 audit | ✅ compose the contingent, name the army, and ground that takes them |
| 8.3 | ✅ **The first-person wrist BEND is still unfixed.** The roll was fixed — palms agree at 0.65, up from −1.00, thumbs both up the blade — and the check names the residue itself: "the wrist reaches 114.4° from rest, down from 179.7". If the player says the hands still look wrong, this is where it is | V3 audit | ✅ **the cure was the ELBOW, which is not where either note said to look.** Both the ratchet's and `_rollForearm`'s said it had to be SaberController's guard model. It is not: once the hilt fixes the shoulder and the wrist, a two-bone solve still has one free parameter — the elbow's swivel — and the pole choosing it was built entirely from where the hand sits relative to the CHEST. `Player._wristPole` bends that pole toward the elbow a straight wrist implies, capped and rate-limited (`ELBOW`, swept by `tools/_wristsweep.mjs`). **114.4° → 89.4° worst, 83.6° → 36.7° median**, first person 124.2° → 115.8°, and the forearm ratchet improves too (2487 → 2476 °/s). The residue is geometry: the hand's long axis is pinned exactly ⊥ to the blade, so the floor is \|90° − θ\|, and the worst frame is a thrust at θ = 3.1°. The tempting cure — an oblique bore — is refuted at 2.9° by `tools/_bore.mjs` against `buildHand`'s own fingers |
| 8.4 | ✅ **The blast-door suite flaps.** 7 passed / 2 failed at HEAD, with different failure text nearly every run, before and after any change. Pinning the module RNG streams did not settle it; the remaining suspect is that a suite's checks run concurrently over shared module state. The door's own breach rule was changed on top of this and is therefore UNVALIDATED against the twenty seconds | this session | ✅ and the cause was neither. `Destruction._prepare` does as much pre-fracture as fits in `prepareBudgetMs` of REAL TIME per frame, and `Structure.bladeCapsules` publishes a different contact set once cells exist — so the frame the revetment finished pre-fracturing, a fact about the machine, moved every number. Pinning the budget and freezing `performance.now` each make the drive bit-identical; the bench pins it. The closed-loop rule was then measured at **0 enclosed area on all 24 samples** and deleted — a blade across a plate lays a bar, not a line. Area rule, `MELT_AREA` 0.34 m²: tight 19.1 s · natural 18.8 s · wide 21.7 s, five byte-identical runs |
| 8.5 | **A felled trunk near enough to walk on gives no floor.** Found while closing 8.1 and left open on purpose. `topOfProps` answers `position.y + extent.y` with no regard for which way the body is turned, so a 12 m log lying flat claims to be 6.55 m tall and is rejected as a wall at every foot height — measured, feet at 0.00/0.70/1.00 against wood topping out at 1.10 gives 0.00/0.70/1.00. Every trunk inside `LIFT_RING` of its stump is a Prop rather than a static box, so this is every log near a player. The fix is a shape question, not a line: a body has a centre, half-extents and a quaternion, while `Enemy.platform()` hands back `position` at the FEET with `extent.y` as the height above them and no orientation. `Player._supportAt` already calls the function twice, once per kind, so the seam exists | 8.1 | open |

---

## §7 — Standing rules that outrank any item here

- **No completely indoor levels, ever** (`FLAGSHIP.md` §4). An interior may be a
  bunker you breach on an outdoor field.
- **Do not regress what the player likes**: the overhead attack; the engagement
  with your own troops; the outdoor levels.
- **Every list is logged verbatim in `PLAYTEST.md` before any work starts.**
- **A finding from someone playing the game outranks any measurement taken
  without a person at the controls** (`HANDOFF.md` §7).
