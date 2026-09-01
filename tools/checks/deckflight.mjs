/**
 * BATTLEFRONT BORZ — THE FLIGHT, driven: boarding the transport on the deck,
 * flying out through the field, and coming home to it.
 *
 * "this is where you board a ship and start any match with or without troops
 *  (you board, fly out through the same force field you see in the hangar …
 *  when you retreat/finish a mode/match you will board a ship, leave the
 *  atmosphere and do all that in reverse and land in the hanger."
 *
 * The departure is driven through the real doors: the wheel's own adapter
 * calls the company in, the player is stood on the ramp's apron for the
 * dwell, the company walks up the ramp and is taken aboard, the player walks
 * into the bay and is seated, the ramp comes up, the hull lifts, runs out
 * through the aperture and raises `onDeckDeploy` in vacuum. The arrival is
 * the same director the other way: a world built with `deckArrival` starts
 * with the hull far out and everybody aboard, lands it, and raises
 * `onDeckArrived` with the player off the ramp and the men walking back into
 * the crowd.
 */

import { DECK, DEPLOY_RAMP } from '../../src/game/Hangar.js';
import { FLIGHT, PHASE, flightPhase, rampFoot, inBay } from '../../src/game/DeckFlight.js';

async function deck(extra = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0, ...extra },
  });
  return { world, idle: idleInput() };
}

