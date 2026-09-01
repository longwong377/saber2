Verified against source. Findings below; where a report was wrong or incomplete I say so.

---

# HANGAR BAY — FEASIBILITY, AGAINST THE ACTUAL TREE

**Read this first.** `src/game/Levels.js:4845-4877` is the single most load-bearing fact in the repo for this feature, and none of the twelve reports surfaced it as a risk:

> "your outdoor maps look good because they're immersive and have a feeling of place, whereas your interior maps remind you that this is an AI game" … "just get rid of all your maps that take place indoors" … "I just tried the boarding bay and the providence and hated them, you completely missed the ball so just remove them. your outside work is much better." **"That is the third time the same instruction has been given about the same class of level, and this file has now stopped arguing with it."**

The roster went 13 → 10 → 7 on that instruction. Hangar Bay Nine, the Invisible Hand (a Providence interior), the Boarding Bay, the Temple Halls, the Intake, the Cut — all built, all deleted, all for being a box. `Levels.js:4841`: *"a roof plus four walls at the draw budget this engine has is a box, and a box is the one shape that cannot be anywhere."*

That does not kill this ask. This ask is a room whose entire content is a **view out of it** — planet, shield wall, battle — which is precisely the counter to "a box cannot be anywhere". But it means the view is not a feature of the scene. It **is** the scene, and if it does not land at a very high bar this is the fourth deletion.

---

## 1. WHAT EXISTS THAT THIS STANDS ON

### Scene / world building
- **`src/world/Terrain.js:1281` `TERRAIN_PRESETS.warship`** — a fully authored capital-ship hangar deck that **no level uses**. Verified: `grep warship src/` returns only comments outside Terrain.js. 340 m, `flat: true`, hull-in-plan (Chebyshev, 84 m half-beam × 104 m half-keel), 46 m walls raised by `smoothstep(0.86,1.0,d)`, a **1.6 m launch trench** with 18° banks crossed twice, a **bridge raised 5.4 m aft** on a 12° ramp, a **corridor spine forward** stepped down 1.2 m through a blast-door threshold, 6 m deck-plate seam module at 5.5 cm relief. Every transition is under 15° because the gait solver and enemy nav walk this heightfield. Cool durasteel palette authored *specifically so red bolts have somewhere to be* (`Terrain.js:1283-1291`). This is a finished hangar floor waiting for a level.
- **`src/world/Terrain.js:685` `TERRAIN_PRESETS.hangar`** — second flat deck, 300 m, `maps:'deck'`, drainage on a 12 m grid. Spent on `DOJO_LEVEL`.
- **`src/game/Dojo.js:816 dressDojo` + `:870 DOJO_LEVEL`** — a complete, working, **unimported** interior level object: `terrain:'hangar'`, `atmosphere: { sky:false, bgColor:0x0c1119, ... }`, an 8-point-light + skylight interior rig, `ambience:{wind:0.02, windFreq:150, drone:0.13}`, emissive fixtures pushed to `world.levelLights` and `world.statics`. Copy this file's shape verbatim; it is the template.
- **`src/game/World.js:647 _loadSteps()`** — 7 named async stages with `await nextFrame()` between. Stage 3 (`:769`) `new Terrain(scene, this._groundKeyFor(L), detail)`; stage 4 (`:819`) `engine.applyAtmosphere(L.atmosphere)`; stage 6 (`:894`) `L.dress(this)`.
- **`src/world/Battlefield.js:932 installGround(key, preset)` / `:941 removeGround(key)`** — registers a `TERRAIN_PRESETS` row **at runtime**, already used by the generated front (`World.js:2949-2951`). Refuses to shadow an authored name; refuses to delete one it did not install.
- **`src/engine/Engine.js:2200 applyAtmosphere(a)`** already knows what an interior is: `:2277` `this.sky.visible = a.sky !== false`; `:2372` `scene.background = a.sky === false ? new Color(a.bgColor) : null`; `:2377` *"Interiors get neither term — a hangar has no sun to scatter and no gravity well of haze to stratify, and faking either there reads immediately as a bug"* — `AERIAL.shape.x = outdoor ? … : 0`.

### A walkable player
- **`src/game/Player.js:3603-3622`** — the `if (this.driving)` branch in `_readInput`. This is the only precedent in the codebase for *"same body, same camera, a completely different input contract"*: it keeps `control.applyInput` (look), keeps `takeControls`/`view`, and **returns before every combat key**. The report's claim that mouselook cannot be had without the saber controller is correct and verified — `SaberController.applyInput` owns the mouse and returns the camera's share (`Player.js:3640`).
- `Player.js:4065` `if (this.riding)` — the same trick in `_move`, zeroing movement while keeping camera and blade.
- **`src/game/World.js:1487 _playerSpawn()`** is already terrain-null-safe: `const h = (x,z) => (t ? t.height(x,z) : 0)`.
- `src/physics/Support.js:122` `supportHeight(terrain, …)` returns 0 for null terrain.

