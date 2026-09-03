/**
 * BATTLEFRONT BORZ — spectacle, and how the player presents themselves.
 *
 * Five things arrived at once and every one of them is the kind that reads
 * perfectly well as source while doing nothing:
 *
 *   1. A SLOW WALK. A gait is one multiplication. What makes it a feature is
 *      that a key nothing else answers to reaches that multiplication, that the
 *      pace it produces is a pace a player can tell apart from the other three,
 *      and that letting go puts it back. Every one of those is a number.
 *   2. A MINIMAP. "Toggleable" and "must not cost a frame" are both claims about
 *      work done per second, so both are counted here — through a canvas that
 *      TALLIES instead of painting, driven by the shipped Minimap.
 *   3. AN EMOTE WHEEL over voice lines that already existed. The failure mode is
 *      exact and it is the one src/engine/Voice.js is shaped around: `utterance`
 *      falls back to the effort grunt for a contour it does not recognise, so a
 *      wheel whose slots name renamed lines plays eight identical noises and
 *      nothing anywhere throws.
 *   4. A FREE CAMERA. The whole design is that the game STOPS while it is off
 *      the body — a detached camera over a running world is a wallhack, not a
 *      screenshot tool — so that is driven against a real World and measured on
 *      its clock, not asserted about its source.
 *   5. A KILLSTREAK LADDER THAT COULD BE JUMPED. The rungs were matched
 *      exactly, so six kills on one frame announced nothing while two announced
 *      DOUBLE STRIKE.
 *
 * Nothing below re-implements anything it measures. Where a shipped file could
 * not be reached without owning it — Player.js belongs to another lane — the
 * real method is driven through the real gate, and the only thing standing in
 * is the collision solver, which does not decide a speed.
 */

import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { ACTIONS, ACTION_IDS, defaultBindings, conflicts, findConflicts, keyLabel,
  walkScale, WALK_SCALE } from '../../src/engine/Bindings.js';
import { Input } from '../../src/engine/Input.js';
/* The saber sets' own pace term — see `walker`. Aliased because this file
 * already has a `paceOf`, which measures a gait rather than declaring one. */
import { setById, paceOf as setPaceOf } from '../../src/game/SaberSet.js';
import { LINES, LINE_KINDS, PLAYER_LINES, ENEMY_LINES, voiceAt } from '../../src/engine/Voice.js';
import { Announcer, STREAKS, RETURNS, CHAMBERS, QUIP_GAP } from '../../src/ui/Announcer.js';
import { HUD, Minimap, EmoteWheel, OrderWheel, WHEEL_EXTRAS, FreeCam, EMOTES, MINIMAP, MINIMAP_COLORS,
  emoteAngle, emoteAt, EMOTE_DEADZONE, FREECAM } from '../../src/ui/HUD.js';
import { DEFAULT_SETTINGS, SETTING_READERS, CODEX, codexHtml,
  applyGait, tapFrame, applyFeelSettings } from '../../src/ui/Menu.js';
import { Player } from '../../src/game/Player.js';
import { makeDocument } from './_page.mjs';
import { bootWorld } from './_coop.mjs';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/* ── a canvas that counts instead of painting ────────────────────────── */

/**
 * The whole instrument behind "it must not cost a frame".
 *
 * A budget is a rate, and the only honest way to hold one is to count the
 * operations the SHIPPED code issues over a known stretch of time. So this is a
 * 2D context that answers every call and tallies it — the map cannot tell the
 * difference, and neither can a future edit that decides to paint a compass
 * rose sixty times a second.
 */
function countingCanvas() {
  const ops = { total: 0 };
  const bump = (k) => { ops.total++; ops[k] = (ops[k] || 0) + 1; };
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === 'canvas') return null;
      if (typeof k === 'symbol') return undefined;
      return (...a) => { bump(String(k)); return a; };
    },
    set(_t, k, v) { bump('=' + String(k)); ops['last:' + String(k)] = v; return true; },
  });
  const classes = new Set();
  return {
    ops,
    canvas: {
      width: 0, height: 0, style: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c); else classes.delete(c);
          return want;
        },
      },
      getContext: () => ctx,
    },
  };
}

/**
 * A context that RECORDS the arcs instead of counting them, so "the blip is
 * where the body is" can be measured in pixels rather than believed.
 */
function tracingCanvas() {
  const arcs = [], tris = [];
  let fill = null, path = [];
  const classes = new Set();
  const ctx = {
    clearRect() { arcs.length = 0; tris.length = 0; },
    beginPath() { path = []; },
    arc(x, y, r) { path = [{ x, y, r }]; },
    moveTo(x, y) { path.push({ x, y }); },
    lineTo(x, y) { path.push({ x, y }); },
    closePath() {},
    fill() {
      if (path.length === 1 && path[0].r !== undefined) arcs.push({ ...path[0], fill });
      else if (path.length) tris.push({ pts: path.slice(), fill });
      path = [];
    },
    set fillStyle(v) { fill = v; },
    get fillStyle() { return fill; },
  };
  return {
    arcs, tris,
    canvas: {
      width: 0, height: 0, style: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => {
          const want = on === undefined ? !classes.has(c) : !!on;
          if (want) classes.add(c); else classes.delete(c);
          return want;
        },
      },
      getContext: () => ctx,
    },
  };
}

const body = (x, z, extra = {}) => ({
  dead: false, position: new THREE.Vector3(x, 0, z), A: { boss: false, big: false }, ...extra,
});

const mapPlayer = (x = 0, z = 0, yaw = 0) => ({
  position: new THREE.Vector3(x, 0, z), camera: { yaw },
});

/* ── a body that can be moved, and nothing else ──────────────────────── */

/**
 * A REAL `Player._move`, driven through the REAL gate.
 *
 * `Object.create(Player.prototype)` and not a bag of fields: the arithmetic
 * under test is four terms on one line of src/game/Player.js and a copy of it
 * here would agree with itself forever. The only method standing in is
 * `_collide`, which wants a heightfield, a physics world and a scene graph and
 * decides no part of a speed — every other line of `_move` is the shipped one,
 * including the sprint predicate and the crouch damp this gait has to sit
 * between.
 *
 * `update` forwards to `_move` because that is what the real one does
 * (Player.js: `this._move(dt, ctx)` inside `update`), and the check below
 * asserts that rather than assuming it — the gate wraps `update`, so a real
 * update that had stopped calling `_move` would make this whole measurement a
 * measurement of nothing.
 */
/**
 * A PLAYER WITH NO CONSTRUCTOR, AND EVERY FIELD `_move` READS DECLARED HERE.
 *
 * `Object.create(Player.prototype)` skips the constructor on purpose — this
 * bench is about the gait ladder and building a real Player drags in a world,
 * a saber, a physics body and a rig. The price is that every field `_move`
 * touches has to be written below, and the day one is added upstream this
 * object goes quietly wrong.
 *
 * It did. `_move`'s base became `4.6 * boonMods.moveSpeed * this.setPace` when
 * the saber sets landed a pace term, `setPace` is assigned in the constructor
 * this bench does not run, and `4.6 * 1 * undefined` is NaN — so the ladder
 * measured NaN m/s and the check reported "the harness is not walking", which
 * was exactly right and said nothing about why.
 *
 * `paceOf(setById(undefined).id)` rather than a typed 1: `setById` resolves the
 * DEFAULT set, and `paceOf` is the same function the constructor calls, so this
 * bench walks at whatever a default-set player walks at and follows the table
 * if that ever changes. A literal here would be a second copy of a number that
 * has already proved it can move.
 */
function walker(extra = {}) {
  return Object.assign(Object.create(Player.prototype), {
    isLocal: true,
    setPace: setPaceOf(setById(undefined).id),
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    camera: { yaw: 0 }, saber: { lit: false },
    boonMods: { moveSpeed: 1, jumpPower: 1, doubleJump: false },
    crouch: 0, grounded: true, coyote: 0.14, airJumps: 1, jumpHeld: 0,
    stamina: 100, maxStamina: 100, force: 100,
    staggerTimer: 0, senseActive: false, dashTimer: 0, dashDir: new THREE.Vector3(),
    facing: 0, fallSpeed: 0,
    _collide() { this.position.y = 0; this.velocity.y = 0; this.grounded = true; },
    _canSpend: () => true, _spend() {},
    update(dt, ctx) { this._move(dt, ctx); },
    ...extra,
  });
}

/** A real Input with nothing held, and the shipped bindings. */
const freshInput = () => new Input({ addEventListener() {}, requestPointerLock() {} });

