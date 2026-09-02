/**
 * THE SECOND NOTE — attribute-driven behaviours, measured. Appended to
 * reactions.mjs's run; see the header of src/game/Reactions.js's BEHAVIOUR
 * table for what each row is.
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STEP = 1 / 30;

/** A real Line, quiet — the same fixture burial.mjs uses. */
export async function quietLine(seed = 3) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { enemyRng } = await import('../../src/game/Enemy.js');
  enemyRng.seed(20260902 + seed);
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi', quality: 'low', instantSpawn: true },
    runSeed: seed,
  });
  const d = world.command;
  d.start(1);
  d.spawnQueue.length = 0;
  d.active = false;
  d.intermission = Infinity;
  d.onMuster = () => {};
  const input = idleInput();
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  return { world, d, input, c: d.commander };
}

export function step(world, input, seconds, until = null) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) { world.update(STEP, input); if (until && until(i * STEP)) return i * STEP; }
  return seconds;
}

/** A record with one attribute pinned, everything else at the mean. */
export const rec = (name, attrs = {}, extra = {}) => ({
  name, attrs: { aim: 50, cadence: 50, nerve: 50, grit: 50, pace: 50, reflex: 50, discipline: 50,
                 hardiness: 50, resolve: 50, bond: 50, ...attrs },
  morale: 0.8, rank: 0, ...extra,
});

/** A stub body for the pure-function rates. */
export const stub = (name, attrs, world = {}) => ({
  id: name, position: V(0, 0, 0), chest: V(0, 1.2, 0), team: 0, velocity: V(0, 0, 0),
  A: { speed: 4 }, trooper: rec(name, attrs), world, actor: null, downed: false, speed: 4,
});

