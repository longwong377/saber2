/**
 * SABER — peer-to-peer co-op.
 *
 * One player hosts and simulates the horde; everyone else runs their own blade
 * locally and tells the host what it did. That split is deliberate: enemy
 * positions can tolerate 80 ms of interpolation, but the blade cannot tolerate
 * a single frame of it, so the blade never leaves the machine holding the mouse.
 *
 * Signalling goes through the public PeerJS broker by default. Point
 * `SABER_SIGNAL` at your own broker if you would rather not use it.
 */

import * as THREE from 'three';
import { buildJedi, speciesOf } from '../game/Bodies.js';
import { Rig, BipedAnimator } from '../game/Rig.js';
import { Saber } from '../game/Saber.js';
import { SKIN_TONES, HAIR_COLORS } from '../ui/Menu.js';
import { clamp, lerp, TAU } from '../engine/MathUtil.js';
import { ATTACK_KEYS, DUEL_PHASES } from '../game/Duel.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3479';
const PREFIX = 'saberduel-';

/** How long a peer may go silent before the host drops it. See Net.sweep. */
export const PEER_TIMEOUT = 8;

/**
 * THE CHARACTER SHEET, AS IT CROSSES THE WIRE.
 *
 * `World.spawnPlayer` builds the local player from twelve appearance settings.
 * A RemoteAvatar used to be built from four, of which main.js supplied two, and
 * BOTH of those were made up — `colorIndex: (rosterIndex + 1) % 8`. So a friend
 * who built a small-folk Jedi with a red blade and a Crossguard hilt arrived on
 * your screen as a default-height human in an index-picked robe. index.html
 * says "The Jedi you build is the Jedi you carry"; in co-op it was carried
 * nowhere.
 *
 * Sent ONCE, on hello/welcome, and carried on the roster — it is identity, not
 * state, so putting it in the 24 Hz avatar packet would pay for it forever.
 *
 * The ten of the twelve that a RemoteAvatar can actually wear. `robeCut` and
 * `order` are deliberately absent: the first dresses a simulated cloak a remote
 * body does not have, and the second grants boons rather than describing a
 * face. Sending them would be two more fields on the wire with no reader.
 */
export const LOOK_KEYS = ['colorIndex', 'bladeLength', 'coreWidth', 'hiltStyle', 'robeIndex',
  'skinIndex', 'hairIndex', 'build', 'species', 'face'];

export function packLook(settings = {}) {
  const out = {};
  for (const k of LOOK_KEYS) if (settings[k] !== undefined) out[k] = settings[k];
  return out;
}

/** The skin rack belongs to the species — the same rule Player.js applies. */
function skinHex(species, i) {
  const sp = speciesOf(species);
  const rack = (sp && sp.skinTones && sp.skinTones.length) ? sp.skinTones : SKIN_TONES;
  return (rack[i ?? 0] || rack[0])?.hex;
}

function makeCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

let peerLibPromise = null;
function loadPeerLib() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLibPromise) return peerLibPromise;
  peerLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/peerjs/peerjs.min.js', import.meta.url).href;
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('peer library did not initialise')));
    s.onerror = () => reject(new Error('could not load the networking library'));
    document.head.appendChild(s);
  });
  return peerLibPromise;
}

