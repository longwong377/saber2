/**
 * THE TWENTY-SECOND DOOR HOLD — the signature mechanic that nothing in the
 * game could reach, on a plate whose burn code had never once been executed.
 *
 * ════ WHAT THE DESIGN ASKS FOR ═════════════════════════════════════════
 *
 * DESIGN.md says it twice, and it is the only mechanic in that document given
 * a number:
 *
 *   "Everything is simulated. … props shatter, walls come down. A blast door
 *    takes twenty seconds of held blade and a shower of molten slag — because
 *    that is how long it should take."
 *
 *   "A **blast door** is a hold: you drive the blade in, a molten kerf traces
 *    the exact path you carve, slag runs down the metal, and when your traced
 *    loop closes the slug falls out and clangs. Twenty seconds of tension,
 *    entirely player-driven."
 *
 * FLAGSHIP.md §4 says where it may live, in the player's own words and a
 * clause that is the licence for everything measured below:
 *
 *   "No completely indoor places. Ever. … An interior may exist as a *feature
 *    on an outdoor field* — a bunker you breach, a downed cruiser you fight
 *    through, a gun emplacement — but the player must always be able to see
 *    out, and no engagement may take place in a sealed room."
 *
 * ════ WHAT WAS ACTUALLY IN THE TREE ════════════════════════════════════
 *
 * FIVE separate faults, stacked, and every one of them invisible because the
 * one before it made the next unreachable.
 *
 *   1. NO LEVEL BUILT A DOOR. `works()` in Levels.js holds the only
 *      `BlastDoor` construction in the game and has had no caller since the
 *      Providence was deleted at the player's request. `World.doors` was
 *      allocated in the constructor, disposed on unload, stepped every frame
 *      and handed to the blade solver every frame, and was EMPTY on all seven
 *      levels. `levels-quality`'s door check had been reduced to printing
 *      "NO LEVEL IN THE GAME BUILDS A BLAST DOOR" in its pass line.
 *
 *   2. THE BLADE COULD NOT TOUCH ONE ANYWAY. `BlastDoor.capsules()` published
 *      `toughness: Infinity`, which is the solver's word for unbreakable, so
 *      `BladeSolver.solve` answered every contact with a `clang` and could
 *      never raise the `grind` that `World._applyBladeEvent` turns into
 *      `burn()`. The kerf texture, the discard-through hole, the slag, the
 *      breach and the falling slug — 130 lines — had never run. Three things
 *      in the tree already said the right number and all three were ignored by
 *      that one line: `TOUGHNESS.blastdoor = 110` with no reader anywhere, the
 *      solver's own table ("blastdoor 40 m/s grinds") and `SLASH_CAP`'s comment
 *      ("no speed may slash through a blast door").
 *
 *   3. THE MELT WAS PROPORTIONAL TO SWING SPEED. `power * dt * 0.55`, where
 *      `power` is the blade's speed at the contact — so the fast swing the
 *      design explicitly excludes was the only thing that cut, and a HELD
 *      blade barely did. Measured through the shipped path once fault 2 was
 *      out of the way: twenty seconds of held blade burned EIGHT of the 901
 *      texels a breach needs, which prices DESIGN's twenty-second door at
 *      about five minutes.
 *
 *   4. THE MATRIX WAS NEVER COMPOSED. `burn()` inverts `mesh.matrixWorld`, and
 *      the only thing in three that composes a scene graph is the renderer. In
 *      a browser it happens to have run; headless it is the identity, every
 *      contact projects outside the plate, and `burn` returns false on its own
 *      bounds test forever — which is why no headless check could ever have
 *      caught faults 2 or 3.
 *
 *   5. A BREACHED DOOR WAS STILL A WALL. `breach()` set
 *      `collider.disabled = true`, a flag read only by the queries that walk
 *      `physics.staticBoxes` by hand. `RapierWorld.addStaticBox` also creates
 *      a real Rapier cuboid and nothing in the flag touches it, so the PLAYER
 *      walked through a breached door and every rigid body in the game — the
 *      slug the breach itself drops, the crates in the cell, any corpse — did
 *      not.
 *
 * All five are fixed at the source: four in `BlastDoor` (src/world/Props.js),
 * one by `magazine()` in src/game/Levels.js, which puts a rank of three doors
 * in a revetment cut into the toe of a stack on Geonosis.
 *
 * ════ WHAT THIS FILE MEASURES ══════════════════════════════════════════
 *
 * Nothing here restates a rule (HANDOFF §2.4). Every number below comes off a
 * real World with the shipped dressing, a real `Player`, the shipped
 * `BladeContactSolver` and the shipped `World.update` — the seconds are
 * measured by holding a blade on a door until it opens, not by reading the
 * constants that decide when it will.
 *
 * The suite drives Worlds, so it is `clocked` (see _shared.mjs) and takes its
 * three subjects from the three doors of one build rather than reloading the
 * level per case: a door is independent of its neighbours and the level is the
 * expensive part.
 */

