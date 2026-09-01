/**
 * BATTLEFRONT BORZ — THE DECK IS ALIVE, AND EVERY PROP IS STANDING ON
 * SOMETHING.
 *
 * `src/game/DeckLife.js` is 1900 lines and until this file it had ZERO checks.
 * That is the whole reason it rotted, and it rotted in a very specific way that
 * `HANGAR-SPEC.md` now names as failure shape 4: one commit took the room from
 * 128 m to 288 m — bulkhead -46 → -104, lip 64 → 144 — and every coordinate in
 * DeckLife stayed where it was. Nothing crashed. Nothing went red. What the
 * player got was
 *
 *   a gantry crab riding a rail that had been DELETED, through open air
 *   a welder standing 4.1 m up on a scaffold that had been DELETED
 *   three steam vents hissing into a 3.2 m pit
 *   fourteen crew at 89-142 m against a comment claiming 48-70, at 0.69-0.95
 *     extinction: invisible grey smears
 *   one crew errand that walked down into the pit and climbed out, forever
 *   haze tuned for a 128 m room taking 99.5% of the aperture rim
 *
 * A suite that asserts "the trolley moves" and "the droids weld" passes on all
 * six of those, because all six of them do. So this file asks the questions a
 * rescale actually breaks:
 *
 *   IS THERE ANYTHING UNDER IT?   A real downward ray into the real built
 *                                 scene, per placed prop. Not a comparison
 *                                 against the constant that placed it, which
 *                                 is a check that cannot fail.
 *   DOES THE PATH STAY ON DECK?   Every looping path sampled end to end
 *                                 against the real heightfield and the real
 *                                 collision, including the pit wherever it is
 *                                 today.
 *   CAN YOU SEE THEM?             The haze solved at the distance the crew are
 *                                 actually at, and at the distance the rim is.
 *   IS IT DERIVED?                Every placement table read out of the source
 *                                 and required to go through the frame — and
 *                                 the frame required to be LAZY, because
 *                                 Hangar.js and DeckLife.js import each other
 *                                 and an eager `const X = DECK.y` is a dead
 *                                 zone that stops the game booting.
 *
 * ── WHY THE RAY AND NOT THE ARITHMETIC ───────────────────────────────────
 *
 * The tempting version of the first check is "assert the tech's y equals
 * SCAFFOLD.lifts[0]". That is the bug restated as a test: it was TRUE the whole
 * time the man was floating, because the scaffold he was standing on had been
 * deleted from a different file. The only question with an honest answer is
 * whether a ray cast down from his boots hits geometry, and that is what this
 * does — into `world.scene`, after the room has actually been dressed.
 */

import * as THREE from 'three';
import { DECK, MUSTER, markFor } from '../../src/game/Hangar.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';

/** Boot the deck through the same door the game uses. */
async function deck() {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  return { world, life: world._deckLife, input: idleInput() };
}

/**
 * WHAT IS UNDER `(x, z)` AT OR BELOW `y`, in metres of drop.
 *
 * The ray starts a little ABOVE the point being tested, because a prop resting
 * exactly on its support is the pass case and a ray fired from the contact
 * point can start inside the surface it is looking for. `Infinity` means
 * nothing at all is under it, which is the failure this file exists for.
 *
 * The heightfield is asked separately rather than raycast: `Terrain` builds one
 * mesh for a 288 m sheet at 200 samples, and `height()` is the same function
 * the game itself places against.
 */
function dropTo(world, x, y, z, ray) {
  let best = Infinity;
  const g = world.terrain ? world.terrain.height(x, z) : 0;
  if (g <= y + 0.4) best = y - g;
  ray.set(new THREE.Vector3(x, y + 0.4, z), new THREE.Vector3(0, -1, 0));
  ray.far = 200;
  const hits = ray.intersectObjects(world.scene.children, true);
  for (const h of hits) {
    /* The haze sheets, the field, the ripple rings and the paint are surfaces
     * you fall through. A prop standing on a fog plane is standing on nothing.
     */
    const m = h.object.material;
    if (!m || m.userData?.saberNoInk || m.transparent) continue;
    if (h.object.name === 'deck-crew' || h.object.name === 'deck-traffic') continue;
    const d = (y + 0.4) - h.point.y;
    if (d >= -0.05 && d < best) best = d;
  }
  return best;
}

