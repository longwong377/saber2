# THE FLIGHT DECK — THE ASK, AS IT WAS GIVEN, AND WHAT IS ACTUALLY TRUE

Every line below is the player's own, from the brief. It is here so that
"finished" can be checked against what was asked rather than against what was
convenient.

Status: `·` not started · `~` partial · `✓` done and driven

---

## HOW THE LAST VERSION OF THIS FILE LIED, BECAUSE IT MATTERS MORE THAN THE TICKS

Four adversarial audits were run over this feature with the instruction to
assume the work was lazy and the ticks were self-congratulatory. They were
right about most of it. The failures were not random — they were four repeating
shapes, and every one of them produced a green suite over a broken room:

**1. A module written, tested, and never called.** `src/physics/Shovable.js` is
420 lines with its own check driving the full knocked-down-and-gets-up cycle
through a real Force push. Nothing in `src/` imported it. `makeShovable`, the
function written specifically to take the row shape `callTheCompany` builds,
had never been called by anyone — including its own test. Every man on this
deck was a hologram the Force went straight through, and the suite was green.
Same shape: `DECK_ORDERS` and `deckOrder` (zero callers anywhere in the
repository), the four `cue*` audio one-shots (callers: their own unit test),
`bootFall`, `turnTo` (imported into `Hangar.js` and never used — an intention,
imported).

**2. A test fixture standing in for the thing it tests.** `DECK.start` — "where
the player is put down" — was read by nothing in `src/`. The level record
declared no `start`, so the engine's literal default `[0, 8]` put the player 82
metres from the composed position, facing the wrong way, with his whole company
behind his back. The only reader of `DECK.start` was the screenshot tool, which
teleported the player there before every frame. **Every picture this room has
ever been judged by was taken from a place the game does not put anyone.**

**3. A stub that agrees with any caller, including a misspelled one.**
`dressHangar` called `engine.sky.configureOrbit(...)`. That method lives on
`engine.skyDome`. The optional chain ate the miss, so there has never been a
planet, a starfield, a fleet, a turbolaser or a dying capital ship outside this
room — and all seventeen ticks in THE PLANET and THE BATTLE below were written
against a shader that has never once executed in the game. It survived because
`tools/checks/_coop.mjs`'s stub engine had **neither** property, so the checks
took the same silent no-op path the browser did, and because the measurements
came from `tools/_orbitprobe.mjs`, which constructs a `SkyDome` by hand and
calls the method on it directly. A probe that builds its own subject tests the
subject and never the wiring to it.

**4. The room was rescaled and everything measured against it was not.** One
commit took the deck from 128 m to 288 m, moved the bulkhead from -46 to -104
and the lip from 64 to 144, and did not touch `DeckLife.js` or `DeckAudio.js`.
Result: a crane riding a rail that had been deleted, a welder standing 4.1 m up
on a scaffold that no longer existed, three steam vents hissing into a 3.2 m
pit, all four PA horns floating 56–82 m from any surface, the "distant traffic
outside the field" flying through the middle of the hangar, and haze tuned for
a 128 m room extinguishing the far wall of a 288 m one at 99.5%.

The checks written since are aimed at those four shapes specifically, not at
the symptoms: a stub that carries the real `SkyDome`, an assertion that the
window is configured, a coordinate audit that every placed prop has something
under it, and derivations off `DECK` rather than literals everywhere a distance
appears.

---

## THE ROOM

> V11, 1 Sep: *"the hangar was too big outside of the side walls like you had
> decent looking side walls but you were able to go behind them and it's just a
> janky mess on the edges, also ships were going through the side walls, give the
> hangar a solid ceiling (but very high up even higher than the side walls) but
> the ceiling can't make the hangar look like a shitty box"*. The rule this file
> carried for five versions — one wall, no ceiling, ever — was the wrong rule,
> and it was the player who said so. `tools/checks/hangar.mjs` now holds HIS
> room, by ray, on the real scene.

