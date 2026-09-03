/**
 * BATTLEFRONT BORZ — the Living Force: a skill tree that is not a lie.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS SUITE IS DEFENDING AGAINST
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This codebase's signature bug is a feature that looks shipped and is a
 * parameter nobody reads: `skinColor` was an argument nothing passed, Cleaving
 * Throw set a flag with no reader, `scoreboard` was bound and handled by
 * nobody, and `q.grass` sat in the quality table from the foundation commit
 * with no consumer at all.
 *
 * A SKILL TREE IS THE PERFECT HOST FOR THAT BUG. It is thirty or forty nodes,
 * each with a name, an icon, a price and a promise, and the promise is a
 * sentence in a data table. Nothing about a node that does nothing LOOKS
 * different from a node that works: it lights up, it charges you, it appears in
 * your build, and the number it moved is read by no line of code in the game.
 * A tree can be nine tenths dead and read perfectly well as source.
 *
 * So the rule for this suite is that a node is proven BEHAVIOURALLY — by
 * driving the real Player, the real Enemy and the real damage path, and
 * measuring the difference between a run that took the facet and one that did
 * not. No check below is satisfied by a flag being set. Where a card's whole
 * effect is a technique (a barrier, a reflection, an aura on somebody else),
 * the check installs it on a real prototype, runs frames, and reads the
 * consequence out of health, damage or a modifier the game already consults.
 *
 * The structural checks that remain are the ones a behavioural test cannot
 * express: that the lattice is exactly the boon table (so a card cannot be
 * added and be invisible, or a facet exist with no mechanism behind it), that
 * the
 * economy cannot outrun the draft it sits beside (arithmetic, at every wave out
 * to 60, because a stochastic depth number would fail on honest tuning), and
 * that the meditation cannot strand the player (driven against the real
 * Screens, which is where that guarantee lives).
 *
 * Every check here fails on the tree that came before this one: the module is
 * imported by name in the first check and every later one asserts on something
 * that had no code at all.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import * as Waves from '../../src/game/Waves.js';
import { Player, defaultBoonMods } from '../../src/game/Player.js';
import { Screens, LIVE } from '../../src/ui/Screens.js';
import { ORDER_IDS } from '../../src/game/Order.js';
import { functionBody } from './_source.mjs';
import { DojoDirector, LESSONS } from '../../src/game/Dojo.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { makeDocument } from './_page.mjs';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const src = (p) => new URL('../../src/' + p, import.meta.url);
const read = (p) => readFile(src(p), 'utf8');

/**
 * ENEMY, ON ITS OWN COPY OF ITS OWN RANDOM STREAM.
 *
 * `Enemy.js` opens with `const rng = makeRng(4711)`, and a body's speed carries
 * a jitter drawn from it at construction. That makes the module's rng PHASE
 * shared state between every suite in this process, and at least one existing
 * check depends on it: escalation.mjs drives two b1s and compares the ground
 * they cover, with the comment "both are b1s with the same speed jitter seed
 * order, so the ratio is the buff". This suite spawns a couple of dozen bodies
 * before that one runs, and every one of them advances the phase — measured:
 * a rallied body covered 1.69 m against a plain 1.31 m alone, and 1.53 vs 1.47
 * with this suite ahead of it, which fails a check about an aura this file does
 * not touch.
 *
 * A cache-busting specifier gives this suite its OWN instance of the module,
 * with its own rng at its own seed. Everything Enemy imports resolves to the
 * modules already loaded — only Enemy.js is duplicated — so the bodies behave
 * identically and the shared stream is left exactly where it was found.
 */
let Foe = null;

/* ── fixtures ────────────────────────────────────────────────────────── */

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {},
});

/** A world wide enough for real Enemies, their rigs and their deaths. */
function gameWorld() {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  return {
    scene: new THREE.Scene(), physics, terrain: physics.terrain,
    difficulty: DIFFICULTY.knight, players: [], enemies: [], props: [],
    settings: {}, engine: { flash() {}, setRadial() {}, hurt() {} },
    particles: null, time: 0, kills: 0, booms: 0,
    addHitstop() {}, report() {}, notify() {}, notifyFloating() {},
    onExplosion() {}, onLimbSevered() {}, onEnemyKilled() { this.kills++; },
    onHitmark() {}, spawnDebrisGroup() {},
  };
}

function spawnFoe(world, type = 'b1', at = V(0, 0, 0)) {
  const e = new Foe.Enemy(world, type, at);
  world.enemies.push(e);
  return e;
}

/**
 * A player whose `damage`, `heal` and `die` are Player's OWN.
 *
 * `Object.create(Player.prototype)` rather than a bag of fields, for the reason
 * controls.mjs gives: the technique layer wraps `damage` and `update`, and what
 * has to be proven is that the wrapper sits in front of the SHIPPING function.
 * A hand-written `damage` would prove that the wrapper sits in front of the
 * test's own arithmetic, which is not the claim. `update` is stubbed because
 * the real one needs a renderer, an input device and a level — the seam is
 * still real (boonTick wraps whatever is there), and the ticks are what is
 * being measured.
 */
function livePlayer(world, over = {}) {
  const p = Object.assign(Object.create(Player.prototype), {
    world, isLocal: true, alive: true, invuln: 0, hitFlash: 0, staggerTimer: 0,
    hp: 120, maxHp: 120, stamina: 100, maxStamina: 100, force: 100, maxForce: 100,
    flow: 0, combo: 0, kills: 0, deflects: 0, perfects: 0, limbsRemoved: 0, score: 0,
    position: V(0, 0, 0), chest: V(0, 1.3, 0), velocity: V(0, 0, 0), grounded: true,
    // NOT `difficulty` — Player exposes it as a getter onto the world, which is
    // itself the thing being exercised: every damage guard re-derives the same
    // `damageTaken` scale to decide what it is looking at.
    camera: { addShake() {} },
    control: { deadzone: 0.24, sensitivity: 1 },
    saber: { bladeLength: 1.15, coreWidth: 1 },
    /* THE BARRIER, DOWN — `Player.damage` asks it whether the blow is being
     * blunted, so a fixture without the state throws on every hit. Shape from
     * the constructor in src/game/Player.js; see `SHIELD` there. */
    shield: { up: false, t: 0, power: 0, stopped: 0, lastHit: -99 },
    boonMods: defaultBoonMods(),
    update() {},
    ...over,
  });
  world.players.push(p);
  /**
   * …AND THE RECEIVER, because World.spawnPlayer installs it on every local
   * player whether or not that player holds a bond card — see the note there.
   * A fixture without it would test an aura that lands on nobody and pass, so
   * the check below asserts that spawnPlayer really does this; the two must not
   * drift apart.
   */
  Waves.boonTick(p, 'bond-in', Waves.bondReceive);
  Waves.boonGuard(p, 'bond-in', Waves.bondGuardIn);
  return p;
}

const boon = (id) => {
  const b = Waves.BOONS.find((x) => x.id === id) || Waves.ATTUNEMENTS.find((x) => x.id === id);
  if (!b) throw new Error(`no boon "${id}" in the tables`);
  return b;
};
const take = (p, id, ranks = 1) => {
  const b = boon(id);
  for (let r = 1; r <= ranks; r++) b.apply(p, Waves.rankScale(r));
  return b;
};
/** `frames` of the player's own tick chain. */
const tick = (p, frames = 1, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) {
    if (p.world) p.world.time += dt;
    p.update(dt, { dt });
  }
};

