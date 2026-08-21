/**
 * BATTLEFRONT BORZ — TWO ARMIES, TWO HULLS, ONE RIDE.
 *
 * ── THE NOTE THIS FILE ANSWERS ────────────────────────────────────────────
 *
 * The player, having played a Sith through a build with one transport in it:
 *
 *   "Ive noticed that sith side still gets picked up by the same transports
 *    that belong to the republic canonically, so fix that the bad guys need
 *    their own unique transports too look it up but functionally they should
 *    not be differernt like you should be able to sit/stand in it and see
 *    through it, ramp, opening doors, etc."
 *
 * That is two properties pulling in opposite directions, and a check that only
 * holds one of them is worse than none: hold "different" alone and the
 * Confederacy gets a beautiful hull nobody can board; hold "not different"
 * alone and it gets the Republic ship with the paint changed, which is the
 * defect being reported.
 *
 * ── WHAT IS MEASURED, AND WHY EACH IS THE HONEST FORM OF THE QUESTION ─────
 *
 *   THE CONTRACT IS DERIVED, NOT LISTED. `ExtractionDirector` drives a hull
 *     through `userData.{engines,lamp,ramp,doorL,doorR,bay,seats,span,length,
 *     height}`, and this file does not carry that list: it reads the key set
 *     off the REPUBLIC hull, which is the one the director was written
 *     against, and requires the Confederacy hull to publish the same set. A
 *     tenth field added to one tomorrow is required of the other tomorrow,
 *     with nobody editing this file. That is HANDOFF §2.3 applied to a check
 *     rather than to the game.
 *
 *   EVERY NAME IS EXERCISED, NOT COUNTED. A `ramp` key holding an empty Group
 *     satisfies any spelling check ever written. So the ramp is hinged and the
 *     box has to change; the doors are slid and the box has to change; the bay
 *     is measured for a standing trooper's head; the seats are asked for both
 *     kinds; the engines are asked to be at the STERN, because an anchor at
 *     the nose puts the exhaust cone out of the front of the ship and nothing
 *     throws.
 *
 *   THE RAMP LEAVES MUST AGREE, and this is the clause that would have caught
 *     the subtlest way to get this wrong. `Extraction._hatch` sets the hinge
 *     angle to asin(drop / 2.6) and `_deckHeight` walks a body up a leaf of
 *     length 2.6 — one constant, in a file that does not know there are two
 *     ships. A Confederacy ramp built 2.0 m long would have passed every other
 *     clause here and dropped a trooper through the deck.
 *
 *   THE CHOICE IS DRIVEN, NOT READ. Two real Worlds, one led by a Jedi and one
 *     by a Sith, through `beginInsertion` — the shipped entry point — and the
 *     hull that arrives is identified by RASTERISING IT and matching the
 *     silhouette against the two builders' own. Reading `userData.side` back
 *     off the model would be asking the ship to confirm its own label, which
 *     is HANDOFF §2.4: an instrument that restates a rule eventually disagrees
 *     with it, and it fails by manufacturing defects.
 *
 *   DISTINCTNESS IS AN OVERLAP, NOT AN OPINION. Three orthogonal silhouettes
 *     per pair — flank, plan and head-on — rasterised at 10 cm onto a common
 *     grid and intersected over their union. Boxes are not enough: two hulls
 *     with different bounding boxes can still be the same shape, and two with
 *     the same box can be nothing alike.
 *
 *   THE FLOOR IS NAMED. The plan view is the loosest of the three at 0.641 and
 *     it cannot be driven much below that by shaping, because both ships are a
 *     2.4 m troop bay on the same centreline with a 2.6 m ramp at the same
 *     place — the functional core the player asked for is about a third of
 *     either footprint. Writing a 0.30 bar there would be writing a bar that
 *     can only be met by breaking the other half of the note.
 *
 *   THE COST IS STATED AND BOUNDED. Draw calls, not triangles: exactly one
 *     transport is ever in the world (`Extraction` adds it to the scene rather
 *     than to `statics`), and the bar is set against what the Republic hull
 *     already costs rather than against a number somebody liked.
 *
 * The suite drives real Worlds, so `check` is wrapped by `clocked` — see
 * `_shared.mjs` and `determinism.mjs`, which fails a World-driving suite that
 * does not.
 */

import { clocked } from './_shared.mjs';

/* ── the instrument: a silhouette, rasterised ─────────────────────────── */

/**
 * Every triangle of a built hull, in the hull's own space, as flat arrays.
 *
 * Flat rather than Vector3s because the three projections below each read two
 * of the nine numbers per triangle and a hull is two and a half thousand of
 * them; allocating 7,500 vectors to throw them away is the kind of thing that
 * turns a 200 ms check into a 4 s one for no reading.
 */
