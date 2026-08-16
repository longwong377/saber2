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
async function twoPlayers({ rules = null, sides = null, gap = 1.1, level = 'arena' } = {}) {
  const H = await import('./_coop.mjs');
  const P = await import('../../src/game/Player.js');
  const { world } = await H.bootWorld({ level });
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

    // 3 — lightning. Measured at 100 hp → 100 hp before this lane.
    b.invuln = 0;
    const before = b.hp;
    a.force = a.maxForce; a.cooldowns.lightning = 0; a.boonMods.lightning = true;
    a.forceLightning(ctx);
    assert(b.hp < before, `force lightning at ${a.chest.distanceTo(b.chest).toFixed(1)} m took `
      + `${before.toFixed(1)} hp to ${b.hp.toFixed(1)} — the power cannot see a player`);

    const line = `blade ${hit.cut} cuts over ${hit.contact} contact frames on ${hit.bones.size} bones, `
      + `push ${shove.toFixed(1)} m/s, lightning −${(before - b.hp).toFixed(0)} hp`;
    world.unload();
    return line;
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
    const dmg = player.slice(player.indexOf('\n  damage(amount, point, source, kind)'));
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

  check('pvp: the seams this lane does not own are named, not silently missing', async () => {
    /**
     * THREE CALL SITES LIVE IN World.js, WHICH THIS LANE DOES NOT OWN. The
     * mechanism each needs is built and driven by the checks above; the glue is
     * three lines. This check exists so that "it is a handover" is a FACT ABOUT
     * THE BUILD rather than a sentence in a report — the day somebody applies
     * the handover, the assertions here flip and this check tells them to
     * delete itself and write the real one.
     *
     * It is deliberately written as "either the seam is still open, or it is
     * closed and here is what must then be true", so it can never be the thing
     * that blocks the handover landing.
     */
    // NOT stripped: the anchors below are code, but the seam is identified by
    // where `_resolveBlades` builds its list, and stripping comments moves
    // every offset in the file for no gain here.
    const world = await src('game/World.js');
    const P = await import('../../src/game/Player.js');

    // 1 — the blade target list.
    const i = world.indexOf('_resolveBlades(dt)');
    assert(i > 0, 'World._resolveBlades has moved or been renamed');
    const body = world.slice(i, world.indexOf('bladeSolver.solve', i));
    assert(/for \(const e of this\.enemies\)/.test(body),
      'the blade target assembly is not where this check thinks it is');
    const wired = /bladeTargets\(/.test(body);
    assert(typeof P.bladeTargets === 'function',
      'bladeTargets is gone, and with it the only thing World needs to call');
    if (!wired) {
      assert(!/for \(const (p2|o) of this\.players\)/.test(body),
        'World grew its own player-targeting loop instead of calling bladeTargets — two copies of a '
        + 'rule that decides damage');
    }

    // 2 — a cut event whose target is a player.
    const applied = /ev\.target\.player|target\.player/.test(world);

    // 3 — the bolt hit test's hard-wired team.
    const bolts = /if \(bolt\.team !== 0\)/.test(world);

    const open = [!wired && '_resolveBlades target list', !applied && '_applyBladeEvent player branch',
      bolts && '_boltHitTest bolt.team !== 0'].filter(Boolean);
    // Whatever the state, the mechanism has to be present and callable.
    assert(typeof P.canHarm === 'function' && typeof P.hostileTo === 'function',
      'the gate World is meant to call is gone');
    return open.length
      ? `${open.length} World.js seams still open (${open.join('; ')}) — see the lane handover`
      : 'every seam closed; delete this check and assert the wired behaviour instead';
  });
}
