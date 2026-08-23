/**
 * BATTLEFRONT BORZ — the storm, and whether anybody in it can see.
 *
 * PLAN.md §4.7 prices weather as *"entirely unbuilt, five systems each of which
 * rewrites sight tests on both sides"*, and half of that is wrong in the
 * expensive direction. `src/world/Scenery.js` has shipped a full `Weather`
 * since long before this file: squalls on a period, an asymmetric envelope, a
 * gust front sweeping the field, a fog gain, a wind gain, a sun loss and a GLSL
 * twin for the wall — and **all seven grounds author one**, peaks 0.52 to 1.0.
 *
 * What was missing was the RULE. Nothing in the game had ever asked whether you
 * could see through it: the frame went brown, the visibility number went from
 * 198 m to 43, and every rifle on the field went on acquiring at ninety metres.
 * So the whole of the work is one number written by the storm that exists and
 * read by the model that already decides what a shooter can see — and this file
 * is the measurement that says it bites, on every ground, out of each ground's
 * own authored numbers.
 *
 * WHAT IS NOT ASSERTED HERE: the look. `environment.mjs` and the level suites
 * own the frame; this owns the consequence.
 */

import * as THREE from 'three';
import { seeThrough, depthAlong, setAir, airDepth, clearAir, SPOT_HARDER, clearSmoke }
  from '../../src/game/Smoke.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** The transmittance a shooter needs to acquire at all — `Enemy`'s SMOKE_SEE. */
const SEE = 0.30;

/** How far a body can still be picked out, in the air as it stands. */
function sightRange() {
  const a = airDepth();
  return a > 0 ? Math.log(1 / SEE) / a : Infinity;
}

