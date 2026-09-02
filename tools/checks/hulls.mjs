/**
 * BATTLEFRONT BORZ — THE FOUR HULLS, HELD TO THE GEOMETRY.
 *
 * ── THE NOTE THIS FILE ANSWERS ────────────────────────────────────────────
 *
 * The player, on the transport:
 *
 *   "it still looks like it's made of paper mache and barely held together…
 *    Nothing is connected, there are no pilots, no real functioning seat…
 *    it needs to be way more detailed and put together inside and out."
 *
 * and on the warship:
 *
 *   "all I see is a large rectangle getting smaller and smaller… the actual
 *    size of the ship should DWARF the size of the force field entrance, this
 *    ship should be massive and it should be just one hangar of many."
 *
 * `tools/checks/transports.mjs` holds the two transports APART and holds
 * their contract to each other; it does not ask whether either is a ship.
 * This file asks that, of all four hulls, in the forms a bounding box cannot
 * fake:
 *
 *   THE SEAT IS A SEAT. Every sitting place in `userData.seats` has geometry
 *     directly under it — a pan within a hand's breadth below the point the
 *     director sits a body at. A table that says "here" over a floor with
 *     nothing at "here" is the defect quoted.
 *   THE WALL IS A WALL, AND THE DOOR IS A DOOR. Rays are cast from inside the
 *     bay out through the flank at stations along its length. Fore and aft
 *     of the door they must hit hull within arm's reach, doors shut or open;
 *     at the door they must hit the door shut and NOTHING open. That is
 *     "nothing is connected" and "you should be able to see through it" as
 *     one instrument.
 *   THE CREW IS VISIBLE. Both pilots' boxes overlap the transparent canopy's,
 *     which is where a pilot has to be to be seen at all.
 *   THE WARSHIP IS THE SIZE IT SAYS, and has bays. `length` in metres,
 *     `scale` in units per metre, the built box within a tenth of their
 *     product; at least two `hangars`, each a unit normal on a point that is
 *     ON the hull (a ray along the normal from outside hits it), the first
 *     one facing away from the hull's centre with a mouth bigger than the
 *     deck's transport.
 *   THE COST IS BOUNDED, in triangles, because these are seen close: the
 *     transports under 40,000, the warships under 80,000, nothing NaN.
 */

import * as THREE from 'three';

function stats(g) {
  let meshes = 0, tris = 0, nan = 0;
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) nan++;
    tris += (o.geometry.index ? o.geometry.index.count : p.count) / 3;
  });
  return { meshes, tris: Math.round(tris), nan };
}

/** Every opaque mesh of a hull (the canopy is what you look THROUGH). */
function opaque(g) {
  const out = [];
  g.traverse((o) => { if (o.isMesh && !o.material.transparent) out.push(o); });
  return out;
}

const _ray = new THREE.Raycaster();
function hit(meshes, from, dir, far) {
  _ray.set(from, dir.clone().normalize());
  _ray.far = far;
  const h = _ray.intersectObjects(meshes, false);
  return h.length ? h[0].distance : null;
}

