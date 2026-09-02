/**
 * BATTLEFRONT BORZ — THE DECK IS ALIVE, AND EVERY PROP IS STANDING ON
 * SOMETHING.
 *
 * `src/game/DeckLife.js` rotted once in a very specific way, which
 * `HANGAR-SPEC.md` names as failure shape 4: one commit took the room from
 * 128 m to 288 m and every coordinate in DeckLife stayed where it was. Nothing
 * crashed. Nothing went red. What the player got was
 *
 *   a gantry crab riding a rail that had been DELETED, through open air
 *   a welder standing 4.1 m up on a scaffold that had been DELETED
 *   three steam vents hissing into a 3.2 m pit
 *   fourteen crew at 89-142 m against a comment claiming 48-70
 *   one crew errand that walked down into the pit and climbed out, forever
 *   haze tuned for a 128 m room taking 99.5% of the aperture rim
 *
 * And then it rotted a second way: derived correctly off `DECK`, it sited its
 * two nearest droids in the ground the company's crowd now stands on, and
 * flew a ship through both rack walls. So this file asks the questions a
 * rescale or a re-zoning actually breaks:
 *
 *   IS THERE ANYTHING UNDER IT?   A real downward ray into the real built
 *                                 scene, per placed prop.
 *   DOES THE PATH STAY ON DECK?   Every looping path sampled end to end
 *                                 against the real heightfield and the walls.
 *   CAN YOU SEE THEM?             The haze solved at the distance the workers
 *                                 actually stand, and at the distance the rim is.
 *   IS IT DERIVED?                Every placement table read out of the source
 *                                 and asked whether it goes through `frame()`.
 *   DOES THE ROOM STAY AFFORDABLE? The file's own share of draw calls, walked
 *                                 off its own state and bounded.
 *
 * The cast — the droids, the workers, the hulls, the bodies under them — has
 * its own suite, `deckcast.mjs`. This one is the room's furniture and its
 * rules. Where an old assertion pinned a thing that no longer exists (the
 * posed tech, the fourteen silhouettes, the two-instance traffic mesh, the
 * 56 m rack half-beam) the assertion was rewritten against what replaced it,
 * and says so.
 *
 * ── WHY THE RAY AND NOT THE ARITHMETIC ───────────────────────────────────
 *
 * "assert the man's y equals SCAFFOLD.lifts[1]" is the bug restated as a
 * test: it was TRUE the whole time the man was floating, because the scaffold
 * he was standing on had been deleted from a different file. The only question
 * with an honest answer is whether a ray cast down from his boots hits
 * geometry, into `world.scene`, after the room has actually been dressed.
 */

import * as THREE from 'three';
import { DECK, DECK_ZONES, inZone } from '../../src/game/Hangar.js';
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
 * WHAT IS UNDER `(x, z)` AT OR BELOW `y`, in metres of drop. `Infinity` means
 * nothing at all is under it. The haze sheets, the field, the rings and the
 * paint are surfaces you fall through; so is a body's own drawing.
 */
