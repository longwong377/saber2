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
    assert(/p\.damage\(/.test(body), 'the body hit no longer reaches the player at all');
    return 'clash is local-only; the body hit reaches every player, remote or not';
  });
}
