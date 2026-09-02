/**
 * BATTLEFRONT BORZ — THE WORLD OUTSIDE THE WINDOW, AND THE FIGHT IN FRONT OF IT.
 *
 * "while the hangar looks really good it almost makes how crude all the
 *  different planets are and how crude the giant battle is stand out even
 *  more … it's just bare static triangles … make it way more dynamic and
 *  engaging and changing over time"
 *
 * What was built for that lives in one fragment shader (src/engine/SkyDome.js,
 * the orbit block) and one table (`BATTLE`), and neither can be seen from a
 * Node harness. So this suite holds the things ABOUT them that a harness can
 * hold, and they are the things that have silently broken before:
 *
 *   1. THE SHADER COMPILES. There is no GL under Node, and a fragment that
 *      does not compile draws nothing and fails no check — `_gradecompile.mjs`
 *      records exactly that happening to the composite. So when the Chromium
 *      the render tools use is on the box, the shipped fragment is handed to a
 *      real WebGL compiler, under the render lock, and the driver's own log
 *      is the failure message. Without the browser the check says so and
 *      falls back to the static tests below rather than passing on nothing.
 *   2. EVERY UNIFORM THE GLSL READS IS ONE THE MATERIAL DECLARES, and the
 *      other way round for the orbit block. A uniform typed in one place and
 *      not the other is the quietest way to draw the wrong picture.
 *   3. EVERY LEVEL'S `planet` RECORD RESOLVES through configureOrbit without a
 *      NaN, its own knobs land on the uniforms they name, and no two worlds
 *      share a seed — the whole point of the record is that the seven
 *      theatres stop being one planet in seven swatches.
 *   4. THE BATTLE IS A FUNCTION OF t: battlePhase(t) equals battlePhase(t +
 *      cycle) everywhere, the phases run in the scripted order inside a
 *      round, and the shader's T_ constants are BATTLE's numbers and not a
 *      second copy of them.
 *   5. THE DECK HEARS THE ROUND: a dome ticked through a round raises the
 *      break and the reactor once each, and a clock seeded into the middle
 *      of a round raises nothing retroactively.
 *   6. THE PLANET IS STILL IN THE OPENING. `_placeByPhase` with the deck's
 *      own forward and rise puts the disc ahead of the player for every
 *      theatre's star — the same bearing test `hangar.mjs` makes on the
 *      booted room, made here on the dome alone so it fails on the file that
 *      moved it.
 *
 *   node --import ./tools/register.mjs tools/_one.mjs orbit-battle
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { SkyDome, BATTLE, battlePhase } from '../../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { ground } from '../../src/world/Scenery.js';
import { sunDirection } from '../../src/engine/Engine.js';

const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** A dome configured as the flight deck configures it, for `key`. */
function windowOn(key, extra = {}) {
  const dome = new SkyDome(new THREE.Scene());
  const L = LEVELS[key];
  dome.configure(L.atmosphere);
  dome.configureOrbit({ level: L, terrain: TERRAIN_PRESETS[L.terrain], faction: 'republic',
    forward: [0, 0, 1], rise: 0.22, ...extra });
  return dome;
}

function finiteUniforms(u) {
  const bad = [];
  for (const [k, { value }] of Object.entries(u)) {
    const nums = value == null ? []
      : typeof value === 'number' ? [value]
      : value.isColor ? [value.r, value.g, value.b]
      : value.isVector3 ? [value.x, value.y, value.z]
      : Array.isArray(value) ? value.flatMap((v) => [v.x, v.y, v.z, v.w]) : [];
    if (nums.some((n) => !Number.isFinite(n))) bad.push(k);
  }
  return bad;
}