### Troop figures + customization
- **`src/game/Bodies.js:6433 buildTrooper`** → `humanoidSkeleton` (`Rig.js:113`, 19 bones) → `dressHumanoid` (`Bodies.js:1798`) → `Kit.bake` (`Bodies.js:1312`) merges one geometry per material per bone. Returns **`{ rig, palette: {plate, under, accent, visor, gear, scorch} }`** at `Bodies.js:7025`.
- **`src/ui/Menu.js:3404 buildParadeFigure(man)`** — the whole pipeline in 30 lines: `A.build({scale, ...bodyOptsFor(type), ...kitOptsFrom(man.look, kind)})`, then `standPreviewFigure` (`Menu.js:2899`, 60 frames of the real `BipedAnimator` at zero velocity to plant feet on y=0), then four `CommandDirector.prototype.{repaint,markUp,bandUp,scorchUp}.call(null, stub, …)` against a three-field stub `{rig, A:{scale}, group}`. **Line 3416-3418 discards `built.palette`** — verified. That is the one-line omission that makes paint cost a full-line rebuild instead of a `setHex`.
- **Rank/mark/band/scar paint is already live and idempotent** — `Command.js:8987` opens `repaint` with `if (e._cmdPaint) { e._cmdPaint.color.setHex(color); return true; }`.
- Stores: `Company.saneLook` (`Company.js:138`) is the single validator, `Company.dress` (`:968`) and `Muster.dressRecruit` (`Muster.js:533`) the only two write doors, `Muster.issue` (`Muster.js:509`) fans a kit across a squad through both.
- **`src/game/MergedSkin.js:341 buildMergedSkin(rig, opts)`** — takes a **bare rig**, not an Enemy. Bakes kept meshes into one `SkinnedMesh` per material bin. Header measures a trooper's 26 kept meshes / 6 materials → **4 draw calls**. `applyMergedSkin(owner, lod)` (`:487`) is the Enemy-shaped entrance; `BAKES_PER_FRAME = 1` (`:460`).

### Physics / ragdoll / force
- **`src/physics/RapierWorld.js:1140`** is the live solver (`Physics.js:329 PhysicsWorld` is dead — only `tools/verify.mjs` builds one). Constructed at `World.js:386` with `gravity:-24, iterations:4, maxBodies: settings.maxBodies ?? 1100`. Stepped at `World.js:3991`.
- Bodies: `RapierWorld.js:386 Body` (box/ball/cylinder/capsule/hull/compound), `:217 hullFromGeometry`, `:262 boxFromObject`, `:1609 addStaticBox`.
- **Ragdoll**: `Ragdoll.js:264 goRagdoll` (one capsule per bone, `RapierWorld.js:1015 RagdollJoint`), `:393 recover()` returns the rest point; `Enemy.js:4702 recover(beat)`, `Enemy.js:4893 _tickGetUp` (chest `velocity.lengthSq() <= 4`, then `GET_UP = 1.35 s`). **No get-up animation** — instant bind-pose restore plus a 1.1 s stun.
- **Force**: 12 powers priced in `Powers.js:33`. Grip `Player.js:7116/7791`, hurl `:7365`, push `:6762`, pull `:6842`, stasis `:9262`, unleash `:8542`, shield `:8814`, saber throw `:8040`. Gate is `_grippableBody` (`Player.js:6960`) — verified: `invMass > 0 && layer ∈ {PROP, DEBRIS, RAGDOLL}`, plus ENEMY with `grippable !== false`, plus the author veto `prop.grippable === false`.
- **Every power is defensive about `ctx`.** `World.js:3792` builds it; `_foes(ctx)` (`Player.js:6753`) returns `[]` with no hostiles and every consumer is a `for…of`. Only `lightning`, `compel` and `rend` degrade to no-ops. Grip/hurl/push/pull/stasis/shield/throw all work against props and architecture alone. `MODES.sandbox` (`Waves.js:~253`) and `meadow.html` already prove a real World + Player with zero enemies.

### Ships and interiors
- **`src/game/Vehicles.js:2014 buildRepublicTransport`** — the game's only first-person interior built to be seen from a metre away. `BAY = {halfW:1.20, floor:-0.95, roof:1.10, front:-1.60, back:3.30}` at `:2034`, published on `userData.bay` at `:2471`; **99-part interior kit** at `:2174-2254` (5 frame hoops with gussets, 2 recessed emissive strips at `:2190`, conduit runs + clamps + avionics + spare-cell rack + fire bottle per side, 6 seats, tread strips + tie-down rings, a forward bulkhead **with a door in it**); ramp `:2310`, doors `:2326`, seat table `:2479` (6 bench + 4 standing). The design note at `Vehicles.js:2100-2114` — fine texture tiling (repeat 5.2-6.2, not 0.8), a local emissive source so the box doesn't take only the level key, two greys a step apart, relief plates a few centimetres off every flat — **is the hangar's rulebook.**
- CIS counterpart `:2703`, 85-part rack interior at `:2864-2921` with **6 empty droid cradles a side**.
- `Extraction.js:1853 _deckHeight(pos)` and `:1526 _inBay(pos)` — verified: both read `this._model.userData.bay` in the ship's own frame and are **private to the extraction director**. Real, correct, and not reusable as written.
- Six hulls total (`Vehicles.js:1592, 1750, 2014, 2703, 3114, 3202`), all template-cloned with `userData` anchors re-resolved by name.

### Procedural geometry patterns
- **`src/world/Props.js:1335 class Kit`** — the heavy batcher. Material bins + colliders + lights + `push/pop` nested sub-assembly frames + **per-part vertex ranges so a merged mesh stays individually destructible** (`addRuin`: 9 destructible pieces, 6 draw calls, 30 598 tris) + `deferred[]` callbacks for bodies that need a world point + a separate weathering RNG stream.
- Hangar parts already shipped and used: `addGantry:5632` (trestles, lattice bracing, grating deck, railings, ladder, **crane trolley on a rail**), `addHullSection:5474`, `addCrateStack:5839`, `addScaffold:6029`, `addPipeRun:5717`, `addCableRun:5776`, `addTank:6246`, `addMachine:6192`, `addStanchion:6294`, `addLamp:6330`, `addSign:6388`, `addRailing:4941`, `addFloorSlab:5116`, `makeCrate:1913`, `makeBarrel:1963`, `makeConsole:2224`, `BlastDoor:2467`.
- `src/game/Vehicles.js:265` — the lighter `Kit` with `.pair(fn)` (authored both sides, never mirrored — negative scale inverts winding) and `.row(n, fn)`.
- **`src/world/Props.js:1623 class Prop`** — the 8-step registration; step 5 `body.userData.prop = this` is what the Force reads, step 8 `world.addProp(this)` is the documented Geonosis-spires bug if skipped.

