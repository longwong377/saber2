/**
 * THE SHIP IS THREE SPACES ON ONE HEIGHTFIELD, and the thing that has to be
 * checked is that they are three and that you can walk between them.
 *
 * The brief is "corridors, a hangar, a bridge, a boss at the end", and the
 * engine has exactly one heightfield: no floors, no overhangs, and a gait
 * solver, an enemy nav and a spawn picker that all assume so. So the three
 * spaces are strung along one spine at three LEVELS, and everything that could
 * go wrong with that is geometric:
 *
 *   the three levels could collapse into one, in which case the ship is a shed;
 *   a transition could be too steep, in which case the droids grind against an
 *     invisible wall and the level has a room nothing can enter;
 *   the corridor could be as wide as the hangar, in which case it is not a
 *     corridor — a corridor is a WIDTH, and it is the only thing that makes
 *     walking down one feel like being inside a ship.
 *
 * And the boss, which is the other half of the brief and is a different kind of
 * claim: it must be unreachable as ordinary fill on every level in the game,
 * reachable as a set-piece on this one, and priced so that the first boss wave
 * can actually afford it.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { WaveDirector, SET_PIECE, BOSS_SHARE, isHeavy } from '../../src/game/Waves.js';
import { TOUGHNESS } from '../../src/game/Combat.js';

let T = null;
const terrain = () => (T ||= new Terrain(new THREE.Scene(), LEVELS.warship.terrain, 0.5));

/** Walkable half-width of the deck at a station along the keel. */
function beamAt(z, step = 1) {
  const t = terrain();
  const h0 = t.height(0, z);
  for (let x = 0; x < 120; x += step) {
    // the shell climbs 44 m over 17: anything over 3 m up from the centreline
    // at the same station is hull, not deck
    if (t.height(x, z) - h0 > 3) return x;
    if (t.slopeAt(x, z) > 0.55) return x;
  }
  return 120;
}