function put(p, THREE, x, z) {
  p.position.set(x, 0, z); p.velocity.set(0, 0, 0);
  p.body?.setTransform?.(new THREE.Vector3(x, 0.9, z), null);
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { run: step } = await import('./_coop.mjs');

  check('flight: the real transport stands on the pad, ramp down, and you cannot walk through it', async () => {
    const { world, idle } = await deck();
    try {
      step(world, 0.2, idle);
      const st = world._deckFlight;
      assert(st && st.group?.parent, 'no transport on the deck');
      assert(flightPhase(world) === PHASE.PARKED, `the hull is ${flightPhase(world)}, not parked`);
      const d = Math.hypot(st.group.position.x - DEPLOY_RAMP.x, st.group.position.z - DEPLOY_RAMP.padZ);
      assert(d < 0.5, `the hull stands ${d.toFixed(1)} m off its pad`);
      assert(st.open > 0.99, 'the parked hull has its ramp up');
      assert(st.solids.length >= 5, `${st.solids.length} colliders on a parked hull — the player walks through it`);
      /* The ramp's foot is on the pad, walkable: within a step of the pad's top. */
      const foot = rampFoot(world);
      assert(Math.abs(foot.y - FLIGHT.padHeight) < 0.01, `the ramp's foot is at y=${foot.y.toFixed(2)}`);
      assert(FLIGHT.padHeight <= 0.45, `the pad is ${FLIGHT.padHeight} m proud — over the 0.45 m step`);
      /* THE HULL IS THE ARMY'S: a Republic deck stands a Republic hull. */
      assert(st.model?.userData?.side === (world._deckFaction === 'separatist' ? 'separatist' : 'republic'),
        `a ${world._deckFaction} deck stands a ${st.model?.userData?.side} hull`);
      return `hull on the pad, ${st.solids.length} colliders, ramp foot at y=${foot.y.toFixed(2)} on a ${FLIGHT.padHeight} m pad`;
    } finally { world.unload(); }
  });

  check('flight: the dwell boards the company up the ramp and the player into the bay, and the hull leaves through the field', async () => {
    const { world, idle } = await deck();
    try {
      const p = world.player;
      const c = world._company;
      assert(c && c.men.length >= 6, `${c?.men?.length ?? 0} men on the deck`);
      /* Out of the lift, and the company called. */
      step(world, 8, idle);
      assert(world.orders.order('fallin'), 'the fall-in was refused');
      step(world, 20, idle);
      const onLine = c.men.filter((r) => Math.abs(r.pos.z - DECK.line) < 4).length;
      assert(onLine >= c.men.length - 1, `${onLine} of ${c.men.length} men reached the line`);
      /* THE DWELL, at the ramp's foot. */
      const foot = rampFoot(world);
      put(p, THREE, foot.x, foot.z + 1.2);
      let deployed = 0;
      world.onDeckDeploy = () => { deployed++; };
      step(world, DEPLOY_RAMP.hold + 0.5, idle);
      assert(flightPhase(world) === PHASE.BOARD, `after the dwell the flight is ${flightPhase(world)}, not boarding`);
      assert(c.men.every((r) => r.path || r.slot), 'the order to board reached nobody');
      /* THE MEN WALK UP THE RAMP — nobody teleports. */
      let biggest = 0;
      const last = c.men.map((r) => r.pos.clone());
      step(world, 14, idle, () => {
        for (let i = 0; i < c.men.length; i++) {
          const r = c.men[i];
          if (r.aboard) continue;
          biggest = Math.max(biggest, r.pos.distanceTo(last[i]));
          last[i].copy(r.pos);
        }
      });
      assert(biggest < 0.3, `a man moved ${biggest.toFixed(2)} m in one frame on the way to the ramp`);
      /* THE PLAYER WALKS INTO THE BAY and is seated where he stands. */
      const st = world._deckFlight;
      const bay = new THREE.Vector3(0, st.bay.floor + 0.02, (st.bay.front + st.bay.back) / 2);
      st.group.localToWorld(bay);
      put(p, THREE, bay.x, bay.z);
      p.position.y = bay.y;
      assert(inBay(world, p.position), 'the middle of the bay is not "in the bay"');
      step(world, 1.0, idle);
      assert(p.riding, 'standing in the bay did not seat the player');
      step(world, 12, idle);
      const aboard = c.men.filter((r) => r.aboard).length;
      assert(aboard === c.men.length, `${aboard} of ${c.men.length} men aboard when the ramp came up`);
      assert([PHASE.SEAL, PHASE.LIFT, PHASE.RUN, PHASE.OUT, PHASE.GONE].includes(flightPhase(world)),
        `everybody is aboard and the flight is ${flightPhase(world)}`);
      /* THE RUN OUT: the hull crosses the lip, the player goes with it, and
       * the deploy is asked for once, in vacuum. */
      let crossed = false, maxZ = -Infinity;
      step(world, FLIGHT.seal + FLIGHT.lift + FLIGHT.run + FLIGHT.out + 1.0, idle, () => {
        maxZ = Math.max(maxZ, st.group.position.z);
        if (st.group.position.z > DECK.lip) crossed = true;
      });
      assert(crossed, `the hull never crossed the lip (reached z=${maxZ.toFixed(0)})`);
      assert(p.riding && Math.abs(p.position.z - st.group.position.z) < 12,
        `the player is at z=${p.position.z.toFixed(0)} while the hull is at ${st.group.position.z.toFixed(0)} — he was left behind`);
      assert(deployed === 1, `onDeckDeploy fired ${deployed} times`);
      assert(st.group.position.z > DECK.lip + 200, `the deploy was asked for at z=${st.group.position.z.toFixed(0)}, inside the room`);
      assert(st.solids.length === 0, 'the hull flew away and left its colliders on the pad');
      return `${c.men.length} aboard, hull out to z=${st.group.position.z.toFixed(0)}, deploy asked once`;
    } finally { world.unload(); }
  });

  check('flight: a run that ends with you standing lands you on the deck, with the company walking off the ramp', async () => {
    const { world, idle } = await deck({ deckArrival: true });
    try {
      const p = world.player;
      const st = world._deckFlight;
      const c = world._company;
      assert(flightPhase(world) === PHASE.APPROACH, `an arrival opens in ${flightPhase(world)}`);
      assert(st.group.position.z > DECK.lip + 400, `the hull starts at z=${st.group.position.z.toFixed(0)}, not far out`);
      assert(p.riding, 'the player is not aboard the hull he is arriving on');
      assert(c.men.every((r) => r.aboard), 'the company is not aboard the hull it is arriving on');
      /* The lift stands open for a man who did not come by it. */
      assert(world._deckLift?.state !== 'ride', 'a player arriving by ship is riding the lift');
      let arrived = 0;
      world.onDeckArrived = () => { arrived++; };
      let minZ = Infinity;
      step(world, FLIGHT.approach + FLIGHT.turn + FLIGHT.open + 0.5, idle, () => {
        minZ = Math.min(minZ, st.group.position.z);
      });
      assert(arrived === 1, `onDeckArrived fired ${arrived} times`);
      const d = Math.hypot(st.group.position.x - DEPLOY_RAMP.x, st.group.position.z - DEPLOY_RAMP.padZ);
      assert(d < 0.6, `the hull landed ${d.toFixed(1)} m off its pad`);
      assert(Math.abs(st.group.rotation.y - DEPLOY_RAMP.yaw) < 0.02, 'the hull did not park nose-out');
      assert(!p.riding, 'the ramp is down and the player is still seated');
      const foot = rampFoot(world);
      assert(Math.hypot(p.position.x - foot.x, p.position.z - foot.z) < 3, 'the player was not put off at the ramp');
      assert(c.men.every((r) => !r.aboard), 'men still aboard after the ramp came down');
      step(world, 24, idle);
      const home = c.men.filter((r) => Math.hypot(r.pos.x - r.home.x, r.pos.z - r.home.z) < 1.0).length;
      assert(home >= c.men.length - 1, `${home} of ${c.men.length} men walked back into the crowd`);
      assert(st.solids.length >= 5, 'the landed hull has no colliders');
      assert(flightPhase(world) === PHASE.PARKED, `after the unload the flight is ${flightPhase(world)}`);
      return `came in from z=${(DECK.lip + FLIGHT.far).toFixed(0)}, landed on the pad, ${home} men back in the crowd`;
    } finally { world.unload(); }
  });
}
