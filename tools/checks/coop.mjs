/**
 * THE WIRE — src/net/Net.js, src/game/World.js, src/main.js.
 *
 * THIS FILE USED TO BE NINE REGULAR EXPRESSIONS. It constructed no `Net`, no
 * `RemoteAvatar` and no `World`, sent no message and asserted no number — every
 * check was `readFile` + `indexOf` + `RegExp.test` over three source files. It
 * reported nine green on a build where:
 *
 *   · three- and four-player co-op collapsed EVERY remote player into one
 *     shared body, because the relay's `from` field was written on the wire and
 *     read by nothing (measured: 840 m of travel and a 1200 m/s peak for two
 *     players standing still);
 *   · a joining player's world had no enemy fire at all — 0 bolts over 10 s
 *     against three enemies standing on them, where the identical scene
 *     simulated locally fired 33 and killed them — so there was nothing to
 *     deflect, nothing to parry, and no perfect return available in the mode
 *     the whole product is about;
 *   · nobody in co-op ever got a death card, and `Player.respawn` had zero
 *     callers;
 *   · everything a client killed with anything except direct blade contact was
 *     a phantom, and a friend's kills were credited to nobody.
 *
 * Two of its checks were actively tuned to the stub: one asserted exactly two
 * claim kinds and called them "the two ways of hurting an enemy" (there are at
 * least six), and its general rule — "no message type is handled and never
 * sent" — has no converse, so it structurally cannot catch a field that is sent
 * and never read, which is precisely what `from`, `ts` and `rem` all were.
 *
 * So the shape of this file is the finding: these DRIVE two real endpoints
 * against each other. tools/checks/_coop.mjs is a PeerJS stub with the property
 * that matters (on a client every message arrives on one connection, so
 * `conn.peer` is a constant) plus the thirty-line stub engine lifecycle.mjs
 * proved a World boots on.
 *
 * Every module is reached by `await import` inside a check body. src/engine/
 * Engine.js rewrites three's ShaderChunks as a module side effect behind
 * once-only flags, and a STATIC import edge from a check patches the wrong copy
 * of three and burns the flag for the shader suites. World.js imports Engine.js,
 * so that rule covers everything here. See tools/checks/materials.mjs.
 */
import { readFile, readdir } from 'node:fs/promises';
import { functionBody } from './_source.mjs';
import { clocked } from './_shared.mjs';

const src = (rel) => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');

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

/** A three-player session over the stub broker: host + two clients, all open. */
async function session(names = ['HOST', 'ALPHA', 'BRAVO'], looks = []) {
  const H = await import('./_coop.mjs');
  const { Net } = await import('../../src/net/Net.js');
  const fake = H.installPeerStub();
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, 0)); fake.flush(); } };
  const host = new Net();
  const code = await (async () => { const p = host.host(names[0], { level: 'colosseum' }, looks[0] || null); await settle(); return p; })();
  const clients = [];
  for (let i = 1; i < names.length; i++) {
    const c = new Net();
    const p = c.join(code, names[i], looks[i] || null);
    await settle();
    await p;
    clients.push(c);
  }
  await settle();
  return { host, clients, fake, settle, code, close: () => fake.restore() };
}