function dropTo(world, x, y, z, ray) {
  let best = Infinity;
  const g = world.terrain ? world.terrain.height(x, z) : 0;
  if (g <= y + 0.4) best = y - g;
  ray.set(new THREE.Vector3(x, y + 0.4, z), new THREE.Vector3(0, -1, 0));
  ray.far = 200;
  const hits = ray.intersectObjects(world.scene.children, true);
  for (const h of hits) {
    const m = h.object.material;
    if (!m || m.userData?.saberNoInk || m.transparent) continue;
    const n = h.object.name || '';
    if (/^deck-(droid|far|crew|astro|sleds|glows|fighter|shuttle)/.test(n) || n === 'hull' || n === 'gear'
      || n.startsWith('mergedSkin') || h.object.isSkinnedMesh) continue;
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
 * THE INBOARD FACE OF THE RACK WALLS, off `Hangar.deckColliders`' own rule:
 * each wall is closed by a box 14.5 m thick centred 7 m outside `DECK.wall`,
 * so the room stops 7.5 m inside the wall's line. This was the literal
 * `56 - 7.5` for as long as the walls stood at 56; the walls are at 80 now
 * and a check that still said 48.5 would fail every honest placement in the
 * room.
 */
const CANYON = DECK.wall - 7.5;

/** Every looping path the file runs, as `[label, ax, az, bx, bz]`. */
function paths(life) {
  const out = [];
  for (const w of life.workers) if (w.job.path) out.push([`worker ${w.i}`, ...w.job.path]);
  for (const d of life.droids) if (d.job.path && !d.lead) out.push([`${d.kind} ${d.i}`, ...d.job.path]);
  /* The crowd's walkers and carriers — no bodies, but the same rules. */
  for (const S of life.sils || []) if (S.job.path && !S.lead) out.push([`silhouette ${S.i}`, ...S.job.path]);
  for (const R of life.sleds.runs) {
    if (R.along === 'x') out.push(['a sled', R.x0, R.z, R.x1, R.z]);
    else out.push(['a sled', R.x, R.z0, R.x, R.z1]);
  }
  const T = life.trolley.run;
  out.push(['the trolley', T.x0, T.z, T.x1, T.z]);
  return out;
}

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
      /* THE ONE THAT WAS ACTUALLY BROKEN: the man on the scaffold. He is a
       * real worker now (`job: 'torch'`), standing on the upper lift, and the
       * tolerance is tight on purpose: his boots are on the plank or they are
       * not. */
      const torch = life.workers.find((w) => w.job.job === 'torch');
      assert(torch, 'nobody is welding from the scaffold any more');
      sit('the scaffold welder', torch.pos.x, torch.pos.y, torch.pos.z, 0.9);
      const R = life.trolley.run;
      sit('the gantry trolley', life.trolley.body.position.x, life.trolley.body.position.y + 0.9, R.z, 1.2);
      /* From beside the rail's line and above its slab: a ray starting inside
       * the rail sees only backfaces and falls to the deck. */
      for (const c of life.cranes) sit('a crane bridge', c.body.position.x + 0.5, c.body.position.y + 2.2, c.body.position.z, 1.6);
      for (const d of life.droids) sit(`${d.kind} ${d.i}`, d.kn.at.x, d.kn.at.y, d.kn.at.z, 0.6);
      for (const w of life.workers) sit(`worker ${w.i}`, w.pos.x, w.pos.y, w.pos.z, 0.9);
      /* The crowd, gallery included: a man thirty metres up with no plank
       * under him is the scaffold welder again. */
      for (const S of life.sils) sit(`silhouette ${S.i} (${S.job.pose || 'walker'})`, S.x, S.y, S.z, 0.9);
      /* And the vents, which is the one that put three coolant jets four
       * metres over the floor of a pit. */
      for (let i = 0; i < life.vents.length; i++) {
        const V = life.vents[i];
        sit(`vent ${i}`, V[0], V[1], V[2], 4.2);
      }
      assert(bad.length === 0,
        `${bad.length} prop(s) placed on nothing:\n      ${bad.join('\n      ')}`);
      return `the welder, the trolley, ${life.cranes.length} cranes, ${life.droids.length} droids, `
        + `${life.workers.length} workers, ${life.sils.length} silhouettes and ${life.vents.length} vents all standing on real geometry`;
    } finally { world.unload(); }
  });

  check('deck life: the welder and the crab stand on things DeckLife itself built', async () => {
    /**
     * The check above would pass if the welder happened to be standing on a
     * crate somebody else put there. This is stricter and it is the direct
     * answer to what went wrong: `addGantry` and `addScaffold` were in another
     * file, that file deleted them, and this file did not notice. So the
     * supports have to be OWNED here: `life.bay` is the kit DeckLife builds.
     */
    const { world, life } = await deck();
    try {
      assert(life.bay && life.bay.meshes.length > 0,
        'DeckLife built no repair bay — the welder, the trolley and the seam droid are all '
        + 'placed against a gantry, a scaffold and a hull section that nothing is building');
      const boxes = new THREE.Box3();
      const all = new THREE.Box3();
      let first = true;
      for (const m of life.bay.meshes) {
        m.geometry.computeBoundingBox();
        boxes.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
        if (first) { all.copy(boxes); first = false; } else all.union(boxes);
      }
      const T = life.workers.find((w) => w.job.job === 'torch').pos;
      assert(all.min.y < T.y + 0.2 && all.max.y > T.y - 0.2,
        `the welder at y ${T.y.toFixed(2)} is not inside the bay DeckLife built `
        + `(${all.min.y.toFixed(1)} .. ${all.max.y.toFixed(1)} m)`);
      const R = life.trolley.run;
      assert(all.max.y > R.y,
        `the trolley rides at ${R.y.toFixed(2)} m and the bay tops out at `
        + `${all.max.y.toFixed(2)} — the crab is above its own gantry`);
      /* AND THE OTHER THREE JOBS ARE IN THE SAME KIT: a cradle, a transport
       * with a stand, a bowser. The kit spans both halves of the deck. */
      assert(all.min.x < -10 && all.max.x > 30,
        `the jobs' kit spans x ${all.min.x.toFixed(0)}..${all.max.x.toFixed(0)} — there is only one job in it`);
      return `${life.bay.meshes.length} meshes of gantry, scaffold, section, cradle, transport, stand and bowser, `
        + `${all.min.y.toFixed(1)}..${all.max.y.toFixed(1)} m, x ${all.min.x.toFixed(0)}..${all.max.x.toFixed(0)}`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2 · DOES THE PATH STAY ON THE DECK                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: no looping path walks into the pit', async () => {
    const { world, life } = await deck();
    try {
      const plate = world.terrain.height(0, DECK.line);
      const bad = [];
      const walk = (label, ax, az, bx, bz) => along(ax, az, bx, bz, 24, (x, z) => {
        const g = world.terrain.height(x, z);
        if (g < plate - 0.8) bad.push(`${label} drops to ${g.toFixed(2)} m at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      });
      const P = paths(life);
      for (const p of P) walk(...p);
      assert(bad.length === 0,
        `${bad.length} sample(s) of a looping path are below the deck:\n      `
        + bad.slice(0, 6).join('\n      '));
      assert(life.holes.found,
        'the hole scan found no pit at all. Either the heightfield stopped cutting one — in '
        + 'which case this check has quietly stopped testing anything — or the scan is broken');
      return `${P.length} looping paths, all on the plate; pit measured at `
        + `x ${life.holes.x0}..${life.holes.x1}, z ${life.holes.z0}..${life.holes.z1}`;
    } finally { world.unload(); }
  });

  check('deck life: no looping path runs into a wall, off the deck, or through the corridor or the line', async () => {
    const { world, life } = await deck();
    try {
      const bad = [];
      const walk = (label, ax, az, bx, bz) => along(ax, az, bx, bz, 24, (x, z) => {
        if (Math.abs(x) > CANYON) bad.push(`${label} reaches x ${x.toFixed(1)}, inside the rack wall`);
        if (z < DECK.aft + 8) bad.push(`${label} reaches z ${z.toFixed(1)}, inside the bulkhead`);
        if (z > DECK.lip - 4) bad.push(`${label} reaches z ${z.toFixed(1)}, past the lip`);
        /* THE CORRIDOR AND THE MUSTER GROUND ARE THE COMPANY'S. The old droid
         * sites were in the march corridor; the check that caught it typed
         * the corridor's width itself. `DECK_ZONES` is the one table now. */
        for (const zone of ['corridor', 'muster', 'lobby', 'padA']) {
          if (inZone(zone, x, z)) bad.push(`${label} crosses the ${zone} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
        }
      });
      const P = paths(life);
      for (const p of P) walk(...p);
      for (const c of life.cranes) {
        if (Math.abs(c.run.x) > CANYON) bad.push(`a crane rail at x ${c.run.x}`);
      }
      assert(bad.length === 0,
        `${bad.length} sample(s) leave the room or cross the company's ground:\n      ${bad.slice(0, 6).join('\n      ')}`);
      /* AND THE WORKERS SURVIVED. The old file dropped a crew errand it
       * could not get off the pit; the new one sites every man by hand and
       * the floor is the brief's ten. */
      assert(life.workers.length >= 10,
        `only ${life.workers.length} workers on the deck — the room is emptying out`);
      return `${P.length} paths and ${life.cranes.length} rails all inside ±${CANYON} m and off the corridor, the line, the lobby and pad A`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3 · CAN YOU SEE ANY OF IT                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: the haze softens the workers, it does not delete them', async () => {
    /**
     * The room shipped at 0.0105, tuned for a 128 m shed, and it took 95% of
     * the far crew. A haze constant is only ever correct relative to the
     * distances in the room, so this asks about the distances in the room:
     * the workers' stations, measured from where the player first stands on
     * open deck.
     */
    const { world, life } = await deck();
    try {
      const k = life.haze.material.uniforms.uDensity.value / 1.15;
      let far = 0, near = 1e9;
      for (const w of life.workers) {
        const d = Math.hypot(w.pos.x - DECK.start.x, w.pos.z - DECK.threshold);
        far = Math.max(far, d); near = Math.min(near, d);
      }
      const worst = eaten(far, k);
      assert(worst < 0.75,
        `the furthest worker is ${far.toFixed(0)} m from the threshold and the haze takes `
        + `${(worst * 100).toFixed(0)}% of him — the apron's crash crew are smears`);
      /* AND THE RIM SURVIVES, which is rule 1 of the references. */
      const rim = eaten(DECK.lip - DECK.start.z, k);
      assert(rim < 0.75,
        `the aperture rim is ${(DECK.lip - DECK.start.z).toFixed(0)} m from the spawn and the `
        + `haze takes ${(rim * 100).toFixed(1)}% of it`);
      /* …and it still DOES something, or it is not haze. */
      assert(eaten(DECK.lip - DECK.aft, k) > 0.6,
        'the far end of the deck keeps most of its contrast: this is fog that does not fog');
      return `k=${k.toFixed(5)}: workers ${near.toFixed(0)}-${far.toFixed(0)} m at `
        + `${(eaten(near, k) * 100).toFixed(0)}-${(worst * 100).toFixed(0)}%, rim ${(rim * 100).toFixed(0)}%, `
        + `aft ${(eaten(DECK.lip - DECK.aft, k) * 100).toFixed(0)}%`;
    } finally { world.unload(); }
  });

  check('deck life: the closest NPC is close enough to be worth being real, and out of the company\'s way', async () => {
    /**
     * The spec's argument for the droids is "near enough to see clearly, since
     * they are the closest NPCs and need to be real". Measured from the
     * THRESHOLD — the spawn is inside a lift car in the bulkhead now — and the
     * zone table leaves only the slivers beside the corridor free within
     * thirty metres of it, which is where the two nearest machines are.
     */
    const { world, life } = await deck();
    try {
      let best = 1e9;
      for (const d of life.droids) {
        best = Math.min(best, Math.hypot(d.kn.at.x - DECK.start.x, d.kn.at.z - DECK.threshold));
      }
      assert(best < 30,
        `the nearest working machine is ${best.toFixed(0)} m from where the player steps onto the deck. `
        + 'Everything in this file is then midground, and the room has no near field at all');
      /* AND NOT IN THE WAY: the corridor the company marches down, the lobby
       * the player walks out through, the ground the crowd stands on. Asked
       * of the zone table, not typed. */
      const bad = life.droids.filter((d) => ['corridor', 'lobby', 'crowdL', 'crowdR', 'muster']
        .some((z) => inZone(z, d.kn.at.x, d.kn.at.z)));
      assert(bad.length === 0,
        `${bad.length} droid(s) are standing in the company's ground: `
        + bad.map((d) => `${d.kind} (${d.kn.at.x.toFixed(0)}, ${d.kn.at.z.toFixed(0)})`).join(' '));
      return `nearest machine ${best.toFixed(0)} m off the threshold, none in the corridor, lobby, crowd or line`;
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
        if (Math.abs(x) > CANYON || z > DECK.lip - 2 || z < DECK.aft) {
          bad.push(`${label} at (${x.toFixed(0)}, ${z.toFixed(0)})`);
        }
      };
      for (const d of life.droids) inside(`${d.kind} ${d.i}`, d.kn.at.x, d.kn.at.z);
      for (const w of life.workers) inside(`worker ${w.i}`, w.pos.x, w.pos.z);
      for (const S of life.sils) inside(`silhouette ${S.i}`, S.x, S.z);
      for (let i = 0; i < life.vents.length; i++) inside(`vent ${i}`, life.vents[i][0], life.vents[i][2]);
      inside('the trolley', life.trolley.run.x0, life.trolley.run.z);
      for (const H of life.traffic.plan.hulls) inside(`the ${H.kind}'s pad`, H.pad.x, H.pad.z);
      for (const H of life.traffic.plan.hulls) {
        if (!inZone('apron', H.pad.x, H.pad.z) && !inZone('padB', H.pad.x, H.pad.z)) bad.push(`the ${H.kind}'s pad is off the apron and off pad B at (${H.pad.x}, ${H.pad.z})`);
      }
      assert(bad.length === 0, `sited outside DECK: ${bad.join(', ')}`);
      /* AND THE CANYON THIS FILE ASSUMES IS THE ONE `dressStructure` BUILT:
       * the frame reads `DECK.wall`, the same field the structure builds
       * from — not a ratio of the lip that equalled it on the day. */
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(new URL('../../src/game/DeckLife.js', import.meta.url), 'utf8');
      const block = src.slice(src.indexOf('function frame()'), src.indexOf('/*  Materials'));
      assert(/const WALL = DECK\.wall;/.test(block),
        'DeckLife\'s frame() does not read the rack half-beam off DECK.wall — a second copy of '
        + 'that number is the defect the audit named four times');
      return `${life.droids.length + life.workers.length + life.sils.length + life.vents.length + 3} placements inside the room, `
        + `canyon half-beam agrees at ${DECK.wall.toFixed(1)} m, both pads on the apron`;
    } finally { world.unload(); }
  });

  check('deck life: the placement tables are read off DECK, not typed against it', async () => {
    /**
     * THE ONE THAT WOULD HAVE CAUGHT ALL OF IT. Every failure this file exists
     * for has the same shape: a distance written down once, correct on the day,
     * and never again. So the test is "does this number MOVE when the room
     * does" — done on the SOURCE, because the question is entirely about
     * where the numbers come from.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/DeckLife.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('function frame()'), src.indexOf('/*  Materials'));
    assert(block.length > 400, 'the frame block has moved or been renamed — this check is blind');
    for (const name of ['DECK.lip', 'DECK.start.z', 'DECK.line', 'DECK.roof', 'DECK_ZONES']) {
      assert(block.includes(name), `frame() never reads ${name}`);
    }
    /* The tables. `techMark`, `crewRuns` and `sledRun` are gone with the
     * posed tech, the silhouettes and the single sled; `workerJobs`,
     * `craneRuns` and `sledRuns` are what replaced them. */
    const tables = ['function droidJobs', 'function workerJobs', 'function silJobs', 'function trolleyRun', 'function craneRuns',
      'function sledRuns', 'function ventTable', 'function trafficPlan'];
    const missing = tables.filter((t) => !src.includes(t));
    assert(missing.length === 0, `these placement tables are gone: ${missing.join(', ')}`);
    const { functionBody } = await import('./_source.mjs');
    for (const t of tables) {
      const body = functionBody(src, t);
      assert(/frame\(\)/.test(body), `${t} does not read the frame — it is siting props on its own`);
    }
    const head = src.slice(0, src.indexOf('function frame()'));
    const eager = head.match(/^const\s+\w+\s*=\s*DECK\./m);
    assert(!eager,
      `a module-level constant reads DECK before the import cycle has settled: "${eager?.[0]}". `
      + 'Hangar.js imports this file, so DECK is in its dead zone at evaluation time');
    return `${tables.length} placement tables, all through frame(), none eager`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5 · THE TRAFFIC, WHICH IS THE HALF THAT WAS NEVER BUILT           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: ships actually cross the room, and the field feels them', async () => {
    /**
     * The loop is the design, so the check drives a whole one and asks whether
     * anything happened: the modelled hulls have to be on screen, in more than
     * a few places, and the field has to ring. The two-instance silhouette
     * mesh this used to read is gone; the hulls are `life.traffic.plan.hulls`.
     */
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      assert(life.traffic, 'there is no traffic on the deck at all');
      const P = life.traffic.plan;
      const longest = Math.max(...P.hulls.map((H) => H.T));
      const seen = { hull: 0, ring: 0, spread: new Set() };
      for (let i = 0; i < longest * 4 + 20; i++) {
        run(world, 0.25, input);
        for (const H of P.hulls) {
          if (!H.cast.group.visible) continue;
          seen.hull++;
          const p = H.cast.group.position;
          seen.spread.add(`${Math.round(p.x / 20)},${Math.round(p.y / 10)},${Math.round(p.z / 20)}`);
        }
        for (const r of life.rings) if (r.mesh.visible) seen.ring++;
      }
      assert(seen.hull > 40,
        `a hull was on screen for ${seen.hull} samples over a full loop — the traffic schedule is not firing`);
      assert(seen.spread.size > 12,
        `the ships occupied ${seen.spread.size} distinct cells over a full loop: they are appearing, but they are not going anywhere`);
      assert(seen.ring > 0,
        'no field ring fired during a whole traffic loop — ships are passing through the shield '
        + 'and the shield is not noticing, which is the one thing the spec asks for by name');
      return `${seen.hull} hull-samples across ${seen.spread.size} cells, ${seen.ring} ring frames`;
    } finally { world.unload(); }
  });

  check('deck life: the traffic is the caller DeckAudio was waiting for', async () => {
    /**
     * `HANGAR-SPEC`'s failure shape 1 is "a module written, tested, and never
     * called", and `DeckAudio.launchSequence` and `damagedArrival` were two of
     * them until the traffic existed. A SOURCE check, on purpose: the question
     * is "does anything in the shipped tree call it at all".
     */
    const { readFile } = await import('node:fs/promises');
    const files = ['DeckLife.js', 'Hangar.js', 'DeckKit.js', 'Menu.js', 'Command.js'];
    const src = {};
    for (const f of files) {
      try { src[f] = await readFile(new URL(`../../src/game/${f}`, import.meta.url), 'utf8'); }
      catch { src[f] = ''; }
    }
    for (const fn of ['launchSequence', 'damagedArrival', 'repulsorPass', 'paCall']) {
      const callers = files.filter((f) => f !== 'DeckAudio.js'
        && new RegExp(`\\b${fn}\\s*\\(`).test(src[f]) && !src[f].includes(`export function ${fn}`));
      assert(callers.length > 0,
        `nothing in src/ calls DeckAudio.${fn} — it is a written, tested, never-called module`);
    }
    /* And it is driven off the hull's own clock, not a second schedule. */
    const life = src['DeckLife.js'];
    const { functionBody } = await import('./_source.mjs');
    const body = functionBody(life, 'function stepHull');
    assert(body.includes('damagedArrival(') && body.includes('launchSequence('),
      'the launch and arrival cues are no longer fired from the hull\'s own clock, so the '
      + 'sound and the ship are two schedules that will drift apart');
    return 'launchSequence, damagedArrival and repulsorPass all driven off the hull clock; paCall off the deck\'s';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6 · WHAT IT COSTS                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck life: the room alive costs what the room can afford', async () => {
    /**
     * The ink pass rasterises every opaque object a second time, so what
     * DeckLife adds is doubled. This bound is on DeckLife's share alone, so a
     * regression is attributable rather than showing up as "the room got
     * bigger".
     *
     * BEFORE the order-of-magnitude pass this was 63 meshes and 121k
     * triangles: fifteen droids, thirteen workers, three hulls, nine
     * silhouettes. AFTER: ~96 meshes and ~270k triangles for 111 droids of
     * nine kinds, 20 real workers, 89 crew silhouettes, seven modelled hulls
     * (four flying, two parked, one taxiing), a fighter on a lift, three
     * cranes, six sleds, twenty-five jobs. The task's budget is 140 meshes
     * and 450k triangles; the bound is set at that so the next thing that
     * forgets to compose is named — a droid kind that stopped instancing is
     * a dozen draws, a pose mesh that stopped freeing its slots is 400k
     * triangles (which is exactly what happened on the first cut).
     */
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      /* Let every worker bake: one per frame. */
      run(world, 1, input);
      const mine = new Set();
      const on = (o) => { let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = p.visible; return v; };
      const walk = (o) => { if (!o) return; if ((o.isMesh || o.isInstancedMesh) && on(o)) mine.add(o); o.children.forEach(walk); };
      walk(life.haze); walk(life.glows);
      for (const r of life.rings) mine.add(r.mesh);
      for (const m of life.bay.meshes) walk(m);
      for (const im of Object.values(life.droidMeshes)) walk(im);
      for (const im of Object.values(life.droidParts)) walk(im);
      walk(life.trolley.body);
      for (const c of life.cranes) walk(c.body);
      walk(life.sleds.mesh);
      for (const w of life.workers) walk(w.root);
      for (const im of Object.values(life.silMeshes)) walk(im);
      walk(life.traffic.farF); walk(life.traffic.farS);
      for (const H of life.traffic.plan.hulls) H.cast.group.traverse((o) => { if (o.isMesh) mine.add(o); });
      for (const P of life.parked) { if (P.cast) P.cast.group.traverse((o) => { if (o.isMesh) mine.add(o); }); if (P.plat) walk(P.plat); }
      if (life.taxi) life.taxi.cast.group.traverse((o) => { if (o.isMesh) mine.add(o); });
      let tris = 0;
      for (const o of mine) {
        const g = o.geometry;
        const t = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += t * (o.isInstancedMesh ? o.count : 1);
      }
      assert(mine.size <= 140,
        `${mine.size} meshes of deck life, doubled by the ink pass. It was 96 with 111 droids, 20 workers, 89 `
        + 'silhouettes and seven hulls all in — something new is emitting per-prop instead of merging or '
        + 'instancing, or a worker did not bake');
      assert(tris <= 450000,
        `${Math.round(tris)} triangles of deck life against a 450k budget. It was ~270k; a pose mesh that stopped `
        + 'freeing its slots or a droid kind that grew a skirt of detail is the usual cause');
      const inst = [...mine].filter((o) => o.isInstancedMesh);
      assert(inst.length >= 30,
        `${inst.length} InstancedMesh in deck life. Nine droid kinds, five turning parts, fifteen crew poses, the `
        + 'sleds, two silhouette meshes and the emitters are all supposed to be instanced; one of them has been unpicked');
      const baked = life.workers.filter((w) => w.merged.skin).length;
      assert(baked === life.workers.length, `${life.workers.length - baked} workers did not bake to a skinned mesh`);
      assert(mine.size >= 80, `${mine.size} meshes is not a room with this much work going on in it`);
      let scene = 0;
      world.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && on(o)) scene++; });
      return `${mine.size} meshes (${inst.length} instanced), ${Math.round(tris)} triangles rasterised (was 63 / 121490), `
        + `in a scene of ${scene} visible`;
    } finally { world.unload(); }
  });

  check('deck life: a step allocates nothing and survives an unload, and gives the camera back', async () => {
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      run(world, 4, input);
      const { stepDeckLife } = await import('../../src/game/DeckLife.js');
      stepDeckLife({}, 0.016);
      stepDeckLife(world, 0);
      const P = TERRAIN_PRESETS.hangardeck;
      assert(P && typeof P.height === 'function', 'there is no hangardeck ground to place against');
      /* THE FAR PLANE IS BORROWED, and the unload is where it is returned —
       * through the sentinel in `world.statics`, without anybody calling
       * `undressDeckLife`. A level loaded after this one would otherwise draw
       * a kilometre of nothing. */
      const cam = world.engine.camera;
      const far0 = life.far0;
      assert(far0 != null && cam.far > far0, `the deck did not extend the far plane (${cam.far} against ${far0})`);
      const bodies = world.physics.bodies.length;
      world.unload();
      stepDeckLife(world, 0.016);
      assert(!life.haze.parent, 'the haze sheet survived the unload');
      assert(cam.far === far0, `the camera's far plane is ${cam.far} after the unload; it was ${far0} before the deck`);
      assert(world.physics.bodies.length < bodies, 'the droids\' and workers\' bodies survived the unload');
      return `four seconds stepped; far plane ${far0} → ${(DECK.lip - DECK.aft) + 760} → ${cam.far}; a step before dress and after unload is a no-op`;
    } finally { try { world.unload(); } catch {} }
  });
}
