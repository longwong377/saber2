# SHARK — the station, the hub of the whole game

A plan, not a build. Version 2, 3 Sep, after the player's second brief. Written
against this tree and against `longwong377/Opus-5` at
`claude/aaa-game-development-j6y2ml` (7c3df7e). Every number is measured off one
of the two repos. The person carrying it out is a different session; §14 is what
to hand them. **If a place, a rule or a number is not in this file, do not invent
it — ask.**

The player, first brief: *"making our elevator in battlefield borz connect to
this larger ship … only take it if it's good and then plan on filling out the
rest … I rather have a smaller actually working detailed and lived in ship than
a giant expansive ship that is ultimately empty and repetitive … a home for the
player, a habitat for the companions, like almost a game within a game."*

Second brief: *"the station will be the hub for the game and any other
modes/games we build that will have their own characters/world but with no
mixing other than in the station where they all live together … all our current
battlefront borz npcs AND all the species from the other Opus 5 repo … everyone
lives on the station if it makes sense … it really needs to feel like a
functioning laid out station with anything an actual station might have …
never copied and pasted, it all needs to be unique … everything actually
modelled and with physics and interactable like any other body in Battlefield
Borz — the space-physics/ragdoll sandbox feel."*

---

## 0. Verdict, in eight lines

1. **The hub-of-worlds is the right structure, and better than the first Shark.**
   Every mode stays clean; the station is the one place the whole cast is seen
   at once. It also settles the lore for good: a crossroads port where people
   from different universes live is a *setting*, not an apology.
2. **Do not take the other game. Take three files and its data.** The Opus-5
   package is 42 GLBs, 3.4 M triangles, 215 MB, and by its own author's audit
   "78 of 128 places from one generic kit, 0 NPCs that move, one room five
   times". Take the Zocalo hall, the transit corridor, the Starfury — and the
   TABLES: 15 species' measured body ratios, name generators, daily rhythms,
   40 jobs, factions. The crowd meshes are worse than what this engine builds.
3. **The station is a battlefield with no war.** It is a level in sandbox mode
   on the real `World`, so every resident is a real body that ragdolls, loses
   limbs and is thrown, and every prop is a `Props` body. Not a second hangar.
4. **It is laid out like a station**: a three-deck drum round an atrium void,
   three decks with three characters and three corridor TYPES, a ring, a spine,
   a tram, three lifts, 55 places in a gazetteer (§3), no two the same shape.
5. **Everyone lives here where it makes sense** — every humanoid kind in Borz
   off duty and unarmed, plus all 15 species, in quarters by people, mixing on
   the concourse.
6. **Future modes plug in by a contract**: a lift floor and a residents
   manifest. No station file ever learns a mode's name.
7. **The Starfury is the one truly new system** and closes a loop nothing else
   can: launch, fly round the station, look into your own hangar, land.
8. **The cost is population and places, not geometry.** Ship deck by deck.

---

## 1. What the other repo actually is

`longwong377/Opus-5` is a **Godot 4** project (Python generators → `.glb` →
GDScript). Nothing in it runs in a browser. What crosses over is `handoff/`:
plain glTF 2.0 with `manifest.json`, `materials.json`, 49 textures, and the
Python under `station/npc/` — which is where the value is.

**Author's own measurement** (`docs/SHIP-PLAN.md` amendment 4h): 16 distinct
place builders over 128 places; 78 from one generic kit; one corridor generator
for 70 decks; 0 dialogue; 0 NPCs that move to a job. Their plan is to fix that
inside Godot. Not our problem and not to be inherited.

### 1.1 What to take

| take | what | why |
|---|---|---|
| `handoff/draco/zocalo.glb` | 98 k tri, 44 meshes, 22 × 7.3 × 67 m, floor at y −0.1, +z the hall's length | the one room with real architecture — a barrel-vaulted market hall with galleries and stalls. It is the Concourse. |
| `handoff/draco/central_corridor.glb` | 44 k tri, 37 meshes, 9.4 × 7.4 × 120 m, floor at −0.2 | a ribbed corridor with signage frames, shopfronts, a lit floor channel. It is ONE deck's corridor type, never all three. |
| `handoff/draco/starfury.glb` + `starfury_manifest.json` | 4 k tri, 16 named sections, nine thruster mounts, cockpit volume | a real airframe, the only vehicle worth having |
| `handoff/draco/hull.glb` | 388 k tri, 8 km | far only, from the Starfury; never walked |
| `handoff/draco/cnc.glb`, one `obs_rotundas` room | 19 k / 42 k | Command and the Observation dome — both a day's kit work if the import disappoints |
| `station/npc/body.py` `SPECIES` | 15 rows: stature, girth, cranium, limb ratios, measured off references | the species bodies' NUMBERS |
| `station/npc/names.py` | per-species name generators (Narn stems, Centauri given/house, …) | residents' names |
| `station/npc/schedule.py` | `RHYTHMS` per species (sleep, meals), 40+ `ROLES`, shift offsets, rotating workplaces | the day |
| `station/npc/faction.py` | factions, flags (armband, psi, ranger, guild, sanctuary), verbs | who stands with whom |

**Do not take:** `shops_kiosks.glb` (it IS `zocalo.glb` — identical 44 mesh
names and bounds), the five bars, the six quarters modules, the drum and its
1.8 km garden, the docking bays, customs, the crowd library (14 species as
untextured low-poly figures — `dressHumanoid` beats every one), the identicard
game from `THE-GAME.md`, streaming.

