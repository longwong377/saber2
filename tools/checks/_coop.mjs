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
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
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
export async function bootWorld({ level = 'arena', settings = {}, spawn = true } = {}) {
  const { World } = await import('../../src/game/World.js');
  const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  const { DIFFICULTY } = await import('../../src/game/Combat.js');
  await initPhysics();
  const engine = await stubEngine();
  const s = { ...DEFAULT_SETTINGS, quality: 'low', ...settings };
  const world = new World(engine, s);
  world.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.knight;
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
 */
export async function bootPair({ level = 'arena', settings = {} } = {}) {
  const a = await bootWorld({ level, settings });
  const b = await bootWorld({ level, settings });
  const seen = { toClient: [], toHost: [] };
  const wire = { down: [], up: [] };
  const wrap = (m) => JSON.parse(JSON.stringify(m));
  a.world.attachNet({
    connected: true, isHost: true, name: 'HOST', roster: [], sweep() {},
    broadcast(m) { wire.down.push(wrap(m)); }, toPeer(id, m) { wire.down.push(wrap(m)); }, toHost() {},
  }, 'host');
  b.world.attachNet({
    connected: true, isHost: false, name: 'PEER', roster: [],
    broadcast(m) { wire.up.push(wrap(m)); }, toPeer() {}, toHost(m) { wire.up.push(wrap(m)); },
  }, 'client');

  const input = idleInput();
  const pump = (seconds) => {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      a.world.update(dt, input);
      while (wire.down.length) {
        const m = wire.down.shift();
        seen.toClient.push(m);
        if (m.t === 'snapshot') b.world.applySnapshot(m);
      }
      b.world.update(dt, input);
      while (wire.up.length) {
        const m = wire.up.shift();
        seen.toHost.push(m);
        if (m.t === 'claim') a.world.applyClaim('PEER', m);
      }
    }
  };
  return { host: a.world, client: b.world, pump, seen, input };
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
