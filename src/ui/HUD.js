/**
 * BATTLEFRONT BORZ — heads-up display.
 *
 * DOM over the canvas: cheap, crisp at any resolution, and it keeps text out
 * of the render target where bloom would eat it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, lerp } from '../engine/MathUtil.js';
import { Announcer } from './Announcer.js';
import { Presence } from '../engine/Presence.js';
import { keyLabel, walkScale, ORDER_ACTIONS, codesFor } from '../engine/Bindings.js';
import { drivableNear, whyNotDrive, crewOf } from '../game/Driving.js';
/**
 * The two lookup tables the roster panel draws WITH, never a copy of them.
 *
 * `roster.summary()` publishes a rank by its short code ('SGT') and an army by
 * its id ('republic'), and a panel that wants the insignia colour or the army's
 * proper name has to ask the table those came out of. Typing `SGT → #2f6fbe`
 * here would be the eighth hand-maintained twin in this codebase (HANDOFF
 * §2.3), and the first repaint of an insignia would make the HUD disagree with
 * the model wearing it.
 */
import { RANKS, ARMIES, ORDERS } from '../game/Command.js';
import { DIR_GLYPH, callPhrase } from '../game/Stratagems.js';
import { POWER_COST, POWER_BOON } from '../game/Powers.js';
import { supportCost } from '../game/Stratagems.js';
// The words a slot is about to say, and whether this browser can say them
// at all. Audio.js owns both the table and the speaking; the wheel prints.
import { wordsFor, canSpeakWords } from '../engine/Audio.js';
import { openState, openMul } from '../game/Combat.js';

const _v = new THREE.Vector3();
const num = (v, d) => (Number.isFinite(v) ? v : d);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE RETICLE                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A reticle is a personal thing, and this one was a hard-coded ring.
 *
 * It sits in the exact centre of the screen for the entire game, so its shape,
 * its size and its colour are the settings a player is most likely to have an
 * opinion about — and the ring was drawn once in index.html with a white stroke
 * baked into styles.css, so there was nothing to have an opinion about.
 *
 * Each shape draws itself into the same 100×100 viewBox with the colour written
 * as a presentation attribute rather than a style. That is deliberate: an
 * attribute loses to a stylesheet rule, so `#reticle.hot .ret-*` still turns the
 * whole thing red when something is close enough to kill you. A custom colour
 * that could hide the threat state would be a customisation that removes
 * information, which is not a customisation.
 */
export const RETICLE_SHAPES = [
  {
    id: 'ring', name: 'Ring',
    draw: (c) => `<circle class="ret-ring" cx="50" cy="50" r="15" stroke="${c}"></circle>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.4" fill="${c}"></circle>`
      + `<path class="ret-tick" d="M50 26 v6 M50 68 v6 M26 50 h6 M68 50 h6" stroke="${c}"></path>`,
  },
  {
    id: 'dot', name: 'Dot',
    draw: (c) => `<circle class="ret-dot" cx="50" cy="50" r="2.6" fill="${c}"></circle>`,
  },
  {
    id: 'cross', name: 'Cross',
    draw: (c) => `<path class="ret-tick" d="M50 30 v11 M50 59 v11 M30 50 h11 M59 50 h11" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.2" fill="${c}"></circle>`,
  },
  {
    id: 'chevron', name: 'Chevron',
    draw: (c) => `<path class="ret-ring" d="M34 62 L50 44 L66 62" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.3" fill="${c}"></circle>`,
  },
  {
    id: 'brackets', name: 'Brackets',
    draw: (c) => `<path class="ret-ring" d="M32 40 v-8 h8 M68 40 v-8 h-8 M32 60 v8 h8 M68 60 v8 h-8" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.3" fill="${c}"></circle>`,
  },
  {
    id: 'pip', name: 'Pip',
    draw: (c) => `<path class="ret-tick" d="M50 32 v9" stroke="${c}"></path>`
      + `<circle class="ret-dot" cx="50" cy="50" r="1.8" fill="${c}"></circle>`,
  },
  // Not an empty option for the sake of one: in first person with the blade
  // cursor on, the centre ring is genuinely redundant, and some players aim
  // down the blade.
  { id: 'none', name: 'None', draw: () => '' },
];

export const RETICLE_COLORS = [
  { name: 'Bone', hex: '#ffffff' },
  { name: 'Blade', hex: '#7fd6ff' },
  { name: 'Amber', hex: '#ffb64a' },
  { name: 'Verdant', hex: '#5dffa8' },
  { name: 'Violet', hex: '#b39dff' },
  { name: 'Crimson', hex: '#ff6b74' },
  { name: 'Ion', hex: '#66ff99' },
  { name: 'Ash', hex: '#9fb0c6' },
];

const pick = (list, i) => list[((Math.round(num(i, 0)) % list.length) + list.length) % list.length];
export const shapeAt = (i) => pick(RETICLE_SHAPES, i);
export const colorAt = (i) => pick(RETICLE_COLORS, i);

/** The base width of the reticle box in CSS pixels, at scale 1. */
export const RETICLE_BASE = 44;

/**
 * Repaint the reticle from the settings — and only when they have moved.
 *
 * Exported and given the element rather than owned by the HUD instance because
 * the OPTIONS SCREEN needs it too: the three controls live on a pause card
 * where `HUD.update` is not running, so without a shared entry point a player
 * would change the colour and see nothing until they resumed. One function, two
 * callers, no second copy of the shape table in Menu.js.
 *
 * @returns the signature it painted, or null if there was nothing to paint.
 */
export function applyReticle(el, s = {}) {
  if (!el || !s) return null;
  const shape = shapeAt(s.reticleShape);
  const col = colorAt(s.reticleColor);
  const size = clamp(num(s.reticleSize, 1), 0.45, 2.4);
  const sig = `${shape.id}|${col.hex}|${size.toFixed(3)}`;
  if (el._retSig === sig) return sig;
  el._retSig = sig;
  el.innerHTML = shape.draw(col.hex);
  const px = `${(RETICLE_BASE * size).toFixed(1)}px`;
  el.style.width = px;
  el.style.height = px;
  return sig;
}

/**
 * The wheel's slots, in order, each with the ACTION ID it is labelled from.
 * The two are not always the same word — the wheel calls it `throw` and the
 * bindings table calls the action `throw` too, but `grip` on the wheel is the
 * hold-to-grip action and there is a second `grip2` for the one-handed stance.
 * Naming them separately is what stops the next edit guessing.
 */
/**
 * The wheel, in order. Each entry is `[power, binding]`.
 *
 * REND IS THE TENTH, and it was bound (`KeyN`, `Bindings.js`), costed, and
 * drawn nowhere: nine slots for ten powers. A player who pressed N got a
 * refusal quoting a number the wheel never showed them, for a power the wheel
 * gave no sign existed — and the refusal named "sundering", which is an
 * unrelated epic boon.
 */
export const POWERS = [
  ['push', 'push'], ['pull', 'pull'], ['grip', 'grip'], ['throw', 'throw'],
  ['sense', 'sense'], ['lightning', 'lightning'], ['stasis', 'stasis'],
  ['heal', 'heal'], ['compel', 'compel'], ['rend', 'rend'],
  /* The barrier — the twelfth, and it went in with its slot rather than after
     an audit found it drawn nowhere, which is what happened to rend. */
  ['shield', 'shield'],
  /* Unleash — the 360° repulse. This LIST is what builds the slots; `_power`
   * only repaints one that already exists, so adding a price and a `_power`
   * call without a row here draws nothing and prices eleven against ten
   * slots. hud-events counts exactly that, which is how it was caught. */
  ['unleash', 'unleash'],
];

/**
 * WHAT EACH SLOT COSTS — IMPORTED, NOT COPIED.
 *
 * This file used to carry its own nine numbers, and it had already been burned
 * by them once: the copies had lightning at 14 against a real 30 and stasis at
 * 30 against a real 26. The stopgap was tools/checks/hud-events.mjs GREPPING
 * each spend out of Player.js and matching it here, which holds only for as
 * long as the regex recognises the shape of the line it is looking for.
 *
 * It also had to describe three DIFFERENT gates, because three of Player's
 * nine powers bypassed `_spend`/`_canSpend`: throw and sense compared raw
 * force against a literal, and lightning applied the boon multiplier by hand
 * but not the drain. So Force Drain at 0 — the Options slider whose own label
 * reads "unlimited Force" — freed six powers and left three still charging,
 * and this wheel had to state that rather than the rule.
 *
 * Both are fixed in Player. One table, one gate, one import — and the table
 * lives in a leaf module rather than in Player, because HUD → Player → Menu →
 * HUD is a real import cycle in this tree.
 */
export { POWER_COST, POWER_BOON };

