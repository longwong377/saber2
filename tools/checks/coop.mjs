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
  const code = await (async () => { const p = host.host(names[0], { level: 'arena' }, looks[0] || null); await settle(); return p; })();
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

    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { host, client, pump } = await H.bootPair();
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
    let hPeak = 0, cPeak = 0, tel = 0;
    for (let i = 0; i < 12 * 60; i++) {
      pump(1 / 60);
      hPeak = Math.max(hPeak, count(host, hSeen));
      cPeak = Math.max(cPeak, count(client, cSeen));
      for (const e of client.enemies) if (e.laser?.visible) tel++;
    }
    assert(hSeen.size > 5, `the host only fired ${hSeen.size} bolts — the scene is wrong, not the wire`);
    assert(cSeen.size > 0,
      `the host fired ${hSeen.size} bolts and the joining player saw 0 — there is nothing to deflect, `
      + 'nothing to parry and no perfect return available in the whole session');
    assert(cSeen.size >= hSeen.size * 0.8,
      `the client saw ${cSeen.size} of the host's ${hSeen.size} bolts`);
    assert(tel > 0,
      'a marksman charged its shot and the joining player never saw the laser — the fairness contract '
      + 'of the entire ranged game is invisible to them');
    assert(client.player.hp < 100, 'the replicated bolts do not reach the joining player at all');
    const line = `host ${hSeen.size} bolts (peak ${hPeak}) → client ${cSeen.size} (peak ${cPeak}), `
      + `${tel} telegraph frames, client hp ${client.player.hp.toFixed(0)}`;
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
     */
    const bomb = host.enemies.find((e) => e.mod === 'unstable');
    const cb = client._netEnemyIndex.get(bomb.id);
    client.player.position.copy(cb.position).add(new THREE.Vector3(1.5, 0, 0));
    client.player.position.y = client.terrain.height(client.player.position.x, client.player.position.z);
    client.player.hp = client.player.maxHp;
    const hp0 = client.player.hp;
    assert(!!cb.coreMesh, 'an Unstable elite reached the client with no reactor core on its chest');
    bomb.damage(9999, bomb.position.clone(), null, 'saber');
    pump(3);
    assert(bomb._detonated, 'the host never detonated its own bomb — the scene is wrong');
    assert(client.player.hp >= hp0 - 0.01,
      `a client's own copy of an Unstable elite took ${(hp0 - client.player.hp).toFixed(1)} hp off its `
      + 'local player — the host bills that blast over `hit`, so the joining player pays for it twice');

    const line = `${host.enemies.length} elite pairs, ${host.enemies.length} on the client with tells `
      + `${Object.entries(H0).map(([k, v]) => `${k} ${v}/${C0[k]}`).join(', ')}, `
      + `worst maxHp ratio ${worstBill.toFixed(3)}, 0 hp of double blast`;
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
     * Insight for a whole session: the Constellation was a dead screen, no star
     * could ever be lit, and they were strictly weaker than the host by 8 hp
     * per wave for as long as they played.
     *
     * The signal is already on the wire as an edge in `w`/`act`.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'arena' });
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
      + 'Constellation is unreachable for anybody who joins');
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world: h } = await H.bootWorld({ level: 'arena' });
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
      const i = main.indexOf(handler);
      assert(i > 0, `${handler} is gone`);
      const body = main.slice(i, i + 1100);
      assert(!/settings\.(level|difficulty|mode)\s*=/.test(body),
        `${handler} writes the host's choice onto the player's own settings, which deploy() persists `
        + 'to localStorage — their next solo run starts in the host\'s level');
    }
    assert(/session\s*=\s*\{/.test(main), 'there is no session scope for the host\'s choices');
    const d = main.slice(main.indexOf('function deploy('), main.indexOf('function deploy(') + 1200);
    assert(/saveSettings\(settings\)/.test(d), 'deploy no longer persists the player\'s settings at all');
    assert(/sessionOr\('level'\)|session\?\.level/.test(d),
      'deploy ignores the session, so a client would load its own level instead of the host\'s');
    return 'the host\'s level/difficulty/mode live in a session object; only the player\'s own settings are saved';
  });

  check('co-op: a client follows the host down a rung instead of standing in the old level', async () => {
    /**
     * A client's Run can never ascend — the rung signal is host-only by design
     * — so the host's `start` broadcast is the ONLY thing that can take a
     * joining player down the ladder. It was acted on `if (screens.state ===
     * 'menu')` alone, so a client that was playing, paused, drafting or dead
     * ignored it and stayed in the Intake receiving snapshots of bodies at
     * Foundry coordinates: enemies inside walls and in mid-air, and an
     * unrecoverable run.
     */
    const main = strip(await src('main.js'));
    const i = main.indexOf("net.on('start'");
    assert(i > 0, 'the start handler is gone');
    const body = main.slice(i, i + 1200);
    assert(!/screens\.state === 'menu'\s*\)\s*deploy\(/.test(body),
      'the start message is still only acted on from the menu, so a client that is already playing '
      + 'never follows the host to the next rung');
    assert(/deploy\(/.test(body), 'the start message no longer deploys anything');
    assert(/world\.dispose\(\)|world = null/.test(body),
      'the old level is not torn down before the new one is built');

    /**
     * …AND THE LEVEL IT DEPLOYS INTO, WHICH THE GATE WAS NOT.
     *
     * Only `screens.state === 'menu'` came off. `deploy()` still fell through
     * to its default argument — `startRun()`, which builds a brand new gauntlet
     * Run at tier 0 — and `deploy`'s own next line is
     * `const levelKey = run && !run.done ? run.rung.level : sessionOr('level')`,
     * so that fresh run's rung beat the `msg.level` the handler had just put
     * into `session` one line above. Evaluated against the real Run and DESCENT
     * this was three of four rungs wrong: the host sends foundry, deeps, deeps
     * and the client builds intake, intake, intake — a different building from
     * everyone else while snapshots keep arriving at the host's coordinates.
     *
     * main.js cannot be imported under Node (it dereferences the DOM at module
     * scope), so the four statements that decide the level are LIFTED FROM THE
     * FILE and evaluated against the real `Run`. The lift refuses to run if any
     * of them stops matching, which is what stops this from decaying into a
     * regex that passes on a file it no longer describes. It is the strongest
     * thing available here and it is stronger than reading the text: the answer
     * below is computed by main.js's own arithmetic over the shipping ladder.
     */
    const raw = await src('main.js');
    const lift = (re, what) => {
      const m = raw.match(re);
      assert(m, `main.js no longer contains ${what}, so this check is describing a file that is gone`);
      return m[0];
    };
    const stSessionOr = lift(/const sessionOr = \(key\) => [^\n]*;/, 'sessionOr');
    lift(/function deploy\(run = startRun\(\)\)/, "deploy's default-argument signature");
    lift(/if \(sessionOr\('mode'\) !== 'gauntlet'\) return null;/, "startRun's gauntlet gate");
    const stLevelKey = lift(/const levelKey = [^\n]*;/, "deploy's levelKey line");
    const stDeployCall = lift(/deploy\((null)?\);\s*\}\);/, "the start handler's deploy call");

    const { Run, DESCENT } = await import('../../src/game/Run.js');
    const settings = { level: 'mustafar', difficulty: 'knight', mode: 'roguelite', order: 'jedi', species: 'human' };
    let session = null;
    // eslint-disable-next-line no-eval
    const sessionOr = eval(`(${stSessionOr.replace('const sessionOr = ', '').replace(/;\s*$/, '')})`);
    const startRun = () => (sessionOr('mode') !== 'gauntlet'
      ? null : new Run({ identity: {}, mode: 'spire' }));
    // `deploy(null)` and `deploy()` are not the same call: a default parameter
    // fires on `undefined` only, so an explicit null is what makes levelKey
    // fall through to the level the host actually sent.
    const passesNull = /deploy\(null\)/.test(stDeployCall);
    const buildFor = (msg) => {
      session = { level: msg.level, difficulty: msg.difficulty, mode: msg.mode };
      const run = passesNull ? null : startRun();
      // eslint-disable-next-line no-eval
      return eval(`(() => { ${stLevelKey} return levelKey; })()`);
    };

    const host = new Run({ identity: {}, mode: 'spire' });
    assert(DESCENT.length >= 4, `the Descent is ${DESCENT.length} rungs long — this check is calibrated on four`);
    const wrong = [];
    for (let rung = 0; rung < 4; rung++) {
      const sent = host.rung.level;
      const built = buildFor({ level: sent, difficulty: 'knight', mode: 'gauntlet' });
      if (built !== sent) wrong.push(`rung ${rung}: host '${sent}' → client '${built}'`);
      host.ascend();
    }
    assert(!wrong.length,
      `${wrong.length} of 4 rungs of a co-op Descent put the joining player in a different level from `
      + `the host — ${wrong.join('; ')}. The level is not on the wire anywhere else, and applySnapshot `
      + 'writes the host\'s absolute coordinates into whatever terrain the client happens to have.');
    // …and every other mode was always fine, because startRun returns null there.
    assert(buildFor({ level: 'kamino', difficulty: 'knight', mode: 'waves' }) === 'kamino',
      'a co-op client no longer follows the host outside the gauntlet either');
    return 'a start from any state redeploys into the level the host is standing in — 4 of 4 rungs of '
      + 'the Descent, and every other mode';
  });

  /* ══ the buffer, and the shape World assumes ═══════════════════════════ */

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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const i = net.indexOf('function peerOptions');
    assert(i > 0, 'peerOptions is gone');
    assert(/iceServers/.test(net.slice(i, i + 700)), 'no ICE servers configured — direct connections only');
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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const i = main.indexOf("net.on('peer-left'");
    assert(i > 0, 'the peer-left handler is gone');
    const body = main.slice(i, i + 900);
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

    const { world } = await H.bootWorld({ level: 'arena' });
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
