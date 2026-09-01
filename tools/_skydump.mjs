/* scratch: dump every SkyDome uniform for every level, to prove a no-op. */
import './dom-shim.mjs';
import * as THREE from 'three';
import { SkyDome } from '../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { cloudLight, skyDisplayShoulder, sunDirection } from '../src/engine/Engine.js';
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
    else if (v.isVector3) row[n] = [+v.x.toFixed(9), +v.y.toFixed(9), +v.z.toFixed(9)];
    else if (v.isDataTexture) {
      let h = 2166136261;
      const d = v.image.data;
      for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
      row[n] = 'tex:' + (h >>> 0);
    } else row[n] = String(v);
  }
  out[k] = row;
}
out.__frag = (() => { let h = 2166136261; const s = dome.mat.fragmentShader;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) + ':' + s.length; })();
console.log(JSON.stringify(out, null, 1));