- `✅` **Closed on five sides, open on the sixth.** Two rack walls run the full
  length at x = ±80 (collider face ±72.5), the bulkhead is aft at −104 with the
  lift lobby cut into it, the lid is at y = 96. Thirteen of sixteen bearings
  out of the middle of the deck are stopped inside 170 m; the three forward
  ones reach space. There is nothing behind the walls to walk to. Check:
  `hangar: a room closed on five sides and open on the sixth, which is forward`.
- `✅` **A lid, not a box.** The ceiling plate is above the walls, and under it
  girders, beams, cable runs, crane rails and hung fighters: a fifth of the
  deck's up-rays stop on hanging structure well below the plate, the rest on
  the plate. `deckColliders` closes the top at the same height, so nothing
  leaves that way. Check: `hangar: a lid, high over the walls, and busy
  underneath — not a box`.
- `✅` **The opening is the whole view, and the planet is in it.** 24 of 25
  forward rays from thirty metres inside the lip reach space; the SkyDome's
  planet bearing is read off the real dome and has to be forward (z > 0.85):
  `SkyDome._placeByPhase` takes the aperture's azimuth and scores the orbit's
  candidates against it. Check: `hangar: the deck ends at the field, and the
  planet is in the opening`.
- `✅` The deck is 288 m long, flat, and `DECK.lip` is the heightfield's edge;
  the field, the rim, the strobes and the forward barrier all stand off it.
