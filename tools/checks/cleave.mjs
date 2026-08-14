/**
 * CLEAVING THROW, AGAINST A WOOD.
 *
 * "The thrown blade cuts clean through everything it passes, and returns twice
 *  as fast." — the card, src/game/Waves.js.
 *
 * The technique keys every body it goes through into `p.throwCleaved` so that
 * one flight cuts one body once. A forest breaks that in a way nothing else in
 * the game does: `attachForest` rides the ENTIRE STAND in `world.props` as a
 * single duck-typed prop with a single `id`, whose `capsules()` hands back one
 * entry per nearby TRUNK. So `cleaveAlong` reached the wood perfectly well —
 * the props loop walks it like any other prop, and `World._applyBladeEvent`'s
 * prop branch calls `Forest.cut`, which fells with its chain — and then
 * `seen.add(pr.id)` retired all eighteen hundred trunks after the first one.
 *
 * MEASURED, before: a disc thrown 24 m through a dense line of the wood left
 * `throwCleaved` holding exactly one entry, the bare string `forest1`, and
 * `throwCleaves` reading 1 for the whole flight.
 *
 * And measured second, which is why nobody noticed and why this is a small
 * defect rather than a large one: trees are `TOUGHNESS.plastoid`, which a disc
 * at 24 m/s parts through the ordinary blade solver with no help at all. The
 * same throw with the technique switched OFF felled 17 trunks against 15 with
 * it on. The wood was coming down either way; the boon was contributing one
 * tree and calling it one body.
 *
 * These checks pin the counter and the keying, because that is the part that
 * was wrong and the part a future refactor can silently put back.
 *
 * Every module is reached by `await import` inside a check body — World.js
 * reaches Engine.js, which rewrites three's ShaderChunks behind once-only flags
 * as a module side effect. See tools/checks/materials.mjs.
 */

/** A player standing in the wood with a lit blade and a clear throw. */
async function inTheWood(withTechnique) {
  const H = await import('./_coop.mjs');
  const { BOONS } = await import('../../src/game/Waves.js');
  const { world } = await H.bootWorld({ level: 'wood', settings: { mode: 'roguelite', difficulty: 'knight' } });
  const p = world.player;
  // Through the CARD, not through `cleavingThrow` directly: the flag is set
  // from the installer's return value and that round trip is part of the boon.
  const card = BOONS.find((b) => b.id === 'saberthrow');
  if (!card) throw new Error('the Cleaving Throw card is gone');
  card.apply(p);
  if (!withTechnique) p.boonMods.throwPierce = false;
  // A fixed stance and a fixed bearing, so the two runs cross the same trunks.
  p.position.set(0, world.terrain.height(0, 0), 0);
  p.aimDir.set(1, 0, 0.35).normalize();
  p.force = p.maxForce;
  p.cooldowns.throw = 0;
  p.saber.lit = true;
  return { world, p, H, card };
}

/** Throw, and run until the blade is back in the hand. */
function flight(world, p, H) {
  const idle = H.idleInput();
  p.throwOrRecall({ terrain: world.terrain, particles: world.particles, enemies: world.enemies });
  let peak = 0;
  for (let f = 0; f < 400; f++) {
    world.update(1 / 60, idle);
    peak = Math.max(peak, p.throwCleaves || 0);
    if (!p.throwState || p.throwState === 'held') break;
  }
  return peak;
}

