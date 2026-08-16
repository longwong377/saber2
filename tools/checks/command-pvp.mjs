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
   * Every line is `main.js`'s own `net.on` line with the subscription taken off
   * — the same message name reaching the same World method. `bootPair` in
   * _coop.mjs established the idiom for `snapshot` and `claim`; Command adds
   * the three that carry an army. Nothing here decodes a payload or decides
   * anything: a check that re-implemented a handler would be measuring itself,
   * which is the failure this whole harness was rebuilt out of.
   *
   * `muster` appears on BOTH tables, once, and that is the message rather than
   * the fixture: it is the one Command type that travels in both directions,
   * and `World.applyMuster` branches on `netMode` to decide which of the two it
   * is holding. Routing it to the same method from both ends is what puts that
   * branch under test — a check that called an offer-reader on the client and
   * an intent-reader on the host would prove the split it was supposed to
   * measure by assuming it.
   */
  const toClient = (w, m) => (m.t === 'snapshot' ? w.applySnapshot(m)
    : m.t === 'army' ? w.applyArmy(m)
      : m.t === 'muster' ? w.applyMuster(m, 'HOST')
        : m.t === 'match' ? w.applyMatch(m) : null);
  const toHost = (w, m) => (m.t === 'claim' ? w.applyClaim('PEER', m)
    : m.t === 'order' ? w.applyOrder('PEER', m)
      : m.t === 'muster' ? w.applyMuster(m, 'PEER') : null);

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
  /* `look` is the sheet that crossed on the roster, and it is where a peer's
   * chosen ORDER now lives — see LOOK_KEYS. Passed through rather than always
   * null so a check can put a Sith on the other end of the field and have the
   * host find that out the way a real host does. */
  const r = new RemoteAvatar(host, { id: opts.id || 'PEER', name: opts.name || 'RIVAL',
    look: opts.look ?? null, team: opts.team });
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

/**
 * THE AREA BOUNDARY, THROUGH THE MODE'S OWN DOOR — and with the host's screen
 * standing in, because without one the muster does not stay open.
 *
 * `payWave` is what the wave loop calls and `_areaClear` is what it reaches;
 * priming `areaWaves` is the idiom `command.mjs` already uses to get there
 * without playing three waves in real time. What this adds is the SCREEN: with
 * no `onMuster` installed the director takes its documented fallback and
 * musters for the player itself, so the card would be raised and dismissed
 * inside one call and there would be nothing for a client to be offered. A host
 * with a UI is the state every real session is in; `main.js` installs exactly
 * this.
 *
 * @returns the offers the host's own screen was raised with.
 */