export function behaviours({ check, assert, squad, boot }) {
  check('behaviours: every row of the table names an attribute the sim reads, and a die that repeats', async () => {
    const { BEHAVIOUR, dieOf } = await import('../../src/game/Reactions.js');
    const { ATTR_IDS } = await import('../../src/game/Attributes.js');
    const rows = Object.entries(BEHAVIOUR);
    assert(rows.length >= 10, `${rows.length} behaviours — the note asked for "above and beyond"`);
    const bad = [];
    for (const [id, row] of rows) {
      if (id === 'shout') continue;
      const ids = String(row.attr || '').split(/[+*]/).filter(Boolean);
      if (!ids.length || ids.some((a) => !ATTR_IDS.includes(a))) bad.push(`${id}: ${row.attr}`);
    }
    assert(!bad.length, `behaviours whose attribute is not on the card: ${bad.join('; ')}`);
    const a = stub('CT-1', {}), b = stub('CT-1', {});
    const ra = [dieOf(a, 1), dieOf(a, 1), dieOf(a, 2)], rb = [dieOf(b, 1), dieOf(b, 1), dieOf(b, 2)];
    assert(ra.join() === rb.join(), 'the die answers differently for the same man on the same roll — determinism.mjs would see it');
    assert(ra[0] !== ra[1], 'the die never advances');
    return `${rows.length} rows: ${rows.map(([k, r]) => `${k}←${r.attr ?? '—'}`).join(' ')}`;
  });

  check('behaviours: a combat roll under a bolt, and reflex decides how often', async () => {
    const R = await import('../../src/game/Reactions.js');
    /* THE RATE, pure: a hundred men at reflex 5 and a hundred at 95, each shown the same bolt. */
    const bolt = { team: 1, vel: V(0, 0, -1), turned: false };
    const pool = { threatsNear: (p, r, out) => { out.length = 0; out.push({ bolt, eta: 0.3, offset: 0.2 }); return out; } };
    const rate = (reflex) => {
      let n = 0;
      for (let i = 0; i < 100; i++) {
        const b = stub(`m${i}`, { reflex }, { bolts: pool });
        R.senseDanger(b, 0.25, { enemies: [], time: 1 });
        if (b.reaction?.kind === 'roll') n++;
      }
      return n / 100;
    };
    const slow = rate(5), quick = rate(95);
    assert(quick > slow + 0.2, `reflex 95 rolled ${quick}, reflex 5 rolled ${slow} — the attribute is not deciding`);
    const { scaleOf } = await import('../../src/game/Attributes.js');
    const q = stub('x', { reflex: 95 });
    assert(Math.abs(R.rollChance(q) - R.BEHAVIOUR.roll.chance / scaleOf(q.trooper, 'reflex')) < 1e-6,
      'rollChance is not chance / reflex scale');
    /* THE ROLL ITSELF, in a real world: a bolt fired at a quick man, and he is a body-width off its line. */
    const { world, input, men } = await squad(1);
    const m = men[0];
    m.trooper = rec('CT-ROLL', { reflex: 95 });
    R.resetReactionStats();
    let rolled = false, low = 0, lateral = 0;
    const from = m.position.clone(); from.z += 12; from.y += 1.2;
    for (let shot = 0; shot < 8 && !rolled; shot++) {
      const dir = new THREE.Vector3().subVectors(m.chest, from).normalize();
      world.bolts.fire(from, dir, { team: 1, speed: 40, damage: 0, life: 1.5, owner: null });
      const x0 = m.position.x;
      for (let i = 0; i < 60 * 3; i++) {
        world.update(1 / 60, input);
        low = Math.max(low, m.crouch || 0);
        if (R.REACTION_STATS.rolled > 0) rolled = true;
        lateral = Math.max(lateral, Math.abs(m.position.x - x0));
        if (rolled && !m.reaction) break;
      }
    }
    assert(rolled, 'a quick man was shot at eight times and never rolled');
    assert(low >= 0.9, `he rolled at crouch ${low.toFixed(2)} — a roll is a body on the ground`);
    assert(lateral > 1.3, `he moved ${lateral.toFixed(2)} m sideways — the design is 1.6`);
    return `rate reflex 5 → ${slow}, reflex 95 → ${quick}; rolled ${lateral.toFixed(1)} m off the bolt's line at crouch ${low.toFixed(1)}`;
  });

  check('behaviours: a man on a charging beast\'s line dives off it, more often when he is quick', async () => {
    const R = await import('../../src/game/Reactions.js');
    const beast = (at, dir) => ({ position: at, lungeDir: dir, state: 'charge', team: 1, dead: false, A: { custom: 'beast' } });
    const rate = (reflex) => {
      let n = 0;
      for (let i = 0; i < 100; i++) {
        const b = stub(`c${i}`, { reflex });
        b.position.set(0, 0, 6);
        R.senseDanger(b, 0.25, { enemies: [beast(V(0, 0, 0), V(0, 0, 1))], time: 1 });
        if (b.reaction?.kind === 'dive') n++;
      }
      return n / 100;
    };
    const slow = rate(5), quick = rate(95);
    assert(quick > slow + 0.15, `reflex 95 dived ${quick}, reflex 5 dived ${slow}`);
    const { world, input, men } = await squad(1);
    const m = men[0];
    m.trooper = rec('CT-DIVE', { reflex: 95 });
    R.resetReactionStats();
    const at = m.position.clone(); at.z += 8;
    const stubBeast = beast(at, V(0, 0, -1));
    const ctx = { enemies: [stubBeast, ...world.enemies], time: world.time };
    let got = null;
    for (let i = 0; i < 12 && !got; i++) { R.senseDanger(m, 0.2, ctx); got = m.reaction; }
    assert(got?.kind === 'dive', 'a man eight metres down a charge line never dived');
    assert(Math.abs(got.dir.z) < 0.05 && Math.abs(got.dir.x) > 0.9, `he dived along the charge (${got.dir.x.toFixed(2)},${got.dir.z.toFixed(2)}) — off the line is sideways`);
    const x0 = m.position.x;
    for (let i = 0; i < 90; i++) world.update(1 / 60, input);
    assert(Math.abs(m.position.x - x0) > 1.5, `he is ${Math.abs(m.position.x - x0).toFixed(2)} m off the line after the dive`);
    assert(R.REACTION_STATS.dodgedCharge === 1, 'the dodge was not counted');
    return `rate reflex 5 → ${slow}, reflex 95 → ${quick}; dived ${Math.abs(m.position.x - x0).toFixed(1)} m off the line`;
  });

  check('behaviours: nerve and reflex decide who throws one back', async () => {
    const R = await import('../../src/game/Reactions.js');
    const g = { grounded: true, left: 1.0, position: V(3, 0, 0), carrier: null, smotheredBy: null };
    const pick = (attrs) => {
      const b = stub('t', attrs); b.trooper.morale = 0.55;
      return R.chooseReaction(b, g, { enemies: [] })?.kind;
    };
    assert(pick({ nerve: 95 }) === 'throwback', `a man of nerve 95 chose ${pick({ nerve: 95 })}`);
    assert(pick({ nerve: 5 }) === 'dive', `a man of nerve 5 chose ${pick({ nerve: 5 })}`);
    /* A slow man needs more fuse to try it: at 0.6 s the quick one goes and the slow one does not. */
    const g2 = { ...g, left: 0.62 };
    const late = (attrs) => { const b = stub('t', attrs); b.trooper.morale = 0.9; return R.chooseReaction(b, g2, { enemies: [] })?.kind; };
    assert(late({ reflex: 95 }) === 'throwback' && late({ reflex: 5 }) !== 'throwback',
      `with 0.62 s left: reflex 95 → ${late({ reflex: 95 })}, reflex 5 → ${late({ reflex: 5 })}`);
    return 'nerve 95 throws, nerve 5 dives, at the same morale; with 0.62 s left only the quick man tries';
  });

  check('behaviours: the squad\'s medic is its hardiest man, and he kneels and works on the wounded', async () => {
    const R = await import('../../src/game/Reactions.js');
    const { world, d, input } = await quietLine(11);
    const squads = d.squadsOf(d.commander).filter((s) => s.filter((t) => t.body && !t.body.dead).length >= 3);
    assert(squads.length, 'no squad of three to find a medic in');
    const sq = squads[0].filter((t) => t.body && !t.body.dead);
    step(world, input, 0.2);
    const medic = sq.find((t) => t.medic);
    assert(medic, 'the squad has no medic');
    const score = (t) => t.attr('hardiness') + t.attr('resolve');
    assert(sq.every((t) => score(t) <= score(medic)), `the medic is not the squad's highest hardiness+resolve`);
    assert(sq.filter((t) => t.medic).length === 1, 'two medics in one squad');
    const patient = sq.find((t) => t !== medic);
    patient.body.hp = patient.body.maxHp * 0.3;
    const hp0 = patient.body.hp;
    R.resetReactionStats();
    let knelt = 0, lit = false, who = null;
    const took = step(world, input, 14, () => {
      const healer = d.roster.living.find((t) => t.body?.reaction?.kind === 'heal' && t.body.reaction.patient === patient.body);
      if (healer) { knelt = Math.max(knelt, healer.body.crouch || 0); lit = true; who = healer; }
      return R.REACTION_STATS.healed > 0;
    });
    assert(lit, 'no medic ever went to him');
    assert(who.medic === true, `${who.name} worked on him and he is not a squad's medic`);
    assert(who === medic, `${who.name} of another squad worked on him while his own squad's medic ${medic.name} stood by`);
    assert(R.REACTION_STATS.healed > 0, `the medic did not finish a job in ${took} s`);
    assert(knelt >= 0.7, `he worked at crouch ${knelt.toFixed(2)} — a medic kneels`);
    const gained = patient.body.hp - hp0;
    assert(gained >= patient.body.maxHp * R.BEHAVIOUR.heal.share * 0.8,
      `the patient gained ${gained.toFixed(1)} hp against ${(patient.body.maxHp * R.BEHAVIOUR.heal.share).toFixed(1)} promised`);
    assert(d.log.some((l) => l.t === 'medic' && l.name === medic.name), 'the log does not say the medic went');
    return `${medic.name} (hardiness ${medic.attr('hardiness')} + resolve ${medic.attr('resolve')}) knelt at ${knelt.toFixed(1)} `
      + `and put ${gained.toFixed(0)} hp back in ${took.toFixed(1)} s`;
  });

  check('behaviours: a steady man walks to a shaken one and steadies him — resolve and bond decide who', async () => {
    const R = await import('../../src/game/Reactions.js');
    const { MORALE } = await import('../../src/game/Morale.js');
    const hi = R.rallyChance(rec('a', { resolve: 95, bond: 95 })), lo = R.rallyChance(rec('b', { resolve: 5, bond: 5 }));
    assert(hi > lo * 2.5, `rally chance ${hi.toFixed(2)} at 95/95 against ${lo.toFixed(2)} at 5/5`);
    const { world, d, input } = await quietLine(12);
    const squads = d.squadsOf(d.commander).filter((s) => s.filter((t) => t.body && !t.body.dead).length >= 3);
    const sq = squads[0].filter((t) => t.body && !t.body.dead);
    const rallier = sq[0], mate = sq[1];
    rallier.attrs.resolve = 95; rallier.attrs.bond = 95;
    for (const t of d.roster.living) t.morale = 0.5;               // nobody else has anything to give
    rallier.morale = 0.9;
    mate.morale = MORALE.BREAK + 0.04;
    mate.body.position.copy(rallier.body.position).x += 6;
    R.resetReactionStats();
    let jump = 0, was = mate.morale;
    const took = step(world, input, 12, () => {
      jump = Math.max(jump, mate.morale - was);
      if (R.REACTION_STATS.rallied > 0) return true;
      /* Held: presence alone lifts a shaken man out of the window in a second
       * or two, which is the design and not what is being measured here. */
      mate.morale = MORALE.BREAK + 0.04;
      was = mate.morale;
      rallier.morale = 0.9;
      return false;
    });
    assert(R.REACTION_STATS.rallied > 0, 'nobody rallied him in twelve seconds');
    const entry = d.log.find((l) => l.t === 'rallied');
    assert(entry && entry.by === rallier.name && entry.name === mate.name, `the log says ${JSON.stringify(entry)}`);
    step(world, input, 0.1); jump = Math.max(jump, mate.morale - was);
    assert(jump >= MORALE.RALLY_TOUCH * 0.9, `his morale jumped ${jump.toFixed(3)} against RALLY_TOUCH ${MORALE.RALLY_TOUCH}`);
    return `chance ${lo.toFixed(2)} → ${hi.toFixed(2)}; ${rallier.name} reached ${mate.name} in ${took.toFixed(1)} s, +${jump.toFixed(2)}`;
  });

  check('behaviours: bond and nerve decide who goes back for a downed man, and a broken man refuses', async () => {
    const R = await import('../../src/game/Reactions.js');
    const hi = R.dragChance(rec('a', { bond: 95, nerve: 95 })), lo = R.dragChance(rec('b', { bond: 5, nerve: 5 }));
    assert(hi >= 0.95 && lo < 0.35, `drag chance ${hi.toFixed(2)} at 95/95 against ${lo.toFixed(2)} at 5/5`);
    const { world, d, input } = await quietLine(13);
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    const coward = men[0], hurt = men[1];
    for (const t of men) if (t !== coward && t !== hurt) t.body.position.x += 80;   // nobody else in reach
    hurt.body.position.copy(coward.body.position).x += 3;
    hurt.body.hp = hurt.body.maxHp * 0.3;
    hurt.body.actor?.goRagdoll?.(hurt.body.velocity.clone(), null);
    coward.morale = 0.12;
    R.resetReactionStats();
    step(world, input, 4, () => { if (hurt.body.actor) hurt.body.actor.ragdolled = true; return false; });
    assert(coward.body.dragWhy === 'broken' && R.REACTION_STATS.refusedDrag > 0,
      `a man at morale 0.12 beside a downed mate: dragWhy=${coward.body.dragWhy}, refusals ${R.REACTION_STATS.refusedDrag}`);
    assert(hurt.body.beingDragged !== coward.body, 'the broken man dragged him anyway');
    return `chance ${lo.toFixed(2)} → ${hi.toFixed(2)}; a broken man refused (${R.REACTION_STATS.refusedDrag} refusal)`;
  });

  check('behaviours: a downed man crawls away from the shooting, further when he is hardy', async () => {
    const R = await import('../../src/game/Reactions.js');
    const { world, d, input } = await quietLine(14);
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    const hardy = men[0], frail = men[1];
    hardy.attrs.hardiness = 95; frail.attrs.hardiness = 5;
    for (const t of men) if (t !== hardy && t !== frail) t.body.position.x += 90;
    world.player.position.x += 90;
    frail.body.position.copy(hardy.body.position).z += 6;
    const foeAt = hardy.body.position.clone().add(V(-14, 0, 3));
    const foe = world.spawnEnemy('b1', foeAt);
    assert(foe && foe.team !== hardy.body.team, 'no hostile to crawl from');
    for (const t of [hardy, frail]) t.body.damage(t.body.hp + 5, t.body.position, null, 'bolt');
    assert(hardy.body.downed && frail.body.downed, 'the men did not go down');
    const h0 = hardy.body.position.clone(), f0 = frail.body.position.clone();
    R.resetReactionStats();
    /* The droid is a thing to crawl from, not a thing that finishes them: held where it is, fire held. */
    step(world, input, 8, () => { foe.position.copy(foeAt); foe.stopFiring?.(); foe.attackTimer = 9; return false; });
    const hm = hardy.body.position.distanceTo(h0), fm = frail.body.position.distanceTo(f0);
    assert(hm > 0.6, `the hardy man crawled ${hm.toFixed(2)} m in eight seconds`);
    assert(hm > fm * 1.3, `hardiness 95 crawled ${hm.toFixed(2)} m and hardiness 5 crawled ${fm.toFixed(2)} m`);
    const away = hardy.body.position.x - foe.position.x;
    assert(away > h0.x - foe.position.x, 'he crawled toward the enemy');
    return `hardiness 95: ${hm.toFixed(1)} m, hardiness 5: ${fm.toFixed(1)} m, away from the gun`;
  });

  check('behaviours: a man takes a fallen mate\'s heavier rifle, and aim decides who bothers', async () => {
    const R = await import('../../src/game/Reactions.js');
    const good = R.salvageChance(stub('a', { aim: 95 })), poor = R.salvageChance(stub('b', { aim: 5 }));
    assert(good > poor * 1.5, `salvage chance ${good.toFixed(2)} at aim 95 against ${poor.toFixed(2)} at aim 5`);
    const { world, d, input } = await quietLine(15);
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    const shot = men[0], dead = men[1];
    shot.attrs.aim = 95;
    for (const t of men) if (t !== shot && t !== dead) t.body.position.x += 80;
    dead.body.position.copy(shot.body.position).x += 3;
    dead.body.attackDamage = shot.body.attackDamage * 2;
    const want = dead.body.attackDamage, had = shot.body.attackDamage;
    const beside = shot.body.position.clone();
    dead.body.damage(dead.body.hp + 1e3, dead.body.position, null, 'sever');
    R.resetReactionStats();
    /* Held beside the body until he decides — the formation would walk him
     * out of reach in three seconds, and what is measured is the decision. */
    const took = step(world, input, 12, () => {
      if (!shot.body.reaction) shot.body.position.copy(beside);
      return R.REACTION_STATS.salvaged > 0;
    });
    assert(R.REACTION_STATS.salvaged > 0, 'nobody took the rifle in twelve seconds');
    assert(shot.body.attackDamage === want, `he carries ${shot.body.attackDamage} against the ${want} on the ground`);
    assert(d.log.some((l) => l.t === 'salvaged' && l.name === shot.name && l.from === dead.name), 'the log does not say whose rifle');
    return `chance ${poor.toFixed(2)} → ${good.toFixed(2)}; ${shot.name} went from ${had} to ${want} in ${took.toFixed(1)} s`;
  });

  check('behaviours: a squad closes ranks when its leader falls, for as long as its discipline says', async () => {
    const R = await import('../../src/game/Reactions.js');
    const { world, d, input } = await quietLine(16);
    const c = d.commander;
    d.order('line');
    step(world, input, 3);
    const squads = d.squadsOf(c).filter((s) => s.filter((t) => t.body && !t.body.dead).length >= 3);
    assert(squads.length >= 2, `only ${squads.length} squads of three`);
    const A = squads[0], B = squads[1];
    const leader = d.leaderOf(A);
    const survivors = A.filter((t) => t !== leader && t.body && !t.body.dead);
    survivors[0].attrs.discipline = 95;
    survivors[1].attrs.discipline = 5;
    for (const t of [...survivors, ...B]) if (t.body) t.body.position.x += 6;
    leader.body.damage(leader.body.hp + 1e3, leader.body.position, null, 'sever');
    step(world, input, STEP);
    const tight = survivors[0]._closeRanks, slack = survivors[1]._closeRanks;
    assert(tight > 0 && slack > 0 && tight > slack * 1.4,
      `closing ranks for ${tight?.toFixed(1)} s at discipline 95 and ${slack?.toFixed(1)} s at 5`);
    assert(!B.some((t) => t._closeRanks > 0), 'the other squad closed ranks on a leader that was not theirs');
    step(world, input, 2.5);
    const dist = (sq) => sq.filter((t) => t.body && !t.body.dead).reduce((s, t) => s + (t.body.cmdSlotDist ?? 0), 0)
      / Math.max(1, sq.filter((t) => t.body && !t.body.dead).length);
    const a = dist(survivors), b = dist(B);
    assert(a < b, `the squad that lost its leader is ${a.toFixed(2)} m off its marks and the other ${b.toFixed(2)} m`);
    return `${R.BEHAVIOUR.ranks.seconds} s × discipline: ${tight.toFixed(1)} s / ${slack.toFixed(1)} s; 2.5 s on, `
      + `${a.toFixed(1)} m off marks against ${b.toFixed(1)} m for a squad with its sergeant`;
  });
}