/** Sample a segment, with both ends included. */
function along(ax, az, bx, bz, n, fn) {
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    fn(ax + (bx - ax) * t, az + (bz - az) * t, t);
  }
}

/** `1 - exp(-d²k²)`: the same curve the engine's fog chunk and the haze use. */
const eaten = (d, k) => 1 - Math.exp(-d * d * k * k);

/**
 * THE INBOARD FACE OF THE RACK WALLS, off `Hangar.deckColliders`' own numbers
 * rather than off `DECK`: the walls stand at ±56 but each one is closed by a
 * box 14.5 m thick, so the room stops 7.5 m short of the wall's centreline and
 * a path at ±50 is a path inside a wall.
 */
const CANYON = 56 - 7.5;

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1 · IS THERE ANYTHING UNDER IT                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: every placed prop has a surface under it', async () => {
    const { world, life } = await deck();
    try {
      const ray = new THREE.Raycaster();
      const bad = [];
      const sit = (label, x, y, z, tol) => {
        const d = dropTo(world, x, y, z, ray);
        if (!(d <= tol)) {
          bad.push(`${label} at (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}) has `
            + `${d === Infinity ? 'NOTHING' : `${d.toFixed(2)} m of air`} under it`);
        }
      };
      /* THE TWO THAT WERE ACTUALLY BROKEN, and the tolerance is tight on
       * purpose: a welder's boots are on the plank or they are not. */
      const T = life.tech.group.position;
      sit('the tech', T.x, T.y, T.z, 0.9);
      const R = life.trolley.run;
      /* The crab hangs UNDER its rail, so what has to be over it is the beam —
       * the ray is fired from above the body and must hit within the height of
       * the crab itself. */
      sit('the gantry trolley', life.trolley.body.position.x,
        life.trolley.body.position.y + 0.9, R.z, 1.2);
      for (const d of life.droids) {
        sit(`droid at ${d.job.x.toFixed(0)}`, d.job.x, d.y, d.job.z, 0.6);
      }
      /* And the vents, which is the one that put three coolant jets four
       * metres over the floor of a pit. */
      for (let i = 0; i < life.vents.length; i++) {
        const V = life.vents[i];
        sit(`vent ${i}`, V[0], V[1], V[2], 4.2);
      }
      assert(bad.length === 0,
        `${bad.length} prop(s) placed on nothing:\n      ${bad.join('\n      ')}`);
      return `tech, trolley, ${life.droids.length} droids and ${life.vents.length} vents all `
        + 'standing on real geometry';
    } finally { world.unload(); }
  });

  check('deck life: the tech and the crab stand on things DeckLife itself built', async () => {
    /**
     * The check above would pass if the tech happened to be standing on a
     * crate somebody else put there. This one is stricter and it is the direct
     * answer to what went wrong: `addGantry` and `addScaffold` were in another
     * file, that file deleted them, and this file did not notice.
     *
     * So the supports have to be OWNED here. `life.bay` is the assembly
     * DeckLife builds; if it is missing or empty, the man is in the air again
     * whatever else happens to be under him.
     */
    const { world, life } = await deck();
    try {
      assert(life.bay && life.bay.meshes.length > 0,
        'DeckLife built no repair bay — the tech, the trolley and the seam droid are all '
        + 'placed against a gantry, a scaffold and a hull section that nothing is building');
      const boxes = new THREE.Box3();
      const all = new THREE.Box3();
      let first = true;
      for (const m of life.bay.meshes) {
        m.geometry.computeBoundingBox();
        boxes.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
        if (first) { all.copy(boxes); first = false; } else all.union(boxes);
      }
      const T = life.tech.group.position;
      assert(all.min.y < T.y + 0.2 && all.max.y > T.y - 0.2
        && Math.abs(all.getCenter(new THREE.Vector3()).x - T.x) < 40,
        `the tech at y ${T.y.toFixed(2)} is not inside the bay DeckLife built `
        + `(${all.min.y.toFixed(1)} .. ${all.max.y.toFixed(1)} m)`);
      const R = life.trolley.run;
      assert(all.max.y > R.y,
        `the trolley rides at ${R.y.toFixed(2)} m and the bay tops out at `
        + `${all.max.y.toFixed(2)} — the crab is above its own gantry`);
      return `${life.bay.meshes.length} meshes of gantry, scaffold and hull section, `
        + `${all.min.y.toFixed(1)}..${all.max.y.toFixed(1)} m`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2 · DOES THE PATH STAY ON THE DECK                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: no looping path walks into the pit', async () => {
    /**
     * `CREW_RUNS[9]` was `[-56, 16, -30, 16]`, which on this heightfield is a
     * man walking three metres down into a lit recess and out again on a loop.
     * The pit is not a constant — it has moved once already and the position
     * in `Terrain.js` and the rim `Hangar.js` draws have disagreed inside the
     * same working tree — so this measures the GROUND, not a rectangle.
     */
    const { world, life } = await deck();
    try {
      const plate = world.terrain.height(0, DECK.line);
      const bad = [];
      const walk = (label, ax, az, bx, bz) => along(ax, az, bx, bz, 24, (x, z) => {
        const g = world.terrain.height(x, z);
        if (g < plate - 0.8) bad.push(`${label} drops to ${g.toFixed(2)} m at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      });
      const C = life.crew;
      for (let i = 0; i < C.n; i++) {
        const k = i * 4;
        walk(`crew ${i}`, C.runs[k], C.runs[k + 1], C.runs[k + 2], C.runs[k + 3]);
      }
      const S = life.sled.run;
      walk('the sled', S.x0, S.z, S.x1, S.z);
      assert(bad.length === 0,
        `${bad.length} sample(s) of a looping path are below the deck:\n      `
        + bad.slice(0, 6).join('\n      '));
      assert(life.holes.found,
        'the hole scan found no pit at all. Either the heightfield stopped cutting one — in '
        + 'which case this check has quietly stopped testing anything — or the scan is broken');
      return `${C.n} crew errands and the sled lane, all on the plate; pit measured at `
        + `x ${life.holes.x0}..${life.holes.x1}, z ${life.holes.z0}..${life.holes.z1}`;
    } finally { world.unload(); }
  });

  check('deck life: no looping path runs into a wall or off the deck', async () => {
    const { world, life } = await deck();
    try {
      const bad = [];
      const walk = (label, ax, az, bx, bz) => along(ax, az, bx, bz, 24, (x, z) => {
        if (Math.abs(x) > CANYON) bad.push(`${label} reaches x ${x.toFixed(1)}, inside the rack wall`);
        if (z < DECK.aft + 8) bad.push(`${label} reaches z ${z.toFixed(1)}, inside the bulkhead`);
        if (z > DECK.lip - 4) bad.push(`${label} reaches z ${z.toFixed(1)}, past the lip`);
      });
      const C = life.crew;
      for (let i = 0; i < C.n; i++) {
        const k = i * 4;
        walk(`crew ${i}`, C.runs[k], C.runs[k + 1], C.runs[k + 2], C.runs[k + 3]);
      }
      const S = life.sled.run;
      walk('the sled', S.x0, S.z, S.x1, S.z);
      const R = life.trolley.run;
      walk('the trolley', R.x0, R.z, R.x1, R.z);
      assert(bad.length === 0,
        `${bad.length} sample(s) leave the room:\n      ${bad.slice(0, 6).join('\n      ')}`);
      /* AND THE ERRANDS SURVIVED. `crewRuns` drops an errand it cannot get off
       * the hole, so a pit that grew across the whole midground would empty
       * the room silently and every check above would still be green. */
      assert(C.n >= 10,
        `only ${C.n} of 14 crew errands could be sited clear of the pit — the far midground `
        + 'is emptying out and nothing else in this file would have said so');
      return `${C.n} errands, the sled, and the crab all inside ±${CANYON} m`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3 · CAN YOU SEE ANY OF IT                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: the haze softens the crew, it does not delete them', async () => {
    /**
     * The number the room shipped with was 0.0105, derived in its own comment
     * from "the 60 m to the far crew" and "the whole 128 m diagonal". After
     * the rebuild the crew were at 89-142 m and the diagonal was 380, so the
     * furthest of them sat at 95% extinction. A haze constant is only ever
     * correct relative to the distances in the room, so this asks about the
     * distances in the room.
     */
    const { world, life } = await deck();
    try {
      const k = life.haze.material.uniforms.uDensity.value / 1.15;
      const C = life.crew;
      let far = 0, near = 1e9;
      for (let i = 0; i < C.n; i++) {
        const kk = i * 4;
        for (const [x, z] of [[C.runs[kk], C.runs[kk + 1]], [C.runs[kk + 2], C.runs[kk + 3]]]) {
          const d = Math.hypot(x - DECK.start.x, z - DECK.start.z);
          far = Math.max(far, d); near = Math.min(near, d);
        }
      }
      const worst = eaten(far, k);
      assert(worst < 0.55,
        `the furthest crewman is ${far.toFixed(0)} m from the spawn and the haze takes `
        + `${(worst * 100).toFixed(0)}% of him. Past about half he is a smear, which is what `
        + 'the room shipped with');
      /* AND THE RIM SURVIVES, which is rule 1 of the references: the aperture
       * band is the brightest thing in the frame, brighter than anything it
       * lights. At 0.0105 it was 99.5% gone. */
      const rim = eaten(DECK.lip - DECK.start.z, k);
      assert(rim < 0.75,
        `the aperture rim is ${(DECK.lip - DECK.start.z).toFixed(0)} m from the spawn and the `
        + `haze takes ${(rim * 100).toFixed(1)}% of it — that is the brightest object in the `
        + 'room being erased by its own atmosphere');
      /* …and it still DOES something, or it is not haze. */
      assert(eaten(DECK.lip - DECK.aft, k) > 0.6,
        'the far end of the deck keeps most of its contrast: this is fog that does not fog, '
        + 'and every rack in the room has to be modelled to the back wall');
      return `k=${k.toFixed(5)}: crew ${near.toFixed(0)}-${far.toFixed(0)} m at `
        + `${(eaten(near, k) * 100).toFixed(0)}-${(worst * 100).toFixed(0)}%, rim `
        + `${(rim * 100).toFixed(0)}%, aft ${(eaten(DECK.lip - DECK.aft, k) * 100).toFixed(0)}%`;
    } finally { world.unload(); }
  });

  check('deck life: the closest NPC is close enough to be worth being real', async () => {
    /**
     * The spec's argument for the droids is "near enough to see clearly, since
     * they are the closest NPCs and need to be real". A droid at 55 m is a
     * shape; the whole cost of articulating three of them is only justified at
     * conversational range. This is the check that stops the near work
     * drifting out with the room the next time it grows.
     */
    const { world, life } = await deck();
    try {
      let best = 1e9;
      for (const d of life.droids) {
        best = Math.min(best, Math.hypot(d.job.x - DECK.start.x, d.job.z - DECK.start.z));
      }
      assert(best < 30,
        `the nearest working machine is ${best.toFixed(0)} m from where the player is put down. `
        + 'Everything in this file is then midground, and the room has no near field at all');
      /**
       * AND IT IS NOT IN THE WAY. The company marches from the bulkhead doors
       * at `DECK.aft + 8` PAST the player to the line, so the middle of the
       * aft third is a corridor with twenty-four men walking down it and a
       * droid on it is a droid they walk through.
       *
       * The corridor's width is the widest MARK, asked of `markFor` itself
       * rather than typed: the fan from the doors is at its widest where the
       * men stop, so that is the half-beam, plus a droid's own hull.
       */
      let widest = 0;
      for (let sq = 0; sq < 5; sq++) {
        for (let i = 0; i < 24; i++) widest = Math.max(widest, Math.abs(markFor(i, 24, sq, 5).x));
      }
      const lane = widest + 2.2;
      const bad = life.droids.filter((d) => d.job.z > MUSTER.door.z - 2
        && d.job.z < DECK.line + MUSTER.depth * 2 && Math.abs(d.job.x) < lane);
      assert(bad.length === 0,
        `${bad.length} droid(s) are standing in the corridor the company marches down `
        + `(x ±${lane.toFixed(1)} between the doors and the line): `
        + bad.map((d) => `(${d.job.x.toFixed(0)}, ${d.job.z.toFixed(0)})`).join(' '));
      return `nearest machine ${best.toFixed(0)} m off the spawn, none inside the `
        + `±${lane.toFixed(1)} m march corridor`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4 · IS ANY OF IT DERIVED, OR JUST RETYPED                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: nothing is sited outside the room DECK describes', async () => {
    const { world, life } = await deck();
    try {
      const bad = [];
      const inside = (label, x, z) => {
        if (Math.abs(x) > DECK.lip - 2 || z > DECK.lip - 2 || z < DECK.aft) {
          bad.push(`${label} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
        }
      };
      for (const d of life.droids) inside('a droid', d.job.x, d.job.z);
      for (let i = 0; i < life.vents.length; i++) inside(`vent ${i}`, life.vents[i][0], life.vents[i][2]);
      inside('the tech', life.tech.group.position.x, life.tech.group.position.z);
      inside('the trolley', life.trolley.run.x0, life.trolley.run.z);
      inside('the landing pad', life.traffic.plan.pad.x, life.traffic.plan.pad.z);
      assert(bad.length === 0, `sited outside DECK: ${bad.join(', ')}`);
      /* AND THE CANYON THIS FILE ASSUMES IS THE ONE `dressStructure` BUILT.
       * DeckLife writes the rack half-beam as a fraction of `DECK.lip` because
       * Hangar.js does not export it; if that ever stops being true, every
       * `across()` in the file silently starts siting props inside a wall. */
      const wall = DECK.lip * (7 / 18);
      assert(Math.abs(wall - 56) < 0.01,
        `DeckLife derives the rack half-beam as ${wall.toFixed(2)} m and dressStructure builds `
        + 'them at 56. Every lateral placement in the file is off by the difference');
      return `${life.droids.length + life.vents.length + 3} placements inside the room, `
        + `canyon half-beam agrees at ${wall.toFixed(1)} m`;
    } finally { world.unload(); }
  });

  check('deck life: the placement tables are read off DECK, not typed against it', async () => {
    /**
     * THE ONE THAT WOULD HAVE CAUGHT ALL OF IT. Every failure this file exists
     * for has the same shape: a distance written down once, correct on the day,
     * and never again. So the test is not "is this number right" — it is
     * "does this number MOVE when the room does".
     *
     * `DECK` is a plain object, so the room can be stretched, the memoised
     * frame in DeckLife dropped, and the tables asked again. Anything that does
     * not move by the same proportion is a literal wearing a derivation's coat.
     *
     * It is done on the SOURCE rather than on a live world because re-dressing
     * a stretched room costs a second boot and proves nothing extra: the
     * question is entirely about where the numbers come from.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/DeckLife.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('function frame()'), src.indexOf('/*  Materials'));
    assert(block.length > 400, 'the frame block has moved or been renamed — this check is blind');
    /* Every ruler in the file has to be a function of DECK. */
    for (const name of ['DECK.lip', 'DECK.start.z', 'DECK.line', 'DECK.roof']) {
      assert(block.includes(name), `frame() never reads ${name}`);
    }
    /* And the tables have to be written in those rulers. A table with bare
     * metres in it is the thing that rotted. */
    const tables = ['function droidJobs', 'function trolleyRun', 'function sledRun',
      'function crewRuns', 'function ventTable', 'function trafficPlan', 'function techMark'];
    const missing = tables.filter((t) => !src.includes(t));
    assert(missing.length === 0, `these placement tables are gone: ${missing.join(', ')}`);
    /* `functionBody` and not a fixed window: `determinism.mjs` bans reading a
     * function by guessing how long it is, and it is right — nineteen of those
     * were in this suite, two of them already expired, and a window that
     * overshoots passes on a line belonging to a different function. */
    const { functionBody } = await import('./_source.mjs');
    for (const t of tables) {
      const body = functionBody(src, t);
      assert(/frame\(\)/.test(body), `${t} does not read the frame — it is siting props on its own`);
    }
    /* THE LAZY READ IS LOad-BEARING, not a style choice: Hangar.js imports this
     * file and this file imports DECK from it, so a module-level `const X =
     * DECK.something` is a temporal dead zone and the whole tree fails to boot.
     * It has happened once already. */
    const head = src.slice(0, src.indexOf('function frame()'));
    const eager = head.match(/^const\s+\w+\s*=\s*DECK\./m);
    assert(!eager,
      `a module-level constant reads DECK before the import cycle has settled: "${eager?.[0]}". `
      + 'Hangar.js imports this file, so DECK is in its dead zone at evaluation time and the '
      + 'game does not boot. Everything that reads DECK must do it inside a function body');
    return `${tables.length} placement tables, all through frame(), none eager`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5 · THE TRAFFIC, WHICH IS THE HALF THAT WAS NEVER BUILT           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: ships actually cross the room, and the field feels them', async () => {
    /**
     * `HANGAR-SPEC.md` asks for ships through the shield on a schedule, a
     * launch, a damaged arrival, and "3-4 scripted traffic events on a loose
     * loop so it never feels dead but never needs AI". The loop is the design,
     * so the check drives a whole one and asks whether anything happened.
     */
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      assert(life.traffic, 'there is no traffic on the deck at all');
      const P = life.traffic.plan;
      const seen = { hull: 0, ring: 0, spread: new Set() };
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      /* One full lander cycle plus a margin, sampled every quarter second. */
      for (let i = 0; i < P.landCycle * 4 + 20; i++) {
        run(world, 0.25, input);
        for (let k = 0; k < 2; k++) {
          life.traffic.mesh.getMatrixAt(k, m);
          m.decompose(p, q, s);
          if (s.x > 0.5) {
            seen.hull++;
            seen.spread.add(`${Math.round(p.x / 20)},${Math.round(p.z / 20)}`);
          }
        }
        for (const r of life.rings) if (r.mesh.visible) seen.ring++;
      }
      assert(seen.hull > 40,
        `a hull was on screen for ${seen.hull} of ${(P.landCycle * 4 + 20) * 2} samples over a `
        + 'full loop — the traffic schedule is not firing');
      assert(seen.spread.size > 12,
        `the ships occupied ${seen.spread.size} distinct 20 m cells over a full loop: they are `
        + 'appearing, but they are not going anywhere');
      assert(seen.ring > 0,
        'no field ring fired during a whole traffic loop — ships are passing through the shield '
        + 'and the shield is not noticing, which is the one thing the spec asks for by name');
      return `${seen.hull} hull-samples across ${seen.spread.size} cells, ${seen.ring} ring frames`;
    } finally { world.unload(); }
  });

  check('deck life: the fire crew run to a landing and go back to work', async () => {
    /**
     * The "fire crew sprinting in" bullet is served by retargeting two of the
     * crew instances rather than by adding bodies, which is free and which is
     * also the kind of thing that quietly never gets handed back. So: they have
     * to leave their errands, and they have to get them back.
     */
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      const home = Array.from(life.crew.home);
      let called = false, restored = false;
      for (let i = 0; i < 260; i++) {
        run(world, 0.25, input);
        if (life.traffic.called) called = true;
        else if (called && life.crew.runs[0] === home[0] && life.crew.runs[1] === home[1]) {
          restored = true; break;
        }
      }
      assert(called, 'no landing called the fire crew over a full traffic loop');
      assert(restored,
        'two crewmen were pulled off their errands for a landing and never put back — the far '
        + 'midground loses a pair of walkers for the rest of the level');
      return 'called out to a hard landing and returned to their errands';
    } finally { world.unload(); }
  });

  check('deck life: the traffic is the caller DeckAudio was waiting for', async () => {
    /**
     * `HANGAR-SPEC`'s failure shape 1 is "a module written, tested, and never
     * called", and `DeckAudio.launchSequence` and `DeckAudio.damagedArrival`
     * were two more of them: both are documented in that file's own header as
     * the room's API, both are driven by its unit test, and until the traffic
     * existed nothing in `src/` had a ship for them to be the sound of.
     *
     * This is a SOURCE check on purpose. Spying on an ESM binding is not
     * available, and the honest question is not "did it fire this run" — it is
     * "does anything in the shipped tree call it at all", which is precisely
     * the question nobody asked for four audits.
     */
    const { readFile } = await import('node:fs/promises');
    const files = ['DeckLife.js', 'Hangar.js', 'DeckKit.js', 'Menu.js', 'Command.js'];
    const src = {};
    for (const f of files) {
      try { src[f] = await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8'); }
      catch { src[f] = ''; }
    }
    for (const fn of ['launchSequence', 'damagedArrival']) {
      const callers = files.filter((f) => f !== 'DeckAudio.js'
        && new RegExp(`\\b${fn}\\s*\\(`).test(src[f]) && !src[f].includes(`export function ${fn}`));
      assert(callers.length > 0,
        `nothing in src/ calls DeckAudio.${fn} — it is a written, tested, never-called module, `
        + 'which is the exact failure shape HANGAR-SPEC names first');
    }
    /* And it is driven off the traffic's own clock, not a second schedule: two
     * schedules for one event is a bang that does not match a picture. */
    const life = src['DeckLife.js'];
    const { functionBody } = await import('./_source.mjs');
    const body = functionBody(life, 'function stepLander');
    assert(body.includes('damagedArrival(') && body.includes('launchSequence('),
      'the launch and arrival cues are no longer fired from the lander\'s own clock, so the '
      + 'sound and the ship are two schedules that will drift apart');
    return 'launchSequence and damagedArrival both driven off the lander clock';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6 · WHAT IT COSTS                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: the room alive costs what the room empty could afford', async () => {
    /**
     * `hangar.mjs` holds the whole room under 240 meshes and the ink pass
     * rasterises every opaque object a second time, so what DeckLife adds is
     * doubled. This bound is on DeckLife's share alone, so a regression here
     * is attributable rather than showing up as "the room got bigger".
     *
     * What is in it: 3 droid chassis (one Props.Kit merge), 9 arm parts, 3
     * bay meshes, 2 trolley, 1 tech, 2 sled, 1 haze, 2 rings, 1 crew, 1 glows,
     * 1 traffic. The glow instancing is what paid for the traffic: nine
     * emitters — three arcs, a torch, a beacon and four engine bells — used to
     * be six meshes and are now one.
     */
    const { world, life } = await deck();
    try {
      const mine = new Set();
      const walk = (o) => { if (o.isMesh || o.isInstancedMesh) mine.add(o); o.children.forEach(walk); };
      if (life.haze) mine.add(life.haze);
      if (life.glows) mine.add(life.glows);
      if (life.crew) mine.add(life.crew.mesh);
      if (life.traffic) mine.add(life.traffic.mesh);
      for (const r of life.rings) mine.add(r.mesh);
      for (const m of life.bay.meshes) mine.add(m);
      for (const m of life.chassis) mine.add(m);
      for (const d of life.droids) walk(d.turret);
      walk(life.trolley.body);
      walk(life.tech.group);
      walk(life.sled.group);
      let tris = 0;
      for (const o of mine) {
        const g = o.geometry;
        const t = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += t * (o.isInstancedMesh ? o.count : 1);
      }
      assert(mine.size <= 30,
        `${mine.size} meshes of deck life, doubled by the ink pass. It was 26 with the gantry, `
        + 'the scaffold, the hull section and the traffic all in — something new is emitting '
        + 'per-prop instead of merging or instancing');
      /* AND THE INSTANCING IS STILL THERE. Three meshes is the whole cost of
       * fourteen crew, two ships and nine emitters; unpicked into one mesh per
       * body it is twenty-five, which is the entire remaining budget. */
      const inst = [...mine].filter((o) => o.isInstancedMesh);
      assert(inst.length >= 3,
        `${inst.length} InstancedMesh in deck life. The crew, the traffic and the emitters are `
        + 'all supposed to be instanced; one of them has been unpicked into per-object meshes');
      /* And a floor, because the cheapest way to pass a cost bound is to stop
       * building things. */
      assert(mine.size >= 18, `${mine.size} meshes is not a room with work going on in it`);
      let scene = 0;
      world.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) scene++; });
      return `${mine.size} meshes, ${Math.round(tris)} triangles rasterised, in a scene of ${scene}`;
    } finally { world.unload(); }
  });

  check('deck life: a step allocates nothing and survives an unload', async () => {
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      run(world, 4, input);
      /* The two guards the frame loop depends on: `stepDeckLife` is called by
       * `HangarDirector.update` and the director does not know what level it is
       * on, so a step before the dress and a step after the unload both have to
       * be silent rather than throwing sparks into a level with no deck. */
      const { stepDeckLife } = await import('../../src/game/DeckLife.js');
      stepDeckLife({}, 0.016);
      stepDeckLife(world, 0);
      const P = TERRAIN_PRESETS.hangardeck;
      assert(P && typeof P.height === 'function', 'there is no hangardeck ground to place against');
      world.unload();
      stepDeckLife(world, 0.016);
      assert(!life.haze.parent, 'the haze sheet survived the unload');
      return 'four seconds stepped, and a step before dress and after unload is a no-op';
    } finally { try { world.unload(); } catch {} }
  });
}
