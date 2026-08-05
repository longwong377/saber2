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
import { buildJedi } from '../game/Bodies.js';
import { Rig, BipedAnimator } from '../game/Rig.js';
import { Saber } from '../game/Saber.js';
import { clamp, lerp, damp, dampVec, makeRng, TAU } from '../engine/MathUtil.js';

const rng = makeRng(31415);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3479';
const PREFIX = 'saberduel-';

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
    this.conns = new Map();       // peerId → { conn, name, ready, lastSeen }
    this.isHost = false;
    this.connected = false;
    this.code = null;
    this.name = 'Jedi';
    this.handlers = new Map();
    this.roster = [];
    this.tickRate = 18;
    this._accum = 0;
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

  async host(name, settings) {
    const Peer = await loadPeerLib();
    this.name = name || 'Jedi';
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
        this.roster = [{ id: peer.id, name: this.name, host: true }];
        this._emit('roster', this.roster);
        this._emit('open', code);
        resolve(code);
      });
      peer.on('connection', (conn) => this._acceptConnection(conn));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // code collision — pick another and try once
          peer.destroy();
          this.host(name, settings).then(resolve, reject);
          return;
        }
        fail(err);
      });
      peer.on('disconnected', () => { this._emit('status', 'signalling lost — peers already connected are unaffected'); });
    });
  }

  async join(code, name) {
    const Peer = await loadPeerLib();
    this.name = name || 'Jedi';
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
        const conn = peer.connect(PREFIX + this.code, { reliable: true, metadata: { name: this.name } });
        this.hostConn = conn;
        conn.on('open', () => {
          this.connected = true;
          conn.send({ t: 'hello', name: this.name });
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
      this.conns.set(conn.peer, { conn, name: conn.metadata?.name || 'Jedi', ready: true, lastSeen: performance.now() });
      this._refreshRoster();
      this._emit('peer-joined', conn.peer, conn.metadata?.name);
      conn.send({ t: 'welcome', settings: this.settings, roster: this.roster, hostName: this.name });
    });
    conn.on('data', (msg) => this._onMessage(msg, conn));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this._refreshRoster();
      this._emit('peer-left', conn.peer);
    });
    conn.on('error', () => {
      this.conns.delete(conn.peer);
      this._refreshRoster();
      this._emit('peer-left', conn.peer);
    });
  }

  _refreshRoster() {
    this.roster = [{ id: this.peer?.id, name: this.name, host: true }];
    for (const [id, c] of this.conns) this.roster.push({ id, name: c.name, host: false });
    this._emit('roster', this.roster);
    if (this.isHost) this.broadcast({ t: 'roster', roster: this.roster });
  }

  _onMessage(msg, conn) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case 'hello':
        if (this.conns.has(conn.peer)) this.conns.get(conn.peer).name = msg.name;
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
        this._emit('avatar', conn.peer, msg);
        if (this.isHost) this.broadcastExcept(conn.peer, { ...msg, from: conn.peer });
        break;
      case 'claim': this._emit('claim', conn.peer, msg); break;
      case 'event': this._emit('event', msg); break;
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

  get peerCount() { return this.isHost ? this.conns.size : (this.connected ? 1 : 0); }

  close() {
    for (const { conn } of this.conns.values()) { try { conn.close(); } catch {} }
    this.conns.clear();
    try { this.hostConn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.peer = null; this.connected = false; this.enabled = false;
    this.roster = [];
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

    const built = buildJedi({ robeIndex: opts.robeIndex ?? 1 });
    this.rig = built.rig;
    world.scene.add(this.rig.root);
    this.animator = new BipedAnimator(this.rig, { scale: 1, hipHeight: 0.95 });

    this.saber = new Saber(world.scene, {
      colorIndex: opts.colorIndex ?? 1, bladeLength: opts.bladeLength ?? 1.15,
      hiltStyle: opts.hiltStyle ?? 'Guardian',
    });
    this.saber.ignite();

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.facing = 0;
    this.hp = 100; this.maxHp = 100;

    this.buffer = [];
    this.delay = 0.09;      // interpolation window
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

  push(state, now) {
    this.buffer.push({ t: now, s: state });
    while (this.buffer.length > 24) this.buffer.shift();
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

export function packSnapshot(world) {
  const enemies = [];
  for (const e of world.enemies) {
    enemies.push([
      e.id, e.type,
      r2(e.position.x), r2(e.position.y), r2(e.position.z),
      r2(e.facing), Math.round(e.hp), e.dead ? 1 : 0,
    ]);
  }
  return {
    t: 'snapshot',
    e: enemies,
    w: world.director.wave,
    act: world.director.active ? 1 : 0,
    rem: world.director.remaining,
    sc: Math.round(world.score),
    ts: performance.now() / 1000,
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
