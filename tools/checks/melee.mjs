/**
 * MELEE — and whether it is a fallback or a build.
 *
 * V15 asks for a strike set with five constraints on it, and every one of them
 * is a number that can be wrong in a way nothing else would notice:
 *
 *   "not nearly as strong as the lightsaber"   — so it is held against one.
 *   "wouldn't slice through stuff"             — so nothing here severs.
 *   "blunt damage … noticeable knockback"      — so a struck body MOVES.
 *   "uses more stamina than the lightsaber"    — so it is held against that.
 *   "can be upgraded to be very effective"     — so the branch has to exist
 *                                                and have to be worth taking.
 *
 * The last one is the one a suite normally cannot see: a facet that is on the
 * tree, costs Insight and multiplies nothing is exactly as green as one that
 * works. So the multipliers are read through the same function the game reads
 * them through, and the result is compared against the bare table.
 */

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('melee: the set is a chain, and it opens cheap and ends heavy', async () => {
    const M = await import('../../src/game/Melee.js');
    assert(M.MOVE_KEYS.length >= 4, `only ${M.MOVE_KEYS.length} strikes; V15 asks for kicks AND punches`);
    /* Kicks AND punches — the ask names both, and a set of five punches would
     * satisfy every other assertion in this file. */
    const limbs = new Set(M.MOVE_KEYS.map((k) => (M.MOVES[k].limb.startsWith('foot') ? 'foot' : 'hand')));
    assert(limbs.has('hand') && limbs.has('foot'), 'the set is all one limb — V15 asks for kicks and punches');

    /* THE CHAIN GOES SOMEWHERE, and each step is heavier and slower than the
     * one before it. A chain that ends where it started is one move with four
     * names. */
    const seen = new Set();
    let name = 'jab', last = null, steps = 0;
    while (name && !seen.has(name)) {
      seen.add(name);
      const m = M.MOVES[name];
      assert(m, `the chain names '${name}', which is not a move`);
      if (last) {
        assert(m.damage > last.damage, `${m.label} does not hit harder than ${last.label} (${m.damage} vs ${last.damage})`);
        assert(m.stamina > last.stamina, `${m.label} does not cost more than ${last.label}`);
        assert(m.impulse > last.impulse, `${m.label} does not move them further than ${last.label}`);
        const dur = (x) => x.wind + x.hit + x.rec;
        assert(dur(m) > dur(last), `${m.label} is not slower than ${last.label}, so committing costs nothing`);
      }
      last = m; name = m.next; steps++;
    }
    assert(steps >= 4, `the chain is ${steps} long`);
    assert(!name, 'the chain loops — a finisher that continues is not a finisher');
  });

  check('melee: it is blunt, it is weaker than the blade, and it costs more', async () => {
    const M = await import('../../src/game/Melee.js');
    const src = await (await import('node:fs/promises'))
      .readFile(new URL('../../src/game/Melee.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    /**
     * NOTHING HERE SEVERS. V15: *"wouldn't slice through stuff"*. The slicer
     * is `Slice.js` and the blade reaches it through `Combat`; a grep is the
     * whole test, because the failure would be one import somebody adds when
     * a kick "should probably take an arm off".
     */
    assert(!/\bSlice\b|sever|dismember|\bcut\(/.test(code),
      'Melee.js reaches the slicer — blunt damage does not take limbs off');
    /* And every strike is dealt as `'melee'`, which is the kind `Enemy.damage`
     * already treats differently from a bolt. */
    assert(/'melee'/.test(code), "a strike is not dealt with kind 'melee'");

    /* WEAKER THAN THE BLADE, held against the blade's own numbers rather than
     * against a number typed here. */
    const SC = await import('../../src/game/SaberController.js');
    const heavy = M.MOVES.roundhouse;
    assert(heavy.damage <= 30,
      `the finisher does ${heavy.damage} — a saber cut severs, and "not nearly as strong" is the ask`);

    /* COSTS MORE STAMINA THAN A SABER ATTACK. `Player._readInput` spends 6 on
     * a thrust and 18 on a spin; the CHEAPEST strike has to beat the cheapest
     * of those to make the sentence true at the bottom of the range. */
    const cheapest = Math.min(...M.MOVE_KEYS.map((k) => M.MOVES[k].stamina));
    assert(cheapest >= 5, `the cheapest strike costs ${cheapest}; a saber sweep costs at most 2.4`);
    assert(M.MOVES.roundhouse.stamina >= 12, 'the finisher is cheap enough to spam');

    /* NOTICEABLE KNOCKBACK, which is the clause with a number nobody would
     * otherwise check. A jab nudges; a roundhouse throws. */
    assert(M.MOVES.jab.impulse >= 2, 'a jab does not move them at all');
    assert(heavy.impulse >= 10, `the finisher shoves at ${heavy.impulse} m/s — V15 asks for noticeable`);
    assert(heavy.lift > 0, 'nothing goes over — a shove with no lift is a slide');
    assert(SC.OVERHEAD, 'the saber controller is still there to be compared against');
  });

  check('melee: the Holocron branch exists, and taking it is worth the Insight', async () => {
    const M = await import('../../src/game/Melee.js');
    const L = await import('../../src/game/LivingForce.js');
    const W = await import('../../src/game/Waves.js');
    const ids = new Set(L.FACETS.map((f) => f.id));
    for (const f of M.FACETS) {
      assert(ids.has(f.id), `${f.id} multiplies something and is not on the tree — it cannot be bought`);
      const row = L.FACETS.find((x) => x.id === f.id);
      assert(row.jedi && row.sith, `${f.id} has no name on one side of the tree`);
      /**
       * ── AND A CARD BEHIND IT, WHICH IS NOT A FORMALITY ──────────────────
       *
       * A facet on the lattice with no row in `Waves.BOONS` is unpriceable:
       * `Communion.costOf` answers Infinity, and World.js's `HOLOCRON_PURSE`
       * walks every facet cheapest-first at MODULE SCOPE. Four facets added
       * here without their cards turned that walk into an infinite loop, so
       * importing World.js never returned and the game did not boot — with
       * nothing on the console, because the module had not finished. The gate
       * could not go red because the gate could not load.
       *
       * `living-force.mjs` holds the same property for the whole tree. This
       * says it again for the four this file owns, so the branch cannot ship
       * half-built from here.
       */
      const card = W.boonById(f.id);
      assert(card, `${f.id} has no card in Waves.BOONS — it cannot be priced, and the purse walk never ends`);
      assert(typeof card.apply === 'function', `${f.id}'s card grants nothing`);
    }
    /* REACHABLE from the axis root, which is what stops a facet being on the
     * tree and unreachable — the same defect `Dojo`'s eleventh lesson was. */
    const reach = new Set(['attune-body']);
    for (let pass = 0; pass < 8; pass++) {
      for (const f of L.FACETS) if (reach.has(f.id)) for (const t of f.to || []) reach.add(t);
    }
    for (const f of M.FACETS) assert(reach.has(f.id), `${f.id} is on the tree and cannot be reached from attune-body`);

    /**
     * AND IT ACTUALLY DOES SOMETHING. A facet that costs Insight and
     * multiplies 1.0 is exactly as green as one that works, which is §2.3b's
     * check-that-cannot-fail in its most expensive form — the player pays for
     * it. So the mods are read through the game's own function.
     */
    const none = M.meleeMods(null);
    for (const k of Object.keys(none)) assert(none[k] === 1, `an unbuilt fighter is not the bare table: ${k} = ${none[k]}`);
    const all = M.meleeMods(new Set(M.FACETS.map((f) => f.id)));
    assert(all.damage > 1.3, `the whole branch buys only ${all.damage}x damage`);
    assert(all.stamina < 0.8, `the whole branch buys only ${all.stamina}x stamina`);
    assert(all.reach > 1.1 && all.speed > 1.1, 'the branch does not buy reach or speed');
    /* …and each facet on its own buys something. */
    for (const f of M.FACETS) {
      const one = M.meleeMods(new Set([f.id]));
      const moved = Object.keys(one).filter((k) => one[k] !== 1);
      assert(moved.length > 0, `${f.id} ("${f.name}") multiplies nothing at all`);
    }
    /* Even fully built it does not become a blade. */
    const best = M.MOVES.roundhouse.damage * all.damage;
    assert(best < 45, `fully built the finisher does ${best.toFixed(0)} — that is a blade`);

    /**
     * ── AND THE ROUTE THE GAME ACTUALLY TAKES ───────────────────────────
     *
     * Everything above reads the bare table through a set of ids. A real
     * fighter does not have one: a bought card calls `apply(p)`, which moves
     * `boonMods`, and `meleeMods` reads THAT. A branch that is right in the
     * table and inert in `boonMods` would pass every assertion above it.
     */
    const P = await import('../../src/game/Player.js');
    const p = { boonMods: P.defaultBoonMods(), maxHp: 100, hp: 100, saber: { bladeLength: 1 } };
    assert(M.meleeMods(p.boonMods).damage === 1, 'a fresh fighter already carries the branch');
    for (const f of M.FACETS) W.boonById(f.id).apply(p, 1);
    const built = M.meleeMods(p.boonMods);
    for (const k of Object.keys(built)) {
      assert(Number.isFinite(built[k]), `${k} came back ${built[k]} — a card wrote a key Player never declared`);
    }
    assert(Math.abs(built.damage - all.damage) < 1e-9,
      `the cards buy ${built.damage}x damage and the table says ${all.damage}x`);
    assert(Math.abs(built.stamina - all.stamina) < 1e-9, 'the cards and the table disagree on stamina');
    /* A SECOND RANK IS WORTH SOMETHING, and less than the first — which is the
     * whole reason the runtime reads boonMods rather than the id set. */
    const one = M.meleeMods(p.boonMods).damage;
    W.boonById('melee-weight').apply(p, W.rankScale ? W.rankScale(2) : 0.6);
    const two = M.meleeMods(p.boonMods).damage;
    assert(two > one, 'a second rank of Falling Stone buys nothing');
    assert(two - one < one - 1, 'a second rank is worth as much as the first — ranks do not diminish');
  });

  check('melee: a strike runs, resolves once, and costs what it says', async () => {
    const M = await import('../../src/game/Melee.js');
    /* A fighter, with only the fields the set reads. Not a whole World: this
     * is arithmetic and a cone test, and a headless World would make the check
     * slower without making it truer. */
    const hit = [];
    const struck = {
      dead: false, hp: 100, maxHp: 100, position: new THREE.Vector3(0, 0, -1.2),
      hipHeight: 0.95, radius: 0.4,
      body: { velocity: new THREE.Vector3() },
      damage(n, p, src, kind) { hit.push({ n, kind }); this.hp -= n; return true; },
    };
    const far = { ...struck, position: new THREE.Vector3(0, 0, -9), damage() { hit.push({ far: true }); return true; } };
    const behind = { ...struck, position: new THREE.Vector3(0, 0, 1.2), damage() { hit.push({ behind: true }); return true; } };
    const player = {
      position: new THREE.Vector3(0, 0, 0), stamina: 100, maxStamina: 100,
      saber: { lit: false }, camera: { yaw: 0 },
      world: { enemies: [struck, far, behind] },
    };

    const name = M.strike(player);
    assert(name === 'jab', `the first strike is '${name}', not the opener`);
    assert(player.stamina === 95, `a jab cost ${100 - player.stamina}, not 5`);
    /* IT DOES NOT CANCEL ITSELF. */
    assert(M.strike(player) === null, 'a second press cancelled the first strike');

    /* Run it out one frame at a time and count how many times it resolved. */
    for (let i = 0; i < 120 && player._melee.move; i++) M.stepMelee(player, 1 / 60);
    const real = hit.filter((h) => !h.far && !h.behind);
    assert(real.length === 1, `the strike resolved ${real.length} times — damage must not be a function of frame rate`);
    assert(real[0].kind === 'melee', `dealt as '${real[0].kind}'`);
    assert(!hit.some((h) => h.far), 'it reached something 9 m away');
    assert(!hit.some((h) => h.behind), 'it hit something behind the fighter');
    assert(struck.body.velocity.length() > 1,
      `the struck body moved ${struck.body.velocity.length().toFixed(2)} m/s — V15 asks for noticeable knockback`);
    assert(struck.body.velocity.y > 0, 'the shove has no lift in it');

    /* THE CHAIN IS OPEN, and the next press is the next move. */
    assert(player._melee.chain === 'cross', `the chain offers '${player._melee.chain}'`);
    assert(M.strike(player) === 'cross', 'the chain did not continue');

    /* …and it closes. A player who waits starts again at the opener. */
    player._melee.move = null; player._melee.chain = 'hook'; player._melee.chainT = 0.01;
    M.stepMelee(player, 0.5);
    assert(M.strike(player) === 'jab', 'the chain window never closes');
  });

  check('melee: the blade is the switch, and stamina is the floor', async () => {
    const M = await import('../../src/game/Melee.js');
    const base = () => ({
      position: new THREE.Vector3(), stamina: 100, maxStamina: 100,
      saber: { lit: false }, camera: { yaw: 0 }, world: { enemies: [] },
    });
    /* WITH THE BLADE LIT, NOTHING COMES OUT. That is the whole seam: one key,
     * one meaning at a time, and `thrust` with a blade is a stab. */
    const armed = base(); armed.saber.lit = true;
    assert(M.strike(armed) === null, 'a strike came out with the blade lit');
    /* …and exhausted, nothing comes out either. */
    const tired = base(); tired.stamina = 1;
    assert(M.strike(tired) === null, 'a strike came out on one point of stamina');
    /* …but a fighter with a little left can still throw the opener, because an
     * input that does nothing is worse than a weak punch. */
    const low = base(); low.stamina = M.MIN_STAMINA + 0.5;
    assert(M.strike(low) === 'jab', 'a fighter above the floor could not throw the opener');
  });

  check('melee: Player wires it to the blade being down, and nothing else', async () => {
    const src = await (await import('node:fs/promises'))
      .readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(/meleeStrike\(this\)/.test(code), 'nothing in Player.js throws a strike');
    /* NO NEW BINDING. `controls.mjs` refuses one, and V15's set is reachable
     * because `thrust` means two things depending on the blade — which is the
     * pattern `swap`, `drive`, `hurl` and `throw` already use. */
    const B = await import('../../src/engine/Bindings.js');
    const acts = Object.keys(B.DEFAULTS || B.BINDINGS || {});
    assert(!acts.includes('melee') && !acts.includes('punch') && !acts.includes('kick'),
      'a melee binding was added — one key with two meanings is the pattern here');
    /* The strike is posed AFTER the animator, or the gait overwrites it. */
    const iAnim = code.indexOf('this.animator.update(');
    const iPose = code.indexOf('poseMelee(this)');
    assert(iAnim > 0 && iPose > iAnim,
      'poseMelee runs before the animator, so the gait overwrites the punch on the frame it is thrown');
  });
}
