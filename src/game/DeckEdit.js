/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FLIGHT DECK — LOOKING ONE MAN IN THE FACE, AND CHANGING HIM THERE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `HANGAR-SPEC.md` asks for seven things this file is the whole of, and every
 * one of them was marked `·` — not started — when it was written:
 *
 *   "Camera close-focus when you select one: he breaks attention, turns to
 *    face you, salutes, holds."
 *   "Deselect returns him to attention with a snap."
 *   "Change them live from the hangar — rename, paint, attach — and see it
 *    happen on the man in front of you."
 *   "Paint applies as a **sweep, not a pop** — like a wash moving over the
 *    armour."
 *   "Attachment parts physically drop in from off-frame or are handed over by
 *    a droid."
 *   "Every change plays a one-shot audio cue."
 *   "Everything you change is saved on leaving, and everything doable here is
 *    doable in the main menu."
 *
 * ── WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────
 *
 * `Hangar.js` owns the ROOM and the company's arrival. Nothing in it reads a
 * pointer, and the one hook the deck has that is not a body or a prop is
 * `HangarDirector.update`. This file is what that hook calls.
 *
 * Keeping it apart is not tidiness, it is the same argument `DeckLife.js` and
 * `DeckAudio.js` already make about that file: the deck is four layers over one
 * room, and each of them reaches `Hangar.js` through exactly one line. This one
 * costs three lines in the whole of the rest of the tree — a step in the
 * director, a key in `Player`'s deck branch, and a commit in `leaveHangar` —
 * and everything else it does it does to itself.
 *
 * ── THE FOUR THINGS THAT WERE ALREADY WRITTEN AND DEAD ────────────────────
 *
 * Almost nothing here is new mechanism. The audit that produced this file found
 * the parts already in the tree with no caller at all, and joining them up is
 * most of the work:
 *
 *   `Parade.turnTo` / `turnState` / `TURN`   the head leading the shoulders,
 *       the feet pivoting under them, the whole thing unwinding. Imported into
 *       Hangar.js and never called. It is "he turns to face you", written.
 *   `Parade.salute` / `SALUTE`               a hand that goes up fast, stops
 *       dead, holds a measured 1.7 s and comes down slower. Called by
 *       `deckOrder`, which itself has no caller.
 *   `MergedSkin.paint()` / `syncPaint`       "AND THE PAINT STILL MOVES" — the
 *       merge's own promise that a `palette.plate.color` written after the bake
 *       reaches the drawn mesh. Nothing had ever written one.
 *   `DeckAudio.cuePaint/cueAttach/cueDetach/cueName`  four cues, measured,
 *       called by nothing but their own unit test.
 *
 * ── THE CAMERA, AND WHY THERE IS NO CAMERA MOVE ───────────────────────────
 *
 * "Camera close-focus" is the one bullet answered with a deliberate NO, and the
 * reason is in `Player.js`: `_updateCamera` ASSIGNS `camera.fovTarget` from the
 * player's own speed on every single frame, and `CameraRig.update` recomposes
 * position and orientation from `aimQuat` every frame after that. Anything this
 * file wrote to the lens would be overwritten on the next line of the same
 * frame, and anything that stopped it being overwritten would be this file
 * taking the mouse away — on a deck whose entire promise is that you walk down
 * the line yourself. `Levels.js` has deleted six interiors for feeling like a
 * screen rather than a place, and a cutscene camera is that failure with a
 * lens on it.
 *
 * SO THE SUBJECT CLOSES THE DISTANCE INSTEAD, and the framing is one the player
 * is guided into rather than moved through:
 *
 *   · the pick only reaches `REACH` metres, so selecting a man is something you
 *     have to walk up to him to do — the close shot is composed by your feet;
 *   · he then breaks ranks and steps `STEP_OUT` out of the line toward you,
 *     which is `Menu._stagePick`'s `stepTo = 0.55` made physical rather than
 *     copied as a number;
 *   · and he turns, salutes and HOLDS, so the thing you walked up to is looking
 *     back at you for as long as you stand there.
 *
 * That is the same shot the bullet asks for, composed out of the man rather
 * than out of the lens, and it costs the player nothing he did not choose.
 *
 * ── THE SWEEP, AND WHICH OF THE TWO ALLOWED MECHANISMS IT IS ──────────────
 *
 * The brief is in bold about this one: "paint applies as a **sweep, not a
 * pop**". The shipped repaint (`CommandDirector.repaint`) is
 * `e._cmdPaint.color.setHex(color)` — a single-frame assignment, a pop by
 * construction.
 *
 * The choice was between a shader uniform and a per-vertex mask, and it is the
 * PER-VERTEX MASK, because of what the deck actually draws. A man who has
 * halted is a MERGED skin: `mergeFigure` folds 54 meshes into about 7, absorbs
 * `material.color` into a vertex colour attribute, and clones the material.
 * A uniform patched onto the source material would therefore have to survive
 * `Material.clone()`, agree with `mergeBinKey` (which walks a material's keys
 * to decide what may share a draw call), and be recompiled per figure — three
 * ways to be wrong, in the one file this work may not edit. The merged colour
 * buffer, by contrast, is already the live paint surface, already public on
 * `skin.meshes[i].geometry.attributes.color`, and already has a published
 * correspondence back to the source materials in `skin.sources[i]`.
 *
 * So the wash is a moving EDGE in the figure's own frame — a height, running
 * from the boot to the crown over `SWEEP.dur` — and every vertex below it
 * carries the new colour, every vertex above it the old, with `SWEEP.soft` of
 * blend between. That is literally a wash crossing the armour, it is one
 * `setXYZ` per painted vertex per frame for the 0.8 s it lasts, and it needs no
 * shader, no recompile and no second material.
 *
 * THE SOURCE MATERIAL IS LEFT ALONE UNTIL THE WASH LANDS, which is what stops
 * this fighting the merge: `syncPaint` only rewrites a span when the source
 * material's colour has MOVED, so while the sweep runs it sees no change and
 * does nothing. On the last frame the source material takes the final colour
 * and `merged.paint()` is called, so the buffer ends up written by the shipped
 * path and not by this one — a figure re-baked or re-merged afterwards comes
 * out the same colour it was left.
 *
 * A man who has NOT halted yet is not merged, and there is nothing to mask; he
 * gets the same progression as a material-colour ramp over the same clock. The
 * sweep is still a progression, it is simply not spatial for the eight seconds
 * of the walk-on. Written down rather than hidden.
 *
 * ── THE ONE DOOR THAT WRITES ──────────────────────────────────────────────
 *
 * `Company.dress` and nothing else, exactly as `Menu._wireCompanyEdits` does
 * it: the deck sends a WHOLE `look` field, the store validates it — a mark id
 * this build does not have, a callsign with a quote in it — and what comes back
 * out of the store is what the deck then puts on the body. A screen that
 * painted first and wrote second would show the player a colour the save
 * refused. `EDIT_OPS` is the list of what may be sent, and `deckedit.mjs`
 * asserts it is the same list the menu sends.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { salute, turnTo, stagger, buildFigure, paradeMan, SALUTE, TURN } from './Parade.js';
import { mergeFigure } from './MergedSkin.js';
import { dress as companyDress } from './Company.js';
import { dressRecruit } from './Muster.js';
import { MARKS, markById, CommandDirector } from './Command.js';
import { ARCHETYPES } from './Enemy.js';
/* The prompt says the key the player actually has bound — see `focusKeyLabel`. */
import { keyLabel, codesFor, loadBindings } from '../engine/Bindings.js';
import {
  PAINTS, PAINT_SLOTS, KIT_FIELDS, paintById, wearableFor, bodyOptsFor,
} from './Bodies.js';
import { cuePaint, cueAttach, cueDetach, cueName } from './DeckAudio.js';
import { liftKey } from './DeckLift.js';
import { smoothstep } from '../engine/MathUtil.js';