/** A key label is drawn into innerHTML; three characters can break it. */
const escKey = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const POWER_ICONS = {
  push:  '<svg viewBox="0 0 24 24"><path d="M4 12h10M14 8l4 4-4 4M18 5v14"/></svg>',
  pull:  '<svg viewBox="0 0 24 24"><path d="M20 12H10M10 8l-4 4 4 4M6 5v14"/></svg>',
  grip:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/></svg>',
  throw: '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M18 6h-5M18 6v5"/><circle cx="6" cy="18" r="2.2"/></svg>',
  sense: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
  jump:  '<svg viewBox="0 0 24 24"><path d="M12 20V6M8 10l4-4 4 4M5 21h14"/></svg>',
  lightning: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-2 7 8-11h-6z"/></svg>',
  // Stasis is a held bolt: a ring with the shot stopped inside it.
  stasis: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9 12h6"/><circle cx="12" cy="12" r="1.6"/></svg>',
  // Heal is the one power that gives rather than takes.
  heal: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/><circle cx="12" cy="12" r="8.5"/></svg>',
  // Compel turns a muzzle around: an arrow bent back on itself.
  compel: '<svg viewBox="0 0 24 24"><path d="M6 9h9a4 4 0 0 1 0 8H9"/><path d="M12 14l-3 3 3 3"/></svg>',
  // A chassis coming apart: a core with four plates pulling off it.
  rend:   '<svg viewBox="0 0 24 24"><rect x="10" y="10" width="4" height="4"/><path d="M8 8L4 4M16 8l4-4M8 16l-4 4M16 16l4 4"/></svg>',
  /* A dome over a figure: the one power in the row that is drawn around the
     player rather than thrown away from them. */
  shield: '<svg viewBox="0 0 24 24"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 11v6M9.5 17h5"/></svg>',
  /* A ring with arrows leaving it in every direction: the icon has to say
     "outward, all of it" at 21 px, which is the one thing that separates this
     from push in the row. */
  unleash: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M12 7.5V3M12 16.5V21M7.5 12H3M16.5 12H21M8.8 8.8L5.6 5.6M15.2 8.8l3.2-3.2M8.8 15.2l-3.2 3.2M15.2 15.2l3.2 3.2"/></svg>',
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE MINIMAP                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT THE MINIMAP IS ALLOWED TO COST.
 *
 * The budget is the design, not a limit bolted onto it. Wave 20 puts 25 bodies
 * in the arena and this thing draws every one of them, so the only question
 * that matters is how often. `hz` is the answer: a contact blip repainted 20
 * times a second is indistinguishable from one repainted 60 times — a body
 * moving at a sprint covers 12 cm between repaints, which is a third of a
 * pixel on this canvas — and it is a third of the work. At 25 bodies that is
 * 500 arcs a second against 1500, on a 132-px canvas. Per-body allocation is
 * zero — no vector, no object and no string is built for a contact; the one
 * allocation a repaint makes is the `plot` closure, twenty a second whatever
 * the roster is.
 *
 * `range` is the radius the rim stands for. Levels spawn inside 60 m; 42 m
 * covers the fight you are in without shrinking it to a smear, and anything
 * outside is CLAMPED to the rim rather than dropped, because "there is
 * something behind you, far away" is the single most useful thing a radar can
 * say and a dropped contact says nothing.
 */
/**
 * …and `linger` is how long a READING lasts after the Force sense that bought
 * it ends. See Minimap.update.
 *
 * 3.5 s, and the number is the pulse's whole design. Force sense is a TOGGLE
 * (Player.toggleSense) that needs POWER_COST.sense in the bar to switch on and
 * then charges `SENSE_DRAIN` a second while it is held open, blocking
 * regeneration entirely — so a player who wants a map has two ways to pay for
 * it: hold the power open and watch the pool drain, or tap it on and off for a
 * snapshot. The linger is what makes the second one a real choice: at 3.5 s a
 * tap is worth about one exchange, which is long enough to find the body behind
 * you and far too short to fight with the map up.
 *
 * TWO WORDS OF THAT WERE WRONG AND BOTH MATTERED. It said sense "costs
 * POWER_COST.sense to switch on", and it does not — the 25 is a THRESHOLD, read
 * through `_canSpend`, and `toggleSense` takes nothing out of the bar (its own
 * note says so); a tap therefore costs the linger and literally nothing else.
 * And it wrote the per-second drain as a bare 22, which is the hand-maintained
 * twin of a number that lived nowhere: it is `SENSE_DRAIN` in
 * src/game/Powers.js now, beside the twelve one-shot prices, because it is one.
 */
/* HOW MANY BOONS STILL GET THEIR NAME ON THE STRIP. Past this the chips go to
 * icons — see `HUD.setBoons`, which explains why a wall of named chips was the
 * thing pushing the command panels off the top of the screen. Ten is two rows
 * of named chips at 520 px, which is as much as the corner can spend before it
 * is competing with the vitals for the left of the frame. */
export const BOONS_NAMED = 10;

export const MINIMAP = { range: 42, hz: 20, size: 132, linger: 3.5 };

/**
 * The palette, exported so the checks can name a colour instead of matching a
 * hex literal they typed themselves — "the boss is not drawn in the same colour
 * as everything else" is a claim about this table, and a check with its own copy
 * of it would go green on a build where every blip was the same red.
 */
export const MINIMAP_COLORS = {
  self: '#7fd6ff',
  enemy: '#ff6b74',
  boss: '#ffb64a',
  ally: '#5dffa8',
  edge: 'rgba(255,107,116,.45)',
  /* The standing fire mission's ground. The same amber the ring on the field is
   * drawn in while it is unverified (`FireMission.js`'s MARK_COLOUR.standing),
   * so the shape on the disc and the shape on the ground read as one thing. */
  mark: '#ffb648',
};

/**
 * A radar, heading-up, driven off the same arrays the HUD already holds.
 *
 * HEADING-UP AND NOT NORTH-UP. A north-up map asks the player to rotate the
 * world in their head every time they turn, and this is a game in which you
 * turn constantly and are being shot at while you do it. Heading-up means a
 * blip on the left of the disc is a body on your left, always, with no
 * arithmetic — which is the entire reason to draw a map at a size where you
 * can only glance at it.
 *
 * It takes its canvas rather than looking one up, so a check can hand it a
 * context that COUNTS instead of one that paints. That is not a testing
 * convenience: "does not cost a frame" is a claim about how many operations
 * this issues per second, and the only way to hold a claim like that is to
 * count them through the shipped code.
 */
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.ctx = null;
    this.acc = 0;
    /** Repaints since construction. The budget in MINIMAP.hz is a rate, and
     *  this is the only way to state a rate as something a check can read. */
    this.repaints = 0;
    this.on = null;
    /**
     * HOW WARM THE READING IS, 1 while the Force is on it and falling to 0
     * over MINIMAP.linger seconds afterwards. Read by nothing but this class;
     * exposed because "the map fades rather than blinking out" is a claim a
     * check can only measure against a number.
     */
    this.read = 0;
    this._fade = -1;
    if (canvas && typeof canvas.getContext === 'function') {
      // BOTH sizes, from the one number, here rather than in the stylesheet.
      // A canvas has two of them — the backing store the arcs are drawn into
      // and the box CSS lays out — and a canvas whose two disagree is a blurred
      // map on every display. Writing them together from MINIMAP.size means the
      // budget that justifies the arcs and the resolution they land in cannot
      // be different numbers, and it leaves styles.css with only the ring
      // around it, which is the part that is genuinely a style.
      canvas.width = MINIMAP.size;
      canvas.height = MINIMAP.size;
      canvas.style.width = canvas.style.height = `${MINIMAP.size}px`;
      this.ctx = canvas.getContext('2d');
    }
  }

  /**
   * One frame's worth of minimap, which is usually no work at all.
   *
   * The setting is read LIVE off the world's own settings blob — the same
   * object the pause card is writing — so unticking the box takes the map off
   * the screen on the next frame rather than on the next deploy. When it is
   * off the element is display:none, which is the difference between a map
   * that is not drawn and a map that is drawn transparent: the second one
   * still costs a composite every frame.
   *
   * ── AND IT IS A FORCE READING, NOT A PERMANENT WINDOW ───────────────────
   *
   * "Bringing up the minimap should maybe use some force like you're using
   * force sense you know what I mean?" — and the game already has the power
   * they are describing. `Force sense` (Player.toggleSense) costs to switch
   * on, drains 22 Force a second while it is open and stops regeneration
   * dead; what it did was tint the world through the shader. It never told
   * the player where anything WAS, while a permanently-on radar did, for
   * free, forever.
   *
   * So the map rides that power: `senseActive` warms the reading to 1, and it
   * cools over MINIMAP.linger once the power is off. No second Force cost is
   * charged here — inventing one would mean two prices for one act, and the
   * player would pay both. The map is what Force sense is FOR now.
   *
   * `minimapSense` false is the accessibility answer and is the behaviour
   * that shipped: always on, costing nothing. It is a separate setting from
   * `minimap` because "I do not want a map" and "I do not want to pay for the
   * map" are different requests and answering both with one box would force
   * anyone who cannot manage the power to give up the map entirely.
   */
  update(dt, world, player, settings) {
    const sensed = !!settings && settings.minimapSense !== false;
    if (player && player.senseActive) this.read = 1;
    else if (this.read > 0) this.read = Math.max(0, this.read - dt / MINIMAP.linger);
    const want = !!settings && settings.minimap !== false && !!player && (!sensed || this.read > 0);
    if (want !== this.on) {
      this.on = want;
      this.canvas?.classList?.toggle('hidden', !want);
    }
    /*
     * IT FADES RATHER THAN BLINKING OUT. A reading that vanishes on a frame
     * boundary reads as a bug — the player did nothing, and the map went. The
     * last second of the linger takes it down to nothing, and the opacity is
     * only WRITTEN when the tenth changes, so a fade costs at most ten style
     * writes rather than one every frame for three and a half seconds.
     */
    if (this.canvas && this.canvas.style) {
      const a = !sensed || this.read >= 0.29 ? 1 : Math.round((this.read / 0.29) * 10) / 10;
      if (a !== this._fade) { this._fade = a; this.canvas.style.opacity = a === 1 ? '' : String(a); }
    }
    if (!want || !this.ctx) return false;
    this.acc += dt;
    const step = 1 / MINIMAP.hz;
    if (this.acc < step) return false;
    // Clamped rather than accumulated: a stall must not buy the map a burst of
    // catch-up repaints of a world that has only moved once.
    this.acc = Math.min(this.acc - step, step);
    this.draw(world, player);
    return true;
  }

  /** Paint it. Public so the checks can drive exactly one repaint. */
  draw(world, player) {
    const g = this.ctx;
    if (!g || !player) return 0;
    const S = MINIMAP.size, R = S / 2, rim = R - 7;
    g.clearRect(0, 0, S, S);
    this.repaints++;
    let n = 0;

    // The heading the disc is rotated by. `camera.yaw` is where the player is
    // LOOKING, which is what a player means by "in front of me" — the body
    // faces the blade in combat and the movement otherwise, and a map that
    // spun with the feet would swing wildly during a strafe.
    const yaw = num(player.camera?.yaw, 0);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const px = num(player.position?.x, 0), pz = num(player.position?.z, 0);

    /**
     * WORLD → DISC, and it is one closure because there are two readers now.
     *
     * `plot` fills a blip; the standing order's mark is an OUTLINE at the same
     * place, and a second copy of this arithmetic is the kind of twin that goes
     * quietly wrong on one of its two callers the next time a sign is fixed.
     * The sign work is measured at five yaws in tools/checks/spectacle.mjs.
     */
    const project = (x, z, out) => {
      const dx = x - px, dz = z - pz;
      let sx = dx * cos - dz * sin;
      let sy = dx * sin + dz * cos;
      const d = Math.hypot(sx, sy);
      const scale = d > 1e-4 ? Math.min(d, MINIMAP.range) / d * (rim / MINIMAP.range) : 0;
      out.x = R + sx * scale; out.y = R + sy * scale; out.edge = d > MINIMAP.range;
      return out;
    };
    const _at = { x: 0, y: 0, edge: false };

    // The blip loop, twice over one shared body. Nothing is allocated in here.
    const plot = (x, z, colour, size) => {
      const dx = x - px, dz = z - pz;
      // Rotate world → screen. The camera's forward is -Z rotated by yaw, so
      // "up the screen" is that direction and the sign work below is what puts
      // it there; see CameraRig for the same pair of terms.
      let sx = dx * cos - dz * sin;
      // Canvas y grows DOWNWARD, and the camera's forward is `-(sin, cos)`, so
      // the two negations cancel and this reads as a plain dot with the heading.
      // Getting it wrong is one character and produces a map that is perfect
      // until the moment you turn round — which is why both signs are measured
      // at five yaws in tools/checks/spectacle.mjs rather than reasoned about.
      let sy = dx * sin + dz * cos;
      const d = Math.hypot(sx, sy);
      const scale = d > 1e-4 ? Math.min(d, MINIMAP.range) / d * (rim / MINIMAP.range) : 0;
      sx *= scale; sy *= scale;
      const edge = d > MINIMAP.range;
      g.beginPath();
      g.arc(R + sx, R + sy, edge ? size * 0.62 : size, 0, 6.2832);
      g.fillStyle = edge ? MINIMAP_COLORS.edge : colour;
      g.fill();
      n++;
    };

    /* YOUR OWN ARMY IS IN THIS ARRAY. index.html's Interface hint promises
     * "bosses warm, allies green", and `MINIMAP_COLORS.ally` was reachable only
     * from the two co-op loops below — so in Command every trooper you own was
     * drawn as a hostile contact. Measured on a real geonosis Command run: 18
     * bodies alive, 10 of them yours, colours used `{enemy: 18}` and the ally
     * colour used zero times. `big` is a SIZE and not a side, so an allied
     * heavy takes the ally colour at the boss's size rather than the boss's
     * warm. */
    for (const e of world?.enemies || []) {
      if (!e || e.dead || !e.position) continue;
      const heavy = !!(e.A?.boss || e.A?.big);
      const colour = !isHostile(world, e) ? MINIMAP_COLORS.ally
        : heavy ? MINIMAP_COLORS.boss : MINIMAP_COLORS.enemy;
      plot(e.position.x, e.position.z, colour, heavy ? 3.4 : 2.3);
    }
    // Co-op. `world.players` carries the local body too, which is already the
    // arrow in the middle, so it is skipped by identity rather than by name.
    for (const p of world?.players || []) {
      if (!p || p === player || p.alive === false || !p.position) continue;
      plot(p.position.x, p.position.z, MINIMAP_COLORS.ally, 2.6);
    }
    for (const r of world?.remotes?.values?.() || []) {
      if (!r || !r.position) continue;
      plot(r.position.x, r.position.z, MINIMAP_COLORS.ally, 2.6);
    }

    /**
     * THE STANDING ORDER'S MARK — PLAN.md §1.
     *
     * An outline and not a blip, because it is a piece of GROUND and not a
     * body, and it is the one thing on this disc the player is being asked a
     * question about. It says WHERE and nothing else: no count, no IFF, and no
     * hint about what is standing on it — the map is drawn by Force sense and
     * the whole design is that sense has to be spent NEAR the mark to learn
     * that. A ring here that changed colour when your men walked in would hand
     * the player the answer from two hundred metres away.
     */
    const mark = world?.fireMissions?.mission;
    if (mark && mark.state === 'standing') {
      project(mark.centre.x, mark.centre.z, _at);
      g.beginPath();
      g.arc(_at.x, _at.y, _at.edge ? 3.2 : 5.4, 0, 6.2832);
      g.strokeStyle = MINIMAP_COLORS.mark;
      g.lineWidth = 2;
      g.stroke();
    }

    // …and you, pointing up the screen, because heading-up means you always do.
    g.beginPath();
    g.moveTo(R, R - 5.5);
    g.lineTo(R - 3.6, R + 4.2);
    g.lineTo(R + 3.6, R + 4.2);
    g.closePath();
    g.fillStyle = MINIMAP_COLORS.self;
    g.fill();

    return n;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE EMOTE WHEEL                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT THE PLAYER CAN SAY ON PURPOSE.
 *
 * Every one of these already existed. src/engine/Voice.js authors twelve pitch
 * contours and five larynxes to speak them with, tools/checks/voices.mjs
 * measures all sixty player utterances and holds them apart, and the ONLY
 * thing that could reach any of it was the announcer — which speaks when the
 * GAME decides something happened. A player who wanted to salute an opponent,
 * or curse a hit, or say anything at all at a moment of their own choosing had
 * no way to. That is what a wheel is for.
 *
 * `line` names a contour in LINES. It is not a second copy of the contour and
 * it is not a new one: the slot is a NAME for a shape that is already there,
 * which is why the eight of them cover PLAYER_LINES exactly — a wheel with a
 * slot missing would be an authored voice line the player cannot reach, and a
 * wheel with a slot too many would be a name for a contour that does not
 * exist. tools/checks/spectacle.mjs holds both directions, so adding a contour
 * to Voice.js fails the build until it has a name here.
 *
 * `gesture` is what the BODY does, and there is exactly one thing this layer
 * can honestly make it do: SaberController's flourish, the idle twirl that is
 * already a bound action. It is on the two slots where a blade moving is the
 * gesture — the salute and the shout — and absent from the six where standing
 * still and saying it is the gesture. The rest of the body belongs to
 * src/game/Player.js and src/game/Rig.js, and a wheel that faked a bow by
 * writing into a bone another workstream solves every frame would be a bow
 * that lasted until the next pose.
 */
export const EMOTES = [
  { id: 'taunt',   name: 'Taunt',   line: 'streak', blurb: 'come on, then', gesture: 'flourish' },
  { id: 'dismiss', name: 'Dismiss', line: 'kill',   blurb: 'that was nothing' },
  { id: 'oath',    name: 'Oath',    line: 'boss',   blurb: 'a long, low promise' },
  { id: 'yield',   name: 'Yield',   line: 'low',    blurb: 'enough' },
  { id: 'lament',  name: 'Lament',  line: 'die',    blurb: 'for the ones who fell' },
  { id: 'bow',     name: 'Bow',     line: 'land',   blurb: 'one note, downward' },
  { id: 'curse',   name: 'Curse',   line: 'hurt',   blurb: 'through the teeth' },
  { id: 'shout',   name: 'Shout',   line: 'effort', blurb: 'all of it at once', gesture: 'flourish' },
];

/** How far the cursor has to leave the middle before a slot is chosen, in px. */
export const EMOTE_DEADZONE = 26;
/**
 * Pixels of mouse travel from the middle of the wheel to a slot.
 *
 * The cursor is CLAMPED to 1.6× this rather than to this, so a player who
 * overshoots — and everyone overshoots, the wheel is open for under a second —
 * keeps the slot they were heading for instead of wrapping past it into the
 * next one. Only the direction is read; the distance past the deadzone does
 * nothing but say "I mean it".
 */
export const EMOTE_REACH = 96;

/**
 * The angle the centre of slot `i` sits at, measured the way a screen measures.
 *
 * Derived and exported rather than written into a stylesheet eight times: the
 * markup, the hit test and the check all ask this one function, so a ninth
 * emote lands in the right place without anybody moving a transform by hand.
 * Slot 0 is straight up, because the top of a radial wheel is where a player
 * looks first and the first entry in the table should be the one they find.
 */
export function emoteAngle(i, n = EMOTES.length) {
  return -Math.PI / 2 + (i / n) * Math.PI * 2;
}

/** Which slot a cursor at (x, y) picks, or -1 for none. */
export function emoteAt(x, y, n = EMOTES.length) {
  if (Math.hypot(x, y) < EMOTE_DEADZONE) return -1;
  // Measured from the top and wrapped, then rounded to the nearest slot centre
  // — which is the same statement as emoteAngle read backwards, and is why the
  // two cannot disagree about where a slot is.
  const a = Math.atan2(y, x) + Math.PI / 2;
  const turns = a / (Math.PI * 2);
  return ((Math.round(turns * n) % n) + n) % n;
}

/**
 * The wheel: a held key, a cursor driven by the mouse, and a release that
 * commits.
 *
 * The cursor is INTEGRATED FROM THE MOUSE DELTA rather than read off
 * `input.mouse.x`, and that is not a stylistic choice. The game is
 * pointer-locked while it is being played, and under pointer lock the browser
 * stops reporting a position at all — `Input` only fills `mouse.x/y` on the
 * unlocked path. A wheel that read the position would work perfectly on the
 * menu and be dead in the one place it exists for.
 */
/**
 * A RADIAL WHEEL — hold a key, push the mouse, let go.
 *
 * Written once and used twice, which is the whole reason it exists as its own
 * class: note #18 asks for the orders to move onto one — "commanding your
 * troops takes up too many buttons so it needs to be a small popup mousewheel
 * sort of thing you know like in other games where you press a botton and use
 * your mouse to select one of the options in the popup wheel" — and the emote
 * wheel was already exactly that, for a different table.
 *
 * A second copy of the geometry, the hit test and the DOM pooling would have
 * been the eighth instance of this project's signature defect (HANDOFF §2.3).
 * So `EmoteWheel` is now this class with a table and a name, and `OrderWheel`
 * is this class with a different table and a different name.
 *
 * WHAT A SUBCLASS SUPPLIES: the list, the action it is held on, the caption
 * for a slot, and what happens when one commits. Nothing else.
 */
export class RadialWheel {
  /**
   * @param host   the container element
   * @param opts.items  the table — one entry per slot
   * @param opts.action the input action held to open it
   * @param opts.cls    the class on each slot node
   */
  constructor(host, opts = {}) {
    this.host = host || null;
    this.items = opts.items || [];
    this.action = opts.action || 'emote';
    this.cls = opts.cls || 'em';
    this.on = false;
    this.x = 0; this.y = 0;
    this.sel = -1;
    this.slots = [];
    this._build();
  }

  /** The caption for slot `i`. Overridden by a subclass that has a live one. */
  captionFor(item) { return item.blurb || ''; }
  /** The title for slot `i`. */
  titleFor(item) { return item.name || item.id || ''; }

  _build() {
    if (!this.host) return;
    this.host.innerHTML = '';
    this.slots = [];
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const e = this.items[i];
      const a = emoteAngle(i, n);
      const d = document.createElement('div');
      d.className = this.cls;
      // The slot's own position, in the wheel's own units. Written here from
      // emoteAngle rather than typed into styles.css because eight hand-typed
      // transforms is eight chances for the markup and the hit test to point
      // at different places, and the player would only find out by pressing.
      d.style.left = `${(50 + Math.cos(a) * 37).toFixed(3)}%`;
      d.style.top = `${(50 + Math.sin(a) * 37).toFixed(3)}%`;
      d.innerHTML = `<b>${esc(this.titleFor(e))}</b><span>${esc(this.captionFor(e))}</span>`;
      d._say = d.querySelector('span');
      this.host.appendChild(d);
      this.slots.push(d);
    }
  }

  /** Rewrite every caption from whatever the subclass says they are now. */
  refresh() {
    for (let i = 0; i < this.slots.length; i++) {
      const el = this.slots[i];
      if (!el || !el._say) continue;
      el._say.textContent = this.captionFor(this.items[i], i);
    }
  }

  /**
   * One frame of the wheel.
   *
   * @returns the ITEM that was just committed, or null.
   */
  update(input, hud) {
    if (!input || typeof input.act !== 'function') { this.close(); return null; }
    const held = input.act(this.action);
    if (held && !this.on) {
      this.on = true;
      this.x = 0; this.y = 0; this.sel = -1;
      this.host?.classList?.remove('hidden');
      this.onOpen?.();
    }
    if (!held) {
      if (!this.on) return null;
      const picked = this.sel >= 0 ? this.items[this.sel] : null;
      this.close();
      return picked;
    }
    // The same delta the camera would have used. It is safe to READ it here
    // without stealing it: main.js clears the accumulator once per frame in
    // input.end(), and while the wheel is open the blade controller is the
    // only other reader — which is the point, since a player picking an emote
    // is not aiming.
    this.x = clamp(this.x + num(input.mouse?.dx, 0), -EMOTE_REACH * 1.6, EMOTE_REACH * 1.6);
    this.y = clamp(this.y + num(input.mouse?.dy, 0), -EMOTE_REACH * 1.6, EMOTE_REACH * 1.6);
    const sel = emoteAt(this.x, this.y, this.items.length);
    if (sel !== this.sel) {
      this.sel = sel;
      for (let i = 0; i < this.slots.length; i++) this.slots[i].classList.toggle('sel', i === sel);
      if (sel >= 0 && hud) hud._emoteTick?.();
    }
    return null;
  }

  close() {
    if (!this.on) return;
    this.on = false;
    this.sel = -1;
    for (const s of this.slots) s.classList.remove('sel');
    this.host?.classList?.add('hidden');
  }
}

export class EmoteWheel extends RadialWheel {
  constructor(host) {
    super(host, { items: EMOTES, action: 'emote', cls: 'em' });
    this.setSpeech(this.spoken);
  }

  /*
   * THE WORDS, WHERE THERE ARE WORDS.
   *
   * `blurb` is a description of a NOISE — "come on, then", "one note,
   * downward" — which is the right caption for a wordless larynx and the
   * wrong one the moment the same slot says an actual sentence. So a slot
   * prints the line it will really speak when spoken lines are on, and its
   * description when they are not. `wordsFor(kind, i)` is deterministic on
   * the slot index, so the caption and the line that follows it are the
   * same line; it is refreshed by setSpeech rather than decided once here,
   * because the mode is a live setting.
   */
  captionFor(e, i = EMOTES.indexOf(e)) {
    const words = this.spoken ? wordsFor(e.line, i) : '';
    return words ? `\u201c${words}\u201d` : e.blurb;
  }

  /**
   * Print what each slot will SAY, or what it will sound like.
   *
   * Called from HUD.update off the live setting and only when the answer has
   * changed — eight innerHTML writes a frame, for a wheel that is on screen a
   * second at a time, would be a real cost for no change at all.
   */
  setSpeech(spoken) {
    this.spoken = !!spoken;
    this.refresh();
    return this.spoken;
  }
}

/**
 * THE ORDER WHEEL — note #18.
 *
 * "commanding your troops takes up too many buttons so it needs to be a small
 * popup mousewheel sort of thing."
 *
 * Six formations were six digit keys, and the seventh this note said a HOLD
 * order "would have been" now exists — Hold fire, on Equal. That is the whole
 * argument for the wheel arriving before it: the row is built from the table,
 * so the order that made this paragraph's hypothetical real cost no markup and
 * no key hunt. They are one held key and a flick. The direct binds STAY — they
 * are in `ACTIONS`, they are rebindable, and a player who has learned them has
 * learned something real — but nobody has to.
 *
 * THE TABLE IS COMMAND'S, not a copy of it. `ORDERS` is the authority for what
 * an order is and what it says about itself — the six formations and the
 * commander's Force verbs together — so a seventh entry of either kind
 * appears on this wheel the day it is authored and cannot appear with the
 * wrong blurb on it. HOLD is appended because it is a toggle rather than a
 * formation and lives beside them rather than among them.
 */
