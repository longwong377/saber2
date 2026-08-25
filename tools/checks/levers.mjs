/**
 * BATTLEFRONT BORZ — the levers a general spends to break the other's quorum.
 *
 * PLAN.md §4.3, and it is the clause that stops that section reading as "make
 * it bigger":
 *
 *     **Mechs, air and reinforcements are the levers each general spends to
 *     break the other's quorum.** Not spectacle — the only ways to make half of
 *     a man's living army stop standing where it needs to stand. A walker
 *     driven into a formation scatters it; a strafing run does; artillery does.
 *     Each is *how you stop them taking ground*.
 *
 * That is a claim about `lineGathered`, and it is the difference between a
 * battle and a light show: if the biggest things either side can spend cannot
 * take a quorum down, then density is decoration and the ground is decided by
 * attrition alone.
 *
 * ── AND KILLING IS NOT THE INTERESTING HALF ─────────────────────────────
 *
 * Anything lethal breaks a quorum eventually by emptying it. What the section
 * claims is SCATTER — living men who stop standing where they were told to
 * stand — so every check below counts the men who are alive and out of place,
 * and would fail on a lever that only killed.
 */

import * as THREE from 'three';
import { MORALE } from '../../src/game/Morale.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert }) {

  check('levers: a barrage on a formation scatters it, and the ground stops being theirs', async () => {
    const { world, d, c, men } = await formedUp();
    assert(d.lineGathered(c), 'the line was not gathered before anything happened to it');
    const near = () => men.filter((e) => !e.dead
      && Math.hypot(e.position.x - c.player.position.x, e.position.z - c.player.position.z) <= MORALE.NEAR).length;
    const alive0 = men.filter((e) => !e.dead).length;
    const near0 = near();

    /**
     * THE LEVER, AT ITS OWN NUMBERS. `Stratagems`' artillery barrage is twelve
     * 6.5 m blasts at 70 force and 120 damage walked across the position, and
     * this lands the same weight in the same place — through `blast`, which is
     * the one door ordnance comes through, so what is measured is the shipped
     * shell and not a fixture's idea of one.
     */
    const ctx = world._frameCtx || { world, enemies: world.enemies, terrain: world.terrain,
      physics: world.physics, particles: world.particles };
    const S = world.player.stratagems;
    for (let i = 0; i < 12; i++) {
      const at = V(c.player.position.x + (i - 5.5) * 3.4, 0, c.player.position.z + ((i % 3) - 1) * 2.6);
      at.y = world.terrain.height(at.x, at.z);
      S.blast(ctx, at, 6.5, 70, 120, { core: 0.25, size: 1.7, crater: 0.9 });
    }
    /* The shove is applied to bodies and carried by their own step, so the
     * field has to run for the displacement to exist at all. */
    for (let i = 0; i < 60; i++) world.update(1 / 30, idle());

    const alive1 = men.filter((e) => !e.dead).length;
    const near1 = near();
    const scattered = alive1 - near1;
    assert(scattered > 0,
      `${alive1} men are still alive after the barrage and every one of them is still standing `
      + `inside ${MORALE.NEAR} m — the lever kills or it does nothing, and §4.3's claim is that it `
      + 'SCATTERS');
    assert(!d.lineGathered(c),
      `the quorum survived a twelve-shell barrage on top of it: ${near1} of ${alive1} still in `
      + 'place. If the heaviest thing on the table cannot stop a line taking ground, the levers are '
      + 'spectacle and the battle is decided by attrition alone');
    world.unload();
    return `${alive0} men, ${near0} in place → ${alive1} alive, ${near1} in place `
      + `(${scattered} scattered, ${alive0 - alive1} killed)`;
  });

  check('levers: and the survivors re-form, so a lever buys time rather than the battle', async () => {
    /**
     * THE OTHER HALF, AND WITHOUT IT THE FIRST ONE IS A DIFFERENT GAME. A lever
     * that broke a quorum permanently would end a battle in one press; what the
     * section wants is a general spending something to stop the other side
     * taking ground FOR A WHILE. `slotFor` never stopped telling the survivors
     * where to stand, so they walk back — and the question the mode asks is
     * what you did with the seconds.
     *
     * THE SAME LEVER as the check above rather than a bare shove, and that is a
     * correction rather than a convenience: a shove big enough to move a man
     * out of a 14 m radius on its own throws him 140 m and kills him on the
     * ground, so an arm built that way measures a body dying, not a line
     * scattering. The barrage is what a general actually spends.
     */
    const { world, d, c, men } = await formedUp();
    const ctx = world._frameCtx || { world, enemies: world.enemies, terrain: world.terrain,
      physics: world.physics, particles: world.particles };
    const S = world.player.stratagems;
    for (let i = 0; i < 12; i++) {
      const at = V(c.player.position.x + (i - 5.5) * 3.4, 0, c.player.position.z + ((i % 3) - 1) * 2.6);
      at.y = world.terrain.height(at.x, at.z);
      S.blast(ctx, at, 6.5, 70, 120, { core: 0.25, size: 1.7, crater: 0.9 });
    }
    for (let i = 0; i < 60; i++) world.update(1 / 30, idle());
    const down = !d.lineGathered(c);
    const aliveAfter = men.filter((e) => !e.dead).length;
    assert(down || aliveAfter === 0,
      'the barrage did not take the quorum down, so this arm has nothing to measure re-forming from');

    /* AND NOW NOBODY DOES ANYTHING TO THEM. */
    for (let i = 0; i < 30 * 25; i++) world.update(1 / 30, idle());
    const alive = men.filter((e) => !e.dead).length;
    const back = d.lineGathered(c);
    assert(alive > 0,
      'every survivor of the barrage died in the twenty-five seconds after it with nothing on the '
      + 'field — the fixture is measuring something other than the lever');
    assert(back,
      `twenty-five seconds after the shells stopped, ${alive} men are alive and the line is still `
      + 'scattered — a lever that breaks a quorum permanently ends the battle in one press, and '
      + '§4.3 asks for one that buys time');
    world.unload();
    return `barrage: quorum down · 25 s later: ${alive} survivors, back up`;
  });

}

