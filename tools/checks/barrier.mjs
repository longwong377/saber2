/**
 * BATTLEFIELD BORZ — THE FORCE BARRIER.
 *
 * The player, twice:
 *
 *   "did you already add the force shield/bubble in the game? i'd already
 *    asked for it but I could have missed it."
 *
 * They had not missed it. There were eleven Force verbs in `POWER_COST` and
 * not one of them shielded anything: the only bubble in the build belonged to
 * a droideka, and the only thing that stopped a bolt for the player was a body
 * held in front of them with the grip. Asking twice for a power and being told
 * nothing is the exact failure this suite exists to make impossible to repeat.
 *
 * ── WHAT IS ACTUALLY WORTH MEASURING ────────────────────────────────────
 *
 * A shield is easy to write and easy to write WRONG, and every wrong version
 * fails in a way source text reads as correct:
 *
 *   • a bubble that is drawn and stops nothing — the mesh is in the scene, the
 *     bolts go through it, and every line of the implementation is present;
 *   • a bubble that stops everything — including the droid standing inside it,
 *     which turns the power into "press to win" and the fight into a wall;
 *   • a bubble that costs nothing — the drain is written, the spend never
 *     lands, and there is no decision left in the power at all;
 *   • a bubble the Codex describes with numbers the code stopped using.
 *
 * So nothing below reads Player.js as text. Every check boots a real World,
 * fires real bolts through the real `_boltHitTest`, and reads hp, the Force
 * bar and the barrier's own counter off the objects afterwards.
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  /* Bodies here drive a real World, which advances the wind clock and both
   * seeded streams — see `determinism.mjs` and _shared.mjs. */
  check = await clocked(check);

  const { SHIELD } = await import('../../src/game/Player.js');
  const { POWER_COST } = await import('../../src/game/Powers.js');

  /**
   * A player standing on the colosseum floor with a full bar and nothing
   * shooting at them yet. The barrier is raised BY THE METHOD rather than by
   * setting `shield.up`, so the price, the cooldown gate and the refusal path
   * are all in the measurement.
   */
  const boot = async () => {
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const p = world.player;
    const input = H.idleInput();
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    p.force = p.maxForce;
    p.hp = p.maxHp;
    const ctx = { input, terrain: world.terrain, physics: world.physics,
      particles: world.particles, bolts: world.bolts, camera: world.engine.camera,
      time: world.time, enemies: world.enemies, players: world.players };
    /** Fire one bolt at the player's chest from `dist` metres in front. */
    const shootAt = (dist) => {
      const dir = new THREE.Vector3(0, 0, 1);
      const from = p.chest.clone().addScaledVector(dir, -dist);
      return world.bolts.fire(from, dir, { speed: 60, team: 1, damage: 10 });
    };
    const step = (n = 30) => { for (let i = 0; i < n; i++) world.update(1 / 60, input); };
    return { world, p, ctx, input, THREE, shootAt, step };
  };

  /* ────────────────────────────────────────────────────────────────────
   * IT STOPS BOLTS
   * ──────────────────────────────────────────────────────────────────── */

  check('barrier: bolts that would have hit you die on it instead', async () => {
    const b = await boot();
    const { p } = b;

    /* THE CONTROL FIRST, because "the player took no damage" means nothing
     * unless the same shot lands with the barrier down. Six bolts, no bubble. */
    for (let i = 0; i < 6; i++) b.shootAt(12);
    b.step(40);
    const bare = p.maxHp - p.hp;
    assert(bare > 0, `six bolts at an UNSHIELDED player did ${bare.toFixed(1)} damage — `
      + 'the bench is not delivering hits, so nothing below would mean anything');

    p.hp = p.maxHp;
    p.force = p.maxForce;
    b.p.forceShield(b.ctx);
    assert(p.shield.up, 'forceShield on a full bar did not raise the barrier');
    /* Up to full power first: `shieldSphere` refuses under a quarter, which is
     * the rule that keeps what stops bolts and what you can see in step. */
    b.step(20);
    assert(p.shieldSphere(), `the barrier is at ${p.shield.power.toFixed(2)} power and answers no sphere`);

    for (let i = 0; i < 6; i++) b.shootAt(12);
    b.step(40);
    const through = p.maxHp - p.hp;
    assert(through === 0, `${through.toFixed(1)} damage got through a raised barrier`);
    assert(p.shield.stopped >= 6, `the barrier counted ${p.shield.stopped} of 6 bolts`);
    return `unshielded ${bare.toFixed(1)} hp lost; shielded 0, ${p.shield.stopped} bolts eaten`;
  });

  check('barrier: a muzzle INSIDE the bubble still shoots you', async () => {
    /**
     * The rule that makes this a barrier and not an invulnerability window,
     * and it is a rule about geometry rather than a special case: a segment
     * that begins inside the sphere never crosses its surface, so
     * `segmentSphere` hands back null and the bolt carries on to the capsule.
     * Without it, walking a droid up to point-blank range would be the safest
     * thing that could happen to the player.
     */
    const b = await boot();
    const { p } = b;
    p.forceShield(b.ctx);
    b.step(20);
    assert(p.shieldSphere(), 'setup: no barrier');

    const before = p.hp;
    // 1.2 m — comfortably inside SHIELD.radius, which is 2.1
    for (let i = 0; i < 4; i++) b.shootAt(1.2);
    b.step(20);
    const hurt = before - p.hp;
    assert(hurt > 0, 'a droid standing INSIDE the barrier could not shoot the man in it — '
      + 'that is a wall against having to move');
    assert(p.shield.up, 'the point-blank shots dropped the barrier');
    return `${hurt.toFixed(1)} hp taken from inside the bubble, barrier still up`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * AND IT IS PAID FOR
   * ──────────────────────────────────────────────────────────────────── */

  check('barrier: holding it drains, eating a bolt costs more, and an empty bar drops it', async () => {
    const b = await boot();
    const { p } = b;
    p.forceShield(b.ctx);
    /* THE PRICE THE PLAYER ACTUALLY PAYS, and not the number in the table:
     * `_priceOf` is what the refusal message quotes and what `_spend` charges,
     * and it carries the Force Drain slider and the boon multiplier. A check
     * that asserted the raw 18 would fail on any save with a cost boon on it
     * and would be measuring the difficulty settings, not the barrier. */
    const price = p._priceOf(POWER_COST.shield);
    const paid = p.maxForce - p.force;
    assert(Math.abs(paid - price) < 0.51,
      `raising it cost ${paid.toFixed(1)} against a quoted ${price}`);

    /* ONE SECOND OF SILENCE — nothing shooting, so the only spend is the hold.
     * Regen runs underneath it, so this measures the NET slope and asserts the
     * sign rather than the exact number: a barrier that pays for itself while
     * up is the failure worth catching. */
    const t0 = p.force;
    b.step(60);
    const quiet = t0 - p.force;
    assert(quiet > 0, `a second of holding the barrier cost ${quiet.toFixed(2)} Force — it is free`);

    /* …AND THE SAME SECOND UNDER FIRE COSTS MORE. Same clock, same regen, one
     * difference: bolts arriving. */
    p.force = p.maxForce; p.hp = p.maxHp;
    const t1 = p.force;
    const eaten = p.shield.stopped;
    for (let i = 0; i < 8; i++) b.shootAt(10 + i * 0.8);
    b.step(60);
    const loud = t1 - p.force;
    const n = p.shield.stopped - eaten;
    assert(n > 0, 'the bench delivered no bolts to the barrier in the loud second');
    assert(loud > quiet, `a second under ${n} bolts cost ${loud.toFixed(2)} against `
      + `${quiet.toFixed(2)} in silence — what it stops, it does not take`);

    /* AND RUNNING DRY DROPS IT, loudly. */
    /* A third of a second's worth of hold left in the pool, and a whole second
     * of frames to spend it in — the margin is there because `_spend` charges
     * `_priceOf`, so a save carrying a cost boon empties the bar at a
     * different rate than the raw SHIELD.hold would suggest. */
    p.force = SHIELD.hold * 0.33;
    const said = [];
    b.world.onNotify = (t, sub) => said.push([String(t), String(sub ?? '')]);
    b.step(60);
    assert(!p.shield.up, `the barrier is still up on ${p.force.toFixed(1)} Force`);
    /* AND IT SAID SO, THROUGH THE ONE PATH THERE IS. This read
     * `b.world.notices?.some?.(…) !== false`, and there is no `world.notices`:
     * `World.notify` raises `onNotify` and nothing else. So the expression was
     * `undefined`, `undefined !== false` is true, and deleting Player's
     * `notify('BARRIER DOWN', why)` left this green — the "loudly" in the note
     * above asserted nothing at all. */
    assert(said.some(([t]) => /BARRIER DOWN/.test(t)),
      `the barrier went out in silence — ${said.length} notices, `
      + `${said.map(([t]) => t).join(' / ') || 'none at all'}`);
    const why = said.find(([t]) => /BARRIER DOWN/.test(t))?.[1] || '';
    assert(why, 'the barrier says it went down and never says why, which is the half a player can act on');
    return `raise ${POWER_COST.shield}; quiet second ${quiet.toFixed(2)}; `
      + `${n} bolts ${loud.toFixed(2)}; empty bar drops it`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * IT IS NOT A WALL AGAINST EVERYTHING
   * ──────────────────────────────────────────────────────────────────── */

  check('barrier: a blade still reaches you, blunted and no more', async () => {
    const b = await boot();
    const { p } = b;
    p.hp = p.maxHp;
    p.damage(40, null, null, 'saber');
    const bare = p.maxHp - p.hp;

    p.hp = p.maxHp;
    p.force = p.maxForce;
    p.forceShield(b.ctx);
    b.step(20);
    p.damage(40, null, null, 'saber');
    const behind = p.maxHp - p.hp;

    assert(behind > 0, 'a lightsabre could not reach a man behind a bubble — '
      + 'a wall against everything is a wall against having to move');
    const cut = 1 - behind / bare;
    assert(Math.abs(cut - SHIELD.blunt) < 0.02,
      `the barrier blunted a blade by ${(cut * 100).toFixed(0)}% against a stated `
      + `${(SHIELD.blunt * 100).toFixed(0)}% — the Codex quotes SHIELD.blunt`);
    return `blade ${bare.toFixed(1)} → ${behind.toFixed(1)} hp, ${(cut * 100).toFixed(0)}% blunted`;
  });

  check('barrier: it is a toggle, it follows the chest, and it leaves nothing behind', async () => {
    const b = await boot();
    const { p, world } = b;
    p.forceShield(b.ctx);
    b.step(15);
    const mesh = p._shieldMesh;
    assert(mesh && mesh.visible, 'the barrier is up and nothing is drawn');
    assert(mesh.parent === world.scene, 'the bubble is not in the scene');
    assert(mesh.position.distanceTo(p.chest) < 1e-3,
      `the bubble sits ${mesh.position.distanceTo(p.chest).toFixed(2)} m off the chest it belongs to`);

    /* WALK, and it comes with you — a barrier pinned to where you raised it is
     * a barrier you have to stand still behind. */
    p.position.x += 4;
    b.step(2);
    assert(mesh.position.distanceTo(p.chest) < 1e-3, 'the bubble stayed where it was raised');

    /* The same key puts it away, and the cooldown is short on purpose. */
    p.forceShield(b.ctx);
    assert(!p.shield.up, 'pressing the key again did not lower the barrier');
    assert(p.cooldowns.shield > 0, 'no recovery at all after a barrier');
    b.step(30);
    assert(!mesh.visible, 'the bubble is still drawn a half second after it came down');

    /* AND IT IS NOT A LEAK. The mesh is built lazily into the scene and
     * parented to nothing, so removing the rig does not take it — the exact
     * shape of orphan the skirt left behind, once per respawn. */
    const before = world.scene.children.length;
    p.dispose();
    assert(!p._shieldMesh, 'dispose left the bubble on the player');
    assert(world.scene.children.length < before, 'dispose left the bubble in the scene');
    return 'toggles, tracks the chest, fades out, disposes clean';
  });

  return;
}