/* ══════════════════════════════════════════════════════════════════════ */

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map();       // peerId → { conn, name, look, lastSeen }
    this.isHost = false;
    this.connected = false;
    this.code = null;
    this.name = 'Jedi';
    this.look = null;
    this.handlers = new Map();
    this.roster = [];
    /** Round trip / 2, from the ping World sends every 2 s. Read by the scoreboard. */
    this.latency = 0;
    this.enabled = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }
  _emit(type, ...args) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) { try { fn(...args); } catch (e) { console.error('[net]', type, e); } }
  }

  async host(name, settings, look = null) {
    const Peer = await loadPeerLib();
    this.name = name || 'Jedi';
    this.look = look;
    this.isHost = true;
    this.enabled = true;
    this.settings = settings;
    const code = makeCode();
    this.code = code;

    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, peerOptions());
      this.peer = peer;
      const fail = (err) => { this._emit('error', err); reject(err); };
      peer.on('open', () => {
        this.connected = true;
        this.roster = [{ id: peer.id, name: this.name, host: true, look: this.look }];
        this._emit('roster', this.roster);
        this._emit('open', code);
        resolve(code);
      });
      peer.on('connection', (conn) => this._acceptConnection(conn));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // code collision — pick another and try once
          peer.destroy();
          this.host(name, settings, look).then(resolve, reject);
          return;
        }
        fail(err);
      });
      peer.on('disconnected', () => { this._emit('status', 'signalling lost — peers already connected are unaffected'); });
    });
  }

  async join(code, name, look = null) {
    const Peer = await loadPeerLib();
    this.name = name || 'Jedi';
    this.look = look;
    this.isHost = false;
    this.enabled = true;
    this.code = code.toUpperCase();

    return new Promise((resolve, reject) => {
      const peer = new Peer(null, peerOptions());
      this.peer = peer;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('no answer — check the code')); }
      }, 14000);

      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true, metadata: { name: this.name, look: this.look } });
        this.hostConn = conn;
        conn.on('open', () => {
          this.connected = true;
          conn.send({ t: 'hello', name: this.name, look: this.look });
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(); }
          this._emit('open', this.code);
        });
        conn.on('data', (msg) => this._onMessage(msg, conn));
        conn.on('close', () => { this.connected = false; this._emit('closed'); });
        conn.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(err); }
        this._emit('error', err);
      });
    });
  }

  _acceptConnection(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, { conn, name: conn.metadata?.name || 'Jedi',
        look: conn.metadata?.look || null, lastSeen: performance.now() / 1000 });
      this._refreshRoster();
      this._emit('peer-joined', conn.peer, conn.metadata?.name);
      conn.send({ t: 'welcome', settings: this.settings, roster: this.roster, hostName: this.name });
    });
    conn.on('data', (msg) => this._onMessage(msg, conn));
    conn.on('close', () => this._dropPeer(conn.peer));
    conn.on('error', () => this._dropPeer(conn.peer));
  }

  /**
   * A PEER IS GONE, AND EVERYBODY HAS TO HEAR ABOUT IT.
   *
   * `peer-left` used to be raised on the host alone, because the host is the
   * only node that holds `conns`. On every OTHER machine the departed player's
   * RemoteAvatar simply stopped receiving packets and stood there: still in
   * `world.players`, still `alive`, still the nearest thing `pickTarget` could
   * find — a frozen body the horde walked to for the rest of the run. The relay
   * exists for exactly this shape of fact, so it carries this one too.
   */
  _dropPeer(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this._refreshRoster();
    if (this.isHost) this.broadcast({ t: 'left', id });
    this._emit('peer-left', id);
  }

  /**
   * Drop peers that have gone quiet.
   *
   * `lastSeen` was written once, at connect, and read nowhere — so a peer whose
   * connection died without a close event (a laptop lid, a lost tunnel) was
   * never removed by anything. PeerJS only raises `close` on a clean teardown.
   * Called from World._netTick on the host.
   */
  sweep(now = performance.now() / 1000, timeout = PEER_TIMEOUT) {
    if (!this.isHost) return 0;
    let dropped = 0;
    for (const [id, c] of [...this.conns]) {
      if (now - (c.lastSeen ?? now) < timeout) continue;
      this._dropPeer(id);
      dropped++;
    }
    return dropped;
  }

  _refreshRoster() {
    this.roster = [{ id: this.peer?.id, name: this.name, host: true, look: this.look }];
    for (const [id, c] of this.conns) this.roster.push({ id, name: c.name, host: false, look: c.look || null });
    this._emit('roster', this.roster);
    if (this.isHost) this.broadcast({ t: 'roster', roster: this.roster });
  }

  /**
   * WHO SENT THIS.
   *
   * On the HOST there is one connection per peer, so `conn.peer` is the sender.
   * On a CLIENT every message in the session — including everything the host
   * forwarded on behalf of somebody else — arrives on the single host
   * connection, so `conn.peer` is a constant: the host's id. That is why the
   * relay stamps `from`, and why reading it is not optional. It was written on
   * the wire and read by nothing, and the cost was that a 3- or 4-player client
   * built exactly ONE RemoteAvatar and fed it the interleaved position streams
   * of every other player: measured 840 m of travel and a 1200 m/s peak for two
   * players standing still.
   */
  _sender(msg, conn) { return msg.from || conn.peer; }

  _onMessage(msg, conn) {
    if (!msg || !msg.t) return;
    const c = this.conns.get(conn.peer);
    if (c) c.lastSeen = performance.now() / 1000;
    switch (msg.t) {
      case 'hello':
        if (c) { c.name = msg.name; if (msg.look) c.look = msg.look; }
        this._refreshRoster();
        break;
      case 'welcome':
        this.roster = msg.roster || [];
        this._emit('roster', this.roster);
        this._emit('welcome', msg.settings);
        break;
      case 'roster':
        this.roster = msg.roster || [];
        this._emit('roster', this.roster);
        break;
      case 'start': this._emit('start', msg); break;
      case 'snapshot': this._emit('snapshot', msg); break;
      case 'avatar':
        this._emit('avatar', this._sender(msg, conn), msg);
        if (this.isHost) this.broadcastExcept(conn.peer, { ...msg, from: conn.peer });
        break;
      // A peer has left the session. Only the host holds `conns`, so only the
      // host can know; this is how everybody else finds out. See _dropPeer.
      case 'left': if (!this.isHost) this._emit('peer-left', msg.id); break;
      case 'claim': this._emit('claim', conn.peer, msg); break;
      // Host → this peer: you were hit. The reverse of `claim`, and it exists
      // for the same reason — the authority for a thing is not where the thing
      // is drawn. A peer owns its own health (its avatar packet carries `hp`,
      // and the host overwrites its copy 24 times a second), so the host cannot
      // apply the damage itself; it can only say so.
      case 'hit': this._emit('hit', msg); break;
      // Host → peers: a draft is open. The moment, not the hand — see the note
      // on World's onDraft.
      case 'draft': this._emit('draft', msg); break;
      /**
       * Somebody's communion has reached us — the first message in this game
       * whose payload is a BUFF rather than a fact about the world.
       *
       * ADDRESSED, and relayed once. `to` is the peer the aura was aimed at,
       * because the sender knows perfectly well how far away everyone is (a
       * peer is a RemoteAvatar with a position) and an aura that ignored
       * distance would be a different ability. A client can only reach the
       * host directly, so a client-to-client bond arrives here addressed to
       * somebody else and is forwarded — exactly the relay `avatar` already
       * does, and for the same reason: the host is the only node that can see
       * everybody.
       */
      case 'bond':
        // The relayed copy is stamped with its origin for the same reason the
        // avatar relay is: `bondGive` keys a live offer on the peer it came
        // from, and two client auras arriving at a third machine under the
        // host's id would silently overwrite one another.
        if (this.isHost && msg.to && msg.to !== this.peer?.id) this.toPeer(msg.to, { ...msg, from: conn.peer });
        else this._emit('bond', msg, this._sender(msg, conn));
        break;
      // 'event' was routed here with no sender anywhere and no listener
      // anywhere — a channel that existed only as this line. Deleting it is as
      // valid a fix as giving it a purpose, and it is the honest one: nothing
      // downstream was waiting for it. See tools/checks/coop.mjs.
      case 'ping': this.send(conn, { t: 'pong', s: msg.s }); break;
      case 'pong': this.latency = (performance.now() - msg.s) * 0.5; break;
      default: this._emit(msg.t, msg, conn.peer);
    }
  }

  send(conn, msg) { try { conn.send(msg); } catch {} }

  broadcast(msg) {
    if (this.isHost) { for (const { conn } of this.conns.values()) this.send(conn, msg); }
    else if (this.hostConn) this.send(this.hostConn, msg);
  }
  broadcastExcept(exceptId, msg) {
    for (const [id, { conn }] of this.conns) if (id !== exceptId) this.send(conn, msg);
  }
  toHost(msg) { if (this.hostConn) this.send(this.hostConn, msg); }

  /** Everyone but us, host or client. Used by the roster and the scoreboard. */
  get peers() { return this.roster.filter((r) => r.id !== this.peer?.id); }

  /**
   * Host → ONE peer.
   *
   * `broadcast` was the only outbound path, and it is the wrong shape for
   * anything addressed to a particular player: damage is the obvious one, since
   * the peer owns its own health and everybody else only needs to be told about
   * it through the avatar stream they already receive. Sending a hit to all
   * four would wound all four.
   */
  toPeer(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c) this.send(c.conn, msg);
  }

  /**
   * LEAVE.
   *
   * Written, complete, and with ZERO CALLERS in the repository — so there was
   * no way out of a co-op session at all. Quitting to the menu left `enabled`
   * and `connected` true, which meant the next Ignite silently re-attached the
   * player as a client of the same host, in the host's level, and solo play was
   * unreachable until the tab was reloaded. On the other machines the departed
   * player stayed a live entry in `world.players` forever.
   *
   * `hostConn` is cleared too: it is what `broadcast`/`toHost` write into, and
   * leaving it behind means a closed session still had an outbound path.
   */
  close() {
    for (const { conn } of this.conns.values()) { try { conn.close(); } catch {} }
    this.conns.clear();
    try { this.hostConn?.close(); } catch {}
    this.hostConn = null;
    try { this.peer?.destroy(); } catch {}
    this.peer = null; this.connected = false; this.enabled = false;
    this.isHost = false;
    this.code = null;
    this.roster = [];
    this._emit('roster', this.roster);
  }
}

