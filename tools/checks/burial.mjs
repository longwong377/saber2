/**
 * BATTLEFIELD BORZ — BURY THE FALLEN, measured.
 *
 *   "right now graves for your dead allies automatically appear but maybe it
 *    should be an active order like your dead troops stay ragdolled dead on
 *    the field in the manner in which they died but you can give the order to
 *    your men to bury the dead, some will drag the dead in the near area while
 *    others will dig holes, the bodies will be dragged into the holes and …
 *    then the grave will appear … it significantly increases morale … it has
 *    to be done quickly as it is something you would do when you have time to
 *    breathe between waves … obviously not all the troops will be doing this
 *    just a portion … maybe it heals your troops too."
 *
 * Every sentence of that is a check below, on a real World running The Line:
 * the body STAYS; the order details a THIRD; holes get DUG on a clock; a body
 * is DRAGGED to one and the grave appears with the RIGHT HELMET; morale and
 * health move by the table's numbers; and a wave arriving CANCELS it.
 */

import * as THREE from 'three';
import { clocked } from './_shared.mjs';

const STEP = 1 / 30;

/** A real Line, quiet: the first wave composed and thrown away, so the field is the player's. */
async function quietLine(seed = 3) {
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

function step(world, input, seconds, until = null) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) { world.update(STEP, input); if (until && until(i * STEP)) return i * STEP; }
  return seconds;
}