export async function run({ check, assert }) {
  const V = await import('../../src/game/Vehicles.js');
  const SIDES = ['republic', 'separatist'];

  check('hulls: both transports publish the contract the directors drive', () => {
    const out = [];
    for (const side of SIDES) {
      const g = V.buildTransport({ side, fresh: true });
      const u = g.userData;
      for (const key of ['engines', 'lamp', 'ramp', 'doorL', 'doorR', 'bay', 'seats', 'span', 'length', 'height', 'side']) {
        assert(u[key] != null, `${side}: publishes no ${key}`);
      }
      assert(u.side === side, `${side}: says it is the ${u.side} hull`);
      assert(u.engines.length >= 4 && u.engines.every((e) => e.position.z > 0), `${side}: engine anchors — need four, all astern`);
      assert(u.lamp.position.z < 0, `${side}: the landing lamp is not at the nose`);
      for (const key of ['ramp', 'doorL', 'doorR']) assert(u[key].isObject3D && u[key].name === key, `${side}: ${key} is not a named node`);
      const b = u.bay;
      assert(b.halfW * 2 >= 2.2 && b.roof - b.floor >= 1.9 && b.back > b.front, `${side}: the bay is ${JSON.stringify(b)}`);
      assert(Math.abs(b.floor + 0.95) < 0.06, `${side}: the bay floor is at ${b.floor} — _hatch and hullFloorAt hinge the ramp off -0.95`);
      assert(u.seats.length >= 8 && u.seats.some((s) => s.sit) && u.seats.some((s) => !s.sit), `${side}: ${u.seats.length} seats, one kind`);
      const s = new THREE.Vector3();
      new THREE.Box3().setFromObject(g).getSize(s);
      assert(Math.abs(u.span - s.x) < 0.01 && Math.abs(u.length - s.z) < 0.01 && Math.abs(u.height - s.y) < 0.01,
        `${side}: publishes ${u.span.toFixed(2)} x ${u.length.toFixed(2)} x ${u.height.toFixed(2)} and measures ${s.x.toFixed(2)} x ${s.z.toFixed(2)} x ${s.y.toFixed(2)}`);
      const ramp = new THREE.Vector3();
      new THREE.Box3().setFromObject(u.ramp).getSize(ramp);
      assert(Math.abs(ramp.z - 2.6) < 0.12, `${side}: the ramp leaf is ${ramp.z.toFixed(2)} m against the 2.6 both directors walk`);
      out.push(`${side} ${s.x.toFixed(1)}x${s.y.toFixed(1)}x${s.z.toFixed(1)} m, ${u.seats.length} seats, ${u.engines.length} nozzles`);
    }
    return out.join(' · ');
  });

  check('hulls: every seat sits inside the bay, on a pan', () => {
    const out = [];
    for (const side of SIDES) {
      const g = V.buildTransport({ side, fresh: true });
      const { bay, seats } = g.userData;
      const meshes = opaque(g);
      let pans = 0;
      for (const s of seats) {
        assert(Math.abs(s.x) <= bay.halfW && s.z >= bay.front && s.z <= bay.back && s.y >= bay.floor - 0.01 && s.y <= bay.roof,
          `${side}: a ${s.sit ? 'sitting' : 'standing'} place at (${s.x}, ${s.y}, ${s.z}) is outside the bay ${JSON.stringify(bay)}`);
        /* what is under the point the director sits a body at — a pan for a
         * seat, the deck for a standing place, and in both cases within reach */
        const d = hit(meshes, new THREE.Vector3(s.x, s.y + 0.05, s.z), new THREE.Vector3(0, -1, 0), 1.0);
        assert(d != null, `${side}: nothing at all under the place at (${s.x}, ${s.y}, ${s.z})`);
        if (s.sit) {
          assert(d <= 0.22, `${side}: the seat at z ${s.z} is ${(d - 0.05).toFixed(2)} m above what is under it — a body sits in the air`);
          pans++;
        } else {
          assert(d <= 0.12, `${side}: the standing place at z ${s.z} floats ${(d - 0.05).toFixed(2)} m over the deck`);
        }
      }
      out.push(`${side}: ${pans} pans under ${pans} seats, ${seats.length - pans} standing on the deck`);
    }
    return out.join(' · ');
  });

  check('hulls: the wall is a wall and the door is a door', () => {
    /**
     * Rays out through the flank from the bay's centreline at mid height,
     * every 30 cm from the bulkhead to the aft frame. Where a wall should be,
     * with the doors shut and with them open, a ray hits hull within arm's
     * reach of the wall line; where the door is, shut it hits the door and
     * OPEN it hits nothing for a metre past the wall — which is the aperture
     * being empty, "you should be able to see through it".
     */
    const out = [];
    for (const side of SIDES) {
      const g = V.buildTransport({ side, fresh: true });
      const u = g.userData, bay = u.bay;
      const doors = [u.doorL, u.doorR];
      const doorBox = new THREE.Box3().setFromObject(u.doorL);
      const zs = [];
      for (let z = bay.front + 0.25; z < bay.back - 0.15; z += 0.30) zs.push(+z.toFixed(2));
      /* From chest height, half a metre inboard of the wall line — above the
       * seat backs and below the conduit run, so what a ray meets is the
       * hull and not the furniture. `reach` is measured from the wall line. */
      const y = bay.floor + 1.45, x0 = bay.halfW - 0.50;
      const reach = 0.50 + 0.55;
      const result = { wall: 0, door: 0, open: 0 };
      for (const slide of [0, 2.0]) {
        for (const d of doors) d.position.z = slide;
        g.updateMatrixWorld(true);
        const meshes = opaque(g);
        for (const sx of [1, -1]) {
          for (const z of zs) {
            const atDoor = z > doorBox.min.z + 0.12 && z < doorBox.max.z - 0.12;
            const onWall = z < doorBox.min.z - 0.12 || z > doorBox.max.z + 0.12;
            if (!atDoor && !onWall) continue;   // the jamb's own width
            const d = hit(meshes, new THREE.Vector3(sx * x0, y, z), new THREE.Vector3(sx, 0, 0), reach + 1.0);
            if (onWall) {
              assert(d != null && d <= reach,
                `${side}: with the doors ${slide ? 'open' : 'shut'}, a ray out of the bay at z ${z} `
                + `${d == null ? 'hits nothing' : `first hits something ${d.toFixed(2)} m out`} — the wall is open there`);
              result.wall++;
            } else if (!slide) {
              assert(d != null && d <= reach, `${side}: with the doors shut, the aperture at z ${z} is open on the ${sx > 0 ? 'port' : 'starboard'} side`);
              result.door++;
            } else {
              assert(d == null, `${side}: with the doors open, a ray through the aperture at z ${z} hits something ${d?.toFixed(2)} m out`);
              result.open++;
            }
          }
        }
      }
      for (const d of doors) d.position.z = 0;
      out.push(`${side}: ${result.wall} wall stations solid, ${result.door} door stations shut, ${result.open} open`);
    }
    return out.join(' · ');
  });

  check('hulls: the crew sits in the canopy, and the Republic gunners in their bubbles', () => {
    const out = [];
    for (const side of SIDES) {
      const g = V.buildTransport({ side, fresh: true });
      g.updateMatrixWorld(true);
      const panes = [];
      g.traverse((o) => { if (o.isMesh && o.material.transparent) panes.push(o); });
      assert(panes.length, `${side}: no transparent canopy on the ship — nothing to see the pilots through`);
      const glass = new THREE.Box3();
      for (const p of panes) glass.union(new THREE.Box3().setFromObject(p));
      for (const name of ['pilotL', 'pilotR']) {
        const p = g.getObjectByName(name);
        assert(p, `${side}: no ${name}`);
        const b = new THREE.Box3().setFromObject(p);
        assert(glass.intersectsBox(b), `${side}: ${name} sits at y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}, outside the glass`);
        /* AND HIS HEAD IS NOT INSIDE THE OPAQUE HULL: a ray straight down from
         * above the ship must reach his helmet through the canopy, not through
         * a plate. */
        const top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 3, (b.min.z + b.max.z) / 2);
        const own = new Set(); p.traverse((o) => own.add(o));
        const d = hit(opaque(g).filter((o) => !own.has(o)), top, new THREE.Vector3(0, -1, 0), 3.0 + 0.10);
        assert(d == null, `${side}: ${name}'s head is under opaque hull — he cannot be seen`);
      }
      if (side === 'republic') {
        for (const name of ['gunnerL', 'gunnerR']) {
          const p = g.getObjectByName(name);
          assert(p, `no ${name} — the forward bubble turrets are empty`);
          assert(glass.intersectsBox(new THREE.Box3().setFromObject(p)), `${name} is not in a bubble`);
        }
      }
      out.push(`${side}: ${panes.length} pane mesh(es), pilots inside`);
    }
    return out.join(' · ');
  });

  check('hulls: each warship says how long it is, and is, and has bays', () => {
    const out = [];
    for (const side of SIDES) {
      const g = V.buildCapitalShip({ side, fresh: true });
      const u = g.userData;
      assert(u.side === side, `${side}: says it is the ${u.side} hull`);
      assert(u.length > 300 && u.scale > 0, `${side}: publishes length ${u.length} and scale ${u.scale}`);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g), s = new THREE.Vector3();
      box.getSize(s);
      const said = u.length * u.scale, built = Math.max(s.x, s.z);
      assert(Math.abs(built - said) / said < 0.10, `${side}: says ${u.length} m and is built ${(built / u.scale).toFixed(0)} m`);
      assert(Array.isArray(u.hangars) && u.hangars.length >= 2, `${side}: ${u.hangars?.length ?? 0} hangar(s) — "one hangar of many"`);
      const meshes = opaque(g);
      const centre = box.getCenter(new THREE.Vector3());
      u.hangars.forEach((h, i) => {
        const p = new THREE.Vector3(...h.pos), n = new THREE.Vector3(...h.normal);
        assert(p.toArray().every(Number.isFinite) && Math.abs(n.length() - 1) < 1e-3, `${side}: hangar ${i} is not a point and a unit normal`);
        assert(box.containsPoint(p), `${side}: hangar ${i} is off the hull`);
        /* ON the surface: from a metre out along the normal, the ray back in
         * meets the hull within that metre and a little — the rim itself. */
        const d = hit(meshes, p.clone().addScaledVector(n, 1.0), n.clone().negate(), 1.2);
        assert(d != null && d <= 1.05, `${side}: hangar ${i} at ${h.pos.map((x) => x.toFixed(2))} is not on the hull's surface`);
        assert(h.size && h.size[0] >= 0.30 && h.size[1] >= 0.20, `${side}: hangar ${i} is ${h.size} — too small for a transport`);
      });
      const h0 = u.hangars[0];
      const p0 = new THREE.Vector3(...h0.pos), n0 = new THREE.Vector3(...h0.normal);
      assert(p0.clone().sub(centre).dot(n0) > 0, `${side}: the deck's own hangar faces INTO the ship`);
      assert(h0.size[0] >= 1.0 && h0.size[1] >= 0.6, `${side}: the deck's hangar mouth is ${h0.size} — 100 m by 60 m is the floor`);
      out.push(`${side}: ${u.length} m, ${u.hangars.length} bays, the deck's ${(h0.size[0] / u.scale).toFixed(0)}x${(h0.size[1] / u.scale).toFixed(0)} m`);
    }
    return out.join(' · ');
  });

  check('hulls: the cost is bounded and nothing is NaN', () => {
    const out = [];
    for (const side of SIDES) {
      const t = stats(V.buildTransport({ side, fresh: true }));
      const c = stats(V.buildCapitalShip({ side, fresh: true }));
      assert(!t.nan && !c.nan, `${side}: ${t.nan + c.nan} non-finite vertex components`);
      assert(t.tris >= 6000, `${side}: the transport is ${t.tris} triangles — that is the paper-mache one`);
      assert(t.tris < 40000, `${side}: the transport is ${t.tris} triangles, seen from a metre — the bar is 40,000`);
      assert(c.tris >= 4000, `${side}: the warship is ${c.tris} triangles — a rectangle`);
      assert(c.tris < 80000, `${side}: the warship is ${c.tris} triangles — the bar is 80,000`);
      out.push(`${side}: transport ${t.tris} tris / ${t.meshes} draws, warship ${c.tris} / ${c.meshes}`);
    }
    return out.join(' · ');
  });
}
