/**
 * WHAT A JOINING PLAYER SEES OF THE ARCHITECTURE AND OF THE MACHINES.
 *
 * A bench, not a check: it asserts nothing and prints numbers. Two questions,
 * both asked of a real pair of Worlds over `tools/checks/_coop.mjs`'s wire:
 *
 *   RUBBLE    after N seconds of the host knocking a level down, how many
 *             pieces have fallen on the host and are still standing on the
 *             joining player's screen — cover that is not there.
 *
 *   MACHINES  what a client's copy of a vehicle is, driven and undriven. The
 *             brief that ordered this bench named src/game/Vehicles.js; that
 *             file is a mesh builder and an archetype table, and the bodies it
 *             builds cross the wire as ordinary enemies. The seat is in
 *             src/game/Driving.js, which is where the hole turned out to be.
 *
 * Run:  node --import ./tools/register.mjs tools/_netrubble.mjs
 *
 * WHY IT DRIVES THE SHIPPED DOORS AND NAMES NO NUMBER OF ITS OWN. Every
 * structural event here goes in through `Destruction.forceBlast`,
 * `DestructionProxy.cut` and `World.onExplosion` — the three seams Player.js,
 * the blade solver and every barrel in the game already use. HANDOFF §2.4: an
 * instrument that restates a rule eventually disagrees with it, and it fails by
 * manufacturing defects.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const LEVEL = 'colosseum';        // 49 destructible pieces, the most of the seven
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => String(v).padStart(n);

/** How much of a manager's world is no longer standing. */
function tally(m) {
  let broken = 0, collapsed = 0;
  for (const s of m.structures) {
    if (s.state !== 'intact') broken++;
    if (s.state === 'collapsed' || s.state === 'gone') collapsed++;
  }
  return { n: m.structures.length, broken, collapsed, live: m.live.length, settled: m.settled.length };
}

/** Pieces the host has broken that the client still has standing, by position. */
function stillStanding(H, C) {
  let n = 0;
  const at = new THREE.Vector3();
  for (const a of H.structures) {
    if (a.state === 'intact') continue;
    let best = null, bestD = 1e9;
    for (const b of C.structures) {
      const d = b.centre.distanceToSquared(at.copy(a.centre));
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best && bestD < 0.01 && best.state === 'intact') n++;
  }
  return n;
}

async function rubble() {
  const H = await import('./checks/_coop.mjs');
  const { host, client, pump } = await H.bootPair({ level: LEVEL });
  const hd = host.destruction, cd = client.destruction;
  console.log(`\n── RUBBLE ─ ${LEVEL}, ${hd.structures.length} destructible pieces a side ─────────`);

  /* The pair boots two Worlds back to back in one process; confirm they hold
   * the SAME architecture before comparing states, or every number below is
   * about two different buildings. */
  let aligned = 0;
  for (let i = 0; i < Math.min(hd.structures.length, cd.structures.length); i++) {
    if (hd.structures[i].centre.distanceTo(cd.structures[i].centre) < 0.01) aligned++;
  }
  console.log(`  aligned pieces: ${aligned} of ${hd.structures.length}`);

  const targets = hd.structures.filter((s) => s.profile.hpPerM2 !== Infinity);
  const norm = new THREE.Vector3(1, 0, 0);
  const imp = new THREE.Vector3(0, -1, 0).multiplyScalar(30);
  const arms = [
    ['blade cut', (s) => { for (let k = 0; k < 6; k++) hd.proxy.cut(s.centre.clone(), norm, imp); }],
    ['force push', (s) => {
      const o = s.centre.clone().add(new THREE.Vector3(0, 0, -8));
      const d = new THREE.Vector3().subVectors(s.centre, o).normalize();
      for (let k = 0; k < 8; k++) hd.forceBlast(o, d, 14, 3);
    }],
    ['heavy impact', (s) => {
      const b = { id: 90000 + Math.round(s.centre.x * 7), static: false, invMass: 1 / 400, mass: 400,
        boundingRadius: 0.9, position: s.centre.clone(),
        velocity: new THREE.Vector3(0, 0, 18), userData: {} };
      host.physics.bodies.push(b);
      for (let k = 0; k < 4; k++) { hd._impactCd.clear(); hd._impactScan(1 / 60); }
      host.physics.bodies.pop();
    }],
    ['blast (control)', (s) => host.onExplosion(s.centre.clone(), 2.2)],
  ];

  console.log(`\n  ${pad('arm', 17)}${num('h.brk')}${num('c.brk')}${num('h.col')}${num('c.col')}${num('h.live')}${num('c.live')}   standing on client`);
  let total = 0;
  for (let i = 0; i < arms.length; i++) {
    const [name, fire] = arms[i];
    const before = tally(hd).broken;
    for (const s of targets.slice(i * 3, i * 3 + 3)) fire(s);
    for (let f = 0; f < 90; f++) pump(1 / 60);
    const a = tally(hd), b = tally(cd);
    const gap = stillStanding(hd, cd);
    total = gap;
    console.log(`  ${pad(name, 17)}${num(a.broken)}${num(b.broken)}${num(a.collapsed)}${num(b.collapsed)}`
      + `${num(a.live)}${num(b.live)}   ${gap}   (+${a.broken - before} this arm)`);
  }
  console.log(`\n  AFTER ALL FOUR: ${tally(hd).broken} pieces down on the host, `
    + `${tally(cd).broken} on the client, ${total} standing on the client that have fallen on the host.`);

  /* …and the other way: a client carving its own cover. */
  const c0 = tally(cd).broken, h0 = tally(hd).broken;
  for (const s of cd.structures.filter((s) => s.profile.hpPerM2 !== Infinity).slice(20, 23)) {
    for (let k = 0; k < 6; k++) cd.proxy.cut(s.centre.clone(), norm, imp);
  }
  for (let f = 0; f < 90; f++) pump(1 / 60);
  console.log(`  the guest's own blade: +${tally(cd).broken - c0} down on their screen, `
    + `+${tally(hd).broken - h0} on the host's.`);

  host.unload(); client.unload();
}

