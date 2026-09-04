/**
 * BATTLEFRONT BORZ — THE DECK'S CAST: droids, workers, hulls, and the bodies
 * under all of them.
 *
 * `src/game/DeckCast.js` builds what `src/game/DeckLife.js` schedules, and the
 * player's brief for both is one paragraph of profanity that reduces to five
 * measurable claims. Each is a check here, and each FAILS without the code it
 * is about:
 *
 *   DENSITY     "all by an order of magnitude": a hundred droids of nine
 *               kinds with floors per kind, twenty real workers, eighty
 *               crew silhouettes, three cranes, six sleds, four flying hulls,
 *               three parked, a taxiing shuttle.
 *   BODIES      every droid and every worker is a dynamic PROP-layer body
 *               the Force can grip, asleep at its station; a thrown one gets
 *               up and goes back.
 *   PLACEMENT   every one of them has a surface under it, stands where
 *               `DECK_ZONES` allows, and no path crosses a wall, the pit, the
 *               corridor or the muster ground.
 *   TRAFFIC     at least six hulls in flight at every moment; nothing enters
 *               or leaves except across the lip; an arrival closes on the lip
 *               monotonically and a departure recedes monotonically to at
 *               least 600 m past it, drawn UNFOGGED and inside the far plane.
 *   PA          every launch and arrival is announced through `world.notify`,
 *               wordless on the horn, never closer than `PA.gap`.
 *
 * ── WHY EVERYTHING IS MEASURED ON A BOOTED WORLD ─────────────────────────
 *
 * The previous life of this deck rotted because its checks compared numbers
 * against the constants that produced them. A droid "at its station" is a
 * body the physics world can list, at a point a downward ray into the real
 * scene finds something under, in a rectangle `Hangar.clearOf` says is free.
 * Every question below is asked of the built room, and the one source check
 * asks only where the numbers come from.
 */

import * as THREE from 'three';
import { DECK, DECK_ZONES, clearOf, inZone } from '../../src/game/Hangar.js';

async function deck() {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  return { world, life: world._deckLife, input: idleInput() };
}

/** Metres of air under `(x, y, z)`, into the real built scene. Infinity = nothing. */
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
    /* A body cannot stand on itself, on another body's drawing, or on a hull
     * that is only passing. */
    const n = h.object.name || '';
    if (/^deck-(droid|far|crew|astro|sleds|glows|fighter|shuttle)/.test(n) || n === 'hull' || n === 'gear'
      || n.startsWith('mergedSkin') || h.object.isSkinnedMesh) continue;
    const d = (y + 0.4) - h.point.y;
    if (d >= -0.05 && d < best) best = d;
  }
  return best;
}

/** The ground everything but the traffic must keep off. */
const KEEP_OFF = ['lobby', 'corridor', 'muster', 'padA', 'pit', 'crowdL', 'crowdR'];

