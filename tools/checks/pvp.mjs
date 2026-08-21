/**
 * FREE DUELS WITH FRIENDS — src/game/Player.js, src/net/Net.js.
 *
 * The owner asked for this twice and never got it: "Co-op everywhere, including
 * training. Free duels with friends: choose rounds, health, boons. Friend's
 * chosen character must work." (note 39), and "Teamwork abilities and build
 * synergies — healer, tank, etc." (note 63).
 *
 * WHAT WAS THERE. `MODES.duel` is a wave of `acolyte` archetypes and its blurb
 * says so — "Acolytes only. No blasters, no crowd." — with the player alone in
 * it. `Player.team` was the literal 0 written once in a constructor;
 * `RemoteAvatar.team` was the literal 0 written once and read by nothing at
 * all. There was no round, no health setting, no boon switch, and no path by
 * which one player's blade could reach another player's body.
 *
 * MEASURED BEFORE ANY OF IT, on two real Players in one real arena — every
 * number below is reproduced by the first check in this file, which builds the
 * same scene and asserts the fixed version of each:
 *
 *      blade swept through a chest, 180 frames    0.0 damage, 0 target records
 *      force push, point blank                    victim velocity 0.000 m/s
 *      force lightning at 1.2 m                   100 hp → 100 hp
 *      ally.damage(25, point, ally, 'saber')      LANDED, for 21.2
 *
 * That last line is the one worth staring at. "Friendly fire is off in co-op"
 * was not a rule anybody had written; it was the absence of a path that could
 * deliver it, which is the same thing right up until the day one exists. The
 * first thing this lane built was the path.
 *
 * WHAT THESE DRIVE. Real Worlds, real Players, the shipped `BladeContactSolver`
 * fed by the shipped `bladeTargets`, and — for the wire — two live `Net`
 * endpoints over tools/checks/_coop.mjs's PeerJS stub. Nothing here
 * re-implements a rule in order to test it: where a check needs a number the
 * game computes, it calls the game.
 *
 * WHAT IS NOT DRIVEN, said plainly. Three seams live in files this lane does not
 * own and are covered by inspection plus a handover with the exact edit:
 * `World._resolveBlades` adding opposing players to its target list,
 * `World._applyBladeEvent` turning a cut on a player into damage, and
 * `World._boltHitTest`'s `bolt.team !== 0`. The mechanism each of them needs is
 * built and driven here; the call site is three lines in World.js.
 *
 * Every module is reached by `await import` inside a check body — Player.js
 * reaches Engine.js through Saber/Cloth, and Engine rewrites three's
 * ShaderChunks behind once-only flags. A static edge from a check patches the
 * copy of three that verify.mjs's own static graph resolved. See
 * tools/checks/materials.mjs.
 */
import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';

const src = (rel) => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Two players, standing in front of each other, on whatever sides you say.
 *
 * The bodies are stepped for real before anything is measured, because
 * `capsules()` walks a POSED rig: a Player whose animator has never run has
 * every bone stacked at the origin, and a check that skipped this would be
 * measuring a pile rather than a person.
 */
/* `level` is left UNSET so `bootWorld` supplies the roster-derived default.
 * It used to read `level = 'arena'` — a level the cull deleted — which
 * `World.loadLevel` silently substituted, so this suite has been measuring
 * somewhere it did not name. roster.mjs was blind to it until a seventh form
 * was added for destructuring defaults; this is the instance that found. */
async function twoPlayers({ rules = null, sides = null, gap = 1.1, level = undefined } = {}) {
  const H = await import('./_coop.mjs');
  const P = await import('../../src/game/Player.js');
  const { world } = await H.bootWorld(level ? { level } : {});
  if (rules) world.rules = rules;
  const S = sides || [P.SIDES[0], P.SIDES[0]];
  const a = world.player;
  a.team = S[0];
  const b = world.spawnPlayer({ name: 'RIVAL', isLocal: false, team: S[1] });
  H.run(world, 0.4);
  b.position.copy(a.position).setX(a.position.x + gap);
  H.run(world, 0.4);
  return { world, a, b, P, H };
}

/** Sweep `holder`'s blade through `victim`'s chest and count what the solver says. */
async function swing(holder, victim, world, P, frames = 240) {
  const THREE = await import('three');
  const { BladeContactSolver } = await import('../../src/game/Combat.js');
  const solver = new BladeContactSolver();
  const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1), hilt = new THREE.Vector3();
  const out = { records: 0, contact: 0, cut: 0, grind: 0, bones: new Set() };
  const H = await import('./_coop.mjs');
  for (let i = 0; i < frames; i++) {
    world.update(1 / 60, H.idleInput());
    const chest = victim.capsules().find((c) => c.name === 'chest');
    if (!chest) continue;
    // Placed off the shipped capsule rather than off a number typed here, so a
    // change to where a chest is cannot leave this check swinging at air and
    // still calling itself green.
    hilt.set(chest.p0.x - 0.75, chest.p0.y, chest.p0.z);
    q.setFromAxisAngle(axis, Math.sin((i / 60) * 12) * 1.35 - Math.PI / 2);
    holder.saber.setHiltPose(hilt, q);
    holder.saber.update(1 / 60, world.time);
    const targets = P.bladeTargets(holder, world.players, world.rules);
    out.records += targets.length;
    const evs = solver.solve(holder.saber, targets, 1 / 60);
    if (evs.length) out.contact++;
    for (const ev of evs) {
      if (ev.type === 'cut') { out.cut++; out.bones.add(ev.bone); }
      else if (ev.type === 'grind') out.grind++;
    }
  }
  return out;
}

