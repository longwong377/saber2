/**
 * The instrument, checked. — tools/balance.mjs
 *
 * `tools/balance.mjs` is 1400 lines that answer "is this game TUNED" — is wave 7
 * a wall, are the four difficulties actually ordered, is one boon strictly
 * better than the other twenty-nine. It has had no checks at all. That is a
 * strange gap for a file whose entire output is numbers other decisions get
 * made from, and it bit twice in one afternoon:
 *
 *   The harness restated Combat's deflection gates as three literals copied out
 *   of it, so when the PERFECT gate was set to 1.37x a speed the blade cannot
 *   physically reach, the instrument agreed with it. It could not report the
 *   bug because it was grading against the same guess.
 *
 *   A card was added — Cadence — that the model had no channel for, and the
 *   harness dutifully ranked it 0.000 and filed it under UNMODELLED. A ranking
 *   that silently scores a real card as worthless is worse than one with a
 *   known hole, because the hole is invisible in the output.
 *
 * ── WHAT IS DELIBERATELY NOT CHECKED HERE ─────────────────────────────────
 *
 * NO SIMULATED DEPTHS. The boon ranking is stochastic — paired seeds, three
 * skill tiers, a few thousand runs — and pinning a number out of it makes a
 * check that fails on honest tuning and on nothing else. Every assertion below
 * is DETERMINISTIC: table shapes, orderings, closed forms, and agreement
 * between two implementations of the same rule. The stochastic half is what
 * `node tools/balance.mjs` is for, and it is read by a person.
 *
 * Every tolerance is stated where it is used, with what it is protecting.
 */
import * as THREE from 'three';

