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
  callPhrase, phraseFaults, PREAMBLE, leadOf, AIM_REACH, LOCK_CONE, DESIGNATE_MAX,
} from '../../src/game/Stratagems.js';
import { SortieDirector, PROFILES, PASS_START } from '../../src/game/Sorties.js';
import { ACTIONS, defaultBindings } from '../../src/engine/Bindings.js';
import { installTeamDamage } from '../../src/game/Command.js';
import {
  addSmoke, updateSmoke, clearSmoke, depthAlong, seeThrough, smokeClouds,
  DENSITY, OPAQUE, BLOOM,
} from '../../src/game/Smoke.js';
import { BoltPool } from '../../src/game/Bolts.js';
import { clocked } from './_shared.mjs';

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

/**
 * PUT THE EYES WHERE A STANDING BODY'S EYES ARE.
 *
 * `_aimSite` walks forward from `p.chest`, which the RIG writes during a
 * posed frame. A bench player has never been posed, so its chest sits at
 * y = 0 — and a beam cast downward from ground level hits the ground on its
 * first 1.2 m step, whatever it was aimed at. That is a fixture artefact and
 * it reads exactly like the defect this check exists to catch, so it is fixed
 * here, once, and named.
 */
const CHEST_Y = 1.42;
function eyes(p) { (p.chest ?? p.position).set(p.position.x, p.position.y + CHEST_Y, p.position.z); }

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
    engine: { addHeat() {}, hurt() {}, shake() {}, punch() {}, rumble() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    /* A body big enough to leave wreckage asks for this on the way down, and
     * the strike fixture kills AATs and walkers. A bench that stubs it is a
     * bench; a bench that does not is a bench that measures `TypeError`. */
    spawnDebrisGroup() {}, spawnDebris() {},
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
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
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

  check('stratagems: spelling a code opens a designation, and a wrong letter fails it', () => {
    /**
     * THE PREMISE OF THIS CHECK CHANGED, AND IT SAYS SO.
     *
     * It used to assert that the last letter QUEUED the call. It cannot any
     * more and must not: player note #31 is that a call landing where the
     * crosshair happened to be on the frame the code finished is "useless",
     * and the answer is that finishing the code opens a DESIGNATION instead.
     * So the assertion moves one step along — the letters have to open the
     * phase, and the phase has to be what queues — and everything the old
     * version was really protecting (a wrong letter fails, a completed code
     * clears the entry, walking spells nothing) is kept verbatim.
     */
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
    assert(S.designating && S.designating.s.id === 'strike',
      'the completed code did not open a designation — there is nothing to aim');
    assert(!S.pending.length,
      'the call queued on the last letter, at whatever the crosshair was over — that is the '
      + 'defect note #31 describes');
    assert(S.entry === '', 'the entry did not clear after a completed code');

    /* …and letting go of the key SENDS it. One key does the whole call: hold,
     * speak, paint, release. */
    S.setArming(false);
    assert(!S.designating, 'releasing the key left the designation open');
    assert(S.pending.length === 1, 'releasing the key did not send the call');

    /* A WRONG LETTER IS A FAILED CODE, not a character to backspace. The
     * alternative — ignoring letters that lead nowhere — means a code can be
     * entered with arbitrary garbage in the middle of it, and a player who
     * fumbled would get a call they did not ask for. */
    const c2 = bench();
    const S2 = c2.p.stratagems;
    S2.setArming(true);
    /**
     * THE DEAD BRANCH IS SEARCHED FOR, NOT ASSUMED TO BE AT DEPTH ONE.
     *
     * It used to take the orbital strike's first letter and look for a second
     * direction that no row continues. That held while the table was seven
     * rows and stopped holding at eighteen: at seed 1 all four directions after
     * the lance's opening letter now lead somewhere, and the fixture failed
     * with "every second letter leads somewhere" — which is a property of the
     * table having got denser, not a defect in the entry machine.
     *
     * So it walks the whole tree for the SHORTEST live prefix with a dead
     * continuation. One exists by construction: eighteen codes cannot fill
     * 4^5 spellings, let alone 4^8. What is being measured is unchanged — a
     * letter that leads nowhere is refused and clears the entry.
     */
    let live = '', dead = '';
    outer: for (const row of STRATAGEMS) {
      for (let k = 1; k < row.code.length; k++) {
        const pre = row.code.slice(0, k);
        const d = DIRS.find(x => !STRATAGEMS.some(o => o.code.startsWith(pre + x)));
        if (d) { live = pre; dead = d; break outer; }
      }
    }
    assert(dead, `no dead branch anywhere in ${STRATAGEMS.length} codes — the space is full`);
    for (const c of live) {
      assert(S2.feed(c, c2.ctx) === null, `${live} is a live prefix and ${c} went nowhere`);
    }
    assert(S2.feed(dead, c2.ctx) === false, 'a letter that leads nowhere was accepted');
    assert(S2.entry === '', 'a failed code left the entry standing');
    return `${strike.code} → designation → release → queued; ${spell(live + dead)} → refused and cleared`;
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

  check('stratagems: the lock holds the dash and the jump too, and says so', () => {
    /**
     * THE CHECK ABOVE MEASURED THE ONE VERB THAT WAS LOCKED.
     *
     * `_move` zeroes the move axis while `stratagems.arming` and its own note
     * calls that the price the whole mechanic is built on — "you stop, in the
     * open, for as long as the code takes". Two other verbs walked straight
     * past it. `_tryDash` reads `ctx.input.moveAxis()` FRESH, after the
     * zeroing, so it kept its direction; the jump block was never guarded at
     * all. Measured through this fixture on the shipped code: arming + run
     * 0.00 m of travel, arming + dash 3.87 m WITH 0.16 s of invulnerability,
     * arming + jump a 4.32 m apex. The WASD you spell a code with is the same
     * WASD that aims the dash, so the escape was aimed.
     *
     * Driven through `update` rather than `_move`, because the defect was in
     * the two paths `_move` does not own — a check that calls `_move` cannot
     * see either of them, which is why the one above did not.
     */
    const held = new Set(['moveF']), hits = new Set();
    const b = bench();
    b.ctx.input = stubInput(held, hits);
    b.world.notices = [];
    b.world.notify = (t, d) => b.world.notices.push(`${t} — ${d}`);
    const frame = (i) => { b.world.time = b.ctx.time = i / 60; b.p.update(1 / 60, b.ctx); hits.clear(); };

    const runs = {};
    for (const verb of ['run', 'dash', 'jump']) {
      const c = bench();
      c.ctx.input = stubInput(held, hits);
      c.world.notices = [];
      c.world.notify = (t, d) => c.world.notices.push(`${t} — ${d}`);
      /* THE KEY IS HELD, not the flag set: `_stratagemInput` runs inside
       * `update` and writes `arming` from the input every frame, so a fixture
       * that set the flag by hand would have it cleared on the first step. */
      held.add('stratagem');
      const start = c.p.position.clone();
      let apex = 0, invuln = 0;
      for (let i = 0; i < 60; i++) {
        if (i === 3 && verb !== 'run') hits.add(verb);
        if (verb === 'jump' && i > 3 && i < 40) held.add('jump'); else held.delete('jump');
        c.world.time = c.ctx.time = i / 60;
        c.p.update(1 / 60, c.ctx);
        hits.clear();
        apex = Math.max(apex, c.p.position.y);
        invuln = Math.max(invuln, c.p.invuln);
      }
      held.delete('jump'); held.delete('stratagem');
      runs[verb] = { moved: Math.hypot(c.p.position.x - start.x, c.p.position.z - start.z),
        apex, invuln, notices: c.world.notices.slice() };
      assert(c.p.stratagems.arming, `the ${verb} run stopped spelling part way through — the fixture lost the lock`);
    }

    assert(runs.run.moved < 0.05, `holding W while spelling still moved ${runs.run.moved.toFixed(2)} m`);
    assert(runs.dash.moved < 0.25,
      `a dash while spelling carried the player ${runs.dash.moved.toFixed(2)} m out of a lock that held a `
      + `run to ${runs.run.moved.toFixed(2)} m`);
    assert(runs.dash.invuln === 0,
      `a dash while spelling bought ${runs.dash.invuln.toFixed(2)}s of invulnerability`);
    assert(runs.jump.apex < 0.05,
      `a jump while spelling reached ${runs.jump.apex.toFixed(2)} m — the ground you are supposed to be `
      + 'standing on is the price of the call');

    /* AND NEITHER REFUSAL IS SILENT. `_refuse`'s own header is the rule — a
     * bound key that does nothing and does not say why is the same lie as a
     * dead checkbox — and a player pressing dash in a panic while spelling has
     * to be told which of the two the game is honouring. */
    for (const verb of ['dash', 'jump']) {
      assert(runs[verb].notices.some((n) => /stratagem/i.test(n)),
        `${verb} was refused in silence while spelling: ${JSON.stringify(runs[verb].notices)}`);
    }
    return `spelling: run ${runs.run.moved.toFixed(2)} m, dash ${runs.dash.moved.toFixed(2)} m `
      + `(invuln ${runs.dash.invuln.toFixed(2)}), jump apex ${runs.jump.apex.toFixed(2)} m; both refusals spoken`;
  });

  check('stratagems: a call is charged when it is SPOKEN, and lands late', () => {
    /**
     * WHERE THE PRICE IS TAKEN IS A DESIGN CALL AND THIS IS IT.
     *
     * The Force and the cooldown go at the moment the code is finished — the
     * moment the player stood in the open and said the whole call out loud —
     * and NOT at the release. A designation that could be abandoned for free
     * would be a free look at the field on a key the player is already
     * holding, and the cost the whole mechanic is priced on is the asking.
     */
    const b = bench({ force: 400 });
    const S = b.p.stratagems;
    const strike = STRATAGEM_BY_ID.strike;
    S.setArming(true);
    const before = b.p.force;
    for (const c of strike.code) S.feed(c, b.ctx);
    assert(b.p.force < before, 'a call was free');
    assert(S.cooldowns.strike > 0, 'a call left no cooldown');
    assert(!b.hit.length, 'the call landed on the frame it was spoken');
    S.setArming(false);
    const lead = leadOf(strike);
    assert(lead > 1, `the lance's lead is ${lead}s — there is no time to be somewhere else`);
    let t = 0;
    for (; t < lead + 0.5 && !b.hit.length; t += 1 / 60) S.update(1 / 60, b.ctx);
    assert(b.hit.length, `nothing landed within ${(lead + 0.5).toFixed(1)}s`);
    assert(Math.abs(t - lead) < 0.2, `it landed at ${t.toFixed(2)}s against a ${lead.toFixed(2)}s lead`);

    // …and it cannot be called again while it is cooling
    S.setArming(true);
    const spentBefore = b.p.force;
    for (const c of strike.code) S.feed(c, b.ctx);
    assert(b.p.force === spentBefore, 'a call on cooldown still charged the player');
    assert(!S.designating, 'a call on cooldown still opened a designation to place');
    return `${strike.cost} Force at the last word, landed at ${t.toFixed(2)}s of a `
      + `${lead.toFixed(2)}s lead, ${strike.cooldown}s cooldown honoured`;
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

  check('smoke: a shooter behind it stops shooting, and so does yours', () => {
    /**
     * THE OTHER HALF OF THE CARD. "Nothing on either side can shoot what it
     * cannot see" — and until the sightline knew about smoke, the cloud only
     * degraded the BOLT. A shooter in front of a wall of it still picked its
     * target, still aimed and still fired: a damage filter, not a screen.
     *
     * Driven through the real `_hasLineOfSight`, which is the ONE place in the
     * game that asks the question, so this is measuring the thing the shooter
     * actually consults and not a parallel model.
     *
     * SYMMETRY IS ASSERTED AND NOT ASSUMED. The same body is asked from both
     * ends of the same line, because a screen that blinded one side would be a
     * free win rather than a decision — and in Command mode the allies are
     * `Enemy` instances too, so a one-sided rule would be the player's own
     * line shooting out of a cloud their enemies cannot shoot into.
     */
    clearSmoke();
    const b = bench();
    const shooter = new Enemy(b.world, 'trooper', new THREE.Vector3(0, 0, -14));
    b.world.enemies.push(shooter);
    shooter.target = b.p;
    const ctx = { ...b.ctx, physics: b.world.physics, terrain: null };
    /* THE MUZZLE IS ON THE RIG, not on `position` — `_muzzleWorld` walks the
     * skeleton — so a body moved by writing `position` alone still shoots from
     * wherever its bones were last solved. Moving it properly is what makes
     * this a measurement of the sightline rather than of a stale matrix: the
     * first version of this fixture put a 14 m shooter's muzzle 0.5 m from the
     * player's chest and concluded the smoke did nothing. */
    const place = (x, z) => {
      shooter.position.set(x, 0, z);
      if (shooter.rig) { shooter.rig.root.position.copy(shooter.position); shooter.rig.updateMatrices(); }
    };
    place(0, -14);
    // The line the shipped code will actually use, asked of the shipped code.
    const line = () => [shooter._muzzleWorld(new THREE.Vector3()),
      (b.p.chest ?? b.p.position).clone()];
    const [m0, c0] = line();
    assert(m0.distanceTo(c0) > 10,
      `the fixture's sightline is only ${m0.distanceTo(c0).toFixed(1)} m long — the body did not move`);
    assert(shooter._hasLineOfSight(ctx), 'the fixture cannot see the player in clear air');

    // a bank on the midpoint of the line the shooter is actually using
    const mid = m0.clone().lerp(c0, 0.5);
    addSmoke(mid, 8.5, 11);
    updateSmoke(BLOOM + 0.01);
    assert(!shooter._hasLineOfSight(ctx),
      `a shooter ${m0.distanceTo(c0).toFixed(0)} m away is still picking its shot through a full `
      + `smoke bank (transmittance ${seeThrough(m0, c0).toFixed(3)})`);

    /* THE BANK HAS A WIDTH, or it is an on/off wall and standing near one is
     * the same as standing in one.
     *
     * Measured by walking the CLOUD off the line rather than the shooter off
     * it: moving the shooter pivots the line about the player, so the cloud
     * sitting at its midpoint stays on it for a very long way and what that
     * sweep measures is trigonometry rather than the screen. Stepping the
     * cloud sideways is the direct question — how far off a sightline does a
     * bank have to be before it stops mattering. */
    let clearAt = null;
    for (let off = 1; off <= 14 && clearAt === null; off++) {
      clearSmoke();
      addSmoke(mid.clone().setX(mid.x + off), 8.5, 11);
      updateSmoke(BLOOM + 0.01);
      if (shooter._hasLineOfSight(ctx)) clearAt = off;
    }
    assert(clearAt !== null,
      'a bank fourteen metres off the sightline still blinds — the cloud has no edge');
    assert(clearAt > 3,
      `the sightline came back with the bank only ${clearAt} m off it — an 8.5 m cloud with a `
      + 'three-metre reach is a wall with the wrong radius');
    clearSmoke();
    addSmoke(mid, 8.5, 11);
    updateSmoke(BLOOM + 0.01);

    // …and it blinds the other way too, from the player's own eye back.
    place(0, -14);
    assert(seeThrough(b.p.chest ?? b.p.position, shooter._muzzleWorld(new THREE.Vector3())) < 0.3,
      'the line reads clear from the player back down it — the screen is one-sided');
    clearSmoke();
    assert(shooter._hasLineOfSight(ctx), 'the sightline never came back after the cloud expired');
    return `clear → sees; a full bank on the line → blind; the same bank ${clearAt} m off it → `
      + 'sees again; blind in both directions';
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

  check('stratagems: every keystroke is a word, and the phrase fits the code', () => {
    /**
     * PLAYER NOTE #31: *"you hold up your wrist and speak into it, every
     * keystroke a word"*. A code was silent. It is a radio call now, and the
     * only way that can be true is if the phrase is exactly as long as the
     * code — a phrase one word short is a keystroke with nothing to say, and
     * one word long is a call that ends mid-sentence.
     *
     * The length is DERIVED at both ends (`codeLength` off the price,
     * `callPhrase` off that), so this is asserted over every row of every one
     * of two hundred deals rather than over the opening hand. `phraseFaults`
     * is the shipped detector and is called rather than reimplemented, for the
     * reason HANDOFF §2.3 gives; what this adds is that it is RUN, and that it
     * detects.
     */
    let words = 0;
    for (let seed = 1; seed <= 200; seed++) {
      rollCodes(seed);
      const faults = phraseFaults();
      assert(!faults.length, `seed ${seed}: ${faults.join('; ')}`);
      for (const row of STRATAGEMS) {
        const ph = callPhrase(row);
        assert(ph.length === row.code.length,
          `seed ${seed}: ${row.id} spells in ${row.code.length} and says ${ph.length} words`);
        assert(ph.every(w => typeof w === 'string' && w.length),
          `seed ${seed}: ${row.id} has an empty word in "${ph.join(' ')}"`);
        /* THE TAIL IS ALWAYS THE ROW'S OWN. The preamble is what gets clipped
         * off a cheap call, because the important half of a radio call is the
         * thing you are asking for. */
        assert(ph.slice(-row.words.length).join(' ') === row.words.join(' '),
          `${row.id}'s phrase "${ph.join(' ')}" does not end in its own words`);
        words += ph.length;
      }
    }
    // …and the detector detects, so a green result means something.
    const short = phraseFaults([{ id: 'x', cost: 40, words: ['go'] }]);
    assert(short.length, 'phraseFaults does not notice a phrase that is the wrong length');
    const none = phraseFaults([{ id: 'y', cost: 12 }]);
    assert(none.length, 'phraseFaults does not notice a row with no words at all');

    /* THE MOUTH AND THE PANEL READ THE SAME DERIVATION. `wordAt` is what
     * `Player._stratagemInput` speaks and what the HUD prints, and it has to
     * walk the phrase in step with the entry or the player hears one word and
     * reads another. */
    rollCodes(1);
    const b = bench();
    const S = b.p.stratagems;
    const strike = STRATAGEM_BY_ID.strike;
    S.setArming(true);
    const heard = [];
    for (const c of strike.code) { heard.push(S.wordAt(b.ctx)); S.feed(c, b.ctx); }
    assert(heard.join(' ') === callPhrase(strike).join(' '),
      `spelling the lance said "${heard.join(' ')}" against a phrase of `
      + `"${callPhrase(strike).join(' ')}"`);
    return `${words} words over 200 deals, every phrase the length of its code; `
      + `the lance says "${callPhrase(strike).join(' ')}"`;
  });

  check('stratagems: you AIM it — where you look, not where you stand', () => {
    /**
     * PLAYER NOTE #31: *"right now it's just where you're literally standing,
     * useless. you need to be able to place it where you want to specifically
     * or target what you want to target"*.
     *
     * Three claims, and each is a different way the complaint could still be
     * true after a fix:
     *
     *  1. THE MARK IS NOT THE PLAYER. It moves with the aim, a long way from
     *     the body, and two different aims put it in two different places.
     *  2. IT IS CAPPED. `AIM_REACH`, so a stratagem is not a map-wide finger.
     *  3. THE TERRAIN STOPS IT. Aiming over a ridge marks the near face of the
     *     ridge and not the ground behind it — which is the line-of-sight rule,
     *     and it is the SAME walk rather than a second test to keep in step.
     */
    const b = bench();
    const S = b.p.stratagems;
    const strike = STRATAGEM_BY_ID.strike;
    const mark = (yaw, pitch) => {
      const c = bench();
      c.p.position.set(0, 0, 0);
      c.p.camera.yaw = yaw; c.p.camera.pitch = pitch;
      c.p.camera.syncAim();
      /* `aimDir` IS WRITTEN BY `_updateCamera` AND NOT BY `syncAim` — the rig
       * holds the quaternion, the player holds the vector, and `_aimSite`
       * reads the vector. A fixture that set the rig and not the vector was
       * marking along a default −Z and measuring nothing. */
      c.p.camera.aimDirection(c.p.aimDir);
      eyes(c.p);
      const T = c.p.stratagems;
      T.setArming(true);
      for (const ch of strike.code) T.feed(ch, c.ctx);
      assert(T.designating, 'the code did not open a designation');
      return { at: T.designating.site.clone(), p: c.p.position.clone() };
    };
    const north = mark(0, -0.15);
    const east = mark(Math.PI / 2, -0.15);
    assert(north.at.distanceTo(north.p) > 5,
      `the mark landed ${north.at.distanceTo(north.p).toFixed(2)} m from the player — that is `
      + 'still "where you are literally standing"');
    assert(north.at.distanceTo(east.at) > 5,
      `two aims 90° apart marked the same place (${north.at.distanceTo(east.at).toFixed(2)} m apart)`);

    // 2. capped, and a call aimed at the sky lands at the cap
    /* A CALL AIMED AT THE SKY LANDS AT THE CAP, which is the honest answer to
     * "there is nothing there" — and the cap is on the RAY, so the ground it
     * puts the mark on is nearer than `AIM_REACH` by the cosine of the pitch.
     * Asserting the ray rather than the ground is what makes this a statement
     * about the reach instead of about the angle it was measured at. */
    const sky = mark(0, 0.9);
    const far = sky.at.distanceTo(sky.p);
    const ray = Math.hypot(far, 0) / Math.max(0.05, Math.cos(0.9));
    assert(far <= AIM_REACH + 2,
      `aiming at the sky marked ${far.toFixed(0)} m from the caller, past a ${AIM_REACH} m reach`);
    assert(Math.abs(ray - AIM_REACH) < 8,
      `aiming at the sky ran the beam ${ray.toFixed(0)} m against a ${AIM_REACH} m cap — `
      + 'the cap is not the answer given');

    // 3. the terrain is the line of sight
    const ridge = bench();
    /* A wall 12 m in front of the player. `height` is the whole terrain
     * contract `_aimSite` reads, so a fixture that answers it is the real
     * question asked of a real ridge. */
    ridge.ctx.terrain = { ...ridge.world.terrain, height: (x, z) => (z > 10 && z < 14 ? 14 : 0) };
    ridge.p.position.set(0, 0, 0);
    ridge.p.camera.yaw = Math.PI; ridge.p.camera.pitch = 0.02;
    ridge.p.camera.syncAim();
    ridge.p.camera.aimDirection(ridge.p.aimDir);
    eyes(ridge.p);
    const R = ridge.p.stratagems;
    R.setArming(true);
    for (const ch of strike.code) R.feed(ch, ridge.ctx);
    const at = R.designating.site;
    assert(at.z < 15,
      `the beam marked ground ${at.z.toFixed(1)} m out, on the far side of a wall at 10-14 m — `
      + 'a designator that reaches through terrain has no line-of-sight rule at all');
    return `aim 90° apart → marks ${north.at.distanceTo(east.at).toFixed(0)} m apart, `
      + `${north.at.distanceTo(north.p).toFixed(0)} m from the caller; sky → ${far.toFixed(0)} m cap; `
      + `a ridge stops it at ${at.z.toFixed(1)} m`;
  });

  check('stratagems: a designated BODY is followed, and a dead one is not', () => {
    /**
     * "…or target what you want to target". The other half of the aim: the
     * beam latches onto a body inside `LOCK_CONE` of the line, and from then
     * until impact the site is wherever that body IS. That is the answer to
     * "what happens if the target moves", and it has to be measured as a
     * position rather than read as a flag.
     *
     * AND THE ANSWER TO "what if it dies" is that the site FREEZES. The round
     * has left the ship; orbit does not get a refund. A check that only
     * asserted the tracking would be green for an implementation that threw on
     * a dead reference in the middle of `World.update`.
     */
    const b = bench({ force: 400 });
    const strike = STRATAGEM_BY_ID.strike;
    const e = new Enemy(b.world, 'walker', new THREE.Vector3(0, 0, -30));
    e.position.set(0, 0, -30);
    b.world.enemies.push(e);
    b.p.position.set(0, 0, 0);
    /* YAW 0 LOOKS DOWN −Z, which is where the walker is standing. `aimDir` is
     * the vector `_aimSite` and `_designate` both read, and a body BEHIND the
     * ray is correctly ignored — so a fixture facing the wrong way measures
     * that refusal rather than the latch. */
    b.p.camera.yaw = 0; b.p.camera.pitch = -0.02;
    b.p.camera.syncAim();
    b.p.camera.aimDirection(b.p.aimDir);
    eyes(b.p);
    const S = b.p.stratagems;
    S.setArming(true);
    for (const c of strike.code) S.feed(c, b.ctx);
    assert(S.designating, 'no designation opened');
    assert(S.designating.lock === e,
      `the beam passed within ${LOCK_CONE} m of a 620 hp walker and marked the ground instead`);
    S.setArming(false);
    const P = S.pending[0];
    assert(P && P.lock === e, 'the call was sent without the lock it was given');

    // it walks away — and the call goes with it
    e.position.set(11, 0, -34);
    S.update(1 / 60, b.ctx);
    assert(P.site.distanceTo(e.position) < 1.5,
      `the walker moved 11 m and the lance stayed ${P.site.distanceTo(e.position).toFixed(1)} m `
      + 'behind it — the mark is on the ground, not on the target');

    // …and when it dies, the mark stops where it last stood
    const lastSeen = P.site.clone();
    e.dead = true;
    e.position.set(60, 0, -60);
    S.update(1 / 60, b.ctx);
    assert(P.lock === null, 'the call is still following a dead body');
    assert(P.site.distanceTo(lastSeen) < 0.5,
      'the mark followed the corpse rather than freezing where the target last stood');

    /* AND A ROW THAT MAY NOT TRACK DOES NOT. A gun run is flown along a line
     * the pilot has committed to; being re-tasked in flight would make it a
     * second, better lance. */
    const c2 = bench({ force: 400 });
    const run = STRATAGEM_BY_ID.strafe;
    assert(run.track === false, 'the strafing run is allowed to latch onto a body');
    const e2 = new Enemy(c2.world, 'walker', new THREE.Vector3(0, 0, -30));
    e2.position.set(0, 0, -30);
    c2.world.enemies.push(e2);
    c2.p.camera.yaw = 0; c2.p.camera.pitch = -0.02;
    c2.p.camera.syncAim();
    c2.p.camera.aimDirection(c2.p.aimDir);
    eyes(c2.p);
    const S2 = c2.p.stratagems;
    S2.setArming(true);
    for (const c of run.code) S2.feed(c, c2.ctx);
    assert(S2.designating && !S2.designating.lock,
      'a gun run latched onto a body it is not allowed to follow');
    return `a walker 30 m out is taken by the beam, followed 11 m, and released when it dies; `
      + `a gun run marks ground only`;
  });

  check('stratagems: something is IN THE AIR for the whole lead', () => {
    /**
     * PLAYER NOTE #31: *"it's not immediate. you should be able to see the ship
     * come in and attack and bomb or do a strafing run or drop smoke. like
     * right now there's just nothing"*.
     *
     * The lead was a number with nothing in it. What this asserts is the two
     * things that make it an event instead:
     *
     *  1. A CRAFT EXISTS, in the scene, from the commit until the effect. Not
     *     "a sortie was requested" — a group with a position that MOVES.
     *  2. THE PAYLOAD LEAVES IT WHERE IT IS. The lead is derived from the
     *     flight (`leadOf` → `SortieDirector.leadOf`), so a bomb cannot be
     *     released at a place its ship is not, and this measures the distance
     *     between the craft and the mark at the moment the cadence fires.
     */
    const b = bench({ force: 400 });
    const run = STRATAGEM_BY_ID.strafe;
    assert(run.deliver && PROFILES[run.deliver],
      'the strafing run names no delivery — there is nothing to watch');
    assert(Math.abs(leadOf(run) - PASS_START / PROFILES[run.deliver].speed) < 1e-6,
      'the run\'s lead is not its own flight time — the ship and the payload can disagree');
    b.p.position.set(0, 0, 0);
    b.p.camera.yaw = Math.PI; b.p.camera.pitch = -0.25;
    b.p.camera.syncAim();
    b.p.camera.aimDirection(b.p.aimDir);
    eyes(b.p);
    const S = b.p.stratagems;
    S.setArming(true);
    for (const c of run.code) S.feed(c, b.ctx);
    const site = S.designating.site.clone();
    S.setArming(false);
    assert(S.sorties && S.sorties.live.length === 1,
      `${S.sorties ? S.sorties.live.length : 'no'} craft in the air after a gun run was called`);
    const craft = S.sorties.live[0];
    const start = craft.group.position.clone();
    assert(start.distanceTo(site) > 60,
      `the ship appeared ${start.distanceTo(site).toFixed(0)} m from the mark — it did not fly in`);
    assert(start.y > site.y + 10, 'the ship appeared on the ground');

    /* IT FLIES. Sampled every frame across the whole lead, and the closest it
     * ever gets to the mark has to be over it. */
    let closest = Infinity, closestT = 0, moved = 0;
    let prev = start.clone();
    const lead = leadOf(run);
    for (let t = 0; t < lead + 0.5; t += 1 / 60) {
      S.update(1 / 60, b.ctx);
      if (!S.sorties.live.length) break;
      const at = S.sorties.live[0].group.position;
      moved += at.distanceTo(prev); prev.copy(at);
      const flat = Math.hypot(at.x - site.x, at.z - site.z);
      if (flat < closest) { closest = flat; closestT = t; }
    }
    assert(moved > 100, `the craft moved ${moved.toFixed(0)} m over its whole run — it is parked`);
    assert(closest < 6,
      `the ship's closest approach to the ground it was shooting was ${closest.toFixed(0)} m`);
    assert(Math.abs(closestT - lead) < 0.6,
      `the ship was over the mark at ${closestT.toFixed(2)}s against a ${lead.toFixed(2)}s lead — `
      + 'the payload and the craft are on two different clocks');
    return `a ${PROFILES[run.deliver].speed} m/s pass from ${start.distanceTo(site).toFixed(0)} m out, `
      + `${moved.toFixed(0)} m flown, over the mark at ${closestT.toFixed(2)}s of a ${lead.toFixed(2)}s lead`;
  });

  check('stratagems: a strike is worth bodies, not a bruise', () => {
    /**
     * THE WHOLE OF PLAYER NOTE #31'S FIRST PARAGRAPH, AS ARITHMETIC.
     *
     * *"each of the stratagem attacks is a little poof of nothing"*. Measured
     * on a REAL wave 26 of Geonosis with `tools/_strikeprobe.mjs` — 22 bodies,
     * ~7 000 hp, the densest 12 m disc holding 14 to 15 of them — the shipped
     * orbital strike killed **one to two** bodies and dealt about 1 000 hp,
     * for 34 Force and a 26 s cooldown. `tools/balance.mjs` prices the blade
     * against the same roster (B1 1.28 s, MagnaGuard 5.34 s, AAT 5.75 s, plus
     * the walk between them): that wave takes about 195 s of swinging, one
     * body every 8.9 s. So the call bought one body for several seconds of
     * standing still in the open, when standing still and swinging buys one
     * every nine seconds for free.
     *
     * THE BENCH HERE IS NOT THAT WORLD — building one costs a minute — but the
     * COMPOSITION IS ITS COMPOSITION, recorded off the probe and packed at the
     * spacing that field actually held. What is asserted is the RATIO the
     * probe measures on the real thing, so this check and that probe cannot
     * quietly disagree about whether the fix landed.
     */
    const FIELD = ['bx', 'bx', 'bx', 'droideka', 'droideka', 'aat', 'aat', 'aat',
      'magna', 'magna', 'magna', 'magna', 'magna', 'magna', 'magna', 'magna', 'magna',
      'walker', 'b1', 'rocket', 'rocket', 'hailfire'];
    /** The wave, packed the way the probe found it: 15 bodies inside 12 m. */
    const pack = (b) => {
      const out = [];
      FIELD.forEach((type, i) => {
        // A spiral out from the centre, so the first fifteen are inside 12 m
        // and the tail is the spread the rest of the field has.
        const r = 1.2 + i * 0.72, a = i * 2.399;
        const at = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const e = new Enemy(b.world, type, at.clone());
        e.position.copy(at);
        b.world.enemies.push(e);
        out.push(e);
      });
      return out;
    };
    const measure = (fire) => {
      const b = bench({ force: 400 });
      const bodies = pack(b);
      b.p.position.set(60, 0, 60);        // the caller is well clear
      const hp0 = bodies.map(e => e.hp);
      fire(b);
      let killed = 0, dealt = 0;
      bodies.forEach((e, i) => { dealt += Math.max(0, hp0[i] - e.hp); if (e.hp <= 0 || e.dead) killed++; });
      const inside = bodies.filter(e => e.position.length() <= 12).length;
      return { killed, dealt, inside, n: bodies.length, hit: b.hit };
    };
    const site = () => new THREE.Vector3(0, 0, 0);
    // what shipped: r 7.5, impulse 62, 150 damage, linear falloff, no core
    const was = measure((b) => b.p.stratagems.blast(b.ctx, site(), 7.5, 62, 150));
    const strike = STRATAGEM_BY_ID.strike;
    const now = measure((b) => strike.fire(b.ctx, site(), b.p.stratagems, strike));
    assert(was.inside >= 12,
      `the fixture only packs ${was.inside} bodies inside 12 m — it is not the field this measures`);
    assert(now.killed >= was.killed * 3,
      `the strike kills ${now.killed} of ${now.n} where the shipped one killed ${was.killed} — `
      + 'that is not the difference between a poof and an orbital strike');
    assert(now.killed >= 5,
      `an orbital strike on ${was.inside} packed bodies killed ${now.killed}`);
    assert(now.killed < now.n * 0.8,
      `it killed ${now.killed} of ${now.n} — a call that clears a whole deep wave every `
      + `${strike.cooldown}s is not a decision`);

    /* THE CORE IS WHAT MAKES IT A LANCE. Linear falloff from a point is right
     * for a shockwave and wrong for a shell: a body two metres off the centre
     * of a 12 m strike is not four fifths hit, it is hit. Measured as two
     * bodies at the same distance under the two shapes. */
    const at = (b, d) => {
      const e = new Enemy(b.world, 'magna', new THREE.Vector3(d, 0, 0));
      e.position.set(d, 0, 0); e.force = 0; e.maxForce = 1;
      b.world.enemies.push(e);
      return e;
    };
    const bare = bench(); const flat = at(bare, 3.5);
    bare.p.position.set(60, 0, 60);
    bare.p.stratagems.blast(bare.ctx, site(), 12, 150, 300);
    const cored = bench(); const lance = at(cored, 3.5);
    cored.p.position.set(60, 0, 60);
    cored.p.stratagems.blast(cored.ctx, site(), 12, 150, 300, { core: 0.35 });
    assert((260 - lance.hp) > (260 - flat.hp) * 1.2,
      `3.5 m off the centre: ${(260 - flat.hp).toFixed(0)} hp with no core against `
      + `${(260 - lance.hp).toFixed(0)} with one — the core is doing nothing`);

    /* AND THE GROUND REMEMBERS IT. `Terrain.crater` is the owner of that verb
     * and it is called with a depth that is a hole rather than a scuff. */
    const holes = now.hit.filter(h => h.kind === 'crater');
    assert(holes.length, 'the strike left no crater');
    assert(holes[0].d > 1.5,
      `the strike pressed ${holes[0].d} m into the ground — the shipped one asked for 0.34, `
      + 'which measures 0.11 m on Geonosis and is a scuff');
    return `shipped ${was.killed} killed / ${was.dealt.toFixed(0)} hp → now ${now.killed} of `
      + `${now.n} killed / ${now.dealt.toFixed(0)} hp, ${was.inside} bodies inside the circle; `
      + `crater r${holes[0].r.toFixed(1)} d${holes[0].d}`;
  });

  check('stratagems: it lands on your own line too, and the line remembers', () => {
    /**
     * THE LEAD AND THE AIM MAKE FRIENDLY FIRE REAL, and the decision here is
     * stated rather than left to fall out: **an orbital strike damages your own
     * troops, and it costs you their morale.**
     *
     * The damage is not special-cased. In Command mode the troops around you
     * are `Enemy` instances on your team, so they come through `blast`'s own
     * loop and are billed at `teamDamage` by the wrapper Command.js already
     * puts in front of `Enemy.damage` — the same door a stray blade stroke
     * goes through. The MORALE is the part that had to be decided: a clumsy
     * sweep of the blade through the man beside you is an accident in a melee,
     * and `MORALE.BETRAYED` was written for the deliberate kind. Spelling eight
     * directions, painting a mark and holding it on your own men is the
     * deliberate kind. It arrives as such because `applyKnockback` bills its
     * damage as `'force'`, which is the kind `onFriendlyHit` reads.
     */
    const shaken = [];
    const command = {
      formation: 'line', reinforce() {}, rallyNear: () => 0,
      onFriendlyHit(e, amount, source, kind) { shaken.push({ amount, kind }); },
    };
    const b = bench({ command, force: 400 });
    const ally = new Enemy(b.world, 'trooper', new THREE.Vector3(3, 0, 0));
    ally.position.set(3, 0, 0);
    ally.team = b.p.team;
    ally.trooper = { name: 'CT-1409' };
    ally.commandOf = command;
    /* THE SHIPPED WRAPPER AND NOT A HAND-BUILT ONE. `installTeamDamage` is
     * what every enlisted body in Command mode actually carries — it is what
     * bills a friendly hit at `teamDamage` and what calls `onFriendlyHit` —
     * so a fixture that wired its own would be measuring the fixture. */
    installTeamDamage(ally, 0.35);
    b.world.enemies.push(ally);
    b.p.position.set(60, 0, 60);
    const hp0 = ally.hp;
    const strike = STRATAGEM_BY_ID.strike;
    strike.fire(b.ctx, new THREE.Vector3(0, 0, 0), b.p.stratagems, strike);
    assert(ally.hp < hp0,
      'a trooper of yours three metres from the centre of your own orbital strike was unharmed');
    assert(shaken.length,
      'the line was never told — `onFriendlyHit` did not fire, so nothing can shake');
    assert(/^(force|lightning|choke|grip|rend)$/.test(shaken[0].kind ?? ''),
      `the hit arrived as kind "${shaken[0].kind}", which Command reads as an accident rather `
      + 'than as a decision — MORALE.BETRAYED will not fire');
    return `3 m from the centre: ${(hp0 - ally.hp).toFixed(0)} hp off one of yours, `
      + `reported as "${shaken[0].kind}" — the betrayal kind`;
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
