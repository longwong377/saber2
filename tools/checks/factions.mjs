/**
 * BATTLEFRONT BORZ — two armies on one field.
 *
 * ── the defect this file was written for ───────────────────────────────
 *
 * Composed through the shipped director on the shipped Geonosis pool, wave 3
 * read `5xb1 2xb2 2xtrooper` — five battle droids, two super battle droids and
 * two clone troopers, arriving together and walking at the player side by side,
 * on the field of the First Battle of Geonosis. Nineteen of the level's first
 * twenty waves mixed the two rosters, and across all ten levels 175 of 200 waves
 * did. `grep -in faction src/game/Waves.js` returned nothing: a level pool was a
 * flat weighted list with no notion of a side, and `CommandDirector.unlockedAt`
 * — which filters this same pool down to the army you are NOT leading — was the
 * only code in the game that had ever known there were two.
 *
 * ── what is checked, and why each clause exists ────────────────────────
 *
 * Every archetype has a faction, and it is the one the game already states.
 *   The faction table is authored (`src/game/Databank.js`) because "a B1 is
 *   Confederate" is a fact about the world and cannot be computed. What CAN go
 *   wrong with an authored table is drift, so it is pinned against the two
 *   places the game states a side for other reasons — `ARMIES[*].tiers`, which
 *   is what an army may buy at the muster, and `VEHICLE_SIDE`. A rung moved
 *   between ladders, or a body registered with no entry, fails here.
 *
 * A level that declares armies fields them one at a time.
 *   Measured by composing, not by reading the code — the same rule
 *   escalation.mjs holds itself to. A mixed wave anywhere in the sweep is a
 *   failure with the wave and seed named.
 *
 * A WAVE CANNOT STALL, and this is the clause the whole design turns on.
 *   Narrowing a wave to one side's roster can narrow it to NOTHING: the
 *   Republic's lightest body is a clone trooper and the ladder opens that at
 *   wave 2, so a Republic wave 1 composes empty, `pending` is 0, and the update
 *   loop's `!spawnQueue.length && alive === 0` fires on the frame it started.
 *   That is a wave that clears itself, which is worse than a hard hang because
 *   it looks like play. Swept over every declared-armies level, forty seeds and
 *   sixty waves.
 *
 * Command mode still gets both armies minus its own.
 *   `CommandDirector.unlockedAt` calls `super.unlockedAt` and removes the types
 *   it leads. If the base narrowed to one side first, half of a campaign's waves
 *   would come back empty — so the rotation stands down in that mode, and this
 *   asserts it rather than trusting the comment that says so.
 */

import * as Waves from '../../src/game/Waves.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { ARMIES, CommandDirector } from '../../src/game/Command.js';
import { VEHICLE_SIDE } from '../../src/game/Vehicles.js';
import { DATABANK, FACTIONS, ARMY_FACTIONS, factionOf } from '../../src/game/Databank.js';

/** A world the director will read a level off, and nothing else. */
const worldOn = (level) => ({ enemies: [], difficulty: null, takenBoons: new Set(), players: [], level });

/** Every level that says it has two armies on it. Derived, never listed. */
const twoArmyLevels = () => LEVEL_ORDER.filter((k) => (LEVELS[k].armies || []).length >= 2);

function directorFor(key, seed = 1234, opts = {}) {
  const L = LEVELS[key];
  return new Waves.WaveDirector(worldOn(L), { mode: 'roguelite', pool: L.pool, seed, ...opts });
}

/** What one composed wave is made of, by faction. */
function sidesOf(d, w) {
  d.wave = w; d._compose();
  const by = new Map();
  for (const e of d.spawnQueue) {
    const f = factionOf(Waves.spawnType(e)) || '(none)';
    by.set(f, (by.get(f) || 0) + 1);
  }
  return { by, n: d.spawnQueue.length, queue: d.spawnQueue.slice() };
}

