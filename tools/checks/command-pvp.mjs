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
    : m.t === 'army' ? w.applyArmy(m)
      : m.t === 'match' ? w.applyMatch(m) : null);
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
    /* Exactly what main.js does on Ignite: a meeting hands out the sides, the
     * armies and the two anchors and starts itself; a campaign starts a wave.
     * The branch is the game's — this only reaches for the same door. */
    if (a.world.command?.versus) a.world.beginVersus();
    else a.world.director.start(1);
    if (opts.trim && a.world.director.spawnQueue) a.world.director.spawnQueue.length =
      Math.min(a.world.director.spawnQueue.length, opts.trim);
  }
  return { host: a.world, client: b.world, pump, seen, input, wire };
}

/**
 * A SECOND COMMANDER ON THE HOST'S FIELD.
 *
 * In a real session that body is a `RemoteAvatar` built by main.js's avatar
 * handler from the roster, and `beginVersus` is re-run the moment it appears.
 * Here it is built the same way, off the same class, with the same one field
 * that decides everything — the side off the roster — so the host is holding
 * the pair of players a real host holds.
 */
async function joinAsCommander(host, opts = {}) {
  const { RemoteAvatar } = await import('../../src/net/Net.js');
  const { canHarm } = await import('../../src/game/Player.js');
  const r = new RemoteAvatar(host, { id: opts.id || 'PEER', name: opts.name || 'RIVAL',
    look: null, team: opts.team });
  (host.remotes || (host.remotes = new Map())).set(r.id, r);
  host.players.push(r);
  /**
   * THE PEER'S OWN MACHINE, STOOD IN FOR — and without it the rival is immortal
   * and its side can never be eliminated.
   *
   * `RemoteAvatar.damage` deliberately does not touch `hp`, and its own note
   * explains why: the peer runs its own Player, its own boons and its own
   * Second Wind, so the only correct thing the host can do is TELL them, over
   * `hit`, and let their machine decide what the number becomes — it arrives
   * back in the next avatar packet. In a check there is no second machine
   * running that Player. This is that missing half and only that: the gate is
   * still `canHarm`, called rather than restated, so a hit that must not land
   * still does not.
   */
  r.damage = function (amount, point, source, kind) {
    if (!(amount > 0) || !this.alive) return false;
    if (!canHarm(source, this, host.rules)) return false;
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return !this.alive;
  };
  return r;
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

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Phase C — versus: two commanders, two armies, one field           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command/versus: two Jedi lead two different armies', async () => {
    /**
     * `sideForOrder` DERIVES THE ARMY FROM THE JEDI/SITH CHOICE, and its own
     * note is right about why: asking again on the deploy screen would let
     * somebody be a Jedi at the head of a droid army, "which is not a build, it
     * is a bug wearing a menu". That reasoning is sound for ONE commander and
     * has no answer at all for two — two Jedi hosting each other both got the
     * Republic, so the meeting was the Republic against itself, in identical
     * armour, with no way to tell whose line was whose.
     *
     * Pure, so it is asserted without a World: this runs on the host and the
     * answer goes out on the wire, and a client that recomputes it from the
     * same roster must reach the same one.
     */
    const Cmd = await import('../../src/game/Command.js');
    const two = Cmd.assignArmies(['jedi', 'jedi']).map((a) => a.id);
    assert(two[0] !== two[1], `two Jedi both lead ${two[0]}`);
    assert(two[0] === 'republic', `the first Jedi leads ${two[0]}, not the Republic`);

    const sith = Cmd.assignArmies(['sith', 'sith']).map((a) => a.id);
    assert(sith[0] !== sith[1], `two Sith both lead ${sith[0]}`);
    assert(sith[0] === 'separatist', `the first Sith leads ${sith[0]}, not the Confederacy`);

    /* The order still picks FIRST, in either join order — that is the half of
     * `sideForOrder`'s argument this must not break. */
    const mixed = Cmd.assignArmies(['jedi', 'sith']).map((a) => a.id);
    const flipped = Cmd.assignArmies(['sith', 'jedi']).map((a) => a.id);
    assert(mixed.join() === 'republic,separatist', `a Jedi and a Sith got ${mixed.join('/')}`);
    assert(flipped.join() === 'separatist,republic', `a Sith and a Jedi got ${flipped.join('/')}`);
    assert(Cmd.assignArmies([]).length === 0, 'an empty roster is not an empty answer');
    return `jedi+jedi → ${two.join('/')}, sith+sith → ${sith.join('/')}, `
      + `jedi+sith → ${mixed.join('/')} either way round`;
  });

  check('command/versus: two commanders meet on Geonosis', async () => {
    /**
     * THE OWNER'S HEADLINE QUESTION, DRIVEN.
     *
     * "can two sides command two different armies and meet on the battlefield?"
     * Everything below is one real World with two real commanders in it: two
     * rosters, two armies, two anchors 120 m apart, and the shipped damage gate
     * asked about every pairing it can be asked about.
     *
     * The controls are the whole value of this check. "Two armies exist" is
     * cheap; what is expensive to get right is that each side is hostile to the
     * OTHER and friendly to its OWN, in both directions, through the same
     * `canHarm` every bolt and every blade consults. A world where everything
     * can hurt everything would satisfy a naive version of this and be a worse
     * game than the one that could not do it at all.
     */
    const { canHarm, SIDES } = await import('../../src/game/Player.js');
    const { VERSUS_SEPARATION } = await import('../../src/game/Command.js');
    const { host } = await commandPair({ host: { commandVersus: true }, start: false });
    /* Deployed ALONE first, which is what `main.js` does on Ignite: the peer's
     * body does not exist until their first avatar packet. A match built with
     * one side ends on the frame the countdown does, so there must not be one
     * yet — this is the state that hands a host the field against nobody. */
    host.beginVersus();
    assert(!host.match, 'a meeting against nobody already has a match, and it is one this host wins');
    const rival = await joinAsCommander(host, { team: SIDES[1] });
    const cs = host.beginVersus();
    assert(cs && cs.length === 2, `beginVersus produced ${cs ? cs.length : 0} commanders, expected 2`);
    assert(host.match && host.match.sides.length === 2,
      'the match was not made when the second commander arrived');

    const [mine, theirs] = cs;
    assert(mine.side !== theirs.side, `both commanders are on side ${mine.side}`);
    assert(mine.army.id !== theirs.army.id, `both commanders lead ${mine.army.id}`);
    assert(theirs.player === rival, 'the second commander is not leading the second player');

    const gap = Math.hypot(mine.anchor.x - theirs.anchor.x, mine.anchor.z - theirs.anchor.z);
    assert(Math.abs(gap - VERSUS_SEPARATION) < 1,
      `the two armies formed up ${gap.toFixed(1)} m apart, not ${VERSUS_SEPARATION}`);

    const mineBodies = host.enemies.filter((e) => e.cmdr === mine && !e.dead);
    const theirBodies = host.enemies.filter((e) => e.cmdr === theirs && !e.dead);
    assert(mineBodies.length >= 8 && theirBodies.length >= 8,
      `${mineBodies.length} against ${theirBodies.length} — both armies must be on the field`);
    assert(mineBodies.every((e) => e.team === mine.side) && theirBodies.every((e) => e.team === theirs.side),
      'a body is standing on a side its commander is not on');

    /* Nobody's line is standing in anybody else's. */
    const centre = (l) => l.reduce((a, e) => a + e.position.z, 0) / l.length;
    const zMine = centre(mineBodies), zTheirs = centre(theirBodies);
    assert(Math.abs(zMine - zTheirs) > VERSUS_SEPARATION * 0.6,
      `the two lines deployed ${Math.abs(zMine - zTheirs).toFixed(1)} m apart — they are in each other's ranks`);

    /* THE GATE, both ways, on real bodies. */
    const a0 = mineBodies[0], b0 = theirBodies[0];
    assert(canHarm(a0, b0, host.rules) && canHarm(b0, a0, host.rules),
      'the two armies cannot fight each other');
    assert(canHarm(host.player, b0, host.rules) && canHarm(rival, a0, host.rules),
      'a commander cannot fight the opposing army');
    assert(canHarm(host.player, rival, host.rules) && canHarm(rival, host.player, host.rules),
      'the two commanders cannot fight each other');
    /* …and the control: your own line is still yours. `canHarm` says yes under
     * a meeting's rules because friendly fire is derived from pvp — what stops
     * a massacre is `installTeamDamage`'s scale, which is asserted in
     * command.mjs. What must NOT be true is that they are on the same side. */
    assert(a0.team === host.player.team && b0.team === rival.team,
      'a commander is not on the same side as their own army');
    return `${mine.army.name} (side ${mine.side}, ${mineBodies.length} bodies) against `
      + `${theirs.army.name} (side ${theirs.side}, ${theirBodies.length}), ${gap.toFixed(0)} m apart`;
  });

  check('command/versus: the two armies actually fight, and one of them wins', async () => {
    /**
     * THE PART A STILL PICTURE CANNOT ASSERT.
     *
     * Two lines placed 120 m apart on a plain is a diorama. What makes it a
     * battle is that both sides pick targets across the gap, close it, take
     * casualties off each other's rosters, and that the thing ends — with a
     * side named, once, through the same `onGameOver` a campaign's victory
     * fires.
     *
     * `DuelMatch` is the model, UNCHANGED and not subclassed: its `update`
     * already takes side → standing and side → health rather than reading the
     * arena, so an army-vs-army round is the same state machine as a duel with
     * a different census. That is asserted here by driving it to a real end.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const { host, pump } = await commandPair({ host: { commandVersus: true }, start: false });
    await joinAsCommander(host, { team: SIDES[1] });
    const cs = host.beginVersus();
    const d = host.command;

    const ended = [];
    host.onGameOver = (s) => ended.push(s);
    assert(host.match, 'a meeting has no match at all');
    assert(host.match.sides.length === 2,
      `the match has ${host.match.sides.length} side(s) — a match with one ends on the frame the `
      + 'countdown does, and hands the field to whoever deployed first');
    assert(host.rules.pvp === true && host.rules.friendlyFire === true,
      `a meeting is being fought under co-op's rules (pvp ${host.rules.pvp})`);

    /**
     * BOTH SIDES ARE ORDERED TO ADVANCE, and that is a statement about the mode
     * rather than a convenience for the harness.
     *
     * The anchor a formation is solved against is its COMMANDER, so an army
     * under a holding order holds — which is correct, and it means two
     * commanders who both stand still produce a stare-off across 120 m that the
     * round clock decides on remaining strength. That is a legitimate ending
     * and it is not a battle, so it cannot be what this check measures. Two
     * armies meet because somebody orders them to; `charge` is the order, given
     * through `order()` on both sides exactly as a key press gives it.
     */
    for (const c of cs) d.order('charge', c);

    const before = cs.map((c) => c.roster.strength);
    /* Long enough to cross 120 m at a trooper's pace and fight it out. The
     * match's own clock is `roundTime`, well past this. */
    let engaged = 0, closest = Infinity;
    for (let i = 0; i < 60; i++) {
      pump(2);
      const mine = host.enemies.filter((e) => e.cmdr === cs[0] && !e.dead);
      const them = host.enemies.filter((e) => e.cmdr === cs[1] && !e.dead);
      for (const e of mine) {
        if (e.target && e.target.team !== undefined && e.target.team !== e.team) engaged++;
        for (const o of them) closest = Math.min(closest, e.position.distanceTo(o.position));
      }
      if (host.match.phase === 'match-over') break;
    }

    assert(engaged > 0, 'no trooper on either side ever picked a target on the other');
    assert(closest < 40, `the two lines never got closer than ${closest.toFixed(0)} m — they did not meet`);
    const after = cs.map((c) => c.roster.strength);
    assert(after[0] < before[0] || after[1] < before[1],
      `no casualties on either roster after 120 s (${before.join('v')} → ${after.join('v')})`);
    assert(host.match.phase === 'match-over',
      `the meeting is still in phase '${host.match.phase}' — ${after.join(' v ')} standing, `
      + 'a battle that cannot end is worse than one that cannot start');
    assert(ended.length === 1, `onGameOver fired ${ended.length} times`);
    assert(typeof ended[0].won === 'boolean', 'the meeting did not report a winner');
    const w = host.match.winner;
    assert(w === null || cs.some((c) => c.side === w), `side ${w} took the field and is nobody's`);
    return `${before.join(' v ')} → ${after.join(' v ')} standing, closed to ${closest.toFixed(1)} m, `
      + `${engaged} target picks across the line; side ${w} took the field, won=${ended[0].won}`;
  });

  check('command/versus: a joining commander is sent their OWN army, not the host\'s', async () => {
    /**
     * THE ROSTER MESSAGE IS BROADCAST IN A CAMPAIGN AND ADDRESSED IN A MEETING,
     * and the difference is not an optimisation.
     *
     * In co-op there is one army and everybody is leading it, so one readout is
     * the truth on every screen — which is what the `army` message was, and
     * correctly. In a meeting each commander has a roster, a rank ladder and a
     * casualty list of their OWN, and a broadcast of the host's puts the
     * Republic's dead down the side of the Confederacy's screen: a joining
     * commander watching a panel of ten names that are not theirs take
     * casualties they did not suffer, in an army they are not leading.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const { host, client, pump } = await commandPair({ host: { commandVersus: true }, start: false });
    await joinAsCommander(host, { team: SIDES[1] });
    const cs = host.beginVersus();
    pump(3);

    const hostSide = host.command.readout();
    const seen = client.command.readout();
    assert(seen.roll.length > 0, 'the joining commander was sent no army at all');
    assert(seen.armyId === cs[1].army.id,
      `the joining commander is shown ${seen.armyId}, and they are leading ${cs[1].army.id}`);
    assert(seen.armyId !== hostSide.armyId,
      `both machines are showing ${seen.armyId} — the host's army was broadcast to its opponent`);
    const hn = new Set(hostSide.roll.map((t) => t.name));
    const overlap = seen.roll.filter((t) => hn.has(t.name));
    assert(!overlap.length,
      `${overlap.length} names appear on both commanders' rolls (${overlap.slice(0, 3).map((t) => t.name).join(', ')})`);
    return `${seen.armyId} (${seen.roll.length} names) to the joining commander, `
      + `${hostSide.armyId} (${hostSide.roll.length}) to the host, no name on both`;
  });

  check('command/versus: the joining commander is told which side they are on and where it stands', async () => {
    /**
     * `assignSides` AND `Net.setSides` BOTH EXISTED, COMPLETE, WITH ZERO
     * CALLERS — the same wire-built-at-one-end shape `claim` and `toHost` were,
     * and it is worth stating that the code was not wrong, it was unreachable.
     * Every remote body in every session was on side 0 whatever the host had
     * decided, and a client's own local player was built with no team at all.
     *
     * The SEAT is the half that is easy to leave out and is fatal on its own. A
     * client told it is the Confederacy but not where the Confederacy stands
     * spawns at the level's home spot — in the middle of the Republic's line,
     * with its own army forming up around it, because a formation is solved in
     * its commander's frame. Two internally consistent machines and no two
     * sides on the field.
     *
     * Driven through two REAL `Net` endpoints over the stub broker, so the
     * roster that reaches the client is the one `_refreshRoster` actually
     * broadcasts rather than an object this file wrote.
     */
    const H = await import('./_coop.mjs');
    const { Net } = await import('../../src/net/Net.js');
    const { SIDES, asTeam } = await import('../../src/game/Player.js');
    const fake = H.installPeerStub();
    const settle = async (n = 8) => {
      for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 0)); fake.flush(); }
    };
    const host = new Net();
    const code = await (async () => { const p = host.host('HOST', {}, null); await settle(); return p; })();
    const peer = new Net();
    const joining = peer.join(code, 'RIVAL', null);
    await settle();
    await joining;
    await settle();

    const hostId = host.peer.id, peerId = peer.peer.id;
    host.setSides(new Map([[hostId, SIDES[0]], [peerId, SIDES[1]]]));
    host.setSeats(new Map([[peerId, { at: [0, 1.5, 60], facing: Math.PI }]]));
    await settle();

    const seen = peer.roster.find((r) => r.id === peerId);
    assert(seen, 'the joining player is not on the roster it received');
    assert(seen.team === SIDES[1],
      `the joining player was told it is on side ${seen.team}, the host put it on ${SIDES[1]}`);
    assert(Array.isArray(seen.at) && seen.at[2] === 60,
      `the joining player was told to stand at ${JSON.stringify(seen.at)}`);

    /* A client may not write either of them. Both refusals are the same rule:
     * a peer that could choose its own side could choose yours, and a peer that
     * could choose its own ground could choose the middle of yours. */
    const before = JSON.stringify(peer.roster);
    peer.setSides(new Map([[peerId, SIDES[0]]]));
    peer.setSeats(new Map([[peerId, { at: [0, 0, -60], facing: 0 }]]));
    assert(JSON.stringify(peer.roster) === before, 'a client can write its own side or its own ground');

    /* …and a session with no meeting in it pays nothing for any of this. */
    const plain = new Net();
    const plainCode = await (async () => { const p = plain.host('SOLO', {}, null); await settle(); return p; })();
    assert(plainCode && plain.roster[0].at === undefined,
      'a co-op roster carries a seat nobody asked for');
    fake.restore(); fake.restore(); fake.restore();
    return `side ${asTeam(seen.team)} and ground ${seen.at.join('/')} reached the joining player; `
      + 'a client cannot write either; a co-op roster carries neither';
  });
}
