/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE COMPANION, ON THE DECK
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "They will be with you in the hangar as well and follow you on/off ships
 *  like they're going to be with you the whole time if you have them"
 *
 * ── TWO REPRESENTATIONS OF ONE RECORD, AND THIS IS THE SETTLED ANSWER ─────
 *
 * The more beautiful answer is one named body in both rooms, and it is
 * REFUSED, for a reason that was verified rather than guessed: **the hangar
 * World deliberately has no CommandDirector** — `World.loadLevel` returns
 * before `this.command` is assigned — because `main.bank()` treats any world
 * with `.command` as a battle and would strike the whole roll on every hangar
 * visit. The deck also has no wave director, no corpse budget and no
 * `pickTarget` context.
 *
 * Putting a live `Enemy` in that room drags `_think`, targeting, the LOD
 * ladder and the death path into a scene built without any of them, in
 * exchange for continuity the player cannot see. The company already solves
 * this the honest way — two representations, one save file — and the Kennel
 * record is the only thing that crosses. Same shape, half the risk.
 *
 * ── WHY IT IS ITS OWN LIST AND NOT A `row` ON THE COMPANY ─────────────────
 *
 * `callTheCompany` cannot build it. `buildFigure` takes a Muster lineup
 * record, `poseParade` is a parade-stance solver off a designation, and the
 * gait is attached only where `fig.rig?.get('thighL')` exists — a humanoid
 * test with no non-humanoid path behind it. A massiff has no `thighL`.
 *
 * So: `world._companionDeck`, one figure, stepped by one `stepCompanionDeck`
 * added to `HangarDirector.update`'s flat ordered list — the pattern DeckLife,
 * DeckLift, DeckMirror, DeckFlight and DeckEdit all already use, and the only
 * hook the room has that is not a body or a prop.
 *
 * ── THE BODY IS POSED BY THE SHIPPED SOLVERS, AND IT WAS NOT ──────────────
 *
 * WHAT THIS HEADER USED TO CLAIM: "walked by a small gait follower off the
 * plan's own published `stance`". **There was no follower.** `grep -rn
 * '\.phase\b' src/` found one line, the write in this file, and no reader
 * anywhere; `stepCompanionDeckLife` touches the head, neck, chest, ribs and
 * the appendage arrays and nothing else. Re-measured on the shipped deck with
 * a massiff adopted and the player dragged 6.18 m: all sixteen leg bones
 * (`hipL0`…`tarsus3`) moved **0.000000 rad** from rest over eight seconds,
 * with `fig.phase` at 13.44 and the head at 0.802 rad. The animal slid across
 * the plates in its bind pose, on the one screen a player stands still and
 * looks at it for minutes. Its own check said so in its preamble and passed
 * anyway, because nothing in it ever read a leg bone.
 *
 * THE FOLLOWER IS NOT WRITTEN HERE EITHER, and that is the point. This file
 * owns WHERE the body is — a mark off your back quarter, a pace, a turn, a
 * sit blend — and hands the pose to whichever solver the FIELD would have
 * used for that skeleton:
 *
 *   `Enemy.prototype._poseWalker`  for anything with `femur{i}` legs, called
 *     on a small duck-typed subject (see `walkerSubject`). Same stance, same
 *     cycle, same two-bone IK, same head clamp, same everything — a second
 *     gait written here would be HANDOFF §2.4's defect, an instrument that
 *     restates a rule and eventually disagrees with it.
 *   `BipedAnimator`               for anything with `thighL`/`shinL`. This is
 *     not a new choice: `Hangar.callTheCompany` routes on exactly that bone
 *     test, and `stepRow` drives it exactly this way — root at identity while
 *     the solver writes world-space bones.
 *
 * `fig.phase` IS the solver's `walkPhase` now, through an accessor, so the
 * field that was written and never read is the one the gait runs on.
 *
 * ── WHY THE ROOT IS AT THE ORIGIN AND `fig.pos` IS WHERE THE ANIMAL IS ────
 *
 * Both solvers write the pelvis in WORLD coordinates onto a bone that is a
 * child of `rig.root` — `BipedAnimator.update` does `hips.position.set(hipX,
 * hipY, hipZ)` and `_poseWalker` does the same off `this.position` — which is
 * correct only while that root is an identity transform. Enemy.js spends a
 * page on what happens when it is not (a body drawn away from its own
 * `position` by the distance to the origin times the angle), and `stepRow`
 * zeroes the root on the frames it drives the animator for the same reason.
 *
 * So the root is no longer the carrier. `fig.pos` is the ground point the
 * animal stands on and `fig.facing` is its yaw, and everything that used to
 * read `fig.root.position` reads `fig.pos`.
 *
 * ── ALL TWELVE KINDS ARE IN THE ROOM ──────────────────────────────────────
 *
 * WHAT WAS HERE: `const BUILT = new Set(['walker'])` against the kind row's
 * own `deck` word, so `b1c` and `astro` (`knockable`) and `wook` and `medic`
 * (`row`) returned null from `callTheCompanion` and simply were not on the
 * deck. Four of twelve. The deck check adopted a massiff and nothing else, so
 * the gap was never once tested — HANDOFF §2.3 exactly, a hand-maintained
 * table beside the thing that could have derived it.
 *
 * `K.deck` had ONE reader in the whole tree and it was that line. It is not
 * read any more: which solver a body gets is asked of the SKELETON THE
 * BUILDER RETURNED, because that is what each solver actually requires —
 * `BipedAnimator` measures `thighL` and `shinL` in its constructor, and
 * `_poseWalker` solves `femur{i}`→`tibia{i}` against the published stance. A
 * routing word in a kind row can drift away from the body; a bone test cannot.
 *
 * The astromech deserves its own sentence, because it looks like an omission
 * and is not: it publishes a stance with NO LIMBS IN IT (buildAstromech says
 * why at length — an R-unit's legs are rigid struts on rollers and a gait
 * solver has nothing to say about them), so `_poseWalker` places its hips,
 * bobs its servos and turns its dome, and its legs correctly do not walk. It
 * is on the walker path because that is the path the field gives it.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES, Enemy } from './Enemy.js';
import { BipedAnimator } from './Rig.js';
import { COMPANION_KINDS } from './CompanionKinds.js';
import { load as loadKennel } from './Kennel.js';
import { companionOptsFrom } from './Bodies.js';
/* The idle-and-reaction layer, shared verbatim with the field body — see
 * CompanionLife.js. It owns everything above the legs: the head, the neck,
 * the trunk, the ribs and the idle beats. It runs LAST, after the gait. */
import { stepCompanionDeckLife } from './CompanionLife.js';

/** How far behind you it stands, and how close is close enough to stop. */
export const DECK_HEEL = { back: 2.2, side: 0.7, settled: 0.6 };

/** Its pace on the deck, in metres a second. A walk, never a trot. */
export const DECK_PACE = 2.1;

/**
 * THE SIT, AS FIVE NUMBERS AND NOT AS A CRANE.
 *
 * What was here: `root.position.y -= sit * hip * 0.35` and `root.rotation.x =
 * sit * -0.12`. The whole animal sank into the plates and tipped over on its
 * nose. Nothing about it moved a joint, the feet went through the deck on the
 * way down, and the two lines were the entire idle inventory of the feature.
 *
 * A quadruped sitting down does four things, and each of these is one of them.
 *
 *   `drop`   the pelvis comes down to a bit under half the height it rides at
 *            walking. It is spent through the STANCE — `hipHeight` is exactly
 *            "how high the hips ride" and `_poseWalker` reads it every frame —
 *            so the front feet stay planted on the floor through their own IK
 *            and take it as a compression, which is what a foreleg does while
 *            the back end goes down. 0.48 leaves a massiff's hips at 0.22 m of
 *            a walking 0.42 and its forefeet still on the plates.
 *   `pitch`  and the spine comes UP. Without it the sit is a crouch: the head
 *            drops by the whole of `drop` and the animal reads as cowering.
 *            Applied to the TRUNK bone, which on `creatureSkeleton` carries
 *            the neck, the head and any arms and carries no leg — the legs
 *            hang off `hips` — so the chest lifts and not one foot moves.
 *   `hip`    the hind socket swings,
 *   `femur`  the thigh bends forward on top of it, so the knee comes forward
 *            and up by the sum of the two, and
 *   `tibia`  the shank goes back past both, so the hock ends behind and below
 *            the knee. That is the shape, and it is the same shape at every
 *            size: they are POSE angles applied to the bones the plan already
 *            published, so a 0.34-scale tooka folds through the same angles
 *            over a tenth of the distance and nobody types a second table.
 *
 * ONLY WHERE THERE ARE LEGS. A body whose published stance has no limbs in it
 * — the astromech, whose builder argues the case at length: rigid struts on
 * rollers, and a gait solver has nothing to say about them — has nothing to
 * absorb a hip drop, so dropping its hips would put its feet through the deck.
 * It settles by not striding, and its 12 mm of servo bob goes on, because that
 * bob is not a stride and is the thing that stops it reading as a prop.
 */
const SIT = { drop: 0.48, pitch: 0.30, hip: 0.34, femur: 0.58, tibia: 1.02 };

/**
 * AND HOW FAR A BIPED SETTLES, WHICH IS NOT A SIT.
 *
 * A wookiee, a B1 and a 2-1B do not fold their haunches; there is no fold in
 * a leg with a knee that bends one way and a plantigrade foot under it. What
 * they do when you stop is take the weight off — and that pose is already
 * built, tested and shipped: `Rig.update`'s `crouch`, which drops the pelvis
 * to `lerp(1, 0.68, crouch)` of standing and leans the spine into it.
 * `CommandDirector.steer` is its other writer.
 *
 * 0.42 is 13% off the standing hip, which reads as weight-off-one-leg and not
 * as a man hiding behind a rock. It is BLENDED on the same `fig.sit` the
 * quadruped folds on, so there is no pose swap and therefore nothing to pop:
 * the alternative — switching to `poseParade` at a threshold, which is what
 * `stepRow` does — snaps a whole skeleton between two solvers on the frame
 * you stop walking, and `stepRow` gets away with it because a parade halt is
 * a halt and this is a body that shadows you round a room.
 */
const BIPED_SETTLE = 0.42;

/**
 * WHAT A SHOVE ON THE DECK DOES TO IT.
 *
 * `give` converts `deckBladeTargets`' 6.5 into metres a second on a body of
 * reference mass: 0.34 puts a clone-weight animal at 2.2 m/s, which is the
 * deck pace, so a good hit costs it about a second of walking back and never
 * throws it across the room. `shed` is how fast it plants its feet again —
 * a third of a second to a stop, which is an animal absorbing a push rather
 * than a crate sliding on ice.
 */
const SHOVE = { give: 0.34, shed: 3.2 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * THE GROUND UNDER A POINT, AND ON A DECK THAT IS NOT THE TERRAIN.
 *
 * `world.floorAt` knows both pads' kerbs, the parked transport's bay floor and
 * its ramp leaf; `terrain.height` knows the plate. Asking the wrong one puts
 * an animal's feet through a ramp it is standing on. One helper, and the deck
 * is the only room where the two answers differ.
 */
function groundUnder(world, x, z) {
  const f = world?.floorAt?.(x, z);
  if (Number.isFinite(f)) return f;
  return world?.terrain?.height?.(x, z) ?? 0;
}

/**
 * WHERE IT STANDS WHEN YOU ARE STANDING — ONE FORMULA, TWO CALLERS.
 *
 * `callTheCompanion` used to build the body at `player.z - back`, which is the
 * heel station only when the player happens to be facing down −z, and
 * `stepCompanionDeck` then walked it to the real mark. Harmless on the old
 * body, which had no legs to speak of; not harmless now. `BipedAnimator`
 * holds its feet in WORLD coordinates and re-plants them over about half a
 * second, and while they are catching up its pelvis falls onto the reach
 * clamp's floor — `Math.max(hipY, position.y + 0.30 * s)` — so a freshly
 * built B1 stood with its hips at 0.306 m of a standing 0.920 for sixteen
 * frames and then popped upright. Building it where it is going to stand
 * costs nothing and there is nothing to catch up.
 */
function deckMark(world, out) {
  const p = world.player;
  const at = p?.position;
  if (!at) return out.set(0, 0, 0);
  const yaw = p.aimDir ? Math.atan2(p.aimDir.x, p.aimDir.z) : (p.facing || 0);
  out.set(
    at.x - Math.sin(yaw) * DECK_HEEL.back + Math.cos(yaw) * DECK_HEEL.side,
    0,
    at.z - Math.cos(yaw) * DECK_HEEL.back - Math.sin(yaw) * DECK_HEEL.side,
  );
  out.y = groundUnder(world, out.x, out.z);
  return out;
}

/**
 * WHICH SOLVER THIS BODY GETS, ASKED OF THE BODY.
 *
 * Exported because the deck check drives off it rather than off a list of
 * kind names — a typed list is precisely why four kinds sat outside this room
 * unnoticed for a whole round, and a second one here would be the same defect
 * wearing a different hat.
 *
 * The two tests are the two solvers' own preconditions, not a restatement of
 * anybody's flag. `BipedAnimator`'s constructor measures `thighL` and `shinL`
 * to get its leg length, its ankle and its stride; `Hangar.callTheCompany`
 * already routes on the first of them for the same reason. `_poseWalker`
 * needs a `hips` bone and reads `built.stance` (or counts `femur{i}` off the
 * rig when a builder published none).
 */
export function deckPathFor(built) {
  const rig = built?.rig;
  if (!rig?.hipsBone) return 'root';
  if (rig.get('thighL') && rig.get('shinL')) return 'biped';
  return 'walker';
}

/**
 * THE SUBJECT `Enemy._poseWalker` IS CALLED ON.
 *
 * Not an `Enemy` — the header above spends a page on why there is no live
 * Enemy in this room — but everything `_poseWalker` and `_stance` read off
 * `this`, and nothing else. Both are taken off `Enemy.prototype` rather than
 * copied, so the deck animal and the field animal cannot walk differently:
 * the day the gait changes, this changes with it, and if the method is ever
 * renamed this throws on the first frame instead of silently freezing the
 * feet, which is the failure this whole lane exists to close.
 *
 * `walkPhase` is an ACCESSOR onto `fig.phase`. The old code advanced that
 * field by hand and nothing read it; now the shipped solver both advances it
 * (off the body's own speed and scale, clamped to its own floor and ceiling)
 * and spends it, so there is exactly one gait clock and it is the field's.
 *
 * `_stanceCache` is PRE-FILLED with a COPY of the published stance, because
 * the one thing this room asks of the gait that a battlefield never does is
 * that the animal sit down: `step`, `lift`, `bob` and `hipHeight` are the
 * four numbers a sitting body has less of, and `poseCompanionDeck` scales
 * them off `fig.sit` every frame. `rear` and the limb table are the plan's,
 * untouched, and `_base` is the plan's own copy so the scaling is never
 * applied twice. Without the stride term a sat animal cycles its feet on the
 * spot at the solver's 0.1 phase floor for ever — which is the exact sentence
 * this file has always carried about why the sit exists at all.
 */
function walkerSubject(fig, A, built) {
  const base = built.stance;
  const stance = base
    ? { ...base, limbs: base.limbs }
    : null;
  const subject = {
    rig: built.rig, A, built,
    position: fig.pos, velocity: fig.vel,
    facing: 0, lod: 0, state: null, stateTime: 0, planted: 0, target: null,
    _stanceCache: stance,
    _stance: Enemy.prototype._stance,
    _poseWalker: Enemy.prototype._poseWalker,
    _base: base,
  };
  Object.defineProperty(subject, 'walkPhase', {
    get: () => fig.phase,
    set: (v) => { fig.phase = v; },
  });
  return subject;
}

/**
 * WHICH LEGS ARE THE HIND PAIR, COUNTED OFF THE STANCE.
 *
 * The hindmost row and only the hindmost row: `L.z` is where that foot plants
 * along the body's own forward axis, so the minimum is the back pair on a
 * quadruped, the only pair on a two-legged hawk or tauntaun, and the rearmost
 * two of a varactyl's six. Derived, so a body with a different number of legs
 * needs nothing written here.
 */
function hindLegs(stance) {
  const legs = [];
  const L = stance?.limbs || [];
  let minZ = Infinity;
  for (const l of L) if (!l.arm && l.z < minZ) minZ = l.z;
  if (!Number.isFinite(minZ)) return legs;
  for (let i = 0; i < L.length; i++) if (!L[i].arm && L[i].z <= minZ + 1e-4) legs.push(i);
  return legs;
}

/**
 * STAND IT UP BEFORE ANYBODY LOOKS AT IT.
 *
 * `BipedAnimator` carries a foot-plant state machine that has to find the
 * floor before it can hold a body up, and on the frames after a body appears
 * or is moved without walking it has not: measured on a freshly built B1, the
 * pelvis sat at 0.306 m of a standing 0.920 — the reach clamp's own floor —
 * for sixteen frames, with the feet 0.28 m off the plates, and then popped
 * upright. Half a second of a droid crouching on the deck, every time.
 *
 * Sixteen solves against a stationary body is a fraction of a millisecond and
 * it happens twice in a hangar visit. The walker path needs none of it and
 * gets none: `_poseWalker` is stateless frame to frame — it places the hips
 * off the stance and IKs the feet onto the floor under them — so a massiff is
 * correct on its first solve and this returns immediately.
 */
function warm(fig) {
  if (!fig?.anim) return;
  for (let i = 0; i < 16; i++) poseCompanionDeck(fig, 1 / 30);
}

/**
 * Build the deck body for the live record, or nothing.
 *
 * IT IS THE SAME BUILDER THE FIELD USES, handed the same colour options, so
 * the animal on the deck is the animal you deploy with — the one thing two
 * representations must never disagree about is what it looks like.
 */
export function callTheCompanion(world) {
  if (!world || world._companionDeck) return world?._companionDeck || null;
  const rec = loadKennel().live;
  if (!rec) return null;
  const K = COMPANION_KINDS[rec.kind];
  if (!K) return null;
  const A = ARCHETYPES[K.archetype];
  if (!A?.build) return null;

  const built = A.build({ scale: A.scale, ...companionOptsFrom(rec.look) });
  const root = built?.rig?.root || built?.group;
  if (!root) return null;

  const at = deckMark(world, new THREE.Vector3());
  world.scene.add(root);

  const path = deckPathFor(built);
  const fig = {
    rec, kind: K, built, root, path,
    /** WHERE THE ANIMAL IS. The root is at the origin on the two rig paths —
     *  see the header — so this is the authority and `root.position` is not. */
    pos: at.clone(),
    /** Where it is trying to be. Recomputed every frame off the player. */
    mark: at.clone(),
    /** Metres a second, handed to the solver: it is what sets the stride. */
    vel: new THREE.Vector3(),
    /** Gait phase. `walkerSubject` binds the solver's `walkPhase` onto it. */
    phase: 0,
    /** 0 standing, 1 fully sat. Eased, so it folds rather than snaps. */
    sit: 0,
    facing: 0,
    /** What a shove left on it, in metres a second. Decays; see `SHOVE`. */
    push: new THREE.Vector3(),
  };
  /* THE FLOOR, AS THE SOLVERS ASK FOR IT. Both take a `terrain.height`-shaped
   * probe; on the deck the honest answer is `floorAt` and not the plate. */
  fig.ctx = { terrain: { height: (x, z) => groundUnder(world, x, z) }, time: 0 };
  if (path === 'walker') {
    fig.subject = walkerSubject(fig, A, built);
    fig.hind = hindLegs(fig.subject._stance());
  } else if (path === 'biped') {
    /* The same construction `Hangar.callTheCompany` makes for a man on this
     * deck, off the same bone measurements, with the archetype's own hip
     * height where it declares one. */
    fig.anim = new BipedAnimator(built.rig, {
      scale: built.rig.scale ?? built.scale ?? 1,
      hipHeight: A.hipHeight ?? 0.95,
    });
    warm(fig);
  } else {
    root.position.copy(at);
  }
  world._companionDeck = fig;

  /**
   * AND IT IS OFFERED TO THE DECK'S BLADE — WHICH IT WAS NOT.
   *
   * `world._deckProps` is a published extension point that
   * `Hangar.deckBladeTargets` reads with an absent-array guard, and this file
   * has always been its only writer. What it wrote was `{ fig, kind, position
   * }`, and `deckBladeTargets` opens `const sh = row?.shove; if (!sh …) return`
   * — so every entry this file ever pushed was DROPPED on the first line of
   * the function it was written for. The blade never met the animal, the
   * Force never moved it, and the check that guarded it asserted only that
   * the entry was in the array: HANDOFF §2.3b, a guard that reads a field
   * nothing on the other side ever looks at.
   *
   * `shove` is the shape the deck's own bodies present — `Shovable` for a man,
   * `DeckCast.Knockable` for a droid — and it needs three things: `at`, the
   * point the capsule is built around; `down`, whether it is already on the
   * floor; and `shove(dir, speed)`, what a hit does. This is a fourth
   * implementation of that shape and it is deliberately the smallest one,
   * because the other two carry a rigid-body tumble and a get-up clock and
   * this body has no pose for lying on its side.
   *
   * `down` IS ALWAYS FALSE, and it is not a stub. A companion on the deck
   * cannot be knocked flat because there is no pose in which it is flat: what
   * a blow does instead is SHIFT it — the animal is knocked off its station
   * and walks back to your heel, which is the whole of what the deck's shoves
   * are for and reads correctly on a body that has legs under it the whole
   * time.
   *
   * AND HOW FAR IT GOES IS ITS OWN MASS. `shatter` hands every deck body the
   * same 6.5, because the men on this deck all weigh the same; these do not.
   * 82 kg is a clone trooper, so the reference divides out and a 3 kg tooka
   * is thrown three times as far as a man while a 640 kg blurrg leans into it
   * and moves a fifth as far. Nobody types a per-kind number.
   */
  (world._deckProps ||= []).push({
    fig: { root },
    kind: 'companion',
    shove: {
      at: fig.pos,
      down: false,
      shove: (dir, speed = 4) => {
        if (!dir || dir.lengthSq() < 1e-8) return;
        const heft = Math.min(3, Math.max(0.2, 82 / (A.mass || 82)));
        fig.push.copy(dir).setY(0).normalize().multiplyScalar(speed * heft * SHOVE.give);
      },
    },
    get position() { return fig.pos; },
  });
  return fig;
}

/**
 * ONE STEP, ADDED TO THE ROOM'S OWN ORDERED LIST.
 *
 * AFTER `stepCompany`, for the same reason `stepDeckFlight` is after it: a
 * body that follows the player has to be moved once the player has moved,
 * or it is permanently one frame behind — 3.5 cm at a walk, which is nothing,
 * and 12 cm at the pace a lift ride ends on, which is a nose through a wall.
 */
export function stepCompanionDeck(world, dt) {
  const fig = world?._companionDeck;
  if (!fig) return;
  const p = world.player;
  if (!p?.position) return;

  /* THE MARK IS RECOMPUTED, NOT PARADE-ASSIGNED. A companion has no slot in
   * the line — it stands off your back quarter wherever you are, which is the
   * same station the field body keeps and the same reason. */
  const yaw = p.aimDir ? Math.atan2(p.aimDir.x, p.aimDir.z) : (p.facing || 0);
  deckMark(world, fig.mark);

  /* WHAT A SHOVE LEFT ON IT, SPENT BEFORE ANYTHING ELSE — so the gap to the
   * mark that everything below reads is the gap it was actually knocked to. */
  if (fig.push.lengthSq() > 1e-6) {
    fig.pos.addScaledVector(fig.push, dt);
    fig.pos.y = groundUnder(world, fig.pos.x, fig.pos.z);
    fig.push.multiplyScalar(Math.max(0, 1 - dt * SHOVE.shed));
    if (fig.push.lengthSq() < 1e-4) fig.push.set(0, 0, 0);
  }

  _v1.subVectors(fig.mark, fig.pos).setY(0);
  let d = _v1.length();

  /**
   * IT CAME UP IN THE LIFT WITH YOU, SO IT IS ALREADY THERE.
   *
   * `callTheCompanion` runs while the ROOM is being built, and the player is
   * placed after it — so the body is built at the world origin and the mark
   * is 90 metres away. Measured on the real deck: 92.9 m, closing at the
   * deck pace, and it was still 67.8 m away twelve seconds later. A player
   * would watch their dog jog in from the far bulkhead every single time they
   * stepped off the lift.
   *
   * Snapping on the first frame it has a real mark is the answer, and the
   * threshold is deliberately large: 20 m is further than this room's own
   * width of walking would ever put it behind you, so a snap can only ever be
   * the arrival case and never a teleport a player could witness.
   */
  if (!fig.placed) {
    fig.placed = true;
    if (d > 20) {
      fig.pos.copy(fig.mark);
      fig.facing = yaw;
      _v1.set(0, 0, 0);
      d = 0;
      /* AND THE FEET COME WITH IT. A `BipedAnimator` holds its feet in world
       * coordinates, so a body teleported ninety metres leaves them behind
       * and spends half a second with its pelvis on the reach clamp's floor
       * while they walk in — see `deckMark`. Solving the stationary body a
       * few times here is the same warm-up the build does, at the one other
       * point in this file where the body moves without walking. */
      warm(fig);
    }
  }

  /**
   * IT HALTS WHEN YOU HALT, AND THEN IT SITS.
   *
   * The sit is the idle pose that has no home anywhere in this tree: every
   * walker advances `walkPhase` at a floor of 0.1, so a standing quadruped
   * cycles its legs on the spot forever and the head only tracks a hostile.
   * On a battlefield nobody looks long enough to notice. In a room you walk
   * around for minutes at a time it is the whole difference between a
   * companion and a prop that jogs in place.
   */
  /**
   * AND WHAT DECIDES IT IS WHETHER **YOU** STOPPED, NOT WHETHER THE GAP IS
   * CLOSED.
   *
   * Written as `d > settled` alone, an animal that keeps up perfectly is an
   * animal whose gap is always under the threshold — so it sat down while
   * walking. Measured on the deck: `sit 1.00` through a twenty-four metre
   * walk it was matching stride for stride, because it never fell behind.
   *
   * The player's own displacement is the real signal, sampled here rather than
   * read off `player.velocity` because on the deck the body is moved by the
   * character controller and a velocity of zero is not the same as not having
   * moved.
   */
  const was = fig.at || (fig.at = p.position.clone());
  const drift = _v2.subVectors(p.position, was).setY(0).length();
  was.copy(p.position);
  const walking = drift > dt * 0.25;
  const moving = d > DECK_HEEL.settled;
  fig.sit += (((moving || walking) ? 0 : 1) - fig.sit) * Math.min(1, dt * 2.2);

  if (moving) {
    _v1.multiplyScalar(1 / d);
    const step = Math.min(d, DECK_PACE * dt);
    fig.pos.addScaledVector(_v1, step);
    fig.pos.y = groundUnder(world, fig.pos.x, fig.pos.z);
    /* THE SPEED THE SOLVER SEES IS THE SPEED IT TRAVELLED, so the stride is
     * the body's own function of it — `clamp(speed / (1.1 * scale), 0.1, 2.4)`
     * cycles a second — and a companion closing a gap at the last centimetre
     * takes a shorter step rather than the same one. */
    fig.vel.copy(_v1).multiplyScalar(step / Math.max(dt, 1e-6));
    /* IT TURNS THE SHORT WAY, and eases rather than snapping — a body that
     * spins 180° in a frame reads as a glitch even when the destination is
     * right. */
    const want = Math.atan2(_v1.x, _v1.z);
    let turn = want - fig.facing;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    fig.facing += turn * Math.min(1, dt * 6);
  } else {
    fig.vel.set(0, 0, 0);
    /* SAT, IT LOOKS AT YOU. The one thing a pet does that a prop does not. */
    _v2.subVectors(p.position, fig.pos).setY(0);
    if (_v2.lengthSq() > 1e-4) {
      const want = Math.atan2(_v2.x, _v2.z);
      let turn = want - fig.facing;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      fig.facing += turn * Math.min(1, dt * 3);
    }
  }

  poseCompanionDeck(fig, dt);

  /* AND THEN IT IS ALIVE. Last, after the gait has run, so the layer's own
   * bone writes are the last thing to touch this body in the frame and
   * nothing below overwrites them. */
  stepCompanionDeckLife(fig, dt, world);
}

/**
 * THE POSE — one of the shipped solvers, then the fold.
 *
 * Split out of the step above so a probe or a check can hold the follower
 * still and drive the pose alone; it is also the whole of what this lane
 * added, and it reads better as one thing.
 */
export function poseCompanionDeck(fig, dt) {
  const sit = fig.sit = Math.max(0, Math.min(1, fig.sit));
  const rig = fig.built?.rig;

  if (fig.path === 'walker') {
    const s = fig.subject;
    s.facing = fig.facing;
    /**
     * THE SIT REACHES THE SOLVER AS A STANCE, WHICH IS THE SOLVER'S OWN INPUT.
     *
     * `_poseWalker` is handed `ST` and reads five numbers off it; four of them
     * are what a sitting animal has less of. So the sit is spent by editing a
     * COPY of the published stance rather than by second-guessing the solver
     * afterwards — no stride, no foot lift, no walk bob, and the hips ride
     * lower — and the limb table and `rear` are the plan's, untouched.
     *
     * Without the stride term a sat animal cycles its feet on the spot for
     * ever at the solver's own 0.1 phase floor, which is the exact sentence
     * this file has always carried about why the sit exists at all.
     */
    const base = s._base;
    if (base && fig.hind.length) {
      const m = 1 - sit;
      s._stanceCache.step = base.step * m;
      s._stanceCache.lift = base.lift * m;
      s._stanceCache.bob = base.bob * m;
      s._stanceCache.hipHeight = base.hipHeight * (1 - SIT.drop * sit);
    }
    s._poseWalker(dt, fig.ctx);
    foldSit(fig, sit);
    return;
  }

  if (fig.path === 'biped') {
    /* ROOT AT IDENTITY WHILE THE SOLVER WRITES WORLD-SPACE BONES — `stepRow`'s
     * own line, for the reason Enemy.js gives at length. */
    fig.root.position.set(0, 0, 0);
    fig.root.quaternion.identity();
    fig.anim.setFacing(fig.facing);
    fig.anim.update(dt, {
      position: fig.pos, facing: fig.facing, velocity: fig.vel,
      grounded: true, groundAt: fig.ctx.terrain.height,
      crouch: sit * BIPED_SETTLE,
      accelForward: Math.min(1, fig.vel.length() / 5),
      deferMatrices: false,
    });
    return;
  }

  /* NO RIG AT ALL: the root carries the transform, which is all there is to
   * carry. Nothing in COMPANION_KINDS reaches this today — every one of the
   * twelve builds a skeleton — and it is here because `callTheCompanion` must
   * put SOMETHING in the room rather than return null, which is the whole
   * defect this lane closed. */
  if (!rig) {
    fig.root.position.copy(fig.pos);
    fig.root.rotation.y = fig.facing;
  }
}

/**
 * THE SIT, FOLDED ON THE BONES AND NOT ON THE ROOT.
 *
 * Applied AFTER `_poseWalker`, because the IK assigns the leg quaternions
 * outright: this post-multiplies a rotation about each bone's own lateral
 * axis, which is what the joint does, so the leg folds from wherever the gait
 * left it rather than from a pose written twice.
 *
 * ONLY THE HIND ROW, counted off the stance rather than named (see
 * `hindLegs`): a sitting animal's forelegs stay under it and straight, and
 * they take the hip drop as a compression through their own IK because their
 * feet are still planted on the floor.
 *
 * ── ASSIGN THE BONES WITH ONE OWNER, POST-MULTIPLY THE ONES WITH TWO, AND
 *    THE DIFFERENCE IS NOT A STYLE ────────────────────────────────────────
 *
 * `solveIK` ASSIGNS `femur{i}` and `tibia{i}` every frame off a world-space
 * target, so a rotation applied to those after it has run is spent and gone by
 * the next one: post-multiplying is the only way to bend a joint the solver
 * owns. **Nothing writes `hipL{i}` or the trunk at all** — the sockets are
 * fixed to the gait and `_poseWalker` never touches `body` — so the same line
 * there is an INTEGRATOR. Measured with the socket written that way: the hind
 * hips wound up 3.135 rad from rest inside six seconds, the IK chased them,
 * and the animal's back legs pointed at the ceiling. It is CompanionLife.js's
 * own rule about two owners of one bone read the other way round, and both
 * halves are here in four lines of each other.
 *
 * THE TRUNK IS ASSIGNED FROM REST AND THE LIFE LAYER STILL GETS IT, which is
 * not luck: `layerBone` resets a bone to rest only when it still holds what
 * that layer left on it last frame, and after this it does not — so the sway
 * and the breath ride on top of the sit rather than erasing it, exactly as
 * they ride on top of `_poseWalker`'s head track on the field.
 *
 * `touchMatrices` rather than `updateMatrices` — the life layer that runs next
 * reads through `worldPos`, which ensures for itself, so the walk is paid for
 * once by whoever actually asks. See the note over `Rig.updateMatrices`.
 */
const _fold = new THREE.Quaternion();
function foldSit(fig, sit) {
  const legs = fig.hind;
  if (!legs?.length) return;
  const rig = fig.built.rig;

  /* THE SPINE COMES UP AS THE PELVIS GOES DOWN. Assigned, because its only
   * other writer is the life layer and that one rides on top. */
  const trunk = rig.get('body');
  if (trunk && !trunk.severed) {
    trunk.obj.quaternion.copy(trunk.restQuat).multiply(_fold.setFromAxisAngle(_RIGHT, SIT.pitch * sit));
  }

  for (const i of legs) {
    const hip = rig.get(`hipL${i}`);
    if (hip && !hip.severed) {
      hip.obj.quaternion.copy(hip.restQuat).multiply(_fold.setFromAxisAngle(_RIGHT, SIT.hip * sit));
    }
    if (sit < 1e-3) continue;
    const femur = rig.get(`femur${i}`);
    if (femur && !femur.severed) femur.obj.quaternion.multiply(_fold.setFromAxisAngle(_RIGHT, SIT.femur * sit));
    const tibia = rig.get(`tibia${i}`);
    if (tibia && !tibia.severed) tibia.obj.quaternion.multiply(_fold.setFromAxisAngle(_RIGHT, -SIT.tibia * sit));
  }
  rig.touchMatrices?.();
}

/** Put it away. Called from the room's own teardown. */
export function dismissCompanion(world) {
  const fig = world?._companionDeck;
  if (!fig) return;
  fig.root.parent?.remove(fig.root);
  const props = world._deckProps;
  if (props) {
    const i = props.findIndex((x) => x?.fig?.root === fig.root);
    if (i >= 0) props.splice(i, 1);
  }
  world._companionDeck = null;
}