### Starfield / sky
- **`src/engine/SkyDome.js:629`** — one inverted sphere, radius 9000, `BackSide`, `renderOrder -900`, `depthWrite:false`, **direction-only, no geometry, one draw call**. Uniforms at `:634-657`; `configure(a)` at `:678`. Already bands its output through `saberCelBand(col,3)` and `saberCelQuant(alpha,5)` (`:621-622`). **`clouds:false` zeroes `uOpacity` (`:681`) — there is already a switch for "no weather in this sky".** Verified: nothing hides the dome on `sky:false`, so it stays available as the space canvas.
- **`src/world/Scenery.js:4595 addHorizon(world, {layers})`** — three concentric rings at 172/248/342 m, 512 segments, per-vertex `aNear`/`aFar` where **`aFar` is the sky in that bearing**, blended by the shared extinction integral in `ridgeMaterial` (`Scenery.js:4461`), banded to `CEL.fogBands`. `frustumCulled=false`, `renderOrder=-10`, no shadow cost, one draw call per ring.
- `Engine.js:2059` three's Preetham `Sky`; `Engine.js:2118-2130` the analytic sun disc — the exact pattern a planet disc copies.
- **`src/game/Bodies.js:7507 buildShieldBubble`** — a finished cel-correct energy shader: fresnel + hex weave + vertical ripple, four flat bands with `fwidth` AA, additive, `depthWrite:false`, `DoubleSide`, `userData.saberNoInk = true`, driven by one `uPower`. Reads `vN`/`vV`, so a `PlaneGeometry` works unchanged.
- **`Extraction.js:766 _makeSpace()`** — 900 `THREE.Points` on a 900-unit shell, hemisphere-biased away from down, plus `capitalModel()`. This is the entire space rendering in the game. The planet is explicitly *not drawn* (`Extraction.js:958-962`).

### Audio
- Everything synthesised; no samples (`Audio.js:1-17`). Two primitives: `noise()` `:1321`, `tone()` `:1373`.
- Usable today: `jet(pos,power,id)` `:2365` + `_openLoop` `:2400` (the only continuous positional voice, cap 6); `createHum(color)` `:1897` (5 oscillators + crackle + LFO, with `set(speed,strain)`); `servo(pos,effort,size)` `:2307`; `bodyThump` `:2293`; `thud` `:2461`; `radio(spec,text,{pos})` `:1580`; `speak(spec,kind,{pos:null})` `:1663` — with `pos` null it goes flat into `speechBus`, which **bypasses the sfx duck**: that is already a PA channel.
- **`Terrain.js:3693 surfaceAt(x,z)`** — verified: `if (this.preset.flat) return 'metal'`. A flat deck is unconditionally metal everywhere.
- `World.js:93 GROUND_ECHO = {sand:.14, water:.52, stone:.86, metal:1.0}` → `roomOf(level, surface)` `:127` → `setRoom` `Audio.js:2955`. A hangar gets `send ≈ 0.38` and will sound cavernous with no work.
- `setAmbience({wind, windFreq, drone, room})` `Audio.js:2980`.

### Checks
- Registration is a filename: `tools/verify.mjs:3808` reads `checks/*.mjs`, drops `_`-prefixed. Contract `export function run({check, assert, near, V, Q, THREE, lerpN})`; `determinism.mjs:376` imports all of them and fails one that doesn't export `run`.
- **47 of 169 suites iterate `LEVEL_ORDER`** (`Levels.js:4878`). A scene not in that array is measured by none of them.
- `_coop.mjs:243 bootWorld()` boots a **real World** with real Rapier; `stubEngine()` `:140` is the only stub and it borrows `Engine.prototype.lightUp`/`_syncLights` rather than reimplementing them.
- Asserting on 3D contents is routine: `lifecycle.mjs:92 census()` (3 load/unload cycles, byte-identical), `prop-seating.mjs:175 assemblies()` (every vertex through `matrixWorld`, triangles rasterised into an 8×8 height field, `SEAT_TOL 0.05`), `physicality.mjs:103` (oriented-slab collider test per mesh), `matter.mjs:111` (everything solid can be cut), `preview.mjs:143 mask()` (software triangle rasteriser, no GL).
- Shots: `tools/shot.mjs --level X --pose "…"` is the arbitrary-scene screenshotter.

---

## 2. WHAT DOES NOT EXIST AND MUST BE BUILT

Ranked by size.

**1. The hangar level itself — dress function + atmosphere block. ~450-600 lines.**
Builds on `dressDojo` (`Dojo.js:816`) for shape, the transport-bay note (`Vehicles.js:2100-2114`) for the rules, `Props.Kit` (`Props.js:1335`) for the batching, and `terrain.warship` (`Terrain.js:1281`) for the floor. Calibration: shipped `dress` functions run 40 (drifts) to 270 (mustafar, colosseum) lines at this repo's comment density. A room with three distinct zones — deck, spine, bridge — plus the aperture wall is the top of that range.

**2. The view: planet + starfield + space battle. ~300 lines GLSL + ~120 JS.**
All of it in `SkyDome`'s fragment (`SkyDome.js:212-624`) plus new uniforms at `:634` and a `configure` branch at `:678`. Nothing else in the tree can hold it: a geometry planet needs its own depth range, its own fog exemption, and would be inked. Zero new draw calls for planet + stars. Ships: one extra `addHorizon`-style ring (`Scenery.js:4595`) with hull profiles in place of harmonic ridges, `ridgeMaterial` verbatim — one draw call, correct aerial perspective and banding for free.

