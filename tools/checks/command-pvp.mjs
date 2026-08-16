/**
 * COMMAND, ACROSS THE WIRE — the mode with an army in it, in a session with
 * more than one person in it.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────
 *
 * `tools/checks/command.mjs` drives a real World and is thorough about the mode
 * on ONE machine. `tools/checks/coop.mjs` drives two real endpoints and is
 * thorough about the wire in every mode that has no army. Between them was the
 * whole of Command in co-op, and what lived in the gap was measured rather than
 * suspected — two real Worlds, host and client, with a ten-man roster on the
 * field:
 *
 *     host troopers          10, team 0
 *     client's copies        10, team 1              ← the horde's number
 *     canHarm(their player, your sergeant)   10 / 10 TRUE
 *
 * Every gate in this game that asks who may hurt whom opened on your own army,
 * on the machine of the friend standing beside you, for the whole session. The
 * two consequences fire with nobody aiming at anything: `_boltHitTest` reads
 * `bolt.owner.team`, and a replicated bolt's owner is the body that fired it —
 * so your own troopers' rifles found the joining player from behind — and every
 * bolt that player deflected into your line hit somebody with a name on the
 * roster and a place on the casualty list.
 *
 * Neither suite could have seen it. `command.mjs` has one World and no wire;
 * `coop.mjs` has a wire and no army. So the shape of this file is the finding:
 * a PAIR of real Worlds in Command mode, stepped by `world.update`, moving only
 * what the production code decided to send.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED ───────────────────────────────────
 *
 * Nothing here scores a formation, a feel or a fight. Those are `command.mjs`'s
 * or nobody's. What this file asserts is the set of sentences that are true on
 * one machine and can silently be false on the other one.
 *
 * Every module is reached by `await import` inside a check body: World.js pulls
 * in Engine.js, which rewrites three's ShaderChunks behind once-only flags, and
 * a static edge from a check patches the copy of three that the harness's own
 * graph resolved. See tools/checks/materials.mjs and _coop.mjs's own note.
 */

/**
 * A HOST AND A CLIENT, BOTH IN COMMAND MODE, WIRED TO EACH OTHER.
 *
 * `bootPair` in _coop.mjs is the model and this is deliberately not a call to
 * it: that helper never starts a director, and an army that has not been
 * deployed is exactly the state in which every defect this file exists for is
 * invisible. So this one starts the host's campaign and then moves EVERY
 * message the production code emits rather than the two `bootPair` knows about
 * — a mode whose roster, orders and muster all have to cross cannot be tested
 * by a pump that only forwards snapshots.
 *
 * Routing is `Net`'s own: each message is handed to the same World method
 * `World.attachNet` binds it to, by name, so a message this file forwards and a
 * message a real session forwards reach the identical line.
 *
 * The ground is NAMED, and it is named by the mode: `MODES.command` declares
 * geonosis and `World.loadLevel` enforces it, so asking for anything else here
 * would be a request the game is entitled to ignore. Saying it out loud is the
 * lesson of the commit that found four checks measuring a level they did not
 * name.
 */
async function commandPair(opts = {}) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const base = { mode: 'command', level: 'geonosis', order: 'jedi' };
  const a = await bootWorld({ level: 'geonosis', settings: { ...base, ...opts.host } });
  const b = await bootWorld({ level: 'geonosis', settings: { ...base, ...opts.client } });

  const wire = { down: [], up: [] };
  const seen = { toClient: [], toHost: [] };
  const wrap = (m) => JSON.parse(JSON.stringify(m));
  const endpoint = (bag, hostSide) => ({
    connected: true, isHost: hostSide, name: hostSide ? 'HOST' : 'PEER', roster: [],
    sweep() {},
    broadcast(m) { bag.push(wrap(m)); },
    toPeer(id, m) { bag.push(wrap(m)); },
    toHost(m) { bag.push(wrap(m)); },
  });
  a.world.attachNet(endpoint(wire.down, true), 'host');
  b.world.attachNet(endpoint(wire.up, false), 'client');

  /**
   * THE ROUTING TABLE, AND IT IS THE GAME'S.
   *
   * Four lines, and every one of them is `main.js`'s own `net.on` line with the
   * subscription taken off — the same message name reaching the same World
   * method. `bootPair` in _coop.mjs established the idiom for `snapshot` and
   * `claim`; Command adds the two that carry an army. Nothing here decodes a
   * payload or decides anything: a check that re-implemented a handler would be
   * measuring itself, which is the failure this whole harness was rebuilt out
   * of.
   */
  const toClient = (w, m) => (m.t === 'snapshot' ? w.applySnapshot(m)
    : m.t === 'army' ? w.applyArmy(m) : null);
  const toHost = (w, m) => (m.t === 'claim' ? w.applyClaim('PEER', m)
    : m.t === 'order' ? w.applyOrder('PEER', m) : null);

  const input = idleInput();
  const STEP = 1 / 30;
  const pump = (seconds) => {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      a.world.update(STEP, input);
      while (wire.down.length) { const m = wire.down.shift(); seen.toClient.push(m); toClient(b.world, m); }
      b.world.update(STEP, input);
      while (wire.up.length) { const m = wire.up.shift(); seen.toHost.push(m); toHost(a.world, m); }
    }
  };

  if (opts.start !== false) {
    a.world.director.start(1);
    if (opts.trim) a.world.director.spawnQueue.length =
      Math.min(a.world.director.spawnQueue.length, opts.trim);
  }
  return { host: a.world, client: b.world, pump, seen, input, wire };
}

