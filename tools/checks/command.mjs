/**
 * BATTLEFRONT BORZ — Command: an army with names on it.
 *
 * Player note #21 is the biggest single thing on their list, and almost every
 * clause of it is a property rather than a feature — which is what makes it
 * checkable. "your troops when dead will permanently die unless they are
 * replaced" is a property. "every ally has a unique name you can see" is a
 * property. "the specific troopers that survive get more experience as they live
 * and get stronger themselves too" is three. And note #29 — "your allies should
 * be as real as the enemies like NO DIFFERENCE … but obviously the force
 * blaster-stop thing shouldn't affect your allies' blasters" — is a pair of
 * properties that pull against each other, which is exactly the pair a checker
 * should be pointed at.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED HERE ──────────────────────────────
 *
 * Anything about how the mode FEELS. There is no check that a formation looks
 * good, that a promotion is satisfying or that losing a name hurts. Those are
 * the things HANDOFF §7 says a person has to play the game to find out, and a
 * number invented to stand for one of them would be a number about the harness.
 *
 * What IS asserted is the set of sentences that can silently become false: a
 * name that is not unique, a rank that only exists in a list, a formation whose
 * leash does nothing, an ally a Force push cannot reach, a wave that cannot end.
 */

import * as THREE from 'three';
import * as Cmd from '../../src/game/Command.js';
import * as Waves from '../../src/game/Waves.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TEAM, canHarm } from '../../src/game/Player.js';
import { CORPSE_BUDGET, Corpses } from '../../src/game/Corpses.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── fixtures ────────────────────────────────────────────────────────── */

const flatGround = (opts = {}) => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, surfaceAt: () => 'sand', crater() {}, flush() {},
  slopeAt: () => 0,
  inBounds: (x, z) => Math.hypot(x, z) < (opts.bound ?? 200),
});

/**
 * A world with the fields the command director actually reads.
 *
 * Bodies are stubs rather than real `Enemy`s on purpose: what this file is about
 * is the ROSTER, the formations and the rules, and a real Enemy drags in a rig,
 * a ragdoll, cloth and a physics body for every one of twenty-four troops. The
 * stub carries exactly the fields the director touches — which is also a useful
 * assertion in itself, because a director that quietly started reading a
 * fifteenth field would fail here rather than in a browser.
 */
function cmdWorld(opts = {}) {
  const w = {
    scene: new THREE.Scene(),
    terrain: flatGround(opts),
    settings: opts.settings || {},
    difficulty: null, hpScale: 1, dmgScale: 1,
    players: [], enemies: [], statics: [], props: [], doors: [],
    level: LEVELS.geonosis,
    run: null, takenBoons: new Set(),
    notes: [],
    notify(a, b) { this.notes.push([a, b]); },
    report() {},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type];
      const e = {
        id: 'e' + (w._n = (w._n | 0) + 1), type, A, world: w, team: 1,
        position: pos.clone ? pos.clone() : V(pos.x, pos.y, pos.z),
        velocity: new THREE.Vector3(), dead: false, hp: A.hp, maxHp: A.hp,
        speed: A.speed, attackDamage: A.damage ?? 0, mod: null, rig: null,
        group: null, wish: null, toTarget: null, facing: 0,
        _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0,
        _prevPos: new THREE.Vector3(),
        burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
        _move(dt) { this._moved = (this._moved | 0) + 1; },
        damage(n) { this.hp -= n; this._took = (this._took || 0) + n; return this.hp <= 0; },
        _syncBody() {},
      };
      w.enemies.push(e);
      return e;
    },
  };
  return w;
}

const dirFor = (opts = {}) => {
  const w = opts.world || cmdWorld(opts);
  const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool, army: opts.army });
  return { w, d };
};

