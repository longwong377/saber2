/**
 * The wire. — src/net/Net.js, src/game/World.js
 *
 * Co-op in this game is real: 417 lines of WebRTC, host-authoritative waves,
 * 18 Hz enemy snapshots, 24 Hz avatars, a 90 ms interpolation buffer, and the
 * full local rig and arm IK running on remote bodies. It had exactly one thing
 * wrong with it, and it was fatal:
 *
 *   `World.applyClaim` existed to receive "I cut this" from a client.
 *   `Net.toHost` existed to send it.
 *   NOTHING EVER CALLED EITHER. `toHost` had zero callers in the repository.
 *
 * Both ends of the wire were built and nothing crossed it. So a joining player
 * could move, be seen and deflect — and every enemy they hit stood back up
 * 55 ms later, when the host's next snapshot hard-wrote `e.hp`. You could join
 * a game; you could not kill anything in it. This is `grip.mjs`'s "written and
 * never read" in its most expensive form, and Net.js had no test coverage of
 * any kind, so nothing said so.
 *
 * The receiver also asked for the cut parameter as `msg.t` — the same field
 * `Net._route` switches on — so it would have read the string 'claim' if a
 * message had ever arrived. Two bugs that could only ever be found together.
 *
 * The last check here is the general form and it is the one worth keeping: a
 * message type the receiver handles must have something, somewhere, that sends
 * it.
 */
import { readFile, readdir } from 'node:fs/promises';

