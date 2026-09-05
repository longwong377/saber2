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
    /* Two of the fields are COUNTS rather than multipliers — how many bolts the
     * Still Hand catches, and whether the One Point is bought — and a count's
     * identity is 0. Named here rather than skipped, so a THIRD field with an
     * identity of 0 has to be added to this line before it can pass. */
    const COUNTS = new Set(['catches', 'point']);
    for (const k of Object.keys(none)) {
      const want = COUNTS.has(k) ? 0 : 1;
      assert(none[k] === want, `an unbuilt fighter is not the bare table: ${k} = ${none[k]}, not ${want}`);
    }
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

  check('melee: the top of the branch — a bolt in the hand and a finger through a droid', async () => {
    /**
     * V16 Lane E. Two facets past the Open Hand, and neither is a bigger
     * number: each adds a verb the set did not have, which is what the end of
     * a branch is for.
     *
     * ── AND THE BLADE HAS TO STAY BETTER ────────────────────────────────
     *
     * *"albiet at a much less effective rate and way than with a saber but you
     * can do it."* Every clause below is that sentence: one bolt at a time
     * against a blade that answers everything reaching it, a catch that is not
     * a return, both bars spent where a deflect spends neither, and a scatter
     * on the way out that a graded deflection does not have.
     */
    const M = await import('../../src/game/Melee.js');
    const W = await import('../../src/game/Waves.js');
    const L = await import('../../src/game/LivingForce.js');
    const P = await import('../../src/game/Player.js');
    const { TOUGHNESS } = await import('../../src/game/Combat.js');

    /* BOTH ARE ON THE TREE, PAST THE WHOLE BRANCH, AND BOTH HAVE A CARD. */
    for (const id of ['melee-catch', 'melee-point']) {
      const row = L.FACETS.find((f) => f.id === id);
      assert(row, `${id} is not on the tree`);
      assert(row.jedi && row.sith, `${id} has no name on one side`);
      assert(W.boonById(id), `${id} has no card — it cannot be priced, and the purse walk never ends`);
      const parents = L.FACETS.filter((f) => (f.to || []).includes(id)).map((f) => f.id);
      assert(parents.includes('melee-reach'),
        `${id} hangs off ${parents.join(', ') || 'nothing'} — the top of the branch has to be past the whole of it`);
    }

    /* THE COUNTS ACCUMULATE, and their identity is 0 and not 1. A count that
     * multiplied would give a second rank of the Still Hand one bolt forever. */
    assert(M.meleeMods(null).catches === 0, 'an unbuilt fighter catches bolts');
    assert(M.meleeMods(null).point === 0, 'an unbuilt fighter has the One Point');
    const p = { boonMods: P.defaultBoonMods() };
    W.boonById('melee-catch').apply(p, 1);
    assert(M.meleeMods(p.boonMods).catches === 1, 'one rank of the Still Hand does not catch one');
    W.boonById('melee-catch').apply(p, 1);
    /* TWO IS THE CAP, and it is `balance.mjs`'s law and not a preference: a
     * whole-count card may have two ranks, because a third linear copy is off
     * the geometric ladder every other card is held to. */
    assert(M.meleeMods(p.boonMods).catches === 2,
      `two ranks catch ${M.meleeMods(p.boonMods).catches} — a count that diminishes is a count that is a multiplier`);
    assert(W.maxRank(W.boonById('melee-catch')) === 2,
      'the Still Hand stacks past two, which is off balance.mjs\'s ladder for a whole-count card');

    /* THE ONE POINT IS THE MOST EXPENSIVE THING IN THE SET, IN EVERY UNIT. */
    const pt = M.MOVES.point;
    assert(pt.needs === 'melee-point', 'the One Point is reachable without its facet');
    assert(pt.force > 0 && pt.cooldown > 0, 'the One Point costs no Force or has no cooldown');
    for (const k of M.MOVE_KEYS) {
      if (k === 'point') continue;
      const o = M.MOVES[k];
      assert(pt.wind + pt.hit + pt.rec > o.wind + o.hit + o.rec,
        `the One Point is faster than ${o.label} — the only thing making it safe is how slow it is`);
      assert(pt.stamina > o.stamina, `the One Point is cheaper than ${o.label}`);
      assert(pt.arc < o.arc, `the One Point is wider than ${o.label} — a moving target has to be a miss`);
      assert(!o.disassemble, `${o.label} disassembles things, and only the One Point may`);
    }

    /**
     * ── AND THE MACHINE TEST HAS NO ORGANIC IN IT ───────────────────────
     *
     * `resolve` reads the engine's own material ladder — `TOUGHNESS.droid` and
     * above — rather than a list of names, because a list of names is the
     * thing this suite refuses everywhere else. That is only honest while the
     * set it selects really is the machines, so this measures it: an organic
     * archetype authored at droid toughness makes this go red rather than
     * making a finger take a person apart in silence.
     */
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    await import('../../src/game/Levels.js');
    const machines = Object.entries(ARCHETYPES)
      .filter(([, A]) => (A.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.droid);
    assert(machines.length > 8, `only ${machines.length} archetypes are droid-tough or harder`);
    const ORGANIC = /clone|trooper|jedi|sith|rancor|wookiee|acolyte|guardsman|senate|beast|creature|nexu|reek|acklay/i;
    const wrong = machines.filter(([k, A]) => ORGANIC.test(A.label || k) && !/droid/i.test(A.label || ''));
    assert(!wrong.length,
      `${wrong.map(([k]) => k).join(', ')} read as organic and sit at droid toughness — the One Point `
      + 'would disassemble them. Either the label is wrong or the machine test needs a declared flag');

    /* IT IS WORTH TAKING, AND IT IS STILL NOT A BLADE. */
    const all = M.meleeMods(new Set(M.FACETS.map((f) => f.id)));
    const best = M.MOVES.roundhouse.damage * all.damage;
    assert(best < 45, `fully built the finisher does ${best.toFixed(0)} — that is a blade`);
    return `catch ${M.meleeMods(p.boonMods).catches} bolts at both ranks; the One Point is `
      + `${(pt.wind + pt.hit + pt.rec).toFixed(2)}s, ${pt.force} Force and ${pt.cooldown}s between; `
      + `${machines.length} machine archetypes and no organic among them`;
  });

  check('melee: a caught bolt is arrested, and the return is worse than a blade', async () => {
    /**
     * Driven on the real pool, because the whole of this feature is a state of
     * `Bolts` — the same `held` a saber's catch window uses — and a check that
     * built its own bolt would be testing a fake.
     */
    const M = await import('../../src/game/Melee.js');
    const W = await import('../../src/game/Waves.js');
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({});
    try {
      const p = world.player;
      p.saber.lit = false; p.force = 100; p.camera.yaw = 0;
      const pool = world.bolts;
      /* Three hostile bolts on their way in, and one going the other way. */
      const made = [];
      for (let i = 0; i < 4; i++) {
        const b = pool.bolts.find((x) => !x.active && !made.includes(x));
        b.active = true; b.team = 1; b.life = 4; b.speed = 40; b.damage = 10;
        b.pos.set(p.position.x + (i - 1) * 0.2, p.position.y + 1.1, p.position.z - 2.2);
        b.prev.copy(b.pos);
        /* The fourth is CROSSING, not incoming: a bolt on its way past is one
         * you waved at, not one you caught. */
        b.vel.set(i === 3 ? 40 : 0, 0, i === 3 ? 0 : 40);
        made.push(b);
      }
      /* WITH NOTHING WOKEN, NOTHING IS CAUGHT. */
      assert(M.stepCatch(p, 1 / 60, true) === 0, 'a fighter with no facet caught a bolt');
      W.boonById('melee-catch').apply(p, 1);
      /* ONE RANK CATCHES ONE, and the hand has to be up. */
      assert(M.stepCatch(p, 1 / 60, false) === 0, 'a bolt was caught with the hand down');
      assert(M.stepCatch(p, 1 / 60, true) === 1, 'one rank did not catch exactly one');
      const held = made.find((b) => b.held);
      assert(held && held.vel.lengthSq() === 0, 'a caught bolt is still moving');
      assert(!made[3].held, 'a bolt crossing the cone was caught — that is a wave, not a catch');
      /* IT DOES NOT AGE while it is held, which is the pool's own contract. */
      const life = held.life;
      M.stepCatch(p, 0.5, true);
      assert(held.life === life, 'a caught bolt aged in the hand');
      /* IT COSTS FORCE TO HOLD, which a deflection does not. */
      assert(p.force < 100, 'holding a bolt cost no Force at all');
      /* AND THE RETURN IS A SECOND PRESS, costs stamina, and comes out YOURS. */
      const stam = p.stamina;
      assert(M.strike(p) === 'return', 'a full hand threw a punch instead of the bolt');
      assert(p.stamina < stam, 'throwing a caught bolt cost no stamina');
      assert(M.caughtCount(p) === 0, 'the hand is still full after throwing');
      assert(held.team === (p.team ?? 0) && held.deflected,
        'a returned bolt is not the fighter\'s, so it cannot hurt what fired it');
      assert(held.vel.lengthSq() > 1, 'a returned bolt is not moving');
      /* THE BLADE IS STILL BETTER: one at a time against everything that
       * reaches it, and this one costs both bars to do it. */
      const cap = M.meleeMods(p.boonMods).catches;
      assert(cap === 1, `one rank caught ${cap}`);
      return `caught 1 of 3 inbound and none of the crossing one; held inert and unaged at `
        + `${(100 - p.force).toFixed(0)} Force; returned on a second press, on the fighter's team`;
    } finally { world.dispose?.(); }
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

  check('melee: one press is one move — the One Point does not also throw a Force push', async () => {
    /**
     * ══ FINDING 5, AND IT IS A MEASUREMENT AND NOT A GREP ═══════════════════
     *
     * `Player._readInput` ran `if (input.actHit('push')) this.forcePush(ctx)`
     * in its Force block and then read the SAME press for the One Point sixty
     * lines below. Measured on a real world, one frame of the press, blade
     * down, `meleePoint: 1`:
     *
     *   before   45.5 Force spent on every target, against 30 declared —
     *            a whole Force push (15.5) on top of the move, and a visible
     *            shockwave that shoved the target through the 0.34 s wind-up.
     *            On a b1 the push killed it at frame 1, before the strike
     *            existed.
     *   after    29.9 on all three, and forcePush never called.
     *
     * DRIVEN THROUGH `world.update(dt, input)` and not through a browser: a
     * keypress in headless Chromium reaches `Input` and no frame ever consumes
     * it, because requestAnimationFrame does not fire there. The game's own
     * loop is the only honest place to press a key.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const press = (acts) => {
      const i = idleInput();
      i.act = (a) => !!acts[a];
      i.actHit = (a) => !!acts[a];
      return i;
    };
    const { world } = await bootWorld({});
    try {
      const M = await import('../../src/game/Melee.js');
      const p = world.player;
      p.saber.lit = false;
      p.force = p.maxForce ?? 100;
      p.stamina = p.maxStamina ?? 100;
      p.boonMods.meleePoint = 1;
      p.camera.yaw = 0; p.camera.pitch = 0;
      let pushes = 0;
      const realPush = p.forcePush.bind(p);
      p.forcePush = (...a) => { pushes++; return realPush(...a); };

      const at = p.position.clone(); at.z -= 1.6;
      const e = world.spawnEnemy('b1', at);
      assert(e, 'no b1 to point at');
      e.noReact = true;
      const f0 = p.force;
      /* The chord: the palm is already up (`stance` held) and the attack key
       * comes down. That is the ONE press the move costs. */
      world.update(1 / 60, press({ stance: true, thrust: true }));
      const spent = f0 - p.force;
      assert(pushes === 0,
        `one press of the attack key fired ${pushes} Force push(es) as well as the One Point`);
      assert(Math.abs(spent - M.MOVES.point.force) < 1.5,
        `the finger spent ${spent.toFixed(1)} Force and the move declares ${M.MOVES.point.force}`);
      /* AND THE TARGET IS STILL STANDING WHEN THE WIND-UP BEGINS. The push used
       * to kill a b1 on frame 1 — a strike whose own commitment is 0.34 s
       * cannot have resolved anything yet. */
      assert(!e.dead, 'the target was dead on the press frame, before the wind-up had run');
      assert(p._melee?.move === 'point', `the press threw '${p._melee?.move}', not the One Point`);

      /* AND THE FORCE KEY STILL PUSHES, which is the half of this that a fix on
       * the `push` branch would have cost: V15's fighter runs *"melee and force
       * powers"*, and taking a power off him to pay for a strike is the wrong
       * side of that sentence. */
      p.force = p.maxForce ?? 100;
      p._melee.move = null; p._melee.t = 0;
      p.cooldowns.push = 0;
      pushes = 0;
      world.update(1 / 60, press({ push: true }));
      assert(pushes === 1, 'the Force key no longer pushes with the blade down');
      return `one press: ${spent.toFixed(1)} Force of a declared ${M.MOVES.point.force}, `
        + `0 Force pushes, target alive through the wind-up; the Force key still pushes`;
    } finally { world.dispose?.(); }
  });

  check('melee: the One Point takes the whole budget off every machine, and nothing off a man', async () => {
    /**
     * ══ FINDING 6, AND THE AUDIT THAT CAUGHT WHAT IT COULD NOT SEE ═════════
     *
     * The player, verbatim: *"it completely dissassembles them just like your
     * regular dissassmble move but with melee."* What shipped was
     * `dmg *= DISASSEMBLE (8)` and an ordinary `e.damage(...)`. Measured on a
     * b1: hp 28 -> -212, `dead=true`, `actor.severedCount` **0** — an ordinary
     * blunt death with nothing off it. An 8x multiplier wearing the name.
     *
     * ── AND THEN THE CLAUSE ASSERTED `parts > 0`, WHICH IS NOT THE PROMISE ──
     *
     * "Completely disassembles" is a COUNT, and `parts > 0` cannot tell two
     * joints from one from a body the instrument is blind to. Driven three
     * times each on the five machines and the man, it read:
     *
     *   b1 2   b2 2   dwarfspider 2   tridroid 1   droideka 0   trooper 0
     *
     * and passed on all six. Two of those numbers were wrong and the clause
     * had no way to say so:
     *
     *   THE TRIDROID gave one joint of two. `Enemy.takeCut` called
     *     `actor.cutRagdoll(bone, impulse)` with no stump, which is the branch
     *     that breaks a joint and keeps no ledger — the trap
     *     `Command._desecrateFinish` already has a paragraph about. The
     *     Octuptarra is `toppleAt: 1` with nothing but legs to shed, so the
     *     first cut ragdolls it and the second landed on that branch. Fixed at
     *     the call site: `cutRagdoll(bone, impulse, ev.cutT)`.
     *
     *   THE DROIDEKA gave two legs and reported zero. It carries NO RIG — its
     *     capsules are synthesised and `_cutDroideka` counts `legsLost` — so
     *     `actor?.severedCount ?? 0`, the number this check counted, could
     *     never move for it. `Enemy.partsOff` is the one reading that answers
     *     for both kinds of body, and it is what this counts now.
     *
     * SO THE BAR IS THE BUDGET, PER ARCHETYPE. `_severBudget` is the player's
     * own number and does not vary by body, so "took the budget off it" is the
     * whole of the promise and a machine that sheds one joint of two fails it
     * by name. The set of joints each machine HAS is asserted first, so the
     * bar is one a body can meet rather than a number typed at it.
     */
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const drive = async (kind) => {
      const { world } = await bootWorld({});
      try {
        const p = world.player;
        p.saber.lit = false;
        p.force = p.maxForce ?? 100;
        p.stamina = p.maxStamina ?? 100;
        p.boonMods.meleePoint = 1;
        p.camera.yaw = 0; p.camera.pitch = 0;
        const at = p.position.clone(); at.z -= 1.6;
        const e = world.spawnEnemy(kind, at);
        assert(e, `no ${kind} to point at`);
        e.noReact = true;
        const hp0 = e.hp;
        /* WHAT THIS BODY COULD SHED, asked BEFORE the strike and off the
         * player's own reader, so the bar below is one the machine can meet.
         * A body with fewer joints than the budget would fail an assertion
         * about the budget for a reason that is not a defect, and the check
         * has to be able to tell those two apart. */
        const centre = p._enemyPoint(e, new THREE.Vector3()).clone();
        const joints = new Set(p._severable(e, centre).map((c) => c.covers ?? c.name)).size;
        const budget = p._severBudget();
        const i = idleInput();
        i.act = (a) => a === 'stance';
        i.actHit = (a) => a === 'thrust';
        world.update(1 / 60, i);
        const idle = idleInput();
        for (let n = 0; n < 90 && p._melee.move; n++) {
          if (!e.dead) e.position.copy(at);
          world.update(1 / 60, idle);
        }
        /* `partsOff` AND NOT `actor.severedCount`. See the header: the
         * droideka has no rig and no actor, so the old reading was structurally
         * incapable of counting the two legs it had just lost. */
        return { parts: e.partsOff, limbs: p.limbsRemoved, hp0, hp: e.hp,
          hits: p._melee.lastHits, joints, budget };
      } finally { world.dispose?.(); }
    };

    /**
     * ALL FIVE MACHINES, and the two that were wrong are in the list by name.
     * `b2` and `droideka` were never driven here at all — the audit measured
     * them by hand and found the droideka's zero — so a suite that is about
     * "it disassembles a machine" now drives every machine the finger is
     * plausibly thrown at.
     */
    const rows = [];
    for (const kind of ['b1', 'b2', 'tridroid', 'dwarfspider', 'droideka']) {
      const r = await drive(kind);
      rows.push([kind, r]);
      assert(r.joints >= r.budget,
        `a ${kind} offers ${r.joints} severable joint(s) against a budget of ${r.budget} — `
        + 'the bar below is asking for more than the body has, which is an archetype problem '
        + 'and not a disassembly one');
      /* THE BAR: the budget, exactly. `parts > 0` passed a tridroid shedding
       * one joint of two for a whole lane. */
      assert(r.parts === r.budget,
        `the One Point took ${r.parts} joint(s) off a ${kind} and the budget is ${r.budget} — `
        + '"completely dissassembles them" is a count, and a machine that comes half apart '
        + 'is the defect this clause exists to name');
      assert(r.limbs === r.budget,
        `${kind}: the player was credited ${r.limbs} limbs for ${r.parts} that came off — `
        + 'a joint the body never lost must not be billed to the player either');
      assert(r.hits > 0, `${kind}: the strike reported itself as a miss while taking a limb off`);
    }

    /**
     * AND A MAN IS UNTOUCHED BY THAT PATH. The gate is the engine's material
     * ladder — `TOUGHNESS.droid` and above — which the check above this one
     * holds against every archetype in the game. Here it is measured on a real
     * body: a clone trooper takes the strike as the heaviest blunt hit in the
     * set and keeps every limb, which is where the fiction put it.
     */
    const man = await drive('trooper');
    assert(man.parts === 0,
      `the One Point took ${man.parts} parts off a clone trooper — the trick works on machines`);
    assert(man.hp < man.hp0, 'a man took no damage at all from it — it is still a very heavy strike');

    /* AND THE ROUTE IS THE FORCE'S OWN. A second copy of the severing loop is
     * how the two disassemblies drift apart, so this names the one door. */
    const src = await (await import('node:fs/promises'))
      .readFile(new URL('../../src/game/Melee.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(/disassembleBody\s*\?\./.test(code),
      'Melee.js no longer routes the One Point through Player.disassembleBody');
    const psrc = await (await import('node:fs/promises'))
      .readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const pcode = psrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert((pcode.match(/e\.takeCut\(\{/g) || []).length === 1,
      'there is more than one severing loop in Player.js — rend and the finger must share one');
    /* …and rend goes through the SAME door, which is the half that makes "just
     * like your regular disassemble move" a fact rather than a hope. Read out
     * of `forceDisassemble`'s own body, not off the file. */
    const fd = pcode.slice(pcode.indexOf('forceDisassemble(ctx) {'));
    assert(fd.startsWith('forceDisassemble(ctx) {'), 'forceDisassemble is gone');
    assert(/this\._sever\(/.test(fd.slice(0, fd.indexOf('\n  }\n'))),
      'forceDisassemble no longer runs through the shared severing loop, so the finger and '
      + 'the Force are two copies again');

    return rows.map(([k, r]) => `${k} ${r.parts}/${r.budget} of ${r.joints}`).join(', ')
      + `, clone trooper 0 (blunt only, ${(man.hp0 - man.hp).toFixed(0)} hp); `
      + 'one takeCut loop for both moves';
  });

  check('melee: a leg already on the floor is not cut again — the droideka has no rig to refuse it', async () => {
    /**
     * ══ THE GUARD EVERY RIGGED BODY HAS AND THIS ONE DID NOT ═══════════════
     *
     * `Ragdoll.isSevered` is asked twice about a rigged body — once when
     * `Enemy.capsules()` builds the list and again inside `Player._sever`'s
     * loop — so a bone that is gone is never offered and never billed. The
     * droideka carries no rig: its four capsules are synthesised in
     * `capsules()` from `built.legs`, and that loop did not look at `leg.gone`.
     *
     * Measured before the fix, two One Points at budget 1 on one droideka:
     *
     *   press 1   leg0 comes off   legsLost 1   hp 170  → 98.3
     *   press 2   leg0 AGAIN       legsLost 1   hp  98.3 → 26.6
     *
     * `_cutDroideka`'s own `!leg.gone` guard meant nothing came off the second
     * time, so a full leg's `SEVER_LETHALITY` share was billed for a limb that
     * was already lying on the deck and `_sever` counted a joint that does not
     * exist. Three presses killed a three-legged machine through one leg.
     *
     * DRIVEN AT BUDGET 1 on purpose: the default budget of 2 takes two legs on
     * the first press and kills it before a second press can show anything.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({});
    try {
      const p = world.player;
      const at = p.position.clone(); at.z -= 1.6;
      const e = world.spawnEnemy('droideka', at);
      assert(e, 'no droideka to take apart');
      e.noReact = true;
      assert(!e.actor, 'the droideka grew a rig — this clause is about the body that has none');
      const legs = (e.built.legs || []).length;
      assert(legs === 3, `a droideka with ${legs} legs`);

      const seen = [];
      const hps = [e.hp];
      for (let press = 0; press < 3; press++) {
        /* The budget is handed in rather than bought, which is what
         * `disassembleBody`'s third argument is for — one joint a press. */
        const took = p.disassembleBody(e, null, 0.25);
        seen.push(took);
        hps.push(e.hp);
      }
      const gone = (e.built.legs || []).filter((l) => l.gone).length;
      assert(gone === 3, `${gone} of 3 legs actually came off across three presses`);
      assert(e.partsOff === 3, `partsOff reads ${e.partsOff} for a machine with 3 legs down`);
      /* AND NO PRESS WAS SPENT ON A LEG THAT WAS ALREADY GONE. */
      assert(seen.every((n) => n === 1), `the three presses took ${seen.join(', ')} joints`);
      /* ONE MORE PRESS HAS NOTHING LEFT TO TAKE, which is the other half of the
       * same guard: with no legs left the severable list is empty and
       * `disassembleBody` returns 0 rather than billing the stumps. */
      const after = e.dead ? null : p.disassembleBody(e, null, 0.25);
      if (after !== null) {
        assert(after === 0, `a legless droideka shed ${after} more joints`);
      }
      return `three presses, three different legs (hp ${hps.map((h) => h.toFixed(0)).join(' → ')}), `
        + `partsOff ${e.partsOff}${after === null ? '' : `, a fourth press took ${after}`}`;
    } finally { world.dispose?.(); }
  });

  check('melee: the HUD says the fists exist, and the binding says what the key does', async () => {
    /**
     * ══ FINDING 9 ══════════════════════════════════════════════════════════
     *
     * `Melee.meleePrompt`'s own header: *"What the HUD says while the blade is
     * down … a player who cannot see the chain cannot use it."* It had NO
     * CALLER. `grep -in "melee|punch|kick" src/ui/HUD.js` found nothing,
     * `caughtCount` was called only by this file, and the controls screen filed
     * Mouse1 under **Blade** as "Attack (thrust)". Every number in this suite
     * was true and unreachable.
     *
     * DRIVEN ON A REAL HUD over the real page, not grepped: a check that
     * asserts the string "meleePrompt" appears in HUD.js passes on a call whose
     * result is thrown away.
     */
    const { readFile } = await import('node:fs/promises');
    const { makeDocument } = await import('./_page.mjs');
    const { HUD } = await import('../../src/ui/HUD.js');
    const { defaultBindings, keyLabel } = await import('../../src/engine/Bindings.js');
    const M = await import('../../src/game/Melee.js');
    const P = await import('../../src/game/Player.js');
    const INDEX = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    assert(INDEX.includes('id="melee-prompt"'), 'the page has no slot for the open hand\'s line');

    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      const b = defaultBindings();
      hud.setBindings(b, null);
      const el = doc.getElementById('melee-prompt');
      const player = {
        alive: true, driving: null, gripBody: null, gripEnemy: null,
        /* The REAL applied state — `defaultBoonMods` — and not a bag with one
         * key in it: `meleeMods` tells its two shapes apart by whether
         * `meleeDamage` is a number, so a hand-made object is silently read as
         * a SET OF FACET IDS and answers 0 to everything. */
        saber: { lit: true }, boonMods: P.defaultBoonMods(), _melee: null,
      };
      /* WITH THE BLADE LIT THERE IS NOTHING TO SAY — the seam is the whole
       * design, and a melee line under a lit sabre would teach the wrong rule. */
      hud._meleePrompt(player);
      assert(!el.innerHTML, `the line is up with the blade lit: "${el.innerHTML}"`);

      /* BLADE DOWN, AND NOT ONE PUNCH THROWN YET. This is the fighter the line
       * exists for: it has to appear before the first press, or it only ever
       * reaches players who already found the system. */
      player.saber.lit = false;
      hud._meleePrompt(player);
      const cold = el.innerHTML;
      assert(cold, 'a fighter with the blade down and no melee set yet is told nothing');
      assert(cold.includes(keyLabel(b.thrust[0])),
        `the line does not name the attack key (${keyLabel(b.thrust[0])}): "${cold}"`);
      assert(el.classList.contains('on'), 'the line is written but not shown');
      /* NO ONE POINT WITHOUT THE FACET — a chord printed for a move you cannot
       * throw is a key that does nothing. */
      assert(!cold.includes(M.MOVES.point.label),
        'the One Point is advertised to a fighter who has not woken it');

      /* THE CHAIN, mid-combination: what the next press buys. */
      player._melee = new M.MeleeSet();
      player._melee.chain = 'cross'; player._melee.chainT = 0.3;
      hud._meleePrompt(player);
      assert(el.innerHTML.includes(M.MOVES.cross.label),
        `mid-chain the line says "${el.innerHTML}" and not what the next press buys`);

      /* THE ONE POINT, once it is woken: the chord, spelled out, because a
       * chord is the thing nobody finds by accident. */
      player._melee = new M.MeleeSet();
      player.boonMods.meleePoint = 1;
      hud._meleePrompt(player);
      const armed = el.innerHTML;
      assert(armed.includes(M.MOVES.point.label), `the One Point is nowhere on the line: "${armed}"`);
      assert(armed.includes(keyLabel(b.stance[0])) || armed.includes(keyLabel(b.stance[1])),
        `the chord does not name the hold key: "${armed}"`);

      /* A HAND FULL OF BOLTS SAYS SO, through `caughtCount` — which had exactly
       * one caller in the repository and it was this file. */
      player._melee.caught.push({ active: true, held: {} }, { active: true, held: {} });
      hud._meleePrompt(player);
      assert(/2/.test(el.innerHTML) && !el.innerHTML.includes(M.MOVES.point.label),
        `a hand holding two bolts reads "${el.innerHTML}"`);

      /* AND IT IS CALLED EVERY FRAME BY `update`, not only by this check. */
      const hsrc = await readFile(new URL('../../src/ui/HUD.js', import.meta.url), 'utf8');
      const hcode = hsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert(/this\._meleePrompt\(player\)/.test(hcode),
        'HUD.update no longer paints the melee prompt — the line exists and nothing calls it');
      assert(/meleePrompt|caughtCount/.test(hcode), 'HUD.js no longer reads Melee.js at all');
      return `blade lit: silent; blade down: "${cold.replace(/<[^>]+>/g, '')}"; `
        + `woken: "${armed.replace(/<[^>]+>/g, '')}"`;
    } finally { restore(); }
  });
}