/** Sample a segment, both ends included. */
function along(ax, az, bx, bz, n, fn) {
  for (let i = 0; i <= n; i++) { const t = i / n; fn(ax + (bx - ax) * t, az + (bz - az) * t, t); }
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1 · THE BUILDERS, HEADLESS, PRICED IN THE BRIEF'S OWN UNIT        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: every builder builds, and the hulls are modelled at the fidelity asked for', async () => {
    const C = await import('../../src/game/DeckCast.js');
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const kinds = Object.keys(C.DROID_BUILDERS);
    assert(kinds.length >= 4, `${kinds.length} droid kinds — the brief names four at least`);
    for (const k of kinds) {
      const r = C.DROID_BUILDERS[k]();
      assert(r.geo && r.geo.attributes.color, `${k} chassis has no vertex colours — it cannot be one instanced draw`);
      assert(r.prims >= 8, `${k} chassis is ${r.prims} primitives — a box is not a droid`);
      assert(C.DROID_KINDS[k], `${k} has no row in DROID_KINDS — no body extents, no mass`);
    }
    const out = [];
    for (const f of ['republic', 'separatist']) {
      for (const [name, build] of [['fighter', C.buildCastFighter], ['shuttle', C.buildCastShuttle]]) {
        const H = build({ faction: f });
        const prims = H.group.userData.prims;
        let meshes = 0, t = 0;
        H.group.traverse((o) => { if (o.isMesh) { meshes++; t += tris(o.geometry); } });
        /**
         * "~120-200 primitives each, baked to 2-4 meshes." The floor is the
         * brief's; the ceiling stops a builder paying for detail nobody can
         * see at the ranges a hull is watched from.
         */
        assert(prims >= 120 && prims <= 220, `the ${f} ${name} is ${prims} primitives — the brief asks 120-200`);
        assert(meshes >= 2 && meshes <= 4, `the ${f} ${name} bakes to ${meshes} meshes, not 2-4`);
        assert(H.group.userData.length > 6 && H.group.userData.span > 6,
          `the ${f} ${name} measures ${H.group.userData.span.toFixed(1)} × ${H.group.userData.length.toFixed(1)} m — a toy`);
        assert(H.bells.length >= 1 && H.half && H.gearY > 0, `the ${f} ${name} publishes no bells, collider or ride height`);
        assert(H.meshes.gear, `the ${f} ${name} has no gear mesh to fold`);
        out.push(`${f[0]}-${name} ${prims}p/${meshes}m/${t}t`);
      }
    }
    for (const f of ['republic', 'separatist']) {
      const far = C.farHullGeometry(0, f);
      assert(far.geo.attributes.color && far.prims >= 4, `the ${f} far fighter is not a painted silhouette`);
    }
    return `${kinds.length} droid kinds · ${out.join(' · ')}`;
  });

  check('deck cast: a deck crewman is a real humanoid on the game\'s own skeleton, and folds to a draw call', async () => {
    const C = await import('../../src/game/DeckCast.js');
    const { mergeFigure } = await import('../../src/game/MergedSkin.js');
    const fig = C.buildDeckCrew({ faction: 'republic', tone: 1 });
    assert(fig.rig && fig.rig.get('thighL') && fig.rig.get('head') && fig.rig.get('handR'),
      'the deck crew body is not on the humanoid skeleton — BipedAnimator cannot walk it');
    let before = 0;
    fig.root.traverse((o) => { if (o.isMesh) before++; });
    assert(before >= 25, `${before} meshes on a crewman — dressHumanoid did not dress him`);
    /* The things that say "crew" rather than "trooper": a cap, a headset, a
     * belt. Hung off the bones they belong to, like a pauldron is. */
    const head = fig.rig.get('head').obj, hips = fig.rig.get('hips').obj;
    assert(head.children.filter((o) => o.isMesh).length >= 4, 'no cap or headset on the head');
    assert(hips.children.filter((o) => o.isMesh).length >= 4, 'no belt or pouches on the hips');
    const scene = new THREE.Scene();
    scene.add(fig.root);
    const m = mergeFigure({ rig: fig.rig, root: fig.root, palette: null }, { castShadow: true });
    assert(m.update(1) === true, 'the crewman did not bake');
    let after = 0;
    fig.root.traverse((o) => {
      if (!o.isMesh) return;
      let on = o.visible; for (let p = o.parent; on && p; p = p.parent) on = p.visible;
      if (on) after++;
    });
    assert(after <= 3, `${after} draws for one baked crewman — three materials should be three at most`);
    return `${before} meshes dressed, ${after} after the bake, ${fig.prims} pieces of kit`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2 · DENSITY, AND EVERY ONE A BODY                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: a hundred droids of nine kinds, thirty-five workers, a hundred and seventy in the crowd, the litter — every body the Force can take', async () => {
    /**
     * THE FLOORS, per kind, from the order-of-magnitude pass: the deck had
     * 15 droids (3 astro, 4 welder, 3 pit, 3 mouse, 2 gonk) and 13 workers.
     * A floor a kind, so a kind that quietly empties is named.
     */
    const { world, life } = await deck();
    try {
      const { LAYER } = await import('../../src/physics/RapierWorld.js');
      const kinds = new Set(life.droids.map((d) => d.kind));
      const n = (k) => life.droids.filter((d) => d.kind === k).length;
      const FLOORS = { astro: 20, welder: 8, pit: 8, pitup: 12, mouse: 15, gonk: 8, tread: 6, proto: 4, lifter: 6 };
      for (const [k, floor] of Object.entries(FLOORS)) assert(n(k) >= floor, `${n(k)} ${k} droids — the floor is ${floor} (was ${{ astro: 3, welder: 4, pit: 3, mouse: 3, gonk: 2 }[k] ?? 0})`);
      assert(life.droids.length >= 100, `${life.droids.length} droids on the deck — a hundred at least, from fifteen`);
      assert(kinds.size >= 9, `${kinds.size} kinds of droid (${[...kinds].join(', ')}) — nine at least`);
      assert(life.droids.filter((d) => d.kind === 'astro' && d.job.path).length >= 8, 'fewer than eight astromechs roll anywhere');
      assert(new Set(life.droids.filter((d) => d.kind === 'astro').map((d) => d.color)).size >= 5, 'the astromechs are all one colour scheme');
      assert(life.droids.filter((d) => d.kind === 'mouse' && d.lead).length >= 10, 'the mouse droids do not run in threes');
      assert(life.workers.length >= 20, `${life.workers.length} workers — twenty at least, from thirteen`);
      assert(life.sils.length >= 150, `${life.sils.length} crew figures — a hundred and fifty at least (was 89 silhouettes)`);
      assert(life.sils.filter((S) => S.job.path).length >= 24, 'fewer than twenty-four of the crowd walk anywhere');
      assert(Object.keys(life.silMeshes).length >= 12, `${Object.keys(life.silMeshes).length} instanced crew poses — four walk frames, three carrying, and seven stills`);
      assert(Object.keys(life.kitMeshes).length >= 6, 'the crowd carries nothing — no helmets, tools, pads, loads or wands');
      assert(life.loose && life.loose.length >= 80, `${life.loose?.length | 0} loose props — eighty at least`);
      assert(life.cranes.length >= 3, `${life.cranes.length} crane bridges on the ceiling rails — three, one lowering a hull`);
      assert(life.cranes.some((c) => c.load), 'no crane is lowering a hull');
      assert(life.sleds.runs.length >= 6, `${life.sleds.runs.length} loader sleds — six lanes`);
      assert(life.traffic.plan.hulls.length >= 4, `${life.traffic.plan.hulls.length} flying hulls — four`);
      assert(life.parked.length >= 3, `${life.parked.length} parked hulls — a shuttle bay, a second cradle, a lift`);
      assert(life.taxi && life.taxi.cast.group.visible, 'no shuttle taxiing');
      assert(life.floods.length >= 10, `${life.floods.length} floodlights — ten at least`);
      const bodies = new Set(world.physics.bodies);
      const player = world.player;
      let asleep = 0, grip = 0;
      const all = [...life.droids.map((d) => d.kn.body), ...life.workers.map((w) => w.shove.body),
        ...life.sils.map((S) => S.kn.body), ...life.loose.map((P) => P.body.body)];
      for (const b of all) {
        assert(bodies.has(b), 'a droid or worker body is not in the physics world');
        assert(b.invMass > 0 && !b.kinematic && !b.static, 'a droid or worker body is not dynamic');
        assert(b.layer === LAYER.PROP, 'a droid or worker body is not on the PROP layer the Force reads');
        if (!b.awake) asleep++;
        if (player && player._grippableBody(b)) grip++;
      }
      assert(asleep >= all.length - 3, `${all.length - asleep} of ${all.length} bodies awake at their stations — a formation costs the solver`);
      assert(!player || grip === all.length, `the Force could take ${grip} of ${all.length} — the rest are holograms`);
      /* The jobs: four assemblies at least, and the kit that draws them. */
      assert(life.bay && life.bay.meshes.length >= 3, 'the jobs\' kit did not build');
      const per = [...kinds].map((k) => `${k} ${n(k)}`).join(', ');
      return `${life.droids.length} droids (${per}; was 15), ${life.workers.length} workers (was 13), ${life.sils.length} in the crowd (was 0), `
        + `${life.cranes.length} cranes, ${life.sleds.runs.length} sleds, ${life.traffic.plan.hulls.length}+${life.parked.length}+1 hulls — ${all.length} bodies, all asleep, all grippable`;
    } finally { world.unload(); }
  });

  check('deck cast: every droid and worker stands on something, where the zones allow, and no path crosses a wall or a zone', async () => {
    const { world, life } = await deck();
    try {
      const ray = new THREE.Raycaster();
      const CANYON = DECK.wall - 7.5;
      const bad = [];
      const sit = (label, x, y, z, tol) => {
        const d = dropTo(world, x, y, z, ray);
        if (!(d <= tol)) bad.push(`${label} at (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)}) has ${d === Infinity ? 'NOTHING' : `${d.toFixed(2)} m of air`} under it`);
      };
      const site = (label, x, z) => {
        if (Math.abs(x) > CANYON) bad.push(`${label} at x ${x.toFixed(1)} is inside a rack wall`);
        if (z < DECK.aft + 4 || z > DECK.lip - 2) bad.push(`${label} at z ${z.toFixed(1)} is outside the room`);
        if (!clearOf(KEEP_OFF, x, z)) {
          const zone = KEEP_OFF.find((n) => inZone(n, x, z));
          bad.push(`${label} at (${x.toFixed(1)}, ${z.toFixed(1)}) is in the ${zone}`);
        }
      };
      for (const d of life.droids) {
        sit(`${d.kind} ${d.i}`, d.kn.at.x, d.kn.at.y, d.kn.at.z, 0.6);
        if (d.job.path) along(d.job.path[0], d.job.path[1], d.job.path[2], d.job.path[3], 16, (x, z) => site(`${d.kind} ${d.i}'s path`, x, z));
        else site(`${d.kind} ${d.i}`, d.kn.at.x, d.kn.at.z);
      }
      for (const w of life.workers) {
        sit(`worker ${w.i} (${w.job.job})`, w.pos.x, w.pos.y, w.pos.z, 0.9);
        if (w.job.path) along(w.job.path[0], w.job.path[1], w.job.path[2], w.job.path[3], 16, (x, z) => site(`worker ${w.i}'s path`, x, z));
        else site(`worker ${w.i}`, w.pos.x, w.pos.z);
      }
      /* THE CROWD keeps off the traffic's ground too — the apron and pad B
       * are the flight's — and stands on something, the gallery men on the
       * catwalk's plank thirty metres up. */
      const sil = (label, x, z) => {
        site(label, x, z);
        if (!clearOf(['apron', 'padB'], x, z)) bad.push(`${label} at (${x.toFixed(1)}, ${z.toFixed(1)}) is on the flight's ground`);
      };
      for (const S of life.sils) {
        sit(`silhouette ${S.i} (${S.job.pose || 'walker'})`, S.x, S.y, S.z, 0.9);
        if (S.job.path) { if (!S.lead) along(S.job.path[0], S.job.path[1], S.job.path[2], S.job.path[3], 16, (x, z) => sil(`silhouette ${S.i}'s path`, x, z)); }
        else sil(`silhouette ${S.i}`, S.x, S.z);
      }
      const up = life.sils.filter((S) => S.y > 20).length;
      assert(up >= 8, `${up} of the crowd are on the gallery — the catwalks are empty`);
      /* AND NOTHING STANDS IN ANYTHING ELSE: two standing bodies closer than
       * a metre push each other apart for ever (a thrown droid could not get
       * home for exactly this), and a man on a sled's lane is run down. */
      const stands = [];
      for (const d of life.droids) if (!d.job.path) stands.push([`${d.kind} ${d.i}`, d.x, d.z, 0.8]);
      for (const w of life.workers) if (!w.job.path) stands.push([`worker ${w.i}`, w.pos.x, w.pos.z, 0.8]);
      for (const S of life.sils) if (!S.job.path && S.y < 20) stands.push([`silhouette ${S.i}`, S.x, S.z, 0.8]);
      for (let i = 0; i < stands.length; i++) for (let j = i + 1; j < stands.length; j++) {
        const dd = Math.hypot(stands[i][1] - stands[j][1], stands[i][2] - stands[j][2]);
        if (dd < 0.9) bad.push(`${stands[i][0]} and ${stands[j][0]} are ${dd.toFixed(2)} m apart`);
      }
      for (const R of life.sleds.runs) {
        const ax = R.along === 'x' ? R.x0 : R.x, az = R.along === 'x' ? R.z : R.z0;
        const bx = R.along === 'x' ? R.x1 : R.x, bz = R.along === 'x' ? R.z : R.z1;
        for (const st of stands) {
          let m = 1e9;
          along(ax, az, bx, bz, 60, (x, z) => { m = Math.min(m, Math.hypot(st[1] - x, st[2] - z)); });
          if (m < 2.2) bad.push(`${st[0]} stands ${m.toFixed(1)} m from a sled's lane`);
        }
      }
      for (const R of life.sleds.runs) {
        const ax = R.along === 'x' ? R.x0 : R.x, az = R.along === 'x' ? R.z : R.z0;
        const bx = R.along === 'x' ? R.x1 : R.x, bz = R.along === 'x' ? R.z : R.z1;
        along(ax, az, bx, bz, 16, (x, z) => site('a sled lane', x, z));
      }
      /* The crane bridges hang under their rails: the ray from above the crab
       * must find the rail within the crab's own height. */
      for (const c of life.cranes) {
        /* Fired from beside the rail's own line and above its slab: a ray that
         * starts INSIDE the rail sees only its backfaces and falls to the deck. */
        sit('a crane bridge', c.body.position.x + 0.5, c.body.position.y + 2.2, c.body.position.z, 1.6);
        const R = c.run;
        if (Math.abs(R.x) > CANYON) bad.push(`a crane rail at x ${R.x}`);
      }
      /* And the pit, wherever it is today. */
      const plate = world.terrain.height(0, DECK.line);
      const walk = (label, ax, az, bx, bz) => along(ax, az, bx, bz, 24, (x, z) => {
        if (world.terrain.height(x, z) < plate - 0.8) bad.push(`${label} drops into the pit at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      });
      for (const w of life.workers) if (w.job.path) walk(`worker ${w.i}`, ...w.job.path);
      for (const d of life.droids) if (d.job.path) walk(`${d.kind} ${d.i}`, ...d.job.path);
      assert(bad.length === 0, `${bad.length} siting fault(s):\n      ${bad.slice(0, 8).join('\n      ')}`);
      /* AND THEY ARE NEAR. Ten within sixty metres of the line's centre, which
       * is where the player stands to look at his men — see workerJobs. */
      const near = life.workers.filter((w) => Math.hypot(w.pos.x, w.pos.z - DECK.line) < 60).length;
      assert(near >= 10, `${near} workers within 60 m of the line — the rest are the far midground again`);
      return `${life.droids.length} droids, ${life.workers.length} workers, ${life.sils.length} in the crowd (${up} on the gallery), ${life.sleds.runs.length} lanes, `
        + `${life.cranes.length} bridges: all on something, all clear of ${KEEP_OFF.join('/')}, none in another, ${near} men within 60 m`;
    } finally { world.unload(); }
  });

  check('deck cast: every instanced kind moves between frames, nothing is NaN, and the step costs under 3.0 ms', async () => {
    /**
     * A hundred and eleven droids and eighty-nine men are instance
     * matrices, and an instance matrix that is never rewritten is a statue
     * — so every kind that is meant to move is sampled over two seconds and
     * asked to have moved: the chassis of each rolling kind, the domes and
     * legs, the welder's arm, the crew's walk frames, the crane's hull, the
     * lift. NaN anywhere in an instance buffer is a vanished mesh, so every
     * instanced buffer of the deck is scanned. And the CPU: the whole of
     * `stepDeckLife`, timed around itself over 300 frames of a live world,
     * has to cost under 3.0 ms on a TYPICAL frame — the median, not the mean,
     * for the reason argued at the assertion itself. Measured 1.0 ms when the
     * deck carried 131 bodies and 20 gaits; the density pass took it to 35
     * gaits and 171 crowd bodies and the bound moved with it.
     */
    const { world, life, input } = await deck();
    try {
      const { stepDeckLife } = await import('../../src/game/DeckLife.js');
      const { run } = await import('./_coop.mjs');
      run(world, 2, input);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      const snap = () => {
        const out = new Map();
        const take = (im, tag) => { for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(p, q, s); if (s.x > 0.01) out.set(`${tag}:${i}`, [p.x, p.y, p.z, q.x, q.y, q.z, q.w]); } };
        for (const [k, im] of Object.entries(life.droidMeshes)) take(im, `droid-${k}`);
        for (const [k, im] of Object.entries(life.droidParts)) take(im, `part-${k}`);
        for (const [k, im] of Object.entries(life.silMeshes)) take(im, `crew-${k}`);
        take(life.sleds.mesh, 'sled');
        return out;
      };
      const a = snap();
      const hullY0 = life.cranes.find((c) => c.load).load.position.y;
      const liftY0 = life.parked.find((P) => P.plat).plat.position.y;
      /* 2.37 s, not 2: a walker's first hold is an integer of seconds plus
       * a fraction, and a sample landing exactly on a hold's end reads a
       * man at rest as a man stuck. */
      run(world, 2.37, input);
      const b = snap();
      const moved = new Set();
      for (const [k, va] of a) {
        const vb = b.get(k);
        if (!vb) { moved.add(k.split(':')[0]); continue; }
        if (va.some((v, i) => Math.abs(v - vb[i]) > 1e-3)) moved.add(k.split(':')[0]);
      }
      /* A walk frame that was EMPTY at the first sample and holds a man at
       * the second has moved: the crowd flips through four frames, and any
       * one of them can be empty at an instant. */
      const had = new Set([...a.keys()].map((k) => k.split(':')[0]));
      for (const k of b.keys()) { const kind = k.split(':')[0]; if (!had.has(kind)) moved.add(kind); }
      const want = ['droid-astro', 'droid-mouse', 'droid-gonk', 'droid-tread', 'droid-proto', 'droid-lifter', 'droid-pitup', 'droid-pit',
        'part-dome', 'part-turret', 'part-boom', 'part-fore', 'sled', 'crew-walk0', 'crew-walk3'];
      const still = want.filter((k) => !moved.has(k));
      assert(still.length === 0, `these instanced kinds did not move in two seconds: ${still.join(', ')}`);
      /* The convoys: the three mouse droids on one path are in a line, not a heap. */
      const trio = life.droids.filter((d) => d.kind === 'mouse').slice(0, 3);
      const gaps = [Math.hypot(trio[0].x - trio[1].x, trio[0].z - trio[1].z), Math.hypot(trio[1].x - trio[2].x, trio[1].z - trio[2].z)];
      assert(gaps.every((g) => g > 0.5 && g < 3.0), `the first mouse convoy's gaps are ${gaps.map((g) => g.toFixed(2)).join(' / ')} m`);
      /* NaN: every instance buffer the deck owns. */
      let nan = 0, buffers = 0;
      world.scene.traverse((o) => {
        if (!o.isInstancedMesh || !/^deck-/.test(o.name)) return;
        buffers++;
        const arr = o.instanceMatrix.array;
        for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(arr[i])) nan++;
        if (o.instanceColor) for (let i = 0; i < o.count * 3; i++) if (!Number.isFinite(o.instanceColor.array[i])) nan++;
      });
      assert(buffers >= 24 && nan === 0, `${nan} NaN values across ${buffers} instance buffers`);
      for (const im of Object.values(life.silMeshes)) for (const e of im.geometry.attributes.position.array) if (!Number.isFinite(e)) nan++;
      assert(nan === 0, `${nan} NaN vertices in the crowd's pose meshes`);
      assert(life.glows.count <= 128 && life.glows.count >= 50, `${life.glows.count} emitters lit — a dozen floodlights, ten arcs, two dozen eyes, the bells`);
      /* THE STEP'S COST, around the step itself, in a live world. */
      const cost = [];
      for (let i = 0; i < 300; i++) {
        world.update(1 / 60, input);
        const t0 = performance.now();
        stepDeckLife(world, 1 / 60);
        cost.push(performance.now() - t0);
      }
      const sorted = cost.slice().sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const worst = sorted[sorted.length - 1];
      const avg = cost.reduce((a, b) => a + b, 0) / cost.length;
      /**
       * ══ THE BUDGET, RE-DERIVED, AND THE CENSUS THAT JUSTIFIES IT ═══════
       *
       * ── FIRST, THE MEDIAN AND NOT THE MEAN ────────────────────────────
       *
       * The bound used to be on the mean, and the mean is dragged by a garbage
       * collection. Five runs on a quiet box measured 2.18, 2.25, 2.54, 2.57,
       * 2.65 — half a millisecond of spread against a tenth of margin, so the
       * clause passed or failed on which run caught a GC rather than on what
       * the code costs. `station.mjs` reports mean, p95 and a 49.8 ms worst on
       * its own step and writes "(a GC)" beside it; this is the same reading
       * of the same fact. The tail is printed and is not allowed to decide.
       *
       * ── AND THE NUMBER MOVED BECAUSE THE DECK DID ─────────────────────
       *
       * 1.5 -> 2.5 -> 3.0, and each step is a census rather than a shrug. The
       * first budget was set when the deck carried 131 bodies and 20 gaits.
       * The density pass took it to 35 rigged gaits and 171 crowd bodies and
       * the bound went to 2.5. Everything since — the walkway population, the
       * loose props, the beats — landed against a number nobody re-derived,
       * and it measured 2.75-2.80 consistently on a quiet box. That is not
       * noise and it was not a regression in the code: it is a deck that grew
       * and a bound that did not.
       *
       * WHAT WAS ACTUALLY WASTE WAS FOUND FIRST AND CUT, which is why this is
       * a re-derivation and not a raised white flag. `tools/_lifeprof.mjs`
       * attributes the step by emptying one collection at a time and put 1.27
       * ms of 2.06 on 35 workers — 36 us a man against 6 for a droid and 2 for
       * a silhouette. Two real wastes came out of that: `merged.update` ran at
       * full rate on men whose pose had just been skipped, syncing a colour
       * buffer nobody had painted (35.0 -> 13.3 calls a frame), and the gait
       * had no distance term at all, so a man 200 m down the deck solved as
       * often as one at the rail (a 1/6 stride past 40 m). Splitting the loop
       * by sub-call afterwards: anim.update 0.62 ms, swingArms 0.12, merged
       * 0.06, the shove body inside noise.
       *
       * SO THE NUMBER IS WHAT THE DECK COSTS WITH THE WASTE GONE, with enough
       * margin that a GC-heavy run does not decide it. 3.0 ms is 18% of a
       * 16.7 ms frame for the ENTIRE animated life of the hangar: 35 rigged
       * gaits, 111 droids, 171 crowd bodies, 142 loose props, two crane
       * bridges, six sled lanes and the boards. The census is printed on every
       * run, so the next person to triple the deck sees the number this bound
       * was derived against instead of guessing at it.
       */
      const census = `${life.workers.length} gaits, ${life.droids.length} droids, `
        + `${life.sils.length} crowd, ${life.loose.length} loose`;
      assert(mid < 3.0,
        `stepDeckLife costs ${mid.toFixed(2)} ms on a typical frame over 300 — the budget is 3.0 `
        + `(mean ${avg.toFixed(2)}, p95 ${p95.toFixed(2)}, worst ${worst.toFixed(2)}) with ${census}`);
      /* The crane's hull rides its cable between `drop` and `drop + lower`
       * below the crab, and the lift platform between the deck and its
       * rise; both were read before the 300 frames and are read again. */
      const crane = life.cranes.find((c) => c.load);
      const hullY1 = crane.load.position.y;
      assert(hullY1 <= -crane.run.drop + 1e-6 && hullY1 >= -(crane.run.drop + crane.run.lower) - 1e-6,
        `the crane's hull hangs ${(-hullY1).toFixed(1)} m under the crab, outside ${crane.run.drop}..${crane.run.drop + crane.run.lower}`);
      const lift = life.parked.find((P) => P.plat);
      const liftY1 = lift.plat.position.y;
      assert(Number.isFinite(hullY0) && Number.isFinite(liftY0) && Number.isFinite(liftY1), 'a crane or lift height is NaN');
      const { LIFTP: LP } = { LIFTP: { rise: 2.6 } };
      assert(liftY1 >= -0.01 && liftY1 <= LP.rise + 1.5, `the lift platform is at ${liftY1.toFixed(2)} m`);
      return `${moved.size} instanced kinds moved, ${buffers} buffers NaN-free, ${life.glows.count} emitters; `
        + `step ${avg.toFixed(2)} ms avg / ${worst.toFixed(1)} worst over 300 frames`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3 · THROWN, AND GETTING UP                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: a thrown droid rights itself and a thrown worker gets up, and both go back to work', async () => {
    const { world, life, input } = await deck();
    try {
      const { run } = await import('./_coop.mjs');
      run(world, 1, input);
      const d = life.droids.find((x) => x.kind === 'astro');
      const w = life.workers.find((x) => x.job.job === 'kneel');
      const home = new THREE.Vector3().copy(d.kn.mark);
      const wHome = new THREE.Vector3().copy(w.shove.mark);
      d.kn.shove(new THREE.Vector3(1, 0, 0.3), 6);
      w.shove.shove(new THREE.Vector3(-1, 0, 0.2), 6);
      const seen = { droid: new Set(), worker: new Set() };
      let followed = 0, rooted = 0, samples = 0;
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (let i = 0; i < 60 * 12; i++) {
        world.update(1 / 60, input);
        seen.droid.add(d.kn.state); seen.worker.add(w.shove.state);
        /* WHILE IT IS DOWN, THE DRAWING IS THE BODY. */
        if (d.kn.down) {
          d.mesh.getMatrixAt(d.i, m); m.decompose(p, q, s);
          samples++;
          if (p.distanceTo(d.kn.at) < 0.05) followed++;
        }
        if (w.shove.down && w.root.position.distanceTo(w.shove.at) < 0.05) rooted++;
        if (d.kn.state === 'post' && w.shove.state === 'post' && i > 120) break;
      }
      for (const [who, S] of Object.entries(seen)) {
        for (const st of ['down', 'rest', 'rise', 'back', 'post']) {
          assert(S.has(st), `the ${who} never went through '${st}' — it was shoved and ${[...S].join('→')}`);
        }
      }
      assert(samples > 0 && followed === samples, `the droid's chassis followed its body on ${followed} of ${samples} down frames`);
      assert(rooted > 0, 'the worker\'s figure never followed his body while he was down');
      assert(d.kn.state === 'post' && w.shove.state === 'post', 'twelve seconds on and one of them is still not back at work');
      assert(d.kn.at.distanceTo(home) < 0.5, `the droid got up ${d.kn.at.distanceTo(home).toFixed(1)} m from its station and stayed there`);
      assert(w.shove.at.distanceTo(wHome) < 0.5, `the worker got up ${w.shove.at.distanceTo(wHome).toFixed(1)} m from his station and stayed there`);
      assert(w.root.position.lengthSq() < 1e-6, 'the worker\'s rig root did not go home to the origin for the gait solver');
      assert(d.kn.falls >= 1 && w.shove.falls >= 1, 'nobody counted a fall');
      return `astromech ${[...seen.droid].join('→')}, worker ${[...seen.worker].join('→')}, both back on station`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4 · THE TRAFFIC                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: six hulls in flight at every moment, in and out through the aperture only, receding to specks', async () => {
    const { world, life, input } = await deck();
    try {
      const T = life.traffic, P = T.plan;
      assert(T.farF.material.fog === false && T.farS.material.fog === false,
        'the outside leg is fogged — at 300 m past the lip it is haze colour and at 700 it is gone');
      const cam = world.engine.camera;
      assert(cam.far >= (DECK.lip - DECK.threshold) + 600,
        `the camera's far plane is ${cam.far} m: a speck 600 m past the lip is behind it from the threshold`);
      const longest = Math.max(...P.hulls.map((H) => H.T));
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      let minFlying = 1e9, maxZ = 0, samples = 0, insideBad = 0, outsideBad = 0, rings = 0;
      const fighter = P.hulls.find((H) => H.kind === 'fighter');
      /* ITS FIRST CYCLE ONLY. The loop below runs longer than the fighter's
       * cycle, and the next cycle's far leg starts 700 m out again — a jump
       * that is not a ship reversing. `H.cycle` advances when the clock
       * wraps, and this is what checks that it does. */
      const c0 = fighter.cycle;
      const inZ = [], outZ = [];
      let landed = 0, solid = 0;
      const dt = 0.25;
      for (let t = 0; t < longest + 30; t += dt) {
        for (let k = 0; k < Math.round(dt * 60); k++) world.update(1 / 60, input);
        let flying = 0;
        for (const [im, n] of [[T.farF, T.farF.count], [T.farS, T.farS.count]]) {
          for (let i = 0; i < n; i++) {
            im.getMatrixAt(i, m); m.decompose(p, q, s);
            if (s.x < 0.5) continue;
            flying++;
            if (p.z < DECK.lip - 1) outsideBad++;
            if (p.z > maxZ) maxZ = p.z;
          }
        }
        for (const H of P.hulls) {
          const g = H.cast.group;
          if (!g.visible) continue;
          const A = H.farIn, B = A + H.inDur, Cc = B + H.sit, D = Cc + H.spin;
          const sitting = H.t >= B && H.t < D;
          if (!sitting) flying++;
          else { landed++; if (H.collider) solid++; }
          if (Math.abs(g.position.x) > P.clear - H.cast.group.userData.span * 0.5) insideBad++;
          if (g.position.y > P.ceiling + H.cast.group.userData.height) insideBad++;
          if (g.position.z > DECK.lip + 2) insideBad++;
        }
        if (flying < minFlying) minFlying = flying;
        samples++;
        for (const r of life.rings) if (r.mesh.visible) rings++;
        /* The fighter's own far leg: closing on the lip, then receding. */
        T.farF.getMatrixAt(fighter.slot, m); m.decompose(p, q, s);
        if (s.x > 0.5 && fighter.cycle === c0) {
          if (fighter.t < fighter.farIn) inZ.push(p.z);
          else outZ.push(p.z);
        }
      }
      assert(fighter.cycle > c0, `the fighter's clock ran ${(longest + 30).toFixed(0)} s against a ${fighter.T.toFixed(0)} s cycle and never counted a second one — every arrival is the same arrival, and the damaged one is every one`);
      assert(minFlying >= 6, `only ${minFlying} hulls in flight at the quietest moment of ${samples} samples — six at least, always`);
      assert(outsideBad === 0, `${outsideBad} samples of a silhouette INSIDE the room — the outside leg came through a wall`);
      assert(insideBad === 0, `${insideBad} samples of a modelled hull past a wall, above the ceiling or outside the lip`);
      assert(maxZ >= DECK.lip + 600, `the furthest a hull was drawn is ${(maxZ - DECK.lip).toFixed(0)} m past the lip — it vanishes before it is a speck`);
      assert(landed > 0 && solid === landed, `a landed hull was solid on ${solid} of ${landed} samples — you can walk through a ship`);
      assert(rings > 0, 'no field ring fired in a whole traffic cycle — ships are passing through the shield unnoticed');
      const mono = (arr, sign) => { for (let i = 1; i < arr.length; i++) if ((arr[i] - arr[i - 1]) * sign < -0.01) return false; return arr.length > 4; };
      assert(mono(inZ, -1), `an arrival did not close on the lip monotonically over ${inZ.length} samples`);
      assert(mono(outZ, 1), `a departure did not recede from the lip monotonically over ${outZ.length} samples`);
      return `${minFlying}+ hulls in flight over ${samples} samples, out to ${(maxZ - DECK.lip).toFixed(0)} m past the lip, `
        + `${landed} landed samples all solid, ${rings} ring frames, far plane ${cam.far} m`;
    } finally { world.unload(); }
  });

  check('deck cast: a damaged arrival smokes, sparks on touchdown and calls the crash crew, who go back', async () => {
    const { world, life, input } = await deck();
    try {
      const H = life.traffic.plan.hulls.find((h) => h.kind === 'fighter');
      assert(H.damaged, 'the first fighter arrival is not the damaged one — the player waits two minutes to see it');
      const crash = life.workers.filter((w) => w.job.job === 'crash');
      assert(crash.length >= 2, `${crash.length} crash men on the apron`);
      let ran = false, back = false, farthest = 0;
      for (let i = 0; i < 60 * (H.farIn + H.inDur + H.sit + H.spin + 20); i++) {
        world.update(1 / 60, input);
        const c = crash[0];
        if (c.run) { ran = true; farthest = Math.max(farthest, c.at); }
        else if (ran && !c.target && c.at === 0) { back = true; break; }
      }
      assert(ran, 'no crash man ran to the landing');
      assert(farthest > 0.9, `the crash crew got ${(farthest * 100).toFixed(0)}% of the way to the pad before being called back`);
      assert(back, 'the crash crew never walked back to the station');
      return 'first fighter arrival damaged; crash crew ran to it and walked back';
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5 · THE PA                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: the PA announces every launch and arrival on the horn, wordless, never inside the gap', async () => {
    const { world, life, input } = await deck();
    try {
      const st = world._deckAudio;
      assert(st, 'no deck audio to announce on');
      const heard = [];
      const n0 = world.notify.bind(world);
      world.notify = (a, b, k) => { if (/^PA\b/.test(String(a))) heard.push({ t: life.t, a, b, k, horn: st.horn }); return n0(a, b, k); };
      for (let i = 0; i < 60 * 150; i++) world.update(1 / 60, input);
      assert(heard.length >= 8, `${heard.length} announcements in 150 s of a deck with four hulls cycling and a taxiing shuttle`);
      for (let i = 1; i < heard.length; i++) {
        assert(heard[i].t - heard[i - 1].t >= 14 - 1e-6,
          `announcements ${(heard[i].t - heard[i - 1].t).toFixed(1)} s apart — the gap is 14`);
      }
      assert(heard.every((h) => h.k === 'flavour'), 'an announcement was raised as an alarm or a threat');
      assert(heard.some((h) => /LAUNCH/.test(h.a)) && heard.some((h) => /INBOUND|FINAL/.test(h.a)),
        `no launch or no arrival was announced: ${heard.map((h) => h.a).join(' | ')}`);
      /* THE HORN WENT WITH EVERY LINE: `paCall` advances `st.horn` per call. */
      for (let i = 1; i < heard.length; i++) assert(heard[i].horn > heard[i - 1].horn, 'a HUD line went up without the horn');
      return `${heard.length} announcements over 150 s: ${heard.map((h) => `${h.t.toFixed(0)}s ${h.a.replace('PA — ', '')}`).join(' · ')}`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6 · NOTHING IS A BARE LITERAL                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck cast: every site is read off the zones, and nothing reads DECK at import', async () => {
    const { readFile } = await import('node:fs/promises');
    const { functionBody } = await import('./_source.mjs');
    const src = await readFile(new URL('../../src/game/DeckLife.js', import.meta.url), 'utf8');
    const fr = functionBody(src, 'function frame()');
    for (const name of ['DECK_ZONES', 'DECK.lip', 'DECK.aft', 'DECK.wall', 'DECK.roof', 'DECK.line', 'DECK.start.z']) {
      assert(fr.includes(name), `frame() never reads ${name}`);
    }
    for (const t of ['function droidJobs', 'function workerJobs', 'function silJobs', 'function looseJobs', 'function craneRuns', 'function sledRuns',
      'function trafficPlan', 'function ventTable', 'function trolleyRun']) {
      const body = functionBody(src, t);
      assert(/frame\(\)/.test(body), `${t} does not read the frame — it is siting things on its own`);
    }
    const head = src.slice(0, src.indexOf('function frame()'));
    const eager = head.match(/^const\s+\w+\s*=\s*DECK[._]/m);
    assert(!eager, `a module-level constant reads DECK before the import cycle has settled: "${eager?.[0]}"`);
    /* And the sound rides the hull's own clock, which is the file's oldest rule. */
    const hull = functionBody(src, 'function stepHull');
    for (const fn of ['damagedArrival(', 'launchSequence(', 'repulsorPass(']) {
      assert(hull.includes(fn), `${fn} is not fired from the hull's clock — a sound and a ship on two schedules drift`);
    }
    const cast = await readFile(new URL('../../src/game/DeckCast.js', import.meta.url), 'utf8');
    assert(/import \{ SHOVE, STATE \} from '\.\.\/physics\/Shovable\.js'/.test(cast),
      'Knockable does not read its clock off SHOVE — a second copy of "how long is being knocked over"');
    return 'eight placement tables through frame(), frame() off DECK and DECK_ZONES, none eager; the cues on the hull clock';
  });
}
