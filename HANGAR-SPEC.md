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

- `✓` Aft bulkhead is the only real *hull* surface — but this is now honestly
  three surfaces, not one. Two rack walls stand 112 m apart down the length of
  the ship. The first version put them 276 m apart, the full width of the deck,
  which meant a player on the centreline was 138 m from either one and the
  racks were entirely outside his field of view. Every light in the room was in
  those walls, so the room had no light in it and the first render was a black
  void with a floor. Past the ends of the racks the deck opens onto an apron
  with vacuum on three sides.
- `✓` Deck extends out toward the shield and just ends. **Warning strobes at
  the lip, no railing.** The strobes did not exist at all until the audit —
  the word appeared nowhere in `src/` for the hangar — while two files carried
  prose describing where they stood. One instanced mesh, pulsing out of phase
  so the flash runs along the rank rather than blinking together.
- `✓` **No ceiling, ever.** And the thing that broke it was the one object the
  no-ceiling check was written to skip: a 288 × 288 m field plane lying flat at
  64 m, whose fresnel shader is *dimmest* looking straight up at it and
  *brightest* at exactly the grazing angles an overhead is viewed from. It was
  a glowing lid, exempted by material flag and by name. Gone; the invisible
  physics box that stops a player leaving through the top stays.
- `✓` **No bare side walls. It cannot look like a box.** Bays face both ways —
  inboard onto the working deck, outboard onto the apron.
- `~` Haze/fog volume so far rows dissolve. It exists and is driven; it was
  tuned for a 128 m room and is being re-derived off `DECK.lip`.

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
- `~` Camera close-focus when you select one: he breaks attention, turns to
  face you, salutes, holds; deselect snaps him back. **In progress** — there
  was no raycast of any kind in this room.
- `✓` at ease / present arms / salute / sing out / dismissed, all on the wheel.
  Dismissed now breaks the line and fall-in deals it again; both were fields
  written and read by nothing, so "dismissed" was a caption over a company
  still standing rigidly at attention.
- `~` Troops sing/chant on command, faction-specific. On the wheel; the voice
  is being built.

## CUSTOMISING THEM, IN FRONT OF YOU

- `~` Change them live from the hangar — rename, paint, attach. **In
  progress.** There was no UI in the hangar at all, and the only route from the
  deck to the editor was to destroy the room.
- `~` Paint applies as a **sweep, not a pop**. It was a pop by construction —
  `color.setHex(...)`, a single-frame assignment, with no uniform and no tween
  anywhere in the project to sweep with. **In progress.**
- `·` Attachment parts physically drop in from off-frame or are handed over by
  a droid.
- `~` Every change plays a one-shot audio cue. The four exist and are measured;
  their only callers were their own unit test. **In progress.**
- `~` Everything you change is saved on leaving, and everything doable here is
  doable in the main menu. **In progress.** The menu's edit surface is real and
  complete; the deck's was empty, which made the second half of that sentence
  true only vacuously.

## THE DECK, ALIVE

- `~` Crew crossing in the far midground, silhouettes on looping paths. Built
  and stepped; sited 89–142 m out under haze that left them at 0.69–0.95
  extinction, i.e. invisible. Being re-sited.
- `✓` Repair droids on fixed loops. Real and driven.
- `~` A gantry crane traversing overhead. The trolley is real; the rail it
  rides was deleted two rewrites ago, so it slid through empty air.
- `~` A ship mid-repair with a tech, sparks, welding flare. The previous status
  line here said "hull + scaffold placed; no tech, no sparks, no flare" and was
  **exactly inverted**: the tech, the sparks and the flare are all real and
  stepped, and the hull and the scaffold are what had been deleted. A man in a
  jumpsuit hung 4.1 m up welding nothing.
- `~` Sparks, steam vents, coolant hiss. Two independent lists — five visual
  vents against four audio ones, different positions, different periods, no
  shared clock — so the puff and the hiss never coincided. Three were over a
  3.2 m pit.
- `✓` Loader sled crossing with a crate.
- `✓` Idle chatter on the PA, distant and unintelligible. 12/12 announcements
  distinct, no words in the source. The horns were floating in open space.
- `~` Ships pass through the shield on a schedule; launches; damaged arrivals;
  heat shimmer. **In progress.** There was no ship — only an audio pass with no
  geometry, and `DeckAudio` says so in its own prose.

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
- `~` The delayed thump is not yet bound to the flash that caused it: `SkyDome`
  pushes every explosion onto a queue capped at 12 and nothing drains it, so
  the thump you hear is uncorrelated with any explosion you saw. This file
  ticked that bullet while its own last sentence said "nothing drains it yet".
  **In progress.**
- `~` Boot steps for the company walking in. Twenty-four men crossed the deck in
  total silence; only the coalesced halt fired. **In progress.**
- `✓` Walking off the deck takes the deck's sound with it. `undressDeckAudio`
  was imported and called from nowhere, so a twenty-five node hull-hum graph
  kept running under the main menu.

## FACTION PURITY

- `~` **In progress.** `DeckKit.js` had zero occurrences of `faction` or
  `army`, and `parkedFighter` is documented in its own file as "the TIE read" —
  so a Republic player stood in a hangar whose dominant visual element was a
  hundred and forty Separatist fighters. In the section the player said kills
  the whole illusion.
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
- `·` A memorial on the one real wall you walk past.
- `·` Deploy for the run by walking up the gunship's ramp.
