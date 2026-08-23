/**
 * A CO-OP SESSION, UNDER NODE — the thing tools/checks/coop.mjs did not have.
 *
 * The old suite was nine regular expressions over source text: it constructed no
 * `Net`, no `RemoteAvatar` and no `World`, sent no message and asserted no
 * number, so it passed unchanged on a build where three-player co-op rendered
 * one shared body, a joining player saw no enemy fire at all, and nobody ever
 * got a death card. Everything here exists so a co-op check can DRIVE the real
 * modules instead of reading them.
 *
 * Two pieces:
 *
 *   `installPeerStub()` — PeerJS's surface, exactly as `Net` uses it: a broker
 *   keyed by peer id, `peer.connect(id, {metadata})` on one side raising a
 *   `connection` event on the other, `conn.peer` being the id of the peer at the
 *   OTHER end of that connection. That last detail is the whole of finding one:
 *   on a client every message arrives on the single host connection, so
 *   `conn.peer` is a constant and cannot identify a sender.
 *
 *   `stubEngine()` — every `engine.*` member reachable from World and its
 *   callees, and nothing else, so a World boots with no GL context. Taken from
 *   tools/checks/lifecycle.mjs, which proved it first.
 *
 * Delivery is QUEUED and flushed by hand rather than synchronous, because the
 * behaviour under test is a relay: a message the host forwards must be seen to
 * arrive as a separate event, and a synchronous send would run the forward
 * inside the original handler and hide the ordering.
 */

/* ── PeerJS, as much of it as Net.js touches ─────────────────────────── */

class FakeConn {
  constructor(net, peer, metadata) {
    this.net = net;             // the FakeNetwork
    this.peer = peer;           // id at the FAR end — what Net reads as the sender
    this.metadata = metadata || {};
    this.open = false;
    this._h = new Map();
    this.other = null;
    this.closed = false;
    this.sent = 0;
    this.bytes = 0;
  }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, []); this._h.get(ev).push(fn); return this; }
  _emit(ev, ...a) { for (const fn of (this._h.get(ev) || [])) fn(...a); }
  send(msg) {
    if (this.closed || !this.other) return;
    this.sent++;
    this.bytes += JSON.stringify(msg).length;
    // structuredClone: a real DataConnection serialises, so a receiver must not
    // be handed the sender's live objects.
    this.net.queue.push([this.other, structuredClone(msg)]);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const o = this.other;
    this.net.queue.push([null, null, () => { this._emit('close'); if (o && !o.closed) { o.closed = true; o._emit('close'); } }]);
  }
}

class FakePeer {
  constructor(net, id) {
    this.net = net;
    this.id = id;
    this.destroyed = false;
    this._h = new Map();
    net.peers.set(id, this);
    net.queue.push([null, null, () => this._emit('open', id)]);
  }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, []); this._h.get(ev).push(fn); return this; }
  _emit(ev, ...a) { for (const fn of (this._h.get(ev) || [])) fn(...a); }
  connect(targetId, opts = {}) {
    const target = this.net.peers.get(targetId);
    // our end: `.peer` is the host we are dialling
    const mine = new FakeConn(this.net, targetId, opts.metadata);
    if (!target) {
      this.net.queue.push([null, null, () => mine._emit('error', new Error('peer-unavailable'))]);
      return mine;
    }
    // their end: `.peer` is US
    const theirs = new FakeConn(this.net, this.id, opts.metadata);
    mine.other = theirs; theirs.other = mine;
    this.net.queue.push([null, null, () => {
      target._emit('connection', theirs);
      theirs.open = true; theirs._emit('open');
      mine.open = true; mine._emit('open');
    }]);
    return mine;
  }
  destroy() { this.destroyed = true; this.net.peers.delete(this.id); }
}

/**
 * A broker plus a delivery queue. `flush()` runs until quiet, so a relayed
 * message is delivered in the same flush as the one that caused it.
 */
export class FakeNetwork {
  constructor() { this.peers = new Map(); this.queue = []; this.delivered = 0; }
  flush(limit = 4000) {
    let n = 0;
    while (this.queue.length && n < limit) {
      const [conn, msg, thunk] = this.queue.shift();
      n++;
      // A thunk is a connection lifecycle event, and PeerJS raises those into
      // handlers that are allowed to reject a promise. Letting one escape here
      // would take the whole runner down instead of failing one check.
      if (thunk) { try { thunk(); } catch {} continue; }
      if (conn.closed) continue;
      this.delivered++;
      try { conn._emit('data', msg); } catch (e) { this.errors = (this.errors || 0) + 1; }
    }
    return n;
  }
}

