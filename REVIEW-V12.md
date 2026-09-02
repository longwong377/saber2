# REVIEW — V12, the whole game read cold

The player asked: *"other than the hangar, the rest of the game has been
almost entirely made by Opus 5. I want you to go through the entire game and
let me know all the improvements you can think of, big or small, and what you
would do to update/change them (make sure to not ruin the game by mistake
because gameplay-wise it's in a pretty good place)."*

This is that pass, made on 2 Sep against the V12 tree by reading the player's
own notes first and then the code by subsystem. Every item cites a file and a
line that was opened. ★ marks the ten I would do first. Nothing here is built;
it is the list to pick from. Items 30 (friendly avoidance of a called
stratagem) and 14's first half (the ward and Restore) were being built in the
same session and are marked where they land in PLAYTEST.md.

Read: `PLAYTEST.md` (V12→V6), `SCOPE.md`, `DESIGN.md`/`ROADMAP.md`/`NEXT.md`/`BACKLOG.md` headings and status tables, then sampled the code by subsystem. Everything below cites a line I actually opened. ★ = the ten I would do first.

## Look and lighting

1. ★ **[Lighting] The fog is the wrong colour on every level** — `hazeRadiance` takes ~88% of haze hue from the drawn Preetham dome, so Geonosis' authored `fogColor #d0a473` (hue 26°) renders at hue 207°, a cold blue-grey (`src/engine/Engine.js:1256`, applied `:2330`; measured in `NEXT.md` Step 1) → turn dome, fog and aerial tint together per level with a `skyTurn` per `LEVELS` entry; **med** (touches all seven theatres, but it is the single biggest visual defect in the game and it is already measured).
2. **[Sky] `uSkyTurn` is held at identity on purpose and nothing overrides it per level** — `src/engine/SkyDome.js:110` → give each level one hue-rotation number, defaulting to today's identity so six levels are byte-identical while Geonosis and Mustafar get their own air; **low**.
3. **[Cel] The smoke banding fix landed but the ground/air value gap is still authored per level, not derived** — `src/world/Scenery.js:4336` → derive haze luminance from the level's own dust `gain` so a new theatre cannot ship mismatched; **low**.

## Controls and onboarding

4. ★ **[Bindings] The stratagem key is CapsLock, held** — `src/engine/Bindings.js:519`, and `Input` has no special case (`src/engine/Input.js:168-179`): CapsLock is an OS lock, browsers on macOS pair keydown/keyup with the lock state, so "hold Caps and spell" is unreliable off Windows → default it to a free normal key (`KeyV`) with Caps kept as an alternate chord; **low**.
5. **[Bindings] Two of the five attacks live on the mouse wheel** — `attackOver: WheelUp`, `attackStab: WheelDown` (`src/engine/Bindings.js:256-257`); a trackpad emits a burst of wheel events per gesture, so one flick can fire several overheads → keep the wheel as an alternate and put the pair on a modifier + LMB; **low**.
6. **[Bindings] Slow walk sits on `KeyI`, and the file admits it** — "the one row in this table deliberately placed where the hand is NOT" (`src/engine/Bindings.js:200-210`) → make it a toggle rather than a hold so the reach costs one tap, not tens of seconds; **low**.
7. ★ **[Training] Ten lessons and all ten are the blade** — feel/block/deflect/return/perfect/cut/parry/chamber/lock/sandbox (`src/game/Dojo.js:133-240`); nothing teaches the fifteen Force keys, the order wheel, a stratagem code or driving → four more lessons on the same `check` shape (a push, a grip-and-hurl, one order + rally, one five-key code); **low**.
8. **[Force] Fifteen Force actions on fifteen literal keys** — `src/engine/Bindings.js:340-373` → reuse the existing `RadialWheel` (`src/ui/HUD.js:659`) for a Force wheel, keys kept as the expert path; **med**.
9. **[Command] Eight formations on eight literal keys *and* a wheel** — `Digit6…Digit0, Minus, Equal, Semicolon` (`src/game/Command.js:1884-2244`) → keep the wheel as primary, cut the direct keys to three player-chosen favourites; **low**.

## The blade

10. **[Combat] A DEFLECT pays exactly what a BLOCK pays** — `GRADE_DAMAGE = [1.0, 1.0, 1.5, 2.5]` (`src/game/Combat.js:972`) and the only other difference is `GUARD_COST.stamina` (`:1037`), so rung two of a four-rung ladder is invisible → give DEFLECT a small stamina refund or a Flow tick so all four rungs are felt, not just seen; **low**.
11. **[Combat] One `assist` number serves two schemes and the file says 0.65 is where they *meet*** — `src/game/Combat.js:60-110` → split `DIFFICULTY.assist` into `zoneAssist`/`aimAssist` columns so directional and free aim can be tuned apart; **med**.
12. **[Blade] A missed parry costs nothing** — `PARRY = { window: 0.20, cooldown: 0.28 }` (`src/game/SaberController.js:291`), so parry can be held down as a metronome → charge a small stamina fee on a parry that catches nothing; **low-med** (it is the one input that could make the duel game trivial).
13. **[Blade] The authored attack set is richer than the buttons reach** — OVERHEAD/SPIN/SLASH/HEAVY/CHARGE all exist (`src/game/SaberController.js:303-630`) but only `thrust` is on a mouse button (`Bindings.js:249`) → an attack rose on LMB + movement direction, mirroring the guard rose; **med-high** (touches feel — prototype behind a setting).

## Force powers

14. ★ **[Force] Ward, Restore, Mend and "nearest wounded" cannot see a co-op partner** — all four walk `world.enemies` only (`src/game/Player.js:9221`, `:9356`, `:9567`, `:9242`), and `RemoteAvatar.heal()`/`addFlow()` are empty (`src/net/Net.js:945-946`) → one `alliesNear()` helper that unions `world.players`, and give the avatar a real `heal`; **low**.
15. **[Force] The barrier and the ward do not cross the wire at all** — stated in place at `src/game/Player.js:9350` ("a peer sees a trooper stop taking damage and not the bubble") → one bit on the 24 Hz avatar packet (`Net.js:948`) and a sphere on the remote side; **low**.
16. **[Force] Unleash is a 360° shove that your own line does not feel** — `UNLEASH = { radius: 11, impulse: 34, damage: 30 }` (`src/game/Player.js:639`), and `SCOPE.md` §1 names this as the highest-leverage change in the document → let it shove friendlies (knockback and a stumble, no damage) as the cheap first half; **med**.
17. **[Force] Lightning has no environmental rule** — 22 m, 3 chains, `LIGHTNING_REACH 6.5` (`src/game/Player.js:862-876`), no interaction with water or contact armour → arc further through the drowned forest's standing water; **low** (one multiplier off the surface query already used by footsteps).
18. **[Force] Restore's 75 s cooldown is invisible until you press it** — `RESTORE.cooldown` (`src/game/Powers.js`, applied `Player.js:9555`); the refusal is a toast → put the two long cooldowns (restore, ward) on the power strip as sweep timers; **low**.

## Enemies and duels

19. ★ **[Enemy] The brain allocates three vectors per body per frame** — `this.toTarget = _v1.clone()` (`src/game/Enemy.js:6299`), `this.wish = wish.clone()` (`:6476`), `:6508`, `:6853`; at 50 bodies that is 9,000 Vector3 a second of pure garbage → allocate both fields once in the constructor and `.copy()` into them; **low**.
20. **[Enemy] `capsules()` mints fresh capsule records every call** — `src/game/Enemy.js:4022-4097` (the array is reused, the entries are not), and the bolt loop calls it per surviving body per bolt (`src/game/World.js:5620`) → pool the records per body and version them on the pose; **med**.
21. **[Duel] Five forms against eight duellist rungs** — `FORMS` (`src/game/Duel.js:422-470`) versus `duelRoster`'s ladder → the ladder repeats a form twice before the master; a sixth form (Niman: mixes a Force shove into the string) is data plus one arc; **med**.
22. **[Nerve] A broken hostile has no legible tell** — `NERVE` writes `Enemy.nerve` (`src/game/Nerve.js`), and nameplates are drawn only for your own side (`src/ui/HUD.js:1600` skips other sides) → a posture/audio tell on a broken hostile, so "walk in and it comes apart" is visible; **low**.
23. **[Enemy] Archetype `preferred` bands still drive every non-duellist** — `src/game/Enemy.js:6420-6430` → give the four ranged archetypes their own stand-off the way forms now own duellists'; **med**.

## The army

24. ★ **[Command] The bleed-out window is The Line's only** — `downed: true` on one mode (`src/game/Waves.js:647`), read once (`src/game/Command.js:5056`); in Command — five areas, named men, permadeath — a man simply dies → turn it on for Command and Skirmish; **med** (it lengthens fights; tune the window).
25. **[Command] The six objective sites and the fire missions are one mode only** — `objectives`/`fireMissions` (`src/game/Waves.js:613`, `:631`; `World.js:1081`, `:1169`), deliberately, because Command has no quorum to price them against → give Command a cheap equivalent price (a crewed site costs that squad's order slot) and the richest system in the game triples its reach; **med-high**.
26. ★ **[HUD] `setTarget` has no caller anywhere in the tree** — `src/ui/HUD.js:2113`, and `_paintOrderSub` (`:2119`) reads a `_target` nothing writes, so the "▸" line can never appear → wire it to a *focus fire* verb on the order wheel: the army shoots what your reticle is on; **low** (the UI half already exists).
27. **[Command] Fire discipline is one bit** — every formation declares `fire: 1` and only `holdfire` declares `0` (`src/game/Command.js:1886-2244`) → make it graded (`0.5` = hold until inside 25 m) so "volley" and "at will" are different orders; **low**.
28. **[Command] The selected squad is only ever text** — the wheel caption and the order sub-line (`src/ui/HUD.js:901-925`, `:2119`) → tint the selected squad's nameplates and minimap dots; **low**.
29. **[Command] `_frame`/`_squadFrame` allocate per call** — `new THREE.Vector3()` at `src/game/Command.js:8176`, `:8281`, `.clone()` at `:8638`, `:8694`, `:8855` → out-params, as the rest of the file already does; **low**.
30. **[Reactions] Grenades are the only thing worth reacting to** — the four answers all hang off a live grenade (`src/game/Reactions.js:28-60`) → a fifth trigger on a *called* stratagem site (your own men clear your barrage), reusing `Stratagems._visible`; **med**.

## Modes, run shape, progression

31. ★ **[Levels] One campaign, two missions** — `CAMPAIGNS.petranaki` (`src/game/Levels.js:5188-5248`), and the theatre picker offers exactly one card because it matches on mission zero (`:5264`) → a second campaign is pure data across grounds that already exist (drifts → alpine → scoria); **low** and it is the cheapest content in the repo.
32. **[Session] No route choice** — `SESSION_PLANS` rolls a length and `planStages` walks `AREAS` in order (`src/game/Session.js:61-95`) → offer two nodes with visible type and unknown contents before each engagement, drawn from `CONDITIONS` (`Waves.js:1874`); **med** (`SCOPE.md` §4's first absence).
33. **[Progress] There is no way to suspend a run** — the only writer is the record store (`src/game/Progress.js:204`), and a Grind is five engagements / 30-45 min (`Session.js:88`) → serialise the run bag (seed, stage, roster, crater log) behind an explicit "stand down" that costs something; **high** (do not weaken `keep()`).
34. **[World] The ground forgets between sittings** — `craterLog` is built per world and trimmed to `SESSION_MEMORY = 900` (`src/game/World.js:1129`, `src/world/CraterLog.js:306`), never serialised, though `NEXT.md` Step 0 proves the replay is exact and costs 15.8 kB → persist per (campaign, ground) in the store that already exists; **med** (`SCOPE.md` §3, and nobody has shipped it).
35. **[Waves] Trial and Path differ in one field** — `drafts` (`src/game/Waves.js:198-215`), with the ramp derived from it → the Trial's differentiator should be visible on the mode card as a *rule you can read on the HUD*, not only in the blurb; **low**.
36. **[Modes] Three of eight modes are honestly deaf to run rules** — `fixedRules` on duel/sandbox/training (`Waves.js:~130`, `:299`, `:390`) → give the duel at least one rule that can apply (a blade condition), so the picker is not greyed for a third of the menu; **med**.

## The flights and the flow between runs

37. ★ **[Flow] It is roughly fifty seconds from Deploy to the first enemy, every run** — deck seal 1.6 + lift 2.6 + run 5.2 + out 11.0 (`src/game/DeckFlight.js:80-113`) then the insertion's twelve phases (`src/game/Extraction.js:357-370`, `TRANSIT = 11`, `:324`) → make the deck run-out answer the same skip key the cruise does, and remember "I have seen this" per session; **low** (do not delete the sequence — it is the thing they asked for).
38. ★ **[Settings] `instantSpawn` is labelled "Instant arrivals" and secretly also skips the hangar and the whole insertion** — label at `index.html:1028`, hidden second reader at `src/main.js:1052`, third at `src/game/Extraction.js:695` → split into `instantArrivals` and `skipDeparture`, each labelled for what it does; **low**.
39. **[Extraction] The skip key is never taught** — gated on `_rotated` and 1.5 s (`src/game/Extraction.js:2149`, `:1098`) with no prompt → a one-line "hold [Space] to press on" on the flight HUD after two seconds; **low**.
40. **[DeckFlight] A landed hull spins up and lifts; it never taxis** — `PHASE` has no taxi step (`src/game/DeckFlight.js:117-120`), flagged ⚠️ by the team's own V11 note → a 3 s roll to a launch mark before `lift`; **low** polish.
41. **[Arrivals] Three concurrent arrivals cap the spectacle** — `MAX_CONCURRENT = 3` (`src/game/Arrivals.js:280`) against waves that peak near 48 hostiles → let the cap scale with the quality tier so "the giant battle" can land in one shot; **med** (frame budget).

## HUD and menus

42. **[HUD] The score is re-formatted every frame** — `toLocaleString()` at `src/ui/HUD.js:2312`, plus a dozen template-literal `style.transform` writes above it (`:2250-2270`) → write on change only; **low**.
43. **[HUD] Nameplates do per-frame work for the whole roster even in `aimed` mode** — the `live` array and a DOM node per living trooper are built before the mode is consulted (`src/ui/HUD.js:1602-1630`) → resolve `aimed` first and early-out; **low**.
44. **[HUD] Minimap range is a fixed 42 m** — `MINIMAP = { range: 42 }` (`src/ui/HUD.js:293`) on grounds hundreds of metres across → two zoom steps, or scale with the mode's frontage; **low**.
45. **[HUD] Hitmark labels churn DOM** — a `div` per hit, capped at 26 (`src/ui/HUD.js:3145-3152`) → recycle a fixed pool of 26 nodes; **low**.
46. **[Menu] `Menu.js` is 10,535 lines in one class** — every tab, the parade, the barracks and the wiring table (`src/ui/Menu.js:1013-1148`) → split the barracks/parade tab out; **low** risk, purely maintenance, but it is the file most likely to gain a defect next.
47. **[Engine] There is no adaptive resolution** — `setResolutionScale` is a manual slider only (`src/engine/Engine.js:2562`, `src/main.js:278`), while the profiler already computes a 1% low (`HUD.js:3185`) → drive the scale off the 1% low with hysteresis; **med** (the player has twice reported sub-10 fps).

## Audio

48. **[Audio] Three music rows and only one real file, a single 28 MB mp3** — `MUSIC_TRACKS` (`src/engine/Audio.js:214-222`) → split it per `assets/music/README.md` into segments so the score can cut on a wave clear instead of streaming one blob; **low**.
49. **[Audio] The per-room reverb is set from a room key, not from what is over your head** — `setRoom`/`_makeImpulse` (`src/engine/Audio.js:3334-3343`) → drive it off the same overhead raycast the shoulder camera already does (`Player.js:2091`) so the colosseum's undercroft sounds different from its sand; **med**.
50. **[Voice] Force lines are 12 pools / 41 lines and every one is the player's** — `FORCE_LINES` (`src/engine/Voice.js`) → the men should answer the big ones ("he's got them!"), reusing `Announcer.say`'s existing gap budget (`Announcer.js:79`); **low**.

## Co-op

51. **[Net] A guest cannot drive anything** — refused by name (`src/game/Driving.js:139`), honestly, because the seat is not replicated → replicate three floats (throttle, steer, gun heading) and let the host drive the hull; **med**.
52. **[Net] A guest cannot be revived, healed or warded** — see item 14; also `RemoteAvatar` has no morale/nerve, so `MORALE.NEAR` never counts a partner (`src/net/Net.js:674-950`) → give the avatar the two fields the aura reads; **low**.
53. **[Net] Peer timeout is 8 s with no reconnect** — `PEER_TIMEOUT` (`src/net/Net.js:39`), `_dropPeer` (`:245`) → hold the seat for 30 s and let the same code rejoin into it; **med**.

## Physics, world, destruction

54. **[Physics] `maxBodies` defaults to 1100 and a corpse is nineteen bodies** — `src/game/World.js:386`, `src/game/Corpses.js` header → the budget is right but the failure mode (silently refusing a body) is invisible; surface it in the perf box; **low**.
55. **[Corpses] The corpse budget is 6/12/20/28 by tier** — `CORPSE_BUDGET` (`src/game/Corpses.js:198`) against waves that peak near 48 → the sink into `FallenField` already covers this well; the remaining gap is that a *sunk* corpse loses its severed limbs, so a butchered body tidies itself; **low**.
56. **[Destruction] Net rubble is capped at 48 and drops silently** — `NET_RUBBLE_MAX` (`src/world/Destruction.js:94`, enforced `:2714`) → in co-op the guest's ruin diverges from the host's with no reconcile; send a periodic "these walls are down" digest; **med**.

---

## What I would not touch

The blade is finished work and every layer of it is load-bearing: `SaberController`'s zone rose and `Combat`'s graded deflection are tuned against measured tables (`Combat.js:60-230`), the parry's two rungs and the blade lock (`Duel.js:1280-1381`) already do the thing most games in this genre fake, and the difficulty ladder's four assist values were re-spaced against a real harness — moving any single number there will look like an improvement and will land as a regression. Leave the Force economy alone as well: `Powers.js` is the one table both the spender and the HUD read, and the whole reason the wheel no longer lies about what you can afford. The army's brain — `Nerve`, `Morale`, `Reactions`, the token ring in `Enemy._think` (`:6390-6415`) and the eight formations' leash spread — is the best-argued code in the repo and is what makes a fight of forty read as forty; the same goes for `Corpses`' worth-based budget and its sink into `FallenField`, which solved the frame problem without emptying the battlefield. The hangar, the deck cast and the insertion are the player's own asks and they are landed; the fix there is the *skip*, never the content. And do not reopen `keep()` or the muster: permadeath plus the pre-run slate is the emotional spine of the whole thing, and item 33 must be built around it rather than through it.
