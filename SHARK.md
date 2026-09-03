# SHARK — the station expansion

**One lived-in ship, not a menu of rooms.**

---

# PART I — SESSION HANDOFF

*Read this part first. It is the whole state of Shark as of the end of this
session. Part II is the plan itself.*

## Status: nothing is built

**Zero lines of Shark exist.** No branch, no files, no commits, no imported
geometry. This document is the entire deliverable. That is deliberate — the
player asked for the plan, then a handoff, then a fresh session.

Everything below in Part II is design, not description. Do not read any of it as
"already done."

## What Shark is

Battlefront Borz has a hangar you fight out of. The player has, from a different
project, a procedurally generated 8 km ring-and-spine space station in glTF.
Shark makes that station **the ship the game lives on** — the hangar becomes one
of its bays, the elevator leads out into the rest of it, and the vessel you fly
out of on every mission is the new hull.

The name is the player's.

## The one idea to not lose

**The bundle gives us ROOMS. It does not give us a SHIP.**

The 34 interiors were authored independently, each in its own local frame. They
do not join. There are no corridors between them, and nothing guarantees two of
them can meet at a doorway. **The ship is the thing designed BETWEEN them** —
concourse spines, lift cores, the rail, the galleries that let you stand and see
three decks down. The imported rooms are set dressing hung on that skeleton.

Getting this backwards produces boxes behind an elevator, which is the thing the
player explicitly rejected.

## The player's words, verbatim — the acceptance criteria

Quoted because paraphrasing them is how they get diluted:

- *"I would want the player's ship to be the new one that we're bringing in as
  it's way more detailed than whatever we have now, and then the good interiors
  we keep and incorporate into our build as you will design the layout of the
  interior ship and add our interiors accordingly while leaving room for more
  additions and parts in the future."*
- *"I don't want any of the shit from the 'Opus 5' other repo to contaminate our
  good game. If this all goes to shit and doesn't work I don't want it to fuck up
  Battlefield Borz."*
- *"I want to be sure that the relatively highly detailed aspects of the stuff
  we're bringing in won't be turned down quality wise… I wouldn't want to lose
  anything other than everything being converted to cell shaded."*
- *"I wouldn't want it to feel like two separate games. Like I would [want] to be
  able to walk the ship with or without my companion, use the ships transports,
  etc. like everything on the ship (that you can touch) will need to have physics
  and [be] modeled just like anything else in Battlefield Borz (pick up shit
  etc.)… colliders/ragdolls the whole thing."*
- *"It shouldn't be a bunch of different rooms/boxes that you visit through the
  elevator it has to feel like a real capitol/space station ship you know what I
  mean like large concourses, passenger rails, elevators connecting the different
  floors etc. Like I know the lazy way would be little separate boxes but you
  need to take time and plan it out like a real ship."* **Babylon 5. A lived-in
  real thing.**
- *"The trashy residential quarters and the bars look bad"* — cut them, and all
  the PBR material/texture work with them.

## Decisions already settled — do not reopen without asking

1. **Missions depart from the Borz hangar.** Not the station's docking bay. The
   player settled this directly. `Extraction.js` and `DeckFlight.js` are not
   touched; the station is never on the mission path.
2. **You still see the new hull on every launch.** Same bay, new ship around it.
   Departure point unchanged ≠ view unchanged.
3. **The residential quarters and bars are cut.** So are all 245 PBR materials
   and all 49 texture triples.
4. **Detail is not decimated.** Cut a room whole before gutting one.
5. **The layout is authored by me**, in a table, with empty sockets for rooms
   brought across later.
6. **The Venator and Lucrehulk stay** as fleet traffic. Only the player's own
   vessel changes.

## The source bundle

Repo `longwong377/Opus-5`, branch `claude/aaa-game-development-j6y2ml`,
directory `handoff/`. Not yet attached to any session — Phase 0 attaches it.

