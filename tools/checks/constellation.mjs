/**
 * BATTLEFRONT BORZ — the constellation: a skill tree that is not a lie.
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
 * measuring the difference between a run that took the star and one that did
 * not. No check below is satisfied by a flag being set. Where a card's whole
 * effect is a technique (a barrier, a reflection, an aura on somebody else),
 * the check installs it on a real prototype, runs frames, and reads the
 * consequence out of health, damage or a modifier the game already consults.
 *
 * The structural checks that remain are the ones a behavioural test cannot
 * express: that the sky is exactly the boon table (so a card cannot be added
 * and be invisible, or a star exist with no mechanism behind it), that the
 * economy cannot outrun the draft it sits beside (arithmetic, at every wave out
 * to 60, because a stochastic depth number would fail on honest tuning), and
 * that the meditation cannot strand the player (driven against the real
 * Screens, which is where that guarantee lives).
 *
 * Every check here fails on the tree before the constellation existed: the
 * module is imported by name in the first check and every later one asserts on
 * something that had no code at all.
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

/** The nine stars this round added, and the instance field each one writes. */
const NEW_STARS = [
  ['thorns', '_thornsShare'], ['aegis', '_aegisMax'], ['momentum', '_momentumPer'],
  ['execute', '_executeAt'], ['detonate', '_detonate'], ['communion', '_bondEdge'],
  ['suffusion', '_bondHeal'], ['vow', '_bondWard'], ['unity', '_bondMastery'],
];