**The rooms are already upright** in their own frames (measured off the
accessors). The handoff README's "+y points inward" is about placing rooms on
THEIR station; ignore `placement`. Measure bbox min y and put the floor at 0.

---

## 2. The constraints that decide the scale

- **One file.** `node tools/pack.mjs` writes 28.6 MB today; three draco files
  with the engine's own materials add ~2 MB. The 33 MB of textures never ship.
- **No glTF loader in the tree.** `vendor/three/three.module.js` is r169;
  vendor `GLTFLoader.js`, `DRACOLoader.js` and the draco wasm from the r169
  examples exactly. `tools/pack.mjs` inlines only png/webp/jpg (`ASSET_IMG`) —
  it must learn `.glb` (`model/gltf-binary`) and `.wasm`, and the decoder path
  becomes a blob URL built from the inlined base64 at boot. **No CDN**:
  `wiring.mjs` refuses external URLs and the packed game must work offline.
- **Materials by prefix, not textures.** A 12-row table binds mesh-name prefixes
  onto `deckMats`: `zoc_rib_*`, `zoc_gallery_*`, `zoc_stall_*`, `zoc_table_*`,
  `zoc_chair_*`, `zoc_deck_*`, `wall_*`, `skirt`, `soffit` → hull/dark/deep;
  `transit_*` (wall/deck/rib/rail/soffit/skirt/panel), `prop_*` (door, bench,
  bollard, planter, locker, shopfront, babcom terminal) → the same; `light_*`,
  `zoc_neon_*`, `sign_text` → the emissive strip. That is what makes an imported
  room look like THIS game.
- **Colliders are ours.** Imported meshes are visual. Flat `world.floorAt` per
  room, `addStaticBox` walls from bounds, boxed props. Never a trimesh — the
  corridor floor has a 66 mm channel a capsule wedges on.
- **The frame budget is a wave's.** The frame ledger has 240 real bodies at
  ~31 ms; the hangar's step is bounded at 2.5 ms. The station's live-body pool
  is 60 (§11) and the rest is the baked crowd. If it does not hold, the pool is
  the knob, and step 1 of §6 finds out on day one.

---

## 3. THE STATION, LAID OUT

### 3.1 The shape of the whole thing — the anti-box rules

`HANGAR.md` records the deletion of six interiors for being boxes: *"a roof
plus four walls at the draw budget this engine has is a box, and a box is the
one shape that cannot be anywhere."* These rules are the counter, written once.

1. **A drum round a void.** The habitable part is a three-deck drum ~180 m
   across, built round a central ATRIUM that runs through all three decks with
   the Concourse vault at its floor. Every deck has a balcony onto it, so from
   anywhere near the middle you see two other decks and the people on them. The
   void is the landmark that makes the station one place, not a list of rooms.
2. **Three decks, three characters**, so you always know where you are:
   - **Deck 40 — the Concourse deck.** Warm: brass, terracotta, amber light. The
     imported Zocalo vault and its market. Corridors are the imported ribbed
     TRANSIT corridor with signage and shopfronts.
   - **Deck 44 — the Living deck.** Cool: white, timber, blue-white light,
     quieter. Corridors are a PROMENADE: a continuous window wall to space on
     the outer side, doors on the inner, the tram guideway outside the glass.
     Never the transit corridor again.
   - **Deck 48 — the Working deck.** Dark: steel, red-orange service light,
     exposed pipe. Corridors are a SERVICE WAY: grating floors, conduit, cutaways
     into machinery. (Flight deck 32 and the Cobra bay 12 hang below the drum;
     the Observation dome 60 sits above it.)
3. **A ring, a spine and a tram.** Each deck has an outer RING walk. A SPINE
   crosses each deck through the atrium balcony. A TRAM loop runs the drum's rim
   at deck 44 with four stops — Arrivals, Concourse East, Quarters, Command —
   cars you can ride, guideway visible from the promenade. Three lift shafts
   (Arrivals, Atrium, Flight) use the existing car; the readout's numbers become
   real floors.
4. **No two places the same shape.** Every place has a listed shape: vault, drum,
   split-level, mezzanine, cut-through, curved gallery, pit, terrace. Two places
   may share a kit but never a plan. `station.mjs` measures pairwise silhouette
   distinguishability of every place from its own door (the IoU instrument
   `characters.mjs` uses on bodies) and fails any pair over 0.85.
5. **Every place has a window onto another place** — the atrium, space, the
   tram, the hangar, a machinery cut — so no room is sealed.
6. **Everything is a body** (§11).

### 3.2 The gazetteer — 55 places

Every place: its shape and look (unique), who is there and on what rhythm, what
happens without you, and the verb you have there. 50 are built with `DeckKit`;
three are imports; two exist.