- 35 glTF 2.0 models, 3.6 MB Draco-compressed, 133 MB uncompressed
- Exterior hull: 8 km, 824 KB, bbox 2421.7 × 1253.1 × 8046.9
- 34 interiors, metres at 1:1, Y-up
- No embedded materials. `materials.json` holds 245 materials whose `binds`
  arrays are mesh-name fragments; 49 albedo/normal/ORM texture triples
- Visual meshes only — **no colliders ship with it**; Shark generates them
- `manifest.json` gives triangles/meshes/bytes/bbox per file

## Traps I already walked into — don't repeat them

- **"The engine can't load glTF."** I argued this first. It is true (no
  `GLTFLoader`, no `DRACOLoader`, no runtime binary fetch) **and irrelevant** —
  conversion is an offline Node step and the browser never sees a GLB. Same
  posture as `tools/pack.mjs`.
- **"One `LEVELS` key per room."** My second proposal. It is exactly the
  boxes-behind-a-lift design the player rejected. One district, many regions.
- **"Decimate hard."** My third. The player said no. Bytes come from
  quantisation and bind-group merging, both lossless to the eye.

## Ground rules inherited from Borz

- Vanilla ES modules, three.js r169 vendored, Rapier, **no build step**.
- Gate: `node --import ./tools/register.mjs tools/verify.mjs`. One suite:
  `tools/_one.mjs <suite>`. One check: `tools/_onecheck.mjs <suite> "<substr>"`.
- **HANDOFF §2.3b — a check that cannot fail is a defect.** §2.4 — never restate
  a rule, import and call it. §2.2b — don't commit another lane's in-flight work.
- **If you delete a check, grep for its name before you commit.** Earned the
  hard way this session: a commit message claimed a check that did not exist.
- Cel is global. `src/toon/Cel.js` rewrites three's physical program at boot;
  roughness and metalness are inert, and `cel.mjs` asserts `TER_RELIEF === 0`,
  which is why normal maps cannot come across.
- Instance-wrapping is the house pattern for extending shipped behaviour without
  editing shipped files.

## Where Borz itself stands

- V13 shipped. Merged to default `claude/lightsaber-combat-game-lxw391`
  (`3eb744d`, `e297708`). Companions and the two new saber forms are in.
- **The play link is deliberately DOWN** at the player's request. `index.html`
  is a holding page; `index.play.html` is the real one. **Do not restore it
  without being asked.**
- Last gate: **2551 passed, 3 failed** — `levers` (a known V12 design question),
  `company` (green alone at 28/0, order-dependent), and **`deckcast`**, which
  measures 1.57–2.09 ms against its own 1.5 ms budget while none of its three
  files changed since it was green at V12. `deckcast` is a Shark blocker, not a
  curiosity: see Phase 5.
- Development branch for this lane: `claude/saber-game-improvements-v12-6f83co`.

## First moves for the next session

1. Read Part II end to end.
2. **This document is meant to be reviewed before it is built.** The player
   intends to put Shark to Fable 5.1 for critique and revision. Expect Part II to
   change. Do not start Phase 1 against an unrevised plan.
3. When building does start: Phase 0 (measure) gates everything else. Nothing
   downstream can be sized without the manifest table.

## For the reviewer

The parts I am least sure of, ranked — start here:

1. **Phase 3, the ship design.** The whole thing is won or lost there and it is
   the least specified part of this document. It is design work before it is
   code, and I have not done it.
2. **Whether the rooms join at all.** Independently authored models. Some pairs
   will not meet at any doorway. This is the most likely place scope explodes.
3. **Region activation vs. real streaming.** I chose activation because it is far
   less risky and the engine is already distance-driven. It may not hold at a
   kilometre.
4. **The packed 16 MB cap.** The hull fits. Every interior will not. I have not
   measured which ones do.

---

# PART II — THE PLAN

## Context

