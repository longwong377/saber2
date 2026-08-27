/**
 * WHAT THE FIELD STILL HOLDS WHEN THE FIGHT IS OVER.
 *
 * `undertaker.mjs` already asks whether the corpse ledger is honest — no
 * ghosts, nothing held past its bound, and every corpse the BUDGET spends laid
 * down as a prone instance instead of deleted. Every one of those properties
 * was green throughout the defect this file is about, because none of them
 * asks the question a player asks, which is: *is anybody still lying there?*
 *
 * ── WHAT A MINUTE OF DRIVING FOUND ──────────────────────────────────────
 *
 * Colosseum sandbox at `high`, 24 B1s spawned, the handful the room keeps
 * killed at once, driven for a minute (`world.fallen` is the prone field):
 *
 *              corpse bodies   retired   prone figures   scene meshes
 *      t= 2 s        6            0            0             581
 *      t=30 s        6            0            0             766
 *      t=60 s        0            0            0             509
 *
 * Nothing. Fewer meshes than before the men were ever spawned, and the corpse
 * ledger reporting that it had retired nobody — because it had not. `Corpses`
 * bounds the dead with a budget of twenty and six never reached it; what
 * actually ended every one of those bodies was `Enemy.update`'s
 * `return this.dying < 40`, a flat forty-second timer in another file, and
 * `Corpses.update` spliced the record out on `e.disposed` without laying
 * anything down. The budget's own header argues at length against a timer, and
 * a timer was doing all the work underneath it.
 *
 * The three checks here are the three halves of "the ground remembers", and
 * two of them failed on the build they were written against:
 *
 *   1. THE DEAD STAY. A man is still on the field after the world has taken
 *      his body away. **Failed: 0 of the 5 the room kept.**
 *
 *      A LONG DRIVE MAKES THIS LOOK SMALLER THAN IT IS, and the size of it is
 *      worth stating: 120 waves of eight B1s, 894 deaths, and the shipped
 *      build laid 875 of them down and lost 19. Nineteen, because in a fight
 *      that big the BUDGET sinks almost everybody before their fortieth second
 *      arrives — and the nineteen it loses are the ones still inside the
 *      budget when the shooting stopped, which by construction are the
 *      nearest, freshest and most in front of the player. So the check is
 *      deliberately a SMALL fight: below the budget the teardown is the only
 *      ending a corpse has, and there the loss is all of them.
 *   2. THE GROUND IS MARKED. `Terrain.scars` — the field that never ages and
 *      is the only thing on the ground that says a war happened here — knew
 *      nothing about a saber kill, which lands no bolt and digs no crater.
 *      **Failed: 0.000 scorch at all five death sites.**
 *   3. AND IT FIGHTS DIFFERENTLY. The wrecks `Front.marchFront` strews are
 *      cover the army's own hunt will choose, on the burnt side only. This one
 *      PASSED and is here as a guard, because it is the half of the thesis
 *      that is gameplay rather than dressing and nothing was measuring it —
 *      `marchFront`'s comment claims "on the burnt side ONLY" and no check
 *      had ever asked.
 *
 * ── NOTHING HERE ASKS WHETHER A THING EXISTS ────────────────────────────
 *
 * HANDOFF §2.3. Every assertion below is a count taken off a driven world
 * after the event it is about has actually happened, and each one is driven
 * UNTIL it has happened rather than for a fixed wall of frames — `World`
 * scales `dt` for hitstop and kill-time, so a fixed number of steps is not a
 * fixed number of seconds and the first draft of check 1 failed against a
 * working fix for exactly that reason (the same trap `undertaker.mjs` names).
 *
 * §2.4: the two numbers this file could have restated are both imported.
 * `FALLEN_SCORCH` is what one man's fall is worth and `SurfaceField.stack` is
 * how much of a burn the ground keeps, so the count of bodies it takes to
 * blacken a cell is DERIVED from the two of them rather than typed — a build
 * that changed either would move the check with it. And "is this cover?" is
 * never answered here at all: `CommandDirector._coverSite` is the army's own
 * hunt and it is asked directly, so this file holds no copy of how tall a
 * thing has to be before a man will get behind it.
 */