**3. A bare-rig entrance to `MergedSkin`. ~80 lines + refactor.**
`buildMergedSkin(rig, opts)` (`MergedSkin.js:341`) already takes a rig. `applyMergedSkin(owner, lod)` (`:487`) is Enemy-shaped. Without this, 24 figures cost ~1300 draw calls (54 meshes each, no merging, no LOD on the parade stage — verified: `_startStage` touches none of `_applyLod`/`MergedSkin`/`CohortField`). With it, ~96. This is the highest-leverage single item in the feature.

**4. A non-combat player mode. ~120 lines.**
A `this.hosting` early-return in `Player._readInput` shaped exactly like `if (this.driving)` (`Player.js:3603`), keeping `control.applyInput` for look and `_move` for locomotion, dropping the blade and selectively keeping Force. Plus a `HangarDirector` no-op (`{wave:0, active:false, intermission:0, update(){}, state(){}}`) because `HUD.js:2198` does `world.director.wave` with **no optional chaining** and `World.js:1018` always assigns a director.

**5. The shield wall. ~60 lines.**
`buildShieldBubble` (`Bodies.js:7507`) material on a curved plane or a cylinder segment. Do not write a second energy shader.

**6. A palette handle on a built figure + per-figure restage. ~90 lines.**
Keep `built.palette` at `Menu.js:3416`; add `applyPaint(figure, look)` mapping `PAINT_SLOTS.flesh` (`Bodies.js:6289`) onto `palette.plate/accent/visor`. Add `_restageOne(designation)` beside `_restage` (`Menu.js:7536`), which is currently all-or-nothing and calls `_stageDisposeAll` (`:7639`) on any signature change.

**7. Standing/inspection poses. ~150 lines.**
Nothing exists. `poseSaberArm` (`Menu.js:2960`) is the only authored-static-pose template (pick targets, `rig.solveIK`, explicit pole). `standPreviewFigure` (`Menu.js:2899`) gives one identical attention-ish stance for every figure. Attention / at-ease / salute / inspection-turn are four new authored functions in that shape.

**8. A hangar entry/exit door in main.js. ~70 lines.**
`enterHangar()` as a sibling of `deploy()` (`main.js:783`), and `leaveHangar()` as a sibling of `quitToMenu()` (`main.js:1265`) that skips `record()` and `bank()`. Plus a menu button and hook (`Menu._buildButtons:9217`, hooks literal `main.js:292-357`).

**9. A repair-droid / deck-crew body. ~250 lines each, and there is no precedent.**
Verified: zero non-combat bodies in the tree. The complete inventory is `buildRemote` (`Dojo.js:73`, a 12-mesh floating ball), `buildDummy` (`Dojo.js:111`, two cylinders), `pilotBody` (`Vehicles.js:1997`, 8 parts, seated), `droidPilotBody` (`Vehicles.js:2682`), and `Crowd` (`Props.js:6774`, an InstancedMesh of 4-9 px spectators). Every row in `ARCHETYPES` is a fighter or a training prop.

**10. Deck traffic. ~200 lines and it will not be good — see §6.**
Landing gear is merged and permanently down (`Vehicles.js:2436-2440`, `:3021-3030`), the LAAT has no bay (its "troop compartment" is a 10 cm dark plate, `Vehicles.js:1618-1622`), no hull has a parked/static-open pose (every one is transform-owned per frame by its director), and there is **no Doppler anywhere** (verified: `grep -i "doppler|speedOfSound|setVelocity"` over `src/` and `tools/` is empty), so a ship taxiing past is a gain ramp.

**11. Faction insignia. ~120 lines.**
Verified: none exists. The only thing called an insignia is a rank chip (`RANKS`, `Command.js:657`). No crest, sigil, roundel or emblem geometry or texture anywhere. `addSign` (`Props.js:6388`) exists with nothing to put on it.

**12. A hangar check suite. ~300 lines.**
`tools/checks/hangar.mjs`, house style, `clocked` if it steps the world.

---

## 3. THE FIVE HARDEST PROBLEMS

### I. The view has to carry the whole scene, and none of it exists

**Constraint.** Everything procedural, cel-shaded, banded, no bundler, ink pass runs a second full rasterisation of every opaque object (`Engine.js:2893`).

**Approach.** All three elements live in `SkyDome`'s fragment shader (`SkyDome.js:212-624`), not in the world.

- **Planet**: analytic disc on `dot(viewDir, uPlanetDir)` with `uPlanetCos` for angular radius, terminator from a second dot against `uSunDir`, surface from 2-3 `pnoise` octaves in the direction basis, then `saberCelBand(col, 3)` per REFERENCE.md rule 1. Copy the sun-disc handling at `Engine.js:2118-2130`. **Palette derived from the level record, not typed** — `Menu._levelArt` (`Menu.js:3947`) already proves the pattern: it composes a cel painting from `atmosphere.skyColor/sunColor/fogColor` + `L.groundColor`. Feed the planet `LEVELS[k].groundColor` + `TERRAIN_PRESETS[L.terrain].{sandColor, rockColor}` + `atmosphere.{cloudCover, cloudLit, cloudDark, cloudWindDir}` + `L.water.{level, deep, kind}`. That is a genuinely biome-matched planet with no new authored data, and it means the planet changes when the player changes theatre.
- **Stars**: hash-on-direction inside the same fragment, gated by `uStars`, quantised like everything else. Zero new draw calls. Do **not** copy `Extraction._makeSpace`'s 900 `Points` — that is a second draw call, its own `frustumCulled=false` bookkeeping, and it fades by opacity rather than by band.
- **Space battle**: one `addHorizon`-shaped ring (`Scenery.js:4595`) at fixed radius with hull silhouettes replacing the harmonic profile, `ridgeMaterial()` (`Scenery.js:4461`) verbatim so you inherit `aFar = the sky in that bearing`, the shared extinction integral and `CEL.fogBands`. Bolt streaks as additive quads on that same ring, on a scripted timeline. Do not use `BoltPool` — it is world-space and would be fogged and inked.
- **Shield wall**: `buildShieldBubble`'s material (`Bodies.js:7507`) on a cylinder segment. Already `saberNoInk`, already additive, already four flat bands.