/** A host and one client, both open, over the shared broker stub. */
async function session(names = ['HOST', 'ALPHA'], looks = []) {
  const H = await import('./_coop.mjs');
  const { Net } = await import('../../src/net/Net.js');
  const fake = H.installPeerStub();
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 0)); fake.flush(); } };
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
  return { host, clients, fake, settle, close: () => fake.restore() };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  /* ══ the gap, reproduced ═══════════════════════════════════════════════ */

  check('pvp: a player can hurt a player, which nothing in the game could do', async () => {
    /**
     * THE HEADLINE, AND THE FOUR MEASUREMENTS IT REPLACES.
     *
     * Every number in the file header was taken in this scene. This check takes
     * them again and asserts the fixed value, so it is red on any build where
     * the gap comes back — the whole point of a check written against a
     * measurement rather than against an implementation.
     *
     * Both halves are here on purpose. A duel where the blade lands is half the
     * feature; the other half is that turning friendly fire on for a duel did
     * not turn it on for the co-op session running in the next tab.
     *
     * WHAT THIS SCENE IS AND IS NOT. It is two `Player`s in ONE World, and a
     * real duel never has that: the two fighters are on two machines and each
     * one is a `RemoteAvatar` on the other's. Everything measured here is
     * genuinely shared — `bladeTargets`, `canHarm`, `_foes`, the powers
     * themselves — but "push 7.0 m/s" is a velocity written straight onto a
     * body in the same address space, and for the whole life of this suite that
     * number was read as though it said something about a duel. It did not:
     * over the wire the same push moved the other player 0.000 m, because
     * `RemoteAvatar.applyKnockback` added the impulse to a velocity the
     * interpolation buffer overwrites and sent nothing but a bare number. The
     * check below this one is the one that measures the wire, and this one is
     * the one that measures the rule.
     */
    const P = await import('../../src/game/Player.js');
    const duel = P.pvpRules({ pvp: true, duelRounds: 3, duelHealth: 150 });
    const { world, a, b } = await twoPlayers({ rules: duel, sides: [P.SIDES[0], P.SIDES[1]] });
    assert(a.team !== b.team, `both fighters are on side ${a.team} — Player.team is hard-wired again`);

    const ctx = { enemies: world.enemies, players: world.players, bolts: world.bolts,
      physics: world.physics, terrain: world.terrain, particles: world.particles };

    // 1 — the blade. Measured at 0 damage and 0 target records before this lane.
    const hit = await swing(a, b, world, P);
    assert(hit.records > 0, 'the blade still cannot see another player as a body at all');
    assert(hit.cut > 0,
      `${hit.records} target records and ${hit.contact} frames of contact produced ${hit.cut} cuts — `
      + 'a player\'s blade passes through a player');
    assert(hit.bones.size > 1, `every cut landed on ${[...hit.bones]} — the rig is not being walked`);

    /* …and the sweep really kills, which is the point of it and also why the
     * next step has to put the body back. `swing` holds a lit blade inside a
     * torso for four seconds; a rival who survived that would be the defect.
     * `alive` was the one field this restore forgot, and a dead body is
     * skipped by `hostileTo`, so every later step measured 0 and blamed the
     * power it was testing. */
    assert(!b.alive || b.hp < b.maxHp,
      'four seconds of blade inside a torso left the rival at full health');

    // 2 — force push. Measured at victim velocity 0.000 m/s before this lane.
    b.alive = true;
    b.velocity.set(0, 0, 0); b.invuln = 0; b.hp = b.maxHp;
    a.force = a.maxForce; a.cooldowns.push = 0;
    a.aimDir.subVectors(b.position, a.chest).normalize();
    a.forcePush(ctx);
    const shove = b.velocity.length();
    assert(shove > 1, `a point-blank force push moved the other player at ${shove.toFixed(3)} m/s`);
    assert(b.hp < b.maxHp, 'a force push into another player does no damage at all');

    /**
     * 3 — lightning. Measured at 100 hp → 100 hp before this lane.
     *
     * THIS STEP'S PREMISE EXPIRED AND THAT IS THE ONLY REASON IT IS EDITED.
     * `forceLightning` used to resolve in ONE CALL — press, gather, damage,
     * done — so a single call and an immediate assertion measured the whole
     * power. It is a CHANNEL now, because the player's own note is that it was
     * "nothing in the air": it opens, it holds, it bills per second and it
     * strikes on a tick. Opening it and reading the health on the same frame
     * therefore measures the opening and nothing else, and would report zero on
     * a perfectly working power.
     *
     * The property is unchanged and so is the number it is measured in: after a
     * second of channel aimed at another player, that player has lost health.
     * See tools/checks/lightning.mjs for the channel's own clock.
     */
    b.invuln = 0;
    const before = b.hp;
    a.force = a.maxForce = 4000; a.cooldowns.lightning = 0; a.boonMods.lightning = true;
    a.aimDir.subVectors(b.chest, a.chest).normalize();
    a.forceLightning(ctx);
    assert(a.channel?.kind === 'lightning', 'the lightning channel did not open at all');
    /* HELD: `act` is the level and `actHit` the edge, so a probe that only
     * pressed would close the channel on the very next frame. */
    const H2 = await import('./_coop.mjs');
    const held = { ...H2.idleInput(), act: (k) => k === 'lightning', actHit: () => false };
    for (let i = 0; i < 60 && a.channel; i++) {
      b.invuln = 0;
      world.update(1 / 60, held);
    }
    assert(b.hp < before, `force lightning at ${a.chest.distanceTo(b.chest).toFixed(1)} m took `
      + `${before.toFixed(1)} hp to ${b.hp.toFixed(1)} — the power cannot see a player`);

    const line = `one machine: blade ${hit.cut} cuts over ${hit.contact} contact frames on ${hit.bones.size} bones, `
      + `push ${shove.toFixed(1)} m/s, lightning −${(before - b.hp).toFixed(0)} hp`;
    world.unload();
    return line;
  });

  check('pvp: a Force push moves the player it was aimed at, on both machines', async () => {
    /**
     * THE HALF THE CHECK ABOVE CANNOT SEE, AND IT WAS THE BROKEN ONE.
     *
     * A duel is two machines. `RemoteAvatar.applyKnockback` — the call every
     * force power ends in when the target is another player — added the impulse
     * to a velocity `update()` overwrites from the interpolation buffer on the
     * next frame, and the only packet it ever emitted was `{t:'hit', d, k}`: an
     * amount and a word. There was no direction on that wire. Measured on a real
     * host/client pair, host pushing the peer point blank, before the field
     * existed:
     *
     *     guest's own body      0.000 m        host's drawing of them  0.000 m
     *     guest's health        100.0 → 97.5   (the damage crossed on its own)
     *
     * A duel in which the Force is a damage-over-distance number and nothing
     * else. Worse for a pull, which `Enemy._castPower` bills at zero damage:
     * `damage()` opens with `amount > 0`, so a peer being dragged across the
     * field received no packet at all.
     *
     * THE CONTROL IS THE SAME BODY, IN THE SAME PLACE, HIT BY THE SAME VECTOR.
     * Two earlier versions of it were not, and each was wrong by more than the
     * thing being measured. A second `forcePush` in a second world stood its
     * bodies 2.22 m apart against the pair's 2.49 m, and the shove scales with
     * range — 25% of the answer, from the scene. Replaying the captured impulse
     * against a different rival in a different world removed that and left the
     * ground: where a shoved body lands decides how far it travelled, and two
     * worlds are two hillsides — 13%.
     *
     * So the guest is pushed over the wire, put back exactly as it was, and hit
     * with the identical vector by a direct call. Same terrain, same pool, same
     * body. Whatever is left between the two numbers is the wire, which is the
     * only thing this check is about.
     */
    const P = await import('../../src/game/Player.js');
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const duel = P.pvpRules({ pvp: true, duelRounds: 3, duelHealth: 150 });

    // ── over the wire: a real push, at a real RemoteAvatar
    const { host, client, pump, seen } = await H.bootPair({ sides: [P.SIDES[0], P.SIDES[1]] });
    host.rules = duel; client.rules = duel;
    pump(0.6);
    const hp = host.player, cp = client.player;
    cp.position.copy(hp.position).setZ(hp.position.z + 2);
    pump(0.4);
    const drawn = host.remotes.get('PEER');
    assert(drawn, 'the host has no body for the peer at all — no packet crossed');
    /* What the power handed the avatar, before anything about it was put on a
     * wire. The bar below is this vector, so the two measurements differ by the
     * wire and by nothing else. */
    let thrown = null, thrownD = 0;
    const knock = drawn.applyKnockback.bind(drawn);
    drawn.applyKnockback = (i, d, s, g) => {
      thrown = i ? i.clone() : null; thrownD = d || 0;
      return knock(i, d, s, g);
    };
    cp.invuln = 0;
    const guestFrom = cp.position.clone(), drawnFrom = drawn.position.clone();
    const hp0 = cp.hp;
    /** Everything about the victim that the blow is about to move. */
    const state = () => ({ p: cp.position.clone(), v: cp.velocity.clone(), hp: cp.hp,
      force: cp.force, invuln: cp.invuln, stagger: cp.staggerTimer, grounded: cp.grounded });
    const restore = (s) => {
      cp.position.copy(s.p); cp.velocity.copy(s.v); cp.hp = s.hp;
      cp.force = s.force; cp.invuln = s.invuln; cp.staggerTimer = s.stagger; cp.grounded = s.grounded;
    };
    const at0 = state();
    hp.force = hp.maxForce; hp.cooldowns.push = 0;
    hp.aimDir.subVectors(drawn.position, hp.chest).normalize();
    /**
     * THE WINDOW, AND IT IS WHY THIS CHECK WAS RED.
     *
     * `seen.toClient` is everything the host has ever broadcast, from
     * `bootPair` onward, and the packet count below was filtering ALL of it —
     * so "one hit packet for one push" was really "one hit packet in the whole
     * session". It is not the wire that is wrong and it never was: the two
     * duellists are standing 2 m apart under `pvp` rules through `pump(0.6)`
     * and `pump(0.4)` of setup, their blades graze, and every graze is a
     * legitimate `{t:'hit', k:'saber'}` on the wire. Measured: 23 packets, of
     * which ONE is `k:'force'` at d=7.175 with an impulse on it and 22 are
     * `k:'saber'` at d=0.002-0.012.
     *
     * The count was the loud half; the quiet half is worse and is the real
     * reason this is a mark rather than a looser bound. `packets[0]` was
     * whichever packet happened to be FIRST in the session — a 0.002 hp blade
     * graze — so the three assertions under it were reading a saber packet
     * while claiming to prove that the push's impulse, direction and source
     * cross the wire. A bound of `>= 1` would have left all three of them
     * measuring the wrong packet forever.
     */
    const mark = seen.toClient.length;
    hp.forcePush({ enemies: host.enemies, players: host.players, bolts: host.bolts,
      physics: host.physics, terrain: host.terrain, particles: host.particles });
    let guestPeak = 0, drawnPeak = 0;
    for (let i = 0; i < 180; i++) {
      pump(1 / 60);
      guestPeak = Math.max(guestPeak, guestFrom.distanceTo(cp.position));
      drawnPeak = Math.max(drawnPeak, drawnFrom.distanceTo(drawn.position));
    }
    assert(thrown, 'the push never reached the avatar at all — _foes does not see a remote player');
    const packets = seen.toClient.slice(mark).filter((m) => m.t === 'hit');
    assert(packets.length === 1,
      `${packets.length} hit packets after the push, out of `
      + `${seen.toClient.filter((m) => m.t === 'hit').length} in the session — one shove is one packet, `
      + 'and the packet the assertions below read has to be that shove');
    assert(Array.isArray(packets[0].v),
      'the hit packet carries no impulse — a duel\'s Force is a number with no direction again');
    assert(packets[0].s, 'the hit packet names nobody as its source');
    const carried = new THREE.Vector3(...packets[0].v);
    assert(carried.distanceTo(thrown) < 0.01,
      `the power threw ${thrown.toArray().map((v) => v.toFixed(2))} and the packet carries `
      + `${packets[0].v} — the wire is not sending the shove that was thrown`);

    // ── the control: put the same body back and hit it by hand
    const wireHp = cp.hp;
    restore(at0);
    const soloFrom = cp.position.clone();
    // The same attacker the wire named, so `canHarm` and `resistForce` are
    // asked the identical question on both runs.
    cp.applyKnockback(thrown.clone(), thrownD, client.remotes.get('HOST') || null, false);
    let soloPeak = 0;
    for (let i = 0; i < 180; i++) {
      pump(1 / 60);
      soloPeak = Math.max(soloPeak, soloFrom.distanceTo(cp.position));
    }
    assert(soloPeak > 0.2, `the same impulse moved the same body ${soloPeak.toFixed(3)} m by a direct `
      + 'call — the control is wrong, not the wire');

    assert(guestPeak > 0.2,
      `the player who was pushed moved ${guestPeak.toFixed(3)} m on their OWN machine, where the same `
      + `impulse moves the same body ${soloPeak.toFixed(3)} m by a direct call — the shove did not cross`);
    assert(Math.abs(guestPeak - soloPeak) < soloPeak * 0.02,
      `the wire's push moved them ${guestPeak.toFixed(3)} m against ${soloPeak.toFixed(3)} m for the `
      + 'identical impulse on the identical body — the blow changes size when it crosses');
    /* …and the machine that threw it SEES it, which is the other half of a duel
     * being legible. The host's copy is drawn from the peer's own avatar
     * stream, so it can only move if the peer's real body did. */
    assert(drawnPeak > 0.2,
      `the shover's own screen showed the body it pushed moving ${drawnPeak.toFixed(3)} m`);
    assert(wireHp < hp0, 'the push did no damage at all');
    return `push: the same impulse moves the same body ${soloPeak.toFixed(2)} m by hand and `
      + `${guestPeak.toFixed(2)} m over the wire, ${drawnPeak.toFixed(2)} m on the shover's screen, `
      + `\u2212${(hp0 - wireHp).toFixed(1)} hp, and exactly one hit packet after the shove out of `
      + `${seen.toClient.filter((m) => m.t === 'hit').length} in the session, carrying the impulse `
      + 'and a source';
  });

  check('pvp: a duel can be turned on from the settings blob the menu writes', async () => {
    /**
     * THE CLAUSE THAT WOULD HAVE CAUGHT IT, AND WHAT "IT" WAS.
     *
     * Everything in this file was green while the feature was unreachable.
     * `pvpRules` read `settings.pvp`, `World`'s constructor called it on the
     * settings blob, `canHarm` gated every damage path on the result, and
     * `DuelMatch` ran to a winner — and the ONLY writer of `settings.pvp` in
     * the whole tree was `World`'s Command-meeting branch, which passes a
     * literal `{pvp: true, duelRounds: 1}` of its own. There was no key in
     * `DEFAULT_SETTINGS`, so there was no control, and there could be no
     * control: `tools/checks/controls.mjs`'s two dead-control guards both
     * iterate `Object.keys(DEFAULT_SETTINGS)`, so a setting that is read and
     * never declared is invisible to the pair of them. Two commanders could
     * duel and two friends standing in a level could not.
     *
     * Every check in this file measured the mechanism by CONSTRUCTING the
     * rules itself — `P.pvpRules({ pvp: true, … })`, thirteen times — which is
     * exactly right for asking whether the mechanism works and is exactly
     * blind to whether anything can reach it. This asks the other question,
     * and it asks it the same way: from the blob a menu actually writes.
     *
     * DERIVED, so it covers the next duel setting. Nothing below names `pvp`
     * as the key to look for — the keys are found by MOVING each one and
     * seeing which of them `pvpRules` answers differently, which is the same
     * question "does the front end reach the rules" without a second copy of
     * the answer sitting here to go stale.
     */
    const P = await import('../../src/game/Player.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const H = await import('./_coop.mjs');

    /* Somewhere else in the same type. A number is nudged rather than zeroed
     * because `pvpLimit` clamps, and a value outside the band would come back
     * as the same clamped answer and read as "nothing reads this". */
    const elsewhere = (v) => (typeof v === 'boolean' ? !v
      : typeof v === 'number' ? v + 1
        : typeof v === 'string' ? `${v}!` : v);
    const base = JSON.stringify(P.pvpRules(DEFAULT_SETTINGS));
    const movers = Object.keys(DEFAULT_SETTINGS).filter((k) =>
      JSON.stringify(P.pvpRules({ ...DEFAULT_SETTINGS, [k]: elsewhere(DEFAULT_SETTINGS[k]) })) !== base);
    assert(movers.length,
      'no key of DEFAULT_SETTINGS reaches `pvpRules` at all, so nothing a player can touch decides '
      + 'whether a session is a duel — the rules object every damage path in the game asks is '
      + 'unreachable from the front end');
    const switches = movers.filter((k) =>
      P.pvpRules({ ...DEFAULT_SETTINGS, [k]: elsewhere(DEFAULT_SETTINGS[k]) }).pvp === true);
    assert(switches.length,
      `${movers.length} setting(s) reach pvpRules (${movers.join(', ')}) and not one of them can turn `
      + '`pvp` ON — the duel rules are configurable and the duel is not');

    /* AND THE DERIVATION IS THE GAME'S. `friendlyFire` is not offered as its
     * own key on purpose — `pvpRules`' note says so — so the switch is asked
     * for rather than restated: whatever turns `pvp` on must turn it on too. */
    for (const k of switches) {
      const r = P.pvpRules({ ...DEFAULT_SETTINGS, [k]: elsewhere(DEFAULT_SETTINGS[k]) });
      assert(r.friendlyFire === true,
        `${k} turns pvp on and leaves friendlyFire ${r.friendlyFire} — a duel in which you cannot hit `
        + 'the other player');
    }

    /**
     * …AND THEN THE WORLD, because "pvpRules returns a different object" is a
     * statement about a pure function and this feature is a statement about a
     * blade. Two real Worlds off the same DEFAULT_SETTINGS with one key moved,
     * two real Players a metre apart in each, and the question put to the
     * shipped gate: how many of the other bodies may this blade find?
     */
    const stand = async (settings) => {
      const { world } = await H.bootWorld({ settings: { ...settings, quality: 'low' } });
      const a = world.player;
      const b = world.spawnPlayer({ name: 'RIVAL', isLocal: false });
      H.run(world, 0.4);
      b.position.copy(a.position).setX(a.position.x + 1.1);
      H.run(world, 0.4);
      const out = { rules: world.rules, targets: P.bladeTargets(a, world.players, world.rules).length,
        harm: P.canHarm(a, b, world.rules), maxHp: b.maxHp };
      world.unload();
      return out;
    };
    const key = switches[0];
    const off = await stand(DEFAULT_SETTINGS);
    const on = await stand({ ...DEFAULT_SETTINGS, [key]: elsewhere(DEFAULT_SETTINGS[key]) });
    assert(off.targets === 0 && off.harm === false,
      `with the shipped defaults one player's blade already finds ${off.targets} of the people they `
      + 'came with — co-op is not the default and this whole check is measuring the wrong direction');
    assert(on.targets === 1 && on.harm === true,
      `${key} moved and a blade still finds ${on.targets} rival(s) (canHarm ${on.harm}) — the setting `
      + 'reaches `world.rules` and `world.rules` reaches nothing');
    /* The duel's health is the other thing the rules decide about a BODY, and
     * `spawnPlayer` is where it lands. Asked of the rules rather than typed. */
    assert(on.maxHp === on.rules.health,
      `a duellist stood up with ${on.maxHp} hp under rules that say ${on.rules.health}`);
    return `${movers.length} of ${Object.keys(DEFAULT_SETTINGS).length} settings reach pvpRules, `
      + `${switches.length} can turn it on (${switches.join(', ')}); off → ${off.targets} blade `
      + `targets / canHarm ${off.harm}, on → ${on.targets} / ${on.harm} at ${on.maxHp} hp`;
  });

  check('pvp: none of that happens to an ally, and it is one gate that says so', async () => {
    /**
     * THE CONVERSE, AND IT WAS THE FAILING HALF.
     *
     * `ally.damage(25, point, ally, 'saber')` landed for 21.2 before this lane,
     * because not one caller in the game consulted a team before applying a
     * number. The identical scene as the check above, one field different —
     * `world.rules` — and everything has to stop.
     *
     * Driven through the SAME entry points rather than by asserting on
     * `canHarm` directly: a gate that is right in isolation and unwired is the
     * exact defect this replaces.
     */
    const P = await import('../../src/game/Player.js');
    const { world, a, b } = await twoPlayers({ rules: P.CO_OP_RULES });
    assert(a.team === b.team, 'the two co-op players are not on the same side');

    const ctx = { enemies: world.enemies, players: world.players, bolts: world.bolts,
      physics: world.physics, terrain: world.terrain, particles: world.particles };

    const direct = b.damage(25, b.chest, a, 'saber');
    assert(b.hp === b.maxHp,
      `an ally's explicit damage call took ${(b.maxHp - b.hp).toFixed(1)} hp off a friend`);
    assert(direct === false, 'an ally kill was reported');

    const hit = await swing(a, b, world, P, 120);
    assert(hit.records === 0 && hit.cut === 0,
      `an ally offered ${hit.records} blade target records and took ${hit.cut} cuts in co-op`);

    b.invuln = 0; b.velocity.set(0, 0, 0);
    a.force = a.maxForce; a.cooldowns.lightning = 0; a.boonMods.lightning = true;
    a.aimDir.subVectors(b.position, a.chest).normalize();
    a.forceLightning(ctx);
    assert(b.hp === b.maxHp, `lightning took ${(b.maxHp - b.hp).toFixed(1)} hp off an ally`);

    // …and the environment is still not on a side. `World.onExplosion` passes a
    // null source, and a wave-clear blast has always reached everyone.
    b.invuln = 0;
    b.damage(9, b.chest, null, 'explosion');
    assert(b.hp < b.maxHp, 'the gate also blocks unattributed damage — falls and blasts now heal you');

    const line = `ally: 0 cuts, 0 target records, 0 hp of lightning; a sourceless blast still lands`;
    world.unload();
    return line;
  });

  check('pvp: the friendly-fire rule is decided in one place, not per weapon', async () => {
    /**
     * The failure mode of a rule like this is never that it is wrong. It is
     * that it is right in four call sites and absent from the fifth, and the
     * fifth is the explosion at a wave clear that kills the friend who just
     * revived you.
     *
     * So: the truth table of the gate itself, and then a scan proving the sinks
     * go through it rather than each testing `team` by hand.
     */
    const P = await import('../../src/game/Player.js');
    const coop = P.CO_OP_RULES, duel = P.pvpRules({ pvp: true });
    const mk = (team) => ({ team, world: null });
    const ally = mk(P.SIDES[0]), me = mk(P.SIDES[0]), rival = mk(P.SIDES[1]), droid = mk(P.TEAM.HORDE);

    assert(P.canHarm(null, ally, coop), 'the environment cannot hurt anybody');
    assert(P.canHarm(me, me, coop), 'you can no longer deflect a bolt into your own feet');

    /**
     * THE GATE FAILS OPEN, and this assertion is here because the first version
     * of it did not. Anything that never declared a side — a prop, a
     * destruction fragment, a hazard, a check's stub — defaulted to the horde's
     * team, which made any two of them ALLIES and silently refused their
     * damage. `tools/checks/vitals.mjs` caught it inside the hour: a duellist
     * stub with no `team` hit a victim stub with no `team` for a lethal 23.8
     * and the victim lived on 20 hp.
     *
     * A gate whose wrong answer is invulnerability is worse than no gate. A hit
     * that does not land makes no sound.
     */
    const nameless = { world: null }, alsoNameless = { world: null };
    assert(P.canHarm(nameless, alsoNameless, coop),
      'two things that never declared a side were treated as allies — the gate fails CLOSED, '
      + 'which is silent invulnerability');
    assert(P.canHarm(nameless, ally, coop) && P.canHarm(ally, nameless, coop),
      'a sideless attacker or victim is gated — a prop, a hazard or a fragment now heals you');
    assert(P.canHarm(droid, ally, coop), 'the horde cannot hurt a player');
    assert(P.canHarm(ally, droid, coop), 'a player cannot hurt the horde');
    assert(!P.canHarm(me, ally, coop), 'friendly fire is on in co-op');
    assert(P.canHarm(me, rival, coop), 'a rival is unhittable even across sides');
    assert(P.canHarm(me, ally, duel), 'friendly fire is off inside a duel');

    // The one boolean, two consequences. Nothing may set them inconsistently.
    assert(duel.friendlyFire === duel.pvp && coop.friendlyFire === coop.pvp,
      'friendlyFire and pvp can be set to disagree — there are two switches again');

    // Every side handed out is a legal one, and never the horde's number.
    for (let i = -3; i < 9; i++) {
      assert(P.sideTeam(i) !== P.TEAM.HORDE, `sideTeam(${i}) put a player on the horde's team`);
      assert(P.SIDES.includes(P.sideTeam(i)), `sideTeam(${i}) = ${P.sideTeam(i)} is not a side`);
    }
    assert(P.asSide(P.TEAM.HORDE) === P.TEAM.PARTY && P.asSide(undefined) === P.TEAM.PARTY,
      'a bad team value survives into a body instead of landing it in co-op');

    /**
     * `hostileTo` — THE LIST EVERY POWER AND EVERY BRAIN ITERATES.
     *
     * Its own contract, because the damage sinks hide its mistakes: `_foes`
     * returning an ally is invisible while `Player.damage` refuses the hit
     * anyway, so the revert harness found both of these reverts silent. They
     * are not harmless. Dropping the self-skip makes `canHarm(me, me)` — which
     * is TRUE, so that a bolt you deflected into your own feet still hurts —
     * put the caster into their own target list, and force lightning
     * electrocutes the person casting it.
     */
    const horde = mk(P.TEAM.HORDE);
    const dead = { team: P.SIDES[1], world: null, dead: true };
    const downed = { team: P.SIDES[1], world: null, alive: false };
    const roomA = [me, ally, rival, horde, dead, downed];
    const inCoop = P.hostileTo(me, roomA, coop);
    assert(!inCoop.includes(me), 'you are in your own target list — every power now hits the caster');
    assert(!inCoop.includes(ally), 'an ally is a target in co-op');
    assert(inCoop.includes(rival) && inCoop.includes(horde), 'a rival or the horde is not a target');
    assert(!inCoop.includes(dead) && !inCoop.includes(downed),
      'a corpse and a downed body are still being fought');
    const inDuel = P.hostileTo(me, roomA, duel);
    assert(inDuel.includes(ally) && !inDuel.includes(me),
      'friendly fire does not reach the target list, or it reaches the caster');
    // `into` is what stops a power allocating three arrays per press.
    const shared = [];
    P.hostileTo(me, [rival], coop, shared);
    P.hostileTo(me, [horde], coop, shared);
    assert(shared.length === 2, `two lists filtered into one gave ${shared.length} entries`);

    // And the sinks consult it rather than each rolling their own.
    const player = strip(await src('game/Player.js'));
    const net = strip(await src('net/Net.js'));
    /**
     * FOUND BY THE FOUR PARAMETERS IT TAKES, not by the whole signature.
     *
     * This read `indexOf('\n  damage(amount, point, source, kind)')` — closing
     * bracket included — so the day a lane added a FIFTH parameter the index
     * came back −1, `slice(-1)` handed the test one character of the file, and
     * the check reported that Player.damage "no longer opens with the gate":
     * every source of harm in the game deciding friendly fire for itself, which
     * was not happening and never had. An instrument that restates a rule fails
     * in the direction nobody checks — it MANUFACTURES defects — and pinning an
     * argument list is restating a rule about a signature this check has no
     * opinion on. Four named parameters is the identity; what comes after them
     * is the callee's business.
     *
     * The miss is an assertion now rather than a silent slice, because that is
     * the half that cost the time: a check that cannot find its subject must
     * say so instead of measuring the last byte of the file.
     */
    const at = player.search(/\n {2}damage\(amount, point, source, kind\b/);
    assert(at > 0, 'Player.damage(amount, point, source, kind…) is not in Player.js under that name');
    const dmg = player.slice(at);
    assert(/canHarm\(source, this\)/.test(dmg.slice(0, 1200)),
      'Player.damage no longer opens with the gate, so every source of harm decides for itself again');
    assert(/canHarm\(source, this\)/.test(net),
      'RemoteAvatar.damage does not consult the gate — the one machine that can see both fighters');
    const gates = (player.match(/canHarm\(/g) || []).length + (net.match(/canHarm\(/g) || []).length;

    /**
     * NO BODY-AGAINST-BODY COMPARISON MAY BE WRITTEN BY HAND, anywhere in the
     * two files that own a `team`. Two kinds survive and both are fine:
     *
     *   bolt.team vs a body's — a BOLT's team is which way it is flying, and
     *     `Bolts.js` and `World._boltHitTest` have always owned that question;
     *     it is a different question from "may this thing harm that thing".
     *   enemy vs enemy — `forceCompel` picking which ally a turned droid fires
     *     on. That is grouping, not harm.
     *
     * A comparison of two PLAYER-shaped things is the one this forbids, because
     * that is the rule the gate exists to be the only holder of.
     */
    const suspect = [];
    for (const text of [player, net]) {
      for (const m of text.matchAll(/([A-Za-z_$][\w$.]*)\.team\s*(===|!==)\s*([A-Za-z_$][\w$.]*)\.team/g)) {
        const [, left, , right] = m;
        if (/bolt/i.test(left) || /bolt/i.test(right)) continue;      // a bolt's heading
        if (/^e$|enem/i.test(left) && /^(best|e)$|enem/i.test(right)) continue;  // enemy vs enemy
        suspect.push(m[0]);
      }
    }
    assert(!suspect.length,
      `a body-against-body team comparison was written by hand instead of asked for: ${suspect.join(', ')}`);

    // And neither damage sink may reason about a team itself.
    for (const [name, text] of [['Player.damage', dmg.slice(0, 1400)],
      ['RemoteAvatar.damage', net.slice(net.indexOf('  damage(amount, point, source, kind)'), net.indexOf('  heal() {}'))]]) {
      assert(!/\.team/.test(text), `${name} reads a team directly instead of asking the gate`);
    }
    return `truth table holds on ${P.SIDES.length} sides; ${gates} call sites, all through canHarm`;
  });

  /* ══ the match ═════════════════════════════════════════════════════════ */

  check('pvp: best-of-N rounds, with a round winner and a match winner', async () => {
    /**
     * There is no ROUND in this game. There is a wave, and a wave has no other
     * side — so every transition below is new, and every one of them is a way a
     * duel can fail to end. The match is driven a frame at a time through its
     * own `update`, with the standing counts a caller would pass; nothing here
     * reaches inside it to set a phase.
     */
    const { DuelMatch, pvpRules, SIDES, PVP_COUNTDOWN, PVP_INTERMISSION } =
      await import('../../src/game/Player.js');
    const rules = pvpRules({ pvp: true, duelRounds: 3, duelHealth: 150 });
    const A = SIDES[0], B = SIDES[1];
    const m = new DuelMatch(rules, [A, B]);

    assert(m.rounds === 3 && m.need === 2,
      `best of ${m.rounds} needs ${m.need} — the target is not derived from the count`);
    assert(m.health === 150, `the health setting did not reach the match (${m.health})`);
    assert(m.phase === 'countdown', 'a match opens mid-fight');

    const seen = [];
    const tick = (n, standing) => {
      for (let i = 0; i < n; i++) for (const e of m.update(1 / 60, standing)) seen.push(e.type);
    };
    const both = { [A]: 1, [B]: 1 };

    // Nobody may score during the countdown, even with a side already wiped.
    tick(Math.round((PVP_COUNTDOWN - 0.2) * 60), { [A]: 1, [B]: 0 });
    assert(m.phase === 'countdown', `the countdown ended early (${m.clock.toFixed(2)}s left)`);
    assert(!m.scores[A], 'a round was awarded before the fight started');

    tick(20, both);
    assert(m.phase === 'fighting' && seen.includes('fight'), 'the countdown never becomes a fight');
    assert(Math.abs(m.clock - rules.roundTime) < 0.4,
      `the round clock started at ${m.clock.toFixed(1)} instead of ${rules.roundTime}`);

    // A wins round 1.
    tick(1, { [A]: 1, [B]: 0 });
    assert(m.scores[A] === 1 && m.phase === 'round-over',
      `eliminating a side gave ${JSON.stringify(m.scores)} in phase ${m.phase}`);
    assert(m.winner === A, `the round went to ${m.winner}`);
    assert(!m.over, 'one round of a best-of-three ended the match');

    // Intermission → round 2.
    tick(Math.round(PVP_INTERMISSION * 60) + 2, both);
    assert(m.round === 2 && m.phase === 'countdown', `round ${m.round} in phase ${m.phase}`);
    tick(Math.round(PVP_COUNTDOWN * 60) + 2, both);

    // B takes round 2, so it is one apiece and still alive.
    tick(1, { [A]: 0, [B]: 1 });
    assert(m.scores[B] === 1 && !m.over, `${JSON.stringify(m.scores)} and over=${m.over}`);

    // Round 3, and A reaches the target.
    tick(Math.round((PVP_INTERMISSION + PVP_COUNTDOWN) * 60) + 4, both);
    assert(m.round === 3 && m.phase === 'fighting', `round ${m.round} phase ${m.phase}`);
    tick(1, { [A]: 1, [B]: 0 });
    assert(m.over, `A reached ${m.scores[A]} of ${m.need} and the match is still running`);
    assert(m.winner === A, `the match went to ${m.winner}`);
    assert(seen.includes('match-end'), 'nothing announced the match ending');
    assert(seen.filter((t) => t === 'round-begin').length === 2,
      `${seen.filter((t) => t === 'round-begin').length} rounds began after the first`);

    // A finished match is finished: no further tick may move it.
    const frozen = JSON.stringify([m.phase, m.round, m.scores, m.winner]);
    tick(600, both);
    assert(JSON.stringify([m.phase, m.round, m.scores, m.winner]) === frozen,
      'a decided match kept running');
    return `best of 3 → first to 2, ${seen.length} transitions, winner side ${m.winner}`;
  });

  check('pvp: a duel that nobody wins still ends', async () => {
    /**
     * THE TWO WAYS A MATCH FAILS TO TERMINATE, and both are reachable in normal
     * play. A mutual blade pass really does eliminate both fighters on the same
     * frame — that is a draw, and a draw that does not burn a round means two
     * evenly matched players duel forever. And a round in which neither is
     * killed is not a draw at all: one of them is at 12 hp and the other at 96,
     * and calling that level rewards whoever ran away.
     */
    const { DuelMatch, pvpRules, SIDES, PVP_COUNTDOWN, PVP_INTERMISSION } =
      await import('../../src/game/Player.js');
    const A = SIDES[0], B = SIDES[1];

    // Three mutual kills in a best-of-three: nobody reaches `need`, and it must
    // still stop — as a DRAW, not by inventing a winner.
    const drawn = new DuelMatch(pvpRules({ pvp: true, duelRounds: 3 }), [A, B]);
    let guard = 0;
    while (!drawn.over && guard++ < 60 * 600) {
      drawn.update(1 / 60, drawn.phase === 'fighting' ? { [A]: 0, [B]: 0 } : { [A]: 1, [B]: 1 });
    }
    assert(drawn.over, 'three mutual kills in a best-of-three never ended the match');
    assert(drawn.winner === null, `a drawn match was awarded to side ${drawn.winner}`);
    assert(drawn.scores[A] === 0 && drawn.scores[B] === 0,
      `a draw moved the score to ${JSON.stringify(drawn.scores)}`);
    const rounds = guard / 60;
    assert(rounds < 3 * (PVP_COUNTDOWN + PVP_INTERMISSION) + 5,
      `${rounds.toFixed(0)}s to play three roundless rounds — the clock is being waited out`);

    // A round nobody dies in is decided on remaining health when time runs out.
    const timed = new DuelMatch(pvpRules({ pvp: true, duelRounds: 1, duelRoundTime: 30 }), [A, B]);
    const both = { [A]: 1, [B]: 1 };
    for (let i = 0; i < 60 * 40 && !timed.over; i++) timed.update(1 / 60, both, { [A]: 96, [B]: 12 });
    assert(timed.over, 'a round in which nobody died ran forever');
    assert(timed.winner === A,
      `the timed-out round went to ${timed.winner}; A finished on 96 hp against 12`);

    // Level on health at the bell is a genuine draw, not a coin toss.
    const level = new DuelMatch(pvpRules({ pvp: true, duelRounds: 1, duelRoundTime: 30 }), [A, B]);
    for (let i = 0; i < 60 * 40 && !level.over; i++) level.update(1 / 60, both, { [A]: 50, [B]: 50 });
    assert(level.over && level.winner === null,
      `level on health at the bell gave the match to ${level.winner}`);

    /**
     * AND A MATCH DECIDED ON POINTS RATHER THAN ON THE TARGET.
     *
     * An EVEN `rounds` can be spent without either side reaching `need` — best
     * of 4 needs 3, and 2–1 with a draw in it never gets there. That match has
     * a clear winner and must be awarded to them, which is the only thing the
     * last-round branch of `_champion` does. Written after the revert harness
     * showed the check above passing with that branch deleted: without it a
     * 2–1 match is declared DRAWN, and the assertion that caught nothing was
     * one about how many SECONDS the match took.
     */
    const onPoints = new DuelMatch(pvpRules({ pvp: true, duelRounds: 4 }), [A, B]);
    const order = [{ [A]: 1, [B]: 0 }, { [A]: 0, [B]: 0 }, { [A]: 1, [B]: 0 }, { [A]: 0, [B]: 1 }];
    let round = 0, spin = 0;
    while (!onPoints.over && spin++ < 60 * 600) {
      round = onPoints.round;
      onPoints.update(1 / 60, onPoints.phase === 'fighting' ? order[round - 1] : both);
    }
    assert(onPoints.over, 'a best-of-four with a draw in it never ended');
    assert(onPoints.scores[A] === 2 && onPoints.scores[B] === 1,
      `the four rounds scored ${JSON.stringify(onPoints.scores)}, not 2–1`);
    assert(onPoints.winner === A,
      `a match that finished 2–1 without either side reaching ${onPoints.need} was awarded to `
      + `${onPoints.winner === null ? 'nobody' : `side ${onPoints.winner}`}`);

    return `mutual kills draw in ${rounds.toFixed(0)}s; a timed-out round goes to 96 hp over 12; `
      + `level is level; 2–1 of a best-of-four goes to the leader`;
  });

  check('pvp: the three settings the owner named are clamped, and boons are one of them', async () => {
    /**
     * "choose rounds, health, boons" — three settings, and a menu writes
     * free-form numbers. `pvpRules` is the one function allowed to decide what
     * they mean, the same shape `sandboxConfig` has and for the same reason.
     */
    const { pvpRules, PVP_LIMITS, DuelMatch, SIDES } = await import('../../src/game/Player.js');
    for (const [key, opt] of [['rounds', 'duelRounds'], ['health', 'duelHealth'], ['roundTime', 'duelRoundTime']]) {
      const spec = PVP_LIMITS[key];
      assert(pvpRules({ pvp: true })[key] === spec.def, `${key} has no default`);
      assert(pvpRules({ pvp: true, [opt]: -999 })[key] === spec.min, `${key} is not clamped below`);
      assert(pvpRules({ pvp: true, [opt]: 1e6 })[key] === spec.max, `${key} is not clamped above`);
      assert(pvpRules({ pvp: true, [opt]: NaN })[key] === spec.def, `${key} accepts NaN`);
      assert(pvpRules({ pvp: true, [opt]: 'seven' })[key] === spec.def, `${key} accepts a string`);
    }
    assert(pvpRules({ pvp: true }).boons === false, 'a duel hands out boons unless told not to');
    assert(pvpRules({ pvp: true, duelBoons: true }).boons === true, 'boons cannot be turned on');
    assert(new DuelMatch(pvpRules({ pvp: true, duelBoons: true }), SIDES.slice(0, 2)).boons === true,
      'the boon switch does not reach the match');

    // Every legal rounds value produces a coherent target, including the even
    // ones. Best of 4 is first to 3, not first to 2 and a half.
    for (let r = PVP_LIMITS.rounds.min; r <= PVP_LIMITS.rounds.max; r++) {
      const m = new DuelMatch(pvpRules({ pvp: true, duelRounds: r }), SIDES.slice(0, 2));
      assert(m.need === Math.floor(r / 2) + 1, `best of ${r} needs ${m.need}`);
      assert(m.need <= r, `best of ${r} needs ${m.need} rounds, which cannot be reached`);
      assert(m.need * 2 > r, `best of ${r} can be won by both sides at ${m.need} each`);
    }
    return `rounds ${PVP_LIMITS.rounds.min}–${PVP_LIMITS.rounds.max}, health `
      + `${PVP_LIMITS.health.min}–${PVP_LIMITS.health.max}, boons off by default`;
  });

  /* ══ the wire ══════════════════════════════════════════════════════════ */

  check('pvp: sides are handed out by the host and carried on the roster', async () => {
    /**
     * A side is IDENTITY for the length of a match, so it rides the roster
     * beside `name` and `look` rather than in the 24 Hz avatar packet — the same
     * argument LOOK_KEYS makes, and the same saving.
     *
     * The host is the only node allowed to assign one. Two machines that
     * disagreed about who is on whose side would disagree about who may hit
     * whom, which is the worst disagreement a networked rule can have.
     */
    const { assignSides, SIDES, TEAM } = await import('../../src/game/Player.js');
    const s = await session(['HOST', 'ALPHA']);
    const before = s.host.roster.map((r) => r.team);
    assert(before.every((t) => t === TEAM.PARTY),
      `a fresh session already has sides ${before} — co-op is not everyone on one team`);

    const map = assignSides(s.host.roster, 2);
    s.host.setSides(map);
    await s.settle();
    const hostRoster = s.host.roster;
    assert(hostRoster[0].team !== hostRoster[1].team,
      `the host handed both players side ${hostRoster[0].team}`);
    assert(hostRoster.every((r) => SIDES.includes(r.team)), 'a roster entry carries a non-side');

    // …and it reached the client through the roster it already receives.
    const seenByClient = s.clients[0].roster;
    assert(seenByClient.length === hostRoster.length, 'the client roster is a different length');
    for (const r of hostRoster) {
      const mine = seenByClient.find((x) => x.id === r.id);
      assert(mine && mine.team === r.team,
        `the client thinks ${r.name} is on side ${mine && mine.team}, the host says ${r.team}`);
    }

    /**
     * A CLIENT CANNOT ASSIGN SIDES TO ITSELF.
     *
     * Asserted on the WHOLE roster rather than on one entry, and written that
     * way after the revert harness showed the one-entry version passing with
     * the guard deleted: a client running `_refreshRoster` rebuilds the list
     * from its own `conns`, which is empty, so the roster collapsed to a single
     * self-entry marked `host: true` — and `roster.find(r => r.host).team`
     * happily read the thief's own side, which happened to be the number it was
     * being compared against. The roster is one object; compare all of it.
     */
    const before2 = JSON.stringify(seenByClient.map((r) => [r.id, r.team, r.host]));
    const stolen = new Map(seenByClient.map((r) => [r.id, SIDES[0]]));
    s.clients[0].setSides(stolen);
    await s.settle();
    const after = JSON.stringify(s.clients[0].roster.map((r) => [r.id, r.team, r.host]));
    assert(after === before2,
      `a client rewrote the side assignment: ${before2} became ${after} — a peer can put itself on `
      + 'your team and stop your blade');

    // Deterministic: the same roster must give the same answer on both machines.
    const again = assignSides(seenByClient, 2);
    for (const [id, side] of map) assert(again.get(id) === side, `assignSides is not deterministic for ${id}`);

    // Free-for-all gives everyone their own number.
    const ffa = assignSides([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], 0);
    assert(new Set(ffa.values()).size === 4, 'a four-way free-for-all put two players on one side');

    const line = `host assigned ${[...map.values()]}; the client agrees; a client cannot reassign`;
    s.close();
    return line;
  });

  check('pvp: the duel record crosses the wire off one field list', async () => {
    /**
     * THE THIRTEEN-SLOT PACKER AGAINST THE TWELVE-SLOT READER, which this
     * repository has already shipped once. `DuelMatch.WIRE` is the list, it
     * lives with the class it describes, and `packMatch` and `readMatch` both
     * loop it — so there is no way to add a field to one end only.
     *
     * The test data comes from the packer too: a hand-written `{ t: 'match',
     * phase: … }` here would be the seventh copied table of this session.
     */
    const { DuelMatch, pvpRules, SIDES } = await import('../../src/game/Player.js');
    const { packMatch, readMatch } = await import('../../src/net/Net.js');

    const m = new DuelMatch(pvpRules({ pvp: true, duelRounds: 5, duelHealth: 220, duelBoons: true }),
      [SIDES[0], SIDES[1]]);
    m.update(1 / 60, { [SIDES[0]]: 1, [SIDES[1]]: 1 });
    m.endRound(SIDES[1]);

    const wire = packMatch(m);
    assert(wire.t === 'match', 'the record is not routable');
    for (const k of DuelMatch.WIRE) {
      assert(wire[k] !== undefined, `packMatch drops ${k}, which DuelMatch.WIRE says it carries`);
    }
    // Through JSON, because a DataConnection serialises and nobody is handed
    // the sender's live objects.
    const far = readMatch(JSON.parse(JSON.stringify(wire)));
    for (const k of DuelMatch.WIRE) {
      assert(JSON.stringify(far[k]) === JSON.stringify(m[k]),
        `${k} arrived as ${JSON.stringify(far[k])}, sent as ${JSON.stringify(m[k])}`);
    }

    // A client applies it and agrees about the state of the match without ever
    // having simulated a body.
    const mirror = new DuelMatch(pvpRules({ pvp: true }), [SIDES[0], SIDES[1]]);
    mirror.apply(far);
    for (const k of DuelMatch.WIRE) {
      assert(JSON.stringify(mirror[k]) === JSON.stringify(m[k]), `apply() ignored ${k}`);
    }
    assert(mirror.scores[SIDES[1]] === 1, 'the client does not know who won the round');

    // The reader has no hand-typed list of its own.
    const net = strip(await src('net/Net.js'));
    for (const fn of ['export function packMatch', 'export function readMatch']) {
      const i = net.indexOf(fn);
      assert(i > 0, `${fn} is gone`);
      const body = net.slice(i, net.indexOf('\n}', i));
      assert(/DuelMatch\.WIRE/.test(body), `${fn} does not read the field list — it has its own copy`);
    }
    const line = `${DuelMatch.WIRE.length} fields, one list, ${JSON.stringify(wire).length} bytes on the wire`;
    return line;
  });

  check('pvp: a client cannot score its own rounds', async () => {
    /**
     * A round ends when a side has nobody standing, and the only node that can
     * see every body is the host — a client knows its own health for certain and
     * everybody else's as of 90 ms ago. A client that scored its own rounds
     * would award itself one every time a packet was late.
     */
    const s = await session(['HOST', 'ALPHA']);
    const { DuelMatch, pvpRules, SIDES } = await import('../../src/game/Player.js');
    const { packMatch } = await import('../../src/net/Net.js');

    const heardByClient = [];
    const heardByHost = [];
    s.clients[0].on('match', (rec) => heardByClient.push(rec));
    s.host.on('match', (rec) => heardByHost.push(rec));

    const m = new DuelMatch(pvpRules({ pvp: true }), [SIDES[0], SIDES[1]]);
    m.endRound(SIDES[0]);
    s.host.broadcast(packMatch(m));
    await s.settle();
    assert(heardByClient.length === 1, `the client heard ${heardByClient.length} match records`);
    assert(heardByClient[0].scores[SIDES[0]] === 1, 'the record arrived without its score');

    // The other direction is refused rather than trusted.
    const forged = new DuelMatch(pvpRules({ pvp: true }), [SIDES[0], SIDES[1]]);
    forged.endRound(SIDES[1]); forged.endRound(SIDES[1]);
    s.clients[0].toHost(packMatch(forged));
    await s.settle();
    assert(heardByHost.length === 0,
      'the host acted on a match record a client sent it — a peer can declare itself the winner');
    const line = `host → client 1 record; client → host refused`;
    s.close();
    return line;
  });

  /* ══ the friend's chosen character, in a duel ═══════════════════════════ */

  check('pvp: the friend you are duelling is the Jedi they built', async () => {
    /**
     * The owner's own sentence: "Friend's chosen character must work." Ten
     * appearance fields cross on the roster (LOOK_KEYS) and co-op already checks
     * that they reach a RemoteAvatar. A DUEL asks two more things of them, and
     * neither was ever true before this lane:
     *
     *   · that the sheet survives ALONGSIDE a side — the roster grew a `team`
     *     field, and a roster entry that carried a side but lost a species
     *     would be a rival who is the right colour and the wrong person;
     *   · that the body it builds is a body a blade can find, at the size the
     *     species actually is. A small-folk Jedi whose capsules came back at
     *     human height would be unhittable where they are drawn and hittable
     *     where they are not, which is worse than not working.
     *
     * `LOOK_KEYS` is looped rather than listed — the packer is the authority on
     * what crosses, and a hand-typed list here would be a copy that goes stale
     * the day an eleventh field is added.
     */
    const H = await import('./_coop.mjs');
    const { RemoteAvatar, packLook, LOOK_KEYS } = await import('../../src/net/Net.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { SIDES, TEAM, canHarm, pvpRules, CO_OP_RULES } = await import('../../src/game/Player.js');

    const built = { ...DEFAULT_SETTINGS, colorIndex: 5, hiltStyle: 'Crossguard', bladeLength: 1.42,
      coreWidth: 1.4, robeIndex: 4, species: 'smallfolk', skinIndex: 3, hairIndex: 4, build: 0.15 };
    const look = packLook(built);
    const s = await session(['HOST', 'ALPHA'], [null, look]);
    s.host.setSides(new Map([[s.host.roster[0].id, SIDES[0]], [s.host.roster[1].id, SIDES[1]]]));
    await s.settle();

    const entry = s.clients[0].roster.find((r) => r.name === 'ALPHA');
    assert(entry, 'the joining player is not on the roster the client received');
    assert(entry.team === SIDES[1], `the rival arrived on side ${entry.team}`);
    for (const k of LOOK_KEYS) {
      if (built[k] === undefined) continue;
      // JSON, not `===`: `face` is an object, and the wire serialises — an
      // identity comparison here would fail for the one field that proves the
      // sheet survived a round trip rather than being handed over by reference.
      assert(entry.look && JSON.stringify(entry.look[k]) === JSON.stringify(built[k]),
        `${k} did not survive onto a roster that now also carries a side: `
        + `${JSON.stringify(entry.look && entry.look[k])} instead of ${JSON.stringify(built[k])}`);
    }

    const { world } = await H.bootWorld({ level: 'colosseum' });
    world.rules = pvpRules({ pvp: true });
    const rival = new RemoteAvatar(world, { id: entry.id, name: entry.name, look: entry.look, team: entry.team });
    const plain = new RemoteAvatar(world, { id: 'X', name: 'X', look: null });

    assert(rival.team === SIDES[1], `the avatar was built on side ${rival.team}`);
    assert(plain.team === TEAM.PARTY, 'an avatar with no side stated is not in co-op');
    assert(canHarm(world.player, rival, world.rules), 'the rival is on your side inside a duel');
    // The side the friend was ASSIGNED is what makes them a rival, and an
    // avatar built with none is still your ally in a co-op session — which is
    // the safe direction for the field to fail in.
    assert(!canHarm(world.player, plain, CO_OP_RULES),
      'a body that never declared a side is hittable by its own party');
    assert(canHarm(world.player, rival, CO_OP_RULES),
      'a rival stops being a rival the moment the session rules are read wrong');

    assert(Math.abs(rival.saber.bladeLength - built.bladeLength) < 1e-6,
      `the rival's blade is ${rival.saber.bladeLength} long; they built ${built.bladeLength}`);
    assert(rival.saber.color.getHex() !== plain.saber.color.getHex(),
      'the rival\'s blade colour is not the one they chose');
    assert(Math.abs((rival.rig.scale ?? 1) - (plain.rig.scale ?? 1)) > 1e-6,
      'a small-folk rival arrives at human height — the species never crossed');

    // And the body a blade meets is THEIR body, at THEIR size.
    H.run(world, 0.3);
    rival.position.copy(world.player.position).setX(world.player.position.x + 1);
    plain.position.copy(rival.position);
    rival.update(1 / 60, { terrain: world.terrain, camera: world.engine.camera, time: 0 });
    plain.update(1 / 60, { terrain: world.terrain, camera: world.engine.camera, time: 0 });
    const caps = rival.capsules(), plainCaps = plain.capsules();
    assert(caps.length > 10, `a remote body offers ${caps.length} capsules — a blade cannot find it`);
    const top = (cs) => Math.max(...cs.map((c) => Math.max(c.p0.y, c.p1.y)));
    const height = top(caps) - rival.position.y, plainHeight = top(plainCaps) - plain.position.y;
    assert(height < plainHeight - 0.15,
      `the small-folk rival's capsules stand ${height.toFixed(2)} m against a human's `
      + `${plainHeight.toFixed(2)} — the hitbox is not the body you can see`);

    const line = `${LOOK_KEYS.length} fields survive beside a side; ${caps.length} capsules at `
      + `${height.toFixed(2)} m against a human ${plainHeight.toFixed(2)} m`;
    rival.dispose(); plain.dispose();
    world.unload(); world.dispose?.();
    s.close();
    return line;
  });

  check('pvp: a duel runs in whichever theatre the players picked', async () => {
    /**
     * "It runs in whichever theatre the players picked — the levels all exist."
     * The match holds no bodies, no scene and no physics precisely so that this
     * is true by construction rather than by four level-specific fixes. What
     * the check has to prove is that the BODIES work everywhere: `capsules()`
     * walks a posed rig, and a rig is posed by the animator against the
     * terrain, which is the one thing that differs between theatres.
     */
    const P = await import('../../src/game/Player.js');
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const rules = P.pvpRules({ pvp: true });
    const lines = [];
    // Three theatres rather than all of them: a full sweep is a four-minute
    // check for a property that is about the animator, not about the level
    // list. Indoor, outdoor and the first in the order, taken from LEVEL_ORDER
    // rather than named here so a renamed level cannot leave this silently
    // testing one theatre three times.
    const picked = [LEVEL_ORDER[0], LEVEL_ORDER[Math.floor(LEVEL_ORDER.length / 2)],
      LEVEL_ORDER[LEVEL_ORDER.length - 1]];
    for (const level of [...new Set(picked)]) {
      const { world, a, b } = await twoPlayers({ rules, sides: [P.SIDES[0], P.SIDES[1]], level });
      const caps = b.capsules();
      assert(caps.length > 10, `${level}: a duellist offers ${caps.length} capsules`);
      const hit = await swing(a, b, world, P, 90);
      assert(hit.cut > 0, `${level}: ${hit.contact} frames of contact produced no cut`);
      lines.push(`${level} ${hit.cut}`);
      world.unload();
    }
    return `cuts landed in ${lines.join(', ')}`;
  });

  /* ══ what is not wired, stated rather than implied ═════════════════════ */

  check('pvp: the three seams in World.js are wired, and this drives them', async () => {
    /**
     * WAS "the seams this lane does not own are named, not silently missing",
     * AND IT REPORTED TWO SEAMS OPEN THAT HAVE BEEN CLOSED ALL ALONG.
     *
     * The check was written as a handover: three call sites lived in World.js,
     * the lane did not own that file, and it read the source to say whether the
     * glue had landed. Its own last line said what to do when it had — "delete
     * this check and assert the wired behaviour instead" — and instead it went
     * on reporting `2 World.js seams still open` in a green suite for as long as
     * the wording held. Both were the regex, not the build:
     *
     *   `_applyBladeEvent player branch` was hunted with `/ev\.target\.player|
     *   target\.player/`. The branch has always read `const t = ev.target;` and
     *   then `} else if (t.player) {` — ten occurrences of `t.player` in that
     *   one function and not one of `target.player`. A source sweep looking for
     *   a spelling rather than for a behaviour, which is the shape this whole
     *   suite exists to replace.
     *
     *   `_boltHitTest bolt.team !== 0` was hunted with the comment stripper
     *   turned OFF — deliberately, with a note giving a reason that had stopped
     *   being true. The one match in the file is inside the comment recording
     *   its own removal: *"This was `if (bolt.team !== 0)` wrapped around the
     *   whole loop"*. So the better the fix was documented, the more certainly
     *   the check called it missing.
     *
     * The replacement DRIVES all three. A source sweep cannot tell a rule that
     * is present from one that is reachable, and both of those regexes were
     * answering a question about spelling while claiming to answer one about
     * behaviour.
     */
    const P = await import('../../src/game/Player.js');
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const duel = P.pvpRules({ pvp: true, duelRounds: 3, duelHealth: 150 });

    /* 1 & 2 — the target list and the cut branch, driven through World's own
     * frame. `swing` above poses the blade and calls the solver directly; this
     * one lets `world.update` do it, so `_resolveBlades` has to find the rival
     * and `_applyBladeEvent` has to bill them. Nothing else in the suite covers
     * the path from a frame to a player's health. */
    /* Three metres apart, not the default 1.1: the blade is posed onto the
     * rival's own chest capsule so the gap costs it nothing, and the bolt half
     * below needs a muzzle that is outside the SHOOTER's capsule. `canHarm`
     * answers `attacker === victim` with a deliberate `true` — a returned bolt
     * has to be able to come back at you — so a shot that starts inside your
     * own 0.36 m radius hits you, which is what the first version measured. */
    const { world, a, b } = await twoPlayers({ rules: duel, sides: [P.SIDES[0], P.SIDES[1]], gap: 3 });
    const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1), hilt = new THREE.Vector3();
    let sawPlayerTarget = 0;
    const applied = world._applyBladeEvent.bind(world);
    world._applyBladeEvent = (pl, ev, dt) => {
      if (ev.target?.player) sawPlayerTarget++;
      return applied(pl, ev, dt);
    };
    /* POSED FROM INSIDE THE FRAME, between the player step and the blade step.
     * `Player.update` hands the hilt to `SaberController` every frame, so a
     * pose written before `world.update` is gone before `_resolveBlades` ever
     * looks at it — which is what a first version of this check measured, and
     * it read exactly like a missing target list. */
    let frame = 0;
    const resolve = world._resolveBlades.bind(world);
    world._resolveBlades = (dt) => {
      const chest = b.capsules().find((c) => c.name === 'chest');
      if (chest) {
        hilt.set(chest.p0.x - 0.75, chest.p0.y, chest.p0.z);
        q.setFromAxisAngle(axis, Math.sin((frame / 60) * 12) * 1.35 - Math.PI / 2);
        a.saber.setHiltPose(hilt, q);
        a.saber.update(dt, world.time);
      }
      return resolve(dt);
    };
    const hp0 = b.hp;
    for (; frame < 240 && b.hp === hp0; frame++) world.update(1 / 60, H.idleInput());
    assert(sawPlayerTarget > 0,
      '_resolveBlades never handed _applyBladeEvent a target that was a player — the duel\'s bodies '
      + 'are not in the blade\'s target list');
    assert(b.hp < hp0,
      `a blade swept through a rival's chest for four seconds inside World.update and took `
      + `${(hp0 - b.hp).toFixed(1)} hp — _applyBladeEvent has no player branch`);
    const billed = hp0 - b.hp;
    // …and the blade goes away before anything else is measured. Left in, it
    // kept cutting through the bolt step and billed the sweep as the shot: the
    // first version of this reported a 12-damage bolt taking 48.6 hp, which is
    // exactly the blade's number and was the blade.
    world._resolveBlades = resolve;
    a.saber.retract();

    /* 3 — the bolt hit test. `bolt.team !== 0` decided for every player in the
     * room at once; the rule is per victim now and it is `canHarm`. Driven both
     * ways round, because the defect was symmetrical: a duellist's returned
     * bolt could not reach the person it was aimed at, and a horde bolt could
     * not be made to spare an ally. */
    b.hp = b.maxHp; b.invuln = 0;
    const shot = (owner, victim) => {
      victim.invuln = 0;
      const before = victim.hp;
      const from = _boltFrom(owner, victim);
      world.bolts.fire(from.origin, from.dir,
        { speed: 60, damage: 12, color: 0xff4030, owner, team: owner.team });
      for (let i = 0; i < 40 && victim.hp === before; i++) world.update(1 / 60, H.idleInput());
      return before - victim.hp;
    };
    const onRival = shot(a, b);
    assert(onRival > 0, 'a duellist\'s bolt could not reach the player it was fired at');
    world.rules = P.CO_OP_RULES;
    a.team = P.SIDES[0]; b.team = P.SIDES[0];
    const onAlly = shot(a, b);
    assert(onAlly === 0, `the same bolt took ${onAlly.toFixed(1)} hp off an ALLY — the hit test is not `
      + 'asking canHarm');

    assert(typeof P.canHarm === 'function' && typeof P.hostileTo === 'function',
      'the gate World is meant to call is gone');
    world.unload();
    return `blade → ${billed.toFixed(1)} hp through World.update on ${sawPlayerTarget} player target `
      + `records; bolt → ${onRival.toFixed(1)} hp on a rival, ${onAlly.toFixed(1)} on an ally`;
  });
  check('pvp: a returned bolt can be answered by the other side', async () => {
    /**
     * `_creditDeflect` stamped `bolt.team = 0` for every deflector alive, and
     * `_onBoltDeflect` returned on `bolt.team === 0` with the comment "already
     * ours". In a duel there is no "ours": side 0 returns a bolt, side 2 puts
     * their blade in its path, and the shipped code read the constant instead
     * of the question. Measured: `B.deflects` 0 and the bolt's velocity
     * untouched, while a non-Player duellist standing in exactly that spot
     * turned it.
     *
     * AND IT IS WORSE THAN A NO-OP. `Bolts.update` sets `consumed` for the
     * frame before calling this back, so the early return skips the body
     * hit-test too: the bolt phases through the guard AND through the fighter
     * behind it. The one contact in the game that is pure reflex, deleted for
     * whichever duellist did not fire first.
     *
     * `_bladeEntries` carried the same constant — every player's blade stamped
     * `team: 0`, which is the number `Bolts.update` compares against to decide
     * whether a bolt is hostile to that guard — so the check reads the entry
     * the game builds rather than hand-writing one.
     */
    const THREE = await import('three');
    const { World } = await import('../../src/game/World.js');
    const { Player, SIDES, asTeam } = await import('../../src/game/Player.js');
    const { Saber } = await import('../../src/game/Saber.js');
    const { BoltPool } = await import('../../src/game/Bolts.js');

    const scene = new THREE.Scene();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const blade = () => { const b = new Saber(scene, { length: 1.3 }); b.lit = true; b.ignition = 1; return b; };
    const swing = (b, a, z) => {
      const q = new THREE.Quaternion();
      b.setHiltPose(a, q); b.update(1 / 60, 0); b.setHiltPose(z, q); b.update(1 / 60, 1 / 60);
    };
    const pool = new BoltPool(scene, 8);
    const w = {
      players: [], enemies: [], bolts: pool, settings: {}, rules: { friendlyFire: true },
      particles: { sparkBurst() {}, plasma: { spawn() {} } }, engine: { flash() {} },
      addHitstop() {}, report() {}, notifyFloating() {}, onDeflectFeedback() {}, feelOn: () => false,
      _creditDeflect: World.prototype._creditDeflect,
      _onBoltDeflect: World.prototype._onBoltDeflect,
      _bladeEntries: World.prototype._bladeEntries,
    };
    const mk = (saber, team) => Object.assign(Object.create(Player.prototype), {
      alive: true, saber, isLocal: true, team, flow: 1, score: 0, stamina: 100,
      deflects: 0, perfects: 0, combo: 0, comboTimer: 0, aimDir: V(0, 0, -1), chest: V(0, 1.35, 0),
      camera: { pos: V(0, 1.35, 0), addShake() {} },
      boonMods: { deflectDamage: 1, returnCone: 0.42 }, addFlow() {}, boltCatch: null, control: null,
    });
    const sA = blade(), sB = blade();
    const A = mk(sA, SIDES[0]), B = mk(sB, SIDES[1]);
    w.players.push(A, B);
    assert(A.team !== B.team, `both duellists are on side ${A.team} — this is not a duel`);

    const entries = w._bladeEntries();
    const eA = entries.find((e) => e.owner === A), eB = entries.find((e) => e.owner === B);
    assert(eA.team === asTeam(A.team) && eB.team === asTeam(B.team),
      `_bladeEntries published sides ${eA.team}/${eB.team} for players on ${A.team}/${B.team} — `
      + 'Bolts.update decides whether a bolt is hostile to a guard by comparing against that number');

    const bolt = pool.fire(V(0, 1.35, -6), V(0, 0, 1), { speed: 40, team: asTeam(B.team), damage: 11 });
    swing(sA, V(-0.35, 1.35, -0.4), V(0.35, 1.35, -0.4));
    let pt = sA.pointAt(0.6, new THREE.Vector3());
    w._onBoltDeflect(bolt, eA, { bladeT: 0.6, point: pt }, pt.clone());
    assert(A.deflects === 1, 'the first duellist could not deflect a bolt at all');
    assert(bolt.team === asTeam(A.team),
      `a bolt returned by the player on side ${A.team} came away stamped team ${bolt.team} — a duel `
      + 'has no party, so a flat 0 makes it friendly to whoever holds that number');

    // …and now the other side answers it, which is the whole of the defect
    swing(sB, V(-0.35, 1.35, 0.4), V(0.35, 1.35, 0.4));
    pt = sB.pointAt(0.6, new THREE.Vector3());
    w._onBoltDeflect(bolt, eB, { bladeT: 0.6, point: pt }, pt.clone());
    assert(B.deflects === 1,
      `the duellist on side ${B.team} watched a bolt returned by side ${A.team} pass through their `
      + 'blade — and Bolts.update has already marked it consumed, so it phases through their body too');
    assert(bolt.team === asTeam(B.team) && bolt.deflector === B,
      `the answered bolt is still stamped team ${bolt.team} — it was not handed back`);

    // the same gate in the other direction: nobody re-deflects their own return
    const again = B.deflects;
    w._onBoltDeflect(bolt, eB, { bladeT: 0.6, point: pt }, pt.clone());
    assert(B.deflects === again,
      'a duellist deflected a bolt that was already theirs — "ours" has stopped being a question '
      + 'about sides in the other direction');
    pool.dispose();
    return `side ${A.team} returns → team ${asTeam(A.team)}; side ${B.team} answers → `
      + `team ${asTeam(B.team)}; neither can re-deflect their own`;
  });
}

/** A muzzle clear of the shooter's own capsule, pointing at the victim. */
function _boltFrom(owner, victim) {
  const dir = victim.chest.clone().sub(owner.chest);
  const d = dir.length() || 1;
  dir.multiplyScalar(1 / d);
  return { origin: owner.chest.clone().addScaledVector(dir, 0.9), dir };
}