export async function run({ check, assert }) {
  check('cleave: a disc thrown through a wood cleaves trunks, not "the forest"', async () => {
    const { world, p, H } = await inTheWood(true);
    const F = world.forest;
    assert(F?.data && F.count > 100, 'the wood has no forest, so this measures nothing');
    assert(world.props.includes(F),
      'the forest is no longer in world.props — cleaveAlong walks props, so it now reaches nothing at all');
    assert(p.boonMods.throwPierce, 'Cleaving Throw did not install, so this measures the plain throw');

    const peak = flight(world, p, H);
    const keys = [...p.throwCleaved];
    /**
     * The bare stand id is the defect itself: one entry, one tree, and every
     * other trunk in the level retired for the rest of the flight.
     */
    assert(!keys.includes(F.id),
      `the whole stand was cleaved as one target ("${F.id}") — one tree per throw, and every other `
      + `trunk in the wood retired behind it (${peak} cleave(s) recorded)`);
    const trunks = new Set();
    for (const k of keys) {
      const m = /^(.+):t(\d+)$/.exec(k);
      assert(m && m[1] === F.id, `"${k}" is not a trunk of ${F.id}`);
      trunks.add(m[2]);
    }
    assert(trunks.size === keys.length, `${keys.length} keys named only ${trunks.size} distinct trunks`);
    assert(peak >= 4,
      `the disc crossed the wood and the technique went through ${peak} trunk(s) — the card says it `
      + 'cuts clean through everything it passes');
    assert(peak === keys.length,
      `the counter says ${peak} and the flight remembered ${keys.length} bodies — one of them is lying`);
    world.unload(); world.dispose?.();
    return `${peak} trunks cleaved on one flight, ${trunks.size} distinct: ${keys.slice(0, 4).join(' ')}…`;
  });

  check('cleave: the counter is the technique\'s, not the ordinary solver\'s', async () => {
    /**
     * The control that decides how big this defect is. Trees are plastoid, so
     * a thrown disc already parts them through `BladeContactSolver` — the wood
     * comes down whether or not the card was ever drafted, which is exactly why
     * a boon that cleaved one tree per throw looked like a boon that worked.
     *
     * What must be true is that `throwCleaves` counts the TECHNIQUE. If the
     * plain throw ever starts incrementing it, the number above stops meaning
     * anything and this check says so.
     */
    const { world, p, H } = await inTheWood(false);
    assert(!p.boonMods.throwPierce, 'the technique is live on the control run');
    const felledBefore = world.forest.stats.felled;
    const peak = flight(world, p, H);
    const felled = world.forest.stats.felled - felledBefore;
    assert(peak === 0,
      `a throw with no technique reported ${peak} cleave(s) — the counter is measuring the ordinary `
      + 'blade solver, so the number the technique is judged on is not the technique');
    assert(felled > 0,
      'a disc thrown through the wood felled nothing at all without the technique — the ordinary '
      + 'solver has stopped reaching the trunks, which is a bigger defect than the one this file is about');
    world.unload(); world.dispose?.();
    return `plain throw: 0 cleaves, ${felled} trunks felled by the ordinary solver`;
  });

  check('cleave: felling one trunk does not reset the grind on the rest of the wood', async () => {
    /**
     * `World._applyBladeEvent`'s prop branch calls `bladeSolver.clearTarget`,
     * and a prop's whole id was swept unless the capsule was marked as part of
     * the destruction proxy. A forest is the same shape as that proxy — one id,
     * many independent capsules named per trunk — so every tree that came down
     * threw away the accumulated work on all 1,800 of them, and the tree beside
     * the one you just felled started again from zero.
     *
     * Driven through the shipped `_applyBladeEvent` with the solver's progress
     * map seeded by hand, because the state under test is the map and there is
     * no way to read "what was cleared" other than what is left.
     */
    const THREE = await import('three');
    const { world, p } = await inTheWood(true);
    const F = world.forest;
    /* `capsules()` culls to `Forest.body.position` — which follows the blade in
     * play — and the wood keeps a clearing around the spawn, so the probe is
     * walked outward until two trunks are on offer. Read off the forest's own
     * accessor rather than off `F.data` with hardcoded field offsets, which is
     * a layout this check has no business knowing. */
    let caps = [];
    for (let r = 5; r <= 70 && caps.length < 2; r += 5) {
      for (let a = 0; a < 6.2 && caps.length < 2; a += 0.5) {
        F.body.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        caps = F.capsules();
      }
    }
    assert(caps.length >= 2, `only ${caps.length} trunk(s) are in reach — the scene is wrong, not the sweep`);
    const [a, b] = caps;
    const S = world.bladeSolver;
    S.progress.set(`${F.id}:${a.name}`, 0.5);
    S.progress.set(`${F.id}:${b.name}`, 0.5);

    world._applyBladeEvent(p, {
      type: 'cut', target: { id: F.id, prop: F }, cap: a, bone: a.name,
      cutT: 0.5, bladeT: 1, speed: 24,
      point: a.p0.clone().lerp(a.p1, 0.5), impulse: new THREE.Vector3(1, 0, 0),
      normal: new THREE.Vector3(0, 1, 0),
    }, 1 / 60);

    assert(!S.progress.has(`${F.id}:${a.name}`), 'the trunk that parted kept its grind progress');
    assert(S.progress.has(`${F.id}:${b.name}`),
      `felling ${a.name} threw away the grind already done on ${b.name} — every trunk in the level `
      + 'starts again each time one comes down');
    world.unload(); world.dispose?.();
    return `${a.name} cleared, ${b.name} kept its 0.5 of work`;
  });
}
