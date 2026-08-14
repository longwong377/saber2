/**
 * SABER — the temple, and who is actually in it.
 *
 * "Jedi Temple / Coruscant — the enemies are Jedi, clear the temple."
 *
 * THE GAP, measured before anything was built. `LEVELS.temple.pool` was
 * `['acolyte','acolyte','acolyte','sniper','acolyte','trooper','acolyte','b2']`
 * — five of eight slots Sith Acolytes — and driven through the real wave
 * director over waves 1 to 12 on a fixed seed it spawned 32 Sith of 115 bodies
 * and ZERO Jedi, because zero Jedi existed. `Object.keys(ARCHETYPES)` was
 * fourteen and not one of them was of the order. The level's own header said so
 * in as many words: "this game has exactly one sabered humanoid archetype,
 * `acolyte`, and no Jedi body". The level named for the Jedi was garrisoned by
 * their opposites, and the file knew.
 *
 * THE SECOND GAP was underneath it and was worth more. `FORMS` in Duel.js has
 * five entries, they are genuinely distinct — Djem So is 0% parryable and
 * Makashi 100%, measured off the shipped `ATTACKS` tiers — and `DuelBrain`'s
 * constructor has taken an `opts.form` since it was written. Measured across
 * the whole roster: 0 of 14 archetypes declared one. Every duellist the game
 * has ever spawned rolled a die on `FORM_KEYS`, so the sentence Duel.js's own
 * header says the system exists to make true — "a player learns 'that is Djem
 * So, it commits hard, punish the recovery'" — could not be learned. The same
 * body in the same robe fought a different way every time it appeared.
 *
 * WHAT IS MEASURED HERE is the garrison and the forms, always by driving the
 * shipped code: the real WaveDirector composing the real pool, real Enemies
 * built by the real builders, and real DuelBrains telegraphing real attacks.
 * Nothing here reads a list of archetype names that this file keeps.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, ARCHETYPES, enemyRng } from '../../src/game/Enemy.js';
import { FORMS, FORM_KEYS, ATTACKS, TIER, duelRng } from '../../src/game/Duel.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { WaveDirector, seedWaves, SET_PIECE } from '../../src/game/Waves.js';
import { SABER_COLORS } from '../../src/game/Saber.js';
import { bodyOf } from '../../src/engine/Presence.js';
import { ENEMY_VOICES } from '../../src/engine/Voice.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flat = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'stone',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/** Everyone of the order, found by the flag the archetypes carry. */
const JEDI = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].jedi);
/** …and everyone who duels at all, which is the set the forms have to cover. */
const DUELLISTS = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].saber && ARCHETYPES[k].melee);

/**
 * WHAT ANSWERS A FORM, derived from the shipped tables rather than restated.
 *
 * `TIER.light.parryable` is true and the other two are false, so the share of a
 * form's move list that is parryable is the share of its attacks a player can
 * answer with the blade alone. This is the axis the four Jedi are spread along
 * and it is computed from `FORMS[k].moves` through `ATTACKS[k].tier` through
 * `TIER[t].parryable` — three shipped tables and no fourth copy.
 */
function parryableShare(formKey) {
  const moves = FORMS[formKey].moves;
  const n = moves.filter((m) => TIER[ATTACKS[m].tier].parryable).length;
  return n / moves.length;
}

/** A world just real enough to build a duellist in and drive it. */
function stubWorld(physics, terrain, target) {
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  return {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: target ? [target] : [], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0x4a4438,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
}

/** A vertex fingerprint of a built body, in its own frame. */
function print(rig) {
  rig.root.updateMatrixWorld(true);
  let h = 2166136261 >>> 0, n = 0;
  rig.root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const a = o.geometry.attributes.position;
    n += a.count;
    for (let i = 0; i < a.count * 3; i++) {
      const q = Math.round(a.array[i] * 10000) | 0; h ^= q; h = Math.imul(h, 16777619) >>> 0;
    }
  });
  return `${n}:${h.toString(16)}`;
}