Battlefront Borz's player ship is a builder-generated capital ship. The player
has a far more detailed 8 km station from another project and wants it to become
that ship, with its good interiors walkable, so the hangar he already fights out
of is one bay on something real. The outcome he is after is a Babylon 5 — a
lived-in place with concourses and rails and lifts, not a menu of rooms.

The constraint that shapes every choice below: **Borz must not be endangered, and
backing out must be trivial.**

## THE THREE GUARANTEES

### 1. Battlefront Borz cannot be damaged

1. **Its own branch.** The default branch — what the play link serves — does not
   move until Shark works and the player says so. Abandoning it is deleting a
   branch.
2. **New files, not edits.** Shark lives in `src/shark/*` and
   `tools/gltf2shark.mjs`. Edits to existing files are additive and few: a
   destination in `src/game/DeckLift.js`, a branch in `src/game/DeckExterior.js`,
   one `LEVELS` key for the district, and the four obligations of one new
   setting. Nothing deleted, nothing rewritten.
3. **A settings flag.** `settings.shark` off ⇒ not one Shark module is imported
   and the game is byte-identical. `tools/checks/shark.mjs` asserts the off path
   builds the old ship and imports nothing from `src/shark/`.
4. **The Venator stays.** Existing capital ships in `src/game/Vehicles.js` are
   untouched. Reverting is flipping a flag, not restoring deleted code.
5. **The gate is the tripwire.** 2551 checks. In this session alone they caught a
   NaN gait from one missing Player field, a HUD regression lighting powers the
   single blade cannot cast, and a lifted function that had grown a fifth
   dependency. If Shark moves anything in Borz it is red before he sees it.

### 2. It is one game, not two

The rule: **nothing bespoke.** If a crate on the concourse behaves differently
from a crate in the hangar, we have failed. Shark reuses and does not fork:

| Need | What it reuses |
|---|---|
| Materials & shading | `src/toon/Cel.js`, `lit()` from `Bodies.js` |
| Static collision | the same box statics the hangar and levels use |
| Push/pick-up/knock-down | `src/physics/Shovable.js`, `Knockable` |
| Bodies falling | `src/game/Ragdoll.js` |
| Crowd & jobs | `src/game/DeckLife.js`, `DeckCast.js` |
| The companion | `src/game/CompanionDeck.js` — already follows and sits |
| In-station transports | the lift idiom already in `src/game/DeckLift.js` |
| Leaving on a mission | unchanged — still the Borz hangar, still `DeckFlight.js` / `Extraction.js`, neither touched |
| Input, HUD, camera | unchanged |

No new material path, no new physics path, no new NPC system. A check asserts
Shark registers no material type Borz does not already use.

### 3. The imported detail is preserved