**Gotchas.** `SkyDome`'s shader must not use `fwidth`/`dFdx` if any of it is appended to `<common>` — that chunk is included by vertex shaders (`Cel.js:362`). Mark every new string `/* glsl */` or `verify.mjs:2969`'s lint skips it silently. No backticks inside a glsl template literal (same lint, has cost two debugging rounds). No GLSL ES 3.00 reserved words as identifiers — `flat`, `sample`, `filter`, `packed`, `mat`, `half` (`verify.mjs:3043`).

### II. A walkable body with no fight, in a world with no director

**Constraint.** `Player` is the combat body by construction: look goes through `SaberController.applyInput` (`Player.js:3640`), which owns the mouse and returns the camera's share. `World.js:1018` unconditionally builds a director. `HUD.js:2198` dereferences `world.director.wave` with no `?.` and would throw every frame.

**Approach.** Two pieces, both copies of existing shapes.

1. **`if (this.hosting)` in `_readInput`, immediately after `if (this.driving)` (`Player.js:3603`).** Same structure: claim `mouse.wheel`, call `control.applyInput` with `bladeHeld` false, `camera.addYaw/addPitch`, honour `view`, and return before the blade block — but *without* the drive branch's suppression of `_move`, and with an explicit allow-list for the Force verbs the hangar wants (grip, push, pull, stasis, jump). This is the file's own established idiom, it keeps one reader of `mouse.dx`, and it is ~40 lines.
2. **A `HangarDirector` that answers the HUD's four questions** — `wave`, `active`, `intermission`, `state()` — and does nothing. Cheaper and safer than adding `?.` at `HUD.js:2198`, which would be a shipped-rule edit made for a scene, and `hud.show(false)` should be up for the whole hangar anyway. `DojoDirector` (`World.js:916`) is the precedent for a director that reads nothing off the level.

Do **not** try to run with `world.terrain === null`. Five sites are unguarded — `World.js:862` (`roomOf(L, terrain.surfaceAt(0,0))`), `:4013` (`terrain.flush()` every frame, verified unconditional), `:3167-3169` (`pickSpawn`), `:871` (`terrain.size + 60`, guarded by `L.water`), `:5680`. `terrain.warship` costs nothing to keep and gives you the deck for free.

### III. Draw calls, with figures in the room

**Constraint.** Hangar Bay Nine measured **395 draw calls** against `world-immersion.mjs:624`'s 520-mesh dressing bound — 76% of budget, for an *empty* room; its first cut was 593, over the bound. Current levels: geonosis 225, mustafar 224. The ink pass rasterises every opaque object a second time. Ten unmerged figures = 495 meshes / 93 360 tris; 24 = 1 202 / 225 384 (measured in the report, consistent with `characters.mjs:714`'s <76 meshes per archetype).

**Approach.** Three cuts, in this order.

1. **Drive `MergedSkin` from a bare rig.** `buildMergedSkin(rig, opts)` (`MergedSkin.js:341`) already accepts one; only `applyMergedSkin` (`:487`) is owner-shaped. 24 figures × 4 draws = 96. `BAKES_PER_FRAME = 1` (`:460`) means 24 frames to bake — invisible on entry. **Do not use `Cohorts`**: its own note (`Cohorts.js:495`) says a standing figure captured into the pose palette "would put a slice of parade rest in the middle of a stride."
2. **Budget the room at ~250 dressing calls, not 395**, and spend the difference on figures. That means the `Kit` (`Props.js:1335`) does the work — one mesh per *material* per hand-placed assembly, and `addRuin`'s 9-destructible-pieces-in-6-calls trick for anything that must break.
3. **Figures are rig-only props, not `Enemy` instances.** No archetype, no physics capsule, no ragdoll, no AI, no `_pose` running per frame. Build via `buildParadeFigure`'s pattern (`Menu.js:3404`) — the four paint methods work against a three-field stub, so you get rank, mark, band and scars for 3.26 µs each. This also sidesteps the fact that a real `Enemy` in a world will walk and aim.

### IV. Customization that changes the man in front of you, live

**Constraint.** Two mechanisms with opposite costs. Paint is *material colour* on three per-figure materials that map 1:1 onto `PAINT_SLOTS.flesh` (`Bodies.js:6289` ↔ `Bodies.js:7025`). Kit is *geometry*, merged per material per bone by `Kit.bake` (`Bodies.js:1312`) — a pauldron cannot be hidden with `mesh.visible` because it is inside a shared buffer. Today one visor click runs `_restage` (`Menu.js:7536`), whose signature includes `JSON.stringify(look.kit)` and `JSON.stringify(look.paint)` (`:7545-7547`), which calls `_stageDisposeAll` (`:7639`) and rebuilds *every figure on the ground*: 160-430 ms and a full GPU re-upload for a colour.

**Approach.** Split the two and be honest about the difference in the fiction.

- **Paint is instant.** Keep `built.palette` (one line at `Menu.js:3416`), add `applyPaint(figure, look)` → `palette.plate.color.setHex(hex)`. Microseconds. Every paint control becomes a live scrub. `Command.js:11725` already names this as the handover item.
- **Kit is a commit.** `_restageOne(designation)` rebuilds one figure in ~15-19 ms — one frame. Give it a diegetic beat: the man steps forward, a second of armourer work, the new piece is on. That is better than a crossfade and cheaper than per-piece meshes.
- **A synthetic `man` for preview.** Every path today is store → build, and there is no dirty/commit/revert concept. `buildParadeFigure` takes a man *object*, so `{...man, look: candidate}` works with no store write. Commit through `Company.dress` / `Muster.dressRecruit` — the only two doors, both take a whole `kit` or `paint` object so the store can never hold a half-written set.