/** 1st, 2nd, 3rd… for a squad number the player is reading off a wheel.
 *  Exported because `main.js`'s order keys name the same squad in the same
 *  words — a second copy of this is a second way to spell "2nd Squad". */
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/**
 * THE SLOTS THE WHEEL ALWAYS CARRIES, whatever formations it is handed.
 *
 * WHO THE NEXT ORDER IS FOR, AND WHO STANDS ALONE — both on the wheel, and
 * neither costing a binding.
 *
 * "I should be able to order separate squads or all squads at once depending on
 * my choosing", and "you should be able to take an npc out of their squad… but
 * you should be able to reverse it and put them back".
 *
 * A dedicated key for each was the obvious answer and it is the wrong one twice
 * over. The number of squads is a function of how many men are alive — five
 * with a full roster, two after a bad area — so a `squad1..squad5` table is
 * mostly dead rows and has nothing for the sixth squad a reinforcement opens.
 * And KeyK/KeyL were the last two unbound letters in the table, which
 * `controls.mjs` requires as spares for the rebinder to settle a clash with;
 * taking them fails the gate, correctly.
 *
 * The wheel already exists, is already the place orders come from, and already
 * prints a live caption — so TARGET cycles which squad the next order is for
 * and DETACH pulls the nearest man out of his line. Both read their current
 * state back through `captionFor`, which is the part a bare keybinding could
 * never have done.
 *
 * EXPORTED AND ITERATED RATHER THAN PUSHED ONE BY ONE, because
 * `spectacle.mjs` asserts the wheel's slot count against the formations it was
 * handed and had `+ 1` written into it — true when HOLD was the only fixed
 * slot and stale the moment these two arrived. A count read off this table
 * cannot go stale, and a fifth fixed slot is a red check until somebody looks
 * at the geometry.
 */
export const WHEEL_EXTRAS = [
  { id: 'hold', name: 'Hold ground', kind: 'hold',
    blurb: 'Stay where you are put. They still turn and fight.' },
  { id: 'squad', name: 'Target', kind: 'squad',
    blurb: 'Choose which squad your next order is for.' },
  { id: 'detach', name: 'Detach', kind: 'detach',
    blurb: 'Pull the nearest trooper out of his squad, or send him back.' },
];

export class OrderWheel extends RadialWheel {
  constructor(host, formations) {
    const items = Object.values(formations || {}).map((F) => ({
      id: F.id, name: F.name, blurb: F.blurb, kind: 'form',
    }));
    for (const x of WHEEL_EXTRAS) items.push({ ...x });
    super(host, { items, action: 'orderwheel', cls: 'em ow' });
    this.director = null;
  }

  /** The live caption: the current order and the hold state are both readable. */
  captionFor(item) {
    const d = this.director;
    if (item.kind === 'squad') {
      if (!d) return item.blurb;
      const n = d.squadsOf?.(d.commander)?.length ?? 0;
      if (n <= 1) return 'One squad. Everything you order goes to it.';
      const sel = d.selectedSquad;
      /* BY THE SQUAD'S OWN NAME, through the director's one reader — a squad
       * the menu calls Havoc and the wheel calls 2nd is two squads as far as
       * the player is concerned. `ordinal` was this file's own second copy of
       * "what a squad is called". */
      const word = (d.commander?.army?.squadWord || 'squad').toLowerCase();
      return sel == null
        ? `All ${n} ${word}s. Choose this to pick one.`
        : `${d.squadLabel?.(sel) ?? `${ordinal(sel + 1)} Squad`} only. `
          + 'Choose this again to step on.';
    }
    if (item.kind === 'detach') {
      const t = d?.nearestTrooper?.();
      if (!t) return 'Nobody of yours is near enough.';
      return t.detached
        ? `${t.designation} is on his own — send him back to his squad.`
        : `Pull ${t.designation} out of the line to take his own orders.`;
    }
    if (item.kind === 'hold' && d) {
      return d.commander?.holding
        ? 'Holding. Choose this again to bring them with you.'
        : item.blurb;
    }
    const f = this._force && this._force[item.id];
    if (f && !f.ready) return f.cd > 0 ? `Recovering — ${f.cd.toFixed(1)}s` : 'Not enough Force';
    return item.blurb;
  }