/** Kill a named man outright — `sever` is a kind `_mayGoDown` refuses, so he dies rather than going down. */
function kill(world, t) {
  const e = t.body;
  e.damage(e.hp + 1e3, e.position, null, 'sever');
  return e;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('burial: the dead stay where they fell, as they fell, and no grave appears on its own', async () => {
    const { world, d, input } = await quietLine(3);
    const { BURY } = await import('../../src/game/Command.js');
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    assert(men.length >= 6, `only ${men.length} men to lose`);
    const t = men[0];
    const e = kill(world, t);
    const where = e.position.clone();
    assert(e.dead && e.keepBody, 'a named man died and his body is not flagged to stay');
    assert(world.graves.length === 0, 'a grave appeared the frame he died — the order is the whole point');
    step(world, input, 45);
    assert(!e.disposed && world.enemies.includes(e),
      'the body was gone after 45 s — the forty-second ceiling every droid has still applied to him');
    assert(e.actor?.ragdolled, 'the kept body is not a ragdoll — "in the manner in which they died"');
    assert(e.position.distanceTo(where) < 4,
      `the body drifted ${e.position.distanceTo(where).toFixed(1)} m from where he fell`);
    assert(world.graves.length === 0, 'a grave appeared while nobody had been told to dig one');
    /* …AND THE WAVE COUNT MOVING ON TWICE LETS HIM GO. */
    d.wave += BURY.waves;
    step(world, input, 1);
    assert(!e.keepBody && d.commander.fallen[0].retired,
      `two waves on the body is still flagged to stay — the cap the player asked for is not held`);
    return `kept 45 s where he fell (${e.position.distanceTo(where).toFixed(2)} m drift), no marker; released ${BURY.waves} waves on`;
  });

  check('burial: the order details a third by nerve, half dig on a clock, and their hands are full', async () => {
    const { world, d, input, c } = await quietLine(4);
    const { BURY, FORMATIONS } = await import('../../src/game/Command.js');
    assert(FORMATIONS.bury && FORMATIONS.bury.buries && FORMATIONS.bury.key,
      'there is no bury order in the table, or it has no key');
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    kill(world, men[0]);
    kill(world, men[1]);
    step(world, input, 1);
    const alive = d.roster.living.filter((t) => t.body && !t.body.dead);
    assert(d.order('bury') === true, `the order was refused — ${d.orderRefused}`);
    const B = c.burial;
    assert(B, 'the order landed and no burial exists');
    const detail = alive.filter((t) => t.burying);
    const want = Math.max(BURY.min, Math.round(alive.length * BURY.share));
    assert(detail.length === want,
      `${detail.length} of ${alive.length} detailed — a third (${want}) is what "just a portion" means`);
    const rest = alive.filter((t) => !t.burying);
    const minNerve = Math.min(...detail.map((t) => t.attr('nerve')));
    const maxNerveRest = Math.max(...rest.map((t) => t.attr('nerve')));
    assert(minNerve >= maxNerveRest,
      `the steadiest man left standing has nerve ${maxNerveRest} and the least steady on the detail has `
      + `${minNerve} — the detail is meant to be the men with the most nerve`);
    const diggers = detail.filter((t) => t.burying === 'dig').length;
    assert(diggers === Math.ceil(detail.length / 2), `${diggers} of ${detail.length} dig — half was the design`);
    assert(B.holes.length === 2, `${B.holes.length} holes for two dead`);
    /* Hands full: the diggers' fuse is pushed up, like a dig-in's. */
    for (const t of detail) if (t.body) t.body.attackTimer = 0;
    step(world, input, 2);
    assert(detail.some((t) => (t.body?.attackTimer ?? 0) > 0),
      'a man on the burial detail kept his fuse down — the risk is that he is off the guns');
    assert(!B.holes.some((h) => h.dug), `a hole was dug inside 2 s of a ${BURY.dig} s job`);
    /* The dig: he has to reach the hole, then kneel for BURY.dig seconds. */
    step(world, input, BURY.dig + 12, () => B.holes.some((h) => h.dug));
    assert(B.holes.some((h) => h.dug), `no hole dug after ${BURY.dig + 12} s`);
    assert(world.graves.holes.length >= 1, 'a hole was dug and nothing is drawn where it was');
    const digger = detail.find((t) => t.burying === 'dig' || t.burying === 'bear');
    assert(digger, 'the detail dissolved');
    return `${detail.length}/${alive.length} detailed (nerve ≥ ${minNerve} vs ≤ ${maxNerveRest}), ${diggers} digging, `
      + `${B.holes.filter((h) => h.dug).length} hole(s) open after the ${BURY.dig} s job`;
  });

  check('burial: a body is dragged to the hole, lowered, and the grave appears with his own helmet', async () => {
    const { world, d, input, c } = await quietLine(5);
    const { BURY } = await import('../../src/game/Command.js');
    const { MORALE } = await import('../../src/game/Morale.js');
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    const dead = men[2];
    const kind = dead.type;
    const e = kill(world, dead);
    step(world, input, 1.5);
    const fell = e.position.clone();
    /* The squad he was in, and everybody else, before the reward. */
    const rec = c.fallen[0];
    const mates = d.roster.living.filter((t) => rec.mates.includes(t.id) && t.body && !t.body.dead);
    assert(mates.length >= 1, 'the record names no squadmates');
    for (const t of d.roster.living) { t.morale = 0.5; if (t.body && !t.body.dead) t.body.hp = t.body.maxHp * 0.5; }
    const moraleBefore = Object.fromEntries(d.roster.living.map((t) => [t.id, t.morale]));
    assert(d.order('bury') === true, `refused — ${d.orderRefused}`);
    const B = c.burial;
    const hole = B.holes[0];
    let dragged = false, lowered = false;
    const took = step(world, input, 60, () => {
      const bearer = d.roster.living.find((t) => t.body?.reaction?.corpse);
      if (bearer && e.position.distanceTo(fell) > 1.5) dragged = true;
      if (hole.body) lowered = true;
      return world.graves.length > 0;
    });
    assert(dragged, 'no bearer ever moved the body — it was not dragged, it was teleported or ignored');
    assert(lowered, 'the body reached no hole — the lowering never happened');
    assert(world.graves.length === 1, `after ${took.toFixed(0)} s the grave has not appeared`);
    const g = world.graves.entries[0];
    assert(Math.hypot(g.x - hole.x, g.z - hole.z) < 0.01,
      `the grave stands ${Math.hypot(g.x - hole.x, g.z - hole.z).toFixed(1)} m from the hole that was dug for him`);
    assert(g.dug === true, 'the marker does not say the line dug it');
    const { helmetKindOf } = await import('../../src/world/Graves.js');
    assert(g.kind === helmetKindOf({ kind, army: dead.kind }),
      `the marker wears a ${g.kind} helmet and he was a ${kind}`);
    assert(world.graves.drawn()[g.kind] === 1, 'the helmet is not drawn in its own bucket');
    assert(rec.buried && !e.keepBody, 'the record does not say he is buried');
    assert(e.rig?.root?.visible === false || e.disposed, 'the buried body is still lying on top of its own grave');
    assert(!world.graves.holes.some((h) => h.open), 'the hole is still open under a marker');
    /* THE REWARD. His squad got BURIED_SQUAD; men inside BURIED_NEAR got BURIED; both healed. */
    const mate = mates[0];
    const rise = mate.morale - moraleBefore[mate.id];
    assert(rise >= MORALE.BURIED_SQUAD * 0.8 && rise <= MORALE.BURIED_SQUAD + 0.2,
      `his squad's morale moved ${rise.toFixed(3)} against a table entry of ${MORALE.BURIED_SQUAD}`);
    const near = d.roster.living.find((t) => !rec.mates.includes(t.id) && t.body && !t.body.dead
      && Math.hypot(t.body.position.x - hole.x, t.body.position.z - hole.z) <= MORALE.BURIED_NEAR);
    if (near) {
      const r2 = near.morale - moraleBefore[near.id];
      assert(r2 >= MORALE.BURIED * 0.8, `a man ${MORALE.BURIED_NEAR} m from the grave moved ${r2.toFixed(3)} against ${MORALE.BURIED}`);
    }
    assert(mate.body.hp > mate.body.maxHp * 0.5 + 1,
      `his squadmate is at ${(mate.body.hp / mate.body.maxHp * 100).toFixed(0)}% after the burial — it heals`);
    const log = d.log.filter((l) => l.t === 'buried');
    assert(log.length === 1 && log[0].name === dead.name, 'the log does not say who was buried');
    return `${dead.name} (${kind}) dragged from where he fell, lowered over ${BURY.lower} s, marker ${g.kind} at the hole; `
      + `squad +${rise.toFixed(2)}, heal to ${(mate.body.hp / mate.body.maxHp * 100).toFixed(0)}%, ${took.toFixed(0)} s`;
  });

  check('burial: a wave arriving cancels it — the detail drops the body and goes back to the line', async () => {
    const { world, d, input, c } = await quietLine(6);
    const men = d.roster.living.filter((t) => t.body && !t.body.dead);
    const e = kill(world, men[1]);
    step(world, input, 1);
    assert(d.order('bury') === true, `refused — ${d.orderRefused}`);
    assert(c.burial && c.formation === 'bury', 'the order did not take');
    step(world, input, 4);
    const detail = d.roster.living.filter((t) => t.burying);
    assert(detail.length >= 2, 'nobody on the detail after four seconds');
    /* CONTACT. `start` is what a wave arriving does — `active` goes true. */
    const was = c.burial.was;
    d.start(d.wave + 1);
    step(world, input, 0.5);
    assert(!c.burial, 'a wave arrived and the burial carried on');
    assert(!d.roster.living.some((t) => t.burying), 'men are still detailed after contact');
    assert(!d.roster.living.some((t) => t.body?.reaction?.corpse), 'a bearer is still dragging a body under fire');
    assert(!e.beingDragged, 'the dropped body still carries a bearer\'s claim');
    assert(c.formation === was, `the line went back to ${c.formation} rather than the ${was} it was in`);
    assert(d.log.some((l) => l.t === 'bury-end' && l.why === 'contact'), 'the log does not say why the burial ended');
    assert(!world.graves.holes.some((h) => h.open), 'an open hole was left when the wave came');
    return `4 s of work, then a wave: ${detail.length} men back on the guns, formation ${was}, no open hole`;
  });

  check('burial: walking past a grave you dug lifts a man, and one you left costs him', async () => {
    const { MORALE } = await import('../../src/game/Morale.js');
    assert(MORALE.PASSED_OWN_GRAVE > 0 && MORALE.PASSED_GRAVE < 0,
      'the two grave terms do not have opposite signs — a grave the line dug is not a memorial it made');
    assert(MORALE.BURIED > 0 && MORALE.BURIED_SQUAD > MORALE.BURIED,
      'the burial is worth less to the dead man\'s own squad than to bystanders');
    assert(MORALE.BURIED_SQUAD < MORALE.WAVE_CLEAR,
      'burying one man is worth more than clearing a wave');
    return `own grave +${MORALE.PASSED_OWN_GRAVE}, a left one ${MORALE.PASSED_GRAVE}; burial +${MORALE.BURIED} near / `
      + `+${MORALE.BURIED_SQUAD} squad, under WAVE_CLEAR ${MORALE.WAVE_CLEAR}`;
  });
}