/* ── the numbers ──────────────────────────────────────────────────────── */

/**
 * How near you have to be to pick a man, in metres.
 *
 * This is the close-focus framing, expressed as the only thing that can compose
 * a shot without taking the camera: at 6 m a man is about a fifth of the frame
 * at the deck's 60° lens and you can read his mark; past it the pick refuses
 * and the line is a line. It is deliberately shorter than the interval between
 * two files (`MUSTER.interval` is 2.1 m) is long, so "walk up to the man you
 * mean" is a real instruction rather than a formality.
 */
export const REACH = 6.0;

/** How far out of the line he steps. `Menu._stagePick`'s own 0.55, in metres. */
export const STEP_OUT = 0.55;

/** How long the step out takes, in and out. A pace, not a slide. */
const STEP_TIME = 0.42;

/**
 * THE WASH.
 *
 * 0.8 s is the middle of the 0.6–1.0 s the brief asks for and it is also what
 * the CUE is: `cuePaint` is 0.62 s of atomised noise rising 900 → 3400 Hz "as
 * the spray crosses the plate", with the settle landing at 0.50. A wash that
 * finished before the can stopped hissing would be two events, so the paint
 * lands 0.18 s after the spray does — which is a settle, and is what the low
 * body under the cue is already there for.
 *
 * `soft` is how tall the wet edge is, in metres: under about 6 cm the boundary
 * reads as a hard line crawling up the armour rather than as a wash, and over
 * about 25 cm there is no edge left to see on a 1.8 m man.
 */
export const SWEEP = { dur: 0.8, soft: 0.14 };

/**
 * HOW LONG THE WHEEL HAS TO SETTLE BEFORE A NOTCH IS A CHANGE.
 *
 * The list is ninety options long on a clone trooper, and applying every notch
 * as it went past would write the save ninety times, start ninety washes, and —
 * once the cursor reached the kit rows — rain ninety plates onto the man from
 * off-frame. A wheel spun through a palette is ONE decision with a lot of
 * frames in it.
 *
 * 0.22 s: longer than the gap between notches of a single flick (a mouse wheel
 * reports every 15–40 ms while it is being turned) and shorter than the pause
 * between two deliberate ones, so a spin commits once at the end and a single
 * click commits at once.
 */
const WHEEL_DWELL = 0.22;

/**
 * THE PART COMING IN.
 *
 * "Attachment parts physically drop in from off-frame or are handed over by a
 * droid." It is the drop and not the droid, for one reason: `DeckLife.js` owns
 * the droids and is another agent's file this week, so a hand-over would be a
 * cross-file appointment. A part that falls in from above the top of the frame
 * is the same sentence with nothing to negotiate.
 *
 * `from` is how far above the man it starts — above 4 m it is out of frame for
 * anyone standing inside `REACH` of him, which is the whole of "off-frame".
 */
export const DROP = { from: 4.6, side: 0.55, fall: 0.62, lift: 0.5 };

/**
 * WHAT MAY BE CHANGED, AND IT IS THE MENU'S OWN LIST.
 *
 * Every one of these is a field of the `look` object `Menu._wireCompanyEdits`
 * and `Menu._wireDressing` pass to `Company.dress` — callsign from the name
 * field, mark and band from the two swatch rows, paint and kit from
 * `_wireDressing`. `deckedit.mjs` reads that same set back out of `Menu.js`'s
 * source and asserts equality, so the two surfaces cannot drift apart without
 * a check going red. The three verbs in the brief map onto it as: rename is
 * `callsign`, paint is `mark`/`band`/`paint`, attach is `kit`.
 */
export const EDIT_OPS = ['callsign', 'mark', 'band', 'paint', 'kit'];

/** The ops whose change is a COLOUR, and therefore washes rather than pops. */
const PAINT_OPS = new Set(['mark', 'band', 'paint']);

/* ── scratch ──────────────────────────────────────────────────────────── */

const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _box = new THREE.Box3();
const _p3 = new THREE.Vector3();
const _col = new THREE.Color();
const FWD = new THREE.Vector3(0, 0, -1);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  STATE                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The deck's edit state, made on first use.
 *
 * Hung off the world rather than held at module scope for the reason every
 * other deck module gives: two Worlds exist at once in the checks, and a module
 * that remembers which man is selected would have them share one.
 */
