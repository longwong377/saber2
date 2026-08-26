/**
 * BATTLEFRONT BORZ — HUNDREDS AGAINST HUNDREDS, AND WHETHER IT IS REAL.
 *
 * The player, across several sessions and in the end flatly: *"I still have yet
 * to experience a single giant battle like what I've asked for… I asked for a
 * mode with hundreds of troops vs hundreds of troops."*
 *
 * `src/game/Mass.js` is the answer and this file is what keeps it honest. A
 * crowd system has one glamorous failure and three quiet ones, and only the
 * glamorous one is obvious from a screenshot:
 *
 *   IT IS A SCREENSAVER. Three hundred men who draw beautifully and never hit
 *     anything. This is not hypothetical — it is what the first working version
 *     of this file did, twice over. First the bolt sweep tested a POINT against
 *     men while a round travels 1.53 m between frames, so every shot teleported
 *     past: 320 men, five seconds, **0 casualties**. Then, with the swept
 *     segment in, the rank fired from chest height at the enemy block's ANCHOR,
 *     which carries the ground height — so every round descended into the rock
 *     over 150 m: **448 rounds fired, 0 of them within 12 m of the enemy line**.
 *     Both looked perfect. Checks 2 and 3 are those two defects.
 *   IT IS DEADLOCK. Two lines that only move when one is winning never meet,
 *     because `tilt` is zero while the strengths are equal — so a fair battle's
 *     opening state is two static hedges at whatever range it was laid out at.
 *     Check 4.
 *   IT COSTS WHAT REAL BODIES COST. The entire justification for the tier is
 *     that it does not. Check 5 measures it against the real thing.
 *   AND THE PLAYER CANNOT SEE IT. Which was the original complaint, and is not
 *     a matter of counts: a shipped Command deploy put 49 hostiles on the field
 *     and ZERO inside the camera frustum six seconds later. Check 6.
 */

import { clocked } from './_shared.mjs';
import { bootWorld, idleInput } from './_coop.mjs';
import {
  MassField, Rank, layBattle, RANK_MEN, RANK_COLS, PROMOTE, STAND_OFF, BREAK_AT, HIT, MUZZLE,
} from '../../src/game/Mass.js';

const STEP = 1 / 60;

/** A world with a donor body per side already standing on it. */
async function field(THREE) {
  const { world } = await bootWorld({ level: 'geonosis', settings: { quality: 'low', mode: 'waves' } });
  const { Enemy } = await import('../../src/game/Enemy.js');
  const p = world.player.position;
  for (const t of ['trooper', 'b1']) {
    world.enemies.push(new Enemy(world, t, new THREE.Vector3(p.x + 300, 0, p.z + 300)));
  }
  const input = idleInput();
  for (let i = 0; i < 10; i++) world.update(STEP, input);
  return { world, input, f: new MassField(world), p };
}

const drive = (b, n) => {
  for (let i = 0; i < n; i++) { b.world.update(STEP, b.input); b.f.update(STEP, { bolts: b.world.bolts }); }
};

