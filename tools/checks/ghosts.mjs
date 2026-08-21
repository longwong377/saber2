/**
 * BATTLEFIELD BORZ — A LIVING BODY DRAWS SOMETHING, AND A HOLD ENDS.
 *
 * The player, twice now, across builds:
 *
 *   "troops go completely invisible a lot like I see their names above their
 *    heads but they're invisible, I can still throw them around though"
 *
 * Read as one sentence it names three states at once, and that is the whole of
 * the diagnosis: something is ALIVE (the roster draws a nameplate only for a
 * living record), DRAWING NOTHING, and STILL A PHYSICAL BODY (you can throw
 * it). Nothing in the game is supposed to be able to be all three.
 *
 * TWO DEFECTS, and they are separate — the second was found while looking for
 * the first and is the one that will outlive it.
 *
 * ── 1. THE HOLD THAT NEVER ENDED ─────────────────────────────────────────
 *
 * `Enemy.gripped` was a latch. Three places wrote it true and exactly one
 * wrote it false: `Player.releaseGrip`. Every other way a hold can end —
 * the gripper dying with a body in the air, a level rotating under it, a
 * co-op peer's Player being disposed — left it true for the rest of the
 * level, and a body carrying it is out of its brain (`_think` returns on
 * `gripped`), out of `_tickGetUp` (so it never stands up again), still
 * suspended by `_move` at a `liftTarget` that is the gripper's own live
 * vector, and still a capsule you can shove. `Enemy.hold()` is a LEASE:
 * the holder renews it every frame and a hold nobody is asserting expires.
 *
 * ── 2. THE INVARIANT, WHICH IS THE PART THAT MATTERS ─────────────────────
 *
 * Six systems write a body's visibility and none of them knows about the
 * others: the ragdoll (swap the rig for holders and back), the LOD (hide
 * detail by range), a cut (hide a severed subtree), `Corpses.fade` (make
 * every material transparent and wind it to zero), `Ink`'s prepass (hide
 * transparent objects for one render), and first person (hide the parts of
 * a body you are inside). Every one is a hide with its show somewhere else.
 * A missed show is therefore a SHAPE of bug rather than one bug, which is
 * why this report keeps coming back after each individual road is closed.
 *
 * `Enemy._auditVisible` asks the invariant three times a second instead of
 * arguing about the roads: if a living body is drawing nothing, put its
 * silhouette back and count it on `world.ghostFixes`. The last check here is
 * the one that keeps that honest — a real fight has to repair NOTHING, or
 * the audit is a paper over a defect rather than a net under one.
 */

import * as THREE from 'three';