export function run({ check, assert }) {
  /* ══════════════════════════════════════════════════════════════════ */
  /*  The mode and its ground                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: the mode owns its ground, and says so where the menu reads it', () => {
    const M = Waves.MODES.command;
    assert(M, 'there is no `command` mode');
    assert(typeof M.name === 'string' && M.name.length, 'the mode has no name');
    /* The whole point of the field. `Menu._syncTheatre` greys the Theatre column
     * when a mode declares one and prints THIS STRING beside it; without it all
     * eight level cards stay live, write `settings.level`, save it, and the
     * write leaks into the next run of another mode. That is not hypothetical —
     * it is exactly what the Descent did, and menu.mjs's own note names Command
     * as the mode that would walk back into it. */
    assert(typeof M.fixedTheatre === 'string' && M.fixedTheatre.length > 20,
      'command does not declare fixedTheatre, so the Theatre column stays live and writes');
    assert(LEVELS.geonosis && LEVEL_ORDER.includes('geonosis'),
      'the mode owns a ground the roster does not have');
    assert(TERRAIN_PRESETS.geonosis, 'geonosis names a terrain preset that does not exist');
    return `${M.name} → ${LEVELS.geonosis.name}, theatre fixed`;
  });

  check('command: geonosis is FLAT where you fight and has something to see everywhere', () => {
    /**
     * THE ONE PROPERTY THE WHOLE MODE RESTS ON, as a number.
     *
     * Every other level in this game is a bowl, a cirque, a wash or a hall — a
     * shape that gives one Jedi somewhere to fall back to. A LINE OF TROOPS
     * CANNOT FORM IN A GULLY, and "circle around me" on a slope is not a circle.
     * So the fighting ground has to be as flat as the flattest ground the game
     * has and stay that way far enough out to array an army on.
     *
     * Measured against the arena's fighting floor, which is that flattest
     * ground, over the same inner disc.
     */
    const P = TERRAIN_PRESETS.geonosis, A = TERRAIN_PRESETS.arena;
    const fract = (v) => v - Math.floor(v);
    const measure = (Q, R) => {
      const half = Q.scale / 2;
      let lo = 1e9, hi = -1e9, n = 0, sum = 0;
      for (let k = 0; k < 24000; k++) {
        const x = (fract(k * 0.7548776662) * 2 - 1) * half * 0.98;
        const z = (fract(k * 0.5698402909) * 2 - 1) * half * 0.98;
        if (Math.hypot(x, z) > R) continue;
        const h = Q.height(x, z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        const gx = (Q.height(x + 1, z) - Q.height(x - 1, z)) / 2;
        const gz = (Q.height(x, z + 1) - Q.height(x, z - 1)) / 2;
        sum += Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; n++;
      }
      return { relief: hi - lo, slope: sum / n, n };
    };
    const g = measure(P, 60), a = measure(A, 60);
    assert(g.n > 400, `only ${g.n} samples landed inside the inner disc`);
    assert(g.slope < a.slope * 1.5,
      `geonosis' fighting floor averages ${g.slope.toFixed(2)}° against the arena's ${a.slope.toFixed(2)}° — `
      + 'it is not the open ground the mode needs');
    /* …and it HOLDS that out to 180 m, which the arena cannot: the arena's rim
     * is a 27 m wall at 60 m. That is the difference between a fighting floor
     * and a battlefield. */
    const wide = measure(P, 180), aWide = measure(A, 180);
    assert(wide.slope < aWide.slope,
      `at 180 m geonosis averages ${wide.slope.toFixed(2)}° and the arena ${aWide.slope.toFixed(2)}° — `
      + 'the open ground does not reach the range the mode fights at');
    /* And the level's own spawn ring has to be out where you can SEE them
     * coming, or "give an order before the contact" is not a thing you can do.
     * Everything else in the game spawns at 26-60 m; this is the one level where
     * that would make the mode impossible. */
    const [rmin, rmax] = LEVELS.geonosis.spawnRadius;
    assert(rmin >= 50, `geonosis spawns contacts at ${rmin} m — inside the range you could react at`);
    assert(rmax > 80, `geonosis' outer ring is ${rmax} m, which is not a sightline`);
    return `inner 60 m ${g.slope.toFixed(2)}° / ${g.relief.toFixed(2)} m (arena ${a.slope.toFixed(2)}°); `
      + `at 180 m ${wide.slope.toFixed(2)}° vs ${aWide.slope.toFixed(2)}°; ring ${rmin}-${rmax} m`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Both sides                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: both armies are playable and priced rung for rung', () => {
    /* "can either be a Sith leading droids or a Jedi leading clone troopers …
     * can also be played with friends, maybe even coop and also against each
     * other where they're a sith and you're a jedi and vice versa."
     *
     * A mirror match is only a match if the two ladders are the same ladder.
     * An asymmetry here would be a difficulty setting hiding inside a faction
     * choice — and it would be invisible, because nothing on screen prints a
     * threat number. */
    const rep = Cmd.ARMIES.republic, cis = Cmd.ARMIES.separatist;
    assert(rep && cis, 'there are not two armies');
    assert(rep.tiers.length === cis.tiers.length,
      `${rep.tiers.length} Republic rungs against ${cis.tiers.length} Separatist`);
    /**
     * PARITY IS ON THE LADDER, NOT ON THE RUNG — and the difference is the
     * finding this check produced on its first run.
     *
     * The first draft asserted `ta.threat === tb.threat` per rung and failed at
     * rung 1: a clone trooper is threat 2 and a B1 is threat 1. That is not a
     * bug in the ladder, it is the source material and it is the game's own
     * long-standing pricing — the Confederacy wins by numbers and the Republic
     * by quality, which is the whole distinction between the two armies. What
     * would have been a bug is either army getting a better EXCHANGE RATE, and
     * that is what the first draft actually caught: both ladders were priced by
     * hand and a clone was 1.5 threat per point against a B1's 1.0.
     *
     * So: the price is derived from the threat by one formula (`musterCost`),
     * the two ladders total the same threat and the same points, and no rung on
     * either side is better value than its opposite number. A hand-written price
     * beside the thing that decides what the price should be is the defect this
     * repository has now been bitten by nine times.
     */
    const rows = [];
    let ta = 0, tb = 0, ca = 0, cb = 0;
    for (let i = 0; i < rep.tiers.length; i++) {
      const r = rep.tiers[i], c = cis.tiers[i];
      const Ar = ARCHETYPES[r.type], Ac = ARCHETYPES[c.type];
      assert(Ar, `${r.type} is on the Republic ladder and is not an archetype`);
      assert(Ac, `${c.type} is on the Separatist ladder and is not an archetype`);
      assert(r.cost === Cmd.musterCost(r.type) && c.cost === Cmd.musterCost(c.type),
        `rung ${i + 1} carries a hand-written price beside the formula that decides it`);
      assert(r.at === c.at, `rung ${i + 1} unlocks in different areas for the two armies`);
      ta += Ar.threat; tb += Ac.threat; ca += r.cost; cb += c.cost;
      rows.push(`${r.type}(${Ar.threat}/${r.cost}) · ${c.type}(${Ac.threat}/${c.cost})`);
    }
    /**
     * TOTALS CLOSE, NOT IDENTICAL — and the loosening is a finding rather than
     * a concession.
     *
     * The first draft asserted `ta === tb` exactly, which held while both
     * ladders were infantry. It stopped holding the moment the armies got
     * MACHINES: an AT-TE is a six-legged 1500 hp gun platform at threat 17 and
     * an AAT is a 1050 hp hover tank at 13, and there is no honest way to make
     * those the same number. Requiring it would have forced one army's hardware
     * to be the other's with a repaint, which is the opposite of what a faction
     * choice is for.
     *
     * The property that actually protects a mirror match is the EXCHANGE RATE —
     * nobody may buy more fight per point than their opponent — and that is
     * asserted exactly, per rung, below. The totals are held to 12% as a
     * backstop against one ladder quietly growing an extra rung.
     */
    const skew = Math.abs(ta - tb) / Math.max(ta, tb);
    const cskew = Math.abs(ca - cb) / Math.max(ca, cb);
    assert(skew < 0.12,
      `the Republic ladder is worth ${ta} threat and the Confederacy's ${tb} — ${(skew * 100).toFixed(0)}% apart`);
    assert(cskew < 0.12,
      `the Republic ladder costs ${ca} points and the Confederacy's ${cb}`);
    // THE EXCHANGE RATE, per rung. 0.2 threat per point is the width of the
    // rounding in `musterCost`'s own `+1` per body at the light end.
    for (let i = 0; i < rep.tiers.length; i++) {
      const vr = ARCHETYPES[rep.tiers[i].type].threat / rep.tiers[i].cost;
      const vc = ARCHETYPES[cis.tiers[i].type].threat / cis.tiers[i].cost;
      assert(Math.abs(vr - vc) < 0.2,
        `rung ${i + 1}: ${rep.tiers[i].type} is ${vr.toFixed(2)} threat per point against `
        + `${cis.tiers[i].type}'s ${vc.toFixed(2)}`);
    }
    /* AND A LADDER THAT REACHES A MACHINE. The back half of a campaign is what
     * the muster points are for; a top rung that is still infantry means the
     * five areas are the same shopping list five times. */
    const top = rep.tiers[rep.tiers.length - 1];
    assert(ARCHETYPES[top.type].big, `the top of the Republic ladder is ${top.type}, which is not a machine`);
    assert(ARCHETYPES[cis.tiers[cis.tiers.length - 1].type].big,
      'the top of the Confederacy ladder is not a machine');
    /* …and it has to be AFFORDABLE by the end. A rung nobody can ever reach is
     * a rung that does not exist — measured against the whole campaign's
     * payout, since a machine is what you save for. */
    const purse = Cmd.AREAS.reduce((n, a) => n + a.muster, 0);
    assert(top.cost < purse * 0.6,
      `the top rung costs ${top.cost} against a whole campaign's ${purse} points`);
    // …and the ladder actually CLIMBS. A "tier ladder" whose rungs are all the
    // same weight is a shopping list.
    for (let i = 1; i < rep.tiers.length; i++) {
      assert(rep.tiers[i].cost >= rep.tiers[i - 1].cost,
        `rung ${i + 1} costs less than rung ${i}`);
    }
    /* THREE TIMES, and the number is the ladder's own shape rather than a
     * taste: rung 1 is threat 2 and rung 5 is threat 7 on the Republic side,
     * 1 and 7 on the Confederacy's. A "tier ladder" whose top rung is not
     * several times its bottom one is a shopping list with prices on it. */
    assert(ARCHETYPES[rep.tiers[rep.tiers.length - 1].type].threat
      >= ARCHETYPES[rep.tiers[0].type].threat * 3,
      'the top of the ladder is not meaningfully above the bottom of it');
    // The order chooses the army, and it must not be answerable twice.
    assert(Cmd.sideForOrder('jedi') === rep, 'a Jedi does not lead the Republic');
    assert(Cmd.sideForOrder('sith') === cis, 'a Sith does not lead the Confederacy');
    assert(Cmd.enemyOf(rep) === cis && Cmd.enemyOf(cis) === rep, 'the armies do not oppose each other');
    return `${rep.tiers.length} rungs a side: ` + rows.join(', ');
  });

  check('command: every body Command adds is reachable and distinct', () => {
    /* `roster.mjs` already asserts that nothing is unreachable. What it cannot
     * say is whether the seven new bodies are seven different fights, which is
     * the thing the note actually asks for ("probably make different tiers of
     * troops too"). Two units with the same engagement band and the same cadence
     * are one unit with two names. */
    const keys = Object.keys(Cmd.COMMAND_UNITS);
    assert(keys.length >= 6, `only ${keys.length} new bodies`);
    const pool = LEVELS.geonosis.pool;
    const seen = new Set();
    for (const k of keys) {
      assert(ARCHETYPES[k], `${k} is declared and never registered`);
      assert(pool.includes(k), `${k} is in no pool, so no player can meet it`);
      const A = ARCHETYPES[k];
      // The signature of a unit: where it wants to stand, and how often it
      // fires. Rounded, because two units 30 cm apart are the same unit.
      const sig = A.melee ? `melee${Math.round(A.damage / 5)}`
        : `${Math.round(A.preferred[0])}-${Math.round(A.preferred[1])}/${A.burst}`;
      assert(!seen.has(sig), `${k} fights identically to something already in the roster (${sig})`);
      seen.add(sig);
    }
    /* NOTE #31, BY NAME: "there should be jet troopers." A jet trooper that does
     * not leave the ground is a trooper. */
    assert(ARCHETYPES.jet && ARCHETYPES.jet.float > 0.8,
      'the jet trooper does not leave the ground — note #31 asks for a jet trooper');
    return `${keys.length} bodies, ${seen.size} distinct engagement signatures`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Names, permadeath, experience, rank                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: every trooper has a name of its own, and it never comes back', () => {
    /* "every ally has a unique name you can see which makes the gameplay more
     * interesting because you can see who lived or who died … your troops when
     * dead will permanently die unless they are replaced." */
    const { d } = dirFor();
    assert(d.roster.strength === Cmd.OPENING_STRENGTH,
      `the campaign opens with ${d.roster.strength} bodies, not ${Cmd.OPENING_STRENGTH}`);
    // Fill the roster right up, so uniqueness is tested at the size it has to
    // hold at rather than at ten.
    d.roster.points = 999;
    for (let i = 0; i < 40 && d.roster.strength < Cmd.MAX_STRENGTH; i++) d.recruit(d.army.tiers[0].type);
    const names = d.roster.all.map((t) => t.name);
    assert(new Set(names).size === names.length,
      `${names.length - new Set(names).size} of ${names.length} designations are duplicates`);

    // PERMADEATH. Kill one, and it must not be replaceable by anything except a
    // purchase — and the record must survive so the casualty list can show it.
    const victim = d.roster.living[3];
    const was = d.roster.strength;
    d.roster.fall(victim, 1);
    assert(d.roster.strength === was - 1, 'a death did not reduce the strength');
    assert(!victim.alive && victim.diedIn === 1, 'the record does not remember dying');
    assert(d.roster.all.includes(victim), 'a fallen trooper is deleted rather than kept — there is no casualty list');
    assert(d.roster.fallen.includes(victim), 'the dead do not appear among the fallen');
    // Idempotent: a body can be reported dead more than once (the killer's path
    // and the corpse budget's), and a roster that counted both would go negative.
    assert(d.roster.fall(victim, 2) === false, 'a second death report counted again');
    assert(d.roster.strength === was - 1, 'a doubled death report moved the strength');
    // …and a REPLACEMENT is a new name, not the old one back.
    d.roster.points = 99;
    const fresh = d.recruit(d.army.tiers[0].type);
    assert(fresh && fresh !== victim && fresh.name !== victim.name,
      'a replacement reused a dead trooper\'s identity');
    return `${names.length} unique designations, a death is permanent and idempotent`;
  });

  check('command: a trooper that survives is visibly promoted, in three ways at once', () => {
    /* "maybe one particular one lasts longer than the others and you protect him
     * … the specific troopers that survive get more experience as they live and
     * get stronger themselves too so for instance the one npc that's somehow
     * survived from the beginning is now quite strong as they've been promoted."
     *
     * THREE THINGS OR NONE. A rank that only exists in a list is the thing this
     * codebase keeps deleting: a title you can read, a COLOUR you can read at
     * range, and numbers that actually moved. */
    const R = Cmd.RANKS;
    assert(R.length >= 4, `only ${R.length} ranks`);
    for (let i = 1; i < R.length; i++) {
      assert(R[i].xp > R[i - 1].xp, `rank ${i} is not above rank ${i - 1} in experience`);
      assert(R[i].hp > R[i - 1].hp && R[i].dmg > R[i - 1].dmg,
        `${R[i].title} is not stronger than ${R[i - 1].title} — the promotion is a title only`);
      assert(R[i].color != null, `${R[i].title} has no colour, so it cannot be read on the field`);
      assert(R[i].title !== R[i - 1].title, 'two ranks share a title');
    }
    const cols = R.slice(1).map((r) => r.color);
    assert(new Set(cols).size === cols.length, 'two ranks wear the same colour');
    assert(R[0].color == null, 'the bottom rung is painted, so a plain trooper is not plain');
    // The ladder is climbable in ONE campaign and only just — the top rung is
    // for the body that lived through all of it.
    const perArea = 2 + 4;                       // survive it, plus a share of the kills
    const total = Cmd.AREAS.reduce((n, a) => n + a.waves, 0) + Cmd.AREAS.length * perArea;
    assert(R[R.length - 1].xp <= total,
      `the top rank needs ${R[R.length - 1].xp} xp and a whole campaign is worth about ${total}`);
    assert(R[R.length - 1].xp > total * 0.4,
      'the top rank arrives too early to be the one who survived everything');

    // And the award path itself: it promotes exactly once per gate crossed.
    const t = new Cmd.Trooper(Cmd.ARMIES.republic, 'trooper', 'CT-0001');
    assert(t.rank === 0 && t.award(R[1].xp - 1) === null, 'a trooper promoted before the gate');
    const p = t.award(1);
    assert(p === R[1], 'crossing the gate did not report a promotion');
    assert(t.award(0) === null, 'awarding nothing promoted somebody');
    // A jump straight past a gate still promotes, and to the RIGHT rank.
    const t2 = new Cmd.Trooper(Cmd.ARMIES.republic, 'trooper', 'CT-0002');
    assert(t2.award(R[3].xp) === R[3], 'a big award landed on the wrong rung');
    return `${R.length} ranks, ${new Set(cols).size} distinct colours, top at ${R[R.length - 1].xp} xp of ~${total}`;
  });

  check('command: the roster crosses an area, and the muster is what refills it', () => {
    /* "between rounds or areas on the map you get stronger and upgrade your
     * troops or bring in more troops." The roster is the one object that
     * outlives an area — the bodies are rebuilt at every boundary, so a name
     * that lived on the body would die at every boundary. */
    const { d } = dirFor();
    const opening = d.roster.all.slice();
    const areaOne = d.area;
    // Lose four, then clear the area.
    for (let i = 0; i < 4; i++) d.roster.fall(d.roster.living[0], 1);
    d.areaWaves = areaOne.waves - 1;
    d.wave = areaOne.waves;
    const paid = d.payWave(areaOne.waves);
    assert(paid, 'clearing the last wave of an area did not pay');
    assert(d.areaIndex === 1, 'the area did not advance');
    /* `>=`, not `===`: the muster ADDS records, and the property is that
     * nothing is ever LOST. A roster that only grows is exactly what a casualty
     * list is. */
    assert(d.roster.all.length >= opening.length,
      'the roster lost records across an area — the casualty list does not survive');
    for (const t of opening) assert(d.roster.all.includes(t), `${t.name} is not in the roster after an area`);
    /* The OPENING survivors, not everybody: the muster has already run by this
     * point and its recruits have crossed nothing. Crediting them would be the
     * check asserting that a body bought after the area fought through it. */
    const survivors = opening.filter((t) => t.alive);
    assert(survivors.length > 0, 'nobody survived the first area at all');
    assert(survivors.every((t) => t.areas === 1), 'survivors were not credited with the area');
    assert(survivors.every((t) => t.xp > 0), 'a body that lived through an area earned nothing');
    // The muster ran (no screen is wired in this fixture, so the director
    // musters for itself rather than stopping the campaign on a UI that does
    // not exist) and it REPLACED the losses.
    assert(d.roster.strength >= Cmd.OPENING_STRENGTH,
      `the muster left the line at ${d.roster.strength}`);
    // …and it PAID for them. A mode that refills the line for free has removed
    // the thing note #21 asks it to add.
    assert(d.roster.points < areaOne.muster + 1,
      `the muster spent nothing: ${d.roster.points} points still held`);
    // The offer is gated on the area, so the campaign teaches its own roster.
    const early = new Cmd.CommandDirector(cmdWorld(), { pool: LEVELS.geonosis.pool });
    const sold = early.musterOffer().units.map((u) => u.type);
    const late = d.army.tiers.filter((t) => t.at > 1).map((t) => t.type);
    for (const t of late) assert(!sold.includes(t), `${t} is on sale in area 1`);
    assert(sold.length > 0, 'nothing at all is on sale in area 1');
    return `${d.roster.all.length} records across an area (${d.roster.fallen.length} fallen), `
      + `${sold.length} of ${d.army.tiers.length} rungs on sale at the start`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Formations                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: the six formations are six different shapes, and the leash bites', () => {
    /* Note #30: "you can order your troops into different formations, circle
     * around you, behind you, in front idk."
     *
     * A formation is a SHAPE and a LEASH, and both have to do something. Six
     * names over one layout is the shape this repository keeps deleting. */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    d._troops(0, {});
    const troops = d.roster.living.map((t) => t.body).filter(Boolean);
    assert(troops.length >= 8, `only ${troops.length} bodies deployed`);

    const shapes = new Map();
    for (const id of Cmd.FORMATION_IDS) {
      d.order(id);
      d._troops(0, {});
      const F = Cmd.FORMATIONS[id];
      const pts = troops.map((e) => {
        const s = d.slotFor(e, new THREE.Vector3());
        return s ? [Math.round(s.x * 4) / 4, Math.round(s.z * 4) / 4] : null;
      });
      if (F.slot(0, 8, 0, new THREE.Vector3()) === null) {
        assert(pts.every((p) => p === null), `${id} claims no slots and produced some`);
        continue;
      }
      const key = JSON.stringify(pts);
      for (const [other, k] of shapes) {
        assert(k !== key, `${id} and ${other} put every body in the identical place`);
      }
      shapes.set(id, key);
    }
    assert(shapes.size >= 4, `only ${shapes.size} of the formations have a shape at all`);

    /* THE THREE THE NOTE NAMES, by geometry rather than by name. `+Z` is the
     * direction the commander faces, so "in front" is a positive mean Z and
     * "behind" is a negative one, and a circle is neither because it surrounds. */
    const meanZ = (id) => {
      d.order(id); d._troops(0, {});
      let s = 0, n = 0;
      for (const e of troops) { const p = d.slotFor(e, new THREE.Vector3()); if (p) { s += p.z; n++; } }
      return n ? s / n : 0;
    };
    assert(meanZ('front') > 3, `"vanguard" has its mean body at z=${meanZ('front').toFixed(1)} — not in front`);
    assert(meanZ('behind') < -2, `"column" has its mean body at z=${meanZ('behind').toFixed(1)} — not behind`);
    d.order('circle'); d._troops(0, {});
    const radii = troops.map((e) => {
      const p = d.slotFor(e, new THREE.Vector3());
      return p ? Math.hypot(p.x, p.z) : 0;
    });
    const rMin = Math.min(...radii), rMax = Math.max(...radii);
    assert(rMin > 2 && rMax - rMin < 4,
      `"circle" runs from ${rMin.toFixed(1)} m to ${rMax.toFixed(1)} m — that is not a ring`);
    // …and it actually surrounds: bodies on both sides of the commander.
    const front = troops.filter((e) => (d.slotFor(e, new THREE.Vector3())?.z ?? 0) > 0).length;
    assert(front > 1 && front < troops.length - 1, 'the "circle" is all on one side');

    /* THE LEASH. This is what makes a formation a tactic rather than a parade:
     * a tight formation will not chase, a charge will. Same body, same enemy,
     * two orders, two answers. */
    const foe = { position: V(0, 0, 26), dead: false, team: 1, alive: true };
    const one = troops[0];
    d.order('circle'); d._troops(0, {});
    assert(d.targetFor(one, [foe]) === null,
      'a trooper in a tight circle engaged something 26 m outside the formation');
    d.order('charge'); d._troops(0, {});
    assert(d.targetFor(one, [foe]) === foe, 'a charging trooper refused a target');
    // …and it never picks its own side, whatever the order.
    const friend = { position: V(0, 0, 1), dead: false, team: one.team, alive: true };
    assert(d.targetFor(one, [friend]) === null, 'a trooper targeted one of its own');
    return `${shapes.size} distinct layouts; front z+${meanZ('front').toFixed(1)}, `
      + `column z${meanZ('behind').toFixed(1)}, circle ${rMin.toFixed(1)}-${rMax.toFixed(1)} m; leash gates`;
  });

  check('command: the steer is installed on the one seam it has, and it moves a body', () => {
    /**
     * PINNED, for the reason `controls.mjs` pins `Player._updateThrow`.
     *
     * `Enemy.update` runs `_think` (which sets `wish` from `target`) and then
     * `_move` (which consumes it). Nothing sits between them, so a formation has
     * to BE the thing between them — `installCommand` wraps `_move` on the
     * instance. Rename that method in Enemy.js and every formation in the game
     * silently becomes a charge, with nothing to see in a diff. This check is
     * what makes that a failure instead.
     */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    d._troops(0, {});
    const e = d.roster.living[0].body;
    assert(e._cmdMove, 'the command steer did not install — Enemy._move has been renamed');
    // Put it a long way off its slot and step it: the wish must point home.
    d.order('circle');
    d._troops(0, {});
    e.position.set(40, 0, 40);
    e.wish = null;
    e._move(1 / 60, {});
    assert(e.wish, 'a trooper 55 m from its slot was given no direction to walk in');
    const slot = d.slotFor(e, new THREE.Vector3());
    const want = new THREE.Vector3(slot.x - 40, 0, slot.z - 40).normalize();
    assert(e.wish.dot(want) > 0.98,
      `the steer points ${(Math.acos(Math.min(1, e.wish.dot(want))) * 180 / Math.PI).toFixed(0)}° off its slot`);
    // `toTarget` too, or `_move`'s backpedal limiter runs a returning trooper at
    // 40% pace and it never arrives.
    assert(e.toTarget && e.toTarget.dot(want) > 0.98,
      'toTarget was not turned with the wish, so the walk home is a backpedal');
    // …and in position it leaves the brain alone entirely.
    e.position.copy(slot);
    e.wish = null;
    e._move(1 / 60, {});
    assert(e.wish === null, 'a trooper standing on its slot is still being steered');
    return 'wrapped on _move; steers home outside the tolerance, silent inside it';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Note #29 — allies are as real as enemies                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('command: your powers reach your own troops and your troops\' rifles do not reach you', () => {
    /**
     * NOTE #29 IS A PAIR OF PROPERTIES THAT PULL AGAINST EACH OTHER, and that
     * is exactly why it is worth a check:
     *
     *   "you can do damage to them and throw them and manipulate them so you
     *    need to be careful not to hurt them" — the player's powers reach them;
     *   "obviously the force blaster-stop thing shouldn't affect your allies'
     *    blasters"                            — and their weapons are not yours.
     *
     * Both fall out of one field, `ctx.rules`, and one team number. Asserted
     * through `canHarm`, which is the ONE gate the game is allowed to answer
     * this question with — so this is testing the shipped rule and not a
     * restatement of it.
     */
    const me = { team: TEAM.PARTY, world: null };
    const mine = { team: TEAM.PARTY, world: null };
    const theirs = { team: 1, world: null };
    const co = { pvp: false, friendlyFire: false };

    // Through the POWERS' rules, an ally is reachable.
    assert(canHarm(me, mine, Cmd.COMMAND_POWER_RULES),
      'a Force push cannot reach your own troops — note #29 asks that it can');
    // Through the WORLD's, a trooper's bolt is not.
    assert(!canHarm(mine, me, co), 'a trooper\'s blaster can shoot the commander');
    assert(!canHarm(mine, { team: TEAM.PARTY }, co), 'a trooper\'s blaster can shoot another trooper');
    // Both directions still fight the other army.
    assert(canHarm(mine, theirs, co), 'your troops cannot hurt the enemy');
    assert(canHarm(theirs, mine, co), 'the enemy cannot hurt your troops');
    // The rules object itself must not be able to become something else.
    assert(Object.isFrozen(Cmd.COMMAND_POWER_RULES), 'the power rules can be mutated by any caller');
    assert(Cmd.COMMAND_POWER_RULES.pvp === false,
      'the power rules turn PvP on, which would put every co-op partner in play');

    /* THE BOLT-STOP, which is the clause the note calls out by name.
     * `Player._stasisCapture` skips `bolt.team === this.team`, so a bolt from
     * one of your troops is skipped BY CONSTRUCTION — the field it reads is the
     * same one that makes them yours. Asserted as the property rather than by
     * driving a Player: the line is `if (!bolt.active || bolt.held ||
     * bolt.team === this.team) continue`, and what matters is that a troop's
     * bolt carries the party's team. */
    const { w, d } = dirFor();
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    const body = d.roster.living[0].body;
    assert(body.team === TEAM.PARTY,
      `a deployed trooper is on team ${body.team}, so the bolt-stop would freeze its fire`);
    return 'powers reach allies; allied bolts reach neither you nor each other; both fight the horde';
  });

  check('command: team damage scales what YOU do and nothing else', () => {
    /* "maybe there's a setting for how much team damage you do." The setting
     * scales DAMAGE and never the physics — a push throws your own sergeant
     * exactly as far as it throws a B1, because the note is explicitly about
     * allies not being a different kind of object. */
    const cfg = Cmd.commandConfig({});
    assert(cfg.teamDamage === Cmd.TEAM_DAMAGE_DEFAULT, 'the default team damage is not the stated one');
    assert(Cmd.commandConfig({ teamDamage: 5 }).teamDamage === 1, 'team damage is not clamped above');
    assert(Cmd.commandConfig({ teamDamage: -1 }).teamDamage === 0, 'team damage is not clamped below');
    assert(Cmd.commandConfig({ teamDamage: 'lots' }).teamDamage === Cmd.TEAM_DAMAGE_DEFAULT,
      'a junk setting is not defaulted');

    const { w, d } = dirFor({ settings: { teamDamage: 0.25 } });
    w.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d.deploy();
    const e = d.roster.living[0].body;
    const player = { team: TEAM.PARTY };
    const droid = { team: 1 };
    const hp0 = e.hp;
    e.damage(40, null, player, 'saber');
    const mine = hp0 - e.hp;
    const hp1 = e.hp;
    e.damage(40, null, droid, 'bolt');
    const theirs = hp1 - e.hp;
    assert(Math.abs(mine - 10) < 0.01, `your own hit did ${mine.toFixed(1)} of 40 at a 0.25 setting`);
    assert(Math.abs(theirs - 40) < 0.01, `the enemy's hit did ${theirs.toFixed(1)} of 40 — it must be full`);
    // A source with no team at all is nobody's — a fall, a hazard, a crate — and
    // pays full, which is the same fails-open rule `canHarm` states.
    const hp2 = e.hp;
    e.damage(10, null, null, 'fall');
    assert(Math.abs(hp2 - e.hp - 10) < 0.01, 'an unattributed hit was scaled as friendly fire');

    // At zero, a careless sweep costs nothing at all — which is a legitimate way
    // to play and has to actually be zero rather than nearly.
    const { w: w0, d: d0 } = dirFor({ settings: { teamDamage: 0 } });
    w0.players.push({ position: V(0, 0, 0), aimDir: V(0, 0, 1), alive: true, team: TEAM.PARTY });
    d0.deploy();
    const safe = d0.roster.living[0].body;
    const before = safe.hp;
    assert(safe.damage(999, null, player, 'saber') === false, 'a zero-team-damage hit reported a kill');
    assert(safe.hp === before, 'team damage 0 still took health');
    return 'own hits ×0.25, enemy hits ×1, unattributed ×1, and 0 is exactly 0';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The wave liveness watchdog — player note #7                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('watchdog: a body nothing can reach does not end the run', () => {
    /**
     * PLAYER NOTE #7, AND IT IS THE WORST BUG ON THEIR LIST because it is the
     * only one that ends a run outright:
     *
     *   "a lot of times I was not able to finish a wave because the enemy would
     *    not be on the map, like the radar would say I'm right on them but idk
     *    maybe they're inside the map but it would keep you from progressing."
     *
     * The wave ends on `!spawnQueue.length && !arrivals.pending && alive === 0`,
     * so ONE unreachable body is a run that never advances again and whose only
     * exit is Abandon. Three states produce it and `Enemy`'s own local stuck
     * handling can resolve none of them: inside geometry, under the terrain, or
     * outside the heightfield.
     *
     * Driven end to end: compose a wave, put its last body somewhere impossible,
     * and assert the wave CLEARS. That is the property — not "the watchdog
     * fired", which is a statement about the fix rather than about the game.
     */
    const w = cmdWorld({ bound: 400 });
    const d = new Waves.WaveDirector(w, { mode: 'waves', pool: ['b1'] });
    w.players.push({ position: V(0, 0, 0), alive: true, team: TEAM.PARTY });
    d.start(1);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(30, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };

    // Run until the wave has put everything down, killing as they land.
    let t = 0;
    while (t < 90 && (d.spawnQueue.length || d.arrivals.pending)) {
      d.update(1 / 60, ctx); t += 1 / 60;
      for (const e of w.enemies) e.dead = true;
    }
    assert(t < 89, 'the wave never finished delivering');

    // Now one body that cannot be reached: 900 m outside a 120 m world.
    const lost = w.spawnEnemy('b1', V(900, 0, 900));
    assert(!Waves.positionIsValid(w, lost), 'the fixture body is not actually in an invalid place');
    assert(d.active, 'the wave had already ended before the stuck body was introduced');

    let cleared = 0;
    d.onWaveClear = () => { cleared++; };
    for (let i = 0; i < 60 * 90 && !cleared; i++) d.update(1 / 60, ctx);
    assert(cleared === 1, 'the wave never cleared — an unreachable body still blocks a run');

    // It was RESCUED before it was retired, and it was not silent.
    const log = d.rescues || [];
    assert(log.length > 0, 'the wave cleared and nothing was logged — the watchdog fired silently');
    assert(log[0].what === 'rescue' && log[0].why === 'invalid position',
      `the first intervention was ${log[0].what}/${log[0].why} — an invalid position must be rescued first`);
    assert(Waves.positionIsValid(w, lost) || lost.dead,
      'the body is still in an impossible place and still alive');
    return `wave cleared with ${log.length} intervention(s): ` + log.map((r) => r.what).join(', ');
  });

  check('watchdog: a body doing its job correctly is never touched', () => {
    /* The other direction, and the one that matters more: a watchdog that
     * teleports a marksman holding its 42 m preferred range is worse than the
     * bug. A real fight is full of thirty-second standoffs. */
    const w = cmdWorld();
    const d = new Waves.WaveDirector(w, { mode: 'waves', pool: ['sniper'] });
    w.players.push({ position: V(0, 0, 0), alive: true, team: TEAM.PARTY });
    d.start(1);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(38, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };
    // A body standing still at a legitimate distance, with the queue empty, for
    // three times the retire clock.
    d.spawnQueue.length = 0;
    d.arrivals.clear();
    const holding = w.spawnEnemy('sniper', V(38, 0, 0));
    for (let i = 0; i < 60 * Waves.STALL_RETIRE * 3; i++) d.update(1 / 60, ctx);
    assert(!holding.dead, 'a marksman holding its own range was retired by the watchdog');
    // …and the two clocks are ordered, so a rescue always precedes a retirement.
    assert(Waves.STALL_RESCUE < Waves.STALL_RETIRE,
      'the retire clock is not after the rescue clock, so nothing is ever rescued');
    assert(Waves.STALL_RESCUE > 8,
      `${Waves.STALL_RESCUE}s of no progress is inside a normal standoff`);
    return `held 38 m for ${(Waves.STALL_RETIRE * 3).toFixed(0)}s untouched; rescue at `
      + `${Waves.STALL_RESCUE}s, retire at ${Waves.STALL_RETIRE}s`;
  });

  check('watchdog: under the ground and outside the world are never legitimate', () => {
    /* Stated as a function rather than as a condition inside the loop, because
     * it is a PROPERTY of this game and a property that only exists inside a
     * check is a property the game does not have. */
    const w = cmdWorld({ bound: 100 });
    const A = ARCHETYPES.b1;
    const at = (x, y, z, a = A) => ({ position: V(x, y, z), A: a });
    assert(Waves.positionIsValid(w, at(0, 0, 0)), 'standing on the ground is not valid');
    assert(Waves.positionIsValid(w, at(0, 40, 0)), 'being in the air is not valid');
    assert(!Waves.positionIsValid(w, at(0, -6, 0)), '6 m under the terrain is valid');
    assert(!Waves.positionIsValid(w, at(400, 0, 0)), 'outside the heightfield is valid');
    assert(!Waves.positionIsValid(w, at(NaN, 0, 0)), 'a NaN position is valid');
    /* A HOVERING BODY IS NOT UNDERGROUND. `float` is real clearance — a jet
     * trooper sits 1.35 m up and a training remote 1.55 — and a tolerance that
     * did not read it would rescue every one of them on the frame it spawned. */
    assert(Waves.positionIsValid(w, at(0, -2.6, 0, ARCHETYPES.jet)),
      'a hovering jet trooper reads as underground');
    return 'ground, air and hover valid; underground, out-of-bounds and NaN are not';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The corpse budget — player note #15                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('corpses: the budget actually bounds the field', () => {
    /**
     * "sometimes for fun I'll spawn like 30 enemies and then it gets really
     * really laggy, framerate probably <10 once there are that many DEAD AND
     * ALIVE enemies on the map."
     *
     * Measured with tools/_crowd.mjs: thirty corpses simulate at 11.46 ms
     * against thirty live bodies at 6.76 and an empty field at 5.30, because a
     * ragdoll is nineteen rigid bodies with joints where a walking enemy is one
     * capsule. Nothing in this repository had ever removed one, and a forty-wave
     * run leaves several hundred.
     *
     * The property is the BOUND: however many die, the number kept is bounded by
     * the tier's budget. Asserted by killing four times the budget and counting.
     */
    const budget = 6;
    const w = cmdWorld();
    w.player = { position: V(0, 0, 0), aimDir: V(0, 0, 1) };
    const c = new Corpses(w, { budget });
    for (let i = 0; i < budget * 4; i++) {
      const e = w.spawnEnemy('b1', V(i * 3, 0, 0));
      e.dead = true;
      e.actor = null;                            // no ragdoll: settles at once
      c.take(e);
    }
    assert(c.list.length === budget * 4, 'the ledger did not take every body');
    // Long enough for the settle hold and a full sink.
    for (let i = 0; i < 60 * 6; i++) c.update(1 / 60);
    assert(c.list.length <= budget,
      `${c.list.length} corpses are still on the field against a budget of ${budget}`);
    assert(c.retired >= budget * 3,
      `only ${c.retired} of ${budget * 3} surplus corpses were retired`);

    // The tiers are ordered and every one of them is a real bound.
    const tiers = ['low', 'medium', 'high', 'ultra'];
    for (let i = 1; i < tiers.length; i++) {
      assert(CORPSE_BUDGET[tiers[i]] > CORPSE_BUDGET[tiers[i - 1]],
        `the ${tiers[i]} tier does not keep more corpses than ${tiers[i - 1]}`);
    }
    assert(CORPSE_BUDGET.low >= 4, 'the lowest tier keeps so few that a wave\'s dead vanishes under you');
    /* AND THE WORLD HAS TO ACTUALLY OWN ONE. A budget nothing constructs is the
     * defect this whole repository is shaped around — a table beside a consumer
     * that ignores it. Read off the source rather than by building a World,
     * which needs Rapier and a GPU-shaped scene. */
    const src = String(new URL('../../src/game/World.js', import.meta.url).pathname);
    const text = require$(src);
    assert(/new Corpses\(/.test(text), 'World never constructs a corpse ledger');
    assert(/corpses\?\.take\(/.test(text), 'nothing hands a dead body to the ledger');
    assert(/corpses\?\.update\(/.test(text), 'the ledger is never stepped');
    assert(/corpses\?\.clear\(/.test(text), 'the ledger is not cleared when a level unloads');
    return `${budget * 4} dead → ${c.list.length} kept, ${c.retired} retired; `
      + `tiers ${tiers.map((t) => CORPSE_BUDGET[t]).join('/')}; World wires all four calls`;
  });
}

/* A file read, kept out of the check body so the import list stays honest. */
import { readFileSync } from 'node:fs';
function require$(p) { return readFileSync(p, 'utf8'); }
