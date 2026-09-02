/**
 * BATTLEFRONT BORZ — peer-to-peer co-op.
 *
 * One player hosts and simulates the horde; everyone else runs their own blade
 * locally and tells the host what it did. That split is deliberate: enemy
 * positions can tolerate 80 ms of interpolation, but the blade cannot tolerate
 * a single frame of it, so the blade never leaves the machine holding the mouse.
 *
 * Signalling goes through the public PeerJS broker by default. Point
 * `SABER_SIGNAL` at your own broker if you would rather not use it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { buildJedi, speciesOf } from '../game/Bodies.js';
import { Rig, BipedAnimator } from '../game/Rig.js';
import { Saber } from '../game/Saber.js';
import { SKIN_TONES, HAIR_COLORS } from '../ui/Menu.js';
import { clamp, lerp, TAU } from '../engine/MathUtil.js';
import { ATTACK_KEYS, DUEL_PHASES } from '../game/Duel.js';
/**
 * The side rules, from the file that owns `Player.team`.
 *
 * A RemoteAvatar is in `world.players` and World's loops treat it as a Player,
 * so it has to answer the same questions with the same code — the alternative
 * is a second `canHarm` with its own idea of a team, on the one machine that
 * cannot see the fight it is arbitrating. This direction (net depends on game)
 * is the one Net.js already has: it imports Bodies, Rig, Saber, Duel and Menu.
 */
import { canHarm, asSide, TEAM, rigCapsules, DuelMatch } from '../game/Player.js';
import { TOUGHNESS } from '../game/Combat.js';

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
 *
 * `ORDER` WAS PUT ON THIS LIST AND TAKEN OFF AGAIN, and the measurement is
 * worth keeping so the next reader does not spend the same hour. It looks like
 * it has a reader now: Command's `assignArmies` derives the ARMY from the
 * Jedi/Sith choice, and with the field absent `World.beginVersus` reads every
 * peer as the HOST's own order. So the peer's real choice ought to change which
 * of two commanders is handed the army they did not want.
 *
 * It does not, and it cannot. `assignArmies` gives the first commander what
 * they ask for and resolves every conflict after that against what is already
 * taken — so with TWO armies on the roster the second side gets the one the
 * first did not take, whatever it asked for. Enumerated over every roster of
 * two, three and four commanders and both orders apiece: the peer's real order
 * changes the assignment in **0 of 28**. A field whose reader cannot change an
 * outcome is bandwidth and a maintenance cost, which is what the check below
 * this one exists to catch. It becomes worth sending the day there is a third
 * army — and not before.
 */
/**
 * …AND `saberSet` IS ONE OF THESE AND NOT A SHARED RULE.
 *
 * The test LOCAL_KEYS states is "whose answer wins", and nobody else's answer
 * is involved: which weapon you carry is a thing about YOUR body, it crosses
 * on the avatar packet exactly as your blade's colour and length already do,
 * and two players in one session carrying different weapons is the feature
 * rather than a disagreement. Putting it on SHARED_KEYS would mean the host
 * choosing what is in everybody's hands, which is the "reaching onto somebody
 * else's mouse" case that table refuses.
 *
 * `session.mjs` fails a key on neither list or on both, so this is enforced
 * rather than remembered.
 */