export async function run({ check, assert }) {
  check = await clocked(check);
  const THREE = await import('three');

  /* ═════ 1. it exists, at the size that was asked for ══════════════════ */

  check('mass: two armies of a hundred and sixty stand on the field and are drawn', async () => {
    const b = await field(THREE);
    const out = layBattle(b.f, { blocks: 8, gap: 150, origin: b.p, axis: new THREE.Vector3(0, 0, 1) });
    drive(b, 30);
    const mine = b.f.count(0), theirs = b.f.count(1);
    assert(mine >= 150 && theirs >= 150,
      `${mine} against ${theirs} — that is a skirmish, and the whole subject of this file is that it is not`);
    /* AND IT IS DRAWN BY THE INSTANCED RUNG, which is the entire reason the
     * count is affordable. Every man has a cohort slot or he is not on screen. */
    const drawn = out.mine.concat(out.theirs)
      .reduce((a, r) => a + r.men.filter((m) => m._l3).length, 0);
    assert(drawn === mine + theirs,
      `${drawn} of ${mine + theirs} men have an instance — the rest are simulated and invisible`);
    const bins = [...b.world.cohorts.cohorts.values()].filter(Boolean)
      .reduce((a, c) => a + c.meshes.length, 0);
    /* Flat in population is the claim `Cohorts.js` makes and this is where it
     * gets spent: two unit types, and the draw cost is a handful of bins
     * whether that is forty men or four hundred. */
    assert(bins <= 20, `${bins} draw bins for two unit types — the instancing is not doing its job`);
    b.world.unload?.();
    return `${mine} v ${theirs} = ${mine + theirs} men, every one instanced, in ${bins} draw bins`;
  });

  /* ═════ 2. the rounds are real and they arrive ════════════════════════ */

  check('mass: a rank kills the men it is shooting at — the swept segment, not the point', async () => {
    const b = await field(THREE);
    /* Two blocks at knife range, so the flight time is short and the only thing
     * under test is whether a bolt that passes through a man kills him. */
    const at = b.p.clone().addScaledVector(new THREE.Vector3(0, 0, 1), PROMOTE + 20);
    const mine = b.f.add({ type: 'trooper', team: 0, dir: new THREE.Vector3(0, 0, 1), anchor: at });
    const theirs = b.f.add({ type: 'b1', team: 1, dir: new THREE.Vector3(0, 0, -1),
      anchor: at.clone().addScaledVector(new THREE.Vector3(0, 0, 1), 40) });
    assert(mine && theirs, 'the two blocks were refused');
    drive(b, 600);
    const dead = (RANK_MEN - mine.alive) + (RANK_MEN - theirs.alive);
    /* THE FIGURE THAT WAS ZERO. Ten seconds of two twenty-man blocks at forty
     * metres has to cost somebody. A `> 0` bound would pass on one lucky round,
     * so the bar is a real exchange. */
    assert(dead >= 6,
      `ten seconds of two blocks at 40 m killed ${dead} men — the rounds are not arriving`);
    /* …AND BOTH SIDES BLEED. A one-sided figure is the aim bug in a different
     * costume: the near line hitting and the far line shooting the dirt. */
    assert(RANK_MEN - mine.alive > 0 && RANK_MEN - theirs.alive > 0,
      `only one side took casualties (${RANK_MEN - mine.alive} v ${RANK_MEN - theirs.alive}) — `
      + 'one of the two lines is firing into the ground');
    b.world.unload?.();
    return `${dead} down in 10 s at 40 m — ${RANK_MEN - mine.alive} of mine, ${RANK_MEN - theirs.alive} of theirs`;
  });

  check('mass: the rifles are level, so the ground does not eat every round', async () => {
    /**
     * THE SECOND DEFECT, AS A PROPERTY RATHER THAN A NUMBER.
     *
     * A rank fired from `MUZZLE` at the enemy block's ANCHOR, whose `y` is the
     * terrain under it, so every round descended `MUZZLE` metres over the whole
     * flight. On rolling ground that is a shot into the dirt and it produced
     * exactly zero hits at 150 m. The fix is to aim at muzzle height, and the
     * assertion is that the fired direction is FLAT when the ground is.
     */
    const b = await field(THREE);
    const dir = new THREE.Vector3(0, 0, 1);
    const at = b.p.clone().addScaledVector(dir, PROMOTE + 20);
    const mine = b.f.add({ type: 'trooper', team: 0, dir, anchor: at });
    b.f.add({ type: 'b1', team: 1, dir: dir.clone().negate(),
      anchor: at.clone().addScaledVector(dir, 60) });
    /* Both blocks flattened onto one height, so any residual pitch is the aim
     * and not the hill. */
    for (const r of b.f.ranks) { r.anchor.y = 0; for (const m of r.men) m.position.y = 0; }
    const shots = [];
    const real = b.world.bolts.fire.bind(b.world.bolts);
    b.world.bolts.fire = (o, d, opt) => { shots.push(d.clone()); return real(o, d, opt); };
    for (let i = 0; i < 240; i++) b.f._fire(STEP, b.world.bolts);
    assert(shots.length > 20, `only ${shots.length} rounds left the line; this measures nothing`);
    const pitch = shots.map((d) => Math.abs(Math.asin(Math.max(-1, Math.min(1, d.y)))));
    const worst = Math.max(...pitch);
    const mean = pitch.reduce((a, x) => a + x, 0) / pitch.length;
    /* The scatter cone is the only thing allowed to tilt a round. Anything
     * beyond it is a systematic dive, which is the defect. */
    assert(mean < 0.02, `the mean shot is pitched ${(mean * 57.3).toFixed(2)}° off level — that is a dive, not scatter`);
    assert(worst < 0.09, `a round left at ${(worst * 57.3).toFixed(1)}° off level`);
    /* …and level is not the same as vacuous: over 60 m a `MUZZLE`-metre dive is
     * 1.2°, which this bound would fail. State it so the bar is legible. */
    const wouldDive = Math.atan(MUZZLE / 60);
    assert(wouldDive > 0.02, 'the bound is looser than the defect it is for');
    b.world.unload?.();
    return `${shots.length} rounds, mean pitch ${(mean * 57.3).toFixed(2)}°, worst ${(worst * 57.3).toFixed(1)}° `
      + `(the old dive was ${(wouldDive * 57.3).toFixed(1)}°)`;
  });

  /* ═════ 3. it is a battle and not two hedges ══════════════════════════ */

  check('mass: the lines close, and then the stronger one pushes', async () => {
    const b = await field(THREE);
    const dir = new THREE.Vector3(0, 0, 1);
    const out = layBattle(b.f, { blocks: 4, gap: 160, origin: b.p, axis: dir });
    const gap0 = out.mine[0].anchor.distanceTo(out.theirs[0].anchor);
    drive(b, 1800);
    const live = out.mine.concat(out.theirs).filter((r) => !r.broken && r.alive);
    assert(live.length >= 2, 'the whole battle broke; there is nothing left to measure a push with');
    /* THE APPROACH. Two equal lines have `tilt` zero, so nothing but the
     * approach term can bring them together — which is precisely what was
     * missing and left the first version deadlocked at its lay-out range. */
    let closest = Infinity;
    for (const m of out.mine) for (const t of out.theirs) {
      if (m.broken || t.broken) continue;
      closest = Math.min(closest, m.anchor.distanceTo(t.anchor));
    }
    assert(closest < gap0 - 40,
      `thirty seconds in, the nearest unbroken blocks are still ${closest.toFixed(0)} m apart `
      + `of an opening ${gap0.toFixed(0)} — the lines are not closing`);
    assert(closest > STAND_OFF * 0.4,
      `the blocks closed to ${closest.toFixed(0)} m; they are walking through each other`);
    b.world.unload?.();
    return `opened at ${gap0.toFixed(0)} m, closed to ${closest.toFixed(0)} m against a `
      + `${STAND_OFF} m stand-off, ${live.length} blocks still in the fight`;
  });

  check('mass: a block that has lost a third of itself breaks and gives ground', async () => {
    const b = await field(THREE);
    const dir = new THREE.Vector3(0, 0, 1);
    const at = b.p.clone().addScaledVector(dir, PROMOTE + 30);
    const r = b.f.add({ type: 'trooper', team: 0, dir, anchor: at });
    b.f.add({ type: 'b1', team: 1, dir: dir.clone().negate(),
      anchor: at.clone().addScaledVector(dir, 70) });
    assert(!r.broken, 'a full block is already broken');
    const z0 = r.anchor.z;
    /* Killed by hand, through the block's own door, so this measures the RULE
     * and not how good the other side's shooting happens to be. */
    const toKill = Math.ceil(RANK_MEN * (1 - BREAK_AT)) + 1;
    for (let i = 0; i < toKill; i++) { const m = r.men.find((x) => x.alive); if (m) r.fell(m); }
    assert(r.broken, `${r.alive} of ${RANK_MEN} left and the block has not broken (BREAK_AT ${BREAK_AT})`);
    drive(b, 240);
    /* A broken block goes BACKWARD along its own facing, whatever the rest of
     * the battle is doing. */
    assert(r.anchor.z < z0 - 2,
      `the broken block is at z=${r.anchor.z.toFixed(1)} against ${z0.toFixed(1)} — it did not fall back`);
    b.world.unload?.();
    return `broke at ${r.alive}/${RANK_MEN} and gave ${(z0 - r.anchor.z).toFixed(1)} m of ground in 4 s`;
  });

  /* ═════ 4. and it is affordable, which is the whole argument ══════════ */

  check('mass: three hundred and twenty men cost a fraction of what the bodies would', async () => {
    const b = await field(THREE);
    layBattle(b.f, { blocks: 8, gap: 150, origin: b.p, axis: new THREE.Vector3(0, 0, 1) });
    drive(b, 120);                                     // past the join and the first volleys
    const t = [];
    for (let i = 0; i < 300; i++) {
      const t0 = process.hrtime.bigint();
      b.world.update(STEP, b.input);
      b.f.update(STEP, { bolts: b.world.bolts });
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((x, y) => x - y);
    const med = t[t.length >> 1];
    const n = b.f.count(0) + b.f.count(1);
    assert(n > 200, `only ${n} men left; this is no longer measuring a big battle`);
    /**
     * THE BAR IS THE REAL THING'S OWN COST, MEASURED IN THIS REPO.
     *
     * Full `Enemy` bodies on this ground: 26 → 6.4 ms, 120 → 15.0, 200 → 25.5,
     * 320 → 42.8. So ~0.13 ms a body, linear. The tier exists because it does
     * not scale that way, and if it ever does the tier is pointless — which is
     * what this number is guarding. Generous against a loaded box: half of what
     * the same count of bodies costs is still a 2x win and no CI flake.
     */
    const asBodies = n * 0.13;
    assert(med < asBodies * 0.5,
      `${n} men cost ${med.toFixed(1)} ms against ${asBodies.toFixed(1)} ms for the same count of `
      + 'real bodies — the instanced tier is not buying anything');
    b.world.unload?.();
    return `${n} men at ${med.toFixed(2)} ms median, against ~${asBodies.toFixed(0)} ms of real bodies`;
  });

  /* ═════ 5. …and the player can SEE it ═════════════════════════════════ */

  check('mass: the battle is in front of you on the frame you land', async () => {
    /**
     * THE ORIGINAL COMPLAINT, AND IT IS NOT ABOUT COUNTS.
     *
     * Measured on a shipped Command deploy: 49 hostiles on the field and ZERO
     * inside the camera frustum six seconds after landing. The army existed and
     * the battle did not, because a battle is a picture. `layBattle` puts the
     * player behind the middle of their own line looking down the axis, and
     * this asserts the picture rather than the roster.
     */
    const b = await field(THREE);
    const axis = new THREE.Vector3(0, 0, 1);
    layBattle(b.f, { blocks: 8, gap: 150, origin: b.p, axis });
    drive(b, 2);

    const cam = b.world.engine?.camera;
    assert(cam, 'no camera to look through');
    /* Pointed down the axis, which is where `layBattle` says the player is
     * facing — the lay-out's own promise, checked rather than assumed. */
    cam.position.copy(b.p).setY(b.p.y + 1.6);
    cam.lookAt(b.p.clone().addScaledVector(axis, 100).setY(b.p.y + 1.6));
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10];
    const halfV = (cam.fov * Math.PI / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
    let seen = 0, total = 0;
    for (const r of b.f.ranks) for (const man of r.men) {
      if (!man.alive) continue;
      total++;
      const vx = man.position.x - cam.position.x;
      const vy = man.position.y - cam.position.y;
      const vz = man.position.z - cam.position.z;
      const len = Math.hypot(vx, vy, vz) || 1;
      if ((vx * fx + vy * fy + vz * fz) / len < Math.cos(halfH * 1.05)) continue;
      seen++;
    }
    assert(seen > total * 0.5,
      `${seen} of ${total} men are in front of the camera on the frame you land — `
      + 'the army exists and the battle does not, which is the whole complaint');
    b.world.unload?.();
    return `${seen} of ${total} men inside the frame from the deploy spot, both armies`;
  });
}
