/**
 * Sky / aerial-perspective numeric probe. No GL — pure CPU evaluation of the
 * same maths the shaders run, so the numbers can be printed and argued with.
 *
 *   node tools/skyprobe.mjs [level...]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { atmosphereMeter, skyRadiance, skyShoulder, sunDirection, hazeRadiance,
  skyDisplayShoulder, cloudLight, SKY_PHYSICAL, AERIAL } from '../src/engine/Engine.js';
import { SkyDome } from '../src/engine/SkyDome.js';
import { LEVELS, LEVEL_ORDER } from '../src/game/Levels.js';

const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const sat = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx <= 1e-6 ? 0 : (mx - mn) / mx; };
const f = (v, n = 3) => v.toFixed(n);
const rgb = (c) => `(${f(c.r)},${f(c.g)},${f(c.b)})`;

// ACES + the composite grade, so a linear radiance can be turned into the
// display luminance a screenshot would actually show.
function aces(x) {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.min(Math.max((x * (a * x + b)) / (x * (c * x + d) + e), 0), 1);
}
function toDisplay(col, exposure, grade = {}) {
  const t = [col.r, col.g, col.b].map((v) => aces(v * exposure));
  const srgb = t.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  // composite: black point, filmic S, contrast, gain/lift, split tone, sat
  const black = 0.018, curve = 0.32, contrast = 1.04;
  let c = srgb.map((v) => Math.max(v - black, 0) / (1 - black));
  c = c.map((v) => v * (1 - curve) + curve * (v * v * (3 - 2 * v)));
  c = c.map((v) => (v - 0.5) * contrast + 0.5);
  const gain = grade.gain ?? [1.02, 1, 0.98], lift = grade.lift ?? [0.004, 0.006, 0.012];
  c = c.map((v, i) => v * gain[i] + lift[i]);
  const L = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const s = grade.saturation ?? 1.06;
  const k = Math.max(0, Math.min(1, (L - 0.62) / 0.38));
  const smooth = k * k * (3 - 2 * k);
  const sm = s * (1 + (0.7 - 1) * smooth);
  c = c.map((v) => L + (v - L) * sm);
  const out = new THREE.Color(Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0));
  return out;
}

const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
// Every level with a sky, asked rather than listed.
const keys = names.length ? names
  : LEVEL_ORDER.filter((k) => LEVELS[k]?.atmosphere?.sky !== false);

for (const key of keys) {
  const a = LEVELS[key]?.atmosphere;
  if (!a) { console.log(`no level ${key}`); continue; }
  const sunPos = sunDirection(a, new THREE.Vector3());
  const m = atmosphereMeter(a); const meter = m;
  console.log(`\n══ ${key} ══ sun elev ${a.elevation}° I=${a.sunIntensity}  exposure ${f(meter.exposure)} (authored ${a.exposure})`);

  // the two horizon samples applyAtmosphere derives everything from
  const side = sunPos.clone().setY(0).normalize().cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
  const flat = sunPos.clone().setY(0.03).normalize();
  const sh = skyDisplayShoulder(a, m);
  const D = [sh.knee, sh.ceil];
  console.log(`  drawn shoulder knee ${f(sh.knee)} ceil ${f(sh.ceil)}`);
  const hazeSide = skyShoulder(skyRadiance(side, sunPos, a, new THREE.Color()), ...D);
  const hazeSun = skyShoulder(skyRadiance(flat, sunPos, a, new THREE.Color()), ...D);
  const zenith = skyShoulder(skyRadiance(new THREE.Vector3(0, 1, 0), sunPos, a, new THREE.Color()), ...D);
  const pSide = skyShoulder(skyRadiance(side, sunPos, a, new THREE.Color()));
  const pSun = skyShoulder(skyRadiance(flat, sunPos, a, new THREE.Color()));
  const pZen = skyShoulder(skyRadiance(new THREE.Vector3(0, 1, 0), sunPos, a, new THREE.Color()));
  console.log(`  physical sky   zenith ${f(lum(pZen))}  horizon-side ${f(lum(pSide))}  horizon-sunward ${f(lum(pSun))}`);
  console.log(`  drawn sky      zenith ${f(lum(zenith))}  horizon-side ${f(lum(hazeSide))}  horizon-sunward ${f(lum(hazeSun))}`);

  const fog = hazeRadiance(a, new THREE.Color(), sh);
  console.log(`  fog radiance   ${rgb(fog)} lum ${f(lum(fog))} sat ${f(sat(fog))}`);

  // inscatter strength and the worst case it can add
  const gain = Math.max(0, Math.min(12, lum(pSun) - lum(pSide)));
  const w = a.inscatter ?? gain * 0.028;
  const g = 0.50, g2 = g * g;
  const phaseAt = (cos) => (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * cos, 1e-4), 1.5);
  const itint = hazeSun.clone().multiplyScalar(1 / Math.max(0.02, lum(hazeSun)));
  // energy-limited exactly as the chunk does it
  const add = (cos) => {
    const glow = itint.clone().multiplyScalar(w * (phaseAt(cos) + 0.75 * (1 + cos * cos) * 0.16));
    const capR = Math.max(fog.r, 1e-4) * 0.26, capG = Math.max(fog.g, 1e-4) * 0.26, capB = Math.max(fog.b, 1e-4) * 0.26;
    return new THREE.Color(capR * (1 - Math.exp(-glow.r / capR)),
      capG * (1 - Math.exp(-glow.g / capG)), capB * (1 - Math.exp(-glow.b / capB)));
  };
  console.log(`  inscatter w=${f(w, 4)}  phase fwd ${f(phaseAt(1))} side ${f(phaseAt(0))} back ${f(phaseAt(-1))}`);
  for (const cos of [1, 0.5, 0, -1]) {
    const t = fog.clone().add(add(cos));
    console.log(`    cos ${String(cos).padStart(4)}  fogTone lum ${f(lum(t))} (${f(lum(t) / lum(fog), 2)}× fog)  disp ${f(lum(toDisplay(t, meter.exposure, a)))}`);
  }

  // what things land at on screen
  const skyDisp = (v) => f(lum(toDisplay(v, meter.exposure, a)));
  console.log(`  display        zenith ${skyDisp(zenith)}  horizon-side ${skyDisp(hazeSide)}  fog ${skyDisp(fog)}`);

  // cloud deck, as SkyDome shades it
  const hdr = 0.95;
  // straight off the engine and the real dome, so nothing here can drift
  const CL = cloudLight(a, m);
  const cloudSun = CL.sun, cloudAmb = CL.amb, bounce = CL.bounce;
  const ambient = CL.tint.clone();
  const dome = new SkyDome(new THREE.Scene());
  dome.configure(a);
  const lit = dome.mat.uniforms.uCloudLit.value.clone();
  const dark = dome.mat.uniforms.uCloudDark.value.clone();
  dome.dispose();
  const hg = (c, gg) => { const q = gg * gg; return (1 - q) / Math.pow(1 + q - 2 * gg * c, 1.5); };
  console.log(`  cloudSun ${f(cloudSun)}  cloudAmb ${f(cloudAmb)}  (bounce ${f(bounce)})`);
  console.log(`  cloudLit ${rgb(lit)} sat ${f(sat(lit))}   cloudDark ${rgb(dark)} sat ${f(sat(dark))}  skyAmb ${rgb(ambient)}`);
  for (const [label, h, od, cosT] of [['sunlit shoulder', 1.0, 0.35, 0.0], ['thick core', 1.3, 2.8, 0.0], ['mid', 0.7, 1.2, 0.0], ['thin edge', 0.2, 0.25, 0.0], ['thick, backlit', 1.3, 2.8, 0.9]]) {
    const trans = Math.exp(-od * 0.85);
    const powder = 1 - Math.exp(-h * 3);
    const phase = Math.min(0.88 + 0.30 * hg(cosT, 0.72), 3.2);
    const sunT = trans * (0.42 + 0.58 * powder) * phase;
    const amb = 0.95 + (0.55 - 0.95) * Math.min(h, 1);
    const c = new THREE.Color(
      (dark.r * ambient.r * cloudAmb * amb + lit.r * cloudSun * sunT) * hdr,
      (dark.g * ambient.g * cloudAmb * amb + lit.g * cloudSun * sunT) * hdr,
      (dark.b * ambient.b * cloudAmb * amb + lit.b * cloudSun * sunT) * hdr);
    const d = toDisplay(c, meter.exposure, a);
    console.log(`    ${label.padEnd(15)} lin ${rgb(c)} lum ${f(lum(c))}  → display lum ${f(lum(d))} sat ${f(sat(d))}`);
  }
  // the sky the deck is composited against, at 25° elevation
  const behind = skyShoulder(skyRadiance(new THREE.Vector3(side.x, 0.42, side.z).normalize(), sunPos, a, new THREE.Color()), ...D);
  const bd = toDisplay(behind, meter.exposure, a);
  console.log(`    sky behind      lin lum ${f(lum(behind))} → display lum ${f(lum(bd))} sat ${f(sat(bd))}`);
}