export async function run({ check, assert }) {
  const boot = async (settings = {}) => {
    const H = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(23);
    const { world } = await H.bootWorld({
      level: 'colosseum',
      settings: { mode: 'waves', quality: 'low', instantSpawn: true, ...settings },
    });
    const at = (i) => {
      const p = world.player.position;
      const x = p.x + 3 + i * 2, z = p.z - 3;
      return new THREE.Vector3(x, world.terrain.height(x, z), z);
    };
    return { world, input: H.idleInput(), at };
  };

  check('ghosts: a hold outlives nothing — the gripper dies and the body gets up', async () => {
    /**
     * THE MEASUREMENT IS THE PLAYER'S OWN THREE STATES. Twelve seconds after
     * a gripper dies mid-lift the body must be upright, drawing, and back in
     * its brain. On the latch this was: limp for ever, rig hidden, `gripped`
     * true, and still following the player's `_liftPoint` around the level.
     */
    const { world, input, at } = await boot();
    const p = world.player;
    const e = world.spawnEnemy('b1', at(0));
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    /* Held the way a grip holds it, through the shipped door. */
    e.hold();
    e.actor.goRagdoll(e.velocity.clone(), null);
    p.gripEnemy = e;
    assert(e.gripped && e.actor.ragdolled, 'the body is not held and limp to begin with');
    /* …and the gripper goes away without ever calling release. This is the
     * defect's real cause and not a contrivance: `Player.die` does not release
     * its grip, and neither does `World.unload`, `rotateTo` or a peer's
     * disposal. */
    p.hp = 0; p.alive = false;
    for (let i = 0; i < 60 * 12; i++) world.update(1 / 60, input);
    assert(!e.dead, 'the body died on its own, so this measured nothing');
    assert(!e.gripped, 'the hold outlived the gripper — this is the latch');
    assert(!e.actor.ragdolled,
      'the body is still limp twelve seconds after nothing was holding it. `_tickGetUp` returns early '
      + 'on `gripped`, so a stuck hold is a body that never stands up again');
    assert(e._anyVisibleMesh(), 'the body is drawing nothing');
    assert(!e.liftTarget, 'it is still being suspended at a lift point nobody is driving');
    return 'held, abandoned, and on its feet 12 s later';
  });

  check('ghosts: a hold renewed every frame does not lapse under the player', async () => {
    /* THE OTHER SIDE OF THE LEASE, and the reason it is a lease rather than a
     * timeout: a player who holds a body for a minute must still be holding it
     * at the end of the minute. Without this the fix would be a new defect
     * with better manners. */
    const { world, input, at } = await boot();
    const p = world.player;
    p.force = p.maxForce = 4000;
    const e = world.spawnEnemy('b1', at(0));
    /* IT MUST NOT DIE OF THE HOLD, which is what makes this measurable at all:
     * a grip CHOKES, and a B1 held at the throat is dead in 2.1 s — so a check
     * that simply counted seconds would be measuring the choke and calling it
     * a lease. The choke bills a FRACTION of `maxHp` per second, so a bigger
     * pool does not buy a longer measurement; the health is put back every
     * frame instead, and then the only thing that can end this hold is the
     * lease itself. */
    for (let i = 0; i < 10; i++) world.update(1 / 60, input);
    const ctx = { input, physics: world.physics, terrain: world.terrain, particles: world.particles };
    p.gripEnemy = e;
    e.hold();
    p.gripDistance = 6;
    p._liftPoint.copy(e.position).setY(e.position.y + 2);
    let held = 0;
    for (let i = 0; i < 60 * 20; i++) {
      e.hp = e.maxHp;                       // see above: the choke must not decide this
      world.update(1 / 60, input);
      if (!p.gripEnemy) break;
      p._updateGrip(1 / 60, ctx);
      if (e.gripped) held++;
    }
    assert(held > 60 * 19,
      `the hold lapsed after ${(held / 60).toFixed(1)} s of a gripper renewing it every frame`);
    return `${(held / 60).toFixed(0)} s of unbroken hold`;
  });

  check('ghosts: nothing writes `gripped` behind the lease', async () => {
    /**
     * THE STRUCTURAL HALF. A lease works only while every holder goes through
     * the one door; a single `e.gripped = true` somewhere else is a body that
     * can be stranded again, and it would pass every behavioural check above
     * because it is a path none of them takes.
     *
     * `Enemy.hold` and `Enemy.releaseHold` are the door, and the constructor's
     * own initialiser is not a write in this sense.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const root = new URL('../../src/', import.meta.url);
    const walk = async (dir) => {
      const out = [];
      for (const d of await readdir(dir, { withFileTypes: true })) {
        const u = new URL(d.name + (d.isDirectory() ? '/' : ''), dir);
        if (d.isDirectory()) out.push(...await walk(u));
        else if (d.name.endsWith('.js')) out.push(u);
      }
      return out;
    };
    const strays = [];
    for (const u of await walk(root)) {
      const src = await readFile(u, 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const m of code.matchAll(/(\w[\w.?]*)\.gripped\s*=\s*(true|false)/g)) {
        /* `this.gripped` inside Enemy itself is the initialiser and the door. */
        if (m[1] === 'this' && u.pathname.endsWith('/Enemy.js')) continue;
        strays.push(`${u.pathname.split('/src/')[1]}: ${m[0]}`);
      }
    }
    assert(strays.length === 0,
      `${strays.length} writer(s) set \`gripped\` without a lease — ${strays.join(' · ')}. Use `
      + '`Enemy.hold()` and `Enemy.releaseHold()`; a latch is what stranded the body in the first place');
    return 'one door in, one door out';
  });

  check('ghosts: every way to strand a body is healed within a second', async () => {
    /**
     * FIVE STRANDINGS, one per system that hides things, and none of them is
     * hypothetical: each is the state that system leaves a body in when its
     * matching show is missed.
     *
     * The point of doing all five is that the audit does not know which one it
     * is looking at. It asks whether anything is drawn and, if not, puts the
     * silhouette back — so a sixth way to hide a body, written next year by
     * somebody who has not read any of this, is covered by the same net.
     */
    const { world, input, at } = await boot();
    const CASES = {
      'the ragdoll left the switch down': (e) => { e.rig.root.visible = false; },
      'the root was never re-added': (e) => { e.rig.root.parent.remove(e.rig.root); },
      'a corpse fade with no inverse': (e) => {
        e.rig.root.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m) { m.transparent = true; m.opacity = 0; }
          }
        });
      },
      'a prepass that hid and did not show': (e) => {
        e.rig.root.traverse((o) => { if (o.isMesh) o.visible = false; });
      },
      'limp, with the holders orphaned': (e) => {
        e.actor.goRagdoll(e.velocity.clone(), null);
        for (const h of e.actor.holders.values()) h.parent?.remove(h);
      },
    };
    const bodies = Object.keys(CASES).map((k, i) => [k, world.spawnEnemy('b1', at(i))]);
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);
    for (const [k, e] of bodies) {
      assert(e._anyVisibleMesh(), `${k}: the body was not drawing before it was stranded`);
      CASES[k](e);
      assert(!e._anyVisibleMesh(), `${k}: the stranding did not actually hide the body`);
    }
    const before = world.ghostFixes;
    /* A SECOND, because `AUDIT_EVERY` is a third of one and the phase is
     * jittered per body — see its note. Any body still missing after three
     * audit windows is a body the audit cannot see. */
    for (let i = 0; i < 60; i++) world.update(1 / 60, input);
    const still = bodies.filter(([, e]) => !e._anyVisibleMesh()).map(([k]) => k);
    assert(still.length === 0, `${still.length} body(s) still invisible after a second: ${still.join(' · ')}`);
    assert(world.ghostFixes - before === bodies.length,
      `${world.ghostFixes - before} repairs counted for ${bodies.length} stranded bodies`);
    return `${bodies.length} strandings, all drawing again inside 1 s`;
  });

  check('ghosts: a real fight repairs nothing at all', async () => {
    /**
     * THE ONE THAT KEEPS THE OTHERS HONEST. An audit that forces meshes back on
     * is a hazard: it could undo the LOD's own culling, un-hide a severed limb,
     * or re-show the head first person hides. If it fires during ordinary play
     * it is fighting a system that was right, and `ghostFixes` is exactly the
     * instrument for saying so.
     *
     * Forty seconds of a real wave with bodies dying, ragdolling, being cut and
     * being thrown, and the number has to stay at zero.
     */
    const { world, input, at } = await boot();
    const p = world.player;
    const list = [];
    for (let i = 0; i < 6; i++) list.push(world.spawnEnemy(i % 2 ? 'b1' : 'trooper', at(i)));
    let rr = 99991;
    const rand = () => ((rr = (rr * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let f = 0; f < 30 * 40; f++) {
      world.update(1 / 30, input);
      if (f % 20) continue;
      const live = world.enemies.filter((e) => !e.dead);
      if (!live.length) break;
      const e = live[Math.floor(rand() * live.length) % live.length];
      const k = Math.floor(rand() * 4);
      if (k === 0) e.damage?.(1e4, e.position.clone(), p, 'probe');
      else if (k === 1) e.actor?.goRagdoll?.(e.velocity.clone(), null);
      else if (k === 2) e.applyKnockback?.(new THREE.Vector3((rand() - 0.5) * 30, 10, (rand() - 0.5) * 30), 9, p, true);
      else { e.hold(); e.actor?.goRagdoll?.(e.velocity.clone(), null); }
    }
    assert(world.ghostFixes === 0,
      `${world.ghostFixes} bodies had to be put back on screen during ordinary play. Either the audit is `
      + 'firing on a system that was right, or there is a live defect it is papering over — both are '
      + 'worth stopping for');
    return `40 s, ${world.enemies.length} bodies, 0 repairs`;
  });
}
