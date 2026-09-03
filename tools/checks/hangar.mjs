/**
 * BATTLEFRONT BORZ — THE FLIGHT DECK, AND WHETHER IT IS A BOX.
 *
 * `Levels.js` has deleted six interior levels on the same instruction, three
 * separate times — Hangar Bay Nine, the Invisible Hand, the Boarding Bay, the
 * Temple Halls, the Intake, the Cut. The reason is recorded there and it is not
 * a budget: "a roof plus four walls at the draw budget this engine has is a
 * box, and a box is the one shape that cannot be anywhere." Hangar Bay Nine
 * measured 395 draw calls for an EMPTY room and read as a box anyway.
 *
 * Every one of those levels passed its suites. So the first thing this file has
 * to do is hold the shape, not the dressing — and the shape is checkable. It
 * held the opposite shape for a while (one wall, no ceiling, ever) and the
 * player's verdict on that room was that its edges were "a janky mess" and it
 * "looks weird without a ceiling". What it holds now is his room:
 *
 *   FIVE SIDES.      Two full-length walls, the bulkhead and a lid close it;
 *                    thirteen of sixteen bearings out of it are stopped.
 *   ONE OPENING.     The three forward bearings reach space, and the planet
 *                    stands in them.
 *   A LID, NOT A BOX. The ceiling is at DECK.roof, above the walls, and a
 *                    good share of the deck is under structure hung well
 *                    below it — girders, rails, cables, fighters.
 *   IT IS BIG.       200–400 m, and the lip is the heightfield's edge.
 *   THE VIEW IS THE ROOM. The aperture subtends more of the frame than the
 *                    interior does, from where the player is put down.
 *
 * And the second thing it has to do is hold the two ways this room could
 * silently destroy a save, both of which are real and both of which are one
 * line away: a `CommandDirector` on the deck means `bank()` strikes the whole
 * roll as dead on the way out, and a `record()` on the way out files a phantom
 * run into a 40-deep history.
 */

import { readFile } from 'node:fs/promises';
import * as Waves from '../../src/game/Waves.js';
import { CommandDirector } from '../../src/game/Command.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { DECK, HANGAR_LEVEL, HangarDirector } from '../../src/game/Hangar.js';

/** Boot the deck through the same door the game uses. */
async function deck() {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world, engine } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  return { world, engine, input: idleInput() };
}

/**
 * Rays against everything drawn in the room except the field and its rim.
 * The field is a plane the player looks THROUGH; a ray that stopped at it
 * would call the opening closed.
 */