### V. Populating the deck — there is no non-combat body in this game

**Constraint.** Verified: no astromech, no pit droid, no mouse droid, no technician, no medic, no civilian, no idle NPC of any kind. `pilotBody` (`Vehicles.js:1997`) and `droidPilotBody` (`:2682`) are the only crew figures and both are seated with rod arms. There is no non-combat AI either — every archetype is a fighter and `DojoDirector` (`Dojo.js`) is the only director that places things relative to the player instead of the level.

**Approach — and this is the one where I would cut hardest.**

- **A repair droid is one new `Props.Kit` maker, not a body.** Treaded chassis, a torso on a turntable, one articulated arm, a welder emitter. ~200 lines, 5-6 material bins, single-digit draw calls. Animate it with three `Object3D` rotations and one `sparkBurst`/`cutFlare` from `Particles` (`Particles.js:1179/1277`) — no rig, no `BipedAnimator`, no IK, no nav.
- **Crew that walk are the expensive lie.** A walking figure needs a rig, a gait solver instance, a path, and something to walk *to*. Instead: crew that **stand and work** — at a console (`makeConsole`, `Props.js:2224`), on a gantry (`addGantry:5632`), under a hull — posed once with `solveIK` in the `poseSaberArm` idiom (`Menu.js:2960`). A static figure with a good pose in a good place reads as work; a figure orbiting nothing at 4.2 m/s reads as an AI game, which is the exact phrase in the deletion note.
- **Fill the CIS cradles.** `Vehicles.js:2882-2894` builds six droid cradles a side with charging contacts and status lamps and hangs nothing on them. A powered-down `buildB1` in each is the single highest-value-per-line piece of population in the feature.

---

## 4. WHAT IT WOULD BREAK

**Concrete, verified.**

1. **`quitToMenu` executes the company roll.** `main.js:1279` calls `bank()` unconditionally. `bank()` (`main.js:1421`) is gated only on `world.command` truthy, not versus, not a net session (`:1424`). `world.command` is non-null whenever `leadsArmy` is true, and `leadsArmy = campaign || contingent > 0` (`World.js:1017-1041`) where `contingent` comes from `settings.allies` — a **persisted global slider**, default 0, that any player who has touched it carries into every world. `world.manifest` is null at construction (`World.js:475`) and only sealed by a real ending, so `bank` reads `[]` (`main.js:1446`) and calls `Company.keep([], {deployed: roster.all, left: roster.all, ended:'quit'})` — and `keep`'s rule for a deployed man not on the manifest is that he is dead. **Walking out of a hangar wipes the permadeath roll, silently.** Fix: the hangar world must never build a `CommandDirector`, and `leaveHangar()` must not call `bank()`.

2. **Phantom runs in `saber.progress.v1`.** `main.js:1277` `record()`; guard is the per-world `world._recorded` (`main.js:1479`), so every visit is eligible. It files `mode: sessionOr('mode')` (`main.js:1504`) — read from **settings, never from the world**. `Progress.recordRun` does `p.runs++`, `p.kills += …`, `p.recent.unshift(…)` with a 40-deep `recent[]`. Ten hangar visits evict ten real runs. The one thing that saves you: `RECORDED` (`Progress.js:175`) is a whitelist and `recordRun` returns early on an unknown mode — so this is safe **if and only if** the world's mode key is not in that whitelist *and* `settings.mode` is what carries it.

3. **Muster slate spent for nothing.** If the hangar routes through `deploy()`, `buildWorld` calls `veteransToField()` (`main.js:477` → `:195`) which caches recruit designations, and `deploy` calls `Muster.consume(...)` whenever `world.command` exists (`main.js:849-852`). `consume` deletes those recruits from the slate (`Muster.js:594-602`). Pre-rolled recruits permanently spent on a scene nobody fought in.

4. **`HUD.update` throws every frame with no director.** `HUD.js:2198` `el.wave.textContent = world.director.wave`; `:2214/2217/2219/2222` the same for `.state()`, `.active`, `.intermission`. Verified: no optional chaining on any of them. `World.js:1018` is why nothing guards it — there is no directorless world today.

5. **Escape becomes a dead key if you add a state.** `Screens.LIVE` (`Screens.js:60`) is a fixed 7-name array and `pause()` (`Screens.js:341`) refuses `if (!LIVE.includes(this.state) || !this.io.world())`. A new `'hangar'` state is unexitable. Worse, `main.js:2462` steps the world only at `'playing' || 'dead'`, so the scene also freezes. `Screens.js:40` says this is the exact class of bug the module exists to prevent.

6. **Engine atmosphere bleed both ways.** `applyAtmosphere` (`World.js:819` → `Engine.js:2200`) is the only writer of sky uniforms, `sunDir`, three shadow cascades, `sun.color/intensity`, `hemi.*`, `scene.fog`, `scene.background`, `scene.environment`, and **nothing reverts any of it**. `World.unload()` (`World.js:1644-1826`) resets `setDrain(0)`/`setBars(0)` at `:1682-1683` and pointedly not `engine._focusTarget` (`World.js:3789`) or `_radialTarget` (`:4083`). A hangar that sets `sky:false, bgColor:…` leaves a flat black background over the next deploy on any path that skips the call; quit while holding Focus and the next run opens desaturated.

7. **`hud.freecam` pins a disposed world.** `HUD.js:972-973` holds `.world` and `.camera` hard refs — including the dead world's Rapier heightfield — and they are only cleared on the next `hud.update` with a different world (`HUD.js:2097`), which never runs at `state === 'menu'` (`main.js:2462`). Quit from photo mode and the previous world is alive for the whole menu session. `quitToMenu` should call `hud.freecam.exit(hud)`; it doesn't.

8. **`hud.announcer` never resets.** `Announcer.js:269 reset()` exists with **zero callers outside the constructor**. The hangar inherits the last fight's kill/deflect/perfect deltas and a `pending[]` queue holding dead `Enemy` refs.