/**
 * Point `window.Peer` at the stub.
 *
 * ONE broker for the whole process, reference counted: the suite's checks run
 * concurrently, and a per-check broker means a client dialling a code that was
 * registered in a different broker gets `peer-unavailable`. Peer ids are unique
 * across it, so deliveries stay addressed.
 */
let installed = null;
export function installPeerStub() {
  if (installed) { installed.refs++; return installed; }
  const net = new FakeNetwork();
  let auto = 0;
  const prev = globalThis.Peer;
  globalThis.Peer = function Peer(id) { return new FakePeer(net, id || `peer-${++auto}`); };
  net.refs = 1;
  net.restore = () => { if (--net.refs <= 0) { globalThis.Peer = prev; installed = null; } };
  installed = net;
  return net;
}

/* ── a World with no GPU ─────────────────────────────────────────────── */

export async function stubEngine() {
  const THREE = await import('three');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  /**
   * THE LIGHT POOL IS BORROWED, NOT REBUILT.
   *
   * Every lit blade now asks `engine.lightUp()` for illumination instead of
   * carrying its own point lights (Saber.js, player note #15). A stub with no
   * `lightUp` sends every blade down the fallback path and adds two lights per
   * sabre to the scene — so a headless harness would measure the behaviour the
   * fix removed and report it as current.
   *
   * The pool SIZE and the RANKING come off the shipped Engine rather than being
   * written out again here. A second copy of the ranking beside the real one is
   * the signature defect of this codebase (HANDOFF §2.3/§2.4) and it fails in
   * the direction nobody checks: the instrument disagrees with the game and
   * manufactures a defect. The import is dynamic and inside a function body for
   * the reason `bootWorld` gives below — Engine.js rewrites three's ShaderChunks
   * behind once-only flags.
   */
  const { Engine, LIGHT_POOL_SIZE } = await import('../../src/engine/Engine.js');
  const stub = {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {},
    lightPool: [], _lightReq: [], _lightsWanted: 0, _lightsLit: 0,
    lightUp: Engine.prototype.lightUp,
    _syncLights: Engine.prototype._syncLights,
    // The real Engine resolves the frame's requests at the top of render(). A
    // census taken without one would see a pool that had never been driven.
    render() { this._syncLights(); },
  };
  for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 7, 1);
    L.castShadow = false;
    scene.add(L);
    stub.lightPool.push(L);
  }
  return stub;
}

/** An input device with nothing pressed. Shape taken from src/engine/Input.js. */
export const idleInput = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

/**
 * A real World, booted headless, with a local player in it.
 *
 * Dynamic import on purpose: World reaches src/engine/Engine.js, which rewrites
 * three's ShaderChunks as a module side effect behind once-only flags. A STATIC
 * import edge from a check file patches the copy of three that verify.mjs's own
 * static graph resolved and burns the flag for the shader suites. See
 * tools/checks/materials.mjs.
 */
/**
 * THE DEFAULT LEVEL, AND WHY IT IS DERIVED RATHER THAN NAMED.
 *
 * `bootWorld` and `bootPair` both defaulted to `'arena'` — a level the roster
 * cull deleted. `World.loadLevel` substitutes `LEVEL_ORDER[0]` for a key it does
 * not know, deliberately and with a comment, so nothing threw and nothing looked
 * wrong. What it cost: `coop`'s marksman check stood a sniper behind a rock on
 * the Ember Shelf believing it was in an arena, measured line of sight on ZERO
 * of 720 frames, never telegraphed, and reported itself as a wire defect —
 * *"the joining player never saw the laser"* — for a laser the host never fired.
 *
 * The default now derives from the roster, so it cannot name a level that does
 * not exist. This is behaviour-identical to what every caller was already
 * getting; it just stops lying about it. A check that needs a PARTICULAR kind of
 * ground — an arena, a corridor, open sky — must say so explicitly, because that
 * is a statement about what it measures and not a default anyone should inherit.
 */
async function defaultLevel() {
  const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
  return LEVEL_ORDER[0];
}

