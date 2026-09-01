import './dom-shim.mjs';
import * as THREE from 'three';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';
import { TERRAIN_PRESETS } from '../src/world/Terrain.js';
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const c = new THREE.Color();
console.log('ColorManagement.enabled', THREE.ColorManagement.enabled);
for (const k of LEVEL_ORDER) {
  const L = LEVELS[k], A = L.atmosphere || {}, P = TERRAIN_PRESETS[L.terrain] || {};
  const g = c.set(P.sandColor ?? L.groundColor ?? 0x60482e).clone();
  const r = c.set(P.rockColor ?? 0).clone();
  const br = g.b / Math.max(g.r, 1e-4);
  console.log([k.padEnd(10),
    'sandLum ' + lum(g).toFixed(3), 'rockLum ' + lum(r).toFixed(3), 'b/r ' + br.toFixed(2),
    'sunI ' + (A.sunIntensity ?? 3.6), 'elev ' + (A.elevation ?? 22), 'azim ' + (A.azimuth ?? 140),
    'expo ' + (A.exposure ?? 1.05)].join('  '));
}
