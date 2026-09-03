/**
 * BATTLEFRONT BORZ — THE LIFT, driven.
 *
 * "right now you just teleport in the front of the hangar when you spawn in
 *  but I want a very short solo elevator ride … the elevator door opens and
 *  you have to actually walk out … (the elevator door closes and leaves)" and
 * "calling for an elevator and getting in the elevator and doing the ride
 *  takes you back to the main menu".
 *
 * Every clause of that is a state the car passes through, and every state is
 * driven here through the real World: the spawn is inside the car with the
 * doors SHUT (a player pressing forward goes nowhere), the shaft streams past
 * the panes for the ride, the doors part, he walks out on his own feet, the
 * doors close behind him, the call key at the doors brings the car back, he
 * steps in, the doors shut, and the ride out raises `onDeckLeave`. Nothing in
 * it is a teleport: his position is read every frame and the largest step it
 * takes is a walking step.
 *
 * And then the car itself, after "two of the walls are just a bare slab of
 * nothing … it doesn't even have doors when you're inside … you should be
 * seeing simulated stuff whizzing past you through the windows": a grid of
 * rays at every wall from the middle of the car has to hit several different
 * things at several different depths (a slab is one thing at one depth); the
 * four door leaves have to exist, part, and stand in the doorway when shut;
 * the shaft has to be several kinds of instanced element that advance by
 * `v·dt` between two frames; and none of it may be visible from the deck
 * except through the doorway.
 *
 * MATRICES. Headless, nothing renders, so nothing updates `matrixWorld` — a
 * leaf that slid two metres is still at the origin to a raycaster until
 * `scene.updateMatrixWorld(true)` is called. Every caster here calls it.
 */

import { DECK, LIFT } from '../../src/game/Hangar.js';
import { RIDE, STATE, DOOR, LEVEL, liftState, liftKey, atTheDoors } from '../../src/game/DeckLift.js';

async function deck() {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  return { world, idle: idleInput() };
}

function walk(idle, dir = 1) {
  return { ...idle, moveAxis: (o) => { if (o) { o.x = 0; o.y = dir; return o; } return { x: 0, y: dir }; } };
}

/** Everything drawn except the shaft's streaming scene and the car's glass. */
function solids(THREE, world, st, { keepPanes = false } = {}) {
  world.scene.updateMatrixWorld(true);
  const skip = new Set(st.scene.kinds.map((k) => k.mesh));
  if (!keepPanes) for (const p of st.panes) skip.add(p);
  const out = [];
  world.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !skip.has(o)) out.push(o); });
  return out;
}

