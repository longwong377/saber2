/**
 * BATTLEFRONT BORZ — the two things you call down: a support call, and
 * yourself.
 *
 * Two of player note #15 and #29's verbs share this file because they share a
 * bench — a real Player over real ground — and because they are the same kind
 * of claim: something arrives late, somewhere you chose, and hurts what is
 * standing there. The stratagems are first; the aerial dive is at the end.
 *
 * Player note #29 asked for WASD-coded support calls. The system is
 * src/game/Stratagems.js; this is what says it works, and the four things it
 * has to say are the four ways a code system fails silently.
 *
 *  1. A TABLE THAT CANNOT BE SPELLED. Two rows on one code, or a short code
 *     that is a prefix of a long one, and one of the pair is simply
 *     unreachable — with nothing at runtime to say so. This is authored by
 *     accident the first time somebody adds a row, and from the outside it
 *     looks like "that call sometimes does the wrong thing".
 *
 *  2. AN ENTRY THAT IS NOT AN ENTRY. Feeding the letters has to actually fire
 *     the call, a wrong letter has to fail rather than be ignored, and letting
 *     go has to abandon the code — otherwise the next W a player presses to
 *     walk completes something.
 *
 *  3. A CODE THAT COSTS NOTHING. The whole mechanic is that you stopped moving
 *     in the open to ask for something. If movement is not actually suppressed
 *     while spelling, there is no risk and the lead times are decoration.
 *
 *  4. AN EFFECT THAT REIMPLEMENTS SOMEBODY ELSE'S RULE. A blast that threw
 *     bodies with its own arithmetic instead of `applyKnockback` would not
 *     answer the target's Force pool — see forceResistance — and the same
 *     shell would hit a Force user harder from a stratagem than from a landing.
 *
 * Everything below drives the real `Stratagems` against a real `Player` and a
 * real `Enemy` rather than reading the source, except the table check, which
 * is a property of the table itself and is exported from the module so there
 * is one implementation of "is this table spellable" and not two.
 */

import { Player } from '../../src/game/Player.js';
import { Enemy } from '../../src/game/Enemy.js';
import {
  Stratagems, STRATAGEMS, STRATAGEM_BY_ID, DIRS, DIR_ACTION, DIR_GLYPH, CODE_GAP,
  CODE_MIN, CODE_MAX, codeFaults, codeLength, rollCodes, spell,
} from '../../src/game/Stratagems.js';
import { ACTIONS, defaultBindings } from '../../src/engine/Bindings.js';
import {
  addSmoke, updateSmoke, clearSmoke, depthAlong, seeThrough, smokeClouds,
  DENSITY, OPAQUE, BLOOM,
} from '../../src/game/Smoke.js';
import { BoltPool } from '../../src/game/Bolts.js';

let THREE = null;

/** An input that answers only what it is told to. */
function stubInput(held = new Set(), hits = new Set()) {
  return {
    act: (id) => held.has(id),
    actHit: (id) => hits.has(id),
    actAxis: (id) => (held.has(id) ? 1 : 0),
    moveAxis: (out = { x: 0, y: 0 }) => {
      out.x = (held.has('moveR') ? 1 : 0) - (held.has('moveL') ? 1 : 0);
      out.y = (held.has('moveF') ? 1 : 0) - (held.has('moveB') ? 1 : 0);
      return out;
    },
    mouse: { dx: 0, dy: 0, wheel: 0 },
    accel: { x: 0, y: 0 },
    locked: true, enabled: true,
  };
}