export async function run({ check, assert }) {
  /**
   * SERIALISED, BECAUSE THE AIR IS ONE MODULE-LEVEL NUMBER.
   *
   * `verify.mjs` runs check bodies concurrently, and every body in this file
   * writes the same `air` — so without the lock one check's `clearAir()` lands
   * between another's `setAir` and its measurement. Found exactly that way: a
   * smoke bank measured as adding "Infinity%" because the storm it was
   * supposed to be stacking on had been cleared by the check before it,
   * mid-body. `clocked` is what `stratagems.mjs` and every other suite that
   * touches a shared clock already uses.
   */
  check = await clocked(check);

  check('weather: calm air is exactly the day before this existed', () => {
    clearSmoke(); clearAir();
    assert(airDepth() === 0, `the air reads ${airDepth()} with no storm running`);
    assert(seeThrough(V(0, 1.2, 0), V(90, 1.2, 0)) === 1,
      'ninety metres of clear air is not clear — every archetype\'s band would have been re-tuned '
      + 'by a feature about weather');
    assert(depthAlong(V(0, 0, 0), V(200, 0, 0)) === 0, 'two hundred metres of nothing has depth in it');
    setAir(0);
    assert(airDepth() === 0, 'a storm of zero strength put something in the air');
    return 'clear air: transmittance 1 at 90 m, depth 0 at 200 m';
  });

  check('weather: the storm every ground already authors takes a rifle\'s sight to about twenty metres', async () => {
    /**
     * DRIVEN, NOT RESTATED. `_applyWeather` is the one place that turns a
     * level's authored gains into a live fog density, and a check that
     * re-computed that arithmetic would eventually disagree with a line that is
     * still right (HANDOFF §2.4). So this builds the real `Atmosphere` on a
     * real scene, winds its `Weather` to the peak of a pass, and reads what the
     * sight model was actually handed.
     */
    const { Atmosphere, weather } = await import('../../src/world/Scenery.js');
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const w = L.dust?.weather;
      if (!w?.peak) continue;
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0xc9b391, L.atmosphere?.fogDensity ?? 0.0035);
      const sun = new THREE.DirectionalLight(0xffffff, 1);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      scene.add(sun); scene.add(hemi);
      const atmo = new Atmosphere(scene, { ...(L.dust || {}), density: 0.2 });
      /* THE PEAK OF A PASS. The envelope rises over the first quarter of a
       * squall's duration, so a phase that puts the clock exactly there is the
       * worst moment of the storm — which is the moment the claim is about. */
      weather.phase = 0;
      weather.time = weather.duration * 0.24;
      atmo.update(0, V(0, 0, 0));
      const air = airDepth();
      const range = sightRange();
      rows.push([key, weather.intensity, range]);
      assert(air > 0,
        `${key} authors a squall of peak ${w.peak} and at the top of a pass the air is still `
        + 'clear — the storm is drawn and nothing in the game can tell');
      assert(range < 45,
        `${key}'s storm leaves a shooter acquiring at ${range.toFixed(0)} m, and the longest band `
        + 'any archetype fights at is 42 — a storm that changes nothing about the shooting is the '
        + 'state this whole feature was written to end');
      assert(range > 8,
        `${key}'s storm cuts sight to ${range.toFixed(0)} m, which is inside a blade's reach — at `
        + 'that point the armies cannot fight at all and the mode is a knife fight in a cupboard');
      atmo.dispose?.();
    }
    assert(rows.length === LEVEL_ORDER.length,
      `${rows.length} of ${LEVEL_ORDER.length} grounds author weather — a ground with none is a `
      + 'ground this section does not reach');
    clearAir();
    return rows.map(([k, i, r]) => `${k} ${r.toFixed(0)} m at I=${i.toFixed(2)}`).join(' · ');
  });

  check('weather: it blinds both armies and the man with no rifle at all', async () => {
    /* SYMMETRY IS THE WHOLE MODEL: nothing in `Smoke.js` knows who fired, so
     * the storm that stops their fire stops yours. It is what makes a squall a
     * decision — the Jedi is the one body on the field whose weapon does not
     * care — rather than a difficulty slider that only points one way. */
    setAir(0.02);
    const a = V(0, 1.2, 0), b = V(30, 1.2, 0);
    assert(Math.abs(seeThrough(a, b) - seeThrough(b, a)) < 1e-12,
      'the storm is thicker in one direction than the other');
    const near = seeThrough(a, V(10, 1.2, 0));
    const far = seeThrough(a, V(60, 1.2, 0));
    assert(near > far, 'distance costs nothing in a storm');
    assert(near > SEE && far < SEE,
      `a body at 10 m reads ${near.toFixed(2)} and one at 60 m reads ${far.toFixed(2)} against a `
      + `${SEE} threshold — the storm has to be a RANGE and not a wall`);
    /* AND THE SMOKE SCREEN STILL STACKS ON TOP OF IT, because they are one
     * model: a bank laid in a storm is thicker than the same bank in clear air,
     * which is what "one model" has to mean. */
    const { addSmoke, updateSmoke } = await import('../../src/game/Smoke.js');
    const bare = depthAlong(a, b);
    addSmoke(V(15, 1.2, 0), 8.5, 18);
    updateSmoke(1.0);
    const banked = depthAlong(a, b);
    assert(banked > bare * 1.2,
      `a smoke bank in a storm added ${((banked / bare - 1) * 100).toFixed(0)}% — two clouds on one `
      + 'line have to add, and the weather is a cloud with no edges');
    clearSmoke(); clearAir();
    return `symmetric · 10 m ${near.toFixed(2)} · 60 m ${far.toFixed(2)} · a bank on top of it `
      + `${(banked / bare).toFixed(2)}×`;
  });

  check('weather: the storm reaches the shooters and does not reach the Force', async () => {
    /**
     * THE WIRE, AND THE ONE THING THAT MUST NOT BE ON IT.
     *
     * PLAN.md's design sentence is "sandstorm kills ranged fire both ways and
     * leaves Force sense working, so you become your army's eyes". The first
     * half is `Enemy._hasLineOfSight`, which is the one place in the game that
     * asks whether a body can see its target. The second half is a structural
     * property: the minimap Force sense drives reads bodies out of the world
     * and never asks the sight model, so a Jedi in a brown-out still knows
     * where everything is while nobody with a rifle does.
     */
    const { readFile } = await import('node:fs/promises');
    const src = (p) => new URL('../../src/' + p, import.meta.url);
    const enemy = await readFile(src('game/Enemy.js'), 'utf8');
    assert(/seeThrough\(from, at\) < SMOKE_SEE/.test(enemy),
      'the one place that asks whether a body can see its target no longer reads the sight model');
    const hud = await readFile(src('ui/HUD.js'), 'utf8');
    assert(!/seeThrough|depthAlong/.test(hud),
      'the HUD reads the sight model — the map rides Force sense, and a storm that blinded the map '
      + 'would take away the one thing the Jedi has that his army does not');

    /* AND IT BITES A REAL BODY. Two troopers of the same archetype at the same
     * distance, one in clear air and one in a full squall, asked the game's own
     * question through the game's own method. */
    const { Enemy } = await import('../../src/game/Enemy.js');
    const world = stubWorld();
    const shooter = new Enemy(world, 'clone', V(0, 0, 0));
    const mark = new Enemy(world, 'b1', V(0, 0, 34));
    shooter.position.set(0, 0, 0); mark.position.set(0, 0, 34);
    shooter.target = mark;
    const ctx = { physics: world.physics, terrain: null };
    clearAir();
    assert(shooter._hasLineOfSight(ctx),
      'a shooter cannot see a body 34 m away across open ground in clear air — the fixture is '
      + 'broken before the storm is in it');
    /* 0.02 is a FOG DENSITY the storm has added, not an optical depth: that is
     * what `setAir` takes and what `_applyWeather` hands it. It is about what
     * geonosis' own squall reaches at its peak, and it puts the sight range at
     * a shade under twenty-five metres. */
    setAir(0.02);
    assert(!shooter._hasLineOfSight(ctx),
      'a shooter in a full squall still acquires at 34 m, so the storm is a filter over the frame '
      + 'and not a fact about the battle');
    /* A SECOND BODY AT TWELVE METRES, and not the same one moved: `aimAt`
     * resolves onto `body.chest`, which the rig writes once a frame — moving a
     * body's `position` by hand leaves its aim point where it was, and the
     * check would then be measuring the same 34 m twice. */
    shooter.target = new Enemy(world, 'b1', V(0, 0, 12));
    shooter.target.position.set(0, 0, 12);
    assert(shooter._hasLineOfSight(ctx),
      'the same shooter cannot see a body twelve metres away in the same storm — a squall has to '
      + 'move the fight in close, not stop it');
    clearAir();
    return 'blind at 34 m and seeing at 12 m in the same air; the map never asks';
  });

}

/** The fields `Enemy` reads to exist and to answer a line-of-sight question. */
function stubWorld() {
  return {
    scene: new THREE.Scene(), settings: {}, time: 0,
    enemies: [], players: [], props: [], statics: [],
    difficulty: null, hpScale: 1, dmgScale: 1, takenBoons: new Set(),
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      inBounds: () => true, half: 200, surfaceAt: () => 'sand', crater() {}, slopeAt: () => 0 },
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {}, raycast: () => null,
      addStaticBox() { return null; }, removeStaticBox() {} },
    report() {}, notify() {},
  };
}