export async function run({ check, assert }) {
  await initPhysics();
  Foe = await import('../../src/game/Enemy.js?constellation');

  let Tree = null, treeErr = null;
  try { Tree = await import('../../src/game/Constellation.js'); } catch (e) { treeErr = e; }

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. The sky is the boon table, arranged                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: the sky is the boon table and nothing else', () => {
    assert(Tree, `there is no src/game/Constellation.js: ${treeErr?.message || 'missing'} — `
      + 'the run has no spine but a flat list of cards');
    const all = [...Waves.BOONS, ...Waves.ATTUNEMENTS];
    const ids = new Set(all.map((b) => b.id));
    const stars = Tree.STARS;
    const starIds = new Set(stars.map((s) => s.id));
    assert(starIds.size === stars.length,
      `${stars.length - starIds.size} star(s) appear twice in the sky — a card in two places is two prices`);
    // The property that stops the tree from silently going stale: a card added
    // to BOONS and forgotten here would be draftable and invisible in the one
    // screen that claims to show the whole system.
    const homeless = [...ids].filter((i) => !starIds.has(i));
    assert(!homeless.length,
      `cards with no star: ${homeless.join(', ')} — the sky claims to be the whole system and is not`);
    // …and the reverse: a star with no boon behind it is a node that grants
    // nothing at all, which is exactly the bug this suite exists for.
    const ghosts = [...starIds].filter((i) => !ids.has(i));
    assert(!ghosts.length, `stars with no card behind them: ${ghosts.join(', ')}`);
    for (const s of stars) {
      for (const t of s.to) assert(starIds.has(t), `${s.id} is joined to "${t}", which is not a star`);
      assert(Tree.constellationOf(s.axis), `${s.id} stands in "${s.axis}", which is not a constellation`);
    }
    return `${stars.length} stars over ${Tree.CONSTELLATIONS.length} constellations, `
      + `one per card across ${Waves.BOONS.length} boons and ${Waves.ATTUNEMENTS.length} attunements`;
  });

  check('constellation: every star can be walked to from its own heart', () => {
    assert(Tree, 'no constellation module');
    const rows = [];
    for (const c of Tree.CONSTELLATIONS) {
      const mine = Tree.starsOf(c.axis).map((s) => s.id);
      assert(mine.includes(c.root), `${c.axis}'s root "${c.root}" does not stand in it`);
      assert(Tree.isRoot(c.root), `${c.root} is not marked a root`);
      // Breadth-first over the lines, exactly as the reachability rule walks
      // them. An unreachable star is one that can only ever be DRAFTED — the
      // tree would show it, price it, and refuse it forever.
      const seen = new Set([c.root]);
      const q = [c.root];
      while (q.length) {
        for (const n of Tree.neighboursOf(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
      const orphans = mine.filter((i) => !seen.has(i));
      assert(!orphans.length,
        `${orphans.join(', ')} cannot be reached from ${c.root} by any path — nothing but a draft can ever light them`);
      // and the heart must be something that never runs out, or a constellation
      // can be closed off by exhausting its only entrance
      const b = Waves.boonById(c.root);
      assert(Waves.maxRank(b) >= 3,
        `${c.root} is the heart of ${c.axis} and caps at ${Waves.maxRank(b)} rank(s)`);
      rows.push(`${c.axis}:${mine.length}`);
    }
    return rows.join(' ');
  });

  check('constellation: the map is readable — nothing overlaps and nothing falls off the sky', () => {
    assert(Tree, 'no constellation module');
    /**
     * A STAR MAP IS A DRAWING, and a drawing has a correctness condition: two
     * stars on top of each other are one star you cannot click, and a star
     * outside the viewBox is a node that exists, is priced, and cannot be
     * reached by a mouse. The first hand-placed version of this table had four
     * cross-constellation pairs within 40 px and put `darkside` sixty pixels
     * below the bottom edge — invisible, buyable by nothing, and impossible to
     * see in review because the table looked perfectly reasonable as source.
     *
     * So the sky is DIVIDED first and the shapes are fitted into it, and this
     * is the assertion that keeps that true as stars are added.
     */
    const pts = Tree.STARS.map((s) => ({ id: s.id, axis: s.axis, ...Tree.positionOf(s) }));
    const M = 30;                                  // the halo radius, plus room
    const off = pts.filter((p) => p.x < M || p.x > Tree.SKY.w - M || p.y < 40 || p.y > Tree.SKY.h - 34);
    assert(!off.length,
      `stars outside the sky: ${off.map((p) => `${p.id} (${p.x | 0},${p.y | 0})`).join(', ')}`);
    let worst = Infinity, pair = '';
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < worst) { worst = d; pair = `${pts[i].id}/${pts[j].id}`; }
      }
    }
    // 44 px is two 15 px discs with 14 px between them; below that the labels
    // collide and the map stops being a map.
    assert(worst >= 44, `${pair} are ${worst.toFixed(0)} px apart — they overlap on screen`);
    // …and no constellation may wander into another's zone, which is the
    // property that makes adding a star to one of them safe.
    for (const p of pts) {
      const z = Tree.zoneOf(p.axis);
      assert(z && Math.abs(p.x - z.x) <= z.halfW + 1 && Math.abs(p.y - z.y) <= z.halfH + 1,
        `${p.id} is drawn outside ${p.axis}'s own zone`);
    }
    return `${pts.length} stars inside ${Tree.SKY.w}×${Tree.SKY.h}, closest pair ${worst.toFixed(0)} px (${pair})`;
  });

  check('constellation: the page and the sky agree on how big the sky is', async () => {
    assert(Tree, 'no constellation module');
    // Two places, one truth. `SKY` is what positionOf lays out into and the
    // viewBox is what the browser scales — and they are in different files, so
    // a sky that grew in one of them would draw every star in the wrong place
    // (or off the edge) with nothing anywhere reporting an error.
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const m = /id="med-sky"[^>]*viewBox="0 0 (\d+) (\d+)"/.exec(html);
    assert(m, 'the star map has no viewBox in index.html');
    assert(+m[1] === Tree.SKY.w && +m[2] === Tree.SKY.h,
      `the page draws a ${m[1]}×${m[2]} sky and Constellation.js lays out a ${Tree.SKY.w}×${Tree.SKY.h} one`);
    return `viewBox and SKY agree at ${Tree.SKY.w}×${Tree.SKY.h}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. The names move with the alignment                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: the same star reads as a Jedi name and a Sith name', () => {
    assert(Tree, 'no constellation module');
    // The alignment is Order.js's, not a second one invented here. If those
    // three ids ever stop being the orders, this fails rather than quietly
    // naming everything after a tradition that no longer exists.
    for (const id of ['jedi', 'sith', 'grey']) {
      assert(ORDER_IDS.includes(id), `Order.js no longer has "${id}", which this file names stars for`);
    }
    const same = [], blank = [];
    for (const s of Tree.STARS) {
      if (!s.jedi || !s.sith) { blank.push(s.id); continue; }
      if (s.jedi === s.sith) same.push(s.id);
      const j = Tree.nameOf(s.id, 'jedi'), k = Tree.nameOf(s.id, 'sith');
      assert(j === s.jedi && k === s.sith, `${s.id} does not read its own aligned name back`);
    }
    assert(!blank.length, `stars with no aligned name: ${blank.join(', ')}`);
    assert(!same.length,
      `stars whose Jedi and Sith names are identical: ${same.join(', ')} — the alignment is decoration there`);
    // A Grey took no temple's vocabulary: they read the canonical name, and so
    // does a player who has chosen no order at all. Defaulting them to the Jedi
    // column would quietly resolve "neither code" into one.
    for (const s of Tree.STARS) {
      const canon = Waves.boonById(s.id).name;
      assert(Tree.nameOf(s.id, 'grey') === canon, `a Grey reads ${s.id} as something other than "${canon}"`);
      assert(Tree.nameOf(s.id, null) === canon, `with no order at all, ${s.id} is not the canonical name`);
    }
    // and inside one constellation two stars may not share a name in any
    // alignment, or the map is unreadable in exactly one of the three
    for (const c of Tree.CONSTELLATIONS) {
      for (const order of ['jedi', 'sith', 'grey']) {
        const names = Tree.starsOf(c.axis).map((s) => Tree.nameOf(s.id, order));
        assert(new Set(names).size === names.length,
          `two stars in ${c.axis} read the same to a ${order}: ${names.join(', ')}`);
      }
    }
    const sample = Tree.STARS.find((s) => s.id === 'lifesteal');
    return `${Tree.STARS.length} stars, all three vocabularies distinct — e.g. `
      + `"${sample.jedi}" / "${sample.sith}" / "${Waves.boonById('lifesteal').name}"`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. The rule that makes it a tree                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: a star cannot be lit out of nowhere', () => {
    assert(Tree, 'no constellation module');
    const led = new Tree.Communion({ insight: 9999 });
    const empty = new Waves.RankSet();
    // With nothing held, only the six hearts are open. Anything else buyable
    // from an empty hand means the lines are decoration.
    const openNow = Tree.STARS.filter((s) => led.canBuy(s.id, empty, 40)).map((s) => s.id);
    const roots = Tree.CONSTELLATIONS.map((c) => c.root);
    assert(openNow.length === roots.length && roots.every((r) => openNow.includes(r)),
      `from an empty hand the sky offers ${openNow.join(', ')} — it must offer exactly the six hearts`);

    // A DRAFTED card is a bridgehead: it lights its own star, and its
    // neighbours become reachable without any purchase at all. This is the
    // whole interplay between the two halves of the reward system.
    const held = new Waves.RankSet(['djemso']);
    const near = Tree.neighboursOf('djemso');
    assert(near.length, 'djemso is joined to nothing');
    for (const n of near) {
      assert(led.reachable(n, held), `holding Djem So does not open ${n}, which it is joined to`);
    }
    assert(!led.reachable('tempest', held), 'a card on the other side of the sky is reachable from Djem So');

    // The gates the draft has, the tree must have too, or the tree is the way
    // around them: a mastery you can simply buy is not a mastery, and a wave-2
    // Force Lightning is what `minWave` exists to prevent.
    const dark = new Waves.RankSet(['attune-dark', 'lifesteal']);
    assert(led.reasonLocked('darkside', dark, 40) === Tree.LOCKED.gated,
      'the dark mastery can be bought without committing to the dark');
    const committed = new Waves.RankSet(['attune-dark', 'lifesteal', 'lifesteal', 'fury', 'fury']);
    assert(led.canBuy('darkside', committed, 40), 'a committed dark build still cannot reach its mastery');
    assert(led.reasonLocked('lightning', new Waves.RankSet(['attune-dark']), 2) === Tree.LOCKED.depth,
      'Force Lightning can be bought at wave 2 — the tree walks around minWave');
    // …and a star with nothing left to give says so rather than taking money
    const full = new Waves.RankSet(['attune-guard']);
    for (let i = 0; i < Waves.maxRank(Waves.boonById('thorns')); i++) full.take('thorns');
    assert(led.reasonLocked('thorns', full, 40) === Tree.LOCKED.spent,
      'a maxed star is still for sale');
    return `six hearts open from nothing; a drafted card opens ${near.length} joined stars; `
      + 'masteries, minWave and rank caps all hold inside the tree';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. The economy cannot outrun the draft                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: the tree never outgrows the draft it sits beside', () => {
    assert(Tree, 'no constellation module');
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
     * The costs are an arithmetic series, so stars-per-run grows like √w while
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
      // Cheapest possible spending: every star a common, which is the most
      // stars this economy can produce at that depth.
      for (;;) {
        const cost = Tree.COST.common + Tree.COST_STEP * bought;
        if (purse < cost) break;
        purse -= cost; bought++;
      }
      const drafted = Math.floor(w / Waves.DRAFT_EVERY);
      const share = drafted ? bought / (bought + drafted) : 0;
      if (share > worst) { worst = share; worstAt = w; }
      assert(bought <= drafted || w < 4,
        `at wave ${w} the tree can buy ${bought} stars against ${drafted} drafted cards — `
        + 'the side channel has become the main one');
      if (w % 20 === 0) rows.push(`w${w}: ${bought} bought / ${drafted} drafted`);
    }
    assert(worst <= 0.45,
      `at wave ${worstAt} the tree is ${(worst * 100).toFixed(0)}% of everything the run earned`);
    // Prices must CLIMB, or the escalator is not one and a late run buys the
    // whole sky.
    const led = new Tree.Communion({ insight: 999 });
    const taken = new Waves.RankSet(['attune-blade']);
    const first = led.costOf('cadence', taken);
    led.buy('cadence', taken, 40); taken.take('cadence');
    const second = led.costOf('djemso', taken);
    assert(second > first, `the second star cost ${second} against the first at ${first}`);
    // and a repeat is never the cheap play
    const again = led.costOf('cadence', taken);
    assert(again > second, `a second rank of the same star costs ${again}, less than a fresh one at ${second}`);
    return `${rows.join(', ')}; worst share of a run's growth ${(worst * 100).toFixed(0)}% at w${worstAt}; `
      + `prices ${first} → ${second} → ${again}`;
  });

  check('constellation: Insight is a run currency and never a save file', async () => {
    assert(Tree, 'no constellation module');
    /**
     * Progress.js exists to say what a record is NOT: "no unlocks, no currency,
     * no cross-run power — the hundredth run starts exactly where the first
     * did". A skill tree is the single most common way that promise gets
     * broken, so the promise is checked rather than restated.
     */
    const fresh = new Tree.Communion();
    assert(fresh.insight === 0 && fresh.bought.length === 0,
      `a new run starts with ${fresh.insight} Insight and ${fresh.bought.length} stars already lit`);
    const progress = await read('game/Progress.js');
    assert(/no currency/.test(progress), 'the doctrine note in Progress.js is gone');
    // Nothing may read the record back INTO a run. The record is written in
    // Progress.js and drawn by the meditation; a third reader would be the
    // moment this became meta-progression.
    for (const file of ['game/World.js', 'game/Waves.js', 'game/Constellation.js']) {
      const text = await read(file);
      assert(!/loadProgress\s*\(/.test(text),
        `${file} reads the saved record — a run must not start from a save file`);
    }
    const main = await read('main.js');
    const uses = [...main.matchAll(/loadProgress\(\)/g)].length;
    assert(uses <= 1, `main.js reads the record ${uses} times; only the star chart may`);
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

  check('constellation: Reflection sends a share of the blow back to whoever struck it', () => {
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

  check('constellation: the Aegis eats the blow and knits itself back together', () => {
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

  check('constellation: Momentum is paid by killing and taken back by standing still', () => {
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

  check('constellation: the Mercy Stroke finishes the broken and spares the whole', () => {
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

  check('constellation: a Detonation reaches the crowd once, not the whole crowd forever', () => {
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

  check('constellation: a communion lands on the ally, and half of it on you alone', () => {
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

  check('constellation: Suffusion mends the person beside you, not you', () => {
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

  check('constellation: the Vow puts the ward on both of you', () => {
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

  check('constellation: a communion crosses the wire and lands on the receiver', async () => {
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
  /*  6. The general rule: no star is a parameter nobody reads          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: every new star installs a seam and every parameter has a reader', async () => {
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
    for (const [id, field] of NEW_STARS) {
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
    assert(!inert.length, `stars that install nothing at all: ${inert.join(', ')}`);
    assert(!unread.length,
      `parameters nothing outside the card reads: ${unread.join(', ')} — the star promises what the code never does`);
    return `${NEW_STARS.length} new stars, each installing a real seam, each parameter read elsewhere`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  7. The meditation                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('meditation: the star map goes up through Screens and can always be left', () => {
    /**
     * The overlay rules are Screens.js's, and this drives the real thing: the
     * meditation is raised by `take`, so it must be REMEMBERED, it must stop
     * the world, Escape over it must land on a card that can resume, and
     * resuming must put the star map back rather than silently skipping it.
     *
     * The card is registered rather than built into Screens, and the registry
     * is the part that fails on the old code: without it, `clear()` and
     * `_hide()` know nothing about this overlay and a star map raised over a
     * run survives being quit to the main menu.
     */
    assert(LIVE.includes('meditation'),
      "'meditation' is not a live state — Escape would do nothing at all inside the star map");
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
    s.card('meditation', () => up.delete('sky'));
    s.state = 'playing';
    s.take('meditation', () => up.add('sky'));
    assert(up.has('sky'), 'the star map never went up');
    assert(s.overlay && s.overlay.state === 'meditation', 'the meditation was not remembered');
    assert(world.paused, 'the world is still running under the star map');
    assert(!input.enabled, 'the blade is still taking input under the star map');

    const did = s.escape();
    assert(did !== 'nothing', 'Escape inside the star map does nothing at all');
    assert(!up.has('sky') && up.has('pause'),
      `Escape left ${[...up].join('+')} on screen — the registered card was not hidden`);
    s.resume();
    assert(s.state === 'meditation' && up.has('sky'), 'resuming did not put the star map back');

    // A throw inside a purchase must land on the pause card, never on a void.
    s.guarded('lighting a star', () => { up.delete('sky'); throw new Error('applyBoon is not a function'); })();
    assert(errors.length === 1, 'the throw was swallowed');
    assert(up.has('pause') && s.state === 'paused',
      `a failed purchase left state '${s.state}' with ${[...up].join('+')} on screen`);
    // …and quitting to the menu must take it down with everything else.
    s.take('meditation', () => up.add('sky'));
    s.set('menu');
    assert(!up.has('sky'), 'quitting to the menu left the star map on the screen forever');
    return 'take → remembered, world stopped; Escape → pause; resume → star map; a throw → pause; clear → gone';
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
      'nothing decides whether a communion is possible — the star map has no in-world door');
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
    assert(/keyLabel\(\(input\.bindings\.crouch/.test(main),
      'the prompt types a key name instead of reading the live binding');
    assert(/screens\.take\('meditation'/.test(main), 'the meditation is raised without Screens — it will not be remembered');
    assert(/screens\.card\('meditation'/.test(main), 'the meditation card is never registered with Screens');
    // Both doors: mid-run by kneeling, and from the Temple between runs.
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    for (const id of ['meditation', 'med-sky', 'commune', 'btn-commune', 'btn-med-buy']) {
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
    const world = await read('game/World.js');
    assert(/settings\.mode === 'training'/.test(world),
      'World.loadLevel does not honour the training mode, so picking it drops you into a normal wave');

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
  /*  The sky, operated                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('constellation: a star that says it is a button behaves like one', async () => {
    /**
     * SkillTree draws every star with `tabindex="0"` and `role="button"`, and
     * styles.css carries a `#med-sky .star:focus` rule for it — so a star takes
     * focus and announces itself to a screen reader as a button. It registered
     * `click` and `dblclick` and nothing else, so Enter and Space did nothing
     * at all: the ONE place in the whole front end that had bothered to claim a
     * keyboard affordance was the one place that had not built it.
     *
     * Driven through the real SkillTree on the real meditation markup, because
     * the claim is about the elements it emits. Synchronous once the document
     * is installed — the runner starts the next check the moment this one
     * suspends, and a globally installed document would follow it there.
     */
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const { SkillTree } = await import('../../src/ui/SkillTree.js');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const bought = [];
      const tree = new SkillTree(doc, { onBuy: (id) => bought.push(id) });
      const taken = new Waves.RankSet([]);
      tree.show({ taken, ledger: new Tree.Communion({ insight: 999 }), wave: 9, order: 'jedi', live: true });
      const stars = doc.querySelectorAll('#med-sky .star');
      assert(stars.length > 10, `${stars.length} stars drew`);
      const deaf = stars.filter(g => g.listenerCount('keydown') === 0);
      assert(!deaf.length,
        `${deaf.length}/${stars.length} stars carry tabindex="0" role="button" and no key listener at all`);
      const focusable = stars.filter(g => g.getAttribute('tabindex') === '0');
      assert(focusable.length === stars.length, 'a star lost its place in the tab order');
      // Enter selects, exactly as a click does…
      const root = stars.find(g => g.classList.contains('root')) || stars[0];
      root.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(tree.selected, 'Enter on a star selected nothing');
      // …and Enter on the star already selected is the keyboard's double-click.
      const before = bought.length;
      root.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(bought.length === before + 1,
        'Enter on the selected star did not buy it — the keyboard can look and never spend');
      assert(bought[0] === tree.selected, `it bought ${bought[0]} with ${tree.selected} selected`);
      return `${stars.length} stars, all focusable and listening; Enter selects then buys (${bought[0]})`;
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
      `'all' arrived holding only ${all.held} boons — the sky is ${Tree.STARS.length} facets wide`);

    return `earned ${earned.insight}i/${earned.held} · open ${open.insight}i/${open.held} · `
      + `all ${all.held} of ${Tree.STARS.length} facets, lightning+compel lit`;
  });
}