export async function run({ check, assert }) {

  /* ────────────────────────────────────────────────────────────────────
   * THE TABLE
   * ──────────────────────────────────────────────────────────────────── */

  check('factions: every body in the game fights for somebody', () => {
    /**
     * Both directions, because each fails in its own silence. An archetype with
     * no entry is a body the databank cannot draw a page for and the wave
     * director cannot place on a side — and `factionOf` deliberately returns
     * null rather than a plausible default, so the failure is here and not on a
     * battlefield. An entry with no archetype is a page for a body that was
     * deleted, which reads to a player as content they can never find.
     */
    const keys = Object.keys(ARCHETYPES);
    const missing = keys.filter((t) => !DATABANK[t]);
    assert(!missing.length,
      `${missing.join(', ')} are archetypes the game fields and the databank does not name`);
    const ghosts = Object.keys(DATABANK).filter((t) => !ARCHETYPES[t]);
    assert(!ghosts.length,
      `${ghosts.join(', ')} have databank entries and are not archetypes any more`);
    const wrongFaction = keys.filter((t) => !FACTIONS[DATABANK[t].faction]);
    assert(!wrongFaction.length,
      `${wrongFaction.map((t) => `${t}→${DATABANK[t].faction}`).join(', ')} name factions that do not exist`);
    const byFaction = {};
    for (const t of keys) byFaction[factionOf(t)] = (byFaction[factionOf(t)] || 0) + 1;
    return `${keys.length} archetypes, all placed: `
      + Object.entries(byFaction).map(([f, n]) => `${FACTIONS[f].short} ${n}`).join(', ');
  });

  check('factions: no army musters a body that fights for the other side', () => {
    /**
     * The table above is authored and these two are not: `ARMIES[*].tiers` is
     * the muster ladder Command sells from, and `VEHICLE_SIDE` is what
     * Vehicles.js says about its four machines. Both already carry a side, for
     * their own reasons, and both are maintained by other hands. If a rung moves
     * between ladders and the databank does not follow, a Republic commander
     * ends up buying B2s and the databank prints the wrong flag over its page —
     * so the disagreement is a failure here rather than a surprise on a field.
     */
    const wrong = [];
    for (const id of Object.keys(ARMIES)) {
      for (const rung of ARMIES[id].tiers) {
        const f = factionOf(rung.type);
        if (f !== id) wrong.push(`${rung.type} musters for ${id} and the databank says ${f}`);
      }
    }
    for (const [t, side] of Object.entries(VEHICLE_SIDE)) {
      const f = factionOf(t);
      if (f !== side) wrong.push(`${t} is VEHICLE_SIDE ${side} and the databank says ${f}`);
    }
    assert(!wrong.length, wrong.join('; '));
    const rungs = Object.values(ARMIES).reduce((n, a) => n + a.tiers.length, 0);
    return `${rungs} muster rungs across ${Object.keys(ARMIES).length} ladders and `
      + `${Object.keys(VEHICLE_SIDE).length} machines agree with the databank`;
  });

  check('factions: the two army ids are the same word in all three places', () => {
    /* Command's ARMIES, Vehicles' VEHICLE_SIDE and the databank's FACTIONS all
     * spell a side. If they ever stop spelling it the same way the check above
     * turns into a translation layer, which is where a mapping table would come
     * from and is exactly what this repository keeps deleting. */
    const fromCommand = Object.keys(ARMIES).sort();
    const fromDatabank = ARMY_FACTIONS.slice().sort();
    assert(fromCommand.join(',') === fromDatabank.join(','),
      `Command leads ${fromCommand.join('/')} and the databank knows ${fromDatabank.join('/')}`);
    const fromVehicles = [...new Set(Object.values(VEHICLE_SIDE))].sort();
    const stray = fromVehicles.filter((s) => !fromDatabank.includes(s));
    assert(!stray.length, `Vehicles.js names ${stray.join(', ')}, which is nobody's army`);
    return `both armies spelled ${fromDatabank.join(' / ')} in Command.js, Vehicles.js and Databank.js`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE LEVEL
   * ──────────────────────────────────────────────────────────────────── */

  check('factions: a level that names two armies can field both of them', () => {
    const levels = twoArmyLevels();
    assert(levels.length >= 1,
      'no level declares `armies` — the rotation in WaveDirector.sideFor is unreachable code');
    const lines = [];
    for (const key of levels) {
      const L = LEVELS[key];
      const ids = L.armies;
      const bad = ids.filter((id) => !FACTIONS[id]?.army);
      assert(!bad.length, `${key} names ${bad.join(', ')} as an army and they are not one`);
      assert(new Set(ids).size === ids.length, `${key} names the same army twice`);
      /**
       * EVERY POOL ENTRY BELONGS TO ONE OF THE DECLARED ARMIES.
       *
       * This is `roster.mjs`'s unreachable-content rule one layer down. On a
       * level with armies a wave is one side's push, so a body whose faction is
       * neither side is a body no wave can ever field — content that shipped and
       * cannot be met, hiding behind a pool entry that looks like it works.
       */
      const orphan = [...new Set(L.pool)].filter((t) => !ids.includes(factionOf(t)));
      assert(!orphan.length,
        `${key} declares ${ids.join(' and ')} and its pool also names `
        + `${orphan.map((t) => `${t} (${factionOf(t) || 'no faction'})`).join(', ')} — `
        + 'bodies no wave on this level can field');
      /* …and both sides have to be real. One army plus two strays is not two
       * armies, it is a horde with a typo in it. */
      for (const id of ids) {
        const mine = [...new Set(L.pool)].filter((t) => factionOf(t) === id);
        assert(mine.length >= 3,
          `${key} gives ${id} only ${mine.length} archetype(s) (${mine.join(', ')}) — `
          + 'too thin to carry a wave on its own');
        lines.push(`${key}/${id} ${mine.length}`);
      }
    }
    return `${levels.length} two-army level(s): ${lines.join(', ')} archetypes a side`;
  });

  check('factions: a wave on a two-army level is one army, and the sides trade', () => {
    /**
     * Measured by COMPOSING, never by reading `unlockedAt` — the queue is the
     * wave the player fights and everything between the roster and the queue
     * (the set-piece, the head, the promotion pass, the surplus loop) is another
     * chance for the other army to get in. The set-piece is the one that
     * actually did: `_setPiece` filters the ladder by `this.pool`, so a Republic
     * push was crowned by an OG-9 spider droid until it was taught the side.
     */
    const report = [];
    for (const key of twoArmyLevels()) {
      let mixed = 0, waves = 0;
      const pushes = {};
      const firstBad = [];
      for (let s = 0; s < 12; s++) {
        const d = directorFor(key, 400 + s);
        for (let w = 1; w <= 40; w++) {
          const { by } = sidesOf(d, w);
          waves++;
          const armies = [...by.keys()].filter((f) => FACTIONS[f]?.army);
          if (armies.length > 1) {
            mixed++;
            if (firstBad.length < 3) {
              firstBad.push(`seed ${400 + s} w${w}: `
                + [...by].map(([f, n]) => `${n}x${f}`).join(' + '));
            }
          }
          const side = d.sideFor(w);
          if (side) pushes[side] = (pushes[side] || 0) + 1;
        }
      }
      assert(!mixed, `${key} fielded both armies in ${mixed} of ${waves} waves — ${firstBad.join('; ')}`);
      /**
       * AND BOTH ARMIES ARE ACTUALLY MET. A rotation that quietly settled on one
       * side would pass the clause above perfectly — every wave one army — while
       * making the other's whole ladder unreachable, which is the same defect the
       * mixing was, wearing the opposite coat. Neither side may drop under a
       * third of the pushes.
       */
      const total = Object.values(pushes).reduce((a, b) => a + b, 0);
      for (const id of LEVELS[key].armies) {
        const share = (pushes[id] || 0) / total;
        assert(share > 0.33,
          `${key} gave ${id} ${(share * 100).toFixed(1)}% of ${total} pushes — the other army is unreachable`);
      }
      report.push(`${key} 0/${waves} mixed, `
        + LEVELS[key].armies.map((id) => `${id} ${((pushes[id] || 0) / total * 100).toFixed(0)}%`).join(' / '));
    }
    return report.join(' · ');
  });

  check('factions: no wave can compose empty — a side that has nothing does not get the push', () => {
    /**
     * THE STALL. `update()` ends a wave on
     * `!spawnQueue.length && !arrivals.pending && alive === 0`, so a wave that
     * composes to zero bodies is not a hang — it is a wave that clears itself,
     * pays its draft and moves on, which the player reads as the game skipping.
     *
     * The narrowing makes that reachable for the first time: at wave 1 the
     * Republic's whole roster is shut (the clone trooper opens at 2, the heavy
     * at 3), so a Republic wave 1 would have nothing to buy. `sideFor` is
     * required to hand that wave to the other army instead, and this is the
     * sweep that says it does — forty seeds, sixty waves, every declared level.
     */
    const out = [];
    for (const key of twoArmyLevels()) {
      let waves = 0, empty = 0, min = Infinity, at = '';
      const firstEmpty = [];
      for (let s = 0; s < 40; s++) {
        const d = directorFor(key, 700 + s);
        for (let w = 1; w <= 60; w++) {
          const { n } = sidesOf(d, w);
          waves++;
          if (!n) { empty++; if (firstEmpty.length < 3) firstEmpty.push(`seed ${700 + s} w${w}`); }
          if (n < min) { min = n; at = `seed ${700 + s} w${w}`; }
        }
      }
      assert(!empty, `${key} composed ${empty} empty waves of ${waves} — ${firstEmpty.join(', ')}`);
      out.push(`${key}: ${waves} waves, 0 empty, smallest ${min} bodies at ${at}`);
    }
    /* …and the direct statement of the rule the sweep is evidence for: at the
     * one depth where a side genuinely has nothing, the push goes to the other
     * one rather than to nobody. */
    for (const key of twoArmyLevels()) {
      const d = directorFor(key, 1);
      for (let w = 1; w <= 3; w++) {
        const side = d.sideFor(w);
        assert(side, `${key} wave ${w} belongs to no army at all`);
        assert(d.unlockedAt(w).length > 0, `${key} wave ${w} opened an empty roster`);
      }
    }
    return out.join(' · ');
  });

  check('factions: every body a two-army level can field is still reachable on it', () => {
    /**
     * `roster.mjs` asks whether a pool names a body. That question stopped being
     * sufficient the moment a wave stopped drawing from the whole pool: a body
     * can be in the pool, on the right side, and still never appear because the
     * side it belongs to never comes up at the depth that unlocks it. Composed
     * rather than reasoned, because the composer is the only honest answer to
     * "what does a player actually meet".
     */
    const out = [];
    for (const key of twoArmyLevels()) {
      const want = new Set([...new Set(LEVELS[key].pool)]
        .filter((t) => !ARCHETYPES[t].setPieceOnly));
      const met = new Set();
      for (let s = 0; s < 20; s++) {
        const d = directorFor(key, 900 + s);
        for (let w = 1; w <= 60; w++) {
          for (const e of sidesOf(d, w).queue) met.add(Waves.spawnType(e));
        }
      }
      const never = [...want].filter((t) => !met.has(t));
      assert(!never.length,
        `${key} never fielded ${never.join(', ')} in 1200 waves, though its pool names them`);
      out.push(`${key}: ${met.size} of ${want.size} poolable bodies met`);
    }
    return out.join(' · ');
  });

  check('factions: the rotation stands down for the director that leads an army', () => {
    /**
     * `CommandDirector.unlockedAt` is `super.unlockedAt(wave).filter(t => !mine)`
     * — the level's two armies minus the one you are leading. If the base
     * narrowed to one side first, the waves where the rotation picked YOUR side
     * would come back empty after the filter, and a campaign would alternate
     * between a wave and nothing.
     *
     * ── AND IT IS ASSERTED AGAINST THE REAL CLASS, IN ALL THREE MODES ──────
     *
     * It used to build a BASE `WaveDirector` with `mode: 'command'` and say so:
     * "so it holds whether or not a CommandDirector can be built without a
     * World". It can — the constructor reads `world?.settings` through an
     * optional chain and the stub above is enough — and that hedge cost more
     * than it saved. The rule lived in the base as `this.mode === 'command'`,
     * a test on ONE of the three mode strings this subclass runs under; the
     * subclass hard-coded `mode: 'command'` to keep it true, and every skirmish
     * therefore reported itself as Command to everything that reads a mode
     * (the codex prints `MODES[director.mode].name` over the purse table). The
     * rule is an override on the subclass now, and this asserts it where the
     * game builds it: `World.loadLevel` builds a CommandDirector for `command`,
     * `skirmish` AND `campaign`, so all three are checked, and the mode string
     * each one reports is checked with them — that is the half that used to be
     * unmeasurable, because the fixture pinned it by hand.
     */
    /* THE BOTH-LADDERS PROPERTY IS `super`'s, AND IT IS TESTED AS `super`'s.
     *
     * The old fixture read it off a base director standing in for this one,
     * which hid the shape of the thing: `CommandDirector.unlockedAt` DELIBERATELY
     * returns one army — the one you are not leading — so asserting "both
     * armies open" against the subclass fails on its own contract (measured:
     * geonosis w2 sees separatist alone, correctly). What the filter depends on
     * is that the call it wraps opened both. So that clause is aimed at the
     * inherited method, called on the real instance, and the subclass is held
     * to its own contract instead: never empty, never your own side. */
    const superUnlocked = Waves.WaveDirector.prototype.unlockedAt;
    for (const key of twoArmyLevels()) {
      const L = LEVELS[key];
      const plain = new Waves.WaveDirector(worldOn(L), { mode: 'roguelite', pool: L.pool, seed: 1234 });
      for (const mode of ['command', 'skirmish', 'campaign']) {
        const cmd = new CommandDirector(
          { ...worldOn(L), settings: { mode, level: key, order: 'jedi' } },
          { pool: L.pool, seed: 1234 });
        assert(cmd.mode === mode,
          `a ${mode} reports itself as '${cmd.mode}' — everything that reads a director's mode, the `
          + 'codex included, is being told the player picked a different game');
        for (let w = 1; w <= 40; w++) {
          assert(cmd.sideFor(w) === null, `${key} w${w}: the rotation ran in ${mode}`);
          const both = superUnlocked.call(cmd, w);
          const opened = L.armies.filter((id) => both.some((t) => factionOf(t) === id));
          const shouldHave = L.armies.filter((id) =>
            plain._openTypes(w).some((t) => factionOf(t) === id));
          assert(opened.length === shouldHave.length,
            `${key} w${w}: ${mode} saw ${opened.join('/')} where the pool opens ${shouldHave.join('/')}`);
          /* …and then the filter, which is the thing that would go silent. */
          const mine = cmd.unlockedAt(w);
          assert(mine.length > 0,
            `${key} w${w}: ${mode} opened nothing at all — this is the empty wave the rotation `
            + 'standing down exists to prevent');
          const sides = new Set(mine.map(factionOf));
          assert(sides.size <= L.armies.length, `${key} w${w}: ${mode} saw a faction the level does not name`);
        }
      }
    }
    return `command, skirmish and campaign each report their own mode on ${twoArmyLevels().join(', ')}, `
      + 'stand the rotation down, and never open empty';
  });

  check('factions: a level with one army composes exactly what it always did', () => {
    /**
     * The nine levels that declare nothing must be byte-identical, and this is
     * the clause that says so rather than the comment claiming it. Composed
     * twice with the same seed, once against a director that can see the level
     * and once against one that cannot — the same queue either way is proof the
     * rotation never touched them.
     */
    const single = LEVEL_ORDER.filter((k) => !(LEVELS[k].armies || []).length);
    assert(single.length >= 1, 'every level declares armies — nothing is left to compare against');
    const moved = [];
    for (const key of single) {
      const L = LEVELS[key];
      const withLevel = new Waves.WaveDirector(worldOn(L), { mode: 'roguelite', pool: L.pool, seed: 55 });
      const without = new Waves.WaveDirector(worldOn(null), { mode: 'roguelite', pool: L.pool, seed: 55 });
      for (let w = 1; w <= 40; w++) {
        /* THE STREAM IS RE-SEEDED BEFORE EACH SIDE OF THE COMPARISON, and the
         * first cut of this check did not do it: `rng` is module-level and
         * shared, so composing A then B handed B the stream A had just advanced
         * and 352 of 360 waves "moved". Nothing had moved. That is HANDOFF §2.5
         * exactly — a probe whose second condition reuses the first's state —
         * and it manufactured a defect in the direction the check was looking. */
        Waves.seedWaves(55 + w, 0);
        withLevel.wave = w; withLevel._compose();
        Waves.seedWaves(55 + w, 0);
        without.wave = w; without._compose();
        if (withLevel.spawnQueue.join(',') !== without.spawnQueue.join(',')) moved.push(`${key} w${w}`);
      }
    }
    assert(!moved.length, `${moved.length} waves moved on levels with no armies: ${moved.slice(0, 4).join(', ')}`);
    return `${single.length} single-army levels compose identically: ${single.join(', ')}`;
  });

  check('factions: the levels that mix two armies and do not say so are counted', () => {
    /**
     * NOT A BOUND — A CENSUS, and it is here because the number is the finding.
     *
     * Nine of the ten shipped levels put Republic and Confederate bodies in one
     * wave, and only one of them declares two armies. The other eight are that
     * way on purpose as far as their own notes go — a horde, a boarding party, a
     * garrison with one traitor in it — and turning the rotation on for any of
     * them is a design decision with its own measurements to make, not a bug to
     * be fixed by a check.
     *
     * So this asserts only the two things that would be silently wrong: that a
     * level declaring armies is never in the mixed list, and that the census
     * still runs. The count itself goes in the summary line, where the next
     * person will read it.
     */
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const armies = new Set([...new Set(L.pool)].map(factionOf).filter((f) => FACTIONS[f]?.army));
      if (armies.size < 2) continue;
      const d = directorFor(key, 1234);
      let mixed = 0;
      for (let w = 1; w <= 20; w++) {
        const { by } = sidesOf(d, w);
        if ([...by.keys()].filter((f) => FACTIONS[f]?.army).length > 1) mixed++;
      }
      assert(!(mixed && (L.armies || []).length >= 2),
        `${key} declares two armies and still mixed ${mixed} of 20 waves`);
      if (mixed) rows.push(`${key} ${mixed}/20`);
    }
    return rows.length
      ? `${rows.length} level(s) still field both armies in one wave and declare no split: ${rows.join(', ')}`
      : 'no level fields both armies in one wave';
  });
}