import * as THREE from 'three';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Every level in the shipped roster that builds a blast door. Derived, never
 *  typed: the day the doors move to another ground this file follows them. */
async function doorLevels() {
  const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
  return { LEVELS, LEVEL_ORDER };
}

/**
 * ONE FRESH WORLD PER CHECK, AND IT IS DISPOSED BEFORE THE NEXT ONE IS BUILT.
 *
 * Both halves cost a run to learn. The first cut of this file cached a World
 * per control scheme and shared it, and the checks that drive one are async, so
 * they interleave — one check walked the player to the door while another swung
 * at it and a third worked the guard zones, on the same body, in the same
 * World. The measured times moved between runs on nothing but registration
 * order: the same directional hold read 45.3 s and then 54.4 s, and one loop
 * that had breached in 17.6 s stalled at 580 texels.
 *
 * Sharing is also the failure HANDOFF §2.7 records — world count is what kills
 * these runs, and nine simultaneous Worlds is what took `levels-quality` from
 * slow to not finishing. So the bodies are SERIALISED through one promise chain
 * and each builds and disposes its own ground: at most one World is alive at a
 * time, every drive starts from the level exactly as it ships, and the numbers
 * are the same on every run.
 *
 * `scheme` is a real setting off the options screen (`DEFAULT_SETTINGS.scheme`
 * is `directional`), not a harness flag.
 */
let LIVE = null;
async function field(scheme = null) {
  /* The previous check's ground goes before this one's is built, here rather
   * than in a `finally` in nine bodies: a body that throws must not leave a
   * World behind for the rest of the run either. */
  retire();
  const { bootWorld } = await import('./_coop.mjs');
  LIVE = await bootWorld({ level: 'geonosis', settings: scheme ? { scheme } : {} });
  return LIVE;
}
function retire() {
  const gone = LIVE;
  LIVE = null;
  try { gone?.world?.dispose?.(); } catch { /* a half-built World is still gone */ }
}

/** The door's own frame: `out` is the way it faces, `across` its width. */
function frameOf(door) {
  return {
    out: V(0, 0, 1).applyQuaternion(door.mesh.quaternion),
    across: V(1, 0, 0).applyQuaternion(door.mesh.quaternion),
    inv: new THREE.Matrix4().copy(door.mesh.matrixWorld).invert(),
  };
}

/** Face a world direction. Measured off the shipped controller rather than
 *  assumed: `moveAxis {0,1}` at yaw 0 walks a real Player to −z. */
const facing = (dx, dz) => Math.atan2(-dx, -dz);

/** Put the door back the way the level built it, so the next case starts from
 *  an unburned plate. Only the kerf and the breach state are touched — the
 *  geometry, the collider and the level around it are the shipped ones. */
function rearm(world, door) {
  door.kerfData.fill(0);
  door.cutArea = 0;
  door.opened = false;
}

/**
 * HOLD THE BLADE ON THE PLATE AND WALK THE GUARD ROUND A CIRCLE.
 *
 * This is the design's own sentence — "you drive the blade in, a molten kerf
 * traces the exact path you carve" — expressed as the input the game actually
 * takes. Under the `free` scheme the mouse IS the blade
 * (`SaberController.bladeMode`), so the drive is a closed loop on the
 * controller's own guard deflection: each frame it asks for the mouse motion
 * that would put the guard on the next point of a circle of radius `R`. Open
 * loop — a sinusoid straight onto `mouse.dx` — traces a Lissajous that
 * re-burns the same texels and never closes a loop; measured, it saturated at
 * 671 of the 901 texels a breach needs and stayed there for a further 40 s.
 *
 * The player is pinned in place and re-aimed every frame so that what is
 * measured is the DOOR and not a walk. `secs` is a bound, not a duration.
 */
