/**
 * BATTLEFIELD BORZ — IS THERE ANYTHING IN THE AIR?
 *
 * The player, by their own count many times over:
 *
 *   "I've told you this a hundred times by now but force lightning needs to be
 *    fucking LIGHTNING that comes out of your hands like I need to be able to
 *    fucking see the lightning come out and travel to where I'm aiming like
 *    this needs to sound and look cool as fuck but for the millionth time it's
 *    nothing in the air right now like there's no VFX or anything like why do
 *    you keep fucking this up"
 *
 * ── WHY IT KEPT COMING BACK, WHICH IS THE PART WORTH KEEPING ─────────────
 *
 * Because the code that draws it was never missing, and every previous pass
 * looked at that code and found it fine. `Player._lightningArc` drew a seeded
 * random walk with forks between two points, and the walk is good — it is kept
 * almost verbatim in `src/world/Lightning.js`.
 *
 * What was wrong was the CONDITION it drew under. `forceLightning` gathered
 * the enemies inside a cone and drew one arc per body found; with that list
 * empty it ran to completion and drew nothing at all. So the power was
 * invisible in exactly the situation a player tries it in first — pointing it
 * at open ground to see what it does — and perfectly visible in the situation
 * a reviewer sets up, which is pointing it at a droid.
 *
 * A check that fires the power at a target and counts sparks would have passed
 * on every broken build. So the first check here fires it at NOTHING.
 */