function openMuster(host) {
  const d = host.command;
  const raised = [];
  d.onMuster = (o) => raised.push(o);
  d.areaWaves = d.area.waves - 1;
  /* A wave is paid ONCE — `wave > _paid` in Waves.js — so a fixture that opens
   * a SECOND muster has to ask about a wave the director has not already
   * settled. Moving `wave` first is what `start` does and keeps the two in the
   * order the loop leaves them in. */
  d.wave = (d.wave | 0) + 1;
  d.payWave(d.wave);
  return raised;
}

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

  check('command/net: a joining commander musters for itself', async () => {
    /**
     * THE PURSE IS THE OTHER HALF OF THE ROSTER, AND IT HAD NO WIRE.
     *
     * `applyNet` has carried `mustering` and `points` to every machine in the
     * session since the roster crossed, so the shape of the defect is subtler
     * than a blank screen and worse. Measured on this pair by running the
     * pre-change path — `musterOffer`, `recruit` and `autoMuster` had no shell
     * branch, so a client ran the local one:
     *
     *   the offer          22 points, 4 rungs, 4 affordable — and a roll of
     *                      ZERO names against the host's ten, `have: 0` on
     *                      every rung with ten of them standing in front of
     *                      you, and `strength: 0`, so `afford` stayed true
     *                      right past MAX_STRENGTH
     *   buying a jet       enlisted CT-2458 onto the CLIENT's own shell
     *                      roster, spent its own 22 → 14, and put 0 messages
     *                      on the wire
     *   the host           10 standing, 22 points. Unchanged. Both.
     *   then autoMuster    2 more phantom bodies, down to 4 points, 0 messages
     *
     * So a joining commander's muster was a private fiction: the points were
     * real, the army it thought it was buying did not exist anywhere else, and
     * the actual reinforcements were chosen by the host's player — or, with no
     * screen wired at all, by `autoMuster`.
     *
     * Driven end to end on two real Worlds: the muster opens on the host
     * through `payWave`, the offer crosses, the CLIENT buys, and the assertion
     * is on the host's roster and the host's purse, which is the pair a client
     * cannot fake.
     */
    const { host, client, pump, seen } = await commandPair({ trim: 3 });
    pump(2);
    const d = host.command;

    /* Both screens, standing in for the two machines' UIs. */
    const cards = [], closes = [];
    client.command.onMuster = (o) => cards.push(o);
    client.command.onMusterClose = () => closes.push(1);
    const hostCards = openMuster(host);

    assert(hostCards.length === 1 && d.mustering,
      `the muster did not open on the host at all (${hostCards.length} cards, mustering=${d.mustering})`);
    pump(0.4);

    assert(cards.length === 1,
      `the joining commander's muster was raised ${cards.length} times, not once`);
    const offer = client.command.musterOffer();
    assert(offer, 'the joining commander has no offer to spend, so there is no muster on that machine');
    const truth = d.musterOffer();
    assert(offer.points === truth.points && offer.points > 0,
      `the joining commander is shown ${offer.points} points against the host's ${truth.points}`);
    /* The SHELF, field for field. `afford` is the one that cannot be derived on
     * a machine with no purse, and it is the one a screen greys a row on. */
    const shelf = (o) => o.units.map((u) => `${u.type}:${u.cost}:${u.have}:${u.afford ? 1 : 0}`).join(' ');
    assert(shelf(offer) === shelf(truth),
      `the two machines are offering different armies:\n  host ${shelf(truth)}\n  peer ${shelf(offer)}`);

    /* …AND IT BUYS. */
    const want = offer.units.filter((u) => u.afford).sort((a, b) => b.cost - a.cost)[0];
    assert(want, `nothing on the shelf is affordable at ${offer.points} points, so nothing was bought`);
    const before = { points: d.roster.points, strength: d.roster.strength };
    const local = client.command.recruit(want.type);
    assert(local === null, 'the joining commander enlisted a trooper of its own, off its own roster');
    assert(d.roster.strength === before.strength,
      'the host acted on a purchase before the message carrying it had arrived');
    pump(0.4);

    assert(d.roster.strength === before.strength + 1,
      `the host's army went ${before.strength} → ${d.roster.strength} — the purchase never landed`);
    assert(d.roster.points === before.points - want.cost,
      `the host's purse went ${before.points} → ${d.roster.points}, and a ${want.type} costs ${want.cost}`);
    const bought = d.roster.living.filter((t) => t.type === want.type).length;
    assert(bought === want.have + 1,
      `${bought} of ${want.type} on the host's roll, ${want.have + 1} expected`);
    const after = client.command.musterOffer();
    assert(cards.length === 2, `the screen was re-offered ${cards.length - 1} times after a purchase`);
    assert(after.points === d.roster.points,
      `the joining commander still reads ${after.points} points against the host's ${d.roster.points}`);
    assert(after.units.find((u) => u.type === want.type).have === want.have + 1,
      'the joining commander cannot see the unit it just bought');

    /* …AND CLOSES IT, which is the half that starts the next area. */
    client.command.closeMuster();
    pump(0.6);
    assert(!d.mustering, 'the host is still mustering after the joining commander was done');
    assert(!client.command.mustering && client.command.musterOffer() === null,
      'the joining commander is still holding an offer for a muster that has closed');
    assert(closes.length === 1, `the joining commander's card came down ${closes.length} times`);
    assert(troopsOf(host).length >= before.strength + 1,
      `${troopsOf(host).length} bodies on the field after the muster closed — the army was not deployed`);

    const msgs = seen.toHost.filter((m) => m.t === 'muster').length;
    return `${offer.points} points and ${offer.units.length} rungs to the joining commander, `
      + `one ${want.type} at ${want.cost} bought from there (${before.points} → ${d.roster.points}), `
      + `${msgs} intents on the wire, ${troopsOf(host).length} deployed`;
  });

  check('command/net: the host holds the purse, and a peer\'s claim about it is worth nothing', async () => {
    /**
     * THE HALF THAT IS NOT ABOUT CONVENIENCE.
     *
     * A muster that a client can drive is a muster a client can LIE to, and the
     * shape the lie takes is always the same: a peer that is trusted about what
     * it can afford is a peer that fields twenty-four ARC troopers on an empty
     * purse. So the intent on the wire carries the unit and nothing else, and
     * every one of `recruit`'s five refusals is evaluated on the machine
     * holding the roster.
     *
     * Asserted by FORGING, not by inspecting: the messages below are pushed
     * onto the same queue the client's own `requestMuster` writes to and are
     * routed by the same table, so they reach `applyMuster` exactly as a
     * hostile peer's would. A check that only asserted the honest path would
     * pass just as green against a host that trusted every field it was sent.
     */
    const { host, client, pump, wire } = await commandPair({ trim: 3 });
    pump(2);
    const d = host.command;
    client.command.onMuster = () => {};
    openMuster(host);
    pump(0.4);

    const shelf = d.musterOffer().units.slice().sort((a, b) => b.cost - a.cost);
    const dear = shelf[0];
    /* An empty purse. The state a campaign reaches on its own every time the
     * player spends the last of it — reached here directly so the assertion is
     * about the refusal rather than about how long it took to get poor. */
    d.roster.points = 0;
    const s0 = d.roster.strength;

    /* THE CLAIM. Every field a peer might hope the host reads off the message. */
    wire.up.push({ t: 'muster', u: dear.type, points: 9999, cost: 0, afford: true,
      strength: 0, o: { points: 9999, units: [] } });
    pump(0.4);
    assert(d.roster.strength === s0,
      `the host fielded a ${dear.type} it could not pay for (${s0} → ${d.roster.strength})`);
    assert(d.roster.points === 0,
      `the host's purse went 0 → ${d.roster.points} — a peer wrote the balance`);
    assert(/points/.test(d.refused || ''),
      `the host refused with '${d.refused}', which is not a refusal about the purse`);
    assert(client.command.refused && /points/.test(client.command.refused),
      `the joining commander was told '${client.command.refused}' — the reason never came back`);
    assert(client.command.musterOffer()?.points === 0,
      'the joining commander is still being shown points the host no longer has');

    /* A UNIT THAT IS NOT IN THIS ARMY, and one the advance has not reached. */
    d.roster.points = 999;
    wire.up.push({ t: 'muster', u: 'b1' });                 // the other army's
    wire.up.push({ t: 'muster', u: 'atte' });               // area 4, from area 1
    wire.up.push({ t: 'muster', u: '__nonsense__' });
    pump(0.4);
    assert(d.roster.strength === s0,
      `${d.roster.strength - s0} bodies joined off a shelf that is not selling them`);

    /* AND WITH NO MUSTER OPEN AT ALL. `mustering` is the flag the whole card
     * hangs off, and a peer that could spend without it could refill the line
     * in the middle of a firefight. */
    d.roster.points = 999;
    d.closeMuster();
    pump(0.3);
    const s1 = d.roster.strength;
    wire.up.push({ t: 'muster', u: dear.type });
    wire.up.push({ t: 'muster', done: 1 });
    pump(0.4);
    assert(d.roster.strength === s1,
      `a peer recruited ${d.roster.strength - s1} bodies with no muster open`);
    assert(d.roster.points === 999, `the purse moved to ${d.roster.points} with no muster open`);

    /* …AND THE FALLBACK DOES NOT SPEND ON A CLIENT EITHER. `main.js` calls
     * `autoMuster()` whenever the muster card cannot be drawn, and every client
     * runs that same main.js: without the shell's refusal a joining commander
     * whose card failed would walk the host's shelf and send one intent per
     * affordable rung. */
    d.roster.points = 999;
    openMuster(host);
    pump(0.3);
    const queued = wire.up.length;
    const gained = client.command.autoMuster();
    assert(gained === 0, `a shell auto-mustered ${gained} bodies for a player who was shown nothing`);
    assert(wire.up.length === queued,
      `${wire.up.length - queued} purchase intents were sent by a fallback nobody was watching`);
    return `an empty purse refused a ${dear.type} and said why; 3 illegal units and a closed `
      + `muster bought nothing; the fallback sent ${wire.up.length - queued} intents`;
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
    const { host, client, pump } = await commandPair({ host: { commandVersus: true }, start: false });
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
    /**
     * …AND THE OTHER MACHINE HEARD ABOUT IT.
     *
     * `beginVersus` is the only thing that makes a match and it runs on the
     * host, so a client had none — `applyMatch` returned on its first line
     * every time, and a joining commander fought a whole battle and was told
     * none of it: no countdown, no clock, no card. The record carries `sides`,
     * which is the one thing the constructor needs.
     */
    assert(client.match, 'the joining commander never got a match at all');
    assert(client.match.phase === 'match-over',
      `the joining commander's copy is still in phase '${client.match.phase}'`);
    assert(client.match.winner === host.match.winner,
      `the two machines disagree about who took the field: ${host.match.winner} v ${client.match.winner}`);
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

  check('command/versus: four commanders are two sides, two armies and a battle that can end', async () => {
    /**
     * 2v2, DRIVEN — and until it was, every part of it was broken in a way that
     * looked fine one commander at a time.
     *
     * `formUp` has always laid its anchors out alternating down one line and
     * `assignArmies`' own note said the extras "share, which is correct". Both
     * of those are statements about a 2v2 and neither had ever been run. At
     * four commanders, before this:
     *
     *   sides      0 / 2 / 3 / 4        `sideTeam(i)` — a side each
     *   armies     republic / separatist / republic / separatist   (four Jedi)
     *              separatist / republic / republic / separatist   (sith,
     *                                    jedi, jedi, sith — measured)
     *   anchors    i=0 and i=2 share the −z end, 14 m apart;
     *              i=4 lands on i=2's exact ground
     *
     * Read those three together and the field is incoherent. Commanders 0 and 2
     * lead the SAME army and stand 14 m apart at the same end — and they are on
     * DIFFERENT sides, so `enlistBody` puts their bodies on different teams and
     * two identical Republic lines in identical white armour open fire on each
     * other before either has seen the enemy. There are two armies on the
     * roster, so a third side has no units, no paint and no enemy list to be
     * given.
     *
     * So the sides come from `assignSides` — the rule the duel already uses,
     * whose own note says a four-player session is 2v2 in roster order — capped
     * at `ARMY_IDS.length`, and an army belongs to a SIDE so allies share one.
     * That pairing then hands `DuelMatch` the same side number twice, and its
     * round test is `sides.filter((s) => standing[s] > 0)`: two entries for one
     * surviving side reads as two survivors and the round never closes. Hence
     * the match is built from the sides in play, each named once — asserted
     * below, because it is invisible until somebody wins.
     *
     * Nothing about two commanders changes, which is every session that has run.
     */
    const { PAIR_SPACING, VERSUS_SEPARATION } = await import('../../src/game/Command.js');
    const { host, pump } = await commandPair({ host: { commandVersus: true }, start: false });
    for (const n of ['B', 'C', 'D']) await joinAsCommander(host, { id: n, name: `RIVAL-${n}` });
    const cs = host.beginVersus();
    const d = host.command;

    assert(cs.length === 4, `four players produced ${cs.length} commanders`);
    const sides = cs.map((c) => c.side);
    assert(new Set(sides).size === 2,
      `four commanders were put on ${new Set(sides).size} sides (${sides.join('/')}) — `
      + 'there are two armies on the roster, so a third side has no units and no colour');
    assert(sides[0] === sides[2] && sides[1] === sides[3] && sides[0] !== sides[1],
      `the sides came out ${sides.join('/')} — evens and odds are what formUp's anchors assume`);

    /* ALLIES SHARE AN ARMY. The paint is the only thing on the field that says
     * whose line is whose, so an ally in the enemy's colours is worse than no
     * colour at all. */
    const ids = cs.map((c) => c.army.id);
    assert(ids[0] === ids[2] && ids[1] === ids[3],
      `the four armies came out ${ids.join('/')} — two allies are in opposing colours`);
    assert(ids[0] !== ids[1], `both sides are fielding ${ids[0]}`);
    for (const c of cs) assert(c.foe.id === (c.army.id === ids[0] ? ids[1] : ids[0]),
      `${c.army.id} believes its enemy is ${c.foe.id}`);

    /* TWO ENDS OF ONE FIELD, with the allies beside each other rather than in
     * each other's ranks. */
    const gap = (a, b) => Math.hypot(a.anchor.x - b.anchor.x, a.anchor.z - b.anchor.z);
    assert(Math.abs(gap(cs[0], cs[1]) - VERSUS_SEPARATION) < 1,
      `the two sides formed up ${gap(cs[0], cs[1]).toFixed(1)} m apart, not ${VERSUS_SEPARATION}`);
    assert(Math.abs(gap(cs[0], cs[2]) - PAIR_SPACING) < 0.5,
      `two allies are ${gap(cs[0], cs[2]).toFixed(1)} m apart, not ${PAIR_SPACING}`);
    assert(Math.abs(gap(cs[1], cs[3]) - PAIR_SPACING) < 0.5,
      `the other pair is ${gap(cs[1], cs[3]).toFixed(1)} m apart`);

    /* FOUR ARMIES ON THE FIELD, each wearing its commander's side. */
    const bodies = (c) => host.enemies.filter((e) => e.cmdr === c && !e.dead);
    const counts = cs.map((c) => bodies(c).length);
    assert(counts.every((n) => n >= 8), `the four armies deployed ${counts.join('/')} bodies`);
    for (let i = 0; i < 4; i++) {
      assert(bodies(cs[i]).every((e) => e.team === sides[i]),
        `an army of ${cs[i].army.id} is standing on a side its commander is not on`);
    }
    /* Two rings 20 m apart do not interleave: an allied body is nearer its own
     * anchor than its ally's, which is what makes an order readable. */
    const strays = bodies(cs[0]).filter((e) =>
      e.position.distanceTo(cs[2].anchor) < e.position.distanceTo(cs[0].anchor));
    assert(!strays.length,
      `${strays.length} of ${counts[0]} bodies deployed into their ally's ranks`);

    /* THE MATCH IS BUILT FROM THE SIDES IN PLAY, EACH NAMED ONCE — the field
     * that decides whether this can ever end. */
    assert(host.match, 'a 2v2 has no match at all');
    assert(host.match.sides.length === 2,
      `the match was built with ${host.match.sides.length} sides (${host.match.sides.join('/')}) — `
      + 'a repeated side counts a wiped-out army as a survivor and the round never closes');
    assert(new Set(host.match.sides).size === host.match.sides.length, 'the match has a duplicate side');

    /* NOBODY SHOOTS THEIR ALLY. `_hostilesFor` is the list a trooper's target
     * is picked out of — called rather than restated, because a second idea of
     * who is opposed to whom is the one thing a 2v2 cannot survive. */
    const mine = bodies(cs[0])[0];
    const foes = host._hostilesFor(mine);
    const allyBodies = new Set(bodies(cs[2]));
    const foeBodies = new Set(bodies(cs[1]));
    assert(![...foes].some((e) => allyBodies.has(e)),
      'a trooper is offered its own ally as a target');
    assert([...foes].some((e) => foeBodies.has(e)), 'a trooper is offered nothing to fight');
    assert(!foes.includes(cs[2].player), "a trooper is offered its ally's commander as a target");
    assert(foes.includes(cs[1].player), 'a trooper is not offered the opposing commander');

    /* …AND IT ENDS. Ordered forward, then decided by wiping one side out
     * through the same `onEnemyKilled` door the mode's own permadeath uses —
     * decisive rather than waiting out a 120 m advance, because what is under
     * test is `DuelMatch`'s census over the sides and not the walk. */
    for (const c of cs) d.order('charge', c);
    let picks = 0, allyPicks = 0;
    for (let i = 0; i < 6; i++) {
      pump(2);
      for (const e of host.enemies) {
        const t = e.target;
        if (!t || t.team === undefined) continue;
        if (t.team === e.team) allyPicks++; else picks++;
      }
    }
    assert(allyPicks === 0, `${allyPicks} troopers picked a target on their own side`);

    const doomed = [cs[1], cs[3]];
    for (const c of doomed) {
      for (const t of c.roster.living) {
        const b = t.body;
        if (!b || b.dead) continue;
        b.hp = 0;
        b.die(b.position.clone(), null, 'check');
      }
      if (c.player) c.player.alive = false;
    }
    for (let i = 0; i < 12 && host.match.phase !== 'match-over'; i++) pump(1);
    assert(host.match.phase === 'match-over',
      `one side has nothing standing and the meeting is still in phase '${host.match.phase}' — `
      + `census ${JSON.stringify(d.census().standing)}`);
    assert(host.match.winner === sides[0],
      `side ${host.match.winner} took the field; ${sides[0]} is the one still standing`);
    return `4 commanders → sides ${sides.join('/')}, armies ${ids.join('/')}, `
      + `${counts.join('/')} bodies, allies ${gap(cs[0], cs[2]).toFixed(0)} m apart and `
      + `${gap(cs[0], cs[1]).toFixed(0)} m from the enemy; ${picks} target picks across the line, `
      + `${allyPicks} within it; side ${host.match.winner} took the field`;
  });

  check('command/versus: a host who deploys into a meeting alone is told there is nobody there', async () => {
    /**
     * THE COST OF THE FIX THAT CAME BEFORE THIS ONE.
     *
     * A meeting used to build its `DuelMatch` whatever the roster held, so a
     * host who turned versus on and pressed Ignite alone was handed the field
     * three seconds later against nobody. That was fixed by refusing to make a
     * match with one side in it — correctly — and the price was silence: an
     * army deployed onto an empty plain, a countdown that never starts, and
     * nothing anywhere saying why. From the player's chair those two failures
     * are the same failure.
     *
     * Said ONCE per spell of being alone, and said again if the opponent
     * leaves: `beginVersus` is idempotent and main.js calls it on every roster
     * change, so an unguarded notify is a banner every time a name moves.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const { host } = await commandPair({ host: { commandVersus: true }, start: false });
    const notes = [];
    host.onNotify = (title, sub) => notes.push(`${title} — ${sub}`);

    host.beginVersus();
    assert(!host.match, 'a meeting against nobody has a match, and it is one this host wins');
    const alone = notes.filter((n) => /opponent/i.test(n));
    assert(alone.length === 1,
      `a host deploying into an empty meeting was told about it ${alone.length} times: `
      + `${notes.join(' | ') || '(nothing was said at all)'}`);
    assert(/second commander/i.test(alone[0]),
      `the notice says '${alone[0]}', which does not say what is missing`);

    /* Idempotent: main.js calls this again on every roster change. */
    host.beginVersus();
    host.beginVersus();
    assert(notes.filter((n) => /opponent/i.test(n)).length === 1,
      `the notice repeated ${notes.filter((n) => /opponent/i.test(n)).length} times across three calls`);

    /* …and it stops the moment somebody arrives. */
    await joinAsCommander(host, { team: SIDES[1] });
    host.beginVersus();
    assert(host.match && host.match.sides.length === 2, 'the match was not made when the rival arrived');
    assert(notes.filter((n) => /opponent/i.test(n)).length === 1,
      'the host is still being told it has no opponent after one arrived');
    return `'${alone[0]}' said once across three lone calls, and not again once a rival joined`;
  });

  check('command/versus: a joining commander\'s order re-forms their OWN line', async () => {
    /**
     * `applyOrder` CALLED `order(f)`, WHICH DEFAULTS TO `commanders[0]`.
     *
     * In co-op that is right and is the whole point — one army, everybody in
     * the session leading it, so a peer's key and the host's reach the same
     * line, and the check above asserts exactly that. In a MEETING it is the
     * defect the mode exists to remove: the joining commander's formation key
     * re-formed the HOST's army, in the host's colours, and their own line
     * never moved. Both players then watched an army take a formation neither
     * of them had ordered for it.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const { FORMATIONS } = await import('../../src/game/Command.js');
    const { host, pump } = await commandPair({ host: { commandVersus: true }, start: false });
    await joinAsCommander(host, { team: SIDES[1] });
    const cs = host.beginVersus();
    pump(1);

    const was = cs.map((c) => c.formation);
    /* OFF THE SHIPPED TABLE, not typed. Written as `was === 'wedge' ? … :
     * 'wedge'` first, and `wedge` is not a formation this game has — the order
     * was refused for being nonsense and the check read that as a routing
     * failure, which is a check manufacturing a defect out of its own typo. */
    const want = Object.keys(FORMATIONS).find((k) => k !== was[1]);
    assert(want, `FORMATIONS holds only ${Object.keys(FORMATIONS).join('/')}`);
    assert(was[0] === was[1], `the two commanders opened in ${was.join('/')}`);
    /* Through the wire, from the peer's machine: the same message `requestOrder`
     * writes, routed by the same table. */
    const took = host.applyOrder('PEER', { t: 'order', f: want });
    assert(took !== false, `the host refused the joining commander's order for ${want} outright`);
    pump(0.5);

    assert(cs[1].formation === want,
      `the joining commander ordered ${want} and their line is in ${cs[1].formation}`);
    assert(cs[0].formation === was[0],
      `the host's army went ${was[0]} → ${cs[0].formation} on somebody else's order`);
    /* …and the host's own key still moves the host's own line. */
    host.command.order(want);
    assert(cs[0].formation === want, `the host's own order left it in ${cs[0].formation}`);
    return `peer ordered ${want}: their line ${was[1]} → ${cs[1].formation}, `
      + `the host's stayed ${was[0]} until its own key`;
  });

  check('command/versus: putting the peer\'s order on the wire cannot change which army they lead', async () => {
    /**
     * A FIELD THAT LOOKS LIKE IT IS MISSING, MEASURED RATHER THAN ADDED.
     *
     * `LOOK_KEYS` leaves `order` off the wire — "it grants boons rather than
     * describing a face" — so `World.beginVersus` reads every commander as the
     * HOST's own order, and the obvious reading is that a Sith joining a Jedi
     * is silently recorded as a second Jedi and handed an army list they did
     * not choose. The field was added on that reasoning and taken off again on
     * this measurement, which is kept here so the next reader does not spend
     * the same hour on it.
     *
     * `assignArmies` gives the FIRST commander what they ask for and resolves
     * every conflict after that against what is already taken. With two armies
     * on the roster there is exactly one left after the first pick, so the
     * second side gets it whatever it wanted — and every commander after that
     * shares their side's. So the peer's real order cannot move the answer, and
     * a wire field whose reader cannot change an outcome is bandwidth plus a
     * maintenance cost. It becomes worth sending the day there is a third army,
     * and this check is what will say so: enumerated rather than argued, so it
     * fails the moment `ARMY_IDS` grows.
     */
    const Cmd = await import('../../src/game/Command.js');
    const { assignSides } = await import('../../src/game/Player.js');
    const ORDERS = ['jedi', 'sith'];
    const ids = (a) => a.map((x) => x.id).join('/');
    let differ = 0, total = 0;
    for (let n = 2; n <= 4; n++) {
      const seats = assignSides(Array.from({ length: n }, (_, i) => ({ id: i })), Cmd.ARMY_IDS.length);
      const sides = Array.from({ length: n }, (_, i) => seats.get(i));
      const combos = [[]];
      for (let k = 0; k < n; k++) combos.splice(0, combos.length,
        ...combos.flatMap((c) => ORDERS.map((o) => [...c, o])));
      for (const real of combos) {
        total++;
        /* What the host actually sees today: every commander read as its own
         * settings, which is the host's. */
        const blind = real.map(() => real[0]);
        if (ids(Cmd.assignArmies(real, sides)) !== ids(Cmd.assignArmies(blind, sides))) differ++;
      }
    }
    assert(total === 28, `${total} rosters enumerated, expected 28`);
    assert(Cmd.ARMY_IDS.length === 2,
      `there are ${Cmd.ARMY_IDS.length} armies now — the peer's order is no longer inert, `
      + `and ${'order'} belongs back on LOOK_KEYS`);
    assert(differ === 0,
      `the peer's stated order changes the army in ${differ} of ${total} rosters — it is `
      + 'no longer a field with no reader and should be on the wire');
    const { LOOK_KEYS } = await import('../../src/net/Net.js');
    assert(!LOOK_KEYS.includes('order'),
      'order is on the wire and, measured, nothing it reaches can act on it differently');
    return `${differ} of ${total} rosters change with the peer's real order, over `
      + `${Cmd.ARMY_IDS.length} armies — so it stays off the wire`;
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