export function run({ check, assert }) {
  check('warship: three spaces at three levels, and every ramp between them is walkable', () => {
    const t = terrain();
    /* The three stations the preset is authored around. Sampled on the
     * CENTRELINE, because that is the one line a player walking the ship end to
     * end actually travels. */
    /* The hangar is sampled at z = +18 and NOT at the origin, because the
     * origin is inside the launch trench: 1.6 m down, which is the deepest
     * point on the level and the worst possible stand-in for "the deck". */
    const hangar = t.height(0, 18);
    const bridge = t.height(4, -66);
    const spine = t.height(0, 60);

    assert(bridge - hangar > 4.5,
      `the bridge stands only ${(bridge - hangar).toFixed(2)} m over the hangar floor — that is a rug, not a deck`);
    assert(hangar - spine > 0.8,
      `the spine is only ${(hangar - spine).toFixed(2)} m below the hangar — the threshold does not read`);

    /* Every step of the walk, at 1 m, has to be climbable. The solvers read
     * this heightfield and will walk anything under about 0.55 of 1 − cos θ
     * (~57°); the level is authored to 12° on the bridge ramp and 18° on the
     * trench banks, so the bar here is deliberately well under the solver's. */
    let worst = 0, worstAt = 0;
    for (let z = -80; z <= 84; z += 1) {
      const s = t.slopeAt(4, z);
      if (s > worst) { worst = s; worstAt = z; }
    }
    assert(worst < 0.30,
      `the walk down the keel hits slope ${worst.toFixed(3)} at z=${worstAt} — steeper than a droid will climb cleanly`);
    return `hangar ${hangar.toFixed(1)} m, bridge +${(bridge - hangar).toFixed(1)}, spine ${(spine - hangar).toFixed(1)}; ` +
      `worst slope on the keel ${worst.toFixed(3)} (${(Math.acos(1 - worst) * 180 / Math.PI).toFixed(0)}°) at z=${worstAt}`;
  });

  check('warship: a corridor is a WIDTH — the spine is not the hangar', () => {
    const wide = beamAt(18);             // amidships, in the hangar, off the trench
    const narrow = beamAt(64);           // forward, in the spine
    assert(wide > 55, `the hangar is only ${wide.toFixed(0)} m to the hull — that is not a hangar`);
    assert(narrow < wide * 0.75,
      `the spine is ${narrow.toFixed(0)} m half-width against the hangar's ${wide.toFixed(0)} — it is the same room twice`);
    return `hangar half-beam ${wide.toFixed(0)} m, spine ${narrow.toFixed(0)} m (${(narrow / wide * 100).toFixed(0)}%)`;
  });

  check('warship: everything aboard is a machine', () => {
    /* "All droids." Asked of what the bodies are MADE OF rather than of a list
     * of names, because a list of names is a thing that stops being true when
     * an archetype is added. A droid is armour, plate or heavy chassis; a
     * clone trooper is plastoid and an acolyte and a beast are flesh, and
     * neither belongs on a Separatist flagship. */
    const metal = new Set([TOUGHNESS.droid, TOUGHNESS.armour, TOUGHNESS.heavy]);
    const bad = [];
    for (const type of new Set(LEVELS.warship.pool)) {
      const A = ARCHETYPES[type];
      assert(A, `the warship's pool names ${type}, which is not an archetype`);
      if (!metal.has(A.toughness)) bad.push(`${type} (${A.label})`);
    }
    assert(!bad.length, `the warship's pool has flesh in it: ${bad.join(', ')}`);
    return `${new Set(LEVELS.warship.pool).size} archetypes, all of them metal`;
  });

  check('warship: the boss is a set-piece and can never arrive as fill', () => {
    const A = ARCHETYPES.bodyguard;
    assert(A, 'the warship has no boss registered');
    assert(A.boss === true, 'the warship boss is not flagged as a boss, so heavyLimit will not count it');
    assert(A.saber === true, 'the warship boss carries no blade, so it uses the beast brain and not the duel brain');
    assert(isHeavy('bodyguard'), 'the boss does not count against the heavy limit');

    /* IT IS NOT IN THE FILL, on any level and at any depth. `unlockedAt` is the
     * list the budget buys bodies out of; a boss in it would arrive in threes
     * on an ordinary wave. Asked of every level's own pool at every depth up to
     * 60, because the answer is allowed to depend on both. */
    const leaked = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L?.pool) continue;
      const d = new WaveDirector({ scene: null }, { pool: L.pool });
      for (let w = 1; w <= 60; w++) {
        if (d.unlockedAt(w).includes('bodyguard')) { leaked.push(`${key} @ ${w}`); break; }
      }
    }
    assert(!leaked.length, `the boss is buyable as fill on ${leaked.join(', ')}`);

    /* …and it IS reachable as a set-piece here, and nowhere else. */
    const rung = SET_PIECE.find((s) => s.type === 'bodyguard');
    assert(rung, 'the boss is on no set-piece rung, so nothing can ever spawn it');
    const carriers = LEVEL_ORDER.filter((k) => LEVELS[k]?.pool?.includes('bodyguard'));
    assert(carriers.length === 1 && carriers[0] === 'warship',
      `the boss is in the pool of ${carriers.length} levels: ${carriers.join(', ')}`);

    /* AND THE FIRST BOSS WAVE CAN AFFORD IT. `_setPiece` spends BOSS_SHARE of
     * the wave budget, and a rung the budget cannot reach is a rung that never
     * fires — which is exactly why the acklay is gated to wave 20. */
    const d = new WaveDirector({ scene: null }, { pool: LEVELS.warship.pool });
    const budget = d.budgetFor(rung.from);
    assert(A.threat <= budget * BOSS_SHARE,
      `the boss costs ${A.threat} against a wave-${rung.from} set-piece budget of ${(budget * BOSS_SHARE).toFixed(1)}`);

    /* IT COMES, AND IT COMES ALONE. `_setPiece` floors its spend at twice the
     * lightest rung and then, if the ladder had exactly one rung and bought
     * exactly one body, buys a second — so a boss that is the only rung a wave
     * can reach always arrives in a PAIR. Two of these is not an escalation of
     * one, and this is the assertion that says the rung is placed where the
     * ladder has company. Measured at `from: 5`, which is where this was first
     * written: 40 of 40 wave-5 set-pieces came out as two bodyguards. */
    let seen = 0, doubled = 0;
    for (let i = 0; i < 40; i++) {
      const dd = new WaveDirector({ scene: null }, { pool: LEVELS.warship.pool });
      dd.wave = rung.from;
      const out = dd._setPiece(rung.from, dd.budgetFor(rung.from), []);
      const n = out.filter((e) => e.startsWith('bodyguard')).length;
      if (n >= 1) seen++;
      if (n >= 2) doubled++;
    }
    assert(seen === 40, `the boss came out of only ${seen} of 40 wave-${rung.from} set-pieces`);
    assert(doubled === 0, `${doubled} of 40 wave-${rung.from} set-pieces fielded two bosses at once`);
    return `${A.label}: ${A.hp} hp, threat ${A.threat} against a wave-${rung.from} set-piece budget of ` +
      `${(budget * BOSS_SHARE).toFixed(1)}; in 1 pool, in no fill list, alone on 40/40 boss waves`;
  });
}
