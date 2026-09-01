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
 */

import { DECK, LIFT } from '../../src/game/Hangar.js';
import { RIDE, STATE, liftState, liftKey, atTheDoors } from '../../src/game/DeckLift.js';

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

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { run: step } = await import('./_coop.mjs');

  check('lift: you arrive inside the car with the doors shut, and the ride is a ride', async () => {
    const { world, idle } = await deck();
    try {
      const p = world.player;
      assert(liftState(world) === STATE.RIDE, `the deck opened in state ${liftState(world)}, not a ride`);
      /* INSIDE THE CAR. */
      assert(Math.abs(p.position.x - LIFT.x) < LIFT.halfW && p.position.z < LIFT.door && p.position.z > LIFT.z - LIFT.halfD,
        `the player spawned at (${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)}) — outside the car`);
      /* THE DOORS HOLD HIM. Two seconds of forward against a shut door. */
      const z0 = p.position.z;
      step(world, 2.0, walk(idle));
      assert(p.position.z < LIFT.door + 0.3,
        `walked to z=${p.position.z.toFixed(2)} through a shut door at ${LIFT.door}`);
      /* THE SHAFT MOVES. The bars' scroll advances during the ride and the
       * speed reaches the cruising figure. */
      const st = world._deckLift;
      let peak = 0;
      step(world, RIDE.ride, idle, () => { peak = Math.max(peak, Math.abs(st.v)); });
      assert(peak > RIDE.speed * 0.9, `the shaft peaked at ${peak.toFixed(1)} m/s against a cruise of ${RIDE.speed}`);
      /* THEN THE DOORS PART. */
      step(world, 2.5, idle);
      assert(liftState(world) === STATE.OUT || liftState(world) === STATE.OPENING,
        `after the ride the car is ${liftState(world)}, not opening`);
      step(world, RIDE.doors + 0.2, idle);
      assert(st.open > 0.99, `the doors are ${(st.open * 100).toFixed(0)}% open after the ride`);
      assert(!st.doorBox, 'the doors are open and their collider is still in the world');
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
      return `ride peaked at ${peak.toFixed(0)} m/s, doors opened, walked out ${(p.position.z - z0).toFixed(1)} m, car gone`;
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
      /* STEP IN, and the ride out raises the door to the menu. */
      let left = 0;
      world.onDeckLeave = () => { left++; };
      step(world, 3.0, walk(idle, -1));
      assert(p.position.z < LIFT.door - 0.2, `walking back put him at z=${p.position.z.toFixed(1)}, not in the car`);
      step(world, 0.8 + RIDE.doors + 0.3, idle);
      assert(liftState(world) === STATE.LEAVE || liftState(world) === STATE.GONE,
        `in the car the state is ${liftState(world)}, not leaving`);
      step(world, RIDE.settle + RIDE.ride, idle);
      assert(left === 1, `onDeckLeave fired ${left} times`);
      assert(liftState(world) === STATE.GONE, `after the ride out the car is ${liftState(world)}`);
      return `called, arrived in ${RIDE.arrive}s, stepped in, rode out, onDeckLeave once`;
    } finally { world.unload(); }
  });

  check('lift: nothing on the deck can see into the shaft, and the car sees only through its panes', async () => {
    /**
     * THE SHAFT IS DRAWN INSIDE THE BULKHEAD. From the deck, a ray at any
     * bar must hit the car's wall, a door, or the bulkhead first; from inside
     * the car, the bars are reachable only through a pane. Rays, because a
     * bounding box cannot say what is in front of what.
     */
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const st = world._deckLift;
      const ray = new THREE.Raycaster();
      const solid = [];
      world.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (o === st.bars || st.panes.includes(o)) return;
        solid.push(o);
      });
      const bar = new THREE.Vector3(LIFT.x + LIFT.halfW + 1.2, 2.2, LIFT.z);
      let leaks = 0;
      for (const from of [
        new THREE.Vector3(0, 1.7, LIFT.door + 6), new THREE.Vector3(12, 1.7, LIFT.door + 4),
        new THREE.Vector3(-12, 1.7, LIFT.door + 10), new THREE.Vector3(30, 1.7, -60),
        new THREE.Vector3(0, 30, -40),
      ]) {
        const dir = bar.clone().sub(from).normalize();
        ray.set(from, dir); ray.far = from.distanceTo(bar) - 0.05;
        const hit = ray.intersectObjects(solid, true);
        if (!hit.length) leaks++;
      }
      assert(leaks === 0, `${leaks} of 5 lines of sight from the deck reach a shaft bar with nothing in the way`);
      /* From the middle of the car, the same bar IS reachable — through the pane. */
      const inside = new THREE.Vector3(LIFT.x, 1.7, LIFT.z);
      const dir = bar.clone().sub(inside).normalize();
      ray.set(inside, dir); ray.far = inside.distanceTo(bar) - 0.05;
      const blocked = ray.intersectObjects(solid, true).length;
      assert(blocked === 0, 'from inside the car the shaft is hidden — the window shows nothing');
      return 'shaft hidden from 5 deck stations, visible through the pane from the car';
    } finally { world.unload(); }
  });
}