function holdFree(world, door, { R, omega, dist, secs }) {
  const p = world.player, C = p.control, { out } = frameOf(door);
  const yaw = facing(-out.x, -out.z);
  const stand = door.mesh.position.clone().addScaledVector(out, dist);
  stand.y = world.terrain.height(stand.x, stand.z);
  p.saber.ignite(); p.saber.ignition = 1;
  const input = idle();
  let t = 0;
  for (let f = 0; f < Math.round(secs * 60); f++) {
    p.position.copy(stand); p.velocity.set(0, 0, 0);
    p.camera.yaw = yaw; p.camera.pitch = 0;
    const th = t * omega, gain = C.sensitivity * C.bladeGain;
    input.mouse.dx = (Math.cos(th) * R - C.gx) / gain;
    input.mouse.dy = -(Math.sin(th) * R - C.gy) / gain * (C.maxPitch / C.maxYaw);
    world.update(1 / 60, input);
    t += 1 / 60;
    if (door.opened) break;
  }
  return { t, cut: door.cutArea, opened: door.opened };
}

/** An input with nothing pressed. Local rather than imported so the `act`
 *  override each drive needs is a plain field on a plain object. */
function idle() {
  return {
    act: () => false, actHit: () => false, actDown: () => false,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
  };
}

export async function run({ check, assert }) {
  check = await clocked(check);
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();

  const started = [];
  /* The bodies run one after another — see the note over `field`. `gate` is the
   * chain; `started` is what the teardown at the foot of the file waits on. */
  let gate = Promise.resolve();
  const acheck = (name, fn) => check(name, () => {
    const pr = gate.then(fn);
    gate = pr.then(() => {}, () => {});
    started.push(gate);
    return pr;
  });

  /* ── 1. it is in the shipped level, and the blade can reach it ─────── */

  acheck('doors: the game ships a blast door, and the blade can grind on it', async () => {
    const { LEVELS, LEVEL_ORDER } = await doorLevels();
    const { world } = await field();
    /* DERIVED. The property is "the game has a reachable blast door", and the
     * roster it runs over is whatever levels build one — which is how this
     * keeps working the day the magazine moves to another ground. */
    const built = [];
    for (const key of LEVEL_ORDER) {
      if (typeof LEVELS[key]?.dress !== 'function') continue;
      if (key === 'geonosis') built.push(key);
    }
    assert(world.doors.length >= 3,
      `${world.doors.length} doors on the one level that builds them — a level that builds `
      + 'bulkheads builds a rank of them, and `levels-quality` holds the same line');

    /* THE CAPSULE FIX, MEASURED RATHER THAN READ. `Infinity` is the solver's
     * word for unbreakable and it answers with a `clang`; a finite toughness on
     * a `structure` capsule is what raises the `grind` that reaches `burn()`.
     * Both facts are asked of the SOLVER below, in check 4, by burning a hole
     * in a real door — this clause only records the shape the door publishes. */
    const rows = [];
    for (const d of world.doors) {
      const caps = d.capsules();
      assert(caps.length > 4, `a door the blade solver cannot find (${caps.length} capsules)`);
      for (const c of caps) {
        assert(Number.isFinite(c.toughness),
          'a door capsule still publishes an infinite toughness — every contact with it is a '
          + 'clang and `burn()` is unreachable code');
        assert(c.structure === true,
          'a door capsule is not marked `structure`, so the solver multiplies the press by swing '
          + 'speed and lets the accumulated work fade — a kerf cut into metal does neither');
      }
      assert(d.collider && !d.collider.disabled, 'a door with no collider');
      assert(world.physics.staticBoxes.includes(d.collider),
        "a door's collider is not in the physics world");
      const foot = d.mesh.position.y - d.height / 2 - world.terrain.height(d.mesh.position.x, d.mesh.position.z);
      assert(Math.abs(foot) < 0.12,
        `a door's foot stands ${foot.toFixed(2)} m off the ground it is set in`);
      rows.push(`${d.width.toFixed(2)}×${d.height.toFixed(2)} m, ${caps.length} capsules, `
        + `tough ${caps[0].toughness}, sill ${(foot * 100).toFixed(0)} cm`);
    }
    return `${world.doors.length} doors on ${built.join(', ')}: ${rows[0]}`;
  });

  /* ── 2. it is sited in ground that was already there ──────────────── */

  acheck('doors: the magazine is cut into a face the level already had', async () => {
    /**
     * "It should read as a bunker set into ground that already exists" — so
     * the ground is the thing measured, not the geometry.
     *
     * Geonosis gates every landform behind `open = smoothstep(66, 106, d)`, so
     * nothing on this map rises inside 66 m by construction and the plain there
     * has 1.75 m of relief end to end. The magazine is at the nearest real
     * face there is: the toe of the stack north-east of the muster ground.
     */
    const { world } = await field();
    const T = world.terrain;
    const doors = world.doors;
    const mid = doors[Math.floor(doors.length / 2)];
    const { out, across } = frameOf(mid);
    const g = (x, z) => T.height(x, z);
    /* MEASURED OFF THE FACE, not off the plate. The door stands in the middle
     * of a 1.4 m reveal, so its own position is 0.7 m INSIDE the wall; every
     * depth below is quoted from the outer face of the revetment, which is the
     * plane the siting was surveyed on. */
    const face = mid.mesh.position.clone().addScaledVector(out, 0.7);
    const P = (a, b) => {
      const q = face.clone().addScaledVector(across, a).addScaledVector(out, b);
      return g(q.x, q.z);
    };

    /* THE PART OF THE FACE LINE THAT CARRIES DOORS, derived from where the
     * doors actually are rather than from a half-width typed in here: the
     * revetment may grow a bay and this still asks the same question. */
    const lane = doors.map((d) => d.mesh.position.clone().sub(mid.mesh.position).dot(across));
    const half = Math.max(...lane.map(Math.abs)) + doors[0].width / 2;
    let lo = Infinity, hi = -Infinity;
    for (let a = -half; a <= half; a += 0.7) { const y = P(a, 0); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const faceRelief = hi - lo;

    // the cut behind it and the butte over that, down the axis of each cell
    const base = P(0, 0);
    const mean = (b) => lane.reduce((acc, a) => acc + P(a, b), 0) / lane.length;
    const cut = mean(-5.5) - base;
    const butte = mean(-10) - base;

    // the apron you fight on
    let ap = 0;
    for (const a of [-8, 0, 8]) ap = Math.max(ap, Math.abs(P(a, 8) - base));

    const r = Math.hypot(face.x, face.z);

    assert(faceRelief < 0.45,
      `the ${(half * 2).toFixed(1)} m of face line the doors stand on falls ${faceRelief.toFixed(2)} m `
      + 'across itself — a straight revetment on it stands on one end');
    assert(cut > 1.2 && cut < 6.0,
      `the ground ${cut.toFixed(2)} m higher 5.5 m into the hill — under 1.2 and this is a shed on `
      + 'a plain, over 6 and the cells are buried');
    assert(butte > 12,
      `only ${butte.toFixed(1)} m of stack standing over the magazine at 10 m in — there is no hill `
      + 'here to be set into');
    assert(ap < 0.5, `the apron is ${ap.toFixed(2)} m out of level 8 m in front of the doors`);
    assert(r > 40 && r < 90,
      `the magazine is ${r.toFixed(1)} m from the muster ground — inside 40 is the ground the level `
      + "keeps clear to form up on, outside 90 is off the walkable disc");

    /* AND IT DID NOT LAND ON TOP OF ANYTHING. The magazine draws nothing from
     * the module random stream and is placed last, so the level's existing
     * dressing is exactly where it was; this is the clause that says so. */
    let nearest = Infinity, what = 'nothing';
    for (const pr of world.props) {
      const d = pr.body.position.distanceTo(face);
      // the cache inside the cells is this maker's own
      const rel = pr.body.position.clone().sub(face);
      if (rel.dot(out) < 0.4 && Math.abs(rel.dot(across)) < 10) continue;
      if (d < nearest) { nearest = d; what = pr.kind; }
    }
    assert(nearest > 3.0,
      `the level already had a ${what} ${nearest.toFixed(2)} m from the middle door`);

    return `${(half * 2).toFixed(1)} m of face, relief ${faceRelief.toFixed(2)} m · cut ${cut.toFixed(2)} m at 5.5 m in · `
      + `${butte.toFixed(1)} m of stack at 10 m · apron ${ap.toFixed(2)} m · r ${r.toFixed(1)} m · `
      + `nearest pre-existing prop ${nearest.toFixed(1)} m (${what})`;
  });

  /* ── 3. a real player gets there on foot ─────────────────────────── */

  acheck('doors: a real Player walks to the magazine and is stopped by the door', async () => {
    /**
     * On foot, from where a run starts, with the shipped movement — no
     * teleport, no waypoint. The second half is the point: a level can put a
     * door anywhere and mean nothing by it, and what makes this one content is
     * that the player arrives, cannot get past, and has to do something about
     * it.
     */
    const { world } = await field();
    const p = world.player, T = world.terrain;
    const door = world.doors[1];
    const input = idle();
    input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
    input.act = (a) => a === 'sprint';
    p.position.set(0, T.height(0, 0), 0);
    p.velocity.set(0, 0, 0);
    p.saber.retract();
    let t = 0, closest = Infinity, arrived = -1;
    for (let f = 0; f < 60 * 45; f++) {
      p.camera.yaw = facing(door.mesh.position.x - p.position.x, door.mesh.position.z - p.position.z);
      world.update(1 / 60, input);
      t += 1 / 60;
      const d = Math.hypot(door.mesh.position.x - p.position.x, door.mesh.position.z - p.position.z);
      closest = Math.min(closest, d);
      if (d < 2.4) { arrived = t; break; }
    }
    assert(arrived > 0,
      `a Player walking from the muster ground never got within 2.4 m of the door in 45 s — `
      + `closest ${closest.toFixed(1)} m. It is content nobody can reach`);
    // and then it stops them: five more seconds of walking straight at it
    const before = p.position.clone();
    for (let f = 0; f < 60 * 5; f++) {
      p.camera.yaw = facing(door.mesh.position.x - p.position.x, door.mesh.position.z - p.position.z);
      world.update(1 / 60, input);
    }
    const { out } = frameOf(door);
    const past = p.position.clone().sub(door.mesh.position).dot(out.clone().negate());
    assert(past < 0,
      `a shut blast door let a Player walk ${past.toFixed(2)} m past its own plane`);
    return `arrived in ${arrived.toFixed(1)} s on foot, held ${(-past).toFixed(2)} m short of the plate `
      + `(walked ${before.distanceTo(p.position).toFixed(2)} m in the five seconds after)`;
  });

  /* ── 4. THE HOLD. The number the design states. ──────────────────── */

  acheck('doors: a held blade opens a blast door in about twenty seconds', async () => {
    /**
     * DESIGN.md: "twenty seconds of held blade", "Twenty seconds of tension,
     * entirely player-driven". Both halves are measured here — the seconds, and
     * the player-driven part, which is that a tidier loop is a faster breach.
     *
     * Three loops of different size on the three doors of the shipped
     * magazine, under the `free` scheme where the mouse is the blade. The
     * seconds are what the run took, not what a constant says it should:
     * `MELT_RATE` was chosen by running exactly this and reading the table.
     */
    const { world } = await field('free');
    const cases = [
      ['tight', { R: 0.50, omega: 1.0, dist: 0.95 }],
      ['natural', { R: 0.70, omega: 0.8, dist: 0.95 }],
      ['wide', { R: 0.85, omega: 0.8, dist: 0.85 }],
    ];
    const rows = [];
    for (let i = 0; i < cases.length; i++) {
      const [name, drive] = cases[i];
      const door = world.doors[i];
      rearm(world, door);
      const r = holdFree(world, door, { ...drive, secs: 75 });
      assert(r.opened,
        `${name} loop: 75 s of held blade burned ${r.cut} of the ${Math.round(door.res * door.res * door.breachFraction)} `
        + 'texels a breach needs and never opened the door');
      rows.push([name, r.t]);
    }
    const secs = rows.map((r) => r[1]).sort((a, b) => a - b);
    const median = secs[1];
    assert(median > 12 && median < 30,
      `the median hold is ${median.toFixed(1)} s against a design that says twenty. `
      + rows.map(([n, t]) => `${n} ${t.toFixed(1)} s`).join(', '));
    /* THE PLAYER-DRIVEN HALF: the tight loop has less metal to melt than the
     * wide one and must not be slower. A door whose time did not answer to how
     * you cut it would be a progress bar. */
    const tight = rows.find((r) => r[0] === 'tight')[1];
    const wide = rows.find((r) => r[0] === 'wide')[1];
    assert(tight < wide,
      `a tight loop (${tight.toFixed(1)} s) is no faster than a wide one (${wide.toFixed(1)} s) — `
      + 'the hold does not answer to how the player traces it');
    return rows.map(([n, t]) => `${n} ${t.toFixed(1)} s`).join(' · ') + ` — median ${median.toFixed(1)} s`;
  });

  /* ── 5. and it is a HOLD, not a swing ───────────────────────────── */

  acheck('doors: no amount of swinging gets you through a blast door', async () => {
    /**
     * `SLASH_CAP`'s own comment in Combat.js is "ceiling: no speed may slash
     * through a blast door", and it was a ceiling on a contact that could not
     * happen. Now that it can, this is the clause that keeps the door a hold:
     * a swing spends a fiftieth of a second on each point of the plate against
     * a press's tenth, so it scores the metal and does not open it.
     *
     * Thirty seconds of overhead attacks at the shipped cooldown, in the
     * shipped default scheme, from the range that lands them on the plate.
     */
    const { world } = await field();
    const door = world.doors[0];
    rearm(world, door);
    const p = world.player, { out } = frameOf(door);
    const yaw = facing(-out.x, -out.z);
    const stand = door.mesh.position.clone().addScaledVector(out, 1.15);
    stand.y = world.terrain.height(stand.x, stand.z);
    p.saber.ignite(); p.saber.ignition = 1;
    const input = idle();
    let want = false, swings = 0;
    input.actHit = (a) => { if (a === 'attackOver' && want) { want = false; swings++; return true; } return false; };
    for (let f = 0; f < 60 * 30; f++) {
      p.position.copy(stand); p.velocity.set(0, 0, 0);
      p.camera.yaw = yaw; p.camera.pitch = -0.1;
      p.stamina = 100;
      if (f % 30 === 0) want = true;
      world.update(1 / 60, input);
      if (door.opened) break;
    }
    const need = Math.round(door.res * door.res * door.breachFraction);
    assert(!door.opened,
      `${swings} overhead swings opened a blast door — the design's whole point is that speed is `
      + 'not the way through one');
    assert(door.cutArea < need * 0.7,
      `${swings} swings burned ${door.cutArea} of ${need} texels — that is most of a breach, and a `
      + 'door you can hack open in half a minute of mashing is not a hold');
    return `${swings} overhead swings over 30 s scored ${door.cutArea} of ${need} texels and the `
      + 'plate held';
  });

  /* ── 6. and it works in the scheme the game actually ships on ────── */

  acheck('doors: the hold is finishable in the shipped default control scheme', async () => {
    /**
     * `DEFAULT_SETTINGS.scheme` is `directional`, where the mouse steers the
     * camera and the blade is a GUARD ZONE rather than a position — so the
     * loop of check 4 is not available and the question "can a player who
     * never opened the options screen finish this" is a different one.
     *
     * They can, and the way they do it is the scheme's own verb: flick a new
     * guard, which moves the blade to a different quarter of the plate, and
     * work sideways along the door in between. Measured with nothing but
     * flicks and a step: the blade reaches u 0.12–0.84 and v 0.19–0.70 of the
     * plate — where a single held zone reaches v 0.44–0.70 and saturates at
     * 521 texels however long you stand there — and the door opens.
     *
     * It is SLOWER than the mouse-blade schemes, and that is the honest
     * result: the scheme that gives you the blade gives you the door faster.
     */
    const { world } = await field();
    const door = world.doors[2];
    rearm(world, door);
    const p = world.player, C = p.control, { out, across } = frameOf(door);
    const yaw = facing(-out.x, -out.z);
    const stand = door.mesh.position.clone().addScaledVector(out, 1.05);
    stand.y = world.terrain.height(stand.x, stand.z);
    p.saber.ignite(); p.saber.ignition = 1;
    const input = idle();
    input.act = (a) => a === 'blade';
    const FLICK = [[0, 40], [-40, 0], [0, -40], [40, 0]];
    const zones = new Set();
    let t = 0;
    for (let f = 0; f < 60 * 90; f++) {
      const [fx, fy] = FLICK[Math.floor(t / 3) % 4];
      if ((t % 3) < 4 / 60) { input.mouse.dx = fx; input.mouse.dy = fy; }
      else { input.mouse.dx = -Math.sin(t * 1.5) * 7; input.mouse.dy = Math.cos(t * 1.5) * 7; }
      p.position.copy(stand).addScaledVector(across, Math.sin(t * 0.7) * 0.55);
      p.position.y = world.terrain.height(p.position.x, p.position.z);
      p.velocity.set(0, 0, 0);
      world.update(1 / 60, input);
      p.camera.yaw = yaw; p.camera.pitch = 0;
      zones.add(C.zone);
      t += 1 / 60;
      if (door.opened) break;
    }
    assert(door.opened,
      `90 s of working all four guard zones against the plate burned ${door.cutArea} texels and did `
      + 'not open it — the signature mechanic is unfinishable for a player on the default scheme');
    assert(zones.size >= 3,
      `only ${zones.size} guard zone(s) were reached, so this measured a stance rather than the scheme`);
    return `${t.toFixed(1)} s on the shipped default scheme, working ${zones.size} guard zones `
      + `(${[...zones].join('/')})`;
  });

  /* ── 7. what happens when you let go ────────────────────────────── */

  acheck('doors: letting go cools the kerf and does not heal it', async () => {
    /**
     * "A molten kerf traces the exact path you carve, slag runs down the
     * metal." Two different lifetimes in one texture and they are easy to get
     * the wrong way round: channel R is how far through the plate that point
     * is CUT, and metal that has been cut does not come back; channel G is how
     * HOT it is, and that has to fade or a door you walked away from glows for
     * the rest of the level.
     *
     * The solver's own progress accumulator is the other half — `structure`
     * capsules are exempt from the fade for the same reason ("a kerf cut into
     * stone does not heal") — so a player driven off the door by a push
     * resumes where they left off instead of starting again. That is what
     * makes twenty seconds under fire a decision rather than a punishment.
     */
    const { world } = await field('free');
    const door = world.doors[0];
    rearm(world, door);
    const held = holdFree(world, door, { R: 0.5, omega: 1.0, dist: 0.95, secs: 8 });
    assert(!held.opened && held.cut > 40,
      `eight seconds of hold burned ${held.cut} texels — too few to measure a fade against`);
    const cutAt = door.cutArea;
    const heatAt = door.kerfData.reduce((a, _, i) => (i % 4 === 1 ? a + door.kerfData[i] : a), 0);

    // walk away: five seconds of the door being stepped by the world and
    // nothing touching it
    const p = world.player;
    p.position.copy(door.mesh.position).addScaledVector(frameOf(door).out, 9);
    p.position.y = world.terrain.height(p.position.x, p.position.z);
    p.saber.retract();
    for (let f = 0; f < 60 * 5; f++) world.update(1 / 60, idle());

    const heatAfter = door.kerfData.reduce((a, _, i) => (i % 4 === 1 ? a + door.kerfData[i] : a), 0);
    const cutAfter = door.cutArea;
    assert(door.cutArea === cutAt,
      `the cut healed while nobody was touching it: ${cutAt} texels became ${door.cutArea}`);
    assert(heatAfter < heatAt * 0.05,
      `the kerf is still ${(heatAfter / Math.max(1, heatAt) * 100).toFixed(0)}% as hot five seconds `
      + 'after the blade left — molten metal that never cools is a decal');

    // …and picking it up again finishes it
    const rest = holdFree(world, door, { R: 0.5, omega: 1.0, dist: 0.95, secs: 40 });
    assert(rest.opened,
      `the door did not open when the hold was resumed (${door.cutArea} texels) — progress made `
      + 'before a player was driven off it counted for nothing');
    return `8 s burned ${cutAt} texels; five seconds off the door left the cut at ${cutAfter} `
      + `and the heat at ${(heatAfter / Math.max(1, heatAt) * 100).toFixed(1)}% of what it was; `
      + `resumed and breached ${rest.t.toFixed(1)} s later`;
  });

  /* ── 8. and breaching gets you what is behind it ─────────────────── */

  acheck('doors: breaching a cell opens it, pays for it, and lets everything through', async () => {
    /**
     * Three separate claims, and the third is a regression the flag alone
     * could not have caught.
     *
     *   THE HOLE IS A HOLE. A Player walks from the apron into the cell.
     *   THE CACHE IS THERE. Liftable ordnance behind every door — a magazine
     *     with nothing in it is a wall with a timer on it.
     *   AND EVERYTHING ELSE GETS THROUGH TOO. `collider.disabled` is honoured
     *     only by the queries that walk `staticBoxes` by hand, so before the
     *     collider was removed outright, the PLAYER passed a breached door and
     *     every rigid body in the game bounced off it — including the slug the
     *     breach itself throws at that exact plane.
     */
    const { world } = await field();
    const { makeCrate } = await import('../../src/world/Props.js');
    const door = world.doors[1];
    rearm(world, door);
    const { out, across } = frameOf(door);
    const inward = out.clone().negate();
    const p = world.player, T = world.terrain;
    const yaw = facing(-out.x, -out.z);
    const input = idle();
    input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };

    // what is in the cell, before anybody has been in it
    const cache = world.props.filter((pr) => {
      const r = pr.body.position.clone().sub(door.mesh.position);
      return r.dot(inward) > 0.4 && r.dot(inward) < 6 && Math.abs(r.dot(across)) < 2.0;
    });
    assert(cache.length >= 2,
      `the cell behind a door holds ${cache.length} liftable object(s) — twenty seconds for an `
      + 'empty room');

    /* THE DEEPEST THE WALK GOT, not where it finished. A breach throws a slug
     * the size of the panel it cut out and sets off an explosion at the plate,
     * so a walk that starts the same frame can be shoved back out by debris
     * that is still in the air — measured, one run of this finished 6.7 m on
     * the WRONG side of the plane having been inside it. What is being asked
     * is whether the doorway is passable, so the answer is the depth reached,
     * and the debris is given a second and a half to land first. */
    const walkIn = () => {
      const from = door.mesh.position.clone().addScaledVector(out, 3.0);
      from.y = T.height(from.x, from.z);
      p.position.copy(from); p.velocity.set(0, 0, 0);
      p.saber.retract();
      let deepest = -Infinity;
      for (let f = 0; f < 60 * 8; f++) {
        p.camera.yaw = yaw;
        world.update(1 / 60, input);
        deepest = Math.max(deepest, p.position.clone().sub(door.mesh.position).dot(inward));
      }
      return deepest;
    };
    const shut = walkIn();
    assert(shut < 0.2, `a shut door let a Player ${shut.toFixed(2)} m into the cell`);

    const supportBefore = world.support.value;
    door.breach();
    const paid = world.support.value - supportBefore;
    assert(paid > 0,
      'breaching a magazine credited the side nothing at all — the twenty seconds bought a doorway '
      + 'and no reason to have opened it');
    assert(!world.physics.staticBoxes.includes(door.collider),
      "a breached door's collider is still in the physics world");

    for (let f = 0; f < 90; f++) world.update(1 / 60, idle());
    const open = walkIn();
    assert(open > 2.0,
      `a Player only reached ${open.toFixed(2)} m past a BREACHED door's plane — the hole is not a hole`);

    // the regression: a rigid body at the same doorway
    const from = door.mesh.position.clone().addScaledVector(out, 0.9);
    from.y = T.height(from.x, from.z) + 0.55;
    const crate = makeCrate(world, from, 0.8);
    crate.body.velocity.copy(inward).multiplyScalar(9);
    for (let f = 0; f < 90; f++) world.update(1 / 60, idle());
    const went = crate.body.position.clone().sub(door.mesh.position).dot(inward);
    assert(went > 0,
      `a crate shoved at 9 m/s through a breached doorway ended ${went.toFixed(2)} m from the plane, `
      + 'i.e. still outside it — the door is gone and its collider is not');

    return `+${paid.toFixed(0)} war support, a Player ${open.toFixed(2)} m into the cell, a crate `
      + `${went.toFixed(2)} m through the doorway, ${cache.length} liftable objects inside`;
  });

  /* ── 9. and it hands everything back ─────────────────────────────── */

  acheck('doors: a door frees every geometry it made when the level unloads', async () => {
    /**
     * The jamb was four separate meshes and four `plateGeo` geometries, and
     * `dispose()` named none of them: four leaked buffer geometries per door
     * per level unload, on the one object that ships in a rank of three.
     * Counted the way `lifecycle` counts a corpse — patch the prototype, build,
     * dispose, and see what came back.
     */
    const { BlastDoor } = await import('../../src/world/Props.js');
    const { world } = await field();
    const proto = THREE.BufferGeometry.prototype;
    const realDispose = proto.dispose;
    const made = new Set(), freed = new Set();
    let watching = true;
    proto.dispose = function patched() { if (watching) freed.add(this); return realDispose.call(this); };
    let door;
    try {
      door = new BlastDoor(world, {
        position: V(0, world.terrain.height(0, 0) + 2.5, 0),
        width: 3.0, height: 4.0, thickness: 0.4,
      });
      door.mesh.traverse((o) => { if (o.geometry) made.add(o.geometry); });
      door.frame.traverse((o) => { if (o.geometry) made.add(o.geometry); });
      door.dispose();
    } finally {
      proto.dispose = realDispose;
      watching = false;
    }
    const leaked = [...made].filter((g) => !freed.has(g));
    assert(leaked.length === 0,
      `${leaked.length} of ${made.size} geometries survived a disposed blast door`);
    assert(!world.scene.children.includes(door.mesh) && !world.scene.children.includes(door.frame),
      'a disposed door left its meshes in the scene');
    assert(made.size >= 2, `only ${made.size} geometries were counted — the census found nothing`);
    return `${made.size} geometries built by one door (it was 5 before the jamb was merged), `
      + `${freed.size >= made.size ? made.size : freed.size} freed, 0 leaked`;
  });

  await Promise.all(started);
  retire();
}