/**
 * `runSeed` IS A FACT ABOUT A SESSION AND NOT ABOUT A WORLD — which is why it
 * is a parameter here rather than a setting.
 *
 * `main.js` assigns `world.runSeed` before `loadLevel` runs, and its own note
 * says why it lives there: "a seed is a fact about a SESSION, and this is the
 * one place that knows whether the session is the player's own or a host's."
 * Every director built inside `loadLevel` reads it in its constructor —
 * `seedWaves`, `enemyRng`, `duelRng`, `seedArrivals`, `seedCommand`, and now
 * `Session.rollSession` — so a harness that wants a SEEDED run has to set it in
 * the same window main.js does. Left null, which is what every existing caller
 * gets and what every one of those streams already treats as "nobody has stated
 * a number".
 */
export async function bootWorld({ level = null, settings = {}, spawn = true, runSeed = null, run = null } = {}) {
  level = level || await defaultLevel();
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../../src/game/Combat.js');
  await initPhysics();
  const engine = await stubEngine();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', ...settings };
  /* THE RUN-SCOPED BAG, and `settings.veterans` is honoured as a shorthand for
   * it. A saved company is not a preference — see World's constructor note —
   * so it does not belong in the settings blob, and `controls.mjs` goes red if
   * anything in src/ reads it from there. A check that finds it easier to say
   * `settings: { veterans }` still gets what it meant. */
  const runBag = { ...(run || {}) };
  if (s.veterans && !runBag.veterans) runBag.veterans = s.veterans;
  delete s.veterans;
  const world = new World(engine, s, runBag);
  world.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
  /* `Number(null)` IS 0 AND `Number.isFinite(0)` IS TRUE, which is the whole
   * reason this reads the value before it converts it: the finite test alone
   * turned the default of `null` — "nobody has stated a number" — into the
   * perfectly good seed 0, and every headless World in the suite silently
   * became a seeded run. Measured before the guard: `director.seed` 0 rather
   * than null on every `bootWorld`, which rolled a Raid in `Session` and put
   * the muster shelf on the Core Ship's rung in a check that had asked for
   * area 1. The same "a missing thing answered with a plausible default"
   * §2.3 names, in a harness. */
  if (runSeed !== null && runSeed !== undefined && Number.isFinite(Number(runSeed))) {
    world.runSeed = (Number(runSeed) | 0) >>> 0;
  }
  await world.loadLevel(level);
  if (spawn) world.spawnPlayer({ name: s.playerName || 'Jedi', isLocal: true });
  return { world, engine, settings: s };
}

/**
 * A HOST AND A CLIENT, WIRED TO EACH OTHER.
 *
 * Two real Worlds with two real net endpoints between them: everything the host
 * broadcasts is handed to the client's own `applySnapshot`, and everything the
 * client claims is handed to the host's own `applyClaim`. No packet is
 * hand-written, no handler is re-implemented — `pump()` steps both worlds and
 * moves whatever the production code decided to send. Messages are round-tripped
 * through JSON because a DataConnection serialises, so neither side can be
 * handed the other's live objects.
 *
 * IT CARRIES AVATARS AND HITS TOO, and until it did there was no such thing
 * here as one player reaching another. `_netTick` broadcasts `packAvatar` from
 * both ends on every tick and the pair discarded both, so neither World held a
 * `RemoteAvatar` and `world.players` was one body on each machine — which means
 * every player-versus-player claim this repository makes was measured on two
 * local Players in ONE world, the exact shape `force.mjs` is 26/26 for. Now the
 * host has a body for the peer and the peer has one for the host, each fed by
 * the other's real packets, and a push aimed at one of them travels the way it
 * travels in a session.
 *
 * `hit` and `avatar` are routed to the SHIPPED readers — `World.applyHit` and
 * `RemoteAvatar.push` — for the reason HANDOFF §2.4 gives: an instrument that
 * restates a rule eventually disagrees with it, and it fails by manufacturing
 * defects. `applyHit` used to live in a closure in main.js, which is why this
 * could not have been done before.
 */
/**
 * @param lag  one-way delivery delay in SIMULATED seconds. Zero by default,
 *   which is what an in-process wire really is; give it a number and every
 *   packet is held for that long, and `net.latency` is published in the
 *   milliseconds `Net`'s own ping would report so anything deriving a window
 *   from it (World._netOwn) sees the connection it is actually on.
 */
