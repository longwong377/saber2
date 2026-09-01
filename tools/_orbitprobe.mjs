/**
 * BATTLEFRONT BORZ — the orbit dome, without a GL context.
 *
 * Two questions this answers that no screenshot can:
 *
 *   1. IS IT A NO-OP? Every SkyDome uniform, for every level on the roster,
 *      against the values the same dump produced before `atmosphere.orbit`
 *      existed. Anything that moved is a level whose sky changed, and no
 *      level's sky was meant to change.
 *   2. DOES IT ACTUALLY DRIFT? The player asked for a world that visibly moves
 *      over two to three minutes and a cloud layer turning at its own slower
 *      rate. Both are rates, and a rate is not a thing a still frame can show.
 *
 *   node --import ./tools/register.mjs tools/_orbitprobe.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { SkyDome } from '../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { TERRAIN_PRESETS } from '../src/world/Terrain.js';
import { ground } from '../src/world/Scenery.js';
import { cloudLight, sunDirection } from '../src/engine/Engine.js';

/* ── 1. the no-op dump ─────────────────────────────────────────────────── */
{
  const dome = new SkyDome(new THREE.Scene());
  const out = {};
  for (const k of LEVEL_ORDER) {
    const a = LEVELS[k].atmosphere;
    dome.configure(a);
    const sun = sunDirection(a, new THREE.Vector3());
    dome.setSun(sun);
    const l = cloudLight(a);
    dome.setRadiance(0.95, l.sun, l.tint, l.amb);
    dome.setHaze(new THREE.Color(0.4, 0.35, 0.3), new THREE.Color(0.2, 0.18, 0.15));
    const u = dome.mat.uniforms;
    const row = { visible: dome.mesh.visible };
    for (const n of Object.keys(u).sort()) {
      const v = u[n].value;
      if (v == null) row[n] = null;
      else if (typeof v === 'number') row[n] = +v.toFixed(9);
      else if (v.isColor) row[n] = [+v.r.toFixed(9), +v.g.toFixed(9), +v.b.toFixed(9)];
      else if (v.isVector3 || v.isVector4) row[n] = v.toArray().map((x) => +x.toFixed(9));
      else if (Array.isArray(v)) row[n] = v.map((e) => e.toArray().map((x) => +x.toFixed(9)));
      else if (v.isDataTexture) {
        let h = 2166136261;
        const d = v.image.data;
        for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
        row[n] = 'tex:' + (h >>> 0);
      } else row[n] = String(v);
    }
    out[k] = row;
  }
  if (process.argv.includes('--dump')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
  const orbits = LEVEL_ORDER.map((k) => out[k].uOrbit);
  console.log('uOrbit over the roster:', JSON.stringify(orbits),
    orbits.every((v) => v === 0) ? '— every shipped level takes the old path' : '— A LEVEL TURNED IT ON');
  console.log('domes visible:', LEVEL_ORDER.filter((k) => out[k].visible).length, 'of', LEVEL_ORDER.length);
}

/* ── 2. the rates ──────────────────────────────────────────────────────── */
const d = new SkyDome(new THREE.Scene());
d.configure({ sky: false, bgColor: 0x05070c, elevation: 12, azimuth: 0, sunIntensity: 3.2, orbit: true });
d.setSun(new THREE.Vector3(0, 0.208, 0.978).normalize());
const L = LEVELS.colosseum;
d.configureOrbit({ level: L, terrain: TERRAIN_PRESETS[L.terrain], faction: 'republic', time: 0 });
console.log('visible', d.mesh.visible, 'city', d.mat.uniforms.uCityAmt.value);
console.log('broker', JSON.stringify({ dir: ground.orbit.dir.toArray().map((v) => +v.toFixed(3)),
  colour: ground.orbit.colour.getHexString(), key: +ground.orbit.key.toFixed(3),
  bounce: +ground.orbit.bounce.toFixed(4) }));
ground.orbit.events.length = 0;
const track = [];
for (let i = 0; i < 4000; i++) { d.update(0.1, null); if (i % 600 === 0) track.push([+(i * 0.1).toFixed(0), ...d.mat.uniforms.uPlanetDir.value.toArray().map((v) => +v.toFixed(3))]); }
console.log('events over 400 s:', ground.orbit.events.length,
  ground.orbit.events.slice(0, 5).map((e) => `${e.kind}@${e.at.toFixed(1)}s d${e.delay.toFixed(1)}s x${e.strength.toFixed(2)}`).join('  '));
console.log('planetDir track', JSON.stringify(track));
// how far the planet moves in 180 s, in degrees, from t=0
d.configureOrbit({ time: 0 });
const a0 = d.mat.uniforms.uPlanetDir.value.clone();
for (let i = 0; i < 1800; i++) d.update(0.1, null);
const a1 = d.mat.uniforms.uPlanetDir.value.clone();
console.log('drift over 180 s:', (a0.angleTo(a1) * 180 / Math.PI).toFixed(2), 'deg');
console.log('surface spin over 180 s:', (d.mat.uniforms.uPlanetSpin.value * 180 / Math.PI).toFixed(2),
  'deg; cloud', (d.mat.uniforms.uCloudSpin.value * 180 / Math.PI).toFixed(2),
  'deg; stars', (d.mat.uniforms.uStarSpin.value * 180 / Math.PI).toFixed(2), 'deg');
d.configure({ sky: false, bgColor: 0x05070c });
console.log('after a plain interior: uOrbit', d.mat.uniforms.uOrbit.value, 'broker', ground.orbit);