/** Every body on the host that has a name on the roster. */
const troopsOf = (world) => world.enemies.filter((e) => e.trooper && !e.dead);

/** The client's copies of a set of host ids, by id, off the replication index. */
const mirrorOf = (client, ids) =>
  [...client._netEnemyIndex.values()].filter((e) => ids.has(e.id));

export function run({ check, assert }) {
  /* ══════════════════════════════════════════════════════════════════ */
  /*  Phase B — co-op: two players, one side, one army                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command/net: a co-op partner cannot shoot your army', async () => {
    /**
     * THE ONE-FIELD DEFECT, DRIVEN ON A REAL PAIR.
     *
     * The snapshot's enemy record described a body and never said whose it was,
     * because for the whole life of the protocol the answer was the horde's and
     * a constant needs no slot. Command broke that: `enlistBody` puts your named
     * troopers in `world.enemies` on the PARTY's team.
     *
     * The control matters as much as the assertion. A check that only asserted
     * "the partner cannot harm these bodies" would pass just as green on a
     * machine where the damage gate had been switched off entirely — so the
     * horde is measured in the same breath, on the same client, through the
     * same call, and it must still be hostile.
     */
    const { canHarm } = await import('../../src/game/Player.js');
    const { host, client, pump } = await commandPair({ trim: 4 });
    pump(3);

    const troops = troopsOf(host);
    assert(troops.length >= 8, `the host deployed ${troops.length} troopers, expected the opening ten`);
    const ids = new Set(troops.map((e) => e.id));
    const mine = mirrorOf(client, ids);
    assert(mine.length === troops.length,
      `${mine.length} of ${troops.length} of your troopers reached the joining player at all`);

    const wrongSide = mine.filter((e) => e.team !== host.partyTeam);
    assert(!wrongSide.length,
      `${wrongSide.length} of ${mine.length} of your troopers arrived on team `
      + `${[...new Set(wrongSide.map((e) => e.team))].join('/')} — the host has them on `
      + `${host.partyTeam}`);

    const harmable = mine.filter((e) => canHarm(client.player, e, client.rules));
    assert(!harmable.length,
      `the joining player may harm ${harmable.length} of your ${mine.length} named troopers`);

    /* THE CONTROL. The horde on the same client, through the same gate. */
    const horde = [...client._netEnemyIndex.values()].filter((e) => !ids.has(e.id) && !e.dead);
    assert(horde.length > 0, 'no horde reached the client, so the control measured nothing');
    const fightable = horde.filter((e) => canHarm(client.player, e, client.rules));
    assert(fightable.length === horde.length,
      `the joining player may harm only ${fightable.length} of ${horde.length} of the horde — `
      + 'the gate is off, not selective');
    return `${mine.length} troopers arrive on team ${host.partyTeam}, none harmable; `
      + `${fightable.length}/${horde.length} of the horde still are`;
  });

  check('command/net: your army\'s rifles do not shoot the joining player', async () => {
    /**
     * THE HALF THAT FIRES WITH NOBODY AIMING AT ANYTHING.
     *
     * `_boltHitTest`'s player loop reads `canHarm(bolt.owner ?? {team: bolt.team}, p)`,
     * and a replicated bolt's owner is looked up out of the replication index —
     * so the owner's team is the trooper's team, and a trooper the client
     * believed was the horde put every round it fired through the joining
     * player's chest from behind their own line.
     *
     * Driven through `_boltHitTest` ITSELF rather than by restating its rule
     * (HANDOFF §2.4): a real replicated bolt off the wire, and a segment that
     * genuinely passes through the client player's body. The bolt is the
     * game's, the gate is the game's, and this only supplies the geometry.
     */
    const { TEAM } = await import('../../src/game/Player.js');
    const THREE = await import('three');
    const { host, client, pump } = await commandPair();

    /**
     * COLLECTED AT THE POOL, because a bolt is an event.
     *
     * `bolts.bolts` is a recycled pool: a record read at the end of a drive is
     * whichever shot happens to be in the air on that frame and carries whoever
     * last borrowed the slot. So the five fields `_boltHitTest` consumes are
     * taken at the moment `_spawnNetBolts` produces each one — the real values,
     * off the real replication path, at the only instant they are that bolt's.
     */
    const spawned = [];
    const inner = client.bolts.fire.bind(client.bolts);
    client.bolts.fire = (o, d, opts = {}) => {
      const b = inner(o, d, opts);
      if (b) spawned.push({ owner: b.owner, team: b.team, damage: b.damage,
        deflected: b.deflected, turned: b.turned });
      return b;
    };
    pump(30);

    const ids = new Set(host.enemies.filter((e) => e.trooper).map((e) => e.id));
    const yours = spawned.filter((b) => b.owner && ids.has(b.owner.id));
    const theirs = spawned.filter((b) => b.owner && !ids.has(b.owner.id));
    assert(yours.length > 0,
      `no bolt fired by one of your troopers was replicated to the joining player in 30 s `
      + `(${spawned.length} replicated bolts, ${theirs.length} of them the horde's) — `
      + 'nothing was measured');

    /* A segment straight through the client player's chest, so a bolt that is
     * allowed to hit them cannot miss for a geometric reason. */
    const p = client.player;
    const chest = new THREE.Vector3(p.position.x, p.position.y + 1.0, p.position.z);
    const from = chest.clone().add(new THREE.Vector3(2.5, 0, 0));
    const to = chest.clone().add(new THREE.Vector3(-2.5, 0, 0));

    const wrongSide = yours.filter((b) => b.team !== TEAM.PARTY);
    assert(!wrongSide.length,
      `${wrongSide.length} of ${yours.length} bolts fired by your own troopers are on team `
      + `${[...new Set(wrongSide.map((b) => b.team))].join('/')}, not the party's ${TEAM.PARTY}`);

    const hpBefore = p.hp;
    let struck = 0;
    for (const b of yours) {
      const res = client._boltHitTest(b, from, to);
      if (res && res.victim === p) struck++;
    }
    assert(!struck,
      `${struck} of ${yours.length} of your own troopers' bolts hit the joining player `
      + `through the shipped hit test (hp ${hpBefore} → ${p.hp})`);

    /**
     * THE CONTROL, AND IT IS WHY THIS IS NOT A CHECK THAT PASSES ON A BROKEN
     * HIT TEST. The horde's bolts go through the same call, on the same
     * geometry, on the same machine, and at least one has to land — one rather
     * than all of them, because the first hit sets `invuln` and the rest of the
     * volley is correctly skipped for the half second that follows.
     */
    let hordeHits = 0;
    for (const b of theirs) {
      const res = client._boltHitTest(b, from, to);
      if (res && res.victim === p) hordeHits++;
    }
    assert(theirs.length > 0 && hordeHits > 0,
      `none of the horde's ${theirs.length} bolts could reach the joining player either — `
      + 'the hit test is not answering, so the assertion above measured nothing');
    return `${yours.length} allied bolts on team ${TEAM.PARTY}, 0 of them reach the joining `
      + `player; ${hordeHits}/${theirs.length} of the horde's do`;
  });

  check('command/net: the joining player fights the host\'s army, not one it invented', async () => {
    /**
     * THE PHANTOM.
     *
     * `World.loadLevel` builds a `CommandDirector` off the mode string alone, on
     * every machine — so a joining player's own director ran `_musterOpening()`
     * and enlisted TEN TROOPERS OF ITS OWN, with ten designations drawn from its
     * own stream, and then never deployed one of them because `main.js` only
     * calls `director.start` when `netMode !== 'client'`.
     *
     * Measured before the fix, on this pair: host `CT-1500 CT-2794 CT-5111`,
     * client `CT-4213 CT-2321 CT-9050` — two disjoint armies, one of which does
     * not exist. The roster panel down the side of a joining player's screen was
     * a list of ten strangers who could never take a casualty, while the ten
     * real names dying three metres in front of them were never named at all.
     *
     * A client holds nothing it was not told now, and what it is told is the
     * host's own `readout()` verbatim — one authority, no twin.
     */
    const { host, client, pump } = await commandPair({ trim: 4 });
    pump(4);

    const hd = host.command, cd = client.command;
    assert(hd && cd, 'one of the two machines has no command director at all');
    const hr = hd.readout(), cr = cd.readout();
    assert(hr.roll.length > 0, 'the host has no roster, so nothing was compared');
    assert(cr.roll.length === hr.roll.length,
      `the joining player holds ${cr.roll.length} names against the host's ${hr.roll.length}`);
    const hn = hr.roll.map((t) => t.name).join(','), cn = cr.roll.map((t) => t.name).join(',');
    assert(hn === cn, `the two machines name different armies:\n  host  ${hn}\n  peer  ${cn}`);
    assert(cr.army === hr.army && cr.armyId === hr.armyId,
      `the joining player is told they lead ${cr.army}, the host leads ${hr.army}`);
    assert(cr.area === hr.area && cr.areaName === hr.areaName,
      `the joining player is in area ${cr.area} (${cr.areaName}), the host in ${hr.area} (${hr.areaName})`);
    assert(cd.roster.all.length === 0 || cd.roster.all.every((t) => hn.includes(t.name)),
      'the client still musters an army of its own');
    return `${cr.roll.length} names, identical on both machines, in ${cr.areaName}`;
  });

  check('command/net: a casualty is a casualty on both machines', async () => {
    /**
     * THE ROSTER IS THE MODE, and a roster that only moves on one machine is a
     * panel rather than a campaign.
     *
     * The name, the rank and the experience all ride the same message, so the
     * useful assertion is the one that a still picture cannot make: kill a
     * trooper on the HOST — through `world.onEnemyKilled`, the same door the
     * mode's own permadeath goes through — and read the joining player's list
     * afterwards. `diedIn` is the field the casualty list is made of.
     */
    const { host, client, pump } = await commandPair({ trim: 3 });
    pump(3);
    const troops = troopsOf(host);
    assert(troops.length >= 3, `only ${troops.length} troopers on the field`);

    const doomed = troops[0];
    const name = doomed.trooper.name;
    const before = client.command.readout().roll.filter((t) => !t.alive).length;
    doomed.hp = 0;
    doomed.die(doomed.position.clone(), null, 'check');
    pump(2);

    const roll = client.command.readout().roll;
    const rec = roll.find((t) => t.name === name);
    assert(rec, `${name} is not on the joining player's roll at all`);
    assert(rec.alive === false,
      `${name} is dead on the host and still standing on the joining player's roster`);
    assert(rec.diedIn != null, `${name} fell in no area on the joining player's copy`);
    const after = roll.filter((t) => !t.alive).length;
    assert(after === before + 1,
      `the casualty list went ${before} → ${after} on the joining player's machine`);
    return `${name} fell in area ${rec.diedIn}; the casualty list is ${after} on both machines`;
  });

  check('command/net: a joining player\'s order reaches the army', async () => {
    /**
     * AN ORDER IS THE WHOLE COMMAND INTERFACE, and on a client it went nowhere.
     *
     * `CommandDirector.order` is called straight off a key press in main.js, on
     * whichever machine pressed it — and the army only exists on the host, so a
     * joining player pressing the formation keys re-posed an army of ten
     * phantoms and the real line never moved. There was no path from that key to
     * the bodies at all.
     *
     * Asserted on the BODIES rather than on the message: the point of an order
     * is where the troops stand, so this reads the host's formation and its
     * announcement, which is the pair a client cannot fake.
     */
    const { host, client, pump } = await commandPair({ trim: 3 });
    pump(2);
    const was = host.command.formation;
    const want = was === 'line' ? 'wedge' : 'line';

    const ok = client.command.order(want);
    assert(ok !== false, `the joining player's order for ${want} was refused outright`);
    pump(1.5);
    assert(host.command.formation === want,
      `the host's army is still in ${host.command.formation} after the joining player ordered ${want}`);
    assert(client.command.readout().formation === want,
      `the joining player's own indicator still reads ${client.command.readout().formation}`);
    const logged = host.command.log.filter((l) => l.t === 'order' && l.formation === want);
    assert(logged.length === 1,
      `the host logged the order ${logged.length} times — a relayed order must be given once`);
    return `${was} → ${want}, given from the joining player's machine, logged once on the host`;
  });
}
