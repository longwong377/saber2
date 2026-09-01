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

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import { bootWorld, idleInput } from './_coop.mjs';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
import { MODES, playableModes } from '../../src/game/Waves.js';
import {
  MassField, Rank, layBattle, blockage,
  RANK_MEN, RANK_COLS, PROMOTE, STAND_OFF, BREAK_AT, HIT, MUZZLE,
} from '../../src/game/Mass.js';

const STEP = 1 / 60;
const read = (f) => readFile(new URL('../../' + f, import.meta.url), 'utf8');

/**
 * WHICH MODES FIELD A MASS BATTLE, ASKED OF THE TABLE THAT OWNS THEM.
 *
 * Not `'thefront'`. `Mass.openFront` names no mode either — it reads
 * `MODES[mode].massBattle` for the size, the same way `World.loadLevel` reads
 * `objectives` and `fireMissions` — so the day a second mass mode is authored
 * it is checked by these rows and not by a copy of them.
 */
const MASS_MODES = Object.entries(MODES).filter(([, M]) => M.massBattle);

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

  /* ═════ 6. …and a MODE actually deploys into it ═══════════════════════ */

  /**
   * EVERY CHECK ABOVE THIS LINE BUILT ITS OWN BATTLE, and for the whole life of
   * this file that was the only kind there was: `grep -rn 'MassField\|layBattle'
   * src/` outside Mass.js returned ZERO. Seven green rows over a tier no player
   * could reach — which is the same defect as the empty camera frustum in check
   * 5, one layer further out. A suite that only ever calls the machinery itself
   * cannot tell a wired mode from an unwired one.
   *
   * So these two boot the MODE. The battle is laid by nothing this file typed:
   * the world builds the mode's own director, `director.start(1)` is the line
   * `main.js` deploys every non-Command mode with, `openFront` is the one door
   * beside it, and the per-frame drive is `world.update` and nothing else.
   */

  check('the front: the mode is on the Deploy panel, built from the table and nothing else', async () => {
    /**
     * THE MENU BUILDS ITSELF OUT OF `MODES`, so a correct row needs no Menu.js
     * edit — and that sentence is worth exactly as much as a check of it.
     * `Menu._buildModes` walks `Object.entries(MODES)`, and this asserts the
     * card, its name, its tooltip and the fact that pressing it writes the
     * setting the deploy path reads.
     *
     * SYNCHRONOUS from `install()` to `close()`, for the reason
     * `tools/checks/menu.mjs` gives at length: a fake `document` is a global,
     * and a check that awaits while one is installed hands its page to whatever
     * runs next.
     */
    const html = await read('index.html');
    assert(MASS_MODES.length > 0,
      'no mode declares `massBattle` — the mass tier is unreachable again and the rest of '
      + 'this file is measuring a machine nobody can deploy into');
    const doc = makeDocument(html);
    const restore = doc.install();
    try {
      const settings = { ...structuredClone(DEFAULT_SETTINGS) };
      const menu = new Menu(settings, { onDeploy() {} });
      const cards = [...doc.getElementById('mode-list').children];
      /**
       * AGAINST `playableModes()`, NOT AGAINST THE WHOLE TABLE.
       *
       * `MODES` is the table of DESTINATIONS — everything `World.loadLevel`,
       * `Extraction` and the theatre column need to know about a place the
       * game can put you — and one of those places is not a card: the flight
       * deck is reached from the Company tab by a door, and offering a hangar
       * as something to deploy INTO would put one in the theatre grid, which
       * is a shape `Levels.js` has deleted three times.
       *
       * `playableModes()` is the one derivation of "which of these is a
       * choice", and its own note names the menu's card builder and the two
       * checks that count cards against modes as its consumers. This is one of
       * those two, and it was still counting the whole table.
       */
      const pickable = playableModes();
      assert(cards.length === pickable.length,
        `${cards.length} cards for ${pickable.length} pickable modes — the panel is not the table`);
      const rows = [];
      for (const [key, M] of MASS_MODES) {
        const card = cards.find((c) => c.querySelector('b')?.textContent === M.name);
        assert(card, `'${key}' is in MODES and has no card on the Deploy panel`);
        /* The tooltip is what the player reads before they pick it, and it is
         * the row's own blurb — see `_buildModes`, which is why moving the text
         * off the table would take `claims.mjs`'s subject away. */
        assert(card.dataset.tip && M.blurb.startsWith(card.dataset.tip.replace(/\.$/, '')),
          `the ${M.name} card's tooltip is not its blurb: "${card.dataset.tip}"`);
        menu.selectMode(key);
        assert(settings.mode === key, `pressing the ${M.name} card set mode='${settings.mode}'`);
        assert(card.className.includes('sel'), `the ${M.name} card does not light when picked`);
        /* AND THE GROUND IS STILL THE PLAYER'S. A mass battle is laid around
         * wherever the player lands, so unlike Command it owes no
         * `fixedTheatre` — and a row that declared one while the column stayed
         * live is the exact defect `_syncTheatre` was written for. */
        assert(!M.fixedTheatre === !doc.getElementById('level-list').classList.contains('inert'),
          `${M.name} greys the Theatre column and does not say why`);
        rows.push(`${M.name} (${key})`);
      }
      return `${rows.join(', ')} on the Deploy panel, ${cards.length} cards from ${Object.keys(MODES).length} rows, no Menu.js edit`;
    } finally { restore(); }
  });

  check('the front: booting the MODE puts hundreds a side on the field, in frame, with real bodies at your elbow', async () => {
    /**
     * THE WHOLE MODE, END TO END, AND NOTHING HAND-PLACED.
     *
     * Four claims, and they are four because a mass battle can fail as any one
     * of them while looking perfect in the other three:
     *
     *   HUNDREDS A SIDE. The card says "hundreds against hundreds" and that is
     *     a claim, so it is held to the count rather than trusted. The expected
     *     figure is derived from the mode's own `massBattle.blocks` × `RANK_MEN`
     *     — type a smaller battle into the table and this row moves with it, but
     *     a battle that no longer answers the word on the card fails.
     *   BOTH SIDES. Half a battle is what every previous attempt produced.
     *   IN THE FRAME. Check 5's subject, now through the mode: 49 hostiles and
     *     zero in the frustum is what a shipped deploy actually did.
     *   AND REAL BODIES AT YOUR ELBOW. `PROMOTE` is 90 m and a rank is never
     *     planted inside it, so a mass-only mode would be ninety metres of empty
     *     ground with a war on the far side of it. The mode runs the ordinary
     *     wave director as well, and this is the assertion that it does.
     *
     * THE DOOR IS THE WORLD'S, AND THAT IS ASSERTED AS BEHAVIOUR. A check that
     * opened the front itself would pass just as green with nothing ever
     * calling it — the exact state this section exists to end — so the world is
     * booted into the mode and asked whether it HAS one.
     *
     * It was a source scan for one build, pinned to `main.js` because that is
     * where the call was, and that pinning was the defect in miniature: the
     * call belonged beside `objectives` and `fireMissions` in `World.loadLevel`
     * (a branch belongs to the property it is gated on, not to the screen that
     * calls it first), and moving it there — which made the mode reachable from
     * a headless boot and from a co-op client for the first time — turned the
     * check RED. A check that fails when the code gets better is testing the
     * wrong thing.
     */
    const [key, M] = MASS_MODES[0];
    const { world } = await bootWorld({ level: 'geonosis', settings: { quality: 'low', mode: key } });
    const input = idleInput();
    /* THE ASSERTION: the world came back from a plain boot WITH a front on it.
     * Nothing here opens one, which is the point — a mode that declares a
     * battle and gets none is what this check is for, and it is exactly the
     * state the build was in when `openFront` lived on one screen's deploy
     * path.
     *
     * TWO OBJECTS AND THEY ARE NOT THE SAME ONE. `world.front` is the prop the
     * world drives — it holds the moulds, the bearing and whether the battle
     * has been laid; `world.mass` is the `MassField` it drives, which is what
     * a HUD counts and what `World.loadLevel` disposes. Reading `laid` off the
     * field is `undefined` forever, which is a check that waits thirty frames
     * for a flag nothing sets. */
    const front = world.front;
    assert(front, `${key} declares massBattle and a booted world has no front on it at all`);
    assert(world.mass, `${key} has a front and no field for it to drive`);
    assert(!front.laid, 'the front laid its battle before a frame was stepped');
    world.director.start(1);

    /* AND FROM HERE NOTHING BUT THE WORLD'S OWN FRAME. If `world.props` ever
     * stops being driven, or the front stops being registered on it, every
     * number below goes to zero.
     *
     * A HALF SECOND, not a frame: the front will not bake a cohort off a mould
     * whose bones have not reached it yet, which takes a handful of frames on
     * every body in the game (see `Front._posed`). The bound is loose enough
     * not to measure the settle and tight enough that "the battle is there when
     * you land" still means what it says. */
    let frames = 0;
    while (!front.laid && frames < 30) { world.update(STEP, input); frames++; }
    const f = world.mass;
    assert(f && front.laid, `${frames} frames after deploy there is still no battle`);

    const want = M.massBattle.blocks * RANK_MEN;
    const mine0 = f.count(0), theirs0 = f.count(1);
    assert(mine0 >= want * 0.9 && theirs0 >= want * 0.9,
      `${mine0} v ${theirs0} of ${want} a side laid — the mode's own declaration is not what reached the ground`);
    assert(/hundreds against hundreds/i.test(M.blurb),
      `the ${M.name} card no longer says what this row holds it to: "${M.blurb}"`);
    assert(mine0 >= 200 && theirs0 >= 200,
      `the card says "hundreds against hundreds" and the mode fielded ${mine0} against ${theirs0}`);

    /* THE PICTURE, on the frame the player lands. The camera is the world's own
     * and it is pointed down the axis the front laid itself on — which is the
     * player's own facing, so this is the lay-out's promise checked rather than
     * a camera moved until the answer came out right. */
    const cam = world.engine?.camera;
    assert(cam, 'no camera to look through');
    const p0 = world.player.position.clone();
    cam.position.copy(world.player.position).setY(world.player.position.y + 1.6);
    cam.lookAt(world.player.position.clone().addScaledVector(front.axis, 100)
      .setY(world.player.position.y + 1.6));
    cam.updateMatrixWorld(true);
    const m = cam.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10];
    const halfV = (cam.fov * Math.PI / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
    let seen = 0, total = 0;
    for (const r of f.ranks) for (const man of r.men) {
      if (!man.alive) continue;
      total++;
      const vx = man.position.x - cam.position.x;
      const vy = man.position.y - cam.position.y;
      const vz = man.position.z - cam.position.z;
      const len = Math.hypot(vx, vy, vz) || 1;
      if ((vx * fx + vy * fy + vz * fz) / len >= Math.cos(halfH * 1.05)) seen++;
    }
    assert(seen > total * 0.5,
      `${seen} of ${total} men are in front of the camera on the frame you land`);
    assert(frames < 30, `the battle took ${frames} frames to appear after the player landed`);

    /**
     * …AND THE GROUND IS NOT IN THE WAY, WHICH THE ANGLE CANNOT SAY.
     *
     * The count above is the one check 5 makes and it is not enough on its own.
     * Measured on a shipped Geonosis deploy before the bearing was chosen: the
     * terrain between the player and their own line ran
     * `-0.7 -0.3 -0.2 -0.2 -0.3 -0.5 -0.2 8.6 19.3 1.4 0.2` — a nineteen-metre
     * rock at 80 m — and the frustum count said **480 of 480** over a frame with
     * an empty plain in it. So the sightline is walked against the heightfield,
     * which is the only question a player is actually asking.
     *
     * A THIRD, and not most of them, because this is authored ground and not a
     * parade square: swept over twenty-four bearings on three levels, ONE
     * bearing of twenty-four on geonosis and none at all on drifts or scoria
     * had less than 2° of anything standing in front of it. What the mode owes
     * is that it CHOSE — see `Front._bearing` — not that Geonosis is flat.
     */
    const eyeY = world.player.position.y + 1.5;
    let clear = 0, tried = 0;
    for (const r of f.ranks) for (let i = 0; i < r.men.length; i += 4) {
      const man = r.men[i];
      if (!man.alive) continue;
      tried++;
      const tx = man.position.x - p0.x, tz = man.position.z - p0.z;
      const d = Math.hypot(tx, tz);
      const top = man.position.y + 1.2;
      let ok = true;
      for (let sm = 10; sm < d - 4; sm += 8) {
        const k = sm / d;
        if (world.terrain.height(p0.x + tx * k, p0.z + tz * k) > eyeY + (top - eyeY) * k) { ok = false; break; }
      }
      if (ok) clear++;
    }
    assert(clear > tried / 3,
      `only ${clear} of ${tried} men sampled have a line of sight to the player that clears the `
      + 'ground — the army is over a ridge and the frame is an empty plain, which is the original '
      + 'complaint with terrain instead of a spawn heuristic in front of it');

    /**
     * …AND THEY ARE DRAWN WHERE THEY STAND, which no count could ever say.
     *
     * `CohortField._cohortFor` freezes the merged skin out of `bone.matrixWorld`
     * against the mould's `position`. An `Enemy` spawned this frame has been
     * through no `update`, so its bones are all still at the ORIGIN while its
     * `position` is wherever it was put — measured, a body spawned 70 m out is
     * posed on frame 1 and not before. A battle laid on the frame its moulds
     * were spawned therefore bakes geometry displaced by that whole distance,
     * and in a real browser three hundred men were drawn FLOATING IN THE AIR
     * over the plain while every `man.position` in this file was correct. Every
     * headless number above this line passed while the picture was nonsense,
     * which is exactly the class of defect check 5 exists for.
     *
     * The frozen parts are in the body's own frame, so their bounding box is
     * centred on the man. Anything else is the bake being taken from a rig that
     * was somewhere the body was not.
     */
    let off = 0;
    for (const c of world.cohorts.cohorts.values()) {
      if (!c || !c.members.size) continue;
      for (const im of c.meshes) {
        im.geometry.computeBoundingBox();
        const bb = im.geometry.boundingBox;
        off = Math.max(off, Math.hypot((bb.min.x + bb.max.x) / 2,
          (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2));
      }
    }
    assert(off < 3,
      `a cohort's frozen skin is centred ${off.toFixed(1)} m from the body's own origin — it was `
      + 'baked off a rig that had never been posed, and every man in it is drawn that far from '
      + 'where he is standing');

    /**
     * …AND NOT ONE MAN OF THE MASS CARRIES A RIG, which is the rule the two
     * defects above both came out of.
     *
     * `CohortField.step` picks a cohort MEMBER and writes its bones into the
     * gait palette against ITS OWN `position` and `facing`; the shader then
     * cancels the instance matrix against that same canon. So a member whose
     * rig belongs to a body standing somewhere else drags every instance
     * wearing that slot to where the rig is — and the palette is per cohort
     * KEY, which real distant bodies of the same type share, so it is not a
     * mistake the mass could keep to itself. A man with no `rig` and no `_l2`
     * cannot be picked (`capture` returns on both), which makes the rule
     * structural rather than a matter of ordering.
     */
    let rigged = 0;
    for (const r of f.ranks) for (const man of r.men) if (man.rig || man._l2) rigged++;
    assert(rigged === 0,
      `${rigged} of the mass's men carry a rig or a merged skin that is not theirs — `
      + 'any one of them can be picked to pose the cohort, and every man in it is then drawn '
      + 'wherever that rig is standing');
    let cohorts = 0;
    for (const c of world.cohorts.cohorts.values()) if (c?.pose && c.members.size) cohorts++;

    /* Now let the near fight arrive, and the far one exchange fire. */
    const t = [];
    for (let i = 0; i < 900; i++) {
      const t0 = process.hrtime.bigint();
      world.update(STEP, input);
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((x, y) => x - y);
    const med = t[t.length >> 1];

    assert(cohorts >= 2, `${cohorts} instanced cohorts — both armies are not being drawn by the mass rung`);

    /* THE NEAR FIGHT. Real `Enemy` bodies inside `PROMOTE`, which is the half of
     * the mode the mass deliberately cannot supply. */
    const p = world.player.position;
    const near = world.enemies.filter((e) => e && !e.dead && e.position.distanceTo(p) < PROMOTE);
    assert(near.length >= 3,
      `${near.length} real bodies inside ${PROMOTE} m fifteen seconds in — the mass is fighting the `
      + 'battle and the player has nothing to swing at, which is half the mode missing');

    /* AND IT IS STILL A BATTLE, not a light show: both lines have bled. */
    const mine1 = f.count(0), theirs1 = f.count(1);
    assert(mine1 < mine0 && theirs1 < theirs0,
      `no casualties on one side in fifteen seconds (${mine0}→${mine1} v ${theirs0}→${theirs1})`);

    /**
     * AND THE WHOLE FRAME IS AFFORDABLE. The bar is check 5's — the real
     * thing's own measured cost in this repo, ~0.13 ms a body — spent here on
     * the mass PLUS the near fight's real bodies PLUS the entire world update,
     * which is the number a player actually pays.
     */
    const n = mine1 + theirs1;
    const asBodies = n * 0.13;
    assert(med < asBodies * 0.5,
      `${n} men cost ${med.toFixed(1)} ms of frame against ${asBodies.toFixed(1)} ms for the same `
      + 'count of real bodies — the tier is not buying anything');

    world.unload?.();
    return `${M.name}: ${mine0} v ${theirs0} = ${mine0 + theirs0} laid ${frames} frames in, ${seen}/${total} in frame, `
      + `${near.length} real bodies inside ${PROMOTE} m, ${n} men at ${med.toFixed(2)} ms median `
      + `(vs ~${asBodies.toFixed(0)} ms as bodies), ${clear}/${tried} sampled men clear of the ground, `
      + `${cohorts} cohorts, bake centred ${off.toFixed(2)} m off`;
  });

  /**
   * THE BATTLE IS FOUGHT ON THE GROUND, AND THE GROUND WAS DECIDING IT.
   *
   * The mode's worst defect and the one no count and no screenshot could see.
   * `layBattle` put its anchors at fixed distances along the axis and never
   * asked whether the two lines could SEE each other. Measured on the shipped
   * front, twelve blocks a side, twenty seconds:
   *
   *     real terrain    122 v 202     hit rates 3.4% and 7.4%
   *     flat ground     225 v 239     16 casualties in total
   *
   * Fire volume was near-equal at 1034 rounds against 1222, so it was neither
   * damage nor cadence. The enemy line simply stood 30 m higher: mean ground
   * 1.9 m under yours and 31.7 m under theirs, with four of nine opposing
   * pairs blocked by up to 33 m of rock. Which side lost was decided by where
   * the level generator happened to put a rise.
   *
   * TWO THINGS FIXED IT and this holds both. `seatPair` slides each opposing
   * pair along the axis to the nearby seating with the clearest line, and the
   * mode's opening `gap` came in from 150 to 90 — because the ground on
   * geonosis is flat to two hundred metres and a 192 m-wide frontage at 250 m
   * reaches into the hills with its flanks. Nothing is lost by closing it:
   * `STAND_OFF` is 55, so the lines walk toward each other and stand at
   * fifty-five whatever they opened at.
   *
   * THE ASSERTION IS THE OUTCOME, NOT THE GEOMETRY. A check that only measured
   * clearance would pass on a build where the ground was level and something
   * else was lopsided, and the player does not care which it was. So this
   * drives a real battle and demands it stay a contest.
   */
  check('mass: the ground does not decide the battle before it starts', async () => {
    const b = await field(THREE);
    b.world.unload?.();
    const { world } = await bootWorld({
      level: 'geonosis', settings: { quality: 'low', mode: MASS_MODES[0][0] } });
    const input = idleInput();
    let n = 0;
    while (!world.front?.laid && n < 600) { world.update(STEP, input); n++; }
    assert(world.front?.laid, 'the front never laid a battle');
    const f = world.mass;
    const T = world.terrain;
    const mine = f.ranks.filter((r) => r.team === 0);
    const theirs = f.ranks.filter((r) => r.team === 1);
    const n0 = { mine: f.count(0), theirs: f.count(1) };

    /* 1. NEITHER SIDE IS STANDING ON A PLATEAU. Mean ground under each line,
     * which is the number that was 1.9 against 31.7. */
    const mean = (rs) => rs.reduce((a, r) => a + T.height(r.anchor.x, r.anchor.z), 0) / (rs.length || 1);
    const tilt = Math.abs(mean(theirs) - mean(mine));
    assert(tilt < 18,
      `one line stands ${tilt.toFixed(0)} m above the other — that is a firing range, not a battle`);

    /* 2. AND THEY CAN SHOOT AT EACH OTHER. Most pairs clear; a hill somewhere
     * on the frontage is a battlefield and not a bug. */
    const pairs = Math.min(mine.length, theirs.length);
    let clear = 0;
    for (let i = 0; i < pairs; i++) if (blockage(T, mine[i].anchor, theirs[i].anchor) <= 0) clear++;
    assert(clear >= pairs * 0.6,
      `${clear} of ${pairs} opposing pairs can see each other — the rest are shooting into rock`);

    /* 3. THE OUTCOME, which is the assertion the other two exist to explain.
     * Twenty seconds of a real battle has to cost both sides, and the loser
     * must still be a line rather than a rout. */
    while (world.time < 20) world.update(STEP, input);
    const a1 = f.count(0), b1 = f.count(1);
    const lostA = n0.mine - a1, lostB = n0.theirs - b1;
    assert(lostA > 20 && lostB > 20,
      `twenty seconds cost ${lostA} and ${lostB} — one of these lines is not in the fight`);
    const ratio = Math.max(lostA, lostB) / Math.max(1, Math.min(lostA, lostB));
    assert(ratio < 2.2,
      `one side lost ${Math.max(lostA, lostB)} and the other ${Math.min(lostA, lostB)} `
      + `(${ratio.toFixed(1)}x) from an even start — the ground is deciding this`);
    world.unload?.();
    return `${tilt.toFixed(1)} m between the two lines' ground, ${clear}/${pairs} pairs clear, `
      + `and ${n0.mine}v${n0.theirs} became ${a1}v${b1} in 20 s (${lostA} lost against ${lostB})`;
  });
}