export async function run({ check, assert }) {
  const boot = async (settings = {}) => {
    const H = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(19);
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', quality: 'low', instantSpawn: true, ...settings },
    });
    const p = world.player;
    p.boonMods.lightning = true;
    p.boonMods.forceCost = 1;
    p.force = p.maxForce = 600;
    /* HELD, which is what a channel means. `actHit` is the press and `act` is
     * the level; a probe that only pressed would open the channel and close it
     * on the very next frame, which is correct behaviour and useless here. */
    const input = { ...H.idleInput(), act: (a) => a === 'lightning', actHit: () => false };
    const ctx = { input, physics: world.physics, terrain: world.terrain, particles: world.particles };
    return { world, p, input, ctx };
  };

  check('lightning: it draws even when it hits absolutely nothing', async () => {
    /**
     * THE ONE THAT WOULD HAVE CAUGHT IT. Nothing is spawned, the aim is at bare
     * ground, and the assertion is that the sky fills up anyway. On the shipped
     * code before this, the count is zero — not small, ZERO — because the draw
     * loop is inside `for (const root of roots)` and `roots` is empty.
     */
    const { world, p, input, ctx } = await boot();
    const hostiles = world.enemies.filter((e) => !e.dead && e.team !== p.team).length;
    assert(hostiles === 0, `${hostiles} enemies on the field — this check is about hitting NOTHING`);
    world.update(1 / 60, input);
    p.forceLightning(ctx);
    assert(p.channel?.kind === 'lightning', 'the channel did not open on a full pool with the boon held');
    let peak = 0, frames = 0;
    for (let i = 0; i < 90; i++) {
      world.update(1 / 60, input);
      if (p.channel?.kind !== 'lightning') break;
      frames++;
      peak = Math.max(peak, world.lightning.bolts.filter((b) => b.alive).length);
    }
    assert(frames > 45, `the channel lasted ${frames} frames aimed at open ground`);
    assert(peak >= 4,
      `${peak} bolts were alive at the busiest frame with nothing to hit — this is the defect: "it's `
      + 'nothing in the air right now like there\'s no VFX or anything"');
    return `${frames} frames of channel at empty ground, ${peak} bolts alive at peak`;
  });

  check('lightning: it comes out of the HANDS and reaches where you are aiming', async () => {
    /**
     * "it comes out of your hands… and travel to where I'm aiming". Both halves
     * are geometry and both are measurable: every live bolt's near end is at a
     * hand bone, and its far end is on the aim ray.
     *
     * The far end is the interesting one. `_lightningEnd` has four answers and
     * one of them is always true — a body, whatever the ray hits, the ground if
     * the ray is heading into it, or the end of the range in open air — which
     * is what makes the first check above possible at all.
     */
    const THREE = await import('three');
    const { world, p, input, ctx } = await boot();
    world.update(1 / 60, input);
    /* Aim down at the ground a little, so the end is the terrain rather than
     * the far end of the range — the harder of the two to get right. */
    p.aimDir.set(0.2, -0.35, -1).normalize();
    p.forceLightning(ctx);
    const aim = p.aimDir.clone();
    const chest = p.chest.clone();
    for (let i = 0; i < 4; i++) world.update(1 / 60, input);
    const live = world.lightning.bolts.filter((b) => b.alive);
    assert(live.length >= 2, `${live.length} bolts alive`);
    /* THE NEAR END IS A HAND. The rig's hands are the origins; measured against
     * the chest rather than against the hand bone directly, because the gesture
     * moves the hands and the point is that the bolt LEAVES THE BODY rather
     * than starting in mid-air. */
    const strays = live.filter((b) => b.from.distanceTo(chest) > 1.4);
    assert(strays.length <= live.length * 0.5,
      `${strays.length} of ${live.length} bolts start more than 1.4 m from the chest — they are supposed to `
      + 'leave the hands');
    /* THE FAR END IS ON THE AIM RAY. Forks deliberately are not, so the main
     * bolts are the ones whose far end is the shared target. */
    const ends = live.map((b) => b.to);
    const onAim = ends.filter((e) => {
      const v = new THREE.Vector3().subVectors(e, chest);
      const d = v.length();
      return d > 1 && v.normalize().dot(aim) > 0.7;
    });
    assert(onAim.length >= 2,
      `${onAim.length} of ${ends.length} bolt ends are on the aim ray — "travel to where I'm aiming"`);
    const reach = Math.max(...onAim.map((e) => e.distanceTo(chest)));
    assert(reach > 3, `the furthest bolt reached ${reach.toFixed(1)} m`);
    return `${live.length} bolts, ${onAim.length} on the ray, furthest ${reach.toFixed(1)} m`;
  });

  check('lightning: it is a channel — it holds, it drains, and it ends', async () => {
    /**
     * The third defect, and the one that made the other two invisible: the old
     * power resolved in ONE CALL. Press, gather, damage, spawn, done. Nothing
     * travelled and nothing could be swept across a line, so even when it did
     * draw there was one frame of it.
     *
     * Three properties: it lasts, it costs while it lasts, and it stops on its
     * own — a channel with no clock is a power the player leans on.
     */
    const { world, p, input, ctx } = await boot();
    const X = await import('../../src/game/Player.js');
    world.update(1 / 60, input);
    p.forceLightning(ctx);
    const opened = p.force;
    let t = 0, seen = 0;
    while (t < 8 && p.channel?.kind === 'lightning') { world.update(1 / 60, input); t += 1 / 60; seen++; }
    assert(seen > 60, `the channel closed after ${seen} frames — it is supposed to hold`);
    assert(t < 6, `the channel ran for ${t.toFixed(1)} s with the key held — it has no clock`);
    assert(p.force < opened,
      `the pool went ${opened.toFixed(0)} → ${p.force.toFixed(0)} — a held channel that costs nothing is `
      + 'a power with no decision in it');
    assert(p.cooldowns.lightning > 0, 'the channel ended with no recovery at all');
    return `held ${t.toFixed(2)} s, ${seen} frames, pool ${opened.toFixed(0)} → ${p.force.toFixed(0)}`;
  });

  check('lightning: releasing the key ends it, and running dry ends it', async () => {
    /* The two ways out that are not the clock. A channel you cannot let go of
     * is worse than a one-shot, and one that runs on an empty pool is free. */
    const { world, p, input, ctx } = await boot();
    world.update(1 / 60, input);
    p.forceLightning(ctx);
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    assert(p.channel, 'the channel is not open');
    /* Let go: the level goes false and the edge does not fire. */
    const released = { ...input, act: () => false, actHit: () => false };
    world.update(1 / 60, released);
    assert(!p.channel, 'releasing the key did not end the channel');

    const { p: q, world: w2, input: held, ctx: c2 } = await boot();
    w2.update(1 / 60, held);
    q.cooldowns.lightning = 0;
    q.force = q.maxForce = 40;                 // enough to open, not to hold
    q.forceLightning(c2);
    assert(q.channel, 'the channel did not open on a pool that could pay the opening cost');
    let n = 0;
    while (n < 600 && q.channel) { w2.update(1 / 60, held); n++; }
    assert(!q.channel, 'the channel outlived the pool');
    assert(n < 400, `it took ${n} frames to run a 40-Force pool dry`);
    return `released in 1 frame; a 40-Force pool ran dry in ${n} frames`;
  });

  check('lightning: the pool is its own, and it is bounded', async () => {
    /**
     * `LightningVfx` allocates once and never grows: `MAX_BOLTS` spines of
     * `MAX_POINTS`, one geometry per layer, and a bolt that expires is
     * collapsed rather than freed. The old drawing went through
     * `particles.sparks`, a ring shared with every blade hit and bolt impact in
     * the fight — HANDOFF records a stratagem overflowing three shared rings,
     * and forty spark spawns per frame per bolt is the same shape of defect.
     */
    const THREE = await import('three');
    const { LightningVfx, MAX_BOLTS } = await import('../../src/world/Lightning.js');
    const scene = new THREE.Scene();
    const vfx = new LightningVfx(scene);
    const before = scene.children.length;
    const a = new THREE.Vector3(0, 1, 0), b = new THREE.Vector3(0, 1, 12);
    for (let i = 0; i < MAX_BOLTS * 4; i++) vfx.strike(a, b, { power: 1, life: 0.2 });
    vfx.update(1 / 60);
    assert(scene.children.length === before,
      'firing bolts added objects to the scene — the pool is supposed to be allocated once');
    const alive = vfx.bolts.filter((x) => x.alive).length;
    assert(alive <= MAX_BOLTS, `${alive} bolts alive against a pool of ${MAX_BOLTS}`);
    assert(vfx.bolts.length === MAX_BOLTS, 'the pool grew');
    /* AND IT ALL GOES AWAY. `World.unload` disposes it with the particles. */
    vfx.dispose();
    assert(scene.children.length === before - 2, 'dispose left its meshes in the scene');
    return `${MAX_BOLTS} bolts, 2 draw calls, nothing allocated per strike`;
  });

  check('lightning: World builds it, steps it and disposes it', async () => {
    /* The wiring, because a pool nobody updates draws one frame and freezes,
     * and a pool nobody disposes is the leak `tools/checks/lifecycle.mjs`
     * exists to catch. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert(/this\.lightning\s*=\s*new LightningVfx/.test(code), 'World never builds the lightning pool');
    assert(/this\.lightning\?\.update\(/.test(code), 'World never steps it — it would draw one frame and stop');
    assert(/this\.lightning\?\.dispose\(/.test(code), 'World never disposes it');
    const { world } = await (await import('./_coop.mjs')).bootWorld({
      level: 'colosseum', settings: { quality: 'low' },
    });
    assert(world.lightning, 'a booted world has no lightning pool on it');
    return 'built, stepped and disposed';
  });
}