/** The avatar packet Net sends, without needing a Player to build it from. */
const avatarAt = (x) => ({ t: 'avatar', p: [x, 0, 0], f: 0, h: 100, a: 1,
  hp0: [x, 1.2, 0], hq: [0, 0, 0, 1], lit: 1 });

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  /* ══ identity ═══════════════════════════════════════════════════════════ */

  check('co-op: four players are four bodies, not one body wearing four names', async () => {
    /**
     * THE RELAY THREW AWAY WHO SENT THE PACKET.
     *
     * On a client every message in the session arrives on the single host
     * connection, so `conn.peer` is a constant — the host's id. The relay
     * stamped `from` and NOTHING READ IT (`grep -rn 'msg.from' src/` returned
     * nothing), so a 3- or 4-player client keyed `world.remotes` on one id and
     * built exactly ONE RemoteAvatar, fed the interleaved position streams of
     * every other player. The host was drawn at another client's coordinates
     * and the other clients were never drawn at all.
     *
     * Driven with three real `Net` objects wired the way PeerJS wires them.
     */
    const s = await session();
    const seen = { host: [], a: [], b: [] };
    s.host.on('avatar', (id, m) => seen.host.push([id, m.p[0]]));
    s.clients[0].on('avatar', (id, m) => seen.a.push([id, m.p[0]]));
    s.clients[1].on('avatar', (id, m) => seen.b.push([id, m.p[0]]));

    s.host.broadcast(avatarAt(0));
    s.clients[0].toHost(avatarAt(10));
    s.clients[1].toHost(avatarAt(20));
    s.fake.flush();

    const keysOf = (l) => new Set(l.map(e => e[0]));
    const hostId = s.host.peer.id, aId = s.clients[0].peer.id, bId = s.clients[1].peer.id;
    assert(keysOf(seen.host).size === 2,
      `the host resolved ${keysOf(seen.host).size} senders out of two clients`);
    assert(seen.a.length === 2, `client A received ${seen.a.length} avatar packets, expected 2`);
    assert(keysOf(seen.a).size === 2,
      `client A attributed two players' packets to ${keysOf(seen.a).size} sender(s) — every remote `
      + 'player collapses into one shared body that teleports between them at the snapshot rate');
    const byKey = new Map(seen.a);
    assert(byKey.get(hostId) === 0 && byKey.get(bId) === 20,
      `client A placed the host at ${byKey.get(hostId)} and BRAVO at ${byKey.get(bId)}; they are at 0 and 20`);
    const byKeyB = new Map(seen.b);
    assert(byKeyB.get(hostId) === 0 && byKeyB.get(aId) === 10,
      'client B does not resolve the host and ALPHA to their own coordinates');
    s.close();
    return 'three endpoints, three distinct bodies on every screen, each at its own coordinates';
  });

  check('co-op: an ally\'s aura is keyed on the ally, not on whoever relayed it', async () => {
    // The bond relay had the same hole as the avatar relay: a client-to-client
    // aura is forwarded by the host, and the receiver keyed it on `conn.peer` —
    // the host — so two allies' offers overwrote one another in `bondGive`,
    // which keys a live offer on its source.
    const s = await session();
    const got = [];
    s.clients[1].on('bond', (msg, from) => got.push(from));
    s.clients[0].toHost({ t: 'bond', to: s.clients[1].peer.id, c: 1.2, s: 1.1, g: 1, h: 0 });
    s.host.toPeer(s.clients[1].peer.id, { t: 'bond', to: s.clients[1].peer.id, c: 1.3, s: 1, g: 1, h: 0 });
    s.fake.flush();
    assert(got.length === 2, `client B received ${got.length} bonds, expected 2`);
    assert(new Set(got).size === 2,
      `two allies' auras arrived under ${new Set(got).size} source id — one silently overwrites the other`);
    assert(got.includes(s.clients[0].peer.id), 'the relayed aura is not attributed to the client that sent it');
    s.close();
    return 'a relayed bond keeps its origin; two allies are two sources';
  });

  check('co-op: a player who leaves is removed on every machine, not just the host\'s', async () => {
    /**
     * `peer-left` was raised on the host alone, because the host is the only
     * node that holds `conns`. On every other machine the departed player's
     * avatar stayed in `world.players`: still alive, still the nearest thing
     * `pickTarget` could find, a frozen body the horde walked to for the rest
     * of the run.
     */
    const s = await session();
    const left = [];
    s.clients[1].on('peer-left', (id) => left.push(id));
    const aId = s.clients[0].peer.id;
    s.clients[0].close();
    s.fake.flush();
    await s.settle(2);
    assert(left.length === 1, `client B heard ${left.length} departures when ALPHA left`);
    assert(left[0] === aId, `client B was told ${left[0]} left; it was ${aId}`);
    assert(!s.host.roster.some(r => r.id === aId), 'the host still lists the departed player');
    s.close();
    return 'a departure reaches the other clients, not only the host';
  });

  check('co-op: a peer that goes silent is dropped rather than haunting the roster', async () => {
    // `lastSeen` was written once, at connect, and read by nothing. PeerJS only
    // raises `close` on a CLEAN teardown, so a lid closing left a ghost in the
    // roster and a live body in everybody's world forever.
    const { PEER_TIMEOUT } = await import('../../src/net/Net.js');
    const s = await session(['HOST', 'ALPHA']);
    const before = s.host.conns.size;
    assert(before === 1, `the host has ${before} connections, expected 1`);
    // Stamped rather than assumed: the suite's checks run concurrently, and a
    // twelve-second simulation in another one is real time this peer would
    // otherwise have spent silent.
    const now = performance.now() / 1000;
    for (const c of s.host.conns.values()) c.lastSeen = now;
    assert(s.host.sweep(now) === 0, 'a peer that has just spoken was dropped');
    const dropped = s.host.sweep(now + PEER_TIMEOUT + 1);
    assert(dropped === 1, `a peer silent for ${PEER_TIMEOUT + 1} s was not dropped (${dropped})`);
    assert(s.host.conns.size === 0 && s.host.roster.length === 1,
      'the silent peer is still in conns or on the roster');
    s.close();
    return `silent for ${PEER_TIMEOUT}s → dropped from conns and roster`;
  });

  check('co-op: the Jedi you built is the Jedi your friends see', async () => {
    /**
     * `packAvatar` carries position, facing, hp, alive, hilt pose and lit —
     * nothing else. `World.spawnPlayer` builds the local player from TWELVE
     * appearance settings; RemoteAvatar took four, main.js supplied two, and
     * both of those were invented from a roster index. The unset defaults did
     * not even match the game's own (hilt 'Guardian' against a DEFAULT_SETTINGS
     * of 'Graflex'), so an unsent field did not merely lose the choice, it
     * substituted a different one.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar, packLook } = await import('../../src/net/Net.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');

    const mine = { ...DEFAULT_SETTINGS, colorIndex: 5, hiltStyle: 'Crossguard', bladeLength: 1.42,
      robeIndex: 4, species: 'smallfolk', skinIndex: 3, hairIndex: 4, build: 0.15 };
    const look = packLook(mine);
    for (const k of ['colorIndex', 'hiltStyle', 'bladeLength', 'robeIndex', 'species', 'skinIndex', 'build']) {
      assert(look[k] === mine[k], `packLook drops ${k}`);
    }

    const s = await session(['HOST', 'ALPHA'], [null, look]);
    const entry = s.host.roster.find(r => r.name === 'ALPHA');
    assert(entry, 'the joining player is not on the host roster');
    assert(entry.look && entry.look.hiltStyle === 'Crossguard' && entry.look.species === 'smallfolk',
      'the character sheet did not cross the wire — a partner is a default human in an index-picked robe');

    const { world } = await H.bootWorld({ level: 'colosseum' });
    const theirs = new RemoteAvatar(world, { id: 'ALPHA', name: 'ALPHA', look: entry.look });
    const plain = new RemoteAvatar(world, { id: 'X', name: 'X' });
    assert(theirs.saber.hiltStyle === 'Crossguard' || theirs.saber.hilt !== plain.saber.hilt,
      'the remote saber ignores the hilt its owner chose');
    assert(Math.abs(theirs.saber.bladeLength - 1.42) < 1e-6,
      `the remote blade is ${theirs.saber.bladeLength} long; its owner built 1.42`);
    assert(theirs.saber.color.getHex() !== plain.saber.color.getHex(),
      'the remote blade colour is not the one its owner chose');
    assert(Math.abs((theirs.rig.scale ?? 1) - (plain.rig.scale ?? 1)) > 1e-6,
      'a small-folk Jedi arrives at human height — the species never crosses the wire');
    assert(plain.saber.hiltStyle === undefined || plain.saber.hiltStyle === DEFAULT_SETTINGS.hiltStyle
      || plain.look.hiltStyle === DEFAULT_SETTINGS.hiltStyle,
      `an unset hilt falls back to something other than the game's own default (${DEFAULT_SETTINGS.hiltStyle})`);
    theirs.dispose(); plain.dispose();
    world.unload(); world.dispose?.();
    s.close();
    return `${Object.keys(look).length} appearance fields cross on the roster; the avatar is built from them`;
  });

  /* ══ the fight a joining player is actually in ══════════════════════════ */

  check('co-op: the horde shoots at a joining player, and they can see it coming', async () => {
    /**
     * THE MEASUREMENT THAT MADE THIS THE HEADLINE FINDING. A client's enemies
     * are `netDriven`, which returns before `_think` — so `_shoot` and
     * `_beginTelegraph` are both unreachable there, and `packSnapshot` carried
     * no bolts, no attack state and no telegraph. A joining player stood in a
     * firefight with nothing on screen and lost health in silent chunks.
     *
     * A bolt is an EVENT: it exists for the 55 ms between two packets and is
     * gone, so no arrangement of position and hp fields can contain one. Both
     * worlds run for real here and the client's own pool is what is counted.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    /**
     * THE GROUND IS NAMED, AND THIS CHECK SPENT A WHOLE SESSION RED BECAUSE IT
     * WAS NOT.
     *
     * `bootPair` defaulted to `'arena'`, a level the roster cull deleted, and
     * `World.loadLevel` substitutes `LEVEL_ORDER[0]` for a key it does not know
     * — so every drive of this check stood its marksman on the Ember Shelf,
     * behind a rock. The `tel > 0` assertion below failed, and it was read as a
     * telegraph-replication bug on the wire for as long as it stood. It is not.
     * The HOST never charged either.
     *
     * Measured, one sniper at 26 m and 720 frames on each level of the roster,
     * counting the frames it spends charging:
     *
     *     scoria      0        colosseum  71      geonosis  71
     *     mustafar   65        wood       69      temple    77
     *     kamino     71        drifts     71      foundry   72
     *
     * Nine of ten. Scoria is the one, it is the fallback every un-named boot
     * lands on, and `_rangedBrain` gates `_beginTelegraph` behind
     * `_hasLineOfSight`. So the ground is a PRECONDITION of what this measures
     * and it has to be stated: an open arena floor, where a marksman 26 m away
     * can see the person it is aiming at.
     *
     * The host's own telegraph is counted alongside the client's for the same
     * reason. A check that measures only the far end cannot tell "the client
     * never saw it" from "there was nothing to see", and it will report the
     * first when the truth is the second — which is exactly what happened.
     */
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    for (let i = 0; i < 3; i++) {
      host.spawnEnemy(['sniper', 'trooper', 'trooper'][i], new THREE.Vector3(Math.cos(i) * 4, 0, 26 + Math.sin(i) * 3));
    }
    host.director.active = true;

    const count = (w, seen) => {
      let live = 0;
      for (const b of w.bolts.bolts) if (b.active) { live++; seen.add(b); }
      return live;
    };
    const hSeen = new Set(), cSeen = new Set();
    let hPeak = 0, cPeak = 0, tel = 0, hTel = 0;
    for (let i = 0; i < 12 * 60; i++) {
      pump(1 / 60);
      hPeak = Math.max(hPeak, count(host, hSeen));
      cPeak = Math.max(cPeak, count(client, cSeen));
      for (const e of client.enemies) if (e.laser?.visible) tel++;
      for (const e of host.enemies) if (e.laser?.visible) hTel++;
    }
    assert(hSeen.size > 5, `the host only fired ${hSeen.size} bolts — the scene is wrong, not the wire`);
    assert(cSeen.size > 0,
      `the host fired ${hSeen.size} bolts and the joining player saw 0 — there is nothing to deflect, `
      + 'nothing to parry and no perfect return available in the whole session');
    assert(cSeen.size >= hSeen.size * 0.8,
      `the client saw ${cSeen.size} of the host's ${hSeen.size} bolts`);
    assert(hTel > 0,
      'no marksman charged a shot on the HOST either, so there was never a telegraph to replicate — '
      + 'the scene is wrong, not the wire. Check the level this pair was booted on.');
    assert(tel > 0,
      `a marksman charged its shot on ${hTel} host frames and the joining player never saw the laser — `
      + 'the fairness contract of the entire ranged game is invisible to them');
    assert(client.player.hp < 100, 'the replicated bolts do not reach the joining player at all');
    const line = `host ${hSeen.size} bolts (peak ${hPeak}) → client ${cSeen.size} (peak ${cPeak}), `
      + `telegraph ${hTel} host / ${tel} client frames, client hp ${client.player.hp.toFixed(0)}`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a grenade the host throws is a grenade the guest can run from', async () => {
    /**
     * `NEXT.md` carried this as an open gap in exactly these words: *"Grenades
     * are not networked. `GrenadeField` is host-side only, so a co-op client
     * sees no grenade, no shout and no crater. Not a desync — a gap."*
     *
     * A grenade is not a STATE, which is why no arrangement of position and hp
     * fields ever contained one: it is an arc, a shout, a body diving away and
     * a hole in the ground, and all of it happens and is over between two
     * packets. So it crosses the way a bolt does — as an event, recorded at the
     * one seam every grenade passes through.
     *
     * WHAT THIS HOLDS, and the second half is the one worth having:
     *
     *   1. the guest sees it — an arc in their world, at the host's own
     *      geometry, from the host's own throw;
     *   2. the guest's copy does NO DAMAGE. The host already resolved it and
     *      the result arrives as hp in the next snapshot; a client that applied
     *      the blast as well would kill the same droid twice on its own screen
     *      and then be corrected, which is what a desync looks like from the
     *      sofa.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const at = new THREE.Vector3(0, 0, 8);
    /* A body on the guest's side of the wire, standing where the grenade is
     * going, so "did the client's copy hurt anybody" has somebody to hurt. */
    const victim = client.spawnEnemy('b1', at.clone());
    assert(victim, 'setup: nothing on the client to stand in the blast');
    pump(1 / 60);
    const hp0 = victim.hp;

    const before = client.grenades.stats.thrown;
    host.grenades.throw(new THREE.Vector3(0, 1.4, 0), at.clone(), { team: 1 });
    assert(host.grenades.list.length === 1, 'the host is not holding the grenade it just threw');

    /* Long enough for the fuse and the packet: FUSE is 2.6 s and the snapshot
     * rate is well inside that. */
    let sawArc = 0;
    for (let i = 0; i < 4 * 60; i++) {
      pump(1 / 60);
      if (client.grenades.list.length) sawArc++;
    }

    assert(client.grenades.stats.thrown > before,
      'the host threw a grenade and the joining player never saw one at all — no arc, no shout, no crater');
    assert(sawArc > 20,
      `the guest's copy existed for ${sawArc} frames — it arrived and vanished rather than flying`);
    assert(client.grenades.stats.blown > 0, "the guest's copy never went off");
    assert(!client.grenades.list.length, 'a replicated grenade is still hanging about after its fuse');

    /* AND IT DID NOTHING. The victim's hp on the client moves only when the
     * host's snapshot says so, and the host has no such body. */
    assert(victim.hp === hp0,
      `the guest's own copy of the blast took ${(hp0 - victim.hp).toFixed(1)} hp off a body the host `
      + 'never touched — the same droid is being killed at both ends');
    const line = `host 1 thrown → guest ${client.grenades.stats.thrown - before} `
      + `(${sawArc} frames of arc, ${client.grenades.stats.blown} detonation), 0 damage applied locally`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a blast the host raises is a blast the guest is standing in', async () => {
    /**
     * THE SAME GAP THE GRENADE HAD, one door further in. `World.onExplosion` is
     * where an exploding barrel, a droideka's death and every structure charge
     * arrive, and none of it was on the wire: a joining player watched a barrel
     * vanish in silence, took damage from nowhere, and walked over ground the
     * host had already cratered.
     *
     * WHAT THIS HOLDS, and the second half is again the one worth having:
     *
     *   1. the guest gets the blast — the sound, the fireball, the hole;
     *   2. the guest's copy bills NOTHING. Same argument as the grenade: the
     *      host resolved it and the hp arrives in the next snapshot.
     *
     * And the third clause, which is the one that broke while this was written:
     * Destruction REPLACES `world.onExplosion` with a wrapper at level load, so
     * the ghost flag has to survive a function that was written before it
     * existed. A wrapper that names its arguments drops it and the client bills
     * the damage after all — which is why the wrapper is variadic and why this
     * check runs on a level with Destruction installed.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const at = new THREE.Vector3(0, 0, 8);
    const victim = client.spawnEnemy('b1', at.clone());
    assert(victim, 'setup: nothing on the client to stand in the blast');
    pump(1 / 60);
    const hp0 = victim.hp;
    /* Ground under the blast, before, so the crater has something to cut. */
    const h0 = client.terrain ? client.terrain.height(at.x, at.z) : null;

    let heard = 0;
    const inner = client.particles?.explosion?.bind(client.particles);
    if (inner) client.particles.explosion = (...a) => { heard++; return inner(...a); };

    host.onExplosion(at.clone(), 1.35);
    for (let i = 0; i < 30; i++) pump(1 / 60);

    assert(heard > 0,
      'the host raised a blast and the joining player got nothing — no bang, no fireball, no hole');
    assert(victim.hp === hp0,
      `the guest's own copy of the blast took ${(hp0 - victim.hp).toFixed(1)} hp off a body the host `
      + 'never touched — the same droid is being killed at both ends');
    const h1 = client.terrain ? client.terrain.height(at.x, at.z) : null;
    assert(h0 === null || h1 < h0 - 0.05,
      `the guest's ground is unmarked (${h0?.toFixed(2)} → ${h1?.toFixed(2)}) — the crater did not cross`);

    /* AND IT DOES NOT ECHO. A client that recorded its own ghost would put it
     * back on the wire the moment that client ever became a host. */
    assert(!(client._netBlasts || []).length,
      'the guest recorded the blast it was told about — a replayed picture is being replicated');

    const line = `host 1 blast → guest ${heard} drawn, ground ${h0?.toFixed(2)} → ${h1?.toFixed(2)}, 0 hp billed locally`;
    host.unload(); client.unload();
    return line;
  });

  /**
   * A SHARED HELPER FOR THE THREE STRUCTURAL CHECKS BELOW, and it is here
   * rather than in each of them because a level is fifty pieces and the
   * question every one of them asks is the same: which pieces are no longer
   * standing.
   */
  const standing = (m) => m.structures.map((s) => s.state === 'intact');

  check('co-op: a wall the host brings down is a wall the guest can be shot through', async () => {
    /**
     * NOTHING IN src/world/Destruction.js HAD EVER ASKED `netMode`, and the
     * whole destructible world was therefore host-only. A blast was on the
     * wire (`ex`, the check above) and a blast is one of five ways to break
     * stone; the other four — a blade's cut, a Force cone, a heavy body
     * arriving, and a blade GRINDING until the piece fails — were not.
     *
     * Measured on this harness before the fix, colosseum, 49 destructible
     * pieces a side: the host cut, pushed, rammed and blew its way through the
     * level and finished with 11 pieces down. The guest had 3, and those 3 were
     * exactly the ones a blast caused. EIGHT walls the host had demolished were
     * still standing on the joining player's screen — cover to hide behind that
     * is not there, and enemies shooting through stone the guest can see.
     *
     * The three arms below are the three seams that were silent. The fourth,
     * the blast, is the check above and is deliberately not repeated here:
     * what this one has to hold is that the OTHER ways of breaking a building
     * cross, and an arm that was already crossing would carry it on its own.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const hd = host.destruction, cd = client.destruction;
    assert(hd && cd, 'setup: the level has no destructible world on one of the two machines');
    assert(hd.structures.length === cd.structures.length,
      `setup: ${hd.structures.length} pieces on the host against ${cd.structures.length} on the guest`);

    const targets = hd.structures.filter((s) => s.profile.hpPerM2 !== Infinity).slice(0, 9);
    assert(targets.length >= 6, `setup: only ${targets.length} breakable pieces to aim at`);
    const norm = new THREE.Vector3(1, 0, 0);
    const imp = new THREE.Vector3(0, -1, 0).multiplyScalar(30);

    /* THE BLADE, through the door the solver uses — `DestructionProxy.cut` is
     * what `World._applyBladeEvent` reaches when the thing the blade is in is
     * a wall, so this is a real swing and not a hand-written call. */
    for (const s of targets.slice(0, 3)) {
      for (let k = 0; k < 6; k++) hd.proxy.cut(s.centre.clone(), norm, imp);
    }
    /* THE FORCE, through the door `Player.forcePush` uses. */
    for (const s of targets.slice(3, 6)) {
      const o = s.centre.clone().add(new THREE.Vector3(0, 0, -8));
      hd.forceBlast(o, new THREE.Vector3().subVectors(s.centre, o).normalize(), 14, 3);
      hd.forceBlast(o, new THREE.Vector3().subVectors(s.centre, o).normalize(), 14, 3);
    }
    /* SOMETHING HEAVY ARRIVING, through `_impactScan`'s poll — a thrown body,
     * a rolling barrel, a chunk of somebody else's wall. */
    for (const s of targets.slice(6, 9)) {
      const b = { id: 91000 + Math.round(s.centre.x * 7 + s.centre.z), static: false,
        invMass: 1 / 400, mass: 400, boundingRadius: 0.9,
        position: s.centre.clone(), velocity: new THREE.Vector3(0, 0, 18), userData: {} };
      host.physics.bodies.push(b);
      for (let k = 0; k < 3; k++) { hd._impactCd.clear(); hd._impactScan(1 / 60); }
      host.physics.bodies.pop();
    }

    for (let f = 0; f < 40; f++) pump(1 / 60);

    const h = standing(hd), c = standing(cd);
    const down = h.reduce((n, up) => n + (up ? 0 : 1), 0);
    assert(down >= 5, `setup: the host only brought ${down} pieces down — nothing to compare`);
    const missed = h.map((up, i) => (!up && c[i] ? i : -1)).filter((i) => i >= 0);
    assert(!missed.length,
      `${missed.length} of ${down} pieces the host demolished are still standing on the joining `
      + `player's screen (registry ${missed.slice(0, 6).join(', ')}${missed.length > 6 ? '…' : ''}) `
      + '— they are taking cover behind rubble');

    /* AND IT DOES NOT ECHO, for the reason the blast check gives: a replayed
     * picture put back on the wire is a client replicating somebody else's
     * demolition as its own the moment it is ever promoted to host. */
    assert(!(client._netRubble || []).length,
      'the guest recorded the demolition it was told about — a replayed picture is being replicated');

    const line = `host ${down} pieces down → guest ${c.reduce((n, up) => n + (up ? 0 : 1), 0)}, 0 left standing`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a guest\'s own blade does not demolish a building the host still has standing', async () => {
    /**
     * THE OTHER HALF OF THE SAME RULE, and the half that is easy to leave open.
     *
     * Replicating the host's demolition is not enough on its own: a client that
     * goes on breaking stone locally holds a level nobody else is fighting in,
     * and it double-bills every REPLICATED break on top. Measured before the
     * fix: the guest's blade took three pieces down on the guest's screen and
     * zero on the host's, and the guest's copy of a blast that was already on
     * the wire billed its own stone a second time.
     *
     * So `Destruction._netAllows` closes every door on a client except the
     * replay — the same rule `World.onExplosion` states for a blast and
     * `Reactions.LiveGrenade` for a grenade. The host bills; every other copy
     * is a picture.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const hd = host.destruction, cd = client.destruction;
    const norm = new THREE.Vector3(1, 0, 0);
    const imp = new THREE.Vector3(0, -1, 0).multiplyScalar(30);
    const targets = cd.structures.filter((s) => s.profile.hpPerM2 !== Infinity).slice(0, 4);
    assert(targets.length >= 3, `setup: only ${targets.length} breakable pieces on the guest`);

    /* Every way a guest can reach architecture, all three from the guest's own
     * machine: the blade, the Force cone, and a blast the guest raised itself
     * (a barrel it cut open — `onExplosion` forces `ghost` on a client, and the
     * structural half used to run anyway). */
    for (const s of targets) {
      for (let k = 0; k < 8; k++) cd.proxy.cut(s.centre.clone(), norm, imp);
      const o = s.centre.clone().add(new THREE.Vector3(0, 0, -7));
      cd.forceBlast(o, new THREE.Vector3().subVectors(s.centre, o).normalize(), 14, 3);
      client.onExplosion(s.centre.clone(), 2.4);
    }
    for (let f = 0; f < 40; f++) pump(1 / 60);

    const hDown = standing(hd).filter((up) => !up).length;
    const cDown = standing(cd).filter((up) => !up).length;
    assert(cDown === 0 && hDown === 0,
      `the guest brought ${cDown} pieces down on its own screen and the host still has `
      + `${hDown} of them standing — two machines are fighting in two different levels`);
    assert(!(client._netRubble || []).length,
      'the guest queued its own demolition for the wire, which only a host may do');

    const line = `guest swung, pushed and blew up ${targets.length} pieces: 0 down there, 0 down on the host`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: taking the controls off-host is refused, not a frozen player in a runaway tank', async () => {
    /**
     * `src/game/Driving.js` never asked `netMode` either, and off-host the
     * result was not a desync — it was a SOFT LOCK. Measured on this harness
     * before the refusal existed, a guest boarding an AT-TE:
     *
     *   · `Crew` retracts and hides the blade, and `Player.update` hands every
     *     frame to `Crew.update` from then on;
     *   · `Enemy.update` takes its `netDriven` branch BEFORE its `driven` one
     *     on a client, so the hull is still being written by the host's
     *     snapshot: the throttle reached nothing, and `Crew.ride` — which is
     *     called from the `driven` branch — never ran, so the driver was never
     *     seated;
     *   · six seconds at full throttle: the guest's body moved **0.00 m** and
     *     finished **3.58 m** from a hull it was supposed to be sitting on,
     *     with no blade;
     *   · and the host was never told, so its copy of the machine kept the
     *     horde's team and its brain and went on shooting at the player who
     *     was notionally driving it.
     *
     * Replicating the seat is a real feature and is not this pass. What this
     * check holds is that the game stops offering a control that cannot work,
     * and says so out loud rather than by silence — which is the rule every
     * other refusal in Driving.js already follows.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { whyNotDrive } = await import('../../src/game/Driving.js');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const at = new THREE.Vector3(0, 0, 14);
    const tank = host.spawnEnemy('atte', at.clone());
    assert(tank, 'setup: no crewed machine on the field');
    for (let f = 0; f < 30; f++) pump(1 / 60);
    const theirs = client.enemies.find((e) => e.id === tank.id);
    assert(theirs, 'setup: the machine never reached the joining player at all');

    /* Both players standing on the hull, both machines on the party's side, so
     * the ONLY thing that can separate the two answers is which end of the wire
     * is asking. */
    tank.team = host.player.team;
    theirs.team = client.player.team;
    host.player.position.copy(tank.position);
    client.player.position.copy(theirs.position);

    assert(whyNotDrive(host, host.player, tank) === null,
      'the HOST cannot take the controls of its own machine either — the refusal is too wide');
    const why = whyNotDrive(client, client.player, theirs);
    assert(typeof why === 'string' && why.length > 8,
      'a joining player is allowed to take the controls of a body the host owns — '
      + 'the throttle reaches nothing, the seat is never taken and the key has to be pressed twice to get out');

    const ctx = { input: H.idleInput(), players: client.players, enemies: client.enemies };
    const took = client.player.takeControls(ctx);
    assert(!took && !client.player.driving,
      'takeControls seated the guest anyway — `driving` is set and every later frame belongs to a Crew '
      + 'that cannot move the hull');

    /* …and the player is still a player: not frozen, and still holding a
     * blade. Both are things `Crew`'s constructor takes away. */
    const p0 = client.player.position.clone();
    const walk = { ...H.idleInput(), moveAxis: (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; } };
    for (let f = 0; f < 60; f++) client.update(1 / 60, walk);
    const moved = client.player.position.distanceTo(p0);
    assert(moved > 0.5,
      `the guest moved ${moved.toFixed(2)} m in a second of holding forward — they are standing in a tank they `
      + 'do not have');
    assert(client.player.saber?.root?.visible !== false,
      'the guest\'s blade was hung on their belt by a boarding that was refused — `Crew` retracts and '
      + 'hides it in its constructor, so a Crew was built after all');

    const line = `guest refused: "${why}"; walked ${moved.toFixed(2)} m, blade still in hand`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: an elite arrives on a joining player\'s screen wearing its tells', async () => {
    /**
     * EVERY ELITE IN THE GAME WAS A PLAIN BODY OFF-HOST.
     *
     * `packSnapshot` carried twelve fields and `e.mod` was not among them, and
     * `applyModifier` had exactly two call sites, both inside
     * `WaveDirector.update`, which a client never runs. So a joining player
     * fought an escalation with none of its seven tells: no deflector bubble on
     * a Shielded body, no reactor core on an Unstable one, no plates, no
     * burning standard and no rally ring under a Leader, no second lit blade on
     * a Dual-Wielder, no red heat on a Frenzied one. The archetype's own name
     * came across too — "Sith Acolyte" where the host read "Armoured Sith
     * Acolyte". Enemy.js's MODIFIERS block opens by saying a difficulty you
     * cannot see coming is not difficulty, it is a surprise.
     *
     * And it was not only cosmetic. `_applyBladeEvent` bills a grind as
     * `share * e.maxHp * GRIND_LETHALITY` off the CLIENT's copy, so the same
     * swing claimed 0.667× on an armoured or leader body and 1.724× on a
     * frenzied one, and 7 of 23 elites arrived carrying more hp than this
     * machine believed the chassis could hold at all.
     *
     * ONE OF EVERY PRODUCIBLE PAIR, not a sample: `modifiersFor(type)` is asked
     * which modifiers each archetype can wear and every answer is fielded, so a
     * tell added to MODIFIERS later is covered the day it is written.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { modifiersFor, applyModifier } = await import('../../src/game/Enemy.js');
    const { host, client, pump } = await H.bootPair();

    const pairs = [];
    for (const t of ['b1', 'trooper', 'acolyte', 'droideka', 'walker']) {
      for (const k of modifiersFor(t)) pairs.push([t, k]);
    }
    assert(pairs.length >= 20, `only ${pairs.length} (archetype, modifier) pairs are producible — the table is wrong`);
    pairs.forEach(([t, k], i) => {
      const p = new THREE.Vector3((i % 6) * 3 - 8, 0, Math.floor(i / 6) * 3 - 6);
      p.y = host.terrain.height(p.x, p.z);
      const e = host.spawnEnemy(t, p);
      assert(e && applyModifier(e, k), `the host could not field a ${k} ${t}`);
    });
    pump(0.5);   // real packets, packed and applied by the shipping code

    /** The tells, as the meshes and materials the MODIFIERS table installs. */
    const tells = (e) => ({
      bubble: !!e.shieldMesh, core: !!e.coreMesh, ring: !!e.rallyRing,
      offhand: !!e.offSaber, tint: (e._modMaterials || []).length > 0,
    });
    const H0 = { bubble: 0, core: 0, ring: 0, offhand: 0, tint: 0 };
    const C0 = { ...H0 };
    let plain = 0, wrongLabel = 0, overHp = 0, worstBill = 1, missing = 0;
    for (const he of host.enemies) {
      const ce = client._netEnemyIndex.get(he.id);
      if (!ce) { missing++; continue; }
      if (!ce.mod) plain++;
      if (ce.A.label !== he.A.label) wrongLabel++;
      // Math.round(e.hp) on the wire is worth up to half a point either way;
      // anything past that is a client billing against a chassis it invented.
      if (ce.hp > ce.maxHp + 0.5) overHp++;
      const ratio = ce.maxHp / he.maxHp;
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worstBill))) worstBill = ratio;
      for (const [k, v] of Object.entries(tells(he))) if (v) H0[k]++;
      for (const [k, v] of Object.entries(tells(ce))) if (v) C0[k]++;
    }
    assert(!missing, `${missing} of the host's ${host.enemies.length} elites never reached the client at all`);
    assert(!plain,
      `${plain} of ${host.enemies.length} elites arrived on the joining player's screen as plain bodies — `
      + 'no bubble, no core, no plates, no standard, no second blade, no tint');
    assert(!wrongLabel, `${wrongLabel} elites are named for the bare archetype on the client`);
    for (const k of Object.keys(H0)) {
      assert(H0[k] > 0, `the host fielded no ${k} at all — the scene is wrong, not the wire`);
      assert(C0[k] === H0[k],
        `the host shows ${H0[k]} ${k} tell(s) and the joining player shows ${C0[k]}`);
    }
    assert(!overHp,
      `${overHp} elites arrived carrying more hp than the client's own copy can hold — its blade grinds `
      + 'them against a maximum health the body does not have');
    assert(Math.abs(Math.log(worstBill)) < 0.02,
      `the client's copy of an elite is ${worstBill.toFixed(3)}× the host's maxHp, so an identical swing `
      + 'bills the host that multiple of what it dealt');

    /**
     * …AND THE ELITE THAT CARRIES A BOMB DOES NOT GO OFF TWICE.
     *
     * `_updateElite` runs ahead of Enemy.update's netDriven branch, for the
     * living and the dead alike, so an Unstable body promoted on the client
     * would burn its own fuse and run `_detonate` here — hurting the local
     * player and every net-driven body in a 5 m radius, off interpolated
     * positions, while the host bills the identical blast over `hit`. Measured
     * with that version: 24.8 hp off a client's local player standing 2 m away.
     * World._applyNetModifier marks the client's copy spent for exactly this.
     *
     * THE ASSERTION USED TO BE `hp did not move`, AND THAT IS NOT THE QUANTITY.
     *
     * It read true only because `bootPair` built no RemoteAvatar, so the host
     * had no body for the peer, `onExplosion` reached nobody, and no `hit` could
     * arrive however correct the host was being. The moment the pair carried
     * avatars the same check went red at 38.7 hp — every one of them the host's
     * own bill, arriving exactly as designed. A check that cannot tell the
     * blast it wants from the blast it is testing for is the shape §2.4 warns
     * about: it manufactures a defect out of a fix.
     *
     * So the two sources are told apart at the door. Everything `applyHit`
     * takes off is attributed to the host; the RESIDUAL is what this machine
     * did to itself, and that is the number that has to be zero. Strictly
     * stronger than the old form, which could not have distinguished a client
     * that blasted itself from one that was correctly billed.
     */
    const bomb = host.enemies.find((e) => e.mod === 'unstable');
    const cb = client._netEnemyIndex.get(bomb.id);
    /* THE FIELD IS SILENCED FIRST, and it has to be. Twenty-three elites now
     * have a body for the joining player to shoot at — they did not before the
     * pair carried avatars — and every one of those bolts is replicated and
     * resolved on the client's own machine, deliberately, by the rule the check
     * two below this one asserts. Measured with the field live: 60.3 hp off the
     * local player over the blast window, of which 1.7 was the blast. A control
     * that leaves the room shooting is not measuring the bomb. */
    for (const e of host.enemies) if (e !== bomb) e._think = () => {};
    pump(1);   // let whatever was already in the air land or expire
    client.player.position.copy(cb.position).add(new THREE.Vector3(1.5, 0, 0));
    client.player.position.y = client.terrain.height(client.player.position.x, client.player.position.z);
    client.player.hp = client.player.maxHp;
    client.player.invuln = 0;
    const hp0 = client.player.hp;
    assert(!!cb.coreMesh, 'an Unstable elite reached the client with no reactor core on its chest');
    assert(cb._detonated,
      'the client\'s copy of an Unstable elite is armed — it will run its own _detonate the moment it dies');
    let billed = 0, packets = 0;
    const applyHit = client.applyHit.bind(client);
    client.applyHit = (m) => {
      const before = client.player.hp;
      const r = applyHit(m);
      packets++; billed += Math.max(0, before - client.player.hp);
      return r;
    };
    bomb.damage(9999, bomb.position.clone(), null, 'saber');
    pump(3);
    client.applyHit = applyHit;
    assert(bomb._detonated, 'the host never detonated its own bomb — the scene is wrong');
    assert(packets > 0 && billed > 0,
      'the host billed the joining player nothing at all for a blast beside them — the scene is wrong');
    const selfInflicted = (hp0 - client.player.hp) - billed;
    assert(selfInflicted <= 0.01,
      `a client's own copy of an Unstable elite took ${selfInflicted.toFixed(1)} hp off its local player `
      + 'over and above the host\'s bill — the joining player pays for that blast twice');

    const line = `${host.enemies.length} elite pairs, ${host.enemies.length} on the client with tells `
      + `${Object.entries(H0).map(([k, v]) => `${k} ${v}/${C0[k]}`).join(', ')}, `
      + `worst maxHp ratio ${worstBill.toFixed(3)}, blast billed once (${billed.toFixed(1)} hp over `
      + `${packets} packet${packets === 1 ? '' : 's'}, 0 self-inflicted)`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a duellist swings on a joining player\'s screen, and telegraphs it', async () => {
    /**
     * THE MELEE HALF OF THE SAME DEFECT. A client's enemies are `netDriven`,
     * which returns before `_think` — so `DuelBrain.update` never runs there.
     * `_poseSaber` reads exactly four things off the duel — `guardDir`,
     * `phase`, `spin` and `attack.reach` — and on a client all four sat where
     * the constructor left them for the whole session. Every acolyte in a
     * joining player's level held one guard and never swung; there was no
     * telegraph, so nothing to read, and no arc, so nothing to chamber.
     *
     * Measured on the blade TIP in the enemy's own frame, because that is what
     * a player is looking at: the guard travels, and the travel is the swing.
     * A pose that never moves reports a tip excursion of exactly zero.
     *
     * AND THE CLIENT POSES WITHOUT RESOLVING. The host bills sabers over
     * `hit`; a blade that animated locally and also billed locally would land
     * twice, so `_saberStrike` refuses on a netDriven body. That is asserted
     * here rather than assumed, because it is the failure this fix could
     * introduce.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair();
    for (let i = 0; i < 2; i++) {
      host.spawnEnemy('acolyte', new THREE.Vector3(Math.cos(i) * 2, 0, 2.4 + i));
    }
    host.director.active = true;

    // How far the guard direction wanders, per machine. A duel brain that runs
    // sweeps it through every attack; one that does not holds it still.
    const span = (w) => {
      const seen = w._guardSeen || (w._guardSeen = new Map());
      for (const e of w.enemies) {
        if (!e.duel) continue;
        const r = seen.get(e.id) || { lo: new THREE.Vector3(9, 9, 9), hi: new THREE.Vector3(-9, -9, -9) };
        r.lo.min(e.duel.guardDir); r.hi.max(e.duel.guardDir);
        seen.set(e.id, r);
      }
    };
    let cTele = 0, cPhases = new Set(), hPhases = new Set();
    for (let i = 0; i < 20 * 60; i++) {
      pump(1 / 60);
      span(host); span(client);
      for (const e of client.enemies) {
        if (!e.duel) continue;
        cPhases.add(e.duel.phase);
        if (e.duel.telegraph?.mesh?.visible) cTele++;
      }
      for (const e of host.enemies) if (e.duel) hPhases.add(e.duel.phase);
    }
    const widest = (w) => {
      let m = 0;
      for (const r of (w._guardSeen || new Map()).values()) m = Math.max(m, r.hi.distanceTo(r.lo));
      return m;
    };
    const hSpan = widest(host), cSpan = widest(client);
    assert(hSpan > 0.5, `the host's own duellists barely moved their guard (${hSpan.toFixed(2)}) — the scene is wrong, not the wire`);
    assert(cSpan > hSpan * 0.5,
      `the host swept its guard through ${hSpan.toFixed(2)} and the joining player saw ${cSpan.toFixed(2)} — `
      + 'every duellist on that screen is holding one pose for the whole session');
    assert(cPhases.has('windup') && cPhases.has('strike'),
      `the client only ever saw the phases {${[...cPhases].join(', ')}} — a blade that never enters a `
      + 'strike is a blade that never swings');
    assert(cTele > 0,
      'a duellist wound up an attack and the joining player never saw the arc — the telegraph is the '
      + 'fairness contract of the melee game exactly as the marksman\'s laser is of the ranged one');

    /**
     * …and the client did not ALSO bill it. Driven rather than read: a real
     * strike phase against a real body, with _saberStrike called directly.
     *
     * AND THE BLADE IS POSED ACROSS THE BODY FIRST, WHICH IS THE WHOLE CHECK.
     *
     * This block used to be `e.position.set(0, 0, 0.6)` and nothing else, and
     * it could not fail. `e.position` moves the BODY; the saber's world-space
     * `base`/`tip` are only ever written by `_poseSaber`, so they stayed
     * wherever the last real pump left them — measured at the call, the two
     * blades sat with their mid-points 7.62 m and 7.86 m from the victim's
     * chest, against a hit radius of 0.34 + BLADE_BITE. `bestD > rad*rad`
     * returned false long before `netDriven` was ever consulted. Bypassing the
     * guard (`e.netDriven = false`, which is the pre-fix tree exactly) left
     * `billed` at 0 and the suite at 28 green; deleting `Enemy.js`'s
     * `if (this.netDriven) return false;` outright leaves the FULL gate green
     * at 1031. So the one assertion the co-op work named as guarding the
     * regression it could introduce was guarding nothing at all.
     *
     * Two setHiltPose+update frames sweeping the hilt through the victim give
     * `prev → cur` a real segment — mid-blade 0.69 m from the chest — and now
     * the numbers separate: 0 billed with the guard in place, 2 billed with it
     * bypassed.
     *
     * AND THE SAME SCENARIO IS RUN TWICE, THE SECOND TIME WITH `netDriven`
     * CLEARED, so the check proves its own reach instead of asserting it. A
     * zero that is never contrasted with a non-zero is the state this block was
     * already in; the second pass is what makes the first pass mean something,
     * and it goes on meaning something however the pose, the reach or the
     * capsule are retuned later.
     */
    let billed = 0;
    const victim = { position: new THREE.Vector3(0, 0, 0), chest: new THREE.Vector3(0, 1.3, 0),
      hp: 500, maxHp: 500, alive: true, invuln: 0, radius: 0.34,
      camera: { addShake() {} }, damage() { billed++; } };
    const acrossTheChest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const swingers = client.enemies.filter((e) => e.duel && e.saber);
    /** Put the body on the victim and sweep its blade through the victim's chest. */
    const swingThrough = (e) => {
      e.duel.phase = 'strike';
      e._strikePhase = 'guard';
      e._struck = false;
      // A blade lock pins both fighters and `_saberStrike` returns on it — one
      // in progress after 20 s of real fighting is what made an earlier draft
      // of this block pass and fail on alternate runs.
      e.lock = null;
      e.saber.ignition = 1;
      e.position.set(0, 0, 0.6);
      victim.position.set(0, 0, 0);
      // `valid = false` discards the stale previous frame, so the first pose
      // establishes prev and the second is the swing itself.
      e.saber.valid = false;
      e.saber.setHiltPose(new THREE.Vector3(0.6, 1.2, 0.4), acrossTheChest);
      e.saber.update(1 / 60, 0);
      e.saber.setHiltPose(new THREE.Vector3(-0.6, 1.2, 0.4), acrossTheChest);
      e.saber.update(1 / 60, 0);
      return e._saberStrike(null, victim);
    };
    assert(swingers.length >= 2,
      `only ${swingers.length} client duellist(s) had a blade to swing — the scene is wrong, not the wire`);
    for (const e of swingers) swingThrough(e);
    assert(billed === 0,
      `a client resolved ${billed} saber hit(s) of its own — the host bills sabers over 'hit', so this `
      + 'is the same blow landing twice on the joining player');

    // …and the zero above is the GUARD, not the geometry. Same bodies, same
    // sweep, same victim, with the one line under test taken out of the way.
    let reach = 0;
    const victimBilled = victim.damage;
    victim.damage = () => { reach++; };
    for (const e of swingers) { e.netDriven = false; swingThrough(e); e.netDriven = true; }
    victim.damage = victimBilled;
    assert(reach > 0,
      'the same blades, swept through the same body with `netDriven` cleared, still billed nothing — so '
      + 'the zero above proves nothing about the guard and this check is decoration');

    const line = `guard travel host ${hSpan.toFixed(2)} → client ${cSpan.toFixed(2)}, phases `
      + `{${[...cPhases].sort().join(', ')}}, ${cTele} telegraph frames, ${swingers.length} blades swept `
      + `through a body: 0 billed with the guard, ${reach} without it`;
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a joining player\'s blade does not take the host\'s frame down', async () => {
    /**
     * THE HOST FREEZES, AND IT IS THE FIX FOR SOMETHING ELSE THAT DID IT.
     *
     * `RemoteAvatar` was put into `world.players` deliberately — that is what
     * lets an enemy blade cut a joining player. Avatars carry a real ignited
     * `Saber`, so `_resolveBlades` feeds their contacts to `_applyBladeEvent`
     * exactly like a local player's. Four `addShake` calls in there read
     * `player.camera`, and an avatar has none.
     *
     * `TypeError: cannot read properties of undefined (reading 'addShake')`
     * is thrown out of `World.update()` — so the rest of the frame is
     * abandoned ON THE HOST: no render, no director tick, no snapshot sent.
     * With one idle avatar holding a lit blade against level geometry, an
     * auditor measured 295 of 300 host frames abandoned. That is a freeze, not
     * a stutter, and it takes the whole session down with it.
     *
     * Two of the eight Audit 3 dimensions hit it independently, one of them
     * while measuring something unrelated — which is what a defect that fires
     * on any contact looks like.
     *
     * Driven through the real `_applyBladeEvent` with a real avatar, because
     * the whole defect is which object is in `world.players`.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { host, client, pump } = await H.bootPair();
    pump(0.5);

    /* The avatar is built HERE because `main.js:1118` is the only place the
     * product builds one and main.js cannot be imported under Node — it
     * dereferences the DOM at module scope. These two lines are that call
     * site, verbatim in shape: construct, and put it in both `remotes` and
     * `players`. Being in `players` is the whole precondition of the defect. */
    const avatar = new RemoteAvatar(host, { id: 'PEER', name: 'Jedi', look: null });
    host.remotes.set('PEER', avatar);
    host.players.push(avatar);
    assert(!avatar.camera,
      'the avatar grew a camera — this check is then vacuous and needs a different subject');
    assert(host.players.includes(avatar),
      'the avatar is not in world.players, which is the precondition this measures');

    // Every event kind _resolveBlades can hand a player, against a real avatar.
    const point = new THREE.Vector3(0, 1, 0);
    const evs = [
      { type: 'clang', point },
      { type: 'grind', point, target: { id: 'x' }, speed: 3 },
      { type: 'cut', point, normal: new THREE.Vector3(0, 1, 0), impulse: new THREE.Vector3(0, 1, 0),
        speed: 22, bone: 'armR', cutT: 0.5, target: { prop: null, enemy: null, id: 'y' } },
    ];
    let threw = 0;
    for (const ev of evs) {
      try { host._applyBladeEvent(avatar, ev, 1 / 60); } catch { threw++; }
    }
    assert(threw === 0,
      `${threw} of ${evs.length} blade events thrown by a joining player threw out of the host's `
      + '_applyBladeEvent — every one of those abandons the rest of World.update() on the host, '
      + 'before the render, the director tick and the snapshot');

    // …and the host's own frame keeps running with an avatar blade in contact.
    let frames = 0, lost = 0;
    for (let i = 0; i < 120; i++) {
      try { pump(1 / 60); frames++; } catch { lost++; }
    }
    void client;
    assert(lost === 0, `${lost} of ${frames + lost} host frames were abandoned with a remote blade live`);
    const line = `${evs.length} event kinds and ${frames} frames with a remote blade in contact, `
      + '0 thrown';
    host.unload(); client.unload();
    return line;
  });

  check('co-op: a replicated enemy runs the gait its body is actually covering', async () => {
    /**
     * `velocity = (netTarget - position) * min(1/dt, 18)` is the remaining
     * TRACKING ERROR, not a velocity, and the body only closes that error at
     * (1 - e^(-14/60)) * 60 = 12.49/s — so the number handed to the gait solver
     * was 18/12.49 = 1.4413× the truth, sawtoothing at the packet rate.
     * Rig.js solves stride frequency and stance span from exactly that number
     * (`speed = hypot(v.x, v.z)`), so every body in a joining player's level
     * ran a sprint cadence while translating at a walk: foot-skate on the whole
     * horde, in a game whose README sells "feet are planted by a gait solver".
     *
     * Measured against the ground the body covers, not against a constant.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair();
    host.spawnEnemy('trooper', new THREE.Vector3(-40, 0, 10));
    host.director.active = true;

    let n = 0, reported = 0, covered = 0, hostTrue = 0, worst = 0;
    const prev = new THREE.Vector3();
    for (let i = 0; i < 14 * 60; i++) {
      const e = client.enemies[0];
      if (e) prev.copy(e.position);
      pump(1 / 60);
      if (!e || e.dead || i < 180) continue;
      const moved = e.position.distanceTo(prev) * 60;
      if (moved < 0.4) continue;                     // standing still proves nothing
      const v = Math.hypot(e.velocity.x, e.velocity.z);
      reported += v; covered += moved; n++;
      hostTrue += Math.hypot(host.enemies[0].velocity.x, host.enemies[0].velocity.z);
      worst = Math.max(worst, Math.abs(v / moved - 1));
    }
    assert(n > 200, `only ${n} moving frames sampled — the enemy never walked`);
    const ratio = reported / covered;
    const truth = Math.abs(reported / hostTrue - 1);
    assert(truth < 0.05,
      `the client reports ${(reported / n).toFixed(2)} m/s where the host's own body is doing `
      + `${(hostTrue / n).toFixed(2)} — ${(truth * 100).toFixed(0)}% out`);
    assert(ratio < 1.15,
      `the gait solver is handed ${ratio.toFixed(3)}× the speed the body covers ground at — the feet `
      + 'plant for a stride that long and skate the difference');
    const line = `reported ${(reported / n).toFixed(2)} m/s vs host truth ${(hostTrue / n).toFixed(2)} `
      + `and ground covered ${(covered / n).toFixed(2)}; ratio ${ratio.toFixed(3)}`;
    host.unload(); client.unload();
    return line;
  });

  /* ══ what a client's own machine is allowed to decide ═══════════════════ */

  check('co-op: every way a client hurts an enemy reaches the host, not just the blade', async () => {
    /**
     * THE CHECK THIS REPLACES ASSERTED EXACTLY TWO CLAIM KINDS AND CALLED THEM
     * "the two ways of hurting an enemy". There are at least six: Force
     * lightning, choke, rend's dismemberment, the grip-shield's bite and a
     * deflected or returned bolt were all unclaimed, so on a client they were
     * PHANTOM kills — you threw lightning into a pack and they dropped on your
     * screen only, while the host kept fighting bodies you had watched die.
     *
     * So this drives the real damage calls the real abilities make, by kind,
     * and requires each to reach the host. A seventh ability is covered the day
     * it is written, because the seam is the hp the host does not know about
     * rather than a list of call sites.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    const out = [];
    world.attachNet({ connected: true, isHost: false, broadcast() {}, toPeer() {},
      toHost(m) { out.push(m); } }, 'client');

    /**
     * BUILT BY THE SHIPPED PACKER, NOT TYPED OUT.
     *
     * This was a hand-written array of twelve slots, and `packSnapshot` emits
     * thirteen — the modifier key went on the end and nothing here grew with
     * it, so `md` arrived `undefined` and every drive below silently skipped
     * the modifier path while looking like it covered it. Positional records
     * are exactly where a copied table hides: the reader destructures by
     * position, so a short record is not an error, it is a quiet default.
     *
     * A one-enemy world is packed and the fields this check cares about are
     * overwritten by name against the packer's own ordering, so the record can
     * never be the wrong length or the wrong shape again.
     */
    const { packSnapshot } = await import('../../src/net/Net.js');
    const shape = (() => {
      const probe = { enemies: [Object.assign(Object.create(null), {
        id: 'probe', type: 'trooper', position: new THREE.Vector3(), facing: 0, hp: 100,
        dead: false, velocity: new THREE.Vector3(), aimCharge: 0, duel: null, mod: 0,
      })], _netFires: [], director: { wave: 1, active: true, remaining: 1, intermission: 0 }, score: 0 };
      return packSnapshot(probe).e[0];
    })();
    const SLOT = { id: 0, type: 1, z: 4, hp: 6 };
    const snap = (id, hp) => {
      const rec = shape.slice();
      rec[SLOT.id] = id; rec[SLOT.type] = 'trooper'; rec[SLOT.z] = 4; rec[SLOT.hp] = hp;
      return { t: 'snapshot', w: 1, act: 1, rem: 1, ic: 0, sc: 0, bf: [], e: [rec] };
    };
    assert(shape.length >= 12,
      `packSnapshot emitted ${shape.length} slots per enemy — the probe is not being packed`);
    const p = world.player;
    const claims = {};
    const drive = (name, id, fn) => {
      world.applySnapshot(snap(id, 100));
      const e = world._netEnemyIndex.get(id);
      out.length = 0;
      fn(e);
      world._netTick(1);
      claims[name] = out.filter(m => m.t === 'claim').reduce((a, m) => a + (m.d || 0), 0);
    };

    // The real call sites, by name: Player.js:3157 (lightning), :3036 (choke),
    // :2769 (the grip-shield's bite), :3733 (rend), World.js (a deflected bolt).
    drive('lightning', 11, (e) => e.damage(46, e.position, p, 'lightning'));
    drive('choke', 12, (e) => e.damage(e.maxHp * 0.4, e.position, p, 'choke'));
    drive('shield-bite', 13, (e) => e.damage(18, e.position, p, 'bolt'));
    drive('rend', 14, (e) => {
      const cap = e.capsules().find(c => /arm|fore/.test(c.name)) || e.capsules()[0];
      e.takeCut({ bone: cap.name, cutT: 0.14, cap, point: e.position.clone(),
        impulse: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 1, 0), speed: 18 }, p);
    });

    const silent = Object.entries(claims).filter(([, d]) => !(d > 0)).map(([k]) => k);
    assert(!silent.length,
      `${silent.join(', ')} never reached the host — every kill a client makes with ${silent.length > 1 ? 'those' : 'that'} `
      + 'is a phantom: the enemy stands back up 55 ms later when the next snapshot hard-writes its hp');

    // …and a claim must not be billed twice: the blade path claims explicitly.
    world.applySnapshot(snap(15, 100));
    const e = world._netEnemyIndex.get(15);
    out.length = 0;
    e.damage(30, e.position, p, 'lightning');
    world._netTick(1);
    const first = out.filter(m => m.t === 'claim').reduce((a, m) => a + m.d, 0);
    out.length = 0;
    world._netTick(1);
    const again = out.filter(m => m.t === 'claim').reduce((a, m) => a + m.d, 0);
    assert(first > 0 && again === 0,
      `the same ${first} damage was claimed again on the next tick (${again}) — a client bills the host twice`);
    world.unload(); world.dispose?.();
    return `claimed: ${Object.entries(claims).map(([k, d]) => `${k} ${d.toFixed(0)}`).join(', ')}; no double billing`;
  });

  /**
   * ── ONE ROUND, TWO MACHINES, AND THE QUESTION OF WHO PAYS FOR IT ────────
   *
   * These two checks are one rule seen from both sides, and neither half means
   * anything alone. `_spawnNetBolts` puts the host's fire into the client's own
   * pool as REAL bolts — that is the design, and DESIGN.md is about what it
   * buys: a guest can deflect a host's bolt, catch it, and send it home. The
   * cost is that every such round is simulated twice, and `_reconcileClaims`
   * bills the host for whatever hp a mirror has lost "whatever dealt it".
   *
   * Measured before the rule existed, on a real co-op Command pair on geonosis,
   * 45 s, the joining player holding `idleInput` and firing nothing: 317 claims
   * up the wire, 273.1 hp taken off the client's mirrors by bolts nobody on
   * that machine had fired, and 42.2 hp of it applied by the host on top of the
   * 187.8 hp of the same bolts it had already applied itself. Co-op was
   * measurably easier than the single-machine numbers every tuning pass in this
   * project was taken on.
   *
   * A fix that stopped the client resolving replicated bolts would pass the
   * first of these two and delete the mechanic the second one is about. So both
   * are here, they share one fixture, and the fixture differs between them by
   * exactly one thing: whether the guest's blade touched the bolt.
   */

  /**
   * A PAIR, ONE HOST BODY SHOOTING AND ONE HOST BODY BEING SHOT AT.
   *
   * Everything crosses the way it crosses in a session: the shot is taken with
   * the shipped `BoltPool.fire` on the HOST, so `_recordFires` puts it in the
   * snapshot, and `_spawnNetBolts` on the far end is what makes the client's
   * copy. Nothing here hand-writes a packet.
   *
   * @param side  the victim's team on the host. `0` is what `enlistBody` does
   *   to a named trooper in Command — a body in `world.enemies` on the PARTY's
   *   side, which is the only arrangement in which the horde's own rifles have
   *   anything in that array to hit. `1` leaves it in the horde, which is what
   *   a returned bolt needs to be aimed at.
   */
  const boltPair = async (side) => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const pair = await H.bootPair({ level: 'geonosis' });
    const at = pair.host.player.position;
    const shooter = pair.host.spawnEnemy('b1', new THREE.Vector3(at.x + 8, at.y, at.z));
    const victim = pair.host.spawnEnemy('b1', new THREE.Vector3(at.x + 14, at.y, at.z));
    victim.team = side;
    /* Off their brains: the only fire in this session is the one round fired
     * below, and a b1 that decides to shoot on its own would be a second
     * replicated bolt in the same pool. */
    shooter._think = () => {}; victim._think = () => {};
    pair.pump(0.4);
    const mirror = pair.client._netEnemyIndex.get(victim.id);
    if (!mirror) throw new Error('the client never received a mirror of the host\'s body');

    /**
     * The host fires one round; the client's copy of it, off the wire.
     *
     * FIRED STRAIGHT UP, and that is the fixture's own correction rather than
     * decoration. Aimed along the ground the round is a live bolt for the six
     * frames it takes the snapshot to cross, and in the arm where the victim is
     * on the party's side it can REACH that victim on its own — so the pool had
     * already consumed it by the time this looked, and the check failed reading
     * `spawned 0` with everything under test working. Up there is nothing to
     * hit; `drive` below is what puts the bolt through a body, and it takes the
     * segment as an argument.
     */
    const round = (damage) => {
      const before = new Set(pair.client.bolts.bolts.filter((b) => b.active));
      pair.host.bolts.fire(shooter.aimPoint(new THREE.Vector3()),
        new THREE.Vector3(0, 1, 0), { owner: shooter, damage, speed: 90 });
      pair.pump(0.12);
      const fresh = pair.client.bolts.bolts.filter((b) => b.active && !before.has(b));
      if (fresh.length !== 1) {
        throw new Error(`the host fired one round and the client spawned ${fresh.length}`);
      }
      return fresh[0];
    };

    /**
     * The bolt, driven through the body, through the SHIPPED resolver.
     *
     * `_boltHitTest` is what `Bolts.update` hands every bolt in the air (see
     * the `hitTest` member of the ctx it is stepped with), so this is the same
     * line a bolt that flew there would reach. Standing in for the FLIGHT and
     * not for the rule: a check that walked the bolt itself would be measuring
     * whether this fixture can aim.
     */
    const drive = (bolt) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const from = mirror.position.clone().add(V(0, 1.1, -2));
      const to = mirror.position.clone().add(V(0, 1.1, 2));
      const hp0 = mirror.hp, base0 = mirror._netHp;
      const res = pair.client._boltHitTest(bolt, from, to);
      /* READ BEFORE THE NEXT SNAPSHOT, and this is not fastidiousness: the
       * host's hp is authoritative and `applySnapshot` writes it straight over
       * `e.hp` 18 times a second, so a reading taken after the pump below is
       * the HOST's number and not what this machine did. Measured the wrong way
       * round first: the arm where nothing is claimed read `took 0.0` — the
       * host's copy was untouched, so it wrote 28 back over a mirror that had
       * just lost 28 — and the check failed saying the bolt never landed while
       * everything under test worked. */
      const took = hp0 - mirror.hp, moved = base0 - mirror._netHp;
      pair.seen.toHost.length = 0;
      pair.pump(0.3);
      const claimed = pair.seen.toHost.filter((m) => m.t === 'claim' && m.id === victim.id)
        .reduce((a, m) => a + (Number(m.d) || 0), 0);
      return { hit: res?.victim === mirror, took, moved, claimed, hadLeft: base0 };
    };
    return { ...pair, mirror, victim, round, drive };
  };

  check('co-op: a guest does not bill the host for the host\'s own bolts', async () => {
    /**
     * The bolt is REAL on the client and has to be — this asserts that it hits,
     * before it asserts that nothing is claimed for it. A fix that stopped the
     * client spawning replicated bolts would satisfy the second half of this
     * check and fail the first, which is why the first is here.
     */
    const P = await boltPair(0);
    const r = P.drive(P.round(20));
    P.host.unload(); P.client.unload();
    assert(r.hit && r.took > 0,
      'the host\'s replicated round did not touch the client\'s copy of the body at all — '
      + 'there is nothing here for a guest to deflect, which is the mechanic _spawnNetBolts exists for');
    assert(r.claimed === 0,
      `the guest billed the host ${r.claimed.toFixed(1)} hp for a round the host fired itself — `
      + `one trooper's shot is simulated on both machines and charged twice, and the horde pays the difference`);
    assert(Math.abs(r.moved - r.took) < 0.05,
      `the mirror lost ${r.took.toFixed(1)} hp and its baseline moved ${r.moved.toFixed(1)} — the gap is `
      + 'what _reconcileClaims bills, so anything but zero comes back as a claim on a later tick');
    return `a replicated round took ${r.took.toFixed(1)} hp off the mirror, moved the baseline with it, and claimed nothing`;
  });

  check('co-op: a bolt the guest DEFLECTED is still the guest\'s to claim', async () => {
    /**
     * THE OTHER HALF, and the one that makes the first hard.
     *
     * The host cannot know this bolt changed course — the deflection happened
     * on a machine it does not simulate — so what it does to the horde is the
     * guest's and nobody else can bill it. Same fixture, same round, one
     * difference: `_onBoltDeflect` is called first, with the client's own blade
     * entry off `_bladeEntries`, which is the object `Bolts.update` hands that
     * method when a lit blade crosses a bolt.
     */
    const P = await boltPair(1);
    const p = P.client.player;
    p.saber.ignite(); p.saber.ignition = 1;
    const bolt = P.round(20);
    const entry = P.client._bladeEntries().find((e) => e.owner === p);
    assert(!!entry, 'the guest\'s own lit blade is not among the blades a bolt is tested against');
    const pt = p.chest.clone();
    P.client._onBoltDeflect(bolt, entry, { bladeT: 0.6, point: pt }, pt.clone());
    const deflects = p.deflects;
    const mine = bolt.owner === p;
    const r = P.drive(bolt);
    P.host.unload(); P.client.unload();
    assert(deflects === 1 && mine,
      `the guest's blade met a replicated bolt and ${deflects === 1 ? 'the bolt is not theirs afterwards' : 'nothing was deflected'} — `
      + 'a guest who cannot deflect the host\'s fire is the reason those bolts are replicated at all');
    assert(r.hit && r.took > 0,
      'the bolt the guest sent back did not reach the body it was driven through');
    /* BOUNDED BY WHAT THE BODY HAD LEFT, not by what the blow was worth.
     * `_reconcileClaims` bills a body this machine has killed for the whole
     * rest of its health — which is the right number, because the host has to
     * stop fighting a corpse — and the overkill past that is nobody's. Read the
     * other way round this asserted 38 against a claim of 28 with the whole
     * mechanism working. */
    const due = Math.min(r.took, r.hadLeft);
    assert(r.claimed >= due - 0.05,
      `the guest returned a bolt into a body with ${r.hadLeft.toFixed(1)} hp left, took ${r.took.toFixed(1)} `
      + `off it and claimed ${r.claimed.toFixed(1)} — the host cannot have applied this one, so anything `
      + 'the guest does not claim never happened');
    return `a deflected round took ${r.took.toFixed(1)} hp off a body holding ${r.hadLeft.toFixed(1)}, `
      + `and was claimed at ${r.claimed.toFixed(1)}`;
  });

  check('co-op: the level\'s lava burns a body once, not once per machine', async () => {
    /**
     * THE SAME DEFECT IN A SECOND SUBSYSTEM, and it is why this one is a class
     * and not a bug. A `Hazard` is built by the LEVEL, so every machine in a
     * session has one, and each was running its own copy over every body on the
     * field — then `_reconcileClaims` sent the client's half back to the host as
     * damage the guest had dealt.
     *
     * Measured on a real pair on mustafar with one body standing in the lava
     * for two seconds, before the rule: the host burned it 14.0 hp, the
     * client's mirror burned 14.0 hp of its own, and all 14.0 came back as a
     * claim. A 28 hp body was spent half by the host's lava and half by the
     * client's copy of the same lava — it died in half the time. The player
     * half runs the other way and is the same defect: the host burns its
     * `RemoteAvatar` of a guest and posts the number over `hit`, while that
     * guest's own sheet is burning their real Player at the same moment.
     *
     * The GROUND IS SEARCHED rather than named. A hazard is a sheet at a fixed
     * height over a generated heightfield, so the only honest way to stand a
     * body in it is to find a place where the ground is under it; a hand-picked
     * coordinate would be a number that stops being true the day the ground
     * rolls differently.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const pair = await H.bootPair({ level: 'mustafar' });
    assert(!!pair.host.hazard && !!pair.client.hazard,
      'both machines were supposed to build the level\'s hazard — with only one of them there is '
      + 'nothing here to double-count and this check proves nothing');
    const lvl = pair.host.hazard.level;
    let spot = null;
    for (let x = -120; x <= 120 && !spot; x += 4) {
      for (let z = -120; z <= 120; z += 4) {
        const h = pair.host.terrain.height(x, z);
        if (h < lvl - 0.3) { spot = [x, h, z]; break; }
      }
    }
    assert(!!spot, 'no ground on this seed sits under the hazard sheet, so nothing can stand in it');

    const e = pair.host.spawnEnemy('acklay', new THREE.Vector3(spot[0], spot[1], spot[2]));
    /* Off its brain: a body that walks out of the lava is a body that stops
     * being burned by either machine. */
    e._think = () => {};
    pair.pump(0.2);
    const m = pair.client._netEnemyIndex.get(e.id);
    assert(!!m, 'the client never received a mirror of the body in the lava');
    let host = 0, guest = 0;
    const hi = e.damage.bind(e), mi = m.damage.bind(m);
    const burn = (b, add) => (a, p, s, k) => {
      const was = b.hp; const out = (b === e ? hi : mi)(a, p, s, k);
      if (b.hp < was) add(was - b.hp, k);
      return out;
    };
    e.damage = burn(e, (d, k) => { if (k === pair.host.hazard.kind) host += d; });
    m.damage = burn(m, (d, k) => { if (k === pair.client.hazard.kind) guest += d; });
    pair.seen.toHost.length = 0;
    pair.pump(2);
    const claimed = pair.seen.toHost.filter((x) => x.t === 'claim' && x.id === e.id)
      .reduce((a, x) => a + (Number(x.d) || 0), 0);
    pair.host.unload(); pair.client.unload();

    assert(host > 0,
      `the host's own lava took ${host.toFixed(1)} hp off a body standing in it — the hazard is not `
      + 'biting at all, so nothing below is a measurement of anything');
    assert(guest === 0,
      `the joining player's copy of the same lava burned the same body for another ${guest.toFixed(1)} hp — `
      + 'one sheet, two machines, and the body pays twice');
    assert(claimed === 0,
      `${claimed.toFixed(1)} hp of the host's own lava came back to it as a claim`);
    return `the host's lava took ${host.toFixed(1)} hp; the joining player's copy took 0.0 and claimed 0.0`;
  });

  check('co-op: a joining player\'s Force moves the body, not only its health bar', async () => {
    /**
     * A GUEST'S FORCE DID NOTHING PHYSICAL. ONLY THE NUMBER CROSSED.
     *
     * `_claim` sent `k:'cut'` and `k:'dmg'`, and that was the whole protocol —
     * there was no impulse on this wire anywhere. Driven on a real host/client
     * pair with the host body taken off its brain so nothing else could move
     * it, every figure below measured on BOTH machines:
     *
     *     CONTROL   host 0.000 m   client 0.000 m
     *     SHOVE     host 0.000 m   client 0.000 m   (hp 46 → 40: the DAMAGE crossed)
     *     PULL      host 0.000 m   client 0.000 m
     *     THROW     host 0.000 m   client 0.000 m
     *     GRIP      host y −0.364 → −0.364, client y −0.360 → −0.360, and
     *               `player.gripEnemy` TRUE the whole time on the guest's own
     *               machine — the hold was real state with no physics under it
     *
     * So for everybody who was not the host, the Force was a number applied at
     * a distance. `tools/checks/force.mjs` is 26/26 on all of it because it only
     * ever builds a single-player world — which is the defect in one sentence,
     * and the reason this one takes its numbers on two machines or not at all.
     *
     * FOUR POWERS, TWO MACHINES, ONE PAIR. Every one of them is driven through
     * the shipped `Player` method a key press reaches, against a body the host
     * owns, and measured at both ends.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');

    /** A pair with one host-owned body standing still, and a guest beside it. */
    const scene = async () => {
      const pair = await H.bootPair({ level: 'colosseum' });
      const e = pair.host.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
      e.id = 'subject';
      /* Off its brain, so the only thing in the session that can move this body
       * is the guest. Without it a walking trooper covers metres on its own and
       * the measurement is of the horde, not of the wire. */
      e._think = () => {};
      pair.pump(0.5);
      const ce = pair.client._netEnemyIndex.get('subject');
      const cp = pair.client.player;
      cp.position.set(0, 0, 3);
      pair.pump(0.3);
      const ctx = { enemies: pair.client.enemies, players: pair.client.players, bolts: pair.client.bolts,
        physics: pair.client.physics, terrain: pair.client.terrain, particles: pair.client.particles };
      cp.force = cp.maxForce;
      for (const k in cp.cooldowns) cp.cooldowns[k] = 0;
      return { ...pair, e, ce, cp, ctx };
    };
    /** Peak displacement of the host's body and the guest's copy of it. */
    const flight = (s, seconds = 1.5) => {
      const h0 = s.e.position.clone(), c0 = s.ce.position.clone();
      let host = 0, client = 0;
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        s.pump(1 / 60);
        host = Math.max(host, h0.distanceTo(s.e.position));
        client = Math.max(client, c0.distanceTo(s.ce.position));
      }
      return { host, client };
    };
    const out = {};

    // CONTROL — nothing pressed. Anything that moves here is not the Force.
    {
      const s = await scene();
      out.control = flight(s);
      assert(out.control.host < 0.05 && out.control.client < 0.05,
        `the subject drifted ${out.control.host.toFixed(3)} m with nothing pressed — the scene moves on `
        + 'its own and every number below is noise');
      s.host.unload(); s.client.unload();
    }

    // SHOVE, PULL — aimed from the chest, the way the powers read it.
    for (const [name, fire] of [['shove', (s) => s.cp.forcePush(s.ctx)],
      ['pull', (s) => s.cp.forcePull(s.ctx)]]) {
      const s = await scene();
      s.cp.aimDir.subVectors(s.ce.position, s.cp.chest).normalize();
      fire(s);
      out[name] = flight(s);
      s.host.unload(); s.client.unload();
    }

    // GRIP and THROW — aimed from the CAMERA, because `_pickGripTarget` casts
    // its ray from there so the pick agrees with the crosshair.
    {
      const s = await scene();
      s.cp.aimDir.subVectors(s.ce.position, s.cp.camera.pos).normalize();
      const hy = s.e.position.y, cy = s.ce.position.y;
      s.cp.toggleGrip(s.ctx);
      assert(s.cp.gripEnemy, 'the guest could not take hold of the body at all — the scene is wrong');
      for (let i = 0; i < 90; i++) s.pump(1 / 60);
      out.liftHost = s.e.position.y - hy;
      out.liftClient = s.ce.position.y - cy;
      assert(s.e.gripped, 'the host does not know the joining player is holding this body');
      s.cp.hurlGripped(s.ctx);
      out.throw = flight(s);
      assert(!s.e.gripped, 'the host is still holding a body the guest has thrown');
      s.host.unload(); s.client.unload();
    }

    for (const k of ['shove', 'pull', 'throw']) {
      assert(out[k].host > 0.3,
        `a guest's ${k} moved the host's body ${out[k].host.toFixed(3)} m — the impulse is not on the wire`);
      assert(out[k].client > 0.3,
        `a guest's ${k} moved their own copy ${out[k].client.toFixed(3)} m — the snapshot stomped it`);
      /* The two machines integrated the same impulse a round trip apart, so they
       * are allowed to differ by the round trip and not by the blow. */
      assert(Math.abs(out[k].host - out[k].client) < Math.max(0.4, out[k].host * 0.1),
        `a guest's ${k} travelled ${out[k].host.toFixed(2)} m on the host and `
        + `${out[k].client.toFixed(2)} m on the guest — the two machines are simulating different blows`);
    }
    assert(out.liftHost > 0.3,
      `the guest lifted the body ${out.liftHost.toFixed(3)} m on the host's screen — the grip is state `
      + 'with no physics under it off-host');
    assert(out.liftClient > 0.3,
      `the guest lifted the body ${out.liftClient.toFixed(3)} m on their own screen`);

    return ['control', 'shove', 'pull', 'throw'].map((k) =>
      `${k} ${out[k].host.toFixed(2)}/${out[k].client.toFixed(2)} m`).join(', ')
      + `, lift ${out.liftHost.toFixed(2)}/${out.liftClient.toFixed(2)} m (host/guest)`;
  });

  check('co-op: a peer who goes silent mid-lift does not leave a body in the air', async () => {
    /**
     * EVERY OTHER CLAIM IS AN EVENT THAT HAPPENED. The lift is a standing
     * instruction — `e.gripped` and `e.liftTarget`, held for as long as the
     * player holds the key — and `_think` returns early on `gripped`, so a body
     * abandoned in that state hangs in the air out of its own brain for the
     * rest of the host's session. That is the one thing on this wire a closing
     * lid can strand, and a silence is the only signal that can say so.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const e = host.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    e.id = 'stranded';
    e._think = () => {};
    pump(0.5);
    const ce = client._netEnemyIndex.get('stranded');
    const cp = client.player;
    cp.position.set(0, 0, 3);
    pump(0.3);
    cp.force = cp.maxForce; cp.cooldowns.grip = 0;
    cp.aimDir.subVectors(ce.position, cp.camera.pos).normalize();
    cp.toggleGrip({ enemies: client.enemies, players: client.players, bolts: client.bolts,
      physics: client.physics, terrain: client.terrain, particles: client.particles });
    pump(1.0);
    assert(e.gripped, 'the host never took the lift at all');
    const heldY = e.position.y;

    // the lid closes: the endpoint stops talking, everything else keeps running
    client.net.toHost = () => {};
    let released = -1;
    for (let i = 0; i < 180 && released < 0; i++) { pump(1 / 60); if (!e.gripped) released = i / 60; }
    assert(released >= 0,
      'the host is still holding a body for a peer that stopped talking a full three seconds ago');
    assert(released > 0.2,
      `the host dropped the lift after ${released.toFixed(2)} s of silence — one late packet on a bad `
      + 'connection would put down whatever a player is holding');
    host.unload(); client.unload();
    return `held at y ${heldY.toFixed(2)}, dropped ${released.toFixed(2)} s after the peer went quiet`;
  });

  check('co-op: two Force users on one body is a contest, and the host is where it is settled', async () => {
    /**
     * ── THE DEFECT, MEASURED ON THIS EXACT FIXTURE BEFORE IT WAS FIXED ────
     *
     * Two players can already hold one body — nothing stopped them, and both
     * paid for it. `e.liftTarget` was ONE SLOT, written every frame by the
     * host's own `_updateGrip` and every claim tick by this handler, so the
     * body went wherever whichever of them ran later put it. Driven here, host
     * pulling one way and guest the other:
     *
     *     host's hold point   -1.18, 6.12, 2.96
     *     guest's hold point  -0.67, 0.41, 2.96
     *     the body sat at     -1.13, 5.82, 2.96   ← 0.30 m from one, 5.43 from the other
     *     force spent over 2 s: host 8.7, guest 7.6
     *
     * Two people spending pool, one of them getting nothing, and nothing on
     * either screen to say which. That is `PLAN §4.8`'s own sentence about the
     * state of the art — *"in Psi-Ops, Half-Life 2, The Force Unleashed and
     * Control, exactly one entity owns an object"* — shipping as a bug.
     *
     * ── WHAT THIS BINDS ──────────────────────────────────────────────────
     *
     * The arithmetic has its own suite (`grip.mjs`, on two players in one
     * world, where there is no latency between the contest and the assertion).
     * What can only be measured HERE is the wire:
     *
     *   1. the host's ledger has BOTH hands on the body, which means the grip
     *      claim's new `w`/`f`/`b` — what the guest pulls with, the pool behind
     *      it, and whether that guard is broken — arrived and were read, since
     *      the host cannot see any of the three any other way;
     *   2. the body resolves BETWEEN the two hold points rather than at either;
     *   3. and breaking the guest's guard — a fact that exists only on the
     *      guest's machine — moves the resolution on the host's.
     *
     * The host is the authority by construction: it is the one machine that can
     * see both pulls. A guest is never told what the host's hand is doing, so
     * its own copy resolves as though it were alone and is corrected by the
     * next snapshot, exactly as every other optimistic claim on this wire is.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { gripHolders } = await import('../../src/game/Enemy.js');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const e = host.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    e.id = 'contested';
    e._think = () => {};
    /* TWO HANDS CHOKE AT TWICE THE RATE, and a trooper held by both of them
     * dies inside four seconds — which would end the measurement rather than
     * fail it. The contest is not a claim about health. */
    e.maxHp = 1e6; e.hp = 1e6;
    pump(0.5);
    const ce = client._netEnemyIndex.get('contested');
    assert(ce, 'the guest never got a copy of the body');
    const hp = host.player, cp = client.player;
    hp.position.set(-6, 0, 6); cp.position.set(6, 0, 6);
    pump(0.3);
    const ctx = (w) => ({ enemies: w.enemies, players: w.players, bolts: w.bolts,
      physics: w.physics, terrain: w.terrain, particles: w.particles, time: w.time });
    for (const [p, tgt] of [[hp, e], [cp, ce]]) {
      p.force = p.maxForce; p.cooldowns.grip = 0;
      p.aimDir.subVectors(tgt.position, p.camera.pos).normalize();
      p.toggleGrip(ctx(p === hp ? host : client));
    }
    assert(hp.gripEnemy === e, 'the host did not take hold of its own copy of the body');
    assert(cp.gripEnemy === ce, 'the guest did not take hold of its mirror of the body');

    /* Opposite ways, and the two hold points are what the contest is between. */
    const hAim = new THREE.Vector3(-1, 0.9, 0).normalize();
    const cAim = new THREE.Vector3(1, 0.9, 0).normalize();
    const drive = (secs, beatGuest = false) => {
      const f0 = { h: hp.force, g: cp.force };
      for (let i = 0; i < secs * 60; i++) {
        hp.aimDir.copy(hAim); cp.aimDir.copy(cAim);
        if (beatGuest) cp.staggerTimer = 1;
        pump(1 / 60);
      }
      return { h: f0.h - hp.force, g: f0.g - cp.force };
    };
    const wants = (p, aim) => new THREE.Vector3().copy(p.camera.pos).addScaledVector(aim, p.gripDistance).x;

    const spent = drive(2);
    const hx = wants(hp, hAim), cx = wants(cp, cAim);
    assert(hx < cx - 8, `setup: the two hold points are ${(cx - hx).toFixed(2)} m apart, which is not a tug-of-war`);
    assert(gripHolders(e, host.time) === 2,
      'the host has one hand on the body, not two — the guest\'s pull never crossed the wire');
    const level = e.position.x;
    assert(level > hx + 2 && level < cx - 2,
      `the body sits at x ${level.toFixed(2)} against hold points at ${hx.toFixed(2)} and ${cx.toFixed(2)} — `
      + 'one of them still owns it outright');
    assert(spent.h > 0 && spent.g > 0,
      `only one of them is paying for it: host ${spent.h.toFixed(1)}, guest ${spent.g.toFixed(1)}`);

    /**
     * AND NOW THE GUEST'S GUARD BREAKS — on the GUEST'S machine, where the host
     * cannot see it. It reaches the host only as the `b` bit on the grip claim,
     * and if that bit is not sent or not read the body does not move at all.
     */
    drive(2, true);
    const pulled = level - e.position.x;
    assert(gripHolders(e, host.time) === 2, 'a hand left the contest mid-measurement');
    assert(pulled > 1,
      `breaking the guest's guard moved the body ${pulled.toFixed(2)} m towards the host — it barely noticed, `
      + 'so the broken guard is not crossing the wire');
    assert(hp.gripEnemy === e && cp.gripEnemy === ce, 'somebody let go before the measurement was taken');
    assert(hp.gripShare > 0.5,
      `the host holds ${hp.gripShare.toFixed(3)} of a body whose other holder is staggered`);

    /* READ BEFORE `unload`, which disposes both players and therefore releases
     * both grips — a share read after it is the 1.000 `releaseGrip` resets to
     * rather than the one this check measured. */
    const won = { share: hp.gripShare, x: e.position.x };
    host.unload(); client.unload();
    return `hold points ${hx.toFixed(2)} / ${cx.toFixed(2)}; level at ${level.toFixed(2)} with both paying `
      + `${spent.h.toFixed(1)}/${spent.g.toFixed(1)} Force; guest's guard broken → ${won.x.toFixed(2)} `
      + `(${pulled.toFixed(2)} m), host share ${won.share.toFixed(3)}`;
  });

  check('co-op: the enemy record is read with as many slots as it is written with', async () => {
    /**
     * THE SIGNATURE DEFECT OF THIS REPOSITORY, and this record has already had
     * it once: a hand-typed twelve-slot reader against a thirteen-slot packer.
     * A positional record cannot fail loudly — the reader destructures by
     * position, so a short list is not an error, it is a quiet `undefined` that
     * every downstream `|| 0` turns into a plausible default. The record has
     * grown four times now (velocity, the duel, the modifier, the side, the
     * cast) and nothing in the suite has ever compared the two ends of it.
     *
     * Counted off the shipped packer and the shipped reader, so it cannot be
     * satisfied by a third copy of the list written here.
     */
    const { packSnapshot } = await import('../../src/net/Net.js');
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    world.attachNet({ connected: true, isHost: true, broadcast() {}, toPeer() {}, toHost() {}, sweep() {} }, 'host');
    const rec = packSnapshot(world).e[0];
    const text = await src('game/World.js');
    const m = text.match(/const \[([^\]]*)\] = rec;/);
    assert(m, 'applySnapshot no longer destructures the enemy record — this check cannot see the reader');
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert(rec.length === names.length,
      `packSnapshot writes ${rec.length} slots per enemy and applySnapshot reads ${names.length} `
      + `(${names.join(', ')}) — the ${Math.abs(rec.length - names.length)} on the end arrive as `
      + 'undefined and every `|| 0` beside them turns that into a plausible default');
    world.unload(); world.dispose?.();
    return `${rec.length} slots written, ${names.length} read: ${names.join(' ')}`;
  });

  check('co-op: the next snapshot does not stomp the shove the guest just applied', async () => {
    /**
     * THE CRUX, AND IT IS NOT THE CLAIM — IT IS THE FRAME AFTER IT.
     *
     * `_stepNetEnemies` hard-overwrites `e.velocity` from `_netVel` and damps
     * position toward `_netPos` at 14/s at the TOP OF EVERY FRAME. That is
     * right for ordinary motion and wrong for the frames after a shove: an
     * impulse applied locally was erased before anything integrated it, so a
     * guest did not even get the local illusion of their own push working.
     * Sending the impulse without fixing this would have left the guest
     * watching the host's copy fly 90 ms later while their own stood still.
     *
     * Two things have to be true at once and they pull in opposite directions,
     * which is why this is its own check:
     *
     *   IMMEDIATE — the body moves on the guest's machine before any answer
     *   could possibly have come back. The claim goes at 1/24 s and the host
     *   answers at 1/18 s, so three frames at 60 Hz is 50 ms and cannot contain
     *   a round trip. Anything that moves in there is local.
     *
     *   STILL THE HOST'S — the window closes, and the moment it does the host's
     *   position is authoritative again. Driven by teleporting the host's body
     *   somewhere the guest could never have put it and watching the guest's
     *   copy come to it.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { host, client, pump } = await H.bootPair({ level: 'colosseum' });
    const e = host.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    e.id = 'shoved';
    e._think = () => {};
    pump(0.5);
    const ce = client._netEnemyIndex.get('shoved');
    const cp = client.player;
    cp.position.set(0, 0, 3);
    pump(0.3);
    cp.force = cp.maxForce; cp.cooldowns.push = 0;
    cp.aimDir.subVectors(ce.position, cp.chest).normalize();

    const from = ce.position.clone();
    cp.forcePush({ enemies: client.enemies, players: client.players, bolts: client.bolts,
      physics: client.physics, terrain: client.terrain, particles: client.particles });
    let early = 0;
    for (let i = 0; i < 3; i++) { pump(1 / 60); early = Math.max(early, from.distanceTo(ce.position)); }
    assert(early > 0.1,
      `the guest's own copy moved ${early.toFixed(3)} m in the 50 ms after their own push — no round `
      + 'trip fits in that, so this is the local illusion being erased by the snapshot');

    // …and the flight lands in the same place on both machines.
    for (let i = 0; i < 180; i++) pump(1 / 60);
    const apart = e.position.distanceTo(ce.position);
    assert(apart < 1.0,
      `the two machines put the shoved body ${apart.toFixed(2)} m apart once it came down — the guest is `
      + 'simulating a body it does not own');

    /* THE HOST IS STILL THE AUTHORITY. A place the guest's own physics could
     * never have produced, so following it is proof the window shut. */
    const away = new THREE.Vector3(18, 0, -14);
    away.y = host.terrain.height(away.x, away.z);
    e.position.copy(away);
    e.velocity.set(0, 0, 0);
    for (let i = 0; i < 120; i++) pump(1 / 60);
    const followed = ce.position.distanceTo(away);
    assert(followed < 1.0,
      `the host moved its body and the guest's copy stayed ${followed.toFixed(2)} m away — the authority `
      + 'window never closes and the guest owns the horde now');
    host.unload(); client.unload();

    /**
     * …AND THE WHOLE THING AGAIN OVER A REAL ROUND TRIP, because a window whose
     * length is derived from the latency is not tested at zero latency. 120 ms
     * one way is a bad-but-ordinary connection, and `bootPair` publishes it as
     * `net.latency` so `_netOwn` derives the window from the wire it is on.
     *
     * The number that matters here is the SNAP-BACK: how far the guest's copy
     * ever travels back toward where it started, which is what a rubber-band
     * is. Measured on this scene, an 11.5 m flight at a 240 ms round trip:
     *
     *     the shipped window            0.78 m in 50 ms, snap-back 0.74 m
     *     window = knockTimer only      0.78 m in 50 ms, snap-back 2.31 m
     *     no window (what shipped)      0.00 m in 50 ms, snap-back 0.00 m
     *
     * The last line is the defect and it is worth reading carefully: the guest's
     * copy still ENDS UP flying, because the impulse claim alone gets the shove
     * to the host and the host's position comes back — it simply does nothing
     * for a quarter of a second and then teleports into a flight it never
     * started. And the middle line is why the window carries the round trip
     * rather than only the body's own knock clock: cut that term and the
     * correction triples.
     */
    const far = await H.bootPair({ level: 'colosseum', lag: 0.12 });
    const fe = far.host.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    fe.id = 'lagged';
    fe._think = () => {};
    far.pump(0.6);
    const fce = far.client._netEnemyIndex.get('lagged');
    const fcp = far.client.player;
    fcp.position.set(0, 0, 3);
    far.pump(0.4);
    fcp.force = fcp.maxForce; fcp.cooldowns.push = 0;
    fcp.aimDir.subVectors(fce.position, fcp.chest).normalize();
    const fFrom = fce.position.clone();
    fcp.forcePush({ enemies: far.client.enemies, players: far.client.players, bolts: far.client.bolts,
      physics: far.client.physics, terrain: far.client.terrain, particles: far.client.particles });
    let fEarly = 0, back = 0, best = 0;
    for (let i = 0; i < 180; i++) {
      far.pump(1 / 60);
      const d = fFrom.distanceTo(fce.position);
      back = Math.max(back, best - d);
      best = Math.max(best, d);
      if (i < 3) fEarly = Math.max(fEarly, d);
    }
    const fApart = fe.position.distanceTo(fce.position);
    assert(fEarly > 0.1,
      `over a 240 ms round trip the guest's own copy moved ${fEarly.toFixed(3)} m in the first 50 ms`);
    assert(fApart < 1.0,
      `over a 240 ms round trip the two machines ended ${fApart.toFixed(2)} m apart`);
    assert(back < best * 0.15,
      `the guest's copy travelled ${back.toFixed(2)} m BACK toward where it started during an `
      + `${best.toFixed(2)} m flight — the window closes before the host's stream carries the shove, `
      + 'and a shove that rubber-bands is worse to look at than one that does not move at all');
    far.host.unload(); far.client.unload();
    return `guest's own copy moved ${early.toFixed(2)} m inside 50 ms, landed ${apart.toFixed(2)} m from `
      + `the host's, and came back to within ${followed.toFixed(2)} m when the host moved it; over a `
      + `240 ms round trip ${fEarly.toFixed(2)} m / ${fApart.toFixed(2)} m apart / ${back.toFixed(2)} m `
      + `of snap-back on an ${best.toFixed(1)} m flight`;
  });

  check('co-op: an enemy\'s cast reaches a joining player as a cast, and they can break it', async () => {
    /**
     * A POWER ARRIVED AS AN UNSOURCED NUMBER WITH NO WARNING.
     *
     * `packSnapshot`'s fourteen slots carried `tg` and `dl` and nothing for
     * `_castTimer`, `_castKey` or `casting`, and `main.js` applied the result as
     * `p.damage(d, null, null, msg.k)`. Driven — a Jedi Master targeting a
     * RemoteAvatar for 40 s:
     *
     *     casts:          ["push" ×6]
     *     host screen:    "FORCE PUSH" ×6 floating tells
     *     peer receives:  hit:force:9.0 ×6   telegraphs: 0   displacement: 0
     *
     * `_forceBrain`'s own note calls the 0.45 s wind-up the fairness contract of
     * the whole kit, and `breakCast` makes it generous — 100% break at 400 ms
     * into a 450 ms tell, measured. All of it invisible and unanswerable off the
     * host, which is worse than the power not existing: the player learns the
     * horde has an attack with no tell.
     *
     * Both halves are here because either alone is worthless. A tell you can see
     * and cannot answer is decoration; an answer you cannot see coming is luck.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { ENEMY_POWERS } = await import('../../src/game/Enemy.js');

    const scene = async () => {
      const pair = await H.bootPair({ level: 'colosseum' });
      /* The host's own player walks off so the duellist has exactly one target
       * — the joining player — and its blade is stilled so the only thing it can
       * reach them with is a power. */
      pair.host.player.position.set(60, 0, 60);
      pair.client.player.position.set(0, 0, 6);
      pair.pump(0.5);
      const e = pair.host.spawnEnemy('master', new THREE.Vector3(0, 0, 3));
      e.id = 'caster';
      e.duel.update = () => {};
      pair.pump(0.3);
      return { ...pair, e, ce: pair.client._netEnemyIndex.get('caster') };
    };

    // ── 1. the tell crosses, and it is the same tell
    const s = await scene();
    const hostTells = [], guestTells = [];
    s.host.onFloating = (p, t) => hostTells.push(t);
    s.client.onFloating = (p, t) => guestTells.push(t);
    const cast = s.e._castPower.bind(s.e);
    const casts = [];
    s.e._castPower = (k, ctx, d) => { casts.push(k); return cast(k, ctx, d); };
    let sawWindup = 0, sawHold = 0, worstDrift = 0;
    const from = s.client.player.position.clone();
    let shoved = 0;
    for (let i = 0; i < 60 * 30; i++) {
      s.pump(1 / 60);
      if (s.e._castTimer > 0 && s.ce._castTimer > 0) {
        sawWindup++;
        worstDrift = Math.max(worstDrift, Math.abs(s.e._castTimer - s.ce._castTimer));
      }
      if (s.e.casting && s.ce.casting === s.e.casting) sawHold++;
      shoved = Math.max(shoved, from.distanceTo(s.client.player.position));
    }
    const labels = new Set(Object.values(ENEMY_POWERS).map((P) => P.label));
    const guestCalls = guestTells.filter((t) => labels.has(t));
    const hostCalls = hostTells.filter((t) => labels.has(t));
    assert(casts.length > 0, 'the duellist never cast anything — the scene is wrong, not the wire');
    assert(hostCalls.length > 0, 'the host drew no floating call for its own casts — the scene is wrong');
    assert(guestCalls.length >= hostCalls.length,
      `the host drew ${hostCalls.length} floating calls (${[...new Set(hostCalls)]}) and the joining `
      + `player saw ${guestCalls.length} — a power with no tell off-host`);
    assert(sawWindup > 0,
      'the joining player never held a wind-up at the same time as the host — `_castTimer` is not crossing');
    assert(worstDrift < 0.12,
      `the guest's copy of the wind-up ran ${worstDrift.toFixed(3)} s away from the host's — the clock a `
      + 'player reads to time an interrupt is not the clock the interrupt is against');
    assert(sawHold > 0, 'a HELD power (choke, lightning) never showed on the joining player as held');
    assert(shoved > 0.3,
      `the enemy's own shove moved the joining player ${shoved.toFixed(3)} m — the cast lands as damage `
      + 'with no physics again');
    s.host.unload(); s.client.unload();

    // ── 2. and the guest can answer what the guest can see
    let broke = 0, tried = 0;
    for (let n = 0; n < 5; n++) {
      const t = await scene();
      let landed = null, done = false;
      const inner = t.e._castPower.bind(t.e);
      t.e._castPower = (k, ctx, d) => { landed = k; return inner(k, ctx, d); };
      for (let i = 0; i < 60 * 20 && !done; i++) {
        t.pump(1 / 60);
        /* Timed off the GUEST's own copy of the wind-up, which is the whole
         * point: a player answers the clock on their screen. 0.05 s left of a
         * 0.45 s tell is 400 ms in, where the host measures 100%. */
        if (!(t.ce._castTimer > 0 && t.ce._castTimer <= 0.05)) continue;
        tried++; landed = null; done = true;
        const cp = t.client.player;
        cp.force = cp.maxForce; cp.cooldowns.push = 0;
        cp.aimDir.subVectors(t.ce.position, cp.chest).normalize();
        cp.forcePush({ enemies: t.client.enemies, players: t.client.players, bolts: t.client.bolts,
          physics: t.client.physics, terrain: t.client.terrain, particles: t.client.particles });
        t.pump(0.5);
        if (!landed) broke++;
      }
      t.host.unload(); t.client.unload();
    }
    assert(tried > 0, 'no cast was ever answered — the guest could not see one to answer');
    assert(broke === tried,
      `the joining player broke ${broke} of ${tried} casts at 400 ms into a 450 ms tell, where the host `
      + 'breaks 100% — the counterplay is generous on one machine and a coin flip on the other');
    return `${casts.length} casts: host ${hostCalls.length} calls / guest ${guestCalls.length}, wind-up `
      + `agrees to ${worstDrift.toFixed(3)} s, ${sawHold} frames of a shared hold, the guest moved `
      + `${shoved.toFixed(2)} m, and broke ${broke}/${tried} at 400 ms`;
  });

  check('co-op: a joining player killed by an enemy was killed BY that enemy', async () => {
    /**
     * `main.js` applied every `hit` as `p.damage(d, null, null, msg.k)` — the
     * third null being the attacker. `Player.die` hands its source to
     * `onPlayerDeath`, which is what names the killer on the death card and
     * credits the kill, so a joining player cut down by a Sith Master died to
     * nobody at all for the whole life of the protocol.
     *
     * Both directions, because they are two different lookups: an enemy is an
     * id the snapshot already agreed on, and a player is the awkward one — the
     * host's own Player answers to 'local' on the host and is a RemoteAvatar
     * keyed by the host's peer id everywhere else.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const P = await import('../../src/game/Player.js');
    const { host, client, pump, seen } = await H.bootPair({ level: 'colosseum' });
    pump(0.4);
    const peer = host.remotes.get('PEER');
    assert(peer, 'the host has no body for the joining player');
    const e = host.spawnEnemy('acolyte', new THREE.Vector3(0, 0, 20));
    e.id = 'namedKiller';
    pump(0.3);   // the body has to have reached the guest before it can be named

    let killer = 'nobody';
    client.onPlayerDeath = (p, src) => { killer = src === null || src === undefined ? 'nobody' : src.id; };
    client.player.hp = 4;
    peer.damage(50, null, e, 'saber');
    pump(0.2);
    assert(!client.player.alive, 'the guest survived a 50 hp blow on 4 hp — the hit never arrived');
    assert(killer === 'namedKiller',
      `the joining player was killed by "${killer}" — the death card and the kill feed have nobody to name`);

    /* …and a PLAYER's kill, which needs the host's own body to be findable by a
     * name the guest knows it under. */
    const duel = P.pvpRules({ pvp: true, duelRounds: 3, duelHealth: 150 });
    host.rules = duel; client.rules = duel;
    host.player.team = P.SIDES[0]; peer.team = P.SIDES[1]; client.player.team = P.SIDES[1];
    client.player.alive = true; client.player.hp = 4; client.player.invuln = 0;
    killer = 'nobody';
    peer.damage(50, null, host.player, 'saber');
    pump(0.2);
    const named = seen.toClient.filter((m) => m.t === 'hit').map((m) => m.s);
    assert(!client.player.alive, 'the guest survived a duellist\'s 50 hp blow on 4 hp');
    assert(killer && killer !== 'nobody' && killer !== 'local',
      `a duel kill named "${killer}" — 'local' is what the host calls its own body and nothing over `
      + 'here answers to it');
    assert(client.remotes.get(killer) === client.remotes.get('HOST'),
      `the id on the wire (${killer}) is not the one the joining player draws the host under`);
    host.unload(); client.unload();
    return `killed by an enemy: "namedKiller"; killed by a player: "${killer}"; ids on the wire ${JSON.stringify(named)}`;
  });

  check('co-op: a friend\'s kill is credited to the friend', async () => {
    /**
     * `applyClaim` passed `null` as the damage source and `onEnemyKilled`
     * requires one before it credits anything — so every enemy a joining player
     * legitimately killed was scored to NOBODY: no kill feed entry, no score,
     * no combo, and `run.kills` (which sums `p.kills` over `world.players`)
     * undercounted the party in the run summary for the whole session.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: true, broadcast() {}, toPeer() {}, toHost() {}, sweep() {} }, 'host');
    const e = world.spawnEnemy('trooper', new THREE.Vector3(0, 0, 6));
    const feed = [];
    world.onKillFeed = (who, what) => feed.push([who, what]);
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    world.players.push(ally); world.remotes.set('PEER', ally);

    world.applyClaim('PEER', { t: 'claim', k: 'dmg', id: e.id, d: 9999, p: [0, 1, 6] });
    assert(e.dead, 'the claim did not kill the enemy');
    assert(ally.kills === 1, `the peer that killed it has ${ally.kills} kills`);
    assert(feed.length === 1 && feed[0][0] === 'ALPHA',
      `the kill feed says ${JSON.stringify(feed)} — a friend's kill is credited to nobody`);
    const partyKills = world.players.reduce((a, p) => a + p.kills, 0);
    assert(partyKills === 1, `the run summary would count ${partyKills} kills for the party`);
    world.unload(); world.dispose?.();
    return `kill feed "${feed[0][0]}", avatar.kills 1, party kills 1`;
  });

  check('co-op: the host does not bill a peer for a bolt that peer resolved itself', async () => {
    /**
     * A peer owns its own health — its avatar packet carries `hp` and
     * `RemoteAvatar.update` overwrites the host's copy 24 times a second — so
     * the host cannot apply damage to it, only say so. That is what `hit` is.
     *
     * But every bolt is replicated now and the peer resolves it against their
     * own body, with their own boons and their own blade, so billing it from
     * the host as well would charge them for a bolt they had just sent back.
     * `hit` keeps everything the peer cannot see: sabers, explosions, the core.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    const sent = [];
    world.attachNet({ connected: true, isHost: true, broadcast() {}, sweep() {},
      toPeer(id, m) { sent.push([id, m]); }, toHost() {} }, 'host');
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    const hp0 = ally.hp;

    ally.damage(12, null, null, 'bolt');
    assert(sent.length === 0, 'the host billed a peer for a bolt the peer is simulating itself');
    ally.damage(26, null, null, 'saber');
    assert(sent.length === 1 && sent[0][0] === 'PEER' && sent[0][1].t === 'hit' && sent[0][1].d === 26,
      `a saber strike did not reach the peer: ${JSON.stringify(sent)}`);
    assert(ally.hp === hp0,
      'RemoteAvatar.damage wrote its own hp, which the next avatar packet overwrites 42 ms later');

    // …and a CLIENT must never be able to damage another client.
    world.netMode = 'client';
    sent.length = 0;
    ally.damage(30, null, null, 'saber');
    assert(sent.length === 0, 'a client damaged another client — the host must be the only authority');
    ally.dispose();
    world.unload(); world.dispose?.();
    return 'bolts resolved by their victim; sabers addressed to one peer; a client cannot hurt a peer';
  });

  /* ══ the run a joining player is having ════════════════════════════════ */

  check('co-op: a joining player earns Insight, hears the wave, and gets the between-wave heal', async () => {
    /**
     * `director.update` is gated off on a client, and EVERYTHING a wave is
     * worth hangs off callbacks only that method fires: the WAVE N and WAVE
     * CLEAR announcements, `score += 500 * w`, the 8 hp and 0.35 flow every
     * player gets for surviving one — and Insight, whose single earning path is
     * `_earnInsight` installed on `onWaveClear`. So a client earned ZERO
     * Insight for a whole session: the LivingForce was a dead screen, no star
     * could ever be lit, and they were strictly weaker than the host by 8 hp
     * per wave for as long as they played.
     *
     * The signal is already on the wire as an edge in `w`/`act`.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: false, broadcast() {}, toPeer() {}, toHost() {} }, 'client');
    const said = [];
    world.onNotify = (t) => said.push(t);
    const snap = (w, act, rem = 0, ic = 0) => ({ t: 'snapshot', e: [], bf: [], w, act, rem, ic, sc: 500 });

    const p = world.player;
    p.hp = p.maxHp - 30;
    const hp0 = p.hp, flow0 = p.flow, insight0 = world.communion.insight;

    world.applySnapshot(snap(1, 1, 6));
    world.applySnapshot(snap(1, 0, 0, 5.5));
    assert(said.includes('WAVE 1'), `no wave announcement reached the client: ${JSON.stringify(said)}`);
    assert(said.includes('WAVE CLEAR'), 'the client never hears a wave clear');
    assert(world.communion.insight > insight0,
      `the client earned ${world.communion.insight - insight0} Insight over a cleared wave — the whole `
      + 'LivingForce is unreachable for anybody who joins');
    assert(p.hp === hp0 + 8, `the client healed ${p.hp - hp0} of the 8 hp a survived wave pays`);
    assert(p.flow > flow0, 'the client got no flow for surviving the wave');

    // …and the HUD's numbers come off the wire rather than off an empty queue.
    world.applySnapshot(snap(2, 1, 9, 0));
    assert(world.director.remaining === 9,
      `the client's wave readout says ${world.director.remaining} where the host says 9 — it cannot see `
      + 'anything the host has queued or in transit');
    world.applySnapshot(snap(2, 0, 0, 4.25));
    assert(Math.abs(world.director.intermission - 4.25) < 1e-6,
      `the intermission clock reads ${world.director.intermission}; the host's is 4.25, so the HUD `
      + 'prints "next wave in 0" for the whole intermission');
    const gained = world.communion.insight - insight0;
    world.unload(); world.dispose?.();
    return `insight +${gained.toFixed(0)}, +8 hp, WAVE 1 / WAVE CLEAR heard, remaining 9, intermission 4.25`;
  });

  check('co-op: a player who dies gets a card, and the party wipe is re-read when an ally falls', async () => {
    /**
     * `onGameOver` requires EVERY entry of `world.players` to be dead, and
     * `world.players` holds RemoteAvatars — so the first player to die in co-op
     * got nothing at all: pointer still locked, input still enabled, watching
     * their own ragdoll for the rest of the run. And it could never fire late
     * either, because `onPlayerDeath` had exactly one caller, `Player.die()`,
     * so nothing re-evaluated the predicate when the REMOTE body died
     * afterwards — a RemoteAvatar's death is a field in a packet and raises
     * nothing.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: false, broadcast() {}, toPeer() {}, toHost() {} }, 'client');
    let over = 0, down = 0;
    world.onGameOver = () => over++;
    world.onLocalDown = () => down++;
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    world.players.push(ally); world.remotes.set('PEER', ally);

    world.player.damage(9999, null, null, 'test');
    await new Promise(r => setTimeout(r, 80));           // the dynamic Ragdoll import
    for (let i = 0; i < 120; i++) world.update(1 / 60, H.idleInput());
    assert(!world.player.alive, 'the player survived 9999 damage');
    assert(down === 1, `the player died with an ally standing and was told ${down} times`);
    assert(over === 0, 'the run ended while an ally was still standing');
    assert(!world.over, 'the world stopped its director while an ally was still fighting');

    ally.alive = false;
    for (let i = 0; i < 30; i++) world.update(1 / 60, H.idleInput());
    assert(over === 1,
      'the last ally died and nothing re-read the wipe condition — the dead player never gets a card '
      + 'at all, on any machine');
    world.unload(); world.dispose?.();
    return 'one death → a local card; the ally\'s death → the run ends';
  });

  check('co-op: a downed player is put back on their feet by a wave the party survives', async () => {
    /**
     * `Player.respawn(pos)` was written — forty complete lines — and had ZERO
     * CALLERS anywhere in src/, tools/ or index.html. There was no downed
     * state, no revive, no spectate and no rejoin: dying in co-op was the end
     * of your session while your friends played on.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: false, broadcast() {}, toPeer() {}, toHost() {} }, 'client');
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    ally.position.set(6, 0, 6);
    world.players.push(ally); world.remotes.set('PEER', ally);
    let revived = 0;
    world.onLocalRevive = () => revived++;

    world.player.damage(9999, null, null, 'test');
    await new Promise(r => setTimeout(r, 80));
    for (let i = 0; i < 60; i++) world.update(1 / 60, H.idleInput());
    assert(!world.player.alive, 'the player is not down');

    const snap = (w, act) => ({ t: 'snapshot', e: [], bf: [], w, act, rem: 0, ic: 0, sc: 0 });
    world.applySnapshot(snap(1, 1));
    world.applySnapshot(snap(1, 0));
    assert(world.player.alive,
      'the party survived a wave with a friend down and nothing brought them back — Player.respawn '
      + 'is still a method with no callers');
    assert(revived === 1, `the revive was not announced (${revived})`);
    assert(world.player.hp === world.player.maxHp, 'the revived player came back hurt');
    assert(world.player.invuln > 0, 'the revived player came back with no mercy window');
    assert(world.player.position.distanceTo(ally.position) < 4,
      `revived ${world.player.position.distanceTo(ally.position).toFixed(1)} m from the ally who held the line`);

    // …and a wipe is still a wipe: with nobody standing, nobody gets up.
    // (the mercy window has to run out first, or the second kill is refused)
    for (let i = 0; i < 3 * 60; i++) world.update(1 / 60, H.idleInput());
    assert(world.player.invuln <= 0, 'the mercy window never expired');
    world.player.damage(9999, null, null, 'test');
    await new Promise(r => setTimeout(r, 80));
    ally.alive = false;
    world.applySnapshot(snap(2, 1));
    world.applySnapshot(snap(2, 0));
    assert(!world.player.alive, 'a wave clear revived the whole party after a total wipe');
    world.unload(); world.dispose?.();
    return 'down → the party clears a wave → up again beside them, at full health, with invulnerability';
  });

  check('co-op: restarting the wave cannot empty a client\'s arena', async () => {
    /**
     * The pause card's Restart is a single-player debug affordance on an
     * always-visible button. On a client it disposed every enemy and emptied
     * `world.enemies` WITHOUT touching `_netEnemyIndex`, and `applySnapshot`
     * only spawns a body for an id that is not already in that map — so every
     * id the host was still sending resolved to a disposed Enemy that could
     * never be recreated. Measured: four net-driven enemies before, zero after,
     * all four ids still held, for the rest of the host's wave, while `hit`
     * messages kept arriving from bodies that were no longer on screen.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: false, broadcast() {}, toPeer() {}, toHost() {} }, 'client');
    const ids = [1, 2, 3, 4];
    const snap = () => ({ t: 'snapshot', bf: [], w: 1, act: 1, rem: 4, ic: 0, sc: 0,
      e: ids.map(i => [i, 'trooper', i * 2, 0, 8, 0, 100, 0, 0, 0, 0, 0]) });
    world.applySnapshot(snap());
    for (let i = 0; i < 30; i++) world.update(1 / 60, H.idleInput());
    const before = world.enemies.length;
    assert(before === 4, `the scene did not establish (${before} enemies)`);

    const restarted = world.restartWave();
    assert(restarted === false, 'a client restarted the host\'s wave');
    for (let i = 0; i < 120; i++) { if (i % 3 === 0) world.applySnapshot(snap()); world.update(1 / 60, H.idleInput()); }
    assert(world.enemies.filter(e => e.netDriven && !e.dead).length === 4,
      `${world.enemies.filter(e => e.netDriven && !e.dead).length} of the host's 4 enemies are on the `
      + 'client\'s screen two seconds after Restart — the arena is empty and can never refill');
    assert(!world.director.active || world.netMode !== 'client' || world.director.spawnQueue?.length === undefined
      || !world.director.spawnQueue.length,
      'a second, local wave director was started on a machine that is supposed to have none');
    world.unload(); world.dispose?.();

    // A HOST may still restart, and must clear the id map with the list.
    const { world: h } = await H.bootWorld({ level: 'colosseum' });
    h.attachNet({ connected: true, isHost: true, broadcast() {}, toPeer() {}, toHost() {}, sweep() {} }, 'host');
    h.spawnEnemy('trooper', new (await import('three')).Vector3(0, 0, 6));
    h._netEnemyIndex.set(99, h.enemies[0]);
    assert(h.restartWave() === true, 'the host cannot restart its own wave');
    assert(h.enemies.length === 0 && h._netEnemyIndex.size === 0,
      'the host restarted the wave and left ids in the client id map');
    h.unload(); h.dispose?.();
    return 'a client declines and keeps the horde; a host restarts and clears both the list and the id map';
  });

  /* ══ leaving, and what a session is allowed to touch ═══════════════════ */

  check('co-op: there is a way out of a session, and it is wired to quitting', async () => {
    /**
     * `Net.close()` was complete and had ZERO CALLERS in the repository.
     * Quitting to the menu disposed the world and left `enabled`/`connected`
     * true, so no `close` fired on the other side, the departed player stayed a
     * live target in everybody else's world, and the next Ignite silently
     * re-attached them as a client of the same host — solo play was unreachable
     * without reloading the tab.
     */
    const s = await session(['HOST', 'ALPHA']);
    const c = s.clients[0];
    let hostSawLeave = 0;
    s.host.on('peer-left', () => hostSawLeave++);
    assert(c.enabled && c.connected, 'the joining client is not in a session to begin with');
    c.close();
    s.fake.flush();
    await s.settle(2);
    assert(!c.enabled && !c.connected, 'close() left the session enabled or connected');
    assert(!c.hostConn, 'close() left an outbound path to the host open');
    assert(c.roster.length === 0, 'close() left the roster standing');
    assert(hostSawLeave === 1, `the host was told ${hostSawLeave} times that the peer left`);
    s.close();

    // …and something has to CALL it. This was the whole defect.
    const main = strip(await src('main.js'));
    assert(/net\.close\(\)/.test(main), 'nothing in main.js ever closes the session');
    const q = main.slice(main.indexOf('function quitToMenu'), main.indexOf('function quitToMenu') + 900);
    assert(/leaveSession\(\)|net\.close\(\)/.test(q),
      'quitting to the menu does not leave the co-op session — the connection stays up and the next '
      + 'Ignite re-attaches you to the same host');
    return 'close() tears the endpoint down, the host hears it, and quitToMenu calls it';
  });

  check('co-op: joining a friend\'s session does not rewrite your saved settings', async () => {
    /**
     * `welcome` and `start` wrote `settings.level`, `settings.difficulty` and
     * `settings.mode` straight onto the player's own settings object, and
     * `deploy()` persists that object wholesale to localStorage. So one round
     * in a friend's Grandmaster Descent permanently rewrote your saved level,
     * difficulty and mode, and your next SOLO run silently started in theirs.
     *
     * A session is a different scope from a preference; the read side has to
     * prefer the session and the write side has to persist the preference.
     */
    const main = strip(await src('main.js'));
    for (const handler of ["net.on('welcome'", "net.on('start'"]) {
      assert(main.includes(handler), `${handler} is gone`);
      const body = functionBody(main, handler);
      assert(!/settings\.(level|difficulty|mode)\s*=/.test(body),
        `${handler} writes the host's choice onto the player's own settings, which deploy() persists `
        + 'to localStorage — their next solo run starts in the host\'s level');
    }
    /* THE SCOPE EXISTS AND THE HANDLERS WRITE INTO IT. This used to look for
     * the literal `session = {`, which is a proxy for the shape rather than
     * for the property — and it went red the day those two literals became
     * `sessionPart(msg)`, a change that made the scope MORE correct rather
     * than less (see the SESSION_KEYS clause below). What matters is that the
     * host's choices land in `session` and not in `settings`; the loop above
     * asserts the second half, and this asserts the first. */
    for (const handler of ["net.on('welcome'", "net.on('start'"]) {
      const body = functionBody(main, handler);
      assert(/\bsession\s*=/.test(body),
        `${handler} does not write the host's choices into the session scope at all`);
    }
    const d = main.slice(main.indexOf('function deploy('), main.indexOf('function deploy(') + 1200);
    assert(/saveSettings\(settings\)/.test(d), 'deploy no longer persists the player\'s settings at all');
    assert(/sessionOr\('level'\)|session\?\.level/.test(d),
      'deploy ignores the session, so a client would load its own level instead of the host\'s');
    return 'the host\'s level/difficulty/mode live in a session object; only the player\'s own settings are saved';
  });

  /* A CLIENT FOLLOWING THE HOST DOWN A RUNG was pinned here, and there are no
   * rungs any more — the Descent is deleted. The defect it caught survives the
   * mode though, and is worth the sentence: `deploy()` fell through to its
   * default argument on a joining client, which built a run of its OWN and
   * loaded that run's level instead of the one the host had just sent. Any
   * future mode that carries the level in the session rather than in settings
   * walks back into it, which is why `deploy(null)` vs `deploy()` is called
   * out in main.js's own comment rather than only here.
   */

  check('co-op: the interpolation window follows the connection instead of a constant', async () => {
    /**
     * 90 ms, hard-coded, for every connection — while `Net.latency` was
     * measured every two seconds by a ping World sends and read by NOTHING.
     * A packet that arrives outside the window is a body that stops dead and
     * snaps, because `update` clamps to the last sample when the buffer runs
     * out.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    const r = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });

    let t = 0;
    for (let i = 0; i < 40; i++) { t += 1 / 24; r.push(avatarAt(i * 0.1), t); }
    const tight = r.delay;
    for (let i = 0; i < 40; i++) { t += (i % 7 === 0 ? 0.22 : 1 / 24); r.push(avatarAt(4 + i * 0.1), t); }
    const loose = r.delay;
    assert(loose > tight * 1.5,
      `the window stayed at ${loose.toFixed(3)} s on a connection whose worst gap went from `
      + `${(1000 / 24).toFixed(0)} ms to 220 ms — it cannot absorb what it cannot measure`);
    assert(loose >= 0.22, `a 220 ms gap is not covered by a ${(loose * 1000).toFixed(0)} ms window`);
    assert(loose <= r.maxDelay, 'the window is unbounded, so a bad connection can put a friend anywhere');
    for (let i = 0; i < 60; i++) { t += 1 / 24; r.push(avatarAt(8 + i * 0.1), t); }
    assert(r.delay < loose,
      'the window never comes back down, so one hiccup costs the rest of the session');
    r.dispose();
    world.unload(); world.dispose?.();
    return `window ${(tight * 1000).toFixed(0)} ms on a clean stream → ${(loose * 1000).toFixed(0)} ms `
      + `through a 220 ms gap → ${(r.delay * 1000).toFixed(0)} ms once it clears`;
  });

  check('co-op: a RemoteAvatar has the shape World treats it as having', async () => {
    /**
     * A RemoteAvatar is pushed into `world.players`, and World's loops treat
     * everything in that list as a Player. Driven rather than grepped: the
     * loops are run for real over a world that contains one.
     *
     * The first of these was not a missing feature but a CRASH — `_boltHitTest`
     * read `p.invuln` then `p.boonMods.absorb` with no guard, so every enemy
     * bolt that reached a friend took the frame loop down with it.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: true, broadcast() {}, toPeer() {}, toHost() {}, sweep() {} }, 'host');
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    ally.position.set(2, 0, 8);
    ally.push({ ...avatarAt(2), p: [2, 0, 8] }, performance.now() / 1000);
    world.players.push(ally); world.remotes.set('PEER', ally);
    world.spawnEnemy('trooper', new THREE.Vector3(2, 0, 22));
    world.spawnEnemy('acolyte', new THREE.Vector3(2.4, 0, 9));
    world.director.active = true;

    let threw = null;
    try { for (let i = 0; i < 8 * 60; i++) world.update(1 / 60, H.idleInput()); } catch (e) { threw = e; }
    assert(!threw, `a world containing a remote player threw after ${threw && threw.message}`);
    // every field World's loops read off a player, unguarded
    for (const f of ['invuln', 'boonMods', 'alive', 'position', 'saber', 'kills', 'score', 'combo']) {
      assert(ally[f] !== undefined, `RemoteAvatar has no ${f}, and World's player loops read it unguarded`);
    }
    for (const m of ['damage', 'heal', 'addFlow', 'aimPoint', 'update', 'dispose']) {
      assert(typeof ally[m] === 'function', `RemoteAvatar has no ${m}()`);
    }
    world.unload(); world.dispose?.();
    return 'eight seconds of a live fight around a remote body, no throw, every read answered';
  });

  /* ══ the general rules worth keeping ══════════════════════════════════ */

  check('co-op: a rule the session shares is on the wire at every site that says the session moved', async () => {
    /**
     * THE SESSION'S RULES, AND THE FIVE PLACES THAT USED TO COPY THEM BY HAND.
     *
     * A session has two kinds of setting. Most are yours — quality, fov, blade
     * colour, bindings. A few are the MATCH's and have to be identical on every
     * machine or the game is two different games: the ground, the difficulty,
     * the mode, and the rules of engagement. That set was written out longhand
     * at five sites — main.js's handshake, its `start` broadcast, the two
     * places a joining player writes `session`, and `World._afterRotate`, which
     * announces a mid-run ground change — and one of them being short is not a
     * crash, it is two players in different games with nothing said.
     *
     * IT HAD ALREADY COST SOMETHING. `commandVersus` turns Command into a
     * meeting between two players and was on NONE of the five, so a host who
     * ticked it and a client who had not were in a meeting and a campaign
     * respectively. `pvp` was about to be the second the day it got a control.
     *
     * So `Net.SESSION_KEYS` is the list and `sessionPart` is the only way to
     * build one of these payloads. Asserted by SOURCE here rather than by
     * behaviour, deliberately and against the usual rule: what is being tested
     * is that no SIXTH site grows its own hand-written copy, and a site that
     * does not exist yet cannot be driven. The behaviour half is the clause in
     * `skirmish` that watches a rotation put exactly one `start` on the wire.
     */
    const files = await sources();
    const src = (p) => files.find(([f]) => f === p)?.[1] ?? '';
    const { SESSION_KEYS, sessionPart } = await import('../../src/net/Net.js');
    assert(SESSION_KEYS.length >= 3 && SESSION_KEYS.includes('level'),
      `SESSION_KEYS is ${JSON.stringify(SESSION_KEYS)} — this clause is measuring nothing`);
    /* The function is the contract: those keys, and only the ones present.
     *
     * THE FIXTURE'S LEVEL IS A REAL ONE, and not because this clause cares —
     * any string would do the arithmetic. `roster: nothing in the tree names a
     * level the game does not have` greps the whole tree for `level: '…'` and
     * a placeholder `'x'` reads to it exactly like a level somebody deleted.
     * Taken from LEVEL_ORDER rather than typed, so it is not a literal at all. */
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const key = LEVEL_ORDER[0];
    const got = sessionPart({ level: key, mode: 'duel', quality: 'ultra', pvp: undefined });
    assert(got.level === key && got.mode === 'duel' && !('quality' in got) && !('pvp' in got),
      `sessionPart let through ${JSON.stringify(got)} — it must carry the session's keys, skip `
      + 'everyone else\'s, and OMIT an absent one rather than writing it as undefined (`session` is '
      + 'replaced on a start, not merged, so absent and present-but-undefined must stay distinct)');

    /* Every payload that says "the session is now this" must be built from it. */
    const sites = [];
    for (const f of ['main.js', 'game/World.js']) {
      const text = src(f);
      for (const m of text.matchAll(/\{[^{}]*\bt: 'start'[^{}]*\}/g)) sites.push([f, m[0]]);
      /* `session = null` is a TEARDOWN, not a payload — leaving a session has
       * no keys to get right. Only an assignment that carries something is a
       * site this clause is about. */
      for (const m of text.matchAll(/session = (?!null\b)([^;\n]+)/g)) sites.push([f, m[0]]);
      /* One level of nesting, because the argument IS a call: a `[^)]*` stops
       * at the inner paren and reports the site as hand-built when it is not. */
      for (const m of text.matchAll(/net\.host\((?:[^()]|\([^()]*\))*\)/g)) sites.push([f, m[0]]);
    }
    assert(sites.length >= 4,
      `found ${sites.length} session payload site(s) — the finder has gone stale and this clause is `
      + 'passing on an empty set');
    const raw = sites.filter(([, code]) => !code.includes('sessionPart'));
    assert(raw.length === 0,
      `${raw.length} site(s) build the session's rules by hand instead of from sessionPart: `
      + raw.map(([f, c]) => `${f}: ${c.trim().slice(0, 70)}`).join(' · ')
      + ' — a site that is one key short is two players in different games, silently');
    return `${SESSION_KEYS.length} session-wide key(s) (${SESSION_KEYS.join(', ')}) across `
      + `${sites.length} payload site(s), all built from sessionPart`;
  });

  check('co-op: no message type is handled and never sent', async () => {
    // THE GENERAL FORM, kept from the old suite. A `case 'x':` in the router
    // with no `t: 'x'` anywhere is a wire built at one end — which is exactly
    // what `claim` was, and it cost the whole co-op mode.
    const files = await sources();
    const net = strip(files.find(([p]) => p === 'net/Net.js')[1]);
    const handled = [...net.matchAll(/case '([a-z]+)':/g)].map(m => m[1]);
    assert(handled.length > 6, `only ${handled.length} message types found — the parse is wrong`);
    const all = files.map(([, t]) => strip(t)).join('\n');
    const unsent = handled.filter((type) => !new RegExp(`t:\\s*'${type}'`).test(all));
    assert(!unsent.length, `handled but never sent by anything: ${unsent.join(', ')} — a wire built at one end`);
    return `${handled.length} message types, every one of them has a sender`;
  });

  check('co-op: no field is put on the wire and read by nobody', async () => {
    /**
     * THE CONVERSE, which the old suite structurally could not have — and it is
     * the half that was failing. `from` was stamped on every relayed packet and
     * read nowhere, which is finding one. `rem` arrived every snapshot and was
     * written to `director._netRemaining`, which nothing read, which is why a
     * client's wave HUD was wrong. `ts` was sent and never looked at.
     * `tickRate`, `_accum` and `peerCount` were state nobody consulted, and
     * `tickRate = 18` actively contradicted the real cadence.
     */
    const files = await sources();
    const all = files.map(([, t]) => strip(t)).join('\n');
    const net = strip(files.find(([p]) => p === 'net/Net.js')[1]);

    // Every key packSnapshot and packAvatar put on the wire must have a reader.
    const packed = [];
    for (const fn of ['export function packSnapshot', 'export function packAvatar']) {
      const i = net.indexOf(fn);
      assert(i > 0, `${fn} is gone`);
      const body = net.slice(i, net.indexOf('\n}', i));
      for (const m of body.matchAll(/^\s{4}([a-z]{1,3}[0-9]?):/gm)) packed.push(m[1]);
    }
    assert(packed.length > 8, `only ${packed.length} wire fields parsed — the parse is wrong`);
    const unread = packed.filter((k) => k !== 't'
      && !new RegExp(`(msg|s|s2|rec|state)\\.${k}\\b`).test(all)
      && !new RegExp(`\\b${k}\\b\\s*[,\\]}]`).test(all.replace(net.slice(net.indexOf('export function packSnapshot')), '')));
    assert(!unread.length,
      `sent every packet and read by nobody: ${unread.join(', ')} — bandwidth for a field that cannot `
      + 'change anything, and the sign of a wire built at one end');

    // The specific dead state this rule was written over.
    for (const dead of ['tickRate', 'peerCount']) {
      assert(!new RegExp(`this\\.${dead}\\s*=|get ${dead}\\(`).test(net),
        `Net.${dead} is back, and nothing reads it`);
    }
    assert(/latency/.test(strip(files.find(([p]) => p === 'main.js')[1])),
      'the latency the client measures every two seconds is shown to nobody again');
    return `${packed.length} wire fields, every one of them has a reader`;
  });

  check('co-op: signalling is overridable, so a broker outage is not fatal', async () => {
    // The default is the public PeerJS broker, which is somebody else's server.
    // An acceptable default and an unacceptable hard dependency.
    const net = await src('net/Net.js');
    assert(/SABER_SIGNAL/.test(net), 'there is no way to point co-op at a different signalling server');
    assert(net.includes('function peerOptions'), 'peerOptions is gone');
    assert(/iceServers/.test(functionBody(net, 'function peerOptions')),
      'no ICE servers configured — direct connections only');
    return 'window.SABER_SIGNAL overrides the broker; ICE servers are configured';
  });

  check('co-op: a blade clash is resolved by whoever is holding the blade', async () => {
    // The body hit is host-authoritative because the ENEMY is. The clash is
    // not: it is a mouse-driven contest whose stamina, riposte window and
    // stagger live on the other machine.
    const world = await src('game/World.js');
    const i = world.indexOf('// enemy blades vs the player');
    assert(i > 0, 'the enemy blade loop is gone');
    const body = world.slice(i, world.indexOf('// blade locks run their own contest', i));
    assert(body.length > 400 && body.length < 6000, `the loop parse looks wrong (${body.length} chars)`);
    assert(!/if \(!p\.alive \|\| !p\.control\) continue/.test(body),
      'the loop still skips everything without a control, so enemy sabers pass through remote players');
    assert(/p\.control && p\.saber\.ignition/.test(body),
      'the clash is resolved for a remote blade too, which decides their duel for them');
    assert(/_saberStrike\(/.test(body),
      'the enemy blade loop no longer runs a body test for the players this enemy is not targeting, '
      + 'so in co-op every saber passes through everyone but its own target');
    return 'clash is local-only; the body hit reaches every player, remote or not';
  });

  check('co-op: an enemy blade cuts a player who has no controller', async () => {
    /**
     * The loop opened `if (!p.alive || !p.control) continue;` and a RemoteAvatar
     * has no `control` — so every enemy saber in the game passed straight
     * through every joining player, in the one mode where being surrounded is
     * the point. Driven: a body with `damage`, a position and no controller,
     * held inside a real duellist's arc for sixty seconds.
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

  check('co-op: drafting a boon does not throw, and every player draws their own hand', async () => {
    /**
     * `World.applyBoon` looped `this.players` and called `applyBoon` on each; a
     * RemoteAvatar is in that list and has no such method, so drafting a SINGLE
     * card in co-op threw a TypeError. And a client's director never runs, so
     * `onDraft` never fired there — a joining player fought every wave the host
     * did and was never offered a card.
     *
     * What is NOT sent is the hand: each machine draws from its own taken-set,
     * the only set that knows what that player already holds.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { boonById } = await import('../../src/game/Waves.js');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.attachNet({ connected: true, isHost: true, broadcast() {}, toPeer() {}, toHost() {}, sweep() {} }, 'host');
    const ally = new RemoteAvatar(world, { id: 'PEER', name: 'ALPHA' });
    world.players.push(ally); world.remotes.set('PEER', ally);
    const boon = boonById('vitality') || { id: 'vitality', name: 'Vitality', tag: 'more life', mods: {} };
    let threw = null;
    try { world.applyBoon(boon); } catch (e) { threw = e; }
    assert(!threw, `drafting a card with a remote player in the world threw ${threw && threw.message}`);
    assert(world.takenBoons.has(boon.id), 'the boon was not taken');
    world.unload(); world.dispose?.();

    const src2 = strip(await src('game/World.js'));
    const main = strip(await src('main.js'));
    assert(/t: 'draft'/.test(src2), 'the host never tells a peer that a draft is open');
    const d = src2.slice(src2.indexOf('onDraft = '), src2.indexOf('onDraft = ') + 1400);
    assert(!/broadcast\([^)]*boons/.test(d),
      'the host broadcasts its own hand, which offers peers ranks they have not earned');
    const h = main.slice(main.indexOf("net.on('draft'"), main.indexOf("net.on('draft'") + 500);
    assert(/drawBoons\(/.test(h) && /world\.takenBoons/.test(h),
      'the client does not draw from its own taken-set');
    return 'applied to local players only, the moment broadcast, each peer draws its own hand';
  });

  check('co-op: a departed peer leaves world.players as well as world.remotes', async () => {
    // It was pushed into both and removed from one, so a departed peer stayed
    // live in every loop over the player list: enemies kept picking it as a
    // target and walking to a body that no longer updated.
    const main = strip(await src('main.js'));
    assert(main.includes("net.on('peer-left'"), 'the peer-left handler is gone');
    const body = functionBody(main, "net.on('peer-left'");
    assert(/remotes\.delete/.test(body), 'the avatar is not removed from remotes');
    assert(/players\.splice|players\.indexOf/.test(body),
      'the avatar is left in world.players, where it stays a target forever');
    assert(/world\.players\.push\(r\)/.test(main), 'the push this pairs with is gone');
    assert(/net\.on\('closed'/.test(main),
      'nothing handles the host disappearing — a client is left in a world where nothing arrives');
    return 'a departed peer leaves both remotes and players; a vanished host is announced';
  });

  check('co-op: a friend cannot be hurt by a friend, and the host is where that is decided', async () => {
    /**
     * "FRIENDLY FIRE IS OFF IN CO-OP" WAS NOT A RULE ANYBODY HAD WRITTEN.
     *
     * It was the absence of a path that could deliver it — which is the same
     * thing right up until the day one exists, and the duel lane has just
     * built several. Measured on this build before the gate went in: an
     * explicit `avatar.damage(25, point, ally, 'saber')` on the HOST sent a
     * `hit` packet addressed to the friend, and `Player.damage(25, point,
     * ally, 'saber')` on a local body took 21.2 hp off them.
     *
     * The host is the node this matters on, because the host is the only node
     * that resolves anything for anybody else — a `hit` it sends is applied by
     * the peer with no further argument (see main.js's handler, which calls
     * `p.damage` with a null source and cannot re-check anything).
     *
     * Driven through both damage sinks, on a real session, with the real
     * `world.rules` a co-op run has: none.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar } = await import('../../src/net/Net.js');
    const { SIDES, CO_OP_RULES, pvpRules } = await import('../../src/game/Player.js');

    const { world } = await H.bootWorld({ level: 'colosseum' });
    assert(!world.rules || !world.rules.friendlyFire,
      'a co-op world boots with friendly fire already on');

    const sent = [];
    world.attachNet({ connected: true, isHost: true, name: 'HOST', roster: [], sweep() {},
      broadcast() {}, toHost() {}, toPeer(id, m) { sent.push([id, m]); } }, 'host');
    const ally = new RemoteAvatar(world, { id: 'ALPHA', name: 'ALPHA' });
    world.players.push(ally);
    const me = world.player;
    assert(me.team === ally.team, `co-op put the party on sides ${me.team} and ${ally.team}`);

    // 1 — the host, billing a friend it can see.
    ally.damage(25, ally.chest, me, 'saber');
    assert(!sent.length,
      `the host sent ${sent.length} hit packet(s) charging an ally for an ally's blade`);
    // 2 — a local body, hurt by a friend standing next to it.
    me.invuln = 0;
    const before = me.hp;
    me.damage(25, me.chest, ally, 'saber');
    assert(me.hp === before, `an ally's blade took ${(before - me.hp).toFixed(1)} hp off a friend`);
    // 3 — and the horde is unaffected by all of it, which is the whole point.
    me.invuln = 0;
    me.damage(25, me.chest, { team: 1, world }, 'saber');
    assert(me.hp < before, 'the gate now blocks the horde as well as your friends');

    // 4 — the same session with duel rules is the opposite, from the same code.
    world.rules = pvpRules({ pvp: true });
    ally.team = SIDES[1];
    ally.damage(25, ally.chest, me, 'saber');
    assert(sent.length === 1 && sent[0][0] === 'ALPHA',
      'a rival on the other side of a duel is still unhittable on the host');
    assert(CO_OP_RULES.friendlyFire === false,
      'the co-op default was mutated by a duel — the rules object is not frozen');

    const line = `ally: 0 hit packets, 0 hp; horde: ${(before - me.hp).toFixed(0)} hp; rival: 1 packet`;
    ally.dispose();
    world.unload(); world.dispose?.();
    return line;
  });
}