/** A bare throw, so the harness above can fail loudly outside a check body. */
const assert0 = (c, m) => { if (!c) throw new Error(m); };

/** Hold the default key(s) of these actions, and nothing else. */
function hold(input, ...ids) {
  input.keys.clear(); input.pressed.clear();
  input.buttons.fill(false); input.buttonPressed.fill(false);
  for (const id of ids) for (const code of input.bindings[id]) {
    if (!code.startsWith('Mouse') && !code.startsWith('Wheel')) { input.keys.add(code); input.pressed.add(code); }
  }
  return input;
}

/**
 * Terminal ground speed after `seconds` of holding these actions.
 *
 * THE GAIT IS NOT ARMED ANY MORE, IT IS THE BODY'S OWN.
 *
 * This used to assert `p._gaitGated` — that `applyFeelSettings` had wrapped
 * `Player.update` — because the walk was built from the UI side while five
 * files were being edited in parallel and `Player.js` belonged to another
 * lane. That handover has been taken: `Player._move` multiplies `walkScale`
 * into its own speed, which is the same arithmetic in the file that owns the
 * pace.
 *
 * So the arming assertion is retired, and deliberately not replaced with a
 * negative one. "The gait works" and "the gait is switched on at boot" were
 * two claims when a wrapper could be missing; with the factor inside `_move`
 * there is nothing to switch on and the second claim has no content. What is
 * left is the property, which is what the four paces below measure.
 *
 * `applyFeelSettings` is still called here rather than skipped, because every
 * OTHER feel setting still routes through it and a walker built without it is
 * not the body the game runs.
 */
function paceOf(seconds, ...ids) {
  const p = walker();
  applyFeelSettings({ players: [p], hitstop: 0, addHitstop() {}, update() {} }, { ...DEFAULT_SETTINGS });
  const input = hold(freshInput(), 'moveF', ...ids);
  const ctx = { input, terrain: null, particles: null };
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) p.update(dt, ctx);
  return { speed: Math.hypot(p.velocity.x, p.velocity.z), p, input, ctx };
}