function peerOptions() {
  const custom = window.SABER_SIGNAL;
  const base = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };
  if (custom) return { ...base, ...custom };
  return base;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Remote avatar                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/** Another player, driven by interpolated snapshots. */
export class RemoteAvatar {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = opts.id;
    this.name = opts.name || 'Jedi';
    this.team = 0;
    this.alive = true;
    this.isRemote = true;

    /**
     * THE JEDI THEY BUILT, not one this machine invented.
     *
     * `look` is the sheet that crossed the wire (see LOOK_KEYS). Every default
     * here is the game's own — DEFAULT_SETTINGS in Menu.js — rather than a
     * plausible-looking neighbour: the old fallback hilt was 'Guardian' where
     * the game's default is 'Graflex', so an unset field did not merely lose
     * the choice, it substituted a different one.
     */
    const look = opts.look || opts;
    const built = buildJedi({
      robeIndex: look.robeIndex ?? 0, scale: 1,
      skinColor: skinHex(look.species, look.skinIndex),
      hairColor: HAIR_COLORS[look.hairIndex ?? 1]?.hex,
      build: look.build, species: look.species, face: look.face,
    });
    this.look = look;
    this.rig = built.rig;
    this.built = built;
    world.scene.add(this.rig.root);
    // the rig's own scale — see the note in Player.js; a remote Yoda floats without it
    this.animator = new BipedAnimator(this.rig, { scale: this.rig.scale ?? 1, hipHeight: 0.95 });