9. **`#deploy-card` and any new overlay are invisible to the pad.** `Menu._padHost` (`Menu.js:8570`) walks a hardcoded list — `boon-draft, muster, death, pause, meditation, menu`. Verified. Anything not in that array cannot be reached with a controller.

10. **`#scoreboard` (`index.html:1754`, z-38) and `#commune` (`:1961`) live outside `#hud`**, so `hud.show(false)` does not hide them; they are gated separately at `main.js:2455` and `:2460` on `screens.state`.

11. **`installGround` throws on a name collision** (`Battlefield.js:933`) and `removeGround` throws on an authored row (`:944`). If the hangar installs a runtime preset it must remove it in a `finally`; `World.js:1653 _dropGeneratedGround()` is the one place that already does this correctly.

12. **`battlefield: true` is the one level flag a hangar must not declare** — `Battlefield.js:881` refuses roofed and flat grounds, and `theline.mjs` plus `prop-seating.mjs:871` go red.

13. **Packer.** `tools/pack.mjs` — module specifiers must be static string literals in one of three regex shapes (`pack.mjs:52`); a computed or template specifier is never rewritten and becomes a dead module with no error. `import.meta.url` is replaced with a dead URL (`:96`). Only `assets/**.{png,webp,jpg,gif,svg}` are inlined (`:139-160`) — a hangar preview jpg is fine, anything else must be generated. `--min` must keep `minifyIdentifiers: false` because `Props.assertOpts` derives a builder's legal options from `fn.toString()`; renaming empties the set and every deploy dies with `zn: handed an option it does not read`. Plain build is 25.36 MB (9.4 MB over the 16 MB artifact cap); `--min` is 12.45 MB with 3.55 MB headroom. A hangar costs ~0.2 MB of that. **The budget this eats is the frame, not the file.**

---

## 5. THE SEAM

**A `LEVELS` entry + a `MODES` row, entered through a sibling of `deploy()`, not through `deploy()` itself, and not through a new `Screens` state.**

Concretely, five edits:

1. `LEVELS.hangar = { name, blurb, terrain:'warship', pool:[], groundColor, spawnRadius, start, atmosphere:{sky:false, bgColor, …}, ambience, dust, grass:0, dress: dressHangar }` — `DOJO_LEVEL` (`Dojo.js:870`) is the working template for every field. **Not** in `LEVEL_ORDER` (a hangar is not a theatre to pick), which means opting out of 47 suites and writing `tools/checks/hangar.mjs` deliberately instead.
2. `MODES.hangar = { name, blurb, level:'hangar', fixedTheatre:true, insertion:false, fixedRules:'…' }` in `Waves.js:125`. `World.js:711` honours `MODES[mode].level` as a ground override; `Menu._syncTheatre` (`Menu.js:4384`) greys the theatre column off `fixedTheatre`; `Extraction` skips the 28 s orbital descent off `insertion:false` (`Waves.js:~276`, exactly as `MODES.sandbox` does).
3. One optional parameter on `buildWorld` (`main.js:451`): `buildWorld(levelKey, onProgress, runSeed, override)` → `new World(engine, {...worldSettings(), ...override}, …)` at `main.js:476`. **This is the whole trick.** `worldSettings()` (`main.js:158`) returns the live `settings` object by reference when there is no session; overriding at the call site means `settings.mode` on disk is never touched, so `record()`'s `sessionOr('mode')` (`main.js:1504`) cannot file a hangar visit under the player's last real mode, and `saveSettings` never runs.
4. `enterHangar()` beside `deploy()`: `buildWorld('hangar', onProgress, seed, {mode:'hangar', allies:0})` → `world.spawnPlayer` → `menu.hideMenu(); screens.clear(); screens.state = 'playing'; input.enabled = true; input.requestLock()`. It skips `saveSettings`, skips `mintRunSeed` semantics, skips `veteransToField`'s consume path, and skips the mode-start block (`main.js:894-936`). `allies:0` forces `contingent = 0` → `leadsArmy` false → `world.command` null → `bank()` is a no-op even if it ever fires.
5. `leaveHangar()` beside `quitToMenu()`: everything `quitToMenu` does **minus** `record()` (`:1277`) and `bank()` (`:1279`), **plus** `hud.freecam.exit(hud)` and `hud.announcer.reset()`.

**Why `screens.state = 'playing'`.** It is already in `LIVE` (`Screens.js:60`), so Escape, Start and pointer-lock loss all route to `pause()` (`Screens.js:336`) with no new code; `main.js:2462`'s frame gate steps the world; `showPause` (`Menu.js:10232`) works as-is because `pauseStats()` (`main.js:1031`) is fully optional-chained, `sandboxLive()` (`main.js:1238`) reads `world.director?.…`, and `report()` returns null without `world.command.log`. The only pause-card change is repointing or hiding `btn-restart`.

**Against the alternatives:**