/** The nine facets this round added, and the instance field each one writes. */
const NEW_FACETS = [
  ['thorns', '_thornsShare'], ['aegis', '_aegisMax'], ['momentum', '_momentumPer'],
  ['execute', '_executeAt'], ['detonate', '_detonate'], ['communion', '_bondEdge'],
  ['suffusion', '_bondHeal'], ['vow', '_bondWard'], ['unity', '_bondMastery'],
];

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  await initPhysics();
  Foe = await import('../../src/game/Enemy.js?living-force');

  let Tree = null, treeErr = null;
  try { Tree = await import('../../src/game/LivingForce.js'); } catch (e) { treeErr = e; }

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. The lattice is the boon table, arranged                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: the lattice is the boon table and nothing else', () => {
    assert(Tree, `there is no src/game/LivingForce.js: ${treeErr?.message || 'missing'} — `
      + 'the run has no spine but a flat list of cards');
    const all = [...Waves.BOONS, ...Waves.ATTUNEMENTS];
    const ids = new Set(all.map((b) => b.id));
    const facets = Tree.FACETS;
    const facetIds = new Set(facets.map((s) => s.id));
    assert(facetIds.size === facets.length,
      `${facets.length - facetIds.size} facet(s) appear twice — a card in two places is two prices`);
    // The property that stops the tree from silently going stale: a card added
    // to BOONS and forgotten here would be draftable and invisible in the one
    // screen that claims to show the whole system.
    const homeless = [...ids].filter((i) => !facetIds.has(i));
    assert(!homeless.length,
      `cards with no facet: ${homeless.join(', ')} — the Holocron claims to be the whole system and is not`);
    // …and the reverse: a facet with no boon behind it is a node that grants
    // nothing at all, which is exactly the bug this suite exists for.
    const ghosts = [...facetIds].filter((i) => !ids.has(i));
    assert(!ghosts.length, `facets with no card behind them: ${ghosts.join(', ')}`);
    for (const s of facets) {
      for (const t of s.to) assert(facetIds.has(t), `${s.id} is joined to "${t}", which is not a facet`);
      assert(Tree.currentOf(s.axis), `${s.id} stands in "${s.axis}", which is not a current`);
    }
    return `${facets.length} facets over ${Tree.CURRENTS.length} currents, `
      + `one per card across ${Waves.BOONS.length} boons and ${Waves.ATTUNEMENTS.length} attunements`;
  });

  check('living force: every facet can be walked to from its own heart', () => {
    assert(Tree, 'no Living Force module');
    const rows = [];
    for (const c of Tree.CURRENTS) {
      const mine = Tree.facetsOf(c.axis).map((s) => s.id);
      assert(mine.includes(c.root), `${c.axis}'s root "${c.root}" does not stand in it`);
      assert(Tree.isRoot(c.root), `${c.root} is not marked a root`);
      // Breadth-first over the lines, exactly as the reachability rule walks
      // them. An unreachable facet is one that can only ever be DRAFTED — the
      // tree would show it, price it, and refuse it forever.
      const seen = new Set([c.root]);
      const q = [c.root];
      while (q.length) {
        for (const n of Tree.neighboursOf(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
      const orphans = mine.filter((i) => !seen.has(i));
      assert(!orphans.length,
        `${orphans.join(', ')} cannot be reached from ${c.root} by any path — nothing but a draft can ever wake them`);
      // and the heart must be something that never runs out, or a current
      // can be closed off by exhausting its only entrance
      const b = Waves.boonById(c.root);
      assert(Waves.maxRank(b) >= 3,
        `${c.root} is the heart of ${c.axis} and caps at ${Waves.maxRank(b)} rank(s)`);
      rows.push(`${c.axis}:${mine.length}`);
    }
    return rows.join(' ');
  });

  check('holocron: every facet is reachable from its own root, and the plate reads top to bottom', () => {
    assert(Tree, 'no Living Force module');
    /**
     * WHAT THIS CHECK USED TO BE, AND WHY IT IS NOT THAT ANY MORE.
     *
     * There were two here, and both were assertions about a DRAWING: no two
     * facets within 44 px of each other, none outside its current's zone, and
     * a `viewBox` in index.html that had to equal `LATTICE`. All three were the
     * right assertions while the Holocron was a node graph with hand-placed
     * coordinates — the first hand-placed table had four cross-current pairs
     * within 40 px and put one facet sixty pixels below the bottom edge,
     * invisible and buyable by nothing.
     *
     * The graph is gone. The player asked three times ("get fucking rid of it
     * and redo the whole thing, also make it less confusing") and the Holocron
     * is six PLATES of stacked rungs — rows in a column. Rows cannot overlap
     * and a row cannot fall off a plate, so every failure mode those checks
     * guarded is gone by construction rather than by assertion, and `LATTICE`,
     * `ZONE`, `zoneOf`, `positionOf` and the `dx`/`dy` on every facet went with
     * them.
     *
     * WHAT SURVIVES IS THE PROPERTY UNDER THE GEOMETRY, and it is the one that
     * actually mattered: a facet nothing joins is a facet no player can ever
     * reach — priced, drawn, and unbuyable. The old check caught that case by
     * accident, as "drawn in the wrong place". This asks it directly, by
     * walking the join graph the way `SkillTree._tiers` walks it.
     */
    const byId = new Map(Tree.FACETS.map((f) => [f.id, f]));
    const rows = [];
    for (const c of Tree.CURRENTS) {
      const mine = Tree.FACETS.filter((f) => f.axis === c.axis);
      assert(mine.length >= 3, `${c.axis} holds ${mine.length} facet(s) — a current is a teaching, not a card`);
      const roots = mine.filter((f) => Tree.isRoot(f.id));
      assert(roots.length === 1,
        `${c.axis} has ${roots.length} roots — exactly one facet per current needs no neighbour`);
      /* Breadth-first, exactly as the drawing does it, so the depth this
       * reports is the depth the player sees as indentation. */
      const seen = new Set([roots[0].id]);
      const queue = [roots[0].id];
      const depth = new Map([[roots[0].id, 0]]);
      let deepest = 0;
      while (queue.length) {
        const id = queue.shift();
        for (const to of Tree.neighboursOf(id)) {
          if (seen.has(to) || !byId.has(to) || byId.get(to).axis !== c.axis) continue;
          seen.add(to);
          depth.set(to, depth.get(id) + 1);
          deepest = Math.max(deepest, depth.get(to));
          queue.push(to);
        }
      }
      const stranded = mine.filter((f) => !seen.has(f.id));
      assert(!stranded.length,
        `${stranded.map((f) => f.id).join(', ')} cannot be reached from ${c.axis}'s root by any chain of `
        + 'joins — they are priced, drawn, and unbuyable for ever');
      /* AND THE PLATE HAS TO FIT. `SkillTree` clamps indentation at four
       * levels, so a current eight joins deep would draw its tail as a flat
       * list and lose the shape it is drawn to show. Six is the ceiling that
       * leaves the clamp as a mercy rather than a lie. */
      assert(deepest <= 6,
        `${c.axis} runs ${deepest} joins deep — the plate indents four and then stops distinguishing`);
      rows.push(`${c.axis} ${mine.length}/${deepest}`);
    }
    return `6 currents, every facet reachable from its root — ${rows.join(' · ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. The names move with the alignment                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: the same facet reads as a Jedi name and a Sith name', () => {
    assert(Tree, 'no Living Force module');
    // The alignment is Order.js's, not a second one invented here. If those
    // three ids ever stop being the orders, this fails rather than quietly
    // naming everything after a tradition that no longer exists.
    for (const id of ['jedi', 'sith', 'grey']) {
      assert(ORDER_IDS.includes(id), `Order.js no longer has "${id}", which this file names facets for`);
    }
    const same = [], blank = [];
    for (const s of Tree.FACETS) {
      if (!s.jedi || !s.sith) { blank.push(s.id); continue; }
      if (s.jedi === s.sith) same.push(s.id);
      const j = Tree.nameOf(s.id, 'jedi'), k = Tree.nameOf(s.id, 'sith');
      assert(j === s.jedi && k === s.sith, `${s.id} does not read its own aligned name back`);
    }
    assert(!blank.length, `facets with no aligned name: ${blank.join(', ')}`);
    assert(!same.length,
      `facets whose Jedi and Sith names are identical: ${same.join(', ')} — the alignment is decoration there`);
    // A Grey took no temple's vocabulary: they read the canonical name, and so
    // does a player who has chosen no order at all. Defaulting them to the Jedi
    // column would quietly resolve "neither code" into one.
    for (const s of Tree.FACETS) {
      const canon = Waves.boonById(s.id).name;
      assert(Tree.nameOf(s.id, 'grey') === canon, `a Grey reads ${s.id} as something other than "${canon}"`);
      assert(Tree.nameOf(s.id, null) === canon, `with no order at all, ${s.id} is not the canonical name`);
    }
    // and inside one current two facets may not share a name in any
    // alignment, or the map is unreadable in exactly one of the three
    for (const c of Tree.CURRENTS) {
      for (const order of ['jedi', 'sith', 'grey']) {
        const names = Tree.facetsOf(c.axis).map((s) => Tree.nameOf(s.id, order));
        assert(new Set(names).size === names.length,
          `two facets in ${c.axis} read the same to a ${order}: ${names.join(', ')}`);
      }
    }
    const sample = Tree.FACETS.find((s) => s.id === 'lifesteal');
    return `${Tree.FACETS.length} facets, all three vocabularies distinct — e.g. `
      + `"${sample.jedi}" / "${sample.sith}" / "${Waves.boonById('lifesteal').name}"`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. The rule that makes it a tree                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: a facet cannot be woken out of nowhere', () => {
    assert(Tree, 'no Living Force module');
    const led = new Tree.Communion({ insight: 9999 });
    const empty = new Waves.RankSet();
    // With nothing held, only the six hearts are open. Anything else buyable
    // from an empty hand means the lines are decoration.
    const openNow = Tree.FACETS.filter((s) => led.canBuy(s.id, empty, 40)).map((s) => s.id);
    const roots = Tree.CURRENTS.map((c) => c.root);
    /**
     * EXACTLY THE SIX HEARTS, which is what this asserted before a three-card
     * deal was put in front of the lattice and is what it asserts again.
     *
     * The property is the one that makes the lines mean anything: nothing but
     * a root can be woken out of nowhere. While the offer existed this had to
     * be weakened to "a subset of the roots, three of them", which no longer
     * said that every root is a legal opening — only that whatever was dealt
     * happened to be one.
     */
    assert(openNow.every((id) => roots.includes(id)),
      `from an empty hand the Holocron offers ${openNow.join(', ')}, and ${
        openNow.filter((id) => !roots.includes(id)).join(', ')} is not a heart — the lines are `
      + 'decoration if anything can be woken from nothing');
    assert(openNow.length === roots.length,
      `${openNow.length} of the six hearts can be woken from an empty hand — every current has to be `
      + 'an opening, or the run\'s shape is decided before the player chooses');
    /* AND THE SEED CHANGES NOTHING. A run's number used to pick which three of
     * the six you were shown; it must not pick which currents exist. */
    for (let seed = 0; seed < 40; seed++) {
      const shown = new Tree.Communion({ insight: 9999, seed }).offerNow(empty, 40);
      assert(shown.length === roots.length,
        `seed ${seed} opens with ${shown.length} of the six hearts — the opening is a deal again`);
    }

    // A DRAFTED card is a bridgehead: it wakes its own facet, and its
    // neighbours become reachable without any purchase at all. This is the
    // whole interplay between the two halves of the reward system.
    const held = new Waves.RankSet(['djemso']);
    const near = Tree.neighboursOf('djemso');
    assert(near.length, 'djemso is joined to nothing');
    for (const n of near) {
      assert(led.reachable(n, held), `holding Djem So does not open ${n}, which it is joined to`);
    }
    assert(!led.reachable('tempest', held), 'a card on the other side of the lattice is reachable from Djem So');

    // The gates the draft has, the tree must have too, or the tree is the way
    // around them: a mastery you can simply buy is not a mastery, and a wave-2
    // Force Lightning is what `minWave` exists to prevent.
    const dark = new Waves.RankSet(['attune-dark', 'lifesteal']);
    assert(led.reasonLocked('darkside', dark, 40) === Tree.LOCKED.gated,
      'the dark mastery can be bought without committing to the dark');
    const committed = new Waves.RankSet(['attune-dark', 'lifesteal', 'lifesteal', 'fury', 'fury']);
    /* THE GATE, AND NOT THE OFFER. `canBuy` now also asks whether the Holocron
     * is showing this facet at all (PLAN.md §4.6), and what this clause is
     * about is the mastery's own `requires` — so it asks for the ABSENCE of the
     * gated reason rather than for a green light that a deal can withhold. */
    assert(led.reasonLocked('darkside', committed, 40) !== Tree.LOCKED.gated,
      'a committed dark build still cannot reach its mastery');
    assert(led.reachable('darkside', committed), 'the dark mastery is not joined to a committed dark build');
    assert(led.reasonLocked('lightning', new Waves.RankSet(['attune-dark']), 2) === Tree.LOCKED.depth,
      'Force Lightning can be bought at wave 2 — the tree walks around minWave');
    // …and a facet with nothing left to give says so rather than taking money
    const full = new Waves.RankSet(['attune-guard']);
    for (let i = 0; i < Waves.maxRank(Waves.boonById('thorns')); i++) full.take('thorns');
    assert(led.reasonLocked('thorns', full, 40) === Tree.LOCKED.spent,
      'a maxed facet is still for sale');
    return `${openNow.length} of six hearts on the table and nothing else; a drafted card opens ${near.length} joined facets; `
      + 'masteries, minWave and rank caps all hold inside the tree';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. The economy cannot outrun the draft                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: the tree never outgrows the draft it sits beside', () => {
    assert(Tree, 'no Living Force module');
    /**
     * THE BALANCE BOUND, AS ARITHMETIC.
     *
     * `budgetFor`'s ramp is derived from the DRAFT RATE — one card every
     * DRAFT_EVERY waves, with BOON_POWER as what a card is worth — so a second
     * reward channel that paid out at the same rate would double the player's
     * growth against a curve fitted for half of it, and wave 20 would stop
     * being a fight. tools/balance.mjs measures the consequence; this pins the
     * cause, deterministically, because a simulated depth would fail on honest
     * tuning and on nothing else (see the header of tools/checks/balance.mjs).
     *
     * The costs are an arithmetic series, so facets-per-run grows like √w while
     * drafted cards grow like w/2. This asserts that relationship at every wave
     * out to 60 rather than trusting the algebra.
     */
    // The closed form and the ledger are two implementations of one rule, and
    // the whole bound below is stated in the closed form — so they have to
    // agree, wave by wave, or the bound is about arithmetic nobody runs.
    const led0 = new Tree.Communion();
    for (let w = 1; w <= 60; w++) {
      led0.earn(w, w % Waves.BOSS_EVERY === 0);
      assert(led0.insight === Tree.insightAfter(w, Waves.BOSS_EVERY),
        `after ${w} waves the ledger holds ${led0.insight} and the closed form says ${Tree.insightAfter(w, Waves.BOSS_EVERY)}`);
    }

    const rows = [];
    let worst = 0, worstAt = 0;
    for (let w = 1; w <= 60; w++) {
      let purse = Tree.insightAfter(w, Waves.BOSS_EVERY), bought = 0;
      // Cheapest possible spending: every facet a common, which is the most
      // facets this economy can produce at that depth.
      for (;;) {
        const cost = Tree.COST.common + Tree.COST_STEP * bought;
        if (purse < cost) break;
        purse -= cost; bought++;
      }
      const drafted = Math.floor(w / Waves.DRAFT_EVERY);
      const share = drafted ? bought / (bought + drafted) : 0;
      if (share > worst) { worst = share; worstAt = w; }
      assert(bought <= drafted || w < 4,
        `at wave ${w} the tree can wake ${bought} facets against ${drafted} drafted cards — `
        + 'the side channel has become the main one');
      if (w % 20 === 0) rows.push(`w${w}: ${bought} bought / ${drafted} drafted`);
    }
    assert(worst <= 0.45,
      `at wave ${worstAt} the tree is ${(worst * 100).toFixed(0)}% of everything the run earned`);
    // Prices must CLIMB, or the escalator is not one and a late run buys the
    // whole lattice.
    const led = new Tree.Communion({ insight: 999 });
    const taken = new Waves.RankSet(['attune-blade']);
    /**
     * ONE FACET, PRICED BEFORE AND AFTER — not two facets compared to each
     * other, which is what stood here and was never a measurement of the
     * escalator at all.
     *
     * `costOf` is `base[rarity] + COST_STEP·bought + RANK_STEP·rank`, so two
     * DIFFERENT facets differ by their rarity base before the escalator is
     * consulted. The old fixture took whatever the three-card deal happened to
     * show first and compared it against a different card from the next deal;
     * with the deal gone and the list sorted, that became a common facet
     * measured against an epic one and read 11 against 12 — a fall, from an
     * escalator that had done nothing wrong.
     *
     * Asking one facet's price on both sides of somebody else's purchase
     * isolates `bought.length`, which is the only thing this clause is about.
     */
    const spend = led.offerNow(taken, 40)[0];
    const watch = led.offerNow(taken, 40).find((id) => id !== spend);
    assert(spend && watch, 'fewer than two facets are legal, so nothing can be priced');
    const first = led.costOf(watch, taken);
    assert(led.buy(spend, taken, 40), `the Holocron refused a facet it calls legal (${spend})`);
    taken.take(spend);
    const second = led.costOf(watch, taken);
    assert(second > first,
      `${watch} cost ${first} before a purchase and ${second} after — the escalator is flat`);
    /* AND A REPEAT IS NEVER THE CHEAP PLAY — asked of the facet that was
     * actually bought, because `RANK_STEP` is a term on the rank HELD and a
     * card nobody has taken has no second rank to price. */
    const again = led.costOf(spend, taken);
    assert(again > second,
      `a second rank of ${spend} costs ${again}, no more than a first rank of ${watch} at ${second}`);
    return `${rows.join(', ')}; worst share of a run's growth ${(worst * 100).toFixed(0)}% at w${worstAt}; `
      + `prices ${first} → ${second} → ${again}`;
  });

  check('living force: the Holocron earns and spends in every mode the game has', async () => {
    /**
     * "confirm that the holocron and upgrades work in every single mode"
     *
     * It did not, and the exception was the worst one available. The Holocron
     * is three mechanisms and a mode can have any two: a ledger, a WAY TO EARN
     * (the director firing `onWaveClear`), and a purchase that reaches the
     * body. Training had the ledger and the screen and no income —
     * `World.loadLevel` returns early for `training`, before the block that
     * hangs `_earnInsight` on the clear signal — so a player could kneel in the
     * one mode built for trying powers out and find 0 Insight forever.
     *
     * Asked of the real World per mode rather than of a list of mode names,
     * because a list is the thing that goes stale the day a mode is added.
     */
    const { MODES } = Waves;
    /* Dynamic, the way every other check in this file reaches the harness. */
    const { bootWorld } = await import('./_coop.mjs');
    const rows = [];
    /**
     * AND ONE MODE HAS NO WAVE TO CLEAR, WHICH IS ITS WHOLE POINT.
     *
     * The flight deck is a place, not a fight: no enemy, no wave, no ending
     * and no score, and `HangarDirector` is deliberately not a `WaveDirector`
     * subclass precisely so it cannot grow a spawn queue or a clear signal.
     * Demanding `onWaveClear` of it is demanding income from a room whose
     * promise is that nothing happens in it unless you ask.
     *
     * It still has to have the LEDGER — a player who kneels on the deck must
     * see what he has — so it is exempted from the earning half only, and the
     * two assertions below are split so that stays true.
     */
    const NO_WAVE = {
      hangar: 'a deck has no wave to clear; you walk onto it to look at your men',
    };
    for (const mode of Object.keys(MODES)) {
      const level = MODES[mode]?.level || 'geonosis';
      const { world } = await bootWorld({ level, settings: { mode, difficulty: 'knight' } });
      try {
        assert(world.communion, `${mode}: no Insight ledger at all`);
        if (NO_WAVE[mode]) {
          assert(!world.director?.onWaveClear,
            `${mode} is on the no-wave list and has grown a clear signal — either it is a fight `
            + 'now and the exemption is stale, or something has given a room a wave');
          rows.push(`${mode}: ledger only (${NO_WAVE[mode]})`);
          continue;
        }
        assert(typeof world.director?.onWaveClear === 'function',
          `${mode}: the director fires no wave-clear signal, so the Holocron can never be paid`);
        const before = world.communion.insight;
        world.director.onWaveClear(1, true);
        const earned = world.communion.insight - before;
        assert(earned > 0,
          `${mode}: a cleared wave paid ${earned} Insight — the Holocron opens here and cannot be spent`);
        /* AND A PURCHASE REACHES THE BODY. A root is legal from an empty hand,
         * so this needs no run behind it. */
        const p = world.player;
        const cut0 = p.boonMods.cutPower;
        world.communion.insight += 500;
        const boon = world.communion.buy('attune-blade', world.takenBoons, 1);
        assert(boon, `${mode}: the Holocron refused a root facet from an empty hand`);
        world.applyBoon(boon);
        assert(p.boonMods.cutPower > cut0,
          `${mode}: a woken facet did not reach the player — the upgrade is a screen only`);
        rows.push(`${mode} ${earned}`);
      } finally { world.unload?.(); world.dispose?.(); }
    }
    return `Insight per clear — ${rows.join(', ')}`;
  });

  check('living force: the Holocron shows every facet the rules allow, and hides none of them', () => {
    /**
     * THE CHECK THAT USED TO PIN THE OPPOSITE, and the report that turned it
     * round:
     *
     *     "the holocron does not unlock in order like you can't just choose to
     *      do one list or path it picks and chooses almost at random"
     *
     * It did, and this file asserted that it should. PLAN.md §4.6 asked for a
     * three-card offer over the lattice so that "a solved build order becomes a
     * found one"; what it produced was a chart the player could read and could
     * not act on, because the two facets they were walking toward were usually
     * among the forty-three not being shown. The lattice is the promise, so the
     * lattice is what the Holocron now offers.
     *
     * What still gates a facet is everything a player can SEE on the chart —
     * the joins, the depth, the disciplines, the price. `LOCKED.offer` has no
     * writer any more.
     */
    const taken = new Waves.RankSet(['attune-blade', 'attune-body', 'cadence']);
    const led = new Tree.Communion({ insight: 9999, seed: 4242 });
    const hand = led.offerNow(taken, 40);

    /* EVERY LEGAL FACET IS ON THE TABLE. This is the property the player asked
     * for, stated as an identity: the legal set and the offered set are the
     * same set, so a line can be walked to its end. */
    const legal = Tree.FACETS.filter((f) => led.reachable(f.id, taken)
      && Waves.rankOf(taken, f.id) < Waves.maxRank(Waves.boonById(f.id))).map((f) => f.id);
    assert(legal.length > Tree.OFFER,
      `only ${legal.length} facets are legal, so this fixture cannot tell a full offer from a deal`);
    assert(hand.slice().sort().join() === legal.slice().sort().join(),
      `the Holocron offers ${hand.length} of ${legal.length} legal facets — withholding ${
        legal.filter((id) => !hand.includes(id)).slice(0, 5).join(', ')}`);

    /* AND NOTHING ON IT LIES. Everything shown really can be taken. */
    for (const id of hand) {
      assert(led.reachable(id, taken), `${id} is on the table and nothing held is joined to it`);
      assert(led.reasonLocked(id, taken, 40) === null,
        `${id} is on the table and still refuses: ${led.reasonLocked(id, taken, 40)}`);
    }

    /* A PATH CAN BE WALKED, which is the whole of the complaint. Take the
     * blade line end to end and assert every step was available when it was
     * wanted — not merely that the facets exist. */
    const walk = new Waves.RankSet(['attune-blade']);
    const led2 = new Tree.Communion({ insight: 99999, seed: 7 });
    const blade = Tree.FACETS.filter((f) => f.axis === 'blade' && f.id !== 'attune-blade');
    let walked = 0;
    for (const f of blade) {
      if (!led2.reachable(f.id, walk)) continue;
      if (led2.reasonLocked(f.id, walk, 40) !== null) continue;
      assert(led2.buy(f.id, walk, 40), `${f.id} is legal and the Holocron refused it`);
      walk.take(f.id); walked++;
    }
    assert(walked >= 3,
      `only ${walked} facets of the blade current could be taken in a row — a player cannot `
      + 'follow a line');

    /* THE SEED DOES NOT DECIDE WHAT YOU MAY TAKE. It still seeds the draft and
     * the world; it must no longer decide which half of the chart is real. */
    const a = new Tree.Communion({ insight: 9999, seed: 1 }).offerNow(taken, 40).join();
    const b = new Tree.Communion({ insight: 9999, seed: 2 }).offerNow(taken, 40).join();
    assert(a === b,
      'two runs with the same holdings are shown different facets — the run number is deciding '
      + 'the chart again');

    /* AND IT DOES NOT MOVE UNDER YOU. */
    for (let i = 0; i < 20; i++) {
      assert(led.offerNow(taken, 40).join() === hand.join(),
        'the offer changed between two reads with nothing bought');
    }
    return `${hand.length} of ${legal.length} legal facets shown (all of them) · a blade line `
      + `walked ${walked} deep · identical across seeds and 20 reads`;
  });

  check('living force: a run wakes a third of the lattice, and two runs are not the same third', () => {
    assert(Tree, 'no Living Force module');
    /**
     * THE CHECK THAT SAYS WHAT THE SIZE OF THE LATTICE IS FOR, because the
     * obvious reading of the numbers is wrong and it was acted on once already.
     *
     * The obvious reading: a run earns `w + 2·floor(w/5)` Insight against an
     * arithmetic price series, so it can afford about √w facets — four by
     * wave 20, six by wave 40, ten by wave 100. Against 46 facets that is 13%,
     * waking the whole lattice would take about 1690 waves, and the conclusion
     * writes itself: the Holocron is 87% decoration, cut it to eighteen.
     *
     * IT IS WRONG BECAUSE THE PURSE IS NOT THE ONLY THING THAT WAKES A FACET.
     * This file's own header says so in as many words — "a DRAFTED card wakes
     * its facet too… the two halves are one system" — and
     * `Communion.reachable` reads `rankOf(taken, …)`, which the draft feeds.
     * Driven through the real `drawBoons` and the real ledger, 24 runs per
     * style, counting DISTINCT facets held from both channels:
     *
     *     style           wave   drafts  bought  woken  share of lattice
     *     random            20     12.0     3.8   13.9      30%
     *     random            40     24.0     5.9   23.9      52%
     *     commit-blade      40     24.0     5.5   17.5      38%
     *     commit-dark       60     36.0     7.0   24.6      53%
     *
     * and the overlap between two wave-40 runs of the same style is 42-47% —
     * so more than half of each holding is facets the other one does not
     * have. Every facet in the table is reached by some run; the least-woken
     * (`unity`, the bond mastery) is held by 8% of them.
     *
     * Cutting to eighteen would take a run that wakes half the lattice to one
     * that wakes all of it by wave 40, which is the end of two runs differing.
     * It would also delete twenty-six cards from the DRAFT, and
     * `tools/checks/escalation.mjs` pins the opposite property there — "a
     * thirty-wave run draws half the table, not five eighths of it" — because
     * a thin draft is the defect that widening the table was done to fix.
     *
     * So the size of the lattice is load-bearing in two directions at once, and
     * this check is what says so: enough facets that a run cannot hold them
     * all, and few enough that a run holds a real share of them.
     *
     * ── WHAT IS ACTUALLY THIN, AND IT IS NOT THE LATTICE ─────────────────
     *
     * The PURSE: 5.9 purchases against 24 drafted cards by wave 40. That is
     * deliberate and it is pinned by "the tree never outgrows the draft it sits
     * beside" three checks above, because the budget ramp is derived from the
     * draft rate. Growing it is a balance pass, not an edit.
     *
     * Two things measured on the way here, neither of them fixed, both worth
     * the next reader's time:
     *
     *   FIFTEEN of the 46 facets are never BOUGHT by a spender who buys the
     *   moment it can afford anything — every root, every mastery, plus
     *   lightning, compel and the saber throw. They are not unreachable: a
     *   SAVER takes a mastery for 9 Insight at wave 12, because the escalator
     *   counts purchases MADE and not Insight HELD. The system rewards saving
     *   exactly as this file's header claims it should, and nothing in the game
     *   tells the player that.
     *
     *   A QUARTER of purchases have exactly one affordable, reachable option
     *   (mean 3.1, across 2.2 axes). A purchase with one option is not a
     *   choice, and that — not the size of the table — is the honest form of
     *   the "it is a lottery, not a build" complaint.
     */
    const styles = [{ kind: 'random' }, { kind: 'commit', axis: 'blade' }, { kind: 'commit', axis: 'dark' }];
    /**
     * `mode` — AND ITS ABSENCE IS WHY THE TRIAL OF WAVES WAS NEVER MEASURED.
     *
     * This harness hardcoded `if (w % DRAFT_EVERY === 0 || boss)` with nothing
     * to turn it off, so every number in the table above and every bar below
     * described Path of the Blade and only Path of the Blade. Run with the
     * draft off — which is what `DRAFT_MODES` says the Trial is — the same
     * twelve seeds reported **4.9 of 46 facets, 11% of the lattice**, against
     * this check's own floor of 33%. The mode whose menu entry says "what you
     * build, you build in the Holocron", and whose file says "the tree is the
     * Trial's whole progression", failed the bar for a build by a factor of
     * three, and the check passed at 38% because it was measuring the other
     * mode. HANDOFF §2.3 with a `mode` argument missing instead of a table.
     *
     * `drafts` is `WaveDirector.drafts`'s answer, and the Insight rate is
     * `insightRate(drafts)` — the shipped pair, called rather than restated.
     */
    const runOne = (toWave, style, seed, drafts = true) => {
      const rate = Tree.insightRate(drafts);
      Waves.seedWaves(seed, 0);
      /**
       * The PLAYER's own die, seeded and separate from the wave stream.
       *
       * The first draft of this walked the draft with `cards[drafts % n]`,
       * which is deterministic and reproducible and produced a finding that was
       * an artefact of the picker: three attunements were "never reached in 36
       * runs" because the modulus never landed on them. A check must be
       * deterministic, which is not the same as being a straight line — so the
       * choice is random and the RANDOMNESS is seeded.
       */
      let st = (seed * 2654435761) >>> 0;
      const die = (n) => { st = (Math.imul(st ^ (st >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return st % n; };
      const taken = new Waves.RankSet();
      const led = new Tree.Communion();
      let picked = 0, bought = 0;
      for (let w = 1; w <= toWave; w++) {
        const boss = w % Waves.BOSS_EVERY === 0;
        led.earn(w, boss, rate);
        if (drafts && (w % Waves.DRAFT_EVERY === 0 || boss)) {
          const cards = Waves.drawBoons(boss ? 4 : 3, taken, w,
            { floor: boss ? 'rare' : null, attune: boss });
          if (cards.length) {
            const pick = style.kind === 'commit'
              ? (cards.find((c) => (c.axes || []).includes(style.axis)
                  || c.id === `attune-${style.axis}`) || cards[0])
              : cards[die(cards.length)];
            taken.take(pick.id); picked++;
          }
        }
        for (;;) {
          const open = Tree.FACETS.filter((s) => led.canBuy(s.id, taken, w));
          if (!open.length) break;
          const pick = style.kind === 'commit'
            ? (open.find((s) => s.axis === style.axis) || open[0]) : open[die(open.length)];
          if (!led.buy(pick.id, taken, w)) break;
          taken.take(pick.id); bought++;
        }
      }
      const held = Tree.FACETS.filter((s) => Waves.rankOf(taken, s.id) > 0);
      return { drafts: picked, bought, ids: new Set(held.map((s) => s.id)),
        all: new Set(held.map((s) => s.id)),
        axes: new Set(held.map((s) => s.axis)) };
    };

    const measure = (drafts) => {
      const out = [];
      for (const st of styles) {
        const name = st.kind === 'commit' ? `commit-${st.axis}` : 'random';
        const runs = [];
        for (let s = 1; s <= 12; s++) runs.push(runOne(40, st, s * 7, drafts));
        let j = 0, n = 0;
        for (let a = 0; a < runs.length; a++) {
          for (let b = a + 1; b < runs.length; b++) {
            const A = runs[a].ids, B = runs[b].ids;
            const inter = [...A].filter((x) => B.has(x)).length;
            j += inter / (A.size + B.size - inter); n++;
          }
        }
        out.push({
          name,
          /* Base facets only — see the note on BASE below, which is why the
           * unbound tier is measured by its own check rather than diluted
           * into this one. */
          woken: runs.reduce((a, r) =>
            a + [...r.ids].filter((id) => !id.startsWith('unbound-')).length, 0) / runs.length,
          unbound: runs.reduce((a, r) =>
            a + [...r.ids].filter((id) => id.startsWith('unbound-')).length, 0) / runs.length,
          bought: runs.reduce((a, r) => a + r.bought, 0) / runs.length,
          axes: runs.reduce((a, r) => a + r.axes.size, 0) / runs.length,
          overlap: j / n,
        });
      }
      return out;
    };

    /**
     * ── THE SHARE IS OF THE LATTICE A RUN IS FOR, AND THE UNBOUND TIER IS NOT
     *    PART OF IT ────────────────────────────────────────────────────────
     *
     * The bar below exists to catch DEAD CONTENT — "the facets nobody reaches
     * should be cut or joined up" — and it uses "how much of the table does a
     * run hold" as the proxy for it. That proxy stops being the same question
     * the moment a tier is added whose whole design is that you take ONE of it.
     * The ten `unbound-*` facets are one leaf per Force power, hung off that
     * power's own facet, gated on four cards of a single axis and wave 16; a
     * committed run reaches its own axis's in roughly half of runs and has no
     * business reaching the other nine, because they are on currents it did not
     * walk. Counted in the denominator they would drag every run's share down
     * by ten facets it was never meant to hold, and the number would say "dead
     * content" about the one tier that is measured directly, facet by facet,
     * in the check immediately after this one.
     *
     * So the share is of the BASE lattice and the tier is asked its own
     * question. Deriving the split off the id prefix rather than listing it
     * keeps the exemption exactly as wide as the tier is.
     */
    const BASE = Tree.FACETS.filter((s) => !s.id.startsWith('unbound-'));
    const rows = [];
    const path = measure(true);
    let worstShare = 1, worstAt = '', worstOverlap = 0, overlapAt = '';
    for (const r of path) {
      const share = r.woken / BASE.length;
      if (share < worstShare) { worstShare = share; worstAt = r.name; }
      if (r.overlap > worstOverlap) { worstOverlap = r.overlap; overlapAt = r.name; }
      rows.push(`${r.name} ${r.woken.toFixed(1)}/${BASE.length} woken `
        + `(${r.bought.toFixed(1)} bought, ${r.unbound.toFixed(1)} unbound)`);
    }
    assert(worstShare >= 0.33,
      `a ${worstAt} run reaches wave 40 holding ${(worstShare * 100).toFixed(0)}% of the lattice — `
      + 'most of the table is a picture of a system rather than a system, and the facets nobody '
      + 'reaches should be cut or joined up');
    assert(worstShare <= 0.85,
      `a ${worstAt} run holds ${(worstShare * 100).toFixed(0)}% of the lattice by wave 40 — `
      + 'if a run can hold nearly all of it then there is nothing left for the next run to be');
    assert(worstOverlap <= 0.7,
      `two ${overlapAt} runs hold ${(worstOverlap * 100).toFixed(0)}% of the same facets at wave 40 — `
      + 'the Holocron is not producing different builds, it is producing one build with noise on it');

    /**
     * ── AND NOW THE MODE THIS CHECK WAS NEVER RUN AGAINST ────────────────────
     *
     * The Trial of Waves has no draft, so the bars above cannot simply be
     * repeated: 33% of the lattice is reached in Path of the Blade mostly
     * through CARDS, and a mode with one channel where the other has two is not
     * being asked the same question. What it can be held to is the number its
     * own budget curve already assumes.
     *
     * `RAMP_CARDS_EVERY` is that number: the base polynomial every mode faces
     * was fitted against a player holding w/3 growth events by wave w, and the
     * Trial is charged that curve with no multiplier. So the Holocron must hand
     * a Trial player about w/3 growth events and NOT MORE — under it and the
     * mode has no build, over it and the tree is outgrowing a ramp fitted for
     * less, which is the same bound "the tree never outgrows the draft it sits
     * beside" holds Path of the Blade to.
     *
     * Measured before the mode-aware rate: 5.0 purchases, 11% of the lattice,
     * 1.1 currents, and two runs of the same style byte-identical.
     */
    const trial = measure(false);
    const want = 40 / Waves.RAMP_CARDS_EVERY;
    for (const r of trial) {
      assert(r.bought >= want * 0.7,
        `a Trial run buys ${r.bought.toFixed(1)} facets in forty waves against the ${want.toFixed(1)} `
        + 'growth events its own budget curve is fitted for — the mode whose whole progression is the '
        + 'Holocron has almost no progression');
      assert(r.bought <= want,
        `a Trial run buys ${r.bought.toFixed(1)} facets against the ${want.toFixed(1)} its budget `
        + 'curve assumes — the tree has outgrown the ramp it sits beside');
      rows.push(`TRIAL ${r.name} ${r.woken.toFixed(1)} woken (${r.bought.toFixed(1)} bought, `
        + `${r.axes.toFixed(1)} currents)`);
    }
    /**
     * …AND IT MUST NOT BE ONE WALK DOWN ONE CURRENT.
     *
     * Asserted on the UNDIRECTED style, and the exclusion is not a dodge: a
     * `commit` player picks the same facet off the same open set every time, so
     * in a mode with NO DRAW their progression is a pure function of the tree
     * and two runs are identical BY CONSTRUCTION. That is a true fact about the
     * Trial and no Insight rate can change it — what makes two Trial runs
     * differ is the run's RULES and its seed, which `escalation.mjs` pins. What
     * this can ask, and what was false, is that a player who is not committed
     * reaches more than one current and does not walk the same four steps every
     * time: measured 1.1 currents and a 14% overlap over four facets, against
     * 3.0 currents and 20% over ten now.
     */
    const undirected = trial.find((r) => r.name === 'random');
    assert(undirected.axes >= 2,
      `an undirected Trial run reaches ${undirected.axes.toFixed(1)} of the ${Tree.AXES.length} `
      + 'currents by wave 40 — the whole mode is "pick one of six currents and walk down it"');
    assert(undirected.overlap <= 0.7,
      `two undirected Trial runs hold ${(undirected.overlap * 100).toFixed(0)}% of the same facets`);
    /**
     * …AND NO FACET MAY BE UNREACHABLE IN PRACTICE, which is the real test of
     * whether a table entry is decoration — and the one the "87% of it is
     * decoration" reading was reaching for.
     *
     * Swept over a player COMMITTED TO EACH AXIS in turn rather than over three
     * styles, because that is the question: a run that goes for the bond has to
     * be able to arrive at the bond's mastery. Twelve seeds each. (`unity` is
     * held by about 8% of undirected runs, so three styles × twelve seeds
     * finding none of them is luck rather than evidence.)
     */
    const ever = new Set();
    const sweep = [{ kind: 'random' }, ...Tree.AXES.map((axis) => ({ kind: 'commit', axis }))];
    for (const st of sweep) for (let s = 1; s <= 12; s++) for (const id of runOne(60, st, s * 13).ids) ever.add(id);
    const dead = Tree.FACETS.filter((s) => !ever.has(s.id)).map((s) => s.id);
    assert(!dead.length,
      `no run in ${sweep.length * 12} ever held: ${dead.join(', ')} — a facet nothing reaches is decoration, `
      + 'and cutting it or joining it up is the honest answer');
    return `${rows.join('; ')}; two runs share ${(worstOverlap * 100).toFixed(0)}% at worst; `
      + `all ${Tree.FACETS.length} facets reached across ${sweep.length * 12} runs`;
  });

  check('living force: Insight is a run currency and never a save file', async () => {
    assert(Tree, 'no Living Force module');
    /**
     * Progress.js exists to say what a record is NOT: "no unlocks, no currency,
     * no cross-run power — the hundredth run starts exactly where the first
     * did". A skill tree is the single most common way that promise gets
     * broken, so the promise is checked rather than restated.
     */
    const fresh = new Tree.Communion();
    assert(fresh.insight === 0 && fresh.bought.length === 0,
      `a new run starts with ${fresh.insight} Insight and ${fresh.bought.length} facets already woken`);
    const progress = await read('game/Progress.js');
    assert(/no currency/.test(progress), 'the doctrine note in Progress.js is gone');
    // Nothing may read the record back INTO a run. The record is written in
    // Progress.js and drawn by the meditation; a third reader would be the
    // moment this became meta-progression.
    for (const file of ['game/World.js', 'game/Waves.js', 'game/LivingForce.js']) {
      const text = await read(file);
      assert(!/loadProgress\s*\(/.test(text),
        `${file} reads the saved record — a run must not start from a save file`);
    }
    const main = await read('main.js');
    const uses = [...main.matchAll(/loadProgress\(\)/g)].length;
    assert(uses <= 1, `main.js reads the record ${uses} times; only the Holocron's chart may`);
    const i = main.indexOf('loadProgress()');
    assert(i > 0 && /history/.test(main.slice(Math.max(0, i - 400), i + 200)),
      'the record is read somewhere other than the chart');
    return 'a run begins at zero; the record is drawn and never spent';
  });

  /* THE LEDGER CROSSING A LANDING was pinned here, and there are no landings
   * any more: the Descent was the one mode that had them and it is deleted
   * along with the three interiors that were three of its four rungs. What is
   * left of that check is the sentence that outlives it — a level load starts
   * a fresh ledger, which is what every other mode always did — and it is
   * asserted in World.js's own comment rather than restated as arithmetic
   * here. If a mode with landings comes back, so does this check.
   */

  check('living force: Reflection sends a share of the blow back to whoever struck it', () => {
    // Driven through the REAL damage path on both sides: Player.prototype.damage
    // takes the hit, the guard chain answers, and the answer lands on a real
    // Enemy through its own `damage`. Nothing here reads a flag.
    const w = gameWorld();
    const p = livePlayer(w);
    const foe = spawnFoe(w, 'b1');
    const control = foe.hp;
    p.invuln = 0;
    p.damage(20, p.chest, foe, 'melee');
    assert(foe.hp === control, `an enemy lost ${control - foe.hp} hp before the card was taken`);

    const p2 = livePlayer(w);
    take(p2, 'thorns');
    const foe2 = spawnFoe(w, 'b1', V(3, 0, 0));
    const before = foe2.hp;
    p2.invuln = 0;
    p2.damage(20, p2.chest, foe2, 'melee');
    const back = before - foe2.hp;
    assert(back > 0, 'Reflection returned nothing at all — the card is a flag nobody reads');
    const share = boon('thorns').apply.length ? 0.35 : 0.35;
    assert(Math.abs(back - 20 * share) < 0.51,
      `a 20-damage blow returned ${back.toFixed(1)}, not the ${(20 * share).toFixed(1)} the card promises`);
    // Nothing may reflect onto a source that cannot take damage, and nothing
    // may reflect onto YOURSELF — the guard runs on every hit, including the
    // ones a card of your own deals.
    const hpBefore = p2.hp;
    p2.invuln = 0;
    p2.damage(5, p2.chest, p2, 'thorns');
    assert(p2.hp === hpBefore - 5 * (w.difficulty?.damageTaken ?? 1),
      'a self-inflicted hit was reflected, which is a loop');
    return `20 damage taken → ${back.toFixed(1)} returned to the body that dealt it (${before} → ${foe2.hp.toFixed(1)} hp)`;
  });

  check('living force: the Aegis eats the blow and knits itself back together', () => {
    const w = gameWorld();
    const plain = livePlayer(w);
    const ward = livePlayer(w);
    take(ward, 'aegis');
    const max = ward._aegisMax;
    assert(max > 0, 'the Aegis has no pool at all');

    // Same blow, both players, real Player.damage on both.
    plain.invuln = 0; ward.invuln = 0;
    plain.damage(18, plain.chest, null, 'bolt');
    ward.damage(18, ward.chest, null, 'bolt');
    assert(ward.hp > plain.hp,
      `the barrier absorbed nothing: warded ${ward.hp} vs bare ${plain.hp}`);
    assert(ward.hp === ward.maxHp, `an 18-point blow got through a ${max}-point barrier`);
    const spent = max - ward._aegis;
    assert(Math.abs(spent - 18) < 0.01, `the barrier spent ${spent.toFixed(1)} against an 18-point blow`);

    // It does NOT recharge while you are being shot at — otherwise it is just
    // more health with extra steps.
    for (let i = 0; i < 120; i++) {
      ward.invuln = 0;
      ward.damage(1, ward.chest, null, 'bolt');
      tick(ward, 1);
    }
    const underFire = ward._aegis;
    tick(ward, Math.round(60 * 12));
    assert(ward._aegis > underFire + 5,
      `twelve quiet seconds mended ${(ward._aegis - underFire).toFixed(1)} of the barrier`);
    assert(ward._aegis <= max + 1e-6, `the barrier refilled past its own maximum (${ward._aegis} > ${max})`);
    return `${max}-point ward: 18-point blow fully absorbed (bare player took ${(plain.maxHp - plain.hp).toFixed(0)}), `
      + `refilled to ${ward._aegis.toFixed(0)} after twelve quiet seconds`;
  });

  check('living force: Momentum is paid by killing and taken back by standing still', () => {
    const w = gameWorld();
    const p = livePlayer(w);
    take(p, 'momentum');
    const flat = p.boonMods.moveSpeed;
    tick(p, 2);
    const idle = p.boonMods.moveSpeed;
    p.kills += 3;
    tick(p, 2);
    const rushed = p.boonMods.moveSpeed;
    const rate = p.boonMods.attackRate;
    assert(rushed > idle,
      `three kills moved moveSpeed ${idle.toFixed(3)} → ${rushed.toFixed(3)} — the stacks reach no reader`);
    assert(rate > 1, `the swing rate never moved (${rate.toFixed(3)})`);
    // …and it decays. A stacking bonus that never comes off is a flat bonus
    // wearing a costume, and this one is meant to pay for aggression.
    tick(p, Math.round(60 * 30));
    assert(Math.abs(p.boonMods.moveSpeed - idle) < 1e-3,
      `thirty seconds of standing still left moveSpeed at ${p.boonMods.moveSpeed.toFixed(3)} against ${idle.toFixed(3)}`);
    assert(Math.abs(p.boonMods.attackRate - 1) < 1e-3, 'the swing rate never came back down');
    return `flat ${flat.toFixed(3)}, +3 kills → ${rushed.toFixed(3)} move / ${rate.toFixed(3)} swing, `
      + `back to ${p.boonMods.moveSpeed.toFixed(3)} after 30 s`;
  });

  check('living force: the Mercy Stroke finishes the broken and spares the whole', () => {
    const w = gameWorld();
    const p = livePlayer(w);
    take(p, 'execute');
    const at = p._executeAt;
    assert(at > 0 && at < 1, `the threshold is ${at}`);

    // A healthy body must survive the same event, or this is not a finisher,
    // it is an instant kill on everything.
    const whole = spawnFoe(w, 'trooper');
    w.onLimbSevered(whole, 'armL', whole.position.clone(), p);
    assert(!whole.dead, 'a body at full health was executed by a limb coming off');

    const broken = spawnFoe(w, 'trooper', V(4, 0, 0));
    broken.hp = broken.maxHp * (at * 0.5);
    const kills = w.kills;
    w.onLimbSevered(broken, 'armL', broken.position.clone(), p);
    assert(broken.dead, `a body on ${(at * 50).toFixed(0)}% health survived the mercy stroke`);
    assert(w.kills === kills + 1, 'the finish was not credited as a kill — it scores nothing and heals nothing');

    // And only for the player who holds it: the sever hook dispatches on the
    // source, so an ally's cut must not fire your card.
    const other = livePlayer(w);
    const third = spawnFoe(w, 'trooper', V(8, 0, 0));
    third.hp = third.maxHp * (at * 0.5);
    w.onLimbSevered(third, 'armL', third.position.clone(), other);
    assert(!third.dead, "somebody else's cut fired this player's finisher");
    return `threshold ${(at * 100).toFixed(0)}% — whole body survives, broken body dies and is credited`;
  });

  check('living force: a Detonation reaches the crowd once, not the whole crowd forever', () => {
    const w = gameWorld();
    const p = livePlayer(w);
    take(p, 'detonate');
    const victim = spawnFoe(w, 'b1', V(0, 0, 0));
    const near = spawnFoe(w, 'b1', V(2.2, 0, 0));
    const far = spawnFoe(w, 'b1', V(30, 0, 0));
    const nearHp = near.hp, farHp = far.hp;
    // The real death path: Enemy.die calls world.onEnemyKilled, which is what
    // the on-kill seam wraps.
    victim.damage(victim.hp + 1, victim.position.clone(), p, 'cut');
    assert(victim.dead, 'the victim did not die, so nothing detonated');
    assert(near.hp < nearHp, `a body 2.2 m from the blast took nothing (${nearHp} → ${near.hp})`);
    assert(far.hp === farHp, `a body 30 m away took ${(farHp - far.hp).toFixed(1)} damage`);

    /**
     * THE CHAIN, isolated. This handler is fired BY a kill and deals damage
     * that can kill, so without the latch a detonation detonates whatever it
     * kills, and in a crowd the recursion is exponential.
     *
     * Three bodies in a line, all one hit from death: the seed at 0, A at 4 m
     * (inside the 4.6 m blast), B at 8.2 m (outside the seed's blast, but well
     * inside A's). With the latch, killing the seed kills A and B survives.
     * Without it, A's death detonates and takes B with it.
     */
    const w2 = gameWorld();
    const p2 = livePlayer(w2);
    take(p2, 'detonate', 3);
    const a = spawnFoe(w2, 'b1', V(4.0, 0, 0));
    const b = spawnFoe(w2, 'b1', V(8.2, 0, 0));
    a.hp = 1; b.hp = 1;
    const seed = spawnFoe(w2, 'b1', V(0, 0, 0));
    seed.damage(seed.hp + 1, seed.position.clone(), p2, 'cut');
    assert(a.dead, 'the body 4 m from the blast survived it, so nothing detonated at all');
    assert(!b.dead,
      'the blast chained: the body it killed detonated in turn, which is exponential in a crowd');
    assert(!p2._detonating, 'the chain latch was left set, so the card is dead from here on');
    return `blast hit at 2.2 m (${nearHp} → ${near.hp.toFixed(0)}), missed at 30 m; `
      + 'one generation only — the body it killed did not detonate in turn';
  });

  /* ── the communion: buffs that land on somebody else ────────────────── */

  check('living force: a communion lands on the ally, and half of it on you alone', () => {
    const w = gameWorld();
    const giver = livePlayer(w);
    const ally = livePlayer(w, { position: V(3, 0, 0) });
    const stranger = livePlayer(w, { position: V(90, 0, 0) });
    take(giver, 'communion');
    tick(giver, 2);
    assert(ally.boonMods.cutPower === 1, 'the ally was buffed before their own tick ran');
    tick(ally, 2); tick(stranger, 2);
    assert(ally.boonMods.cutPower > 1,
      `an ally 3 m away cuts at ${ally.boonMods.cutPower.toFixed(3)} — the aura reaches nobody`);
    assert(ally.boonMods.moveSpeed > 1, 'the ally gained no speed');
    assert(stranger.boonMods.cutPower === 1,
      `an ally 90 m away was buffed at ${stranger.boonMods.cutPower.toFixed(3)} — the aura has no range`);
    // The holder keeps half of it, so the card is never dead in a solo run…
    const self = giver.boonMods.cutPower;
    assert(self > 1 && self < ally.boonMods.cutPower,
      `the holder's own share is ${self.toFixed(3)} against the ally's ${ally.boonMods.cutPower.toFixed(3)}`);
    // …and it lapses when they walk away, rather than being permanent.
    ally.position.set(90, 0, 0);
    tick(giver, 4); tick(ally, Math.round(60 * 2));
    assert(Math.abs(ally.boonMods.cutPower - 1) < 1e-6,
      `an ally who walked out of range kept ${ally.boonMods.cutPower.toFixed(3)}× cut power`);
    // The mastery closes the bond: the half becomes the whole.
    take(giver, 'unity');
    tick(giver, 2);
    assert(giver.boonMods.cutPower > self,
      `the mastery left the holder's own share at ${giver.boonMods.cutPower.toFixed(3)}`);
    return `ally ×${(1 + (giver._bondEdge)).toFixed(2)} cut at 3 m, nothing at 90 m, `
      + `holder ×${self.toFixed(2)} alone and ×${giver.boonMods.cutPower.toFixed(2)} with the mastery`;
  });

  check('living force: Suffusion mends the person beside you, not you', () => {
    const w = gameWorld();
    const healer = livePlayer(w, { hp: 60 });
    const ally = livePlayer(w, { hp: 40, position: V(4, 0, 0) });
    take(healer, 'suffusion');
    const foe = spawnFoe(w, 'b1');
    w.onLimbSevered(foe, 'armL', foe.position.clone(), healer);
    assert(ally.hp > 40, `the ally was not healed at all (${ally.hp})`);
    assert(healer.hp === 60,
      `the healer healed themselves ${healer.hp - 60} while an ally was in reach — this card gives it away`);

    // Alone, it is not a dead card: half of it stays.
    const w2 = gameWorld();
    const solo = livePlayer(w2, { hp: 60 });
    take(solo, 'suffusion');
    const foe2 = spawnFoe(w2, 'b1');
    w2.onLimbSevered(foe2, 'armL', foe2.position.clone(), solo);
    assert(solo.hp > 60, 'alone, Suffusion healed nobody at all');
    assert(solo.hp - 60 < ally.hp - 40, 'the solo share is not smaller than the given share');
    return `ally +${(ally.hp - 40).toFixed(1)} hp per limb, giver +0; alone +${(solo.hp - 60).toFixed(1)}`;
  });

  check('living force: the Vow puts the ward on both of you', () => {
    const w = gameWorld();
    const keeper = livePlayer(w);
    const ally = livePlayer(w, { position: V(4, 0, 0) });
    const control = livePlayer(w, { position: V(200, 0, 0) });
    take(keeper, 'vow');
    tick(keeper, 2); tick(ally, 2); tick(control, 2);

    ally.invuln = 0; control.invuln = 0;
    ally.damage(20, ally.chest, null, 'bolt');
    control.damage(20, control.chest, null, 'bolt');
    const warded = ally.maxHp - ally.hp, bare = control.maxHp - control.hp;
    assert(warded < bare,
      `the warded ally took ${warded.toFixed(1)} against ${bare.toFixed(1)} — the vow reaches nobody`);

    // And the keeper: harder to kill while somebody is actually standing there.
    const alone = gameWorld();
    const lonely = livePlayer(alone);
    take(lonely, 'vow');
    tick(lonely, 2);
    keeper.invuln = 0; lonely.invuln = 0;
    keeper.damage(20, keeper.chest, null, 'bolt');
    lonely.damage(20, lonely.chest, null, 'bolt');
    const together = keeper.maxHp - keeper.hp, apart = lonely.maxHp - lonely.hp;
    assert(together < apart,
      `the keeper took ${together.toFixed(1)} with an ally and ${apart.toFixed(1)} without — standing together is worth nothing`);
    assert(apart < bare, 'a lone keeper gets nothing at all from their own vow');
    return `ally ${bare.toFixed(1)} → ${warded.toFixed(1)} damage; keeper ${apart.toFixed(1)} alone, `
      + `${together.toFixed(1)} with somebody beside them`;
  });

  check('living force: a communion crosses the wire and lands on the receiver', async () => {
    /**
     * THE CO-OP HALF, and the failure it is written against is this project's
     * own history: `claim` existed at both ends and nothing ever sent one, so
     * killing things in co-op did not work for the whole life of the mode. A
     * buff that only works between two players on the same machine would be the
     * same bug in a nicer coat, because there has never been a second player on
     * the same machine.
     */
    const { World } = await import('../../src/game/World.js');
    const net = await read('../src/net/Net.js').catch(() => readFile(new URL('../../src/net/Net.js', import.meta.url), 'utf8'));
    assert(/case 'bond'/.test(net), 'Net.js does not route a bond at all');
    assert(/t: 'bond'/.test(await read('game/World.js')), 'nothing ever sends a bond — a wire built at one end');
    assert(/toPeer\(/.test(await read('game/World.js')), 'the aura is broadcast rather than addressed to the peers in range');

    // The receiver is installed by World on every local player at spawn — not
    // by the card, which is on the giver's machine. Without that line the aura
    // would work only between two players who had drafted the same card, which
    // is a co-op feature that needs a rehearsal.
    const body = functionBody(await read('game/World.js'), '  spawnPlayer(');
    assert(/bondReceive/.test(body) && /bondGuardIn/.test(body),
      'World.spawnPlayer does not install the bond receiver, so a communion lands on nobody');

    // The receiving half, driven: World.applyBond writes the same slot a local
    // ally's aura writes, and the receiver's own installed tick reads it.
    const w = gameWorld();
    const me = livePlayer(w);
    w.player = me;
    w.time = 10;
    const applied = World.prototype.applyBond.call(w, { c: 1.4, s: 1.2, g: 0.3, h: 9 });
    assert(applied, 'applyBond refused the message');
    tick(me, 1);
    assert(Math.abs(me.boonMods.cutPower - 1.4) < 1e-6,
      `a received communion left cutPower at ${me.boonMods.cutPower.toFixed(3)}`);
    me.invuln = 0;
    const before = me.hp;
    me.damage(20, me.chest, null, 'bolt');
    const took = before - me.hp;
    assert(took < 20 * (w.difficulty?.damageTaken ?? 1) - 1,
      `a received ward took nothing off a 20-point blow (${took.toFixed(1)})`);

    // …and it LAPSES. A buff held by a packet that stopped arriving would make
    // a peer who quit the session a permanent aura.
    w.time += Waves.BOND.hold + 1;
    tick(me, 2);
    assert(Math.abs(me.boonMods.cutPower - 1) < 1e-6,
      `an expired communion is still worth ${me.boonMods.cutPower.toFixed(3)}× cut power`);
    return `applyBond → ×1.40 cut and a ward worth ${(20 * (w.difficulty?.damageTaken ?? 1) - took).toFixed(1)} damage, `
      + `lapsing after ${Waves.BOND.hold}s`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6. The general rule: no facet is a parameter nobody reads         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: every new facet installs a seam and every parameter has a reader', async () => {
    /**
     * The structural companion to the behavioural checks above, and the exact
     * analogue of controls.mjs's "every boon changes the player and every
     * change has a reader" — applied to the cards whose parameter is NOT a
     * boonMods key.
     *
     * `Player.defaultBoonMods()` is a closed contract (verify.mjs fails a card
     * that writes a key Player never declares), so a technique whose parameter
     * is not one of those keys keeps it on the instance, exactly as
     * `_juyoStacks` and `_mendClock` already do. The rule that matters is
     * unchanged: the number must be READ, outside the table that wrote it.
     */
    const waves = await read('game/Waves.js');
    const table = waves.indexOf('export const BOONS = [');
    assert(table > 0, 'the BOONS table is gone');
    const readers = waves.slice(0, table) + (await read('game/World.js'));
    // Counted rather than compared by identity: the receiver World installs at
    // spawn has already wrapped `update` and `damage`, so a card adding a sixth
    // handler to an existing chain leaves both functions the same object. What
    // has to move is the number of things listening.
    const seams = (p, w) => [p._boonTicks?.size || 0, p._boonGuards?.size || 0,
      p._boonAfterHit?.size || 0, w._boonSever?.length || 0, w._boonKill?.length || 0].join('/');
    const unread = [], inert = [];
    for (const [id, field] of NEW_FACETS) {
      const b = boon(id);
      const w = gameWorld();
      const p = livePlayer(w);
      const before = seams(p, w) + JSON.stringify(p.boonMods);
      b.apply(p, 1);
      if (seams(p, w) + JSON.stringify(p.boonMods) === before) inert.push(id);
      assert(p[field] !== undefined, `${id} does not write ${field} at all`);
      // The parameter has to be read somewhere that is not the card that wrote
      // it — which is the whole of the bug this project keeps having.
      const re = new RegExp(`this\\.${field}\\b|q\\.${field}\\b|p\\.${field}\\b`);
      if (!re.test(readers)) unread.push(`${id} → ${field}`);
    }
    assert(!inert.length, `facets that install nothing at all: ${inert.join(', ')}`);
    assert(!unread.length,
      `parameters nothing outside the card reads: ${unread.join(', ')} — the facet promises what the code never does`);
    return `${NEW_FACETS.length} new facets, each installing a real seam, each parameter read elsewhere`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  7. The meditation                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('meditation: the Holocron goes up through Screens and can always be left', () => {
    /**
     * The overlay rules are Screens.js's, and this drives the real thing: the
     * meditation is raised by `take`, so it must be REMEMBERED, it must stop
     * the world, Escape over it must land on a card that can resume, and
     * resuming must put the Holocron back rather than silently skipping it.
     *
     * The card is registered rather than built into Screens, and the registry
     * is the part that fails on the old code: without it, `clear()` and
     * `_hide()` know nothing about this overlay and a Holocron raised over a
     * run survives being quit to the main menu.
     */
    assert(LIVE.includes('meditation'),
      "'meditation' is not a live state — Escape would do nothing at all inside the Holocron");
    const up = new Set();
    const menu = {
      showPause: () => up.add('pause'), hidePause: () => up.delete('pause'),
      hideDraft() {}, hideLanding() {}, hideDeath() {},
    };
    const world = { paused: false, player: {} };
    const input = { enabled: true, exitLock() {}, requestLock() {} };
    const errors = [];
    const s = new Screens({
      world: () => world, input, menu, pauseStats: () => [], onError: (what, e) => errors.push(`${what}: ${e.message}`),
    });
    assert(typeof s.card === 'function', 'Screens cannot be taught about an overlay it did not ship with');
    s.card('meditation', () => up.delete('holocron'));
    s.state = 'playing';
    s.take('meditation', () => up.add('holocron'));
    assert(up.has('holocron'), 'the Holocron never went up');
    assert(s.overlay && s.overlay.state === 'meditation', 'the meditation was not remembered');
    assert(world.paused, 'the world is still running under the Holocron');
    assert(!input.enabled, 'the blade is still taking input under the Holocron');

    const did = s.escape();
    assert(did !== 'nothing', 'Escape inside the Holocron does nothing at all');
    assert(!up.has('holocron') && up.has('pause'),
      `Escape left ${[...up].join('+')} on screen — the registered card was not hidden`);
    s.resume();
    assert(s.state === 'meditation' && up.has('holocron'), 'resuming did not put the Holocron back');

    // A throw inside a purchase must land on the pause card, never on a void.
    s.guarded('waking a facet', () => { up.delete('holocron'); throw new Error('applyBoon is not a function'); })();
    assert(errors.length === 1, 'the throw was swallowed');
    assert(up.has('pause') && s.state === 'paused',
      `a failed purchase left state '${s.state}' with ${[...up].join('+')} on screen`);
    // …and quitting to the menu must take it down with everything else.
    s.take('meditation', () => up.add('holocron'));
    s.set('menu');
    assert(!up.has('holocron'), 'quitting to the menu left the Holocron on the screen forever');
    return 'take → remembered, world stopped; Escape → pause; resume → Holocron; a throw → pause; clear → gone';
  });

  check('meditation: it is reached by kneeling, and never in the middle of a fight', async () => {
    /**
     * The design asked for a moment in the world rather than a menu key, and
     * the three conditions are what make it one: still, grounded, and nothing
     * near you. They are checked in main.js — which cannot be imported outside
     * a browser — so this reads them the way tools/checks/screens.mjs reads the
     * state machine's wiring, and pins the parts that would silently rot.
     */
    const main = await read('main.js');
    assert(main.includes('function canCommune'),
      'nothing decides whether a communion is possible — the Holocron has no in-world door');
    const body = functionBody(main, 'function canCommune');
    assert(/screens\.state !== 'playing'/.test(body), 'the kneel is possible while an overlay owns the screen');
    assert(/grounded/.test(body), 'you can kneel in mid-air');
    assert(/velocity/.test(body), 'you can kneel at a dead run');
    assert(/distanceToSquared/.test(body) && /enemies/.test(body),
      'you can kneel with something swinging at you — a menu that opens mid-fight is a menu');
    assert(/COMMUNE\.clear/.test(body), 'the clear radius is not a named number');
    // The key is READ from the bindings table, never typed into the prompt: a
    // label baked into markup is wrong the moment anybody rebinds crouch.
    assert(/input\.act\('crouch'\)/.test(main), 'the kneel is not read through the bindings table');
    /**
     * THE LABEL COMES FROM THE BINDINGS — asserted through the seam rather than
     * by its spelling.
     *
     * This pinned the literal expression `keyLabel((input.bindings.crouch…`,
     * which was the shipped form until gamepad support arrived and hoisted it
     * into `liveKey(id)` — one helper that resolves the code for the ACTIVE
     * DEVICE and prints a pad glyph when a pad is holding it. That is strictly
     * better than what the regex demanded, and the regex failed it: the check
     * was restating an implementation instead of calling the rule (§2.4), and
     * it punished the refactor that improved the thing it was guarding.
     *
     * So it now follows the seam in two steps — the prompt's label is assigned
     * from `liveKey`, and `liveKey` reads `input.bindings`. A literal typed into
     * the prompt still fails, which is the property that matters, and the next
     * person to improve the helper is not punished for it.
     */
    assert(/communePrompt\.key\.textContent\s*=\s*liveKey\(/.test(main),
      'the prompt types a key name instead of reading the live binding');
    assert(/const liveKey[^\n]*input\.bindings/.test(main),
      'liveKey no longer reads the bindings table, so the prompt is showing a guess');
    assert(/screens\.take\('meditation'/.test(main), 'the meditation is raised without Screens — it will not be remembered');
    assert(/screens\.card\('meditation'/.test(main), 'the meditation card is never registered with Screens');
    // Both doors: mid-run by kneeling, and from the Temple between runs.
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    for (const id of ['meditation', 'med-field', 'commune', 'btn-commune', 'btn-med-buy']) {
      assert(html.includes(`id="${id}"`), `#${id} is missing from index.html`);
      assert(main.includes(`'${id}'`) || (await read('ui/SkillTree.js')).includes(`'${id}'`),
        `#${id} is in the page and nothing reads it`);
    }
    return 'kneel: playing + grounded + still + nothing within COMMUNE.clear; both doors wired, key read from bindings';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  8. Training, anywhere                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('training: the eleven lessons run in any theatre, not only the dojo', async () => {
    /**
     * The lessons were reachable only by picking the level called "The Dojo",
     * so you could learn to return a bolt in an octagonal hall and had no way
     * to practise it on the dune face you keep dying on. Nothing about
     * DojoDirector ever needed that room: it places everything relative to the
     * PLAYER and reads nothing off the level. This drives it in a level that is
     * emphatically not the dojo and requires every lesson to build its room.
     */
    assert(Waves.MODES.training, 'there is no training mode — the lessons are still pinned to one level');
    /**
     * …AND `World.loadLevel` HONOURS IT — read off the mode's own DECLARATION
     * rather than off the spelling of a branch.
     *
     * This used to grep for `settings.mode === 'training'`, which is a test of
     * one string and cannot tell whether the branch it found is the dojo
     * branch or something else that happens to name the mode. The mode
     * declares `dojo` now — one flag, one writer, two readers (`loadLevel`
     * builds the `DojoDirector` off it, and `musterPlan` refuses to raise a
     * line for a mode that has no roster to put one on) — so the property is
     * asserted in both directions: the mode says it, and the world reads it.
     */
    assert(Waves.MODES.training.dojo === true,
      'MODES.training does not declare `dojo`, so nothing can tell the lessons apart from a wave');
    const dojos = Object.keys(Waves.MODES).filter((m) => Waves.MODES[m].dojo);
    assert(dojos.length === 1, `${dojos.length} modes declare a dojo: ${dojos.join(', ')}`);
    const world = await read('game/World.js');
    assert(/MODES\[this\.settings\.mode\]\?\.dojo/.test(world),
      'World.loadLevel does not read the mode\'s dojo declaration, so picking Training drops '
      + 'you into a normal wave');

    const settings = { mode: 'training' };
    let id = 0;
    const w = {
      settings, enemies: [], locks: [], difficulty: DIFFICULTY.knight, takenBoons: new Set(),
      player: { position: V(12, 0, -30) },              // deliberately not the origin
      bolts: { clear() {} }, bladeSolver: { clearTarget() {} },
      terrain: { inBounds: () => true, slopeAt: () => 0, height: () => 0 },
      level: LEVELS.drifts, levelKey: 'drifts',
      notify() {},
      spawnEnemy(type, pos) {
        const A = Foe.ARCHETYPES[type] || Foe.ARCHETYPES.b1;
        const e = { id: 'e' + (id++), type, A, dead: false, dying: 0, position: pos.clone(),
          attackTimer: 0, burstLeft: 0, burstTimer: 0,
          duel: A.saber ? { formKey: 'makashi', form: null, describe: () => 'Makashi' } : null,
          dispose() {} };
        w.enemies.push(e);
        return e;
      },
    };
    const d = new DojoDirector(w);
    d.start();
    const rows = [];
    for (let i = 0; i < LESSONS.length; i++) {
      d.index = i; d.progress = 0; d._applyLesson();
      const need = LESSONS[i].setup || {};
      const wanted = (need.remotes || 0) + (need.dummies || 0) + (need.spar ? 1 : 0);
      if (wanted) {
        assert(w.enemies.length >= wanted,
          `lesson "${LESSONS[i].id}" built ${w.enemies.length} of the ${wanted} bodies it asks for, outside the dojo`);
        // and it must build them around the PLAYER, wherever the player is
        const near = w.enemies.every((e) => e.position.distanceTo(w.player.position) < 12);
        assert(near, `lesson "${LESSONS[i].id}" placed a body away from the player instead of around them`);
      }
      rows.push(`${LESSONS[i].id}:${w.enemies.length}`);
    }
    /* RE-DERIVED, and it is now the strongest form this property can take.
     *
     * It used to read "the dojo keeps its `training` flag, and the dune sea
     * does not" — a pair of assertions about two named levels, which was the
     * best available while training was still half pinned to one room. THE
     * DOJO HAS BEEN DELETED, at the player's request, and that is precisely
     * why this check now says more rather than less: with no level carrying
     * the flag at all, the eleven lessons above ran on an ordinary theatre
     * with no help from a purpose-built room, which is the thing the mode was
     * always claimed to do and could never previously be shown to do.
     *
     * `World.loadLevel` opens the director on `L.training || mode ===
     * 'training'`, so the flag remains a supported door for a level that wants
     * it. Nothing may claim it by accident, though: a level with `training`
     * set would silently lose its wave director in every other mode. */
    const flagged = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].training);
    assert(flagged.length === 0,
      `${flagged.join(', ')} still carries the training flag — that level cannot be played in any other mode`);
    return `${LESSONS.length} lessons built in "${LEVELS.drifts.name}", a level with no training flag at all, `
      + `around a player at (12, -30): ${rows.slice(0, 4).join(' ')}…`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The Holocron, operated                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('living force: a facet that says it is a button behaves like one', async () => {
    /**
     * SkillTree draws every facet with `tabindex="0"` and `role="button"`, and
     * styles.css carries a `#med-field .facet:focus` rule for it — so a facet
     * takes focus and announces itself to a screen reader as a button. It
     * registered `click` and `dblclick` and nothing else, so Enter and Space did
     * nothing at all: the ONE place in the whole front end that had bothered to
     * claim a keyboard affordance was the one place that had not built it.
     *
     * Driven through the real SkillTree on the real meditation markup, because
     * the claim is about the elements it emits. Synchronous once the document
     * is installed — the runner starts the next check the moment this one
     * suspends, and a globally installed document would follow it there.
     */
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const { SkillTree } = await import('../../src/ui/SkillTree.js');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const bought = [];
      const tree = new SkillTree(doc, { onBuy: (id) => bought.push(id) });
      const taken = new Waves.RankSet([]);
      tree.show({ taken, ledger: new Tree.Communion({ insight: 999 }), wave: 9, order: 'jedi', live: true });
      /* `.hol-rung` and not `.facet`: the star chart is gone (see
       * SkillTree._draw) and a facet is a RUNG on a plate now. The property
       * this check is about — a thing that claims to be a button behaves like
       * one — is unchanged and is exactly as easy to break in the new drawing. */
      const nodes = doc.querySelectorAll('#med-field .hol-rung');
      assert(nodes.length > 10, `${nodes.length} rungs drew`);
      const deaf = nodes.filter(g => g.listenerCount('keydown') === 0);
      assert(!deaf.length,
        `${deaf.length}/${nodes.length} rungs carry tabindex="0" role="button" and no key listener at all`);
      const focusable = nodes.filter(g => g.getAttribute('tabindex') === '0');
      assert(focusable.length === nodes.length, 'a facet lost its place in the tab order');
      /* THE FACET THE HOLOCRON IS ACTUALLY OFFERING, and not merely a root.
       * `SkillTree` refuses to buy what `canBuy` refuses, and since PLAN.md
       * §4.6's offer landed a root can be one of the three or not — so a
       * fixture that reached for `.root` was testing the keyboard against a
       * card the screen is right to refuse. The rung this drives is the one the
       * ledger says is on the table. */
      const offered = new Tree.Communion({ insight: 999 }).offerNow(taken, 9);
      const root = nodes.find(g => offered.includes(g.dataset?.facet))
        || nodes.find(g => g.classList.contains('root')) || nodes[0];
      root.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(tree.selected, 'Enter on a facet selected nothing');
      // …and Enter on the facet already selected is the keyboard's double-click.
      const before = bought.length;
      root.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(bought.length === before + 1,
        'Enter on the selected facet did not buy it — the keyboard can look and never spend');
      assert(bought[0] === tree.selected, `it bought ${bought[0]} with ${tree.selected} selected`);
      return `${nodes.length} rungs, all focusable and listening; Enter selects then buys (${bought[0]})`;
    } finally { restore(); }
  });

  check('holocron: every facet carries its own price, and every number is the ledger\'s', async () => {
    /**
     * THE SHOP HID ITS PRICE TAGS ON EVERYTHING YOU COULD NOT AFFORD, and the
     * fix has since gone further than the first version of this check asked
     * for.
     *
     * ROUND ONE. `SkillTree._draw` drew a cost badge under `!v.held && v.can &&
     * live`, and `can` is affordable AND reachable AND ungated — so on the
     * first open of a run, purse 0 against six hearts at 9, the lattice carried
     * NOT ONE NUMBER. This check demanded a price on everything the purse alone
     * stood between the player and.
     *
     * ROUND TWO is the drawing itself. The player: "get fucking rid of it and
     * redo the whole thing, also make it less confusing." The star chart is
     * gone and a facet is a RUNG on a plate, which is a row of text — so there
     * is no longer any reason to ration numbers to the ones a label solver
     * could fit. EVERY rung carries its price, always, including the ones three
     * joins away, because that is what makes the screen plannable rather than
     * merely honest about the next purchase.
     *
     * So the property is stronger than it was: not "every price the purse could
     * meet" but "every price", with the STATE — affordable, short, gated,
     * already yours — carried by the tag rather than by its absence.
     *
     * Every number it prints is still compared against `Communion` rather than
     * against a second copy of the price series: the whole point of `facetView`
     * is that the rules have one implementation, and a check that re-derived
     * them would agree with itself and nothing else.
     */
    const html = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const { SkillTree } = await import('../../src/ui/SkillTree.js');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const tree = new SkillTree(doc, {});
      const tagged = (t) => [...t._nodes].map(([id, g]) => {
        const c = g.querySelector('.hol-cost');
        return { id, text: c ? c.textContent : null, cost: Number(c?.textContent),
          short: !!c?.classList.contains('short') };
      });
      /* The ones showing an actual number — a held-out facet reads '✓' and a
       * gated mastery reads '—', and neither is a price. */
      const priced = (t) => tagged(t).filter((p) => Number.isFinite(p.cost));

      /* ── the opening of a run, which is where it was worst ─────────── */
      const taken = new Waves.RankSet();
      const led = new Tree.Communion();
      tree.show({ taken, ledger: led, wave: 1, order: 'jedi', live: true });
      const all = tagged(tree);
      const open = priced(tree);
      assert(all.length > 10, `${all.length} rungs drew`);
      const blank = all.filter((p) => !p.text);
      assert(!blank.length,
        `${blank.length} rungs carry no tag at all — every one is supposed to say a price, a tick or a dash`);
      /* EVERY facet the ledger will ever quote a number for has that number on
       * it, including the ones three joins out of reach. The set is derived
       * from the ledger rather than named: anything not gated and not already
       * maxed has a price. */
      const quotable = Tree.FACETS.filter((f) =>
        led.reasonLocked(f.id, taken, 1) !== Tree.LOCKED.gated && Number.isFinite(led.costOf(f.id, taken)));
      assert(open.length === quotable.length,
        `${open.length} prices drawn against ${quotable.length} facets the ledger can quote — a rung `
        + 'without its number is a circle the player has to guess at');
      assert(open.every((p) => p.short),
        'a facet is drawn as affordable on an empty purse');

      /* ── every number equals the ledger's ──────────────────────────── */
      const wrong = open.filter((p) => p.cost !== led.costOf(p.id, taken));
      assert(!wrong.length,
        `prices that disagree with Communion.costOf: ${wrong.map((p) => `${p.id} shows ${p.cost} `
          + `against ${led.costOf(p.id, taken)}`).join('; ')}`);

      /* ── and the purse line names the exact shortfall ──────────────── */
      /* WITHIN REACH, which is not the same set as "has a price on it" any
       * more. `_purseLine` names the cheapest thing the purse alone stands
       * between the player and; the rack now also prices facets three joins
       * away, and the minimum over ALL of them is a number the purse line is
       * right not to quote. */
      const inReach = open.filter((p) =>
        led.reasonLocked(p.id, taken, 1) === Tree.LOCKED.insight || led.canBuy(p.id, taken, 1));
      assert(inReach.length, 'nothing at all is within reach on an empty lattice');
      const cheapest = Math.min(...inReach.map((p) => p.cost));
      const line = doc.getElementById('med-purse').textContent;
      assert(line.includes(String(cheapest)),
        `the purse says "${line}" and the cheapest thing within reach is ${cheapest}`);

      /* ── mid-run: prices climb, the footer says by how much, and the
       *    detail line converts the gap into waves off this run's ledger ─ */
      const t2 = new Waves.RankSet(['cadence', 'attune-blade', 'djemso']);
      const led2 = new Tree.Communion({ insight: 6, earned: 28, bought: ['attune-blade', 'djemso', 'cadence'] });
      tree.show({ taken: t2, ledger: led2, wave: 20, order: 'jedi', live: true });
      const mid = priced(tree);
      const bad = mid.filter((p) => p.cost !== led2.costOf(p.id, t2));
      assert(!bad.length, `mid-run prices disagree with the ledger: ${bad.map((p) => p.id).join(', ')}`);
      /* `short` is now the answer to "is there anything at all between you and
       * this", which on a rack that prices the whole lattice is exactly
       * `!canBuy` — money, reach and gating together. It used to be read on a
       * set that was already filtered to the reachable, where the two questions
       * happened to coincide. */
      const lit = mid.filter((p) => !p.short && !led2.canBuy(p.id, t2, 20));
      assert(!lit.length,
        `lit as affordable but the ledger refuses: ${lit.map((p) => p.id).join(', ')}`);
      const dimmed = mid.filter((p) => p.short && led2.canBuy(p.id, t2, 20));
      assert(!dimmed.length,
        `dimmed but the ledger would take it: ${dimmed.map((p) => p.id).join(', ')}`);

      const foot = doc.getElementById('med-hint').textContent;
      const surcharge = led2.bought.length * Tree.COST_STEP;
      assert(foot.includes(String(surcharge)),
        `the footer says "${foot}" and every price is ${surcharge} over its base`);
      /* The way out is on that line whatever else is: it used to be a ternary
       * against the escalator note, so buying one facet DELETED the only
       * sentence on the screen that says how to leave it. */
      assert(/escape/i.test(foot),
        `after three purchases the footer is "${foot}" and no longer says how to leave the screen`);

      /* The distance, in the two units the player has. `earned/wave` is this
       * run's own pace — 28 over 20 waves — so the estimate carries the mode's
       * rate without the screen having to know which mode it is in. */
      const far = tree.view.find((v) => v.locked === Tree.LOCKED.insight);
      assert(far, 'nothing on a 6-Insight purse at wave 20 is out of reach on price alone');
      tree._select(far.id);
      const detail = doc.getElementById('med-detail').textContent;
      const short = far.cost - Math.floor(led2.insight);
      const waves = Math.ceil(short / (led2.earned / 20));
      assert(detail.includes(`${short} more`),
        `the card for ${far.id} costs ${far.cost} against ${led2.insight} held and does not say `
        + `"${short} more" — it says: ${detail.replace(/\s+/g, ' ').slice(-90)}`);
      assert(detail.includes(`${waves} more wave`),
        `${short} Insight at ${(led2.earned / 20).toFixed(2)} a wave is ${waves} waves and the card `
        + `does not say so: ${detail.replace(/\s+/g, ' ').slice(-90)}`);

      /* ── between runs there is no purse, so there are no prices ────── */
      tree.show({ taken: new Waves.RankSet(), ledger: new Tree.Communion(), wave: 1, order: null, live: false });
      assert(priced(tree).length === 0,
        'the Temple chart prices facets it cannot sell');

      return `w1 empty purse: ${open.length} prices, all dim, cheapest ${cheapest}; `
        + `w20 three woken: ${mid.length} prices all +${surcharge} over base; `
        + `${far.id} reads "${short} more, about ${waves} more waves"; chart prices nothing`;
    } finally { restore(); }
  });

  /**
   * THE HOLOCRON CAN BE OPENED, because a kit nobody can reach is a kit
   * nobody can tell you is broken.
   *
   * Reported: "I can't actually test out anything in the Holocron to even
   * know if it works… I haven't even been able to force lightning or force
   * compel yet." Both are gated on `boonMods.lightning` / `boonMods.compel`,
   * which arrive only as a boon, which arrives only from a draft or a facet
   * bought at roughly 1.4 Insight a wave — so a whole run can end without the
   * player meeting half of what is built.
   *
   * Three settings, and the check is that they are three DIFFERENT games:
   * 'earned' is untouched (the default has to stay bit-identical or this is a
   * balance change wearing a debug hat), 'open' pays but does not choose, and
   * 'all' chooses. `all` is asserted to actually light the two powers by name,
   * because those two are the report.
   */
  check('holocron: it can be opened, and opening it is not the same as filling the purse', async () => {
    const H = await import('./_coop.mjs');
    const boot = async (holocron) => {
      const { world } = await H.bootWorld({
        level: 'colosseum',
        settings: { mode: 'roguelite', difficulty: 'knight', holocron },
      });
      const p = world.player;
      const out = {
        insight: world.communion.insight,
        lightning: !!p.boonMods.lightning,
        compel: !!p.boonMods.compel,
        held: world.takenBoons.size ?? 0,
      };
      world.unload();
      return out;
    };

    const earned = await boot('earned');
    const open = await boot('open');
    const all = await boot('all');

    // The default is the game, and it must not have moved.
    assert(earned.insight === 0, `'earned' starts with ${earned.insight} Insight, not 0`);
    assert(!earned.lightning && !earned.compel,
      "'earned' hands out a power at spawn — the default is supposed to be untouched");

    // 'open' PAYS. It must not also choose: the kneel, the pick and the price
    // escalator are the shape of the feature and survive it.
    assert(open.insight > 100, `'open' opened with ${open.insight} Insight`);
    assert(!open.lightning && !open.compel,
      "'open' lit facets by itself — it is meant to make them affordable, not to take them");
    assert(open.held === earned.held,
      `'open' arrived holding ${open.held} boons against 'earned''s ${earned.held}`);

    // 'all' CHOOSES, and the two powers in the report are the two asserted.
    assert(all.lightning, "'all' did not light Force lightning — the reported power is still unreachable");
    assert(all.compel, "'all' did not light Compel — the reported power is still unreachable");
    assert(all.held > earned.held + 10,
      `'all' arrived holding only ${all.held} boons — the lattice is ${Tree.FACETS.length} facets wide`);

    return `earned ${earned.insight}i/${earned.held} · open ${open.insight}i/${open.held} · `
      + `all ${all.held} of ${Tree.FACETS.length} facets, lightning+compel woken`;
  });

  check("the open purse reaches the bottom of every current, from wave 1", () => {
    /**
     * THE PROMISE, TESTED AS A PROMISE — and the money was never the reason.
     *
     * The player: "confirm that with a full purse you can finish an entire
     * path at the very beginning of a game… it still wouldn't let me get the
     * final couple of things at the very bottom."
     *
     * They were right, and the first guess was wrong. `HOLOCRON_PURSE` was
     * short once and is derived now, so a bigger number looked like the fix.
     * Driven at wave 1 with an INFINITE purse, nineteen facets still answered
     * `LOCKED.depth` — a facet inherits its card's `minWave` and the deepest is
     * 16 — and among them were `lightning` and `compel`, which are the two
     * powers this setting was added for in the first place.
     *
     * So the check drives BOTH arms at wave 1. 'earned' must still be the game
     * (a purse that runs out and a depth gate that holds), and 'open' must
     * reach every facet in the lattice on the first wave, which is what its
     * card says in as many words.
     */
    const buyAll = (ledger, wave) => {
      const taken = new Set();
      for (let pass = 0; pass < 200; pass++) {
        let any = false;
        for (const f of Tree.FACETS) {
          if (taken.has(f.id)) continue;
          if (!ledger.canBuy(f.id, taken, wave)) continue;
          ledger.buy(f.id, taken, wave); taken.add(f.id); any = true;
        }
        if (!any) break;
      }
      return taken;
    };
    const shut = new Tree.Communion();
    shut.insight = 600;
    const got = buyAll(shut, 1);
    assert(got.size < Tree.FACETS.length,
      `a shut purse reached all ${Tree.FACETS.length} facets at wave 1 — the earned game has no gate left`);

    const open = new Tree.Communion({ open: true });
    open.insight = 600;
    const all = buyAll(open, 1);
    const missed = Tree.FACETS.filter((f) => !all.has(f.id)).map((f) => f.id);
    /**
     * PER CURRENT, because "an entire path" is what was asked for and a path is
     * ONE of the six — The Book is the Force current's Jedi name, not a name
     * for the lattice. A total that is right while one column is unreachable
     * would answer the wrong question, and reading a single number is exactly
     * how that goes unnoticed.
     */
    const short = [];
    for (const c of Tree.CURRENTS) {
      const mine = Tree.FACETS.filter((f) => f.axis === c.axis);
      const got = mine.filter((f) => all.has(f.id)).length;
      if (got < mine.length) short.push(`${c.axis} ${got}/${mine.length}`);
    }
    assert(!short.length,
      `an open purse cannot finish every current at wave 1: ${short.join(', ')} — `
      + '"finish an entire path at the very beginning" is the whole promise');
    assert(!missed.length,
      `an open purse could not reach ${missed.length} of ${Tree.FACETS.length} facets at wave 1: `
      + `${missed.slice(0, 8).join(', ')} — the card promises the whole Holocron from the first wave`);
    /* AND IT DOES NOT EMPTY, which is the other half of what was asked for. */
    assert(open.insight === 600,
      `an open purse fell from 600 to ${open.insight} — it is meant not to be spent`);
    /* …and the price is still COMPUTED, because the escalator is the shape of
     * the choice and the card still shows it. A cost that went to zero would
     * be the feature quietly becoming 'all'. */
    assert(open.costOf(Tree.FACETS[0].id, all) > 0, 'an open purse zeroed the prices');
    return `wave 1: shut purse ${got.size}, open purse ${all.size} of ${Tree.FACETS.length}, purse unspent`;
  });

  check('every unbound card names the power it unleashes, in the words the game uses', async () => {
    /**
     * "can you explain to me which powerups make which force abilities have no
     * cooldown anymore? the descriptions in the holocron are so riddly and
     * totally vague"
     *
     * They were. "The shove no longer needs a breath between" is the whole of
     * what "The Endless Wave" used to say about being Force push, and a card
     * whose effect you have to infer is a card that cannot be chosen. The name
     * stays evocative — that is the Holocron's voice — but the body has to say
     * which power, in the same words the key-bindings screen uses for it, so
     * the two can be read against each other.
     */
    const { ACTIONS } = await import('../../src/engine/Bindings.js');
    const Powers = await import('../../src/game/Powers.js');
    const { POWERS } = await import('../../src/ui/HUD.js');
    /**
     * A POWER IS NOT ALWAYS A KEY, and this check assumed it was.
     *
     * It looked each card's `key` up in ACTIONS directly, which held for as
     * long as every power had a binding of its own. Two do not: `throwOff` and
     * `orbit` both RIDE the `throw` key, because that key means three different
     * things in the three saber sets — the disc, the saberstaff's orbit, the
     * pair's shoto — and the measured keyboard budget has nothing left to give
     * them rows of their own. So the card for the pair's throw named
     * 'throwOff', which is a real power with a real cost and a real slot on the
     * wheel, and this file called it "not an action".
     *
     * `HUD.POWERS` is already the power → binding column, written where the
     * wheel needed it and carrying its own argument for these two rows. It is
     * imported rather than restated (§2.4), and the mapping is asserted to be
     * TOTAL over the cards, so a fourteenth power that nothing draws still
     * fails here rather than being quietly resolved to nothing.
     */
    const slot = new Map(POWERS);
    const vague = [];
    for (const u of Powers.UNBOUND) {
      assert(slot.has(u.key),
        `unbound card ${u.name} names the power '${u.key}' and HUD.POWERS gives it no slot, so the `
        + 'wheel neither draws it nor prices it');
      const bind = slot.get(u.key);
      const act = ACTIONS.find((a) => a.id === bind);
      assert(act, `unbound card ${u.name} names '${u.key}', which rides '${bind}' — not an action`);
      assert(act.label, `the action '${u.key}' has no label to name it by`);
      /* The first noun of the action's own label — "Force push" out of
       * "Force push", "Stasis field" out of "Stasis field", "Throw" out of
       * "Throw / recall saber" — is what a player will scan for. */
      const word = act.label.split(/[\/(]/)[0].trim().toLowerCase();
      const text = String(u.text || '').toLowerCase();
      if (!text.includes(word) && !text.includes(u.key)) vague.push(`${u.name} → ${act.label}`);
      assert(/cooldown/.test(text),
        `${u.name} never says the word "cooldown", which is the only thing it does`);
      /* And the price, because a card that states a gift and hides a bill is
       * the riddle wearing a different hat. */
      assert(/force/.test(text) && /health|blood|hp/.test(text),
        `${u.name} does not say what it costs in Force and in health`);
    }
    assert(!vague.length,
      `${vague.length} unbound card(s) never name their power: ${vague.join('; ')}`);
    return `${Powers.UNBOUND.length} cards, each naming its power, its cooldown and its price`;
  });

  check('a card that changes a number says which number, and by how much', async () => {
    /**
     * "go through everything else in the holocron and make sure the player can
     * actually understand what they're getting and that it's not too vague"
     *
     * They were describable in two piles. Some cards stated a magnitude —
     * "a quarter sooner", "twice as long", "Thirty more vitality" — and some
     * gave you an image and nothing to plan with: "Cuts bite deeper", "a share
     * of every blow", "hands a measure of it straight back", "the less the
     * Force asks", "give it a few seconds". A player choosing between two
     * cards cannot compare a share with a measure.
     *
     * Every one of those had a number sitting in its own `apply` — 0.35, 22,
     * 0.85, five seconds — so the fix was never invention, it was transcription.
     * The names keep the Holocron's voice; the bodies carry the arithmetic.
     *
     * WHAT THIS CANNOT DO is check that the number is the RIGHT one — no test
     * short of reading English can. What it can do is refuse the shape the
     * whole complaint was about: a card that moves a number and does not print
     * one. A card whose effect is a switch (Force lightning, Triage, Salvage)
     * is exempt from the magnitude and not from the rest.
     */
    const { defaultBoonMods } = await import('../../src/game/Player.js');
    const { modsMoved } = await import('./_shared.mjs');
    /* Rich enough for the cards that reach past `boonMods` — a blade with a
     * length, a control block with a deadzone — because the alternative is
     * exempting exactly the cards that were vaguest. */
    const stub = () => ({
      boonMods: defaultBoonMods(), boons: new Set(),
      maxHp: 100, hp: 100, maxForce: 100, maxStamina: 100, stamina: 100,
      saber: { bladeLength: 1.4, coreWidth: 1 },
      control: { deadzone: 0.2, sensitivity: 1 },
    });
    const STAT = ['maxHp', 'maxForce', 'maxStamina'];
    /* A digit, or the words English uses for one. */
    const MAGNITUDE = /\d|\bhalf\b|\btwice\b|\bdouble[ds]?\b|\bthird\b|\bquarter\b|\bfifth\b|\bentirely\b|\bin full\b|\boutright\b/i;
    const mute = [], silent = [], doubled = [];
    const cards = [...Waves.BOONS, ...(Waves.ATTUNEMENTS || [])];
    const inTree = new Set(Tree.FACETS.map((f) => f.id));
    let numeric = 0, switches = 0;
    for (const b of cards) {
      if (!inTree.has(b.id)) continue;
      const text = String(b.text || '');
      if (!text.trim()) { silent.push(b.id); continue; }
      /**
       * A SENTENCE THAT SAYS ITSELF TWICE, which is what a botched edit ships.
       *
       * `text:` in this table is sometimes ONE literal and sometimes several
       * joined with `+` across lines. A rewrite that replaced only the first
       * left the old tail glued on the end, and three cards went out reading
       * "…only so much in it.so much in it." and "…Permanent, and
       * repeatable.Permanent, and repeatable." Nothing caught it: the text was
       * present, it was long enough, and it stated its magnitude. Only reading
       * it did — so this reads it.
       */
      for (let n = Math.floor(text.length / 2); n >= 10; n--) {
        if (text.slice(0, -n).includes(text.slice(-n))) {
          doubled.push(`${b.id} ends by repeating "${text.slice(-n)}"`);
          break;
        }
      }
      /* NO LENGTH BAR. The first cut of this failed `celerity` — "You move 20%
       * faster." — for being 24 characters, which is the check preferring prose
       * to clarity and is the opposite of the point. Short is not vague; vague
       * is vague, and the magnitude rule below is what measures it. */
      const before = stub(), after = stub();
      try { b.apply(after, 1); } catch { continue; }   // needs a live world: not this check's business
      const moved = modsMoved(after.boonMods, before.boonMods)
        .filter((k) => typeof after.boonMods[k] === 'number');
      const stats = STAT.filter((k) => after[k] !== before[k]);
      const blade = after.saber.bladeLength !== before.saber.bladeLength
        || after.saber.coreWidth !== before.saber.coreWidth;
      if (!moved.length && !stats.length && !blade) { switches++; continue; }
      numeric++;
      if (!MAGNITUDE.test(text)) {
        mute.push(`${b.id} moves ${[...moved, ...stats].join('/') || 'the blade'} and says "${text}"`);
      }
    }
    assert(!silent.length, `card(s) in the lattice with no text at all: ${silent.join(', ')}`);
    assert(!doubled.length,
      `card(s) whose text repeats itself — a half-applied edit: ${doubled.join('; ')}`);
    assert(!mute.length,
      `${mute.length} card(s) change a number and never print one — the exact complaint:\n  `
      + mute.join('\n  '));
    assert(numeric > 20, `only ${numeric} cards were measured as numeric — the stub has stopped applying them`);
    return `${numeric} cards move a number and every one states a magnitude; ${switches} are switches`;
  });

  check('the holocron says what it is for, and its refusals say how far', () => {
    /**
     * THE SURFACES THAT ARE NOT CARDS — asked for by name after the cards were
     * done: "go through everything else in the holocron".
     *
     * TWO OF THEM WERE THE CARDS' OWN DEFECT, one level out. The six plates are
     * the whole navigation of the Holocron and carried a NAME and a COUNT: "THE
     * GUARDIAN 3/8", with a creed under it that is a mood rather than a
     * signpost. And two lock lines refused without saying how far away the
     * thing was — "A mastery. Commit to the discipline first." and "Too early.
     * This one comes later." — which are exactly the sentences a player is
     * asking "how many more?" and "which wave?" at.
     *
     * Both numbers already existed. `facetView` carries them now, so the check
     * is that they arrive rather than that a particular sentence is printed:
     * the wording is the screen's business, the numbers are not.
     */
    for (const c of Tree.CURRENTS) {
      const what = Tree.whatOf(c.axis);
      assert(what && what.length > 15,
        `the ${c.axis} current has no line saying what it is for — a plate with a name and a count `
        + 'is not a signpost');
      assert(what !== Tree.creedOf(c.axis, null),
        `the ${c.axis} current's signpost is just its creed, which is a mood and not a description`);
    }
    /* A DEPTH-LOCKED CARD KNOWS WHICH WAVE IT OPENS ON, and a gated one knows
     * how many of its current it wants and how many you hold. */
    const led = new Tree.Communion();
    led.insight = 9999;
    const held = new Set(['cadence']);
    const deep = Tree.facetView('unbound-push', { taken: held, ledger: led, wave: 1 });
    assert(deep.locked === Tree.LOCKED.depth,
      `unbound-push at wave 1 is ${deep.locked}, so this is measuring the wrong refusal`);
    assert(deep.minWave > 1, 'the depth-locked card does not carry the wave it opens on');
    const mast = Tree.facetView('sunder', { taken: held, ledger: led, wave: 20 });
    assert(mast.locked === Tree.LOCKED.gated,
      `sunder at wave 20 holding one blade card is ${mast.locked} — expected the discipline gate`);
    assert(mast.needs > 0 && Number.isInteger(mast.have),
      `the gated card carries needs=${mast.needs} have=${mast.have} — the refusal cannot say how far`);
    assert(mast.have < mast.needs,
      `sunder says you hold ${mast.have} of ${mast.needs} and is still gated`);
    return `${Tree.CURRENTS.length} currents signposted; depth names wave ${deep.minWave}, `
      + `the discipline gate names ${mast.have}/${mast.needs}`;
  });
}
