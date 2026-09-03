# SHARK — the lift goes somewhere

A plan, not a build. Written 3 Sep against this tree and against
`longwong377/Opus-5` at `claude/aaa-game-development-j6y2ml` (7c3df7e, "previews:
every model rendered"). Every number is measured off one of the two repos.
The person carrying it out is expected to be a different session; the last
section is what to hand them.

The player's ask, in his words: *"making our elevator in battlefield borz
connect to this larger ship (essentially replaces the relatively low effort
venerator we have) … only take it if it's good and then plan on filling out
the rest … I rather have a smaller actually working detailed and lived in
ship than a giant expansive ship that is ultimately empty and repetitive …
a home for the player, a habitat for the companions, like almost a game
within a game."*

---

## 0. Verdict, in six lines

1. **The idea is good and cheaper than it looks.** The lift already exists,
   it already "goes" somewhere the player never sees, and the deck already
   has the one thing a hub needs: a reason to come back (the company, the
   kennel, the muster). A second floor on the same lift is the natural next
   room. Do it.
2. **Do not take the other game.** Take four files from it and its one good
   idea. The Opus-5 package is 42 GLBs, 3.4 M triangles, 215 MB, 245
   materials, 14 alien species — and it is, by its own author's measurement,
   *"78 of 128 places from one generic kit"*, *"0 NPCs that travel, work, eat or
   sleep"*, *"one room, five times"*. The previews confirm it. Most of it is
   the empty, repetitive ship the player said he does not want.
3. **Take: the Zocalo, the central corridor, the Starfury, the hull
   exterior.** Judge everything else unworthy of a 28 MB single-file game
   (§2). The crowd library is worse than what this engine already builds.
4. **Build small: one ring, eight rooms, one lift, one fighter.** Everything
   walkable is inside ~600 m of corridor and every room has people in it
   doing something. A "home" and a "kennel" are two of the eight.
5. **The flying is the one genuinely new system**, and it is worth it because
   it closes a loop no other feature can: launch, fly round the ship, look into
   your own hangar from outside, land. Port the flight model, not the Godot
   scene.
6. **Lore does not need fixing.** The player already answered it ("two
   universes colliding … a strange charm"). One name and one line of
   Databank text is all the cover it needs: the capital ship you serve on is
   a *captured* alien station-hull that the Republic bolted a flight deck
   onto. The alien architecture and the mixed crowd become the point, not the
   problem.

---

## 1. What the other game actually is

`longwong377/Opus-5` is a **Godot 4** project (Python generators →
`.glb` → GDScript runtime). Nothing in it runs in a browser; its own
`PLAY.md` says so (*"No, and not for a fixable reason"*). What crosses over is
the `handoff/` folder: plain glTF 2.0, no engine dependency, with
`manifest.json` (placements, triangles, bounds), `materials.json` (245
material rows that bind by mesh-name fragment) and `textures/` (49 PNGs,
33 MB). It was made for exactly this hand-over and it is competent.

The **babylon5** repo (June) is an older three.js/TypeScript "Lethe Station"
with a large NPC simulation in `src/sim/`. It has no models worth taking and
its sim is TypeScript on a different world model. Ignore it for Shark.

**What the Godot game's own author measured** (`docs/SHIP-PLAN.md`,
amendment 4h): 16 distinct place builders over 128 places; 78 from the
generic kit; one corridor generator for 70 ring decks; 0 dialogue; 0 NPCs
that move to a job. The plan there is a plan to fix that inside Godot. It is
not our problem and we should not inherit it.

### 1.1 The inventory, judged from the previews

| asset | tri | verdict | why |
|---|---|---|---|
| `zocalo.glb` | 98 k | **TAKE** | The one room with real architecture: a barrel-vaulted market hall, ribbed arches, galleries, kiosks, tables. Distinct, warm, legible. Becomes the ship's concourse. |
| `shops_kiosks.glb` | 101 k | take with the Zocalo | Same hall's dressing. Cull to the stalls you can stand at. |
| `central_corridor.glb` | 44 k | **TAKE** | A long ribbed corridor with signage frames and lit floor channel; the connective tissue. Loop it, do not tile it seventy times. |
| `starfury.glb` | 4 k | **TAKE** | 16 named sections, 18 KB draco, thruster mounts in `starfury_manifest.json`. A real airframe, and the only vehicle. |
| `hull.glb` | 388 k | TAKE, far only | 8 km hull with cobra bay, docking spheres, reactor spine, greebles. Good at 2-6 km as the thing you fly around; never walked. Needs a floating origin or a scale-model. |
| `cnc.glb` | 19 k | maybe | A decent blue command room with a console dais. Could be the bridge if we want one; a room we can also build ourselves in a day. |
| `obs_dome_1/2`, `obs_rotundas` | 26-42 k | maybe one | Round rooms with windows. Take ONE rotunda as the observation lounge; the others are the same room. |
| `docking_bays.glb` | 33 k | no | A grey box with lamps. Our hangar is far better. |
| `customs_north/south` | 40 k | no | Turnstiles in a grey hall. Nothing to do there without the identicard game. |
| 5 bars/cafés | 6-7 k each | no | "One room, five times", flat-lit, red chairs. Build one cantina ourselves. |
| 6 quarters modules | 28-95 k | no | Corridors of doors. Empty. |
| `hydroponics`, `drum_*` | 57-174 k | no | A 1.8 km rotating garden. Beautiful idea, wrong scale for "small and lived in", and 300 KB+ of terrain we cannot fill. |
| `crowd_library(.low)` | 1.36 M / 123 k | **no** | 14 species × costumes as untextured, low-poly, flat-shaded figures (`crowd_front.jpg`). This engine's `dressHumanoid`/`buildDeckCrew` figures are better in every way and already animate, ragdoll and dismember. |
| `alien_sector`, `kosh_quarters`, plant rooms | 4-44 k | no | Dark boxes. |
| `shuttle_car`, `core_shuttle` | 27-29 k | no | A tram. Our lift is the transport. |

Roughly: **four files, ~530 k triangles before culling, ~2 MB draco.** That
is the whole import.

---

## 2. Why "small and lived in" is the only version that works here

Three measured constraints in *this* repo decide the scale:

- **The game ships as one file.** `node tools/pack.mjs` writes **28.4 MB**
  today (23.4 MB of modules, 25 inlined assets). Every byte of GLB and
  texture goes in that file as base64. The full Opus-5 package would be
  +11 MB draco (+33 MB textures) — a 70 MB page. Four files with the
  engine's own materials is +2 MB.
- **There is no GLTF loader in the tree.** `vendor/three/` carries
  `three.module.js`, a few objects/postprocessing/shaders and nothing else;
  `grep GLTFLoader src tools` returns nothing. Loading the handoff means
  vendoring `GLTFLoader` (+ `DRACOLoader` and its WASM decoder, ~330 KB) —
  see §5.1.
- **The room budget is real.** `tools/checks/hangar.mjs` bounds the deck at
  320 draw calls and the ink pass draws everything twice. A 98 k-triangle
  hall in 44 meshes is fine; seventy generic decks streaming is not, and we
  have no streaming.

Against that, what makes a room "lived in" in this engine already exists and
is expensive to build twice: `DeckLife.js` (111 droids, 20 rigged workers, a
crowd, 25 jobs, PA, traffic), `DeckCast.js` (crew builders, Knockable bodies),
`CompanionDeck.js` (your animal follows you round the deck), `Company.js`
(the men, their looks, their record). **Every room Shark adds should be
populated by reusing those systems**, which means the number of rooms is
bounded by how many distinct *activities* we can give them, not by geometry.
Eight rooms with people doing eight different things beats forty corridors.

---

## 3. The ship — "BORZ STATION", eight rooms and a ring

Rename nothing the player already knows. The hangar stays the hangar. The
lift's readout already counts decks (FLIGHT DECK is 32); Shark gives four of
the other numbers a floor.

```
                 ┌────────────── OBSERVATION LOUNGE (deck 60) ──────────────┐
                 │   the rotunda: a window wall onto the planet and the      │
                 │   battle, benches, a bar, off-duty men, the holo news     │
                 └──────────────────────────┬───────────────────────────────┘
                                            │ lift
   ┌── COBRA BAY (deck 12) ──┐   ┌──────────┴──────────┐   ┌── QUARTERS (deck 44) ──┐
   │ the Starfury's launch   │   │  THE CONCOURSE      │   │ your cabin; the        │
   │ well; a rack of two     ├───┤  (Zocalo, deck 40)  ├───┤ company's barracks;    │
   │ fighters; the catapult  │   │  market, cantina,   │   │ the KENNEL habitat     │
   └─────────────────────────┘   │  kiosks, the crowd  │   └────────────────────────┘
                                 └──────────┬──────────┘
                                            │ ring corridor (central_corridor, looped ~300 m)
                              ┌─────────────┴──────────────┐
                              │  MEDBAY · ARMOURY · BRIG   │  three small rooms off the ring
                              └────────────────────────────┘
                                            │ lift
                                 ┌──────────┴──────────┐
                                 │  FLIGHT DECK (32)   │  ← everything that exists today
                                 └─────────────────────┘
```

**The one rule:** every room has a *verb* the player can do there and *people*
doing something without him. If a room has neither it is not built.

| room | source | what you do there | who is there (reusing what) |
|---|---|---|---|
| **Concourse** | `zocalo.glb` + `shops_kiosks.glb`, culled to one 67 m hall | Walk, browse. The kiosks are the game's existing menus made physical: the forge (hilt/blade), the quartermaster (kits/paint), the recruiter (Muster), the Databank as a library terminal, a cantina table where the company sits between runs. | Crowd from `DeckCast.crewSilhouettes`/the new baked crew, off-duty company men (`Company.js` looks, sitting/eating poses), droids, **a mixed crowd**: reskin 3-4 of the engine's own humanoid builders as "station locals" (the Opus species are unusable, but a Twi'lek/near-human variety pass on `dressHumanoid` is a day's work and matches the art). |
| **Ring corridor** | `central_corridor.glb`, looped into a ~300 m ring with four doors | Get between rooms; meet traffic. | Walkers on errands (the same `walk` job rows DeckLife uses), a droid convoy, a patrol pair, a PA. |
| **Your cabin** | built with `DeckKit` (do not import a quarters module) | The **home**: your saber on a stand, your kills on a wall, the campaign map on a table, a bunk that is the "sleep/advance the clock" verb, a window. Trophies from runs appear here (the ledger already records them). | Your companion sleeps here when not fielded. |
| **The Kennel habitat** | `DeckKit` + `CompanionDeck` | Where the animals live. Walk in, your companion comes to you; retired/dead companions have a plaque; the pup is visibly bigger than last month. Feed/play/groom = the idle-beat layer already in `CompanionLife.js` triggered by an interact key. | Every kind you have ever kept, as deck bodies. |
| **Barracks** | `DeckKit` | The company off duty: bunks, a card game, the muster slate as a physical board. The `Muster.js` slate becomes a thing on a wall. | Company men in sleeping/sitting poses. |
| **Medbay** | `DeckKit` | The wounded from the last run in bacta (the `Injury.js` roll made visible); the 2-1B is here. | Injured men, the medic droid. |
| **Armoury / Brig** | `DeckKit`, small | Armoury: the weapon racks are the loadout screen. Brig: captured droids/prisoners from runs behind a field — flavour, one interact. | A guard, a prisoner. |
| **Observation lounge** | one `obs_rotundas` room, culled | Look at the battle §4 built; the holo-news plays the last run's summary. A bar. | Off-duty men, a bartender droid. |
| **Cobra bay** | `DeckKit` + the launch well measured off `hull.glb`'s `cobra_bay_well` mesh | Board the Starfury. §4. | A ground crew, a second fighter on the rack. |

Total walkable: ~600 m of corridor and eight rooms. Total imported geometry:
~250 k triangles after culling. Total new geometry: kit rooms at DeckKit
density, ~150 k. The whole ship is one `World` level like the hangar is
(`Levels.js` registers `LEVELS.hangar = HANGAR_LEVEL`; Shark registers
`LEVELS.station`), loaded when the lift ride ends on a deck that is not 32.

**The lift is the seam.** `DeckLift.js` already runs a ride, a landing snap,
doors and a readout. Shark adds a *floor selector* (the button column on the
car's panel is already modelled and already lit — it becomes real) and a
level swap during the ride: the car's interior is the same object in both
worlds, so the swap happens behind closed doors at cruise and the player
never sees a load. Under the hood it is `World.unload` + `World.load` of a
different level with `_deckArrival`-style state, exactly what deploying does
today.

---

## 4. The Starfury — the new system, and why it is worth it

Godot has `starfury.gd` (1771 lines) — a **checked port** of a Python 6-DOF
Newtonian model: quaternion attitude, gyroscopic term, a thruster allocator
over nine mounts, no velocity damping (the "hands off, it keeps rotating"
premise). The nine mounts and their positions are in
`starfury_manifest.json`. That model is ~250 lines of arithmetic once the
Godot scaffolding is removed and it is worth porting **because this engine's
existing flight (`Flight.js`, the hawk; `DeckFlight.js`, the scripted
transport; `Driving.js`, ground vehicles) has nothing Newtonian in it**, and a
Starfury that flies like a car would be the "low effort" thing the player is
asking us to stop shipping.

What the loop is:

1. Walk into the cobra bay, climb in (the existing `Driving.whyNotDrive`/board
   path — the Starfury is a `crew: 1` vehicle like a mount).
2. Catapult launch out of the well (scripted 3 s, like `DeckFlight`'s run).
3. Free flight in a bubble around the ship: **the hull from `hull.glb` at
   scale-model distance**, the battle from §4 of the V14 work already out
   there, the planet from `SkyDome`. Six axes, WASD/RF/arrows, kill-rotation,
   kill-velocity, a chase cam and a cockpit cam (the cockpit clear volume is
   in the manifest).
4. **Fly past your own hangar and look in.** This is the shot the player
   asked for and it costs nothing extra: `DeckExterior.js` already stands the
   capital hull with the aperture mapped; from outside, the deck's lit
   interior is visible through the field. The fighter passing the mouth is a
   pass the deck already scripts for NPC traffic.
5. Land: fly into the well, a tractor takes over inside 30 m (scripted
   settle), climb out.

**What it is not:** a combat mode. No guns in the first cut. If the player
wants dogfights later, `Bolts.js` and the fighter swarm in the outside battle
already have the pieces. Cutting guns keeps the first Starfury commit at
"flight model + launch + land + cameras", which is one lane and one check
suite (`flight-newton.mjs`: conservation of momentum with hands off, the
allocator's nine mounts sum to the requested wrench, launch/land settle).

**Scale trick, stated once:** the hull is 8 km long. Do not fly 8 km. Stand
it at 1/10 (800 m) with the cobra bay and the hangar mouth at true size on a
locally-true patch, or keep it 1:1 and give the flight world a floating
origin. The 1/10 diorama is what the outside battle lane already does for
capital ships and it is the recommendation: the player is never more than
~2 km from the deck and the far plane stays sane.

---

## 5. The technical path

### 5.1 Loading glTF in this engine

- Vendor `GLTFLoader.js` and `DRACOLoader.js` from three r16x examples
  (match `vendor/three/three.module.js`'s version — check its header) plus
  `draco_decoder.wasm` + `draco_wasm_wrapper.js` (~330 KB). The pack
  inlines them as `data:` URLs like every other asset; `DRACOLoader.setDecoderPath`
  must point at a blob/data URL, which `tools/pack.mjs` already knows how to
  rewrite for `import.meta.url` → `location.href`. **Do not use the gstatic
  CDN** the handoff README suggests: the packed game must work offline and
  `wiring.mjs` will (rightly) refuse an external URL.
- Ship the four GLBs draco-compressed, in `assets/station/`. Strip what is
  not walked (`shops_kiosks` has 44 meshes; keep ~15).
- **Materials:** do not import the 49 textures. Bind the engine's own
  `propMaterials`/`deckMats` by mesh-name fragment, the same way
  `materials.json` binds — a 30-line table mapping `bay_*`, `kiosk_*`,
  `corridor_*` fragments onto the deck palette so the concourse is lit and
  coloured like the hangar (same key/fill rig, same ink pass). This is what
  makes an imported room look like *this* game rather than a visitor.
- **Colliders:** the handoff says its meshes are visual, not colliders, and
  its corridor floor has a 66 mm channel a capsule wedges on. Do what the
  hangar does: a flat `world.floorAt` plane per room plus `addStaticBox`
  walls from the room's bounds and a handful of boxed props. Never a trimesh.
- **Scale/orientation:** metres, Y-up, room +y points *inward* on the
  station (their floors are the outer wall). Each room is in its own local
  frame near the origin — ignore `placement`; we are not assembling their
  station. Rotate each room flat once at import and cache the matrix.

### 5.2 The level

- `src/game/Station.js` — `STATION_LEVEL` in the shape of `HANGAR_LEVEL`
  (`terrain: flat deck preset`, `atmosphere: { sky: false }`, `dress`,
  `lights`). Rooms are placed on a plan table (x, z, yaw, door edges), the
  ring corridor is instanced from the corridor GLB's 120 m module bent into
  four straights and four turns (build the turns from `DeckKit`; a bent GLB
  is worse than a kit corner).
- `src/game/StationLife.js` — reuses `DeckLife`'s job-row shape
  (`{kind, x, z, path, phase}`) for the crowd, and `DeckCast`'s builders. One
  table per room. Aim: 120 figures across the ship, 30 rigged near the
  player's paths, the rest baked poses with Knockable bodies (the V14 hangar
  lane is building exactly this).
- `src/game/Home.js` — the cabin's state: trophies (read the ledger),
  the saber stand (the current hilt), the map, the bunk verb.
- `src/game/Habitat.js` — the kennel room over `CompanionDeck.js`: every
  record in `Kennel` gets a body, the live one follows you, retired ones
  have plaques; three interacts (feed/play/groom) that fire `CompanionLife`
  beats and bank a small `story` line.
- `DeckLift.js` — the floor selector and the swap. The ride's vignette strip
  (V14) is authored so that the decks the player can stop at are real
  vignettes at the right numbers.
- `src/game/Starfury.js` — the flight model + cockpit/chase cameras;
  `Vehicles.js` gets the airframe as a registered hull like the others.

### 5.3 Checks that can kill each step (the repo's rule)

- `station.mjs`: every room reachable on foot from the lift (a ray-walk),
  every door crossable, every floor at `floorAt` height, draw calls ≤ the
  hangar's bound + 40, no external URL in any loader path.
- `stationlife.mjs`: ≥ 100 figures, every one with a body, every room's job
  table non-empty, step ≤ 1.5 ms.
- `home.mjs`/`habitat.mjs`: the trophy wall reflects the ledger; the kennel
  shows every record; the pup's size on the deck equals `bodyScaleOf`.
- `starfury.mjs`: momentum conserved hands-off, allocator sums, launch ends
  outside the well, land ends inside it, never through the hull.
- `packed.mjs` (exists): the single file boots with the station in it; pack
  size ≤ 34 MB.

---

## 6. Build order — five commits a session could actually make

Each step ends in something playable and a check that fails without it.

1. **Loader + one room.** Vendor GLTF/Draco, pack support, the Zocalo
   standing in a new `station` level lit with the deck palette, reachable by
   the lift's new floor button. *Gate:* `station.mjs` walks it; pack ≤ 31 MB.
2. **The ring and the kit rooms.** Corridor loop, cabin, barracks, medbay,
   armoury, brig, lounge as DeckKit rooms with doors. Empty. *Gate:*
   reachability from the lift to every door.
3. **Life.** `StationLife` tables for every room; the company off duty; the
   kennel habitat; the home's trophies and bunk. *Gate:* `stationlife.mjs`,
   `home.mjs`, `habitat.mjs`. This is the step that makes it "lived in" and
   it is the one to spend the most time on.
4. **The Starfury.** Airframe, flight model, cobra bay, launch/land, the
   pass by the hangar mouth. *Gate:* `starfury.mjs` + a screenshot from the
   cockpit looking into the deck.
5. **The mix.** Station locals (near-human variety on the engine's own
   builders), the concourse kiosks wired to the existing menus, the holo-news
   in the lounge reading the last run. *Gate:* `menu.mjs` still green (the
   kiosks are the same panels), a browser sweep of every interact.

Steps 1-2 are one session. Step 3 is the biggest. Step 4 is one lane on its
own. Step 5 is polish that can trail.

---

## 7. What I would cut from the original Shark discussion, and why

- **"Replace the Venator."** Don't replace the *ship*; replace the *idea that
  the deck is a lobby*. The Republic hull outside the aperture stays (it is
  the thing the extraction sequence flies away from). Shark's fiction is that
  the hull the deck is bolted into is the alien station-hull; from outside,
  `hull.glb`'s spine and the Venator-style flight deck read as one captured,
  converted thing. Cheaper, and it is the "two universes" charm the player
  named.
- **The drum, the sectors, the 24 docking bays, the customs game.** All the
  size with none of the life. Every one is a future *room* if a verb ever
  needs it; none is a reason to exist now.
- **The crowd library.** Worse than ours. Not a single mesh.
- **The identicard/civil game from `THE-GAME.md`.** A different game. The
  player's game is the war; the station is where you live between runs.
- **Streaming.** Eight rooms in one level fit the budget. If they ever do
  not, the lift is the load screen and always was.

## 8. Decisions only the player can make

1. **Guns on the Starfury in the first cut?** Recommendation: no.
2. **Lounge or bridge?** The `cnc.glb` room could be a bridge with an officer
   who gives the next campaign. It is a ninth room; recommendation: later.
3. **Locals' species.** Near-human reskins (recommended, a day) vs. authoring
   two or three alien heads on `dressHumanoid` (a week, and a good one).
4. **Does the clock advance at the bunk?** Sleeping to trigger a new
   campaign day is the cleanest "game within a game" loop; it touches
   `Campaigns`. Recommendation: yes, as the only way to start a new day.

## 9. What to hand the executing session

- This file, `HANGAR.md` (the rulebook for an interior that is not a box),
  `HANDOFF.md` §2 (the tooling traps), `DeckLife.js`'s and `DeckLift.js`'s
  headers.
- The four files from `longwong377/Opus-5:handoff/draco/`
  (`zocalo.glb`, `shops_kiosks.glb`, `central_corridor.glb`,
  `starfury.glb`), `handoff/starfury_manifest.json`, and
  `godot/scripts/starfury.gd` + `station/physics/starfury.py` for the port
  (the Python is the source of truth; the GDScript is the readable one).
- The order in §6 and the gates in §5.3, unchanged.
