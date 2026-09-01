/**
 * BATTLEFRONT BORZ — a commander's half-cape is cloth.
 *
 * The player: "are the capes for troopers even actual cloth like my capes?
 * they look completely solid."
 *
 * They were two rigid plates on the chest bone. Cloth.js's own header gives
 * the measure of cloth this game uses — a hem that travels 217 mm in the
 * pelvis frame over seven seconds of walking, beside a lathe that travels
 * none — and a plate welded to the ribcage scores exactly zero on it however
 * the body moves. So that is what is measured here: a caped trooper is built,
 * its cape is stepped for three seconds while the rig is yawed back and forth,
 * and the hem has to have swung.
 *
 * The rest of the file is the plumbing that decides whether the player sees
 * it at all: the cape reaches a spawned enemy through `Enemy._build`, a
 * trooper without `K.cape` builds no cloth (cloth-cost.mjs prices the column
 * on who wears what), the rigid plates stand in past the cloth cut, and the
 * step is reachable from the RIFLE pose — which is where a commander's arms
 * are, and where the garment step was not.
 */

import * as THREE from 'three';
import * as B from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';
import { attachTrooperCape } from '../../src/game/Cloth.js';
import { Enemy } from '../../src/game/Enemy.js';
import { clocked } from './_shared.mjs';
import { functionBody } from './_source.mjs';

function gunWorld() {
  return {
    scene: new THREE.Scene(), settings: {}, difficulty: null,
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, surfaceAt: () => 'sand' },
    physics: { add() {}, remove() {}, bodies: [], staticBoxes: [], raycast: () => null,
      addJoint() {}, removeJoint() {} },
    particles: null, bolts: null, time: 0, enemies: [], players: [],
    notify() {}, report() {}, addHitstop() {},
  };
}

/** A caped trooper, built the way Enemy._build builds a Clone Commander. */
function caped(type = 'officer') {
  return B.buildTrooper({ scale: 1, ...(B.bodyOptsFor(type) || {}) });
}

/** The hips-frame transform, and the cloth read back in it. */
function hipsInv(rig) {
  const h = rig.get('hips').obj;
  h.updateMatrixWorld(true);
  return new THREE.Matrix4().copy(h.matrixWorld).invert();
}

