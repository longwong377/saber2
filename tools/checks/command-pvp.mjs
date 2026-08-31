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
    else {
      a.world.director.start(1);
      /**
       * …AND THE HOST HOLDS A BODY FOR THE PEER, WHICH IT DID NOT.
       *
       * `applyClaim(peerId, msg)` resolves the claimant out of `world.remotes`
       * and then asks `canHarm` whether that player may touch the body being
       * claimed — and its own note records what the gate is for: "in co-op it
       * is a peer shooting your named troopers in the back". It also records
       * the deliberate exception, "a NULL `by` keeps today's behaviour on
       * purpose: an unattributed claim is the environment".
       *
       * This fixture never seated a body for the peer, so every claim it
       * routed arrived unattributed and took that exception. What came through
       * the hole was not malice and not a forgery — it was the client's own
       * honest `_reconcileClaims`, billing the host for damage the host had
       * already dealt itself. The client fires replicated bolts into its own
       * pool (`_spawnNetBolts`) and resolves them against its own mirrors, so
       * a hostile round is simulated on BOTH machines; the host applies it,
       * the client applies it to its copy, and the reconciler sends the
       * difference back as a claim. Measured on this pair with the joining
       * player idle and nothing but `idleInput` on either end: **a 39.4 hp
       * claim against one of the host's own named troopers**, and 5 of 9
       * unattended trooper deaths over twenty five-second runs were that road
       * rather than the battle. Seat the body and the shipped gate refuses all
       * of it — 0.0 hp of `remote` damage to a trooper over the same runs.
       *
       * So the pair was quietly proving the opposite of `command/net: a co-op
       * partner cannot shoot your army`, by a door that check does not look
       * at. A real host always has this body; `bootPair` in _coop.mjs builds
       * it on the first avatar packet and says why. Here it is built up front,
       * because it is not what is being measured — it is the state every
       * co-op session is already in.
       *
       * CO-OP ONLY. A meeting's peers arrive through `joinAsCommander`, which
       * seats its own body with a side on it and re-runs `beginVersus` around
       * it; a second `PEER` standing here would be a body with no commander in
       * the one fixture whose whole subject is which commander leads whom.
       */
      const { RemoteAvatar } = await import('../../src/net/Net.js');
      const peer = new RemoteAvatar(a.world, { id: 'PEER', name: 'ALPHA', team: a.world.partyTeam });
      (a.world.remotes || (a.world.remotes = new Map())).set(peer.id, peer);
      a.world.players.push(peer);
    }
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

  check('meeting: the front moves, and only for a line that is gathered AND forward', async () => {
    /**
     * THE FRONT IS THE MODE, AND UNTIL NOW `versus` RETURNED BEFORE IT.
     * `CommandDirector.update` reads `if (this.versus) { this._troops(); return; }`
     * — so a meeting ran two armies at each other and never asked who was
     * taking the ground. It was a deathmatch with a roster.
     *
     * `lineIsUp(c)` has always taken a commander and nothing ever passed one.
     * `_front` asks it of both, and this asserts the two clauses that make the
     * answer a battle rather than a race:
     *
     *   A SCATTERED ARMY TAKES NOTHING, however far forward it is.
     *   AN ARMY STANDING ON GROUND IT HOLDS TAKES NOTHING either — the quorum
     *     has to be PAST the front, or holding would read as advancing.
     *
     * Driven on the director directly rather than through a session: the rule
     * is about two rosters and a scalar, and a wire between them would only add
     * a way for this to fail for a reason it is not about.
     */
    const { host } = await commandPair({ host: { commandVersus: true }, start: false });
    /**
     * TWO COMMANDERS, THROUGH THE DOOR A SECOND ONE REALLY ARRIVES BY.
     *
     * `commandPair` leaves a meeting unstarted, which is right for the six
     * other versus checks and useless here: a front is a quantity between two
     * armies, and `beginVersus` builds one commander per LIVING PLAYER — so a
     * host standing alone gets one, and the whole subject of this check is
     * missing. Seating a second `CommandDirector.commanders` entry by hand
     * would be a fixture inventing the thing under test.
     *
     * So the opponent's body arrives first and `beginVersus` is asked
     * afterwards, which is the real order: its own note says it "is idempotent
     * and runs again when that body appears, which is where the match is
     * really made", and main.js calls it on every roster change for exactly
     * this reason. What comes out is a meeting the game built — two sides from
     * `assignSides`, an army each, and a `DuelMatch` over both.
     */
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const rival = new RemoteAvatar(host, { id: 'RIVAL', name: 'BRAVO' });
    (host.remotes || (host.remotes = new Map())).set(rival.id, rival);
    host.players.push(rival);
    host.beginVersus();

    const d = host.command;
    assert(d && d.versus, 'no meeting director');
    assert(d.commanders.length >= 2, `a meeting with ${d.commanders.length} commander(s)`);
    assert(d.commanders[0].side !== d.commanders[1].side,
      `both commanders came out on side ${d.commanders[0].side} — assignSides did not split them`);

    const half = 60;                                   // VERSUS_SEPARATION / 2
    /* Put each commander's living men where the arm wants them. `lineIsUp` is
     * a quorum inside MORALE.NEAR of the commander, so moving the commander and
     * his men together is what makes a line "up". */
    const place = (c, z, gathered) => {
      const men = c.roster.living.filter((t) => t.body && !t.body.dead);
      if (c.player) c.player.position.set(0, 0, z);
      men.forEach((t, i) => {
        // gathered: all inside NEAR of him. scattered: strung out down the field.
        t.body.position.set(gathered ? (i % 4) * 1.5 - 2 : 0, 0, gathered ? z + (i % 3) : z + 20 + i * 9);
      });
      return men.length;
    };
    const A = d.commanders[0], B = d.commanders[1];
    const step = (n) => { for (let i = 0; i < n; i++) d._front(1 / 30); };

    // 1 — A gathered and forward, B scattered: the front moves A's way (toward -1)
    d.front = 0;
    place(A, -20, true);
    place(B, 40, false);
    step(60);
    const afterA = d.front;
    assert(afterA < -0.01,
      `A was gathered and forward against a scattered B and the front read ${afterA.toFixed(3)}`);

    // 2 — both gathered and forward: a contested front holds
    d.front = 0;
    place(A, -20, true);
    place(B, 20, true);
    step(60);
    assert(Math.abs(d.front) < 1e-6,
      `both lines up and forward and the front still moved to ${d.front.toFixed(3)} — a contested front must hold`);

    // 3 — A gathered but BEHIND the front: holding is not advancing
    d.front = -0.8;                                    // deep in B's ground already
    place(A, 40, true);                                // and A's line is back at home
    place(B, 50, false);
    const was = d.front;
    step(60);
    assert(Math.abs(d.front - was) < 1e-6,
      `a line standing on ground it already holds advanced the front ${was.toFixed(3)} → ${d.front.toFixed(3)}`);

    // 4 — the baseline ends it, through the one door that ends a meeting
    let ended = null;
    host._endMeeting = (w) => { ended = w; };
    d.done = false;
    d.front = -0.99;
    place(A, -80, true);
    place(B, 40, false);
    step(120);
    assert(ended !== null, `the front reached ${d.front.toFixed(2)} and no meeting ended`);
    /* SIDE 0 DRIVES THE FRONT TOWARD −1, so a front at −1 is side 0 standing on
     * side 1's baseline and side 0 is the winner. Written out because the sign
     * caught the first draft of this check rather than the code: a reader who
     * reasons from "−1 is side 1's end of the field" gets it backwards. */
    assert(ended === A.side,
      `side ${ended} was credited with a front side ${A.side} drove to the far baseline`);
    return `scattered B → front ${afterA.toFixed(2)} · both up → held · behind → held · baseline ended it for side ${ended}`;
  });

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

  check('command/coop: two, three or four players — ONE roster, a squad each, one purse', async () => {
    /**
     * FLAGSHIP §9, DRIVEN ON THE SIDE IT IS ACTUALLY ABOUT.
     *
     * "`SQUAD = 5` is already the unit and `CommandRoster.squads()` already
     * slices the living list into fives. Four players take four squads out of
     * one roster of up to 24."
     *
     * The 2v2 check further down measures the same machinery on OPPOSED
     * commanders, where two rosters are correct. This is the co-op case — four
     * people on one side — and until `World.seatAlly` existed it was not
     * reachable at all: nothing outside `beginVersus` had ever called
     * `enlistCommander`, so a peer joining a Command run got a blade, a body
     * and no army.
     *
     * Four properties, and each of them is a thing four private rosters got
     * wrong:
     *
     *   ONE ROLL, so `taken` is one set and two men cannot answer to one name.
     *   ONE PURSE, which is §9's actual co-op mechanic — "a Heavy for your
     *     squad or an ARC for mine" is only a conversation if it is one shop.
     *   A PARTITION. Every living man is led by exactly one commander: no body
     *     is steered by two frames and none is steered by none.
     *   IT RE-DEALS. A player leaving is the second defect §9 names, and with
     *     one roster the answer is that their squads are simply somebody
     *     else's on the next call.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const Cmd = await import('../../src/game/Command.js');
    const rows = [];
    /**
     * TWO, THREE AND FOUR, and THREE is the one that had never been run.
     *
     * "obviously everything needs to work with 3-player coop if it already
     * doesn't." This check was written at four and every number in it was a
     * literal four — `cs.length === 4`, `solo + 3 * SQUAD`, three joiners by
     * name — so a rule that happened to hold at four and break at three would
     * have passed. Nothing here is a party size any more: the joiners are
     * `n - 1` of them, the line is `solo + (n - 1) * SQUAD` capped at the
     * mode's own ceiling, and the departure clause runs at every size, so the
     * re-deal is measured with two commanders left as well as with three.
     */
    for (const n of [2, 3, 4]) {
    const { host } = await commandPair({ start: false });
    const d = host.command;
    assert(d && !d.versus, 'this fixture is not a co-op world');

    const solo = d.roster.strength;
    const players = [];
    for (const name of ['B', 'C', 'D'].slice(0, n - 1)) {
      /* `dispose` because this loop unloads the world between party sizes, and
       * `World.unload` disposes every player — a stub standing in for a peer
       * has to carry the one method the teardown calls on it. */
      const p = { name, isLocal: false, alive: true, dead: false, hp: 100,
        team: d.commander.side, order: 'jedi', position: host.player.position.clone(),
        actor: { setPosition() {} }, dispose() {} };
      players.push(p);
      host.players.push(p);
      const c = d.enlistCommander({ player: p, side: d.commander.side, army: d.commander.army });
      assert(c, `${name} was seated with no commander`);
    }
    const cs = d.commanders;
    assert(cs.length === n, `${n} players produced ${cs.length} commanders`);

    /* ONE ROLL. */
    const rosters = new Set(cs.map((c) => c.roster));
    assert(rosters.size === 1,
      `${n} players on one side hold ${rosters.size} rosters — that is ${n} private armies`);
    const roll = d.roster.all;
    const names = new Set(roll.map((t) => t.name));
    assert(names.size === roll.length,
      `${roll.length} named bodies and ${names.size} distinct names`);

    /* THE LINE GREW BY A SQUAD A PLAYER, capped by the mode's own ceiling. */
    const want = Math.min(Cmd.MAX_STRENGTH, solo + (n - 1) * Cmd.SQUAD);
    assert(d.roster.strength === want,
      `${n} players field ${d.roster.strength} men; one opened with ${solo} and each joiner brings `
      + `${Cmd.SQUAD} up to ${Cmd.MAX_STRENGTH}, so it should be ${want}`);

    /* ONE PURSE. */
    d.roster.points = 37;
    for (const c of cs) {
      assert(c.roster.points === 37, 'two allies are shopping in two different shops');
    }

    /* A PARTITION: every living man led exactly once. */
    const seen = new Map();
    const per = cs.map((c) => {
      const mine = d.led(c);
      for (const t of mine) seen.set(t, (seen.get(t) || 0) + 1);
      return mine.length;
    });
    const twice = [...seen].filter(([, n]) => n > 1);
    assert(!twice.length,
      `${twice.length} men are being led by two commanders at once — two formations solving one body`);
    const orphans = d.roster.living.filter((t) => !seen.has(t));
    assert(!orphans.length, `${orphans.length} living men are led by nobody`);
    assert(per.reduce((a, b) => a + b, 0) === d.roster.strength, 'the shares do not sum to the line');
    assert(per.every((n) => n > 0), `the shares came out ${per.join('/')} — somebody leads nothing`);

    /* AND A PLAYER LEAVES. The avatar goes out of `world.players` exactly as
     * main.js does it, and the Commander goes with it. */
    const gone = players[0];
    host.players.splice(host.players.indexOf(gone), 1);
    const dropped = d.dismissCommander(gone);
    assert(dropped, 'the departed player kept their Commander');
    assert(d.commanders.length === n - 1,
      `${d.commanders.length} commanders after one of ${n} left`);
    assert(!d.commanders.some((c) => c.player === gone), 'the orphan is still in the list');
    assert(d.roster.strength === want, `${want} men before the peer left and ${d.roster.strength} after`);
    const seen2 = new Map();
    for (const c of d.commanders) for (const t of d.led(c)) seen2.set(t, (seen2.get(t) || 0) + 1);
    const stranded = d.roster.living.filter((t) => !seen2.has(t));
    assert(!stranded.length,
      `${stranded.length} of the departed player's men are led by nobody — the squads did not re-deal`);
    assert(![...seen2.values()].some((n) => n > 1), 'a man is led twice after the re-deal');

    rows.push(`${n}: ${roll.length} men, ${names.size} names, squads ${per.join('/')}, `
      + `${d.commanders.length} left after a departure, 0 orphans`);
    host.unload();
    }
    return rows.join(' · ');
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

    /**
     * THE SUBJECT IS HELD STILL FOR THE REPLAY, and it was not.
     *
     * `_boltHitTest`'s player loop opens `if (!p.alive || p.invuln > 0) continue`
     * — the half second the first landed bolt buys, and the fight itself. Both
     * belong in the game and neither belongs in a replay of fifty bolts against
     * one segment: after the first hit the rest of the volley is skipped, and
     * after thirty seconds of a real battle the joining player can be dead
     * before the loop starts. The control below then reads ZERO hostile hits and
     * says the hit test is not answering, which is the check manufacturing a
     * defect out of its own fixture — seen once in ten runs, as
     * *"none of the horde's 51 bolts could reach the joining player either"*.
     *
     * The question being asked here is geometric and about sides: may this
     * bolt, fired by this owner, reach this body. So the body is restored
     * before every single call, in BOTH arms — which also makes the assertion
     * above strictly stronger, because every allied bolt now gets a live target
     * with no invulnerability to hide behind rather than one that went numb
     * after the first contact.
     */
    const hpBefore = p.hp;
    const ask = (b) => {
      p.invuln = 0; p.hp = p.maxHp; p.alive = true;
      return client._boltHitTest(b, from, to);
    };

    let struck = 0;
    for (const b of yours) {
      const res = ask(b);
      if (res && res.victim === p) struck++;
    }
    assert(!struck,
      `${struck} of ${yours.length} of your own troopers' bolts hit the joining player `
      + `through the shipped hit test (they were on ${hpBefore} hp when the replay began)`);

    /**
     * THE CONTROL, AND IT IS WHY THIS IS NOT A CHECK THAT PASSES ON A BROKEN
     * HIT TEST. The horde's bolts go through the same call, on the same
     * geometry, on the same machine, and with the same body restored between
     * each of them — so every one of them has to land, and one that does not is
     * a bolt that missed a segment drawn through the chest it is aimed at.
     */
    let hordeHits = 0;
    for (const b of theirs) {
      const res = ask(b);
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
    /**
     * IT IS A SET, NOT A COUNT, AND THAT IS THIS SESSION'S CORRECTION.
     *
     * This read `after === before + 1` — one hand-dealt kill, one more name on
     * the list — and it was green for as long as the only man who could die
     * was the one this check killed. That stopped being true the moment
     * `_boltHitTest` let a hostile bolt reach a body in `world.enemies`: your
     * named troopers live in that array, and until then the enemy's rifles
     * could not touch them. The commit that fixed it measured the difference
     * on the mode's own ground — "after, same world, idle player: 7 of 10 down
     * in 60 s" — and a wave with a gun emplacement in it now kills somebody
     * every eleven seconds with nobody aiming at anything. Measured on this
     * fixture: **9 of 20 five-second runs lose a man to the horde**, so an
     * exact delta over the two seconds this check pumps is a coin toss, and it
     * fails as `0 → 2` with both casualties perfectly real.
     *
     * A count also never asserted the thing the label promises. `0 → 2` reads
     * like one death counted twice and cannot be — `CommandRoster.fall` is
     * idempotent by construction and one trooper is one row — so the count was
     * both flaky AND blind to the defect it looked like it was guarding.
     *
     * So the property is written out directly, on names:
     *
     *   the man this check killed is on the joining player's casualty list;
     *   nothing is on that list the host does not also have dead — the client
     *     may lag the host by up to ARMY_INTERVAL and may never lead it, so
     *     this direction is the race-free one and it is the one a phantom or a
     *     re-applied death would break;
     *   one row per name, which is what "counted twice" would actually look
     *     like on a roll.
     *
     * Whatever else the battle took is reported rather than asserted, because
     * it is the battle.
     */
    const { host, client, pump } = await commandPair({ trim: 3 });
    pump(3);
    const troops = troopsOf(host);
    assert(troops.length >= 3, `only ${troops.length} troopers on the field`);

    /** The names on a machine's casualty list, off the mode's own readout. */
    const fallenOn = (w) => w.command.readout().roll.filter((t) => !t.alive).map((t) => t.name);

    const doomed = troops[0];
    const name = doomed.trooper.name;
    const before = new Set(fallenOn(client));
    assert(!before.has(name), `${name} was already on the joining player's casualty list`);
    doomed.hp = 0;
    doomed.die(doomed.position.clone(), null, 'check');
    pump(2);

    const roll = client.command.readout().roll;
    const rec = roll.find((t) => t.name === name);
    assert(rec, `${name} is not on the joining player's roll at all`);
    assert(rec.alive === false,
      `${name} is dead on the host and still standing on the joining player's roster`);
    assert(rec.diedIn != null, `${name} fell in no area on the joining player's copy`);

    const after = fallenOn(client);
    const seenNames = new Set(after);
    assert(seenNames.size === after.length,
      `the joining player's casualty list names ${after.length} men and only ${seenNames.size} of `
      + `them are distinct — a casualty is on it twice: ${after.join(' ')}`);
    const dead = new Set(fallenOn(host));
    const phantom = after.filter((n) => !dead.has(n));
    assert(!phantom.length,
      `${phantom.length} man on the joining player's casualty list is alive on the host: `
      + `${phantom.join(' ')}`);
    const alsoFell = after.filter((n) => n !== name && !before.has(n));
    return `${name} fell in area ${rec.diedIn}; ${after.length} on the joining player's list and `
      + `${dead.size} on the host's, no name twice`
      + (alsoFell.length ? `; the horde took ${alsoFell.join(' ')} in the same five seconds` : '');
  });

  check('command/net: a joining player who fires nothing bills the host for nothing', async () => {
    /**
     * ── THE SURCHARGE THE HORDE WAS PAYING FOR HAVING A SECOND PLAYER ──────
     *
     * `_reconcileClaims` bills the host for whatever hp a mirror has lost since
     * the last snapshot, "whatever dealt it" — which is the right seam and the
     * reason a guest's lightning, choke and rend all reach the host without a
     * call site each. What it cannot tell apart on its own is damage this
     * machine DEALT from damage this machine merely WATCHED, and a co-op client
     * watches a great deal: `_spawnNetBolts` puts the host's fire into the
     * client's own pool as real bolts so a guest can deflect one, and the
     * client then resolves them against its own mirrors.
     *
     * In Command that is the whole battle. Your named troopers stand in
     * `world.enemies` on the party's side, so the horde's rifles have something
     * in that array to hit and your line's rifles have the horde — every round
     * either way was simulated on both machines and charged twice. Measured on
     * this fixture before the rule, 45 s, the joining player holding
     * `idleInput` and firing nothing: **317 claims, and the host applied 42.2
     * hp of them on top of the 187.8 hp of the same bolts it had already
     * applied itself.** Co-op was roughly half again easier than the
     * single-machine numbers every tuning pass in this project was taken on.
     *
     * Two roads fed it and the second was a different defect with the same
     * shape. The gun emplacement was built by the LEVEL, so both machines had
     * one and both were firing it — a second gun on one embrasure, laid on the
     * client's own copy of the line, billed back to the host. That object is
     * gone from the tree (src/game/Armour.js), but the road it opened is not:
     * anything a LEVEL stands up exists on both machines and fires on both.
     * The deaths were the larger half of both: rounding puts the two copies a
     * point apart, the client's mirror goes down on a round the host's
     * survives, and `_reconcileClaims`' kill clause then claims that body's
     * whole remaining health every tick for the rest of the session.
     *
     * WHAT IS ASSERTED IS ZERO, which is the one figure in this file that is
     * not a coin toss: a player pressing nothing has dealt no damage, so a
     * claim with anything in it is this defect and nothing else. The battle
     * around it is reported and not scored — see the note over the casualty
     * check for why a head-count across a live battle is not an assertion.
     *
     * The second half of the rule — a guest's genuine deflection still lands
     * and is still billed — is in `tools/checks/coop.mjs`, and neither half
     * means anything without the other: a fix that stopped the client resolving
     * replicated bolts would pass this check and delete the mechanic.
     */
    const { host, client, pump, seen } = await commandPair();
    /**
     * PUMPED UNTIL THE PREMISE IS TRUE, NOT FOR A TYPED NUMBER OF SECONDS.
     *
     * This was `pump(20)`, and 20 s of a Geonosis line is plenty — alone. In a
     * FULL RUN it went red once at "0 bolts to 60 mirrors": the fixture is
     * deterministic, but the streams it draws from are not restored between
     * suites (§2.11), so which second the first rifle goes off moves with
     * whatever ran before it. The check then failed for having nothing to
     * measure, which is the honest outcome of a premise that is not yet true
     * and a bad reason to call a defect.
     *
     * So the clock is the premise's: pump in slices until fire has crossed the
     * wire onto real mirrors, and give up at 60 s. A line that has not fired a
     * round in a minute IS the defect this asserts a premise for, and the
     * message below still says so. `asked === 0` is untouched by the change —
     * an idle guest claims nothing over any length of run.
     */
    const fireSeen = () => seen.toClient.reduce((a, m) => a + (m.bf?.length || 0), 0);
    for (let t = 0; t < 60 && !(fireSeen() > 0 && client._netEnemyIndex.size > 0); t += 5) pump(5);
    const claims = seen.toHost.filter((m) => m.t === 'claim');
    const asked = claims.reduce((a, m) => a + (Number(m.d) || 0), 0);
    const fired = fireSeen();
    const mirrors = client._netEnemyIndex.size;
    assert(fired > 0 && mirrors > 0,
      `the host replicated ${fired} bolts to ${mirrors} mirrors — with no fire crossing there is `
      + 'nothing here for a client to double-bill and this check proves nothing');
    assert(asked === 0,
      `a joining player holding idleInput asked the host for ${asked.toFixed(1)} hp across `
      + `${claims.length} claims — that is the host's own fire, resolved a second time on the `
      + 'guest\'s machine and charged back, and the horde pays the difference');
    host.unload(); client.unload();
    return `${fired} replicated rounds over ${mirrors} mirrors, and an idle guest claimed nothing`;
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
    /* Who was already on the roll, so the man bought below can be named rather
     * than counted. See the deployment assertion at the foot of this check. */
    const enlisted = new Set(d.roster.all.map((t) => t.name));
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
    /* FOURTEEN SECONDS, because the army comes in on gunships now — the mode's
     * own first brief has always said so and until this session `deploy` put
     * them down out of nothing. `closeMuster` asks for ships; a flight is
     * about four seconds in the air and a roster over six needs two of them.
     * 0.6 s measured the sky. */
    pump(14);
    assert(!d.mustering, 'the host is still mustering after the joining commander was done');
    assert(!client.command.mustering && client.command.musterOffer() === null,
      'the joining commander is still holding an offer for a muster that has closed');
    assert(closes.length === 1, `the joining commander's card came down ${closes.length} times`);
    /**
     * THE MAN, NOT THE HEAD COUNT — the same correction the casualty check
     * above carries, and this is where it was found.
     *
     * This asserted `troopsOf(host).length >= before.strength + 1`: eleven
     * bodies standing where ten stood. Fourteen seconds of a live battle
     * separate that count from the purchase, and since a hostile bolt can
     * reach a body in `world.enemies` the line loses a man about every eleven
     * seconds with nobody aiming at anything — so the check failed as "10
     * bodies on the field after the muster closed — the army was not
     * deployed", with the reinforcement standing right there and one of his
     * comrades dead. It failed in one run and passed in the next for that
     * reason and no other.
     *
     * What the assertion is FOR is that a joining commander's purchase reaches
     * the ground. That is a statement about one man, and he has a name.
     */
    const recruit = d.roster.all.find((t) => !enlisted.has(t.name));
    assert(recruit, 'nothing new is on the host\'s roll at all, so nothing was deployed');
    const onField = new Set(troopsOf(host).map((e) => e.trooper?.name));
    /* Or he was deployed and then killed, which is still deployed — a name can
     * only come off the roll through `onDeath`, and `onDeath` is reached from a
     * BODY. A reinforcement who never landed cannot die. */
    assert(onField.has(recruit.name) || !recruit.alive,
      `${recruit.name} was bought and paid for and has no body on the field — `
      + `${onField.size} deployed, ${d.roster.strength} on the roll`);

    const msgs = seen.toHost.filter((m) => m.t === 'muster').length;
    return `${offer.points} points and ${offer.units.length} rungs to the joining commander, `
      + `one ${want.type} at ${want.cost} bought from there (${before.points} → ${d.roster.points}), `
      + `${msgs} intents on the wire, ${recruit.name} deployed among ${onField.size} standing`;
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

  /* ══════════════════════════════════════════════════════════════════
   *  THE COMMANDER BATTLE — MODES.versus
   * ══════════════════════════════════════════════════════════════════ */

  check('versus: THREE commanders is 2v1 and both sides field the same number of men', async () => {
    /**
     * "make sure it works for 3 players as well not just 2."
     *
     * Two and four were driven; three never was, and three is the one that was
     * wrong. `_rosterFor` shares a roster per SIDE and `_musterJoin` adds a
     * squad for every commander past the first — §9's rule, and the right one
     * for co-op Command, where everybody is on the same side and a bigger table
     * should field a bigger company. Measured on the shipped build with three
     * commanders in a meeting:
     *
     *     sides   0 / 2 / 0        armies  republic / separatist / republic
     *     rosters 15  ·  10  ·  15   ← ONE roster of 15 against one of 10
     *
     * The pair outnumbered the lone commander by half again ON TOP of being two
     * people. So `openingFor` reads the side's strength in a meeting and
     * `_musterJoin` brings nobody: a side fields what the host said it fields
     * and an ally takes a squad out of it rather than adding one.
     *
     * Everything else about three commanders is asserted here too, because
     * nothing had ever run it: the 2v1 split, one army per side with the allies
     * sharing it, two ends of one field with the pair beside each other, and a
     * match built on the two sides in play rather than on three seats.
     */
    const Cmd = await import('../../src/game/Command.js');
    const { host } = await commandPair({ host: { commandVersus: true } , start: false });
    for (const n of ['B', 'C']) await joinAsCommander(host, { id: n, name: `RIVAL-${n}` });
    const cs = host.beginVersus();
    const d = host.command;
    assert(cs.length === 3, `three players produced ${cs.length} commanders`);

    const sides = cs.map((c) => c.side);
    assert(new Set(sides).size === 2,
      `three commanders were put on ${new Set(sides).size} sides (${sides.join('/')}) — a meeting `
      + 'has two ends and a third side has no army, no paint and no enemy list');
    assert(sides[0] === sides[2] && sides[0] !== sides[1],
      `the sides came out ${sides.join('/')} — evens and odds are what formUp's anchors assume`);

    const ids = cs.map((c) => c.army.id);
    assert(ids[0] === ids[2] && ids[0] !== ids[1],
      `the armies came out ${ids.join('/')} — the two allies are in opposing colours`);
    for (const c of cs) {
      assert(c.foe.id !== c.army.id, `${c.army.id} believes its enemy is itself`);
    }

    /* THE MEASUREMENT THIS CHECK EXISTS FOR. One roster per side, so the two
     * allies' commanders answer with the same object and it is counted once. */
    const bySide = new Map();
    for (const c of cs) bySide.set(c.side, c.roster);
    assert(bySide.size === 2, `${bySide.size} rosters for two sides`);
    const strengths = [...bySide.values()].map((r) => r.living.length);
    assert(strengths[0] === strengths[1],
      `the two sides field ${strengths.join(' against ')} men — a 2v1 is already two people `
      + 'against one, and it must not also be more rifles');
    const want = d.meetingPlan.strength;
    assert(strengths[0] === want,
      `a side fields ${strengths[0]} where the host asked for ${want}`);

    /* TWO ENDS OF ONE FIELD, the pair beside each other rather than in each
     * other's ranks — the anchors formUp lays out, at three rather than four. */
    const gap = (a, b) => Math.hypot(a.anchor.x - b.anchor.x, a.anchor.z - b.anchor.z);
    assert(Math.abs(gap(cs[0], cs[1]) - Cmd.VERSUS_SEPARATION) < 1,
      `the two sides formed up ${gap(cs[0], cs[1]).toFixed(1)} m apart, not ${Cmd.VERSUS_SEPARATION}`);
    assert(Math.abs(gap(cs[0], cs[2]) - Cmd.PAIR_SPACING) < 0.5,
      `the two allies are ${gap(cs[0], cs[2]).toFixed(1)} m apart, not ${Cmd.PAIR_SPACING}`);

    /* …AND A MATCH THAT CAN END. `DuelMatch` filters `sides` for who is still
     * standing, so the same side number twice makes a wiped-out side read as
     * two survivors and the round never closes. */
    assert(host.match, 'three commanders on two sides built no match');
    assert(host.match.sides.length === 2 && new Set(host.match.sides).size === 2,
      `the match was built on sides ${JSON.stringify(host.match.sides)} — one per SEAT rather than `
      + 'one per side, so a beaten side counts as two survivors');

    /* …AND THE CENSUS AGREES, ON THE MEN. `standing` counts the commanders too,
     * so a 2v1 is legitimately one body up on the pair's side — that is the two
     * PEOPLE, which is the thing a 2v1 is. The rifles are what had to be
     * levelled, and `standing - generals` is what the men are. */
    const census = d.census();
    const menOn = (side) => census.standing[side] - census.generals[side];
    assert(menOn(sides[0]) === menOn(sides[1]),
      `the census reads ${menOn(sides[0])} men against ${menOn(sides[1])} at the top of a battle `
      + 'nobody has fought yet');
    assert(census.standing[sides[0]] - census.standing[sides[1]] === 1,
      `the pair's side is ${census.standing[sides[0]] - census.standing[sides[1]]} bodies up — a `
      + '2v1 should be exactly one, which is the second commander');
    const matchSides = JSON.stringify(host.match.sides);
    host.unload();
    return `3 commanders → 2v1 on sides ${sides.join('/')}, armies ${ids.join('/')}, `
      + `${strengths.join(' v ')} men a side, one match on ${matchSides}`;
  });

  check('versus: the host says who is with whom, and three players can be 1v2 either way', async () => {
    /**
     * "you and your friends can choose to be either allies or enemy
     * commanders."
     *
     * `assignSides` alternates down the roster, so the ONLY way to change the
     * teams was to change who joined first — a race, not a choice. `versusTeams`
     * is the host's stated map from peer id to side; it rides `SESSION_KEYS`, so
     * it is the host's answer for the table and no other machine's menu is
     * consulted, which is the other half of what the player asked for.
     *
     * Driven at three, both ways round: the host alone against the pair, and
     * the host with one of them. Neither is reachable by joining in a different
     * order — the alternation gives seats 0 and 2 to the same side, full stop.
     */
    const seatsOf = async (teams) => {
      const { host } = await commandPair({
        host: { commandVersus: true, versusTeams: teams }, start: false,
      });
      /* The ids the host's own map is keyed on: the peer id for the local
       * player and the avatar id for everybody else — `beginVersus.idOf`. */
      for (const n of ['B', 'C']) await joinAsCommander(host, { id: n, name: `RIVAL-${n}` });
      const cs = host.beginVersus();
      const out = cs.map((c) => c.side);
      host.unload();
      return out;
    };
    /* The fixture's host has no peer id, so `idOf` falls back to 'host' — which
     * is the same string the lobby writes for a host that has not connected
     * yet, and exactly the case worth pinning. */
    const alone = await seatsOf({ host: 0, B: 1, C: 1 });
    assert(alone[0] !== alone[1] && alone[1] === alone[2],
      `asked for the host alone against both, got ${alone.join('/')}`);
    const paired = await seatsOf({ host: 0, B: 0, C: 1 });
    assert(paired[0] === paired[1] && paired[1] !== paired[2],
      `asked for the host with B against C, got ${paired.join('/')}`);
    /* …AND THE ALTERNATION IS STILL THE DEFAULT, so every session that has ever
     * run is unchanged. */
    const none = await seatsOf({});
    assert(none[0] === none[2] && none[0] !== none[1],
      `with no stated sides the alternation gave ${none.join('/')}`);
    /* A CHART THAT EMPTIES THE FIELD IS REFUSED WHOLE. Everybody on one side is
     * a battle with nobody in it; a half-honoured chart would put somebody
     * somewhere nobody asked for. */
    const flat = await seatsOf({ host: 0, B: 0, C: 0 });
    assert(new Set(flat).size === 2,
      `a chart putting all three on one side was honoured — the field came out ${flat.join('/')}`);
    return `host alone ${alone.join('/')}, host+B ${paired.join('/')}, `
      + `default ${none.join('/')}, all-on-one refused → ${flat.join('/')}`;
  });

  check('versus: the win condition decides what ends it, and the clock is only one of them', async () => {
    /**
     * "you basically fight to the death with different win conditions."
     *
     * The shipped meeting had exactly one ending and nobody had been told about
     * it: `pvpRules` gives a round 120 seconds and decides it on remaining
     * health, so two armies that did not wipe each other out inside two minutes
     * drew on a timer. Measured on a real pair: 124 s, `10 v 10 -> 10 v 10`, and
     * that was the whole session.
     *
     * Three conditions now, and this asserts the two things that make them real
     * rather than three words on three cards: the CENSUS each one counts, and
     * the CLOCK each one runs on. `annihilation` and `commanders` have no timer
     * at all — a battle to the last man cannot be won by running away — and
     * `rounds` is the one that keeps the old behaviour and says so on its card.
     */
    const Cmd = await import('../../src/game/Command.js');
    const { PVP_LIMITS } = await import('../../src/game/Player.js');
    for (const [key, W] of Object.entries(Cmd.VERSUS_WINS)) {
      assert(W.label && W.blurb && W.blurb.length > 20, `${key} has no card worth reading`);
      assert(W.counts === 'standing' || W.counts === 'generals',
        `${key} counts "${W.counts}", which no census answers`);
    }
    const cfg = (win) => Cmd.versusCommandConfig({ versusWin: win });
    assert(cfg('nonsense').win === 'annihilation', 'an unknown condition was accepted');
    assert(cfg().win === 'annihilation', 'the default is not the fight to the death');

    /* THE CENSUS EACH ONE COUNTS, on a real three-commander field: the generals
     * are a strict subset of what is standing, and they are what `commanders`
     * is decided on. */
    const { host } = await commandPair({ host: { commandVersus: true }, start: false });
    for (const n of ['B', 'C']) await joinAsCommander(host, { id: n, name: `RIVAL-${n}` });
    host.beginVersus();
    const c = host.command.census();
    assert(c.generals, 'census() reports no generals, so the commanders condition cannot be read');
    for (const side of Object.keys(c.standing)) {
      assert(c.generals[side] <= c.standing[side],
        `side ${side} has ${c.generals[side]} generals standing out of ${c.standing[side]} bodies`);
      assert(c.generals[side] > 0, `side ${side} opened the battle with no commander standing`);
    }
    const total = Object.values(c.generals).reduce((a, n) => a + n, 0);
    assert(total === 3, `three commanders, ${total} generals in the census`);
    host.unload();

    /* THE CLOCK. A world built under each condition, and the rules it hands
     * `DuelMatch` — the one place `roundTime` and `rounds` are decided. */
    const H = await import('./_coop.mjs');
    const seen = [];
    for (const win of Object.keys(Cmd.VERSUS_WINS)) {
      const { world } = await H.bootWorld({
        level: 'geonosis',
        settings: { mode: 'versus', level: 'geonosis', order: 'jedi', quality: 'low',
          versusWin: win, instantSpawn: true },
      });
      assert(world.command?.versus,
        `mode 'versus' with win '${win}' did not come up as a meeting — alwaysVersus is not read`);
      const timed = Cmd.VERSUS_WINS[win].clock;
      assert(world.rules.roundTime === (timed ? PVP_LIMITS.roundTime.def : PVP_LIMITS.roundTime.max),
        `${win} runs a ${world.rules.roundTime}s round where ${timed ? 'the default' : 'no clock'} `
        + 'was asked for');
      assert(world.rules.rounds === (timed ? PVP_LIMITS.rounds.def : 1),
        `${win} is best of ${world.rules.rounds} — permadeath means a battle is one round unless `
        + 'the condition says otherwise');
      seen.push(`${win} ${world.rules.rounds}×${world.rules.roundTime}s`);
      world.unload();
    }
    return `${Object.keys(Cmd.VERSUS_WINS).length} conditions: ${seen.join(', ')}; generals are a `
      + 'subset of the standing on a real 2v1';
  });

  check('versus: reinforcements come to BOTH sides, once a side, on one clock', async () => {
    /**
     * "maybe also a mode where reinforcements come in waves so imagine like two
     * armies meeting and a frontline."
     *
     * Three properties and the third is the one three players breaks:
     *
     *   BOTH SIDES   one clock, one wave, both ends of the field. A timer per
     *                side drifts apart the moment one of them is interrupted,
     *                and a battle where one army's replacements land a beat
     *                sooner every cycle is decided by the timer.
     *   ON A CLOCK   nothing arrives before the interval and something does
     *                after it, which is what makes it a frontline rather than a
     *                bigger opening army.
     *   ONCE A SIDE  `_rosterFor` shares a roster between allies, so reinforcing
     *                every COMMANDER pays a side with two players twice. A 2v1
     *                that is also 2× the replacements is not a battle, and it
     *                is invisible at two players and at four.
     */
    const { host } = await commandPair({
      host: { commandVersus: true, versusReinforce: 20 }, start: false,
    });
    for (const n of ['B', 'C']) await joinAsCommander(host, { id: n, name: `RIVAL-${n}` });
    const cs = host.beginVersus();
    const d = host.command;
    assert(d.reinforceEvery === 20, `the director reads a ${d.reinforceEvery}s interval`);

    const bySide = new Map();
    for (const c of cs) bySide.set(c.side, c.roster);
    const before = new Map([...bySide].map(([s, r]) => [s, r.strength]));
    /* Points, or there is nothing to buy and this measures a purse rather than
     * a clock. A meeting's roster opens with the muster's own purse; topped up
     * here so the check is about the interval. */
    for (const r of bySide.values()) r.points = 500;

    /* NOTHING BEFORE THE INTERVAL. */
    d._reinforceTick(19);
    for (const [s, r] of bySide) {
      assert(r.strength === before.get(s),
        `side ${s} grew from ${before.get(s)} to ${r.strength} before the first interval was up`);
    }
    /* …AND A SQUAD AFTER IT, TO EVERY SIDE, ONCE. */
    d._reinforceTick(2);
    const after = new Map([...bySide].map(([s, r]) => [s, r.strength]));
    const grew = [...bySide.keys()].map((s) => after.get(s) - before.get(s));
    assert(grew.every((n) => n > 0),
      `the wave reached ${grew.filter((n) => n > 0).length} of ${grew.length} sides (${grew.join('/')})`);
    assert(grew[0] === grew[1],
      `the sides were reinforced by ${grew.join(' and ')} — the side with two commanders was paid twice`);

    /* AND OFF IS OFF: a standing battle gets nothing however long it runs. */
    const { host: still } = await commandPair({
      host: { commandVersus: true, versusReinforce: 0 }, start: false,
    });
    const s0 = still.command.commander.roster.strength;
    still.command.commander.roster.points = 500;
    still.command._reinforceTick(600);
    assert(still.command.commander.roster.strength === s0,
      `a standing battle grew from ${s0} to ${still.command.commander.roster.strength} men`);
    host.unload(); still.unload();
    return `nothing at 19s, +${grew.join('/+')} at 21s to both sides of a 2v1, and nothing at all `
      + 'in 600s with reinforcements off';
  });

  check('versus: a meeting composes its army instead of fielding one kind twice', async () => {
    /**
     * "at the beginning you choose the number and mixup of each of your
     * armies/the field."
     *
     * The NUMBER is `versusStrength` and the FIELD is the theatre; the MIXUP
     * was being swallowed by a rule written for a different mode. `MODES.versus`
     * declares `battles`, which is what gets it a CommandDirector at all, and
     * `battles` sets `campaign` — and a campaign is forced to rung 0 on purpose:
     * the roll at the top of a crossing is "ten identical strangers, so that the
     * three names in it four areas later are something the player earned", and
     * the composition is what the muster screen BETWEEN AREAS is for.
     *
     * A meeting has no areas and no muster screen. Under the campaign's rule it
     * fielded twenty identical clone troopers against twenty identical B1s with
     * a purse it could never spend — the opposite of what was asked for, from a
     * line of code that is right where it was written.
     *
     * So a meeting reads the contingent's own composition control, which is the
     * shelf this game already has for "what is my army made of". Asserted three
     * ways, because "it is a mix" alone would pass on an accident:
     *
     *   MIXED IS MIXED       CONTINGENT_MIXED spends the purse on the line and
     *                        then the heaviest thing left, so the roll holds
     *                        more than one kind of body.
     *   A RUNG IS THAT RUNG  asking for one rung fields that rung, which is the
     *                        half a "did it vary" test cannot see.
     *   A CAMPAIGN IS NOT    the rule it was borrowing is untouched: a Command
     *   TOUCHED              crossing still opens with identical strangers.
     */
    const Cmd = await import('../../src/game/Command.js');
    const roll = async (settings) => {
      const { host } = await commandPair({ host: settings, start: false });
      const d = host.command;
      const types = d.commander.roster.living.map((t) => t.type);
      const strength = d.commander.roster.strength;
      host.unload();
      return { kinds: new Set(types), types, strength };
    };

    const mixed = await roll({ commandVersus: true, allyUnit: Cmd.CONTINGENT_MIXED });
    assert(mixed.kinds.size > 1,
      `a mixed meeting fielded ${mixed.kinds.size} kind of body (${[...mixed.kinds].join(', ')}) — `
      + 'the purse was spent on one rung, or not spent at all');

    /* A NAMED RUNG. Rung 1 of either ladder is the second-cheapest thing, so a
     * side of twenty can afford several of them and still buy line — what is
     * asserted is that the rung ARRIVED, not that it is the whole army. */
    const rung = 1;
    const named = await roll({ commandVersus: true, allyUnit: rung });
    const wantType = Cmd.ARMIES[[...Cmd.ARMY_IDS][0]].tiers[rung].type;
    assert(named.kinds.has(wantType),
      `asked for rung ${rung} (${wantType}) and the roll came out ${[...named.kinds].join(', ')}`);

    /* …AND THE CROSSING STILL OPENS WITH STRANGERS. The rule this mode stopped
     * borrowing is the rule Command keeps. */
    const crossing = await roll({ commandVersus: false, allyUnit: Cmd.CONTINGENT_MIXED });
    assert(crossing.kinds.size === 1,
      `a Command crossing opened with ${crossing.kinds.size} kinds (${[...crossing.kinds].join(', ')}) `
      + '— the campaign\'s ten identical strangers are what its muster screen exists to change');
    return `mixed → ${[...mixed.kinds].join('+')} (${mixed.strength} men), rung ${rung} → `
      + `${[...named.kinds].join('+')}, a crossing still opens ${[...crossing.kinds].join('+')}`;
  });

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
    const { SIDES, PVP_COUNTDOWN, PVP_INTERMISSION } = await import('../../src/game/Player.js');
    const { enemyRng } = await import('../../src/game/Enemy.js');
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
    /**
     * THE BUDGET IS THE MATCH'S OWN CLOCK, AND THAT IS THE WHOLE FIX.
     *
     * This drive used to be `for (i = 0; i < 60; i++) pump(2)` — a flat 120
     * game-seconds — with a comment claiming `roundTime` was "well past this".
     * It is the other way round. `DuelMatch` spends `PVP_COUNTDOWN` before the
     * blades are live and only THEN sets `clock = roundTime`, so the latest a
     * round can be decided is 3 + 120 = 123 s, and the drive stopped at 120.
     * The three seconds it was short by are exactly the countdown it forgot.
     *
     * So it passed alone by MARGIN and not by construction: whenever one line
     * happened to wipe the other out early it ended, and whenever the fight
     * went the distance it did not. Which of those you get depends on who
     * shoots straight, and `Enemy.aimQuality` draws off `enemyRng` — a
     * module-scope stream every suite that drives a World advances. Run after
     * `cloth-cost` and `colosseum`, which is the real order in `verify` (the
     * hyphen sorts before the dot, so this file runs BEFORE command.mjs), the
     * battle was a different battle and stood at 5 v 4 with the phase still
     * 'fighting'. HANDOFF §6.2.5's "order-independence residue" in the flesh.
     *
     * TWO CHANGES AND THEY ANSWER DIFFERENT HALVES. The stream is SEEDED here,
     * as tools/checks/cloth-cost.mjs does, so the fight is the same fight
     * whatever ran before it — seeded at the last possible moment, after every
     * `await` in this check, because an async check's awaits are exactly where
     * a peer's frames get to run. And the cap is DERIVED from the rules the
     * match is actually being fought under rather than typed, so a change to
     * `PVP_LIMITS` or to the meeting's `duelRounds: 1` moves it by itself and
     * a real hang still reads as a hang instead of as a slow battle.
     */
    enemyRng.seed(20250814);
    const m0 = host.match;
    const budget = PVP_COUNTDOWN + m0.rounds * host.rules.roundTime
      + PVP_INTERMISSION * Math.max(0, m0.rounds - 1) + 4;
    let engaged = 0, closest = Infinity, spent = 0;
    while (spent < budget && host.match.phase !== 'match-over') {
      pump(2);
      spent += 2;
      const mine = host.enemies.filter((e) => e.cmdr === cs[0] && !e.dead);
      const them = host.enemies.filter((e) => e.cmdr === cs[1] && !e.dead);
      for (const e of mine) {
        if (e.target && e.target.team !== undefined && e.target.team !== e.team) engaged++;
        for (const o of them) closest = Math.min(closest, e.position.distanceTo(o.position));
      }
    }

    assert(engaged > 0, 'no trooper on either side ever picked a target on the other');
    assert(closest < 40, `the two lines never got closer than ${closest.toFixed(0)} m — they did not meet`);
    const after = cs.map((c) => c.roster.strength);
    assert(after[0] < before[0] || after[1] < before[1],
      `no casualties on either roster after ${spent} s (${before.join('v')} → ${after.join('v')})`);
    assert(host.match.phase === 'match-over',
      `the meeting is still in phase '${host.match.phase}' after ${spent} s of a ${budget} s budget `
      + `— ${after.join(' v ')} standing. That budget is the match's OWN clock `
      + `(${PVP_COUNTDOWN} s countdown + ${m0.rounds}\u00d7${host.rules.roundTime} s round), so a `
      + 'meeting that reaches it has stopped deciding rather than merely being slow');
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
      + `${engaged} target picks across the line; side ${w} took the field in ${spent} s of a `
      + `${budget} s budget, won=${ended[0].won}`;
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

    /**
     * TWO ARMIES ON THE FIELD, FOUR SQUADS — FLAGSHIP §9, and this is the
     * assertion that used to read "four armies" and measured the defect.
     *
     * It was `counts.every(n => n >= 8)`, and it passed: four commanders, four
     * `CommandRoster`s, four private lines of ten. Driven at four commanders on
     * this fixture, before one roster:
     *
     *     commanders 4 · rosters 4 · named bodies 40 · DISTINCT NAMES 39
     *
     * One duplicate, in the one mode whose entire subject is names you
     * recognise. `designate` loops against `roster.taken` to keep the promise
     * "every ally has a unique name you can see", `taken` is per roster, and
     * all four draw out of ONE seeded stream — so two commanders on the same
     * side mint the same `CT-####` and neither Set can see the other. It is not
     * a rare collision either: it is 40 draws from 8999 numbers across four
     * independent sets, which is a duplicate about half the time.
     *
     * After, on the identical fixture:
     *
     *     commanders 4 · rosters 2 · named bodies 30 · distinct names 30
     *     led per commander 10/10/5/5 · purses 11 and 11 (one a side)
     *
     * Two rosters, because a meeting is two armies and must be. Thirty rather
     * than forty because a side is now ONE line — `OPENING_STRENGTH` and one
     * `SQUAD` more for the second commander on it (see `_musterJoin`) — instead
     * of two private tens, and the odd squad stays with the commander who
     * brought the line. Zero collisions by construction rather than by care:
     * there is one `taken` per side and nothing left to keep in step.
     */
    const bodies = (c) => host.enemies.filter((e) => e.cmdr === c && !e.dead);
    const counts = cs.map((c) => bodies(c).length);
    const rosters = new Set(cs.map((c) => c.roster));
    assert(rosters.size === 2,
      `four commanders hold ${rosters.size} rosters — allies on one side are two private armies, `
      + 'two `taken` sets, and two purses');
    assert(cs[0].roster === cs[2].roster && cs[1].roster === cs[3].roster,
      'the allies are not sharing a roll');
    assert(cs[0].roster !== cs[1].roster, 'both sides are drawing off one roll');
    const all = [];
    for (const r of rosters) for (const t of r.all) all.push(t);
    const distinct = new Set(all.map((t) => t.name));
    assert(distinct.size === all.length,
      `${all.length} named bodies and ${distinct.size} distinct names — two of your men answer to `
      + 'the same designation, in the mode whose subject is names you recognise');
    assert(counts.every((n) => n >= 5),
      `the four commanders lead ${counts.join('/')} bodies — somebody was dealt no squad at all`);
    assert(counts[0] + counts[2] === cs[0].roster.strength,
      `the ${sides[0]} side leads ${counts[0] + counts[2]} of its ${cs[0].roster.strength} men`);
    /* THE PURSE IS SHARED — §9's actual co-op mechanic. */
    cs[0].roster.points = 40;
    assert(cs[2].roster.points === 40, 'two allies are shopping in two different shops');
    cs[0].roster.points = 11;
    for (let i = 0; i < 4; i++) {
      assert(bodies(cs[i]).every((e) => e.team === sides[i]),
        `an army of ${cs[i].army.id} is standing on a side its commander is not on`);
    }
    /* AND EACH SIDE MUSTERED ITS OWN ARMY'S BODIES. `formUp` used to build the
     * second commander with the defaults, muster ten of the FIRST army's
     * cheapest rung into it, and only then reassign `c.army` — so both ends of
     * every meeting fielded `Clone Trooper` and both rolls read `CT-####`. */
    for (const c of cs) {
      const kinds = [...new Set(c.roster.all.map((t) => t.type))];
      const rung = c.army.tiers.map((t) => t.type);
      const wrong = kinds.filter((k) => !rung.includes(k));
      assert(!wrong.length,
        `${c.army.id}'s roll holds ${wrong.join('/')}, which is not on its own muster ladder`);
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

  check('command/versus: the front is the host\'s, and both machines read the same one', async () => {
    /**
     * PLAN.md §4.5's KILL CRITERION, and the answer is a host authority.
     *
     * "If two commanders cannot be kept in agreement on `lineIsUp`, the mode's
     * win condition desyncs and it needs a host authority." It has one by
     * construction — `CommandDirector._front` runs inside the director's own
     * update and a client's director is a shell that never steps — so the
     * question is not whether both machines compute the same number, it is
     * whether the client is told the one number that exists. Until this field
     * it was not: the whole state of a meeting sat at zero on every machine but
     * the host's, and the bar a player reads to know whether they are winning
     * would have read "contested" for an entire battle.
     */
    const { SIDES } = await import('../../src/game/Player.js');
    const { host, client, pump } = await commandPair({ host: { commandVersus: true },
                                                       client: { commandVersus: true }, start: false });
    host.beginVersus();
    await joinAsCommander(host, { team: SIDES[1] });
    host.beginVersus();
    assert(host.command?.versus, 'the host is not running a meeting at all');

    /* THE HOST DRIVES IT. `_front` moves the scalar only for a line that is
     * gathered and forward, which `command-pvp`'s own first check measures —
     * this one is about the wire, so the number is set directly and the
     * question is whether it arrives. */
    host.command.front = 0;
    pump(0.5);
    const before = client.command?.front ?? null;
    host.command.front = -0.42;
    pump(0.5);
    const after = client.command?.front ?? null;
    assert(before !== null,
      'the client has no front at all — a meeting whose central quantity is undefined on one '
      + 'machine cannot draw a bar, and cannot agree about who is winning');
    assert(Math.abs(after - (-0.42)) < 0.02,
      `the host drove the front to -0.42 and the client reads ${after} — the mode's whole state `
      + 'does not cross the wire');
    /* …AND THE CLIENT DOES NOT INVENT ONE. A shell director that stepped
     * `_front` itself would drift from the host's within seconds, which is
     * exactly the desync §4.5 names. */
    host.command.front = 0.31;
    pump(0.5);
    assert(Math.abs((client.command?.front ?? 0) - 0.31) < 0.02,
      'the client stopped following the host — it is computing a front of its own');
    return 'host -0.42 → client -0.42, host +0.31 → client +0.31';
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