  /** Light whichever order is up, so the wheel says where you are. */
  onOpen() {
    const d = this.director;
    /* THE DIRECTOR'S OWN READINESS, read once per open rather than once per
     * caption. `castReady` is the single rule `castForce` refuses on, and a
     * wheel that decided for itself whether a verb was ready would be the
     * second copy of it — which is the defect Powers.js's note records. */
    this._force = d ? Object.fromEntries((d.readout?.()?.force || []).map((f) => [f.id, f])) : null;
    this.refresh();
    for (let i = 0; i < this.slots.length; i++) {
      const it = this.items[i];
      const f = this._force && this._force[it.id];
      const live = d && (it.kind === 'hold' ? !!d.commander?.holding : d.formation === it.id);
      this.slots[i].classList.toggle('live', !!live);
      this.slots[i].classList.toggle('cold', !!(f && !f.ready));
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE FREE CAMERA                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How the detached camera flies.
 *
 * `look` is radians per pixel of mouse travel and it is SaberController's own
 * `camGain`, so the free camera turns at exactly the rate the game does and
 * nobody has to relearn their wrist to frame a shot. Quoted rather than
 * imported: HUD.js must not take an import edge into the blade controller for
 * one number, and a quoted number is a number that can drift — so
 * tools/checks/spectacle.mjs reads `camGain` out of src/game/SaberController.js
 * and fails if the two stop agreeing. The player's own sensitivity slider
 * multiplies both, one layer up.
 *
 * `boost` and the slow-walk scale on the other side of it are the two
 * modifiers a photographer actually needs: cross a level in a second, then
 * creep the last half-metre to line the shot up.
 */
export const FREECAM = { speed: 9, boost: 3.2, look: 0.0024, pitchMax: 1.53, hint: 4.5 };

const _fq = new THREE.Quaternion(), _fe = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3();

/**
 * A CAMERA THAT COMES OFF THE BODY — AND A GAME THAT STOPS WHILE IT IS OFF.
 *
 * The second half is the whole design. A detached camera that let the world run
 * is not a screenshot tool, it is a wallhack: you would fly it over a wall,
 * watch a wave assemble, fly back and know where everything is. So entering
 * sets `world.paused`, which is World.update's own first line and therefore the
 * one gate in the project that is guaranteed to stop every system at once —
 * physics, spawning, the director, the blade solver, the net tick. Nothing
 * advances, nothing can be learned that was not already on screen, and the shot
 * you are framing is the frame you froze.
 *
 * It flies on the MOVEMENT BINDINGS rather than on keys of its own: forward is
 * whatever moves you forward, up is whatever jumps, down is whatever crouches,
 * fast is sprint and slow is the new walk. Rebind W and the free camera follows,
 * for free, and there is nothing here for the Codex to get wrong.
 *
 * GETTING BACK IS THE FEATURE. The camera's transform and the world's previous
 * paused state are both stored on the way in and put back on the way out, so
 * leaving a free camera cannot strand a player in a paused world or leave the
 * view a metre off where the rig had it. Leaving is also forced by anything
 * that makes the state meaningless — a different world, a HUD driven without a
 * camera — because the one unrecoverable bug this feature can have is being
 * stuck in it.
 */
export class FreeCam {
  constructor() {
    this.on = false;
    this.yaw = 0; this.pitch = 0;
    this.world = null;
    this.camera = null;
    this.hintT = 0;
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._wasPaused = false;
  }

  toggle(world, camera, hud) {
    if (this.on) this.exit(hud);
    else this.enter(world, camera, hud);
    return this.on;
  }

  enter(world, camera, hud) {
    if (this.on || !world || !camera) return false;
    this.world = world;
    this.camera = camera;
    this._pos.copy(camera.position);
    this._quat.copy(camera.quaternion);
    // Start pointing exactly where the rig had it, or the first frame of a
    // photo mode is a lurch away from the shot you pressed the key for.
    _fe.setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = _fe.y;
    this.pitch = clamp(_fe.x, -FREECAM.pitchMax, FREECAM.pitchMax);
    /**
     * TWO WRITES, AND BOTH ARE NEEDED.
     *
     * `paused` is World.update's own first line and therefore the right STATE
     * for anything else that asks whether the game is running. `freeCamera` is
     * what the frame gate in Menu.tapFrame reads, and it is what makes the stop
     * airtight: main.js runs `world.update` BEFORE `hud.update`, so anything
     * that writes `paused = false` between two HUD frames — its own resume(),
     * after a pause menu raised over a free camera — would buy the game one
     * whole frame of simulation before this could re-assert itself, and one
     * frame is enough to watch a wave assemble.
     */
    this._wasPaused = !!world.paused;
    world.paused = true;
    world.freeCamera = true;
    this.on = true;
    this.hintT = FREECAM.hint;
    hud?.show?.(false);
    return true;
  }

  exit(hud) {
    if (!this.on) return false;
    if (this.camera) {
      this.camera.position.copy(this._pos);
      this.camera.quaternion.copy(this._quat);
    }
    if (this.world) {
      this.world.freeCamera = false;
      this.world.paused = this._wasPaused;
    }
    this.on = false;
    this.world = null;
    this.camera = null;
    hud?.show?.(true);
    return true;
  }

  /**
   * One frame of flying, on REAL time.
   *
   * `dt` here is the frame length main.js measured, not the world clock — the
   * world clock is stopped, which is the point, and a camera that could not
   * move while the game was frozen would be a camera that could not move at
   * all.
   */
  step(dt, input, world, camera) {
    if (!this.on) return false;
    // Anything that makes the stored state meaningless takes the camera down
    // rather than flying a camera that is not the one we detached.
    if (!world || !camera || world !== this.world || camera !== this.camera) return false;
    // Re-asserted every frame, for the same pair of reasons they are written on
    // the way in: `paused` is the state everything else reads, and `freeCamera`
    // is the gate that cannot be raced by the frame order.
    world.paused = true;
    world.freeCamera = true;

    if (input && typeof input.act === 'function') {
      this.yaw -= num(input.mouse?.dx, 0) * FREECAM.look;
      this.pitch = clamp(this.pitch - num(input.mouse?.dy, 0) * FREECAM.look, -FREECAM.pitchMax, FREECAM.pitchMax);

      // Fast on sprint, precise on the slow walk — the same two modifiers that
      // move the body, doing the same two things to the camera. walkScale is
      // the gait's own function, so the creep here is the creep there.
      const boost = input.act('sprint') ? FREECAM.boost : walkScale(input);
      const v = FREECAM.speed * boost * dt;
      /* THROUGH `actAxis`, NOT `act`, and the difference is a whole device.
       * A held key answers 1 to both, but a STICK — a pad's or a thumb's — only
       * ever answers `actAxis`: `act('moveF')` reads `touchHeld` and the key
       * table, and neither of those is where a stick's magnitude lives. Read
       * the wrong one and the free camera is the one place in the game a stick
       * does not move you, which is also how it would read as broken rather
       * than as unbound. The four the body walks on go through `moveAxis`, and
       * this is the same question one level down. */
      let f = 0, r = 0, u = 0;
      f = input.actAxis('moveF') - input.actAxis('moveB');
      r = input.actAxis('moveR') - input.actAxis('moveL');
      if (input.act('jump')) u += 1;
      if (input.act('crouch')) u -= 1;
      /* CLAMPED, not normalised. Two keys held is `hypot(1,1)` and has to come
       * back to 1, but a stick eased a third of the way is already 0.33 and
       * normalising it would push it to full speed — the exact switch the
       * analog read was for. Same rule as `Input.moveAxis`. */
      const len = Math.hypot(f, r);
      if (len > 1) { f /= len; r /= len; }
      _fe.set(this.pitch, this.yaw, 0, 'YXZ');
      _fq.setFromEuler(_fe);
      _fwd.set(0, 0, -1).applyQuaternion(_fq);
      _rgt.set(1, 0, 0).applyQuaternion(_fq);
      camera.position.addScaledVector(_fwd, f * v).addScaledVector(_rgt, r * v);
      camera.position.y += u * v;
    }
    _fe.set(this.pitch, this.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(_fe);
    camera.updateMatrixWorld?.();
    if (this.hintT > 0) this.hintT = Math.max(0, this.hintT - dt);
    return true;
  }
}

export class HUD {
  constructor(root = document) {
    this.el = {
      hud: root.getElementById('hud'),
      perf: root.getElementById('hud-perf'),
      wave: root.getElementById('hud-wave'),
      // The word in front of the number. It is an element rather than the bare
      // text node the HUD used to reach for by position — see the wave block
      // in update() for the session-long 'LESSON' that cost.
      waveWord: root.getElementById('hud-wave-word'),
      level: root.getElementById('hud-level'),
      diff: root.getElementById('hud-diff'),
      remaining: root.getElementById('hud-remaining'),
      left: root.getElementById('hud-left'),
      leftWord: root.getElementById('hud-left-word'),
      hp: root.getElementById('bar-hp'),
      hpGhost: root.getElementById('bar-hp-ghost'),
      force: root.getElementById('bar-force'),
      stam: root.getElementById('bar-stam'),
      /* The three READINGS beside the three captions. A bar is a proportion,
       * and a proportion cannot answer "can I take one more hit" — which is
       * the only question anybody asks of a health bar. Written through
       * `_num`, so a value that has not moved costs no DOM write. */
      hpNum: root.getElementById('bar-hp-num'),
      forceNum: root.getElementById('bar-force-num'),
      stamNum: root.getElementById('bar-stam-num'),
      flow: root.getElementById('hud-flow'),
      flowFill: root.querySelector('#hud-flow i'),
      combo: root.getElementById('hud-combo'),
      score: root.getElementById('hud-score'),
      targetOpen: root.getElementById('target-open'),
      mendCue: root.getElementById('mend-cue'),
      withdrawRing: root.getElementById('withdraw-ring'),
      center: root.getElementById('hud-center-msg'),
      drivePrompt: root.getElementById('drive-prompt'),
      hitmarks: root.getElementById('hitmarks'),
      troopnames: root.getElementById('troopnames'),
      stratagem: root.getElementById('stratagem'),
      /* The standing order — see _missionPanel. Six nodes and no markup that
       * says anything: the grid, the clock, the estimate, the reading, the
       * verdict and the key. */
      /* The front, and the four nodes that draw it. See _frontBar. */
      front: root.getElementById('hud-front'),
      frMark: root.getElementById('fr-mark'),
      frHeld: root.getElementById('fr-held'),
      frMine: root.getElementById('fr-mine'),
      frTheirs: root.getElementById('fr-theirs'),
      frState: root.getElementById('fr-state'),
      mission: root.getElementById('firemission'),
      fmGrid: root.getElementById('fm-grid'),
      fmClock: root.getElementById('fm-clock'),
      fmTold: root.getElementById('fm-told'),
      fmRead: root.getElementById('fm-read-fill'),
      fmVerdict: root.getElementById('fm-verdict'),
      fmFoot: root.getElementById('fm-foot'),
      support: root.getElementById('bar-support'),
      supportNum: root.getElementById('bar-support-num'),
      killfeed: root.getElementById('killfeed'),
      coach: root.getElementById('coach'),
      coachTitle: root.getElementById('coach-title'),
      coachCount: root.getElementById('coach-count'),
      coachBrief: root.getElementById('coach-brief'),
      coachHint: root.getElementById('coach-hint'),
      coachFill: root.getElementById('coach-fill'),
      lock: root.getElementById('lockmeter'),
      lockFill: root.getElementById('lock-fill'),
      why: root.getElementById('deflect-why'),
      boss: root.getElementById('bossbar'),
      bossForceTrack: root.getElementById('boss-force-track'),
      bossForce: root.getElementById('boss-force'),
      bossCast: root.getElementById('boss-cast'),
      bossLabel: root.getElementById('boss-label'),
      bossPhase: root.getElementById('boss-phase'),
      bossFill: root.getElementById('boss-fill'),
      boons: root.getElementById('boon-strip'),
      powers: root.getElementById('power-wheel'),
      reticle: root.getElementById('reticle'),
      events: root.getElementById('event-feed'),
      cursor: root.getElementById('blade-cursor'),
      flowVig: root.getElementById('flow-vignette'),
      dmgVig: root.getElementById('dmg-vignette'),
      minimap: root.getElementById('minimap'),
      mapKey: root.getElementById('minimap-key'),
      emotes: root.getElementById('emote-wheel'),
      orderwheel: root.getElementById('order-wheel'),
      // The free camera's own line lives OUTSIDE #hud, because #hud is the
      // thing it hides — a legend inside it would go away with everything else
      // and leave a player flying a detached camera with no way to learn how to
      // get back. It is the one element in this file that is deliberately not
      // part of the HUD it belongs to.
      freecam: root.getElementById('freecam-bar'),
      freecamKey: root.getElementById('freecam-key'),
      // ── the army (Command mode only; hidden everywhere else)
      roster: root.getElementById('roster'),
      rpArmy: root.getElementById('rp-army'),
      rpStrength: root.getElementById('rp-strength'),
      rpOrderName: root.getElementById('rp-order-name'),
      rpOrderSub: root.getElementById('rp-order-sub'),
      rpOrders: root.getElementById('rp-orders'),
      rpList: root.getElementById('rp-list'),
      rpFoot: root.getElementById('rp-foot'),
    };
    /** Which formation is current, so a rebind can re-light the right chip. */
    this._order = null;
    /** The last roll drawn, as a signature — the panel is not rebuilt per frame. */
    this._rosterKey = null;
    this.hpGhostValue = 1;
    this.centerTimer = 0;
    this._buildPowers();
    this._marks = [];
    /** Pooled nameplate nodes, one per living trooper. See `_nameplates`. */
    this._plates = [];
    this.whyTimer = 0;
    /* The last state+multiplier drawn, so the two strings are only written when
     * one of them has actually changed. null means the readout is hidden. */
    this._openKey = null;
    /**
     * The two systems that make the fight audible, driven from the one place
     * that already gets the world, the player and the camera once a frame.
     *
     * They live behind the HUD rather than in World because World.js belongs to
     * another lane and because neither of them is simulation: the announcer
     * DIFFERENCES the same numbers this file already draws, and Presence reads
     * positions. Nothing here writes to the world.
     */
    this.announcer = new Announcer();
    this.presence = new Presence();
    this._pops = [];
    this.popupsOn = true;
    /**
     * The three surfaces this file gained for the spectacle pass, all driven
     * off the one call main.js already makes once a frame.
     *
     * They are here rather than in World for the same reason the announcer is:
     * none of them is simulation. The map READS positions, the wheel READS the
     * input and plays a voice line that was already authored, and the free
     * camera writes the render camera and World's own `paused` flag and touches
     * nothing else. Nothing in this file advances a game.
     */
    this.minimap = new Minimap(this.el.minimap);
    this.emotes = new EmoteWheel(this.el.emotes);
    this.freecam = new FreeCam();
  }

  /**
   * THE POWER WHEEL, LABELLED FROM THE BINDINGS TABLE.
   *
   * It used to carry five typed letters: `[['push','F'],['pull','⇧F'],
   * ['grip','G'],['throw','R'],['sense','C']]`, built once from the
   * constructor. Two of the five were wrong on a fresh install — pull is bound
   * to R and throw to H, so the wheel told the player to press R to throw and
   * pressing R Force-pulled instead — and none of the five followed a rebind,
   * ever. The wheel is on screen for the whole fight.
   *
   * `POWERS` is the list, in wheel order, with the action id each slot reads.
   * The label comes from `keyLabel(bindings[id][0])`, which is what the Codex
   * and the coaching panel already do; `setBindings` is called from main.js's
   * `onBindings` hook, beside the `refreshCoachKeys()` that exists for exactly
   * this reason.
   *
   * Nine slots, not five. The other four — lightning, stasis, heal, compel —
   * all carry a real cooldown in `Player.cooldowns` and a real Force cost, and
   * had no readout anywhere; `lightning` even had an icon sitting unused in
   * POWER_ICONS. A cooldown the player cannot see is a cooldown they learn by
   * pressing the key and getting nothing.
   */
  /**
   * NAMEPLATES OVER YOUR OWN TROOPS.
   *
   * "When you hover your reticle over your troops it should show you their
   * name or maybe optionally their names will be displayed attractively and
   * carefully over their heads like in other games."
   *
   * Both, and the setting is `troopNames`: `aimed` (the default — only the one
   * you are looking at), `all`, or `off`. The default is the conservative one
   * because twelve labels is twelve things competing with a lightsaber, and
   * the note itself offers the hover reading first.
   *
   * WHAT IS ON IT is decided by what the player can do about it. The rank chip
   * because the ladder is the mode's whole progression and it is the same
   * colour the body is painted in; the name because that is the point; a
   * health bar because a man about to die is a man you can go and stand in
   * front of; and a NERVE bar beside it, narrower, because a man about to
   * break is a different problem with a different answer and the two must be
   * distinguishable without reading.
   *
   * THE NODES ARE POOLED. A plate per trooper per frame is twelve DOM writes
   * and twelve creations at sixty hertz; the pool grows to the roster's high
   * water mark and then never allocates again.
   *
   * IT IS DERIVED FROM THE ROSTER, not from a list the HUD keeps: the roster
   * is the one authority for who exists and what they are called, and a second
   * copy of it here is the defect this project keeps removing.
   */
  /**
   * WHAT YOU HAVE TYPED AND WHAT IT COULD STILL BE.
   *
   * The panel is the whole of the mechanic's discoverability. A code system
   * with no readout is a manual you have to keep beside the keyboard, and the
   * player asked for support calls, not for homework — so while the key is
   * held this lists every call still consistent with what has been entered,
   * greys the ones on cooldown or out of Force, and shows each code with the
   * letters already matched lit.
   *
   * IT IS BUILT FROM `STRATAGEMS` AND NOT FROM A COPY. The rows, their names,
   * their codes, their costs and their blurbs all come off the table in
   * src/game/Stratagems.js through `candidates`, so a call authored there is
   * on this panel the same day and there is nothing here to fall out of step
   * with it (HANDOFF §2.3).
   *
   * The DOM is rebuilt only when the entry or the candidate set changes, which
   * on a normal frame is never — this runs inside the HUD's per-frame update
   * and a panel that re-rendered six rows every frame would be the most
   * expensive thing on the screen for the 99% of the time it is not open.
   */
  _stratagemPanel(player) {
    const host = this.el.stratagem;
    if (!host) return;
    const S = player?.stratagems;
    if (!S || !S.arming) {
      if (this._stratOpen) { host.classList.add('hidden'); host.innerHTML = ''; this._stratOpen = false; this._stratKey = ''; }
      return;
    }
    const ctx = { world: player.world, enemies: player.world?.enemies || [] };
    const D = S.designating;
    const rows = D ? [D.s] : S.candidates(ctx);
    const said = S.saidT > 0 ? S.said : '';
    const key = `${D ? 'mark' + (D.lock ? '!' : '') : S.entry}|${said}|${rows.map(r => r.id).join(',')}`
      + `|${rows.map(r => Math.ceil(S.cooldowns[r.id] ?? 0)).join(',')}`;
    if (key === this._stratKey) return;
    this._stratKey = key;
    this._stratOpen = true;
    host.classList.remove('hidden');
    /* AFFORDABILITY IS ASKED OF THE SUPPLY LINE, not of the Force pool. A
     * panel that greyed a row against `player.force` after the price moved to
     * war support would light calls you cannot make and grey ones you can —
     * which is the exact defect `Powers.js`'s own header records the HUD having
     * had once already, from its private copy of the price table. */
    const support = player.world?.support;
    const purse = support ? support.value : (player.force ?? 0);
    /**
     * THE SECOND PHASE HAS ITS OWN PANEL, because it is a different question.
     *
     * While the code is being spelled the panel answers "what can I still
     * spell"; once it is spoken there is nothing left to choose except WHERE,
     * and a list of six other calls at that moment is furniture. So the
     * designation collapses to one line that says what is being placed and
     * whether the beam has a body or a piece of ground — which is the one
     * thing the player cannot tell from the beam alone at fifty metres.
     */
    if (D) {
      host.innerHTML = `<div class="sg-row sg-mark"><b>${D.s.name}</b>`
        + `<span class="sg-cost">${D.lock ? 'TARGET' : 'GROUND'}</span></div>`
        + `<div class="sg-said">${D.lock ? 'locked — release to send' : 'paint it, then release'}</div>`;
      return;
    }
    /**
     * EVERY KEYSTROKE IS A WORD, so the panel prints the words.
     *
     * `callPhrase` is the one derivation (src/game/Stratagems.js) and both the
     * mouth and this row read it, so what the player hears and what they see
     * cannot disagree. The word already SAID is lit with its arrow; the next
     * one is the instruction. That is what turns the panel from a reference
     * you have to find your place in into a script you are reading aloud.
     */
    /**
     * TEN ROWS AT MOST, AND THE REST AS A COUNT.
     *
     * The table was seven rows and is eighteen, and the panel opens with the
     * whole of it before a single letter has been entered. Eighteen rows at
     * this size is 430 px of list down the left of the screen while somebody
     * is shooting at you — which is not a reference, it is a wall — and the
     * first letter cuts it to about five anyway, so the long list is only ever
     * on screen at the one moment the player has not yet chosen anything.
     *
     * Ten, in the table's own order, which is the release ladder: the calls
     * you have had since the first minute are at the top and the ones you
     * earned are under them. The tail is a COUNT and not a scroll, because a
     * panel you have to scroll while holding a key with the same hand you
     * spell with is a panel nobody reads.
     */
    const SHOWN = 10;
    const spill = rows.length - SHOWN;
    host.innerHTML = rows.slice(0, SHOWN).map((r) => {
      const cd = Math.ceil(S.cooldowns[r.id] ?? 0);
      const price = support ? supportCost(r) : r.cost;
      const off = cd > 0 || purse < price;
      /* ARROWS, not the letters. A code is made of DIRECTIONS and W is only
       * what one happens to be bound to on a keyboard — see DIR_GLYPH.
       *
       * THREE STATES AND NOT TWO. `on` is what you have already pressed, and
       * that alone makes the panel a reference you have to read your place in.
       * `next` is the one to press, which makes it an INSTRUCTION — and that
       * is the difference that matters under fire, because the codes are dealt
       * per run (see rollCodes) so nobody is entering one from memory. It is
       * only ever on the leading candidate: marking the next arrow of six rows
       * at once would be six instructions and no answer. */
      const lead = r === rows[0];
      const phrase = callPhrase(r);
      const code = [...r.code].map((c, i) => {
        const cls = i < S.entry.length ? ' on' : (lead && i === S.entry.length ? ' next' : '');
        return `<i class="sg-d${cls}">${DIR_GLYPH[c] || c}</i>`;
      }).join('');
      const note = cd > 0 ? `${cd}s` : `${price}`;
      const words = lead
        ? `<div class="sg-words">${phrase.map((w, i) => {
          const cls = i < S.entry.length ? 'on' : (i === S.entry.length ? 'next' : '');
          return `<em class="${cls}">${w}</em>`;
        }).join(' ')}</div>` : '';
      return `<div class="sg-row${off ? ' off' : ''}"><span class="sg-code">${code}</span>`
        + `<b>${r.name}</b><span class="sg-cost">${note}</span></div>${words}`;
    }).join('') || '<div class="sg-row off"><b>no such call</b></div>';
    if (spill > 0) {
      host.innerHTML += `<div class="sg-row off"><b>+${spill} more — keep spelling</b></div>`;
    }
    /**
     * WHAT THE FLEET HAS NOT RELEASED YET, as one line under the list.
     *
     * The heavier calls are held until the side has earned them (see
     * `RELEASE` in src/game/Stratagems.js), and a locked call is ABSENT from
     * this panel rather than greyed in it — a code that can be spelled and
     * then refuses is a menu item that lies, which is the rule the
     * command-only calls already follow. That leaves the player with no way to
     * know the ladder exists between the notice that announces a rung and the
     * next time they open the Codex, so the panel carries the next rung: what
     * it is and how much more war effort it wants.
     *
     * It reads `Stratagems.locked`, which is the one derivation of that list —
     * a second filter here would be the private duplicate this file's own
     * price note is about.
     */
    const locked = S.locked ? S.locked(ctx) : [];
    if (locked.length && support) {
      const next = locked[0];
      const want = Math.max(0, Math.ceil((next.earn ?? 0) - (support.effort ?? 0)));
      const also = locked.filter(r => (r.earn ?? 0) === (next.earn ?? 0)).length - 1;
      const el = document.createElement('div');
      el.className = 'sg-said sg-locked';
      el.textContent = `held: ${next.name}${also > 0 ? ` +${also}` : ''} — ${want} more war effort`;
      host.appendChild(el);
    }
    /* WHAT THE LAST ENTRY DID, under the list. The panel says what you CAN
     * still spell; this says what happened to the thing you just spelled — a
     * call made and how long until it lands, a refusal and why. Without it a
     * code entered into a cooldown looks exactly like a code that was not
     * recognised, which is the one thing a player must be able to tell apart. */
    if (said) {
      const el = document.createElement('div');
      el.className = 'sg-said';
      el.textContent = said;
      host.appendChild(el);
    }
  }

  /**
   * THE STANDING ORDER, AND WHAT YOU ARE ALLOWED TO KNOW ABOUT IT.
   *
   * PLAN.md §1: "Force sense shows what is inside it, including friendly IFF…
   * Sometimes your own men are in it and the game never says so." This panel
   * is where that sentence is kept or broken, so it reads `readout()` and
   * nothing else — `FireMission.readout` answers null for the counts until the
   * reading is finished, which means a bug in this method cannot leak what the
   * player has not earned. The panel cannot know more than the Jedi does.
   *
   * Keyed like the stratagem panel: a HUD that rewrites five nodes sixty times
   * a second for a clock that ticks in whole seconds is a HUD that costs frames
   * for nothing.
   */
  /**
   * THE FRONT — PLAN.md §1's "two lines make the front", drawn.
   *
   * `CommandDirector.front` is a scalar in [-1, +1] and it is the whole state
   * of a meeting: 0 is the middle of the field, +1 is your own baseline, and a
   * side wins by driving it to the other's. Nothing in the tree read it. The
   * mode's own sentence — "the front moves because a general left his line at
   * the wrong moment" — is unlearnable if the moment is invisible, so this is
   * the readout that makes the rule teachable: it moves while your line is
   * gathered AND past it, and it stops the instant you outrun them.
   *
   * THE SIGN IS THE PLAYER'S, not the field's. `front` is written in absolute
   * terms (side 0 drives it to -1), and a bar that ran the wrong way for
   * whichever commander is on side 1 would be a HUD that lies to half a
   * meeting. Everything below is in "ground you have taken", so the two
   * players see mirror images of one battle and both of them see the truth.
   */
  _frontBar(world) {
    const host = this.el.front;
    if (!host) return;
    const d = world?.command;
    if (!d?.versus || d.front === undefined) {
      if (this._frKey !== '') { host.classList.add('hidden'); this._frKey = ''; }
      return;
    }
    const mine = world.player?.team ?? 0;
    /* +1 is side 0's baseline, so a commander on side 1 reads the negative. */
    const won = (mine === 0 ? d.front : -d.front) ?? 0;
    const pct = clamp(won, -1, 1) * 50;
    const cs = d.commanders || [];
    const nameOf = (side) => cs.find((c) => c.side === side)?.army?.name || (side === mine ? 'YOURS' : 'THEIRS');
    const state = Math.abs(won) < 0.02 ? 'contested' : won > 0 ? 'you are pushing' : 'you are giving ground';
    const key = `${Math.round(pct * 2)}|${state}|${nameOf(mine)}|${nameOf(1 - mine)}`;
    if (key === this._frKey) return;
    this._frKey = key;
    host.classList.remove('hidden');
    host.classList.toggle('theirs', won < 0);
    host.classList.toggle('pushing', won > 0.02);
    host.classList.toggle('losing', won < -0.02);
    this.el.frMark.style.left = `${50 + pct}%`;
    /* The fill runs FROM the middle TO the mark, either way, so the shape says
     * how much ground has changed hands rather than where a marker happens to
     * be sitting. */
    this.el.frHeld.style.left = `${50 + Math.min(0, pct)}%`;
    this.el.frHeld.style.width = `${Math.abs(pct)}%`;
    this.el.frMine.textContent = nameOf(mine);
    this.el.frTheirs.textContent = nameOf(1 - mine);
    this.el.frState.textContent = state;
  }

  _missionPanel(world) {
    const host = this.el.mission;
    if (!host) return;
    const r = world?.fireMissions?.readout?.();
    if (!r || r.state !== 'standing') {
      if (this._fmKey !== '') { host.classList.add('hidden'); this._fmKey = ''; }
      return;
    }
    const own = r.verified && r.friendlies > 0;
    const secs = Math.ceil(r.left);
    const key = `${r.grid}|${secs}|${Math.round(r.read * 20)}|${r.verified ? r.hostiles : 'x'}`
      + `|${own ? r.names.join(',') + r.friendlies : ''}|${r.prize}`;
    if (key === this._fmKey) return;
    this._fmKey = key;
    host.classList.remove('hidden');
    host.classList.toggle('late', secs <= 10);
    host.classList.toggle('read', r.verified);
    host.classList.toggle('own', own);
    this.el.fmGrid.textContent = `Fire mission — grid ${r.grid}`;
    this.el.fmClock.textContent = `${secs}s`;
    this.el.fmTold.textContent = `${r.told} hostile${r.told === 1 ? '' : 's'}, estimated`;
    this.el.fmRead.style.width = `${Math.round(r.read * 100)}%`;
    /**
     * THE THREE THINGS THIS LINE MAY SAY, and the first one is the design.
     *
     * UNVERIFIED does not hedge and does not hint. It says what the player has
     * — an estimate somebody else made, at a time nobody told him — and the
     * only way past it is to go and stand near the mark. A line that read
     * "possible friendlies" would be the game quietly doing the checking, and
     * then there is nothing to check.
     */
    this.el.fmVerdict.textContent = !r.verified
      ? 'Unverified — their estimate, at a time nobody told you'
      : own
        ? `${r.friendlies} OF YOURS INSIDE IT — ${r.names.join(', ')}`
        : `Read: ${r.hostiles} hostile${r.hostiles === 1 ? '' : 's'}, none of yours`;
    this.el.fmFoot.innerHTML = `<kbd>${escKey(this._chip('authorise'))}</kbd> clear to fire`
      + `<b>+${r.prize}</b>`;
  }

  _nameplates(world, player, camera) {
    const host = this.el.troopnames;
    if (!host) return;
    const mode = world.settings?.troopNames ?? 'aimed';
    const cmd = world.command;
    if (mode === 'off' || !cmd || !player) {
      if (this._plates.length) { for (const p of this._plates) p.node.style.display = 'none'; }
      return;
    }
    /* WHICH ONE IS UNDER THE RETICLE, in the same terms the rest of the HUD
     * uses: the smallest angle between the aim and the line to the body. A
     * screen-space test would disagree with the crosshair in third person,
     * where the camera and the aim are not the same ray. */
    const aim = player.aimDir;
    const eye = player.camera ? player.camera.pos : player.position;
    let aimed = null, bestDot = 0.986;                     // ≈ 9.5° cone
    const live = [];
    for (const c of cmd.commanders || []) {
      if (c.side !== undefined && player.team !== undefined && c.side !== player.team) continue;
      for (const t of c.roster.living) {
        const e = t.body;
        if (!e || e.dead) continue;
        live.push(t);
        if (!aim) continue;
        _v.set(e.position.x - eye.x, e.position.y + 1.5 - eye.y, e.position.z - eye.z);
        const d = _v.length();
        if (d < 0.4 || d > 90) continue;
        const dot = _v.divideScalar(d).dot(aim);
        if (dot > bestDot) { bestDot = dot; aimed = t; }
      }
    }
    while (this._plates.length < live.length) {
      const node = document.createElement('div');
      node.className = 'tplate';
      node.innerHTML = '<div><span class="tp-rank"></span><span class="tp-name"></span></div>'
        + '<div class="tp-bars"><div class="tp-hp"><i></i></div><div class="tp-mor"><i></i></div></div>';
      host.appendChild(node);
      this._plates.push({ node, rank: node.querySelector('.tp-rank'),
        name: node.querySelector('.tp-name'), hp: node.querySelector('.tp-hp i'),
        mor: node.querySelector('.tp-mor i') });
    }
    for (let i = 0; i < this._plates.length; i++) {
      const P = this._plates[i];
      const t = live[i];
      if (!t) { P.node.style.display = 'none'; continue; }
      const isAimed = t === aimed;
      if (mode === 'aimed' && !isAimed) { P.node.style.display = 'none'; continue; }
      const e = t.body;
      /* THE HEAD, not the origin: a plate at a body's feet reads as belonging
       * to the ground. `hipHeight` is the archetype's own and scales with it,
       * so an ARC and a spider walker both get their label over their heads. */
      _v.set(e.position.x, e.position.y + (e.A?.hipHeight ?? 0.95) + 1.15, e.position.z);
      const dist = _v.distanceTo(eye);
      _v.project(camera);
      if (_v.z > 1 || dist > 120) { P.node.style.display = 'none'; continue; }
      P.node.style.display = '';
      P.node.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
      P.node.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
      /* FADE WITH DISTANCE rather than cutting out: a label that pops off at a
       * radius is the thing that makes a crowd of them read as a system. */
      P.node.style.opacity = String(clamp(1.25 - dist / 90, 0.18, 1));
      const R = t.rankRec;
      if (P._rank !== R.short) {
        P._rank = R.short;
        P.rank.textContent = R.short;
        // The rank's own colour, which is the colour the body is painted in.
        P.rank.style.background = R.color ? `#${R.color.toString(16).padStart(6, '0')}` : 'var(--panel-hi)';
        P.rank.style.color = R.color ? '#0a0b14' : 'var(--ink)';
      }
      if (P._name !== t.name) { P._name = t.name; P.name.textContent = t.name; }
      const hp = clamp((e.hp ?? 1) / Math.max(1, e.maxHp ?? 1), 0, 1);
      const mo = clamp(t.morale ?? 1, 0, 1);
      P.hp.style.width = `${hp * 100}%`;
      P.mor.style.width = `${mo * 100}%`;
      P.node.classList.toggle('aimed', isAimed);
      P.node.classList.toggle('far', dist > 40);
      P.node.classList.toggle('hurt', hp < 0.35);
      P.node.classList.toggle('shaken', mo < 0.4);
      P.node.classList.toggle('broken', !!t.broken);
    }
  }

  _buildPowers(bindings = null) {
    this.powerEls = {};
    this.el.powers.innerHTML = '';
    for (const [key, action] of POWERS) {
      const d = document.createElement('div');
      d.className = 'pw';
      /**
       * THE SLOT NAMES ITS ACTION — one attribute, and it is what makes a
       * phone playable past the six buttons a thumb rack can hold.
       *
       * There are forty-four actions and two thumbs, so the touch pad carries
       * the ones a fight cannot be had without and nothing else. The Force
       * verbs are already HERE, in a row of exactly the powers this player
       * holds, with the cooldown, the price and the ready state on each, under
       * the right thumb. `Touch.bindWheel` makes them pressable; this is the
       * only thing that had to change for it, and it changes nothing on a
       * desktop — an unread data attribute is not a behaviour.
       */
      d.dataset.action = action;
      /**
       * FIVE CHILDREN, EACH CREATED AND HELD — not one innerHTML blob picked
       * apart with `querySelector` afterwards.
       *
       * Two reasons. The slot now has four writable parts rather than one, and
       * `querySelector` on the check harness's DOM double returns the SAME node
       * for every selector — so a blob-and-query build would hand `cd`, `label`
       * and `tick` the same object under test and quietly make three assertions
       * agree with each other. And the glyph is the only part that has to be
       * parsed as markup, so it is the only part that goes in as markup.
       *
       * THE SLOT IS AN ICON WITH TAGS ON IT, which is the whole visual change.
       * It used to be a 50 px grey square with a letter under a dim glyph, ten
       * of them in a row — an auditor called the row the most "web demo" object
       * in the frame, and they were right: what read at a glance was ten
       * keycaps printed F R G H C Z B 3 4 N U. Now the GLYPH is the object; the
       * key is a small tab in the corner where a key belongs; the price is in
       * the Force's own colour where an ability bar puts a cost; and the
       * seconds left are printed over the shutter, which is the one thing an
       * ability bar exists to tell you and this one never did.
       */
      const gl = document.createElement('span');
      gl.className = 'gl';
      gl.innerHTML = POWER_ICONS[key] || '';
      const cd = document.createElement('div');
      cd.className = 'cd';
      const cost = document.createElement('em');
      cost.className = 'cost';
      // Priced from the same imported table Player spends against — this file
      // used to carry its own nine numbers and two of them were wrong.
      const price = POWER_COST[key];
      cost.textContent = price > 0 ? String(Math.round(price)) : '';
      const label = document.createElement('span');
      label.className = 'key';
      label.textContent = bindings
        ? keyLabel(codesFor(bindings, action, this._pad?.device === 'pad' ? 'pad' : 'key')[0],
          this._pad?.family || 'xbox')
        : '';
      const tick = document.createElement('b');
      tick.className = 'tick';
      // Order matters: the shutter goes over the glyph and under everything
      // that has to stay readable while it is closed.
      d.appendChild(gl); d.appendChild(cd);
      d.appendChild(cost); d.appendChild(label); d.appendChild(tick);
      this.el.powers.appendChild(d);
      this.powerEls[key] = { root: d, cd, label, tick, cost, glyph: gl };
    }
    this._bindings = bindings;
  }

  /**
   * Repaint the wheel's key labels. Called on boot, after any rebind, and
   * whenever the player swaps between a keyboard and a controller.
   *
   * `pad` is `{ device, family }` or nothing, and nothing means the keyboard —
   * so every existing caller and every check keeps the markup it had. It is
   * held rather than passed on, because the four surfaces below are repainted
   * from other places too (`_buildPowers` on a HUD rebuild, `setOrder` on a
   * formation change) and a device the HUD had forgotten would silently
   * repaint half the screen back to keyboard letters.
   */
  /** The key the player would actually press to mend, from the live bindings. */
  _mendKeyLabel() {
    const b = this._bindings;
    if (!b) return 'HEAL';
    const dev = this._pad && this._pad.device === 'pad' ? 'pad' : 'key';
    return keyLabel(codesFor(b, 'heal', dev)[0], (this._pad && this._pad.family) || 'xbox') || 'HEAL';
  }

  /**
   * THE BOARD PROMPT — *"drive the vehicles it makes sense to drive"*, and the
   * half of that sentence this method is for is "it makes sense".
   *
   * A PERSISTENT LINE AND NOT A NOTICE CARD, because what it says is a fact
   * about where you are standing rather than an event: a card that faded after
   * two seconds would leave a player next to a tank with nothing on screen and
   * no way to find out whether they may have it.
   *
   * AND IT PRINTS THE REFUSAL TOO. `Driving.drivableNear` deliberately does not
   * filter out the machines it will then refuse, so this can say WHICH of them
   * it is — a hailfire is a droid and there is nobody in it to displace, and an
   * enemy tank with its crew alive has to be put under a quarter first. Being
   * told that is the difference between a rule and a bug, and it is the same
   * argument `Player._refuse` makes for every Force key.
   *
   * The key name comes off the live bindings, never typed — see the note over
   * `setBindings`, and tools/checks/controls.mjs, which fails any surface that
   * types one.
   */
  _drivePrompt(world, player) {
    const el = this.el.drivePrompt;
    if (!el) return;
    let text = '', bad = false;
    if (player.driving) {
      const v = player.driving.vehicle;
      const hull = Math.max(0, Math.round((v.hp / Math.max(1, v.maxHp)) * 100));
      text = `<b>${this._chip('drive')}</b> climb down · ${esc(v.A?.label ?? 'machine')} · hull ${hull}%`;
    } else {
      const near = drivableNear(world, player);
      if (near) {
        const why = whyNotDrive(world, player, near);
        bad = !!why;
        text = why
          ? `${esc(near.A?.label ?? 'it')} — ${esc(why)}`
          : `<b>${this._chip('drive')}</b> take the controls · `
            + `${esc(near.A?.label ?? 'machine')}, ${crewOf(near.type)} crew`;
      }
    }
    el.classList.toggle('on', !!text);
    el.classList.toggle('no', bad);
    if (text !== this._driveText) { el.innerHTML = text; this._driveText = text; }
  }

  /** One binding, as the player's own device names it. */
  _chip(id) {
    const b = this._bindings;
    if (!b) return String(id).toUpperCase();
    const dev = this._pad && this._pad.device === 'pad' ? 'pad' : 'key';
    return keyLabel(codesFor(b, id, dev)[0], (this._pad && this._pad.family) || 'xbox')
      || String(id).toUpperCase();
  }

  setBindings(bindings, pad = this._pad) {
    this._bindings = bindings;
    this._pad = pad || null;
    const fam = (pad && pad.family) || 'xbox';
    const dev = pad && pad.device === 'pad' ? 'pad' : 'key';
    const chip = (id) => keyLabel(codesFor(bindings, id, dev)[0], fam);
    for (const [key, action] of POWERS) {
      const p = this.powerEls[key];
      if (p && p.label) p.label.textContent = chip(action);
    }
    // The free camera's own legend, from the same table and on the same call.
    // It is the only text on screen while the HUD is hidden, so it is the one
    // place a stale key name would be unrecoverable: a player who cannot read
    // the way out has to reload the page.
    if (this.el.freecamKey) {
      this.el.freecamKey.textContent = `${chip('freecam')} to come back`;
    }
    /*
     * The map's own legend, from the same table and on the same call. It names
     * the POWER the map now rides — Force sense — and what it costs, because a
     * caption that said only "press C" would leave the player wondering why
     * their Force pool moved. The price comes off POWER_COST, which is what
     * the wheel already prices every other power from.
     */
    if (this.el.mapKey) {
      this.el.mapKey.innerHTML = `<b>${escKey(chip('sense'))}</b> `
        + `sense · ${Math.round(POWER_COST.sense)} Force`;
    }
    // The order keycaps, on the same call and for the same reason. They were
    // raw key codes read past the table until this round; now that they are
    // rebindable, printing one from memory is exactly the bug the wheel above
    // was built to stop.
    this._buildOrderKeys(bindings);
  }

  /**
   * One of the three bar readings, written only when the printed value moves.
   *
   * A bar's fill is a transform and the compositor eats a repeat of it; a
   * textContent write is layout, and three of them sixty times a second for a
   * number that changes twice a fight is the shape of a HUD that costs frames
   * for nothing. `Math.round` is the comparison because the ROUNDED value is
   * what the player reads — 61.4 and 61.0 are the same string.
   */
  _num(node, v) {
    if (!node) return;
    const n = Math.max(0, Math.round(num(v, 0)));
    if (node._last === n) return;
    node._last = n;
    node.textContent = String(n);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  THE ARMY                                                              */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE ROSTER PANEL — note #21, finally on the screen. See `rosterHtml`.
   *
   * "you can see who lived or who died, maybe one particular one lasts longer
   * than the others and you protect him."
   *
   * Everything that makes that sentence true has been built for a while and
   * none of it was visible. A trooper is a record that outlives its body; it
   * carries a designation, a nickname EARNED by surviving to Sergeant, a rank
   * with a painted insignia on the real mesh, kills, areas survived, and a
   * death that is permanent. `CommandDirector` published the lot through
   * `onRoster` and main.js called `hud.setRoster?.(summary)` — into a method
   * that did not exist. The optional-call operator meant it failed silently,
   * every promotion and every casualty, for the whole life of the mode.
   *
   * WHAT IT DRAWS, and why in this order. The living, best first — rank, then
   * kills — so the two or three names you have been protecting are at the top
   * of the column where you can watch them; then the fallen, struck through,
   * with the area they died in. That asymmetry IS the mechanic: a column of
   * numbers with three names in it is the game telling you who you managed to
   * keep alive.
   *
   * `summary` is `CommandRoster.summary()` exactly as shipped — nothing here
   * asks for a field the director does not already publish. Pass `null` to put
   * the panel away, which is what every non-Command mode does.
   */
  /**
   * WHAT THE PLAYER CALLS THEIR SQUADS, and their army's own word for one.
   *
   * Set once when the fight starts, off the same `Company.squadNames` the
   * director is handed, so the roster column and every notification say the
   * same word. Absent is the honest default: the number.
   */
  setSquadWords(names, word) {
    this._squadNames = Array.isArray(names) ? names.slice() : null;
    this._squadWord = word || 'Squad';
  }

  setRoster(summary) {
    const host = this.el.roster;
    if (!host) return;
    if (!summary || !Array.isArray(summary.roll)) {
      host.classList.add('hidden');
      this._rosterKey = null;
      return;
    }
    host.classList.remove('hidden');
    const army = ARMIES[summary.army];
    if (this.el.rpArmy) this.el.rpArmy.textContent = army ? army.name : String(summary.army ?? '');

    // A signature, so a summary that has not changed costs no innerHTML write.
    // onRoster fires on every promotion and every death; the panel is cheap but
    // it is not free, and a rebuild throws away the arrival animation.
    const key = `${summary.army}|${summary.points}|`
      + summary.roll.map(t => `${t.id}${t.rank}${t.kills}${t.alive ? 1 : 0}${t.diedIn ?? ''}`).join(',');
    if (key === this._rosterKey) return;
    this._rosterKey = key;

    const { living, fallen } = rosterSides(summary);
    if (this.el.rpStrength) this.el.rpStrength.textContent = `${living.length}/${summary.roll.length}`;
    if (this.el.rpList) {
      this.el.rpList.innerHTML = rosterHtml(summary, this._squadNames, this._squadWord);
    }
    if (this.el.rpFoot) {
      // Reinforcement points belong here and not only on the muster screen: it
      // is what a casualty COSTS, and the price is worth knowing while the
      // decision that produces one is still being made.
      this.el.rpFoot.innerHTML = `<span>${living.length} standing</span>`
        + `<span>${fallen.length} lost</span><b>${summary.points | 0} rp</b>`;
    }
  }

  /**
   * WHICH FORMATION YOU ARE IN — the other thing nothing on screen ever said.
   *
   * Six order keys change how twenty-four bodies behave and the only feedback
   * was a message that faded in two seconds, so the answer to "am I still in
   * cover?" was to press a key and watch. The name is held on screen; the six
   * keycaps under it are built from the live bindings by `setBindings`, and the
   * one you are in is lit.
   *
   * Signature is the director's: `onOrder(F, squads, one)` → `setOrder(F.id,
   * F.name, squads, one)`, which is exactly what main.js was already calling
   * into thin air.
   *
   * ── AND A PER-SQUAD ORDER DOES NOT REPAINT THE ARMY'S ─────────────────
   *
   * `one` is `{ squad, name }` when the order was given to ONE squad, and null
   * when it was the whole line. This used to arrive with two arguments and the
   * panel repainted for both, while `CommandDirector.order`'s per-squad branch
   * deliberately does not set `c.formation`: telling 2nd Squad to take cover
   * lit "Take cover" across the only always-visible statement of what your men
   * are doing, while the army was still in line abreast. The one persistent
   * order display on screen said something no squad was doing.
   *
   * So a per-squad order writes the SUBTITLE — which squad, and what they were
   * told — and leaves the headline and the lit chip to the army's own order.
   */
  setOrder(id, name, squads, one = null) {
    if (one) {
      if (this.el.rpOrderSub) {
        this.el.rpOrderSub.textContent = `${one.name} — ${String(name || '').toLowerCase()}`;
      }
      return;
    }
    const was = this._order;
    this._order = id || null;
    if (this.el.rpOrderName) this.el.rpOrderName.textContent = name || '—';
    if (this.el.rpOrderSub) {
      const n = squads | 0;
      this.el.rpOrderSub.textContent = n ? `${n} squad${n === 1 ? '' : 's'}` : '';
    }
    this._lightOrder();
    /*
     * AND THE ORDER IS SPOKEN, which it never was.
     *
     * `Voice.LINES.order` is a fully authored contour with three paragraphs
     * over it — "it is the officer's line and it is what the player hears when
     * they change formation, so it has to be legible under a firefight" — and
     * it was the ONE kind of the fifteen that nothing ever emitted. Every other
     * contour (effort, hurt, land, die, kill, streak, boss, low, alarm, panic,
     * scream, chatter, flung, cheer) has a live caller; this path wrote two DOM
     * strings and lit a chip in silence. The one mode where you give orders was
     * the one where nothing answered you.
     *
     * Only on a CHANGE. `setOrder` is also called when the HUD is rebuilt — the
     * note over `_buildPowers` says so in as many words — and an officer who
     * repeats the standing order every time a panel is redrawn is worse than
     * one who says nothing.
     */
    if (this._order && this._order !== was) this.announcer?.say(this._settings, 'order');
  }

  /** Light the chip for the current formation, and only that one. */
  _lightOrder() {
    const host = this.el.rpOrders;
    if (!host || !host.children) return;
    for (const c of host.children) {
      c.classList?.toggle('on', !!this._order && c.dataset?.order === this._order);
    }
  }

  /**
   * The six order keycaps, from the bindings table.
   *
   * Rebuilt on every rebind for the same reason the power wheel is: these are
   * ordinary rebindable actions now (see the seam in Bindings.js), so a typed
   * key here would be a lie the first time somebody moved one. Empty when no
   * orders are registered, which is every build that never loads Command.
   */
  _buildOrderKeys(bindings) {
    const host = this.el.rpOrders;
    if (!host) return;
    host.innerHTML = '';
    for (const o of ORDER_ACTIONS) {
      const chip = document.createElement('i');
      chip.className = 'rp-key';
      chip.dataset.order = o.id;
      chip.title = `${o.name} — ${o.blurb}`;
      chip.textContent = bindings
        ? keyLabel(codesFor(bindings, o.action, this._pad?.device === 'pad' ? 'pad' : 'key')[0],
          this._pad?.family || 'xbox')
        : '';
      host.appendChild(chip);
    }
    this._lightOrder();
  }

  /**
   * THE READOUT GOES UP OR DOWN — and whatever else belongs with it.
   *
   * `onShow` exists for exactly one caller: the touch pad is the CONTROLLER
   * rather than part of the readout, so it lives outside `#hud` — but it must
   * appear and vanish on precisely the same four moments, and a phone player
   * whose thumb is on GUARD when the menu opens must not keep guarding. Four
   * hand-copied `touch.show(...)` lines beside the four `hud.show(...)` calls
   * is the shape this repository keeps deleting; one hook is not.
   */
  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
    this.onShow?.(!!on);
  }

  setLevel(name, difficulty) {
    this.el.level.textContent = name;
    this.el.diff.textContent = difficulty;
  }

  update(dt, world, player, camera) {
    /**
     * THE FREE CAMERA IS READ BEFORE THE EARLY RETURN, ON PURPOSE.
     *
     * Everything below this block describes a living player. The free camera
     * describes a STOPPED world and may well outlive the body — a player can
     * freeze the frame their Jedi died on, which is exactly the frame worth
     * photographing — so it is stepped up here where `player` has not been
     * required yet. It also returns, because a frozen world has nothing to say:
     * no bars to move, no announcer, no room. See FreeCam for why the world is
     * paused rather than merely unwatched.
     */
    // Kept so `setOrder` can pick a voice. It is called by the director, not by
    // the frame, so it has no world of its own to ask — and everything else the
    // announcer speaks is spoken from inside this method, where `world` is in
    // hand. One field rather than threading a fifth argument through a seam the
    // director owns the signature of.
    this._settings = world?.settings ?? this._settings ?? null;
    const input = world ? world.liveInput : null;
    if (input && input.actHit('freecam') && camera) this.freecam.toggle(world, camera, this);
    if (this.freecam.on) {
      if (!this.freecam.step(dt, input, world, camera)) this.freecam.exit(this);
      else {
        // A wheel left open across a detach would commit its slot the moment
        // the camera came back — an emote from a key you released a minute ago,
        // in a mode you entered to take a photograph. It closes with the HUD.
        this.emotes.close();
        this.el.freecam?.classList?.toggle('hidden', false);
        this.el.freecam?.classList?.toggle('fade', this.freecam.hintT <= 0);
        return;
      }
    }
    this.el.freecam?.classList?.add('hidden');
    if (!player) return;
    const el = this.el;

    // ── bars
    const hp = player.hp / player.maxHp;
    el.hp.style.transform = `scaleX(${clamp(hp, 0, 1)})`;
    this.hpGhostValue = Math.max(hp, this.hpGhostValue - dt * 0.35);
    el.hpGhost.style.transform = `scaleX(${clamp(this.hpGhostValue, 0, 1)})`;
    el.hp.parentElement.classList.toggle('low', hp < 0.3);
    this._num(el.hpNum, player.hp);
    el.force.style.transform = `scaleX(${clamp(player.force / player.maxForce, 0, 1)})`;
    this._num(el.forceNum, player.force);
    // Focus reads on the Force bar itself — it is Force being spent, and
    // showing it anywhere else would hide the trade the ability is built on.
    const fs = world?.focus;
    if (fs) el.force.parentElement.classList.toggle('focus', fs.held > 0.05);
    const stam = player.stamina / player.maxStamina;
    el.stam.style.transform = `scaleX(${clamp(stam, 0, 1)})`;
    el.stam.parentElement.classList.toggle('low', stam < 0.25);
    this._num(el.stamNum, player.stamina);
    /**
     * WAR SUPPORT — the side's, not yours. See src/game/Support.js.
     *
     * `?.` on every reach because a check drives `HUD.update` against a stub
     * world, and because the bar has to be honest about a world that has no
     * supply line rather than drawing a full one: it hides.
     */
    const sup = world?.support;
    if (el.support) {
      const line = el.support.parentElement?.parentElement;
      if (!sup) { if (line) line.classList.add('hidden'); }
      else {
        if (line) line.classList.remove('hidden');
        el.support.style.transform = `scaleX(${clamp(sup.frac, 0, 1)})`;
        /* THE ONE STATE A LEVEL CANNOT SHOW. While the ships are turning round
         * the bar is not merely low, it is not filling — and a player watching
         * a bar that has stopped moving needs to be told that is the rule and
         * not a bug. */
        el.support.parentElement.classList.toggle('rearm', sup.rearming);
        el.support.parentElement.classList.toggle('low', sup.frac < 0.2);
        this._num(el.supportNum, sup.value);
      }
    }

    // ── flow
    el.flowFill.style.width = `${clamp(player.flow, 0, 1) * 100}%`;
    el.flow.classList.toggle('max', player.flow > 0.92);
    el.flowVig.style.opacity = (player.flow * 0.55).toFixed(3);
    /* NOT IN FIRST PERSON. `#dmg-vignette` is a full-screen centred radial that
     * goes red toward all four corners, and in first person there is no body
     * between you and it — you are inside the head it is meant to be describing,
     * so it reads as blood ON THE CAMERA. It is worst at the lower right, which
     * is only where the HUD is emptiest and the band is unobstructed.
     * It is also the one red thing in a game whose own rule is that a lightsaber
     * does not bleed anything (DESIGN §3). Third person keeps it: there the
     * frame is a shot of your character and the vignette is the frame, not the
     * eye. */
    el.dmgVig.style.opacity =
      (player.camera?.firstPerson ? 0 : clamp(1 - hp * 1.6, 0, 0.75)).toFixed(3);

    // ── combo / score
    if (player.combo > 1) {
      el.combo.textContent = `${player.combo}×`;
      el.combo.classList.add('on');
    } else el.combo.classList.remove('on');
    el.score.textContent = Math.floor(world.score + player.score).toLocaleString();

    /* ── wave, or lesson in Training ──────────────────────────────────
     *
     * THE WORD IS WRITTEN ON EVERY FRAME, IN BOTH DIRECTIONS.
     *
     * It used to be written in one: the training branch reached through
     * `el.wave.previousSibling` into the bare text node in front of the number
     * and typed 'LESSON ' into it, and the else branch below touched only
     * `#hud-remaining`. The HUD is a module-scope singleton built once against
     * markup that is never rebuilt, and Training is an ordinary selectable
     * mode, so ONE training deploy renamed the counter for the rest of the
     * session: pick Training, deploy, Abandon, deploy Trial of Waves, and the
     * top-left reads 'LESSON 7' for that fight and every fight after it, until
     * the page is reloaded. Measured on the real HUD against the real page:
     * "WAVE 3" -> "LESSON 3" -> "LESSON 3", where the third should have been
     * "WAVE 3" again.
     *
     * The word has its own element now (index.html, `#hud-wave-word`) rather
     * than the HUD reaching into an anonymous text node by position — a node
     * found by `firstChild` is a node any edit to that line can move, and two
     * check harnesses had already stubbed `previousSibling` to null, which
     * short-circuited the whole branch and hid this.
     */
    el.wave.textContent = world.director.wave;
    if (el.waveWord) el.waveWord.textContent = world.training ? 'LESSON' : 'WAVE';
    /* ── the figure and the word under it ─────────────────────────────
     *
     * One line used to carry both ("7 remaining") in one 10.5 px string, under
     * a 38 px wave index. The figure a player reads while deciding whether to
     * push is how many are left, so it is the big one now and the wave index
     * is the caption above it — see the note in index.html.
     *
     * Two elements, not one string, because that is what a hierarchy needs.
     * The `n` may be empty ('attune', 'free practice'): the word then carries
     * the whole line, and `.wave-sub:has(b:empty)` lifts it back up to where
     * the figure would have sat so the corner does not shift.
     */
    let n = '', w = '';
    if (world.training) {
      const st = world.director.state();
      if (st.need === Infinity) w = 'free practice';
      else { n = st.progress; w = `of ${st.need}`; }
    } else if (world.director.active) {
      n = hostilesLeft(world); w = n === 1 ? 'hostile left' : 'hostiles left';
    } else if (world.director.intermission > 900) {
      w = 'attune';
    } else {
      n = Math.ceil(world.director.intermission); w = 'to next wave';
    }
    if (el.left) { el.left.textContent = n === '' ? '' : String(n); el.leftWord.textContent = w; }
    else el.remaining.textContent = n === '' ? w : `${n} ${w}`;

    // ── powers
    //
    // Cooldowns go in as SECONDS REMAINING, not as a fraction of a divisor
    // typed in here — see _power for the measurement that replaced the four
    // wrong divisors. Affordability goes through _afford, which asks the
    // player's own economy rather than comparing against a literal.
    const cd = player.cooldowns;
    this._power('push', cd.push, this._afford(player, 'push'));
    this._power('pull', cd.pull, this._afford(player, 'pull'));
    this._power('grip', 0, this._afford(player, 'grip'), !!(player.gripBody || player.gripEnemy));
    this._power('throw', cd.throw, this._afford(player, 'throw'), player.throwState !== 'held');
    this._power('sense', 0, this._afford(player, 'sense'), player.senseActive);
    // The four that had no readout at all until recently, and had a wrong one
    // until this edit. `lightning` has no "on" state to show — it is a single
    // discharge, and the flag the wheel used to read (`player.lightningOn`)
    // exists nowhere in src/, so that slot's active border could never light.
    this._power('lightning', cd.lightning, this._afford(player, 'lightning'));
    /* `active`, NOT `bodies.size`. The lit border means "this power is running",
     * and `bodies` holds only the prop/debris/ragdoll physics bodies the field
     * caught — so it has never lit for a field of pure bolts, which is the
     * commonest field there is, and it does not light for a field of PEOPLE
     * either now that stasis arrests them. `active` is the field's own name for
     * exactly the state being drawn, and it is what `grip` and `sense` next to
     * it already read. */
    this._power('stasis', cd.stasis, this._afford(player, 'stasis'), !!player.stasis?.active);
    // `healing` is elapsed seconds or null (`Player.forceHeal` sets it to 0), so it is `0`
    // on the first frame of a heal — `!!player.healing` would blink the border
    // off at exactly the moment the power starts.
    this._power('heal', cd.heal, this._afford(player, 'heal'), player.healing != null);
    this._power('compel', cd.compel, this._afford(player, 'compel'));
    /* Rend, whose slot did not exist until the audit found it bound to KeyN,
     * priced at 38 and drawn nowhere. 2.4 s, from `forceDisassemble`. */
    this._power('rend', cd.rend, this._afford(player, 'rend'));
    /* Unleash — the 360° repulse. Its slot exists for the same reason rend's
     * had to be added: a power that is bound, priced and castable and drawn
     * nowhere is a power the player has to be told about out of band, and
     * hud-events counts the wheel against POWER_COST so a new price without a
     * new slot fails rather than shipping quiet. */
    this._power('unleash', cd.unleash, this._afford(player, 'unleash'));
    /* The barrier is the only slot whose "on" state costs money every frame it
     * stays on, so the lit border is the readout that matters most in the row:
     * it is what tells the player the bar is draining. `up` and not `power`,
     * because `power` is the visual ease and lingers for a third of a second
     * after the barrier is down. */
    this._power('shield', cd.shield, this._afford(player, 'shield'), !!player.shield?.up);

    // ── reticle & blade cursor
    this._drivePrompt(world, player);
    const firstPerson = !!player.camera.firstPerson;
    /* THE SAME MISSING FILTER, AND IT PINNED THE WARNING ON FOR ALL OF COMMAND.
     * Every formation parks your squads inside 5 m by construction: measured on
     * a real geonosis run with ZERO hostiles inside the radius, circle, behind,
     * cover, line and holdfire all lit it — five of seven orders, permanently.
     * index.html's reticle note argues that a colour which could hide this
     * "would be a customisation which removes information"; a warning that is
     * always on carries none either. */
    const threat = world.enemies.some(e => isHostile(world, e)
      && e.position.distanceToSquared(player.position) < 25);
    el.reticle.classList.toggle('hot', threat);
    // full strength: a reticle you cannot see is not a reticle
    el.reticle.style.opacity = firstPerson ? 1 : 0.9;
    // Shape, size and colour, repainted only when one of the three has moved.
    applyReticle(el.reticle, world.settings);

    /* ── THE TARGET'S STATE, which the blade has always been paid for
     *
     * `openness()` pays a cut 3x through a body you are holding, 2x through one
     * still being yanked and 1.5x through one that is down. The comment on it
     * says it exists "to make pull→cut read as ONE MOVE instead of two" — and
     * that cannot happen while the second half is invisible, which it was.
     *
     * `openState` returns the shared table row from Combat.js and `openMul`
     * turns it into what THIS body is worth: a boss takes a quarter of the held
     * and yanked bonuses, so the row's own `mul` is not the number to print —
     * quoting it at a boss would overstate by exactly the factor the design
     * intends. Reading both off Combat.js is what stops this readout drifting
     * from the arithmetic, the way seven hand-maintained tables in this
     * codebase have drifted from their generated twins.
     *
     * Nothing is allocated per frame: the row is shared, and the two strings
     * are only written when the state or the multiplier changes.
     *
     * A held body wins over everything else, because it is the one you are
     * unambiguously talking about; otherwise the nearest open body inside the
     * reach a cut could plausibly follow a pull with.
     */
    /**
     * …AND THE ONE YOU CAN HELP.
     *
     * The player: "remind me how to heal allies". The reminder is worth
     * nothing on a card in a menu — it is worth something while you are
     * looking at a bleeding trooper, which is the only moment the question
     * gets asked. `Player._mendTarget` is the authority on who that is, so
     * this draws what the power would actually do rather than a second opinion
     * about who is in range (HANDOFF §2.4).
     */
    /**
     * …AND THE SHIP, WHICH IS THE ONE INPUT THAT ENDS THE RUN.
     *
     * `World._withdrawTick`'s own comment has claimed for several builds that
     * this number reaches the HUD — "the ring the player watches fill is the
     * same number this method is counting" — and nothing read it. The player
     * could not find the mechanic at all: "I still don't see a way to retreat
     * and take your troops out."
     *
     * Read off `world.withdrawHold` and nothing else, so the ring and the
     * commitment cannot disagree by construction. Hidden at zero rather than
     * drawn empty: a permanent ring on the screen is furniture, and this is an
     * event.
     */
    if (el.withdrawRing) {
      const h = world.withdrawHold || 0;
      if (h > 0) {
        el.withdrawRing.classList.remove('hidden');
        el.withdrawRing.firstElementChild.style.setProperty('--w', h.toFixed(3));
      } else if (this._withdrawShown) {
        el.withdrawRing.classList.add('hidden');
      }
      this._withdrawShown = h > 0;
    }

    if (el.mendCue) {
      const t = player.healTarget || player._mendTarget?.({ enemies: world.enemies });
      /**
       * …AND THE MAN YOU ARE NOT LOOKING AT, WHICH IS WHY NOBODY FOUND THIS.
       *
       * The player, three sessions running: "how do I heal my troops? You
       * should have already added it but maybe I've missed it." Ally mend has
       * worked the whole time and this cue has printed the whole time — but
       * only while a wounded man is inside the aim cone, which in a firefight
       * is where the ENEMY is. The prompt that teaches the power only appeared
       * once you were already doing it.
       *
       * `nearestWounded` is the same question with the cone off. When there is
       * somebody in reach and they are not under the reticle, the cue says so
       * and tells you what to do about it. The power is untouched: it still
       * wants the aim.
       */
      const near = t ? null : player.nearestWounded?.({ enemies: world.enemies });
      const who = t || near;
      const key = who
        ? `${t ? 'a' : 'n'}${who.hp < who.maxHp * 0.35 ? 2 : 1}${player.healing != null ? 'h' : ''}`
        : null;
      if (who && this._mendKey !== key) {
        this._mendKey = key;
        el.mendCue.firstChild.textContent = player.healing != null ? 'MENDING' : 'WOUNDED ALLY';
        el.mendCue.lastChild.textContent = player.healing != null ? 'HOLD STILL'
          : t ? `${this._mendKeyLabel()} TO MEND` : `LOOK AT THEM · ${this._mendKeyLabel()} TO MEND`;
        el.mendCue.classList.toggle('far', !t);
        el.mendCue.classList.remove('hidden');
      } else if (!who && this._mendKey !== null) {
        this._mendKey = null;
        el.mendCue.classList.add('hidden');
      }
    }
    if (el.targetOpen) {
      let best = null, bestState = null, bestD = Infinity;
      for (const e of world.enemies) {
        // …and the same filter again. Verified rather than assumed: an allied
        // trooper toppled 2 m from the player returns the shared `downed` row,
        // and this readout offered "1.5x CUT" over your own downed sergeant.
        if (!isHostile(world, e)) continue;
        const s = openState(e);
        if (!s) continue;
        const d = e.gripped ? -1 : e.position.distanceToSquared(player.position);
        if (d < bestD) { bestD = d; best = e; bestState = s; }
      }
      if (bestState && bestD < 100) {
        const mul = openMul(bestState, best);
        const key = bestState.key + mul;
        if (this._openKey !== key) {
          this._openKey = key;
          el.targetOpen.firstChild.textContent = bestState.label;
          el.targetOpen.lastChild.textContent = `${mul}× CUT`;
          el.targetOpen.style.color = bestState.colour;
          el.targetOpen.classList.remove('hidden');
        }
      } else if (this._openKey !== null) {
        this._openKey = null;
        el.targetOpen.classList.add('hidden');
      }
    }

    /* THE BLADE CURSOR IS A FIRST-PERSON INSTRUMENT AND NOTHING ELSE.
     *
     * It answers one question — where is the blade pointing, as distinct from
     * where am I looking — and that question only exists when the blade is not
     * on screen. In third person it IS on screen: screenGuard projects the
     * guard point, which is the base of the blade, so the ring lands ON the
     * blade every frame of every third-person game and reads as a second
     * reticle stuck to the weapon. Reported as exactly that. The answer is not
     * to move it, it is that in third person the blade is its own cursor.
     *
     * Hidden with the class rather than by leaving it transparent: `opacity`
     * is written below out of the steering branch, so an invisible-by-opacity
     * cursor comes back the moment the player grips, and a display:none node
     * costs no layout either. The centre reticle is untouched — it is the AIM,
     * a different instrument, and it is drawn in both views. */
    if (el.cursor) {
      el.cursor.classList.toggle('hidden', !firstPerson);
      // and mark the blade cursor while the player is actually driving the blade
      el.cursor.classList.toggle('steering', firstPerson && !!player.control?.steering);
    }

    if (firstPerson && el.cursor && player.control._grip) {
      const g = player.control.screenGuard(camera, player.chest, player.camera.aimQuat, _screen);
      const x = (g.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-g.y * 0.5 + 0.5) * window.innerHeight;
      el.cursor.style.transform = `translate(${x - window.innerWidth / 2}px, ${y - window.innerHeight / 2}px)`;
      const heat = clamp(player.saber.tipSpeed / 26, 0, 1);
      el.cursor.style.opacity = (0.25 + heat * 0.75).toFixed(2);
      el.cursor.firstElementChild.style.transform = `scale(${(0.7 + heat * 0.75).toFixed(2)})`;
    } else if (firstPerson && el.cursor && el.cursor.style.transform) {
      /* AND IT GOES BACK TO CENTRE WHEN NOBODY IS DRIVING IT.
       *
       * The transform above is written only while `_grip` is live, and the ring
       * is HIDDEN only in third person — so any first-person frame without a
       * grip left the last transform in place, and it sat there. Nothing reset
       * it on respawn, on a level change or on putting the blade away, so what
       * the player saw was a second reticle stuck off to one side: "over the
       * course of a game my reticle will move for some reason permanently…
       * you realise later that it's moved from your right to your left."
       *
       * `#blade-cursor` is centred by CSS, so clearing the inline transform IS
       * returning it to centre. Guarded on the string being non-empty because
       * this runs every frame and an unconditional style write on an untouched
       * element is a layout invalidation for nothing.
       *
       * AND ON `firstPerson`, which the first cut of this left off. The branch
       * then ran in THIRD person too, where the rule above is that the HUD
       * touches this node's transform not at all — hidden by a class is one CSS
       * edit away from being a ring on the blade again, so the guard is that
       * nothing writes the position, not that something writes it to zero.
       * There is nothing to clean up there in any case: the node is display:none
       * and the next first-person frame either rewrites the transform from a
       * live grip or lands here and clears it. */
      el.cursor.style.transform = '';
    }

    // ── boss bar: whichever boss is alive and nearest
    /* Both armies field a `big` body, so the third reader with the missing
     * filter put your own heavy on the boss bar. Verified: an allied trooper
     * given `A.big` was picked by this loop and named on the bar. */
    let boss = null;
    for (const e of world.enemies) {
      if (!isHostile(world, e)) continue;
      /* …AND A FORCE USER IS A BOSS FOR THE PURPOSES OF THIS BAR.
       *
       * The player: "I still don't know how to counter or fight against other
       * force users… I'm just being manipulated and thrown around like a
       * ragdoll being unable to do anything." Every counter this game has is
       * timed against something the enemy is doing — a pool that empties, a
       * 0.45 s telegraph, a cast that breaks when you hit it hard enough — and
       * a duellist that was not `boss` or `big` put none of it on screen. A
       * Sith acolyte throwing you across a room was, from the player's side, a
       * body with no state at all.
       *
       * Nearest-first, and a real boss outranks a duellist at the same range,
       * so walking into a set-piece still shows you the set-piece. */
      const isCaster = e.forceMax > 0 && (e.A.powers?.length > 0);
      if (!e.A.boss && !e.A.big && !isCaster) continue;
      if (!boss) { boss = e; continue; }
      const rank = (x) => (x.A.boss || x.A.big ? 0 : 1);
      const dNew = e.position.distanceToSquared(player.position);
      const dOld = boss.position.distanceToSquared(player.position);
      if (rank(e) < rank(boss) || (rank(e) === rank(boss) && dNew < dOld)) boss = e;
    }
    if (boss) {
      el.boss.classList.remove('hidden');
      el.bossLabel.textContent = boss.A.label;
      el.bossPhase.textContent = boss.bossPhase ? `PHASE ${boss.bossPhase}` : '';
      el.bossFill.style.transform = `scaleX(${clamp(boss.hp / boss.maxHp, 0, 1)})`;
      /* THE RESERVE, and the point of drawing it is that it EMPTIES: a body
       * with nothing left in the bar cannot push, cannot pull and cannot
       * lightning you, and that is the moment to close. */
      const pool = boss.forceMax > 0;
      if (el.bossForceTrack) el.bossForceTrack.classList.toggle('hidden', !pool);
      if (pool && el.bossForce) {
        el.bossForce.style.transform = `scaleX(${clamp(boss.force / boss.forceMax, 0, 1)})`;
      }
      /* AND THE TELEGRAPH IN WORDS. `_castTimer` is the 0.45 s wind-up and
       * `casting` is a power already running; both are windows the player can
       * act inside, and neither had any presence on screen. */
      if (el.bossCast) {
        const key = boss.casting || (boss._castTimer > 0 ? boss._castKey : null);
        if (key && this._bossCast !== key) {
          this._bossCast = key;
          el.bossCast.textContent = `${key} — BREAK IT`;
          el.bossCast.classList.remove('hidden');
        } else if (!key && this._bossCast !== null) {
          this._bossCast = null;
          el.bossCast.classList.add('hidden');
        }
      }
    } else el.boss.classList.add('hidden');

    // ── blade lock: a bar that runs out from the centre either way
    const lock = player.lockState;
    if (lock && !lock.done) {
      el.lock.classList.remove('hidden');
      const p01 = clamp(lock.pressure, -1, 1);
      const halfPct = Math.abs(p01) * 50;
      el.lockFill.style.width = `${halfPct}%`;
      el.lockFill.style.left = p01 >= 0 ? '50%' : `${50 - halfPct}%`;
      el.lockFill.classList.toggle('losing', p01 < 0);
    } else if (!el.lock.classList.contains('hidden')) {
      el.lock.classList.add('hidden');
    }

    // ── the line that says why the last deflection graded as it did
    if (this.whyTimer > 0) {
      this.whyTimer -= dt;
      if (this.whyTimer <= 0) el.why.classList.remove('on');
    }

    // ── center message
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) el.center.classList.remove('on');
    }

    // ── floating marks
    for (let i = this._marks.length - 1; i >= 0; i--) {
      const m = this._marks[i];
      m.t += dt;
      if (m.t > 1.05) { m.node.remove(); this._marks.splice(i, 1); continue; }
      _v.copy(m.pos).project(camera);
      if (_v.z > 1) { m.node.style.display = 'none'; continue; }
      m.node.style.display = '';
      m.node.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
      m.node.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
    }

    // ── who is who. Note #16; see `_nameplates`.
    this._nameplates(world, player, camera);

    // ── the support calls, while one is being spelled. See `_stratagemPanel`.
    this._stratagemPanel(player);
    /* The standing order, above it in the same column. */
    this._missionPanel(world);
    /* …and the front, under the wave. Both are readouts of a mode rather than
     * of a body, so both are written once a frame from the director. */
    this._frontBar(world);

    /**
     * ── the room, and what it has to say about itself
     *
     * Last, and after the early return above, so both systems see a frame the
     * HUD has already agreed is drawable. `popups` is read here rather than
     * inside popup() so that the gate is one property read per frame instead of
     * one per event, and so the reader named in SETTING_READERS is on the
     * element that owns the feed.
     */
    this.popupsOn = world.settings ? world.settings.popups !== false : true;
    this.announcer.update(dt, world, player, this);
    this.presence.update(dt, world);

    /**
     * ── the map, and what the player has to say
     *
     * After the announcer, so an emote committed on this frame speaks into a
     * budget the announcer has already stepped, and last of all because both
     * are readouts: neither may run before the HUD has agreed the frame is
     * drawable, and neither may change anything the lines above it read.
     */
    this.minimap.update(dt, world, player, world.settings);
    /*
     * …and the line that says how to bring it up, which only exists while the
     * map is something you have to ask for. It is written on a CHANGE rather
     * than every frame: a DOM class toggle sixty times a second for a caption
     * that changes twice a fight is the same waste the map's own 20 Hz budget
     * exists to refuse.
     */
    if (this.el.mapKey) {
      const s = world.settings || {};
      const ask = s.minimap !== false && s.minimapSense !== false && this.minimap.read <= 0;
      if (ask !== this._mapAsk) {
        this._mapAsk = ask;
        this.el.mapKey.classList.toggle('hidden', !ask);
      }
    }
    // The wheel prints WORDS when the player has asked for words — the same
    // live read as everything else on this frame, written only on a change.
    const spoken = (world.settings?.speechMode ?? 'synth') !== 'synth' && canSpeakWords();
    if (spoken !== this.emotes.spoken) this.emotes.setSpeech(spoken);
    const picked = this.emotes.update(input, this);
    if (picked) this.emote(picked, world, player);

    /**
     * …AND THE ORDER WHEEL, which is the same machine with the mode's own
     * table in it. Note #18.
     *
     * Built lazily and only where there is an army: `ORDERS` is the
     * authority for what an order is, so the wheel cannot exist before the
     * director does and there is nothing for it to say in a mode with no
     * troops in it.
     */
    if (world.command && this.el.orderwheel) {
      if (!this.orders) {
        this.orders = new OrderWheel(this.el.orderwheel, ORDERS);
      }
      this.orders.director = world.command;
      const o = this.orders.update(input, this);
      if (o) {
        if (o.kind === 'hold') world.command.hold?.();
        else if (o.kind === 'squad') world.command.cycleSquad?.();
        else if (o.kind === 'detach') world.command.detachNearest?.();
        /* …AND THE ORDER CARRIES ITS TARGET. `selectedSquad` is null unless the
         * player has chosen one on this same wheel, and null is the whole army
         * — which is the behaviour every existing caller had and keeps. */
        else world.command.order?.(o.id, null, world.command.selectedSquad);
      }
    } else if (this.orders) {
      this.orders.close();
    }
  }

  /**
   * PLAY ONE EMOTE — the voice, the blade, and the word for it.
   *
   * `force` on the announcer's budget, because this is not a quip. The gaps in
   * Announcer exist to stop the game talking over itself when it decides
   * something happened; a player who has held a key open, moved the mouse to a
   * slot and let go has decided, and a deliberate act refused by a rate limit
   * reads as a broken key rather than as restraint. It still SETS the budget on
   * the way through, so the next automatic line waits for this one.
   *
   * Every gate the rest of the voice honours is honoured here too: a player who
   * has switched their own voice off gets the gesture and the caption and no
   * sound, and one who has switched popups off gets the gesture and the sound.
   * An emote is not a reason to overrule an option.
   */
  emote(e, world, player) {
    if (!e) return null;
    const s = world?.settings || {};
    const at = player?.chest || player?.position || null;
    const said = this.announcer.say(s, e.line, at);
    /**
     * THE ONLY THING THE BODY CAN HONESTLY BE ASKED TO DO FROM HERE.
     *
     * `flourishT` is SaberController's own timer and `actHit('flourish')` sets
     * it exactly this way, guard and all — the guard is what stops an emote
     * interrupting a raised blade or a thrust, and re-checking `< 0` is what
     * stops a held key restarting the twirl sixty times a second. Everything
     * else a body could do is a pose, and a pose written from here would be
     * overwritten by the animator on the very next frame.
     */
    if (e.gesture === 'flourish' && player?.control && player.control.flourishT < 0) {
      player.control.flourishT = 0;
    }
    this.popup(e.name.toUpperCase(), e.blurb, 'emote');
    return { emote: e, said: !!said };
  }

  /**
   * A tick as the cursor crosses into a slot.
   *
   * `hover` and not a new sound: it is the one AudioEngine.ui already ships for
   * "the cursor is now on this", it is 50 ms at gain 0.05, and it goes out at
   * PRIO.critical like every other menu sound so a wheel opened mid-firefight
   * still answers. A kind that is not in that map plays SILENTLY, which is how
   * a wheel ends up with no feedback and nothing to show for it.
   */
  _emoteTick() { try { this.announcer.audio?.ui?.('hover'); } catch {} }

  /**
   * ONE EVENT, IN THE HUD'S OWN VOICE.
   *
   * Not a banner across the middle of the screen: that space belongs to
   * `message()`, which the wave director already uses, and a killstreak
   * competing with "WAVE 7" is two things shouting. The feed sits under the
   * score in the top-right corner — where the combo counter and the score
   * already are, which is where the eye goes after a kill — in the same mono
   * face and the same letter-spacing as everything else in that column, so it
   * reads as the score block saying something rather than as an overlay
   * arriving on top of the game.
   */
  popup(title, sub = '', kind = 'event') {
    if (!this.popupsOn) return null;
    const host = this.el.events;
    if (!host) return null;
    const node = document.createElement('div');
    node.className = `ev ev-${kind}`;
    node.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    host.appendChild(node);
    this._pops.push(node);
    // Four at once is already a wall; the oldest leaves rather than the newest
    // being refused, because the newest is the one that just happened.
    while (this._pops.length > 4) drop(this._pops.shift(), host);
    setTimeout(() => { drop(node, host); const i = this._pops.indexOf(node); if (i >= 0) this._pops.splice(i, 1); }, 2800);
    return node;
  }

  /**
   * ONE SLOT OF THE WHEEL: A SHUTTER THAT IS MEASURED, AND A GATE THAT ASKS.
   *
   * `cd` is SECONDS REMAINING. It used to be a fraction the caller computed by
   * dividing by a cooldown constant typed into HUD.update, and four of the nine
   * divisors disagreed with the power they described: lightning divided by 0.35
   * against a real 1.5 s (`Player.forceLightning`), stasis by 0.8 against 1.4, heal by 8
   * against 9, compel by 6 against 7. Since `clamp(cd, 0, 1)` pins anything
   * over 1 to a full shutter, Force Lightning read "just used" for 1.15 s of
   * its 1.5 s wait and then emptied in the last 0.35 s — the bar said nothing
   * for three quarters of the countdown it exists to show.
   *
   * The fix is not a better table. It is that the HUD does not need to know any
   * cooldown at all: it watches the number it is given, remembers the highest
   * value of the current wait, and draws the ratio. That is right for every
   * power automatically, including heal, whose cooldown is 9 s when it
   * completes and 3 s when it is interrupted (`Player._endHeal`) — a constant
   * divisor cannot be right for both, and a peak is right for both. Change a
   * cooldown in Player and this follows it in the same frame, with no second
   * copy of the number anywhere.
   *
   * The peak is captured within one frame of the power firing (the wheel runs
   * after the player's update, so the worst case is a 60th of a second of decay
   * already applied — 1.6% of a 1 s cooldown) and is cleared the moment the
   * wait reaches zero, so nothing leaks between uses.
   */
  _power(key, cd, affordable, active) {
    const p = this.powerEls[key];
    if (!p) return;
    const peaks = this._cdPeak || (this._cdPeak = {});
    const left = Math.max(0, num(cd, 0));
    if (left <= 0) peaks[key] = 0;
    else if (left > (peaks[key] || 0)) peaks[key] = left;
    const shutter = peaks[key] > 0 ? left / peaks[key] : 0;
    p.cd.style.transform = `scaleY(${clamp(shutter, 0, 1)})`;
    p.root.classList.toggle('ready', !!affordable && left <= 0.01);
    p.root.classList.toggle('active', !!active);
    /* SECONDS, NOT A PROPORTION. The shutter is `left / peak`, which answers
     * "how far through" and not "how long" — and how long is the only version
     * of the question a player asks. Written through `_num`'s rule: only when
     * the printed value moves, because this runs for eleven slots every frame.
     * Under a second it counts in tenths, because the last second of a 2.4 s
     * cooldown is the one you are actually waiting on. */
    const cooling = left > 0.05;
    p.root.classList.toggle('cool', cooling);
    if (p.tick) {
      const txt = cooling ? (left < 1 ? left.toFixed(1) : String(Math.ceil(left))) : '';
      if (p.tick._last !== txt) { p.tick._last = txt; p.tick.textContent = txt; }
    }
  }

  /**
   * CAN THE PLAYER ACTUALLY PAY FOR THIS, IN THE GAME AS CONFIGURED.
   *
   * The wheel used to compare `player.force` against a literal per slot, and
   * two of the nine literals were simply the wrong price — lightning was gated
   * at 14 against a real 30 (`Player.forceLightning`), so the slot said READY and the
   * key answered "30 FORCE NEEDED, YOU HAVE 20"; stasis was gated at 30 against
   * a real 26, so the slot dimmed for four Force it did not need. On top of
   * that, a raw comparison cannot see either of the two things that move the
   * price: `forceDrain`, whose own label in index.html reads "unlimited Force"
   * at 0 — with it there, every power is free and the wheel greyed them all out
   * anyway — and the `forceCost` boons.
   *
   * So the gate asks the player's own economy: `_canSpend` is the single
   * function Player uses to decide, and it reads drain and the boon multiplier
   * live.
   *
   * A PARAGRAPH USED TO STAND HERE saying that three powers bypassed that gate
   * in Player — `throwOrRecall` and `toggleSense` comparing raw force against a
   * literal, `forceLightning` applying the boon multiplier by hand but not the
   * drain — and that "until they are fixed, this wheel tells the truth about
   * them". They were fixed, in Player, and the paragraph stayed: it was
   * contradicted by the four lines under it, which route every slot through
   * `_canSpend` and say so. A comment that describes a game two rounds old is
   * worse than none, because the next reader believes it and writes the
   * exception back in. See tools/checks/hud-events.mjs, which pins every number
   * below to the line of Player.js it came from.
   */
  _afford(player, key) {
    const cost = POWER_COST[key];
    if (cost == null || !player) return true;
    // Force Lightning is drafted, not learned: without the boon the key
    // refuses no matter how much Force is in the bar.
    const boon = POWER_BOON[key];
    if (boon && !player.boonMods?.[boon]) return false;
    // ONE gate for all nine — `_canSpend` is the single function Player uses to
    // decide, and it reads the drain slider and the boon multiplier live. There
    // used to be three gates here because three powers bypassed it; they do not
    // any more, so the wheel no longer has to describe an exception.
    return typeof player._canSpend === 'function'
      ? player._canSpend(cost)
      : player.force >= cost * (player.boonMods?.forceCost ?? 1);
  }

  /** Dojo coaching panel. */
  setCoach(state) {
    const el = this.el;
    if (!state) { el.coach.classList.add('hidden'); return; }
    el.coach.classList.remove('hidden');
    el.coachTitle.textContent = state.title;
    el.coachCount.textContent = state.need === Infinity
      ? `${state.index + 1}/${state.total}`
      : `${state.progress}/${state.need}`;
    el.coachBrief.textContent = state.brief;
    /* THE FORM'S NAME AND THE FORM'S TELL. The name alone is a label a student
     * cannot act on; the tell is the sentence that says what to watch for, and
     * `FORMS` has authored one per form since the table was written with
     * nothing anywhere drawing it. Appended rather than given a line of its own
     * because it is the second half of the same statement — see `Dojo.report`. */
    el.coachHint.textContent = state.form
      ? `${state.hint}  ·  sparring: ${state.form}${state.formTell ? ` · ${state.formTell}` : ''}`
      : state.hint;
    const frac = state.need === Infinity ? 1 : clamp(state.progress / state.need, 0, 1);
    el.coachFill.style.width = `${frac * 100}%`;
  }
  showCoach(on) { this.el.coach.classList.toggle('hidden', !on); }

  /** One short line explaining the last deflection or clash. */
  explain(text, colour = '#9fb0c6', duration = 1.6) {
    if (!text) return;
    this.el.why.textContent = text;
    this.el.why.style.color = colour;
    this.el.why.classList.add('on');
    this.whyTimer = duration;
  }

  /**
   * The banner across the middle. `sub` CAN BE A PEER'S NAME.
   *
   * `main.js` calls `world.notify('A JEDI HAS FALLEN AWAY', `${r.name} left the
   * fight`)` when a co-op remote drops, and `r.name` arrives off that peer's
   * `{t:'hello', name}` with no cap and no sanitisation — so the string on the
   * far side of this template is written by another machine, exactly as
   * `killFeed`'s `who` is. That fix was made once, for this threat, and this
   * method one screen away was missed: measured on the real page, a name of
   * `<img src="/nope" onerror=…>` parsed into the live DOM with its handler
   * attached and the browser went and fetched the URL.
   */
  message(title, sub, duration, kind = 'flavour') {
    /* THREE TIERS, ONE ELEMENT. The class is what the stylesheet reads; the
     * DURATION is part of the tier too, because an alarm that hangs for the
     * same 2.4 s as a level name is an alarm you scroll past. See World.notify
     * for what each tier means. */
    const k = kind === 'alarm' || kind === 'threat' ? kind : 'flavour';
    const el = this.el.center;
    el.classList.remove('flavour', 'threat', 'alarm');
    el.classList.add(k);
    el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    el.classList.add('on');
    this.centerTimer = duration ?? (k === 'alarm' ? 1.8 : k === 'threat' ? 2.6 : 2.4);
  }

  floating(worldPos, text, color = '#fff') {
    const node = document.createElement('div');
    node.className = 'hm';
    node.textContent = text;
    node.style.color = color;
    this.el.hitmarks.appendChild(node);
    this._marks.push({ node, pos: worldPos.clone(), t: 0 });
    if (this._marks.length > 26) { const m = this._marks.shift(); m.node.remove(); }
  }

  /**
   * The frame cost, on screen, in the corner.
   *
   * Refreshed four times a second rather than every frame: at 60 Hz a number
   * that changes 60 times a second is unreadable, and — worse — reading it
   * would then be a measurement of the profiler. The values shown are the
   * WINDOW's statistics, not this frame's, for the same reason.
   *
   * The 1% low is deliberately given equal billing to the mean. A build that
   * averages 8 ms and hitches to 40 four times a second reads as "smooth" in
   * an average and feels broken to play, and "it runs like shit and gets worse"
   * is a complaint about the second number, never the first.
   */
  perf(profiler, show) {
    const el = this.el.perf;
    if (!el) return;
    if (!show) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this._perfAt = (this._perfAt || 0) + 1;
    if (this._perfAt % 15) return;
    const s = profiler.stats();
    if (!s) { el.textContent = 'measuring…'; return; }
    /* …AND THE CPU LINE OBEYS THE PARAGRAPH ABOVE NOW. It read
     * `profiler.cpuMs`, which is THIS FRAME — the one thing the note two lines
     * up says this box does not show, and unreadable for exactly the reason it
     * gives, since the box refreshes on whichever frame lands on the fifteenth.
     * The window's CPU mean and its 1% low were being recorded and discarded
     * (see Profiler.stats); a hitching build now says whether the hitch is
     * ours. The GPU stays instantaneous when there is no window for it — a
     * machine that refuses the timer query has nothing to average. */
    const g = s.gpu;
    const gpu = g ? `${g.mean.toFixed(1)}/${g.low1.toFixed(1)}`
      : (profiler.gpuMs == null ? 'n/a' : profiler.gpuMs.toFixed(1));
    el.textContent =
      `${s.mean.toFixed(1)} ms  ${s.fps.toFixed(0)} fps\n`
      + `1% low ${s.low1.toFixed(1)}  p99 ${s.p99.toFixed(1)}\n`
      + `cpu ${s.cpu.mean.toFixed(1)}/${s.cpu.low1.toFixed(1)}  gpu ${gpu}\n`
      + `${profiler.calls} calls  ${(profiler.triangles / 1000).toFixed(0)}k tris`;
  }

  hitmark(worldPos, kind, bone) {
    const map = {
      hit: ['·', '#dfe8f5'],
      cut: [bone ? SEVER_LABEL[bone] || 'CUT' : 'CUT', '#8fe8ff'],
      sever: [SEVER_LABEL[bone] || 'SEVERED', '#a8f0ff'],
      kill: ['KILL', '#ffd88a'],
    }[kind] || ['·', '#fff'];
    this.floating(worldPos, map[0], map[1]);
  }

  killFeed(who, what, kind) {
    const node = document.createElement('div');
    node.className = 'kf';
    const verb = kind === 'cut' ? 'cut down' : kind === 'bolt' ? 'returned fire on' : 'destroyed';
    // `who` is a player name, which in co-op arrives from another machine
    // (Net.js reads it off `conn.metadata`). The popup feed and the boon chips
    // in this file already escape; this line did not.
    node.innerHTML = `<b>${esc(who)}</b> ${verb} ${esc(what)}`;
    this.el.killfeed.appendChild(node);
    setTimeout(() => node.remove(), 4200);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  /**
   * THE STRIP STOPS BEING A WALL ONCE THERE ARE ENOUGH OF THEM.
   *
   * Every boon was a chip reading "icon NAME" — about 90 px of it — in a strip
   * that wraps. That is fine at four and it is a wall at forty: with a full
   * holocron the strip was eight wrapped rows, and since `.hud-bl` is
   * bottom-anchored every one of those rows LIFTED everything above it. The
   * player reported the consequence rather than the cause: "all the icons for
   * all your powerups cover the bottom left side of your screen pushing up the
   * troop management screen and stratagem screens so far up that they are
   * totally obscured". Measured on the real page at 1280x720, `.hud-bl` spanned
   * y -811…702 — eight hundred pixels of HUD above the top of the window.
   *
   * The panels have moved out of that column (see index.html), which is the
   * half of the fix that stops them being pushed. This is the other half: past
   * `NAMED` boons the strip drops to ICONS, which is the part a player reads at
   * a glance anyway, and the name goes to the tooltip and the accessible label
   * rather than off the screen. Nothing is hidden and no count is elided — a
   * "+31 more" chip would be exactly the failure of not showing you what you
   * unlocked. Forty-four chips: 8 rows named, 3 rows as icons.
   */
  setBoons(boons) {
    this.el.boons.innerHTML = '';
    const dense = boons.length > BOONS_NAMED;
    this.el.boons.classList.toggle('dense', dense);
    for (const b of boons) {
      const d = document.createElement('div');
      d.className = 'bn';
      /* The name is still ON the chip when it is dense — as the title and the
       * label, so a hover and a screen reader both still get it. */
      d.title = b.name;
      d.setAttribute('aria-label', b.name);
      d.textContent = dense ? `${b.icon}` : `${b.icon} ${b.name}`;
      this.el.boons.appendChild(d);
    }
  }
}

const SEVER_LABEL = {
  head: 'DECAPITATED', neck: 'DECAPITATED',
  chest: 'BISECTED', spine: 'BISECTED', hips: 'BISECTED', body: 'BISECTED',
  armL: 'ARM', armR: 'ARM', foreL: 'ARM', foreR: 'ARM', handL: 'HAND', handR: 'HAND',
  thighL: 'LEG', thighR: 'LEG', shinL: 'LEG', shinR: 'LEG', footL: 'FOOT', footR: 'FOOT',
  clavL: 'SHOULDER', clavR: 'SHOULDER',
};

const _screen = new THREE.Vector2();

/** Titles come from archetype labels, which are data. Data goes in as text. */
const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/**
 * HOW MANY OF THE ENEMY ARE LEFT — and a note about where this belongs.
 *
 * `#hud-remaining` read `world.director.remaining`, which is
 *
 *     spawnQueue.length + arrivals.pending + enemies.filter(e => !e.dead).length
 *
 * and in Command mode `world.enemies` HOLDS YOUR OWN TROOPS. An ally is an
 * Enemy with a different `team` — that is the design decision that makes allies
 * real, and Waves.js's own `update()` has the correct rule forty lines above
 * the getter, with a long comment about how counting your own army once stopped
 * waves from ever closing. `remaining` never got it. So the top-left corner
 * said "10 remaining" with nothing hostile on the field.
 *
 * THIS IS NOT WHERE THE FIX BELONGS AND IT IS DELIBERATELY MINIMAL. The getter
 * is in src/game/Waves.js, which another lane owns; the request to hoist that
 * predicate so both callers share one rule has been sent and is unanswered.
 * Until it lands:
 *
 *   · every mode WITHOUT an army reads `director.remaining`, untouched, so
 *     nothing that is currently right can be made wrong here and no second
 *     copy of the rule can drift in the ninety-odd percent of play that has
 *     no allies in `world.enemies` at all;
 *   · Command mode — the only place the shipped getter is wrong — counts the
 *     hostiles itself, off `world.partyTeam`, which is the authority for
 *     "which side is mine" and the same field Waves.js reads.
 *
 * Written so it stays correct if `remaining` is fixed underneath it: it does
 * not subtract from the getter's answer, it composes its own. A subtraction
 * would silently start under-counting the moment the real fix landed.
 */
/**
 * IS THIS BODY ON THE OTHER SIDE — the predicate FOUR readers in this file were
 * missing, and the same one `hostilesLeft` twelve lines down already needed.
 *
 * In Command your own troops ARE `Enemy` instances in `world.enemies` with a
 * different `team`; that is the design decision that makes allies real, and
 * `WaveDirector.blocksWaveEnd` is the one statement of it, with a comment
 * naming the three callers that each had a wrong copy. So this asks the
 * director rather than writing a fourth. Measured on a real geonosis Command
 * run: 18 bodies alive, 10 of them yours.
 *
 * The fallback is not a second opinion, it is the no-director case — the
 * options preview and the co-op lobby both drive this HUD against a world with
 * no wave director, and a minimap that goes blank there would be a worse defect
 * than the one this fixes.
 */
export function isHostile(world, e) {
  const d = world?.director;
  if (d && typeof d.blocksWaveEnd === 'function') return d.blocksWaveEnd(e);
  return !!e && !e.dead && (e.team ?? 1) !== (world?.partyTeam ?? 0);
}

export function hostilesLeft(world) {
  /**
   * COMPOSED, NOT DELEGATED — and it stays that way on purpose.
   *
   * `WaveDirector.remaining` has since been fixed at the source: `blocksWaveEnd`
   * is now the single statement of the party predicate with three callers, two
   * of which were wrong. So this function is, strictly, a second computation of
   * a rule that is now right in one place — the twin this codebase keeps
   * deleting (HANDOFF 2.3) — and collapsing it to `d.remaining` was tried.
   *
   * It was put back, because the check that guards this is written against a
   * director whose `remaining` is deliberately a LIE (99, with six real
   * hostiles). That fixture is the point: the HUD's job is to be right about
   * what the player can see even when the thing it asks has been broken, and
   * `remaining` has been broken twice already this session. Making the
   * delegation pass would have meant editing that fixture to accept the
   * delegation — relaxing a bound to fit a cleanup that buys no behaviour.
   *
   * Redundant and independently correct beats terse and jointly wrong. If this
   * is ever collapsed, the check has to be rewritten to drive a REAL director
   * first, not restubbed.
   */
  const d = world?.director;
  if (!d) return 0;
  if (!world.command) return d.remaining;
  const party = world.partyTeam ?? 0;
  let alive = 0;
  for (const e of world.enemies || []) if (!e.dead && (e.team ?? 1) !== party) alive++;
  return (d.spawnQueue?.length || 0) + (d.arrivals?.pending || 0) + alive;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ROLL, drawn once and read twice                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The roll split and ordered, from `CommandRoster.summary()`.
 *
 * The living come first and the BEST of them first — rank, then kills, then
 * experience — because the panel's whole job is to put the two or three names
 * you have been protecting where you can watch them. The fallen come after,
 * most recent first, because a casualty list is read backwards from the last
 * thing that happened.
 *
 * `rank` arrives as a short code ('SGT'), so the ordering is the RANKS table's
 * own index and not an alphabetical accident: 'SGT' sorts before 'TRP' either
 * way, and 'CMD' before 'VET' does not.
 */
export function rosterSides(summary) {
  const roll = summary?.roll || [];
  const rung = (short) => RANKS.findIndex(r => r.short === short);
  return {
    living: roll.filter(t => t.alive)
      .sort((a, b) => (rung(b.rank) - rung(a.rank)) || (b.kills - a.kills) || (b.xp - a.xp)),
    fallen: roll.filter(t => !t.alive)
      .sort((a, b) => (b.diedIn ?? 0) - (a.diedIn ?? 0)),
  };
}

/**
 * One name, as a row.
 *
 * The insignia chip is the RANK'S OWN COLOUR, looked up in `RANKS` rather than
 * typed here — those five colours are painted onto the real meshes when a
 * trooper is promoted, and a second table of them in the HUD would drift from
 * the army the player is looking at. A Trooper has `color: null` in that table
 * on purpose (a fresh clone is unmarked), so the chip falls back to the panel's
 * own line rather than inventing a colour nobody wears.
 */
export function trooperRow(t) {
  const rec = RANKS.find(r => r.short === t.rank);
  const chip = rec && rec.color != null
    ? `#${(rec.color >>> 0).toString(16).padStart(6, '0')}` : '';
  const right = t.alive ? String(t.kills | 0) : `A${t.diedIn ?? '?'}`;
  return `<div class="rp-row${t.alive ? '' : ' gone'}" title="${esc(t.rankTitle)} · ${esc(t.unit)}">`
    + `<i${chip ? ` style="background:${chip}"` : ''}></i>`
    + `<b>${esc(t.rank)}</b><span>${esc(t.name)}</span><em>${esc(right)}</em></div>`;
}

/**
 * THE WHOLE ROLL AS MARKUP — living above fallen, the dead struck through.
 *
 * Exported because it is drawn in two places: the HUD's own column during a
 * fight, and the muster screen between areas, where there is room for all of
 * it. Two renderers would be two answers to "what does a casualty list look
 * like", and the one that is wrong is always the one you are not looking at.
 * Pure and DOM-free so a check can assert what a player would read.
 */
export function rosterHtml(summary, squadNames = null, word = 'Squad') {
  const { living, fallen } = rosterSides(summary);
  /**
   * ── AND IT IS GROUPED BY SQUAD, WHICH IS THE ONLY IN-GAME VIEW OF ONE ────
   *
   * "I should be able to separately view my squads in an actual game."
   *
   * Nothing on the field distinguished squad 1 from squad 2 — not the roster,
   * not the nameplates, not the minimap, not the paint — so a player who
   * delegated an order had no way to see who they had delegated it to. This
   * column already draws every living man; grouping it under a heading per
   * squad turns it into the view, and costs nothing but the headings.
   *
   * `squadNames` is what the player called them, handed down from the same
   * one reader the fight's notifications use, so a squad named Havoc is Havoc
   * here too. Absent, they are the army's own word and the number.
   *
   * A ROLL WITH NO SQUADS IN IT IS ONE LIST, exactly as before — a mode with
   * one squad, or a summary from a build that did not carry the field, must
   * not sprout a heading that says nothing.
   */
  const label = (k) => (squadNames && squadNames[k]) || `${word} ${k + 1}`;
  const keyed = living.filter((t) => Number.isInteger(t.squad) && !t.detached);
  const loose = living.filter((t) => !Number.isInteger(t.squad) || t.detached);
  const squads = [...new Set(keyed.map((t) => t.squad))].sort((a, b) => a - b);
  const head = '<div class="rp-row rp-cols"><i></i><b>Rk</b><span>Trooper</span><em>K</em></div>';
  const body = squads.length > 1
    ? squads.map((k) => {
      const men = keyed.filter((t) => t.squad === k);
      return `<div class="rp-div">${esc(label(k))} — ${men.length}</div>`
        + men.map(trooperRow).join('');
    }).join('') + (loose.length
      ? `<div class="rp-div">Detached — ${loose.length}</div>` + loose.map(trooperRow).join('')
      : '')
    : living.map(trooperRow).join('');
  return head + body
    + (fallen.length ? `<div class="rp-div">Fallen — ${fallen.length}</div>` : '')
    + fallen.map(trooperRow).join('');
}

/** Detach a node whether it is a real one or a test double. */
function drop(node, host) {
  if (!node) return;
  try { if (typeof node.remove === 'function') { node.remove(); return; } } catch {}
  try { host?.removeChild?.(node); } catch {}
}
