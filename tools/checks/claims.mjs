/**
 * BATTLEFRONT BORZ — every sentence this game says about itself, against what it does.
 *
 * The owner's complaint, six times over in different words: "pointed out
 * repeatedly and missed every time", "changes nothing", "never observed; verify
 * it works at all", "does nothing when pressed". That is one defect, and it is
 * not shallowness — it is a game that CLAIMS THINGS IT DOES NOT DO. A hand-
 * maintained sentence beside a generated mechanism, agreeing on the day it was
 * written and never again.
 *
 * This file drives the claim tables against the code. Not "does the number in
 * the text match a constant somewhere" — that is another transcription. Every
 * check here either drives a real Player through the shipped `apply`, or reads
 * the shipped source and asks whether the field a card moves has anybody at the
 * other end of it.
 *
 * WHAT IT CAUGHT, all of it measured before it was fixed:
 *
 *   attune-force  "The Force asks less and RETURNS SOONER". `Player._regen`
 *                 regenerates at a flat 7.5/s and does not read `forceRegen` at
 *                 all; the only thing that spends that field is `wellspringFlow`,
 *                 installed by the Wellspring CARD. Four takes of a permanent,
 *                 uncapped, forever-offered attunement moved the Force
 *                 regenerated over 4 s by exactly 0.00%.
 *   attune-dark   "and the taking sharpens you". `ferocity` is read by exactly
 *                 one function, `juyoEdge`, installed by the Juyo card. Alone:
 *                 cutPower 1.00 → 1.00 after five limbs taken. With Juyo: 1.48.
 *   ataru         "you may leap a second time in the air" — which every player
 *                 can already do. `airJumps = doubleJump ? 2 : 1`; the card
 *                 grants a THIRD leap, and the note beside the code says so.
 *   meditation    "Flow bleeds away more slowly". Flow bleeds at a flat
 *                 `dt * 0.085` that nothing scales. Driven at three ranks: flow
 *                 after 5 s was 0.5750, 0.5750, 0.5750.
 *   cadence       "the blade comes back around a third sooner" — 1.33 on a rate
 *                 that is DIVIDED into the cooldown is 24.8% sooner, not 33%.
 *   soresu        "deflection is forgiven further along the blade" — the field
 *                 it moves is the aim cone for finding a return target. The
 *                 blade-position gate is a different number that nothing moves,
 *                 and the two were both spelled `0.42` in the same function.
 *   the telegraph "the blade traces a ghost of where it is about to go" — drawn
 *                 at a fixed radius that ignored the attack's own reach, 0.054
 *                 to 0.624 m INSIDE the sweep it claims to contain, on all ten
 *                 attacks. See Duel._drawTelegraph.
 *
 * And what it confirmed TRUE, which is worth as much: Vaapad's half again,
 * Makashi's twice as long, Celerity's fifth, Vitality's thirty, the Dark Side's
 * third, Unity's twice as far, Cleaving Throw's twice as fast, and every rank
 * of every stacking card.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Player } from '../../src/game/Player.js';
import { Enemy, enemyRng, ARCHETYPES } from '../../src/game/Enemy.js';
import { BOONS, ATTUNEMENTS, MODES, rankScale, maxRank, WaveDirector, seedWaves,
  sandboxUnits, DUEL_RUNG, DUEL_MAX } from '../../src/game/Waves.js';
import { LESSONS } from '../../src/game/Dojo.js';
import { DIFFICULTY, OPEN_STATES, openState, openMul, openness,
  BladeContactSolver, TOUGHNESS, SPEED_GRADE } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';
import { ORDERS, applyOrder } from '../../src/game/Order.js';
import { duelRng, ATTACKS, ATTACK_KEYS, Telegraph, FORMS, TIER } from '../../src/game/Duel.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const scene = new THREE.Scene();
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

function gameWorld(diff = 'knight') {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  return {
    scene, physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY[diff], players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: null, time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}
const stubInput = () => ({
  keys: new Set(), buttons: [false, false, false], mouse: { dx: 0, dy: 0, wheel: 0 },
  accel: { x: 0, y: 0 }, bindings: null,
  moveAxis: (o) => { o.x = 0; o.y = 0; return o; }, act: () => false, actHit: () => false,
});

/** A real Player in a real world, with `ids` drafted onto it and nothing else. */
function drafted(ids, scale = 1) {
  const w = gameWorld();
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  w.players.push(p);
  const all = [...BOONS, ...ATTUNEMENTS];
  for (const id of ids) all.find((b) => b.id === id).apply(p, scale);
  const ctx = { input: stubInput(), terrain: w.terrain, physics: w.physics, particles: null,
    bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: [], players: w.players, pickTarget: () => null };
  return { w, p, ctx };
}
function tick({ w, p, ctx }, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) { ctx.time = w.time = i * dt; p.update(dt, ctx); }
}

/** Everything numeric or boolean a card could plausibly have moved. */
function snap(p) {
  const o = {};
  for (const k of Object.keys(p.boonMods)) {
    const v = p.boonMods[k];
    if (typeof v === 'number' || typeof v === 'boolean') o[`boonMods.${k}`] = v;
  }
  for (const k of Object.keys(p)) {
    if (k === 'boonMods') continue;
    const v = p[k];
    if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
  }
  o['saber.bladeLength'] = p.saber.bladeLength;
  o['saber.coreWidth'] = p.saber.coreWidth;
  o['control.sensitivity'] = p.control.sensitivity;
  o['control.deadzone'] = p.control.deadzone;
  for (const h of ['_boonTicks', '_boonGuards', '_boonAfterHit']) {
    if (p[h] instanceof Map) o[h] = p[h].size;
  }
  return o;
}
const changedKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

/**
 * A real WaveDirector fighting for `n` blades.
 *
 * `partyScale` reads `world.level.party` (how much a level lets the party count
 * move its pressure) and `partySize` counts living players, so both halves have
 * to be real for the co-op numbers to be real.
 */
function partyDirector(n) {
  const w = gameWorld();
  w.level = { party: 1 };
  w.players = new Array(n).fill(0).map(() => ({ alive: true }));
  seedWaves(99, 0);
  return new WaveDirector(w, { mode: 'roguelite',
    pool: ['b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker', 'beast'] });
}

/* ── the source side: who reads what ─────────────────────────────────── */

/**
 * Comments out, before anything is scanned for a reader.
 *
 * THIS MATTERS MORE THAN IT LOOKS. The fix for the two dead attunements is a
 * one-line `boonTick(...)` under a twenty-line note that names the handler it
 * installs — so a scan that reads comments finds `wellspringFlow` in the card's
 * source whether or not the card still calls it, and the check stays green
 * through a revert of the very thing it exists to hold. Measured, by doing
 * exactly that: deleting both `boonTick` lines left this suite 9/1 instead of
 * 8/2, and the one that survived was this check. The same trap applies to
 * `boonMods.KEY` written inside a comment in Player or World, which would
 * invent a core reader that does not exist.
 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** Every .js file under src/, so "does anything read this" is a whole-tree question. */
function srcFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) srcFiles(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * `boonMods.KEY` → who mentions it, split into the card layer and everything
 * else. Waves.js is the card layer: a field that only Waves.js touches is only
 * alive if the handler that reads it has actually been installed on the player.
 * A field mentioned in Player, World, Combat or Order is read by the game
 * itself and is alive the moment it is written.
 */
function readerIndex() {
  const core = new Map();          // key -> Set(file)
  const wavesFns = new Map();      // function name -> Set(key it reads)
  for (const f of srcFiles()) {
    if (f.endsWith('Waves.js')) continue;
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const m of text.matchAll(/boonMods\??\.(\w+)/g)) {
      if (!core.has(m[1])) core.set(m[1], new Set());
      core.get(m[1]).add(f.slice(SRC.length));
    }
  }
  // Waves.js, function by function. Top-level declarations only — every hook in
  // the file is one — and the body runs to the next `}` in column 0.
  const waves = stripComments(readFileSync(join(SRC, 'game/Waves.js'), 'utf8'));
  const decl = /^(?:export )?function (\w+)\s*\([^)]*\)\s*\{/gm;
  for (let m = decl.exec(waves); m; m = decl.exec(waves)) {
    const start = m.index + m[0].length;
    const end = waves.indexOf('\n}', start);
    const body = waves.slice(start, end < 0 ? waves.length : end);
    const keys = new Set();
    for (const r of body.matchAll(/boonMods\??\.(\w+)/g)) keys.add(r[1]);
    if (keys.size) wavesFns.set(m[1], keys);
  }
  return { core, wavesFns };
}

/** Handler function names actually installed on this player and its world. */
function installed(p, w) {
  const names = new Set();
  for (const m of [p._boonTicks, p._boonGuards, p._boonAfterHit]) {
    if (m instanceof Map) for (const fn of m.values()) if (fn?.name) names.add(fn.name);
  }
  for (const list of [w._boonSever, w._boonKill]) {
    if (Array.isArray(list)) for (const h of list) if (h.fn?.name) names.add(h.fn.name);
  }
  return names;
}