export async function bootPair({ level = null, settings = {}, sides = null, lag = 0 } = {}) {
  level = level || await defaultLevel();
  const { RemoteAvatar } = await import('../../src/net/Net.js');
  const a = await bootWorld({ level, settings });
  const b = await bootWorld({ level, settings });
  const seen = { toClient: [], toHost: [] };
  const wire = { down: [], up: [] };
  const wrap = (m) => JSON.parse(JSON.stringify(m));
  /* Simulated seconds since the pair was built. The pump owns it; the wire only
   * stamps with it, so a delayed packet is delayed by GAME time and not by
   * however long the box took to step two Worlds. */
  const clock = { t: 0 };
  const post = (q, m) => q.push([clock.t + lag, wrap(m)]);
  /* The roster is what `hitSourceId` reads to learn which id the far end knows
   * the host's own Player by — on the host it is 'local', everywhere else it is
   * the host's peer id. Two entries, the shape `Net._refreshRoster` builds. */
  const roster = [{ id: 'HOST', name: 'HOST', host: true }, { id: 'PEER', name: 'ALPHA' }];
  a.world.attachNet({
    connected: true, isHost: true, name: 'HOST', roster, latency: lag * 1000, sweep() {},
    broadcast(m) { post(wire.down, m); }, toPeer(id, m) { post(wire.down, m); }, toHost() {},
  }, 'host');
  b.world.attachNet({
    connected: true, isHost: false, name: 'PEER', roster, latency: lag * 1000,
    broadcast(m) { post(wire.up, m); }, toPeer() {}, toHost(m) { post(wire.up, m); },
  }, 'client');
  if (sides) { a.world.player.team = sides[0]; b.world.player.team = sides[1]; }

  /**
   * Each machine's drawing of the other player, built on the first packet.
   *
   * THE INTERPOLATION WINDOW IS SET TO ZERO, and that is a statement about this
   * harness rather than about the game. `RemoteAvatar.delay` exists to cover the
   * worst recent GAP between arrivals — its own note says so — and it measures
   * that gap with `performance.now()`, a wall clock. This pair has no jitter at
   * all (delivery is a function call) and no wall clock of its own: it steps
   * 1/60 s of simulation per iteration in whatever real time that costs, which
   * here is about an eighth of it. Left alone, `now - delay` lands 60 ms of REAL
   * time back — several hundred milliseconds of SIMULATED time — and the drawing
   * renders the oldest packet in the buffer. Measured: the peer standing 2.00 m
   * from where the host drew them, with both bodies at rest.
   *
   * So the window that absorbs jitter is closed on a wire that has none, and the
   * drawing is the newest packet received. `minDelay` too, because `push`
   * recomputes `delay` against it on every arrival.
   */
  const avatarOn = (world, id, name, team) => {
    let r = world.remotes.get(id);
    if (r) return r;
    r = new RemoteAvatar(world, { id, name, team });
    r.delay = 0; r.minDelay = 0;
    world.remotes.set(id, r);
    world.players.push(r);
    return r;
  };

  const input = idleInput();
  /** Everything on `q` whose delivery time has come, in order. */
  const ready = (q) => {
    const out = [];
    while (q.length && q[0][0] <= clock.t + 1e-9) out.push(q.shift()[1]);
    return out;
  };
  const pump = (seconds) => {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      clock.t += dt;
      a.world.update(dt, input);
      for (const m of ready(wire.down)) {
        seen.toClient.push(m);
        if (m.t === 'snapshot') b.world.applySnapshot(m);
        else if (m.t === 'hit') b.world.applyHit(m);
        else if (m.t === 'avatar') avatarOn(b.world, 'HOST', 'HOST', sides ? sides[0] : undefined)
          .push(m, performance.now() / 1000);
      }
      b.world.update(dt, input);
      for (const m of ready(wire.up)) {
        seen.toHost.push(m);
        if (m.t === 'claim') a.world.applyClaim('PEER', m);
        else if (m.t === 'avatar') avatarOn(a.world, 'PEER', 'ALPHA', sides ? sides[1] : undefined)
          .push(m, performance.now() / 1000);
      }
    }
  };
  return { host: a.world, client: b.world, pump, seen, input, roster, clock };
}

/** Step a world for `seconds` of wall clock at 60 Hz. */
export function run(world, seconds, input = idleInput(), each = null) {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    world.update(dt, input);
    if (each) each(i);
  }
  return n;
}

/**
 * `performance.now()` is what every buffer in Net.js stamps with, so a check
 * that wants to advance the interpolation window has to be able to move it.
 */
export function fakeClock(start = 1000) {
  const real = performance.now.bind(performance);
  let t = start;
  performance.now = () => t;
  return {
    advance(ms) { t += ms; return t; },
    set(ms) { t = ms; },
    get now() { return t; },
    restore() { performance.now = real; },
  };
}