export async function run({ check, assert }) {
  await initPhysics();

  check('temple: the hall named for the order is garrisoned by the order', () => {
    /**
     * Driven through the REAL composer on the REAL pool, because the pool alone
     * does not decide the wave: `unlockedAt` gates by depth, `_pickType`
     * weights by `threat^bias`, and an archetype named in a pool with no
     * `unlockAt` never fills at all. Counting pool slots would have said the
     * garrison was Jedi while the composer fielded none of them.
     *
     * The before number, on this exact code path and this exact seed: 115
     * bodies over waves 1-12, 32 Sith Acolytes, 0 Jedi.
     */
    const L = LEVELS.temple;
    const d = new WaveDirector({ players: [{}], level: L }, { pool: L.pool, mode: 'waves' });
    const tally = {};
    seedWaves(20250814);
    for (let w = 1; w <= 12; w++) {
      d.wave = w;
      d._compose();
      for (const s of d.spawnQueue) {
        const t = String(s).split('|')[0];
        tally[t] = (tally[t] || 0) + 1;
      }
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    const jedi = Object.entries(tally).filter(([t]) => ARCHETYPES[t]?.jedi)
      .reduce((n, [, c]) => n + c, 0);
    /* The Sith counted the same way the Jedi are — by what the archetype IS
     * rather than by its key — so an acolyte renamed tomorrow still counts. */
    const sith = Object.entries(tally)
      .filter(([t]) => ARCHETYPES[t]?.saber && ARCHETYPES[t]?.melee && !ARCHETYPES[t].jedi)
      .reduce((n, [, c]) => n + c, 0);
    assert(total > 40, `only ${total} bodies over twelve waves — the composer is not composing`);
    assert(jedi > sith * 2,
      `the temple fields ${jedi} Jedi against ${sith} Sith over twelve waves — `
      + 'the level named for the Jedi is still garrisoned by their opposites');
    /* …and the Sith are not deleted from it either. One acolyte slot in nine is
     * the fiction — something turned this hall — and a garrison of nothing but
     * Jedi would be a different mistake with the same shape. */
    assert(sith > 0, 'there is no Sith left in the temple at all, which is a hall with no reason to be fought in');
    /* At least three of the four have to actually arrive. A roster where one
     * body wins the `threat^bias` weighting and the rest never spawn is four
     * archetypes and one enemy. */
    const seen = JEDI.filter((t) => tally[t]);
    assert(seen.length >= 3,
      `only ${seen.length} of the ${JEDI.length} Jedi archetypes ever spawn: ${seen.join(', ')}`);
    return `${jedi} Jedi (${seen.map((t) => `${t} ${tally[t]}`).join(', ')}) and ${sith} Sith `
      + `of ${total} bodies over twelve waves`;
  });

  check('temple: the Master arrives as the set-piece, and only as the set-piece', () => {
    /**
     * `_setPiece` is the only door a `boss` archetype has, and it filters every
     * rung by whether the LEVEL'S POOL names the type — which is why the
     * warship names its own general. Before the Master's rung, the temple's
     * ladder was `acolyte` and nothing else: measured, every boss wave from 5
     * to 40 on this level fielded exactly two Sith Acolytes, so the level built
     * for duelling had the lightest rung in the game as its climax.
     *
     * The other half is the property `unlockedAt` promises — a body with no
     * `unlockAt` can never arrive as fill — and it matters here because it is
     * what keeps a 460 hp duellist off wave 2.
     */
    const L = LEVELS.temple;
    const d = new WaveDirector({ players: [{}], level: L }, { pool: L.pool });
    const rung = SET_PIECE.find((s) => ARCHETYPES[s.type]?.jedi);
    assert(rung, 'no Jedi rung on the set-piece ladder');
    assert(L.pool.includes(rung.type),
      `${rung.type} has a rung but the temple's pool does not name it, so the rung can never fire`);
    assert(ARCHETYPES[rung.type].unlockAt === undefined,
      `${rung.type} declares an unlockAt, so it can arrive as ordinary fill on any wave`);

    const waves = {};
    for (const w of [5, 10, 15, 20, 30]) {
      seedWaves(4242);
      waves[w] = d._setPiece(w, d.budgetFor(w), d.modifiersAt(w))
        .map((e) => String(e).split('|')[0]);
    }
    assert(!waves[5].includes(rung.type), `the ${rung.type} arrives on wave 5, under its own gate of ${rung.from}`);
    for (const w of [10, 15, 20, 30]) {
      assert(waves[w].includes(rung.type),
        `boss wave ${w} on the temple is [${waves[w].join(', ')}] — no Master in it`);
    }
    /* And it never fills: the composer over thirty waves must not put one in
     * the queue on a wave that is not a boss wave. */
    let stray = 0;
    for (let w = 1; w <= 30; w++) {
      if (d.isBossWave(w)) continue;
      seedWaves(1000 + w);
      d.wave = w;
      d._compose();
      stray += d.spawnQueue.filter((s) => String(s).split('|')[0] === rung.type).length;
    }
    assert(stray === 0, `${stray} Masters arrived on non-boss waves as ordinary fill`);
    return `${rung.type} on boss waves ${[10, 15, 20, 30].join('/')} and never as fill over 30 waves; `
      + `wave 5 is [${waves[5].join(', ')}]`;
  });

  check('temple: every Jedi declares a duel form, and the four span what answers them', () => {
    /**
     * The measurement that made this worth building: 0 of 14 archetypes carried
     * a `form`, so `Enemy._build`'s `A.form || FORM_KEYS[floor(rng() * 5)]` was
     * the random branch every single time.
     *
     * The spread is over PARRYABLE SHARE, derived through three shipped tables
     * (FORMS.moves -> ATTACKS.tier -> TIER.parryable) rather than restated here.
     * That is the axis the player experiences: at one end a duellist every one
     * of whose attacks can be met with the blade, at the other one where none
     * of them can and the only answers are footwork and the counter-swing.
     */
    const declared = JEDI.filter((t) => ARCHETYPES[t].form);
    assert(declared.length === JEDI.length,
      `${JEDI.length - declared.length} of the ${JEDI.length} Jedi still roll a random form`);
    for (const t of JEDI) {
      assert(FORMS[ARCHETYPES[t].form],
        `${t} names the form '${ARCHETYPES[t].form}', which is not in FORMS`);
    }
    const forms = [...new Set(JEDI.map((t) => ARCHETYPES[t].form))];
    assert(forms.length >= 3,
      `the ${JEDI.length} Jedi share ${forms.length} form(s) between them — that is one duellist`);

    const shares = forms.map((f) => ({ f, p: parryableShare(f) }));
    const lo = Math.min(...shares.map((s) => s.p)), hi = Math.max(...shares.map((s) => s.p));
    assert(lo <= 0.05,
      `the most committed Jedi form is still ${(lo * 100).toFixed(0)}% parryable — nothing in the `
      + 'garrison forces the player off the parry');
    assert(hi >= 0.95,
      `the most open Jedi form is only ${(hi * 100).toFixed(0)}% parryable — nothing in the `
      + 'garrison teaches the parry either');
    /* …and aggression has to spread too, or four forms is four move lists at
     * one tempo. Soresu at 0.42 will not walk onto your blade; Ataru at 1.3
     * will not stop coming. */
    const agg = forms.map((f) => FORMS[f].aggression);
    assert(Math.max(...agg) > Math.min(...agg) * 2,
      `every Jedi form attacks at ${agg.join('/')} aggression — one tempo, four names`);
    return shares.map((s) => `${FORMS[s.f].name} ${(s.p * 100).toFixed(0)}% parryable at ` +
      `${FORMS[s.f].aggression} aggression`).join(', ');
  });

  check('temple: and the form on the archetype is the form the body actually fights with', () => {
    /**
     * The half a data check cannot see. `A.form` could be declared, spelled
     * correctly, spread across the answer axis — and dropped on the floor by
     * `_build`, which is exactly what would have happened had the constructor
     * not already had the `opts.form` seam.
     *
     * So this builds real Enemies and drives them at a real target, and counts
     * the TIERS of the attacks the shipped DuelBrain actually chose. The
     * measured mix has to match the form's own move list, which is the only
     * way to know the declaration reached the brain rather than merely being
     * stored on it.
     */
    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 200 });
    const terrain = flat();
    physics.terrain = terrain;
    const rows = [];
    for (const type of JEDI) {
      enemyRng.seed(4711);
      duelRng.seed(8123);
      const target = {
        position: V(0, 0, 0), velocity: new THREE.Vector3(), chest: V(0, 1.3, 0),
        hp: 5000, alive: true, invuln: 0, radius: 0.34, camera: { addShake() {} },
        damage() { this.hp = 5000; },
      };
      const w = stubWorld(physics, terrain, target);
      const e = new Enemy(w, type, V(0, 0, -2.4));
      e.position.set(0, 0, -2.4);
      w.enemies.push(e);
      assert(e.duel, `${type} built without a duel brain`);
      assert(e.duel.formKey === ARCHETYPES[type].form,
        `${type} declares ${ARCHETYPES[type].form} and fights ${e.duel.formKey}`);
      const ctx = { enemies: w.enemies, particles: w.particles, terrain, physics,
        bolts: w.bolts, time: 0, pickTarget: () => target, camera: w.engine.camera };
      const seen = {};
      let last = null, n = 0;
      for (let i = 0; i < 90 * 60; i++) {
        ctx.time = w.time += 1 / 60;
        e.hp = e.maxHp;
        e.update(1 / 60, ctx);
        target.hp = 5000;
        const k = e.duel.attackKey;
        if (k && k !== last) { seen[k] = (seen[k] || 0) + 1; n++; }
        last = k;
        physics.step(1 / 60);
      }
      /* Eight, not twenty, and the floor is low ON PURPOSE. Soresu is authored
       * at 0.42 aggression against Ataru's 1.3 and its tell is literally "gives
       * you nothing — it is waiting for you to swing first"; against a target
       * that never swings it threw 12 attacks in ninety seconds where the
       * Knight threw 90. A threshold that failed the Sentinel would be a check
       * demanding the defensive form stop being defensive. What this floor is
       * for is the other failure: a form whose declaration reached the brain
       * and whose move list is empty or unreachable throws nothing at all. */
      assert(n > 8, `${type} threw only ${n} attacks in ninety seconds`);
      const own = new Set(FORMS[ARCHETYPES[type].form].moves);
      const stray = Object.keys(seen).filter((k) => !own.has(k));
      assert(!stray.length,
        `${type} fights ${ARCHETYPES[type].form} and threw ${stray.join(', ')}, which is not in it`);
      const parryable = Object.entries(seen)
        .filter(([k]) => TIER[ATTACKS[k].tier].parryable)
        .reduce((a, [, c]) => a + c, 0) / n;
      const want = parryableShare(ARCHETYPES[type].form);
      // Not equality: `_pick` keeps RHYTHM 0.72 of the order and rolls the rest,
      // so the realised mix wanders round the authored one. What must hold is
      // the END of the axis — a 0% form must land no parryable attacks at all,
      // and a 100% form must land nothing else.
      if (want === 0) assert(parryable === 0, `${type} is ${ARCHETYPES[type].form} and threw ${(parryable * 100).toFixed(0)}% parryable attacks`);
      if (want === 1) assert(parryable === 1, `${type} is ${ARCHETYPES[type].form} and threw ${((1 - parryable) * 100).toFixed(0)}% unparryable attacks`);
      rows.push(`${type} ${e.duel.formKey} ${n} attacks ${(parryable * 100).toFixed(0)}% parryable`);
      e.dispose?.();
    }
    /* The Sith are deliberately NOT given a form, and that is a statement
     * rather than an oversight: the erratic one is the one whose own header
     * says "the rhythm is the trap". */
    const wild = DUELLISTS.filter((t) => !ARCHETYPES[t].form);
    assert(wild.length >= 1, 'every duellist in the game now fights a fixed form, so none of them is unpredictable');
    return `${rows.join('; ')}; ${wild.length} duellist(s) still draw at random`;
  });

  check('temple: a Jedi is a different body from a Sith, and a different blade', () => {
    /**
     * "Not a reskinned Sith: a body with its own silhouette, its own blade
     * colour." Both halves measured off what is actually built.
     *
     * The silhouette is `buildJedi` — the builder the PLAYER uses — against
     * `buildAcolyte`, and the two were authored against each other: the
     * acolyte's own comment in Bodies.js says "these two and the Jedi share one
     * skeleton and one standing height, so the only thing that can separate
     * them at range is mass distribution". So the vertex counts and the
     * fingerprints must differ, and the Jedi must not be wearing the acolyte's
     * cowl.
     *
     * The blade is `SABER_COLORS[saberColor]`, and the assertion is the one
     * that matters in a hall where both sides carry one: no Jedi may draw a
     * crystal flagged `dark`, and no two of them may draw the same crystal as
     * the Sith they are standing next to.
     */
    const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 200 });
    const terrain = flat();
    physics.terrain = terrain;
    const w = stubWorld(physics, terrain, null);
    enemyRng.seed(2024);
    duelRng.seed(31);
    const prints = new Map();
    const rows = [];
    let acolyte = null;
    for (const type of [...JEDI, 'acolyte']) {
      const e = new Enemy(w, type, V(0, 0, 0));
      assert(e.rig, `${type} built no rig`);
      const p = print(e.rig);
      if (type === 'acolyte') acolyte = p;
      else prints.set(type, p);
      rows.push(`${type} ${p.split(':')[0]}v`);
      e.dispose?.();
    }
    for (const [type, p] of prints) {
      assert(p !== acolyte, `${type} builds exactly the acolyte's geometry — it IS a reskinned Sith`);
    }

    const sithCrystal = ARCHETYPES.acolyte.saberColor;
    for (const type of JEDI) {
      const idx = ARCHETYPES[type].saberColor;
      const c = SABER_COLORS[idx];
      assert(c, `${type} names crystal ${idx}, which is not on the rack`);
      assert(idx !== sithCrystal, `${type} draws the same crystal as the Sith Acolyte`);
      assert(!c.dark, `${type} draws ${c.name}, which the rack flags as a dark crystal`);
    }
    const used = new Set(JEDI.map((t) => ARCHETYPES[t].saberColor));
    assert(used.size >= 3,
      `the ${JEDI.length} Jedi draw ${used.size} crystal(s) between them — at range they are one enemy`);

    /* AND NO TWO OF THEM ARE THE SAME PERSON. `buildJedi` takes the whole
     * character sheet the creator screen drives, and the archetype draws one
     * per body out of `enemyRng` — so a hall of eight is eight faces. Built
     * eight times from one archetype: if the look were fixed at declaration
     * time rather than drawn per body, all eight would fingerprint alike. */
    enemyRng.seed(77);
    const crowd = new Set();
    for (let i = 0; i < 8; i++) {
      const e = new Enemy(w, JEDI[0], V(0, 0, 0));
      crowd.add(print(e.rig));
      e.dispose?.();
    }
    assert(crowd.size >= 6,
      `eight ${JEDI[0]}s built ${crowd.size} distinct bodies between them — a garrison of clones`);
    return `${rows.join(', ')}; ${used.size} crystals, none dark; 8 bodies of one archetype are ${crowd.size} people`;
  });

  check('temple: nothing that classifies a body by its archetype is short of the new ones', () => {
    /**
     * The copied-table defect, asked of the roster this pass adds to. The
     * project has been bitten by it six times, most recently when `bodyguard`,
     * `charger` and `stalker` — three archetypes registered in Levels.js after
     * two key lists were written — fell past every branch of both and came out
     * as plain humanoids: the 240 kg IG droid BREATHED instead of running its
     * servos, and the Reek died at f0 97 on the two-syllable human scream.
     *
     * `bodyOf` is the roster's one body classifier and `Announcer._enemySpec`
     * reads it, so both are derived and both are asked here for EVERY archetype
     * in the table rather than for the ones this pass happens to know about.
     *
     * A Jedi answering to the `sith` voice spec is correct and is not an
     * oversight: that spec is a throat — f0 97, two formants, a sawtooth — and
     * the name on it is a label. Both robed duellists have the same larynx.
     */
    const all = Object.keys(ARCHETYPES);
    const bad = [];
    for (const type of all) {
      const b = bodyOf({ A: ARCHETYPES[type] });
      /* The three buckets are exclusive; `walker` is a REFINEMENT of droid
       * rather than a fourth bucket (`bodyOf` computes `droid = !beast &&
       * (walker || …)`), so it is asserted as an implication instead. */
      const kinds = [b.droid, b.beast, b.trooper].filter(Boolean).length;
      if (kinds > 1) bad.push(`${type} is ${kinds} kinds of body at once`);
      if (b.walker && !b.droid) bad.push(`${type} is a walker and not a machine`);
      if (b.legs !== (b.walker || b.beast ? 4 : 2)) bad.push(`${type} has the wrong number of legs`);
      /* Every archetype must land SOMEWHERE: the leftover bucket is the robed
       * duellist, and a body that is none of the three and carries no blade has
       * fallen off the end of the classifier the way the Reek did. */
      if (kinds === 0 && !ARCHETYPES[type].saber) bad.push(`${type} is no kind of body at all`);
    }
    assert(!bad.length, bad.join('; '));

    /* The voice, through the same classifier the Announcer uses. Every
     * archetype must resolve to a spec that exists — the failure this catches
     * is a branch order that lets a new body fall off the end. */
    const spec = (type) => {
      const b = bodyOf({ A: ARCHETYPES[type] });
      if (b.walker) return ENEMY_VOICES.walker;
      if (b.beast) return ENEMY_VOICES.beast;
      if (b.droid) return ENEMY_VOICES.droid;
      if (b.trooper) return ENEMY_VOICES.trooper;
      return ENEMY_VOICES.sith;
    };
    const voiced = {};
    for (const type of all) {
      const s = spec(type);
      assert(s && s.id, `${type} resolves to no voice at all`);
      voiced[s.id] = (voiced[s.id] || 0) + 1;
    }
    /* And the five large creatures must all be voiced as animals, which is the
     * exact regression that put the Reek in an acolyte's throat. */
    for (const type of all) {
      if (ARCHETYPES[type].custom !== 'beast') continue;
      assert(spec(type).id === 'beast', `${ARCHETYPES[type].label} screams with a ${spec(type).id}'s throat`);
    }
    return `${all.length} archetypes, all classified: `
      + Object.entries(voiced).map(([k, n]) => `${n} ${k}`).join(', ');
  });

  check('temple: every level names only archetypes the game has', () => {
    /* The cheap half of the same family, and the one that would have caught a
     * pool slot mistyped in this pass before it reached a wave. A pool naming
     * a type that is not in ARCHETYPES does not throw: `_pickType` skips it,
     * `unlockedAt` filters it out, and the level quietly fields a thinner wave
     * for the rest of its life. */
    const bad = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.pool) continue;
      for (const t of L.pool) if (!ARCHETYPES[t]) bad.push(`${key} names '${t}'`);
    }
    for (const s of SET_PIECE) if (!ARCHETYPES[s.type]) bad.push(`the set-piece ladder names '${s.type}'`);
    assert(!bad.length, bad.join('; '));
    /* …and every set-piece rung has at least one level that can field it, or it
     * is a rung nobody ever climbs. */
    const orphan = SET_PIECE.filter((s) =>
      !LEVEL_ORDER.some((k) => LEVELS[k]?.pool?.includes(s.type)));
    assert(!orphan.length,
      `${orphan.map((s) => s.type).join(', ')} have set-piece rungs no level's pool names`);
    return `${LEVEL_ORDER.length} pools and ${SET_PIECE.length} set-piece rungs, all resolving; `
      + `${FORM_KEYS.length} forms, ${Object.keys(ARCHETYPES).length} archetypes`;
  });
}