export const LOOK_KEYS = ['colorIndex', 'bladeLength', 'coreWidth', 'hiltStyle', 'robeIndex',
  'skinIndex', 'hairIndex', 'build', 'species', 'face', 'saberSet'];

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
    /** peer id → side. Written by the host through setSides; see _sideOf. */
    this.sides = new Map();
    /** Round trip / 2, from the ping World sends every 2 s. Read by the scoreboard. */
    this.latency = 0;
    /** The stamp of the ping we are still waiting on. See the `pong` case. */
    this._pingSent = null;
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
        // Through _refreshRoster's shape rather than a second literal: the two
        // drifted the moment the roster grew a `team`, and a host sitting alone
        // in a lobby had an entry with no side on it at all.
        this.roster = [{ id: peer.id, name: this.name, host: true, look: this.look, team: this._sideOf(peer.id) }];
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
    this.roster = [{ id: this.peer?.id, name: this.name, host: true, look: this.look,
      team: this._sideOf(this.peer?.id), ...this._seatOf(this.peer?.id) }];
    for (const [id, c] of this.conns) {
      this.roster.push({ id, name: c.name, host: false, look: c.look || null,
        team: this._sideOf(id), ...this._seatOf(id) });
    }
    this._emit('roster', this.roster);
    if (this.isHost) this.broadcast({ t: 'roster', roster: this.roster });
  }

  /**
   * WHERE A PLAYER STANDS AT THE START OF A MATCH — the other half of a side.
   *
   * `sides` answers who may hit whom and it is not enough on its own for two
   * armies. A meeting engagement puts the two commanders 120 m apart, and a
   * client that was told its SIDE but not its GROUND spawned at the level's own
   * home spot — so the Confederacy's general stood in the middle of the
   * Republic's line while their own army formed up around them, because a
   * formation is solved in its commander's frame. Both machines were internally
   * consistent and the battle had no two sides in it.
   *
   * A seat is identity for the length of a match, exactly as a side is, so it
   * rides the same roster for the same reason and is written by the same
   * authority. Empty for every session that is not a meeting, which is all of
   * them so far — `...{}` spreads to nothing and the roster entry is byte for
   * byte what it was.
   */
  _seatOf(id) {
    const s = this.seats?.get(id);
    if (!s || !Array.isArray(s.at)) return {};
    return { at: s.at, facing: s.facing ?? 0 };
  }

  /**
   * Host: hand out ground. `map` is peer id → `{ at: [x, y, z], facing }`.
   *
   * Refused on a client for the reason `setSides` is: a peer that could choose
   * its own ground could choose the middle of yours.
   */
  setSeats(map) {
    if (!this.isHost) return this.roster;
    this.seats = map instanceof Map ? map : new Map(Object.entries(map || {}));
    this._refreshRoster();
    return this.roster;
  }

  /**
   * WHICH SIDE A PEER IS ON, and why it rides the roster.
   *
   * A side is IDENTITY for the length of a match, not per-frame state, so it
   * belongs beside `name` and `look` on the roster rather than in the 24 Hz
   * avatar packet — exactly the argument LOOK_KEYS makes above, and for the
   * same price: sending it in the avatar record would pay for it forever, and
   * it changes about once a match.
   *
   * `sides` is a Map the HOST writes and everybody else receives. There is no
   * client-side assignment at all: two machines that disagreed about who is on
   * whose side would disagree about who may hit whom, which is the worst thing
   * a networked rule can do. `asSide` on the way out so a corrupt entry lands
   * a body in co-op rather than on the horde's number.
   */
  _sideOf(id) { return asSide(this.sides?.get(id) ?? TEAM.PARTY); }

  /**
   * Host: hand out sides and tell everyone.
   *
   * Takes a Map of peer id → side (build it with `assignSides` in Player.js,
   * which is pure and deterministic so a client can verify the same roster
   * reaches the same answer). Refuses on a client: a peer that could set its own
   * side could set itself onto yours and stop your blade.
   */
  setSides(map) {
    if (!this.isHost) return this.roster;
    this.sides = map instanceof Map ? map : new Map(Object.entries(map || {}));
    this._refreshRoster();
    return this.roster;
  }

  /**
   * A NEW NAME, MID-SESSION — and the field that types it had been wired to
   * nothing since it was added.
   *
   * `Menu` raises `hooks.onName` on every keystroke in the co-op name box and
   * NO CALLER HAS EVER SUPPLIED ONE: grep `onName` across `src/` and the only
   * hit is the line that raises it. `net.name` is read exactly twice, by
   * `host()` and `join()`, so a player who types a name, hosts, and then
   * changes their mind is listed under the old one for the rest of the session
   * — on the roster, in the status line and in the kill feed. That is the same
   * defect the name field was added to end, one step later in the story.
   *
   * NO NEW MESSAGE ON THE WIRE. A client says `hello` again, which is the join
   * handshake's own packet and whose handler already does exactly the right
   * thing — set the sender's name and refresh — and the host refreshes its own
   * roster, which broadcasts. `toHost` rather than `broadcast` because a name
   * is the sender's to state and the HOST is the only node that may publish a
   * roster; a client that broadcast one would be the forgery `_sender`'s note
   * describes.
   *
   * @returns {boolean} did the name actually change
   */
  setName(n) {
    /* `|| 'Jedi'` AND NOTHING ELSE, which is exactly what `host()` and `join()`
     * do to the same argument. The trim and the 18-character cap live in
     * `main.js`'s `playerName()`, which is the one place that turns a settings
     * field into a name; a second copy of that rule here is the twin-table
     * defect, and the day the cap moved they would disagree about the player. */
    const name = n || 'Jedi';
    if (name === this.name) return false;
    this.name = name;
    if (this.isHost) this._refreshRoster();
    else this.toHost({ t: 'hello', name: this.name, look: this.look });
    return true;
  }

  /** Everybody's side, as the roster currently states it. id → team. */
  get teams() {
    const out = new Map();
    for (const r of this.roster) out.set(r.id, asSide(r.team));
    return out;
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
   *
   * READ ON THE HOST IT IS A FORGERY, and that is the other half of the same
   * fact. `from` exists because a CLIENT cannot tell senders apart on its one
   * host connection; the HOST has a connection per peer, so `conn.peer` is
   * already the answer and `msg.from` is nothing but a string the sender chose.
   * Trusting it on the host cost two proven attacks, both from a peer that only
   * ever had to add one field: ALPHA sent `{t:'muster', from:'PEER2', …}` and
   * spent BRAVO's purse (40 → 35 points on a commander ALPHA does not command),
   * and ALPHA sent `{t:'avatar', from:BRAVO, p:[400,0,400], h:0, a:0}` and
   * puppeted BRAVO's body on the host — driven to (400,0,400), dead, hp 0, 0
   * capsules for a blade to find, while on BRAVO's own machine it stood alive
   * at (3,0,4). `claim` and `order` were already right; they read `conn.peer`.
   */
  _sender(msg, conn) { return this.isHost ? conn.peer : (msg.from || conn.peer); }

  _onMessage(msg, conn) {
    if (!msg || !msg.t) return;
    const c = this.conns.get(conn.peer);
    if (c) c.lastSeen = performance.now() / 1000;
    switch (msg.t) {
      case 'hello':
        if (c) { c.name = msg.name; if (msg.look) c.look = msg.look; }
        this._refreshRoster();
        break;
      /**
       * Host → peers, all five of them, and the `!this.isHost` is the direction
       * exactly as it is on `army` and `match`.
       *
       * They were unguarded, and a peer therefore spoke to the host in the
       * host's own voice. Measured on a real three-endpoint session: one
       * `{t:'roster', roster:[{id:'ghost', name:'<img onerror>', host:true,
       * team:3}]}` replaced the host's three-entry roster with that single
       * forged line — and since `teams` and `peers` are both derived from
       * `roster`, the host's idea of who is playing and which side they are on
       * went with it. One `welcome` then made the host announce a level, mode
       * and difficulty it had never chosen (`hangar/duel/master`) and emptied
       * the roster completely. A ledger only the host can keep is a ledger only
       * the host may write, which is the whole of `army`'s argument.
       */
      case 'welcome':
        if (this.isHost) break;
        this.roster = msg.roster || [];
        this._emit('roster', this.roster);
        this._emit('welcome', msg.settings);
        break;
      case 'roster':
        if (this.isHost) break;
        this.roster = msg.roster || [];
        this._emit('roster', this.roster);
        break;
      case 'start': if (!this.isHost) this._emit('start', msg); break;
      case 'snapshot': if (!this.isHost) this._emit('snapshot', msg); break;
      case 'avatar':
        this._emit('avatar', this._sender(msg, conn), msg);
        if (this.isHost) this.broadcastExcept(conn.peer, { ...msg, from: conn.peer });
        break;
      // A peer has left the session. Only the host holds `conns`, so only the
      // host can know; this is how everybody else finds out. See _dropPeer.
      case 'left': if (!this.isHost) this._emit('peer-left', msg.id); break;
      case 'claim': this._emit('claim', conn.peer, msg); break;
      /**
       * Host → peers: the army, the area and the order in force.
       *
       * One direction only, and for the same reason `match` is: the roster is a
       * ledger of promotions, casualties and reinforcement points that only the
       * machine holding the bodies can keep. A client that kept its own version
       * of it kept a DIFFERENT army — measured on a real pair, two disjoint
       * lists of ten names, one of which had never been deployed.
       *
       * Not folded into the snapshot: it is 2.5 KB at a full roster and changes
       * about twice a second at its very worst, so the 18 Hz record would spend
       * 45 KB/s repeating a casualty list. Exactly the argument `match` makes.
       */
      case 'army': if (!this.isHost) this._emit('army', msg); break;
      /**
       * Peer → host: "form wedge."
       *
       * The one Command message that travels the other way, and the only thing
       * a commander who is not holding the army can do. Stamped with the sender
       * the way `claim` is, so the host can tell whose army is being asked for
       * once there is more than one — see the sides work in Player.js.
       */
      case 'order': if (this.isHost) this._emit('order', conn.peer, msg); break;
      /**
       * THE MUSTER, AND IT IS THE ONE MESSAGE THAT TRAVELS BOTH WAYS.
       *
       * Host → peers it is the OFFER: `musterOffer()` verbatim, or null when
       * the card comes down. Peer → host it is an INTENT: a unit to buy, or
       * "I am done". One type rather than two because it is one conversation
       * with one subject, and every reply is the answer to an ask — the shape
       * `ping`/`pong` has, without the second name.
       *
       * THE DIRECTION IS NOT DECIDED HERE, and that is deliberate rather than
       * an omission. `army` and `order` each guard on `isHost` because each has
       * exactly one direction and the guard IS the direction; this one has two,
       * so a guard here could only ever assert half of it. It is resolved in
       * `World.applyMuster`, which branches on `netMode` — a total split, so a
       * message lands in exactly one branch and neither branch reads the
       * other's fields. A client cannot hand the host an offer, because the
       * host branch never looks for one; a host cannot be made to spend a
       * client's claim about its own points, because no such claim is on the
       * wire at all. The only thing a peer may say is which unit it wants.
       *
       * Stamped with the sender the way `order` and `claim` are, so the host
       * can tell whose purse is being spent once there is more than one — a
       * meeting gives every commander a roster and a purse of their own.
       */
      case 'muster': this._emit('muster', msg, this._sender(msg, conn)); break;
      // Host → this peer: you were hit. The reverse of `claim`, and it exists
      // for the same reason — the authority for a thing is not where the thing
      // is drawn. A peer owns its own health (its avatar packet carries `hp`,
      // and the host overwrites its copy 24 times a second), so the host cannot
      // apply the damage itself; it can only say so.
      // Guarded like `army`, and it is the most expensive omission on this
      // wire: it was the ONE host→peer message with no direction on it. A
      // client sending a single `{t:'hit', d:9999, k:'force', v:[0,40,0], s:0}`
      // took the host from 100 hp to 0 and threw it upward at 39.3 m/s, in one
      // packet, from full health — and `canHarm` never got a word in, because
      // `s:0` resolves to a null source and a null source is the environment,
      // which `_tellHit`'s own note says is never gated. There is no legitimate
      // sender: the host is the only node that can say a blow landed.
      case 'hit': if (!this.isHost) this._emit('hit', msg); break;
      // Host → peers: a draft is open. The moment, not the hand — see the note
      // on World's onDraft.
      case 'draft': if (!this.isHost) this._emit('draft', msg); break;
      /**
       * Host → peers: the state of the duel.
       *
       * One direction only, and there is no client branch on purpose. A round
       * ends when a side has nobody standing, and the only node that can see
       * every body is the host — a client knows its own health for certain and
       * everybody else's as of 90 ms ago. A client that scored its own rounds
       * would award itself one every time a packet was late.
       *
       * Sent on a phase change and at 1 Hz, not in the snapshot: it is under
       * 150 bytes and changes about four times a minute, so folding it into the
       * 18 Hz record would cost 2.7 KB/s to say the same thing 18 times.
       */
      case 'match': if (!this.isHost) this._emit('match', readMatch(msg)); break;
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
        // …and NOT back to the peer that sent it. The only test used to be
        // `msg.to !== this.peer?.id`, so a peer addressing an aura to its own
        // id had the host post it straight back — a buff nobody granted it,
        // arriving with the host's blessing. Measured: moveSpeed 1 → 1000000,
        // cutPower 0.85 → 850000, hp 10 → 100 off one self-addressed packet.
        // The relay's job is to reach the node the sender cannot; `conn.peer`
        // is by definition not that node.
        if (this.isHost && msg.to && msg.to !== this.peer?.id && msg.to !== conn.peer) this.toPeer(msg.to, { ...msg, from: conn.peer });
        else this._emit('bond', msg, this._sender(msg, conn));
        break;
      // 'event' was routed here with no sender anywhere and no listener
      // anywhere — a channel that existed only as this line. Deleting it is as
      // valid a fix as giving it a purpose, and it is the honest one: nothing
      // downstream was waiting for it. See tools/checks/coop.mjs.
      case 'ping': this.send(conn, { t: 'pong', s: msg.s }); break;
      // A pong is only an answer, so it is only worth reading on the side that
      // asked — `_pingSent` is stamped by `send` and cleared here, one pong per
      // ping. Unsolicited, it is a number the sender chose: a peer sent
      // `{t:'pong', s:-1e9}` to a host that had never pinged it and set the
      // host's published latency to 500000653 ms, which every consumer of it
      // reads as truth (`World`'s interception lead is `2*latency/1000`).
      case 'pong':
        if (msg.s !== this._pingSent) break;
        this._pingSent = null;
        this.latency = (performance.now() - msg.s) * 0.5;
        break;
      default: this._emit(msg.t, msg, conn.peer);
    }
  }

  send(conn, msg) {
    // The ping is composed in World (`net.toHost({t:'ping', …})`), so this is
    // the only place Net can learn that it asked — see the `pong` case.
    if (msg && msg.t === 'ping') this._pingSent = msg.s;
    try { conn.send(msg); } catch {}
  }

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
    /**
     * THE SIDE THIS PLAYER IS ON — and it was the literal `0`, read by nothing.
     *
     * That is the field a duel is made of. Every remote body in every session
     * was on the party's side, so `canHarm` would have said "no" to every blade
     * in a duel even after the blade could find a body — and there was no way
     * to say otherwise, because nothing ever wrote to it. It arrives on the
     * ROSTER, not in the avatar packet: a side is identity for the length of a
     * match, and the host is the only node allowed to decide it (see
     * `Net.setSides`). Through `asSide`, so a corrupt or absent value lands a
     * body in co-op rather than on the horde's ledger.
     */
    this.team = asSide(opts.team);
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
   * A FRIEND'S BODY, AS SOMETHING A BLADE CAN FIND.
   *
   * The same absence a local Player had, and the same fix, through the same
   * function — `rigCapsules` is called by both, so a Jedi you are duelling has
   * exactly the shape of the Jedi you are playing whichever machine is asking.
   * A second copy of the bone walk here is how the two would end up disagreeing
   * about where a chest is, which in a duel is the difference between a hit and
   * a miss.
   *
   * The rig is REAL on this machine: `update()` runs the same `BipedAnimator`
   * and the same IK the local player does, off interpolated snapshots. So these
   * capsules are where the body is DRAWN, which is the only place a player can
   * be asked to aim at.
   */
  capsules() {
    const out = (this._caps ||= []);
    out.length = 0;
    if (!this.alive) return out;
    return rigCapsules(this.rig, { into: out, owner: this, toughness: TOUGHNESS.flesh });
  }

  /**
   * Shoved. The call shape every force power ends in, so a duel's push reaches
   * a peer through the same line it reaches an acolyte through.
   *
   * THE SHOVE TRAVELS NOW, AND UNTIL IT DID A DUEL'S FORCE WAS A NUMBER.
   *
   * This used to add the impulse to `velocity` and send nothing but `{d, k}` —
   * a bare amount. `update()` overwrites `velocity` from the interpolation
   * buffer on the very next frame, so the local add was inert (it still is, and
   * it is kept only as the one frame of smoothing before the buffer speaks),
   * and the packet had no room for a direction. Measured on a real host/client
   * pair: a point-blank push on another player took hp off them and moved them
   * 0.000 m on both machines. Push, pull, throw and the enemy kit's own shove
   * were all damage with no physics for everybody who was not the host.
   *
   * So the impulse goes in the packet and the peer applies it to their OWN
   * Player, which is the only body in the session that can move it — and it
   * arrives through `Player.applyKnockback` rather than `damage`, so the shove
   * and the harm are weighed together in one contest exactly as they are when
   * the two fighters share a machine. See the note over `_tellHit`.
   */
  applyKnockback(impulse, damage = 0, source = null, gentle = false) {
    if (!this.alive) return false;
    if (impulse) this.velocity.add(impulse);
    return this._tellHit(damage || 0, 'force', source, impulse, gentle);
  }

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
   */
  damage(amount, point, source, kind) {
    if (!(amount > 0) || !this.alive) return false;
    return this._tellHit(amount, kind, source, null, false);
  }

  /**
   * ONE DOOR OUT, so a shove and a cut cannot end up on the wire under two
   * different sets of rules — which is precisely what happened while
   * `applyKnockback` reached the wire only by calling `damage`: a pull carries
   * no damage at all (`Enemy._castPower` bills it at 0), so `amount > 0` threw
   * the whole packet away and a peer being yanked across the field received
   * nothing whatsoever.
   *
   * Silently does nothing on a client, so a peer cannot damage another peer —
   * the host is the only authority, and the alternative is four machines each
   * applying their own version of the same sword.
   */
  _tellHit(amount, kind, source, impulse, gentle) {
    const push = impulse && impulse.lengthSq() > 1e-8 ? impulse : null;
    if (!this.alive || (!(amount > 0) && !push)) return false;
    /**
     * THE SAME GATE THE LOCAL PLAYER PASSES THROUGH, AND THE SAME FUNCTION.
     *
     * Without it a duel's rule and co-op's rule would be enforced in two
     * places, one of which is the only machine in the session that can see both
     * fighters. `canHarm` reads `world.rules`, and the host is the node that
     * sets them, so the answer here is the answer everywhere.
     *
     * A null source is the environment and is never gated — `World.onExplosion`
     * passes null, and a wave-clear blast has always reached every body in the
     * room. Note what this does NOT do: it does not stop a peer being told
     * about a hit it already resolved. That is the bolt rule below, and the two
     * are separate questions — "may this land" and "who bills it".
     */
    if (!canHarm(source, this)) return false;
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
    /**
     * WHO DID IT — and it was nobody, all the way to the far end.
     *
     * `main.js` applied every one of these as `p.damage(d, null, null, k)`.
     * `Player.die` hands `source` to `onPlayerDeath`, so a joining player
     * killed by a Sith Master's lightning died to a null: no kill credit, no
     * name on the death card, nothing in the feed. One field fixes it, and the
     * only work is saying which id the far end knows this body by.
     */
    const msg = { t: 'hit', d: r3(amount || 0), k: kind, s: hitSourceId(source, net) };
    if (push) {
      msg.v = [r3(push.x), r3(push.y), r3(push.z)];
      // `gentle` is what tells the far end whether this shove beats a guard:
      // `Player.applyKnockback` writes `staggerTimer` only when it is NOT
      // gentle, and a pull and a held power's tick both are. Absent means false,
      // which is what a shove is.
      if (gentle) msg.g = 1;
    }
    net.toPeer(this.id, msg);
    return false;
  }

  /**
   * A remote player heals on its own machine — the authority for a body's
   * health is the machine driving it, and the 24 Hz packet carries `hp` back.
   * These stay no-ops for that reason.
   *
   * WHAT THEY ARE NOT is a reason to refuse to AIM at him. `Player._allyList`
   * puts remote avatars in front of the mend, the ward and Restore, so your
   * friend can be picked, bubbled and counted in the circle; what lands on him
   * is his own machine's business, and `hp` on the next packet is what says
   * whether it worked. A power that would not even select him was the defect.
   */
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

/**
 * THE NAME THE FAR END KNOWS AN ATTACKER BY.
 *
 * An enemy is easy: `packSnapshot` sends `e.id` and `applySnapshot` writes the
 * same string onto the replicated copy, so the two machines have agreed on it
 * all along. A PLAYER is the awkward one, and it is the reason this is a
 * function rather than `source.id` written at the call site: the host's own
 * Player answers to `'local'` (Player.js: `this.id = opts.id ?? 'local'`) and
 * is a `RemoteAvatar` keyed by the host's PEER id on every other machine in the
 * session. Sending `'local'` would name a body that does not exist over there
 * and resolve to nobody, which is the null this field exists to remove.
 *
 * `0` for an attacker with no id at all — the environment, a fall, a wave-clear
 * blast — which is what `World.netSource` reads as "unattributed", and is
 * exactly the state every `hit` was in before the field existed.
 */
/**
 * WHAT THE HOST DECIDES FOR EVERYBODY — named once, spread everywhere.
 *
 * A session has two kinds of setting. Most are yours: your quality tier, your
 * fov, your blade colour, your bindings. A few are the MATCH's, and they have
 * to be identical on every machine or the game is two different games — the
 * ground, the difficulty, the mode, and the rules of engagement.
 *
 * That set was written out by hand at four sites in main.js — the handshake,
 * the `start` broadcast, and the two places a joining player writes `session` —
 * and a fifth in `World._afterRotate`, which announces a mid-run ground change.
 * Five hand-copies of one list is the §2.3 shape and it had already cost
 * something: `commandVersus`, the switch that turns Command into a meeting
 * between two players, is on none of them, so a host who ticks it and a client
 * who has not are in a meeting and a campaign respectively and neither is told.
 * `pvp` was about to become the second the day it got a control.
 *
 * IT LIVES HERE because this file is what decides what goes on the wire, and
 * because World.js and main.js are the two readers — neither imports the other,
 * and both already import this. A sixth session-wide rule is added to this line
 * and is on the wire at all five sites by construction.
 *
 * NOTE WHAT IS NOT HERE. `duelRounds`, `duelHealth`, `duelRoundTime` and
 * `duelBoons` are session-scoped too (see the SESSION_ONLY note in
 * tools/checks/controls.mjs) but are read only inside `DuelMatch`, which only
 * the host ever builds — a client never asks. Putting them on the wire would be
 * bytes nobody reads, and the day something else reads them is the day they
 * join this list.
 */
/**
 * …AND `seed` IS ON IT NOW, which is the fix for a client standing on a bare
 * map.
 *
 * The run's number was the one thing about a session that never crossed. Every
 * machine called `mintRunSeed()` and got its OWN random number, and `runSeed`
 * is not a cosmetic: `World._groundKeyFor` GENERATES THE HEIGHTFIELD from it
 * on every `battlefield` level, `theatreFor` ROLLS THE GROUND ITSELF from it
 * for a `seedsGround` mode (The Line lands on five different theatres over
 * eight seeds), and the objectives are placed from it.
 *
 * So the host and the joining player built different worlds and then exchanged
 * absolute coordinates about them. What the client saw depended on how far
 * apart the two rolls fell: a different theatre outright, or the same theatre
 * with a different landscape, with every body arriving inside its hills or
 * hanging over them. That is the reported symptom — "the teammates see nothing,
 * no host, no friends, no enemies, bare map".
 *
 * It rides on `start` beside `level` for the same reason `level` does: that
 * message is the sentence "the session is now on this ground", and the ground
 * is not fully named until the number that generates it is on the wire too.
 */
/**
 * …AND SIX KEYS WAS NOT ENOUGH, WHICH THE PLAYER FOUND BEFORE ANY CHECK DID.
 *
 * "I want you to be sure that every mode works in co-op and it's not dependent
 * on what any modes/maps non-host players have selected on their screens."
 *
 * The ground, the mode, the difficulty and the seed were on the wire, so the
 * headline was right. Everything else a menu can say about what the run IS was
 * still each machine's own, and `worldSettings()` is `{...settings, ...session}`
 * — so a key that is not on this list is the JOINING player's answer, used to
 * build their half of a world the host is authoritative for. Read down the
 * settings table and it is not a short list of edge cases:
 *
 *   `allies`      decides whether `World.loadLevel` builds a CommandDirector at
 *                 all. A host at 20 and a guest at 0 is an army on one machine
 *                 and a wave director on the other.
 *   `rules`       the run CONDITIONS — NO GUNS, the lot. The waves are composed
 *                 under them.
 *   `skirmish*`   the whole battle plan: how many engagements, how long, how
 *                 big, how hard.
 *   `sandbox*`    the practice room's population, which each machine holds to
 *                 its own numbers.
 *   `forceDrain`  0 is the setting whose own label reads "unlimited Force". A
 *                 guest could switch it on in somebody else's session.
 *
 * So the rule this list states is now stated properly: a setting that shapes
 * the SHARED WORLD or the FAIRNESS of the run is the host's, and everything
 * else is yours. `LOCAL_KEYS` below is the other half of it, and
 * `tools/checks/session.mjs` holds every setting in the game to being on
 * exactly one of the two lists — so the next setting somebody adds cannot
 * quietly default to "each machine decides for itself".
 */
export const SESSION_KEYS = [
  /* THE GROUND AND THE RUN. `seed` generates the heightfield, rolls the
   * theatre for a `seedsGround` mode and places the objectives — see above. */
  'level', 'seed', 'mode', 'difficulty', 'rules',
  /* WHO MAY HURT WHOM. The worst possible thing for two machines to disagree
   * about, because it decides damage. */
  'pvp', 'commandVersus', 'teamDamage',
  /* WHO CAN BE HURT BY WHAT. `stratagemOnly` decides whether a walker takes a
   * blade at all — two machines disagreeing about that is the damage
   * disagreement above wearing a different hat. */
  'stratagemOnly',
  /* WHETHER THERE IS AN ARMY AT ALL, and what it is made of. `allies` is the
   * one that picks the DIRECTOR CLASS, so a disagreement here is not a
   * difference of degree. */
  'allies', 'allyUnit', 'allyArmy', 'commandFormation',
  /* THE MEETING'S OWN PICKS — the sides, what each side fields, how it is won
   * and whether reinforcements come. See MODES.versus. */
  'versusStrength', 'versusWin', 'versusReinforce', 'versusTeams',
  /* THE BATTLE PLAN. */
  'skirmishEngagements', 'skirmishWaves', 'skirmishStrength',
  'skirmishPressure', 'skirmishRotate',
  /* THE PRACTICE ROOM, and whether bodies walk in or appear. */
  'sandboxCount', 'sandboxFire', 'sandboxType', 'sandboxMix', 'instantSpawn',
  /* THE HANDICAPS. Every one of these is a lever a guest could otherwise pull
   * on somebody else's run: unlimited Force, an unleashed blade, free Focus,
   * and whether the Holocron is in play. */
  'holocron', 'forcePower', 'forceDrain', 'unlimitedBlade', 'unlimitedFocus',
];

/**
 * WHAT STAYS YOURS, AND WHY — the other half of the rule above.
 *
 * Every setting in the game is on this list or on SESSION_KEYS, and
 * `tools/checks/session.mjs` fails if one is on neither or on both. The reason
 * strings are the point: "it is not shared" is a decision, and a decision with
 * no reason written next to it is the one that gets made wrong next time.
 *
 * Three kinds, and they are genuinely different:
 *
 *   YOUR MACHINE     a frame rate is not a rule. Nothing here changes what
 *                    happens, only what it costs to draw.
 *   YOUR BODY        who you are and what you look like. Some of it already
 *                    crosses on `LOOK_KEYS` so other people can see you — that
 *                    is a different wire and a different question from "whose
 *                    answer wins".
 *   YOUR HANDS       a control scheme, a sensitivity, a reticle. Sharing one
 *                    of these would be the host reaching onto somebody else's
 *                    mouse.
 */
export const LOCAL_KEYS = {
  /* ── your machine ────────────────────────────────────────────────── */
  quality: 'a frame rate is not a rule',
  resolutionScale: 'a frame rate is not a rule',
  maxBodies: 'how many bodies THIS machine will draw; the host stays authoritative for who is alive',
  bloom: 'a post pass', grain: 'a post pass', particleScale: 'a post pass',
  grassScale: 'ground cover density, drawn not simulated',
  showPerf: 'a debug overlay',
  /* ── what your screen does to you ────────────────────────────────── */
  shake: 'camera feel', slowmo: 'camera feel', rumble: 'a gamepad motor',
  letterbox: 'a framing choice', injury: 'a screen effect', deathDrain: 'a screen effect',
  popups: 'whether YOUR feed prints', minimap: 'whether YOUR map is up',
  minimapSense: 'whether YOUR map costs Force to read',
  reticleShape: 'your crosshair', reticleSize: 'your crosshair', reticleColor: 'your crosshair',
  /* ── your hands ──────────────────────────────────────────────────── */
  sensitivity: 'your mouse', camFollow: 'your camera', fov: 'your camera',
  invertY: 'your mouse', firstPerson: 'which shoulder you play over',
  scheme: 'your control scheme', deflectAim: 'how YOUR guard is aimed',
  bladeHold: 'whether YOUR blade holds position',
  fullscreen: 'whether YOUR browser gives the game the whole screen',
  /* ── your ears ───────────────────────────────────────────────────── */
  volume: 'your speakers', music: 'your speakers', musicIndex: 'your soundtrack',
  voiceLevel: 'your speakers', voiceIndex: 'your voice', voiceLines: 'whether YOU speak',
  forceVoice: 'whether YOU call your powers', enemyVoices: 'whether the horde speaks to YOU',
  speechMode: 'how YOUR lines are delivered', enemyBody: 'whose body plays a line',
  /* ── your body ───────────────────────────────────────────────────── */
  playerName: 'your name; it crosses on the roster instead',
  order: 'which temple you belong to — measured not to change an army assignment in 0 of 28 rosters, see beginVersus',
  colorIndex: 'your crystal', lightningColor: 'your lightning', hiltStyle: 'your hilt',
  species: 'your face', face: 'your face', robeCut: 'your clothes', robeIndex: 'your clothes',
  wardrobe: 'your clothes', skinIndex: 'your skin', hairIndex: 'your hair', build: 'your build',
  meditation: 'how YOUR body sits when you commune; nobody else\'s knees',
  bladeLength: 'your blade — re-clamped against the SESSION\'s ceiling, see worldSettings',
  coreWidth: 'your blade',
  troopNames: 'whose name is over whose head, on YOUR screen',
};

/**
 * Those keys of an object, skipping the ones it does not carry.
 *
 * Skipping rather than writing `undefined` is load-bearing at the receiving
 * end: `session` is REPLACED on a `start`, not merged, because a mode change
 * has to be able to take a key away. A sender that wrote `pvp: undefined`
 * would put the key on the wire as absent-but-present and the two would stop
 * being distinguishable.
 */
export function sessionPart(o) {
  const out = {};
  for (const k of SESSION_KEYS) if (o && o[k] !== undefined) out[k] = o[k];
  return out;
}

export function hitSourceId(source, net) {
  const id = source?.id;
  if (id === undefined || id === null) return 0;
  if (!source.isLocal) return id;
  return net?.peer?.id ?? net?.roster?.find((r) => r.host)?.id ?? 0;
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
 *   md      WHICH ELITE THIS IS, and it is the field the whole escalation model
 *           was missing. `e.type` names the archetype and NOTHING named the
 *           modifier, so on a joining player's screen every elite in the game
 *           wore the plain chassis: measured on two real Worlds fielding one of
 *           every producible (archetype, modifier) pair — 23 of them — 23 of 23
 *           arrived with `e.mod` undefined and 0 of 23 carried a single tell.
 *           Host vs client, per tell: deflector bubbles 4 vs 0, reactor cores
 *           5 vs 0, rally rings 4 vs 0, off-hand blades 1 vs 0, tinted bodies
 *           18 vs 0. The labels came across as "Sith Acolyte" where the host
 *           read "Armoured Sith Acolyte". Enemy.js's MODIFIERS block opens by
 *           saying a difficulty you cannot see coming is not difficulty, it is
 *           a surprise; this is the field that makes that true off-host.
 *
 *           It is worth a slot for a second reason that is not cosmetic at all.
 *           `applyModifier` resets `maxHp`, and the client's grind billing —
 *           `share * e.maxHp * GRIND_LETHALITY` in World._applyBladeEvent — is
 *           read off the CLIENT's copy. With the base archetype's maxHp under
 *           an elite's health the same swing billed the host anywhere from
 *           0.667× (armoured, leader) to 1.724× (frenzied) of what it should,
 *           and 7 of those 23 arrived carrying more hp than the client believed
 *           the body could hold at all.
 *
 *           The KEY, not an index into MODIFIER_KEYS: `e.type` in the same
 *           record is already a bare string, an index decodes as a DIFFERENT
 *           elite the day that table is reordered, and a plain body — which is
 *           most of every wave — pays one byte for `0` either way. Priced on
 *           the worst realistic composition rather than guessed at: a real
 *           director run to wave 20 on the arena fields 21 bodies of which 12
 *           are elite, and one snapshot of it is 1443 bytes with no field,
 *           1582 with the key, 1494 with an index — 25.4, 27.8 and 26.3 KB/s
 *           at the host's 18 Hz. 1.5 KB/s is not worth a decoder that can be
 *           silently wrong.
 *
 *   tm      WHOSE SIDE THIS BODY IS ON, and it is one number against the worst
 *           defect co-op and Command had between them. Every record on this
 *           wire described a body and never said whose it was, because for the
 *           whole life of the protocol the answer was "the horde's" and a
 *           constant does not need a slot. Command broke that: `enlistBody`
 *           puts your named troopers in `world.enemies` on the PARTY's team,
 *           and they crossed as team 1 like everything else.
 *
 *           Driven on two real Worlds with a ten-man roster deployed, before
 *           the field existed: 10 of 10 of the host's named troopers arrived on
 *           the joining player's machine on the horde's team, so
 *           `canHarm(theirPlayer, yourSergeant)` was TRUE and every gate in the
 *           game that asks it opened. The two that matter both fire without
 *           anybody aiming at anything:
 *
 *             · `_boltHitTest` reads `bolt.owner.team`, and a replicated bolt's
 *               owner is the body that fired it — so YOUR OWN ARMY'S RIFLES
 *               shot the joining player in the back, all game, from a line they
 *               were standing behind.
 *             · a bolt that player deflected carried their own team 0 against
 *               your trooper's wrongly-read 1, so every deflection they made
 *               into the line was a friendly casualty they could not have
 *               known about.
 *
 *           `e.team` raw, not an index and not a boolean: the numbers are the
 *           game's own (`TEAM.PARTY` 0, the horde's 1, further player sides 2-4
 *           from `SIDES`), one slot carries all five, and `asTeam` on the far
 *           end is what makes an illegible one the horde rather than a friend.
 *
 *   ck      WHICH POWER THIS BODY IS THROWING, and off-host there was no such
 *   cw      thing as a warning. `_forceBrain` opens every cast with a 0.45 s
 *   ch      wind-up and a floating call over the head, and its own note says
 *           why: "a power that arrives with no frame of warning is the 11.5 m
 *           sphere the beasts check has a note about". None of `_castKey`,
 *           `_castTimer` or `casting` was on the wire, so on a joining player's
 *           screen the whole thing was invisible. Driven — a Jedi Master
 *           targeting a peer for 40 s — the host drew six FORCE PUSH tells and
 *           the peer received six anonymous numbers, 0 telegraphs, 0 metres.
 *
 *           THE COUNTERPLAY IS THE POINT, not the decoration. `breakCast` is
 *           reached from everything that beats a guard and the window is
 *           generous — measured 100% break at 400 ms into a 450 ms tell — and a
 *           tell nobody can see is a window nobody can take. It is also the
 *           only thing on this wire that tells a peer WHICH power is coming,
 *           and a push and a choke want opposite answers.
 *
 *           Three slots because a cast has two stages and they are different
 *           facts: `ck` is the key (a STRING, for the reason `md` is one — an
 *           index decodes as a different power the day ENEMY_POWERS is
 *           reordered), `cw` is the wind-up left, and `ch` is what remains of a
 *           HELD power once the wind-up has landed. A body doing neither pays
 *           `0, 0, 0`, which is most of every wave.
 *
 *           Priced on a real director run rather than guessed at, the way `md`
 *           was: wave 20 on the Colosseum fields 17 bodies and one snapshot of
 *           it is 1226 bytes without these three and 1328 with — 21.6 against
 *           23.3 KB/s at the host's 18 Hz.
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
      e.mod || 0,
      e.team,
      e._castKey || e.casting || 0,
      r2(e._castTimer > 0 ? e._castTimer : 0),
      r2(e.casting ? Math.max(0, e.castLeft || 0) : 0),
    ]);
  }
  const fires = world._netFires || [];
  /* …AND THE GRENADES, on the same wire and for the same reason a bolt is on
   * it: an arc, a shout and a hole in the ground are things that HAPPEN, and
   * there is no arrangement of position and hp fields that can contain one.
   * See `World._recordNades`. */
  const nades = world._netNades || [];
  /* …and the blasts, for the reason the grenades are here: a fireball, a bang,
   * a shove and a crater are things that HAPPEN. See `World.onExplosion`. */
  const blasts = world._netBlasts || [];
  /* …and the architecture, for the reason the blasts are here and one class
   * bigger. A wall is not a state either — it is a wall until the frame it
   * stops being one — and there is no arrangement of position and hp fields
   * that contains a colonnade coming down. Measured before this field existed,
   * over two real Worlds on the colosseum: the host cut, pushed, rammed and
   * blew its way through the level and finished with 11 pieces down; the
   * joining player had 3, and those 3 were the ones a blast happened to cause,
   * because `ex` above was already crossing and nothing else was. Eight walls
   * the host had demolished were still standing on the guest's screen.
   *
   * What crosses is the EVENT and not the rubble — the piece by its registry
   * index, and either the sphere that damaged it or the plane the blade cut it
   * on. Both machines already hold the same building (the cell pattern is
   * seeded off each piece's own seed and the dressing is deterministic), so
   * the same input produces the same collapse and the cells themselves never
   * have to travel. See `World._recordNades` for the argument and
   * src/world/Destruction.js's REPLICATION block for why those two events are
   * the whole set. */
  const rubble = world._netRubble || [];
  const snap = {
    t: 'snapshot',
    /**
     * THE ONLY ORDERING THIS PROTOCOL OWNS.
     *
     * Everything else about a snapshot's ordering is borrowed from the
     * transport: `Net.join` asks for `reliable: true`, so the DataChannel is
     * ordered and de-duplicated and no replay can happen today. That is a
     * property of one line in the connect options, not of the record — and a
     * record whose correctness lives in somebody else's config is one edit away
     * from being wrong. Replayed by hand, an old snapshot rewinds a client's
     * wave and score and re-announces WAVE N over the top of the wave it is
     * actually fighting, and a duplicated one fires every bolt in `bf` twice.
     *
     * Per WORLD rather than per Net, so it restarts with the ground: a client
     * rebuilds its World on `start` (see main.js) and must not reject the first
     * snapshot of the new level for being older than the last of the old one.
     *
     * The receiving half belongs in `World.applySnapshot` — drop a packet whose
     * `n` is not greater than the last one applied, and remember `n` per host.
     */
    n: (world._netSeq = (world._netSeq || 0) + 1),
    e: enemies,
    bf: fires.slice(),
    gn: nades.slice(),
    ex: blasts.slice(),
    rb: rubble.slice(),
    w: world.director.wave,
    act: world.director.active ? 1 : 0,
    rem: world.director.remaining,
    // The intermission clock. `director.intermission` is only ever moved by
    // `director.update`, which a client never runs, so its HUD printed
    // "next wave in 0" for the whole 5.5 s between waves and never printed
    // "attune" during a draft it was simultaneously being offered.
    ic: r2(world.director.intermission || 0),
    /**
     * WHERE THE FRONT IS — PLAN.md §4.5's kill criterion, in one field.
     *
     * "If two commanders cannot be kept in agreement on `lineIsUp`, the mode's
     * win condition desyncs and it needs a host authority." It has one:
     * `CommandDirector._front` runs inside the director's own update, a
     * client's director is a shell that never steps, and the scalar it moves is
     * the whole state of a meeting — so the honest answer is not to make both
     * machines compute it but to send the number the host computed.
     *
     * `undefined` in every mode that is not a meeting, and `r2` because a front
     * is drawn as a bar and two decimal places is a fifth of a pixel on it.
     */
    fr: world.command?.versus ? r2(world.command.front ?? 0) : undefined,
    sc: Math.round(world.score),
  };
  fires.length = 0;
  nades.length = 0;
  blasts.length = 0;
  rubble.length = 0;
  return snap;
}


const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * THE DUEL, AS IT CROSSES THE WIRE — packed and read off ONE list.
 *
 * `DuelMatch.WIRE` is the list, it lives with the class it describes, and both
 * of these loop it. That is not fastidiousness: this repository has already
 * shipped a hand-typed twelve-slot wire record against a thirteen-slot packer,
 * and six times in one session a hand-typed table drifted from its generated
 * twin. A duel record with a field the far end silently drops is a client that
 * thinks the match is still on after it has been won.
 *
 * `clock` is rounded because it is a countdown a human reads and 0.01 s is
 * below anything a round announcement can express; nothing else is touched,
 * because a score you rounded is a score you got wrong.
 */
export function packMatch(match) {
  const out = { t: 'match' };
  for (const k of DuelMatch.WIRE) {
    const v = match[k];
    if (v === undefined) continue;
    out[k] = k === 'clock' ? r2(v) : v;
  }
  return out;
}

/** The far end of packMatch. Same list, so neither can grow a field alone. */
export function readMatch(msg) {
  const out = {};
  for (const k of DuelMatch.WIRE) if (msg && msg[k] !== undefined) out[k] = msg[k];
  return out;
}

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
