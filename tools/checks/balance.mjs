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
import { LEVEL_ORDER } from '../../src/game/Levels.js';
import { lines } from './_source.mjs';

export async function run({ check, assert }) {
  const B = await import('../balance.mjs');
  const { DIFFICULTY, SPEED_GRADE } = await import('../../src/game/Combat.js');
  const { ARCHETYPES, MODIFIERS, modifierThreat } = await import('../../src/game/Enemy.js');
  const { defaultBoonMods } = await import('../../src/game/Player.js');
  const { WaveDirector, BOONS, ATTUNEMENTS, maxRank, rankScale, RANK_DIMINISH } =
    await import('../../src/game/Waves.js');

  /**
   * A player-shaped thing a card can be applied to, and the biggest fractional
   * move any card made to it.
   *
   * Deliberately a stub rather than a real Player: the question is what the
   * CARD does, and a real Player drags in a scene, a saber and a rig whose own
   * defaults would have to be held constant anyway. `biggestMove` reads every
   * numeric field back against a pristine copy and returns the largest relative
   * change, which is how one function can measure thirty cards that each move
   * something different.
   */
  const stubPlayer = () => ({
    boonMods: defaultBoonMods(), maxHp: 100, hp: 100, maxStamina: 100, stamina: 100,
    maxForce: 100, force: 100, control: { deadzone: 0.24, sensitivity: 1 },
    saber: { bladeLength: 1.15, coreWidth: 1 },
  });
  const _pristine = stubPlayer();
  const biggestMove = (p) => {
    let best = 0;
    const walk = (a2, b2) => {
      for (const k of Object.keys(b2)) {
        if (typeof b2[k] === 'number' && typeof a2[k] === 'number') {
          if (a2[k]) best = Math.max(best, Math.abs(b2[k] / a2[k] - 1));
          else if (b2[k]) best = Math.max(best, Math.abs(b2[k]));
        } else if (b2[k] && typeof b2[k] === 'object' && a2[k]) walk(a2[k], b2[k]);
      }
    };
    walk(_pristine, p);
    return best;
  };

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

  check('balance: every column of a difficulty tier has a reader', async () => {
    /**
     * "A tier is a promise about the fight. A column of that promise with no
     * reader is the same lie as a checkbox with no onChange." That is
     * balance.mjs's own report text, and it was printing TWO names —
     * `deflectWindow` and `chamberWindow`, both four hand-authored numbers that
     * differed across the tiers on paper and were identical in the code.
     *
     * `deflectWindow` now scales the parry window (see parryScale).
     * `chamberWindow` was deleted rather than wired: Duel.js already owns that
     * name, per FORM, with different semantics, so the DIFFICULTY copy was a
     * vestigial duplicate that could only ever have meant something else.
     *
     * Deleting a dead column and wiring one are equally honest; what is not
     * honest is printing it in a difficulty table and reading it nowhere.
     */
    const { readFile, readdir } = await import('node:fs/promises');
    const dir = new URL('../../src/', import.meta.url);
    let src = '';
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
        if (e.isDirectory()) await walk(u);
        else if (e.name.endsWith('.js')) src += await readFile(u, 'utf8');
      }
    };
    await walk(dir);
    // The declaration itself is not a reader, so count occurrences past the
    // four table rows.
    const dead = [];
    for (const col of Object.keys(DIFFICULTY.knight)) {
      if (col === 'name' || col === 'blurb') continue;
      const uses = (src.match(new RegExp(`\\b${col}\\b`, 'g')) || []).length;
      // 4 rows of the table + the doc comment mentions; a real reader pushes it
      // clear of that. Checked as "appears somewhere that is not the table",
      // which is what a reader means.
      const outsideTable = new RegExp(`(\\.|\\?\\.)${col}\\b|\\[['"\`]${col}['"\`]\\]`).test(src);
      if (!outsideTable) dead.push(`${col} (${uses} mentions, none of them a read)`);
    }
    assert(!dead.length,
      `difficulty columns with no reader anywhere in src/: ${dead.join(', ')}. `
      + 'Wire it or delete it — a tier that differs on paper and not in the code is a lie.');
    return `${Object.keys(DIFFICULTY.knight).length - 2} columns, all read`;
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

  check('balance: a rank is a return, and a diminishing one', () => {
    /**
     * The property RANKS EXIST FOR, and nothing had ever measured it — the
     * harness dropped the rank on the floor (`boon.apply(p)` with no second
     * argument, so every rank applied at full strength) and its draw mirror
     * removed a card from the pool after one take, so it could not have taken
     * one twice even if it had wanted to.
     *
     * Two halves, and they pull in opposite directions on purpose:
     *
     *   MORE IS MORE. Rank k must beat rank k-1 on the stat. A card whose
     *     second copy is worth nothing is a dead card in every draft after the
     *     first, and the draft would go on offering it.
     *   AND LESS THAN LINEAR. The excess over baseline must follow the
     *     geometric series `1 + d + d² + …` — that convergence is what BOUNDS a
     *     build, and it is the whole reason attunements had to exist separately.
     *
     * Measured on the STAT rather than on run depth, because depth is a
     * non-linear function of a stat: thirty more health is worth more than
     * thirty when it carries you into a wave you would not otherwise have seen,
     * so a card can diminish perfectly and still look superlinear in depth.
     * Communion does exactly that — 3.34x at rank 3 against a geometric 1.96x —
     * and asserting on the depth column would be asserting the wrong thing
     * about the right property. On the stat there is no noise at all.
     */
    const ranked = BOONS.filter((b) => maxRank(b) > 1);
    assert(ranked.length >= 15, `only ${ranked.length} ranked cards — the ladder is not the spine`);
    const rows = [];
    let checked = 0;
    for (const boon of ranked) {
      const cap = maxRank(boon);
      const excess = [];
      for (let k = 1; k <= cap; k++) {
        const p = stubPlayer();
        for (let i = 1; i <= k; i++) boon.apply(p, rankScale(i));
        excess.push(biggestMove(p));
      }
      if (!excess[0]) continue;              // nothing the stub can see; boonReport reports those
      checked++;
      const norm = excess.map((v) => v / excess[0]);
      for (let k = 1; k < norm.length; k++) {
        assert(norm[k] > norm[k - 1] + 1e-9,
          `${boon.id} rank ${k + 1} is worth ${norm[k].toFixed(3)} against rank ${k}'s `
          + `${norm[k - 1].toFixed(3)} — a second copy that pays nothing is a dead draft slot`);
      }
      const geo = norm.map((_, i) => {
        let t = 0;
        for (let j = 0; j <= i; j++) t += Math.pow(RANK_DIMINISH, j);
        return t;
      });
      /* ON THE SERIES, OR UNDER IT, OR A WHOLE COUNT — and the third case is
       * recognised STRUCTURALLY rather than by name, because a list of allowed
       * exceptions is a list somebody adds to.
       *
       * `grow` now returns the increment that lands rank k exactly on
       * `1 + a·S_k`, so every multiplicative card sits on the series to within
       * floating point. Two do not, and both are deliberate:
       *
       *   a WHOLE COUNT — Second Wind is a number of second chances and its own
       *     comment says 0.6 of one is not a thing, so it ignores the scale and
       *     grows linearly. Allowed only up to stack 2, because linear growth
       *     with a high cap is exactly the runaway the ladder exists to stop.
       *   a HARD CAP — Steadfast clamps at 0.75 because two full ranks would be
       *     immunity to every heavy blow. It pays LESS than the series, which is
       *     always safe.
       *
       * What is never allowed is paying MORE than the series with a cap above
       * two, which is the runaway direction and is what both Makashi and
       * Shatterpoint did before `grow` was fixed — their second rank was worth
       * more than their first. */
      const last = norm.length - 1;
      const onSeries = Math.abs(norm[last] - geo[last]) < 0.02;
      const linear = norm.every((v, i) => Math.abs(v - (i + 1)) < 0.02);
      const under = norm[last] < geo[last] + 1e-6;
      assert(onSeries || under || (linear && cap <= 2),
        `${boon.id} at rank ${norm.length} is worth ${norm[last].toFixed(3)}x its first copy `
        + `against the geometric ${geo[last].toFixed(3)}x — it is off the ladder in the runaway `
        + 'direction, and it is not a whole-count card with a cap of two');
      // and no card, on any shape, may reach linear with room to keep going
      assert(norm[last] < norm.length - 1e-6 || cap <= 2,
        `${boon.id} grows linearly to rank ${norm.length} — the diminishment is not happening `
        + 'and one axis runs away');
      rows.push(`${boon.id} ${norm.map((v) => v.toFixed(2)).join('/')}`);
    }
    assert(checked >= 10, `only ${checked} ranked cards moved a stat this check can read`);
    return `${checked} ranked cards on the ${(1 / (1 - RANK_DIMINISH)).toFixed(2)}x series; `
      + rows.slice(0, 4).join(', ');
  });

  check('balance: an attunement does NOT converge, which is the whole of why it exists', () => {
    /**
     * The complement of the check above, and the pair is the design: a rank
     * converges so a build is bounded, an attunement does not so the reward
     * half of an endless mode never goes quiet.
     *
     * Stated as a ratio between the two rather than as an absolute, because an
     * absolute is a number somebody chose and this is a structural claim: take
     * twenty of each and the attunement must be worth MULTIPLES of what the
     * ranked card converged to. At ATTUNE_STEP 0.12 twenty steps is 9.65x
     * against a rank ladder's 2.50x ceiling.
     *
     * AND THE CORRECTION THIS CHECK CARRIES. The design comment in Waves.js
     * used to claim attunements "race the ramp" — it compared twenty
     * attunements, which is wave 100, against ramp figures measured over twenty
     * WAVES. They do not race it and were never going to: measured against raw
     * dps, wave 100 is 203x the pressure of wave 1 and twenty attunements are
     * 9.65x. Cards, ranks and skill carry the rest. What is asserted here is
     * the property they DO have.
     */
    const N = 20;
    for (const att of ATTUNEMENTS) {
      const p = stubPlayer();
      const steps = [];
      for (let i = 0; i < N; i++) { att.apply(p, 1); steps.push(biggestMove(p)); }
      assert(steps[0] > 0, `${att.id} moves nothing this check can read`);
      // strictly increasing, for ever — no ceiling, no plateau
      for (let i = 1; i < N; i++) {
        assert(steps[i] > steps[i - 1] + 1e-9,
          `${att.id} stopped growing at step ${i + 1} (${steps[i].toFixed(4)} against `
          + `${steps[i - 1].toFixed(4)}) — it is capped, and it is offered for ever`);
      }
      /* AND THE STEPS DO NOT SHRINK, which IS non-convergence and is the whole
       * distinction from a rank.
       *
       * A converging series has steps that fall away — that is what converging
       * means, and a rank ladder's fall by RANK_DIMINISH each time. An
       * attunement's must not: a multiplicative one grows its steps (1.12^k),
       * an additive one holds them level, and either is unbounded. Stated this
       * way rather than as "must reach some multiple of the rank ceiling",
       * which is a number somebody picked — the first cut of this check used
       * 2x the ceiling and failed Attunement of the Body at 4.60x, which is
       * +18 hp twenty times over: perfectly unbounded, and caught by an
       * arbitrary bar rather than by the property. */
      const first = steps[1] - steps[0];
      const lastStep = steps[N - 1] - steps[N - 2];
      assert(lastStep >= first - 1e-9,
        `${att.id}'s twentieth step is worth ${lastStep.toFixed(4)} against its second's `
        + `${first.toFixed(4)} — the steps are shrinking, so it converges like the ranks it `
        + 'was built to escape');
      const ceiling = 1 / (1 - RANK_DIMINISH);
      const grew = 1 + steps[N - 1];
      assert(grew > ceiling,
        `${att.id} over ${N} takes reaches ${grew.toFixed(2)}x, under a rank ladder's own `
        + `${ceiling.toFixed(2)}x ceiling — twenty permanent choices are worth less than one card`);
    }
    const p = stubPlayer();
    for (let i = 0; i < N; i++) ATTUNEMENTS[0].apply(p, 1);
    return `${N} steps of each axis: all strictly increasing, blade reaches `
      + `${(1 + biggestMove(p)).toFixed(2)}x against a rank ladder's `
      + `${(1 / (1 - RANK_DIMINISH)).toFixed(2)}x ceiling`;
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
    B.simulateRun({ difficulty: 'knight', level: LEVEL_ORDER[0], seed: 1, sigma: 75 });
    const before = scene.children.length;
    for (let s = 0; s < 12; s++) {
      B.simulateRun({ difficulty: 'knight', level: LEVEL_ORDER[0], seed: 400 + s, sigma: 75 });
    }
    const after = scene.children.length;
    assert(after - before <= 2,
      `twelve simulated runs left ${after - before} objects in the harness's scene `
      + `(${before} → ${after}) — that is the undisposed-Saber leak again`);
    return `scene held at ${after} objects across 12 runs`;
  });

  check('balance: a body that defends itself does not die as fast as one that cannot', async () => {
    /**
     * THE LARGEST SINGLE DEFECT THIS INSTRUMENT HAS HAD, and nothing could see
     * it because every number it produced was internally consistent.
     *
     * `engagementFor` worked the real capsules against the real toughness
     * tables with the real cut arithmetic — and stood every archetype PERFECTLY
     * STILL while it did. Measured before the fix, time to put one down at
     * stock cut power:
     *
     *     b1        28 hp    0.64 s   head (decap)
     *     sentinel 200 hp    0.64 s   hips (kill)
     *     stalker  420 hp    0.64 s   head (decap)
     *     beast    900 hp    0.64 s   head (decap)
     *     master   460 hp    0.64 s   hips (kill)
     *
     * The cut arithmetic is not wrong: a lightsaber does take a neck off in one
     * pass. What was missing is that a Jedi Master does not let you have its
     * neck. `measureDuel` now counts the share of a fight the real `DuelBrain`
     * spends in its `guard` phase — Soresu 87.9%, Makashi 48.9%, Djem So 40.2%,
     * Juyo 38.3%, Ataru 24.3% — and the player's cadence against a duellist is
     * only its openings.
     *
     * This check pins the ORDERING that was false, not the numbers: a body with
     * a blade in the way must cost more time than one without.
     */
    const { engagementFor, measureDuel } = B;
    const { FORM_KEYS } = await import('../../src/game/Duel.js');
    const mods = { cutPower: 1, bladeLength: 1.15, attackRate: 1, moveSpeed: 1 };
    const shares = FORM_KEYS.map((k) => ({ k, g: measureDuel('knight', k).guardShare }));
    for (const { k, g } of shares) {
      assert(g > 0.05 && g < 0.99,
        `${k} spends ${(g * 100).toFixed(0)}% of a fight guarding, which is not a fight`);
    }
    const defensive = shares.reduce((a, b) => (a.g > b.g ? a : b));
    const aggressive = shares.reduce((a, b) => (a.g < b.g ? a : b));
    assert(defensive.k === 'soresu',
      `the most defensive form measures as ${defensive.k}; Duel.js authors Soresu as the one that `
      + '"gives you nothing — it is waiting for you to swing first"');
    assert(aggressive.k === 'ataru',
      `the least defensive form measures as ${aggressive.k}; Duel.js authors Ataru as the flurry`);

    // …and the ordering that was false. A B1 has no blade; a Sentinel does.
    const bare = engagementFor('b1', mods, 0).tKill;
    const rows = [];
    for (const t of ['sentinel', 'guardian', 'master', 'acolyte']) {
      const A = ARCHETYPES[t];
      if (!A) continue;
      const g = measureDuel('knight', A.form || 'ataru').guardShare;
      const held = engagementFor(t, mods, g).tKill;
      assert(held > bare,
        `a ${t} (${A.hp} hp, a saber and ${(g * 100).toFixed(0)}% guard) goes down in ${held.toFixed(2)} s `
        + `against a 28 hp B1's ${bare.toFixed(2)} s — the model is still standing it still`);
      rows.push(`${t} ${held.toFixed(2)}s`);
    }
    const sen = engagementFor('sentinel', mods, measureDuel('knight', 'soresu').guardShare).tKill;
    const jed = engagementFor('jedi', mods, measureDuel('knight', 'ataru').guardShare).tKill;
    assert(sen > jed * 2,
      `a Soresu Sentinel (${sen.toFixed(2)} s) is not meaningfully harder to reach than an Ataru Jedi `
      + `(${jed.toFixed(2)} s) — the forms are not separating`);
    return `guard share ${shares.map((x) => `${x.k} ${(x.g * 100).toFixed(0)}%`).join(', ')}; `
      + `b1 ${bare.toFixed(2)}s vs ${rows.join(', ')}`;
  });

  check('balance: a body with NO blade defends itself too, and its mass is the form it has', async () => {
    /**
     * The check above fixed duellists and this is the half it left behind. With
     * the guard gated on `A.saber`, `engagementFor` still reported:
     *
     *     b1       28 hp    0.64 s   head (decap)
     *     stalker 420 hp    0.64 s   head (decap)
     *     beast   900 hp    0.64 s   head (decap)
     *     charger 1250 hp   0.64 s   head (decap)
     *     brute   2200 hp   1.28 s   tibia0
     *
     * — the player's "the large creatures all look the same" with a number
     * against it. `Enemy.guardFor` derives a guard from MASS for anything
     * without a blade and `engagementFor` models `_turnCut` itself.
     *
     * ORDERINGS, not numbers, for the reason this file's header gives. Three of
     * them, and each was false before:
     *   · a body over half a tonne costs strictly more than a battle droid;
     *   · the heavies are ordered by their guard, so the mass derivation
     *     actually reaches the answer instead of being decorative;
     *   · and it is bounded — nothing is unkillable, at any cut power.
     */
    const { engagementFor } = B;
    const { guardFor, TURNED_CUT } = await import('../../src/game/Enemy.js');
    const mods = { cutPower: 1, bladeLength: 1.15, attackRate: 1, moveSpeed: 1 };
    const bare = engagementFor('b1', mods, 0).tKill;
    const heavies = Object.entries(ARCHETYPES)
      .filter(([, A]) => !A.saber && !A.training && !A.inert && (A.mass ?? 0) >= 520)
      .map(([t, A]) => ({ t, A, g: guardFor(A), tKill: engagementFor(t, mods, 0).tKill }));
    assert(heavies.length >= 8, `only ${heavies.length} bodies over 520 kg to measure`);
    for (const h of heavies) {
      assert(h.tKill > bare,
        `a ${h.t} (${h.A.hp} hp, ${h.A.mass} kg) goes down in ${h.tKill.toFixed(2)} s against a `
        + `28 hp B1's ${bare.toFixed(2)} s — the model is still standing it still`);
      assert(isFinite(h.tKill), `${h.t} cannot be killed at all — the hide has become a wall`);
    }
    // The guard is what buys the time, so a body that turns more passes than
    // another of the same shape must not die faster. Compared within the beast
    // family only, because a machine's capsules are a different problem.
    const beasts = heavies.filter((h) => h.A.custom === 'beast').sort((a, b) => a.g - b.g);
    for (let i = 1; i < beasts.length; i++) {
      assert(beasts[i].tKill >= beasts[i - 1].tKill - 1e-9,
        `${beasts[i].t} turns ${beasts[i].g} passes and dies in ${beasts[i].tKill.toFixed(2)} s, `
        + `while ${beasts[i - 1].t} turns ${beasts[i - 1].g} and takes ${beasts[i - 1].tKill.toFixed(2)} s`);
    }
    // …and the ceiling the game itself imposes is respected: no engagement may
    // charge more turns than `1 / TURNED_CUT`, whatever the guard says.
    for (const h of heavies) {
      const e = engagementFor(h.t, mods, 0);
      assert((e.turns ?? 0) <= Math.ceil(1 / TURNED_CUT),
        `${h.t} is billed ${e.turns} turned passes against a ceiling of ${Math.ceil(1 / TURNED_CUT)}`);
    }
    return `b1 ${bare.toFixed(2)}s vs ` + heavies.map((h) => `${h.t} ${h.tKill.toFixed(2)}s(g${h.g})`).join(', ');
  });

  check('balance: a melee opener gets to attack — wave 1 is not free', async () => {
    /**
     * TWO DEFECTS MET HERE AND THE SECOND WAS INVISIBLE BEHIND THE FIRST.
     *
     * `armTime` charges a melee body the whole walk in from the spawn ring and
     * the travel phase is supposed to hold the player off until it arrives —
     * the note at that line says so, and says it was written after the identical
     * symptom on scoria. But `e.arm` is a COUNTDOWN the incoming loop
     * decrements every tick, and it was compared against a `phaseT` counting
     * UP, so the two met in the middle and the player began cutting at half the
     * arm time. Measured on the Colosseum, whose wave 1 is a single creature on
     * every seed: the Nexu's arm clock is 4.16 s, it died at 3.36 s, and wave 1
     * cost the player 0.0 hp across 24 seeds at all four tiers.
     *
     * A SIMULATED number in a file whose header forbids them, and deliberately:
     * the assertion is not a depth, it is that a wave which spawns a body with
     * a 54-damage claw is not free. Zero is a claim about the instrument, not
     * about the game, and it is the exact reading that hid this for a session.
     *
     * ── AND THE FIRST VERSION OF THIS CHECK FLAKED, WHICH IS WORTH THE SPACE ─
     *
     * It asserted a per-tier mean and that wave 1 cleared on EVERY seed, and it
     * failed 3 runs in 8 — on the clear clause, at Master. The cause is written
     * at the top of `tools/balance.mjs` in as many words: `Math.random` is
     * pinned around the Waves.js import so a standalone run is reproducible,
     * and *"under verify.mjs the module is already loaded and this does nothing
     * — which is why nothing in tools/checks/balance.mjs may depend on a
     * specific composition."* The Colosseum's wave-1 pool is 22/40 Nexu, 9/40
     * Reek, 6/40 Gundark and 3/40 battle droids, so which twelve compositions
     * twelve seeds draw moves between PROCESSES, and with it the mean, the
     * worst case and whether the modelled player survives the Reek.
     *
     * So the property is stated in a way the composer cannot move:
     *
     *   · WORST > 0 at every tier. That is the defect exactly — before the fix
     *     every seed at every tier cost 0.0, and it takes only one melee body
     *     landing one claw to falsify that. A pool with no melee body in
     *     twenty-four draws is not a thing this level composes.
     *   · a POOLED mean over all four tiers, against 1 hp — two orders of
     *     magnitude under what it measures, and averaged over 96 runs rather
     *     than 12 so a droid-heavy pool cannot carry it.
     *   · and the other half, so this cannot be satisfied by making wave 1 a
     *     wall: it still clears on at least three quarters of seeds. Measured
     *     24/24 on a quiet pool and 11/12 on the worst one observed.
     *
     * ── AND THE CLEAR CLAUSE FLAKED AGAIN, FOR THE REASON ABOVE ──────────────
     *
     * The paragraph two up gives the fix — state the property so the composer
     * cannot move it — and then the clear clause was left stated PER TIER while
     * only the mean was pooled. A per-tier rate over 24 draws from a pool that
     * changes between processes is exactly the movable thing that note warns
     * about. Measured five consecutive runs of this file after the creature
     * work landed, grandmaster: **21, 19, 18, 20 and one below the floor of 18**
     * — four passes and a fail, with the bound sitting inside the noise.
     *
     * So the clear clause is pooled over all 96 runs, for the same reason and
     * with the same words as the mean beside it: a tier whose pool drew badly
     * cannot carry it, and a wave-1 that is genuinely a wall still fails
     * because it would be a wall at every tier. Measured pooled across those
     * same five runs: 92, 90, 90, 91 of 96 against a floor of 72 — steady.
     *
     * The per-tier reading is kept and PRINTED rather than asserted, because it
     * is worth knowing: grandmaster clearing 18-21 of 24 is a real balance
     * signal that the Colosseum's opener got harder when the creatures gained
     * their phase-1 vocabulary, and the next person to tune that should see the
     * number rather than discover it as a flake.
     */
    const rows = [];
    let pooled = 0, runs = 0, clearedAll = 0;
    for (const difficulty of ['padawan', 'knight', 'master', 'grandmaster']) {
      let sum = 0, n = 0, worst = 0, cleared = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const r = B.simulateRun({ difficulty, level: 'colosseum', seed, maxWave: 1 });
        const w = r.waveLog[0];
        if (!w) continue;
        const cost = w.hpStart - w.hpEnd;
        sum += cost; n++; worst = Math.max(worst, cost); cleared += w.cleared >= 1 ? 1 : 0;
      }
      assert(n === 24, `only ${n} of 24 seeds produced a wave 1`);
      assert(worst > 0,
        `not one of ${n} seeds at ${difficulty} cost the player a single point — the Colosseum's `
        + 'opener is being killed before its own clock starts');
      clearedAll += cleared;
      pooled += sum; runs += n;
      rows.push(`${difficulty} ${(sum / n).toFixed(1)} hp (worst ${worst.toFixed(0)}, cleared ${cleared}/${n})`);
    }
    assert(pooled / runs > 1,
      `the Colosseum's wave-1 opener costs ${(pooled / runs).toFixed(2)} hp averaged over ${runs} runs`);
    assert(clearedAll >= runs * 0.75,
      `wave 1 cleared on only ${clearedAll} of ${runs} runs across all four tiers — the opener is a wall`);
    return `${(pooled / runs).toFixed(1)} hp pooled over ${runs} runs, cleared ${clearedAll}/${runs} — `
      + rows.join(', ');
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
      assert(src.includes(`const ${name} = new Map()`), `${name} is gone`);
      // The declaration and the lookups that follow it — a neighbourhood, not a
      // function, so it is counted in LINES rather than in characters.
      const body = lines(src, `const ${name} = new Map()`, 34);
      assert(/MEMO_MAX|memoGet/.test(body),
        `${name} is keyed on a value that moves during a run and has no bound`);
    }
    // and the keys must be quantised, or the bound is reached constantly
    assert(/const q = \(v\)/.test(src), 'the key quantiser is gone, so a continuous key fills the cache every run');
    return 'both continuous-keyed memos are quantised and bounded';
  });
}