export async function run({ check, assert }) {
  check = await clocked(check);
  await import('../../src/game/Levels.js');   // the Command units: officer, arc

  check('trooper-cape: the builder publishes the cape it built, and only when it built one', () => {
    const c = caped('officer');
    assert(c.cape, 'a Clone Commander is built with K.cape and publishes no `cape` — the cloth has nothing to hang from');
    assert(Array.isArray(c.cape.rigid) && c.cape.rigid.length >= 1, 'the published cape carries no rigid stand-in');
    assert(c.cape.sx === 1 || c.cape.sx === -1, `the published cape's side is ${c.cape.sx}, not a sign`);
    assert(c.cape.rigid.every((m) => m.isMesh && m.userData.silhouette), 'the stand-in plates lost their silhouette tag — they would be culled at thirty metres');
    /* And exactly the rungs whose KIT says so — `TROOPER_KITS[kit].cape` is
     * the one place a cape is declared, so it is the rule this calls rather
     * than a list of archetype names restated here (HANDOFF 2.4). */
    const rows = [];
    for (const [type, row] of Object.entries(B.BODY_KITS)) {
      if (!row.kit || !B.TROOPER_KITS[row.kit]) continue;
      const wears = !!B.TROOPER_KITS[row.kit].cape;
      const b = caped(type);
      assert(!!b.cape === wears,
        wears ? `${type}'s kit '${row.kit}' declares a cape and the builder published none`
              : `${type}'s kit '${row.kit}' declares no cape and the builder published one`);
      rows.push(`${type}${wears ? '*' : ''}`);
    }
    /* The creator's own path: `cape` is a kit FIELD, so any trooper can be given one. */
    const custom = B.buildTrooper({ scale: 1, kit: 'line', cape: true });
    assert(custom.cape, 'a line trooper given `cape: true` by the creator publishes no cape');
    return `officer sx ${c.cape.sx} (${c.cape.rigid.length} plate mesh); caped* on the roster: ${rows.join(' ')}`;
  });

  check('trooper-cape: THE HEM MOVES — 150 mm in the pelvis frame over three seconds of turning', () => {
    const built = caped('officer');
    const rig = built.rig;
    const scene = new THREE.Scene();
    const cape = attachTrooperCape(scene, rig, { scale: 1, seed: 7171, ...built.cape });
    assert(cape && cape.pos && cape.links, 'attachTrooperCape returned no cloth body');
    /* No finer than the cape it is sized against: cloth-cost.mjs prices the
     * column on the acolyte's 63 particles / 300 links, and a half-cape that
     * cost more than a full one would double the column for the bodies that
     * wear it. */
    const particles = cape.pos.length / 3;
    assert(particles <= 63 && cape.links.length <= 300,
      `the half-cape is ${particles} particles / ${cape.links.length} links — more than the acolyte's full cape (63 / 300)`);
    /* The plates are hidden while the cloth runs, and come back when it is
     * switched off with a stand-in, exactly as the skirt's lathes do. */
    assert(built.cape.rigid.every((m) => !m.visible), 'the rigid plates are still drawn under the cloth');
    cape.setVisible(false);
    assert(built.cape.rigid.every((m) => m.visible), 'past the cut, nothing stands in for the cape');
    cape.setVisible(false, false);
    assert(built.cape.rigid.every((m) => !m.visible), 'first person shows the plates');
    cape.setVisible(true);

    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(), wind = new THREE.Vector3();
    const N = 180;                               // three seconds
    const hemRow = (cape.rows - 1) * cape.cols;
    const frames = [];
    let minY = Infinity, maxStretch = 0;
    for (let i = 0; i < N; i++) {
      /* A standing figure turning through ±1 rad on a 1.5 s cycle: the swing
       * a cape makes when its wearer looks round, which is the movement a
       * rigid plate cannot make at all. */
      const facing = Math.sin((i / 60) * Math.PI * 2 / 1.5) * 1.0;
      anim.setFacing(facing);
      anim.update(1 / 60, { position: pos, facing, velocity: vel, grounded: true,
        groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
      anim.swingArms(1 / 60, 0, 1);
      rig.updateMatrices();
      cape.update(1 / 60, cape.refreshColliders(), wind);
      if (i >= 30) {
        const inv = hipsInv(rig);
        const row = [];
        for (let c = 0; c < cape.cols; c++) {
          const k = (hemRow + c) * 3;
          const p = new THREE.Vector3(cape.pos[k], cape.pos[k + 1], cape.pos[k + 2]);
          minY = Math.min(minY, p.y);
          row.push(p.applyMatrix4(inv));
        }
        frames.push(row);
      }
      for (const l of cape.links) {
        const a = l.a * 3, b = l.b * 3;
        const d = Math.hypot(cape.pos[a] - cape.pos[b], cape.pos[a + 1] - cape.pos[b + 1], cape.pos[a + 2] - cape.pos[b + 2]);
        if (l.rest0 > 0) maxStretch = Math.max(maxStretch, d / l.rest0 - 1);
      }
    }
    /* Every hem particle's own travel in the pelvis frame, averaged along the
     * hem — one column is a lottery on a garment whose hem is not level. */
    let mean = 0, best = 0;
    for (let c = 0; c < cape.cols; c++) {
      let m = 0;
      for (const a of frames) for (const b of frames) m = Math.max(m, a[c].distanceTo(b[c]));
      mean += m / cape.cols;
      best = Math.max(best, m);
    }
    assert(mean >= 0.150,
      `the half-cape's hem travels ${(mean * 1000).toFixed(0)} mm in the pelvis frame over three seconds of turning — `
      + 'that is a plate. The rigid one travels 0');
    /* And it is a garment, not an explosion: nothing on the floor and no
     * link torn to twice its cut length. */
    assert(minY > 0.15, `the hem reached ${minY.toFixed(2)} m — it is on the floor`);
    assert(maxStretch < 1.0, `a link stretched to ${(1 + maxStretch).toFixed(2)}x its cut length`);
    cape.dispose();
    assert(built.cape.rigid.every((m) => m.visible), 'disposing the cloth did not hand the plates back');
    return `hem travel ${(mean * 1000).toFixed(0)} mm mean, ${(best * 1000).toFixed(0)} mm best column; `
      + `${particles} particles / ${cape.links.length} links; worst stretch ${(maxStretch * 100).toFixed(0)}%`;
  });

  check('trooper-cape: a spawned commander wears the cloth and a line trooper builds none', () => {
    const officer = new Enemy(gunWorld(), 'officer', new THREE.Vector3());
    assert(officer.cloak && officer.cloak.pos && officer.cloak.links, 'a Clone Commander spawns with no cloth cape');
    assert(officer.cloak.rigid?.length >= 1 && officer.cloak.rigid.every((m) => !m.visible),
      'the commander\'s rigid plates are drawn under its cloth');
    for (const type of ['trooper', 'sniper', 'heavy', 'jet', 'arc', 'b1']) {
      const e = new Enemy(gunWorld(), type, new THREE.Vector3());
      assert(!e.cloak, `a ${type} spawns wearing cloth it has no cape for — cloth-cost.mjs prices the column on who wears what`);
    }
    /* THE CUT. The cape is stepped and shown only inside `clothOn`, which is
     * the distance every enemy garment is priced on (World.clothCut: 0 at
     * low, 18 medium, 30 high, 46 ultra); outside it the plates stand in. */
    const ctx = { terrain: officer.world.terrain, physics: officer.world.physics, particles: null, time: 0, enemies: [] };
    officer.facing = 0; officer.target = null;
    officer.clothOn = true;
    for (let i = 0; i < 5; i++) officer._pose(1 / 60, ctx);
    assert(officer.cloak.initialised && officer.cloak.mesh.visible, 'inside the cut the cape is not simulated');
    assert(officer.cloak.rigid.every((m) => !m.visible), 'inside the cut the plates are drawn as well as the cloth');
    officer.clothOn = false;
    officer._pose(1 / 60, ctx);
    assert(!officer.cloak.mesh.visible && officer.cloak.rigid.every((m) => m.visible),
      'outside the cut the cloth is still drawn and the plates are not');
    officer.dispose?.();
    return 'the officer wears cloth, six uncaped bodies wear none; plates stand in outside clothOn';
  });

  check('trooper-cape: the garment step is reachable from the rifle pose, and gated once', async () => {
    /* A commander holds a rifle, so its arms go through the rifle pose — and
     * the garment step used to live inside `_poseSaber`, where no rifle body
     * ever went. Read off the shipped source: one step function, called from
     * every arm path, carrying the one `clothOn` gate cloth-cost.mjs looks
     * for. */
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/game/Enemy.js', import.meta.url), 'utf8');
    const arms = functionBody(src, '\n  _poseArms(');
    const saber = functionBody(src, '\n  _poseSaber(');
    const step = functionBody(src, '\n  _stepGarments(');
    assert(step, 'Enemy has no _stepGarments');
    assert((arms.match(/this\._stepGarments\(/g) || []).length >= 2,
      '_poseArms does not step the garments on the rifle path and the disarmed path');
    assert(/this\._stepGarments\(/.test(saber), '_poseSaber no longer steps the garments');
    assert(/if \(!this\.clothOn\)/.test(step), 'the clothOn gate is not in the one garment step');
    assert(!/if \(!this\.clothOn\)/.test(saber) && !/if \(!this\.clothOn\)/.test(arms),
      'a second clothOn gate has appeared outside _stepGarments');
    return 'one _stepGarments, three callers, one clothOn gate';
  });
}