function bench({ command = null, force = 400 } = {}) {
  const hit = [];
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, surfaceAt: () => 'sand',
      crater(x, z, r, d) { hit.push({ kind: 'crater', x, z, r, d }); },
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    enemies: [], props: [], command,
    addProp() {}, onHitmark() {}, notify() {}, report() {},
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
      addJoint() {}, removeJoint() {} },
    engine: { addHeat() {}, hurt() {}, shake() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
  };
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.force = force;
  const ctx = {
    dt: 1 / 60, terrain: world.terrain, enemies: world.enemies, particles: null,
    physics: world.physics, world, input: stubInput(), camera: world.engine.camera,
    time: 0, groundColor: 0,
  };
  return { world, p, ctx, hit };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('stratagems: every code can actually be spelled', () => {
    /* THE ONE RULE THIS SYSTEM CANNOT ENFORCE AT RUNTIME. `codeFaults` is
     * exported from the module rather than re-derived here, for the reason
     * HANDOFF §2.3 gives: a second implementation of "is this table spellable"
     * would be the copy that drifts, and it is the copy an author would trust.
     * What this check adds is that it is RUN, against the shipped table. */
    const faults = codeFaults();
    assert(!faults.length, faults.join('; '));
    // …and that the detector detects, so a green result means something. Two
    // planted faults, one of each kind.
    const dupe = codeFaults([{ id: 'a', code: 'WS' }, { id: 'b', code: 'WS' }]);
    assert(dupe.length, 'codeFaults does not notice two rows sharing a code');
    const pre = codeFaults([{ id: 'a', code: 'WS' }, { id: 'b', code: 'WSAD' }]);
    assert(pre.length, 'codeFaults does not notice a code that is a prefix of another');
    return `${STRATAGEMS.length} calls, no duplicate and no prefix; the detector catches both`;
  });

  check('stratagems: the codes are dealt per run, and every deal is spellable', () => {
    /**
     * A CODE THE PLAYER HAS MEMORISED IS NOT A CODE — it is a second binding
     * with more keystrokes in it, and the mechanic is over the evening they
     * learn the six. So the codes are dealt from the run's seed, and this is
     * what says the dealer cannot deal a broken hand.
     *
     * Two hundred seeds, because the constraints `rollCodes` enforces are the
     * ones that fail RARELY and silently — a prefix collision needs two
     * particular codes to land, and testing one deal proves nothing about the
     * next. `codeFaults` is the shipped detector and is called rather than
     * re-implemented, so there is one answer to "is this hand spellable".
     */
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      rollCodes(seed);
      const faults = codeFaults();
      assert(!faults.length, `seed ${seed} dealt an unspellable hand: ${faults.join('; ')}`);
      for (const s of STRATAGEMS) {
        assert(s.code.length === codeLength(s),
          `seed ${seed}: ${s.id} was dealt ${s.code.length} directions and its price asks for `
          + `${codeLength(s)}`);
        assert(!/(.)\1\1/.test(s.code),
          `seed ${seed}: ${s.id} was dealt ${s.code} — three of the same in a row is a stuck key, `
          + 'not a code a player can count');
      }
      seen.add(STRATAGEMS.map(s => s.code).join('|'));
    }
    assert(seen.size > 190,
      `200 seeds produced only ${seen.size} distinct hands — the deal is barely moving`);

    /* SEEDED, and that is the half that makes it usable rather than chaotic: a
     * code is fixed for a whole run, a replayed seed replays its codes, and a
     * co-op guest spells what the host spells. */
    rollCodes(4242);
    const a = STRATAGEMS.map(s => s.code).join('|');
    rollCodes(77);
    rollCodes(4242);
    assert(STRATAGEMS.map(s => s.code).join('|') === a,
      'the same seed dealt two different hands — a replayed run would not replay its codes');
    return `200 seeds, ${seen.size} distinct hands, no duplicate / prefix / triple in any of them; `
      + `lengths ${STRATAGEMS.map(s => s.code.length).sort().join('')}`;
  });

  check('stratagems: a code is longer than four, and its length is its price', () => {
    /* FOUR WAS TOO SHORT IN TWO WAYS AT ONCE. Every code in the table was the
     * same length, so the panel taught nothing about which call was the
     * expensive one; and four directions is 256 spellings, which is a small
     * enough space that two rows dealt at random collide often.
     *
     * Length is DERIVED from cost — one keystroke per PER_KEY Force over a
     * floor — because a stratagem's price and the seconds you stand still to
     * ask for it are two statements of the same thing, and two of those kept
     * in step by hand is the defect this codebase keeps removing. */
    rollCodes(1);
    for (const s of STRATAGEMS) {
      assert(s.code.length > 4, `${s.id} is still a four-direction code`);
      assert(s.code.length >= CODE_MIN && s.code.length <= CODE_MAX,
        `${s.id} is ${s.code.length} directions, outside ${CODE_MIN}..${CODE_MAX}`);
    }
    const by = STRATAGEMS.slice().sort((x, y) => x.cost - y.cost);
    for (let i = 1; i < by.length; i++) {
      assert(by[i].code.length >= by[i - 1].code.length,
        `${by[i].id} costs ${by[i].cost} and spells in ${by[i].code.length}, while `
        + `${by[i - 1].id} costs ${by[i - 1].cost} and spells in ${by[i - 1].code.length} — `
        + 'a dearer call must not be quicker to ask for');
    }
    assert(by[by.length - 1].code.length > by[0].code.length,
      'every call is the same length, so the panel says nothing about which one is expensive');
    return by.map(s => `${s.id} ${s.cost}→${s.code.length}`).join(', ');
  });

  check('stratagems: a code is written in arrows, not in key names', () => {
    /* A code is made of DIRECTIONS. W is only what a direction happens to be
     * bound to on a keyboard, so printing the letter is printing the input
     * method and not the thing — wrong on a pad, wrong after a rebind to ESDF,
     * and wrong in a screenshot. */
    for (const d of DIRS) {
      assert(DIR_GLYPH[d] && !/[A-Za-z]/.test(DIR_GLYPH[d]),
        `direction ${d} has no arrow of its own (${DIR_GLYPH[d] ?? 'nothing'})`);
    }
    assert(new Set(Object.values(DIR_GLYPH)).size === DIRS.length,
      'two directions share an arrow');
    rollCodes(1);
    for (const s of STRATAGEMS) {
      const w = spell(s.code);
      assert(!/[A-Za-z]/.test(w), `${s.id} spells as "${w}", which still has a letter in it`);
      assert([...w].length === s.code.length, `${s.id} spelled to ${[...w].length} glyphs`);
    }
    return `${DIRS.map(d => DIR_GLYPH[d]).join('')} — ${spell(STRATAGEM_BY_ID.smoke.code)} lays smoke`;
  });

  check('stratagems: the key is in the bindings table and the letters are movement', () => {
    /* A control that is not in ACTIONS cannot be rebound, cannot be listed and
     * cannot be seen to COLLIDE — which is the exact hole `registerOrders`
     * exists to have closed for the formations. The stratagem key is one row;
     * the four letters are deliberately NOT four rows, because they are the
     * movement actions and a code written in key names could not survive a
     * player rebinding WASD. This asserts that second part rather than
     * assuming it: every direction has to name an action that exists. */
    const row = ACTIONS.find(a => a.id === 'stratagem');
    assert(row, 'no `stratagem` action — the key cannot be rebound or listed');
    assert(row.hold, 'the stratagem key is not a hold, so nothing tells a letter from a step');
    const b = defaultBindings();
    assert((b.stratagem || []).length, 'the stratagem action ships bound to nothing');
    const missing = DIRS.filter(d => !ACTIONS.some(a => a.id === DIR_ACTION[d]));
    assert(!missing.length,
      `the code letters ${missing.join(',')} name actions that do not exist`);
    return `${b.stratagem.join('+')} holds; letters read off `
      + `${DIRS.map(d => DIR_ACTION[d]).join(', ')}`;
  });

  check('stratagems: spelling a code fires the call, and a wrong letter fails it', () => {
    const b = bench();
    const S = b.p.stratagems;
    assert(S, 'the player has no stratagems');
    const strike = STRATAGEM_BY_ID.strike;
    // nothing happens while the key is up — a code cannot be entered by walking
    for (const c of strike.code) assert(S.feed(c, b.ctx) === null, 'a letter landed with the key up');
    assert(S.entry === '', 'walking spelled something');

    S.setArming(true);
    let fired = null;
    for (const c of strike.code) fired = S.feed(c, b.ctx) || fired;
    assert(fired && fired.id === 'strike',
      `spelling ${strike.code} produced ${fired ? fired.id : 'nothing'}`);
    assert(S.pending.length === 1, 'the call did not queue');
    assert(S.entry === '', 'the entry did not clear after a completed code');

    /* A WRONG LETTER IS A FAILED CODE, not a character to backspace. The
     * alternative — ignoring letters that lead nowhere — means a code can be
     * entered with arbitrary garbage in the middle of it, and a player who
     * fumbled would get a call they did not ask for. */
    S.cooldowns.strike = 0;
    const wrong = [...strike.code];
    wrong[1] = DIRS.find(d => d !== wrong[1] && !STRATAGEMS.some(s => s.code.startsWith(wrong[0] + d)));
    assert(wrong[1], 'every second letter leads somewhere — this fixture needs a dead one');
    assert(S.feed(wrong[0], b.ctx) === null, 'the first letter of a real code went nowhere');
    assert(S.feed(wrong[1], b.ctx) === false, 'a letter that leads nowhere was accepted');
    assert(S.entry === '', 'a failed code left the entry standing');
    return `${strike.code} → ${strike.id}; ${wrong[0]}${wrong[1]} → refused and cleared`;
  });

  check('stratagems: letting go abandons the code, and so does silence', () => {
    const b = bench();
    const S = b.p.stratagems;
    S.setArming(true);
    S.feed(STRATAGEM_BY_ID.strike.code[0], b.ctx);
    assert(S.entry.length === 1, 'the first letter did not stick');
    S.setArming(false);
    assert(S.entry === '',
      'releasing the key left a half-entered code standing — the next step would complete it');

    S.setArming(true);
    S.feed(STRATAGEM_BY_ID.strike.code[0], b.ctx);
    for (let t = 0; t < CODE_GAP + 0.2; t += 1 / 60) S.update(1 / 60, b.ctx);
    assert(S.entry === '', `a code left alone for ${CODE_GAP}s did not time out`);
    return `release clears; ${CODE_GAP}s of silence clears`;
  });

  check('stratagems: entering a code costs you the ground you are standing on', () => {
    /* THE WHOLE MECHANIC, as a measurement. If the player still walks while
     * spelling, the lead times are decoration and the call is free. Driven
     * through the real `_move` with the real input seam rather than by reading
     * the source, because "does the player move" is a claim about a position. */
    const b = bench();
    const held = new Set(['moveF']);
    b.ctx.input = stubInput(held);
    const start = b.p.position.clone();
    for (let i = 0; i < 60; i++) b.p._move(1 / 60, b.ctx);
    const walked = b.p.position.distanceTo(start);
    assert(walked > 1.5, `the fixture cannot walk at all (${walked.toFixed(2)} m in a second)`);

    b.p.position.copy(start);
    b.p.velocity.set(0, 0, 0);
    b.p.stratagems.setArming(true);
    for (let i = 0; i < 60; i++) b.p._move(1 / 60, b.ctx);
    const spelled = b.p.position.distanceTo(start);
    assert(spelled < walked * 0.15,
      `holding W while spelling still moved ${spelled.toFixed(2)} m against ${walked.toFixed(2)} m free — `
      + 'a code that costs no ground costs nothing');
    return `1 s of held W: ${walked.toFixed(2)} m free, ${spelled.toFixed(2)} m while spelling`;
  });

  check('stratagems: a call is charged, cooled, and lands late', () => {
    const b = bench({ force: 400 });
    const S = b.p.stratagems;
    const strike = STRATAGEM_BY_ID.strike;
    S.setArming(true);
    const before = b.p.force;
    for (const c of strike.code) S.feed(c, b.ctx);
    assert(b.p.force < before, 'a call was free');
    assert(S.cooldowns.strike > 0, 'a call left no cooldown');
    // it has NOT happened yet
    assert(!b.hit.length, 'the call landed on the frame it was made — the lead is not a lead');
    let t = 0;
    for (; t < strike.lead + 0.5 && !b.hit.length; t += 1 / 60) S.update(1 / 60, b.ctx);
    assert(b.hit.length, `nothing landed within ${(strike.lead + 0.5).toFixed(1)}s`);
    assert(Math.abs(t - strike.lead) < 0.2,
      `it landed at ${t.toFixed(2)}s against a ${strike.lead}s lead`);

    // …and it cannot be called again while it is cooling
    S.setArming(true);
    const spentBefore = b.p.force;
    for (const c of strike.code) S.feed(c, b.ctx);
    assert(b.p.force === spentBefore, 'a call on cooldown still charged the player');
    return `${strike.cost} Force, landed at ${t.toFixed(2)}s of a ${strike.lead}s lead, `
      + `${strike.cooldown}s cooldown honoured`;
  });

  check('stratagems: a blast goes through the same door a landing does', () => {
    /* `applyKnockback` is where a blow is answered out of the target's own
     * Force pool (see forceResistance, which both sides call). A stratagem
     * that threw bodies with its own arithmetic would be the one blast in the
     * game a Force user could not resist — so this drives a real Enemy and
     * asserts that resisting CHANGED the outcome, which is only possible if
     * the blast used the shared door. */
    /* A FORCE USER AND THE SAME FORCE USER WITH AN EMPTY POOL, and not a
     * droid against a Jedi: `resistForce` returns 0 for anything with no
     * `powers` at all, so a B1 would show the same number either way and this
     * check would pass for a body that could never have resisted. Same
     * archetype, same distance from the centre, one difference. */
    const mk = (b, at, force) => {
      const e = new Enemy(b.world, 'sentinel', at.clone());
      e.position.copy(at);
      e.force = force; e.maxForce = Math.max(force, 1);
      b.world.enemies.push(e);
      return e;
    };
    const b = bench();
    const site = new THREE.Vector3(4, 0, 0);
    const bare = mk(b, new THREE.Vector3(5.2, 0, 0), 0);
    const held = mk(b, new THREE.Vector3(2.8, 0, 0), 400);
    assert(bare.powers && held.powers, 'the fixture archetype has no Force powers to resist with');
    const hp0 = { bare: bare.hp, held: held.hp };
    b.p.stratagems.blast(b.ctx, site, 7.5, 62, 150);
    const tookBare = hp0.bare - bare.hp, tookHeld = hp0.held - held.hp;
    assert(tookBare > 0, 'the blast did nothing to a body 1.2 m from the centre');
    assert(tookHeld < tookBare,
      `a body with 400 Force took ${tookHeld.toFixed(0)} and one with none took ${tookBare.toFixed(0)} `
      + '— the blast is not going through applyKnockback');
    assert(held.force < 400, 'resisting the blast cost the target nothing');
    assert(b.hit.some(h => h.kind === 'crater'), 'the blast left no crater');
    return `1.2 m out: ${tookBare.toFixed(0)} hp unresisted, ${tookHeld.toFixed(0)} hp against `
      + `400 Force (${(400 - held.force).toFixed(0)} spent)`;
  });

  check('stratagems: it does not spare the person who called it', () => {
    /* A support call with no friendly fire is a button with no downside, and
     * the lead time only means something if the marked circle is somewhere you
     * must not be standing. */
    const b = bench();
    const hp0 = b.p.hp;
    b.p.stratagems.blast(b.ctx, b.p.position.clone(), 7.5, 62, 150);
    assert(b.p.hp < hp0, 'standing in your own orbital strike is free');
    const took = hp0 - b.p.hp;
    assert(took < 150, `it hit the caller for the full ${took.toFixed(0)} — the caller knew it was coming`);
    return `dead centre of your own strike: ${took.toFixed(0)} hp`;
  });

  check('smoke: the screen actually blinds, and it blinds both ways', () => {
    /**
     * THE CARD SAYS "Nothing on either side can shoot what it cannot see" and
     * what shipped was sixty dust particles. A card promising a mechanic the
     * game does not have is worse than no card: the player spends Force on it,
     * stands behind it, and is shot.
     *
     * So the claim is measured as an INTEGRAL and not as a flag: how much
     * cloud a given line passes through, in the same units a bolt reads. A
     * line through the middle of a bank must be worth far less than one
     * clipping its edge, or the mechanic is a wall with a hole in it.
     */
    clearSmoke();
    const at = (x, z) => new THREE.Vector3(x, 0, z);
    addSmoke(at(0, 0), 8.5, 11);
    updateSmoke(BLOOM + 0.01);                      // let it bloom to full
    assert(smokeClouds().length === 1, 'the cloud was not registered');

    const across = depthAlong(at(-20, 0), at(20, 0));      // straight through the middle
    const edge = depthAlong(at(-20, 8.0), at(20, 8.0));    // clipping the top
    const miss = depthAlong(at(-20, 30), at(20, 30));      // nowhere near it
    assert(miss === 0, `a line 30 m from a 8.5 m cloud reads ${miss.toFixed(2)} of depth`);
    assert(across > edge * 2.5,
      `through the middle reads ${across.toFixed(2)} and along the edge ${edge.toFixed(2)} — `
      + 'a cloud that costs the same wherever you cross it is a wall with no shape');
    assert(across >= OPAQUE,
      `the middle of a full-sized bank reads ${across.toFixed(2)} against an opaque depth of `
      + `${OPAQUE} — a bolt goes straight through the thickest part of a smoke screen`);
    assert(seeThrough(at(-20, 0), at(20, 0)) < 0.15,
      'a sightline through the middle of the bank is still most of the way clear');
    assert(seeThrough(at(-20, 30), at(20, 30)) === 1, 'a line nowhere near the smoke is not clear');

    /* IT BLOOMS AND IT THINS. A round that was instantly a wall would be a
     * dodge you cannot react to, and one that vanished on a frame boundary
     * would take cover away from a player mid-crossing. */
    clearSmoke();
    addSmoke(at(0, 0), 8.5, 11);
    const fresh = depthAlong(at(-20, 0), at(20, 0));
    updateSmoke(BLOOM);
    const full = depthAlong(at(-20, 0), at(20, 0));
    assert(fresh < full * 0.5, `a cloud is ${(100 * fresh / full).toFixed(0)}% dense on the frame it lands`);
    updateSmoke(11);
    assert(!smokeClouds().length, 'the cloud outlived its own life');
    assert(depthAlong(at(-20, 0), at(20, 0)) === 0, 'an expired cloud still blinds');
    return `middle ${across.toFixed(2)} vs edge ${edge.toFixed(2)} vs clear 0.00; `
      + `${(100 * fresh / full).toFixed(0)}% dense on arrival, gone at its life`;
  });

  check('smoke: a bolt through it arrives weaker, bent, or not at all', () => {
    /* THROUGH THE REAL BoltPool, because "the model says so" and "the bolt
     * that reaches you is weaker" are different claims and only the second one
     * is the feature. Three bolts on three lines through the same bank. */
    clearSmoke();
    const b = bench();
    const pool = new BoltPool(b.world.scene, 64);
    const fire = (z) => {
      const bolt = pool.fire(new THREE.Vector3(-14, 1, z), new THREE.Vector3(1, 0, 0),
        { speed: 90, damage: 24, team: 'red', life: 3 });
      return bolt;
    };
    const run = (z, seconds = 0.35) => {
      const bolt = fire(z);
      const d0 = bolt.damage;
      for (let i = 0; i < seconds * 60 && bolt.active; i++) {
        pool.update(1 / 60, { blades: null, enemies: [], player: null });
      }
      return { d0, d: bolt.damage, active: bolt.active, dir: bolt.vel.clone().normalize() };
    };
    const clear = run(40);
    assert(Math.abs(clear.d - clear.d0) < 1e-6,
      `a bolt nowhere near smoke lost ${(clear.d0 - clear.d).toFixed(1)} damage`);

    addSmoke(new THREE.Vector3(0, 1, 0), 8.5, 11);
    updateSmoke(BLOOM + 0.01);
    const through = run(0);
    const grazed = run(8.0);
    assert(!through.active,
      `a bolt through the middle of a full bank came out the other side with `
      + `${through.d.toFixed(1)} of its ${through.d0} damage`);
    assert(grazed.d < grazed.d0 * 0.8,
      `a bolt clipping the edge kept ${(100 * grazed.d / grazed.d0).toFixed(0)}% of its damage`);
    assert(grazed.d > 0, 'the edge of a cloud absorbs a bolt outright — it is meant to be a gamble');
    const bend = Math.acos(Math.max(-1, Math.min(1, grazed.dir.x))) * 180 / Math.PI;
    assert(bend > 0.05, 'a bolt through smoke came out on exactly the line it went in on');
    clearSmoke();
    return `clear ${clear.d.toFixed(0)}/${clear.d0}; edge ${grazed.d.toFixed(0)}/${grazed.d0} `
      + `bent ${bend.toFixed(1)}°; middle absorbed`;
  });

  check('dive: attacking in the air drives you into the ground, hard', () => {
    /**
     * THE DIVE IS A VELOCITY AND NOTHING ELSE — see `_tryDive`. Everything the
     * attack does when it arrives is `_land`'s, keyed off the speed a body
     * came down at, so the only thing to measure here is that it produces that
     * speed and that it refuses when it should.
     *
     * Two refusals, and both matter. A dive with the ground under your feet is
     * not a dive; a dive from a kerb should not shake the field, which is what
     * DIVE_CLEAR is for. Without them the attack is a free stomp on a button
     * that is also the ordinary stab.
     */
    const b = bench();
    const p = b.p;

    // on the ground: nothing
    p.grounded = true;
    assert(p._tryDive(b.ctx) === false, 'a dive fired with both feet on the sand');

    // in the air but too low: nothing
    p.grounded = false;
    p.position.set(0, 0.6, 0);
    p.velocity.set(0, -1, 0);
    assert(p._tryDive(b.ctx) === false,
      `a dive fired from 0.6 m up — below DIVE_CLEAR there is nothing to fall from`);

    // in the air and still rising: that is a jump, not a dive
    p.position.set(0, 6, 0);
    p.velocity.set(0, 8, 0);
    assert(p._tryDive(b.ctx) === false, 'a dive fired on the way UP');

    // high, falling, with stamina: a slam
    p.velocity.set(3, -1, 0);
    p.stamina = 100;
    const st0 = p.stamina;
    assert(p._tryDive(b.ctx) === true, 'a dive from 6 m up while falling did not fire');
    assert(p.velocity.y < -25,
      `the dive left the body falling at ${(-p.velocity.y).toFixed(1)} m/s — under the 15 m/s `
      + '`_land` needs before it cracks the ground, the dive is just a fall');
    assert(Math.abs(p.velocity.x) < 3 * 0.5,
      'the dive kept full horizontal speed — a slam that carries the whole run is a long jump');
    assert(Math.abs(p.velocity.x) > 0.1,
      'the dive zeroed the horizontal — a slam that stops you dead in the air reads as a wall');
    assert(p.stamina < st0, 'the dive was free');
    assert(p.diving, 'the dive did not mark the body as committed');
    assert(p._tryDive(b.ctx) === false, 'a second dive fired while the first was still falling');
    return `refused grounded / at 0.6 m / rising; fired at 6 m into `
      + `${(-p.velocity.y).toFixed(0)} m/s for ${(st0 - p.stamina).toFixed(0)} stamina`;
  });

  check('dive: landing from one hits harder than arriving at the same speed', () => {
    /**
     * The dive's whole claim on being an ATTACK rather than a fall is
     * `DIVE_LAND`, and it is one multiplier on a landing that already exists
     * rather than a second landing path. So: two identical landings at the
     * same speed on the same ground, one of them committed, and the bodies
     * standing next to them compared.
     *
     * Same archetype, same distance, same impact speed. The only difference is
     * the flag.
     */
    const land = (dove) => {
      const b = bench();
      const e = new Enemy(b.world, 'b1', new THREE.Vector3(2.2, 0, 0));
      e.position.set(2.2, 0, 0);
      b.world.enemies.push(e);
      b.ctx.enemies = b.world.enemies;
      const hp0 = e.hp;
      b.p.position.set(0, 0, 0);
      b.p.diving = dove;
      b.p._land(b.ctx, 30);
      return { took: hp0 - e.hp, moved: Math.hypot(e.velocity.x, e.velocity.z), diving: b.p.diving };
    };
    const fell = land(false);
    const dove = land(true);
    assert(fell.took > 0, 'a 30 m/s landing did nothing to a body 2.2 m away — the bench is wrong');
    assert(dove.took > fell.took * 1.3,
      `a dive landing took ${dove.took.toFixed(0)} hp against a fall's ${fell.took.toFixed(0)} — `
      + 'the blade in it is worth nothing');
    assert(dove.moved > fell.moved,
      'a dive landing threw the body no further than an accident at the same speed');
    assert(!dove.diving,
      '`diving` survived the landing — the next accidental fall would land as a dive');
    return `2.2 m away: fall ${fell.took.toFixed(0)} hp / ${fell.moved.toFixed(1)} m/s, `
      + `dive ${dove.took.toFixed(0)} hp / ${dove.moved.toFixed(1)} m/s`;
  });

  check('stratagems: a call needing an army is not offered without one', () => {
    const solo = bench();
    const army = bench({ command: { formation: 'line', reinforce() {}, rallyNear: () => 0 } });
    const soloIds = solo.p.stratagems.available(solo.ctx).map(s => s.id);
    const armyIds = army.p.stratagems.available(army.ctx).map(s => s.id);
    const gated = STRATAGEMS.filter(s => s.commandOnly).map(s => s.id);
    assert(gated.length, 'no call is marked commandOnly — this check is measuring nothing');
    for (const id of gated) {
      assert(!soloIds.includes(id), `${id} is offered with no army behind you`);
      assert(armyIds.includes(id), `${id} is not offered even in Command`);
    }
    /* …and the gate is on the OFFER, not only on the effect: a code that can
     * be spelled and then refuses is a menu item that lies. */
    const S = solo.p.stratagems;
    S.setArming(true);
    const first = STRATAGEM_BY_ID[gated[0]];
    let out = null;
    for (const c of first.code) out = S.feed(c, solo.ctx);
    assert(out !== first, `${first.id} was spelled to completion with no army`);
    return `${gated.join(', ')} hidden solo, offered in Command`;
  });
}