function triangles(THREE, g) {
  g.updateMatrixWorld(true);
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  g.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      out.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
    }
  });
  return out;
}

/** The common window both hulls of a pair are rasterised into. */
function extentOf(sets, ia, ib, pad = 0.2) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const T of sets) for (const t of T) for (const o of [0, 3, 6]) {
    if (t[o + ia] < minU) minU = t[o + ia];
    if (t[o + ia] > maxU) maxU = t[o + ia];
    if (t[o + ib] < minV) minV = t[o + ib];
    if (t[o + ib] > maxV) maxV = t[o + ib];
  }
  return { minU: minU - pad, maxU: maxU + pad, minV: minV - pad, maxV: maxV + pad };
}

/**
 * A filled silhouette mask.
 *
 * Each triangle is sampled on a barycentric lattice whose density is set by
 * its own AREA, so a big plate is filled and a 3 cm greeble is not
 * over-sampled. Point-sampling rather than a scanline fill because it cannot
 * disagree with itself about edges: the same lattice is used for both hulls of
 * a pair, so whatever it under-fills it under-fills identically on both sides
 * and the RATIO — which is the only number read out — is unmoved. A scanline
 * fill would be more exact and would need its own correctness argument.
 */
function silhouette(T, ia, ib, ext, cell) {
  const w = Math.ceil((ext.maxU - ext.minU) / cell), h = Math.ceil((ext.maxV - ext.minV) / cell);
  const m = new Uint8Array(w * h);
  for (const t of T) {
    const u0 = t[ia], v0 = t[ib], u1 = t[3 + ia], v1 = t[3 + ib], u2 = t[6 + ia], v2 = t[6 + ib];
    const area = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5;
    const k = Math.max(1, Math.ceil(Math.sqrt(area) / cell * 2));
    for (let x = 0; x <= k; x++) {
      for (let y = 0; y <= k - x; y++) {
        const bu = (x + 1 / 3) / (k + 1), bv = (y + 1 / 3) / (k + 1), bw = 1 - bu - bv;
        if (bw < 0) continue;
        const u = u0 * bw + u1 * bu + u2 * bv, v = v0 * bw + v1 * bu + v2 * bv;
        const cx = (u - ext.minU) / cell | 0, cy = (v - ext.minV) / cell | 0;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) m[cy * w + cx] = 1;
      }
    }
  }
  return m;
}

/** Intersection over union of two masks cut from the same window. */
function overlap(a, b) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] | b[k]) u++; if (a[k] & b[k]) i++; }
  return u ? i / u : 1;
}

/** flank (z,y) · plan (z,x) · head-on (x,y) — the three orthogonal views. */
const VIEWS = [['flank', 2, 1], ['plan', 2, 0], ['head-on', 0, 1]];

/** Every view's IoU for one pair of triangle sets, on one common grid each. */
function views(A, B, cell) {
  const out = {};
  for (const [name, ia, ib] of VIEWS) {
    const ext = extentOf([A, B], ia, ib);
    out[name] = overlap(silhouette(A, ia, ib, ext, cell), silhouette(B, ia, ib, ext, cell));
  }
  return out;
}

/** meshes = draw calls, because every Kit bake is one merged mesh. */
function cost(g) {
  let meshes = 0, tris = 0;
  g.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return { meshes, tris: Math.round(tris) };
}