async function machines() {
  const H = await import('./checks/_coop.mjs');
  const { host, client, pump } = await H.bootPair({ level: LEVEL });
  console.log(`\n── MACHINES ────────────────────────────────────────────────────────`);

  const at = new THREE.Vector3(0, 0, 24);
  const kinds = ['atte', 'aat', 'juggernaut', 'hailfire', 'dwarfspider', 'snailtank'];
  const made = kinds.map((k, i) => [k, host.spawnEnemy(k, at.clone().setX(i * 9 - 22))]);
  for (let f = 0; f < 90; f++) pump(1 / 60);
  console.log(`\n  ${pad('archetype', 14)}${pad('crew', 6)}  client copy`);
  for (const [k, e] of made) {
    const c = client.enemies.find((x) => x.id === e?.id);
    const { crewOf } = await import('../src/game/Driving.js');
    console.log(`  ${pad(k, 14)}${pad(crewOf(k), 6)}  `
      + (c ? `present, ${c.position.distanceTo(e.position).toFixed(2)} m off the host's, hp ${Math.round(c.hp)}/${Math.round(e.hp)}, team ${c.team}` : 'MISSING'));
  }

  /* ── the host takes the controls, and the guest watches ── */
  const { Crew } = await import('../src/game/Driving.js');
  const tank = made.find(([k]) => k === 'juggernaut')[1];
  tank.team = host.player.team;
  host.player.position.copy(tank.position);
  const drove = host.player.takeControls({ input: H.idleInput(), players: host.players, enemies: host.enemies });
  const p0 = tank.position.clone();
  /* `pump` steps both Worlds with an idle stick — HANDOFF §2.5c's statue. The
   * throttle has to be driven by hand, before the step, every frame. */
  const wheel = { ...H.idleInput(), moveAxis: (o) => { if (o) { o.x = 0.4; o.y = 1; return o; } return { x: 0.4, y: 1 }; } };
  for (let f = 0; f < 300; f++) {
    host.player.driving?.update(1 / 60, { input: wheel, players: host.players, enemies: host.enemies });
    pump(1 / 60);
  }
  const ct = client.enemies.find((x) => x.id === tank.id);
  console.log(`\n  HOST DRIVES a ${tank.type}: boarded=${drove}, hull moved ${tank.position.distanceTo(p0).toFixed(1)} m`);
  console.log(`    guest's copy: ${ct ? `${ct.position.distanceTo(tank.position).toFixed(2)} m off the hull, team ${ct.team} (host ${tank.team}), driven=${!!ct.driven}` : 'MISSING'}`);
  const hostSeat = host.player.position.distanceTo(tank.position);
  const ghost = client.remotes?.get?.('HOST');
  console.log(`    the DRIVER: host has them ${hostSeat.toFixed(2)} m from the hull; `
    + `guest draws them ${ghost ? ghost.position.distanceTo(ct?.position ?? tank.position).toFixed(2) + ' m' : '— no avatar'} from theirs`);
  host.player.driving?.leave(null);

  /* ── the guest takes the controls ── */
  const ctank = client.enemies.find((x) => x.id === made.find(([k]) => k === 'atte')[1].id);
  const htank = made.find(([k]) => k === 'atte')[1];
  ctank.team = client.player.team;
  client.player.position.copy(ctank.position);
  const q0 = client.player.position.clone();
  const took = client.player.takeControls({ input: H.idleInput(), players: client.players, enemies: client.enemies });
  const c0 = ctank.position.clone(), hp0 = htank.position.clone();
  for (let f = 0; f < 360; f++) {
    client.player.driving?.update(1 / 60, { input: wheel, players: client.players, enemies: client.enemies });
    pump(1 / 60);
  }
  console.log(`\n  GUEST DRIVES an ${ctank.type}: boarded=${took}`);
  console.log(`    the guest's hull moved ${ctank.position.distanceTo(c0).toFixed(2)} m; the host's moved ${htank.position.distanceTo(hp0).toFixed(2)} m`);
  console.log(`    the host still has it driven=${!!htank.driven}, team ${htank.team} (guest reads ${ctank.team})`);
  console.log(`    the guest's own body moved ${client.player.position.distanceTo(q0).toFixed(2)} m, `
    + `${client.player.position.distanceTo(ctank.position).toFixed(2)} m from the hull `
    + `(a seated driver is under ${(ctank.radius ?? 1).toFixed(1)} m), `
    + `driving=${!!client.player.driving}, blade ${client.player.saber?.root?.visible === false ? 'on their belt' : 'in hand'}`);

  host.unload(); client.unload();
}

await rubble();
await machines();