export async function run({ check, assert }) {
  const B = await import('../balance.mjs');
  const { DIFFICULTY, SPEED_GRADE } = await import('../../src/game/Combat.js');
  const { ARCHETYPES, MODIFIERS, modifierThreat } = await import('../../src/game/Enemy.js');
  const { defaultBoonMods } = await import('../../src/game/Player.js');
  const { WaveDirector, BOONS, ATTUNEMENTS } = await import('../../src/game/Waves.js');

  /* ══ 1. the ladder the whole difficulty system is ══════════════════════ */

  check('balance: the four difficulty tiers are ordered on every dial they declare', () => {
    // THE FIRST QUESTION THE HARNESS EXISTS TO ANSWER, and it is answerable
    // without simulating anything: a tier that is harder must be harder on
    // every axis it names, or "Master" is a word rather than a setting. Pinned
    // as strict monotonicity because these are four hand-authored rows — there
    // is no fitting process here to leave a tie behind.
    const order = ['padawan', 'knight', 'master', 'grandmaster'];
    const harder = { damageTaken: 1, fireRate: 1, enemyAggression: 1, enemyAccuracy: 1 };
    const easier = { assist: 1 };
    const rows = [];
    for (const [dial, _] of Object.entries(harder)) {
      const seq = order.map(k => DIFFICULTY[k][dial]);
      assert(seq.every(v => typeof v === 'number'), `${dial} is not a number on every tier`);
      for (let i = 1; i < seq.length; i++) {
        assert(seq[i] > seq[i - 1],
          `${dial} goes ${seq[i - 1]} → ${seq[i]} from ${order[i - 1]} to ${order[i]} — the ladder is flat or inverted there`);
      }
      rows.push(`${dial} ${seq[0]}→${seq[3]}`);
    }
    for (const dial of Object.keys(easier)) {
      const seq = order.map(k => DIFFICULTY[k][dial] ?? 0);
      for (let i = 1; i < seq.length; i++) {
        assert(seq[i] < seq[i - 1],
          `${dial} (help, so it must SHRINK) goes ${seq[i - 1]} → ${seq[i]} from ${order[i - 1]} to ${order[i]}`);
      }
      rows.push(`${dial} ${seq[0]}→${seq[3]}`);
    }
    return rows.join(', ');
  });

  /* ══ 2. the gate that outran the blade ═════════════════════════════════ */

  check('balance: every deflection gate is a speed the blade can actually reach', () => {
    /**
     * THE BUG THIS FILE WAS WRITTEN TOO LATE TO CATCH. PERFECT was gated at
     * bladeSpeed > 15 while the fastest authored attack peaks the tip at 10.97
     * m/s — so the top rung of the deflection ladder, on the game's most-used
     * verb, could not be climbed by swinging at any skill level. It went
     * unnoticed because the harness restated the gate rather than reading it.
     *
     * MEASURED, not asserted: the peak comes from driving the real
     * SaberController through the real authored attack into a real Saber.
     *
     * The tolerance is a HEADROOM RATIO rather than an absolute, so this
     * survives any honest retune of either side — a faster attack, a longer
     * blade, a different gate. 0.95 leaves the gate reachable while still
     * demanding it sit near the top of a committed swing; a gate at 0.99 of
     * peak would be technically reachable and practically not.
     */
    const s = B.measureSwing();
    const peak = s.peak;
    assert(peak > 0, 'the swing measured no tip speed at all — the harness is not driving the controller');
    for (const [name, gate] of [['driven', SPEED_GRADE.driven], ['return', SPEED_GRADE.return],
      ['perfect', SPEED_GRADE.perfect]]) {
      assert(gate < peak * 0.95,
        `SPEED_GRADE.${name} is ${gate} m/s against a measured peak of ${peak.toFixed(2)} — `
        + `${(gate / peak).toFixed(2)}x the fastest the blade goes, so that grade is unreachable by speed`);
    }
    // …and the ladder has to BE a ladder, or two rungs are one rung.
    assert(SPEED_GRADE.driven < SPEED_GRADE.return && SPEED_GRADE.return < SPEED_GRADE.perfect,
      `the gates are out of order: ${SPEED_GRADE.driven} / ${SPEED_GRADE.return} / ${SPEED_GRADE.perfect}`);
    // Each rung must admit strictly less of a real swing than the one below it,
    // which is the property "harder" actually means.
    const share = (v) => s.shareAbove(v);
    assert(share(SPEED_GRADE.perfect) < share(SPEED_GRADE.return),
      'the PERFECT gate admits as much of a real swing as the RETURN gate — they are the same rung');
    return `peak ${peak.toFixed(2)} m/s; gates ${SPEED_GRADE.driven}/${SPEED_GRADE.return}/${SPEED_GRADE.perfect} `
      + `admit ${(100 * share(SPEED_GRADE.driven)).toFixed(0)}%/${(100 * share(SPEED_GRADE.return)).toFixed(0)}%/`
      + `${(100 * share(SPEED_GRADE.perfect)).toFixed(0)}% of it`;
  });

  check('balance: the harness reads Combat\'s gates instead of restating them', async () => {
    // The structural version of the check above, and the one that actually
    // stops the bug recurring: a hardcoded 15 in this file is what made the
    // instrument blind to a hardcoded 15 in the game.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../balance.mjs', import.meta.url), 'utf8');
    const i = src.indexOf('export function measureSwing');
    const body = src.slice(i, src.indexOf('MEASURED ANCHOR 2'));
    assert(/SPEED_GRADE\./.test(body), 'measureSwing does not read SPEED_GRADE — it is grading against its own copy');
    assert(!/above\(\s*\d+(\.\d+)?\s*\)/.test(body),
      'measureSwing grades against a numeric literal, which is how the last wrong gate went unreported');
    return 'the grade mix is computed from the game\'s own ladder';
  });

  /* ══ 3. the ramp ═══════════════════════════════════════════════════════ */

  check('balance: the budget climbs smoothly and without a step', () => {
    /**
     * A wave that costs noticeably more than the trend is a wall the player
     * cannot see coming and cannot be told about. This is the second derivative
     * of the budget over the first forty waves.
     *
     * TOLERANCE: |Δ²| ≤ 4. Today's curve runs -3..+2 — it is
     * `floor(4 + 2.6w + 0.65·w^1.62) × BOON_POWER^((w-1)/6)`, and the floor
     * alone makes ±1 unavoidable, so a bound tight enough to catch a real step
     * still has to tolerate rounding. 4 is comfortably inside "one extra B1"
     * (threat 1) and far below any authored jump.
     */
    const d = new WaveDirector({ settings: {}, enemies: [], difficulty: DIFFICULTY.knight },
      { mode: 'roguelite', pool: ['b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'] });
    const b = [];
    for (let w = 1; w <= 40; w++) b.push(d.budgetFor(w));
    for (let w = 1; w < b.length; w++) {
      assert(b[w] > b[w - 1], `the budget did not grow from wave ${w} to ${w + 1}: ${b[w - 1]} → ${b[w]}`);
    }
    let worst = 0, worstAt = 0;
    for (let w = 2; w < b.length; w++) {
      const dd = (b[w] - b[w - 1]) - (b[w - 1] - b[w - 2]);
      if (Math.abs(dd) > Math.abs(worst)) { worst = dd; worstAt = w + 1; }
    }
    assert(Math.abs(worst) <= 4,
      `the budget steps by ${worst} at wave ${worstAt} — that is a wall the player cannot see coming`);
    // And it must not stop growing: this is the endless mode's pressure half.
    assert(b[39] > b[19] * 1.5, `the budget flattens out — wave 40 is only ${(b[39] / b[19]).toFixed(2)}x wave 20`);
    return `wave 1 → 40: ${b[0]} → ${b[39]}, worst Δ² ${worst} at wave ${worstAt}`;
  });

  /* ══ 4. two implementations of one rule ════════════════════════════════ */

  check('balance: the harness\'s elite arithmetic matches Enemy\'s own', () => {
    /**
     * `archetypeOf` reimplements `Enemy.applyModifier` — scale the numbers,
     * override the flags, recompute the threat — because applyModifier needs a
     * live Enemy with a scene and a world and this needs a table. The header of
     * balance.mjs promises this check exists so the two cannot drift; it did
     * not. A silent drift here misreports the threat of every elite in the
     * report, which is the number the whole ramp table is built from.
     */
    let pairs = 0;
    for (const type of Object.keys(ARCHETYPES)) {
      const base = ARCHETYPES[type];
      if (base.training) continue;
      for (const key of Object.keys(MODIFIERS)) {
        const M = MODIFIERS[key];
        if (M.allow && !M.allow(base)) continue;
        const { A } = B.archetypeOf(`${type}|${key}`);
        // Compared against the MODIFIER'S OWN declaration rather than against a
        // call to applyModifier: that function mutates a live Enemy (it reads
        // `.boss`, retunes the brain, rebuilds the body) and cannot be run on a
        // plain archetype. The rule is the data, and the data is what both
        // implementations are supposed to be reading.
        for (const k of Object.keys(M.scale || {})) {
          if (typeof base[k] !== 'number') continue;
          assert(Math.abs(A[k] - base[k] * M.scale[k]) < 1e-9,
            `${type}|${key}: the harness scaled ${k} to ${A[k]}, the rule says ${base[k] * M.scale[k]}`);
        }
        for (const [k, v] of Object.entries(M.set || {})) {
          assert(A[k] === v, `${type}|${key}: the harness left ${k} = ${A[k]}, the modifier sets ${v}`);
        }
        assert(Math.abs(A.threat - modifierThreat(type, key)) < 1e-9,
          `${type}|${key}: threat ${A.threat} against the game's ${modifierThreat(type, key)}`);
        pairs++;
      }
    }
    assert(pairs > 20, `only ${pairs} type/modifier pairs were comparable — the check is not exercising much`);
    return `${pairs} elite variants agree with Enemy's own arithmetic`;
  });

  /* ══ 5. the blind spots, held honest ═══════════════════════════════════ */

  check('balance: no card claims an offensive axis the model cannot see', () => {
    /**
     * THE CADENCE TRAP. A card was added to answer a finding of this very
     * harness — offence buys nothing, because kill time is one pass for ten of
     * fifteen archetypes — and the harness could not see it, so it ranked the
     * fix at 0.000 and filed it under UNMODELLED alongside the Force powers.
     *
     * The rule is not "every card must be modelled": Force Lightning, Ataru's
     * double jump and Cleaving Throw genuinely cannot be, and calling those
     * worthless would be a libel rather than a finding. The rule is that a card
     * on the BLADE or BODY axis — the two axes this model is entirely about —
     * must move something the model reads, or it will be scored as worthless by
     * an instrument that simply is not looking.
     *
     * A card that legitimately cannot be seen declares itself below, once, by
     * name. That list is the honest statement of the gap.
     */
    const CANNOT_BE_MODELLED = new Set([
      'saberthrow',    // the thrown blade: no flight, no return, no second body
      'makashi',       // the riposte WINDOW, and nothing here parries
      'counterstroke', // same seam
      'sunder',        // the stroke carrying into a SECOND body; the model
                       // fights one engaged target at a time and has no notion
                       // of who is standing behind it
      'meditation',    // stamina regen: READ but never binding, because the
                       // guard in this model cannot be broken. See
                       // READ_BUT_NEVER_BINDING in balance.mjs.
    ]);
    const missed = [];
    for (const b of BOONS) {
      const axes = b.axes || [];
      if (!axes.includes('blade') && !axes.includes('body')) continue;
      if (CANNOT_BE_MODELLED.has(b.id)) continue;
      if (!B.boonChannels(b).length) missed.push(b.id);
    }
    assert(!missed.length,
      `${missed.join(', ')} — a blade/body card the model cannot see, so the ranking scores it as worthless. `
      + 'Either give the model a channel for it, or name it in CANNOT_BE_MODELLED with a reason.');
    // …and the escape hatch must not rot into a dumping ground: every name in
    // it has to still be a card, and still be unmodelled.
    for (const id of CANNOT_BE_MODELLED) {
      const b = BOONS.find(x => x.id === id);
      assert(b, `CANNOT_BE_MODELLED lists "${id}", which is not a card any more`);
      assert(!B.boonChannels(b).length,
        `"${id}" is excused as unmodellable but the model CAN see it now — take it off the list`);
    }
    const seen = BOONS.filter(b => B.boonChannels(b).length).length;
    return `${seen}/${BOONS.length} cards visible to the model; ${CANNOT_BE_MODELLED.size} declared blind spots`;
  });

  check('balance: every attunement moves a real number, and keeps moving it', () => {
    /**
     * Attunements are the endless-growth half of the run — permanent, uncapped,
     * offered on every set-piece forever — so an inert one is the worst card in
     * the game, and it would be invisible because there is no "you gained
     * nothing" feedback anywhere.
     *
     * PINNED ON THE PLAYER, NOT ON THE MODEL. The first draft of this check
     * asked whether `boonChannels` could see the effect, and Attunement of the
     * Force failed it — correctly, and uselessly: it moves `forceCost` and
     * `forceRegen`, which are real, and which this harness cannot read because
     * it has no Force powers at all. Demanding the model see everything would
     * make the honest answer "delete the Force axis". So the property is that
     * the PLAYER changes.
     *
     * And it must change on EVERY take, not just the first: these ignore the
     * rank scale on purpose (that is what makes them non-converging), so a
     * `set`-shaped effect would silently stop paying at rank 2 while still
     * being offered forever.
     */
    const stub = () => ({
      boonMods: defaultBoonMods(), maxHp: 100, hp: 100, maxStamina: 100, stamina: 100,
      maxForce: 100, force: 100, control: { deadzone: 0.24, sensitivity: 1 },
      saber: { bladeLength: 1.15, coreWidth: 1 },
    });
    const snap = (p) => JSON.stringify([p.boonMods, p.maxHp, p.maxForce, p.saber]);
    const rows = [];
    for (const a of ATTUNEMENTS) {
      assert(typeof a.apply === 'function', `${a.id} has no apply`);
      const p = stub();
      const s0 = snap(p);
      a.apply(p, 1);
      const s1 = snap(p);
      assert(s1 !== s0, `${a.id} changed nothing — a permanent uncapped choice that does nothing`);
      // the fifth take must still move it, or the tail of a long run is dead
      for (let i = 0; i < 3; i++) a.apply(p, 1);
      const s4 = snap(p);
      a.apply(p, 1);
      assert(snap(p) !== s4, `${a.id} stopped paying after four takes, but is still offered forever`);
      rows.push(a.attune);
    }
    // and each must own a DISTINCT axis, or two of the five are one choice
    assert(new Set(rows).size === ATTUNEMENTS.length,
      `attunement axes collide: ${rows.join(', ')}`);
    return `${ATTUNEMENTS.length} attunements on ${new Set(rows).size} axes, each still paying at rank 5`;
  });

  /* ══ 6. the instrument must survive being used ═════════════════════════ */

  check('balance: simulating runs does not grow the heap', () => {
    /**
     * THE HARNESS USED TO DIE. `workCapsule` built `new Saber(scene, …)` per
     * capsule and never disposed it — and a Saber ADDS ITSELF TO THE SCENE,
     * which here is a module-level THREE.Scene nothing ever clears. About
     * twenty undisposed blades per engagement, ~460 MB of ArrayBuffers per
     * sixty runs, and a full report reached `FATAL ERROR: Ineffective
     * mark-compacts near heap limit` at 8 GB, after the boon table had printed.
     *
     * Pinned on the SCENE rather than on `process.memoryUsage()`, because a
     * heap figure is noisy, GC-dependent and would make this flaky. The scene's
     * child count is exact, and it is the actual mechanism: bounded children
     * means nothing is being retained by the thing that was retaining it.
     *
     * TOLERANCE: the scene may grow by at most 2 objects across 12 runs.
     * `measureSwing` keeps one blade on purpose (it is cached and reused), so
     * the bound is "a small constant", not zero.
     */
    const scene = B.reportScene?.();
    assert(scene && typeof scene.children?.length === 'number',
      'balance.mjs does not expose its scene, so this cannot be measured');
    B.simulateRun({ difficulty: 'knight', level: 'dunes', seed: 1, sigma: 75 });
    const before = scene.children.length;
    for (let s = 0; s < 12; s++) {
      B.simulateRun({ difficulty: 'knight', level: 'dunes', seed: 400 + s, sigma: 75 });
    }
    const after = scene.children.length;
    assert(after - before <= 2,
      `twelve simulated runs left ${after - before} objects in the harness's scene `
      + `(${before} → ${after}) — that is the undisposed-Saber leak again`);
    return `scene held at ${after} objects across 12 runs`;
  });

  check('balance: a memo keyed on a moving number cannot grow without bound', async () => {
    // The companion to the leak above: `engagementFor` keys on cutPower, which
    // Fury moves every tick with the player's health, so the key space is
    // continuous. Unbounded caches are how a 16 MB/run leak hides behind a
    // plausible-looking optimisation.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../balance.mjs', import.meta.url), 'utf8');
    assert(/MEMO_MAX/.test(src), 'the memo bound is gone');
    for (const name of ['_engage', '_bolt']) {
      const i = src.indexOf(`const ${name} = new Map()`);
      assert(i > 0, `${name} is gone`);
      const body = src.slice(i, i + 1800);
      assert(/MEMO_MAX|memoGet/.test(body),
        `${name} is keyed on a value that moves during a run and has no bound`);
    }
    // and the keys must be quantised, or the bound is reached constantly
    assert(/const q = \(v\)/.test(src), 'the key quantiser is gone, so a continuous key fills the cache every run');
    return 'both continuous-keyed memos are quantised and bounded';
  });
}
