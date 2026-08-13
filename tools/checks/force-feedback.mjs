/**
 * SABER — a Force key that refuses has to say so.
 *
 * THE BUG. The player reported "force lightning does nothing when pressed",
 * and it was true. `KeyZ` is in ACTIONS, printed in the Codex and on the pause
 * card, and the call site read
 *
 *     if (input.actHit('lightning') && this.boonMods.lightning) this.forceLightning(ctx);
 *
 * with `forceLightning` then opening on `if (this.force < cost ||
 * this.cooldowns.lightning > 0) return;`. Four different states — not attuned,
 * not enough Force, still recovering, and working — collapsing into two
 * outcomes, one of which is nothing at all happening. There is no way for a
 * player to tell a power they have not unlocked from a power that is broken,
 * and they will report the second one, because that is what it looks like.
 *
 * This project already knows the shape of that bug: `controls.mjs` fails the
 * build for a setting nobody reads, a boon whose only effect is a flag nobody
 * reads, and an action nothing handles. This is the same class one layer in —
 * an action something handles, silently, by declining.
 *
 * The precedent for the fix is already in the tree too. A refused Force lift
 * says TOO HEAVY and names the mass, the cap and the slider that moves it. So:
 * every Force ability that declines, for any reason, notifies with the reason.
 *
 * Both checks fail on the tree they were written against.
 */

import { Player } from '../../src/game/Player.js';
import { ACTIONS } from '../../src/engine/Bindings.js';

let THREE = null;

function bench({ force = 100, boons = {} } = {}) {
  const notices = [];
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    notify: (title, sub) => notices.push({ title, sub }),
    report() {},
  };
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force;
  Object.assign(p.boonMods, boons);
  const ctx = { input: null, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  return { p, world, ctx, notices };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('force: a power that declines says which of its three reasons it was', () => {
    /*
     * Three states per ability, and each one has to produce a DIFFERENT notice.
     * A single "you can't do that" would pass a check that only counted
     * notices, and would be very nearly as useless to the player as silence —
     * "not yet attuned" and "18 Force short" are different problems with
     * different answers.
     */
    const rows = [];

    // 1. not attuned
    {
      const b = bench({ force: 100, boons: { lightning: false } });
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === 1,
        `pressing lightning without the boon produced ${b.notices.length} notices — the key is silent, which is the bug`);
      assert(/attun|boon|draft/i.test(b.notices[0].sub),
        `the refusal says "${b.notices[0].sub}" without telling the player how to get the power`);
      rows.push(`unattuned → "${b.notices[0].sub}"`);
    }
    // 2. not enough Force
    {
      const b = bench({ force: 5, boons: { lightning: true } });
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === 1 && /Force/.test(b.notices[0].sub),
        `pressing lightning at 5 Force produced ${JSON.stringify(b.notices)} — it has to name the cost`);
      assert(/30/.test(b.notices[0].sub) && /5/.test(b.notices[0].sub),
        `the refusal says "${b.notices[0].sub}" without both the cost and what the player has`);
      rows.push(`no force → "${b.notices[0].sub}"`);
    }
    // 3. on cooldown
    {
      const b = bench({ force: 100, boons: { lightning: true } });
      b.p.forceLightning(b.ctx);                       // fires, and starts the cooldown
      const fired = b.notices.length;
      b.world.time = 0.1;
      b.p.forceLightning(b.ctx);
      assert(b.notices.length === fired + 1,
        'pressing lightning again during its own cooldown said nothing');
      assert(/recover|\ds/i.test(b.notices[fired].sub),
        `the cooldown refusal says "${b.notices[fired].sub}" without saying how long`);
      rows.push(`cooldown → "${b.notices[fired].sub}"`);
    }
    // 4. and it fires when it can
    {
      const b = bench({ force: 100, boons: { lightning: true } });
      const before = b.p.force;
      b.p.forceLightning(b.ctx);
      assert(b.p.force < before, 'lightning with the boon and full Force did not fire');
      assert(b.notices.length === 0, `a power that WORKED still complained: ${JSON.stringify(b.notices)}`);
      rows.push(`attuned → fires, ${Math.round(before - b.p.force)} Force`);
    }
    return rows.join('; ');
  });

  check('force: a held key does not turn the refusal into a stutter', () => {
    // 60 refusals a second is a notice nobody reads and a sound nobody can
    // stand. The rate limit is per ability, so two different refusals in the
    // same second still both arrive.
    const b = bench({ force: 0, boons: { lightning: true } });
    for (let i = 0; i < 60; i++) { b.world.time = i / 60; b.p.forceLightning(b.ctx); }
    assert(b.notices.length <= 2,
      `holding the key for a second produced ${b.notices.length} notices`);
    assert(b.notices.length >= 1, 'holding a refusing key for a second said nothing at all');
    const n = b.notices.length;
    b.p.forcePush(b.ctx);
    assert(b.notices.length === n + 1,
      'a DIFFERENT power refusing in the same second was swallowed by the rate limit');
    return `${n} notice(s) for a second of held lightning, and force push still gets its own`;
  });

  check('force: every Force action reaches a handler that can refuse out loud', async () => {
    /*
     * The structural half, so the next power added does not reintroduce the
     * silence. Every id in the Force group has to be read in Player.js, and
     * every method it dispatches to has to be able to reach `_refuse` — an
     * ability whose only early return is a bare `return` is one press away from
     * being reported as broken.
     */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const world = await readFile(new URL('../../src/game/World.js', import.meta.url), 'utf8');
    // `focus` is the one Force action read a layer up rather than in Player: it
    // dilates the WORLD's clock, so World.update owns it and Focus.js spends
    // the meter. Both files count.
    const forceIds = ACTIONS.filter((a) => a.group === 'Force').map((a) => a.id);
    const unread = forceIds.filter((id) =>
      !new RegExp(`act(?:Hit)?\\(\\s*'${id}'`).test(src) && !new RegExp(`act\\(\\s*'${id}'`).test(world));
    assert(!unread.length, `Force actions nothing reads: ${unread.join(', ')}`);
    // the abilities with a cost or a cooldown are the ones that can decline
    const spenders = ['forceLightning', 'forcePush', 'forcePull', 'toggleStasis', 'forceDisassemble'];
    const silent = [];
    for (const name of spenders) {
      const i = src.indexOf(`  ${name}(`);
      if (i < 0) { silent.push(`${name} (gone)`); continue; }
      const body = src.slice(i, i + 1800);
      if (!/_refuse\(/.test(body)) silent.push(name);
    }
    assert(!silent.length,
      `these decline without a word: ${silent.join(', ')} — the player cannot tell them from broken`);
    return `${forceIds.length} Force actions, all read across Player.js and World.js; `
      + `${spenders.length} spenders, all able to say why not`;
  });
}