export async function run({ check, assert }) {
  await initPhysics();

  check('claims: every card the draft can hand you moves a real Player', () => {
    /**
     * The floor under everything else. A card that changes nothing is the
     * purest form of the defect this file is about, and the draft gives no
     * "you gained nothing" feedback anywhere — the card goes on the strip and
     * the run continues.
     *
     * ON A REAL PLAYER, in a real world, through the real `apply`. The existing
     * balance check asks the same question of a hand-built stub with no update
     * loop, no saber and no world, which is why it cannot see the difference
     * between a field moving and a field being read.
     */
    const all = [...BOONS, ...ATTUNEMENTS];
    const inert = [];
    for (const b of all) {
      const f = drafted([]);
      const before = snap(f.p);
      b.apply(f.p, 1);
      if (!changedKeys(before, snap(f.p)).length) inert.push(b.id);
    }
    assert(!inert.length, `these cards changed nothing at all: ${inert.join(', ')}`);
    return `${all.length} cards (${BOONS.length} boons + ${ATTUNEMENTS.length} attunements), all of them move a live Player`;
  });

  check('claims: no card raises a number that nothing is listening to', () => {
    /**
     * THE CHECK THAT FOUND THE TWO ATTUNEMENTS. A field moving is not a field
     * being read, and the difference is invisible from inside the card: both
     * halves of `attune-force` are one line each and only one of them existed.
     *
     * The rule is derived, not listed. For every key a card writes:
     *   • if anything outside Waves.js mentions `boonMods.KEY`, the game itself
     *     reads it and it is alive the moment it is written;
     *   • otherwise the only readers are handlers in Waves.js, and one of them
     *     has to be LIVE on this player — either registered in a hook map by
     *     the card's own `apply`, or named directly in that apply's source, the
     *     way Cleaving Throw calls `cleavingThrow(p)` to wrap `_updateThrow`.
     *
     * Both the reader index and the installed set are read off the shipped
     * source and the shipped player, so a handler renamed or a card that stops
     * installing one fails here rather than going quiet in a run.
     */
    const { core, wavesFns } = readerIndex();
    assert(wavesFns.size > 6, `only found ${wavesFns.size} handler functions in Waves.js — the scan is broken`);
    const all = [...BOONS, ...ATTUNEMENTS];
    const dead = [];
    const rows = [];
    for (const b of all) {
      const f = drafted([]);
      const before = snap(f.p);
      b.apply(f.p, 1);
      const moved = changedKeys(before, snap(f.p))
        .filter((k) => k.startsWith('boonMods.'))
        .map((k) => k.slice('boonMods.'.length));
      if (!moved.length) continue;
      const live = installed(f.p, f.w);
      const src = stripComments(String(b.apply));
      for (const key of moved) {
        if (core.has(key)) { rows.push(`${key}←${[...core.get(key)][0]}`); continue; }
        const readers = [...wavesFns].filter(([, keys]) => keys.has(key)).map(([n]) => n);
        const ok = readers.some((n) => live.has(n) || src.includes(n));
        if (!ok) {
          dead.push(`${b.id} writes boonMods.${key}, whose only readers are `
            + `${readers.length ? readers.join('/') : '(nothing at all)'}, and it installs none of them`);
        }
      }
    }
    assert(!dead.length, dead.join('; '));
    return `${all.length} cards; every boonMod they write has a reader that is live on the player who took it`;
  });

  check('claims: a rank of a stacking card is worth something on a real Player', () => {
    /**
     * `stack: n` says the draft will offer this card up to n times. A second
     * rank that lands on a `set`-shaped effect is a card that the run spends a
     * draft on and gets nothing for, and there are ten waves between drafts at
     * the depth where ranks start appearing.
     *
     * Rank 2's scale is `rankScale(2)` — the shipped ladder, not a number typed
     * here — and the assertion is only that SOMETHING moves. How much is
     * `balance.mjs`'s question; whether anything at all is this one's.
     */
    const all = [...BOONS, ...ATTUNEMENTS];
    const flat = [];
    let n = 0;
    for (const b of all) {
      if (maxRank(b) < 2) continue;
      n++;
      const f = drafted([]);
      b.apply(f.p, rankScale(1));
      const afterFirst = snap(f.p);
      b.apply(f.p, rankScale(2));
      if (!changedKeys(afterFirst, snap(f.p)).length) flat.push(b.id);
    }
    assert(!flat.length, `these cards' second rank changed nothing: ${flat.join(', ')}`);
    return `${n} stacking cards, every second rank moves the player again`;
  });

  check('claims: the two attunements whose second halves did nothing now do', () => {
    /**
     * The check above is the general rule; this is the measurement, kept
     * because the general rule would also pass if somebody deleted the claim
     * instead of implementing it. Both are driven end to end through the real
     * update loop and the real `limbsRemoved` counter the card reads.
     */
    // "…and returns sooner" — Force regenerated over 4 s from empty
    const regen = (ids) => {
      const f = drafted(ids);
      f.p.force = 0;
      tick(f, 4 * 60);
      return f.p.force;
    };
    const base = regen([]);
    const one = regen(['attune-force']);
    const four = regen(['attune-force', 'attune-force', 'attune-force', 'attune-force']);
    assert(one > base * 1.05, `one Attunement of the Force regenerated ${one.toFixed(1)} against a base ${base.toFixed(1)}`);
    assert(four > one * 1.2, `four of them regenerated ${four.toFixed(1)} against one's ${one.toFixed(1)} — it stops paying`);

    // "…and the taking sharpens you" — cutPower after limbs taken
    const sharpen = (ids) => {
      const f = drafted(ids);
      tick(f, 20);
      const cold = f.p.boonMods.cutPower;
      f.p.limbsRemoved = (f.p.limbsRemoved || 0) + 5;
      tick(f, 20);
      return f.p.boonMods.cutPower / cold;
    };
    const dark = sharpen(['attune-dark']);
    assert(dark > 1.02, `Attunement of the Dark alone sharpened the blade by ${((dark - 1) * 100).toFixed(1)}%`);
    return `force ${base.toFixed(0)} → ${one.toFixed(0)} → ${four.toFixed(0)} over 4 s; the dark alone sharpens ×${dark.toFixed(2)} on five limbs`;
  });

  check('claims: the numbers a card states out loud are the numbers it produces', () => {
    /**
     * The literal half of the sweep. Every card whose text names a definite
     * quantity is driven and the quantity read back off the player, and the
     * PAIRING here is the claim itself — both sides are live, so moving either
     * the sentence or the code fails this.
     *
     * Deliberately only the cards that state a number. "Ferocity compounds" and
     * "a crowd is cover" are not measurable sentences and the checks above are
     * what hold those honest.
     */
    /**
     * THE EXPECTED VALUE IS PARSED OUT OF THE CARD'S OWN `text`. It has to be.
     * The first draft of this check listed the card, a copy of its sentence and
     * the number that sentence means — which is a hand-maintained answer key
     * beside a generated mechanism, ie. the exact defect the file is hunting,
     * wearing a check's clothes. Reverting the Cadence wording would have left
     * it green.
     *
     * So this is a VOCABULARY — ordinary English quantity phrases and what they
     * mean as a factor — applied to whatever the shipped card says today. Edit
     * a card's wording and either no phrase matches (this fails, loudly, saying
     * the card no longer states a quantity) or a different phrase matches and
     * the code has to produce the new number.
     */
    const DEN = { half: 2, third: 3, quarter: 4, fifth: 5, sixth: 6, eighth: 8, tenth: 10 };
    const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
    const F = '(half|third|quarter|fifth|sixth|eighth|tenth)';
    const PHRASES = [
      // "twice as long", "twice as far"
      [/twice as (?:much|fast|long|hard|far)/i, () => 2],
      // "half again as fast", "three fifths again as fast" — 1 + n/d
      [new RegExp(`(a|one|two|three|four|five) ?${F}s? again as \\w+`, 'i'),
        (m) => 1 + (NUM[m[1].toLowerCase()] ?? 1) / DEN[m[2].toLowerCase()]],
      [new RegExp(`${F} again as \\w+`, 'i'), (m) => 1 + 1 / DEN[m[1].toLowerCase()]],
      // "a fifth faster", "a third deeper", "two fifths harder" — 1 + n/d
      [new RegExp(`(a|an|one|two|three|four|five) ${F}s? (?:faster|more|further|deeper|wider|longer|harder|hotter)`, 'i'),
        (m) => 1 + (NUM[m[1].toLowerCase()] ?? 1) / DEN[m[2].toLowerCase()]],
      // "a quarter sooner", "a fifth less to lose" — 1 − n/d
      [new RegExp(`(a|an|one|two|three|four|five) ${F}s? (?:sooner|less|shorter|cheaper)`, 'i'),
        (m) => 1 - (NUM[m[1].toLowerCase()] ?? 1) / DEN[m[2].toLowerCase()]],
      // "a third of your vitality, gone"
      [new RegExp(`an? ${F} of your \\w+, gone`, 'i'), (m) => 1 - 1 / DEN[m[1].toLowerCase()]],
      // "in half the time"
      [new RegExp(`in ${F} the time`, 'i'), (m) => 1 / DEN[m[1].toLowerCase()]],
      // "thirty more vitality" — additive, in the card's own units
      [/(ten|twenty|thirty|forty|fifty) more/i, (m) => NUM[m[1].toLowerCase()]],
      /* "costs little over half" is the one card that hedges on purpose, and
       * the hedge is the claim: somewhere just past half. It is checked against
       * that band rather than a point, because pinning it would be inventing a
       * precision the sentence does not offer. */
      [/costs little over half/i, () => 0.55, 0.12],
    ];
    /**
     * Each probe reads the player back IN THE UNITS THE SENTENCE USES, which is
     * the only part of this that is a judgement: "a quarter sooner" is a claim
     * about the RECOVERY, so Cadence's reader inverts `attackRate` rather than
     * reporting it. `hint` picks the clause when a card states two things.
     */
    const probes = [
      ['vaapad', (p) => p.boonMods.deflectDamage],
      ['makashi', (p) => p.boonMods.riposteWindow],
      ['celerity', (p) => p.boonMods.moveSpeed],
      ['vitality', (p) => p.maxHp - 100],
      ['darkside', (p) => p.maxHp / 100],
      ['unity', (p) => p._bondRange / 16],
      ['bastion', (p) => p.boonMods.deflectDamage],
      ['ataru', (p) => p.boonMods.forceCost],
      ['meditation', (p) => p.boonMods.staminaRegen],
      ['wellspring', (p) => p.boonMods.forceRegen],
      ['cadence', (p) => 1 / p.boonMods.attackRate],
    ];
    const all = [...BOONS, ...ATTUNEMENTS];
    const bad = [], rows = [];
    for (const [id, read] of probes) {
      const card = all.find((b) => b.id === id);
      assert(card, `there is no card called '${id}' any more`);
      const hits = PHRASES.map(([re, val, tol]) => {
        const m = re.exec(card.text);
        return m ? { want: val(m), tol: tol ?? 0.03, said: m[0] } : null;
      }).filter(Boolean);
      assert(hits.length === 1,
        `${id} states ${hits.length} recognisable quantities in "${card.text}" — `
        + 'this check cannot tell which one the code is supposed to produce');
      const { want, tol, said } = hits[0];
      assert(isFinite(want), `could not read a number out of "${said}" in ${id}`);
      const f = drafted([id]);
      const got = read(f.p);
      // 3% by default — "a fifth", "half again", "a quarter" are round numbers
      // and a card that means them cannot be a tenth off one.
      if (Math.abs(got - want) > Math.abs(want) * tol) {
        bad.push(`${id} says "${said}" — ${want} — and produces ${got.toFixed(3)}`);
      }
      rows.push(`${id} ${got.toFixed(2)}`);
    }
    assert(!bad.length, bad.join('; '));
    return `${probes.length} stated quantities parsed out of the cards' own text, all within 3%: ${rows.join(', ')}`;
  });

  check('claims: an order\'s blurb is the order you actually get', () => {
    /**
     * The three order blurbs are the longest claims in the game and the first
     * ones a new player reads — they are on the creator screen before anything
     * has been deployed. Same treatment as the cards: the quantity is parsed
     * out of the shipped blurb and the player is driven through the shipped
     * `applyOrder`.
     *
     * What it found:
     *   Sith  "a cut that bites HALF AGAIN as hard" against `cutPower: 1.40`.
     *         Two fifths, not half.
     *   Sith  "you start with A FIFTH less to lose" against `maxHp: -22`, which
     *         is 22% of the 100 a player starts with.
     *   Jedi  "You are the worst cutter of the three" — contradicted by
     *         Order.js's own header table four hundred lines above it, where a
     *         Grey at rest cuts at 0.80 against a Jedi's 0.85.
     *
     * The Grey is checked as an ORDERING rather than a number, because its two
     * axes are functions of the blade's temper and its blurb makes exactly that
     * claim: cleanest guard at rest, hardest cut and worst guard committed.
     */
    const DEN = { half: 2, third: 3, quarter: 4, fifth: 5 };
    const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
    const F = '(half|third|quarter|fifth)';
    /* Both shapes the table uses for "harder": "two fifths harder" and the
     * "half again as hard" form the Sith blurb used to carry. The second one is
     * here precisely so that reverting to it fails with the NUMBER rather than
     * with "I cannot parse this" — a check whose red is only ever "unreadable"
     * would pass the day somebody wrote a wrong number in a readable phrase. */
    const harder = new RegExp(
      `(?:(a|an|one|two|three|four|five) ${F}s? harder|(a|an|one|two|three|four|five)? ?${F}s? again as hard)`, 'i');
    const less = new RegExp(`(a|an|one|two|three|four|five) ${F}s? less`, 'i');
    /* The match may come from either alternative, so the count and the
     * denominator are whichever pair actually captured. */
    const val = (m) => {
      const n = m[1] ?? m[3], d = m[2] ?? m[4];
      return (NUM[String(n).toLowerCase()] ?? 1) / DEN[String(d).toLowerCase()];
    };

    const of = (id) => {
      const f = drafted([]);
      applyOrder(f.p, id);
      return f;
    };
    const sith = ORDERS.find((o) => o.id === 'sith');
    const sf = of('sith');
    const mh = harder.exec(sith.blurb), ml = less.exec(sith.blurb);
    assert(mh, `the Sith blurb no longer states how much harder it cuts: "${sith.blurb}"`);
    assert(ml, `the Sith blurb no longer states how much vitality it gives up`);
    const cutSaid = 1 + val(mh), hpSaid = 1 - val(ml);
    assert(Math.abs(sf.p.boonMods.cutPower - cutSaid) < cutSaid * 0.03,
      `the Sith blurb says "${mh[0]}" — ${cutSaid.toFixed(2)}× — and applyOrder gives `
      + `${sf.p.boonMods.cutPower.toFixed(2)}×`);
    assert(Math.abs(sf.p.maxHp / 100 - hpSaid) < hpSaid * 0.03,
      `the Sith blurb says "${ml[0]}" to lose — ${(hpSaid * 100).toFixed(0)} hp — and applyOrder `
      + `leaves ${sf.p.maxHp}`);

    // …and the comparative claims, driven against each other rather than read
    const jf = of('jedi'), gf = of('grey');
    const cut = { jedi: jf.p.boonMods.cutPower, sith: sf.p.boonMods.cutPower };
    // The Grey's two ends. `temper` is the live schedule the accessor reads.
    const greyAt = (t) => { gf.p.saber.temper = t; return gf.p.boonMods.cutPower; };
    const greyGuardAt = (t) => { gf.p.saber.temper = t; return gf.p.boonMods.returnCone; };
    const calmCut = greyAt(0), furyCut = greyAt(1);
    const calmGuard = greyGuardAt(0), furyGuard = greyGuardAt(1);
    assert(furyCut > cut.sith && furyCut > cut.jedi,
      `the Grey blurb promises "the hardest cut in the game" and a committed Grey cuts at `
      + `${furyCut.toFixed(2)} against the Sith's ${cut.sith.toFixed(2)}`);
    assert(calmGuard > jf.p.boonMods.returnCone && calmGuard > sf.p.boonMods.returnCone,
      `the Grey blurb promises "the cleanest, steadiest guard in the game" and a composed Grey's `
      + `cone is ${calmGuard.toFixed(3)} against the Jedi's ${jf.p.boonMods.returnCone.toFixed(3)}`);
    assert(furyGuard < jf.p.boonMods.returnCone && furyGuard < sf.p.boonMods.returnCone,
      `a committed Grey is supposed to have "the worst guard" and its cone is ${furyGuard.toFixed(3)}`);
    /* THE JEDI'S OWN CLAIM, READ FOR ITS QUALIFIER.
     *
     * This blurb used to say, flatly, "You are the worst cutter of the three" —
     * and Order.js's own header table says a composed Grey cuts at 0.80 against
     * a Jedi's 0.85, so the flat form was false. The wording now names the
     * temper it is true at, so the check has to read the wording: an unqualified
     * claim is tested against the Grey AT BOTH ENDS, a qualified one only
     * against a committed Grey. Otherwise this check would pass on the sentence
     * it exists to have caught, which is the trap the rest of this file is about.
     */
    const jedi = ORDERS.find((o) => o.id === 'jedi');
    const softest = /(worst|softest) cut(ter)? of the three/i.test(jedi.blurb);
    assert(softest, `the Jedi blurb no longer makes a claim about its cut: "${jedi.blurb}"`);
    const qualified = /when anyone commits|committed|at full/i.test(jedi.blurb);
    const rivals = qualified ? [cut.sith, furyCut] : [cut.sith, furyCut, calmCut];
    assert(rivals.every((c) => cut.jedi < c),
      `the Jedi blurb claims the softest cut of the three${qualified ? ' when anyone commits' : ''}, `
      + `and it is ${cut.jedi.toFixed(2)} against ${rivals.map((c) => c.toFixed(2)).join(' / ')}`);
    for (const f of [jf, sf, gf]) f.p.saber.dispose?.();
    return `sith ${cutSaid.toFixed(2)}× cut / ${(hpSaid * 100).toFixed(0)} hp as written; `
      + `grey ${calmCut.toFixed(2)}→${furyCut.toFixed(2)} cut, ${calmGuard.toFixed(2)}→${furyGuard.toFixed(2)} guard; `
      + `jedi ${cut.jedi.toFixed(2)} cut, last of the three when anyone commits`;
  });

  check('claims: Shatterpoint really does part armour in half the time', () => {
    /**
     * The one stated quantity in the table that cannot be read off a field,
     * because the thing it promises is a RATE and `cutPower` reaches it through
     * a non-linear path: `BladeContactSolver.solve` multiplies the blade's own
     * speed by it and then squares that speed again inside the `rush` term, so
     * "1.9× the power" is not "1.9× the work" and 1/1.9 is not the answer.
     *
     * So it is driven: one identical sweep of a real lit blade across a real
     * armour capsule, through the shipped solver, with and without the card.
     * The pass covers the same span at the same hilt speed either way — only
     * `opts.power` differs — so the ratio of accumulated work IS the ratio of
     * rates, and the time to part the plate is its reciprocal.
     */
    const cap = { name: 'plate', p0: V(0, 1.2, -0.25), p1: V(0, 1.2, 0.25),
      r: 0.13, toughness: TOUGHNESS.armour };
    const workOf = (power) => {
      const solver = new BladeContactSolver();
      const saber = new Saber(scene, { length: 1.3 });
      saber.lit = true; saber.ignition = 1;
      const q = new THREE.Quaternion();
      const tgt = { id: 't', capsules: [cap], dead: false };
      const dt = 1 / 60, span = 1.2, speed = 9;
      let work = 0;
      const steps = Math.ceil(span / (speed * dt));
      for (let i = 0; i <= steps; i++) {
        saber.setHiltPose(V(-span / 2 + i * speed * dt, 0.55, 0), q);
        saber.update(dt, i * dt);
        for (const e of solver.solve(saber, [tgt], dt, { power })) {
          if (e.type === 'grind') work += e.dWork;
          if (e.type === 'cut') return work;
        }
      }
      return work;
    };
    const card = BOONS.find((b) => b.id === 'shatterpoint');
    const f = drafted(['shatterpoint']);
    const plain = workOf(1), sharp = workOf(f.p.boonMods.cutPower);
    const timeRatio = plain / sharp;
    assert(plain > 0 && sharp > 0, `no work was done at all (${plain}, ${sharp})`);
    // "half the time" is a round claim, so a fifth either side of it. It must
    // not UNDER-deliver — a card that says half and gives a third is the defect.
    assert(timeRatio <= 0.6,
      `Shatterpoint says "${card.text}" and parts armour in ${(timeRatio * 100).toFixed(0)}% of the time`);
    assert(timeRatio >= 0.35,
      `Shatterpoint parts armour in ${(timeRatio * 100).toFixed(0)}% of the time — the card says half, `
      + 'and a card that quietly over-delivers is the same drift the other way');
    return `cutPower ${f.p.boonMods.cutPower.toFixed(2)}× → ${(1 / timeRatio).toFixed(2)}× the work rate, `
      + `armour parts in ${(timeRatio * 100).toFixed(0)}% of the time`;
  });

  check('claims: the ghost of a swing contains the swing', () => {
    /**
     * Duel.js's first paragraph — "the blade traces a ghost of where it is
     * about to go" — driven against the blade that follows it, one attack at a
     * time, on a real acolyte with the shipped Telegraph.
     *
     * The property is CONTAINMENT, not equality: a ghost slightly larger than
     * the sweep is honest and a ghost smaller than it teaches a distance that
     * gets you cut. Before the fix all ten attacks failed, by 0.054 m on the
     * shortest slash and 0.624 m on the lunge — which is most of a body.
     *
     * The target is invulnerable on purpose. `Enemy._saberStrike` ends the
     * strike phase on the frame it connects, so a killable dummy takes `thrust`
     * and `lunge` out of the sample entirely — they are the two attacks with
     * reach, which is to say the two the defect was worst on.
     */
    const rows = [], bad = [];
    for (const key of ATTACK_KEYS) {
      const w = gameWorld();
      const target = { position: V(0, 0, 0), chest: V(0, 1.3, 0), alive: true, radius: 0.34,
        invuln: 1e9, crouch: 0, hp: 1e6, damage() {}, camera: { addShake() {} }, velocity: V(0, 0, 0) };
      w.players.push(target);
      enemyRng.seed(11); duelRng.seed(22);
      const e = new Enemy(w, 'acolyte', V(0, 0, 2.0));
      w.enemies.push(e);
      e.duel._pick = () => key;                        // this attack, every time
      const tele = new Telegraph(scene);
      e.duel.telegraph = tele;
      const ctx = { input: null, terrain: w.terrain, physics: w.physics, particles: null,
        bolts: null, camera: w.engine.camera, time: 0, groundColor: 0,
        enemies: w.enemies, players: w.players, pickTarget: () => target };
      let ghost = 0, blade = 0;
      const raw = tele.shape.bind(tele);
      tele.shape = (origin, yaw, from, to, inner, outer) => {
        raw(origin, yaw, from, to, inner, outer);
        if (e.duel.phase === 'windup') ghost = Math.max(ghost, outer);
      };
      const dt = 1 / 60, chest = new THREE.Vector3();
      for (let i = 0; i < 60 * 40; i++) {
        ctx.time = w.time = i * dt;
        e.position.set(0, 0, 2.0); e.velocity.set(0, 0, 0);
        e.update(dt, ctx);
        if (e.duel.phase !== 'strike') continue;
        if (!(e.rig && e.rig.worldPos && e.rig.worldPos('chest', chest))) {
          chest.copy(e.position).setY(e.position.y + 1.34 * e.A.scale);
        }
        blade = Math.max(blade, e.saber.tip.distanceTo(chest));
      }
      tele.dispose();
      assert(ghost > 0 && blade > 0, `${key}: never drew a ghost or never swung (ghost ${ghost}, blade ${blade})`);
      if (ghost < blade) bad.push(`${key}: ghost ${ghost.toFixed(3)} m, blade reached ${blade.toFixed(3)} m`);
      rows.push(`${key} +${(ghost - blade).toFixed(3)}`);
    }
    assert(!bad.length, `the arc is drawn short of the blade — ${bad.join('; ')}`);
    return `${ATTACK_KEYS.length} attacks, ghost margins ${rows.join(', ')} m`;
  });

  check('claims: every state the blade is paid extra for has a name and a colour', () => {
    /**
     * THE OTHER DIRECTION. `openness` returns 3.0× for a gripped body, 2.0× for
     * one still being yanked and 1.5× for one that is down — the mechanic that
     * makes pull→cut read as one move — and for as long as it existed nothing
     * on screen said so. A mechanic nobody can see is the same defect as a
     * label with nothing behind it.
     *
     * The table is the source now and `openness` is derived from it, so this
     * asks the two to agree on every state, on an ordinary body and on a boss,
     * driven through both entry points.
     */
    const mk = (o) => ({ gripped: false, yankT: 0, toppled: false, stunTimer: 0, dead: false, A: {}, ...o });
    assert(OPEN_STATES.length >= 3, `only ${OPEN_STATES.length} open states declared`);
    const rows = [];
    for (const s of OPEN_STATES) {
      assert(s.key && s.label && /^#[0-9a-f]{6}$/i.test(s.colour),
        `open state ${s.key} has no name or no colour to draw it in`);
      assert(s.why && s.why.length > 12, `open state ${s.key} has no sentence saying why`);
      assert(s.mul > 1, `open state ${s.key} is worth ${s.mul}×, which is nothing`);
      // the state test and the multiplier must agree with `openness` itself
      const probe = mk(s.key === 'held' ? { gripped: true }
        : s.key === 'yanked' ? { yankT: 0.2 }
        : { stunTimer: 0.5 });
      const found = openState(probe);
      assert(found === s, `a body in the ${s.key} state resolved to ${found?.key ?? 'nothing'}`);
      assert(openness(probe) === s.mul,
        `${s.key}: the table says ${s.mul}× and openness() pays ${openness(probe)}×`);
      // …and a boss takes its share, so a readout cannot print the table value
      const boss = mk({ ...probe, A: { boss: true } });
      const want = s.bigShare < 1 ? 1 + (s.mul - 1) * s.bigShare : s.mul;
      assert(openness(boss) === want && openMul(s, boss) === want,
        `${s.key} on a boss: openness pays ${openness(boss)}× against the table's ${want}×`);
      rows.push(`${s.label} ${s.mul}× (boss ${want}×)`);
    }
    assert(openState(mk({ gripped: true, dead: true })) === null, 'a corpse still counts as helpless');
    assert(openState(null) === null && openness(null) === 1, 'openness(null) must be neutral');
    return rows.join(', ');
  });

  check('claims: the counts the game says out loud are the counts its tables hold', () => {
    /**
     * The classic shape of this defect: a number spelled out in a blurb beside
     * a table that grew. Both sides live — the sentence is read out of the
     * shipped MODES/LESSONS entry and the count off the shipped array — so
     * adding a lesson or a rung fails here on the day it is added.
     */
    const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
      fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
    /**
     * A COUNT WRITTEN AS PROSE, INCLUDING A HYPHENATED ONE.
     *
     * `(\w+)` cannot see a hyphen, so "forty-six boons drafted" was read as
     * SIX and the check failed claiming the header said 6 where the table held
     * 46 — a red about the code, caused by the instrument being unable to read
     * the most natural way to write any number past twenty. Every count in this
     * game's prose is going to be hyphenated sooner or later, so the pattern
     * takes the tens-and-units form and sums it.
     */
    const num = (text, after) => {
      const m = new RegExp(`([\\w-]+)\\s+${after}`, 'i').exec(text);
      if (!m) return null;
      const w = m[1].toLowerCase();
      if (/^\d+$/.test(w)) return +w;
      if (WORDS[w] !== undefined) return WORDS[w];
      const parts = w.split('-');
      if (parts.length === 2 && WORDS[parts[0]] !== undefined && WORDS[parts[1]] !== undefined) {
        return WORDS[parts[0]] + WORDS[parts[1]];
      }
      return null;
    };
    const rows = [];
    const claims = [
      ['training blurb', MODES.training.blurb, 'lessons', LESSONS.length],
      ['the cut lesson', LESSONS.find((l) => l.id === 'cut').hint, 'limbs',
        LESSONS.find((l) => l.id === 'cut').need],
    ];
    for (const [what, text, noun, live] of claims) {
      const said = num(text, noun);
      assert(said !== null, `${what} no longer states a count of ${noun}: "${text}"`);
      assert(said === live, `${what} says ${said} ${noun} and the table holds ${live}`);
      rows.push(`${what}: ${said} ${noun}`);
    }
    // …and every mode the menu can offer has a blurb at all
    for (const [k, m] of Object.entries(MODES)) {
      assert(m.name && m.blurb && m.blurb.length > 16, `mode '${k}' has no blurb worth reading`);
    }

    /**
     * AND THE FILE'S DESCRIPTION OF ITSELF, which drifts exactly the same way.
     * Waves.js opens by telling the reader how many boons and how many
     * masteries the system has. Those two sentences said "twenty-nine boons"
     * and "five masteries" while the table had grown to forty and six — nobody
     * reading the header had a true picture of the thing they were editing,
     * which is how a card gets written that duplicates another one's axis.
     * Read out of the shipped header, counted off the shipped arrays.
     */
    const header = readFileSync(join(SRC, 'game/Waves.js'), 'utf8').slice(0, 3000);
    const boonsSaid = num(header, 'boons drafted');
    const mastSaid = num(header, 'masteries gated');
    const masteries = BOONS.filter((b) => typeof b.requires === 'function').length;
    assert(boonsSaid === BOONS.length,
      `the Waves.js header says ${boonsSaid} boons and BOONS holds ${BOONS.length}`);
    assert(mastSaid === masteries,
      `the Waves.js header says ${mastSaid} masteries and ${masteries} cards are gated on one`);

    return `${rows.join('; ')}; ${Object.keys(MODES).length} modes all named and described; `
      + `the Waves header's ${boonsSaid} boons and ${mastSaid} masteries are what the tables hold`;
  });

  check('claims: the sandbox offers every enemy the game has, because it says it does', () => {
    /**
     * `sandboxUnits` says of itself: "Built from ARCHETYPES rather than typed
     * again, so a new droid shows up here the day it is added instead of the
     * day someone remembers this list exists." It then filtered ARCHETYPES
     * through a hand-typed array, which made the array the membership test and
     * the sentence false — the seventh hand-maintained-table-beside-a-generated-
     * one in this codebase, and the second time this exact list has been it.
     *
     * Measured before: 11 of 15 archetypes offered, with `jedi`, `sentinel`,
     * `guardian` and `master` unreachable in the one mode whose entire purpose
     * is picking an enemy and practising against it. The roster has since grown
     * again, which is precisely the point: this check asserts the DERIVATION —
     * every key of ARCHETYPES is offered — and never a count, so it stays true
     * on the day the twenty-first body is registered.
     */
    const offered = sandboxUnits().map((u) => u.key);
    const keys = Object.keys(ARCHETYPES);
    const missing = keys.filter((k) => !offered.includes(k));
    assert(!missing.length,
      `${missing.length} of ${keys.length} archetypes cannot be spawned in the sandbox: ${missing.join(', ')}`);
    // …and nothing offered that does not exist, which is the other way to lie
    const ghosts = offered.filter((k) => k !== 'mixed' && !ARCHETYPES[k]);
    assert(!ghosts.length, `the sandbox offers bodies that are not archetypes: ${ghosts.join(', ')}`);
    // …and every row says something true about the unit it names
    for (const u of sandboxUnits()) {
      if (u.key === 'mixed') continue;
      assert(u.name === ARCHETYPES[u.key].label,
        `the sandbox calls '${u.key}' "${u.name}" and the archetype calls itself "${ARCHETYPES[u.key].label}"`);
      assert(u.blurb.includes(`${ARCHETYPES[u.key].hp} hp`),
        `the sandbox row for ${u.key} does not quote its own hp`);
      assert(u.blurb.includes(`threat ${ARCHETYPES[u.key].threat}`),
        `the sandbox row for ${u.key} does not quote its own threat`);
    }
    return `${keys.length} archetypes, ${offered.length - 1} offered, every name and stat read off ARCHETYPES`;
  });

  check('claims: everything a boss wave scales with the party scales with the party', () => {
    /**
     * A co-op boss wave is supposed to be a bigger set-piece, not a solo
     * set-piece with more droids around it. Three numbers in `WaveDirector`
     * carry `partyScale()` — the threat budget, the heavy limit and the number
     * of set-piece bodies — and the third one did not: it was the flat
     * `wave >= CHAMPION_FROM ? 3 : 2`, so every extra blade's worth of threat
     * went to the ordinary fill. Measured through the real composer at waves 10
     * and 20, one/two/four players: 2, 2, 2 and 3, 3, 3 set-piece bodies, while
     * the budget went 61 → 245 and 162 → 650.
     *
     * Held as a DERIVATION over the three quantities rather than as three
     * numbers: each must be strictly larger at four blades than at one. A
     * fourth party-scaled quantity added later is covered the day it is added
     * only if it is listed here — which is why the list names what it measures
     * and the failure says which one stopped moving.
     */
    const solo = partyDirector(1), full = partyDirector(4);
    const wave = 20;
    const quantities = {
      'threat budget': (d) => d.budgetFor(wave),
      'heavy limit': (d) => d.heavyLimit(wave),
      'set-piece bodies': (d) => d._setPiece(wave, d.budgetFor(wave), d.modifiersAt(wave)).length,
    };
    const flat = [], rows = [];
    for (const [name, read] of Object.entries(quantities)) {
      const one = read(solo), four = read(full);
      if (!(four > one)) flat.push(`${name} is ${one} at one blade and ${four} at four`);
      rows.push(`${name} ${one}→${four}`);
    }
    assert(!flat.length, `these do not scale with the party: ${flat.join('; ')}`);
    assert(full.partyScale() > solo.partyScale(),
      `partyScale itself is flat: ${solo.partyScale()} vs ${full.partyScale()}`);
    return `wave ${wave}, one blade → four: ${rows.join(', ')}`;
  });

  check('claims: the Duel mode blurb is the ladder the director composes', () => {
    /**
     * "No blasters, no crowd. A ladder of duellists — a new form every 3 waves,
     * and a master at the top." Four claims, and every one of them is
     * checkable against the shipped `_compose`.
     *
     * THIS CHECK USED TO ASSERT THE OPPOSITE, and the reason is worth keeping.
     * The blurb said "Acolytes only", the mode composed acolytes only, and this
     * check parsed the noun out of the sentence and pinned the roster to it. It
     * passed for the whole life of the mode and it was measuring a defect:
     * `Duel.js` is a thousand lines of blade-lock, chambering and five authored
     * FORMS, and sixty waves over twelve seeds fielded fifteen distinct
     * compositions and ONE enemy type. A check can only ever hold a claim to
     * what it says; it cannot notice that the claim is small.
     *
     * So the claims are now about the SHAPE — no blasters, more than one body,
     * a rung cadence, a boss — and each is read off the sentence rather than
     * typed here a second time.
     */
    const blurb = MODES.duel.blurb;
    assert(/no blasters/i.test(blurb), `the Duel blurb no longer promises "no blasters": "${blurb}"`);
    assert(/no crowd/i.test(blurb), `the Duel blurb no longer promises "no crowd": "${blurb}"`);
    const rung = /every (\d+) waves?/i.exec(blurb);
    assert(rung, `the Duel blurb no longer states a rung cadence: "${blurb}"`);
    assert(Number(rung[1]) === DUEL_RUNG,
      `the blurb says a new form every ${rung[1]} waves and DUEL_RUNG is ${DUEL_RUNG}`);

    seedWaves(4242, 0);
    const d = new WaveDirector(gameWorld(), { mode: 'duel' });
    const seen = new Set();
    const bosses = new Set();
    let most = 0;
    for (let w = 1; w <= 30; w++) {
      d.wave = w;
      d._compose();
      most = Math.max(most, d.spawnQueue.length);
      for (const entry of d.spawnQueue) {
        const t = String(entry).split('|')[0];
        seen.add(t);
        if (ARCHETYPES[t].boss) bosses.add(t);
        // "no blasters" — nothing the ladder fields may shoot, elite or not.
        assert(!ARCHETYPES[t].ranged && !ARCHETYPES[t].fireRate,
          `the Duel blurb says "no blasters" and it fielded a ${t}, which fires`);
        // "just blades" — everything on the ladder carries one.
        assert(ARCHETYPES[t].saber, `the Duel ladder fielded a ${t}, which has no saber`);
      }
    }
    // "a ladder", not a stack of one body. This is the claim the old check
    // could not make, and it is the one that was false.
    assert(seen.size >= 4,
      `thirty waves of Duel fielded ${seen.size} archetype(s): ${[...seen].join(', ')} — a ladder has rungs`);
    // "a master at the top" — the boss rungs field something the ladder itself
    // never offers, which is what `setPieceOnly` means.
    assert(bosses.size >= 1, 'thirty waves of Duel never fielded a boss duellist');
    // "no crowd" — it is still a duel.
    assert(most <= DUEL_MAX, `a Duel wave fielded ${most} bodies against a stated ceiling of ${DUEL_MAX}`);
    return `30 waves of Duel: ${seen.size} duellists (${[...seen].join(', ')}), `
      + `bosses ${[...bosses].join(', ')}, never more than ${most} at once, no ranged archetype`;
  });

  check('claims: the coach\'s colours and answers are the game\'s colours and answers', () => {
    /**
     * The eleven lessons are the only place this game teaches its own rules, so
     * a coach line that names the wrong colour or the wrong answer is worse
     * than an unimplemented card: it teaches a player to do the thing that gets
     * them hit and then the mechanic takes the blame. "Blue arcs can be
     * parried" and "amber arcs cannot be parried — they must be chambered or
     * dodged" are two claims each, and all four are checkable against TIER.
     *
     * Both sides live: the colour word is parsed out of the shipped hint and
     * the hue is measured off the shipped `TIER[*].colour`, so recolouring a
     * tier fails here rather than leaving the dojo teaching last year's palette.
     */
    const hueOf = (hex) => {
      const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d < 1e-6) return 0;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      return h < 0 ? h + 360 : h;
    };
    // Ordinary colour names, as hue bands. Not a per-tier answer key.
    const BANDS = { red: [[340, 360], [0, 15]], amber: [[20, 55]], orange: [[15, 45]],
      yellow: [[45, 70]], green: [[80, 160]], blue: [[180, 260]] };
    const rows = [];
    for (const L of LESSONS) {
      const hint = typeof L.hint === 'function' ? L.hint({ scheme: 'directional' }) : L.hint;
      const m = /\b(red|amber|orange|yellow|green|blue) arcs?\b/i.exec(hint);
      if (!m) continue;
      const word = m[1].toLowerCase();
      // Which tier is that colour? Measured off TIER, not listed here.
      const named = Object.entries(TIER).filter(([, t]) =>
        BANDS[word].some(([lo, hi]) => hueOf(t.colour) >= lo && hueOf(t.colour) <= hi));
      assert(named.length === 1,
        `lesson '${L.id}' talks about ${word} arcs and ${named.length} tiers are that colour `
        + `(hues: ${Object.entries(TIER).map(([k, t]) => `${k} ${hueOf(t.colour).toFixed(0)}°`).join(', ')})`);
      const [tierKey, tier] = named[0];
      // …and the answer the line gives for that colour
      if (/can be parried/i.test(hint) && !/cannot be parried/i.test(hint)) {
        assert(tier.parryable, `lesson '${L.id}' says ${word} arcs can be parried and ${tierKey} is not parryable`);
      }
      if (/cannot be parried/i.test(hint)) {
        assert(!tier.parryable, `lesson '${L.id}' says ${word} arcs cannot be parried and ${tierKey} is`);
      }
      if (/chambered/i.test(hint)) {
        assert(tier.chamberable, `lesson '${L.id}' says ${word} arcs must be chambered and ${tierKey} is not chamberable`);
      }
      rows.push(`${L.id}: ${word} → ${tierKey} (${hueOf(tier.colour).toFixed(0)}°)`);
    }
    assert(rows.length >= 2, `only ${rows.length} lessons name an arc colour — the scan is broken`);

    /**
     * AND THE ONE LESSON THAT NAMES A POSITION ALONG THE BLADE. The `return`
     * brief said "contact past the middle of the blade" while `gradeCaught`
     * gates on `bladeT > 0.42`, which is not the middle. If a coach line names
     * a fraction, the gate has to be at that fraction.
     */
    const ret = LESSONS.find((l) => l.id === 'return');
    const brief = typeof ret.brief === 'function' ? ret.brief({ scheme: 'directional' }) : ret.brief;
    if (/middle of the blade|half(?:way)? (?:along|up) the blade/i.test(brief)) {
      assert(SPEED_GRADE.returnBladeT >= 0.5,
        `the 'return' lesson teaches contact past the middle of the blade and the gate is at `
        + `${SPEED_GRADE.returnBladeT} of it`);
    }
    return `${rows.join('; ')}; the return lesson names no fraction the gate (${SPEED_GRADE.returnBladeT}) does not have`;
  });

  check('claims: every lesson the coach counts is a lesson the world can report', () => {
    /**
     * A coach line is a claim too: "Sever eight limbs", "Blue arcs can be
     * parried". The lesson's `check` is fed every event the world produces, so
     * a lesson keyed on an event type nothing emits is a lesson that can never
     * be finished — the player does the thing, the counter does not move, and
     * the only way out is the skip button.
     *
     * The event vocabulary is read out of the shipped `world.report(...)` and
     * `report({...})` call sites rather than listed here, so a renamed event
     * fails on the day it is renamed.
     */
    const emitted = new Set();
    for (const f of srcFiles()) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/report\??\.?\(?\s*\{\s*type:\s*'(\w+)'/g)) emitted.add(m[1]);
      for (const m of text.matchAll(/report\s*\(\s*\{\s*type:\s*'(\w+)'/g)) emitted.add(m[1]);
    }
    assert(emitted.size > 3, `only found ${emitted.size} reported event types — the scan is broken`);
    const unreachable = [];
    for (const L of LESSONS) {
      /* The one endless rung — the sandbox the ladder ends in. It used to be
       * two, and the second was `free practice` sitting one rung ABOVE the end
       * with `check: () => false`, which stopped the ladder dead: this line
       * excused exactly the lesson that made the one past it unreachable.
       * `tools/checks/training.mjs` walks the ladder through `report` now and
       * asserts only the LAST rung may be endless, which is the half this
       * `continue` cannot make. */
      if (L.need === Infinity) continue;
      // Which event types can satisfy this lesson? Ask it, with the real shapes.
      const answers = [...emitted].filter((type) => {
        for (const ev of [{ type, speed: 99, grade: 3 }, { type, speed: 0, grade: 0 }]) {
          try { if (L.check(ev, { scheme: 'directional' })) return true; } catch { /* not this one */ }
        }
        return false;
      });
      if (!answers.length) unreachable.push(L.id);
    }
    assert(!unreachable.length,
      `these lessons cannot be completed by any event the world emits: ${unreachable.join(', ')}`);
    return `${LESSONS.length} lessons; ${LESSONS.filter((l) => l.need !== Infinity).length} counted ones all answerable `
      + `from the ${emitted.size} event types the world reports`;
  });

  check('claims: the two wave modes say what separates them, and the numbers are the code\'s', async () => {
    /**
     * The player, after playing both: "explain the difference between trail of
     * waves and path of the blade."
     *
     * That is a menu defect. The two blurbs were written years apart against
     * different questions, so neither mentioned the other and neither named
     * the axis: "Endless escalation" and "waves, boons and a run that ends when
     * you do" describe the same evening. They differ in exactly one thing —
     * where your power comes from — and the cards have to say so, because the
     * mode card is the only place a player is ever asked to choose.
     *
     * Both figures in them are CLAIMS, which is why they are here: `MODES` is
     * declared above `DRAFT_EVERY` and `TRIAL` in Waves.js and interpolating
     * them would be a temporal-dead-zone crash on import, so the numbers are
     * typed — and a typed number in a blurb is one tuning pass from being a
     * lie.
     */
    const { MODES, DRAFT_EVERY, TRIAL } = await import('../../src/game/Waves.js');
    const trial = MODES.waves.blurb, path = MODES.roguelite.blurb;
    const ord = (n) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

    /* EACH NAMES THE OTHER'S ANSWER. A card that only describes itself leaves
     * the comparison to the player, which is the whole complaint. */
    assert(/holocron/i.test(trial), `the Trial's card never says where its power comes from: "${trial}"`);
    assert(/\bno boons?\b/i.test(trial), `the Trial's card never says it has no boons: "${trial}"`);
    assert(/trial/i.test(path), `Path of the Blade's card never mentions the mode beside it: "${path}"`);
    assert(/boon/i.test(path), `Path of the Blade's card never says it deals boons: "${path}"`);

    /* AND THE CADENCES ARE THE CONSTANTS. */
    assert(path.includes(`every ${ord(DRAFT_EVERY)} wave`),
      `Path of the Blade's card does not quote DRAFT_EVERY (${DRAFT_EVERY}, i.e. "every ${ord(DRAFT_EVERY)} `
      + `wave"): "${path}"`);
    assert(trial.includes(`every ${ord(TRIAL.every)} wave`),
      `the Trial's card does not quote TRIAL.every (${TRIAL.every}): "${trial}"`);
    assert(trial.includes(`from wave ${TRIAL.from}`),
      `the Trial's card does not quote TRIAL.from (${TRIAL.from}): "${trial}"`);
    /* …AND THE CLAIM THAT IT DRAFTS NOTHING IS THE DIRECTOR'S OWN ANSWER. */
    const { WaveDirector } = await import('../../src/game/Waves.js');
    /* `drafts` is a getter over DRAFT_MODES, which is the shipped statement of
     * this claim — read off the prototype rather than by standing up a whole
     * director, since building one wants a real World. */
    const { DRAFT_MODES } = await import('../../src/game/Waves.js');
    assert(!DRAFT_MODES.includes('waves'),
      'the Trial of Waves card says no boons are drafted and DRAFT_MODES lists it as a mode that does');
    assert(DRAFT_MODES.includes('roguelite'),
      'Path of the Blade\'s card says it deals boons and DRAFT_MODES does not list it');
    return `Trial: no boons, Holocron, every ${ord(TRIAL.every)} wave from ${TRIAL.from} · `
      + `Path: a boon every ${ord(DRAFT_EVERY)} wave`;
  });
}
