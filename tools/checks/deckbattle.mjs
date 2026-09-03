/**
 * BATTLEFRONT BORZ — THE FLEET ACTION OUTSIDE THE APERTURE (src/game/DeckBattle.js).
 *
 * "big triangles shooting lasers … weirdly localized to one area". The
 * things a harness can hold about the replacement:
 *
 *   1. THREE HULL CLASSES A NAVY, each a real geometry with plating, lamps
 *      and turret hardpoints, and the deck stands all six.
 *   2. THE ACTION IS SPREAD: at least two engagements a long way apart in
 *      bearing, and every one inside the room's far plane from the lift.
 *   3. BOLTS TRAVEL: a bolt in flight is somewhere else next frame, and the
 *      guns are open on the broadside — hundreds in the air.
 *   4. THE DIRECTOR IS PERIODIC in BATTLE.cycle: every hull's pose at t is
 *      its pose at t + cycle, and the victim burns, breaks and dies on the
 *      dome's own beats.
 *   5. COST: a bounded number of draw calls, a step under a millisecond
 *      warm, and nothing allocated at steady state.
 *   6. THE SHADER FLEET IS OFF while this stands, and back after an unload.
 *
 *   node --import ./tools/register.mjs tools/_one.mjs deckbattle
 */
import * as THREE from 'three';
import { BATTLE } from '../../src/engine/SkyDome.js';
import { HULL_CLASSES, ROLES, ENGAGEMENTS, POOLS, poseHull, seekDeckBattle, stepDeckBattle, deckBattleState }
  from '../../src/game/DeckBattle.js';

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('deck battle: three hull classes a navy, each built with plate, lamps and turrets', () => {
    const by = { republic: [], separatist: [] };
    for (const [k, C] of Object.entries(HULL_CLASSES)) by[C.faction].push(k);
    assert(by.republic.length >= 3, `the Republic has ${by.republic.length} hull classes`);
    assert(by.separatist.length >= 3, `the Separatists have ${by.separatist.length} hull classes`);
    for (const f of ['republic', 'separatist']) for (const role of ['carrier', 'assault', 'light']) {
      assert(HULL_CLASSES[ROLES[f][role]], `${f} has no ${role}`);
    }
    const out = [];
    for (const [k, C] of Object.entries(HULL_CLASSES)) {
      const b = C.build();
      let tris = 0, lamps = 0, turrets = 0;
      for (const P of b.halves) {
        const g = P.merge();
        tris += g.attributes.position.count / 3;
        const gl = g.attributes.glow.array;
        for (let i = 0; i < gl.length; i++) if (gl[i] > 0) lamps++;
        turrets += P.turrets.length;
        g.dispose();
      }
      assert(tris > 300, `${k} is ${tris} triangles — a box, not a hull`);
      assert(lamps > 30, `${k} has no lit windows or engines`);
      assert(turrets >= 4, `${k} carries ${turrets} turrets`);
      assert(b.halves.length === C.halves, `${k} declares ${C.halves} halves and built ${b.halves.length}`);
      out.push(`${k}=${tris | 0}t/${turrets}g`);
    }
    return out.join(' ');
  });

  check('deck battle: the engagements are spread across the opening and inside the far plane', () => {
    assert(ENGAGEMENTS.length >= 2, 'one engagement is a patch');
    let minSep = Infinity;
    const dir = (E) => new THREE.Vector3(Math.sin(E.az) * Math.cos(E.el), Math.sin(E.el), Math.cos(E.az) * Math.cos(E.el));
    for (let i = 0; i < ENGAGEMENTS.length; i++) for (let j = i + 1; j < ENGAGEMENTS.length; j++) {
      minSep = Math.min(minSep, dir(ENGAGEMENTS[i]).angleTo(dir(ENGAGEMENTS[j])));
    }
    assert(minSep > 0.3, `two engagements are ${(minSep * 57.3).toFixed(0)}° apart — that is one patch`);
    /* left AND right of the axis, and one high: busy wherever he looks */
    assert(ENGAGEMENTS.some((E) => E.az < -0.2) && ENGAGEMENTS.some((E) => E.az > 0.2), 'everything is on one side');
    assert(ENGAGEMENTS.some((E) => E.el > 0.35), 'nothing to see when he looks up');
    /* from the lift (0, 1.7, -99) every centre is inside DeckLife's 1008 m far plane with room for a hull */
    for (const E of ENGAGEMENTS) {
      const p = dir(E).multiplyScalar(E.r).add(new THREE.Vector3(0, 43, 144));
      const d = p.distanceTo(new THREE.Vector3(0, 1.7, -99));
      /* plus half a carrier at that engagement's scale */
      assert(d + E.scale * 600 < 1008, `${E.id} sits ${d.toFixed(0)} m from the lift — past the far plane`);
    }
    return `${ENGAGEMENTS.length} engagements, closest pair ${(minSep * 57.3).toFixed(0)}° apart`;
  });

  check('deck battle: the deck stands the fleet, bolts travel, and the sky is full on the broadside', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    try {
      const st = world._deckBattle;
      assert(st, 'dressHangar did not dress the battle');
      assert(st.hulls.length >= 12, `${st.hulls.length} hulls is not a fleet`);
      const classes = Object.keys(st.classes);
      assert(classes.length === 6, `${classes.length} classes stood, of 6`);
      /* the guns open */
      seekDeckBattle(world, BATTLE.fire + 40);
      for (let i = 0; i < 240; i++) stepDeckBattle(world, 1 / 60);
      const S = deckBattleState(world);
      assert(S.phase === 'broadside', `phase ${S.phase} at fire + 44`);
      assert(S.bolts >= 100, `${S.bolts} bolts in flight on the broadside — the brief says hundreds`);
      /* one bolt, two frames */
      const B = st.bolts;
      let i = -1;
      for (let k = 0; k < B.n; k++) if (B.live[k] && B.kind[k] === 0 && (st.t - B.t0[k]) / B.dur[k] < 0.5) { i = k; break; }
      assert(i >= 0, 'no turbolaser in flight to watch');
      const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
      B.mesh.getMatrixAt(i, m); a.setFromMatrixPosition(m);
      for (let k = 0; k < 6; k++) stepDeckBattle(world, 1 / 60);
      B.mesh.getMatrixAt(i, m); b.setFromMatrixPosition(m);
      const moved = a.distanceTo(b);
      assert(moved > 5 && moved < 60, `a bolt moved ${moved.toFixed(1)} m in a tenth of a second`);
      /* turrets traverse: after the guns have been open a while, mounts are off their rest */
      let slewed = 0;
      for (let k = 0; k < st.turret.n; k++) if (Math.abs(st.turret.yaw[k]) > 0.05) slewed++;
      assert(slewed > st.turret.n * 0.3, `${slewed} of ${st.turret.n} turrets have traversed`);
      /* the shader fleet is off while the geometry stands */
      const u = world.engine.skyDome.mat.uniforms;
      assert(u.uFleet.value === 0, `uFleet is ${u.uFleet.value} with a fleet in the world — two fleets`);
      return `${st.hulls.length} hulls of ${classes.length} classes, ${st.turret.n} turrets, ${st.fighters.n} fighters; ${S.bolts} bolts in flight, one moved ${moved.toFixed(1)} m in 0.1 s`;
    } finally { try { world.unload(); } catch {} }
  });

  check('deck battle: the director is periodic in the cycle and the victim dies on the dome\'s beats', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    try {
      const st = world._deckBattle;
      const { battlePhase } = await import('../../src/engine/SkyDome.js');
      const A = new THREE.Matrix4(), Bm = new THREE.Matrix4();
      let compared = 0;
      for (const t of [10, 100, 200, 240, 300, 350, 400, 500]) {
        for (const h of st.hulls) {
          const p1 = battlePhase(t), p2 = battlePhase(t + BATTLE.cycle);
          poseHull(st, h, p1.t, p1.victimSide, p1.sep); A.copy(h.m[0]);
          poseHull(st, h, p2.t, p2.victimSide, p2.sep); Bm.copy(h.m[0]);
          for (let k = 0; k < 16; k++) assert(Math.abs(A.elements[k] - Bm.elements[k]) < 1e-6, `${h.cls} at t=${t} is not where it is at t+cycle`);
          compared++;
        }
      }
      /* the victim: alive on the broadside, gone at the break, the other navy's the next round */
      const victims = [];
      for (const round of [0, 1]) {
        const t0 = round * BATTLE.round;
        const p = battlePhase(t0 + BATTLE.breakAt + 1);
        let v = null;
        for (const h of st.hulls) { poseHull(st, h, p.t, p.victimSide, p.sep); if (h.victim) v = h; }
        assert(v, `no victim in round ${round}`);
        assert(!v.alive && v.shown, `the victim is ${v.alive ? 'alive' : 'hidden'} a second after the break`);
        const q = battlePhase(t0 + BATTLE.fire + 10);
        poseHull(st, v, q.t, q.victimSide, q.sep);
        assert(v.alive, 'the victim is dead on the broadside');
        const r = battlePhase(t0 + BATTLE.reactor + 1);
        poseHull(st, v, r.t, r.victimSide, r.sep);
        assert(v.halfVis[1] === 0 && v.halfVis[0] === 1, 'the stern half survived the reactor, or the bow did not');
        victims.push(v.faction);
      }
      assert(victims[0] !== victims[1], `the same navy (${victims[0]}) loses both rounds`);
      /* the replacement stands in only for the navy that lost */
      const p = battlePhase(BATTLE.jumpIn + 5);
      let stood = 0;
      for (const h of st.hulls) { poseHull(st, h, p.t, p.victimSide, p.sep); if (h.reinforcement && h.shown) { stood++; assert(h.faction === p.victimSide, 'the wrong navy\'s replacement jumped in'); } }
      assert(stood === 1, `${stood} replacements stood at jumpIn`);
      return `${compared} poses equal at t and t + ${BATTLE.cycle}; the ${victims[0]} carrier dies in round 0 and the ${victims[1]} in round 1`;
    } finally { try { world.unload(); } catch {} }
  });

  check('deck battle: fourteen draw calls, a step under a millisecond, nothing allocated, and the room gets its sky back', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    const st = world._deckBattle;
    try {
      let draws = 0, tris = 0;
      st.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { draws++; tris += o.geometry.attributes.position.count / 3 * (o.isInstancedMesh ? o.count : 1); } });
      assert(draws <= 30, `${draws} draw calls for the battle; the budget is 30`);
      st.group.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          assert(m.fog === false, `${o.name} is fogged — at 600 m it is haze colour`);
          assert(m.userData.saberNoInk, `${o.name} is inked`);
        }
        assert(o.frustumCulled === false, `${o.name} is frustum-culled off its geometry's own sphere`);
      });
      /* warm, on the broadside, then measure */
      seekDeckBattle(world, BATTLE.fire + 60);
      for (let i = 0; i < 300; i++) stepDeckBattle(world, 1 / 60);
      /* three windows, the least growth of them: a collection landing inside
       * one window reads as negative, a promotion as a spike; a step that
       * really allocates grows in every window */
      let ms = Infinity, grew = Infinity;
      for (let w = 0; w < 3; w++) {
        const heap0 = process.memoryUsage().heapUsed;
        const t0 = performance.now();
        for (let i = 0; i < 600; i++) stepDeckBattle(world, 1 / 60);
        ms = Math.min(ms, (performance.now() - t0) / 600);
        grew = Math.min(grew, (process.memoryUsage().heapUsed - heap0) / 1024);
      }
      /* one small phase record a frame is the only allocation; 600 of them are
       * well under a megabyte, and a per-frame vector or array would be many */
      assert(ms < 1.5, `${ms.toFixed(3)} ms a step on the broadside`);
      assert(grew < 2048, `${grew.toFixed(0)} KB of heap over 600 steps — the step allocates`);
      /* a step before dress and after unload is a no-op */
      stepDeckBattle({}, 0.016);
      const fleet0 = st.fleet0;
      world.unload();
      stepDeckBattle(world, 0.016);
      assert(!st.group.parent, 'the battle survived the unload');
      assert(world._deckBattle == null, '_deckBattle survived the unload');
      const u = world.engine.skyDome.mat.uniforms;
      assert(u.uFleet.value === fleet0, `uFleet is ${u.uFleet.value} after the unload; the dome does not have its fleet back`);
      return `${draws} draws / ${Math.round(tris / 1000)}k tris standing; ${ms.toFixed(3)} ms a step, ${grew.toFixed(0)} KB over 600 steps; pools ${JSON.stringify(POOLS)}`;
    } finally { try { world.unload(); } catch {} }
  });
}
