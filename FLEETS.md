# THE FLEETS — raw findings, preserved

Six fleets, 82 agents, 2 Sep. Three ran to completion (feasibility, archaeology,
red team) and their findings are argued in SEEN.md. Three were stopped mid-run
when the V13 list arrived. This file is what they had produced by then, kept so
that nothing is lost and nobody re-runs them.

## The invention field — 27 concepts from 9 of 18 lenses

Stopped after the ground pass and half the lenses. Each is a title and the
one line a player would repeat.

**Lens — Build only from capabilities that already exist and that nothing currently reaches. I read the tree for the largest cohe**

- **Meeting Engagement** — There is a general on the other side, he actually gives orders, and the only way the battle ends is one of you reaching the other through both armies.
  - loop: Your hands do three things on a rotation of about thirty seconds. The order wheel and the reticle: hold, delegate a squad, dig in, charge, fall back to me — and now for a reason, because the shape opposite you just changed. The blade and the Force in the ten metres actually in front of you, which is where you personally are worth anything. And the support codes when the front bends. Running under 
  - isolation: It never touches MODES.versus. The human meeting keeps alwaysVersus and its own path; the new row declares its own field and World opens the adversary from it, so a co-op meeting is byte-for-byte what it is today. Every reader in Command.js is already field-driven and every one o
  - touches: src/game/Waves.js — one MODES row, src/game/World.js — one call site beside beginVersus that seats the adversary instead of waiting for a second human; _matchTick unchanged, src/game/Command.js — census() gains one clause so a commander's avatar may be an Enemy body (c.avatar) as well as a Player, which is what VERSUS_WINS.commanders needs to count a general who is not a person. Nothing today sets `avatar`, so no existing mode moves, src/main.js — the deploy branch, and one row in the TAKEN label map at 1945 (a ninth mode that reports a count gets a plausible WRONG noun otherwise, not a missing one), src/game/Progress.js — RECORDED, checks: modes.mjs, progress.mjs, endings.mjs, runrules.mjs
- **The Burning Deck** — The hangar you fly out of every run is the level this time, and it is the one that is dying — there are ten seats on the transport and twenty-four men on the deck.
  - loop: Fighting with the blade in cover you already know by heart — the crates, the pit kerbs, the cradles, the bulkhead, the gallery at thirty metres. Giving standing orders on the deck's own wheel: hold the pad, hold the lobby, fall back to the ramp. Shoving droids into the failing field, which already rings and flashes for any body that crosses it above five metres a second. Melting a blast door with 
  - isolation: A second LEVELS key, never a second mode on level: 'hangar'. Player.hosting and World.loadLevel's hangar early-return are both keyed on that exact string literal, so the flight deck keeps its refusal table and its directorless world untouched, and the new room gets a normal comba
  - touches: src/game/Levels.js — one new LEVELS key reusing dress: dressHangar with its own pool and its own orbit block, deliberately kept out of LEVEL_ORDER exactly as HANGAR_LEVEL is, with battlefield: false, src/game/Waves.js — one MODES row declaring level and insertion: false (you are already aboard), src/game/Hangar.js — one assignment writing world._deckProps, and the teardown: HangarDirector.dispose is the only thing that unwinds the audio graph, the lift colliders, the flight, the mirror, world.floorAt and every Shovable on the deck, so this mode reuses it or adds a matching undress, src/game/World.js — one line so Boarding gets a per-frame tick (or none, if it rides world.props, which five systems already do), src/main.js — TAKEN label; hangarFirst already declines on insertion: false, src/game/Progress.js — RECORDED, checks: hub.mjs (its 'a fighting mode skips the deck' list is three literal names and must be widened), hangar.mjs, modes.mjs, progress.mjs, endings.mjs
- **The Column** — Your lightsaber does almost nothing to what is coming at you — so you take its legs off, climb on, and turn the gun round.
  - loop: A minute of it: cut through the screen, which is real bodies in quantity and exactly what a sword is for. Read which machine is ranging your line and spell the code that opens it — the mass driver for a walker, the ion pulse for a droid giant, the bombardment for something with legs — then hold the mark while a craft flies a real path to it. Take legs off with the blade, because severance is count
  - isolation: Every machine already exists as an ordinary archetype and already arrives, marches, plants, shoots, is cut, topples and dies with no mode's knowledge of it — the entire mode is reachability plus one rule. The one genuinely global thing it wants is settings.stratagemOnly, and this
  - touches: src/game/Waves.js — one MODES row (DRAFT_MODES untouched), src/game/Levels.js — pool data only: conscript on one more ground to light the levy, machine keys on the grounds the mode plays, and one saddle: field to put riders on a walker, src/game/World.js — one line so the mode declares the armour rule for its own duration off its MODES row, read at the single existing site, rather than by writing the persisted global, src/main.js — TAKEN label; src/game/Progress.js — RECORDED, checks: modes.mjs, progress.mjs, roster.mjs (pool edits, policed in both directions already), escalation.mjs, frame-budget.mjs

**Lens — Only what the player asked for in his own words, in PLAYTEST.md, more than once, and never received. I read PLAYTEST.md **

- **Pitched Battle** — The other side has a general too — and from the ridge you land on you can see his entire line forming up against yours.
  - loop: Read the line at two hundred metres through the dust: where is it thin, which of the four installations is he crewing, where is his anchor walking. Give your squads ground on the order wheel — they hold it without you, because a planted squad order survives your leaving (`_squadFrame`). Then run 150 m and go and be worth a hundred men at one point: you are not killing forty, you are killing the si
  - isolation: Every field it declares is read as `MODES[mode]?.x` at one or two sites that already exist, so no shipped mode's behaviour changes by a byte. The General owns only bodies it adopts, through the instance-wrapper seam Enemy.js was built to expose (`installCommand` wraps `_move` on 
  - touches: src/game/Waves.js — one MODES row (`battles`, `generatedGround`, `objectives`, `downed: 0.6`, `levy`), and one string in `Levy.levies()`'s source of truth, src/game/Levy.js — one clause: `|| MODES[director.mode]?.levy` beside the existing `pool.includes('conscript')`, so the levy lights without editing any level's pool (adding `conscript` to a pool would silently drop 40 free bodies into every crossing on that ground), src/game/World.js — one branch beside the existing `ObjectiveField` build at :1081 that constructs the General and the Pitch when the mode declares them, and a `world.onObjectiveFire` handler, src/ui/HUD.js — the front readout already exists for the meeting; widen its condition from `versus` to `director.front !== undefined`, src/game/Progress.js — `'pitched'` into `RECORDED`, src/main.js — one entry in the `TAKEN` label map at :1945 ('Ground held'), or the death card prints somebody else's noun