- **A new `Screens` state (`'hangar'`).** Costs `LIVE`, `_padHost`'s array (`Menu.js:8573`), the frame gate (`main.js:2462`) and a `card()`/`take()` pair, and gets nothing back. Every guarantee it would buy — remembered, escapable, restored by resume — is already the property of `'playing'`. `Screens.js:40` is explicit that a reachable state without an exit is the bug the module exists to prevent, and this is how you write one.
- **An overlay over a live world** (the meditation pattern, `main.js:1093/1181/1195`). Four lines and correct — but the hangar *is* the world. There is nothing underneath for it to overlay.
- **A second `WebGLRenderer` panel in the menu, like `_startStage` (`Menu.js:7384`) or `_startPreview` (`:5239`).** This is the tempting one and it fails the ask outright: no `RapierWorld`, no `Player`, no `Force`, no ragdoll, no `Terrain`, no `applyAtmosphere`, no post chain — no bloom, no ink, no cel banding, no aerial perspective. The parade stage's lighting is a hemi + key + rim (`Menu.js:7407-7411`) and its shadow maps are not even enabled. You would be reimplementing the engine inside the menu, and you would already have three live GL contexts. It is the right answer for a *portrait* and the wrong answer for a *place*.
- **A plain `LEVEL_ORDER` entry, deployed normally.** Puts a hangar card in the theatre grid (`Menu.js:4331`), makes it a place you can pick to fight on, subscribes it to 47 level suites it will fail (weather, ground cover, spawn legality, generated fronts), and — because `deploy()` runs `saveSettings`, `veteransToField`, `Muster.consume`, `record` and `bank` — walks straight into every corruption in §4.
- **`installGround` at runtime** (`Battlefield.js:932`). Right tool for a *generated* deck, wrong tool here: `terrain.warship` is an authored row that already exists, and installing over it throws by design.

The menu button belongs in the **Company tab** (`Menu._buildCompany`, `Menu.js:5941`), not the Play tab — this is where a player already goes to look at their men, `showMenu()` (`Menu.js:3594`) is already the per-return refresh point, and the tab-injection pattern at `:5941-5988` is the template to copy. Bind it in `_buildButtons` (`Menu.js:9217`) via the local `bind(id, fn)` helper → a new `onHangar` hook in the `main.js:292-357` literal.

---

## 6. HONEST VERDICT ON SCOPE

### Achievable at a very high bar

**The view.** This is the codebase's strongest suit and nearly all of it already exists in the right places. A biome-matched planet derived from `LEVELS[k].groundColor` + `TERRAIN_PRESETS` + the atmosphere block, cel-banded in `SkyDome`'s fragment for zero draw calls, is not a compromise — it is better than a textured sphere would be here, and it changes with the theatre the player picked. Stars in the same shader. The shield wall reusing `buildShieldBubble` is a finished, correct, house-pattern energy shader. Distant hulls through `ridgeMaterial` inherit correct aerial perspective and banding for one draw call. **This is where the effort should go and it will land.**

**The deck as a place.** `terrain.warship` is a real ship in plan with a launch trench, a bridge and a corridor spine, authored against `descent.mjs`'s walls-you-cannot-climb bound and already checked. `Props.js` has every part. The transport bay's design note (`Vehicles.js:2100-2114`) is a written rulebook for exactly this room, from somebody who already got it right once.

**Walkable, physical, force-powered.** Nearly free. The `driving` branch is the template, the powers are already defensive about empty `ctx.enemies`, `meadow.html` and `MODES.sandbox` already prove a real World with zero hostiles. Gripping a crate off a rack and hurling it down the deck works today with no new code.

**Named troops, standing, inspectable, live-repainted.** With the palette handle kept and `MergedSkin` driven from a bare rig, 24 named men in the room at ~96 draw calls with instant paint scrubbing. This is genuinely the best version of the Company tab that exists.

### A mediocre imitation of the ask

**Deck traffic.** Ships taxiing in and out will be bad and there is no cheap fix. No hull has a parked pose — every one is transform-owned per frame by a director. Landing gear is merged and permanently down (`Vehicles.js:2436-2440`). The LAAT has no bay: at 3 m you see a 10 cm dark plate where the famous open compartment should be (`Vehicles.js:1618-1622`). And there is no Doppler and no cone directivity anywhere in `Audio.js`, so a ship passing you is a gain ramp with an engine nozzle facing every direction at once.

**Repair droids doing work.** No non-combat body class, no task AI, no tool VFX, no idle poses, no rig that is not a fighter's. Walk-cycle figures orbiting nothing is precisely the "reminds you this is an AI game" failure.

**An ongoing space battle as an event.** Scripted streaks between static silhouettes at fixed radius. Fine as ambience. It cannot be a battle you watch turn.

**Live kit swapping.** Kit is baked geometry (`Kit.bake`, `Bodies.js:1312`). A pauldron toggle is a rebuild, full stop, unless you break the merge — which trades one draw call for six per figure and blows §3.III.

### What I would cut

1. **Deck traffic as motion.** Park the hulls instead. One LAAT on jacks under a gantry with a crane trolley over it (`addGantry:5632` already has the trolley) is a better shot than three ships sliding past, and it is the only way the merged geometry is honest. If one ship must move, move it **once**, on entry, at distance, through the shield wall — a single scripted arrival, not traffic.
2. **Repair droids as workers → repair droids as machines.** One `Props.Kit` maker on treads with an arm and a welder emitter, no rig, no nav. Three of them stationary at three jobs.
3. **Walking deck crew.** Replace with posed standing crew at consoles and on gantries, one `solveIK` pose each in the `poseSaberArm` idiom.
4. **The Confederacy hangar, if both factions were in scope.** Republic only. The Providence hull is 5 meshes / 1 142 tris built explicitly for a 400 m astern shot (`Vehicles.js:3195`) — *"nothing on it is smaller than about four metres"* — and cannot be the shell of a room you stand in. The Republic at least has the transport bay's language to copy.
5. **Faction insignia.** None exists; it is 120 lines of new geometry for a wall decal. Use the **rank chips** that already exist (`RANKS`, `Command.js:657`) and the deck's own scorch memory (`loose.soot: 1.0`) instead.
6. **Live kit.** Paint is instant; kit is a one-frame commit with a diegetic beat.

### The one thing to decide before writing any code

**Is the aperture the whole room?** If the answer is yes — if the deck is a foreground for a planet and a battle, lit from outside, with the shield wall as the brightest thing in frame and the walkable floor deliberately narrow — then this is not the class of level that was deleted three times and it can be very good. If it drifts into a big enclosed bay with the view as a window at one end, it is the Invisible Hand again, and `Levels.js:4876` already recorded what happened: *"a box with a window."*