/** Only the car and its leaves. */
function carMeshes(world, st) {
  world.scene.updateMatrixWorld(true);
  const out = [];
  st.car.traverse((o) => { if (o.isMesh || o.isInstancedMesh) out.push(o); });
  return out;
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { run: step } = await import('./_coop.mjs');
  const ray = new THREE.Raycaster();
  const cast = (list, from, to) => {
    const dir = to.clone().sub(from).normalize();
    ray.set(from, dir); ray.far = from.distanceTo(to) - 0.05;
    return ray.intersectObjects(list, false)[0] || null;
  };

  check('lift: you arrive inside the car with the doors shut, and the ride is a ride', async () => {
    const { world, idle } = await deck();
    try {
      const p = world.player;
      assert(liftState(world) === STATE.RIDE, `the deck opened in state ${liftState(world)}, not a ride`);
      /* INSIDE THE CAR. */
      assert(Math.abs(p.position.x - LIFT.x) < LIFT.halfW && p.position.z < LIFT.door && p.position.z > LIFT.z - LIFT.halfD,
        `the player spawned at (${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)}) — outside the car`);
      const st = world._deckLift;
      const deck0 = st.readout.number;
      /* THE DOORS HOLD HIM. Two seconds of forward against a shut door. */
      const z0 = p.position.z;
      step(world, 2.0, walk(idle));
      assert(p.position.z < LIFT.door + 0.3,
        `walked to z=${p.position.z.toFixed(2)} through a shut door at ${LIFT.door}`);
      /* THE SHAFT MOVES. The scene's scroll advances during the ride and the
       * speed reaches the cruising figure; THE CAR SWAYS while it does. */
      let peak = 0, sway = 0;
      step(world, RIDE.ride, idle, () => { peak = Math.max(peak, Math.abs(st.v)); sway = Math.max(sway, st.car.position.length()); });
      assert(peak > RIDE.speed * 0.9, `the shaft peaked at ${peak.toFixed(1)} m/s against a cruise of ${RIDE.speed}`);
      assert(sway > 0.008 && sway < 0.08, `the car swayed ${(sway * 100).toFixed(1)} cm at speed — wanted a few centimetres`);
      /* AND IT STOPS ON A LANDING: the scroll is a whole number of levels. */
      assert(liftState(world) !== STATE.RIDE, `after ${RIDE.ride}s of ride the car is still ${liftState(world)}`);
      const off = Math.abs(((st.scroll % LEVEL) + LEVEL) % LEVEL);
      assert(Math.min(off, LEVEL - off) < 0.02, `the car stopped ${off.toFixed(2)} m off a landing`);
      /* THEN THE DOORS PART. */
      step(world, 2.5, idle);
      assert(liftState(world) === STATE.OUT || liftState(world) === STATE.OPENING,
        `after the ride the car is ${liftState(world)}, not opening`);
      step(world, RIDE.doors + 0.2, idle);
      assert(st.open > 0.99, `the doors are ${(st.open * 100).toFixed(0)}% open after the ride`);
      assert(!st.doorBox, 'the doors are open and their collider is still in the world');
      /* THE READOUT COUNTED, and says where he is; the car is still. */
      assert(st.readout.number > deck0, `the readout went from ${deck0} to ${st.readout.number} — it did not count`);
      assert(st.readout.caption === 'FLIGHT DECK', `at the stop the readout says "${st.readout.caption}"`);
      assert(st.car.position.length() < 1e-3, `the stopped car is still ${(st.car.position.length() * 100).toFixed(1)} cm off its rest`);
      /* AND THE LEFT WINDOW LOOKS OUT ON PEOPLE: heads at pane height beside the car. */
      const heads = st.scene.kinds.find((k) => k.name === 'head').mesh;
      const m = new THREE.Matrix4();
      let standing = 0;
      for (let i = 0; i < heads.count; i++) {
        heads.getMatrixAt(i, m);
        const x = m.elements[12], y = m.elements[13], z = m.elements[14];
        if (x < LIFT.x - LIFT.halfW && Math.abs(y - 2.4) < 1.2 && Math.abs(z - LIFT.z) < LIFT.halfD) standing++;
      }
      assert(standing >= 2, `${standing} heads at the left window at the stop — the landing should be a lift landing with people waiting`);
      /* AND HE WALKS OUT, on his own feet, at a walking pace. */
      let biggest = 0, last = p.position.z;
      step(world, 3.0, walk(idle), () => { biggest = Math.max(biggest, Math.abs(p.position.z - last)); last = p.position.z; });
      assert(p.position.z > LIFT.door + 2, `three seconds of walking left him at z=${p.position.z.toFixed(1)}, still in the car`);
      assert(biggest < 0.25, `the largest step out of the car was ${biggest.toFixed(2)} m in one frame — a teleport`);
      assert(p.position.z > z0 + 4, 'he did not leave the car');
      /* THE DOORS CLOSE BEHIND HIM AND THE CAR GOES. */
      step(world, RIDE.linger + RIDE.doors + 0.5, idle);
      assert(liftState(world) === STATE.AWAY, `he is out and the car is ${liftState(world)}, not away`);
      assert(st.open < 0.01 && st.doorBox, 'the car left with its doors open');
      return `ride peaked at ${peak.toFixed(0)} m/s, swayed ${(sway * 100).toFixed(1)} cm, readout ${deck0}→${st.readout.number} FLIGHT DECK, `
        + `${standing} figures at the landing, walked out ${(p.position.z - z0).toFixed(1)} m, car gone`;
    } finally { world.unload(); }
  });

  check('lift: called from the doors, it comes back, and the ride out leaves the deck', async () => {
    const { world, idle } = await deck();
    try {
      const p = world.player;
      const st = world._deckLift;
      /* Skip to the car being away: ride, open, walk out, close. */
      step(world, RIDE.settle + RIDE.ride + 0.6 + RIDE.doors + 0.3, idle);
      step(world, 3.0, walk(idle));
      step(world, RIDE.linger + RIDE.doors + 0.5, idle);
      assert(liftState(world) === STATE.AWAY, `expected the car away, got ${liftState(world)}`);
      /* THE KEY DOES NOTHING FROM THE MIDDLE OF THE DECK. */
      const far = new THREE.Vector3(0, 0, DECK.line);
      p.position.copy(far); p.velocity.set(0, 0, 0);
      p.body?.setTransform?.(new THREE.Vector3(far.x, far.y + 0.9, far.z), null);
      assert(!atTheDoors(world) && !liftKey(world), 'the lift answered a call from the muster line');
      /* AT THE DOORS, IT CALLS THE CAR. */
      const near = new THREE.Vector3(0, 0, LIFT.door + 2.0);
      p.position.copy(near); p.velocity.set(0, 0, 0);
      p.body?.setTransform?.(new THREE.Vector3(near.x, near.y + 0.9, near.z), null);
      assert(atTheDoors(world), 'two metres from the doors is not "at the doors"');
      assert(liftKey(world), 'the call key at the doors was not taken');
      assert(liftState(world) === STATE.CALLED, `after the call the car is ${liftState(world)}`);
      step(world, RIDE.arrive + RIDE.doors + 0.3, idle);
      assert(liftState(world) === STATE.WAIT, `the called car is ${liftState(world)}, not waiting open`);
      assert(st.open > 0.99, 'the car arrived with its doors shut');
      assert(st.readout.caption === 'FLIGHT DECK', `the car came back reading "${st.readout.caption}"`);
      /* STEP IN, and the ride out raises the door to the menu. */
      let left = 0;
      world.onDeckLeave = () => { left++; };
      step(world, 3.0, walk(idle, -1));
      assert(p.position.z < LIFT.door - 0.2, `walking back put him at z=${p.position.z.toFixed(1)}, not in the car`);
      step(world, 0.8 + RIDE.doors + 0.3, idle);
      assert(liftState(world) === STATE.LEAVE || liftState(world) === STATE.GONE,
        `in the car the state is ${liftState(world)}, not leaving`);
      const n0 = st.readout.number;
      step(world, RIDE.settle + RIDE.ride, idle);
      assert(left === 1, `onDeckLeave fired ${left} times`);
      assert(liftState(world) === STATE.GONE, `after the ride out the car is ${liftState(world)}`);
      assert(st.readout.number !== n0, 'the readout did not count on the way out');
      return `called, arrived in ${RIDE.arrive}s, stepped in, rode out, onDeckLeave once`;
    } finally { world.unload(); }
  });

  check('lift: no wall of the car is bare — every wall is several things at several depths', async () => {
    /**
     * "two of the walls are just a bare slab of nothing". A grid of rays from
     * the middle of the car at each of its six surfaces; what comes back is
     * the set of NAMED meshes hit (one per material, so a name is a kind of
     * surface) and the set of depths they were hit at, to the centimetre. A
     * bare slab is one name at one depth. A wall with a dado, ribs, a rail,
     * a sill, posts and a recessed strip is five names at six depths.
     */
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const st = world._deckLift;
      const list = carMeshes(world, st);
      const C = new THREE.Vector3(LIFT.x, 1.7, LIFT.z);
      const hw = LIFT.halfW, hd = LIFT.halfD, H = LIFT.height, zA = LIFT.z - hd, zF = LIFT.door;
      const ys = [0.08, 0.4, 0.7, 0.98, 1.2, 1.8, 2.6, 3.3, 3.5, 3.62, 3.75, 3.95, 4.1];
      const walls = {
        left: { need: 4, pts: [], depth: (h) => h.point.x },
        right: { need: 4, pts: [], depth: (h) => h.point.x },
        back: { need: 4, pts: [], depth: (h) => h.point.z },
        front: { need: 3, pts: [], depth: (h) => h.point.z },
        ceiling: { need: 2, pts: [], depth: (h) => h.point.y },
        floor: { need: 2, pts: [], depth: (h) => h.point.y },
      };
      for (const y of ys) for (let z = zA + 0.2; z < zF - 0.2; z += 0.45) {
        walls.left.pts.push(new THREE.Vector3(LIFT.x - hw, y, z));
        walls.right.pts.push(new THREE.Vector3(LIFT.x + hw, y, z));
      }
      for (const y of ys) for (let x = -hw + 0.2; x < hw - 0.2; x += 0.4) {
        walls.back.pts.push(new THREE.Vector3(x, y, zA));
        if (y < DOOR.height + 0.6) walls.front.pts.push(new THREE.Vector3(x, y, zF));
      }
      for (let x = -hw + 0.3; x < hw - 0.3; x += 0.45) for (let z = zA + 0.3; z < zF - 0.3; z += 0.45) {
        walls.ceiling.pts.push(new THREE.Vector3(x, H, z));
        walls.floor.pts.push(new THREE.Vector3(x, 0, z));
      }
      const report = [];
      for (const [name, w] of Object.entries(walls)) {
        const names = new Set(), depths = new Set();
        let misses = 0;
        for (const pt of w.pts) {
          const to = pt.clone().sub(C).normalize().multiplyScalar(pt.distanceTo(C) + 0.6).add(C);
          const h = cast(list, C, to);
          if (!h) { misses++; continue; }
          names.add(h.object.name);
          depths.add(Math.round(w.depth(h) * 100));
        }
        assert(misses < w.pts.length * 0.05, `${misses} of ${w.pts.length} rays at the ${name} wall hit nothing of the car — a hole`);
        assert(names.size >= w.need, `the ${name} wall is ${names.size} kind(s) of surface (${[...names].join(', ')}) — wanted ${w.need}; a bare slab is one`);
        assert(depths.size >= w.need, `the ${name} wall is ${depths.size} depth(s) — flat; wanted relief at ${w.need}`);
        report.push(`${name} ${names.size}k/${depths.size}d`);
      }
      return report.join(', ');
    } finally { world.unload(); }
  });

  check('lift: two inner and two outer leaves stand in the doorway when shut, part together, and the collider goes with them', async () => {
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const st = world._deckLift;
      assert(st.doors.length === 2 && st.outerDoors.length === 2, `${st.doors.length} inner and ${st.outerDoors.length} outer leaves`);
      const leaves = [...st.doors, ...st.outerDoors];
      const shut = leaves.map((l) => Math.abs(l.position.x - LIFT.x));
      assert(shut.every((x) => x < DOOR.halfW / 2 + 0.1), `shut leaves at |x| = ${shut.map((x) => x.toFixed(2)).join(', ')} — not meeting at the seam`);
      assert(st.doorBox, 'the doors are shut and there is no collider between them');
      /* FROM INSIDE, THE DOORWAY IS A DOOR: a ray out of the car at head
       * height hits a leaf, and a ray at the frame's edge hits the reveal. */
      const C = new THREE.Vector3(LIFT.x, 1.6, LIFT.z);
      const list = carMeshes(world, st);
      const seam = cast(list, C, new THREE.Vector3(LIFT.x + 0.6, 1.6, LIFT.door + 2));
      assert(seam && /^car-door/.test(seam.object.name), `looking at the shut doors from inside hits ${seam?.object.name || 'nothing'}`);
      const edge = cast(list, C, new THREE.Vector3(LIFT.x + DOOR.halfW + 0.3, 1.6, LIFT.door - 0.85));
      assert(edge && edge.object.name === 'car-hull', `beside the doorway the ray hits ${edge?.object.name || 'nothing'}, not the reveal`);
      /* FROM THE DECK, A SHUT LIFT IS A DOOR IN A FRAME: the outer leaves
       * first, and just outside the opening the kit's own frame. */
      const all = solids(THREE, world, st);
      const outerHit = cast(all, new THREE.Vector3(LIFT.x - 0.5, 1.7, LIFT.door + 6), new THREE.Vector3(LIFT.x - 0.5, 1.7, LIFT.z));
      assert(outerHit && /^lift-outer/.test(outerHit.object.name), `from the deck the shut lift shows ${outerHit?.object.name || 'nothing'} first, not its outer doors`);
      const frameHit = cast(all, new THREE.Vector3(LIFT.x + DOOR.halfW + 0.15, 1.7, LIFT.door + 6), new THREE.Vector3(LIFT.x + DOOR.halfW + 0.15, 1.7, LIFT.z));
      assert(frameHit && /^deck-kit/.test(frameHit.object.name) && frameHit.point.z > LIFT.door,
        `the lobby's frame beside the opening is ${frameHit?.object.name || 'nothing'} at z=${frameHit?.point.z.toFixed(2)} — liftLobby and DOOR disagree on the opening`);
      /* THEY PART, ALL FOUR, and the doorway is clear. */
      step(world, RIDE.settle + RIDE.ride + 0.6 + RIDE.doors + 0.3, idle);
      assert(st.open > 0.99, `after the ride the doors are ${(st.open * 100).toFixed(0)}% open`);
      const open = leaves.map((l) => Math.abs(l.position.x - LIFT.x));
      assert(open.every((x) => x > DOOR.halfW + 0.9), `open leaves at |x| = ${open.map((x) => x.toFixed(2)).join(', ')} — still in the doorway`);
      assert(!st.doorBox, 'the doors are open and the collider is still there');
      const list2 = carMeshes(world, st);
      const clear = cast(list2, C, new THREE.Vector3(LIFT.x + 0.6, 1.6, LIFT.door + 2));
      assert(!clear, `with the doors open a ray out of the doorway hits ${clear?.object.name}`);
      return `4 leaves shut at |x|≈${shut[0].toFixed(2)}, open at |x|≈${open[0].toFixed(2)}; outer doors and frame read from the deck`;
    } finally { world.unload(); }
  });

  check('lift: the shaft is layers of instanced elements that stream past all three windows at v·dt', async () => {
    const { world, idle } = await deck();
    try {
      const st = world._deckLift;
      const kinds = st.scene.kinds.filter((k) => k.mesh.isInstancedMesh && k.slots.length > 0);
      assert(kinds.length >= 5, `${kinds.length} instanced kinds in the shaft — wanted at least 5`);
      const total = kinds.reduce((n, k) => n + k.mesh.count, 0);
      let draws = 0;
      st.shaft.traverse((o) => { if (o.isMesh || o.isInstancedMesh) draws++; });
      assert(draws <= 24, `${draws} draws for the shaft — it is meant to be a dozen instanced meshes and a few statics`);
      /* THREE WINDOWS: a lit plate of the far layer stands off each pane. */
      const m = new THREE.Matrix4();
      const slabs = kinds.find((k) => k.name === 'plate').mesh;
      let left = 0, right = 0, back = 0;
      for (let i = 0; i < slabs.count; i++) {
        slabs.getMatrixAt(i, m);
        const x = m.elements[12], z = m.elements[14];
        if (x < LIFT.x - LIFT.halfW - 2) left++;
        else if (x > LIFT.x + LIFT.halfW + 2) right++;
        else if (z < LIFT.z - LIFT.halfD - 0.3) back++;
      }
      assert(left >= 6 && right >= 6 && back >= 6, `deck levels: ${left} left, ${right} right, ${back} back — a window with nothing behind it`);
      /* THEY MOVE WITH THE CAR. At cruise, the plate nearest the window
       * drops by exactly v·dt in one frame. */
      step(world, RIDE.settle + 1.6, idle);
      assert(Math.abs(st.v) > RIDE.speed * 0.9, `not at cruise: v=${st.v.toFixed(1)}`);
      let best = -1, bestD = 1e9;
      for (let i = 0; i < slabs.count; i++) {
        slabs.getMatrixAt(i, m);
        const d = Math.abs(m.elements[13] - LIFT.height / 2);
        if (m.elements[12] > LIFT.x + LIFT.halfW && d < bestD) { bestD = d; best = i; }
      }
      slabs.getMatrixAt(best, m);
      const y1 = m.elements[13];
      world.update(1 / 60, idle);
      slabs.getMatrixAt(best, m);
      const dy = m.elements[13] - y1;
      const want = -st.v / 60;
      assert(Math.abs(dy - want) < 0.02, `the plate moved ${dy.toFixed(3)} m in a frame against v·dt = ${want.toFixed(3)}`);
      /* And the light bars are still the check's old handle. */
      assert(st.bars?.isInstancedMesh && st.bars.count >= 60, 'the light bars are gone');
      return `${kinds.length} kinds, ${total} instances, ${draws} draws; levels L${left}/R${right}/B${back}; plate moved ${dy.toFixed(3)} m at v·dt=${want.toFixed(3)}`;
    } finally { world.unload(); }
  });

  check('lift: nothing on the deck can see into the shaft, and the car sees it only through its panes', async () => {
    /**
     * THE SHAFT IS DRAWN INSIDE THE BULKHEAD. From the deck, a ray at any
     * element of it must hit a leaf, the car's wall, or the bulkhead first;
     * from inside the car, the elements are reachable only through a pane.
     * With the doors OPEN the doorway itself is the one way in, so a ray
     * that reaches the shaft then must have passed through the opening.
     * Rays, because a bounding box cannot say what is in front of what.
     */
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const st = world._deckLift;
      const targets = {
        'left bar': new THREE.Vector3(LIFT.x - LIFT.halfW - 0.85, 2.2, LIFT.z - 0.5),
        'right bar': new THREE.Vector3(LIFT.x + LIFT.halfW + 0.85, 2.2, LIFT.z - 0.5),
        'right corridor': new THREE.Vector3(LIFT.x + LIFT.halfW + 4.3, 2.2, LIFT.z + 0.6),
        'back wall': new THREE.Vector3(LIFT.x + 1.2, 2.2, LIFT.z - LIFT.halfD - 0.9),
      };
      const stations = [
        new THREE.Vector3(0, 1.7, LIFT.door + 6), new THREE.Vector3(12, 1.7, LIFT.door + 4),
        new THREE.Vector3(-12, 1.7, LIFT.door + 10), new THREE.Vector3(30, 1.7, -60),
        new THREE.Vector3(0, 30, -40), new THREE.Vector3(-6, 1.7, LIFT.door + 1.5),
      ];
      const shutList = solids(THREE, world, st);
      let leaks = [];
      for (const [name, tgt] of Object.entries(targets)) for (const from of stations) {
        if (!cast(shutList, from, tgt)) leaks.push(`${name} from (${from.x},${from.y},${from.z})`);
      }
      assert(leaks.length === 0, `${leaks.length} of ${stations.length * 4} lines of sight from the deck reach the shaft with the doors shut: ${leaks.join('; ')}`);
      /* From the middle of the car, every target IS reachable — through a pane. */
      const inside = new THREE.Vector3(LIFT.x, 1.7, LIFT.z);
      for (const [name, tgt] of Object.entries(targets)) {
        const h = cast(shutList, inside, tgt);
        assert(!h, `from inside the car the ${name} is hidden behind ${h?.object.name} — the window shows nothing`);
      }
      /* DOORS OPEN: only through the doorway. */
      step(world, RIDE.settle + RIDE.ride + 0.6 + RIDE.doors + 0.3, idle);
      assert(st.open > 0.99, 'the doors did not open');
      const openList = solids(THREE, world, st);
      leaks = [];
      let viaDoor = 0;
      for (const [name, tgt] of Object.entries(targets)) for (const from of stations) {
        if (cast(openList, from, tgt)) continue;
        /* Where does this ray cross the lobby face? Inside the opening, or not. */
        const t = (LIFT.door - from.z) / (tgt.z - from.z);
        const x = from.x + (tgt.x - from.x) * t, y = from.y + (tgt.y - from.y) * t;
        if (Math.abs(x - LIFT.x) < DOOR.halfW && y < DOOR.height) viaDoor++;
        else leaks.push(`${name} from (${from.x},${from.y},${from.z}) crossing the face at x=${x.toFixed(1)} y=${y.toFixed(1)}`);
      }
      assert(leaks.length === 0, `with the doors open, ${leaks.length} sightlines reach the shaft other than through the doorway: ${leaks.join('; ')}`);
      return `shaft hidden from ${stations.length} deck stations at 4 targets with the doors shut; open, ${viaDoor} sightlines and all through the doorway; all 4 visible from the car`;
    } finally { world.unload(); }
  });

  check('lift: the strip is dozens of distinct authored vignettes, longer than both rides, and nothing repeats on the way in', async () => {
    /**
     * "when you're using the elevator you still don't see imagined scenes
     * from the rest of the station/ship you only see machinery buzzing by …
     * imagine passing dozens and dozens of levels all unique". The far
     * strip is authored per level per face from a list of vignettes; the
     * list is at least forty long, the strip covers the ride in plus the
     * ride out, and on any one face the levels the ride in passes are all
     * different (the bulkhead crossing excepted — a bulkhead every eight
     * decks is the ship's structure, and its number changes).
     */
    const { world } = await deck();
    try {
      const st = world._deckLift;
      const sc = st.scene;
      assert(sc.vignettes.length >= 40, `${sc.vignettes.length} vignettes authored — wanted at least 40`);
      assert(new Set(sc.vignettes).size === sc.vignettes.length, 'two vignettes share a name');
      const lay = st.layout;
      const stripLen = (lay.hi - lay.lo + 1) * LEVEL;
      assert(stripLen > st.rideLen + st.leaveLen,
        `the far strip is ${stripLen} m for a ride in of ${st.rideLen} m and a ride out of ${st.leaveLen.toFixed(0)} m — it would have to repeat`);
      /* NO WRAP on the far layer: every plate is an unwrapped slot. */
      const plates = sc.kindOf.plate.slots;
      assert(plates.length > 0 && plates.every((o) => !o.wrap), 'a far-layer plate wraps');
      /* The ride in, per face: from the level in the window at the start to the landing. */
      const report = [];
      for (let fi = 0; fi < 3; fi++) {
        const names = sc.perFace[fi];
        const seen = names.slice(0 - lay.lo, lay.landing - lay.lo + 1);
        const dup = seen.filter((n, i) => n !== 'bulkhead' && seen.indexOf(n) !== i);
        assert(dup.length === 0, `face ${fi} shows ${dup.join(', ')} twice on the ride in`);
        const distinct = new Set(names).size;
        assert(distinct >= 40, `face ${fi} lays only ${distinct} distinct vignettes over its ${names.length} levels`);
        report.push(`face ${fi}: ${seen.length} levels in, ${distinct} distinct over ${names.length}`);
      }
      /* The three faces do not agree at any level of the ride in. */
      let same = 0;
      for (let lev = 0; lev <= lay.landing; lev++) {
        const i = lev - lay.lo;
        const a = sc.perFace[0][i], b = sc.perFace[1][i], c = sc.perFace[2][i];
        if (a !== 'bulkhead' && (a === b || a === c || b === c)) same++;
      }
      assert(same <= 2, `${same} levels of the ride in show the same vignette in two windows at once`);
      return `${sc.vignettes.length} vignettes; strip ${stripLen} m vs ${st.rideLen}+${st.leaveLen.toFixed(0)} m; ${report.join('; ')}`;
    } finally { world.unload(); }
  });

  check('lift: the people in the shaft have heads, bodies and limbs; the scene keeps moving when the car is still; and it is still nine draws', async () => {
    const { world, idle } = await deck();
    try {
      const st = world._deckLift;
      const K = st.scene.kindOf;
      const heads = K.head.slots.length, parts = K.figure.slots.length;
      assert(heads >= 100, `${heads} heads in the whole strip — the ship is empty`);
      assert(parts >= heads * 3, `${parts} body parts for ${heads} heads — a figure is a torso, legs and arms, not a box`);
      /* Coloured: the plates carry more than a handful of distinct hues. */
      const hues = new Set(K.plate.slots.map((o) => o.col));
      assert(hues.size >= 30, `${hues.size} plate colours across the strip — wanted a palette, got a tint`);
      /* Animated slots exist in several kinds. */
      const animated = st.scene.kinds.filter((k) => k.anims.length > 0).length;
      assert(animated >= 4, `${animated} kinds carry animated slots`);
      /* THE BUDGET: one mesh per kind and the statics. */
      let draws = 0;
      st.shaft.traverse((o) => { if (o.isMesh || o.isInstancedMesh) draws++; });
      const instanced = st.scene.kinds.length;
      assert(instanced <= 10, `${instanced} instanced kinds — the strip is meant to be nine`);
      assert(draws <= 16, `${draws} draws for the whole shaft — wanted nine kinds and a few statics`);
      /* AT THE STOP, WITH THE DOORS OPEN, THE FANS STILL TURN: some
       * animated instance's matrix changes between two still frames. */
      step(world, RIDE.settle + RIDE.ride + 0.6 + RIDE.doors + 0.3, idle);
      assert(liftState(world) === STATE.OUT, `expected the car open and still, got ${liftState(world)}`);
      const s0 = st.scroll;
      const fan = K.fan.mesh;
      const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
      /* Any fan on the strip at all — collapsed ones read as zero, skip those. */
      let idx = -1;
      for (let i = 0; i < fan.count; i++) { fan.getMatrixAt(i, m0); if (m0.elements[0] !== 0 || m0.elements[1] !== 0 || m0.elements[2] !== 0) { idx = i; break; } }
      assert(idx >= 0, 'no fan is laid anywhere in the box while the car stands');
      fan.getMatrixAt(idx, m0);
      step(world, 0.3, idle);
      assert(st.scroll === s0, 'the scene scrolled while the car stood open');
      fan.getMatrixAt(idx, m1);
      let moved = 0;
      for (let i = 0; i < 16; i++) moved = Math.max(moved, Math.abs(m0.elements[i] - m1.elements[i]));
      assert(moved > 1e-3, 'a fan did not turn over 0.3 s with the car standing still');
      return `${heads} heads, ${parts} parts, ${hues.size} plate colours, ${animated} animated kinds, ${instanced} kinds / ${draws} draws; a fan turned ${moved.toFixed(2)} while still`;
    } finally { world.unload(); }
  });
}