    this.saber = new Saber(world.scene, {
      colorIndex: look.colorIndex ?? 0, bladeLength: look.bladeLength ?? 1.15,
      coreWidth: look.coreWidth ?? 1, hiltStyle: look.hiltStyle ?? 'Graflex',
    });
    this.saber.ignite();

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.facing = 0;
    this.hp = 100; this.maxHp = 100;

    /**
     * THE SHAPE THE WORLD ALREADY ASSUMED, and did not have.
     *
     * A RemoteAvatar goes into `world.players` (main.js), and World's loops
     * treat everything in that list as a Player. Two of them did not survive
     * the difference:
     *
     *   `_boltHitTest` reads `p.invuln` and then `p.boonMods.absorb` with no
     *   guard at all. Neither existed here, so `undefined > 0` was false, the
     *   hit test ran, and reading `.absorb` off undefined THREW — every enemy
     *   bolt that reached a friend took the frame loop down with it. Co-op was
     *   not "your friend cannot be hurt", it was "your friend being shot at is
     *   an exception".
     *
     *   The enemy-blade loop guarded on `!p.control`, which no avatar has, so
     *   enemy sabers passed straight through them. That one at least failed
     *   quietly.
     *
     * `boonMods` is deliberately EMPTY rather than Player's defaults: whatever
     * boons this player holds are theirs, applied on their own machine, and a
     * plausible-looking local copy here would be a second source of truth for
     * something this side does not own.
     */
    this.invuln = 0;
    this.boonMods = {};
    // The counters World's callbacks move when this peer kills something. They
    // are here because `onEnemyKilled` credits the claiming avatar now — a
    // friend's kill used to be credited to nobody at all — and because
    // `run.kills` sums `kills` across `world.players`.
    this.kills = 0; this.deflects = 0; this.perfects = 0; this.limbsRemoved = 0;
    this.score = 0; this.combo = 0; this.comboTimer = 0;