export function editState(world) {
  if (!world) return null;
  if (!world._deckEdit) {
    world._deckEdit = {
      /** The selected row of `world._company.men`, or null. */
      held: null,
      /** Company-clock seconds at which he was selected. */
      at: 0,
      /** 0..1 of the step out of the line. */
      step: 0,
      /** The man still walking back to his mark after a deselect, or null. */
      going: null,
      /** Running washes: `{ row, mats, from, to, at, lo, hi }`. */
      sweeps: [],
      /** Parts in the air: `{ row, mesh, at, dur, from, to, then }`. */
      drops: [],
      /** Where the wheel is in `optionsFor(row)`. */
      cursor: 0,
      /** The option the wheel is sitting on, not yet committed. */
      pending: null,
      /** Free-text rename in progress, or null. See `beginNaming`. */
      naming: null,
      /** Edits applied since the room opened — what `leaveDeck` reports. */
      writes: 0,
      /** The company clock this layer was last stepped on. See `stepDeckEdit`. */
      steppedAt: -1,
    };
  }
  return world._deckEdit;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  1. THE PICK                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ A RAY DOWN THE CROSSHAIR, AND THE FIRST ONE IN THE ROOM ═══════════════
 *
 * There was no raycast of any kind in the hangar. This is `Menu._stagePick`
 * moved into the world and pointed the other way, deliberately assertion for
 * assertion: a ray, a `Box3` per figure, `ray.intersectBox`, nearest wins. Two
 * differences and both are forced by the room rather than chosen:
 *
 *   THE RAY IS THE CROSSHAIR'S, not a mouse position's. There is no cursor on
 *   a pointer-locked deck. `CameraRig` publishes `pos` (where the lens ended
 *   up) and `aimQuat` (where it is pointed) every frame, and in BOTH view modes
 *   the screen centre is `pos` plus the aim's forward — third person composes
 *   `look = anchor + fwd*6` off the same quaternion, so the line through the
 *   middle of the frame is the same line. No branch on `firstPerson`.
 *
 *   IT IS BOUNDED BY `REACH`. The menu's stage has ten men in a box; this room
 *   has a company down a 25 m line, and a ray that reached all of it would let
 *   you inspect a man forty metres away, which is the close-focus bullet
 *   answered by a sniper scope.
 *
 * BOXES AND NOT TRIANGLES, which is `_stagePick`'s choice and is not laziness:
 * these are `THREE.SkinnedMesh`es whose triangles live in bind pose and are
 * moved by the skeleton on the GPU. `Raycaster` against a skinned mesh either
 * tests the bind pose — a man standing where he was baked, not where he is —
 * or pays a full CPU skin per ray. A box around the figure is both correct and
 * free, and a man is very nearly a box.
 */
export function pickMan(world, opts = {}) {
  const c = world?._company;
  if (!c || !c.men.length) return null;
  if (!rayFrom(world, opts, _o, _dir)) return null;
  const reach = opts.reach ?? REACH;
  const ray = new THREE.Ray(_o.clone(), _dir.clone());
  let hit = null, best = Infinity;
  for (const row of c.men) {
    const root = row.fig?.root;
    if (!root) continue;
    /* THE BOX IS THE FIGURE'S, TAKEN AT THE MOMENT OF THE PICK. A pick is a
     * keypress and there are at most `MAX_ON_DECK` of these, so the cost is
     * one walk of two dozen bodies once — against caching a box per man, which
     * would have to be invalidated by the walk-on, the step-out, a shove and a
     * rebuild, and would be wrong on whichever of those was forgotten. */
    /* THE MAN IS HIS SKELETON. A deck figure is drawn as its merged skin
     * (`mergeFigure`) with the source meshes hidden, and a skinned mesh's CPU
     * bounds are its bake-time bounds — baked in the crowd, so once the
     * company had really WALKED to the line `Box3.setFromObject(root)` ran
     * every man's box 50 m back to the wall and the pick took the file beside
     * him. The bones are where he is this frame, whatever is drawn on them. */
    _box.makeEmpty();
    const rig = row.fig?.rig;
    if (rig?.list?.length) {
      root.updateWorldMatrix(true, true);
      for (const b of rig.list) { if (b.obj) _box.expandByPoint(b.obj.getWorldPosition(_p3)); }
      _box.expandByScalar(0.34);
    } else {
      _box.setFromObject(root);
    }
    if (_box.isEmpty()) continue;
    if (!ray.intersectBox(_box, _hit)) continue;
    /* MEASURED FROM THE MAN'S FEET TO THE PLAYER'S, not along the ray from the
     * lens: in third person the boom is 3 m behind the player's head, so a ray
     * distance would let him pick a man he is standing three metres further
     * from than he thinks he is. */
    const from = playerAt(world, _p) ? _p.distanceTo(root.position) : ray.origin.distanceTo(_hit);
    if (from > reach) continue;
    const d = _hit.distanceToSquared(ray.origin);
    if (d < best) { best = d; hit = row; }
  }
  return hit;
}

/** The crosshair's ray, or false if there is nobody looking down one. */
function rayFrom(world, opts, o, dir) {
  if (opts.from && opts.dir) {
    o.copy(opts.from); dir.copy(opts.dir).normalize();
    return dir.lengthSq() > 0.5;
  }
  const rig = world?.player?.camera;
  if (!rig?.pos || !rig?.aimQuat) return false;
  o.copy(rig.pos);
  dir.copy(FWD).applyQuaternion(rig.aimQuat).normalize();
  return true;
}

/** Where the player's boots are, for the reach test. */
function playerAt(world, out) {
  const p = world?.player?.position;
  if (!p) return false;
  out.copy(p);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  2. THE FOCUS                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ HE BREAKS ATTENTION, TURNS, SALUTES, AND HOLDS ════════════════════════
 *
 * Every part of this is `Parade.js`'s and none of it is new. What was missing
 * was a caller, and one detail the parade could not supply on its own: the
 * HOLD. `TURN.total` is 2.43 s and `SALUTE.total` is 2.56 — both sequences
 * unwind by themselves, which is right for a company saluting on an order and
 * wrong for a man being looked at. `stepDeckEdit` therefore RE-ARMS both while
 * he is held, each time the sequence has come far enough into its own plateau
 * that restarting it cannot be seen. Two lines, and the drill's numbers stay
 * the drill's rather than being retyped as a third pose.
 *
 * `turnTo` resolves the point to a yaw ONCE, which its note explains is
 * deliberate — a target that moves while a man is turning to it drags his feet
 * round with it. So the re-arm re-resolves against where the player is STANDING
 * NOW: walk round him while he holds and he tracks you in whole turns, which is
 * what a man at attention actually does, rather than swivelling.
 */
export function holdMan(world, row) {
  const st = editState(world);
  const c = world?._company;
  if (!st || !c || !row) return null;
  if (st.held === row) return row;
  if (st.held) {
    releaseMan(world);
    /* THE MAN YOU HAD IS PUT BACK AT ONCE rather than walked back. There is one
     * `step` for the whole layer and it belongs to whoever is held now; the
     * only thing that would be watching the old man's pace is the new one. */
    if (st.going?._deckHome) st.going.fig.root.position.copy(st.going._deckHome);
    st.going = null;
  }
  st.held = row;
  st.going = null;
  /* FROM THE LINE, not from wherever the last man's pace had got to. */
  st.step = 0;
  st.at = c.t;
  st.cursor = 0;
  /* HIS MARK, REMEMBERED BEFORE HE LEAVES IT. `stepCompany` writes a halted
   * man's position exactly once, on the frame he halts, and never again — so
   * from here on this file owns where he stands and has to be able to put him
   * back. */
  if (!row._deckHome) row._deckHome = row.fig.root.position.clone();
  /* AND THE DIRECTION HE STEPS, FIXED NOW rather than read every frame. A pace
   * whose bearing is recomputed against a player who is walking round the line
   * is a man sliding sideways on his mark — the same ice-skate `turnTo`'s note
   * refuses for the same reason. */
  row._deckOut = new THREE.Vector3(0, 0, -1);
  if (playerAt(world, _p)) {
    _dir.set(_p.x - row._deckHome.x, 0, _p.z - row._deckHome.z);
    if (_dir.lengthSq() > 1e-4) row._deckOut.copy(_dir.normalize());
  }
  faceThePlayer(world, row, true);
  /* THE PAINT PROBE, PAID FOR HERE. `paintSlots` builds one throwaway body per
   * archetype to find out which material each paint slot lands on, and doing
   * it lazily on the first swatch would put that build on the frame the player
   * turns the wheel. Selecting a man is already a frame with a body stepping
   * out of a line on it, and the answer is cached for the session. */
  paintSlots(row.rec.type, row.rec.kind === 'steel' ? 'steel' : 'flesh');
  tag(world, nameOf(row.rec), 'stood out of the line');
  return row;
}

/**
 * …AND THE DESELECT IS A SNAP, which is the bullet.
 *
 * `man.turn = null` and `man.saluteAt = null` are read by `turnState` and
 * `saluteAmount` on the very next `poseParade`, both of which return zero for
 * an absent sequence — so the pose is back at attention on the following frame
 * with no blend at all. That is not a shortcut standing in for a transition, it
 * IS the transition the brief asks for: "returns him to attention with a snap."
 * The only thing that eases is his walk back to his mark, because a man
 * teleporting 0.55 m sideways is a different sentence.
 */
export function releaseMan(world) {
  const st = editState(world);
  const row = st?.held;
  if (!row) return null;
  /* A CHANGE DIALLED AND NOT YET SETTLED IS STILL A CHANGE. Putting the man
   * down half a beat after the last notch must not throw it away. */
  if (st.pending) commitWheel(world);
  row.man.turn = null;
  row.man.saluteAt = null;
  st.held = null;
  /* He is not back on his mark yet — the snap is the POSE, the pace back is a
   * pace. `stepDeckEdit` walks him in and drops this when he arrives. */
  st.going = row;
  st.naming = null;
  detachKeys(st);
  tag(world, null);
  return row;
}

/** Aim him at where the player is standing, and start (or hold) the salute. */
function faceThePlayer(world, row, fresh) {
  const c = world._company;
  const man = row.man;
  const t = c.t + stagger(man);
  if (playerAt(world, _p)) {
    /* IN THE FIGURE'S OWN FRAME, which is what `turnTo` documents it wants —
     * `poseParade` works entirely in the rig's frame and converts at the three
     * boundaries that need world. `worldToLocal` needs the root's matrix to be
     * current and `poseParade` refreshes it every frame, so this is reading the
     * same matrix the pose will use. */
    row.fig.root.updateWorldMatrix(true, false);
    row.fig.root.worldToLocal(_p);
    turnTo(man, _p, fresh ? t : t - TURN.swing);
  }
  /* THE SALUTE COMES IN BEHIND THE SHOULDERS, not with them. `TURN.swing` is
   * 0.46 s and a hand that starts up while the body is still turning reads as a
   * wave; the drill is turn, halt, salute. */
  if (fresh) salute(man, t + TURN.swing);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  3. THE ONE INPUT DOOR                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ SELECT, OR PUT HIM DOWN ═══════════════════════════════════════════════
 *
 * The whole of the deck's new input surface, so that `Player.js` — which is not
 * this work's file and is an ALLOW-LIST of exactly eight actions — grows by one
 * line and no judgement.
 *
 * `focus` is the action it is wired to, and it is not a new key. On a
 * battlefield `focus` slows time; on a deck there is no time to slow, the
 * binding is Mouse3 (which is where "click the thing I am looking at" is
 * actually pressed), and the word already means what this does. A new row in
 * `Bindings.js` would have to find a free key in a table where every letter
 * within reach of WASD is spoken for twice over — `controls.mjs` has caught
 * three separate attempts at that — and would buy nothing.
 *
 * Pressing it with a man already held puts him down, whatever the crosshair is
 * on. That is the same "press it again" the menu's own `_stagePick` has
 * (`keyOf === this._companyKey ? null : keyOf`), and it means the player never
 * has to find an empty patch of deck to deselect.
 */
export function focusKey(world) {
  /* THE LIFT FIRST. The same key at the lobby doors calls the car or steps
   * into it; `liftKey` answers true only when it spent the press, so a man
   * standing beside the doors can still be picked. */
  if (liftKey(world)) return null;
  const st = editState(world);
  if (!st) return null;
  if (st.held) { releaseMan(world); return null; }
  const row = pickMan(world);
  if (!row) return null;
  return holdMan(world, row);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  4. THE EDIT SURFACE                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * EVERY CHANGE THIS MAN CAN TAKE, AS ONE FLAT LIST.
 *
 * Derived from `wearableFor`, `PAINT_SLOTS`, `PAINTS` and `KIT_FIELDS` — the
 * same four tables `Menu._dressingHtml` builds its rows out of — so a swatch
 * added to the game appears on both surfaces or on neither. The menu draws them
 * as a grid because it has a page; the deck has a wheel, so they are one
 * sequence.
 *
 * The mark and the band lead, because they are the two things a line is read by
 * and the two a player reaches for first when standing in front of one man.
 */
export function optionsFor(row) {
  const rec = row?.rec;
  if (!rec) return [];
  const kind = rec.kind === 'steel' ? 'steel' : 'flesh';
  const can = wearableFor(rec.type, kind);
  const out = [];
  for (const m of MARKS) out.push({ op: 'mark', value: m.id, label: `Mark — ${m.name}` });
  for (const m of MARKS) out.push({ op: 'band', value: m.id, label: `Band — ${m.name}` });
  for (const [field] of (PAINT_SLOTS[kind] || []).filter(([f]) => can.paint.includes(f))) {
    out.push({ op: 'paint', field, value: null, label: `${field} as issued` });
    for (const p of PAINTS) out.push({ op: 'paint', field, value: p.id, label: `${field} ${p.name}` });
  }
  for (const field of can.kit) {
    const row2 = KIT_FIELDS[kind][field];
    if (!row2) continue;
    for (const [v, label] of row2.values) out.push({ op: 'kit', field, value: v, label: `${row2.name} ${label}` });
  }
  return out;
}

/**
 * ══ THE WHEEL ═════════════════════════════════════════════════════════════
 *
 * One notch, one change, applied live. The deck already claims the wheel
 * unconditionally in `Player`'s hosting branch ("the notch can simply BE the
 * grip's distance control"), and while a man is held there is nothing gripped
 * for it to collide with — so this is the second half of a claim that was
 * already made, not a new one.
 *
 * @returns true if the notch was spent here, so the caller can stop it also
 *          moving a crate.
 */
export function wheelEdit(world, notches) {
  const st = editState(world);
  if (!st?.held || !notches) return false;
  const list = optionsFor(st.held);
  if (!list.length) return false;
  st.cursor = ((st.cursor + Math.sign(notches)) % list.length + list.length) % list.length;
  const o = list[st.cursor];
  /* DIALLED NOW, APPLIED WHEN THE WHEEL STOPS. See `WHEEL_DWELL`. */
  st.pending = { ...o, at: world._company.t };
  tag(world, nameOf(st.held.rec), `${o.label} …`);
  return true;
}

/** Apply whatever the wheel is sitting on. Idempotent; a no-op with nothing dialled. */
export function commitWheel(world) {
  const st = world?._deckEdit;
  const o = st?.pending;
  if (!o || !st.held) { if (st) st.pending = null; return null; }
  st.pending = null;
  const look = applyEdit(world, o.op, o.field ? { [o.field]: o.value } : o.value);
  tag(world, nameOf(st.held.rec), o.label);
  return look;
}

/**
 * ══ WRITE, THEN WEAR ══════════════════════════════════════════════════════
 *
 * `Company.dress` FIRST and the body second, which is the order
 * `Menu._wireCompanyEdits` uses and its note explains: the store validates —
 * a mark id from an older build, a callsign with a quote in it — and can
 * legitimately answer with something other than what was asked for. A surface
 * that painted first would be showing the player a choice the save refused.
 *
 * `paint` and `kit` are sent as a WHOLE object for the same reason the menu
 * sends them that way: `saneLook` writes the whole set, so clearing a slot has
 * to be the same call as choosing one or the store can hold a half-written kit.
 * The deck therefore merges the one field it is changing over what the man is
 * already wearing.
 *
 * @param op    one of `EDIT_OPS`.
 * @param value the new value — a string for `callsign`, a mark id for
 *              `mark`/`band`, and a `{field: value}` patch for `paint`/`kit`.
 * @returns the written `look`, or null if nothing was written.
 */
export function applyEdit(world, op, value, opts = {}) {
  const st = editState(world);
  const c = world?._company;
  const row = opts.row || st?.held;
  if (!c || !row || !EDIT_OPS.includes(op)) return null;
  const army = c.army;
  const key = row.rec.designation;
  const kind = row.rec.kind === 'steel' ? 'steel' : 'flesh';

  const was = { ...(row.rec.look || {}) };
  let patch;
  if (op === 'paint' || op === 'kit') {
    const whole = { ...(was[op] || {}) };
    for (const f in value) {
      if (value[f] === null || value[f] === undefined) delete whole[f];
      else whole[f] = value[f];
    }
    patch = { [op]: whole };
  } else {
    patch = { [op]: value };
  }

  /**
   * THE ONE DOOR PER STORE. A man on the roll is dressed through
   * `Company.dress`; a recruit who has never fielded is on the muster SLATE
   * and is dressed through `Muster.dressRecruit` — the same two doors the
   * Company tab uses. Before this the deck knew only the roll, so on a fresh
   * save (every man a recruit) every wheel notch wrote nothing and said so to
   * nobody: `dress` returns the unchanged roll for a designation it does not
   * hold, `man` came back undefined, and this returned null.
   */
  const written = row.rec.recruit
    ? { men: (dressRecruit(army, key, patch)?.recruits || []) }
    : companyDress(army, key, patch);
  const man = (written?.men || []).find((m) => m.designation === key);
  if (!man) return null;
  const look = man.look || null;
  row.rec.look = look;
  st.writes++;

  if (PAINT_OPS.has(op)) wearPaint(world, row, op, was, look, kind);
  else if (op === 'kit') wearKit(world, row, value);
  else cue(cueName, world, row);
  return look;
}

/** `applyEdit`'s three verbs, named the way the brief names them. */
export const renameMan = (world, text, opts) => applyEdit(world, 'callsign', text, opts);
export const paintMan = (world, field, paintId, opts) =>
  applyEdit(world, 'paint', { [field]: paintId }, opts);
export const attachPart = (world, field, value, opts) =>
  applyEdit(world, 'kit', { [field]: value }, opts);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  5. THE WASH                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which of the figure's materials a paint field actually lands on, DERIVED.
 *
 * `PAINT_SLOTS.flesh` is `[['color','Plate'], ['accent','Unit flash'],
 * ['visor','Visor']]` and `buildTrooper` returns `palette: { plate, under,
 * accent, visor, gear, scorch }`. The mapping between the two is obvious to a
 * reader and is nowhere in the tree, and typing it here would be the
 * hand-maintained twin this repository has been bitten by nine times —
 * `_source.mjs`'s header counts them.
 *
 * So it is MEASURED instead, once per archetype: build one throwaway body with
 * each paint option set to a colour nothing else uses, and see which palette
 * material comes out wearing it. A builder that renames a material, adds a
 * slot or stops reading one is followed automatically, and a slot no builder
 * reads answers `null` and is honestly reported as un-washable rather than
 * silently painting nothing. `wearableFor`'s own table was built by exactly
 * this experiment, run by hand.
 */
const SENTINEL = 0x010203;
const _slotCache = new Map();
function paintSlots(type, kind) {
  const ck = `${type}/${kind}`;
  if (_slotCache.has(ck)) return _slotCache.get(ck);
  const out = {};
  const A = ARCHETYPES[type];
  const fields = (PAINT_SLOTS[kind] || []).map(([f]) => f);
  for (const field of fields) {
    let key = null;
    try {
      const built = A?.build?.({
        scale: A.scale ?? 1, ...(bodyOptsFor(type) || {}), [field]: SENTINEL,
      });
      for (const k in (built?.palette || {})) {
        const m = built.palette[k];
        if (m?.color?.getHex?.() === SENTINEL) { key = k; break; }
      }
      built?.rig?.dispose?.();
    } catch { key = null; }
    out[field] = key;
  }
  _slotCache.set(ck, out);
  return out;
}

/**
 * ══ WHAT A PAINT CHANGE TOUCHES, AND WHAT IT IS BECOMING ═══════════════════
 *
 * Two kinds of entry, because the room has two kinds of paint:
 *
 *   A MATERIAL ENTRY `{ mat, from, to }` — a paint slot (plate, unit flash,
 *   visor, a droid's shell) recolours a whole material, and the wash carries
 *   `mat.color` from one colour to the other. Vertices the rank, the mark or
 *   the band have PAINTED on that material are left alone by it: their colour
 *   is the paint's, not the plate's, and `CommandDirector.renewPaint` re-fits
 *   them to the new plate when the edge has passed.
 *
 *   A VERTEX ENTRY `{ vertex, slot, geos }` — a mark or a band is per-vertex
 *   colour in the plate's own channel (src/game/Command.js `PAINT`), so the
 *   wash carries every painted VERTEX from what it was to what the brush
 *   wrote, and the mark washes ON — out of the bare plate the first time,
 *   out of the old colour on a change, and back to bare plate when it is
 *   dialled off. The channel follows the edge as it goes, so the source
 *   geometry and the merged buffer agree on every frame and a re-bake
 *   mid-wash could reproduce the frame.
 */

/** A copy of the colour channel of every geometry a paint record touched. */
function snapshotChannels(rec) {
  const out = new Map();
  if (!rec?.geos) return out;
  for (const [geo] of rec.geos) {
    const col = geo.attributes.color;
    if (col && !out.has(geo)) out.set(geo, Float32Array.from(col.array));
  }
  return out;
}

/** Per geometry, which vertices any of the three paint records own. */
function paintedMask(stub) {
  const mask = new Map();
  for (const key of ['_cmdPaint', '_cmdMark', '_cmdBand']) {
    const rec = stub?.[key];
    if (!rec?.geos) continue;
    for (const [geo, g] of rec.geos) {
      let m = mask.get(geo);
      if (!m) mask.set(geo, (m = new Uint8Array(g.count)));
      for (let k = 0; k < g.idx.length; k++) m[g.idx[k]] = 1;
    }
  }
  return mask;
}

/** The live materials a paint change touches, and what they are becoming. */
function wearPaint(world, row, op, was, look, kind) {
  const entries = [];
  const stub = row.fig?._stub;
  if (op === 'mark' || op === 'band') {
    if (!stub) { cue(cuePaint, world, row); return; }
    const key = op === 'mark' ? '_cmdMark' : '_cmdBand';
    const to = markById(look?.[op])?.color;
    const old = stub[key];
    /* THE CHANNEL AS HE WEARS IT, taken before the brush moves: a re-coloured
     * mark puts the bare plate back and paints again, so its record's `orig`
     * is the plate and not the colour he had on a moment ago. */
    const snap = snapshotChannels(old);
    let rec = null, clear = false;
    if (to == null) {
      /* DIALLED OFF. The wash runs the other way — back to what was under
       * the paint — and the record is dropped when the edge has cleared him. */
      if (!old) { cue(cuePaint, world, row); return; }
      rec = old; clear = true;
    } else {
      const fn = op === 'mark' ? CommandDirector.prototype.markUp : CommandDirector.prototype.bandUp;
      fn.call(null, stub, to);
      rec = stub[key];
    }
    if (rec?.geos) {
      const geos = new Map();
      const mats = new Set();
      for (const [geo, g] of rec.geos) {
        const col = geo.attributes.color;
        if (!col || col.count !== g.count) continue;
        const n = g.idx.length;
        const from = new Float32Array(n * 3), toArr = new Float32Array(n * 3);
        const prev = snap.get(geo);
        for (let k = 0; k < n; k++) {
          const i = g.idx[k], o = k * 3;
          if (prev) { from[o] = prev[i * 3]; from[o + 1] = prev[i * 3 + 1]; from[o + 2] = prev[i * 3 + 2]; }
          else { from[o] = g.orig[o]; from[o + 1] = g.orig[o + 1]; from[o + 2] = g.orig[o + 2]; }
          if (clear) { toArr[o] = g.orig[o]; toArr[o + 1] = g.orig[o + 1]; toArr[o + 2] = g.orig[o + 2]; }
          else { toArr[o] = col.getX(i); toArr[o + 1] = col.getY(i); toArr[o + 2] = col.getZ(i); }
          /* And the channel starts where the wash starts, or the first
           * frame is the answer — which is the pop this whole section is
           * here to refuse. */
          col.setXYZ(i, from[o], from[o + 1], from[o + 2]);
        }
        col.needsUpdate = true;
        mats.add(g.mat);
        geos.set(geo, { mat: g.mat, idx: g.idx, from, to: toArr });
      }
      if (geos.size) entries.push({ vertex: true, slot: op, clear, geos, mats: [...mats] });
    }
  } else {
    const slots = paintSlots(row.rec.type, kind);
    const pal = row.fig.palette || {};
    for (const field in slots) {
      const key = slots[field];
      const mat = key ? pal[key] : null;
      if (!mat?.color) continue;
      const now = paintById(look?.paint?.[field])?.color;
      const then = paintById(was?.paint?.[field])?.color;
      if (now === then) continue;
      /* AS ISSUED IS NOT A COLOUR. Clearing a slot puts the chassis' own back,
       * and the only place that number still exists is the material as it was
       * built — so a cleared slot washes back to whatever the figure had
       * before the player ever touched it, remembered on the material itself
       * the first time it is painted. */
      if (mat.userData.deckIssued === undefined) mat.userData.deckIssued = mat.color.getHex();
      entries.push({
        mat,
        from: mat.color.clone(),
        to: new THREE.Color(now ?? mat.userData.deckIssued),
      });
    }
  }
  cue(cuePaint, world, row);
  if (entries.length) startSweep(world, row, entries);
}

/** Every material an entry moves, for telling two washes apart. */
const matsOf = (e) => (e.vertex ? e.mats : [e.mat]);

/** Arm a wash over this man, bottom to top. */
function startSweep(world, row, entries) {
  const st = editState(world);
  const c = world._company;
  /* THE FIGURE'S OWN HEIGHT, off the parade measurements rather than typed:
   * `hip` is the gait solver's standing hip and a man is very close to twice
   * it plus his head, which is the number the wash has to cross. A species
   * frame at another scale therefore washes over the whole of itself. */
  const hi = (row.man?.hip || 0.95) * 1.95;
  /* Drop any wash already running on the same materials, or two edges cross
   * and the second one paints back over the first's `from`. */
  const mats = entries.flatMap(matsOf);
  st.sweeps = st.sweeps.filter((s) => s.row !== row || !s.mats.some((m) => mats.includes(m)));
  st.sweeps.push({
    row,
    mats,
    entries,
    /* Which vertices are paint rather than plate, so a plate wash goes round
     * them. Taken now: the records do not change under a running wash. */
    mask: paintedMask(row.fig?._stub),
    at: c.t,
    lo: -SWEEP.soft,
    hi: hi + SWEEP.soft,
  });
}

/** Write a vertex entry's channel at blend `k` (0 = from, 1 = to), flat. */
function writeVertexEntry(e, k) {
  for (const [geo, g] of e.geos) {
    const col = geo.attributes.color;
    if (!col || col.count < g.idx.length) continue;
    for (let i = 0; i < g.idx.length; i++) {
      const o = i * 3;
      col.setXYZ(g.idx[i],
        g.from[o] + (g.to[o] - g.from[o]) * k,
        g.from[o + 1] + (g.to[o + 1] - g.from[o + 1]) * k,
        g.from[o + 2] + (g.to[o + 2] - g.from[o + 2]) * k);
    }
    col.needsUpdate = true;
  }
}

/** Hand a geometry's channel to the merged buffer: `mat.color × channel`, on the vertices given. */
function syncVertices(skin, geo, g) {
  for (let i = 0; i < skin.meshes.length; i++) {
    const col = skin.meshes[i].geometry.attributes.color;
    let start = 0;
    for (const src of skin.sources[i]) {
      const count = src.geometry.attributes.position.count;
      if (src.geometry === geo) {
        const c = src.material.color, ch = geo.attributes.color;
        for (let k = 0; k < g.idx.length; k++) {
          const v = g.idx[k];
          col.setXYZ(start + v, c.r * ch.getX(v), c.g * ch.getY(v), c.b * ch.getZ(v));
        }
        col.needsUpdate = true;
        return;
      }
      start += count;
    }
  }
}

/**
 * ONE FRAME OF A WASH.
 *
 * The edge is a height in the figure's own frame; `k` is where it has got to.
 * The merged buffer is written per vertex, the unmerged material per material,
 * and the last frame hands the final colour to the SOURCE material and lets
 * `MergedSkin.paint()` write the buffer — so the state the sweep leaves behind
 * is one the shipped path produced and can reproduce.
 */
function stepSweep(world, s, t) {
  const u = (t - s.at) / SWEEP.dur;
  const done = u >= 1;
  const skin = s.row.merged?.skin || null;
  const stub = s.row.fig?._stub;
  if (done) {
    for (const e of s.entries) {
      if (e.vertex) {
        writeVertexEntry(e, 1);
        if (e.clear) CommandDirector.prototype.unpaint.call(null, stub, e.slot);
      } else {
        e.mat.color.copy(e.to);
      }
    }
    /* The paint re-fitted to the plate it now sits on, THEN the buffer:
     * `syncPaint` follows a material whose colour moved and reads the
     * channel as it is, so the order is what makes a painted vertex come out
     * as the paint and not as `want × new ÷ old`. */
    if (s.entries.some((e) => !e.vertex)) CommandDirector.prototype.renewPaint.call(null, stub);
    s.row.merged?.paint?.();
    if (skin) for (const e of s.entries) if (e.vertex) for (const [geo, g] of e.geos) syncVertices(skin, geo, g);
    return true;
  }
  const k = smoothstep(0, 1, Math.max(0, u));
  const edge = s.lo + (s.hi - s.lo) * k;
  if (!skin) {
    /* NOT MERGED YET — he is still walking on. Same clock, same easing, no
     * spatial edge, because there is no shared buffer to write one into. */
    for (const e of s.entries) {
      if (e.vertex) writeVertexEntry(e, k);
      else e.mat.color.copy(e.from).lerp(e.to, k);
    }
    return false;
  }
  /* A material that is in no span of the merged skin — nothing a figure
   * wears today, since every paint is in the bake, but tracked rather than
   * assumed — takes the same clock as a colour ramp. */
  const painted = new Set();
  for (let i = 0; i < skin.meshes.length; i++) {
    const geo = skin.meshes[i].geometry;
    const col = geo.attributes.color;
    const pos = geo.attributes.position;
    if (!col || !pos) continue;
    let start = 0, dirty = false;
    for (const src of skin.sources[i]) {
      const count = src.geometry.attributes.position.count;
      const e = s.entries.find((x) => !x.vertex && x.mat === src.material);
      if (e) {
        /* THE BAKE IS IN THE RIG ROOT'S FRAME (`buildMergedSkin` multiplies by
         * `rootInv`), so a vertex's y IS its height above the man's boots —
         * which is what the wash is a function of, and needs no transform.
         * The source's own channel rides along — creases, and the paint's
         * neighbours — and the painted vertices themselves are stepped over. */
        const skip = s.mask.get(src.geometry);
        const C = src.material.vertexColors ? src.geometry.attributes.color : null;
        for (let v = 0; v < count; v++) {
          if (skip && skip[v]) continue;
          const a = smoothstep(edge - SWEEP.soft, edge + SWEEP.soft, pos.getY(start + v));
          _col.copy(e.to).lerp(e.from, a);
          if (C) col.setXYZ(start + v, _col.r * C.getX(v), _col.g * C.getY(v), _col.b * C.getZ(v));
          else col.setXYZ(start + v, _col.r, _col.g, _col.b);
        }
        dirty = true;
        painted.add(e.mat);
      }
      for (const x of s.entries) {
        if (!x.vertex || !x.geos.has(src.geometry)) continue;
        const g = x.geos.get(src.geometry);
        const c = g.mat.color, ch = src.geometry.attributes.color;
        for (let j = 0; j < g.idx.length; j++) {
          const v = g.idx[j], o = j * 3;
          const a = smoothstep(edge - SWEEP.soft, edge + SWEEP.soft, pos.getY(start + v));
          const r = g.to[o] + (g.from[o] - g.to[o]) * a;
          const gg = g.to[o + 1] + (g.from[o + 1] - g.to[o + 1]) * a;
          const b = g.to[o + 2] + (g.from[o + 2] - g.to[o + 2]) * a;
          ch.setXYZ(v, r, gg, b);
          col.setXYZ(start + v, c.r * r, c.g * gg, c.b * b);
        }
        ch.needsUpdate = true;
        dirty = true;
      }
      start += count;
    }
    if (dirty) col.needsUpdate = true;
  }
  for (const e of s.entries) {
    if (!e.vertex && !painted.has(e.mat)) e.mat.color.copy(e.from).lerp(e.to, k);
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  6. THE PART COMING IN                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ IT ARRIVES, IT IS NOT REVEALED ════════════════════════════════════════
 *
 * "Attachment parts physically drop in from off-frame."
 *
 * And the honest note, because this is the one bullet with a compromise in it:
 * a pauldron is GEOMETRY, baked onto the bones by `buildTrooper` at build time.
 * It cannot appear on a standing body without that body being built again —
 * there is no runtime attach point in `Bodies.js` and `Bodies.js` is not this
 * work's file. So the rebuild happens, for ONE man, on the frame the falling
 * part reaches his shoulder: the swap is covered by the thing landing on it,
 * which is what a drop-in is for. Rename and paint are genuinely live and
 * rebuild nothing.
 *
 * The part itself is a plate rather than a model of the specific fitting. A
 * wrong-looking pauldron falling in would be worse than a crate: `HANGAR-SPEC`
 * is explicit that one wrong-faction asset kills the illusion, and a
 * hand-modelled twin of every kit option is the maintained-copy defect again.
 */
function wearKit(world, row, patch) {
  const st = editState(world);
  const c = world._company;
  /* WHICH WAY THE PART IS TRAVELLING, off the value rather than off a count:
   * every "none" in `KIT_FIELDS` is `null` or `false` and every fitting is a
   * string or `true`, so a pauldron moved from the left shoulder to the right
   * is an attach and stripping the bells is a detach — which counting the keys
   * either side of the write gets wrong in both directions. */
  const off = Object.values(patch || {}).every((v) => v === null || v === undefined || v === false);
  const mesh = partProxy(row);
  const top = row.fig.root.position.clone();
  top.y += DROP.from;
  top.x += DROP.side;
  const shoulder = row.fig.root.position.clone();
  shoulder.y += (row.man?.hip || 0.95) * 1.55;
  mesh.position.copy(off ? shoulder : top);
  world.scene?.add(mesh);
  st.drops.push({
    row,
    mesh,
    at: c.t,
    dur: off ? DROP.lift : DROP.fall,
    from: mesh.position.clone(),
    to: off ? top : shoulder,
    off,
    /* THE REBUILD IS THE LANDING, not the keypress. */
    then: () => {
      rebuildRow(world, row);
      cue(off ? cueDetach : cueAttach, world, row);
    },
  });
}

/** A plate, in the deck's own metal. One geometry, one material, per drop. */
function partProxy(row) {
  const s = row.man?.s || 1;
  const g = new THREE.BoxGeometry(0.22 * s, 0.055 * s, 0.17 * s);
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.45, metalness: 0.55 });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

function stepDrop(world, d, t) {
  const u = (t - d.at) / d.dur;
  if (u >= 1) {
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
    d.then();
    return true;
  }
  const k = Math.max(0, u);
  /* FALLING, NOT SLIDING: the drop accelerates and the lift decelerates, so a
   * part coming in has weight and a part coming off is being taken. */
  const e = d.off ? 1 - (1 - k) * (1 - k) : k * k;
  d.mesh.position.lerpVectors(d.from, d.to, e);
  d.mesh.rotation.y = k * 3.1;
  d.mesh.rotation.x = (1 - k) * 0.6;
  return false;
}

/**
 * ONE MAN, BUILT AGAIN, standing exactly where he was.
 *
 * Everything that is a DECISION about him — which way he is turned, whether he
 * is mid-salute, which stance the company is in — is carried across, because
 * those live on the `paradeMan` handle and not on the body. Everything that is
 * a MEASUREMENT is re-derived from the new rig, which is the point of building
 * again. If the build refuses (an archetype the roster no longer has), the old
 * body stays: a man who vanished because his kit changed would be worse than a
 * kit that did not.
 */
function rebuildRow(world, row) {
  const c = world?._company;
  if (!c) return false;
  const old = row.fig;
  const at = old.root.position.clone();
  const ry = old.root.rotation.y;
  const fig = buildFigure(row.rec);
  if (!fig) return false;
  const man = paradeMan(fig.rig, { designation: row.rec.designation || row.rec.name });
  man.facing = row.man.facing;
  man.stance = row.man.stance;
  man.arms = fig.rifle ? row.man.arms : 'sides';
  man.turn = row.man.turn;
  man.saluteAt = row.man.saluteAt;
  fig.root.position.copy(at);
  fig.root.rotation.y = ry;
  world.scene?.add(fig.root);
  row.merged?.dispose?.();
  old.root.removeFromParent();
  old.rig?.dispose?.();
  row.fig = fig;
  row.man = man;
  /* THE GAIT GOES WITH THE RIG. `Hangar.callTheCompany` hangs a
   * `BipedAnimator` on the row to walk him; it was built on the rig that has
   * just been disposed, and a solver writing bones nobody draws is a man who
   * stands still when he is next called. */
  if (row.anim && fig.rig?.get?.('thighL')) {
    row.anim = new (row.anim.constructor)(fig.rig, { scale: fig.rig.scale ?? 1 });
  }
  /* HE IS STANDING STILL, so he is folded again on the same terms
   * `stepCompany` folds him on — 54 meshes into about 7. A man left unmerged
   * because the player changed his pack is 47 draw calls of quiet cost. */
  row.merged = row.halted ? mergeFigure(fig, { castShadow: true }) : null;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  7. THE FRAME                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ ONE FRAME OF THE EDIT LAYER ═══════════════════════════════════════════
 *
 * AFTER `stepCompany`, and the order is load-bearing rather than tidy: that
 * loop calls `poseParade` and then `merged.update(c.t)`, and `update` runs
 * `syncPaint`, which rewrites any span whose SOURCE material has moved. A wash
 * writing the merged buffer before it would be overwritten by a flat colour on
 * the same frame. Running after it means the last word on the buffer is the
 * wash's, every frame, until the wash hands the colour over and lets the
 * shipped path have it.
 */
export function stepDeckEdit(world, dt) {
  const st = world?._deckEdit;
  const c = world?._company;
  if (!st || !c) return;
  const t = c.t;
  /**
   * ONCE A FRAME, WHOEVER CALLS IT.
   *
   * `c.t` advances exactly once per `stepCompany`, so it is the frame's own
   * identity and a second call inside the same frame is a second call. This is
   * not defensive padding: the layer is driven from `HangarDirector.update`
   * and the checks drive it themselves as well, and a wash stepped twice a
   * frame crosses the man in half the time it is authored to — which would be
   * a real defect measured as a passing test.
   */
  if (st.steppedAt === t) return;
  st.steppedAt = t;

  /* THE WHEEL, ONCE IT HAS STOPPED. */
  if (st.pending && t - st.pending.at >= WHEEL_DWELL) commitWheel(world);

  /* THE HOLD. See `holdMan` — both sequences unwind by themselves and a man
   * being looked at must not. */
  const row = st.held;
  if (row) {
    const mt = t + stagger(row.man);
    const T = row.man.turn;
    if (!T || mt - T.at > TURN.swing + TURN.hold * 0.5) faceThePlayer(world, row, false);
    const S = row.man.saluteAt;
    if (S == null || mt - S > SALUTE.up + SALUTE.hold * 0.6) row.man.saluteAt = mt - SALUTE.up;
  }

  /* THE STEP OUT OF THE LINE, and the pace back into it. `stepCompany` writes
   * a halted man's position on exactly ONE frame — the frame he halts — and
   * never again, so this is the only thing moving him and there is nothing to
   * fight for the write. */
  const on = st.held || st.going;
  if (on?._deckHome) {
    const want = st.held ? 1 : 0;
    const d = want - st.step;
    st.step += Math.sign(d) * Math.min(Math.abs(d), dt / STEP_TIME);
    _p.copy(on._deckHome).addScaledVector(on._deckOut, STEP_OUT * smoothstep(0, 1, st.step));
    on.fig.root.position.x = _p.x;
    on.fig.root.position.z = _p.z;
    if (!st.held && st.step <= 0) {
      on.fig.root.position.copy(on._deckHome);
      st.going = null;
    }
  }

  /**
   * ══ AND THE PROMPT, WHICH IS WHY HE COULD NOT FIND ANY OF THIS ═══════════
   *
   * The player, V13: *"is there a way to customize your troops while you're in
   * the hangar or am I just missing it"*.
   *
   * He was missing it, and there was nothing to find. Everything this file does
   * — walk up to a man, he breaks attention and salutes, the wheel dials his
   * mark, his band, his paint and his kit — was reachable only by pressing a
   * key nobody had been told about while looking at somebody. `tag()` fires the
   * moment a man is HELD, which is one press too late to be a discovery.
   *
   * This is the same `pickMan` the key uses, on a hover, so the answer on the
   * screen and the answer to the press cannot disagree. Anything else — a
   * second raycast, a proximity test — would be a second opinion about who you
   * are looking at.
   *
   * THROTTLED, and that is not a micro-optimisation. `pickMan`'s own note says
   * the walk is affordable because "a pick is a keypress and there are at most
   * MAX_ON_DECK of these" — two dozen bodies, each rebuilding a box out of its
   * bones. Once per keypress is free; sixty times a second is not the same
   * claim, so it runs on every fourth frame, which is 15 Hz against a pointer
   * that moves in tenths of a second.
   */
  if (!st.held) {
    st.hoverTick = (st.hoverTick || 0) + 1;
    if ((st.hoverTick & 3) === 0) {
      const under = pickMan(world);
      const who = under ? nameOf(under.rec) : null;
      if (who !== st.hoverName) {
        st.hoverName = who;
        if (who) tag(world, who, `${focusKeyLabel(world)} to look him over`);
        else tag(world, null, null);
      }
    }
  } else if (st.hoverName) {
    st.hoverName = null;
  }

  for (let i = st.sweeps.length - 1; i >= 0; i--) {
    if (stepSweep(world, st.sweeps[i], t)) st.sweeps.splice(i, 1);
  }
  for (let i = st.drops.length - 1; i >= 0; i--) {
    if (stepDrop(world, st.drops[i], t)) st.drops.splice(i, 1);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  8. LEAVING                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ "EVERYTHING YOU CHANGE IS SAVED ON LEAVING" ═══════════════════════════
 *
 * …and it is saved BEFORE leaving, which is stronger. `Company.dress` ends in
 * `save(c)` and `save` writes localStorage, so every edit is durable the
 * instant it is made — the deck never holds a change that a crash would take.
 * That is deliberate and it is the same guarantee the Company tab gives.
 *
 * So what is left for this door is the one piece of state that is genuinely
 * unwritten: a name being TYPED when the player walks off. It commits, the man
 * is put down, and any wash still crossing him is landed rather than abandoned
 * half-applied on a body about to be disposed.
 *
 * @returns how many edits were made on this visit, for the caller to say so.
 */
export function leaveDeck(world) {
  const st = world?._deckEdit;
  if (!st) return 0;
  if (st.pending) commitWheel(world);
  if (st.naming) commitName(world);
  const c = world?._company;
  if (c) for (const s of st.sweeps) stepSweep(world, s, s.at + SWEEP.dur);
  st.sweeps.length = 0;
  for (const d of st.drops) {
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
    d.then();
  }
  st.drops.length = 0;
  releaseMan(world);
  const n = st.writes;
  st.writes = 0;
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  9. THE RENAME                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ TYPING A NAME IN A ROOM WITH NO CURSOR ════════════════════════════════
 *
 * The other four ops are a wheel notch. A callsign is free text, and free text
 * is the one thing a bindings table cannot express: `Bindings.js` maps a key
 * code to an ACTION, and there is no action whose meaning is "the letter K".
 *
 * So naming reads the keyboard directly, and it is fenced by the two things
 * that make that safe rather than sloppy: it is only ever listening while a man
 * is held AND naming has been armed, and the caller must suppress the deck's
 * own input for the duration — one line in `Player.js`'s hosting branch, which
 * is where every other statement about what the deck's keys mean already lives.
 * Without that line the letters would also walk, so `naming()` is published for
 * exactly that guard and this returns false rather than arming if there is no
 * document to listen to.
 */
export function naming(world) { return !!world?._deckEdit?.naming; }

export function beginNaming(world) {
  const st = editState(world);
  if (!st?.held) return false;
  if (st.naming) { st.naming = null; detachKeys(st); return false; }
  st.naming = { text: st.held.rec.look?.callsign || '' };
  attachKeys(world, st);
  tag(world, `${st.held.rec.designation} —`, `${st.naming.text}_`);
  return true;
}

/** One keystroke of a name. Published so a check can drive it with no DOM. */
export function typeName(world, key) {
  const st = world?._deckEdit;
  if (!st?.naming) return false;
  if (key === 'Enter') { commitName(world); return true; }
  if (key === 'Backspace') {
    st.naming.text = st.naming.text.slice(0, -1);
    tag(world, `${st.held.rec.designation} —`, `${st.naming.text}_`);
    return true;
  }
  /* PRINTABLE ONLY, and the store does the rest: `cleanCallsign` caps the
   * length, collapses the spaces and refuses the five characters that would
   * end up in an `innerHTML`. A second copy of that rule here is a second copy
   * of that rule. */
  if (key.length !== 1) return false;
  st.naming.text += key;
  tag(world, `${st.held.rec.designation} —`, `${st.naming.text}_`);
  return true;
}

export function commitName(world) {
  const st = world?._deckEdit;
  if (!st?.naming) return null;
  const text = st.naming.text;
  st.naming = null;
  detachKeys(st);
  return applyEdit(world, 'callsign', text);
}

function attachKeys(world, st) {
  const d = globalThis.document;
  if (!d?.addEventListener) return;
  st._keys = (e) => {
    if (!st.naming) return;
    e.preventDefault?.();
    typeName(world, e.key);
  };
  d.addEventListener('keydown', st._keys);
}

function detachKeys(st) {
  const d = globalThis.document;
  if (st._keys && d?.removeEventListener) d.removeEventListener('keydown', st._keys);
  st._keys = null;
}

/* ── the cues ─────────────────────────────────────────────────────────── */

/**
 * One-shot, at the man it happened to, guarded twice.
 *
 * `DeckAudio.js` is another agent's file this week and its signatures may move,
 * so the call is optional-chained and wrapped: a cue that has been renamed
 * costs the player a sound, not the edit. `at` is the man's own position
 * because these are positional — a pauldron seating forty metres down the line
 * should be forty metres away.
 */
function cue(fn, world, row) {
  try { fn?.(world, row?.fig?.root?.position ?? null); } catch { /* a sound is not an edit */ }
}

function nameOf(rec) {
  return rec?.look?.callsign ? `${rec.designation} "${rec.look.callsign}"` : (rec?.designation || 'trooper');
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE READOUT                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ SAYING WHICH MAN, AND WHAT JUST HAPPENED TO HIM ═══════════════════════
 *
 * `#deck-tag`, and it exists because `world.notify` CANNOT BE SEEN HERE:
 * `enterHangar` ends in `hud.show(false)`, which puts `hidden` on the whole of
 * `#hud`, and every toast the game raises is inside it. So a player standing in
 * front of twenty-four men in identical armour, turning a wheel that repaints
 * one of them, would have nothing on screen naming which one he had picked or
 * what the last notch did. The free camera's bar is outside `#hud` for exactly
 * this reason and this is beside it.
 *
 * `world.notify` is still called as well, so the sentence is in the event feed
 * for anyone who has the HUD up — this is the second reader of one statement,
 * not a second statement.
 */
/**
 * What the player has bound to `focus`, in the words their own keyboard uses.
 *
 * Asked of `Bindings` rather than typed, because the action is rebindable and a
 * prompt that said "Middle mouse" to somebody who had moved it would be worse
 * than no prompt at all. `keyLabel` is the same reader the HUD and the Codex
 * use, so all three say one thing.
 */
function focusKeyLabel(world) {
  try {
    const b = world?.input?.bindings || loadBindings();
    const dev = world?.input?.lastDevice === 'pad' ? 'pad' : 'key';
    const code = codesFor(b, 'focus', dev)[0];
    return keyLabel(code, 'xbox') || 'Middle mouse';
  } catch { return 'Middle mouse'; }
}

function tag(world, name, note) {
  world?.notify?.(name || '', note || '');
  const d = globalThis.document;
  const el = d?.getElementById?.('deck-tag');
  if (!el) return;
  if (!name) { el.classList.add('hidden'); return; }
  const n = d.getElementById('deck-tag-name');
  const s = d.getElementById('deck-tag-note');
  if (n) n.textContent = name;
  if (s) s.textContent = note || '';
  el.classList.remove('hidden');
}