- **The Column** — You fight from the back of a walking gun, and when they take its legs out from under you, you finish the march on foot.
  - loop: Three postures and you swap between them constantly. ON it: standing on the deck (already supported — `Player._gatherNear` builds `_nearDecks` from `Enemy.platform()` and the note over it is the player's own bug report about falling through a walker), giving orders, cutting anything that gets close. IN it: `Crew` gives you tank steering, a turret on its own 2.2 rad/s clamped to a 0.85π arc, and th
  - isolation: Nothing here changes what a machine is: it stays an ordinary `Enemy` with its own hp, armour table, legs, gait and death, which is why you can be shot out of it and why its legs can still be cut off under you. `Crew` already borrows exactly four fields and restores them in the on
  - touches: src/game/Waves.js — one MODES row (`battles`, `generatedGround`, `downed: 0.6`, `armourRule`), src/game/Enemy.js — one line: the `STRATAGEM_ONLY` gate reads `settings.stratagemOnly || MODES[mode]?.armourRule`, so the mode can require the rule without writing a host-authoritative persisted global, src/game/Levels.js — machine entries into the pools of the two or three grounds the mode rolls, and `saddle` on the archetypes that carry men, src/game/Command.js — one rung added to EACH army ladder (`command.mjs` asserts they pair rung-for-rung by threat and that the totals stay close, and `LADDER_RUNGS` is the min of the two lengths, so both or neither), src/game/World.js — one branch that builds the Column and hands your machine to `enlistBody` on your side, src/game/Progress.js and src/main.js — `RECORDED`, and a `TAKEN` label ('Ground crossed')
- **Fighting Withdrawal** — You cannot win this one by killing anything. You win by how many of them get on the ship.
  - loop: Order the line back to the next position; it closes when the quorum is actually standing on it — that is `lineIsUp` run backwards, and it is the same code, because the rule is 'half the living inside `MORALE.NEAR` of where they were told to be' and it does not care which direction 'told' points. Then go and get the ones who did not make it: Restore stands the downed up inside 12 m for 70 Force on 
  - isolation: It adds no verb to the keyboard — the manifest rides the order wheel and the reticle, which is COMPANY.md's own one-input doctrine, and there is no free letter left anyway. `holdTheLine` and `lineAdvances` are already fields with one reader each and `theline.mjs` only asserts tha
  - touches: src/game/Waves.js — one MODES row (`downed: 1`, `holdTheLine`, `lineAdvances`, a `noMuster` field, no `crossing`), src/game/Extraction.js — one comparator: a named manifest sorts before `_queue`'s squared distance, falling back byte-for-byte to today's behaviour when nothing is named. Plus the second writer `Trooper.wounds` has been missing (its only writer fires solely where `downed` is declared), src/game/Command.js — the muster is refused for this mode where `musterPlan`/`_areaClear` already read the mode's own row (the same shape `solo` and `dojo` use to refuse the contingent slider), src/game/Company.js — one epitaph kind so LEFT and KILLED are different facts on the memorial; `MAN_FIELDS` is pinned by no check and this is explicitly legal, src/game/World.js — one branch beside the objective build that constructs the Withdrawal and the Billets, src/ui/HUD.js — the manifest list under the order wheel, using the existing `RadialWheel` and `HUD.TERSE` rather than a new panel or a new key, src/game/Progress.js and src/main.js — `RECORDED`, and a `TAKEN` label ('Men brought home')

**Lens — Invert the scale the game is played at — smaller (one trooper, one seat, one slot in a formation), vastly larger (a plan**

- **One of Ten** — You play the trooper. The Jedi is an NPC thirty metres away, and when you die you wake up as the next man on the roll.
  - loop: Move, aim, fire a real BoltPool round with your archetype's own spread, burst gap and damage. Listen: orders arrive as a voice with a bearing and your slot lights; you walk to it or you don't. Then the whole Reactions catalogue becomes your verb set instead of ambience — drag a downed mate (findCasualty/startDrag), take a dead man's heavier rifle and really inherit his attackDamage (findRifle/star
  - isolation: The three new pieces are all additive objects. The AI general calls the same public CommandDirector.order(id, cmdr, squad) the player's wheel calls, so nothing in Command.js changes and _ask writes nothing when it is asked. The rifle is a new file that calls BoltPool.fire, which 
  - touches: src/game/Waves.js — one MODES row (battles or crossing, downed, objectives, a solo-style flag so the contingent slider cannot double you), src/game/Progress.js:173 — RECORDED, src/game/Player.js — the body-builder fork at the two buildJedi call sites (:3121 and :11134), a guard on _makeCloak's unconditional this.palette.outer.clone() at :3566, and one _readInput branch, src/main.js:1945 — the TAKEN label map, src/ui/HUD.js — the slot and order readout (reuse setTarget rather than adding a panel)
- **Landfall** — You ride the lift up to the bridge, look at the planet you are invading turning in the viewport, choose where to put your men down — then walk back down, board the transport and be one of them.
  - loop: On the bridge: walk a real body under the shipped no-combat contract, and read three things you can read nowhere else in the game. The planet (configureOrbit derives land, highland, sea, ice line, cloud deck, terminator and city lights from the LEVELS record of the ground you are looking at, with a running fleet action behind it, for zero draw calls). The table (the landing sites, each carrying ga
  - isolation: The bridge is a second LEVELS key with its own director, its own dispose and insertion:false. It never builds a CommandDirector, so bank()'s permadeath fold — which strikes every deployed man not on a manifest — cannot fire in it; the deck's d.deck escape hatch is the precedent a
  - touches: src/game/Waves.js — one playable MODES row plus one hidden bridge destination, src/game/Levels.js — a LEVELS.bridge record on the warship preset, kept out of LEVEL_ORDER exactly as HANGAR_LEVEL is, src/main.js — onDeckLeave gets a destination; an enterBridge sibling of enterHangar, src/game/Progress.js:173 — RECORDED, tools/checks/hangar.mjs:343 — the assertion that exactly one mode is hidden
- **Relief Column** — A garrison forty minutes away is being overrun and you are the thing that has to get there — riding on the deck of an AT-TE that can have its legs cut out from under you.
  - loop: Ride: Enemy._measurePlatform walks the transformed vertices of the body bone, keeps the inner 60% of the footprint, takes the highest and returns the NARROWER half-span, so standing on a moving machine is answered by the same query as standing on a crate, and it bobs with the gait. Crew: Driving.Crew is a complete pilot model — tank steering, a turret at 2.2 rad/s inside a 0.85pi arc off the nose,
  - isolation: The column rides in world.props and gets its per-frame tick between physics and the draw — the same duck-typed contract Forest, Hazard, RiderPack, FlightPack and Crowd already ride, which is exactly why it needs no line in World.update. Every machine on it is an ordinary Enemy wi
  - touches: src/game/Waves.js — one MODES row (battles, generatedGround, downed, objectives), src/game/Levels.js — vehicle keys into two or three more level pools, which is the sanctioned door (roster.mjs already fails on an archetype no pool names), src/main.js:1204 — the battle-pick line is literally name-gated on settings.mode === 'skirmish', so a new battles mode silently takes skirmishConfig(null) defaults with the sliders lit and ignored; and the TAKEN label map at :1945, src/game/Progress.js:173 — RECORDED

**Lens — TIME AS STRUCTURE — three different grains of it. The Long Siege makes the PLACE the thing that persists across sittings**

- **The Long Siege** — Every sitting is one day of the same siege — your craters, your graves and your burn line are exactly where you left them, and you deploy at the metre you last stopped at.
  - loop: Command's fight, with the terrain reading inverted. You give orders on the wheel, you fight with the blade, you call support. What changes is that three verbs stop being tactics and become investments: DIG IN (FORMATIONS.digin -> Terrain.crater, which permanently deforms the heightfield and is already wrapped by CraterLog) leaves a position that is still there next sitting; BURY (FORMATIONS.bury -
  - isolation: Every mechanism it needs is already gated on `leadsArmy` and already constructed per-World with an adopt-if-present idiom — World.js:1129 literally reads `this.craterLog || new CraterLog()`, so a restored log is picked up with no edit. The siege store is a new file on makeStore, 
  - touches: src/game/Waves.js — one MODES row (name, blurb, battles, downed, level left open so the theatre column picks WHICH siege), src/game/Progress.js — one string in RECORDED, src/main.js — read the siege record and hand world.craterLog / world.graves / run.siegeDay in before loadLevel; bank the siege beside Company.keep; one TAKEN label ('Days held'), src/game/Command.js — one line: seed the engagement counter from run.siegeDay so marchTo lays the accumulated bands
- **The Other Side** — You lose the battle. Then you fight the same twenty minutes again from the other army, against a ghost of yourself doing exactly what you did — with the first telling's clock printed on your HUD telling you what you are about to do next.
  - loop: You are a Sith with a red blade leading a droid army — already fully supported by armyForOrder/opposingArmy, ARMIES.separatist.tiers, the order wheel and Commander. Your hands do what they always do: orders, blade, support calls. What is different is where your attention goes. A second strip on the HUD carries the first run's timeline off CommandDirector.log's own named beats (fell, order, area, d
  - isolation: The recorder is a `net`, so every line it runs through is already optional and already null-checked — _netTick is gated on this.net and has been since co-op shipped, and netMode stays 'host' so not one of the ~45 `=== 'client'` sites changes behaviour. The ghost is a RemoteAvatar
  - touches: src/game/Waves.js — one MODES row (needsSession absent; solo absent; it leads an army), src/game/Progress.js — one string in RECORDED, and one field on recent[] pointing at the record (not run state — a filename), src/main.js — attach the Recorder at deploy in recordable modes; one door on the death/victory card ('fight it from the other side'); the bank escape flag; one TAKEN label, src/ui/HUD.js — the timeline strip (one readout; HUD already reads world.command || world.orders and already has an unwritten setTarget line to sit beside)
- **Under the Fleet** — There is a real battle in orbit on a real clock, and about once every six minutes a capital ship dies up there — you get four minutes' warning, a bearing, and then seven hundred metres of burning hull comes down on the map.
  - loop: An army fight with a second reading always running. You are giving orders and swinging a blade, and part of you is watching the horizon, because SkyDome.battlePhase(t) is a pure periodic function with named phases and a named victim, and this mode makes the ground read it out loud: a hull is burning at t=160, it breaks at 228, its reactor goes at 236. What that becomes on the ground is a lit cloud
  - isolation: battlePhase is a pure exported function that nothing on the ground currently reads, so nothing on the ground can regress. Critically, this mode does NOT put the dome in orbit mode — uOrbit is exclusive (0 = sky, 1 = window) and switching it on a battlefield would take the sky awa
  - touches: src/game/Waves.js — one MODES row (battles, generatedGround, objectives, downed), src/game/Progress.js — one string in RECORDED, src/main.js — one TAKEN label, src/game/World.js — one construction line beside the objectives (:1081) and fireMissions (:1169) lines, which are the same MODES[mode].x && leadsArmy shape, src/ui/HUD.js — one readout: the sky line and the countdown

**Lens — Clone Wars fiction the game has not touched — Order 66, Umbara, a ship boarded, a rescue. I looked for the places where **

- **Hard Dock** — You fly your own transport into the enemy flagship's hangar, hold the mouth open, and land your whole army through the hole you made.
  - loop: Fight along a real place rather than a field: a 3.2 m pit with kerbs, a gallery at 30 m, a bulkhead with blast doors, a mirror floor, hung fighters overhead. You shove droids over with a lit blade (deckBladeTargets already publishes non-Enemy shove targets and reads `world._deckProps`, which nothing writes). You cut a bulkhead door open with the saber — melted by area, ~19 s, the one signature mec
  - isolation: It is a second LEVELS key, not a second mode on `level: 'hangar'`. Every one of the four traps in that area is keyed on a literal that cannot see the new key: `Player.hosting` tests `MODES[mode].level === 'hangar'`; `World.loadLevel`'s early return tests the same string; `bank()`
  - touches: src/game/Waves.js — one MODES row (`level: 'deckfight'`, `battles`, `objectives`, `downed`, `holdTheLine`, `insertion: false`), src/game/Levels.js — one LEVELS key reusing `dress: dressHangar`, deliberately kept out of LEVEL_ORDER (this is the documented route; a second mode on `level: 'hangar'` would silently inherit `Player.hosting`'s eight-power refusal table and World.loadLevel's early return), src/game/Hangar.js — export the install/teardown pair so a non-HangarDirector world can call it; write `world._deckProps`; HangarDirector.dispose is currently the ONLY teardown for the audio graph, the lift colliders, the flight and every Shovable on the deck, src/game/DeckLife.js — its eight module-level caches (FRAME, DROIDS, TRAFFIC, …) are computed once per process and never reset, and TRAFFIC bakes the first world's groundAt; they need a reset hook, src/main.js — bank()'s `d.deck` guard must NOT catch this mode (it wants permadeath and seals a real manifest); onDeckDeploy routes to the enemy deck instead of a planet, src/game/Progress.js — RECORDED, tools/checks/hangar.mjs — the 320-drawn-mesh bound and the exactly-one-hidden-mode assertion, tools/checks/hub.mjs:70 — asserts only sandbox/training/hangar skip the flight deck; `insertion: false` here fails it until widened
- **Good Soldiers** — Every engagement opens with an order from a general who cannot see the ground, and you can obey it with one keypress or walk out into the storm and find out it's wrong.
  - loop: An order lands at the top of every engagement: a grid reference, an estimate in High Command's own vocabulary ('a screen' … 'everything they have left'), and a window. You have three verbs and one of them is new. AUTHORISE — one key, pays support, moves their trust in you up. READ — walk out to the mark, twelve seconds at spotter range, four with Force sense open, and now you know what is actually
  - isolation: Every system it lights is already gated as `MODES[mode]?.field` and is off in ten of eleven modes; turning them on for a twelfth cannot change the eleven. The betrayal writes `team` on bodies that exist only inside this run, through `enlistBody`/`installTeamDamage`, which is the 
  - touches: src/game/Waves.js — one MODES row (battles, objectives, fireMissions, downed: 1, holdTheLine, and the lineAdvances decision below), src/main.js:1204 — `else if (settings.mode === 'skirmish')` is the ONLY place the five battle picks become a plan; a new `battles` mode silently takes skirmishConfig(null) defaults with the sliders lit and ignored, src/main.js:1945 — the hand-written TAKEN label map, which gives a ninth mode a plausible WRONG noun on the death card rather than a missing one, src/game/Command.js — one row registering STAND DOWN so it rides the existing order wheel (the keyboard is full; this must not claim a letter), src/game/Progress.js — RECORDED, tools/checks/fire-mission.mjs:115 — hard-bars any mode but theline from declaring fireMissions, by design; widening it requires stating this mode's price for a read, tools/checks/downed.mjs, tools/checks/modes.mjs, tools/checks/theline.mjs — all pin the single-mode flags
- **Left Behind** — Your company's casualty list already knows which men you left alive on the ground. This is the run where you go back for one of them.
  - loop: Deploy to the ground his record names — `fallen[].where` is stored, so the theatre column becomes the list of places you have lost men. Fight in. Get him up: Restore stands the downed, or the squad medic, or you shoulder him yourself. The moment you shoulder him your saber goes down, and that is a complete, checked state in this engine — the right arm drops to a mirrored rest pose, `handsOnHilt()`
  - isolation: It reads a field that already exists, is already sanitised on load, and is already produced by the shipped bank path — nothing else in the tree reads it. The one write into Company.js is the inverse of a strike that function already performs, on the same records, under the same c
  - touches: src/game/Waves.js — one MODES row (battles, downed, holdTheLine, a theatreVeto sentence: 'you have not lost anybody here'), src/game/Levels.js — theatresFor gains one case; the Theatre column becomes the grounds your company has lost men on, src/game/Player.js — one carry branch in _readInput beside the existing riding/driving/hosting branches, and one write of saberDown, src/game/Company.js — keep() gains a `recovered` list: a man moving from fallen back to men, which is the exact inverse of the strike it already performs, src/main.js — bank() passes `recovered` beside manifest/stranded; the TAKEN label map at 1945, src/game/Progress.js — RECORDED, src/ui/Menu.js — the memorial already renders and counts fate === 'left'; it gains a 'recoverable' tag on those rows, tools/checks/company.mjs — extend the existing suite rather than adding one; its six-word source scan (points/currency/purchase/upgrade/unlock/buy) is clean for this work

**Lens — Tension, dread and scarcity rather than power — darkness, limited sight, a thing hunting you, ammunition that runs out, **

- **The Long Walk** — Your transport went down behind their line, there is no army, and the Force keeping the wounded man in the air is the same Force you would need to fight with.
  - loop: You walk, slowly, through air you cannot see thirty metres through. You stop and spend 25 Force on Sense for five seconds of sight and it costs you five seconds of carry. You find a downed man crawling (`Reactions.crawlStep`, hardiness-scaled) — you grip him and he rides in front of you at about 14 Force a second. Something acquires you at twenty-two metres out of nothing and you have three answer
  - isolation: Every behavioural change is scoped to bodies this mode itself spawns: `installCommand` wraps `_move` on the INSTANCE, so the Stalker steers its own body and nothing in Enemy.js knows the difference. `setAir` is already set and cleared per level by the atmosphere path, so a thick 
  - touches: src/game/Waves.js — one MODES row (`solo:true`, `seedsGround:true`, `generatedGround:true`, `downed:2`, `hunted:true`) plus the `hunted` flag's doc, src/game/World.js — a fifth branch in `loadLevel`'s director dispatch (the same six lines the `dojo` branch is), and two build lines behind `MODES[mode].hunted` in the exact shape of the `objectives` line at :1081 and the `fireMissions` line at :1169, src/game/Progress.js — add the key to `RECORDED`:173, src/main.js — one row in the `TAKEN` label map at :1945 ('Men carried out'), and `stratagemOnly:true` as a `buildWorld` OVERRIDE at the deploy call site, never a settings write (the `enterHangar` precedent at :889), tools/checks — progress.mjs (RECORDED), modes.mjs (the TAKEN row), endings.mjs (it boots every mode and demands a run end); no edit to hub.mjs because the mode keeps `insertion` and routes through the deck like every fighting mode
- **Last Call** — Twenty-four men, ten seats, and the gunship can only come back twice — you write the manifest with your own hands while they are still shooting.
  - loop: You hold a shrinking perimeter with the order wheel — the real one, with `ORDER_REACH`'s 34 m and the four refusals and the runner. You read who is hurt, because a downed man cannot walk to a ramp: either two men go back for him (`Reactions.startDrag`, chance = bond × nerve, and that is two rifles off the line to save one) or you grip him yourself and carry him up the ramp with Force you were spen
  - isolation: Every lever is an opt-in field read as `MODES[mode]?.x`, so ten modes get an absent field and today's answer. `FORMATIONS` is an open table that self-registers through `registerOrders` at module scope, so a twelfth order costs no wiring and no key — it rides the existing wheel, w
  - touches: src/game/Waves.js — one MODES row (`battles:true`, `downed:1`, `holdTheLine:true`, `objectives:true`, `lifts:3`), src/game/Command.js — one FORMATIONS row ('On the ship') with its own leash and slot solver; `command.mjs` requires a distinct leash and refuses two orders that place men identically, so the slot must genuinely be the ramp queue, src/game/Extraction.js — a `rearm()` method so the director can run more than once per world; written as a NEW method rather than a change to `withdraw()` (which returns false on `this.active`) so the single-lift path stays byte-identical, src/game/World.js — a guard at the top of `_endWithdrawal`: if `MODES[mode].lifts` and the director has lifts left, hand the kept list to the director instead of calling `onGameOver`. Four lines, field-driven, src/game/Progress.js `RECORDED`; src/main.js `TAKEN` ('Men brought home'), tools/checks — extraction.mjs (its skip check is inverted and must stay that way; the re-arm must not become a skip), company.mjs, endings.mjs, modes.mjs
- **Dead Air** — Something came aboard while you were away — the hull has gone quiet, you cannot see across your own hangar, and the only people in it are your crew, unarmed.
  - loop: You navigate by ear. `DeckAudio` is a positional pressure model measured in real dB across the room's length, so where you are standing changes what you can hear, and in the smoke that is your primary sense: a scream from the pit, boots on grating at the lip, the lift chime forty metres behind you, a hull thump that is really a flash you saw through the aperture four seconds ago. You find people a
  - isolation: The mode lives on its own LEVELS key, which is the decisive choice. `Player.hosting` is derived once from `MODES[mode].level === 'hangar'` — the literal string — so on `deckfight` it is false by construction and the hub keeps its non-combat contract byte for byte, while this mode
  - touches: src/game/Waves.js — one MODES row (`level:'deckfight'`, `insertion:false`, `solo:true`), src/game/Levels.js — `LEVELS.deckfight = { ...HANGAR_LEVEL, name, blurb, pool }`, deliberately NOT in `LEVEL_ORDER` (legal: roster.mjs allows a key that is some mode's own `level`), src/game/Hangar.js — write `world._deckProps` in `dressHangar` (one line, and it lights 131 bodies), and export an `undressDeck(world)` so a second director can tear down the audio graph, the lift colliders, the flight and the mirror without duplicating HangarDirector, src/game/World.js — one branch: `loadLevel`'s hangar early-return is keyed on the literal `level === 'hangar'`, so `deckfight` falls through; a `MODES[mode].boarding` branch builds BoardingDirector in the same shape, src/game/Progress.js `RECORDED`; src/main.js `TAKEN` ('Crew brought off'), tools/checks/hub.mjs:70 — widen the 'a fighting mode skips the deck' assertion list by one name, because `insertion:false` is correct here (you do not fly out of the hangar to arrive at the hangar)

**Lens — Asymmetric multiplayer and asymmetric AI — one player against many, a director against a squad, a Jedi versus a company,**

- **Order of Battle** — There is a general on the other side of the field, he cannot see you either, and he will believe what you show him.
  - loop: You place your company against a front you have never seen (a generated bezier line with exactly one chokepoint, laid from the run seed). You send one squad forward on `holdfire` as eyes and get back a band, not a number — 'a heavy line, forming east of the cut'. You `digin` a position you do not intend to hold, because 22 seconds of shovel work is a real hole a real observer will see and report. 
  - isolation: A meeting composes no wave — `CommandDirector.start` declines outright when `versus` is set — so this mode never enters the composer, never enters `_watchdog` (the 62%-retirement prop every army-mode survivor number in the record sits on), and cannot move a single tuned number in
  - touches: /home/user/saber2/src/game/Waves.js — one MODES row: `alwaysVersus: true`, `aiGeneral: true`, `generatedGround: true`, `objectives: true`, `levies: true`, `recon: true`, plus name/blurb (no figure in the blurb — claims.mjs parses it), /home/user/saber2/src/game/Progress.js — one string in `RECORDED`, /home/user/saber2/src/main.js — one row in the `TAKEN` label map (:1945); one field-gated line beside `if (world.command?.versus) world.beginVersus()` (:1200) to seat the AI commander through `formUp` before the human meeting path runs, /home/user/saber2/src/game/World.js — one field-gated line to build the Recon projection beside the existing `objectives` line (:1081), disposed where ObjectiveField already is, /home/user/saber2/src/ui/HUD.js — two reads: the hostile count and the minimap consult `world.recon` when the mode declares it, `?.`-guarded so every other mode is byte-identical, /home/user/saber2/src/game/Levy.js — one clause in `levies(director)` so a mode may declare the levy instead of requiring `conscript` in a level pool (today: Geonosis and only Geonosis), /home/user/saber2/tools/checks/modes.mjs, claims.mjs, endings.mjs — the standing per-mode enumerations every new row pays
- **Answer the Blade** — You have spent a hundred hours being the thing on the other end of this. Now you find out what it is like to be the forty.
  - loop: The counter-intuitive thing, and it is already true in the sim: DO NOT SHOOT HIM. `Nerve.boltAnswered` bills the droid whose bolt was deflected, and six answered bolts break a man — so the squad firing at him is the squad that routs, and it takes its neighbours with it through `nerveTick`'s rout carrier. So your hands do this: `holdfire` on whoever is in his path, `digin` on the ground that matter
  - isolation: Everything the mode takes away it takes away in one early-return branch that no other mode can enter, gated on a field the constructor reads once — the exact shape the flight deck has shipped for a year, including the rule that the branch writes `control.scheme` on the controller
  - touches: /home/user/saber2/src/game/Waves.js — one MODES row: `battles: true`, `holdTheLine: true`, `downed: 0.6`, `unarmed: true`, `fireMissions: true`, name/blurb, /home/user/saber2/src/game/Player.js — `this.unarmed` derived once in the constructor beside `this.hosting` (:3332), and one early-return branch in `_readInput` shaped like the hosting branch; both field-gated, /home/user/saber2/src/game/World.js — one field-gated line to install the Adversary beside the existing per-mode subsystem lines, /home/user/saber2/src/main.js — one `TAKEN` row; and the mode's battle picks at :1204, which today is a literal `settings.mode === 'skirmish'` and would otherwise hand this mode `skirmishConfig(null)` defaults with the sliders lit and ignored, /home/user/saber2/src/game/Progress.js — one string in `RECORDED`, /home/user/saber2/tools/checks/fire-mission.mjs:115 — widen the hard bar, with the price argument written down (the read costs you your voice, not your quorum). This check goes red by design until somebody argues it, and that is the design working, /home/user/saber2/tools/checks/downed.mjs, modes.mjs, endings.mjs, claims.mjs — the standing per-mode enumerations
- **The Hidden Enemy** — One of your ten is working for them, and the only way to be sure is to be wrong about somebody.
  - loop: You fight an ordinary crossing and you read your own men while you do it. The tells are all things the sim already produces and you have spent a hundred hours half-ignoring: `_ask` returns 'shaken' for a man whose bravery you can see on the roster feed is fine; the order you sent twice goes with a runner and the log writes `lostorder` and the runner is unhurt; the squad you put on a battery loses 
  - isolation: The traitor is one body with wrapped methods, through the seam this codebase already uses to turn an enemy into an ally — `installCommand` and `installTeamDamage` are instance wrappers, variadic on purpose, and `enlistBody` is exported. Nothing about any other man on the roll cha
  - touches: /home/user/saber2/src/game/Waves.js — one MODES row: `crossing: true`, `downed: 0.6`, `informer: true`, name/blurb (and NOT `battles` — declaring both silently demotes a crossing, Command.js:5097), /home/user/saber2/src/game/Command.js — `detain(t)` (one method: out of the line, out of `led()`, out of the quorum, marked on the roster feed, one log kind) and one `this.orders = { ...ORDERS, detain }` assignment when the mode declares the flag. The wheel table already comes off the director, so the HUD is not touched at all, /home/user/saber2/src/game/World.js — one field-gated line to install the Informer after the roster is dealt, /home/user/saber2/src/game/Progress.js — one string in `RECORDED`, /home/user/saber2/src/main.js — one `TAKEN` row, /home/user/saber2/src/game/Company.js — one fate kind for a man detained or exposed, alongside the `stranded` fate `keep()` already writes, /home/user/saber2/tools/checks/company.mjs, modes.mjs, claims.mjs, endings.mjs — the standing enumerations, plus company.mjs's source scan (the new fate string must avoid the six forbidden words)

**Lens — The management/simulation game hiding in this codebase — the company, the roster, the names, the ranks, the dead. I look**

- **Rotation** — Ten seats, sixty men — you walk your own flight deck and pick who's coming, and the ones you leave are standing there watching as you fly out.
  - loop: On the deck: the order arrives at the holotable that has stood there with nothing on it since the day it was written (`Session.deployCard` is a complete, live, unreachable screen — this is what makes it reachable again). You walk the line. Crosshair a man inside `DeckEdit.REACH` (6 m); he steps out, turns, salutes and holds; the wheel says GOING or STAYING. GOING and he breaks ranks and walks up t
  - isolation: Three separate arguments, and the strongest is that the hard half already ships. (1) PERSISTENCE: nothing new is stored. `Company.keep` already folds a drop, already strikes the men who did not come home, already writes epitaphs and honours — that runs identically today at the en
  - touches: src/game/Waves.js — one MODES row (`rotation`: name, blurb, battles: true, downed: 0.6, plus one new field `tour: true`)., src/game/Progress.js:173 — 'rotation' into RECORDED., src/main.js — a module `let tour` beside fieldedRecruits (194); `enterHangar` hands it to the deck world; `homeward` (2027) keeps the tour alive instead of ending the sitting; `deploy` takes the tour's stick as `run.veterans` in place of the default lineup; one row in the TAKEN label map (1945)., src/game/Hangar.js — one `stepDeckMuster` call in HangarDirector.update (between stepDeckEdit and stepDeckLife, for the ordering reason already written there), one `undressDeckMuster` in dispose, and the `world.orders` swap — which MUST keep `deck: true` on the new table, both because tools/checks/hangar.mjs:284 asserts it and because it is the flag that stops bank() striking the whole roll., src/ui/Menu.js — one readout line under the mode column saying where the tour is (drop N, men on the roll). Optional but he will ask for it., tools/checks/progress.mjs, modes.mjs, hangar.mjs — the RECORDED entry, the TAKEN label, and widening hangar.mjs's order-table assertion to accept a second deck table that still declares `deck: true`.
- **The Detail** — Your spotter is one man with a name, and when he dies nobody can read the artillery mark for the rest of the run.
  - loop: You fight, and every capability you have goes through a person. Artillery: High Command lays the ellipse and states an honest estimate that is never revised; obeying is one keypress; checking it costs twelve seconds seventy metres forward of your own line — unless your spotter is alive and forward, in which case it costs four, which means the whole mode is about keeping one specific man in a place
  - isolation: The board is a nullable object on the World and every consumer reads it optional-chained with the shipped constant as the fallback: `world.billets?.readRate() ?? 1`, `world.billets?.voiceHops() ?? 1`, `world.billets?.crews(squad) ?? holds(leadOf(squad),'CREWS')`. With no board ev
  - touches: src/game/Waves.js — one MODES row (`detail`: battles, seedsGround, generatedGround, objectives, fireMissions, downed: 0.8, billets: true)., src/game/Progress.js:173 — 'detail' into RECORDED., src/main.js:1204 — the battle picks are handed over on `settings.mode === 'skirmish'` LITERALLY, so any new `battles` mode silently takes skirmishConfig(null) defaults with the sliders lit and ignored. Make it field-driven off `MODES[mode].battles`. Plus one row in the TAKEN label map (1945)., src/game/World.js — build `world.billets` behind `MODES[mode].billets && leadsArmy`, beside the ObjectiveField build at 1081., src/game/Command.js — onDeath raises `billets.vacate(t)`; `_voices` adds the voice's hop; `_digTick` asks the board for the spade; one order row so the wheel can appoint under the reticle (the wheel, never a key — the keyboard is full and controls.mjs fails the build when the rebinder has no spare letter)., src/game/Objectives.js:107 — one `wants` field per row, and the crew count tests the licence., src/game/FireMission.js:458 — `_readTick`'s rate becomes `world.billets?.readRate(reader) ?? 1`., src/ui/HUD.js — one caption row for the board, through the existing `_paintOrderSub` sub-line.
- **Last Call** — The gunship takes ten. You have twenty-four men on the ground and the ship makes three trips.
  - loop: You hold a perimeter that is shrinking on purpose. The ship is on the pad with the ramp down for twenty-two seconds and it will not wait; while it is down it is pinned and the enemy pushes the LZ. Your hands: crosshair a man, wheel, ON THE SHIP — he breaks contact and walks (never teleports; the walk is kinematic and it is the mode's central animation). Ten of those, or you let the shipped nearest
  - isolation: The whole mode is one director object on `world.lifts` plus one MODES row. Extraction's existing single-lift path is guarded on `world.lifts` being absent — the `_withdrawTick`, `canWithdraw`, `withdraw`, `sealManifest` and `_endWithdrawal` sequence every other mode runs is not r
  - touches: src/game/Waves.js — one MODES row (`lastcall`: battles: true, downed: 1, plus `lifts: 3` and one new field `manifested: true` — the run is scored by who came home, which is a third ending beside holdTheLine and lineAdvances)., src/game/Progress.js:173 — 'lastcall' into RECORDED., src/main.js — the same one-line fix concept 2 needs at 1204 (battle picks field-driven off `MODES[mode].battles` instead of the literal 'skirmish'), plus one row in the TAKEN label map (1945)., src/game/World.js — build `world.lifts` behind the flag; `sealManifest` (2660) appends per lift instead of sealing once (it already early-returns on an existing array, so this is where the change goes); `_announceBattle` reads `manifested` for the third verdict., src/game/Extraction.js — a re-arm so the ship can come back, modelled on the existing `_reboard`, guarded so that with `world.lifts` absent every existing code path is byte-identical. This is the sensitive edit and it is the only one., src/game/Command.js — one order row so the wheel can name a man for the ramp under the reticle., src/ui/HUD.js — the seat count and the clock on the ramp.

**Lens — Physics, destruction, ragdoll, cutting and terrain deformation as the SUBJECT rather than the medium — a mode whose obje**

- **The Undermining** — I cut the two piers on the near side and dropped two hundred metres of viaduct sideways onto their line — and then my men took cover behind it for the rest of the fight.
  - loop: Blade lit, standing at a pier, holding a cut through stone. `PROFILES.duracrete` at TOUGHNESS.heavy × 1.6 means seconds of contact, not a swing, and the blade solver grades a wall exactly the way it grades a limb because `Structure.bladeCapsules` publishes cells as capsules. Between cuts you are reading the load: which piers are still bearing, which span is now hanging on one, and whether `updateS
  - isolation: Every new behaviour hangs off a MODES field read as `MODES[mode]?.siege`, which is the same shape as `objectives` and `fireMissions` — both already single-mode and both already gated at exactly one line in World.js. Destruction.js is not modified: `Structure` already publishes `s
  - touches: src/game/Waves.js — one MODES row (`battles: true`, `holdTheLine: true`, `downed: 0.6`, `siege: true`, `generatedGround`, blurb), src/game/Progress.js:173 — one string in `RECORDED`, src/main.js:1945 — one entry in the `TAKEN` label map, or the death card prints somebody else's noun; and main.js:1204's `settings.mode === 'skirmish'` literal means a new `battles` mode silently takes `skirmishConfig(null)` defaults, so the plan has to be passed here or read off the field, src/game/World.js — build the Siege director beside the `objectives` (:1081) and `fireMissions` (:1169) lines, behind `MODES[mode]?.siege && leadsArmy`; raise `Destruction`'s `maxLive` for objective pieces, src/world/Battlefield.js — a sixth entry in `REASONS`: a ravine with one crossing (the existing five are pass/ford/landing/gunline/wreckfield and the table is already the extension point), tools/checks/modes.mjs, progress.mjs, plus one new suite driving a headless collapse
- **The Churn** — By the sixth hour on that hill the ground was four metres lower than it started and there was nothing left to hide behind — for either of us.
  - loop: This is the mode where you give the order to dig and mean it. `FORMATIONS.digin`: 22 seconds, fire held, the squad cannot leave the spot, and what comes out is a `Terrain.crater(x, z, 8, 0.9, 1.6)` that blocks 12 of 12 measured sight rays in and 11 of 12 out. Your squad has stopped being a firing line and become a thing that has to be cleared by somebody walking up to it — and so has theirs, becau
  - isolation: The enemy engineer director is a `world.props` member — the duck-typed per-frame contract that `Forest`, `Hazard`, `Crowd`, `Storm` and `DestructionProxy` already ride — so it needs zero lines inside World.update's loop and a `capsules()` returning nothing keeps it off the blade 
  - touches: src/game/Waves.js — one MODES row (`battles: true`, `holdTheLine: true`, `lineAdvances: true`, `downed: 1`, `objectives: true`, `fireMissions: true`, `level` or `generatedGround`), src/game/Progress.js:173 — `RECORDED`, src/main.js:1945 — a `TAKEN` label; and main.js:1204's skirmish literal, same trap as any new `battles` mode, src/game/World.js — build ChurnDirector beside the Objectives line (:1081); stop the engagement rotation so `deform` accumulates live in one Terrain rather than through replay, tools/checks/fire-mission.mjs:115 — this HARD-BARS any mode but `theline` from declaring `fireMissions`, by design. The bar's argument is that without a quorum, walking out to read a mark costs nothing; The Churn declares `lineAdvances`, so it answers the argument, and the check's argument has to be widened rather than deleted, tools/checks/downed.mjs, modes.mjs, progress.mjs, plus one new suite
- **Deadweight** — I got onto a moving AT-TE, cut three of its legs from the deck, and rode it down onto the tank behind it.
  - loop: Getting on. `Enemy.platform()` is measured off the real transformed vertices of the `body` bone, keeping only those inside the inner 60% of the footprint and returning the NARROWER half-span so you have to land on the thing rather than beside it — and `Player._gatherNear` already feeds it into `supportHeight` as `_nearDecks`, so a walker's deck is floor and the gait bobs it under you. You jump for
  - isolation: The boarding half is a consumer of machinery that already ships and already works — `_nearDecks` is built every frame today and `topOfProps` already answers it — plus a `_readInput` branch in the shape of the existing `driving` (Player.js:3912) and `hosting` (:3990) branches, bot
  - touches: src/game/Waves.js — one MODES row (`battles: true`, `downed: 0.6`, `column: true`, `generatedGround`), src/game/Progress.js:173 — `RECORDED`, src/main.js:1945 — a `TAKEN` label; main.js:1204's skirmish literal again, src/game/World.js — build ColumnDirector behind the field, beside the existing Objectives/FireMission gates, src/game/Levels.js — pool entries so the machines exist on more than one ground, and one `attachRiders(world)` line per ground that wants mounted escorts. This only widens what a level may field, but it is a real edit to a shared file and roster.mjs/factions.mjs both police it, tools/checks/driving.mjs (it asserts the crewed/uncrewed split matches the source material's crew-compartment line, so no `crew` field moves), roster.mjs, escalation.mjs if pools change, plus one new suite

## The deep designs — two syntheses completed

### Good Soldiers

Your own company changes commanders mid-engagement, and from that second the only way to make a man stop shooting at you is to kill one of his friends.

**The loop.** **Every ten seconds you make one bearing decision, one target decision, and one Force decision. Your hands do: move, deflect, cut one specific man, move again.**

Read it as the ring it is.

**BREAK THE SIGHT LINE (hands: sprint, terrain).** Their artillery is refused at the commit by `Stratagems._visible(site)` — it walks the caller's own team for a body within `SPOTTER_SIGHT` of the ground being called (Stratagems.js:1399–1415). So dead ground does not mitigate the strike, it CANCELS it, and the mark on the ground four seconds ahead of the shell tells you which way to run. Terrain is the counter-play, not deflection. This is what you are doing with your hands most of the time.

**PICK THE NAME (hands: one commitment, three to five seconds inside their line).** You cannot break them; you can only take somebody out of them, and the shipped tables make that a real choice with different prices:

- **The rifleman between you and the ground you need.** −0.16 to everyone in his squad (`MORALE.COMRADE_FELL`, fired on any trooper death regardless of killer — Command.js:10082). Cheapest, smallest, and sometimes the only honest answer.
- **The squad leader.** −0.26 (`LEADER_FELL`), AND his squad loses `MORALE.LEADER_NEAR` (0.055/s) which is what was holding it up, AND `_closeRanks` pulls the survivors in tight for a few seconds, which is a knot of men you can now leave behind or catch together.
- **The man who RELAYS.** `relaysOf` gathers every living man licensed to RELAY across the 

**Variance.** **Run twenty is a different fight from run two because the antagonist's stat block is nineteen runs of your own decisions, and every axis of it is already load-bearing in the shipped arithmetic.**

**Rank.** `AIM_BY_RANK` is [1.00, 0.97, 0.94, 0.91, 0.88] on the aim CONE, so a company you have promoted for nine sessions shoots measurably tighter than a company of Troopers. A green roll misses; a decorated one does not.

**How many men RELAY.** The comm-holder is derived, not rolled — highest-ranking living man licensed to RELAY. A run-two company has one such man, so one walk across open ground silences their artillery for the rest of the mode. A run-twenty company has four, and by the end i

**Isolation.** Not a claim. Six seams, each with the line that bounds it, and the one place this design can actually go wrong.

**1. THE CENTRAL VERB IS ONE FIELD ON AN OBJECT THE GAME ALREADY HAS.** `canHarm` (Player.js:2555) is `if (a !== v) return true` and it is the only code permitted to answer whether one thing may hurt another — the bolt test, the blade solver, `hostileTo`, `bladeTargets` and every Force power call it rather than comparing teams themselves. So the defection needs no plumbing at any of those sites, a third side on the field costs no rules work at all, and `installTeamDamage`'s wrapper (Command.js:4878) reads the team at call time so the player's blade unblunts itself on the frame the sides move.

**2. THE COMPANY IS STEERED WITHOUT TOUCHING THE BRAIN, AND WITHOUT TOUCHING WORLD.** `World.pickTarget` opens with `if (enemy?.trooper && this.command) return this.command.targetFor(...

**Kill test.** **THE HANDOVER PROBE. It is takeable on day one, headless, before `Order66.js` exists, and it kills the design if it fails.**

Boot a real Command run on a fixed seed through the existing `tools/checks/_army.mjs` harness. Let it settle sixty seconds with a full roster. Then, in the driving script and with no mode written, do the four things the mode would do: enlist a second Commander with `player: null` on an opposed side, move the roster object to it, stand the first commander down, and write `team` on every trooper body. Step ninety seconds with the player scripted to walk a straight line and kill five specific men — one rifleman, one squad leader, and the senior RELAYS man.

**Four numbe

**What I would cut.** **THE LOYALIST — the one man who does not turn. The film director explicitly refused to cut it ("I would not cut: the loyalist, the empty deck, or the three-second dead order wheel"), and it is the first thing I would take out.**

Two reasons, and the second is the fatal one. It is a body on your side that the mode's own verdict cannot price: `_endWithdrawal` counts `roster.living` aboard, so a man who stayed loyal is either a hole in the card or a special case in the one ending the mode did not have to write. And the systems designer's own objection is right — a man who can be kept is a curre

### On Your Word

High Command marks a piece of ground, the guns are theirs and yours are gone, and the game will never tell you who is standing on it — it only lets you go and look, and every window you let close shortens the bar that four more of your men come down.

**The loop.** Take any ten seconds of it and ask what the hands are doing.

SECONDS 0–10. Left hand on the movement keys walking the line forward; right hand deflecting, because a rifle line is 40 m away and `Combat` does not care that a comm is open. Somewhere in here the order came down — a voice, a card on the right, an amber ellipse on the ground 40 to 120 m out.

SECONDS 10–20. Hands off the blade for about a second and a half: the order wheel, one squad, one piece of ground. This is the mode's actual skill and it is a verb that already ships. Planting the line before you walk out is the difference between reading a mark alone and bringing ten men into it with you — measured in `FireMission.js`'s own header, 0 of 10 caught against 10 of 10.

SECONDS 20–32. Sprint. Nothing else. You are crossing open ground toward a shape you cannot read from here, and the men you just planted are not coming.

SECONDS 32–36. Standing still, holding sense. Four seconds if the bar has it, twelve if it does not, and standing still 40 m forward of your own line is the whole price. The ring under you turns blue or it turns red.

SECONDS 36–46. Either you press one key and eighteen shells sweep the ground over 3.1 seconds, or you turn round and run and let the window close. Both are one motion. Neither has a confirmation.

AND UNDERNEATH ALL OF IT, THE SECOND CARD. From the second engagement on there are two orders standing at once and one pair of eyes. The clock cuts into any free slot at `CADENCE / slots`,

**Variance.** Run two is a Raid: two engagements, the front never closes past 140 m, one order slot the whole way, and the marks land in the gap between two armies that never quite touch. You will probably finish it having checked most of them and lost nobody to your own guns, and you will think the mode is about artillery.

Run twenty is different for four reasons and only one of them is a dice roll.

THE SEED, which is the ordinary roll and the smallest part: `rollSession` draws Raid 2 / Push 3 / Grind 5 at 1:2:1, the ground comes off `LEVEL_ORDER`, `Battlefield.planBattle` draws one of five reasons and lays a bezier front from six seeded numbers, and the ten names are minted at the muster. A Grind on a

**Isolation.** Nine pieces of evidence, each checkable against the tree with a grep, and each stated so it can be falsified.

1. ONE NEW FILE, AND IT IS A CHECK. Everything in src/ is an edit to a file that already does this job. `FireMissionDirector` is constructed at World.js:1170, stepped at :3886, disposed at :1167 and :1695, and read by HUD.js:520 and :1559 and main.js:2696. Every one of those call sites exists today and the mode reaches all of them by declaring `fireMissions: true`, a field that already gates director construction.

2. NO NEW PER-FRAME WORK, AND THE SECOND SLOT IS CHEAPER THAN IT SOUNDS. The added cost is `_pick`, whose own note prices it as O(n²) over 'at most a few dozen bodies in one annulus'. At two slots it runs about every 48 s instead of every 95. Against a measured frame where `BipedAnimator.update` is 46.4 µs per body, this is not in the budget. The mode adds no body, no

**Kill test.** Both halves are takeable on day one, on the shipped code, before Waves.js gains a row.

HALF ONE — HEADLESS, HALF A DAY, NO NEW SRC CODE. `FireMissionDirector` already exists and `tools/checks/fire-mission.mjs` already has the fixture. Add the depth band as a constructor option — the one change the mode needs anyway — and drive the shipped director on the shipped The Line across ten seeds and a full crossing, at the shipped band (70–140) and the candidate band (40–120), counting one number: the share of ellipses that hold at least one of your own men at the moment of authorisation.

  Under 0.10 at the candidate band and the mode is dead. Nobody is ever in the ellipse, checking is a chore wi

**What I would cut.** THE DISPATCHED SPOTTER — the systems designer's `Spotter.js`, a named man who walks out to refresh the count and comes back with a number and never a name. About 180 lines, its own file, a death case, a HUD state, a wire story and two checks, and its author costed and defended it as the mode's middle rung. Cut, and not on budget. `FireMission.js`'s own header already settles it: "A spotter can tell you there is something on that ground; he cannot tell you WHOSE, because the whole reason the order is checkable is that the Force reads life and not silhouettes. Handing the reading to any trooper 

## The promotion seam — four designs, twelve refutations, TWELVE FATAL

Four independent approaches (the dissolve, the budget-as-allocator, identity-first,
and one that refused the premise), each attacked by three skeptics: the frame
budget, the integrity of the fiction, and co-op/determinism.

**Not one design survived a single lens. 12 of 12 attacks landed fatal.**
The settlement agent was stopped before it ran; on this evidence its own
instruction was to report that the seam should not be built as designed.

### Design — THE DISSOLVE. A rank crossing the seam becomes twenty real bodies, one a frame, each redressed from 

The seam is INK.edgeFade, both ends of it: men swap at 130 m where the ink has already faded the silhouette to nothing, and inside 55 m where the line is at full strength nothing may ever be an instance — so the swap is invisible by construction rather than by tuning, and the 75 m between is the window the arbitration decides in.

*Honest doubt.* That two blocks is enough to feel like walking into a battle.

Forty men. Standing in the mass the player has forty real bodies around him and four hundred instances beyond — and inside CONTACT every block that cannot be afforded gives ground, so a 12-block line grows a 55-metre dent wherever he is standing. I have argued that reads as a line bending away from a Jedi. It might read as the line running away from a bug, and I will not know which until it is on screen. If it reads wrong, the fallback is to let those blocks stand and accept an outline gap at 40 m — which is what the shipped code a

*Kill test.* Build the bench and nothing else, on day one. Forty `Enemy` bodies of two uniforms spawned into the mould band during a real Geonosis insertion at one a frame, posed, merged, darkened, proxies removed, lifted out of `world.enemies`. Then put all forty back at once and step 300 frames.

Four numbers, any one of which kills the approach:

1. THE REDRESS. If putting a benched body back — position, facing, phase, hp, `physics.add`, slot adoption — is not under about 0.5 ms, promotion is construction

### Design — THE BUDGET IS THE DESIGN. The seam is an allocator, not a radius: start from the measured ceiling, p

A rank never gives a man up; it lends him a body out of a warm pool for as long as the frame can afford one, so PROMOTE stops being a keep-out radius and becomes the floor under a breathing one.

*Honest doubt.* Demotion. Promotion is easy to make invisible because the body is put exactly where the instance was. Demotion is not, and I do not believe my own hysteresis fixes it.

A body that has been real for thirty seconds has been doing what real bodies do: it has walked out of its file, it is crouching, it has been shoved, it is aiming somewhere the block is not. A cohort instance can only wear the palette's walk — Cohorts.js says so out loud: "a body that kneels, staggers, is held or is knocked down past the band still stands." So every demotion is a small snap to attention. I have pushed the releas

*Kill test.* Measure the exchange rate directly, day one, before a line of Promote.js exists. Boot thefront as it shipped — 480 men, geonosis — let it lay, then add real Enemy bodies one at a time at 40 m and take the median world update after each. Two numbers come out: the ms a body actually costs on top of a running mass, and the count at which the median passes 8.2 ms, the 66-body row this game already ships.

If that count is under about twelve, the allocator has nothing to allocate. Twelve bodies is no

### Design — IDENTITY-FIRST. The man is the record; the Enemy body is a rung, not a birth.

Promotion is not a spawn — it is a lease. A rank man is a permanent anonymous ledger entry; a pooled `Enemy` chassis is leased to him while he is inside the band where the game already refuses to draw an outline, and handed back past `L3_AT` where both tiers are literally the same InstancedMesh.

*Honest doubt.* THE BEHAVIOURAL SEAM, WHICH I CANNOT PROVE INVISIBLE THE WAY I CAN PROVE THE RENDERING ONE. Rank.place is a rigid 5x4 grid re-seated on an anchor every frame, terrain-sampled, every man on the same facing, no collision, no separation, no reaction. A real `Enemy` is ten thousand lines of a body that wants to be an individual: it steers, it avoids, it has a capsule that pushes off terrain, it picks its own target through pickTarget, it crouches, it takes cover, it flinches, it throws grenades, it staggers. Twenty of them told to stand in a grid will not stand in a grid — they will jostle and dri

*Kill test.* Two numbers, both takeable on day one against the deleted file plus twenty `world.spawnEnemy` calls, with no seam written. (1) THE PIXEL TEST. Lay a real front on geonosis. At 134 m, stand twenty real bodies of one archetype in a 5x4 grid and twenty cohort instances of the same archetype in an identical grid beside them, driven to the same gait phase. Screenshot through the shipped renderer with the ink pass on, and diff the two halves inside the men's footprint. If the mean difference is above 

### Design — REFUSE THE PREMISE — and the refusal is arithmetic off this repo's own shader, not taste.

The seam 

Delete the near/far split: a block is one unit of strength with two backends — cohort instances and pooled real bodies — and the whole battle hands over inside the 118–138 m band where this renderer's own arithmetic proves an instance and a merged skin are the same picture.

*Honest doubt.* THAT A POOL IS ENOUGH TO MAKE TWENTY MEN ARRIVE WITHOUT A HITCH.

The pool removes construction, and construction is the big cost. It does not remove the twenty bodies' FIRST FRAME, and I have not measured that. On the frame a block detaches, twenty `Enemy`s enter `world.enemies` and all of them, together: pick a target through `ctx.pickTarget`, run `_think` for the first time, `_syncBody` twenty colliders into one Rapier step, solve a biped that has not been solved since the corps was parked, and get seen by `Corpses`, `Cohorts` and `_boltHitTest` as twenty new entries. That is a burst, and t

*Kill test.* TWO MEASUREMENTS, BOTH TAKEABLE ON DAY ONE, BEFORE A LINE OF THE DESIGN IS WRITTEN.

1. THE FRAME, AND IT IS THE ONE THAT DECIDES EVERYTHING. Boot a real World on Geonosis at `low`. Pre-build 40 `Enemy` bodies, park them, then seat them as two 20-man blocks 25 m either side of the player with their `_move` wrapped by `Command.installCommand`'s wrapper steering them onto fixed formation slots. Put 440 `Mass` rank men on the field behind them through `layBattle`, with the dirty-flag on `place`/`_d

**THE INTEGRITY OF THE FICTION — does the seam lie to a player who is paying attention?** — fatal: True

PROMOTION DOES NOT CHANGE WHAT DRAWS A MAN. IT CHANGES WHAT HE DOES, AND IN THE ONE MODE THIS SHIPS IN IT CHANGES IT INTO NOTHING.

The design's load-bearing claim is stated three times: "THE RANK NEVER NOTICES… whether a block's men are instances or bodies is a rendering-and-simulation tier, not an identity", "No MassBody class, no puppet, no AI switched off", "the front's advance is computed from the same numbers either way." All three are false in `thefront`, because `thefront` is a mode with no army, and a body's behaviour in this engine is decided by whether the world has one.

An instanced rank man is a soldier in a firing line: he marches at MARCH 1.15 m/s in a 5x4 grid and pours volleys into the enemy LINE, taking the player only when the line in front of him is gone — a rule Mass.js bought with a measured disaster (240v240 becoming 2v208 when twelve blocks all agreed on the player, Mass.js:669-698).

The same man promoted is an `Enemy`, and `World.pickTarget` is the only thing that decides what an `Enemy` does. In `thefront` `world.command` is null, so `pickTarget` can retur

*Evidence.* /home/user/saber2/src/game/World.js:1039-1064 — `const leadsArmy = campaign || contingent > 0;` … `this.director = leadsArmy ? new CommandDirector(...) : new WaveDirector(this, { mode, pool: L.pool });` … `this.command = leadsArmy ? this.director : null;`. The deleted MODES.thefront entry declares no campaign and no army ("it is why the row declares no `battles`, no `crossing` and no `ladder`"; "runs BOTH: the ordinary wave director for the close fight and the mass for the battle behind it"), so `world.command === null` for the whole mode.

/home/user/saber2/src/game/World.js:3225-3283 — `pickTarget(enemy)`: the trooper/Command branch first, then `for (const p of hostileTo(enemy, this.players, this.rules))` — players only — then `if (this.command) { … armyIndex.nearest … }` for body-vs-bod

*Can it be saved?* Not in this shape. The bench, the adopted slot, the one-a-frame queue and the ink-derived seam are all sound and worth keeping — the arithmetic and the visual-continuity chain are the strong half of this document. What cannot survive is REVERSIBILITY plus FULL AI in a mode with no army. Those two together are the lie: full AI means the man leaves the line, and reversibility means he has to be put back, and putting him back is a teleport of everything he did while he was real.

Two honest exits.


**THE FRAME BUDGET — what twenty (and forty) real Enemy bodies actually cost to build and to** — fatal: True

The design prices a promoted man as a FAR body and then spends the entire feature putting him at the player's elbow. Every per-body cost in this engine that is bought back by distance — the biped solve, the deferred matrix walk, the shadow cast, the draw call, the ink prepass's second rasterisation, the footstep and its sand puff — is switched back ON inside 62 m, by shipped code with argued reasons. 0.13 ms a body is a measurement of men standing on a battlefield at LOD 2/3. The repo's own split of the SAME two-line front layout says a body inside 62 m costs ~335 µs of `world.enemies` work, of which 173 µs is the biped solve alone. Forty of them is 6.9 ms of animation before anything else — larger than the 5.20 ms the budget allots the whole forty. And the design's own named guard against that (`_animLag`, "so twenty men do not solve on the same frame") is dead code at LOD 0/1, because `ANIM_STEP` is 0 there and `due` is unconditionally true. So the seam does not merely hitch on the promotion frame; it raises the steady-state floor by 3–10× wherever the player is actually standing, 

*Evidence.* 1. THE 0.13 ms IS A FAR-BODY NUMBER, AND THE REPO HAS THE NEAR ONE, IN THIS EXACT LAYOUT.
`/tmp/.../deleted/Mass.js:10-21` measures bodies "standing on a real Geonosis field" — the two-line front, mostly past 62 m. Its own ladder is not linear either: 26→66 is 45 µs/body, 200→320 is 144 µs/body.
The near split is quoted inside the engine. `/home/user/saber2/src/game/Enemy.js:8989-9002`, from `tools/floor.mjs --layout front`, 158 bodies as two lines across a battlefield:
    enemies 53.0 ms (86.0%) · _pose 30.0 · anim 27.4 (BipedAnimator.update) · _move 10.8 · _think 7.9 · physics.step 4.2
That is 335 µs a body for `enemies` alone. `/home/user/saber2/tools/checks/animation.mjs:282` states the same figure as a per-body rate: "27.4 ms of a 61.7 ms frame across 158 bodies — 173 µs a body, paid

*Can it be saved?* Not at forty. The mechanism is salvageable; the number is not.

KEEP: the bench (as a detached subtree, not a darkened one — that closes finding 8 and costs nothing the design fears), `CohortField.adopt`, `Enemy.reseat` and its state list, the four hysteresis rules, and the wire-gating of `Front.update`. None of that is what fails.

CUT: SEAM_BLOCKS to 1, and RANK_MEN-at-the-seam below 20. Re-price a promoted man at the near cost this repo has already measured — ~335 µs of `world.enemies` at LOD

**CO-OP AND DETERMINISM** — fatal: True

The design's load-bearing netplay claim — "PROMOTED BODIES NEED NO NEW MESSAGE… the wire already knows how to carry one" — is exactly backwards. The wire's only vocabulary for membership of `world.enemies` is BIRTH BY CONSTRUCTION and DEATH BY ABSENCE, and the seam's two operations are precisely membership changes that are neither. On every guest the seam inverts into its own two worst failure modes.

THE FOLD IS A MASSACRE. Demotion splices twenty healthy bodies out of `world.enemies` (the design's own words: "the splice out of `world.enemies` … happen on frame N+1"). `packSnapshot` walks that array, so twenty ids stop arriving. `World.applySnapshot`'s cleanup then does `if (!e.dead) e.die(e.position.clone(), null, 'net')` — World.js:7177. That is not a bookkeeping delete. `Enemy.die` (Enemy.js:5829) runs `world.onEnemyKilled` (World.js:5725) = `corpses.take` + `command.onDeath` + `witnessDeath` + `_killFelt` (World.js:3526: `audio.bodyThump`, a tone and a noise burst per body) + score, combo and kill-feed; then die() drops the saber into Dropped.js, calls `spawnDebrisGroup`, and ra

*Evidence.* src/game/World.js:7162-7181 — "AN ID THE HOST HAS STOPPED SENDING IS GONE, dead or not", `if (!e.dead) e.die(e.position.clone(), null, 'net'); this._netEnemyIndex.delete(id);`. Its note records the measurement that put it outside the `!e.dead` guard: 92.3 MB retained over 240 host spawns, 394 KB each — so kill-on-absence is load-bearing and cannot be softened for the fold.

src/game/Enemy.js:5829 `die(point, source, kind)` → `this.world.onEnemyKilled?.(...)`, then the panic cry, hum retire, jetpack stop, cloak/hood/skirt dispose, the saber dropped into Dropped.js, `spawnDebrisGroup`, `physics.remove`, `audio.thud`. `_mayGoDown('net')` does not intercept a body with no `trooper`.

src/game/World.js:5725 `onEnemyKilled` → `this.corpses?.take(enemy)`, `this.command?.onDeath(...)`, `witnessDea

*Can it be saved?* Not as designed, and not by a small edit — the part that has to change is the sentence the netplay section is built on.

What cannot be patched: the fold. "An id that stopped arriving is dead" is not an accident to be excepted; World.js:7162 is the record of paying 92.3 MB to make it unconditional. A per-rank `promoted` bit cannot carry the fold either, at any granularity, because the host folds one man a frame while the wire runs at 18 Hz — so between packets the guest draws either double men o

**THE FRAME BUDGET — does this hitch?** — fatal: True

"Promotion NEVER constructs a body. That is the whole answer to a hitch when twenty men appear" is the load-bearing claim, and it fails three ways at once, all of them in milliseconds this repo has already measured.

(1) THE AMORTISER IS SET TO THIS CODEBASE'S RATE FOR A JOB SIX TIMES SMALLER. Building a body is ~15.8 ms and it is indivisible — one synchronous `A.build()` returning a whole rig. "One a frame" therefore means every build frame is ~32 ms instead of ~16.7. The design does not remove the hitch; it converts it into 0.6–2.0 s of half-rate frames inside the gunship insertion, which is the most camera-controlled moment in the mode, and the director is already spawning through that same landing.

(2) THE POOL CANNOT BE SIZED TO THE DEMAND ITS OWN UNCONDITIONAL RULE CREATES. "Every man inside 62 m must be real" over `layBattle`'s 16 m block pitch and a `back` of 45 m is six blocks, 120 men — not the two the design asserts. The ledger it derives affords 21–29. The gap is closed by construction, mid-fight, with the player standing in the line.

(3) THE POOL DRAINS AND CANNOT REFI

*Evidence.* WHAT A BODY COSTS TO BUILD

- /home/user/saber2/COMPANY.md:297 — "a parade figure costs **15.82 ms to build** and stands as **54 meshes / 9,386 triangles with no LOD**". Ten men is 540 draw calls; sixty is 3,240 — more than the entire shipped Geonosis frame at 12 alive (2,413).
- /home/user/saber2/src/game/Parade.js:882 `buildFigure` is `A.build({scale, ...bodyOptsFor(type), ...kitOptsFrom(look, kind)})` — its own note says "the same merge `Enemy._build` does". So 15.82 ms is a STRICT SUBSET of an Enemy. Enemy adds, in the same constructor: `_build` (Enemy.js:3426), `new Actor(...)` (Enemy.js:3461 → Ragdoll.js:165), `new BipedAnimator(...)` (Enemy.js:3473), `new Body(...)` plus `world.physics.add` (Enemy.js:3311, 3348 — a Rapier rigid body and a capsule + 3-sphere chain, created for real: 

*Can it be saved?* Not in this shape. The allocator is the wrong first move: it prices per-frame simulation, and the thing that hitches is construction, which appears nowhere in its four currencies.

Two things would have to be true first, and neither is a tuning change.

1. THE KILL TEST HAS TO MEASURE THE RIGHT QUANTITY, AND FIRST. As written it measures the marginal steady-state ms of a body on top of a running mass. The number that decides this design is what `new Enemy(world, 'trooper', …)` costs on the frame

**THE INTEGRITY OF THE FICTION — does the seam lie to a player who is paying attention?** — fatal: True

A loan does not just change how a man is DRAWN, it changes what he is made of. An instanced man has no hit points and is killed by any hostile bolt that passes within 0.9 m of him in plan view, height ignored. A loaned man is an Enemy with hp, bone capsules and a damage model. So the same twenty men, under the same incoming volley, die at somewhere between one quarter and one ninth the rate the moment the allocator buys them, and the difference is invisible on the swap frame and enormous ten seconds later.

The design conserved the wrong quantity. It proves `r.alive` does not step at the bind, and its own check says so in the strictest possible way — "assert the standing counts and _march's tilt are bit-identical ACROSS THE FRAME". That check passes trivially and is scoped to the single instant where the defect is not. What is not conserved is the derivative: casualties per round. And `_march` integrates exactly that. `tilt = (mine - theirs) / total` over standing men, and the winner walks at MARCH. So the front's motion — the one variable this whole mode exists to make readable, the

*Evidence.* LETHALITY. Man record is `{alive, slot, position, facing, animator}` — no hp anywhere (Mass.js:258-283). One bolt kills: `if (segNear(b.prev, b.pos, m.position, HIT)) { if (r.fell(m)) this._release(m); }` (Mass.js:515-516), HIT = 0.9 (Mass.js:204), and `segNear` is explicitly flat XZ with infinite height, argued for at Mass.js:217-230. A rank's round is `(A?.damage ?? 9) * 0.6` (Mass.js:256) — the header states 7.2 for a trooper rank and 5.4 for a B1 rank. B1 hp 28 (Enemy.js:788) → 4 hits. Clone trooper hp 46 (Enemy.js:1013) → 9 hits. Before geometry: a 0.9 m infinite cylinder against `capsules()`' per-bone capsules (Enemy.js:3990+).

THE FRONT MOVES WITH THE CAMERA. `const tilt = (mine - theirs) / total` summed over `r.alive` both sides (Mass.js:546-550); `push = d > STAND_OFF ? 1 : (r.te

*Can it be saved?* Not as an allocator. Three of the four breaks are in the tier boundary itself, not in the policy that moves it, so no eviction rule, tenure or hysteresis touches them.

What is salvageable, in order:

1. The dead. Mass casualties should end in `FallenField.lay` the way `Corpses.bury` does. The prone field's buffers are already allocated at attach and cost two draw calls, so this is nearly free and it removes the most obvious catch — the battlefield stops being a map of the player's route. Do thi

**CO-OP AND DETERMINISM** — fatal: True

The netplay section describes a machine state that does not exist, and its one cited precedent is invented.

**1. A guest has no mass to have a seam with.** `openFront` is refused on a client outright: `if (this.netMode !== 'client' && MODES[mode]?.massBattle) openFront(this);` (World.at.front.js:1114). The comment eight lines above says so in the file's own words — "A co-op client would have had none either." So in thefront as it shipped, players 2-4 saw **zero of the four hundred men**. No ranks, no instances, no `world.mass`, no Front prop. Every sentence of the netplay section — "A client's mass MARCHES and DRAWS but does not sweep, fire or kill", "the client releases exactly those instances", "The client thins its blocks by releasing the difference" — operates on an object the guest does not have. The seam is not the thing that crosses in co-op; **the loans are the entire thing a guest sees.** Promotion therefore makes the guest's picture strictly worse than doing nothing: it hands players 2-4 twenty-odd real soldiers standing alone on an empty plain where the host sees an army,

*Evidence.* **The gate that deletes the guest's battle**
- `/tmp/…/scratchpad/deleted/World.at.front.js:1114` — `if (this.netMode !== 'client' && MODES[mode]?.massBattle) openFront(this);`
- same file, :1097 — "A co-op client would have had none either."
- `/tmp/…/deleted/Mass.js:1352-1363` — `openFront` is the only constructor of `world.front` / `world.mass`, and it is only reachable through that gate.
- `src/game/World.js:4003` — `for (const p of this.props) p.update(dt);` is ungated, so the prop *would* run on a guest; there is simply no prop.

**The precedent that isn't**
- `src/game/Corpses.js:397-399` — `const p = this.world.player; const eye = p ? p.position : …; const fwd = p && p.aimDir ? …`
- `src/game/Corpses.js:378-393` — `worth(c, eye, fwd)`, three terms, one eye.
- grep of Corpses.js for

*Can it be saved?* The single-player seam might survive its own kill test. The co-op story cannot be patched — it has to be withdrawn, in writing, the way Mass.js's header withdrew promotion.

What survives: keep the allocator, keep the loan identity model (a man holding a body, `r.alive` unmoved), keep the eight failure-mode guards — none of those are what I hit. Run the kill test as written, and run it **twice**: once on the host and once on a guest with the front gate at World.at.front.js:1114 left exactly wher

**THE FRAME BUDGET — what twenty Enemy bodies actually cost to build and to keep, and whethe** — fatal: True

The amortisation is aimed at the wrong cost, and it works. Construction really is drippable: 30 chassis at PROMOTE_PER_FRAME=1 inside a 24.3 s flight is fine, physics.add is ~40 µs, and the 2.76 ms bake is genuinely payable once. The design wins its own kill tests and dies anyway, because the thing that blows the frame is not the spike — it is the INVARIANT. "Any man inside SEAM_AT (133.9 m) of any player IS a real body, always, no score, no vote" is not a demand for 24 bodies in the geometry this mode actually lays. It is a demand for hundreds. layBattle builds a 192 m frontage per side (RANK_COLS 5 × SPACING 2 + 6 = 16 m a block × 12 blocks) with the player looking down its middle, and the two centre blocks sit at ±8 m of offset. From where the design itself seats the friendly line — past L3_AT, 137.8 m — the player walks FOUR METRES forward and two whole blocks, 40 men, are inside 133.9 m and mandatorily real. PROMOTED_MAX is 24 and the pool is 30. The budget is gone before he has walked the length of a gunship. And once the lines close to STAND_OFF = 55 m and he is standing in hi

*Evidence.* THE GEOMETRY (deleted Mass.js, restored verbatim by the design). layBattle: `const width = RANK_COLS * SPACING + 6` = 16 m, `off = (i - (blocks-1)/2) * width`, so 12 blocks sit at offsets ±8, ±24, ±40, ±56, ±72, ±88 m — 192 m of frontage, matching the file's own "A twelve-block line is 192 m of frontage" (Mass.js:748 area). `mineAt = opts.back ?? PROMOTE + 10` = 100 m; Front's call (Mass.js:1306) passes no `back`, so the shipped number is 100 and the design's is L3_AT = 137.8. STAND_OFF = 55 (Mass.js:170) — the lines CLOSE and fight at 55 m, so the terminal state of every engagement puts the player between two 192 m walls of men 55 m apart. Men inside 133.9 m at that moment: all 480.

THE PER-BODY NUMBER THE BUDGET IS BUILT ON IS RETRACTED IN THIS REPO. /home/user/saber2/PERF.md: "EVERY FI

*Can it be saved?* Yes, but only by giving up the absolute rule, and the absolute rule is what buys the invisible seam — so the rescue costs the design its best argument. Two honest shapes. (1) BUDGETED LEASE, NOT MANDATORY PROMOTION: promote the near rows of the one or two blocks nearest each player, near-row-first, hard-capped at PROMOTED_MAX, and accept that men stand as instances inside 133.9 m. That re-opens the defect the design proudly names — instances inside the ink — so the seam has to be re-argued at a 

**THE INTEGRITY OF THE FICTION — does the seam lie to the player?** — fatal: True

The design's load-bearing claim is that at the seam the two tiers are the same men, so nothing appears, vanishes or changes. Three independent facts in the shipped code say otherwise, and each is catchable by a player who is paying attention.

(1) THE MASS DOES NOT MOVE ITS LEGS IN THIS MODE. A cohort's gait palette is filled only from a real body of the same key standing PAST `L3_AT`, and `thefront` has none: its moulds are deliberately parked at 96 m, inside the band. The deleted file says so in its own words — "until one does, they stand." So 456 instanced men slide forward in one frozen pose while the 24 promoted men walk properly. The design's whole visual-continuity argument ("the same triangles in the same pose", "pose within one palette slot") is about a palette that is the identity matrix. At 134 m a man is 12.6 px tall — gait is the only signal at that size, and gait is the one thing that differs. Cohorts.js's own header names this exact failure.

(2) A PROMOTED MAN EXISTS TWICE. The design's guard against double life is "one owner of `alive`: the ledger… standing men acros

*Evidence.* THE FROZEN CROWD — the design's central visual claim is void in this mode.

- src/game/Cohorts.js:706-717 `step()` picks a palette donor from `c.members`; src/game/Cohorts.js:501-522 `capture()` returns false unless the donor has `animator.moving`, a `rig` AND `e._l2.skin.skeleton.bones`. Mass men have none of those, deliberately — deleted Mass.js:393-405 `_joinAll` ("a man carries a TYPE and nothing else"), and the check suite asserts it (deleted mass.mjs:573-578, "0 of the mass's men carry a rig").
- src/game/Cohorts.js:448-458 `mirrorUnseen` returns immediately on `P.filled === 0`, so an unfilled palette is all-identity and every instance draws the frozen bake.
- deleted Mass.js:944-980 (the `MOULD_FWD = 85 / MOULD_SIDE = 45` note) puts the mould at 96.2 m — INSIDE `L3_AT` on purpose — 

*Can it be saved?* Not as identity-first. The one sentence the design is built on — "the man is a permanent ledger entry that stays alive in both tiers" — is what produces the double man, and every consumer of `Rank.alive` (`place`, `_sweep`, `_fire`, `strength`/`BREAK_AT`, `_march`, `count`, and the `ma` wire field) would have to learn a third state, EMBODIED, that means "counted, but not standing here." That is a rewrite of Mass.js's whole census, not a seam pass.

Three more repairs are each larger than the sea

**CO-OP AND DETERMINISM** — fatal: True

The chassis pool is simultaneously the design's hitch guard and its determinism break, and it is fatal because those are the same mechanism seen from two machines.

The design's load-bearing claim is "CONSTRUCTION COST IS ZERO AT PLAY TIME... a promotion is a field reset plus physics.add plus a splice into world.enemies." That is true on the host and false on every other machine in the session. `World.applySnapshot` has exactly one door for an id it has not seen (src/game/World.js:7050): `e = this.spawnEnemy(type, new THREE.Vector3(x, y, z))`. Unbudgeted, unpooled, undripped, inside the reconcile loop. The design also mandates "a FRESH e.id minted at every promotion — the chassis is recycled, the man is not." Those two rules together mean **every promotion is a full `new Enemy` on every guest, forever**. The host pays a field reset; the guest pays a birth — a rig, a skeleton, ~80 meshes, a physics proxy, and then a 2.76 ms L2 bake because the promoted man is at LOD 2 on the guest by the seam's own construction.

The design's own arithmetic supplies the load. It offers `PROMOTED_MAX /

*Evidence.* src/game/World.js:7050 — `e = this.spawnEnemy(type, new THREE.Vector3(x, y, z))`, the only door for an unknown id in applySnapshot; no budget, no pool, no per-frame cap.
src/game/Enemy.js:3070-3076 — "Jittered … off a counter and NOT off `rng()` … One extra call per body constructed would shift all of it, and the failure that produces is a check somewhere else disagreeing about a number nobody touched (HANDOFF §2.4)."
src/game/Enemy.js:3418-3495 — the constructor's 5-8 `enemyRng` draws: speed, facing, attackTimer, strafeDir, strafeTimer, walkPhase, `A.form || FORM_KEYS[floor(rng()*5)]`, hoverPhase/orbitPhase; line 3487 "DRAW ORDER IS LOAD-BEARING … same number of draws, different values, and every seeded remote in the dojo landed somewhere new."
src/game/World.js:222-240 — a SINGLE extra d

*Can it be saved?* Partly, and only by abandoning the line the design calls its strongest netplay argument.

The identity ledger survives. The anonymity argument survives — it is genuinely why the mass is cheap on the wire. What does not survive is "no new field at all."

The promoted body cannot be a fresh-id Enemy appearing in the snapshot. It has to be a **pooled id that exists on every machine from the moment the level starts**. Warm the pool on the client too, off `start` (which already carries `seed` and `le

**THE FRAME BUDGET — what it actually costs to build and wake twenty Enemy bodies, and wheth** — fatal: True

The amortisation covers one cost out of six, and it covers the only one this repo had already solved for it.

The design amortises the MergedSkin bake — 54 pooled bodies x 2.76 ms over 54 frames of a 24 s flight — and that arithmetic is sound. It does not amortise CONSTRUCTION, which is the larger half and the half with no budget anywhere in this tree. It asserts "two constructions a frame" as if such a budget existed; it does not, and no committed instrument in this repo has ever measured what one construction costs, because `tools/scale.mjs` deliberately builds its bodies OUTSIDE the timed window.

Three separate failures, any one fatal:

1. THE CLIENT GETS THE BURST WITH NOTHING IN FRONT OF IT. `Extraction.beginInsertion` refuses on `netMode === 'client'`. A co-op client never flies the insertion, so the 24 s window the whole amortisation rests on does not exist on three of four machines. And the client does not need a pool because it never detaches — it receives. `packSnapshot` walks `world.enemies`; a parked pooled body is not in it, so its id has never crossed. The frame twenty

*Evidence.* THE CONSTRUCTION FLOOR, DERIVED RATHER THAN GUESSED
- /home/user/saber2/src/game/MergedSkin.js:452 — "A cold bake costs 2.76 ms a body (42 mixed bodies, geonosis, a loaded box)... 42 at once is 116 ms."
- MergedSkin.js:230-303 `bakeBin` is a PURE PER-VERTEX COPY of already-built geometry: read position/normal/uv/colour, one matrix multiply, write, over the LOD-2 kept set only. 2.76 ms is the price of COPYING a body.
- /home/user/saber2/src/game/Corpses.js:17 — "A corpse costs 11 208 triangles and 81 meshes against a live body's 11 342." That is what the 2.76 ms walks.
- Building that geometry from nothing is strictly more work on the same vertices: lathe/extrude generation, `sectionise`'s analytic normal transport, a per-vertex `shadeAO` multiply per crease (Bodies.js:166), ~56-81 meshes a

*Can it be saved?* The construction burst can be, but only by giving up the thing the design is built on; the corpse cost cannot be saved by amortisation at all.

THE BURST. The fix is the one the design names and refuses: stagger the detachment over 10-20 frames. It refuses because a part-instanced, part-embodied block is "the within-block mixing my whole design is built to make unrepresentable" — so the fix costs the design its central invariant, plus a mixed state with its own ledger and its own check. On the c

**THE INTEGRITY OF THE FICTION — does the design lie to the player, and can a player paying ** — fatal: True

THE DESIGN UNIFIES THE ONE LEDGER THE PLAYER CANNOT SEE AND LEAVES SPLIT EVERY LEDGER THE HUD SHOWS HIM — and then, unlike the mode it replaces, it deliberately walks the same men back and forth across the split.

The deleted mode's segregation was ugly but honest: a mass man was NEVER a body man, so nothing could be compared. This design's whole premise is that a block's men are the same men at both resolutions. That turns four shipped asymmetries from invisible into instrumented, and hands the player a live readout of which men are real.

1. THE COMBO COUNTER NARRATES THE SEAM. Killing an instanced rank man is `r.fell(m)` + `this._release(m)` (Mass.js:516, 528) — a zero-scale write and nothing else. Killing the same block's man once he is embodied runs World.js:5792-5816: `kills++`, `score += A.score`, `support.credit('kill')`, `addFlow(0.16/0.08)`, `combo++`, `comboTimer = 3.4`, `onKillFeed(...)`, plus a corpse, a ragdoll and a `bodyThump`. HUD.js:2334-2338 paints `${player.combo}×` on screen continuously and the score sits in the top-right. So: fire into the battle and your combo

*Evidence.* CREDIT PATH (the split ledger)
- /home/user/saber2/src/game/World.js:5792-5816 — `if (!paysOut(A)) { ...source.kills++; return; } this.score += A.score; this.support?.credit('kill'); ... source.kills++; source.score += A.score; source.addFlow(kind === 'cut' ? 0.16 : 0.08); source.combo++; source.comboTimer = 3.4; ... this.onKillFeed?.(source.name, A.label, kind);`
- /home/user/saber2/src/ui/HUD.js:2334-2338 — `if (player.combo > 1) { el.combo.textContent = \`${player.combo}×\`; ... }`; :2968 notes the score sits top-right.
- /home/user/saber2/src/game/Progress.js:233, :331 — `p.kills += summary.kills || 0` and `` `${p.runs} run…, ${p.kills} felled` `` — a persistent cross-run counter.
- /home/user/saber2/src/game/Support.js:223 — `credit(kind, n = 1)`; war support is what stratagems cost.


*Can it be saved?* PARTLY, AND THE GOOD HALF IS THE HALF THE DESIGN ARGUED HARDEST FOR.

What survives: the block as the unit of account; the refusal of per-man identity (Mass.js:236-241 backs it — the men are literals on purpose); the pre-built pool instead of construction at the boundary; commitment-not-distance as the trigger; reservation at 250 m; pairing as the atom. Those are right and none of them is what kills it.

What has to change, and each costs the design something it was built to avoid:

1. THE HANDO

**CO-OP AND DETERMINISM** — fatal: True

"THE DETACHED BODIES CHANGE NOTHING ABOUT THE WIRE" IS THE ONE SENTENCE IN THIS DESIGN THAT IS FALSE, AND EVERY CO-OP FAILURE FALLS OUT OF IT.

The design puts three new things on the wire without noticing, because all three ride doors this repo has already wrapped, unconditionally, on the host.

1. RANK BOLTS CROSS AND THE CASUALTIES DO NOT, SO A GUEST IS SHOT BY BOLTS THE HOST DELETED. `World._recordFires` wraps `BoltPool.fire` itself, with no filter, and pushes every shot into `_netFires` (World.js:6125-6147). Mass's `_fire` goes through that exact door (deleted/Mass.js:653). So all 134 rank bolts a second (480 men x RATE 0.28) are replicated to every guest as real bolts. But `_sweep` — the thing that CONSUMES a rank bolt against a rank man, `b.active = false` (deleted/Mass.js:501-542) — is host-only by the design's own netplay clause. On the host a volley dies in the enemy block at 138 m. On every guest the identical volley passes through 20 phantom men and keeps flying, at MUZZLE height 1.25 m, along the line. World.js:5241-5267 states the contract this breaks in its own words: 

*Evidence.* /home/user/saber2/src/game/World.js:6125-6147 — `_recordFires` wraps `pool.fire` itself with no filter, `if (b && this._netFires && this.netMode === 'host')`, pushing a 12-number record per shot. Its own note: "Recorded at the pool rather than at the shooter because `BoltPool.fire` is the one seam every shot in the game passes through … so this cannot miss a caller." It does not miss Mass either.

/tmp/.../deleted/Mass.js:618-656 — `_fire` calls `bolts.fire(_w, _v.normalize(), {team, damage, color, speed: 92})`. `RATE = 0.28` a standing man (:139); 480 men is 134 bolts/s onto the wire.

/home/user/saber2/src/game/World.js:5241-5267 — the replicated-bolt contract, with the measurement that produced it: 273.1 hp lost on a client to bolts nobody there fired, 317 claims back, a 22% surcharge o

*Can it be saved?* PARTLY, AND ONLY BY GIVING UP THE CLAIM THAT DOES THE WORK.

What actually survives is the thesis — one block, one ledger, two backends — and the derivation of the handover band off `INK.edgeFade`. What does not survive is "the detached bodies change nothing about the wire." Every fix below is a wire change, and stated together they are a different, more expensive design than the one proposed.

1. THE CORPS NEVER LEAVES `world.enemies`. Build it during `beginInsertion` and keep all 54 in the lis