**Keep the geometry as authored. If a room does not fit the budget, cut the room
— never gut it.** No blanket decimation. Bytes come from quantisation (16-bit
positions over each model's own box, octahedral 8-bit normals) and from merging
by bind group, both lossless to the eye.

What changes is only shading: 245 PBR materials and 49 textures are discarded for
a bind onto our palette. Under `Cel.js` two of the three maps are inert anyway —
the shader deletes the specular lobes so roughness feeds nothing, and deletes the
line where metalness zeroes diffuse — and normal maps would violate the standing
rule that shaded surfaces carry no detail normals (`cel.mjs` asserts
`TER_RELIEF === 0`).

**Said plainly so it is not a surprise:** cel shading *is* a change in how the
hull reads. Every triangle, panel line and piece of greebling survives, but flat
bands and ink outlines replace specular and soft normals. Detail preserved;
lighting model replaced. That is the point of bringing it in rather than shipping
it as-is.

## The architecture

**A DISTRICT, NOT A LEVEL PER ROOM.** One contiguous walkable space of roughly a
kilometre — Babylon 5's Zocalo-and-corridors scale, not all 8 km. The rest of the
hull is exterior, seen through windows and from the hangar. Under ~1.5 km we stay
comfortably inside float32 and **need no floating origin at all**.

**REGIONS, NOT LOADING SCREENS.** The district is one `LEVELS` key. Within it,
regions activate and deactivate by proximity — geometry groups and their
population enabled or disabled, not async-streamed. Far less risky than true
streaming, and the game already does the hard half: `_applyLod`, the merged skin
at 62 m, the cohort past `L3_AT`, and `world.props`' per-frame tick are all
distance-driven already.

**VERTICAL AND CONNECTED.** Lift cores between decks, a passenger rail along the
spine, galleries that see down into the concourse. The lift out of the Borz
hangar arrives at the **main concourse**, which is the hub; from there the player
walks. Lifts within the district are rides inside one loaded space, not
transitions.

**THE LAYOUT IS AUTHORED, IN A TABLE.** `src/shark/layout.js` places every room
in one 3D frame with its rotation, its deck, its doorways, and the connective
piece that joins it to its neighbour — plus **empty sockets** reserved for rooms
not yet brought across. Adding a space later is a row, which is the "room for
future additions" requirement literally.

## Budgets, honestly

**Two, and they differ.** The play link (GitHub Pages, module tree) has no hard
cap, only load time. The packed single file caps at **16 MB** and sits near 12
minified. 3.6 MB Draco is perhaps 12–18 MB quantised plus a third for base64:
**the hull fits comfortably; every interior will not.** Hence
cut-rooms-not-detail, and the flag also lets `pack.mjs` ship without Shark if the
packed build is the binding constraint.

**And a frame budget that is already red.** `deckcast`'s own assertion —
`stepDeckLife` under 1.5 ms — currently measures 1.57–2.09 ms across five
readings, while none of its three files has changed since it was green at V12
(HANDOFF §6.4). **Populating a district scales that up. It gets diagnosed and
fixed BEFORE Phase 5, not after.**

## Phases

**0 — Measure.** Attach `longwong377/Opus-5`
(`claude/aaa-game-development-j6y2ml`), read `handoff/manifest.json` and
`materials.json`. One table: per model triangles, meshes, bytes, bounding box,
quantised cost, keep/cut. Nothing downstream can be sized without it.

**1 — `tools/gltf2shark.mjs`.** Node-only, run by hand, output committed. Parses
GLB and decodes Draco in Node (a Node dependency never ships — same posture as
`tools/pack.mjs`). Merges by bind group so a room is a handful of draws.
Quantises. Emits `src/shark/rooms/<name>.js` — typed arrays as base64, bind
names, and `build(palette)` returning merged geometry with our materials and
`userData.authored` set. Also emits **box colliders** fitted offline to the
walkable shell (not trimesh — Rapier trimesh for a corridor system is the wrong
tool) and **doorway anchors** the layout uses to join rooms. Per-model report so
converter regressions are visible.

`src/shark/palette.js` is authored, not generated: it maps their bind fragments
onto our vocabulary, and it is the file that makes this look like our game.

**2 — The hull outside.** The vessel the hangar sits inside becomes the station,
via the flag.

Today `DeckExterior.js` builds a capital ship, rotates it so the model's own
hangar mouth aligns with the deck aperture, scales it ×100, hides it until the
camera passes the lip, and marks it `fog = false` / `saberNoInk`. It carries no
collider because **it is a picture you look at through the mouth** — you cannot
walk on it. Phase 2 changes only which model that is. Same code path, same
posture, one new branch.

**And this is the phase you feel on every launch.** `setExteriorSeen` is driven
by the flight each frame with "is the camera past the lip" — the fly-out is
exactly when the hull appears, and it holds the far plane open so all 8 km stays
drawn. **Flying out and back in, you see the new ship.** Every mission, from the
first one after the flag goes on.

So "scenery only, no collider" describes THIS phase, not the finished station.
**The walkable part is Phase 4**, where the district gets real box colliders
fitted offline by the converter. And no floating origin: the district stays under
~1.5 km, and the 8 km hull is a distant unfogged mesh, not something you stand
on.

Fleet action in the sky keeps the existing Venator and Lucrehulk — nothing is
deleted; only the player's own vessel changes, and only with the flag on.
**Shippable alone, lowest risk, delivers most of the scale feeling.**

**3 — The ship design.** The document and the table: decks, spines, circulation,
where each imported room sits, what connective architecture joins them, where the
sockets are. This is where "real ship, not boxes" is won or lost, and it is
design work before it is code. Reviewed against renders before anything is built.

**4 — The district walks.** The connective architecture built in our own
procedural idiom (`Hangar.js` is the model: its own note records that beams,
cable runs, crane rails and hung fighters are what stopped it reading as a box,
after a 3/10 from the player). Region activation. Colliders live. The lift from
the Borz hangar arrives at the concourse and **you can walk from there to a
second space without a load.**

**5 — Lived in.** Extrapolate `DeckLife`/`DeckCast` across the district — jobs,
routes, crowds, droids — after the 1.5 ms budget is settled. Companion comes
along via `CompanionDeck`. Shovables, knockables, ragdolls throughout.

**6 — The ship's own systems.** Passenger rail, inter-deck lifts, and the
in-station transports that move you around the district.

**Missions keep departing from the Borz hangar — decided, not open.** Shark never
sits on the mission path: you launch exactly where you launch today.
`Extraction.js` and `DeckFlight.js` are not touched, and the station's transports
carry you between decks, never off the ship. This is the single biggest thing
keeping the risk low — a bug anywhere in Shark cannot reach a run.

*That is about code and risk, not about what you see.* Same bay, new hull around
it: on every departure and return you fly out of and back into the station
(Phase 2). Unchanged launch point, completely changed view.

## Risks I am not hiding

- **This is the largest thing on the roadmap** — bigger than the companion
  system. Phases 2 and 4 are each worth shipping alone; 5 and 6 are open-ended.
- **The rooms may not join.** They were authored independently. Some pairs will
  not meet at any doorway and will need connective pieces built, or will be cut.
  Discovered in Phase 3, and the most likely place the scope grows.
- **Cel is unforgiving of flat walls**, and imported rooms will need the same
  authored greebling the hangar needed.
- **`deckcast` is already over budget.** Named above; a gate on Phase 5.
- **Some rooms will not fit the packed build.** Cut them, or ship the packed
  build without Shark.

## Files

- New: `tools/gltf2shark.mjs`, `src/shark/{layout,palette,district,regions}.js`,
  `src/shark/rooms/*.js`, `tools/checks/shark.mjs`, `SHARK.md`
- Changed, additively: `src/game/DeckExterior.js`, `src/game/DeckLift.js`,
  `src/game/Levels.js`, plus the new setting's four obligations
- Reference: `src/game/Hangar.js`, `DeckLife.js`, `DeckCast.js`,
  `CompanionDeck.js`, `src/toon/Cel.js`, `src/physics/Shovable.js`

## Verification

- Full gate green; `cel`, `frame-budget`, `hangar`, `packed`, `menu`, `deckcast`
  unmoved, and the deck's 320-draw bound unchanged.
- **The off-path proof:** `settings.shark` off ⇒ gate identical to today and no
  Shark module in the import graph.
- **The one-game proof:** a check that pushes a crate on the concourse and the
  same crate in the hangar and asserts identical behaviour.
- `tools/_soft.mjs` and deck shots on every room — nothing accepted unlooked-at.
- `node tools/pack.mjs /tmp/borz.html --min` under 16 MB, with Shark's cost
  reported.

## Where this stopped

The plan was approved and written here. **Building was deliberately not
started** — the player takes Shark to a fresh session for review first. Part I
is the handoff.