    this.buffer = [];
    /**
     * THE INTERPOLATION WINDOW, WHICH USED TO BE A CONSTANT.
     *
     * 90 ms is right for a 24 Hz stream that arrives evenly. It is not right
     * for a connection that bunches, and nothing in the game could tell the
     * difference: `Net.latency` was measured every two seconds by a ping and
     * read by nobody, and the window never moved. A packet that arrives later
     * than the window is a body that stops dead and snaps — the buffer runs
     * out and `update` clamps to the last sample.
     *
     * So the window follows the WORST recent gap between arrivals rather than a
     * number somebody picked: that is the quantity a buffer has to cover, it is
     * measured on this machine with no clock sync, and it needs no timestamp on
     * the wire (an avatar packet carries none — the sender's clock is not ours).
     * Clamped so a healthy connection still gets a tight window and a bad one
     * cannot make a friend lag half a second behind.
     */
    this.delay = 0.09;
    this.minDelay = 0.06; this.maxDelay = 0.30;
    this._gaps = [];
    this._lastPush = 0;
    this.hiltPos = new THREE.Vector3();
    this.hiltQuat = new THREE.Quaternion();
    this._init = false;

    // a nameplate so you can find your friend in a crowd
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 14, 256, 36);
    g.fillStyle = '#dfe8f5'; g.fillText(this.name, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.85 }));
    this.plate.scale.set(1.1, 0.28, 1);
    this.plate.renderOrder = 20;
    world.scene.add(this.plate);
  }

  aimPoint(out = new THREE.Vector3()) { return out.copy(this.chest); }
  get dead() { return !this.alive; }

  /**
   * Something on THIS machine hurt a player on ANOTHER one.
   *
   * It does not touch `this.hp`, and that is the whole design rather than an
   * omission: `update()` overwrites hp from the avatar packet every frame, so
   * anything written here is gone inside 42 ms. The peer owns its own health —
   * it runs its own Player, its own boons, its own Second Wind — so the only
   * correct thing the host can do is tell it, and let it decide what the number
   * becomes.
   *
   * Returns false ("not killed") unconditionally for the same reason: whether
   * this was lethal is not knowable here, and callers use the return only to
   * decide local flourishes.
   *
   * Silently does nothing on a client, so a peer cannot damage another peer —
   * the host is the only authority, and the alternative is four machines each
   * applying their own version of the same sword.
   */
  damage(amount, point, source, kind) {
    if (!(amount > 0) || !this.alive) return false;
    const net = this.world?.net;
    if (this.world?.netMode !== 'host' || !net) return false;
    /**
     * …EXCEPT A BOLT, WHICH THAT PLAYER IS NOW RESOLVING THEMSELVES.
     *
     * Every shot the horde fires is replicated as an event in the snapshot and
     * spawned into the peer's own pool, so the bolt that reached this body on
     * the host is live over there too — where it can be deflected, caught, or
     * absorbed by boons that only exist on that machine. Billing it from here
     * as well would charge a peer for a bolt they had just sent back.
     *
     * `hit` keeps everything the peer CANNOT see: sabers, explosions, the
     * unstable core. It is the reconciliation for what local resolution missed,
     * which is what it should always have been — it used to be the only thing
     * that ever happened, and damage arrived as an invisible number with no
     * direction and no source.
     */
    if ((kind || 'bolt') === 'bolt') return false;
    net.toPeer(this.id, { t: 'hit', d: amount, k: kind });
    return false;
  }

  /** A remote player heals on its own machine. Here so World's loops are safe. */
  heal() {}
  addFlow() {}

  push(state, now) {
    this.buffer.push({ t: now, s: state });
    while (this.buffer.length > 24) this.buffer.shift();
    if (this._lastPush) {
      this._gaps.push(now - this._lastPush);
      while (this._gaps.length > 32) this._gaps.shift();
      // The window has to cover the worst gap in the recent past plus one
      // packet of headroom, or the body arrives at the end of the buffer and
      // stops. `Math.max` over a bounded window rather than a mean: a mean is
      // beaten by exactly the spikes this exists to absorb.
      let worst = 0;
      for (const g of this._gaps) if (g > worst) worst = g;
      this.delay = clamp(worst * 1.6, this.minDelay, this.maxDelay);
    }
    this._lastPush = now;
    if (!this._init) {
      this.position.set(state.p[0], state.p[1], state.p[2]);
      this._init = true;
    }
  }

  update(dt, ctx) {
    const now = performance.now() / 1000;
    const target = now - this.delay;

    // find the two snapshots that bracket the render time
    let a = null, b = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].t <= target) { a = this.buffer[i]; b = this.buffer[i + 1] || null; break; }
    }
    if (!a) a = this.buffer[0];
    if (a) {
      const s = a.s;
      let k = 0;
      if (b) k = clamp((target - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
      const s2 = b ? b.s : s;
      _v1.set(lerp(s.p[0], s2.p[0], k), lerp(s.p[1], s2.p[1], k), lerp(s.p[2], s2.p[2], k));
      _v2.subVectors(_v1, this.position).multiplyScalar(dt > 0 ? 1 / dt : 0);
      this.velocity.copy(_v2);
      this.position.copy(_v1);
      this.facing = lerpAngle(s.f, s2.f, k);
      this.hp = s.h;
      this.alive = s.a !== 0;
      this.hiltPos.set(lerp(s.hp0[0], s2.hp0[0], k), lerp(s.hp0[1], s2.hp0[1], k), lerp(s.hp0[2], s2.hp0[2], k));
      _q1.set(s2.hq[0], s2.hq[1], s2.hq[2], s2.hq[3]);
      this.hiltQuat.set(s.hq[0], s.hq[1], s.hq[2], s.hq[3]).slerp(_q1, k);
      if (s.lit !== undefined) { if (s.lit) this.saber.ignite(); else this.saber.retract(); }
    }

    this.chest.copy(this.position).setY(this.position.y + 1.34);

    const groundAt = (x, z) => (ctx.terrain ? ctx.terrain.height(x, z) : 0);
    this.animator.setFacing(this.facing);
    this.animator.update(dt, {
      position: this.position, facing: this.facing, velocity: this.velocity,
      grounded: Math.abs(this.position.y - groundAt(this.position.x, this.position.z)) < 0.12,
      groundAt, crouch: 0, accelForward: clamp(this.velocity.length() / 6, 0, 1),
    });

    // arms to the hilt, exactly as the local player does it
    const chest = this.rig.worldPos('chest', _v1);
    const right = _v2.set(Math.cos(this.facing), 0, -Math.sin(this.facing));
    const poleR = _v3.copy(chest).addScaledVector(right, 0.75).addScaledVector(UP, -0.75);
    this.rig.solveIK('armR', 'foreR', this.hiltPos, poleR);
    const poleL = _v3.copy(chest).addScaledVector(right, -0.62).addScaledVector(UP, -0.8);
    this.rig.solveIK('armL', 'foreL', _v1.copy(this.hiltPos).addScaledVector(UP, -0.06), poleL);
    this.rig.updateMatrices();

    this.saber.setHiltPose(this.hiltPos, this.hiltQuat);
    this.saber.update(dt, ctx.time);

    this.plate.position.copy(this.position).setY(this.position.y + 2.05);
    const d = ctx.camera.position.distanceTo(this.position);
    this.plate.material.opacity = clamp(1 - (d - 26) / 30, 0, 0.85);
    this.plate.visible = d > 3;
    this.rig.root.visible = this.alive;
    this.saber.setVisible(this.alive);
  }

  dispose() {
    this.world.scene.remove(this.rig.root, this.plate);
    this.rig.dispose();
    this.saber.dispose();
    this.plate.material.map?.dispose();
    this.plate.material.dispose();
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}

/* ── snapshot packing ────────────────────────────────────────────────── */

export function packAvatar(player) {
  return {
    t: 'avatar',
    p: [r3(player.position.x), r3(player.position.y), r3(player.position.z)],
    f: r3(player.facing),
    h: Math.round(player.hp),
    a: player.alive ? 1 : 0,
    hp0: [r3(player.control.handPos.x), r3(player.control.handPos.y), r3(player.control.handPos.z)],
    hq: [r3(player.control.quat.x), r3(player.control.quat.y), r3(player.control.quat.z), r3(player.control.quat.w)],
    lit: player.saber.lit ? 1 : 0,
  };
}

/**
 * THE HORDE, AND WHAT IT IS DOING.
 *
 * The record used to be eight numbers — where the body is and whether it is
 * dead — and that is precisely the part a client could survive without. What it
 * could NOT survive without was everything the body was DOING: a joining
 * player's enemies are `netDriven`, which returns before `_think`, so on their
 * machine nothing ever fired a bolt, lit a telegraph or swung. Measured: 0
 * bolts over 10 s against three enemies standing on the player, where the same
 * scene simulated locally fired 12 and killed them. The deflection game
 * README.md calls the point of the product did not exist for anybody but the
 * host, and damage arrived instead as an invisible number over the `hit`
 * channel.
 *
 * So the record carries three more things:
 *
 *   vx, vz  the body's OWN velocity. The client used to derive it from its
 *           tracking error, which reports 1.44× the truth and sawtooths at the
 *           snapshot rate — and that number is the gait solver's only speed
 *           input, so every enemy on a client ran a sprint cadence while
 *           walking. See World's client integration.
 *   tg      is a telegraph lit. A marksman's laser is the fairness contract of
 *           the whole ranged game.
 *
 *   dl      THE MELEE HALF, and it is the same defect as `bf`. A client never
 *           runs `DuelBrain.update`, so on a joining player's screen every
 *           duellist in the game held one guard and never swung: the blade was
 *           posed from `duel.guardDir`, `duel.phase`, `duel.spin` and
 *           `duel.attack.reach`, and all four sat where the constructor left
 *           them. `_poseSaber` reads exactly those four and nothing else, so
 *           they are exactly what crosses: the phase as an index, the attack as
 *           an index into ATTACKS (which carries `reach` AND the arc the
 *           telegraph draws), how far through that phase it is, the guard
 *           direction, and the spin. Null for anything with no duel brain, so
 *           a wave of droids pays nothing for it.
 *
 *           The client poses it and does NOT resolve it: `Enemy._saberStrike`
 *           returns early on a netDriven body, because a blade that both
 *           animates locally and bills damage locally would hit twice. Sabers
 *           are billed by the host over `hit`, as they were.
 *
 * …and the snapshot carries `bf`, the bolts fired since the last one. A bolt is
 * an EVENT, not a state: it is gone by the next packet, so a state-only
 * protocol can never contain one.
 */
export function packSnapshot(world) {
  const enemies = [];
  for (const e of world.enemies) {
    enemies.push([
      e.id, e.type,
      r2(e.position.x), r2(e.position.y), r2(e.position.z),
      r2(e.facing), Math.round(e.hp), e.dead ? 1 : 0,
      r2(e.velocity?.x || 0), r2(e.velocity?.z || 0),
      e.aimCharge > 0 ? 1 : 0,
      packDuel(e.duel),
    ]);
  }
  const fires = world._netFires || [];
  const snap = {
    t: 'snapshot',
    e: enemies,
    bf: fires.slice(),
    w: world.director.wave,
    act: world.director.active ? 1 : 0,
    rem: world.director.remaining,
    // The intermission clock. `director.intermission` is only ever moved by
    // `director.update`, which a client never runs, so its HUD printed
    // "next wave in 0" for the whole 5.5 s between waves and never printed
    // "attune" during a draft it was simultaneously being offered.
    ic: r2(world.director.intermission || 0),
    sc: Math.round(world.score),
  };
  fires.length = 0;
  return snap;
}


const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * A duellist's blade, as the six numbers `Enemy._poseSaber` actually reads.
 *
 * Null for a body with no duel brain, which is most of a wave — the record is
 * one slot either way and a droid does not pay for a saber it does not carry.
 */
function packDuel(d) {
  if (!d) return null;
  const ph = DUEL_PHASES.indexOf(d.phase);
  const len = d.phase === 'windup' ? d._windupLen
    : d.phase === 'strike' ? d._strikeLen
      : d.phase === 'recover' ? d._recoverLen : 0;
  return [
    ph < 0 ? 0 : ph,
    d.attackKey ? ATTACK_KEYS.indexOf(d.attackKey) : -1,
    // How far through the phase, 0 → 1. The telegraph's fill is this number and
    // so is the strike's guard sweep; a client that does not know it can draw
    // an arc but cannot draw it FILLING, which is the half that reads as a
    // warning rather than as decoration.
    r3(len > 0 ? 1 - Math.max(0, Math.min(1, d.timer / len)) : 0),
    r3(d.guardDir.x), r3(d.guardDir.y), r3(d.guardDir.z), r3(d.spin || 0),
  ];
}