import * as THREE from 'three';
import { bootWorld, idleInput } from './_coop.mjs';
import { clocked } from './_shared.mjs';

const STEP = 1 / 30;
/** Step a world for `seconds` of game time. */
const drive = (world, seconds, input) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) world.update(STEP, input);
};

/** Put a body on the ground at (x, z), whatever the ground is doing there. */
function stand(world, type, x, z) {
  const p = new THREE.Vector3(x, 0, z);
  p.y = world.terrain?.height?.(x, z) ?? 0;
  return world.spawnEnemy(type, p);
}

/**
 * A ROOM FULL OF MEN, KILLED, AND DRIVEN PAST THE WORLD'S OWN TEARDOWN.
 *
 * Shared by the first two checks because they are two readings of the same
 * minute and booting a second World to take the second one would double the
 * slowest thing in this file.
 *
 * `WaveDirector._sandboxUpdate` decides what STAYS every frame and disposes
 * the rest, so what is asked for and what is on the floor are different
 * numbers — the caller is handed the bodies the ROOM kept, and nothing here
 * asserts against the count that was requested.
 */
async function aFightThatIsOver(assert) {
  const { world } = await bootWorld({
    level: 'colosseum', settings: { mode: 'sandbox', level: 'colosseum', quality: 'high' }, runSeed: 7,
  });
  const input = idleInput();
  const made = [];
  for (let i = 0; i < 24; i++) {
    const e = stand(world, 'b1', 8 + (i % 6) * 2.4, -10 + Math.floor(i / 6) * 2.4);
    if (e) made.push(e);
  }
  drive(world, 0.5, input);
  const kept = made.filter((e) => !e.disposed);
  assert(kept.length >= 4,
    `the sandbox room kept only ${kept.length} of ${made.length} bodies — too few for a fight to be over`);
  /* WHERE EACH MAN WAS STANDING WHEN HE DIED, taken before he dies because a
   * disposed Enemy is not a thing to read a position off. A ragdoll travels a
   * metre or two from here as it falls, which is why every distance below is
   * a loose one — the claim is "he is lying about where he fell", not "he is
   * lying on the pixel he was standing on". */
  const sites = kept.map((e) => ({ x: e.position.x, z: e.position.z }));
  for (const e of kept) { e.hp = 0; e.die?.(null, 'check'); }
  /* DRIVEN UNTIL THE WORLD HAS TORN THEM DOWN, not for a fixed wall of
   * frames. `Enemy.update` ends `return this.dying < 40` and `World.update`
   * disposes on that, so the event this check is about is forty scaled
   * seconds away and `dt` does not advance at one second per second. */
  let stepped = 0;
  while (stepped < 100 && kept.some((e) => !e.disposed)) { drive(world, 2, input); stepped += 2; }
  assert(kept.every((e) => e.disposed),
    `${kept.filter((e) => !e.disposed).length} of ${kept.length} bodies were still not torn down after `
    + `${stepped} s — this check needs the world's own teardown to have happened`);
  return { world, input, kept, sites, stepped };
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('fallen: the dead are still on the field after the world takes their bodies', async () => {
    /**
     * THE ONE PROPERTY A PLAYER CAN SEE, and the one nothing was asserting.
     *
     * Every count below is taken AFTER the forty-second teardown has fired on
     * every body, which is the moment the field used to empty itself. The
     * corpse ledger is asserted empty first — not as tidiness, but because a
     * build where the bodies were still standing would satisfy the figure
     * count for the wrong reason and this check would be measuring a fight
     * that was not over.
     */
    const { world, kept, sites } = await aFightThatIsOver(assert);
    const field = world.fallen;
    assert(field && field.meshes, 'no FallenField is attached, so nothing here is measuring anything');

    /* NONE OF OUR DEAD IS STILL A BODY. Scoped to the men this check killed
     * rather than to the whole ledger, because `WaveDirector._sandboxUpdate`
     * keeps the room populated for the whole minute and a body it spawned and
     * lost during it is a corpse this check did not make and is not about. */
    const held = (world.corpses?.list || []).filter((c) => kept.includes(c.e)).length;
    assert(held === 0,
      `${held} of the ${kept.length} men this check killed are still full Enemy graphs — the world's `
      + 'teardown has not run, so this check is not measuring what happens after it');

    /* THE PROPERTY FIRST, so that a build which does not do this says so in the
     * plainest sentence available rather than tripping over a counter that
     * does not exist yet. The ROOM's own dead count towards it — the sandbox
     * keeps refilling itself for the whole minute and anything it lost goes
     * through the same door — so this is a floor and not an equality. What
     * must be exact is that nobody was lost, which is the pair below. */
    assert(field.count >= kept.length,
      `${kept.length} men fell and the field is drawing ${field.count} of them a minute later`);
    assert(world.corpses.torn === kept.length,
      `${kept.length} bodies were torn down by the world and the ledger noticed ${world.corpses.torn}`);
    assert(world.corpses.buried === world.corpses.torn,
      `${world.corpses.torn - world.corpses.buried} of ${world.corpses.torn} men the world took away left `
      + 'nothing on the ground — they are simply gone from the field');

    /* AND THEY ARE LYING WHERE THEY FELL. A field that took the count and put
     * every figure at the origin would satisfy everything above. */
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const q = new THREE.Quaternion(), sc = new THREE.Vector3();
    let placed = 0, offGround = 0, adrift = 0, far = 0;
    for (const im of field.meshes) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        m.decompose(p, q, sc);
        placed++;
        const g = world.terrain?.height?.(p.x, p.z) ?? 0;
        /* Lying ON the ground: `LIE_SINK` is 4.5 cm and this allows twice it
         * either way rather than restating the constant. */
        if (Math.abs(p.y - g) > 0.1) offGround++;
        const d = Math.min(...sites.map((s) => Math.hypot(p.x - s.x, p.z - s.z)));
        if (d > 8) adrift++;
        far = Math.max(far, d);
      }
    }
    assert(placed === field.count, `the field says ${field.count} and is drawing ${placed}`);
    assert(offGround === 0, `${offGround} of ${placed} men are not lying on the ground`);
    assert(adrift === 0,
      `${adrift} of ${placed} men were laid down more than 8 m from anywhere anybody died — the `
      + `furthest is ${far.toFixed(1)} m, so the resting place is not being carried through the teardown`);

    /* THE PRICE, AS THE TWO NUMBERS IT IS — read before the teardown below
     * detaches the field, because a check that quotes its own teardown reports
     * zero for a thing it has just asserted is drawing something. */
    const calls = field.calls, standing = field.count;
    assert(calls === 2,
      `the field costs ${calls} draw calls; Fallen.js is two geometries and one material and cannot `
      + 'honestly cost more');
    world.dispose?.();
    return `${kept.length} men fell, the world tore down all ${kept.length} bodies, and ${standing} of `
      + `them are still lying on the field for ${calls} draw calls`;
  });

  check('fallen: the ground goes dark where men fell, and a heap is darker than a man', async () => {
    /**
     * `Terrain.scars` is the ground's long memory — whole-map, never ages,
     * burns stack — and it is written by bolts, by craters and by the front's
     * own dressing. A saber kill fires nothing and digs nothing, so a company
     * cut down on a patch of sand left that sand identical to sand nobody had
     * ever stood on. Measured before the fix, five men killed at their feet:
     * **0.000 at every one of the five resting places.**
     *
     * The second half of this check is the one that keeps it honest. "The
     * ground is marked" alone would pass on a build that blackened a cell
     * outright per body, which is a field of identical black dots and is the
     * exact failure `SCAR_STACK`'s own note warns about. So the count of
     * bodies it takes to blacken one cell is derived from the two constants
     * that decide it and asserted to be that count — not more, and not one.
     */
    const { FALLEN_SCORCH } = await import('../../src/world/Fallen.js');
    const { world, kept, sites } = await aFightThatIsOver(assert);
    const scars = world.terrain?.scars;
    assert(scars, 'this ground has no long memory at all, so nothing here is measuring anything');

    const marks = sites.map((s) => scars.scorchAt(s.x, s.z));
    const unmarked = marks.filter((v) => v <= 0).length;
    assert(unmarked === 0,
      `${unmarked} of ${kept.length} places where a man fell are still unmarked ground `
      + `(${marks.map((v) => v.toFixed(3)).join(' ')})`);

    /**
     * HOW MANY MEN IT TAKES TO BLACKEN A CELL, derived and then measured.
     *
     * `SurfaceField.burn` adds `heat * stack` at the centre of the mark and
     * clamps at 1, so the count is 1/(heat·stack) rounded up and this file
     * holds no copy of either number. Laid through the field's own `lay`,
     * which is the only door a retired man goes through, on ground far enough
     * from the fight to be virgin.
     */
    const need = Math.ceil(1 / (FALLEN_SCORCH * scars.stack));
    assert(need >= 3,
      `one man in ${need} blackens the ground he falls on, which is a field of identical black dots `
      + '— see SCAR_STACK');
    /* ON THE CENTRE OF A CELL, and that is not fussiness — it is what makes the
     * count above exact. `SurfaceField.burn` falls off as `(1 - d²)·1.5` across
     * the mark, so a body that lands on a cell BOUNDARY gives that cell about
     * nine tenths of the heat and takes an extra man to blacken it. Measured:
     * seven bodies on an arbitrary point reached 0.953 and seven on a cell
     * centre reached exactly 1.000. The centre is derived from the field's own
     * `cell` — its cells are `floor(v / cell)` — so this holds no copy of the
     * grid. What a real body does is the off-centre case, and that is what the
     * five death sites above are. */
    const cellMid = (v) => (Math.floor(v / scars.cell) + 0.5) * scars.cell;
    const x = cellMid(120), z = cellMid(-120);
    assert(scars.scorchAt(x, z) === 0, 'the control ground was already marked');
    const ramp = [];
    for (let i = 0; i < need; i++) {
      world.fallen.lay(x, z, 0, 0.1, null, 1);
      ramp.push(scars.scorchAt(x, z));
    }
    assert(ramp[0] > 0 && ramp[0] < 0.5,
      `one man alone takes the ground to ${ramp[0].toFixed(3)} — a lone body is supposed to be a smudge`);
    for (let i = 1; i < ramp.length; i++) {
      assert(ramp[i] > ramp[i - 1],
        `the ${i + 1}th man to fall on the same cell did not darken it (${ramp[i - 1].toFixed(3)} → `
        + `${ramp[i].toFixed(3)}) — the ground is recording the hottest mark rather than the count`);
    }
    assert(ramp[ramp.length - 1] >= 0.999,
      `${need} men on one cell leaves it at ${ramp[ramp.length - 1].toFixed(3)} rather than black`);
    world.dispose?.();
    return `${kept.length} men marked the ground they fell on `
      + `(${marks.map((v) => v.toFixed(2)).join(' ')}); ${need} on one cell blackens it`;
  });

  check('fallen: the burnt side carries cover the clean side does not', async () => {
    /**
     * THE HALF THAT IS GAMEPLAY RATHER THAN DRESSING.
     *
     * `Front.marchFront`'s §4 comment claims its wrecks land "on the burnt
     * side ONLY, which is the half of this that `strewWrecks` could not
     * previously express", and nothing had ever asked. It is worth asking
     * because a hull is not scenery: it is a static box, and
     * `CommandDirector._coverSite` walks `physics.staticBoxes` looking for
     * something a man can get behind. So the ground the line has crossed is
     * the ground with cover on it, and that is a fact about how the next
     * engagement is FOUGHT.
     *
     * ASKED THROUGH THE ARMY'S OWN HUNT and not through a copy of its rule.
     * `_coverSite` owns how tall a thing has to be and how wide, and a second
     * opinion here would be the ninth time this repository wrote a number
     * down twice (§2.4). What this file supplies is a trooper, a bearing and a
     * threat; the answer is the game's.
     *
     * MEASURED on geonosis, seed 7, engagement 1: 13 boxes within 60 m of the
     * line before the front is dressed and 21 after — 12 hull frames added, all
     * twelve on the burnt side, 20 to 50 m past the line. The hunt moves a man
     * 5.0 m and leaves him 3.5 m from the hull's centre, which is behind it.
     */
    const { world } = await bootWorld({
      level: 'geonosis', settings: { mode: 'command', level: 'geonosis', quality: 'low' }, runSeed: 7,
    });
    const F = await import('../../src/world/Front.js');
    const B = await import('../../src/world/Battlefield.js');
    const { strewWrecks } = await import('../../src/game/Levels.js');
    const dir = world.command;
    assert(dir && typeof dir._coverSite === 'function',
      'this world has no CommandDirector, so there is nobody here to take cover');

    const SEED = 7;
    const front = F.engagementFront(world, 1, { seed: SEED });
    const line = B.frontLine(front);
    const before = world.physics.staticBoxes.slice();
    const out = F.marchFront(world, { engagement: 1, seed: SEED, strewWrecks, wrecks: 3, fallen: 60 });
    assert(out.wrecks > 0,
      'the front laid no wrecks at all on this ground, so this check is measuring nothing');
    const added = world.physics.staticBoxes.filter((b) => !before.includes(b));
    assert(added.length > 0, `${out.wrecks} wreck clusters went down and added no static box`);

    /* ON THE BURNT SIDE ONLY — `burnt` is the front's own reader and the same
     * one the smoke columns are filtered through. */
    const clean = added.filter((b) => !F.burnt(front, b.center.x, b.center.z));
    assert(clean.length === 0,
      `${clean.length} of ${added.length} pieces the front strewed landed on ground the line has not `
      + `reached (${clean.slice(0, 4).map((b) => line.side(b.center.x, b.center.z).d.toFixed(0)).join(', ')} m `
      + 'short of it) — the burnt half of the field is supposed to be the half with the wrecks on it');

    /**
     * AND A MAN WILL ACTUALLY GET BEHIND ONE.
     *
     * Started eight metres in FRONT of a hull, on the threat's own side of it,
     * so a hunt that did nothing would leave him in the open. `COVER_HUNT` is
     * the radius the ordered TAKE COVER uses and it is read off Command.js
     * rather than typed. The cache key is a fresh epoch so the answer is
     * solved here rather than inherited.
     */
    const C = await import('../../src/game/Command.js');
    const T = front.dir;
    let moved = 0, behind = Infinity, tried = 0;
    for (const b of added) {
      /* Eight metres upwind of the hull along the axis of advance — which is
       * where the threat is, so the far side of the hull is a real move. */
      const A = { pos: new THREE.Vector3(b.center.x + T.x * 8, 0, b.center.z + T.z * 8), yaw: front.bearing };
      const e = { position: A.pos.clone() };
      const pt = new THREE.Vector3().copy(A.pos);
      tried++;
      dir._coverSite(e, pt, A, C.COVER_HUNT, 9000 + tried, 1);
      const d = Math.hypot(pt.x - b.center.x, pt.z - b.center.z);
      if (d < behind) { behind = d; moved = Math.hypot(pt.x - A.pos.x, pt.z - A.pos.z); }
    }
    assert(moved > 1,
      `the army's own cover hunt looked at ${tried} hull frames the front had just put on the burnt side `
      + 'and did not move a man off his slot for any of them — the wrecks are scenery');
    assert(behind < 8,
      `the nearest the hunt would stand a man to a hull is ${behind.toFixed(1)} m, which is not behind it`);
    world.dispose?.();
    return `${added.length} pieces on the burnt side and none on the clean; the hunt moves a man `
      + `${moved.toFixed(1)} m to end ${behind.toFixed(1)} m from a hull`;
  });
}