/* ── the fixture ──────────────────────────────────────────────────────── */

/**
 * THE HARNESS'S OWN IDLE INPUT, and not a hand-rolled one.
 *
 * `World.update` reads more of an input than four methods — a stub that answers
 * only what a reader remembers throws `Cannot read properties of undefined`
 * somewhere in the frame, which is how the first version of this file failed.
 * `_coop.mjs` publishes the one every other suite drives a real world with.
 */
let _idle = null;
const idle = () => _idle;

/**
 * A REAL LINE ON REAL GROUND, formed up on its general.
 *
 * Real `Enemy` bodies and not stubs, because the whole subject is `blast` →
 * `applyKnockback` → the shove that moves a man off his slot, and none of that
 * exists on a stand-in object. The hostiles are cleared out so the only thing
 * that happens to this line in the measured seconds is the lever.
 */
async function formedUp() {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  _idle = idleInput();
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', quality: 'low' },
    runSeed: 9,
  });
  const d = world.command;
  /* `start(1)` IS WHAT PUTS THE LINE ON THE GROUND — `theline.mjs`'s own
   * fixture opens the same way. Without it the roster exists and no body does. */
  d.start(1);
  const c = d.commander;
  c.player = world.player;
  world.player.position.set(0, world.terrain.height(0, 0), 0);
  /* NOTHING ELSE ON THE FIELD. A wave shooting at the line while it is being
   * measured is a second cause for every number this file reports. Spliced in
   * place rather than reassigned: `World._frameCtx` holds this array, so a
   * fresh one would leave the frame stepping the list this fixture threw away. */
  const mine = world.player.team ?? 0;
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    if (e.team === mine) continue;
    e.dispose?.();
    world.enemies.splice(i, 1);
  }
  world.director.active = false;
  world.director.spawnQueue.length = 0;

  const men = d.roster.living.map((t) => t.body).filter(Boolean);
  if (men.length < 6) throw new Error(`the fixture deployed ${men.length} men`);
  /* Formed up tight on the general, which is what `circle` means and what the
   * quorum reads. Stepped once so the director stamps their indices. */
  men.forEach((e, i) => {
    const a = (i / men.length) * Math.PI * 2;
    e.position.set(Math.sin(a) * 4, 0, Math.cos(a) * 4);
    e.position.y = world.terrain.height(e.position.x, e.position.z);
  });
  d.order('circle', c);
  d._troops(1 / 30, {});
  return { world, d, c, men };
}
