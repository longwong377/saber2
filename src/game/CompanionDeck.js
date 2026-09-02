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
 * ── WHAT IS BUILT HERE AND WHAT IS NOT, STATED PLAINLY ────────────────────
 *
 * BUILT: the creature and mount kinds — eight of the twelve — as a body built
 * by the same `ARCHETYPES[...].build` the field uses, walked by a small gait
 * follower off the plan's own published `stance`, following you at a heel,
 * SITTING when you stop, and offered to the deck's blade through the
 * `world._deckProps` extension point.
 *
 * NOT BUILT: the droid kinds' `Knockable` path and the wookiee's humanoid
 * `row`. Both are named in COMPANIONS.md with the shipped machinery they
 * should reuse; neither is here yet, and a kind whose deck body is missing
 * simply does not appear on the deck rather than appearing wrong. That is
 * written down instead of discovered.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES } from './Enemy.js';
import { COMPANION_KINDS } from './CompanionKinds.js';
import { load as loadKennel } from './Kennel.js';
import { companionOptsFrom } from './Bodies.js';

/** How far behind you it stands, and how close is close enough to stop. */
export const DECK_HEEL = { back: 2.2, side: 0.7, settled: 0.6 };

/** Its pace on the deck, in metres a second. A walk, never a trot. */
export const DECK_PACE = 2.1;

/**
 * WHICH KINDS HAVE A DECK BODY AT ALL — read off the row's own `deck` field,
 * never a list of names. A kind whose representation is not built yet is
 * absent from the room rather than drawn wrong, and the day the Knockable and
 * the humanoid row land this set grows by two words.
 */
const BUILT = new Set(['walker']);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

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
  if (!K || !BUILT.has(K.deck)) return null;
  const A = ARCHETYPES[K.archetype];
  if (!A?.build) return null;

  const built = A.build({ scale: A.scale, ...companionOptsFrom(rec.look) });
  const root = built?.rig?.root || built?.group;
  if (!root) return null;

  const p = world.player?.position || new THREE.Vector3();
  const at = new THREE.Vector3(p.x, 0, p.z - DECK_HEEL.back);
  at.y = groundUnder(world, at.x, at.z);
  root.position.copy(at);
  world.scene.add(root);

  const fig = {
    rec, kind: K, built, root,
    /** Where it is trying to be. Recomputed every frame off the player. */
    mark: at.clone(),
    /** Gait phase, and the 0.1 floor every walker in the game uses — except
     *  that a standing companion SITS instead, which is what `sit` is for. */
    phase: 0,
    /** 0 standing, 1 fully sat. Eased, so it folds rather than snaps. */
    sit: 0,
    facing: 0,
  };
  world._companionDeck = fig;

  /**
   * AND IT IS PUSHABLE AND CUTTABLE WITH ZERO FILE CHANGES. `world._deckProps`
   * is a published extension point that `Hangar.deckBladeTargets` already
   * reads with an absent-array guard and that World.js already consumes — and
   * that NOTHING in `src/` has ever written. This is its first writer.
   */
  (world._deckProps ||= []).push({
    fig: { root },
    kind: 'companion',
    get position() { return root.position; },
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
  fig.mark.set(
    p.position.x - Math.sin(yaw) * DECK_HEEL.back + Math.cos(yaw) * DECK_HEEL.side,
    0,
    p.position.z - Math.cos(yaw) * DECK_HEEL.back - Math.sin(yaw) * DECK_HEEL.side,
  );
  fig.mark.y = groundUnder(world, fig.mark.x, fig.mark.z);

  const root = fig.root;
  _v1.subVectors(fig.mark, root.position).setY(0);
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
      root.position.copy(fig.mark);
      fig.facing = yaw;
      _v1.set(0, 0, 0);
      d = 0;
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
    root.position.addScaledVector(_v1, step);
    root.position.y = groundUnder(world, root.position.x, root.position.z);
    fig.phase += step * 2.4;
    /* IT TURNS THE SHORT WAY, and eases rather than snapping — a body that
     * spins 180° in a frame reads as a glitch even when the destination is
     * right. */
    const want = Math.atan2(_v1.x, _v1.z);
    let turn = want - fig.facing;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    fig.facing += turn * Math.min(1, dt * 6);
  } else {
    /* SAT, IT LOOKS AT YOU. The one thing a pet does that a prop does not. */
    _v2.subVectors(p.position, root.position).setY(0);
    if (_v2.lengthSq() > 1e-4) {
      const want = Math.atan2(_v2.x, _v2.z);
      let turn = want - fig.facing;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      fig.facing += turn * Math.min(1, dt * 3);
    }
  }
  root.rotation.y = fig.facing;

  /* THE SIT ITSELF: the haunches drop and the front stays up, which is what a
   * four-legged animal does and is expressible as one lean and one drop
   * without a pose table. `hip` is the plan's own number, so a tooka sits by
   * as much less as it is smaller. */
  const hip = fig.built?.plan?.hip ?? 0.5;
  root.position.y = groundUnder(world, root.position.x, root.position.z)
    - fig.sit * hip * 0.35 * (fig.built?.scale ?? 1);
  root.rotation.x = fig.sit * -0.12;
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