export function run({ check, assert, near }) {
  check('orbit: the orbit fragment compiles under a real WebGL compiler', async () => {
    if (!existsSync(CHROMIUM)) {
      return 'no headless Chromium on this box — compile not attempted (static checks below still hold)';
    }
    const { hold } = await import('../_lock.mjs');
    const { chromium } = await import('playwright-core');
    const fs = new SkyDome(new THREE.Scene()).mat.fragmentShader;
    /* The render lock, because this is a browser and the box is shared. */
    const release = await hold('orbit-battle');
    let browser = null;
    try {
      browser = await chromium.launch({ executablePath: CHROMIUM,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
          '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      const page = await browser.newPage();
      const out = await page.evaluate((src) => {
        /* WebGL1 with derivatives on, exactly as _gradecompile.mjs does: the
         * literal is ES 1.00 and three adds the version line and the
         * extension for it in the real build. */
        const gl = document.createElement('canvas').getContext('webgl');
        if (!gl) return { ok: false, log: 'no WebGL context' };
        gl.getExtension('OES_standard_derivatives');
        const s = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(s, '#extension GL_OES_standard_derivatives : enable\n' + src);
        gl.compileShader(s);
        const ok = gl.getShaderParameter(s, gl.COMPILE_STATUS);
        return { ok, log: ok ? '' : gl.getShaderInfoLog(s).replace(/\0/g, ''), v: gl.getParameter(gl.VERSION) };
      }, fs);
      assert(out.ok, `the sky fragment does not compile:\n${out.log}`);
      return `compiled on ${out.v}, ${fs.length} chars`;
    } finally {
      if (browser) await browser.close();
      if (typeof release === 'function') release();
    }
  });

  check('orbit: every uniform the GLSL reads is declared on the material, and back', () => {
    const dome = new SkyDome(new THREE.Scene());
    const src = dome.mat.fragmentShader;
    const declared = new Set(Object.keys(dome.mat.uniforms));
    const inGlsl = new Set([...src.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]));
    const missing = [...inGlsl].filter((n) => !declared.has(n));
    assert(missing.length === 0, `the shader reads uniforms the material never sets: ${missing.join(', ')}`);
    const orphan = [...declared].filter((n) => !inGlsl.has(n) && n !== 'uDeathSpan');
    assert(orphan.length === 0, `the material sets uniforms no shader line reads: ${orphan.join(', ')}`);
    /* the things the player asked for are in the fragment by name */
    for (const need of ['uPlanetSeed', 'uScatterCol', 'uRingAmt', 'uStormAmt', 'uGlint', 'uSide',
      'shipMask', 'hyperStreak', 'uSlot', 'T_REACTOR', 'T_JUMPIN', 'cShadow']) {
      assert(src.includes(need), `${need} is not in the orbit fragment`);
    }
    /* five silhouettes, and none of them is the old tapered box */
    assert(!/float hullMask\(/.test(src), 'the old tapered-box hullMask is back');
    const kinds = (src.match(/kind < [0-4]\.5/g) || []).length;
    assert(kinds >= 4, `shipMask only branches ${kinds} times — fewer than five silhouettes`);
    dome.dispose();
    return `${inGlsl.size} uniforms read, ${declared.size} declared; five silhouettes`;
  });

  check('orbit: every theatre\'s planet record resolves, lands, and is its own world', () => {
    const seeds = new Map();
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const dome = windowOn(key);
      const u = dome.mat.uniforms;
      const bad = finiteUniforms(u);
      assert(bad.length === 0, `${key}: non-finite uniforms after configureOrbit: ${bad.join(', ')}`);
      const PL = LEVELS[key].atmosphere.planet;
      assert(PL, `${key} has no atmosphere.planet record — it is the derived default planet again`);
      /* the record's own numbers are what the shader gets */
      if (PL.seaAmt != null) near(u.uSeaAmt.value, PL.seaAmt, 1e-9, `${key}: seaAmt did not land`);
      if (PL.ice != null) near(u.uCapAmt.value, PL.ice, 1e-9, `${key}: ice did not land`);
      if (PL.cloudCover != null) near(u.uCloudAmt.value, PL.cloudCover, 1e-9, `${key}: cloudCover did not land`);
      if (PL.cities != null) near(u.uCityAmt.value, PL.cities, 1e-9, `${key}: cities did not land`);
      if (PL.haze != null) near(u.uHazeAmt.value, PL.haze, 1e-9, `${key}: haze did not land`);
      if (PL.storms != null) near(u.uStormAmt.value, PL.storms, 1e-9, `${key}: storms did not land`);
      assert(u.uSeaGlow.value === (PL.lava ? 1 : 0), `${key}: lava flag did not land`);
      assert((u.uRingAmt.value > 0) === !!PL.ring, `${key}: ring did not land`);
      if (PL.land != null) {
        const c = new THREE.Color(PL.land);
        near(u.uLandCol.value.r, c.r, 1e-6, `${key}: land colour did not land`);
      }
      const seed = u.uPlanetSeed.value.toArray().map((v) => v.toFixed(3)).join(',');
      assert(!seeds.has(seed), `${key} and ${seeds.get(seed)} share a planet seed — the same coastlines`);
      seeds.set(seed, key);
      rows.push(`${key}${PL.lava ? ' lava' : ''}${PL.ring ? ' ring' : ''} sea ${u.uSeaAmt.value.toFixed(2)} ice ${u.uCapAmt.value.toFixed(2)} cities ${u.uCityAmt.value.toFixed(2)}`);
      dome.dispose();
    }
    /* …and a level with NO record still resolves: the derived defaults */
    const dome = new SkyDome(new THREE.Scene());
    dome.configure({});
    dome.configureOrbit({ level: { id: 'nowhere', atmosphere: {} }, terrain: TERRAIN_PRESETS.drifts });
    assert(finiteUniforms(dome.mat.uniforms).length === 0, 'a level with no planet record produces a NaN');
    assert(dome.mat.uniforms.uRingAmt.value === 0, 'a level with no planet record grew a ring');
    dome.dispose();
    return rows.join('; ');
  });

  check('orbit: the battle is a function of t, periodic, and in the scripted order', () => {
    const C = BATTLE.cycle;
    for (let t = 0; t < C; t += 0.37) {
      const a = battlePhase(t), b = battlePhase(t + C), c = battlePhase(t + 3 * C);
      for (const o of [b, c]) {
        for (const k of Object.keys(a)) {
          const same = typeof a[k] === 'number' ? Math.abs(a[k] - o[k]) < 1e-6 : a[k] === o[k];
          assert(same, `battlePhase(${t.toFixed(2)}).${k} is ${a[k]} and ${o[k]} a cycle later`);
        }
      }
    }
    /* the phases run in order inside a round and the second round swaps sides */
    const order = ['arrive', 'approach', 'broadside', 'dying', 'breakup', 'reinforced', 'withdraw', 'departed'];
    let last = -1;
    const seen = new Set();
    for (let t = 0; t < BATTLE.round; t += 0.5) {
      const i = order.indexOf(battlePhase(t).phase);
      assert(i >= last, `phase order breaks at ${t}s: ${order[last]} → ${order[i]}`);
      last = i; seen.add(order[i]);
    }
    assert(seen.size === order.length, `a round only reaches ${[...seen].join(', ')}`);
    assert(battlePhase(10).victimSide !== battlePhase(10 + BATTLE.round).victimSide,
      'the same navy loses the ship in both rounds');
    /* the lines are far apart at both ends of a round and on station between */
    near(battlePhase(0).sep, 1, 1e-9, 'the lines do not start apart');
    near(battlePhase(BATTLE.round - 1e-3).sep, 1, 1e-6, 'the lines do not end apart');
    near(battlePhase(150).sep, 0, 1e-9, 'the lines are not on station mid-round');
    assert(battlePhase(150).fire === 1 && battlePhase(20).fire === 0 && battlePhase(350).fire === 0,
      'the guns are not gated to the engagement');
    /* the shader reads BATTLE's numbers, not a copy */
    const src = new SkyDome(new THREE.Scene()).mat.fragmentShader;
    const pairs = [['ROUND', 'round'], ['T_BURN', 'burn'], ['T_BREAK', 'breakAt'], ['T_REACTOR', 'reactor'],
      ['T_JUMPIN', 'jumpIn'], ['T_WITHDRAW', 'withdraw'], ['T_JUMPOUT', 'jumpOut'], ['T_CEASE', 'cease']];
    for (const [glsl, js] of pairs) {
      const m = src.match(new RegExp(`const float ${glsl}\\s*=\\s*([0-9.]+);`));
      assert(m, `the fragment declares no ${glsl}`);
      near(Number(m[1]), BATTLE[js], 1e-6, `${glsl} is ${m[1]} in the fragment and BATTLE.${js} is ${BATTLE[js]}`);
    }
    return `period ${C}s, ${order.length} phases in order, ${pairs.length} constants shared with the fragment`;
  });

  check('orbit: the deck hears the round — break and reactor once each, nothing retroactive', () => {
    const dome = windowOn('drifts', { time: 0 });
    ground.orbit.events.length = 0;
    const heard = [];
    for (let t = 0; t < BATTLE.round; t += 1 / 30) {
      dome.update(1 / 30, null);
      while (ground.orbit.events.length) heard.push(ground.orbit.events.shift());
    }
    const breaks = heard.filter((e) => e.kind === 'breakup');
    assert(breaks.length === 1, `${breaks.length} break-ups in one round`);
    assert(Math.abs(breaks[0].at - BATTLE.breakAt) < 0.1, `the break was heard at ${breaks[0].at.toFixed(1)}s, not ${BATTLE.breakAt}`);
    const big = heard.filter((e) => e.kind === 'blast' && e.strength >= 3);
    assert(big.length === 1, `${big.length} reactor detonations in one round`);
    assert(Math.abs(big[0].at - BATTLE.reactor) < 0.1, `the reactor was heard at ${big[0].at.toFixed(1)}s`);
    assert(heard.every((e) => Number.isFinite(e.delay) && e.delay > 0), 'an event with no delay');
    dome.dispose();
    /* seeded into the middle of a round: the events before the seed never fire */
    const late = windowOn('drifts', { time: BATTLE.reactor + 5 });
    ground.orbit.events.length = 0;
    late.update(1 / 30, null);
    late.update(1 / 30, null);
    const stale = ground.orbit.events.filter((e) => e.kind === 'breakup' || e.strength >= 3);
    assert(stale.length === 0, `a clock seeded past the reactor still raised ${stale.map((e) => e.kind).join(', ')}`);
    late.dispose();
    return `${heard.length} events in a round: 1 break at ${BATTLE.breakAt}s, 1 reactor at ${BATTLE.reactor}s`;
  });

  check('orbit: the planet still sits in the opening for every theatre\'s star', () => {
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const dome = windowOn(key);
      /* the flight deck's own star, as Engine.applyAtmosphere would set it */
      dome.setSun(sunDirection({ elevation: 12, azimuth: 0 }, new THREE.Vector3()));
      const dir = dome.mat.uniforms.uPlanetDir.value;
      assert(dir.z > 0.85 && dir.y > -0.05,
        `${key}: the planet is at (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)}) — not in the opening`);
      const fd = dome.mat.uniforms.uFleetDir.value;
      assert(fd.dot(dir) > 0.5, `${key}: the fleet is ${Math.acos(fd.dot(dir)).toFixed(2)} rad from the world — out of the same view`);
      rows.push(`${key} z=${dir.z.toFixed(2)}`);
      dome.dispose();
    }
    return rows.join(', ');
  });
}