- `✅` **Two pads, one table.** `PADS` in Hangar.js: pad A (the transport's) at
  (−30, 14) r 15, 0.45 m proud; pad B (the shuttle's) at (44, 96) r 15, 1.2 m
  proud. Each collider is three boxes a third of a turn apart — a twelve-sided
  plate the width of the drawn disc — and `deckFloorAt` answers the same disc,
  so a man on the pad stands on it rather than in it. `world.floorAt` is the
  one floor query on the deck: pads, the transport's ramp and bay
  (`DeckFlight.hullFloorAt`), else the heightfield. `Shovable` reads it under
  the whole body box, not the centre.
- `✅` **A mirror floor.** `DeckMirror.js`: a planar reflection of the room in
  the deck plane, dark (0.18 head-on to 0.45 grazing), smeared along the
  vertical, once per frame, off on the lowest tier, half-res on medium.
  Suite: `deckmirror` (11 checks).
- `✅` The insignia is the army's: Separatist hex-and-bars, Republic hub-and-
  spokes without the wheel ring (`DeckKit.insigniaParts`); the ground and
  wall marks are the same parts.
- `✅` Haze solved off `DECK` rather than typed; the field planes fog with the
  rim on them.

## V11 — THE HUB (1 Sep)

The player's V11 notes, and where each one stands. Each `✅` names the check
that goes red without it.

- `✅` **Fresh troops on a fresh run.** A company with nothing on its roll is
  minted from the muster slate (`Muster.lineup`, `saber.muster.v1`) so the
  deck has men to customise before any mode has been played; a dressed
  recruit survives a re-mint. Checks: `deckedit` (6 veterans + recruits),
  `barracks: a dressed recruit survives a remint`.
- `✅` **You arrive by lift.** `DeckLift.js`: the spawn is inside the car with
  the doors shut, the shaft streams past the panes at 46 m/s, the doors part,
  you walk out on your own feet, the doors close and the car leaves. The call
  key at the doors brings it back, and riding it out raises `onDeckLeave` —
  the main menu. Suite: `decklift` (3 checks, driven: no step out of the car
  is larger than a walking step).
- `✅` **You leave by ship, and come home by it.** `DeckFlight.js`: the army's
  real transport stands on pad A on its belly with its ramp on the pad; the
  dwell at the ramp's foot sends the company up it in file, seats you when you
  walk into the bay, seals, lifts, runs out through the field (with its ripple)
  and asks main.js for the deploy only past `DECK.lip + 200`, where the
  insertion's own orbit phase carries the capital ship astern and shrinking,
  the planet growing, and the atmosphere entry it already had. A run that ends
  with you standing (`withdrew` or won, not a session, not a dojo) comes home:
  `enterHangar({card})` builds the deck with `deckArrival`, the hull comes in
  from 640 m out, turns, lands, drops the ramp, puts you off and the company
  walks back into the crowd, and the run's card is raised on the deck. The
  dwell will not board you again until you have walked away from the ramp.
  Suite: `deckflight` (3 checks). `main.js gameOver` → `homeward`.
- `✅` **The company waits in the crowd and files in on the order.** The deck
  stands a crowd of other troopers (`CROWD`, 18, in `crowdL`/`crowdR`); your
  men stand among them at port arms until `fallin`, then walk to the line with
  the real gait (`BipedAnimator`), rifles seated by the field's own
  `seatWeapon`, cloth capes (`attachTrooperCape`). A staggered start is a man
  standing until his turn — it used to teleport him to the line. They walk
  round you, not through you, and climb the pads' kerbs at a step's pace.
  Checks: `deckflight: the dwell boards the company…` (no man moves more than
  0.3 m in a frame), `deckedit`, `trooper-cape`.
- `✅` **Not bowling pins.** A man on his post is planted: a brush from the
  player's capsule under `SHOVE.shove` (3.2 m/s) is undone and he is put back
  on his mark; a Force push or a hurled crate still puts him over. `Shovable`
  reads the floor under the whole body box. Check: `deckplay` shove rows.
- `✅` **The blade is yours on the deck.** It comes out down as you leave the
  lift; the ignite key lights it; a stroke meets every body on a `Shovable`
  (`Hangar.deckBladeTargets`) and puts him over, and the plate scars under it.
  `throw` and six powers still refuse out loud. Check: `deckplay: the blade
  comes out down, the ignite key lights it, and a stroke puts a man on the
  deck`.
- `✅` **No solid UI backgrounds.** Every screen over a live world is the game
  through an 18% scrim (the pause card is over the paused game); every screen
  with no world carries the menu plate. Suites: `backdrop`, `pause-card`.
- `✅` **Troopers hold their rifles.** `Enemy.seatWeapon`/`_poseRifle`: the
  stock in the shoulder pocket, the bore on the target, the support hand on
  the foregrip read off the weapon's own hold points; blasters rebuilt to
  reference lengths. Suite: `rifle-hold`.
- `⚠️` **Density, real ships, workers with physics, receding traffic, PA
  lines** — `DeckLife.js`/`DeckCast.js`, in progress on the life lane as this
  is written; `decklife`/`deckcast` are the checks. **Lived-in paint** —
  `Command.js` paint tables, in progress on the paint lane; `worn-paint` is the
  check. **Every NPC against its reference** — the NPC lane;
  `reference-fidelity` is the check. See PLAYTEST.md's V11 table for the
  state at the end of the session.

## THE COMPANY

- `✓` You give an order, audibly, and it calls your troops — **and it is the
  real order wheel**, the same held key and flick the fight uses, with the
  deck's own table in it. `HUD` gates that wheel on `world.command`, and
  `World` assigns that field below its own early return for this level, so the
  deck had none and every one of `DECK_ORDERS` was unreachable by any input the
  game has. Note the hazard this exposed: `main.bank()` is gated on
  `world.command` being truthy and its rule for a deployed man not on an
  extraction manifest is that he is **dead** — so opening the wheel put the
  entire permadeath roll one forgotten exit from being struck off on every
  visit to the room built to look after it. `bank` refuses a deck adapter by
  name now, and the check asserts that against `bank`'s own source.
- `✓` Troops file in from off-camera in a loose column, then snap to formation.
  The doors they come through are the bulkhead's, derived from `DECK.aft`. They
  used to be a literal `z: -44` against a bulkhead at -104 — the company
  materialised 60 m out in open deck, four metres from its own marks, and
  "filing in" was eleven bodies interpenetrating at two points and fanning
  sideways. The player stands 18 m forward of the doors so they march past him.
- `✓` Staggered arrival — start, pace and distance all differ per man. Two of
  those three read the *same* random draw, so the late starter was always
  exactly the slow walker: one number wearing two hats. Decorrelated.
- `✓` Idle micro-motion at attention: breathing, weight shifts, helmet turns,
  one man adjusting his grip. This was the one bullet in the section that was
  genuinely finished and driven — and on the real spawn no player had ever
  seen it, because he was facing the other way.
- `✓` They face the player. `man.facing` and `fig.root.rotation.y` were both
  set to π, in different frames, and cancelled: the whole company stood with
  its back to him under a comment saying the opposite.
- `✓` The line squares up in a ripple. `turnIn` was computed and then the
  rotation was hard-assigned on the very next line; it fed one field no file in
  this project reads.
- `✓` Select one and he breaks attention, turns to face you, salutes, holds;
  deselect snaps him back. There was no raycast of ANY kind in this room, and
  `turnTo` was imported into `Hangar.js` and never used — the bullet, imported
  as an intention. The turn and the salute are re-armed inside their own
  plateau so he holds rather than unwinding.
  **The camera does not move, and that is a decision.** `Player._updateCamera`
  assigns the lens every frame and recomposes from `aimQuat` on the next line,
  so anything written to it is overwritten within the same frame; stopping that
  means taking the mouse away in a room built around walking down a line. The
  close-focus is composed by the subject instead — the pick only reaches 6 m,
  so you walk up to him and he closes the last half-metre himself.
- `✓` at ease / present arms / salute / sing out / dismissed, all on the wheel.
  Dismissed now breaks the line and fall-in deals it again; both were fields
  written and read by nothing, so "dismissed" was a caption over a company
  still standing rigidly at attention.
- `✓` Troops sing/chant on command, faction-specific. Four detuned larynxes
  with vibrato and a falling cadence against three near-identical squares with
  neither; two halves of one performance within 0.4 dB of each other, because
  a chant repeats. No phrase anywhere in the module, asserted over the whole
  file rather than over one function.

## CUSTOMISING THEM, IN FRONT OF YOU

- `~` Change them live from the hangar — paint and attach are live on the body
  in front of you; **rename is not reachable from a key**. The API is complete
  and checked, but text entry cannot be a bindings action and suppressing WASD
  while typing needs a change where `_move` runs. Said plainly rather than
  ticked.
  There is no DOM panel either, deliberately: the deck is pointer-locked and a
  lost lock routes straight to `pause()`. A read-only caption and the wheel do
  the work.
- `✓` Paint applies as a **sweep, not a pop**. It was a pop by construction —
  `color.setHex(...)`, a single-frame assignment, with nothing in the project
  to sweep with. It is a per-vertex mask rather than a shader uniform, because
  the deck draws MERGED skins and a uniform would have to survive a material
  clone, agree with the merge key and recompile per figure. A height edge runs
  boot to crown: measured at 0.72 s, 35 frames of movement, 34 of them with a
  genuine wet edge — and the check asserts it takes more than one frame, which
  is what would catch a regression back to a pop.
- `~` Attachment parts drop in from off-frame — a plate falls 4.6 m over about
  0.6 s and the man is rebuilt at the landing. Honestly: a kit change rebuilds
  that one man, because a pauldron is geometry baked at build time and there is
  no runtime attach point. The rebuild is hidden under the landing part.
  Nobody hands it over; there is no droid in that loop yet.
- `✓` Every change plays a one-shot audio cue. All four are called and
  asserted. Their only callers had been their own unit test — the textbook
  case of this whole effort.
- `✓` Everything you change is saved on leaving, and `Company.dress` is still
  the single writer — write first, then wear, exactly as the menu does. The
  check enumerates both surfaces and asserts set equality, so the two cannot
  drift. It used to be true only vacuously, because the deck's surface was
  empty.

## THE DECK, ALIVE

- `✓` Crew crossing in the far midground, silhouettes on looping paths. They
  were sited 89–142 m out under haze that left them 69–95% extinguished — built,
  stepped, and invisible. 59–105 m now, as fractions of `DECK`, and one lane
  that walked down into the pit and out again is pushed off it at dress.
- `✓` Repair droids on fixed loops. Real and driven.
- `✓` A gantry crane traversing overhead. The trolley was real and the rail it
  rides had been deleted two rewrites ago, so a crane crab slid through empty
  air at 10.35 m. There is a 16 m portal gantry under it now and the stroke is
  read off the rail rather than typed.
- `✓` A ship mid-repair with a tech, sparks, welding flare. The previous status
  line said "hull + scaffold placed; no tech, no sparks, no flare" and was
  **exactly inverted**: the tech, the sparks and the flare were all real and
  stepped, and the hull and the scaffold were what had been deleted — a man in
  a jumpsuit hanging 4.1 m up welding nothing. A 15 m hull section on four
  splayed jacks and a two-lift scaffold with a ladder, and he stands on it.
- `~` Sparks, steam vents, coolant hiss. Both lists are re-sited off `DECK`
  and off the real heightfield — three used to hiss into a 3.2 m pit — and the
  audio ones are slid along the wall until `terrain.height` says deck. They are
  still **two lists with two clocks**, so a puff and a hiss at the same vent
  are not the same event. Named rather than ticked.
- `✓` Loader sled crossing with a crate.
- `✓` Idle chatter on the PA, distant and unintelligible. 12/12 announcements
  distinct, no words in the source. The horns were floating in open space.
- `~` Ships pass through the shield on a schedule; launches; damaged arrivals.
  All three exist now with geometry and sound on one clock: an arrival through
  the forward field with a smoke trail, a ring, a flare, a hard landing and
  deck grit blown sideways; it cools; then clamps, spin-up, taxi and punch out
  through the same field, with two crew retargeted as the fire crew and handed
  back. Periods of 46 s and 31 s so the two never resolve. There was no ship at
  all before — only an audio pass with no geometry, and `DeckAudio` said so in
  its own prose.
  **Heat shimmer is a heat plume, not a shimmer.** A real one is a screen-space
  refraction pass and no file in this feature owns a pass. Said in the code.

## THE FIELD

- `✓` Visible energy plane with a hex/interference pattern. **The hex term was
  identically zero.** It multiplied `sin` of the object-space z of a
  `PlaneGeometry`, where every vertex is at z = 0 — on all four planes, always.
  And the frequency was a hectometre: one cell was 105 m across. Two terms now,
  and metres.
- `✓` Ripples outward from anything that passes through. Real, driven, and this
  file had it marked not-started.
- `✓` Flickers and browns out when a big hit lands. Same — real and mis-marked.
- `✓` Audible pressure differential at the boundary. Real and driven; the
  measurement was taken from a spawn the game never used.
- `✓` Debris hits it from outside and burns off in a flare. Real and mis-marked.

## THE PLANET · THE BATTLE

**All seventeen bullets were ticked and none of them had ever rendered.** See
shape 3 above. The shader work behind them is genuinely good — the terminator
quantised to three plates, the ice line derived from the ground swatch's own
brightness, the cloud deck at 0.62× the surface rotation, the two-gate
quantised city lights, three capitals and four cruisers, six turbolasers at
6.4–13.3 s with the bolt a sixth of the gap, four dogfight passes drawn as
segments, a capital ship dying over 240 s with the list rolling as t², sixteen
tumbling debris chunks, a starfield at 3:1 parallax against the orbital drift —
and every line of it was unreachable because of one word.

- `✓` It is wired now, the faction goes with it, and the theatre record is
  handed over **before** the level is dressed rather than one line after
  `await buildWorld` returns — which is inside the await, so the planet had
  always been derived from the hangar deck's own near-black floor swatch
  instead of from the map the player picked.
- `✓` A check asserts the orbit is on the dome the engine owns, that the uniform
  is set, and that the faction went with it. The stub engine carries a real
  `SkyDome` so that check can see anything at all.

## SOUND

- `✓` Deep hull hum bed, PA, muffled battle thumps, dopplered repulsor whine,
  footsteps changing material at the lip. All real, all driven, all measured.
- `✓` The delayed thump is the flash you actually saw. `SkyDome` pushes every
  explosion onto a queue capped at 12; nothing drained it, so the thump came
  off an independent random timer. `drainBlasts` runs in `HangarDirector.update`
  and replays each flash's own strength and delay — 3 flashes, 3 thumps, at
  0.88/1.9/2.1 s. This file ticked that bullet for weeks while its own last
  sentence said "nothing drains it yet".
- `✓` Boot steps for the company walking in. Twenty-four men crossed fifty
  metres of plate in total silence — `bootFall` existed, was measured, and had
  no caller in `src/`. `bootStride` integrates distance rather than counting
  frames, so a man who walks further takes more steps: 24 men over 56 m gives
  930 boots coalesced to 239 sounds, 10 voices at peak against a cap of 15.
- `✓` Walking off the deck takes the deck's sound with it. `undressDeckAudio`
  was imported and called from nowhere, so a twenty-five node hull-hum graph
  kept running under the main menu.

## FACTION PURITY

- `✓` Two palettes, six ship silhouettes, two insignia, two light
  temperatures, two PA voices, and the fleet outside. `DeckKit.js` had zero
  occurrences of `faction` or `army`, and `parkedFighter` is documented in its
  own file as "the TIE read" — so a Republic player stood in a hangar whose
  dominant visual element was a hundred and forty Separatist fighters.
  And the resolution itself was broken twice over: `factionOf` tested every
  candidate for being a string while `armyToLead` returns the army RECORD, so
  a Sith player's hangar was a Republic hangar wall to wall; and the room was
  steering off `settings.army`, which nothing in this project writes.
- `✓` The battle outside now takes the faction, so a Separatist player no
  longer watches his own fleet fire Republic-blue.
- `✓` A Separatist player with an empty Separatist roll is no longer handed the
  Republic company. The fallback was `|| rolls[0]`, three lines under a comment
  promising exactly that could not happen.

## PLAY

- `✓` Force powers work in here: shove the line over, they get up and re-form.
- `✓` Pick up crates and throw them at the shield. The crates sat 73–114 m from
  the nearest field plane against a measured throw of 45.6 m, so the one bit of
  play this room had could not be performed from where any of them stood.
- `✓` Physics on everything in the hangar. **Nothing built in this room had a
  collider.** `world.statics` is read in exactly one place in the project: the
  disposal loop. The player walked through both rack walls, a hundred and forty
  parked fighters, the bulkhead, the catwalks and the pit.
- `~` Walk to the shield edge and stand there — reward it with the best view in
  the scene. The walk works and the pressure model is real; the *view* only
  started existing when the window was wired.
- `~` Every single thing in that hangar is modelled and real. Honestly: 140
  racked hulls of 3 kinds, 8 builders, ~2400 primitives in 9 merged meshes.
  Against a real combat level it is about a quarter of the triangles. Better
  than it was; not yet the claim.

## MINE, ADDED ON TOP

- `✓` The muster call reuses the real order wheel.
- `✓` `ORDER_REACH` applies: the deck adapter measures to the nearest man and
  refuses past 34 m, using the fight's own constant. The player lands 30 m from
  the line, so three paces the wrong way and they stop hearing him.
- `✓` The line is the persistent roll, dealt by `squadPlan`, led by `leadOf`.
  One correction to the old claim: there are no "gaps where last run's dead
  used to stand" — a fallen man is off the roll entirely, so the line is
  shorter, not gapped. The only gaps are the squad separators.
- `✓` A memorial on the one real wall you walk past. The roll has always
  carried its dead and nothing had ever drawn them. A recessed panel beside the
  doors, one lit bar per name, no numerals — rule 7, and a name stencilled two
  metres high on a bulkhead is a label rather than a memorial.
- `✓` Deploy for the run by walking up the gunship's ramp. The only way off
  this deck was the pause card's Menu button, so the hangar was a cul-de-sac
  you backed out of. A dwell on the apron at the foot of the near pad — not a
  tripwire, so walking past the ship on the way to the shield does not launch a
  run — and it asks `main.js` rather than deciding what a run is.