export async function run({ check, assert }) {
  const INDEX = await read('index.html');
  const CSS = await read('styles.css');
  const PLAYER_SRC = await read('src/game/Player.js');

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. THE SLOW WALK                                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('spectacle: the slow walk is a binding, held, on a key nothing else answers to', () => {
    const row = ACTIONS.find(a => a.id === 'walk');
    assert(row, 'there is no `walk` action — the gait is not in the table, so it cannot be rebound, '
      + 'cannot be listed and cannot be seen to collide');
    assert(row.hold, 'the slow walk is registered as a press. A gait you toggle is a mode you forget '
      + 'you are in, and the first time you forget it is a bolt in the back');
    assert(row.group === 'Movement', `the walk is filed under ${row.group}`);

    // Through a REAL Input with the shipped defaults, the way a key press
    // actually arrives — not by reading the table and agreeing with it.
    const b = defaultBindings();
    const input = freshInput();
    for (const code of b.walk) {
      hold(input, 'walk');
      const who = ACTION_IDS.filter(id => input.act(id) || input.actHit(id));
      assert(who.length === 1 && who[0] === 'walk',
        `${code} answers to ${who.join(' + ')} — one press, two systems`);
      assert(!findConflicts(b, code, 'walk').length,
        `the walk defaults to ${code}, which ${findConflicts(b, code, 'walk').join('+')} also answers to`);
    }
    assert(!conflicts(b).length, 'adding the walk put a clash into the shipped defaults');

    // …and the thing that reads it. Sprint wins outright: 0.34 × 1.62 would be
    // a fifth gait nobody asked for and no readout describes.
    assert(walkScale(freshInput()) === 1, 'the walk scales the pace with nothing held');
    assert(walkScale(hold(freshInput(), 'walk')) === WALK_SCALE,
      `holding the walk key asked for ${walkScale(hold(freshInput(), 'walk'))}× rather than ${WALK_SCALE}×`);
    assert(walkScale(hold(freshInput(), 'walk', 'sprint')) === 1,
      'holding walk AND sprint produced a fifth gait');
    assert(walkScale(null) === 1 && walkScale({}) === 1, 'walkScale throws on a frame with no input');

    // The one page a player reads has to print the live binding, not a name.
    const probe = defaultBindings();
    probe.walk = ['F13'];
    assert(/<kbd>(?:Hold )?F13<\/kbd>/.test(codexHtml(probe)),
      'the Codex never prints the walk\'s binding — the gait is documented on no screen a player sees');
    return `walk on ${b.walk.map(keyLabel).join('+')}, hold, sole answer to its key, `
      + `${WALK_SCALE}× pace, sprint overrides`;
  });

  check('spectacle: holding the walk key really walks the body, under the crouch and over nothing', () => {
    /**
     * THE MEASUREMENT, on the real integrator.
     *
     * A gait is only a gait if a player can tell it from the one either side of
     * it, so what is asserted is the LADDER — four upright speeds each about
     * half again the one below — rather than a single number this file could
     * have produced by copying the constant.
     */
    assert(/this\._move\(dt, ctx\)/.test(PLAYER_SRC),
      'Player.update no longer calls _move, so the gate this gait rides wraps a call that '
      + 'does not reach the speed any more');

    const T = 2.2;                       // well past the 19.3/s velocity damp
    const base = paceOf(T).speed;
    const walk = paceOf(T, 'walk').speed;
    const crouch = paceOf(T, 'crouch').speed;
    const sprint = paceOf(T, 'sprint').speed;

    assert(base > 4 && base < 5.2, `the ordinary pace measured ${base.toFixed(2)} m/s — the harness is not walking`);
    assert(Math.abs(walk / base - WALK_SCALE) < 0.02,
      `holding the walk gave ${(walk / base).toFixed(3)}× the ordinary pace, and WALK_SCALE is ${WALK_SCALE}`);
    assert(walk < crouch - 0.3,
      `the slow walk is ${walk.toFixed(2)} m/s and a crouch is ${crouch.toFixed(2)} — a gait that is not `
      + 'clearly under the crouch is a rounding error with a key on it');
    assert(walk > 1.1, `${walk.toFixed(2)} m/s is under the animator's gait floor — the feet would slide`);
    assert(sprint > base && base > crouch, 'the four gaits are not in order');

    // It is a MODIFIER: let go and the body is back at its ordinary pace, and
    // the number it was borrowing is put back exactly.
    const r = paceOf(T, 'walk');
    assert(r.p.boonMods.moveSpeed === 1,
      `the gate left ${r.p.boonMods.moveSpeed} on boonMods.moveSpeed — a walk that leaks is a permanent limp`);
    hold(r.input, 'moveF');
    for (let i = 0; i < Math.round(T * 60); i++) r.p.update(1 / 60, r.ctx);
    const after = Math.hypot(r.p.velocity.x, r.p.velocity.z);
    assert(Math.abs(after - base) < 0.05, `letting go left the body at ${after.toFixed(2)} m/s, not ${base.toFixed(2)}`);

    /**
     * A boon taken WHILE the key is held survives the restore.
     *
     * The gate borrows `boonMods.moveSpeed` for the length of one update and
     * puts it back afterwards, and a landing replays a run's whole card list
     * into a freshly built player — so a restore that wrote back the value it
     * captured would throw a Fleet-Footed away for anyone who happened to be
     * walking on the frame it landed. The gate undoes the FACTOR instead, which
     * is what this measures.
     */
    /* …and it cannot throw a boon away, because it no longer borrows one.
     * The wrapper multiplied `boonMods.moveSpeed` for the length of one update
     * and put it back, which is a whole class of hazard — a card taken inside
     * that call was discarded by the restore. `_move` reads the factor and
     * writes nothing, so the only thing left to assert is that a boon taken
     * mid-frame survives, which it now does by construction. */
    const gi = hold(freshInput(), 'moveF', 'walk');
    const inside = walker({ update(dt, ctx) { this.boonMods.moveSpeed *= 1.2; this._move(dt, ctx); } });
    inside.update(1 / 60, { input: gi, terrain: null, particles: null });
    assert(Math.abs(inside.boonMods.moveSpeed - 1.2) < 1e-9,
      `a boon taken during a walked frame came out as ${inside.boonMods.moveSpeed}`);

    return `pace: walk ${walk.toFixed(2)}  crouch ${crouch.toFixed(2)}  ordinary ${base.toFixed(2)}  `
      + `sprint ${sprint.toFixed(2)} m/s (walk is ${(walk / base * 100).toFixed(0)}% of ordinary)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. THE MINIMAP                                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('spectacle: the minimap plots every living body, where it actually is', () => {
    const t = tracingCanvas();
    const map = new Minimap(t.canvas);
    assert(map.ctx, 'the minimap never took a 2D context');
    assert(t.canvas.width === MINIMAP.size && t.canvas.height === MINIMAP.size,
      `the backing store is ${t.canvas.width}px against a declared ${MINIMAP.size}`);

    const R = MINIMAP.size / 2;
    const enemies = [];
    for (let i = 0; i < 25; i++) enemies.push(body(Math.cos(i) * 12, Math.sin(i) * 12));
    enemies[3].A = { boss: true };
    enemies[7].dead = true;
    const world = { enemies, players: [], remotes: null };
    const me = mapPlayer(0, 0, 0);
    const n = map.draw(world, me);
    assert(n === 24, `${n} contacts drawn for 24 living bodies — a dead one is still on the map`);
    assert(t.arcs.length === 24, `${t.arcs.length} blips for ${n} contacts`);
    assert(t.arcs.some(a => a.fill === MINIMAP_COLORS.boss),
      'the boss is drawn in the same colour as everything else');
    assert(t.arcs.filter(a => a.fill === MINIMAP_COLORS.enemy).length === 23,
      'the ordinary contacts are not all in the enemy colour');
    assert(t.tris.length === 1 && t.tris[0].fill === MINIMAP_COLORS.self,
      'there is no arrow for the player at the centre of their own map');

    /**
     * HEADING-UP, and this is the assertion that catches a sign.
     *
     * The camera's forward is `-(sin yaw, cos yaw)` (Player.js builds it that
     * way), so a body directly in front must land ABOVE the middle of the
     * canvas — smaller y — at every heading, and one on the player's right must
     * land to the right. Getting that wrong is one character and produces a map
     * that reads perfectly until you turn round.
     */
    for (const yaw of [0, Math.PI / 2, Math.PI, -2.1, 0.7]) {
      // The camera's forward is `-(sin yaw, cos yaw)`, so 20 m straight ahead is
      // exactly that, times 20. Placed from the same expression Player builds
      // the walk direction with rather than from a guess about which way is up.
      const px = -Math.sin(yaw) * 20, pz = -Math.cos(yaw) * 20;
      const w2 = { enemies: [body(px, pz)], players: [] };
      map.draw(w2, mapPlayer(0, 0, yaw));
      const a = t.arcs[0];
      assert(a.y < R - 10 && Math.abs(a.x - R) < 0.6,
        `at yaw ${yaw.toFixed(2)} a body 20 m straight ahead was drawn at (${a.x.toFixed(1)}, ${a.y.toFixed(1)}) `
        + `on a ${MINIMAP.size}px canvas whose centre is ${R} — the disc is not heading-up`);
      // …and one on the player's right, which is the other half of the sign.
      const rx = Math.cos(yaw) * 20, rz = -Math.sin(yaw) * 20;
      map.draw({ enemies: [body(rx, rz)], players: [] }, mapPlayer(0, 0, yaw));
      assert(t.arcs[0].x > R + 10 && Math.abs(t.arcs[0].y - R) < 0.6,
        `at yaw ${yaw.toFixed(2)} a body 20 m to the right landed at (${t.arcs[0].x.toFixed(1)}, ${t.arcs[0].y.toFixed(1)})`);
    }

    // Out of range is CLAMPED to the rim, not dropped: "something is behind you,
    // far away" is the most useful thing a radar says and a dropped contact
    // says nothing.
    map.draw({ enemies: [body(0, MINIMAP.range * 4), body(0, -1)], players: [] }, mapPlayer());
    assert(t.arcs.length === 2, 'a body outside the range was dropped rather than pinned to the rim');
    const far = t.arcs.find(a => a.y > R);
    assert(far && Math.abs(Math.hypot(far.x - R, far.y - R) - (R - 7)) < 0.01,
      'the far contact is not on the rim');
    assert(far.fill === MINIMAP_COLORS.edge, 'a rim contact is drawn as though it were in range');

    // Allies, on both of the two lists a party can arrive on.
    const ally = { position: new THREE.Vector3(4, 0, 4), alive: true };
    map.draw({ enemies: [], players: [me, ally], remotes: new Map([[1, { position: new THREE.Vector3(-4, 0, 4) }]]) }, me);
    assert(t.arcs.length === 2 && t.arcs.every(a => a.fill === MINIMAP_COLORS.ally),
      `${t.arcs.length} ally blips — the local body is on world.players too and must not be drawn twice`);
    return `24 of 25 bodies (1 dead skipped), boss in ${MINIMAP_COLORS.boss}, heading-up at 5 yaws, `
      + `range ${MINIMAP.range} m with far contacts pinned to the rim, allies from players + remotes`;
  });

  check('spectacle: the minimap is toggleable, and off it costs nothing at all', () => {
    const c = countingCanvas();
    const map = new Minimap(c.canvas);
    const enemies = [];
    for (let i = 0; i < 25; i++) enemies.push(body(Math.cos(i) * 9, Math.sin(i) * 9));
    const world = { enemies, players: [] };
    const me = mapPlayer();
    /* `minimapSense: false` — this check is about what the map COSTS TO DRAW,
     * and the always-on map is the one that draws on every eligible frame.
     * With the shipped default the map is a Force reading (see
     * Minimap.update): a stub player with no `senseActive` never asks for one,
     * so every number below would be zero and the budget would go unmeasured.
     * The gate itself is measured in tools/checks/hud-events.mjs. */
    const s = { ...DEFAULT_SETTINGS, minimap: true, minimapSense: false };

    const SECONDS = 10, dt = 1 / 60;
    const frames = Math.round(SECONDS / dt);
    for (let i = 0; i < frames; i++) map.update(dt, world, me, s);
    const onOps = c.ops.total, onPaints = map.repaints;

    // The rate is the budget. 20 Hz is what MINIMAP.hz declares and a body at a
    // sprint covers 12 cm between repaints — a third of a pixel on this canvas.
    const hz = onPaints / SECONDS;
    assert(Math.abs(hz - MINIMAP.hz) <= 1,
      `the map repainted ${hz.toFixed(1)} times a second against a declared ${MINIMAP.hz}`);
    assert(onPaints < frames,
      'the map repaints on every frame — the whole budget is that it does not');
    // Per repaint: one clear, then a begin/arc/fill/fillStyle per contact, then
    // the four calls that draw the arrow. 25 bodies is wave 20's full roster.
    const perPaint = onOps / onPaints;
    assert(perPaint < 6 * (enemies.length + 2),
      `${perPaint.toFixed(0)} canvas operations per repaint for ${enemies.length} bodies`);
    assert(onOps / SECONDS < 2600,
      `${(onOps / SECONDS).toFixed(0)} canvas operations a second with 25 bodies alive`);

    // OFF: not drawn transparent — not drawn at all, and taken out of the
    // layout, which is the difference between costing nothing and costing a
    // composite every frame.
    s.minimap = false;
    const wasOps = c.ops.total, wasPaints = map.repaints;
    for (let i = 0; i < frames; i++) map.update(dt, world, me, s);
    assert(c.ops.total === wasOps, `${c.ops.total - wasOps} canvas operations with the map switched off`);
    assert(map.repaints === wasPaints, 'the map kept repainting with the box unticked');
    assert(c.canvas.classList.contains('hidden'), 'the map is invisible but still in the layout');

    // …and back, on the same settings object, with no redeploy.
    s.minimap = true;
    for (let i = 0; i < 60; i++) map.update(dt, world, me, s);
    assert(map.repaints > wasPaints, 'the switch is one-way');
    assert(!c.canvas.classList.contains('hidden'), 'the map came back hidden');

    // A stall must not buy a burst of catch-up repaints of a world that has
    // moved once.
    const before = map.repaints;
    map.update(2.5, world, me, s);
    assert(map.repaints === before + 1, `a 2.5 s frame produced ${map.repaints - before} repaints`);
    return `${onPaints} repaints in ${SECONDS} s (${hz.toFixed(0)} Hz), ${(onOps / SECONDS).toFixed(0)} ops/s `
      + `with 25 bodies; off → 0 ops, 0 repaints, display:none`;
  });

  check('spectacle: the HUD\'s own frame is what drives the map, and the box is on the options screen', () => {
    // The wiring, through the real HUD on the real page. Everything above
    // drives Minimap directly, which cannot tell whether anything ever calls it.
    const doc = makeDocument(INDEX);
    const el = doc.getElementById('minimap');
    assert(el, 'index.html has no #minimap for the HUD to find');
    assert(el.localName === 'canvas', `#minimap is a <${el.localName}>, and the map draws with a 2D context`);
    // The page shim models no canvas context; give the parsed element one so the
    // SHIPPED HUD can be driven end to end.
    const c = countingCanvas();
    el.getContext = c.canvas.getContext;
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      assert(hud.minimap && hud.el.minimap === el, 'the HUD does not own the map element');
      const p = {
        hp: 90, maxHp: 100, force: 40, maxForce: 100, stamina: 60, maxStamina: 100,
        flow: 0.2, combo: 1, score: 0, kills: 0, deflects: 0, perfects: 0, chambers: 0,
        alive: true, grounded: true, velocity: { y: 0 }, senseActive: false, throwState: 'held',
        gripBody: null, gripEnemy: null, lockState: null, healing: null, stasis: { bodies: new Set() },
        cooldowns: {}, boonMods: {}, position: new THREE.Vector3(), chest: new THREE.Vector3(0, 1.4, 0),
        saber: { tipSpeed: 0 }, camera: { firstPerson: false, yaw: 0, aimQuat: new THREE.Quaternion() },
        control: { _grip: null, steering: 0, flourishT: -1, screenGuard: (a, b2, q, o) => o.set(0, 0) },
      };
      // …and again the always-on map, for the same reason: this is the WIRING
      // check — does the HUD's own frame drive the map at all — and the
      // shipped Force-sense gate would answer "no" for a stub that never
      // senses. The gate has its own check beside the reticle's.
      const settings = { ...DEFAULT_SETTINGS, minimapSense: false };
      const world = {
        score: 0, enemies: [body(3, -4), body(-6, 2)], players: [], training: false, focus: null,
        settings, director: { wave: 1, remaining: 2, active: true, intermission: 0 },
      };
      const cam = new THREE.PerspectiveCamera();
      for (let i = 0; i < 30; i++) hud.update(1 / 60, world, p, cam);
      assert(hud.minimap.repaints > 0, 'thirty HUD frames drew the map zero times — nothing drives it');
      const was = hud.minimap.repaints;
      settings.minimap = false;
      for (let i = 0; i < 30; i++) hud.update(1 / 60, world, p, cam);
      assert(hud.minimap.repaints === was,
        'unticking the box mid-run left the map drawing — that is a checkbox that does nothing');
      return `#minimap wired to the HUD, ${was} repaints in 30 frames, 0 after the box came off`;
    } finally { restore(); }
  });

  check('spectacle: the minimap is a setting with a reader and a control, in the HUD\'s own flow', async () => {
    const menu = await read('src/ui/Menu.js');
    assert('minimap' in DEFAULT_SETTINGS, 'the minimap cannot be remembered between runs');
    assert(DEFAULT_SETTINGS.minimap === true, 'the map ships off, and the note asks for one');
    assert(SETTING_READERS.minimap?.[0] === 'ui/HUD.js', 'the minimap declares no reader in the HUD');
    assert(/_check\('opt-minimap',\s*'minimap'/.test(menu), 'no control writes the minimap setting');
    assert(INDEX.includes('id="opt-minimap"'), '#opt-minimap is not on the options screen — '
      + '_check returns SILENTLY when the id is wrong');

    /**
     * …and it lives in the bottom-right BLOCK rather than floating.
     *
     * The same rule the kill feed was moved to obey after it was found at
     * `position:absolute; top:120px` inside the space the score column had
     * grown into. Two absolutely-positioned HUD boxes are two boxes measured
     * against different things, and the first viewport where they meet is the
     * first where one is drawn through the other.
     */
    const br = INDEX.slice(INDEX.indexOf('<div class="hud-br">'), INDEX.indexOf('<div id="bossbar"'));
    assert(br.includes('id="minimap"'), 'the minimap has left the bottom-right HUD block');
    assert(br.indexOf('id="minimap"') < br.indexOf('id="power-wheel"'), 'the map is under the power wheel');
    const rule = CSS.slice(CSS.indexOf('#minimap{'), CSS.indexOf('}', CSS.indexOf('#minimap{')));
    assert(rule.length > 10, '#minimap has no styles at all');
    assert(!/position\s*:\s*(fixed|absolute)/.test(rule),
      'the map is positioned out of the block it lives in — that is a bolted-on overlay');
    // The rule that OWNS .hud-br, not the shared `.hud-tl,.hud-tr,.hud-bl,.hud-br`
    // filter above it — a plain indexOf finds that one's tail and reads nothing.
    const brRule = CSS.match(/\n\.hud-br\{([^}]*)\}/);
    assert(brRule && /flex-direction\s*:\s*column/.test(brRule[1]),
      '.hud-br is not a column, so the map and the wheel share a row');
    /**
     * THE SIZE IS WRITTEN ONCE, AND MINIMAP.size IS WHERE.
     *
     * A canvas has two sizes and this project has three places that could name
     * one: the markup, the stylesheet, and the class whose per-second budget is
     * argued from it. Any second copy is a map drawn at one resolution and laid
     * out at another the first time the budget moves.
     */
    const tag = INDEX.match(/<canvas[^>]*id="minimap"[^>]*>/);
    assert(tag && !/\bwidth=/.test(tag[0]), `the canvas types its own resolution: ${tag && tag[0]}`);
    assert(!/width\s*:/.test(rule) && !/height\s*:/.test(rule),
      `styles.css types the map's size as well: ${rule.trim()}`);
    const sized = tracingCanvas();
    const box = new Minimap(sized.canvas);
    assert(box.canvas.width === MINIMAP.size && box.canvas.style.width === `${MINIMAP.size}px`,
      `the map laid out at ${box.canvas.style.width} and drew at ${box.canvas.width}px`);
    return `minimap: default on, reader in ui/HUD.js, #opt-minimap, in .hud-br above the power wheel`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. THE EMOTE WHEEL                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('spectacle: the wheel names every line the player\'s voice can make, and invents none', () => {
    /**
     * THE FAILURE THIS EXISTS FOR. `utterance()` falls back to LINES.effort for
     * a contour it does not recognise — which is right for the game, a trigger
     * must never throw mid-fight — and catastrophic for a table of names: rename
     * a contour and all eight emotes quietly become the same grunt, with nothing
     * anywhere throwing and every one of them still "playing".
     */
    const split = [...PLAYER_LINES, ...ENEMY_LINES].sort();
    assert(split.join() === [...LINE_KINDS].sort().join(),
      `the two halves of LINE_KINDS do not add up to it: ${split.join()} vs ${[...LINE_KINDS].sort().join()}`);
    assert(!PLAYER_LINES.some(k => ENEMY_LINES.includes(k)), 'a contour is on both sides of the split');

    const named = EMOTES.map(e => e.line).sort();
    assert(named.join() === [...PLAYER_LINES].sort().join(),
      `the wheel offers ${named.join()} and the player's voice can make ${[...PLAYER_LINES].sort().join()} — `
      + 'either a line the player owns is unreachable or a slot names one they do not');
    for (const e of EMOTES) {
      assert(LINES[e.line], `the ${e.id} slot names the contour "${e.line}", which is not in LINES — `
        + 'utterance() would fall back to the effort grunt and every emote would sound the same');
      assert(!ENEMY_LINES.includes(e.line), `${e.id} plays the room's ${e.line} out of a Jedi's throat`);
      assert(e.name && e.blurb, `${e.id} has no name or no blurb to show`);
    }
    assert(new Set(EMOTES.map(e => e.id)).size === EMOTES.length, 'two slots share an id');
    assert(new Set(EMOTES.map(e => e.name)).size === EMOTES.length, 'two slots show the same name');
    assert(EMOTES.some(e => e.gesture), 'no slot moves the body at all');
    return `${EMOTES.length} slots over ${PLAYER_LINES.length} player contours (${PLAYER_LINES.join(', ')}), `
      + `${EMOTES.filter(e => e.gesture).length} with a gesture; ${ENEMY_LINES.length} enemy calls kept off it`;
  });

  check('spectacle: every authored contour has something that actually plays it', async () => {
    /**
     * THE CHECK ABOVE ASKS WHETHER THE TABLES ADD UP. They did, and one contour
     * was still silent for the whole project.
     *
     * `LINES.order` carries three paragraphs of its own rationale — "it is the
     * officer's line and it is what the player hears when they change
     * formation, so it has to be legible under a firefight" — and nothing
     * emitted it. Fourteen of fifteen contours had a live caller; the formation
     * path wrote two DOM strings and lit a chip in silence, so the one mode
     * where you give orders was the one where nothing answered you. Set
     * equality could not see that, because a contour that is in both tables and
     * spoken by nobody satisfies every assertion above.
     *
     * A contour is authored to be HEARD. So the property is emission, and it is
     * read off the source rather than off a list somebody keeps: any literal
     * handed to a speaking call, anywhere under src/.
     *
     * TWO THINGS THE FIRST VERSION OF THIS GOT WRONG, both of which made it
     * report contours as silent that are played every fight. It knew only
     * `say`/`_say`/`cry`/`speak` and missed `_battleLine`/`_enemyLine`, which
     * are how the announcer plays most of the room's calls. And it took the
     * FIRST literal in the argument list, so `spec.ring ? 'alarm' : 'flung'`
     * hid `flung` behind `alarm`. It now takes every literal in the call. A
     * check that cries wolf about four working contours is worse than no check,
     * because the next person to see it red will assume it always is.
     */
    const { readdir } = await import('node:fs/promises');
    const root = new URL('../../src/', import.meta.url);
    const files = [];
    const walk = async (dir) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u);
        else if (e.name.endsWith('.js')) files.push(u);
      }
    };
    await walk(root);

    const spoken = new Set();
    for (const f of files) {
      const src = await readFile(f, 'utf8');
      // Comments are stripped first: this file, and Voice.js, DISCUSS every
      // contour by name, and a mention is not an emission.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // THE CALLEE LIST IS A SHAPE, NOT A ROSTER, and that is the third time
      // this pattern has been widened by hand. It knew say/_say/cry/speak and
      // missed `_battleLine`/`_enemyLine`; widened to name those, it then
      // missed `_roomLine`, the router those two now sit under, and would have
      // reported five working contours as silent. Anything ending in `Line`
      // plays one, which is the naming rule the announcer already follows, so
      // the next one is covered the day it is written.
      for (const call of code.matchAll(/\b(?:say|_say|cry|speak|[A-Za-z_]*[Ll]ine)\s*\(([^;]{0,200})/g)) {
        for (const lit of call[1].matchAll(/['"]([a-z]+)['"]/g)) {
          if (LINE_KINDS.includes(lit[1])) spoken.add(lit[1]);
        }
      }
    }

    // The emote wheel plays its eight through a slot table rather than a
    // literal, so those are emitted by construction and counted as such.
    for (const e of EMOTES) spoken.add(e.line);

    const silent = LINE_KINDS.filter((k) => !spoken.has(k));
    assert(silent.length === 0,
      `${silent.length} authored contour(s) are never played by anything: ${silent.join(', ')} — `
      + 'a line in the table with no caller is a sound the game cannot make, and nothing else here '
      + 'can tell you that because it is in the table exactly as the played ones are');
    return `all ${LINE_KINDS.length} contours have a live emitter (${files.length} modules scanned)`;
  });

  check('spectacle: the wheel\'s markup and its hit test agree about where every slot is', () => {
    const doc = makeDocument('<div id="emote-wheel"></div>');
    const restore = doc.install();
    try {
      const host = doc.getElementById('emote-wheel');
      const wheel = new EmoteWheel(host);
      assert(wheel.slots.length === EMOTES.length,
        `${wheel.slots.length} slots built for ${EMOTES.length} emotes`);
      const REACH = EMOTE_DEADZONE * 2.4;
      for (let i = 0; i < EMOTES.length; i++) {
        const a = emoteAngle(i);
        // Where the CURSOR has to be for the hit test to choose this slot…
        const got = emoteAt(Math.cos(a) * REACH, Math.sin(a) * REACH);
        assert(got === i, `a cursor pointing at slot ${i} (${EMOTES[i].name}) selects slot ${got} `
          + `(${EMOTES[got]?.name ?? 'none'})`);
        // …and where the MARKUP put it. Two answers to "where is this slot" is
        // a wheel a player only finds wrong by pressing it.
        const left = parseFloat(wheel.slots[i].style.left), top = parseFloat(wheel.slots[i].style.top);
        assert(Math.abs((left - 50) - Math.cos(a) * 37) < 0.01 && Math.abs((top - 50) - Math.sin(a) * 37) < 0.01,
          `slot ${i} is drawn at ${left}%,${top}% and picked at ${(Math.cos(a) * 37 + 50).toFixed(1)}%,`
          + `${(Math.sin(a) * 37 + 50).toFixed(1)}%`);
        assert(wheel.slots[i].innerHTML.includes(EMOTES[i].name), `slot ${i} does not print its own name`);
      }
      assert(emoteAt(0, 0) === -1, 'the middle of the wheel selects a slot — there is no way to cancel');
      assert(emoteAt(EMOTE_DEADZONE - 1, 0) === -1, 'the deadzone does not reach EMOTE_DEADZONE');
      assert(emoteAt(0, -REACH) === 0, 'straight up is not the first slot, so the table order is not the wheel order');
      return `${EMOTES.length} slots, markup and hit test agree at every one, dead centre cancels`;
    } finally { restore(); }
  });

  check('spectacle: holding the key, choosing a slot and letting go says that slot\'s line', () => {
    const doc = makeDocument('<div id="emote-wheel"></div>');
    const restore = doc.install();
    try {
      const said = [];
      const wheel = new EmoteWheel(doc.getElementById('emote-wheel'));
      const announcer = new Announcer({
        speak: (spec, kind) => { said.push({ spec, kind }); return 0.4; },
        setVoiceLevel() {}, ui() {},
      });
      const pops = [];
      const hud = {
        announcer, popup: (t, s, k) => { pops.push({ t, s, k }); return {}; },
        emote: HUD.prototype.emote, _emoteTick: HUD.prototype._emoteTick,
      };
      const settings = { ...DEFAULT_SETTINGS, voiceIndex: 3 };
      const control = { flourishT: -1 };
      const player = { chest: new THREE.Vector3(0, 1.4, 0), control };
      const world = { settings };

      // Slot 2, chosen the way a player chooses one: hold the key, push the
      // mouse at it, let go. A real Input, so the action comes off the table.
      const input = freshInput();
      const target = 2;
      const a = emoteAngle(target);
      hold(input, 'emote');
      input.mouse.dx = Math.cos(a) * 90; input.mouse.dy = Math.sin(a) * 90;
      assert(wheel.update(input, hud) === null, 'the wheel committed while the key was still down');
      assert(wheel.on && wheel.sel === target,
        `the wheel selected slot ${wheel.sel} where the mouse pointed at ${target}`);
      assert(wheel.slots[target].classList.contains('sel'), 'the chosen slot is not lit');

      input.keys.clear(); input.mouse.dx = 0; input.mouse.dy = 0;
      const picked = wheel.update(input, hud);
      assert(picked === EMOTES[target], `letting go played ${picked && picked.id} rather than ${EMOTES[target].id}`);
      assert(!wheel.on && !wheel.slots[target].classList.contains('sel'), 'the wheel stayed open');

      hud.emote(picked, world, player);
      assert(said.length === 1, `${said.length} utterances for one emote`);
      assert(said[0].kind === EMOTES[target].line,
        `the ${EMOTES[target].id} slot said "${said[0].kind}" and names "${EMOTES[target].line}"`);
      assert(said[0].spec === voiceAt(3),
        'the emote spoke in a voice the player did not choose — it is not reading voiceIndex live');
      assert(pops.length === 1 && pops[0].k === 'emote' && pops[0].t === EMOTES[target].name.toUpperCase(),
        'the emote left nothing on screen to say what happened');

      // The gesture, and only where one is declared.
      for (const e of EMOTES) {
        control.flourishT = -1;
        hud.emote(e, world, player);
        assert((control.flourishT === 0) === !!e.gesture,
          `${e.id} ${e.gesture ? 'declares a gesture and moved nothing' : 'moved the blade with no gesture declared'}`);
        // …and a twirl already running is never restarted, which is what
        // SaberController's own `flourishT < 0` guard means.
        control.flourishT = 0.3;
        hud.emote(e, world, player);
        assert(control.flourishT === 0.3, `${e.id} restarted a flourish that was already halfway through`);
      }

      // EVERY switch the rest of the voice honours. An emote is not a reason to
      // overrule an option the player set.
      said.length = 0; pops.length = 0;
      hud.emote(EMOTES[0], { settings: { ...settings, voiceLines: false } }, player);
      assert(said.length === 0, 'a player who switched their own voice off was made to speak');
      assert(pops.length === 1, 'switching the voice off also took away the caption and the gesture');
      said.length = 0;
      // …and the quip gap, which exists to stop the GAME talking over itself,
      // may not swallow a key press. Two emotes in a row both land.
      announcer.quipT = QUIP_GAP;
      hud.emote(EMOTES[1], world, player);
      assert(said.length === 1, 'a deliberate emote was refused by the automatic quip budget');
      assert(announcer.quipT > 0, 'the emote did not take the budget, so the next automatic line lands on top of it');
      return `slot ${target} (${EMOTES[target].name}) → "${EMOTES[target].line}" in ${voiceAt(3).name}; `
        + `${EMOTES.filter(e => e.gesture).length} gestures fire, ${EMOTES.length - EMOTES.filter(e => e.gesture).length} do not; `
        + 'voiceLines off → silent, quip gap does not refuse it';
    } finally { restore(); }
  });

  check('spectacle: the wheel is in the table, on a key of its own, and on the page a player reads', () => {
    const row = ACTIONS.find(a => a.id === 'emote');
    assert(row && row.hold, 'the emote wheel is not a held action — the mouse picks while the key is down');
    const b = defaultBindings();
    for (const code of b.emote) {
      assert(!findConflicts(b, code, 'emote').length,
        `the wheel defaults to ${code}, which ${findConflicts(b, code, 'emote').join('+')} answers to`);
    }
    const probe = defaultBindings();
    probe.emote = ['F13'];
    assert(/<kbd>(?:Hold )?F13<\/kbd>/.test(codexHtml(probe)), 'the Codex never prints the wheel\'s binding');
    assert(CODEX.some(r => (r.keys || []).includes('emote')), 'no Codex row names the wheel');
    assert(INDEX.includes('id="emote-wheel"'), 'index.html has no host for the wheel');
    // No slot markup on the page: eight typed positions and one computed hit
    // test is two answers to where a slot is.
    const host = INDEX.slice(INDEX.indexOf('id="emote-wheel"'));
    assert(!/class="em"/.test(host.slice(0, host.indexOf('</div>'))),
      'the wheel\'s slots are typed into the markup as well as computed from the table');
    /* The rule is shared with the ORDER wheel now — same class, same geometry,
     * same hit test (see `RadialWheel`) — so the selector is a list and the
     * test asks whether this wheel is in it rather than whether it is alone. */
    assert(/#emote-wheel[,{]/.test(CSS) && /\.em\.sel\{/.test(CSS), 'the wheel has no styles');
    return `emote on ${b.emote.map(keyLabel).join('+')}, hold, in the Codex, host in index.html, no typed slots`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. THE FREE CAMERA                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('spectacle: the free camera comes off the body, and the game does not advance while it is off', async () => {
    /**
     * A REAL WORLD, because the claim is about World's own clock.
     *
     * "The game must not be advanced while it is on, or it is a cheat rather
     * than a camera" is not a property of the camera at all — it is a property
     * of what the world does on the frames the camera is up. So this drives the
     * real frame order main.js uses (`input.begin` → `world.update` →
     * `hud.update` → `input.end`) against a real World with a real level and a
     * real player in it, and measures the world clock.
     */
    const { world } = await bootWorld({ level: 'colosseum' });
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      const input = freshInput();
      hud.setBindings(input.bindings);
      tapFrame(world);
      const camera = world.engine.camera;
      const dt = 1 / 60;
      /**
       * main.js's own frame order, and `mid` is where the measurement goes.
       *
       * The camera the free camera has to give BACK is the one the rig had at
       * the instant HUD.update was entered — after `world.update` posed it for
       * that frame, before anything in the HUD has touched it. Taking the
       * snapshot there rather than reading FreeCam's stored copy is what makes
       * "it puts the view back" a measurement instead of a tautology: a version
       * that stored the wrong thing would restore its own wrong thing and agree
       * with itself perfectly.
       */
      const frame = (mid = null) => {
        input.begin(dt);
        world.update(dt, input);
        if (mid) mid();
        hud.update(dt, world, world.player, camera);
        input.end();
      };

      for (let i = 0; i < 12; i++) frame();
      const running = world.time;
      assert(running > 0, 'the world did not advance before the camera was ever touched');
      assert(!hud.freecam.on, 'the free camera is on at boot');

      // Press it. `hold` puts the key down for exactly one frame, which is what
      // actHit reads.
      let eye = null, aim = null;
      hold(input, 'freecam');
      frame(() => { eye = camera.position.clone(); aim = camera.quaternion.clone(); });
      assert(hud.freecam.on, 'pressing the free-camera key did nothing');
      assert(world.paused === true, 'the world is still running under a detached camera — that is a wallhack');
      assert(hud.el.hud.classList.contains('hidden'), 'the HUD is still on screen in a screenshot mode');
      assert(!hud.el.freecam.classList.contains('hidden'), 'nothing tells the player how to get back');
      assert(hud.el.freecamKey.textContent.includes(keyLabel(input.bindings.freecam[0])),
        `the way back reads "${hud.el.freecamKey.textContent}" and the key is ${keyLabel(input.bindings.freecam[0])}`);

      // Fly it, for a full second of frames, with bodies in the level.
      const frozen = world.time;
      const bodiesBefore = world.enemies.map(e => e.position.clone());
      input.keys.clear();
      hold(input, 'moveF');
      for (let i = 0; i < 60; i++) { input.mouse.dx = 4; frame(); }
      assert(world.time === frozen, `the world clock moved ${(world.time - frozen).toFixed(4)} s while the camera was off the body`);
      const moved = world.enemies.filter((e, i) => e.position.distanceTo(bodiesBefore[i]) > 1e-9);
      assert(!moved.length, `${moved.length} of ${world.enemies.length} bodies moved while the game was stopped`);
      const flew = camera.position.distanceTo(eye);
      assert(flew > 3, `a second of holding forward moved the camera ${flew.toFixed(2)} m`);
      assert(Math.abs(hud.freecam.yaw) > 0.1, 'the mouse did not turn the free camera');

      // Even if something else un-pauses underneath it — main.js's own resume()
      // writes `paused = false` — the camera puts it back rather than letting a
      // frame of the game run.
      world.paused = false;
      const stolen = world.time;
      for (let i = 0; i < 10; i++) frame();
      assert(world.paused === true && world.time === stolen,
        'something un-paused the world under a detached camera and it stayed that way');

      // And back. The transform and the pause state are both restored.
      input.keys.clear();
      hold(input, 'freecam');
      frame();
      assert(!hud.freecam.on, 'the free camera would not come off');
      assert(camera.position.distanceTo(eye) < 1e-9 && camera.quaternion.angleTo(aim) < 1e-9,
        `coming back left the view ${camera.position.distanceTo(eye).toFixed(4)} m from where it was`);
      assert(world.paused === false, 'the world stayed paused after the camera came back');
      assert(!hud.el.hud.classList.contains('hidden'), 'the HUD did not come back');
      assert(hud.el.freecam.classList.contains('hidden'), 'the free-camera line is still on screen');
      input.keys.clear();
      for (let i = 0; i < 10; i++) frame();
      assert(world.time > stolen, 'the game never started again');
      return `world clock: ${running.toFixed(3)} s running → frozen for 70 frames → running again; `
        + `camera flew ${flew.toFixed(1)} m and came back to within 1e-9 m`;
    } finally { restore(); world.unload?.(); world.dispose?.(); }
  });

  check('spectacle: the free camera flies on the movement bindings and on nothing else', () => {
    // No world needed: this is about which controls reach it. Rebinding forward
    // onto a key nothing uses and finding the camera follows is the only way to
    // show it is not reading a key code of its own.
    const cam = new THREE.PerspectiveCamera();
    const fly = (bindings, ids, seconds = 0.5) => {
      const c = new THREE.PerspectiveCamera();
      const w = { paused: false };
      const f = new FreeCam();
      f.enter(w, c, null);
      const input = freshInput();
      input.setBindings(bindings);
      input.keys.clear();
      for (const id of ids) for (const code of bindings[id]) input.keys.add(code);
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i++) f.step(dt, input, w, c);
      const d = c.position.clone();
      f.exit(null);
      return d;
    };
    const b = defaultBindings();
    const fwd = fly(b, ['moveF']).length();
    assert(fwd > 1, `holding forward moved the camera ${fwd.toFixed(2)} m in half a second`);
    const rebound = defaultBindings();
    rebound.moveF = ['F13'];
    const after = fly(rebound, ['moveF']).length();
    assert(Math.abs(after - fwd) < 1e-6,
      'rebinding forward changed how far the free camera flew — it is reading a key of its own');
    assert(fly(b, []).length() === 0, 'the camera drifts with nothing held');

    // Fast on sprint, precise on the slow walk — the same two modifiers that
    // move the body, doing the same two things to a camera.
    const fast = fly(b, ['moveF', 'sprint']).length();
    const slow = fly(b, ['moveF', 'walk']).length();
    assert(Math.abs(fast / fwd - FREECAM.boost) < 0.02, `sprint flew ${(fast / fwd).toFixed(2)}× and boost is ${FREECAM.boost}`);
    assert(Math.abs(slow / fwd - WALK_SCALE) < 0.02, `the walk crept at ${(slow / fwd).toFixed(2)}× and WALK_SCALE is ${WALK_SCALE}`);
    // Up and down, which are the two a photographer needs most.
    assert(fly(b, ['jump']).y > 0.5 && fly(b, ['crouch']).y < -0.5, 'the camera cannot be raised or lowered');
    // A diagonal is not faster than a straight line.
    const diag = fly(b, ['moveF', 'moveR']).length();
    assert(Math.abs(diag - fwd) < 1e-6, `a diagonal flew ${diag.toFixed(3)} m against ${fwd.toFixed(3)} straight`);

    // …and it refuses to fly a camera that is not the one it detached, which is
    // the one unrecoverable state this mode can reach.
    const f = new FreeCam();
    const w = { paused: false };
    f.enter(w, cam, null);
    assert(f.step(1 / 60, freshInput(), { paused: false }, cam) === false,
      'the free camera flew on against a world it never detached from');
    assert(f.step(1 / 60, freshInput(), w, new THREE.PerspectiveCamera()) === false,
      'the free camera flew a camera it never took');
    return `forward ${fwd.toFixed(2)} m/half-second, unchanged after a rebind; sprint ${FREECAM.boost}×, `
      + `walk ${WALK_SCALE}×, diagonal not faster, refuses a world it did not detach`;
  });

  check('spectacle: the free camera turns at the rate the rest of the game turns', async () => {
    // FREECAM.look is SaberController's `camGain`, quoted rather than imported
    // so that HUD.js does not take an import edge into the blade controller for
    // one number. A quoted number is a number that can drift, so this is what
    // says so — the same instrument SETTING_READERS uses, one layer down.
    const ctrl = await read('src/game/SaberController.js');
    const m = ctrl.match(/this\.camGain\s*=\s*([\d.]+)/);
    assert(m, 'SaberController no longer has a camGain — the free camera is quoting a number that is gone');
    assert(Math.abs(parseFloat(m[1]) - FREECAM.look) < 1e-9,
      `the camera turns at ${FREECAM.look} rad/px and the game turns at ${m[1]} — a photographer has to `
      + 'relearn their wrist the moment they press the key');
    // …and the pitch stops short of straight up, or the yaw becomes meaningless
    // at the poles and the horizon rolls.
    assert(FREECAM.pitchMax > 1.3 && FREECAM.pitchMax < Math.PI / 2,
      `pitch is clamped at ${FREECAM.pitchMax} rad`);
    const c = new THREE.PerspectiveCamera();
    const w = { paused: false };
    const f = new FreeCam();
    f.enter(w, c, null);
    const input = freshInput();
    for (let i = 0; i < 200; i++) { input.mouse.dy = -60; f.step(1 / 60, input, w, c); }
    assert(Math.abs(f.pitch - FREECAM.pitchMax) < 1e-9, `pitch ran to ${f.pitch}`);
    f.exit(null);
    return `${FREECAM.look} rad/px, the same as SaberController.camGain; pitch clamped at `
      + `${(FREECAM.pitchMax * 180 / Math.PI).toFixed(0)}°`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. THE LADDERS, AND THE BODY                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('spectacle: a killstreak that leaps a rung is still announced', () => {
    /**
     * THE BUG. `rung` matched a count EXACTLY, and a count does not climb one at
     * a time: kills are differenced once a frame and a rend, a thrown blade down
     * a corridor or one explosion take three, four or six bodies inside a single
     * frame. Measured against the shipped ladder before the fix, 0→2 announced
     * DOUBLE STRIKE and 0→6 — the most spectacular thing the game produces —
     * announced nothing at all and took the ordinary one-kill grunt.
     */
    const drive = (jumps) => {
      const seen = [];
      const a = new Announcer({ speak: () => 0.2, setVoiceLevel() {} });
      const hud = { popup: (t, s, k) => { seen.push({ t, k }); } };
      const p = { kills: 0, deflects: 0, perfects: 0, chambers: 0, hp: 100, maxHp: 100,
        alive: true, grounded: true, velocity: { y: 0 }, saber: { tipSpeed: 0 },
        chest: new THREE.Vector3() };
      const world = { settings: { ...DEFAULT_SETTINGS }, enemies: [] };
      a.update(1 / 60, world, p, hud);        // baseline frame
      for (const got of jumps) {
        p.kills += got;
        a.update(1 / 60, world, p, hud);
      }
      return seen.filter(s => s.k === 'streak').map(s => s.t);
    };

    const one = drive([1, 1, 1, 1, 1]);
    assert(one.join('|') === STREAKS.filter(r => r.at <= 5).map(r => r.title).join('|'),
      `killing five one at a time announced ${one.join(', ') || 'nothing'}`);

    // The jump. Six at once crosses 2, 3, 4 and 5, and the HIGHEST rung crossed
    // is the one worth saying — not four popups in one frame, and not silence.
    const six = drive([6]);
    assert(six.length === 1, `six kills on one frame produced ${six.length} popups`);
    assert(six[0] === STREAKS.filter(r => r.at <= 6).pop().title,
      `six kills on one frame announced "${six[0] ?? 'nothing'}"`);
    for (const n of [2, 3, 4, 5, 6, 8, 9, 12]) {
      const got = drive([n]);
      const want = STREAKS.filter(r => r.at <= n).pop();
      assert(got.length === 1 && got[0] === want.title,
        `${n} kills on one frame announced ${got.join(', ') || 'nothing'}, and the ladder's highest rung at or `
        + `under ${n} is ${want.title}`);
    }
    // A rung is never announced twice inside one streak: 3 then 3 more crosses
    // 5 and 7, and says each once.
    const staged = drive([3, 3, 4]);
    assert(new Set(staged).size === staged.length, `a rung was announced twice: ${staged.join(', ')}`);
    assert(staged.length === 3, `3+3+4 announced ${staged.length} rungs: ${staged.join(', ')}`);
    assert(staged[0] === 'TRIPLE STRIKE', `the first rung was ${staged[0]}`);
    assert(staged[staged.length - 1] === STREAKS[STREAKS.length - 1].title,
      `ten kills never reached the top rung: ${staged.join(', ')}`);
    return `1×5 → ${one.length} rungs; one frame of n kills → the highest rung at or under n, `
      + `for n = 2,3,4,5,6,8,9,12; 3+3+4 → ${staged.join(' → ')}`;
  });

  check('spectacle: the deflection and chamber ladders can be jumped too', () => {
    const drive = (ladder, field, jumps) => {
      const seen = [];
      const a = new Announcer({ speak: () => 0.2, setVoiceLevel() {} });
      const hud = { popup: (t, s, k) => seen.push(t) };
      const p = { kills: 0, deflects: 0, perfects: 0, chambers: 0, hp: 100, maxHp: 100,
        alive: true, grounded: true, velocity: { y: 0 }, saber: { tipSpeed: 0 },
        chest: new THREE.Vector3() };
      const world = { settings: { ...DEFAULT_SETTINGS }, enemies: [] };
      a.update(1 / 60, world, p, hud);
      for (const got of jumps) { p[field] += got; a.update(1 / 60, world, p, hud); }
      return seen;
    };
    // Two bolts can land on one frame, and a volley can land four.
    for (const n of [3, 4, 6, 7, 10, 11, 16, 20]) {
      const got = drive(RETURNS, 'deflects', [n]).filter(t => RETURNS.some(r => r.title === t));
      const want = RETURNS.filter(r => r.at <= n).pop();
      assert(got.length === 1 && got[0] === want.title,
        `${n} deflections on one frame announced ${got.join(', ') || 'nothing'}, not ${want.title}`);
    }
    for (const n of [2, 3, 4, 5, 6]) {
      const got = drive(CHAMBERS, 'chambers', [n]).filter(t => CHAMBERS.some(r => r.title === t));
      const want = CHAMBERS.filter(r => r.at <= n).pop();
      assert(got.length === 1 && got[0] === want.title,
        `${n} chambers on one frame announced ${got.join(', ') || 'nothing'}, not ${want.title}`);
    }
    return `returns and chambers both announce the highest rung a jump crosses `
      + `(${RETURNS.length} + ${CHAMBERS.length} rungs, jumps of 2 to 20)`;
  });

  check('spectacle: the popup switch still takes every one of these off the screen', () => {
    // The other half of note 13a, and the half a new event kind could silently
    // escape: the ladders go through HUD.popup, which is gated, and the emote
    // does too.
    const seen = [];
    const a = new Announcer({ speak: () => 0.2, setVoiceLevel() {} });
    const hud = { popup: () => seen.push(1) };
    const p = { kills: 0, deflects: 0, perfects: 0, chambers: 0, hp: 100, maxHp: 100,
      alive: true, grounded: true, velocity: { y: 0 }, saber: { tipSpeed: 0 }, chest: new THREE.Vector3() };
    const settings = { ...DEFAULT_SETTINGS, popups: false };
    const world = { settings, enemies: [] };
    a.update(1 / 60, world, p, hud);
    p.kills = 6; p.deflects = 12; p.chambers = 5; p.perfects = 3;
    a.update(1 / 60, world, p, hud);
    assert(seen.length === 0, `${seen.length} popups arrived with Event popups switched off`);
    // Back on, through `perfects` — a plain pulse with no ladder under it, so
    // this half of the claim cannot be turned red by anything about the rungs.
    settings.popups = true;
    p.perfects = 4;
    a.update(1 / 60, world, p, hud);
    assert(seen.length > 0, 'the switch is one-way');
    return 'streak, return, chamber and perfect popups all pass through the one gated call';
  });

  check('spectacle: injuries reach the body through the seam the game actually calls', async () => {
    /**
     * Note 14 asks for blood and torn cloth on the body, toggleable, and all of
     * it exists — src/game/Injury.js, marks, the cap, the wipe, and a gate on
     * `Player.damage`. What nothing asserted is the LINK: `applyInjury` is armed
     * by `applyFeelSettings`, and `applyFeelSettings` is what main.js calls. A
     * gate that works and is never installed is the same lie as a setting with
     * no reader.
     */
    const { buildJedi } = await import('../../src/game/Bodies.js');
    const built = buildJedi({});
    built.rig.updateMatrices();
    built.rig.root.updateMatrixWorld(true);
    let tris = 0;
    const count = () => { let t = 0; built.rig.root.traverse(o => { if (o.isMesh && o.geometry?.index) t += o.geometry.index.count; }); return t; };
    const player = {
      rig: built.rig, hp: 100, maxHp: 100, isLocal: true, boonMods: { moveSpeed: 1 },
      update() {}, damage(a) { this.hp -= a; return this.hp <= 0; }, heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); },
      control: {}, camera: null,
    };
    const world = { players: [player], addHitstop() {}, hitstop: 0, update() {} };
    const s = { ...DEFAULT_SETTINGS };
    applyFeelSettings(world, s);
    tris = count();
    player.damage(30, new THREE.Vector3(0, 1.3, 0.3), null, 'bolt');
    assert(count() > tris, 'applyFeelSettings did not arm the injury gate — main.js calls this and only this');
    assert(player.injury && player.injury.wounds.length === 1, 'the hit left no wound on the body');
    const main = await read('src/main.js');
    assert(/applyFeelSettings\(world, settings\)/.test(main), 'main.js no longer calls the seam that arms it');
    // …and the box takes them off, live, on the same blob.
    s.injury = false;
    applyFeelSettings(world, s);
    assert(count() === tris, 'unticking the box left the marks on the body');
    return `applyFeelSettings arms Injury on the real rig: a hit adds geometry, the box wipes it`;
  });

  check('spectacle: the ORDER wheel is the same machine, with the mode\'s own table in it', () => {
    /* Note #18: "commanding your troops takes up too many buttons so it needs
     * to be a small popup mousewheel sort of thing you know like in other
     * games where you press a botton and use your mouse to select one of the
     * options in the popup wheel."
     *
     * Six digit keys become one held key and a flick. Two properties, and the
     * second is the one that keeps it honest a year from now: the wheel's
     * table is `FORMATIONS`, not a copy of it, so a seventh order appears on
     * it the day it is authored and cannot appear with the wrong words on. */
    assert(INDEX.includes('id="order-wheel"'), 'index.html has no host for the order wheel');
    const host = INDEX.slice(INDEX.indexOf('id="order-wheel"'));
    assert(!/class="em/.test(host.slice(0, host.indexOf('</div>'))),
      'the order wheel\'s slots are typed into the markup as well as computed from the table');
    assert(/#order-wheel[,{]/.test(CSS) && /\.em\.ow\{/.test(CSS), 'the order wheel has no styles');

    const b = defaultBindings();
    assert(b.orderwheel?.length, 'the order wheel has no default binding');
    for (const code of b.orderwheel) {
      assert(!findConflicts(b, code, 'orderwheel').length,
        `the order wheel defaults to ${code}, which ${findConflicts(b, code, 'orderwheel').join('+')} answers to`);
    }
    const probe = defaultBindings();
    probe.orderwheel = ['F13'];
    assert(/<kbd>(?:Hold )?F13<\/kbd>/.test(codexHtml(probe)),
      'the Codex never prints the order wheel\'s binding');

    /* AND THE TABLE IS COMMAND'S. Built against a fake FORMATIONS with a name
     * nothing else in the game has, so a wheel that had quietly grown its own
     * copy of the real six would fail here rather than in a year. */
    const fake = {
      alpha: { id: 'alpha', name: 'Alpha', blurb: 'first' },
      beta: { id: 'beta', name: 'Beta', blurb: 'second' },
    };
    const el = { innerHTML: '', children: [], classList: { add() {}, remove() {}, toggle() {} },
      appendChild(c) { this.children.push(c); } };
    const made = [];
    const realCreate = globalThis.document.createElement.bind(globalThis.document);
    const w = new OrderWheel(el, fake);
    /**
     * THE COUNT IS DERIVED, and it was `3` typed in.
     *
     * That was true when HOLD was the only slot the wheel always carried, and
     * it went stale the day TARGET and DETACH arrived — a red check reporting
     * "5 slots for two formations, it should be those two plus HOLD" about a
     * wheel that was working exactly as intended. `WHEEL_EXTRAS` is the table
     * the wheel builds those slots from, so the arithmetic here cannot drift
     * from it again, and a fourth fixed slot is still a red check until
     * somebody has looked at what six slots do to the geometry.
     */
    const want = Object.keys(fake).length + WHEEL_EXTRAS.length;
    assert(w.items.length === want,
      `the wheel holds ${w.items.length} slots for ${Object.keys(fake).length} formations — it `
      + `should be those plus ${WHEEL_EXTRAS.length} fixed `
      + `(${WHEEL_EXTRAS.map((x) => x.id).join(', ')})`);
    assert(w.items[0].id === 'alpha' && w.items[1].id === 'beta',
      'the wheel is not built from the formations it was handed');
    /* …AND THEY ARE THE TABLE'S, IN THE TABLE'S ORDER. A wheel that built the
     * right NUMBER of fixed slots out of its own literals would pass the count
     * above and be the copied table this check exists to prevent. */
    for (let i = 0; i < WHEEL_EXTRAS.length; i++) {
      const got = w.items[Object.keys(fake).length + i];
      assert(got.kind === WHEEL_EXTRAS[i].kind && got.id === WHEEL_EXTRAS[i].id,
        `fixed slot ${i} is ${got.id}/${got.kind} and the table says `
        + `${WHEEL_EXTRAS[i].id}/${WHEEL_EXTRAS[i].kind}`);
    }
    assert(w.slots.length === want, `${w.slots.length} slot nodes for ${want} items`);
    /* The slots are placed from the SAME function the hit test reads back, at
     * the wheel's own length — so a three-slot wheel is thirds and an
     * eight-slot one is eighths, and neither has a transform typed anywhere. */
    for (let i = 0; i < want; i++) {
      const a = emoteAngle(i, want);
      const at = `${(50 + Math.cos(a) * 37).toFixed(3)}%`;
      assert(w.slots[i].style.left === at,
        `slot ${i} sits at ${w.slots[i].style.left} and the hit test says ${at}`);
      assert(emoteAt(Math.cos(a) * 80, Math.sin(a) * 80, want) === i,
        `pushing at slot ${i} picks ${emoteAt(Math.cos(a) * 80, Math.sin(a) * 80, want)}`);
    }
    void realCreate; void made;
    return `order wheel on ${b.orderwheel.join('/')}, ${w.items.length} slots derived from `
      + `${Object.keys(fake).length} formations plus ${WHEEL_EXTRAS.length} fixed `
      + `(${WHEEL_EXTRAS.map((x) => x.id).join(', ')}), geometry shared with the emote wheel`;
  });

}