| # | Deck | Place | Shape / look | Who / rhythm | Happens without you | Your verb |
|---|---|---|---|---|---|---|
| 1 | 32 | **Flight deck** | exists — the hangar | — | — | — |
| 2 | 32 | **Deck control tower** | a glass box cantilevered over the hangar mouth, up a stair from the gallery; consoles, the traffic board | 4 controllers, 3 shifts | calls every launch and arrival you hear on the PA | read the board: what is inbound |
| 3 | 32 | **Pilots' ready room** | low room under the tower: lockers, briefing screen, cots, coffee urn | 8 pilots between sorties | briefings before a launch cycle, sleepers, a card game | the Starfury cert is signed here (§4) |
| 4 | 32 | **Fighter maintenance bay** | a pit two decks deep beside the flight deck, a fighter on a lift in it, gantries at three levels | 12 techs, droids | a fighter stripped and rebuilt across the day | walk the gantries, throw tools |
| 5 | 12 | **Cobra bay** | the launch well: a vertical shaft with the Starfury on a rail, catapult rams, hazard chevrons, a blast wall you look through | 3 ground crew, a launch officer | test cycles; a fighter racked and unracked | board and launch (§4) |
| 6 | 12 | **Fighter rack** | a cellar off the bay: two spare airframes on cradles, engines on stands, a parts wall | 4 techs | an engine test-fires on the stand | grip a spare engine bell and throw it |
| 7 | 40 | **Arrivals hall** | curved; one long window onto the docking throat; a customs line of three gates; departures board; benches; a kiosk | 20 movements an hour, 2 customs officers, a guard | shuttles dock; new residents walk in with bags; a queue forms and clears | arrive here from the Arrivals shaft; read the board |
| 8 | 40 | **Docking throat** | outside Arrivals: a shuttle nosed into a pressure collar, umbilicals, fuel line, loading ramp | 3 dockhands, a mouse-droid convoy | a shuttle every 6 min; cargo down the ramp | walk aboard a docked shuttle |
| 9 | 40 | **The Concourse** | the imported Zocalo vault: 67 m barrel vault, galleries both sides, 14 stalls, the atrium opening at its centre | 60–90 at the busy hours, 20 at night | market cries, shift-change floods, a busker, a pickpocket chased by a guard, a spill cleaned by a droid | browse; every kiosk is a real menu (§5) |
| 10 | 40 | **The Forge** | a stall grown into a shop: hilt parts on pegboard, a bench with a vice, a kyber cabinet lit from inside | a Wookiee smith | hammering, sparks | the hilt/blade menu, at a counter |
| 11 | 40 | **Quartermaster's cage** | a wire cage under the gallery, racks of kit, a counter with a hatch | a clone QM and a droid | kit issued to men queuing | the kit/paint menu |
| 12 | 40 | **Recruiting office** | glass-fronted, the Republic crest, a holoscreen of the war | a recruiter, a queue | recruits sworn in | the Muster slate |
| 13 | 40 | **The Databank** | a round reading room, terminals in a ring, a holo globe at the centre | a librarian droid, 6 readers | the globe cycles the war's fronts | the Databank |
| 14 | 40 | **Cantina "The Long Night"** | sunk half a deck below the concourse; a bar in the round, booths in the wall, a band's dais, coloured lights | a Drazi barkeep, 24 drinkers, a band | songs; a brawl once an hour the guards break up; a Sith acolyte drinking alone | sit, drink (a beat), talk to a resident |
| 15 | 40 | **The Fresh Air** (restaurant) | a terrace over the atrium: white cloth, plants, a kitchen seen through the pass | a Centauri maître d', 16 diners, 4 cooks | service at meal hours, plates carried, the pass rings | eat; the company sits here after a run |
| 16 | 40 | **Galley** | the working kitchen behind it: ranges, hanging pots, a walk-in cold room, steam | 6 cooks on shifts | prep, the meal rush, cleaning | throw pots |
| 17 | 40 | **Food court / noodle bar** | counters in a row under a low ceiling, stools, neon, steam vents | 3 vendors, 20 eaters | the shift-change queue | eat cheap |
| 18 | 40 | **The Pit** (gambling den) | a lower room off the cantina: sabacc tables, a dice cage, a cashier behind bars, one exit | a Brakiri house, 12 players, a bouncer | games; a cheat thrown out | watch and bet (a minigame is later) |
| 19 | 40 | **Holo-theatre** | a fan-shaped auditorium of 60 seats facing a stage where the last run plays as a battle holo | 20–40 watching | shows on the hour | watch your last run |
| 20 | 40 | **The Arena** (sparring hall) | a sunken ring with tiered benches, training remotes overhead, racks of practice sabers | 2 sparring, 12 watching, a marshal | bouts on a schedule | fight a bout (the Dojo, moved here) |
| 21 | 40 | **Gym** | bars, weights, a running gallery round the atrium | 10 | drills | a beat |
| 22 | 40 | **Chapel / meditation hall** | a dark drum with a single skylight to space, candles, mats, a Force shrine | a chaplain, kneelers | vigils; a memorial for the dead | kneel and connect (the existing verb) |
| 23 | 40 | **Arboretum** | a cut through decks 40–44: real trees (`Trees.js`), a stream, benches, birds | 12 | watering droids; the hawk perches | walk, sit; the companion plays here |
| 24 | 40 | **Security post** | a booth at the atrium bridge, screens, a cell behind glass | 2 guards | patrol pairs leave from here | report; the standing number lives here |
| 25 | 40 | **Lost & found / notice board** | a wall of paper and holo notes, a droid | 1 | notices change daily | read (the ledger's story lines) |
| 26 | 44 | **The Promenade** | the living deck's ring: window wall to space, the tram guideway outside | walkers on rhythm | the tram passes; the battle outside | walk |
| 27 | 44 | **Your cabin** | two rooms, a real window, a saber stand, a trophy wall, the campaign map table, a bunk, a desk, a wardrobe | you; the companion sleeping | the trophies grow; a note on the desk | sleep (advances the day), dress, read |
| 28 | 44 | **The Kennel habitat** | a high room with a mezzanine, straw, perches, a pool, a run onto the arboretum | every companion you ever kept; a handler | animals play, eat, sleep; plaques for the dead | feed / play / groom; pick your companion here |
| 29 | 44 | **Company barracks** | a long bunk hall split by lockers into bays, a slate on the wall, a stove | your company off duty | cards, sleep, kit cleaning, a sergeant's inspection | the Muster slate as a board |
| 30 | 44 | **Officers' quarters** | a curved corridor of doors, one open; wood and brass | 6 officers | comings and goings | knock (a line) |
| 31 | 44 | **Human residential** | a stacked two-level cabin block round a light well | 30 | laundry lines, children, an argument | walk |
| 32 | 44 | **Narn quarter** | red stone, braziers, a shrine, low ceilings | 16 Narn | prayer at dawn; a market of their own | walk, trade |
| 33 | 44 | **Centauri quarter** | white, gilt, a fountain, portraits, a card room | 14 Centauri | intrigue; a duel of words | walk |
| 34 | 44 | **Minbari quarter** | crystal, blue light, a triangular hall, silence | 12 Minbari | ritual at set hours | walk quietly |
| 35 | 44 | **Drazi quarter** | a fighting pit, colours, noise | 14 Drazi | the green/purple brawl | walk; get pulled in |
| 36 | 44 | **The methane quarter** (Gaim, Pak'ma'ra) | behind an airlock: yellow haze, walkways over pools | 10 in suits | suit checks | walk in a suit (a verb) |
| 37 | 44 | **The Vorlon's door** | a sealed door at the end of a dead corridor: organic, a hum, one light | — | the light changes | stand there |
| 38 | 44 | **Transient hostel** | capsule bunks in a wall, a desk | 20 travellers | turnover with each shuttle | rent a bunk (the co-op guest's home) |
| 39 | 44 | **Laundry & showers** | steam, rows, a droid | 6 | cycles | a beat |
| 40 | 44 | **Tram stations (4)** | four DIFFERENT platforms: Arrivals (glass), Concourse East (brass), Quarters (timber), Command (steel) | waiting crowds | trams every 90 s | ride |
| 41 | 48 | **Command / CIC** | the imported CnC: the console dais, a tactical wall showing the battle outside, the comms pit | a commander, 8 officers, 3 shifts | the front moves on the wall; orders read out | the next campaign is briefed here (§8) |
| 42 | 48 | **Comms & sensor room** | a dark drum of screens, a rotating dish through a window | 4 | traffic | listen to the fleet channel |
| 43 | 48 | **Medbay** | a triage hall, six curtained bays, a surgery seen through glass, the 2-1B | 2 medics; the wounded from your last run | surgeries; a crash-cart run when a fighter comes in damaged | see your wounded — the injury roll made visible |
| 44 | 48 | **Bacta ward** | a row of lit tanks with men suspended | 4 | tanks fill and drain | look |
| 45 | 48 | **Morgue & memorial** | cold drawers, a wall of names (the memorial roll) | a mortician | the roll grows | read the names |
| 46 | 48 | **Armoury** | cages of rifles, a saber vault, a bench, a range beyond a window | an armourer, 4 | issue; test-fire on the range | the loadout screen as racks; shoot on the range |
| 47 | 48 | **The Brig** | a curved cell block round a guard desk, force-field doors | 2 guards, 6 prisoners (droids, a Sith) | meals; a transfer | wake here after a crime (§11) |
| 48 | 48 | **Reactor hall** | a cathedral: the core a pulsing blue column three decks tall, catwalks spiralling round it, heat shimmer | 10 engineers, droids | power surges dim the deck; a coolant vent | walk the catwalks |
| 49 | 48 | **Coolant & water plant** | a wet room of pipes and tanks, grating over water, turquoise light | 6 | pumps cycle | throw things in the water |
| 50 | 48 | **Fabrication / machine shop** | lathes, a plasma cutter, sparks, a droid being rebuilt | 8 | parts made | cut with the blade — it is a shop |
| 51 | 48 | **Droid pool** | astromechs in charging rows, a protocol droid on a bench | 30 droids | droids leave for jobs and return | the astromech companion lives here |
| 52 | 48 | **Cargo hold** | a canyon of container stacks, a crane overhead, a lifter | 6 | stacks move | the sandbox: everything here is a body |
| 53 | 48 | **Waste & recycling** | a pit, a compactor, a smell | 3 | the compactor crushes | throw a crate in and watch it die |
| 54 | 60 | **Observation dome** | the imported rotunda: a glass dome onto the planet and the battle, a bar, benches, a telescope | 20 off duty | the reactor flash lights the room | watch the battle — the best seat |
| 55 | — | **The station's outside** | from the Starfury: the hull, the drum, the flight deck's mouth, the docking throat, the dome | the fleet | §4 | fly |

### 3.3 Who lives here

**Everyone, where it makes sense** (the player's decision). Every humanoid kind in
Borz is a resident off duty and unarmed — clone crew, the company, Jedi, Sith
acolytes, reprogrammed and off-duty droids, the companions in the kennel — with
a room, a job or a haunt, and a rhythm. "Where it makes sense" is the only
filter: a droideka does not drink in the cantina; a magnaguard stands at a door.
Mechanically: every archetype with a humanoid builder gets a residents row unless
its row says `resident: false` with a reason.

**Plus all 15 species** from `body.py` `SPECIES`: human, narn, centauri, minbari,
drazi, brakiri, pakmara, vree, abbai, gaim, hyach, llort, grome, other, vorlon.
Bodies on this engine's `dressHumanoid` path, tiered so it ships:

- **Tier A — full authored heads and costume, one lane each:** Narn, Centauri,
  Minbari, Drazi.
- **Tier B — head variant + skin + costume palette:** Vree, Pak'ma'ra, Brakiri,
  Gaim (the encounter suit — cheapest and most distinct).
- **Tier C — near-human brow/ear/skin/hair variants:** Abbai, Hyach, Llort,
  Grome, "other".
- **Vorlon:** one encounter suit, one place (#37), never walks.

Quarters by people (#31–37), mixing on deck 40. The concourse is where the game's
whole cast is seen at once, and that is the point of the station.

### 3.4 Life, so it functions rather than sits

- **The clock.** `world.run.stationHour`, 1 game hour per 2 real minutes,
  persisted in `Session` so a return visit is later in the day; the bunk (#27)
  jumps it to the next morning. Everything in `StationCast` reads the hour and
  nothing else keeps time.
- **The rhythms** (ported from `schedule.py`): shift change at 06/14/22 floods
  the ring and the concourse; meals at 07/13/19 fill #15, #16, #17; the cantina
  peaks at 21; quarters sleep by species rhythm.
- **Events on the clock**, one table: a shuttle arrival (Arrivals fills); a
  damaged fighter (crash cart from Medbay to the flight deck); a cantina brawl
  (→ Security); market day; a memorial at the chapel; a fire drill; a reactor
  surge (the lights dip everywhere); a tram fault (crowds walk); a Drazi fight; a
  fighter launch cycle (Cobra bay, tower, ready room all move at once).
- **Routes are real.** Residents WALK between places on the ring, the spine and
  the tram — the `walk` job rows already path men; the tram carries them.

---

## 4. The Starfury — the one new system

Godot has `starfury.gd` (1771 lines), a checked port of `station/physics/
starfury.py`: 6-DOF Newtonian, quaternion attitude, the gyroscopic term, a
thruster allocator over nine mounts (in `starfury_manifest.json`), no velocity
damping. ~250 lines of arithmetic once the scaffolding is off. Worth porting
because nothing in this engine's flight (`Flight.js` the hawk, `DeckFlight.js`
the scripted transport, `Driving.js`) is Newtonian, and a Starfury that flies
like a car is the low-effort thing we are being asked to stop shipping.

**The spike comes first.** Before any modelling: a one-day probe porting the
Python to JS and proving conservation of momentum hands-off and the allocator's
nine mounts in a node check (`starfury.mjs`), with no scene at all.

The loop: walk into the Cobra bay (#5); board — the Starfury is a `crew: 1`
vehicle seated through `Driving`'s `Crew.seat` like a mount, so no new "player
in a vehicle" path is written; a scripted 3 s catapult launch; free flight in a
new level `LEVELS.orbit` that stands `hull.glb` at 1/10 the way `DeckExterior`
stands the capital hull, with the `DeckBattle` fleet and the `SkyDome` planet;
six axes, kill-rotation, kill-velocity, chase and cockpit cameras (the cockpit
clear volume is in the manifest); **fly past your own hangar and look in** —
`DeckExterior` already maps the aperture, and the deck's lit interior is visible
through the field; land — a tractor takes over inside 30 m of the well.

Not a combat mode in the first cut. No guns. `Bolts.js` and the fleet's
fighters exist if that changes.

---

## 5. The technical path

### 5.1 Loading glTF (§2 has the constraints)
Vendor r169 `GLTFLoader`/`DRACOLoader` + wasm; teach `pack.mjs` `.glb` and
`.wasm`; decoder path as a blob URL; bind materials by the §2 prefix table; our
own colliders; floor at 0.

### 5.2 The files
- `src/game/Station.js` — `STATION_LEVEL` in the shape of `HANGAR_LEVEL`
  (`terrain: flat`, `atmosphere: { sky: false }`, `dress`, `lights`), registered
  as `LEVELS.station` and run in **sandbox mode** (§11). The drum, the atrium,
  the three corridor types, the ring/spine, the tram guideway, the lift lobbies,
  and the plan table: every place in §3.2 with (deck, x, z, yaw, shape, doors).
- `src/game/StationKit.js` — the place builders, one function per place, each a
  DIFFERENT plan (rule 4). They compose `DeckKit` and `Props.Kit` pieces; walls
  and rings are static, furniture and stalls are destructible `Prop` bodies.
- `src/game/StationCast.js` — the ported tables: species body parameters
  (`body.py`), names (`names.py`), rhythms/roles/shifts (`schedule.py`), factions
  (`faction.py`); the residents manifests every mode feeds (§10); a
  `residents()` reader.
- `src/game/StationLife.js` — the live-body pool (§11), the baked far crowd,
  the job/route tables per place, the event table, the tram, the clock's
  consumers. Reuses `DeckLife`'s job-row shape and `DeckCast`'s builders for the
  far crowd only.
- `src/game/Home.js` — the cabin's state: trophies (read the ledger), the saber
  stand, the map, the bunk verb.
- `src/game/Habitat.js` — the kennel room: every `Kennel` record gets a body,
  the live one is the real animal via `fieldCompanion`, the dead have plaques;
  feed/play/groom fire `CompanionLife` beats and bank a `story` line.
- `src/game/Starfury.js` + a hull row in `Vehicles.js` + `LEVELS.orbit`.
- `DeckLift.js` — the floor selector (the modelled button column; `liftKey`
  cycles it) and `world.onDeckLift(floor)` raised at the end of `STATE.LEAVE`
  when a floor other than the menu's was chosen. `main.js` (which already
  answers `onDeckLeave` and `onDeckDeploy`) unloads and loads `LEVELS.station`
  with `{ arrive: true, floor }`; the station dresses its own lift lobby from
  the same `LIFT` constants and calls `dressDeckLift(world, { arrive: true })`.
  First cut: two floors, FLIGHT DECK 32 and CONCOURSE 40; every vignette at a
  real floor's number is that place.
- **Kiosks open DOM menus from a pointer-locked deck**: a kiosk interact raises
  `world.onKiosk(panelId)`; `main.js` releases pointer lock, opens that Menu
  panel with a "back to the concourse" button, re-locks on close. One hook for
  the forge, quartermaster, recruiter, databank, armoury and the muster board.

### 5.3 Checks that can kill each step
- `station.mjs`: every place reachable on foot from a lift (a ray-walk of the
  plan's doors); every door crossable; floor at `floorAt` height everywhere;
  rule 4's distinguishability on every pair; draws under the bound; no external
  URL in any loader path.
- `stationcast.mjs`: every species in `SPECIES` has a builder, a name generator
  that never returns a Borz name, a rhythm; no station file names a mode; every
  manifest entry resolves to a builder; ≥ 8 residents placed per species.
- `stationlife.mjs`: every place's job table non-empty at its busy hour; routes
  walk end to end; the tram carries; events fire on the clock; step ≤ a wave's.
- `station-sandbox.mjs` (§11): a resident ragdolls when thrown and gets up; a
  limb comes off under the blade; a stall breaks into pieces; 60 live bodies +
  crowd + rooms step inside the wave budget; attacking a resident summons a
  guard within 10 s.
- `home.mjs` / `habitat.mjs`: the trophy wall reflects the ledger; the kennel
  shows every record; the pup's size on the station equals `bodyScaleOf`.
- `starfury.mjs`: momentum conserved hands-off; allocator sums; launch ends
  outside the well; land ends inside it; never through the hull.
- `packed.mjs` (exists): the single file boots with the station in it;
  pack ≤ 34 MB.

---

## 6. Build order — gated, deck by deck

1. **Loader + the Concourse + the sandbox.** Vendor GLTF/Draco, pack support,
   the Zocalo standing in a sandbox-mode `LEVELS.station` lit with the deck
   palette, reached by the lift's new CONCOURSE floor — **with 20 real residents
   you can throw**. *Gate:* `station.mjs` walks it; `station-sandbox.mjs`'s
   ragdoll and limb checks; pack ≤ 31 MB. If the frame budget does not hold
   here, the pool is the knob and it is known on day one.
2. **The drum.** Atrium, the three corridor types, ring and spine on all three
   decks, the tram and its four stations, the three lift lobbies. Empty.
   *Gate:* reachability from every lift to every door on the plan.
3. **Deck 40, all 19 places** (#7–#25), each landing WITH its life table and its
   kiosk hook. *Gate:* rule 4 on the deck; every place populated at its busy
   hour; the kiosks open their menus.
4. **The cast, Tier A.** Narn, Centauri, Minbari, Drazi as archetypes on
   `ARCHETYPES` with heads and costume; `StationCast` tables ported; the Borz
   residents' manifest. *Gate:* `stationcast.mjs`; a `castshot` probe photographs
   one of each.
5. **Deck 44, all 15 places** (#26–#40) including the home and the habitat.
   *Gate:* `home.mjs`, `habitat.mjs`, rule 4.
6. **Deck 48, all 13 places** (#41–#53) and the dome (#54). *Gate:* rule 4; the
   brig's consequence loop; the medbay reads the injury roll.
7. **Flight ops** (#2–#6) and **the Starfury** (spike first, §4). *Gate:*
   `starfury.mjs`; a cockpit screenshot looking into the deck.
8. **Tiers B and C**, the event table's long tail, the holo-theatre's replay.
   Trails; never blocks a deck.

Steps 1–2 are one session. Steps 3, 5, 6 are one session each and are the
work. Step 4 is four lanes. Step 7 is its own lane.

---

## 7. What is cut, and the warning

- **The Republic hull outside stays.** Shark's fiction: the deck is bolted into
  a hull nobody built; from outside, `hull.glb`'s spine and the Venator-style
  flight deck read as one captured, converted thing.
- **Cut:** the drum garden, the sectors, the 24 docking bays, the identicard
  game, the crowd library, streaming (55 places in three decks fit one level;
  if they ever do not, the lift is the load screen and always was).
- **The warning:** population and places are the cost, not geometry. Fifteen
  species with real heads is three or four sessions on their own, and 50 unique
  places is more. Ship deck by deck with Tier A; never let the cast block a deck.

---

## 8. Decisions only the player can make

1. **Tier A four** — Narn, Centauri, Minbari, Drazi, or a different four.
2. **Command briefs the next campaign** (#41) — a real door into `Campaigns`,
   or flavour. Recommendation: real, as the only way to start a campaign day.
3. **Guns on the Starfury** — recommendation: not in the first cut.
4. **The Pit's minigame** — watch-and-bet first; sabacc later.

*Decided:* everyone lives on the station where it makes sense (§3.3); sleeping in
the bunk advances the day (§3.4).

---

## 9. TWO GUARANTEES — the look, and the kill switch

**9.1 It is all cel-shaded Borz, or it is not shipped.** Nothing imported or
built for the station may look like a visitor. The rules, and the check that
holds them:
- Every mesh in a walkable room takes the engine's own materials (`deckMats`,
  `propMaterials`) through the §2 prefix table, and so takes the cel bands and
  the ink pass exactly as the hangar's kit does. The 49 handoff textures never
  ship. `MeshStandardMaterial` from a loader is replaced on import, never kept.
- `saberNoInk` is allowed only where the deck already allows it: things seen
  through glass at range (the fleet, the shaft scene). Inside a room, nothing.
- Lighting is the deck's rig (`lightDeck`'s key/fill/fog pattern, per-deck
  temperature from §3.1), never a loader's lights; imported light meshes become
  the emissive strip.
- Species heads and costumes are built on `dressHumanoid` with the same palette
  and band discipline `characters.mjs` and `character-shading.mjs` already
  hold every body to, and both suites run on every new archetype.
- `station.mjs` asserts: no `MeshStandardMaterial`/`MeshPhysicalMaterial` from
  a loader survives dress; no `saberNoInk` material inside any place's bounds;
  every material in a place is one of the engine's own. A screenshot of the
  Concourse beside a screenshot of the hangar is the judge-it-by picture, and
  it is taken at step 1 before anything else is built.

**9.2 It can be killed in one commit, and the game is exactly today's.** The
whole station is additive and behind one switch:
- All new code is new files (§5.2). The existing files change in exactly these
  places, each behind `STATION_ENABLED` in `Levels.js`: the `LEVELS.station` /
  `LEVELS.orbit` registrations; the lift's floor list (one row per door, §10);
  the three `main.js` hooks (`onDeckLift`, `onKiosk`, and the orbit load);
  two MIME rows in `pack.mjs`; the species rows assigned onto `ARCHETYPES`
  (`unlockAt: 99`, `score: 0`, so no wave can ever compose one — the same fence
  `COMPANION_UNITS` uses).
- With the switch off, the lift has one floor, the tree behaves as it does
  today, and `station.mjs` proves it the way `saberforms.mjs` proves the single
  blade: a recorded trace of the hangar visit (the lift ride, the deck's first
  600 frames, the pack's module list) must be identical with the switch off.
- Killing it for good is: delete the new files, delete the assets folder,
  revert the guarded lines. One commit; nothing else in the game moves.

---

## 10. THE HUB OF WORLDS — the rule and the contract

**The rule, once:** a mode never mixes casts. Battlefront Borz keeps its Star
Wars cast; every future mode keeps its own world and its own people. The station
mixes everything, and it is the only place that does.

**The mode contract.** Every mode contributes to the station exactly two things:

1. **A door** — a lift floor: its number, its label on the readout, the vignette
   at that deck, and what `world.load` builds when the car stops there.
2. **A residents manifest** — who from that mode lives on the station: builder
   name, species/kind, name generator, job, home place (a # from §3.2), rhythm.

A new mode is one world plus one manifest entry. No station file learns a mode's
name — the same "rows, not names" rule `CompanionKinds.js` already keeps, and
`stationcast.mjs` greps for it.

**Lore, one line for the Databank:** the station is a crossroads port. The
Republic bolted a flight deck onto a hull nobody built, and people from
everywhere live here. That is the whole explanation and it is enough.

---

## 11. A BATTLEFIELD WITH NO WAR — the sandbox feel

The player's bar: everything modelled, with physics, interactable like any other
body in Battlefield Borz. The hangar does NOT meet that bar by design — its own
header says so: instanced Knockables, no ragdoll, "past thirty metres no bodies
is the honest trade". So the station is not a second hangar.

- **The station is a level in sandbox mode.** `MODES.sandbox` already builds a
  full `World` + `Player` with zero enemies (`Waves.js`; `meadow.html` proves
  it). `LEVELS.station` runs on that path, so every system the battlefield has
  is simply present: `spawnEnemy`, `Ragdoll.js`, dismemberment,
  `Destruction.js`, `Props.js` bodies, Force grip/hurl/push/pull on everything,
  `Reactions.js`, `Corpses.js`, voice.
- **Every resident within ~40 m is a REAL body**: `world.spawnEnemy(archetype)`
  with `team = player.team`, so it ragdolls, loses limbs, is gripped and thrown,
  flinches and speaks exactly as a trooper does. Species are archetype rows in a
  `STATION_UNITS` table assigned onto `ARCHETYPES` the way `COMPANION_UNITS` is,
  so they get `MergedSkin` LODs and the frame ledger for free. Beyond ~40 m the
  baked crowd (`DeckCast.crewFigures`) fills the far end of a hall and is swapped
  for real bodies as you approach: a `StationLife` pool of ~60 live bodies that
  re-seats itself round the player. Basis: 240 real bodies at ~31 ms in the
  frame ledger; 60 live plus the crowd sits inside the budget a wave takes.
- **Every prop is a `Props.Prop` body** through the `Kit` batcher with per-part
  vertex ranges: grabbable, throwable, cuttable. Furniture and stalls are
  destructible pieces; walls, rings and the tram guideway are static. No
  Knockable instances inside the walkable rooms.
- **Consequence, so a sandbox is not a griefing box.** Residents never fight
  unless attacked. Cut or throw one and the nearest guards — real, armed bodies
  — come. You wake in the Brig (#47), your station `standing` drops (one number
  in `Session`), the kiosks refuse you for a day. Built on the existing
  team/`canHarm` machinery.
- **The companion is the real animal**: `fieldCompanion` on the station world.
  The hangar needed `CompanionDeck` only because its World has no director; a
  sandbox World has everything the pack needs — `companions.mjs`'s "finds
  enemies in a mode with no army" check already runs on exactly this path.

---

## 13. PERFORMANCE — nothing about how it runs may change

The player's bar: *"still easily run this in the browser with no setup or
installs — nothing about that should change — and it should still run well on
a good PC."* Every number below is the engine's own, from `PERF.md`,
`frame-budget.mjs`, `frame-ledger.mjs`, `hangar.mjs` and `decklife.mjs`, and
the station is held to them by check, not by intention.

**13.1 The delivery does not change.** One `index.play.html` served from Pages,
one `pack.mjs` file that opens from disk, no server, no install, no download at
runtime, no CDN, no WASM fetched from anywhere but the page itself. The draco
decoder and the three GLBs are inlined like every other asset; `packed.mjs`
boots the single file with the station in it and fails if anything reaches
the network. `wiring.mjs` keeps refusing bare specifiers and external URLs.

**13.2 The budgets, in the engine's units.**

| what | bound | where it comes from |
|---|---|---|
| pack size | ≤ 34 MB (today 28.6) | §2; three draco files + loader ≈ 2 MB, engine materials not textures |
| boot to menu | no slower than today, measured by `tools/_frame.mjs`'s boot line | the pack only grows by the assets; nothing loads until the station level is entered |
| station level load | ≤ the hangar's, measured the same way (`World._loadSteps` stages) | one level, no streaming; the GLBs decode once and are cached for the session |
| draw calls, any station view | ≤ 400 with the ink pass (the hangar's bound after V14) | `hangar.mjs`'s method: everything a KIND holding many things — instanced props, merged kit per material, `MergedSkin` bodies at 4 draws each, the baked far crowd |
| triangles submitted | ≤ 3 M at 1080p (the deck's V14 figure) | places are culled by the plan table (a place is drawn when its door is inside ~80 m); the atrium is the one long sightline and is budgeted for that |
| live real bodies | 60 in the pool, 20 per place at most (§11) | `PERF.md`: 120 bodies at 16.60 ms in the two-army front; a station has no O(bodies²) cross-army pass and no shooting, so 60 is under half the budget a wave takes |
| physics bodies | ≤ 1100 (`maxBodies` today), asleep unless touched | `RapierWorld` is constructed with the same cap; props sleep, and a place's props are re-slept when its door leaves 80 m |
| station step (life, tram, events, clock) | ≤ 2.5 ms on the shared box, the same bound `decklife.mjs` holds the deck to | `stationlife.mjs` times it exactly as `deckcast.mjs` times `stepDeckLife` |
| our JS per frame, browser | ≤ the hangar's today, by `tools/_frame.mjs` (`JS med`) | the same instrument, same quality, same drawing buffer, the station standing where the hangar stood |
| GPU per frame on a real card | the player's own reading of `Profiler.js`'s GPU line beside the hangar's | the only true render number; §13.4 says how it is used |
| memory | no unbounded growth across an in-game day: heap flat over 3 000 steps in node, as `deckbattle.mjs` already asserts for the fleet | the event table and the pool allocate nothing per frame |

**13.3 How the station stays under them** — the rules that make the numbers
possible, so an executor does not discover them at step 6:
- **Places are drawn by their doors.** The plan table gives every place its
  bounds; `Station.js` culls a place whole when its door is beyond ~80 m and the
  atrium sightline does not reach it. The three corridor types are instanced
  modules, one draw each per material.
- **Bodies are a pool, not a population.** 60 real bodies re-seated round the
  player; everyone else is the baked crowd until you approach. A place's
  headcount in §3.2 is who is THERE, not who is live at once.
- **Nothing per frame.** The rule every deck file already keeps: scratch
  vectors, Float32 pools sized at dress, no closures in the step.
- **Quality tiers apply.** The existing `low/medium/high/ultra` settings scale
  the station like the deck: the pool (30/45/60/60), the far crowd's LOD
  distance, the mirror floor's share, shadow cascades.
- **The Starfury's orbit level is cheap by construction**: a hull, the fleet the
  deck already pays for, no bodies.

**13.4 The gate is a real PC, not this box.** There is no GPU where this is
written; every render number above transfers as a COUNT, never as a
millisecond. So the acceptance for each deck in §6 includes one reading from
the player's machine: `Profiler.js`'s always-on frame/JS/GPU line at 1080p
`high`, standing in the Concourse at 13:00 station time (the busiest place at
the busiest hour), beside the same reading in the hangar. **The station must
not read worse than the hangar on that line.** If it does, the knobs are, in
order: the pool, the far-crowd distance, the per-place draw cull radius, the
quality tier — never the ink pass and never the ragdoll.

---

## 14. What to hand the executing session

- This file; `HANGAR.md` (the rulebook for an interior that is not a box);
  `HANDOFF.md` §2 (the tooling traps); the headers of `DeckLife.js`,
  `DeckCast.js`, `DeckLift.js`, `Companions.js`, `Waves.js`'s sandbox mode.
- From `longwong377/Opus-5:handoff/draco/`: `zocalo.glb`, `central_corridor.glb`,
  `starfury.glb`, `hull.glb`, and `cnc.glb`/`obs_rotundas.glb` to judge;
  `handoff/starfury_manifest.json`.
- From `longwong377/Opus-5:station/`: `npc/body.py`, `npc/names.py`,
  `npc/schedule.py`, `npc/faction.py` (port as tables); `physics/starfury.py`
  (the source of truth for the flight model) and `godot/scripts/starfury.gd`
  (the readable port).
- §3.2, §6 and §5.3 unchanged. **A place not in §3.2 is not built. A rule in
  §3.1 is not bent. A gate in §5.3 is not skipped.**