/** Every .js under src/, as [relative path, text]. */
async function sources() {
  const root = new URL('../../src/', import.meta.url);
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(u, prefix + e.name + '/');
      else if (e.name.endsWith('.js')) out.push([prefix + e.name, await readFile(u, 'utf8')]);
    }
  };
  await walk(root, '');
  return out;
}

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export async function run({ check, assert }) {
  check('co-op: a client that cuts something tells the host', async () => {
    const world = strip(await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8'));
    // The claim has to be sent from the blade path, not merely defined: the
    // whole defect was a helper nobody called.
    const i = world.indexOf('  _applyBladeEvent(');   // the DEFINITION, not the call above it
    assert(i > 0, 'the blade event handler is gone');
    const body = world.slice(i, world.indexOf('  _applyClash(', i));
    assert(/_claim\(/.test(body),
      'the blade path no longer claims its hits to the host — a client cannot kill anything');
    assert(/k: 'cut'/.test(body) && /k: 'dmg'/.test(body),
      'only one of the two ways of hurting an enemy is claimed; the other is silently local-only');
    // and the sender has to actually reach the wire
    assert(/_claim\(msg\)\s*\{[^}]*toHost\(msg\)/.test(world.replace(/\n/g, ' ')),
      '_claim does not reach Net.toHost');
    return 'cut and grind both claimed, through toHost';
  });

  check('co-op: the cut parameter is not the message type', async () => {
    // `Net._route` switches on `msg.t`. A receiver reading the cut fraction
    // from `msg.t` reads the string 'claim'. Both sides now use `ct`.
    const world = strip(await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8'));
    const i = world.indexOf('applyClaim(');
    assert(i > 0, 'applyClaim is gone');
    const body = world.slice(i, i + 900);
    assert(!/cutT:\s*msg\.t\b/.test(body),
      "applyClaim reads the cut fraction from msg.t, which is the message TYPE — it would be the string 'claim'");
    assert(/cutT:\s*msg\.ct\b/.test(body), 'applyClaim no longer reads a cut fraction at all');
    const sent = /ct:\s*ev\.cutT/.test(world);
    assert(sent, 'the sender does not put the cut fraction in the field the receiver reads');
    return 'sender writes ct, receiver reads ct, neither collides with the routing field';
  });

  check('co-op: no message type is handled and never sent', async () => {
    // THE GENERAL FORM. A `case 'x':` in the router with no `t: 'x'` anywhere
    // is a wire that was built at one end. That is exactly what `claim` was,
    // and it cost the whole co-op mode.
    const files = await sources();
    const net = strip(files.find(([p]) => p === 'net/Net.js')[1]);
    const handled = [...net.matchAll(/case '([a-z]+)':/g)].map(m => m[1]);
    assert(handled.length > 6, `only ${handled.length} message types found — the parse is wrong`);
    const all = files.map(([, t]) => strip(t)).join('\n');
    const unsent = [];
    for (const type of handled) {
      // 'pong' is answered inline by the router itself, which counts.
      if (new RegExp(`t:\\s*'${type}'`).test(all)) continue;
      unsent.push(type);
    }
    assert(unsent.length === 0,
      `handled but never sent by anything: ${unsent.join(', ')} — a wire built at one end`);
    return `${handled.length} message types, every one of them has a sender`;
  });

  check('co-op: signalling is overridable, so a broker outage is not fatal', async () => {
    // The default is the public PeerJS broker, which is somebody else's server.
    // That is an acceptable default and an unacceptable hard dependency, so the
    // escape hatch has to be real rather than documented.
    const net = await readFile(new URL('../../src/net/Net.js', import.meta.url), 'utf8');
    assert(/SABER_SIGNAL/.test(net), 'there is no way to point co-op at a different signalling server');
    const i = net.indexOf('function peerOptions');
    assert(i > 0, 'peerOptions is gone');
    assert(/iceServers/.test(net.slice(i, i + 700)), 'no ICE servers configured — direct connections only');
    return 'window.SABER_SIGNAL overrides the broker; ICE servers are configured';
  });

  /* ══ the other half of the wire: a joining player could not be hurt ═════ */

  check('co-op: a RemoteAvatar has the shape World treats it as having', async () => {
    /**
     * A RemoteAvatar is pushed into `world.players`, and World's loops treat
     * everything in that list as a Player. Two of them did not survive the
     * difference, and the first is not a missing feature but a CRASH:
     *
     *   `_boltHitTest` reads `p.invuln` then `p.boonMods.absorb` with no guard.
     *   Neither field existed, so `undefined > 0` was false, the hit test ran,
     *   and `.absorb` off undefined threw. Every enemy bolt that reached a
     *   friend took the frame loop with it.
     *
     * So the property is not "remotes can be hit", it is "anything in
     * `world.players` answers what World's loops ask of it".
     */
    const { readFile } = await import('node:fs/promises');
    const net = await readFile(new URL('../../src/net/Net.js', import.meta.url), 'utf8');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const i = net.indexOf('export class RemoteAvatar');
    assert(i > 0, 'RemoteAvatar is gone');
    const body = net.slice(i);
    // Exactly the fields the loops over `this.players` touch without a guard.
    for (const field of ['invuln', 'boonMods', 'damage(', 'heal(', 'alive', 'position', 'saber']) {
      assert(new RegExp(`\\b${field.replace('(', '\\(')}`).test(body),
        `RemoteAvatar has no ${field}, and World's player loops read it unguarded`);
    }
    // …and the reader must still be unguarded, or this check is pinning a field
    // nothing needs.
    assert(/p\.boonMods\.absorb/.test(world),
      'the unguarded read is gone — re-point this check at whatever replaced it');
    return 'RemoteAvatar answers invuln, boonMods, damage, heal and the pose fields';
  });

  check('co-op: the host can hurt a peer, and does not try to do it locally', async () => {
    /**
     * A peer owns its own health: its avatar packet carries `hp` and
     * `RemoteAvatar.update` overwrites the host's copy 24 times a second, so
     * anything the host writes there is gone inside 42 ms. The only correct
     * move is to TELL the peer — the mirror image of `claim`, and it did not
     * exist.
     *
     * Combined with the other half — a client's enemies are `netDriven`, which
     * returns before `_think`, so they never fire and never strike — a joining
     * player was simply invulnerable.
     */
    const { readFile } = await import('node:fs/promises');
    const net = await readFile(new URL('../../src/net/Net.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = net.indexOf('  damage(amount');
    assert(i > 0, 'RemoteAvatar has no damage()');
    const dmg = net.slice(i, i + 700);
    assert(/toPeer\(/.test(dmg), 'the host does not tell the peer it was hit');
    assert(!/this\.hp\s*[-=]/.test(dmg),
      'RemoteAvatar.damage writes its own hp, which the next avatar packet overwrites 42 ms later');
    assert(/netMode !== 'host'/.test(dmg),
      'a client can damage another client — the host must be the only authority');
    // addressed, not broadcast: a broadcast hit wounds everybody
    assert(/toPeer\(peerId, msg\)|toPeer\(.*\)\s*\{/.test(net), 'Net cannot address a single peer');
    // and the receiving end must exist and go through the peer's OWN damage
    assert(/net\.on\('hit'/.test(main), 'nothing on the client listens for a hit');
    const h = main.slice(main.indexOf("net.on('hit'"), main.indexOf("net.on('hit'") + 700);
    assert(/p\.damage\(/.test(h), 'the hit does not go through the peer\'s own damage path, so its boons are skipped');
    return 'host addresses one peer; the peer applies it through its own Player.damage';
  });

  check('co-op: a blade clash is resolved by whoever is holding the blade', async () => {
    // The body hit is host-authoritative because the ENEMY is. The clash is
    // not: it is a mouse-driven contest — a blade lock is a drag race — and the
    // stamina, riposte window and stagger it moves live on the other machine.
    // Resolving it host-side would decide a duel on a player's behalf with none
    // of their input.
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const i = world.indexOf('// enemy blades vs the player');
    assert(i > 0, 'the enemy blade loop is gone');
    const body = world.slice(i, world.indexOf('// blade locks run their own contest', i));
    assert(body.length > 400 && body.length < 6000, `the loop parse looks wrong (${body.length} chars)`);
    assert(!/if \(!p\.alive \|\| !p\.control\) continue/.test(body),
      'the loop still skips everything without a control, so enemy sabers pass through remote players');
    assert(/p\.control && p\.saber\.ignition/.test(body),
      'the clash is resolved for a remote blade too, which decides their duel for them');
    /**
     * The body hit used to be a second, laxer copy of the blade test inlined
     * right here, and this check grepped for its `p.damage(` call. It is gone —
     * see tools/checks/forms.mjs for why it had to go — and the loop delegates
     * to the one real implementation instead. What matters to CO-OP is not
     * which function it is but that a player with no `control` is still in the
     * arc, so the assertion is on the delegation and the behaviour is measured
     * for real by the next check.
     */
    assert(/_saberStrike\(/.test(body),
      'the enemy blade loop no longer runs a body test for the players this enemy is not targeting, '
      + 'so in co-op every saber passes through everyone but its own target');
    return 'clash is local-only; the body hit reaches every player, remote or not';
  });

  check('co-op: an enemy blade cuts a player who has no controller', async () => {
    /**
     * THE BUG THIS REPLACES A GREP WITH. The loop opened
     *
     *     if (!p.alive || !p.control) continue;
     *
     * and a RemoteAvatar has no `control` — so every enemy saber in the game
     * passed straight through every joining player, in the one mode where
     * being surrounded is the point. `!p.control` was standing in for "is this
     * a local Player", and the thing it actually protects is the two
     * `hitImpulse` calls inside `_applyClash`.
     *
     * Driven rather than read: a body with `damage`, a position and no
     * controller, held inside a real duellist's arc for sixty seconds.
     */
    const THREE = await import('three');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    const { RapierWorld } = await import('../../src/physics/RapierWorld.js');
    const { Enemy, enemyRng } = await import('../../src/game/Enemy.js');
    const { duelRng } = await import('../../src/game/Duel.js');
    await initPhysics();
    enemyRng.seed(4711);
    duelRng.seed(8123);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const terrain = { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
      crater() {}, flush() {}, slopeAt: () => 0 };
    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
    physics.terrain = terrain;
    const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
      plasma: { spawn() {} }, smoke: { spawn() {} } };
    let hits = 0;
    /* No `control`, no `camera`, no `velocity` — everything a RemoteAvatar
     * lacks. It must still be cuttable, and the hit must not throw on the
     * members it does not have. */
    const avatar = {
      position: V(0, 0, 0), chest: V(0, 1.3, 0), hp: 5000, maxHp: 5000,
      alive: true, invuln: 0, radius: 0.34, damage() { hits++; },
    };
    const world = {
      scene: new THREE.Scene(), physics, terrain, statics: [],
      settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
      players: [avatar], enemies: [], props: [], doors: [], locks: [],
      particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
      time: 0, combatIntensity: 0, groundColor: 0xcfae82,
      engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
        camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
      report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
      onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
      onExplosion() {}, spawnDebrisGroup() {},
    };
    const e = new Enemy(world, 'acolyte', V(0, 0, -2));
    e.position.set(0, 0, -2);
    world.enemies.push(e);
    const ctx = { enemies: world.enemies, particles, terrain, physics, bolts: world.bolts,
      time: 0, pickTarget: () => avatar, camera: world.engine.camera };
    const dt = 1 / 60;
    let threw = null;
    try {
      for (let i = 0; i < 60 / dt; i++) {
        ctx.time = world.time += dt;
        e.update(dt, ctx);
        physics.step(dt);
      }
    } catch (err) { threw = err; }
    for (const x of world.enemies) x.dispose?.();
    assert(!threw, `cutting a controller-less avatar threw ${threw && threw.message}`);
    assert(hits > 0,
      'a duellist stood in front of a joining player for 60 s and never landed a cut — enemy sabers '
      + 'pass through remote players again');
    return `${hits} cuts landed on a body with no controller, camera or velocity`;
  });

  check('co-op: drafting a boon does not throw, and every player gets one', async () => {
    /**
     * TWO BUGS THAT LOOKED LIKE ONE FEATURE.
     *
     *   `World.applyBoon` looped `this.players` and called `applyBoon` on each.
     *   A RemoteAvatar is in that list and has no such method, so drafting a
     *   SINGLE CARD in co-op threw a TypeError.
     *
     *   And a client's director never runs — main.js only calls `start` when
     *   `netMode !== 'client'` — so `onDraft` never fired there. A joining
     *   player fought every wave the host did and was never offered a card, for
     *   the whole session.
     *
     * The fix has to be BOTH: apply locally only, and tell the peers a draft is
     * open. What is NOT sent is the hand — each machine draws from its own
     * taken-set, because that is the only set that knows what that player
     * already holds and what ranks they have left. Sending the host's three
     * cards would offer a Vitality III to someone who has never taken one.
     */
    const { readFile } = await import('node:fs/promises');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

    const i = world.indexOf('  applyBoon(boon)');
    assert(i > 0, 'World.applyBoon is gone');
    const body = world.slice(i, i + 700);
    assert(/typeof p\.applyBoon === 'function'/.test(body),
      'applyBoon still calls p.applyBoon on every player, and a RemoteAvatar has none — this throws');

    // the moment is broadcast…
    assert(/t: 'draft'/.test(world), 'the host never tells a peer that a draft is open');
    // …and the hand is NOT
    const d = world.slice(world.indexOf('onDraft = '), world.indexOf('onDraft = ') + 1400);
    assert(!/broadcast\([^)]*boons/.test(d),
      'the host broadcasts its own hand, which offers peers ranks they have not earned');
    // the client draws its own, from its own set
    assert(/net\.on\('draft'/.test(main), 'nothing on the client opens a draft');
    const h = main.slice(main.indexOf("net.on('draft'"), main.indexOf("net.on('draft'") + 500);
    assert(/drawBoons\(/.test(h) && /world\.takenBoons/.test(h),
      'the client does not draw from its own taken-set');
    return 'applied locally, the moment broadcast, each peer draws its own hand';
  });

  check('co-op: a player who leaves stops being a player', async () => {
    // `peer-left` deleted the avatar from `world.remotes` and left it in
    // `world.players`, where main.js had ALSO pushed it. So a departed peer
    // stayed live in every loop over the player list: enemies kept picking it
    // as a target and walking to a body that no longer updated, and `damage`
    // kept addressing a closed connection.
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const i = main.indexOf("net.on('peer-left'");
    assert(i > 0, 'the peer-left handler is gone');
    const body = main.slice(i, i + 900);
    assert(/remotes\.delete/.test(body), 'the avatar is not removed from remotes');
    assert(/players\.splice|players\.indexOf/.test(body),
      'the avatar is left in world.players, where it stays a target forever');
    // and the pushes must still be paired, or this check is pinning half a rule
    assert(/world\.players\.push\(r\)/.test(main), 'the push this pairs with is gone');
    // the host leaving must SAY so rather than leaving a silent, unwinnable room
    assert(/net\.on\('closed'/.test(main),
      'nothing handles the host disappearing — a client is left in a world where nothing arrives and nothing explains why');
    return 'a departed peer leaves both remotes and players; a vanished host is announced';
  });
}