/** A world in a mode with a commander and a line, led by the given order. */
async function boot(order, level = 'geonosis') {
  const H = await import('./_coop.mjs');
  /* Levels.js is what calls `setTransportModel` / `setCapitalModel`. Without
   * it `transportModel()` falls back to the gunship and every hull question
   * below would be asked of the wrong ship — and it is imported dynamically,
   * inside a function body, for HANDOFF §2.1's reason. */
  await import('../../src/game/Levels.js');
  const { world } = await H.bootWorld({
    level, settings: { quality: 'low', difficulty: 'knight', mode: 'skirmish', order },
  });
  const input = H.idleInput();
  world.update(1 / 60, input);
  return { world, input };
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══ A — both hulls publish the same contract ══════════════════════ */

  check('transports: the Confederacy hull publishes exactly the contract the Republic one does', async () => {
    /**
     * DERIVED FROM THE SHIPPED HULL, not from a list in this file. See the
     * header: the director was written against the Republic ship, so that
     * ship's own key set is the specification, and the day somebody publishes
     * a tenth field on one of them this goes red without being edited.
     */
    const V = await import('../../src/game/Vehicles.js');
    const rep = V.buildTransport({ side: 'republic', fresh: true });
    const cis = V.buildTransport({ side: 'separatist', fresh: true });
    assert(rep !== cis, 'the two sides were handed the same object');
    const drivenBy = Object.keys(rep.userData).sort();
    const publishes = Object.keys(cis.userData).sort();
    const missing = drivenBy.filter((k) => !publishes.includes(k));
    const extra = publishes.filter((k) => !drivenBy.includes(k));
    assert(!missing.length,
      `the Confederacy hull does not publish ${missing.join(', ')} — ExtractionDirector reads `
      + 'those names off whatever ship it is given and would need a branch per hull without them');
    assert(!extra.length,
      `the Confederacy hull publishes ${extra.join(', ')} and the Republic one does not — one of `
      + 'the two ships is being driven by something the other cannot answer');
    /* AND THE NINE THE DIRECTOR ACTUALLY NAMES ARE AMONG THEM. Without this
     * the clause above has a trivial solution: delete a field from both hulls
     * and the sets still match. The names are read out of Extraction.js's own
     * source rather than typed here, so a rename over there fails here. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Extraction.js', import.meta.url), 'utf8');
    const named = new Set();
    for (const m of src.matchAll(/userData(?:\?)?\.(\w+)/g)) named.add(m[1]);
    for (const m of src.matchAll(/\bu\.(\w+)/g)) named.add(m[1]);
    const drives = [...named].filter((k) => drivenBy.includes(k)).sort();
    assert(drives.length >= 6,
      `only ${drives.length} of the published names are reachable from Extraction.js (${drives.join(', ')}) `
      + '— the detector is wrong, or the director stopped reading the ship');
    return `${drivenBy.length} fields both ways (${drivenBy.join(', ')}); ${drives.length} of them read by the director`;
  });

  check('transports: every name on the Confederacy hull is a working part, not a key', async () => {
    /**
     * "functionally they should not be differernt like you should be able to
     * sit/stand in it and see through it, ramp, opening doors, etc."
     *
     * A `ramp` field holding an empty Group satisfies the clause above and
     * every spelling check ever written. So each name is USED here the way the
     * director uses it, and the assertion is on what moved.
     */
    const THREE = await import('three');
    const V = await import('../../src/game/Vehicles.js');
    const out = [];
    for (const side of ['republic', 'separatist']) {
      const g = V.buildTransport({ side, fresh: true });
      const u = g.userData;
      assert(u.engines?.length >= 4,
        `${side}: ${u.engines?.length ?? 0} engine anchor(s) — "I don't see any engines working" was `
        + 'answered by putting a lit cone in every nozzle, and a hull with fewer has dead nozzles');
      for (const e of u.engines) {
        assert(e.position.z > 0,
          `${side}: an engine anchor sits at z ${e.position.z.toFixed(2)}, which is forward of centre — `
          + '_makeShip roots its exhaust cone there and it would blow out of the nose');
      }
      assert(u.lamp && u.lamp.position.z < 0, `${side}: no landing lamp at the nose`);
      assert(g.getObjectByName('pilotL') && g.getObjectByName('pilotR'),
        `${side}: nobody is flying it — "You should be able to see the pilots too"`);
      const bay = u.bay;
      assert(bay, `${side}: publishes no bay, so Extraction has nothing to seat anybody in`);
      assert(bay.roof - bay.floor >= 1.9,
        `${side}: the bay is ${(bay.roof - bay.floor).toFixed(2)} m deck to roof — a trooper cannot stand up`);
      assert(bay.halfW * 2 >= 2.2, `${side}: the bay is ${(bay.halfW * 2).toFixed(2)} m wide`);
      assert(bay.back > bay.front, `${side}: the bay's aft lip is forward of its bulkhead`);
      assert(u.seats.some((x) => x.sit) && u.seats.some((x) => !x.sit),
        `${side}: every place in the bay is the same kind — "you can either sit or stand"`);
      /* THE PARTS MOVE, AND EACH IS MEASURED ON ITSELF. They are separate
       * groups precisely so they can move, and a hull that baked them back
       * into the merge would satisfy everything above and be the closed box
       * the player complained about.
       *
       * MEASURED ON THE PART, not on the ship, and that is not fussiness — it
       * is the version of this clause that works. Sliding a door 2 m aft does
       * not change the SHIP's bounding box at all, because the box is already
       * held by the ramp at z 5.89 and the wings at x ±4.43. A check that
       * watched the whole hull would have called a working door baked-in, and
       * one that watched it for the ramp only would have missed the door
       * entirely. So each part is asked for its own geometry and its own
       * displacement. */
      const part = (o) => {
        const b = new THREE.Box3().setFromObject(o), c = new THREE.Vector3();
        let tris = 0;
        o.traverse((m) => {
          if (!m.isMesh) return;
          tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
        });
        return { at: b.getCenter(c), tris };
      };
      for (const [name, node] of [['ramp', u.ramp], ['doorL', u.doorL], ['doorR', u.doorR]]) {
        assert(part(node).tris > 12,
          `${side}: ${name} is an empty group — the field exists and there is no panel on it`);
      }
      const doorShut = part(u.doorL).at.clone();
      u.doorL.position.z = 2.0; u.doorR.position.z = 2.0; g.updateMatrixWorld(true);
      const doorOpen = part(u.doorL).at;
      assert(doorOpen.z - doorShut.z > 1.8,
        `${side}: sliding the door 2.0 m aft moved its geometry ${(doorOpen.z - doorShut.z).toFixed(2)} m — `
        + 'it is baked into the hull merge and only the empty group is moving');
      u.doorL.position.z = 0; u.doorR.position.z = 0;
      const rampShut = part(u.ramp).at.clone();
      u.ramp.rotation.x = 0.6; g.updateMatrixWorld(true);
      const rampDown = part(u.ramp).at;
      assert(rampShut.y - rampDown.y > 0.5,
        `${side}: hinging the ramp 0.6 rad dropped its leaf ${(rampShut.y - rampDown.y).toFixed(2)} m — `
        + 'a ramp that does not swing is a bay nobody can walk out of');
      u.ramp.rotation.x = 0;
      /* …and the published size is the size it IS. `_wake` sizes its landing
       * wash off these, so a literal that had drifted from the geometry would
       * put the dust cone somewhere the ship is not. */
      g.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      new THREE.Box3().setFromObject(g).getSize(s);
      assert(Math.abs(u.span - s.x) < 0.01 && Math.abs(u.length - s.z) < 0.01 && Math.abs(u.height - s.y) < 0.01,
        `${side}: publishes ${u.span.toFixed(2)} x ${u.length.toFixed(2)} x ${u.height.toFixed(2)} and `
        + `measures ${s.x.toFixed(2)} x ${s.z.toFixed(2)} x ${s.y.toFixed(2)}`);
      out.push(`${side} ${s.x.toFixed(1)}x${s.y.toFixed(1)}x${s.z.toFixed(1)} m, `
        + `bay ${(bay.halfW * 2).toFixed(1)}x${(bay.roof - bay.floor).toFixed(1)} m, `
        + `${u.seats.filter((x) => x.sit).length} seated + ${u.seats.filter((x) => !x.sit).length} standing`);
    }
    return out.join(' · ');
  });

  check('transports: the two ramp leaves are the same length, because Extraction only knows one', async () => {
    /**
     * THE CLAUSE THAT CATCHES THE SUBTLEST WAY TO GET THIS WRONG, and the only
     * one here that is about a number rather than a property.
     *
     * `Extraction._hatch` computes the hinge angle that puts the lip on the
     * sand as asin(drop / 2.6), and `_deckHeight` walks a climbing body up a
     * leaf of length 2.6 — ONE constant, in a file that has no idea there are
     * two ships and must not be given one. A Confederacy ramp built 2.0 m long
     * would satisfy every other clause in this file and put a trooper through
     * the deck on the way up: the director would think there was still half a
     * metre of leaf under them.
     *
     * So the two leaves are MEASURED off the built hulls and required to
     * agree, and the constant they must both agree WITH is read out of
     * Extraction.js's own source rather than written here — because the whole
     * failure being guarded against is one number in two places.
     */
    const THREE = await import('three');
    const V = await import('../../src/game/Vehicles.js');
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Extraction.js', import.meta.url), 'utf8');
    const m = src.match(/const\s+rampLen\s*=\s*([\d.]+)/);
    assert(m, 'Extraction.js no longer declares rampLen — this check cannot answer its question');
    const assumed = parseFloat(m[1]);
    const leaves = {};
    for (const side of ['republic', 'separatist']) {
      const g = V.buildTransport({ side, fresh: true });
      g.userData.ramp.rotation.x = 0;
      g.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      new THREE.Box3().setFromObject(g.userData.ramp).getSize(s);
      leaves[side] = s.z;
    }
    const spread = Math.abs(leaves.republic - leaves.separatist);
    assert(spread < 0.10,
      `the ramp leaves are ${leaves.republic.toFixed(2)} m and ${leaves.separatist.toFixed(2)} m — `
      + `_hatch hinges both at asin(drop / ${assumed}) and _deckHeight walks a body up ${assumed} m of leaf`);
    for (const side of ['republic', 'separatist']) {
      assert(Math.abs(leaves[side] - assumed) < 0.12,
        `the ${side} leaf measures ${leaves[side].toFixed(2)} m against the ${assumed} m Extraction.js `
        + 'assumes — the ramp will not reach the ground, or will pass through it');
    }
    return `${leaves.republic.toFixed(2)} m and ${leaves.separatist.toFixed(2)} m against the `
      + `${assumed} m the director hinges on (spread ${(spread * 100).toFixed(0)} mm)`;
  });

  /* ══ B — the two hulls are actually two ships ══════════════════════ */

  check('transports: the two hulls do not share a silhouette from any side', async () => {
    /**
     * "droid transports do not look like a LAAT." Measured rather than
     * asserted, from three orthogonal directions, because a bounding box
     * cannot answer it: the Republic hull is 8.86 x 4.43 x 11.54 and the
     * Confederacy hull is 8.06 x 7.34 x 12.64, and two different boxes can
     * still hold the same shape.
     *
     * As built: 0.437 flank, 0.641 plan, 0.391 head-on, mean 0.490. The bars
     * are 0.70 on the worst view and 0.55 on the mean, which is roughly 25% of
     * headroom on the number that actually moves.
     *
     * WHY THE PLAN BAR IS THE LOOSE ONE, since a reader will ask. Both ships
     * are a 2.4 m troop bay on the same centreline with a 2.6 m ramp hinged at
     * the same place, because that is the half of the note that says the ride
     * must not change. From directly above, that shared functional core is
     * about a third of either footprint and no amount of shaping removes it. A
     * 0.30 bar there would be a bar that can only be met by breaking the other
     * half of the player's sentence.
     */
    const THREE = await import('three');
    const V = await import('../../src/game/Vehicles.js');
    const A = triangles(THREE, V.buildTransport({ side: 'republic', fresh: true }));
    const B = triangles(THREE, V.buildTransport({ side: 'separatist', fresh: true }));
    const v = views(A, B, 0.10);
    const worst = Math.max(...Object.values(v));
    const mean = Object.values(v).reduce((a, b) => a + b, 0) / VIEWS.length;
    assert(worst <= 0.70,
      `the two hulls overlap ${(worst * 100).toFixed(0)}% of their union from one side `
      + `(${Object.entries(v).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(', ')}) — that is one ship `
      + 'with different paint, which is the note this file exists for');
    assert(mean <= 0.55,
      `mean overlap ${mean.toFixed(3)} across flank, plan and head-on — distinct from one angle is not distinct`);
    assert(Math.min(...Object.values(v)) <= 0.45,
      'no single view separates the two hulls by more than half — there is no angle from which they read apart');
    return Object.entries(v).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(' · ') + ` · mean ${mean.toFixed(3)}`;
  });

  check('transports: the capital ship the insertion leaves is the commander\'s own fleet', async () => {
    /**
     * THE SAME DEFECT ONE SCENE EARLIER. `beginInsertion` opens every deploy in
     * the bay of a transport falling away from a warship, and the warship is
     * the ONLY thing in that shot — stars, a planet, and one hull receding. A
     * Sith leaving a Republic assault ship is the player's note moved thirty
     * seconds earlier and two kilometres further out.
     *
     * Held to the same overlap measure at 6 cm, because these are 1/100-scale
     * models: 0.268 flank, 0.600 plan, 0.561 head-on. The bar is looser than
     * the transports' and deliberately so — a capital ship is a stylised
     * silhouette meant to read at four kilometres, both are long hulls with an
     * engine bank at the stern, and the shape budget is smaller. What must not
     * happen is the two being interchangeable.
     */
    const THREE = await import('three');
    const V = await import('../../src/game/Vehicles.js');
    const A = triangles(THREE, V.buildCapitalShip({ side: 'republic', fresh: true }));
    const B = triangles(THREE, V.buildCapitalShip({ side: 'separatist', fresh: true }));
    const v = views(A, B, 0.06);
    const mean = Object.values(v).reduce((a, b) => a + b, 0) / VIEWS.length;
    assert(Math.max(...Object.values(v)) <= 0.72,
      `the two capital ships overlap ${(Math.max(...Object.values(v)) * 100).toFixed(0)}% of their union `
      + `from one side (${Object.entries(v).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(', ')})`);
    assert(mean <= 0.60, `mean overlap ${mean.toFixed(3)} across three views`);
    return Object.entries(v).map(([k, x]) => `${k} ${x.toFixed(3)}`).join(' · ') + ` · mean ${mean.toFixed(3)}`;
  });

  /* ══ C — the choice, driven through the shipped code ═══════════════ */

  check('transports: a Sith is picked up by the Confederacy and a Jedi by the Republic', async () => {
    /**
     * THE WHOLE NOTE, DRIVEN. Two real Worlds in a real mode, one led by a
     * Jedi and one by a Sith, through `beginInsertion` — the method every
     * deploy in the game calls — and the hull that turns up is identified by
     * MEASURING IT.
     *
     * Reading `model.userData.side` back would be asking the ship to confirm
     * its own label and would pass on a hull that published `'separatist'` and
     * was the Republic ship. So the flown hull is rasterised and matched
     * against the two builders' own silhouettes: it has to be a near-perfect
     * match for one and not for the other. `_side()` is printed beside it, but
     * nothing here asserts on it.
     *
     * A GREY IS CHECKED TOO, because a fallback nobody exercises is a fallback
     * nobody knows is broken. `Command.sideForOrder` documents the Republic as
     * the answer for an order with no army — "somebody has to be at the head
     * of the column" — and this is where that stops being a comment.
     */
    const THREE = await import('three');
    const V = await import('../../src/game/Vehicles.js');
    const ref = {
      republic: triangles(THREE, V.buildTransport({ side: 'republic', fresh: true })),
      separatist: triangles(THREE, V.buildTransport({ side: 'separatist', fresh: true })),
    };
    const named = (T) => {
      const scores = {};
      for (const [id, R] of Object.entries(ref)) {
        const v = views(T, R, 0.10);
        scores[id] = Object.values(v).reduce((a, b) => a + b, 0) / VIEWS.length;
      }
      const best = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
      return { best, scores };
    };
    /* A FLOWN HULL IS NOT A FRESH ONE, and the margin is what accounts for it
     * without pretending otherwise. `_makeShip` parents an exhaust cone and a
     * core to every one of the four nozzles, and `beginInsertion` calls
     * `_hatch(1)` before the first frame — so the ship in the sky has eight
     * meshes the reference does not and its ramp is down and its doors are
     * aft. Measured, that is worth about 0.20 of overlap. So the test is not
     * "is it identical to one of them", which no flown ship can pass; it is
     * "is it far closer to one than to the other", which is the question, and
     * the gap it has to clear is bigger than the drift it has to survive. */
    const seen = [];
    for (const [order, want] of [['jedi', 'republic'], ['sith', 'separatist'], ['grey', 'republic']]) {
      const { world } = await boot(order);
      const X = world.extraction;
      const flew = X.beginInsertion({ name: 'Geonosis' });
      assert(flew, `${order}: beginInsertion declined on a world with a player, terrain and no instantSpawn`);
      assert(X._model, `${order}: the insertion flew with no hull at all`);
      const { best, scores } = named(triangles(THREE, X._model));
      const other = Object.keys(scores).find((k) => k !== want);
      assert(scores[want] > 0.70,
        `${order}: the hull that arrived matches the ${want} ship only ${scores[want].toFixed(3)} — `
        + 'it is neither of the two shipped hulls');
      assert(scores[want] - scores[other] > 0.15,
        `${order}: the hull that arrived is ${scores[want].toFixed(3)} like the ${want} ship and `
        + `${scores[other].toFixed(3)} like the ${other} one — that is not a ship, it is a coin toss`);
      assert(best === want,
        `${order} leads the ${want === 'republic' ? 'Republic' : 'Confederacy'} and was picked up by the `
        + `${best} transport (${Object.entries(scores).map(([k, s]) => `${k} ${s.toFixed(3)}`).join(', ')}) — `
        + 'this is the player\'s note, still true');
      /* AND THE WARSHIP ASTERN IS THE SAME ARMY'S. One decision, two consumers
       * — see `_side`'s note — so a build in which they disagree is a build in
       * which the decision got made twice. */
      assert(X._capital, `${order}: no capital ship in the opening shot`);
      assert(X._capital.userData.side === X._model.userData.side,
        `${order}: the transport is the ${X._model.userData.side} hull and the warship it left is the `
        + `${X._capital.userData.side} one — the side was decided twice`);
      seen.push(`${order} → ${best} ${scores[want].toFixed(2)} v ${scores[other].toFixed(2)}`);
      world.dispose?.();
    }
    return seen.join(' · ');
  });

  check('transports: the Confederacy bay carries the same stick onto the ground', async () => {
    /**
     * "functionally they should not be differernt" is a claim about the number
     * of bodies that get a ride, and the seat table is where a hull would
     * quietly break it: `beginInsertion` fills up to `seats.length` and stops,
     * so a Confederacy bay with eight places would leave a Sith's ninth and
     * tenth trooper standing on the pad while a Jedi's boarded — with nothing
     * on screen to say why.
     *
     * So both are flown, in the same mode on the same ground, and what is
     * counted is bodies that RODE and bodies that got off. Not the seat table:
     * the table is what the ship claims and this is what the flight did.
     */
    const out = [];
    const took = {};
    for (const order of ['jedi', 'sith']) {
      const { world, input } = await boot(order);
      const X = world.extraction;
      X.beginInsertion({ name: 'Geonosis' });
      const places = X._model.userData.seats.length;
      world.update(1 / 60, input);
      const aboard = world.enemies.filter((e) => !e.dead && e.riding).length;
      assert(world.player.riding, `${order}: the commander did not start aboard`);
      /**
       * EVERY PASSENGER IS INSIDE THE SHIP, not perched on it. That sentence
       * is the whole of the sill the player complained about — "you don't even
       * walk into the ship you touch it and teleport in I guess?" — which was
       * a seat at x = ±1.45, half a body outboard of the belly.
       *
       * ASKED IN THE SHIP'S OWN FRAME, which is where the answer lives.
       * `riding.to` is the seat `_seat` took out of `userData.seats`, in ship
       * coordinates, and `userData.bay` is the box in the same coordinates —
       * so this compares the two things that have to agree, with no matrix
       * between them. Reading world positions back instead measures something
       * else in a headless harness: nothing renders, three refreshes
       * `matrixWorld` only when something asks it to, and a body placed
       * through one generation of the ship's transform and tested against
       * another disagrees by however far the ship flew in between. That was
       * seen: ten passengers in their seats reported 5.5 m aft of the bay.
       */
      const bay = X._model.userData.bay;
      const inBay = (t) => Math.abs(t.x) <= bay.halfW + 0.05
        && t.z >= bay.front && t.z <= bay.back
        && t.y >= bay.floor - 0.05 && t.y <= bay.roof;
      let outside = 0, worst = null;
      for (const e of world.enemies) {
        if (!e.riding || inBay(e.riding.to)) continue;
        outside++;
        worst = worst || e.riding.to;
      }
      assert(!outside,
        `${order}: ${outside} of the ${aboard} aboard were seated outside the bay the hull publishes `
        + `(first at ${worst && [worst.x, worst.y, worst.z].map((x) => x.toFixed(2)).join(', ')} against `
        + `${JSON.stringify(bay)}) — that is the sill this whole sequence was rewritten to remove`);
      assert(world.player.riding && inBay(world.player.riding.to),
        `${order}: the commander's own place is outside the bay`);
      let t = 0;
      for (let i = 0; i < 60 * 120; i++) {
        world.update(1 / 60, input); t += 1 / 60;
        if (!X.active && t > 1) break;
      }
      const landed = world.enemies.filter((e) => !e.dead && e.team === world.partyTeam).length;
      assert(!world.player.riding, `${order}: the commander is still in the bay after the flight finished`);
      const p = world.player.position;
      assert(Math.abs(p.y - world.terrain.height(p.x, p.z)) < 2.5,
        `${order}: the commander did not end up standing on the ground`);
      took[order] = { places, aboard, landed };
      out.push(`${order}: ${places} places, ${aboard} rode, ${landed} on the sand in ${t.toFixed(0)} s`);
      world.dispose?.();
    }
    assert(took.jedi.places === took.sith.places,
      `the Republic bay publishes ${took.jedi.places} places and the Confederacy bay ${took.sith.places} — `
      + 'a Sith would leave troopers on the pad that a Jedi takes');
    assert(took.sith.aboard >= took.jedi.aboard,
      `${took.sith.aboard} droids rode against ${took.jedi.aboard} clones out of the same muster`);
    assert(took.sith.landed >= 6, `${took.sith.landed} of the Confederacy line made it onto the ground`);
    return out.join(' · ');
  });

  /* ══ D — one decision, one place, and what it costs ════════════════ */

  check('transports: nothing outside Vehicles.js knows there are two hulls', async () => {
    /**
     * THE PROPERTY THAT IS NOT ABOUT EITHER SHIP. The brief this work was done
     * to: "Find every place a hull is chosen and make the choice one decision
     * in one place — not a branch at each call site."
     *
     * There are two consumers — `_makeShip` picks the transport and
     * `_makeSpace` picks the warship astern — and the tempting shape is
     * `side === 'separatist' ? a : b` at each. That is two copies of one rule
     * and the ninth instance of HANDOFF §2.3 waiting to happen: a third army
     * arrives, one branch is updated, and nothing says so.
     *
     * So this reads the SOURCE, which is the only instrument that can see the
     * shape rather than the behaviour. Two clauses:
     *
     *   the per-side builders are named nowhere outside the file that defines
     *     them and the file that checks them, so no call site can reach past
     *     the table;
     *   and `Extraction.js` asks `_side()` rather than deciding — the string
     *     `'separatist'` appears in it only inside `_side`'s own note.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const root = new URL('../../src/', import.meta.url);
    const files = [];
    const walk = async (dir) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const at = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(at);
        else if (e.name.endsWith('.js')) files.push([e.name, at]);
      }
    };
    await walk(root);
    assert(files.length > 20, `only ${files.length} source files found — the walker is wrong`);
    const perSide = /\bbuild(?:RepublicTransport|DroidTransport|RepublicCapital|DroidCapital)\b/;
    const named = [];
    let extractionSrc = '';
    for (const [name, at] of files) {
      const src = await readFile(at, 'utf8');
      if (name === 'Extraction.js') extractionSrc = src;
      if (name === 'Vehicles.js') continue;
      if (perSide.test(src)) named.push(name);
    }
    assert(!named.length,
      `${named.join(', ')} name a per-side hull builder directly — the choice belongs to the one table `
      + 'in Vehicles.js, and a second caller is a second copy of it');
    assert(extractionSrc, 'Extraction.js was not found by the walker');
    /* THE DIRECTOR DOES NOT BRANCH. Comments stripped, because `_side`'s note
     * names both armies and should — what must not appear is a decision. */
    const bare = extractionSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const branches = bare.split('\n').filter((l) => /'(separatist|republic)'/.test(l));
    const inSide = branches.filter((l) => /armyForOrder|return 'republic'/.test(l));
    assert(branches.length === inSide.length,
      `Extraction.js decides a side outside _side(): ${branches.filter((l) => !inSide.includes(l))
        .map((l) => l.trim()).slice(0, 3).join(' | ')}`);
    const calls = (bare.match(/this\._side\(\)/g) || []).length;
    assert(calls >= 2,
      `_side() is called ${calls} time(s) — the transport and the capital ship are two consumers and `
      + 'a side resolved twice is a side that can be resolved two different ways');
    return `${files.length} source files scanned, 0 name a per-side builder; the director calls _side() `
      + `${calls} times and branches on an army id in ${branches.length} lines, all inside it`;
  });

  check('transports: the Confederacy hull costs what the Republic one costs', async () => {
    /**
     * DRAW CALLS, NOT TRIANGLES, because that is what this renderer is short
     * of — HANDOFF §2.6 measures an EMPTY field at 801 draw calls and 4151 ms
     * a frame on swiftshader. Every `Kit.bake` is one merged mesh per material,
     * so a mesh here is a draw call and the number is the count of materials
     * the hull spends, not the count of parts it is made of.
     *
     * The bar is set against the ship that already ships rather than against a
     * number somebody liked: the Confederacy hull may not cost more than a
     * quarter again what the Republic one does. As built that is 29 meshes
     * against 30 and 2,616 triangles against 2,084 — the extra triangles are
     * the carapace arch and the three-ellipsoid snout, which are the whole
     * silhouette argument, and they are free at the only place this is spent.
     *
     * EXACTLY ONE IS EVER IN THE WORLD. `Extraction._makeShip` adds the hull to
     * the scene rather than to `statics`, and there is one director; a wave can
     * put three GUNSHIPS in the sky and never a second transport. So this is a
     * flat cost paid once, which is why it can afford a bay at all.
     */
    const V = await import('../../src/game/Vehicles.js');
    const rep = cost(V.buildTransport({ side: 'republic', fresh: true }));
    const cis = cost(V.buildTransport({ side: 'separatist', fresh: true }));
    const capR = cost(V.buildCapitalShip({ side: 'republic', fresh: true }));
    const capC = cost(V.buildCapitalShip({ side: 'separatist', fresh: true }));
    assert(cis.meshes <= Math.ceil(rep.meshes * 1.25),
      `the Confederacy hull is ${cis.meshes} draw calls against the Republic hull's ${rep.meshes}`);
    assert(cis.tris <= rep.tris * 1.6,
      `${cis.tris} triangles against ${rep.tris} — this is the ship the player stands inside and it is `
      + 'already the most expensive one in the game');
    assert(capC.meshes <= Math.ceil(capR.meshes * 1.5),
      `the Confederacy warship is ${capC.meshes} draw calls against ${capR.meshes}`);
    /* A SECOND HULL IS A TRANSFORM, NOT A REBUILD. `Object3D.clone` shares
     * every geometry by reference, and `userData` is copied SHALLOW — so a
     * clone whose anchors were not re-resolved by name would light its engines
     * wherever the template happens to be. That is the trap `buildGunship`'s
     * own note records, and it is sprung the same way on this hull. */
    const a = V.buildTransport({ side: 'separatist' }), b = V.buildTransport({ side: 'separatist' });
    assert(a !== b, 'the builder handed back the same object twice');
    const ga = [], gb = [];
    a.traverse((o) => { if (o.isMesh) ga.push(o.geometry); });
    b.traverse((o) => { if (o.isMesh) gb.push(o.geometry); });
    const shared = ga.filter((g, i) => g === gb[i]).length;
    assert(shared === ga.length && ga.length > 6,
      `only ${shared} of ${ga.length} geometries are shared between two Confederacy hulls`);
    assert(b.userData.engines[0] && b.userData.engines[0] !== a.userData.engines[0],
      'the second hull carries the first hull\'s engine anchors — clone() copies userData shallow');
    assert(b.userData.ramp && b.userData.ramp !== a.userData.ramp, 'the same for the ramp');
    assert(b.getObjectByName('doorL') === b.userData.doorL, 'the doors were resolved off the wrong tree');
    return `transports ${rep.meshes}/${cis.meshes} draw calls and ${rep.tris}/${cis.tris} triangles; `
      + `warships ${capR.meshes}/${capC.meshes} and ${capR.tris}/${capC.tris}; one transport in the world at a time`;
  });
}
