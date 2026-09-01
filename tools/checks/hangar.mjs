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
 * to do is hold the shape, not the dressing — and the shape is checkable:
 *
 *   ONE WALL.        Exactly one bearing out of the room is closed by ground.
 *                    A second is the Invisible Hand again.
 *   NO CEILING.      No geometry over the deck below the field, ever. This is
 *                    the one assertion in the file that must never be relaxed.
 *   IT ENDS.         The heightfield is 128 m and the deck's edge is the
 *                    heightfield's edge, so the ship runs out under your feet
 *                    rather than stopping at a wall or a fog bank.
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
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  return { world, input: idleInput() };
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The shape                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('hangar: one wall, and it is behind you', () => {
    /**
     * SIXTEEN BEARINGS OUT OF THE ROOM, asking each one whether the GROUND
     * closes it. `descent.mjs` walks a level this way to prove a room is
     * bounded; this walks it to prove the opposite about fifteen of them.
     *
     * The bulkhead is the wall and it is aft. Everything else has to run out
     * flat to the lip, because the moment a second bearing rises the deck has
     * a corner in it, and a room with corners is the shape that was deleted.
     */
    const P = TERRAIN_PRESETS.hangardeck;
    assert(P, 'there is no hangardeck ground');
    const R = P.scale / 2;
    const walled = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      let high = 0;
      for (let r = 6; r <= R - 4; r += 2) high = Math.max(high, P.height(dx * r, dz * r));
      if (high > 6) walled.push(`${Math.round(a * 180 / Math.PI)}° rises ${high.toFixed(0)} m`);
    }
    assert(walled.length >= 1, 'no bearing out of the deck is closed — there is no ship here at all');
    assert(walled.length <= 5,
      `${walled.length} of 16 bearings out of the deck are closed by ground (${walled.join(', ')}) `
      + '— that is a room with corners, which is the shape Levels.js has deleted three times');
    /* AND IT IS AFT. A wall in front of the player is a wall across the view. */
    for (let r = 6; r <= R - 4; r += 2) {
      assert(P.height(0, r) < 3,
        `the ground rises ${P.height(0, r).toFixed(0)} m ${r} m FORWARD of the player — the one `
        + 'wall is supposed to be behind him and the aperture is supposed to be the whole view');
    }
    /* OFF THE PRESET'S OWN SCALE, not a literal: the room went from 128 m to
     * 288 and this said 'the bulkhead is not a bulkhead' about a bulkhead that
     * had simply moved. A check that has to be edited every time the room is
     * resized is a check that will one day be edited to pass. */
    const aftFace = -P.scale / 2 + 8;
    assert(P.height(0, aftFace) > 25,
      `the ground ${aftFace.toFixed(0)} m aft rises ${P.height(0, aftFace).toFixed(0)} m — there is `
      + 'no bulkhead behind the player');
    return `${walled.length} of 16 bearings closed, all aft · ${P.height(0, aftFace).toFixed(0)} m of bulkhead`;
  });

  check('hangar: the deck ends, rather than stopping at something', () => {
    /**
     * THE HEIGHTFIELD'S EDGE IS THE DECK'S EDGE, which is the whole reason
     * this room does not need a wall it is not meant to look at. Every deleted
     * interior was doing something at its boundary — a wall, a fog bank, a
     * doorway to nowhere — and a player who walks toward the edge of this one
     * simply runs out of ship.
     *
     * 128 m and not 300: `TERRAIN_PRESETS.hangar` and `.warship` are both far
     * larger, and a larger sheet is a sheet that has to be ENDED.
     */
    const P = TERRAIN_PRESETS.hangardeck;
    /**
     * IT IS BIG, AND BIG IS THE BRIEF. This asserted 160 m when the room was
     * 128, on the reasoning that a larger sheet has to be CLOSED by something.
     * That reasoning was right and the conclusion was wrong: the references are
     * enormous — in `hangar 7.jpg` the racked fighters recede until they are
     * specks — and the brief says "scale must be immense". What closes this one
     * is the rack walls for the aft two-thirds and the field for the rest, so
     * the sheet never has to be ended by a fog bank.
     *
     * The bound that still matters is the OTHER one: a deck so large the player
     * cannot cross it is a corridor with nothing at the end.
     */
    assert(P.scale >= 200,
      `the deck is only ${P.scale} m across — the brief is "scale must be immense" and every `
      + 'reference is enormous; 128 m read as a shed');
    assert(P.scale <= 400,
      `the deck is ${P.scale} m across — past about 400 a player cannot walk from the bulkhead to `
      + 'the lip in under a minute, and a room nobody crosses is a corridor');
    assert(P.flat === true, 'the deck is not flat');
    assert(DECK.lip === P.scale / 2,
      `DECK.lip is ${DECK.lip} and the ground ends at ${P.scale / 2} — the strobes, the field and `
      + 'the barrier are all placed off DECK.lip and would stand somewhere the deck is not');
    return `${P.scale} m of deck, lip at ${DECK.lip} m, and nothing past it`;
  });

  check('hangar: there is no ceiling, and there never can be', async () => {
    /**
     * THE ONE ASSERTION IN THIS FILE THAT MUST NEVER BE RELAXED.
     *
     * "Explicitly do not build: no ceiling, ever." It is also the single thing
     * that decides whether this reads as a deck or as a room: the spars arc up
     * and out of frame and the eye completes an enclosure it is never shown,
     * and one horizontal plane over the deck undoes all of it.
     *
     * Driven on the real scene rather than read off the source: every mesh in
     * the world is asked for its bounding box, and anything WIDE and FLAT
     * sitting over the deck below the field is a ceiling whatever it was called
     * when it was added.
     */
    const THREE = await import('three');
    const { world } = await deck();
    try {
      /**
       * ══ RAYS, NOT BOUNDING BOXES ═══════════════════════════════════════
       *
       * This walked every mesh's bounding box looking for something broad and
       * flat overhead, and the moment the room's structure was merged into one
       * mesh per material — which is how it affords twenty rack bays — that
       * mesh's box became the whole room and the check reported a 164×212 m
       * ceiling at 47 m. There was no ceiling. A bounding box cannot see a
       * shape, only its extent, and every correct answer here is about shape.
       *
       * So it fires rays STRAIGHT UP from a grid over the deck and asks what
       * they hit. That is the question — "is there anything over my head" — and
       * it cannot be fooled by a merge, by an instanced mesh, or by geometry
       * that happens to span the room while enclosing none of it.
       */
      const ray = new THREE.Raycaster();
      const up = new THREE.Vector3(0, 1, 0);
      const from = new THREE.Vector3();
      const solid = [];
      world.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (o.material?.userData?.saberNoInk) return;      // the field
        if (o.name === 'field-rim') return;                 // its frame
        solid.push(o);
      });
      const hits = [];
      const STEP = 12;
      let probes = 0;
      for (let x = -DECK.lip + 10; x <= DECK.lip - 10; x += STEP) {
        for (let z = DECK.aft + 20; z <= DECK.lip - 10; z += STEP) {
          probes++;
          from.set(x, 2.0, z);
          ray.set(from, up);
          ray.far = DECK.roof - 3;
          const hit = ray.intersectObjects(solid, false)[0];
          /* An overhead FIXTURE is not a ceiling — every reference has them and
           * they are how the room reads as tall. What is forbidden is a
           * SURFACE: something hit from many neighbouring points at the same
           * height. A rig is hit from one or two. */
          if (hit) hits.push({ x, z, y: +hit.point.y.toFixed(1) });
        }
      }
      /* Group by height and see if any one height is hit from a broad area. */
      const byY = new Map();
      for (const h of hits) {
        const k = Math.round(h.y / 4) * 4;
        if (!byY.has(k)) byY.set(k, []);
        byY.get(k).push(h);
      }
      const lids = [...byY].filter(([, list]) => list.length > probes * 0.25);
      assert(!lids.length,
        `${lids.map(([y, l]) => `${l.length} of ${probes} points have something solid overhead at `
          + `${y} m`).join('; ')} — that is a ceiling however it was built, and "no ceiling, ever" `
        + 'is the one rule this room stands on');
      const covered = hits.length;
      assert(covered < probes * 0.45,
        `${covered} of ${probes} points on the deck have something over them — the overhead is `
        + 'supposed to be fixtures and open space, not cover');

      return `no lid: ${covered} of ${probes} deck points have anything overhead, none of them `
        + `sharing a height · ${solid.length} solid objects tested by ray`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The two ways it could destroy a save                              */
  /* ══════════════════════════════════════════════════════════════════ */

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
    const { world } = await deck();
    try {
      let meshes = 0;
      world.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes++; });
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
      assert(meshes < 240,
        `${meshes} meshes dressing an empty deck. It was 193 after every static assembly was `
        + 'composed through Props.Kit; something new is emitting per-prop, and the ink pass '
        + 'doubles whatever this is');
      assert(meshes > 60, `${meshes} meshes is not a hangar, it is a floor`);
      return `${meshes} meshes empty, against 395 for the room that was deleted`;
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