function caster(THREE, world) {
  const ray = new THREE.Raycaster();
  const solid = [];
  world.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (o.material?.userData?.saberNoInk) return;
    if (o.name === 'field-rim') return;
    solid.push(o);
  });
  const cast = (from, dir, far) => {
    ray.set(from, dir.clone().normalize());
    ray.far = far;
    return ray.intersectObjects(solid, false)[0] || null;
  };
  return { solid, cast };
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The shape                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hangar: a room closed on five sides and open on the sixth, which is forward', async () => {
    /**
     * SIXTEEN BEARINGS OUT OF THE ROOM, by ray, from thirty metres over the
     * middle of the deck. This file used to prove the OPPOSITE — one wall,
     * fifteen open bearings, "no ceiling, ever" — and the player's answer to
     * that room was "the hangar was too big outside of the side walls, you
     * were able to go behind them and it's just a janky mess on the edges,
     * ships were going through the side walls, give the hangar a solid
     * ceiling". So the shape this holds is the one he asked for: the two
     * rack walls run the full length, the bulkhead closes the aft, the lid
     * closes the top, and the ONE way out is the aperture forward — which is
     * still the whole view, and still has to be open to the planet.
     *
     * Rays and not bounding boxes, because the room is merged into a mesh
     * per material and a box cannot say what is in front of what.
     */
    const THREE = await import('three');
    const { world } = await deck();
    try {
      const { solid, cast } = caster(THREE, world);
      const from = new THREE.Vector3(0, 30, 20);
      const open = [], shut = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const hit = cast(from, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 600);
        const deg = Math.round((a * 180) / Math.PI);
        const forward = i === 0 || i === 1 || i === 15;
        if (forward) {
          assert(!hit, `the bearing ${deg}° — through the aperture — is closed ${hit?.distance.toFixed(0)} m out`);
          open.push(deg);
        } else {
          assert(hit && hit.distance < 170,
            `the bearing ${deg}° runs ${hit ? hit.distance.toFixed(0) + ' m' : 'open'} — the room is not closed there`);
          shut.push(deg);
        }
      }
      /* THE WALLS RUN THE FULL LENGTH: from the centreline, both ways, at
       * every thirty metres from the bulkhead to the lip, something solid
       * stands within a metre past DECK.wall and no more than sixteen inside
       * it (the racks). A gap is the "janky mess on the edges". */
      let gaps = 0;
      for (let z = DECK.aft + 10; z <= DECK.lip - 4; z += 30) {
        for (const s of [-1, 1]) {
          const hit = cast(new THREE.Vector3(0, 12, z), new THREE.Vector3(s, 0, 0), 300);
          const d = hit ? hit.distance : Infinity;
          if (!(d <= DECK.wall + 1 && d >= DECK.wall - 16)) gaps++;
        }
      }
      assert(gaps === 0, `${gaps} stations along the deck see past a side wall`);
      /* AND THE BULKHEAD IS AFT, in the ground as well as in the dressing. */
      const P = TERRAIN_PRESETS.hangardeck;
      const aftFace = -P.scale / 2 + 8;
      assert(P.height(0, aftFace) > 25,
        `the ground ${aftFace.toFixed(0)} m aft rises ${P.height(0, aftFace).toFixed(0)} m — there is no bulkhead behind the player`);
      const aft = cast(new THREE.Vector3(0, 12, -60), new THREE.Vector3(0, 0, -1), 200);
      assert(aft && aft.distance < 60, 'nothing solid stands aft of the muster line');
      return `${shut.length} bearings closed, ${open.length} open (${open.join('°, ')}°) · walls whole at 16 stations · ${solid.length} solids by ray`;
    } finally { world.unload(); }
  });

  check('hangar: the deck ends at the field, and the planet is in the opening', async () => {
    /**
     * THE HEIGHTFIELD'S EDGE IS THE LIP, and everything placed off DECK.lip —
     * the strobes, the field, the barrier, the transport's run out — stands
     * where the deck is. It is big, and big is the brief: the references are
     * enormous, and 128 m read as a shed. But past about 400 m a player
     * cannot cross it in under a minute, and a room nobody crosses is a
     * corridor.
     *
     * And the opening is OPEN: a grid of rays forward from thirty metres
     * inside the lip, at five heights, reaches space. "The planet/war wasn't
     * facing the main force field, it was behind the hangar, it should be
     * visible in front of you when you spawn in" — so the orbit's planet
     * bearing is read off the real SkyDome and has to be forward.
     */
    const THREE = await import('three');
    const P = TERRAIN_PRESETS.hangardeck;
    assert(P, 'there is no hangardeck ground');
    assert(P.scale >= 200, `the deck is only ${P.scale} m across — the brief is "scale must be immense"`);
    assert(P.scale <= 400, `the deck is ${P.scale} m across — past about 400 a player cannot walk it`);
    assert(P.flat === true, 'the deck is not flat');
    assert(DECK.lip === P.scale / 2,
      `DECK.lip is ${DECK.lip} and the ground ends at ${P.scale / 2} — the strobes, the field and `
      + 'the barrier are all placed off DECK.lip and would stand somewhere the deck is not');
    const { world, engine } = await deck();
    try {
      const { cast } = caster(THREE, world);
      const blocked = [];
      for (const y of [3, 20, 45, 60, 80]) {
        for (const x of [-60, -30, 0, 30, 60]) {
          const hit = cast(new THREE.Vector3(x, y, DECK.lip - 30), new THREE.Vector3(0, 0, 1), 400);
          if (hit) blocked.push(`(${x}, ${y}) at ${hit.distance.toFixed(0)} m`);
        }
      }
      /* One overhead chamfer piece may sit in the topmost row; the view is
       * the other twenty-four. */
      assert(blocked.length <= 2 && blocked.every((b) => /, (60|80)\)/.test(b)),
        `the opening is closed at ${blocked.join('; ')}`);
      const sd = engine?.skyDome;
      const dir = sd?.mat?.uniforms?.uPlanetDir?.value;
      assert(dir, 'the SkyDome has no planet bearing to read');
      assert(dir.z > 0.85 && dir.y > -0.05,
        `the planet is at (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)}) — not in the opening in front of the player`);
      return `${P.scale} m of deck, lip at ${DECK.lip} m, ${25 - blocked.length} of 25 forward rays reach space, planet at z=${dir.z.toFixed(2)}`;
    } finally { world.unload(); }
  });

  check('hangar: a lid, high over the walls, and busy underneath — not a box', async () => {
    /**
     * "Give the hangar a solid ceiling (but very high up even higher than the
     *  side walls you have now, it just looks weird right now without a
     *  ceiling), but the ceiling can't make the hangar look like a shitty box
     *  like you've done in the past — a billion things going on."
     *
     * Three facts, by rays straight up from a grid over the whole deck:
     * everything is under SOMETHING (the lid is whole); the lid is where
     * DECK.roof says and no higher (the colliders close the top there); and
     * a good share of the deck is under structure hanging well below the
     * plate — girders, cables, crane rails, hung fighters — which is the
     * difference between a ceiling and a box.
     */
    const THREE = await import('three');
    const { world } = await deck();
    try {
      const { cast } = caster(THREE, world);
      let probes = 0, hits = 0, lid = 0, busy = 0, top = 0;
      for (let x = -DECK.wall + 6; x <= DECK.wall - 6; x += 8) {
        for (let z = DECK.aft + 8; z <= DECK.lip - 6; z += 8) {
          probes++;
          const hit = cast(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, 1, 0), 400);
          if (!hit) continue;
          hits++;
          top = Math.max(top, hit.point.y);
          if (hit.point.y >= DECK.roof - 6) lid++;
          else busy++;
        }
      }
      assert(hits >= probes * 0.97, `${probes - hits} of ${probes} deck points have nothing over them — the lid has holes`);
      assert(top <= DECK.roof + 4, `something over the deck is at ${top.toFixed(0)} m, above the roof at ${DECK.roof}`);
      assert(top >= DECK.roof - 2, `the highest thing over the deck is ${top.toFixed(0)} m — the lid is not at the roof`);
      assert(lid >= probes * 0.5, `only ${lid} of ${probes} points see the lid — it is not a ceiling`);
      assert(busy >= probes * 0.12,
        `${busy} of ${probes} points have structure hanging under the lid — that is a bare plate, a box`);
      assert(busy <= probes * 0.6, `${busy} of ${probes} points are under hanging structure — the lid is buried`);
      /* HIGHER THAN THE WALLS: over the wall foot, looking down from above the
       * roof, the first thing met is the lid, at the roof, not a wall cap. */
      for (const x of [-DECK.wall + 2, DECK.wall - 2]) {
        const hit = cast(new THREE.Vector3(x, DECK.roof + 30, 20), new THREE.Vector3(0, -1, 0), 200);
        assert(hit && hit.point.y >= DECK.roof - 2, `over x=${x} the lid is ${hit ? hit.point.y.toFixed(0) + ' m' : 'missing'}`);
      }
      return `${hits}/${probes} covered · lid ${lid}, hung structure ${busy} · top at ${top.toFixed(1)} m over a roof of ${DECK.roof}`;
    } finally { world.unload(); }
  });

  check('hangar: walking onto the deck cannot execute your company', async () => {
    /**
     * ══ THE BUG THIS ROOM WAS ONE LINE AWAY FROM ══════════════════════════
     *
     * `main.js`'s `bank()` is gated on `world.command` being truthy and nothing
     * else — not on the mode, not on a session, not on an ending. `world.
     * manifest` is null until a real withdrawal seals it, so `bank` reads `[]`
     * and calls `Company.keep([], {deployed: roster.all, left: roster.all})`,
     * and `keep`'s rule for a deployed man who is not on the manifest is that
     * he is DEAD.
     *
     * `quitToMenu` calls it unconditionally. So a deck world that built a
     * `CommandDirector` would wipe the entire permadeath roll, silently, every
     * single visit — and it would have, because `leadsArmy = campaign ||
     * contingent > 0` and `contingent` comes off `settings.allies`, a PERSISTED
     * GLOBAL SLIDER that any player who has ever touched it carries into every
     * world.
     *
     * TWO GUARDS AND BOTH ARE DRIVEN: the mode declares no campaign, and
     * `enterHangar` overrides `allies` to 0. The check forces the slider ON
     * first, because a fixture that leaves it at its default proves only that
     * the default is safe.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar',
      /* The dangerous shape: a player who plays with allies, walking onto the
       * deck. `enterHangar` is what forces the 0; this asserts the room is
       * safe even if that override were ever dropped. */
      settings: { mode: 'hangar', level: 'hangar', allies: 8 },
    });
    try {
      /**
       * THIS CHECK WAS RIGHT AND I WAS WRONG TO WEAKEN IT.
       *
       * Wanting the real order wheel on the deck, I set `world.command` to a
       * small adapter and rewrote this assertion to allow it — reasoning that
       * "no command" was only ever a proxy for "bank cannot fire". It is not.
       * `world.command` means "this is a commanded fight, with a roster, a
       * manifest and an ending" in a dozen places, and the very next thing to
       * read it was `buildWorld`, which calls `d.roster.summary()` on it: the
       * room threw on load and did not appear at all. `bank()` executing the
       * permadeath roll was the second consequence, not the only one.
       *
       * So the assertion is back exactly as it was, and the wheel got its own
       * handle instead. `world.orders` is read by `HUD.update` and
       * `main.orderKeys` and by nothing else.
       */
      assert(!world.command,
        'the flight deck set world.command — every other reader of that field takes it to mean a '
        + 'commanded fight with a roster and an ending. buildWorld calls d.roster.summary() on it '
        + 'and bank() treats every deployed man not on an extraction manifest as dead, so this is '
        + 'both a room that will not load and a roll that gets struck off on the way out');
      assert(world.orders?.deck === true,
        'the deck has no order adapter on world.orders, so HUD cannot build the order wheel and '
        + 'every one of DECK_ORDERS is unreachable by any input the game has');
      assert(!(world.orders instanceof CommandDirector),
        'the deck put a real CommandDirector on world.orders — it brings a roster, a manifest '
        + 'and an ending with it, none of which exist in a room where nothing is shooting');
      assert(world.director instanceof HangarDirector,
        `the deck built a ${world.director?.constructor?.name} instead of a HangarDirector`);
      assert(!world.manifest, 'the deck sealed a manifest');
      /* AND `bank`'s OWN GATE STILL CARRIES THE `d.deck` TERM, which is belt
       * and braces now rather than the load-bearing guard: nothing assigns the
       * adapter to `world.command` any more. It stays because the next person
       * who wants the wheel on some other screen will reach for `command`
       * first — I did — and this is the sentence that catches them. */
      const mainSrc = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
      /**
       * THE WHOLE FUNCTION, READ TO ITS REAL END.
       *
       * Two wrong ways first, both instructive. A regex matching to the first
       * line that is a lone brace found nothing — `bank` has no such line —
       * so the window was EMPTY and the assertion tested a pattern against the
       * empty string; it could not pass. Then a fixed 2600-character slice,
       * which `tools/checks/determinism.mjs` correctly refuses: a window is
       * right only until somebody adds a line, and it fails silently in both
       * directions. `functionBody` counts braces.
       */
      const { functionBody } = await import('./_source.mjs');
      const gate = functionBody(mainSrc, 'function bank(');
      assert(/if\s*\(!d \|\| d\.deck/.test(gate),
        'main.bank() no longer returns early for a deck adapter — the flight deck sets '
        + '`world.command` to open the order wheel, and bank() executes the roll of any world '
        + 'that has one');
      return 'allies forced to 8: no command, no manifest, wheel on world.orders, bank() still refuses a deck';
    } finally { world.unload(); }
  });

  check('hangar: a visit is not a run', () => {
    /**
     * `Progress.recordRun` does `p.runs++`, adds kills, and unshifts into a
     * 40-deep `recent[]`. `main.js`'s `record()` files under `sessionOr('mode')`
     * — read from SETTINGS, never from the world — so a destination that wrote
     * `settings.mode` would file its visits under the player's last real mode
     * and evict ten real runs in ten visits.
     *
     * Two things stop it and this pins both: `RECORDED` is a whitelist and the
     * deck is not in it, and `enterHangar` passes its mode as a `buildWorld`
     * OVERRIDE rather than writing `settings`.
     */
    const P = Waves.MODES.hangar;
    assert(P, 'there is no hangar destination');
    assert(P.hidden === true,
      'the flight deck is offered as a mode you can pick — a hangar in the theatre grid is the '
      + 'shape Levels.js has deleted three times');
    assert(!Waves.playableModes().includes('hangar'), 'playableModes offers the deck');
    assert(Waves.playableModes().length === Object.keys(Waves.MODES).length - 1,
      'playableModes is filtering something other than the deck, or nothing at all');
    assert(P.insertion === false,
      'the deck flies a 28-second orbital descent to reach the deck you are already standing on');
    return `${Waves.playableModes().length} modes a player can pick, and the deck is not one`;
  });

  check('hangar: the deck is a place, not a theatre', () => {
    assert(LEVELS.hangar === HANGAR_LEVEL, 'the level is not registered');
    assert(!LEVEL_ORDER.includes('hangar'),
      'the flight deck is in LEVEL_ORDER — it would be a card in the theatre grid and would be '
      + 'held to forty-seven suites about weather, ground cover, spawn legality and generated '
      + 'fronts, every one of which is a question about a battlefield');
    assert(HANGAR_LEVEL.atmosphere.sky === false, 'the deck has a sky dome over it');
    assert(!HANGAR_LEVEL.battlefield,
      'the deck declares `battlefield` — Battlefield.js refuses roofed and flat grounds and two '
      + 'suites go red');
    assert((HANGAR_LEVEL.pool || []).length === 0, 'the deck has an enemy pool');
    return 'in LEVELS, out of LEVEL_ORDER, no sky, no pool';
  });

  check('hangar: the room costs less than the one that was deleted for costing too much', async () => {
    /**
     * Hangar Bay Nine measured **395 draw calls empty** against
     * `world-immersion.mjs`'s 520-mesh dressing bound — 76% of the budget, for
     * a room with nothing in it — and was deleted anyway. The lesson recorded
     * there is that the count was never the problem, but it is still the
     * ceiling: the company has to stand in this room, and twenty-four merged
     * figures are about ninety-six draws.
     */
    const { world, input } = await deck();
    try {
      /* LET THE MEN FOLD. `MergedSkin` bakes one figure a frame, so a room
       * counted on its first frame is a room of forty unmerged rigs. Forty
       * frames is enough for the whole deck to bake; the game shows the room
       * after a lift ride longer than that. */
      /* 240 frames, from 48: `MergedSkin` bakes ONE figure a frame for the
       * whole world, and the deck stands thirty-five rigged workers beside
       * the company now. Four seconds is still shorter than the lift ride
       * the room is shown after. */
      for (let i = 0; i < 240; i++) world.update(1 / 60, input);
      /**
       * WHAT IS DRAWN, NOT WHAT IS IN THE GRAPH. The deck stands its company
       * and a crowd of troopers now, and every one of them is a rig of ~54
       * meshes folded into about seven by `MergedSkin` — with the originals
       * left in the graph, hidden. A traverse that counts hidden meshes
       * reported 1591 for a room whose renderer submits a fifth of that.
       * So a mesh counts only if it and every ancestor is visible, which is
       * the renderer's own rule. The men are counted separately below.
       */
      const drawn = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
      let meshes = 0, figures = 0;
      const roots = new Set();
      for (const r of [...(world._company?.men || []), ...(world._company?.crowd || [])]) if (r.fig?.root) roots.add(r.fig.root);
      world.scene.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || !drawn(o)) return;
        let man = false;
        for (let p = o; p; p = p.parent) if (roots.has(p)) { man = true; break; }
        if (man) figures++; else meshes++;
      });
      /* AND THE MEN ARE MERGED: a figure standing still is about seven
       * draws, and a room of forty men that has forgotten to fold them is
       * two thousand. */
      const nMen = roots.size;
      if (nMen) assert(figures <= nMen * 12,
        `${figures} drawn meshes for ${nMen} men on the deck — ${(figures / nMen).toFixed(0)} each; `
        + 'a merged figure is about seven, so somebody is standing unmerged');
    /**
     * 240, not 380. The first browser reading of the finished room was 988
     * meshes and **1035 draw calls** — against 225 for Geonosis, the 395 that
     * Hangar Bay Nine was deleted at, and an ink pass that rasterises every
     * opaque object a SECOND time. Composing the four dressing passes through
     * `Props.Kit`, which bins by material and emits one mesh per bin, took the
     * empty room from 336 to 193: spars 70 → 3, bulkhead 26 → 17, deck 103 → 36.
     *
     * The bound is set just above what the room actually costs rather than at
     * a round number, because the whole point is to notice the next thing that
     * forgets to compose.
     */
      /**
       * 320, FROM 240. The room stands two things now that are not kit and
       * cannot be: the army's REAL transport on the near pad (`DeckFlight`,
       * the same forty-odd meshes the insertion flies, because a ship you
       * walk into has to be a ship) and the lift car with its doors, panes
       * and shaft (`DeckLift`, which moves). Measured at 255 with both; the
       * bound sits just above so the next thing that forgets to compose is
       * still caught.
       */
      /**
       * 400, FROM 320 — TWO PASSES IN ONE ROUND, each measured on its own
       * branch and added here: THE DENSITY PASS at 352 (the crowd is
       * fourteen instanced poses and eight accessory kinds, the litter is
       * eleven instanced kinds of loose prop, two more hulls fly, and the
       * rams, hoist, canopy and boards move) and THE FLEET ACTION OUTSIDE
       * (`DeckBattle`) at fourteen instanced meshes, every one `saberNoInk`.
       * Every one of those is a KIND holding a hundred things; the bound
       * sits just above the honest sum, as before.
       */
      assert(meshes < 400,
        `${meshes} meshes dressing the deck. It was 352 with the kit composed, the transport, the lift, `
        + 'the crowd, the litter and the beats all standing, plus fourteen for the battle outside; '
        + 'something new is emitting per-prop, and the ink pass doubles whatever this is');
      assert(meshes > 60, `${meshes} meshes is not a hangar, it is a floor`);
      return `${meshes} meshes of room drawn (${figures} for ${nMen} men on the deck), against 395 for the room that was deleted`;
    } finally { world.unload(); }
  });

  check('hangar: the window outside is actually configured, which it never once was', async () => {
    /**
     * ══ THE CHECK THAT WAS NOT WRITTEN, AND COST SEVENTEEN BULLETS ════════
     *
     * `dressHangar` called `engine.sky.configureOrbit(...)`. The orbit window
     * lives on `engine.skyDome`; `engine.sky` is three's Preetham `Sky` mesh
     * and has no such method. The optional call swallowed it in silence, so
     * `SkyDome._orbit` stayed null, `uOrbit` stayed 0, and with
     * `atmosphere.sky === false` the dome was never even visible: outside the
     * field there was a background colour and nothing else. No planet, no
     * starfield, no fleet, no turbolasers, no dying capital ship, no city
     * lights, no landing craft. Every bullet of `HANGAR-SPEC.md`'s PLANET and
     * BATTLE sections — all seventeen, all ticked — described a shader that
     * had never run in the game.
     *
     * Two things let it live and this kills both. The stub engine had NEITHER
     * property, so the suites took exactly the same no-op path the browser
     * did; `_coop.stubEngine` carries a real `SkyDome` now. And the numbers in
     * the spec came from `tools/_orbitprobe.mjs`, which constructs a `SkyDome`
     * by hand and calls the method on it directly — a probe that builds its
     * own subject can test the subject and never the wiring to it.
     *
     * SO THIS ASSERTS THE WIRING AND NOTHING ELSE: that dressing the room left
     * an orbit on the dome the engine actually owns, and that the faction went
     * with it, without which a Separatist player watches his own fleet fire
     * Republic blue.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar',
      /* STEERED BY THE ORDER, which is the lever the player has. `settings.army`
       * is read by nothing and written by nothing — see `Hangar.deckFaction`. */
      settings: { mode: 'hangar', level: 'hangar', allies: 0, order: 'sith' },
    });
    try {
      const dome = world.engine?.skyDome;
      assert(dome, 'the stub engine has no skyDome, so this check cannot see the bug it exists for');
      assert(dome._orbit,
        'dressing the flight deck left no orbit on engine.skyDome, so the window outside is a '
        + 'background colour. That is the exact shape of the original bug: the call went to '
        + 'engine.sky, which has no configureOrbit, and the optional chain ate it');
      assert(dome.mat?.uniforms?.uOrbit?.value === 1,
        'the orbit uniform is off, so nothing outside the field is drawn whatever _orbit says');
      assert(dome._orbit.faction === 'separatist',
        'the window was configured with faction ' + JSON.stringify(dome._orbit.faction)
        + ' on a separatist deck. SkyDome colours the friendly bolts off this, so the player '
        + 'would watch his own fleet fire the enemy colour');
      return 'orbit on, faction ' + dome._orbit.faction + ', level '
        + (dome._orbit.level?.name || 'none');
    } finally { world.unload(); }
  });

  check('hangar: no material carries a field its own shader has no uniform for', async () => {
    /**
     * ══ THE CHECK FOR THE ONE CLASS OF BUG NOTHING HERE CAN SEE ═══════════
     *
     * Not one of this project's two thousand checks renders a frame, so a
     * crash inside `WebGLRenderer.render` is invisible to all of them. This
     * room shipped one: the field rim was an unlit `MeshBasicMaterial` — the
     * only kind that can promise reference rule 1's "brighter than anything it
     * lights" — and an `emissive` property had been hung on it purely to keep
     * an older check quiet. three's uniform refresh does
     *
     *     if (material.emissive) uniforms.emissive.value.copy(...)
     *
     * and `MeshBasicMaterial`'s uniform set has no `emissive`. Every frame that
     * drew the rim threw. Eight suites green, and the room could not draw.
     *
     * THE GUARD LIST IS READ OUT OF THE VENDORED THREE rather than typed here.
     * A hand-written list of "fields that need a uniform" is the second copy of
     * a rule three already states, and it would go stale on the next vendor
     * bump in the direction nobody checks — the instrument disagreeing with the
     * game and manufacturing a defect, or worse, missing one.
     */
    const THREE = await import('three');
    const src = await readFile(new URL('../../vendor/three/three.module.js', import.meta.url), 'utf8');
    /* THE WHOLE FUNCTION, by brace count — a fixed window over a VENDORED file
     * is the worst version of the guess `determinism.mjs` bans, because the
     * next vendor bump moves every line in it. */
    const { functionBody } = await import('./_source.mjs');
    const fn = functionBody(src, 'function refreshUniformsCommon(');
    assert(fn, 'refreshUniformsCommon is not where it was in the vendored three — this check '
      + 'derives its rule from that function and cannot make one up');
    /* Every `if (material.X)` whose body touches `uniforms.X`. Those are the
     * pairs where having the field without the uniform is a throw. */
    const guarded = new Set();
    for (const m of fn.matchAll(/if\s*\(\s*material\.(\w+)\s*\)\s*\{([\s\S]{0,240}?)\n\t\t\}/g)) {
      if (new RegExp('uniforms\\.' + m[1] + '\\b').test(m[2])) guarded.add(m[1]);
    }
    assert(guarded.size >= 4,
      `only ${guarded.size} guarded field(s) found in refreshUniformsCommon — the parse is wrong `
      + 'and this check would pass on anything');

    const SHADER = {
      MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong',
      MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical',
      MeshMatcapMaterial: 'matcap', PointsMaterial: 'points', SpriteMaterial: 'sprite',
      LineBasicMaterial: 'basic', LineDashedMaterial: 'dashed',
    };
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 },
    });
    try {
      const bad = [];
      const seen = new Set();
      let n = 0;
      world.scene.traverse((o) => {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m || seen.has(m.uuid)) continue;
          seen.add(m.uuid);
          const key = SHADER[m.type];
          /* A ShaderMaterial owns its own uniforms and answers for itself. */
          if (!key) continue;
          const u = THREE.ShaderLib[key]?.uniforms;
          if (!u) continue;
          n++;
          for (const f of guarded) {
            if (m[f] !== undefined && m[f] !== null && u[f] === undefined) {
              bad.push(`${m.name || m.type}.${f} (a ${m.type} has no uniforms.${f})`);
            }
          }
        }
      });
      assert(!bad.length,
        `${bad.length} material(s) carry a field their own shader has no uniform for: `
        + `${bad.slice(0, 5).join(', ')}. three's refreshUniformsCommon reads the uniform for any `
        + 'material that has the field, so every frame drawing one of these throws inside '
        + 'WebGLRenderer.render — in the browser only, which is the one place nothing here looks');
      return `${n} materials against ${guarded.size} guarded fields (${[...guarded].join(', ')})`;
    } finally { world.unload(); }
  });
}
