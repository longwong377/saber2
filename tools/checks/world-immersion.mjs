/**
 * The world you stand in: how full it is, how it moves, and how far it goes.
 *
 * Everything pinned here was measured, because every one of these read as
 * perfectly reasonable in the source:
 *
 *   · a third to a half of every outdoor level was ground the player could
 *     walk across with nothing within twelve metres of them. Measured on a 3 m
 *     grid over the walkable r = 90 m disc: dunes 55.0%, canyon 37.4%, arena
 *     33.3%. Nothing about the dressing code looked sparse — it places wrecks,
 *     colonnades, outposts and rock — because all of it was aimed at the
 *     fight, and the fight is the inner forty metres;
 *   · the wind's only spatial scale had fronts 114 m apart, and the grass ring
 *     is 46 m across. Less than half a wavelength is ever on screen, so the
 *     whole field leaned one way and then the other together. That is a slider
 *     being moved, not wind crossing a meadow, and no amount of per-blade
 *     noise fixes it — per-blade noise is the OPPOSITE of the fix;
 *   · the weather was a particle count. A dust field at a fixed density is
 *     identical in the first second and the ten-thousandth, so the eye files it
 *     as texture and stops seeing it;
 *   · the only thing at distance was painted on a dome at infinity, so it did
 *     not move when the player did, and the terrain visibly stopped.
 *
 * None of those throw. They are what makes a level read as a diorama.
 */

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import {
  WindField, wind, weather, Weather, WIND_GLSL, STORM_GLSL, Atmosphere, addHorizon, ground,
} from '../../src/world/Scenery.js';
import { skyRadiance, skyShoulder, skyDisplayShoulder, sunDirection } from '../../src/engine/Engine.js';
import { SkyDome } from '../../src/engine/SkyDome.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── a world stub the dressing passes are happy with ─────────────────── */
function stubWorld(terrain) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() {}, staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null,
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

/**
 * Every mesh that reached the scene, as [x, z, horizontal radius]. Instanced
 * meshes are expanded — the whole point of them is that they are hundreds of
 * separate objects, and counting one InstancedMesh as one thing is exactly how
 * a level full of scree measures as empty.
 */
function occupancy(world) {
  const out = [];
  const b = new THREE.Box3(), s = new THREE.Vector3(), c = new THREE.Vector3();
  const m = new THREE.Matrix4(), t = new THREE.Vector3();
  const q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const take = (o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    o.updateMatrixWorld(true);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      o.geometry.boundingBox.getSize(s);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.decompose(t, q, sc);
        t.applyMatrix4(o.matrixWorld);
        const r = Math.max(s.x * sc.x, s.z * sc.z) * 0.5;
        if (isFinite(t.x) && isFinite(t.z)) out.push([t.x, t.z, Math.max(0.05, r)]);
      }
    } else {
      b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      b.getSize(s); b.getCenter(c);
      // The ground plane and the horizon curtains ARE the view; they are not
      // things standing in it, and counting them would make every sample pass.
      if (s.x > 120 || s.z > 120) return;
      if (isFinite(c.x) && isFinite(c.z)) out.push([c.x, c.z, Math.max(0.05, Math.max(s.x, s.z) * 0.5)]);
    }
  };
  world.scene.traverse(take);
  for (const p of world.props) { if (p.mesh) (p.mesh.traverse ? p.mesh.traverse(take) : take(p.mesh)); }
  return out;
}

function nearestGap(occ, x, z, minR) {
  let best = Infinity;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i][2] < minR) continue;
    const dx = occ[i][0] - x, dz = occ[i][1] - z;
    const d = Math.sqrt(dx * dx + dz * dz) - occ[i][2];
    if (d < best) best = d;
  }
  return best < 0 ? 0 : best;
}

let FILL = null;
/** The barrenness survey, run once and shared by the checks below. */
function fill() {
  if (FILL) return FILL;
  FILL = new Map();
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    /* The dojo is skipped, and the reason matters: it is a walled octagonal
     * hall 22 m across that the player cannot leave, so surveying a 90 m disc
     * around it measures 78% "barren" ground nobody can ever reach. The metric
     * is only meaningful where the walkable area and the survey area are the
     * same thing. The hangar is also an interior and is NOT skipped — its bay
     * is 92 m across, so the survey is measuring real floor. */
    if (!L || typeof L.dress !== 'function' || L.training) continue;
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
    const world = stubWorld(terrain);
    L.dress(world);
    const occ = occupancy(world);
    const R = 90, step = 4;
    let total = 0, footBad = 0, silBad = 0;
    const foot = [];
    for (let z = -R; z <= R; z += step) {
      for (let x = -R; x <= R; x += step) {
        if (x * x + z * z > R * R) continue;
        if (!terrain.inBounds(x, z, 6)) continue;
        if (terrain.slopeAt(x, z) > 0.55) continue;      // not ground you can stand on
        total++;
        const f = nearestGap(occ, x, z, 0.35);
        foot.push(f);
        if (f > 12) footBad++;
        if (nearestGap(occ, x, z, 1.20) > 25) silBad++;
      }
    }
    foot.sort((a, b) => a - b);
    let meshes = 0;
    world.scene.traverse((o) => { if (o.isMesh && o.geometry) meshes++; });
    for (const p of world.props) { if (p.mesh) p.mesh.traverse((o) => { if (o.isMesh && o.geometry) meshes++; }); }
    FILL.set(key, {
      samples: total, objects: occ.length, meshes,
      foot: footBad / total, sil: silBad / total,
      p50: foot[(foot.length * 0.5) | 0], p95: foot[(foot.length * 0.95) | 0],
    });
    terrain.dispose();
  }
  return FILL;
}

export function run({ check, assert, near }) {

  /* ══ nowhere barren ══════════════════════════════════════════════════ */

  check('levels: nowhere you can stand has nothing in reach', () => {
    /* THE measurement this whole workstream exists for. On a 4 m grid over the
     * walkable r = 90 m disc, how much of the ground has nothing with a
     * silhouette within twelve metres of it?
     *
     * Before:  dunes 55.0%   arena 33.3%   canyon 37.4%   hangar 1.4%
     *
     * A third to a half of three levels. The dressing code did not look sparse
     * — it builds a colonnade, an outpost, three wrecks, a rock arch — but all
     * of it aims at the inner forty metres, and past that the levels were bare
     * heightfield. The gate is 0.35 m because that is about the smallest thing
     * that reads as an object rather than as ground texture. */
    const rows = [];
    for (const [key, f] of fill()) {
      assert(f.samples > 900, `${key}: only ${f.samples} walkable samples to survey`);
      assert(f.foot < 0.10,
        `${key}: ${(f.foot * 100).toFixed(1)}% of the walkable ground has nothing within 12 m`);
      assert(f.p50 < 6.5, `${key}: the median gap to the nearest object is ${f.p50.toFixed(1)} m`);
      rows.push(`${key} ${(f.foot * 100).toFixed(1)}% p50 ${f.p50.toFixed(1)}m`);
    }
    assert(rows.length >= 4, `only ${rows.length} levels surveyed`);
    return rows.join(', ');
  });

  check('levels: and there is always something with a silhouette in view', () => {
    /* The other half, and a different question: "at my feet" is not "in view".
     * A metre of gravel does not stop a level reading as empty — what does is
     * something big enough to sit on the skyline and give the ground a scale.
     * Gate 1.2 m radius within 25 m.
     *
     * Before:  dunes 31.8%   canyon 21.6%   arena 7.4%   hangar 0.0% */
    const rows = [];
    for (const [key, f] of fill()) {
      assert(f.sil < 0.12,
        `${key}: ${(f.sil * 100).toFixed(1)}% of the ground has nothing over 1.2 m within 25 m`);
      rows.push(`${key} ${(f.sil * 100).toFixed(1)}%`);
    }
    return rows.join(', ');
  });

  check('levels: filling the ground did not cost a draw call per pebble', () => {
    /* The obvious way to fill a level is a loop around `addRock`, which is ONE
     * DRAW CALL PER ROCK. The first version of this pass did exactly that and
     * took the arena from 351 meshes to 502 for less fill than the instanced
     * version gives. Everything wide-area now goes through `addScree`, which is
     * one instanced call for hundreds of stones — so the object count and the
     * mesh count have to be allowed to diverge by a wide margin. */
    const rows = [];
    const ratios = [];
    for (const [key, f] of fill()) {
      assert(f.meshes < 520, `${key} dresses itself in ${f.meshes} draw calls`);
      rows.push(`${key} ${f.objects} objects / ${f.meshes} calls (${(f.objects / f.meshes).toFixed(1)}:1)`);
      // Only the levels with open ground to fill. A hangar is a room: it is
      // dense because it is small, every object in it is hand-placed and near
      // enough to be seen properly, and instancing its crates would buy
      // nothing. Holding it to the same ratio would be measuring the wrong
      // thing and would push someone to instance a workshop.
      if (LEVELS[key].atmosphere.sky !== false) ratios.push(f.objects / f.meshes);
    }
    const worst = Math.min(...ratios);
    assert(ratios.length >= 3, `only ${ratios.length} outdoor levels to measure`);
    assert(worst > 5, `the least instanced outdoor level packs only ${worst.toFixed(1)} objects per draw call`);
    return rows.join('; ');
  });

  /* ══ the wind's fine scale ═══════════════════════════════════════════ */

  check('wind: the wave is a travelling band, and its GLSL twin has the same numbers', () => {
    // Same guarantee `windGust` already has: WindField and WIND_GLSL are
    // hand-mirrored, and if one drifts the grass waves at one speed and the
    // dust at another.
    const nums = (s) => (s.match(/(?<![\w.])\d+\.\d+/g) || []).map(Number);
    const glsl = WIND_GLSL.slice(WIND_GLSL.indexOf('float windWave'), WIND_GLSL.lastIndexOf('vec3 windAt'));
    assert(glsl.length > 40, 'WIND_GLSL has no windWave at all');
    const inShader = new Set(nums(glsl).map((n) => n.toFixed(6)));
    const inJs = nums(WindField.prototype.wave.toString()).map((n) => n.toFixed(6));
    const missing = inJs.filter((n) => !inShader.has(n));
    assert(missing.length === 0, `coefficients only the CPU has: ${missing.join(', ')}`);

    const w = new WindField({ heading: 0, strength: 2, gustiness: 0.6 });
    w.wander = 0;
    w._refresh();
    // ── crest spacing along the wind. This is the number that decides whether
    // a field reads as a field: 15 m puts three crests across a 46 m grass
    // ring, and the gust scale's 114 m puts less than half of one.
    const zeros = [];
    let prev = w.wave(0, 0, 0);
    for (let x = 0.1; x < 200; x += 0.1) {
      const v = w.wave(x, 0, 0);
      if ((prev < 0) !== (v < 0)) zeros.push(x);
      prev = v;
    }
    assert(zeros.length > 12, `only ${zeros.length} zero crossings in 200 m — that is not a wave`);
    const spacing = 2 * (zeros[zeros.length - 1] - zeros[0]) / (zeros.length - 1);
    assert(spacing > 9 && spacing < 24,
      `crests are ${spacing.toFixed(1)} m apart — a field reads waves at 10-20 m`);
    // and the gust scale must still be the LONG one, or there is only one scale
    const gz = [];
    let gp = w.gust(0, 0, 0);
    for (let x = 0.5; x < 600; x += 0.5) {
      const v = w.gust(x, 0, 0);
      if ((gp < 0) !== (v < 0)) gz.push(x);
      gp = v;
    }
    const gustSpacing = 2 * (gz[gz.length - 1] - gz[0]) / (gz.length - 1);
    assert(gustSpacing > spacing * 3,
      `gusts repeat every ${gustSpacing.toFixed(0)} m against waves at ${spacing.toFixed(0)} m — one scale, not two`);

    // ── it TRAVELS, downwind, at a believable speed. Measured by finding the
    // shift that best re-aligns the field a second later.
    const dt = 1.0;
    let bestShift = 0, bestErr = Infinity;
    for (let sh = -20; sh <= 20; sh += 0.05) {
      let e = 0;
      for (let x = 0; x < 120; x += 1) e += Math.abs(w.wave(x + sh, 0, dt) - w.wave(x, 0, 0));
      if (e < bestErr) { bestErr = e; bestShift = sh; }
    }
    // positive shift means the pattern moved toward +x, which IS downwind here
    assert(bestShift > 3 && bestShift < 14,
      `the wave pattern moves at ${bestShift.toFixed(1)} m/s — wind waves travel at walking to jogging pace`);
    assert(bestErr < 6, `the pattern does not survive being shifted (residual ${bestErr.toFixed(1)})`);
    return `crests ${spacing.toFixed(1)} m apart travelling ${bestShift.toFixed(1)} m/s, ` +
      `gusts ${gustSpacing.toFixed(0)} m apart (${(gustSpacing / spacing).toFixed(1)}× coarser)`;
  });

  check('grass: a gust front crossing the field is visible as LIGHT, not only as motion', () => {
    /* Wind on a meadow is legible from a hundred metres, and almost none of
     * that is the movement — it is that a band of blades laid over shows you
     * its pale underside and its sheen at the same moment. This ports the two
     * places the shader uses the wave and checks both are actually doing
     * something: `1 + uWaveGain·wave` on the bend, and the silver mix on the
     * albedo. Read out of the SOURCE, so it cannot pass on a copy of the
     * numbers that has drifted from the shader.
     */
    const w = new WindField({ heading: 0, strength: 1.7, gustiness: 0.62 });
    w.wander = 0; w._refresh();
    const waveGain = 0.62, sheen = 0.55, lift = 1.7;

    // bend, as the vertex shader computes it, along one line across the field
    let bendMin = Infinity, bendMax = 0;
    let lumMin = Infinity, lumMax = 0;
    const base = [0.32, 0.40, 0.22];             // a mid green blade, linear
    const L = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    for (let x = 0; x < 120; x += 0.25) {
      const g = w.gust(x, 0, 0);
      const wmag = Math.max(0, w.strength * (1 + w.gustiness * g));
      const wv = w.wave(x, 0, 0);                // per-tuft factor left at 1
      const lay = 1 + waveGain * wv;
      const bend = 0.23 * wmag * lay;
      bendMin = Math.min(bendMin, bend); bendMax = Math.max(bendMax, bend);
      // the fragment shader's silver, at the tip where the height ramp is 1
      const k = Math.min(1, Math.max(0, wv * 0.5 + 0.5)) * sheen;
      const l0 = L(base);
      const silver = base.map((c) => (c + (l0 - c) * 0.45) * lift);
      const out = base.map((c, i) => c + (silver[i] - c) * k);
      lumMin = Math.min(lumMin, L(out)); lumMax = Math.max(lumMax, L(out));
    }
    assert(lay0Positive(waveGain), `1 + ${waveGain}·wave can go negative — the crest bends upwind`);
    assert(bendMax / bendMin > 2.5,
      `the wave only moves the bend by ${(bendMax / bendMin).toFixed(2)}:1 — that is a breeze, not a wave`);
    const depth = (lumMax - lumMin) / lumMax;
    assert(depth > 0.18,
      `a crest is only ${(depth * 100).toFixed(1)}% brighter than a trough — the wave is invisible at range`);
    assert(depth < 0.60, `a crest is ${(depth * 100).toFixed(0)}% brighter — that is a strobe, not grass`);
    return `bend ${bendMin.toFixed(2)}–${bendMax.toFixed(2)} rad (${(bendMax / bendMin).toFixed(1)}:1), ` +
      `crest/trough luminance ${(depth * 100).toFixed(0)}%`;
  });

  /* ══ weather ═════════════════════════════════════════════════════════ */

  check('weather: a squall arrives, peaks, and leaves — and it is mostly calm', () => {
    /* The whole difference between weather and a particle count. Walked over a
     * full cycle at 10 Hz: the intensity has to spend most of its time low, get
     * to something like full at the peak, and take LONGER to leave than to
     * arrive, because a squall line hits in seconds and blows itself out over
     * a minute. A symmetric bump is a fade-in/fade-out, which is a transition. */
    const W = new Weather({ peak: 1, period: 120, duration: 40, unrest: 0.14, phase: 0 });
    const N = 1200, dt = 0.1;
    const trace = [];
    for (let i = 0; i < N; i++) { W.update(dt); trace.push(W.intensity); }
    const peak = Math.max(...trace);
    const calmFrac = trace.filter((v) => v < 0.25).length / trace.length;
    assert(peak > 0.9, `the storm only reaches ${peak.toFixed(2)} — that is a breeze`);
    assert(calmFrac > 0.55,
      `only ${(calmFrac * 100).toFixed(0)}% of the cycle is calm — permanent weather is wallpaper`);
    // and it is never dead flat, or calm is its own tell
    assert(Math.min(...trace) < 0.12 && new Set(trace.map((v) => v.toFixed(3))).size > 200,
      'the calm between fronts is a constant');
    // rise vs fall, measured between the half-power crossings and the peak
    const iPeak = trace.indexOf(peak);
    let rise = 0; for (let i = iPeak; i > 0 && trace[i] > 0.5; i--) rise = (iPeak - i) * dt;
    let fall = 0; for (let i = iPeak; i < N && trace[i] > 0.5; i++) fall = (i - iPeak) * dt;
    assert(fall > rise * 1.6,
      `the front takes ${rise.toFixed(0)} s to arrive and ${fall.toFixed(0)} s to leave — that is symmetric`);
    return `peak ${peak.toFixed(2)}, calm ${(calmFrac * 100).toFixed(0)}% of the cycle, ` +
      `${rise.toFixed(0)} s in / ${fall.toFixed(0)} s out`;
  });

  check('weather: the front is somewhere, then here, then gone', () => {
    /* A global fade is not a storm rolling through, it is a slider. The leading
     * edge has a position along the wind axis, it crosses the camera at the
     * gust fronts' own speed, and a point downwind of it is still clear while a
     * point upwind of it is already in the dust. */
    const W = new Weather({ peak: 1, period: 120, duration: 40, unrest: 0, phase: 0 });
    const prevWander = wind.wander;
    wind.set(0, 2, 0.6); wind.wander = 0; wind._refresh();
    let sawApproach = false, sawOver = false, sawPast = false;
    let crossStart = -1, crossEnd = -1;
    let worstOrder = 0, backwards = 0, prevFront = -1e9, minFront = 1e9, maxFront = -1e9;
    for (let i = 0; i < 1200; i++) {
      W.update(0.1);
      const up = W.localAt(-140, 0);    // 140 m upwind — where the wall comes from
      const here = W.localAt(0, 0);
      const down = W.localAt(45, 0);    // just downwind — the last ground to go
      // The invariant, every frame: dust never increases downwind. A front that
      // is denser ahead of itself than behind is not a front.
      worstOrder = Math.max(worstOrder, down - up);
      if (W.intensity > 0.4) {
        // the edge has to advance while the storm is actually blowing
        if (W.frontOffset + 1e-9 < prevFront) backwards++;
        prevFront = W.frontOffset;
        minFront = Math.min(minFront, W.frontOffset);
        maxFront = Math.max(maxFront, W.frontOffset);
        if (up > here + 0.05 && here > down + 0.05) sawApproach = true;
        if (here > 0.55) { sawOver = true; if (crossStart < 0) crossStart = i * 0.1; crossEnd = i * 0.1; }
        if (down > 0.55 && here > 0.55) sawPast = true;
      } else { prevFront = -1e9; }
      // never out of range, whatever the front is doing
      assert(here >= 0 && here <= 1.0001, `local dust load left [0,1]: ${here}`);
    }
    wind.wander = prevWander;
    assert(worstOrder <= 1e-6, `the dust is ${worstOrder.toFixed(2)} denser downwind than upwind`);
    assert(sawApproach, 'the dust load is the same upwind and downwind — the front does not travel');
    assert(sawOver, 'the front never actually reached the camera while the storm was still blowing');
    assert(sawPast, 'the front never got past the camera before the storm blew out');
    assert(backwards === 0, `the leading edge moved upwind on ${backwards} frames`);
    // and it has to arrive from upwind and leave downwind, not appear on top of you
    assert(minFront < -40 && maxFront > 90,
      `the edge only travelled ${minFront.toFixed(0)} → ${maxFront.toFixed(0)} m while the storm was blowing`);
    const dwell = crossEnd - crossStart;
    assert(dwell > 6 && dwell < 45, `the wall sat on the camera for ${dwell.toFixed(0)} s`);

    // the GLSL twin has to be the same profile
    assert(/1\.0 - smoothstep\(uStorm\.y - uStorm\.z, uStorm\.y, s\)/.test(STORM_GLSL),
      'STORM_GLSL no longer computes the leading edge the way Weather.localAt does');
    return `edge runs ${minFront.toFixed(0)} → ${maxFront.toFixed(0)} m, crosses in ${dwell.toFixed(0)} s, ` +
      'upwind leads downwind throughout';
  });

  check('weather: one number drives wind, visibility and the light together', () => {
    /* The reason there is a scheduler at all. If the dust decided its own
     * density, the fog its own thickness and the sun its own level, they would
     * disagree — and disagreement is what reads as fake. Built on a real
     * Atmosphere over a lit, fogged scene, then driven to a peak. */
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xfff0d8, 7);
    sun.position.set(30, 60, 20); sun.castShadow = true;
    const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x8a6a44, 0.30);
    scene.add(sun); scene.add(hemi);
    scene.fog = new THREE.FogExp2(0xd8c8a4, 0.0042);

    const a = new Atmosphere(scene, {
      count: 120, density: 0.5, color: 0xd8c8a8, opacity: 0.34,
      weather: { peak: 1, period: 120, duration: 40, unrest: 0, phase: 0, fogGain: 3.6, windGain: 2.6 },
    });
    const fog0 = scene.fog.density, sun0 = sun.intensity, hemi0 = hemi.intensity;
    const windSpeed0 = wind.strength;
    const vis0 = a.weather.visibility(fog0);

    let peak = null;
    const centre = V(0, 0, 0);
    for (let i = 0; i < 400; i++) {
      a.update(0.1, centre);
      if (!peak || a.weather.intensity > peak.I) {
        peak = { I: a.weather.intensity, fog: scene.fog.density, sun: sun.intensity,
          hemi: hemi.intensity, wind: wind.strength, vis: a.weather.visibility(fog0) };
      }
    }
    assert(peak.I > 0.9, `the storm never got going (${peak.I.toFixed(2)})`);
    assert(peak.fog > fog0 * 2, `fog only went ${fog0.toFixed(4)} → ${peak.fog.toFixed(4)}`);
    /* HALF THE LIGHT SURVIVING AT 43 m INSTEAD OF 198 m, which is what the dune
     * sea's own fogGain asks for and what it did not used to get. The storm was
     * held to 85 m by a cap that had nothing to do with weather —
     * Terrain._syncAtmosphere used to test the LIVE fog density against 0.01 to
     * decide whether it was indoors, so anything past that line switched the
     * ground's aerial term off mid-squall and the cap existed to stay under it.
     * Measured cost: a full-strength front moved the arena's median frame
     * luminance from 0.2856 to 0.2711. Five per cent, for the whole storm.
     *
     * Terrain now tests the density the level AUTHORED, so the check is the
     * real one: visibility has to collapse to a quarter, AND the ground has to
     * still know it is outdoors while it does. */
    assert(peak.vis < vis0 * 0.28,
      `visibility only fell ${vis0.toFixed(0)} m → ${peak.vis.toFixed(0)} m`);
    {
      const t = new Terrain(new THREE.Scene(), 'dunes', 0.5);
      t._scene = scene;
      scene.fog.density = fog0; t._syncAtmosphere();          // calm, outdoors
      const calm = t._uniforms.uHaze.value.y;
      scene.fog.density = peak.fog; t._syncAtmosphere();      // the same air, stormed
      const storm = t._uniforms.uHaze.value.y;
      assert(calm > 0.01 && storm === calm,
        `the ground's aerial term went ${calm.toFixed(3)} → ${storm.toFixed(3)} at fog ` +
        `${peak.fog.toFixed(4)} — the storm is switching the terrain indoors and back`);
      t.dispose();
      scene.fog.density = peak.fog;
    }
    assert(peak.sun < sun0 * 0.65, `the key light barely moved: ${sun0} → ${peak.sun.toFixed(2)}`);
    assert(peak.hemi > hemi0 * 1.2,
      'the fill did not come up — a dust storm converts direct light into ambient, it is not a dimmer');
    assert(peak.wind > windSpeed0 * 2.5, `the wind only went ${windSpeed0} → ${peak.wind.toFixed(2)} m/s`);
    // and the sun took the colour of what it is coming through
    assert(sun.color.b < 0.98, 'the sun kept its clear-air colour through a dust storm');

    a.dispose();
    // ── and NOTHING it borrowed outlives the level
    near(scene.fog.density, fog0, 1e-9, 'the fog stayed thickened after dispose');
    near(sun.intensity, sun0, 1e-9, 'the sun stayed dimmed after dispose');
    near(hemi.intensity, hemi0, 1e-9, 'the fill stayed lifted after dispose');
    near(wind.strength, windSpeed0, 1e-9, 'the wind stayed up after dispose');
    near(weather.intensity, 0, 1e-9, 'the weather kept running with no level to run in');
    return `I ${peak.I.toFixed(2)}: visibility ${vis0.toFixed(0)} → ${peak.vis.toFixed(0)} m, ` +
      `sun ${sun0.toFixed(1)} → ${peak.sun.toFixed(1)}, fill ×${(peak.hemi / hemi0).toFixed(2)}, ` +
      `wind ${windSpeed0.toFixed(1)} → ${peak.wind.toFixed(1)} m/s; all restored`;
  });

  check('weather: indoors there is none of it', () => {
    // A dust storm crossing a hangar bay is a bug report. The only signal is
    // whether the scene has a sky, which is what the rest of Atmosphere uses.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d13);
    scene.add(new THREE.DirectionalLight(0xbcd0ff, 3.4));
    scene.fog = new THREE.FogExp2(0x141922, 0.016);
    const fog0 = scene.fog.density;
    const a = new Atmosphere(scene, { count: 60, density: 0.5, weather: { peak: 1, phase: 0 } });
    for (let i = 0; i < 200; i++) a.update(0.1, V(0, 0, 0));
    assert(a.weather.intensity === 0, `the hangar is in a ${a.weather.intensity.toFixed(2)} dust storm`);
    near(scene.fog.density, fog0, 1e-9, 'the hangar fog moved');
    assert(!a.banks.mesh, 'a hangar grew fog banks');
    a.dispose();
    return 'no weather without a sky';
  });

  check('weather: every outdoor level says how hard its own weather gets', () => {
    // The scheduler is shared; the CHARACTER is the level's. An open dune sea
    // and a sheltered bowl cannot have the same storm, and a level that forgot
    // to say gets none at all rather than a default that is wrong everywhere.
    const rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L) continue;
      const outdoor = L.atmosphere.sky !== false;
      const w = L.dust && L.dust.weather;
      if (!outdoor) { assert(!w || !w.peak, `${key} is indoors and has weather`); continue; }
      assert(w && w.peak > 0.4, `${key} is outdoors under an open sky with no weather at all`);
      assert(w.period > w.duration * 1.8,
        `${key} storms for ${w.duration}s every ${w.period}s — that is not weather, that is the climate`);
      rows.push(`${key} peak ${w.peak} every ${w.period}s`);
    }
    assert(rows.length >= 3, `only ${rows.length} outdoor levels carry weather`);
    // and the levels must not all be the same storm
    const peaks = new Set(rows.map((r) => r.split('peak ')[1]));
    assert(peaks.size > 1, 'every level has identical weather');
    return rows.join(', ');
  });

  /* ══ distance ════════════════════════════════════════════════════════ */

  check('horizon: three ranges at three distances, and they move when you do', () => {
    /* The sky dome's painted ridges sit at infinity: they do not shift when the
     * player walks, and the eye reads that inside about ten seconds. These are
     * real geometry at 170/250/340 m, which is the ONE cue a dome cannot fake.
     *
     * Measured as parallax: from the centre and from 60 m off it, the apparent
     * bearing of a point on the near range has to move several times as far as
     * the same point on the far one. */
    const terrain = new Terrain(new THREE.Scene(), 'dunes', 0.5);
    const world = stubWorld(terrain);
    world.scene.fog = new THREE.FogExp2(0xd8c8a4, 0.0042);
    const before = world.physics.staticBoxes.length;
    const meshes = addHorizon(world, { seed: 4401 });
    assert(meshes.length === 3, `${meshes.length} ranges — layering needs at least three`);
    assert(world.physics.staticBoxes.length === before,
      'the far ranges took colliders — they are scenery, and the player can never reach them');
    assert(world.statics.length >= 3, 'the ranges never reached world.statics, so unload will leak them');

    const radii = [], heights = [], spans = [];
    for (const m of meshes) {
      assert(!m.castShadow, 'a range 300 m away is in the shadow cascade');
      const p = m.geometry.attributes.position;
      assert(m.geometry.attributes.aNear && m.geometry.attributes.aFar,
        'a range with no aNear/aFar attribute renders as the material colour — a white wall');
      let rmin = Infinity, rmax = 0, top = -1e9, bot = 1e9;
      const tops = [];
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getZ(i));
        rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
        const y = p.getY(i);
        top = Math.max(top, y); bot = Math.min(bot, y);
        if (i % 2 === 1) tops.push(y);
      }
      near(rmax, rmin, rmax * 0.02, 'a range is not a ring');
      radii.push(rmax);
      heights.push(top);
      tops.sort((a, b) => a - b);
      spans.push(tops[(tops.length * 0.9) | 0] - tops[(tops.length * 0.1) | 0]);
      assert(bot < -20, 'a range is not rooted below grade — you can see under it');
    }
    for (let i = 1; i < radii.length; i++) {
      assert(radii[i] > radii[i - 1] * 1.2, `ranges at ${radii[i - 1].toFixed(0)} and ${radii[i].toFixed(0)} m are the same range`);
      assert(heights[i] > heights[i - 1], 'a further range is not taller — it will hide behind the near one');
    }
    for (let i = 0; i < spans.length; i++) {
      assert(spans[i] > radii[i] * 0.03,
        `range ${i} varies by only ${spans[i].toFixed(1)} m over ${radii[i].toFixed(0)} m — a cylinder with a lid`);
    }

    // parallax: how far a crest slides across the view when the player walks
    const bearingShift = (R) => {
      const off = 60;
      // a point straight ahead at range R, seen from 60 m to the side
      return Math.abs(Math.atan2(off, R)) * 180 / Math.PI;
    };
    const nearShift = bearingShift(radii[0]), farShift = bearingShift(radii[2]);
    assert(nearShift > farShift * 1.5,
      `the near range shifts ${nearShift.toFixed(1)}° and the far one ${farShift.toFixed(1)}° — no layering`);
    // and something too big to be near: the far range has to out-subtend
    // everything in the play space (nothing there is over 20 m)
    const farAngle = Math.atan2(heights[2], radii[2]) * 180 / Math.PI;
    assert(heights[2] > 45, `the far range tops out at ${heights[2].toFixed(0)} m — that could be a building`);
    terrain.dispose();
    return `ranges at ${radii.map((r) => r.toFixed(0)).join('/')} m, crests to ` +
      `${heights.map((h) => h.toFixed(0)).join('/')} m, parallax ${nearShift.toFixed(1)}° vs ${farShift.toFixed(1)}°, ` +
      `far range subtends ${farAngle.toFixed(1)}°`;
  });

  check('horizon: every range is DARKER and BLUER than the sky it stands against', () => {
    /* The single sharpest thing an art director found in the whole frame, and
     * it was true: measured on two dune frames the cones came out at 0.703 /
     * 0.611 / 0.688 / 0.600 display luminance against sky immediately beside
     * them at 0.547 / 0.635 / 0.537 — ratios of 1.29, 1.12, 1.08, 1.12 — at
     * hue 36-37° against a sky at 160-198°. Flat white paper triangles.
     *
     * The cause was that the ranges converged on scene.fog, and scene.fog is
     * ONE COLOUR while the sky is not: hazeRadiance anchors it to the skyline
     * BESIDE THE SUN. Measured on the dune atmosphere at 8° elevation, drawn
     * sky radiance runs 0.821 at 20° from the sun down to 0.391 at 155°, all
     * against a fog colour of 0.589 — so on the shade half of the horizon the
     * thing distance dissolved into was one and a half times the sky it was
     * dissolving into, and no vertex shading could fix that.
     *
     * So this asserts the RELATIONSHIP rather than any constant: at every
     * vertex of every range of every outdoor level, at that level's own hour,
     * the composited range must be darker than the drawn sky directly above it
     * AND bluer than it. Both are computed off the engine's own exported sky,
     * not off a transcription of it. */
    const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const rows = [];
    let worstL = 0, worstB = Infinity, worstAt = '';
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      const a = L.atmosphere || {};
      if (a.sky === false || a.horizon === false) continue;
      const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
      const world = stubWorld(terrain);
      world.level = L;
      world.scene.fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
      // The ranges read the sky the DOME baked, so the dome has to exist —
      // which is also the check that the two agree about the same horizon.
      const dome = new SkyDome(world.scene);
      dome.configure(a);
      const meshes = addHorizon(world, { seed: 4400 });
      const disp = skyDisplayShoulder(a);
      const sun = sunDirection(a, new THREE.Vector3());
      const invH = 1 / (a.fogHeight ?? 38), rho = a.fogDensity ?? 0.0035;
      const camY = 1.75, sky = new THREE.Color(), out = new THREE.Color();
      let hi = 0, lo = Infinity, bMin = Infinity;
      for (const m of meshes) {
        const P = m.geometry.attributes.position;
        const N = m.geometry.attributes.aNear, F = m.geometry.attributes.aFar;
        for (let i = 1; i < P.count; i += 2) {           // crest row only
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          const R = Math.hypot(x, z), relY = y - camY, dist = Math.hypot(R, relY);
          // the shader's own extinction, camera in the middle of the ring
          const k = relY * invH, t0 = Math.exp(-camY * invH);
          const mm = Math.abs(k) < 1e-3 ? t0 : t0 * (1 - Math.exp(-k)) / k;
          const path = dist * Math.min(6, Math.max(0, mm));
          const f = 1 - Math.exp(-rho * rho * path * path);
          out.setRGB(N.getX(i) + (F.getX(i) - N.getX(i)) * f,
            N.getY(i) + (F.getY(i) - N.getY(i)) * f,
            N.getZ(i) + (F.getZ(i) - N.getZ(i)) * f);
          // the sky DIRECTLY ABOVE that crest: same bearing, 3° higher
          const el = Math.atan2(relY, R) + 0.052, ce = Math.cos(el) / Math.max(R, 1e-4);
          skyShoulder(skyRadiance(new THREE.Vector3(x * ce, Math.sin(el), z * ce), sun, a, sky),
            disp.knee, disp.ceil);
          const ratio = lum(out) / Math.max(1e-4, lum(sky));
          // "bluer" with no argument about hue wheels: more blue per unit red.
          const br = (out.b / Math.max(1e-4, out.r)) / (sky.b / Math.max(1e-4, sky.r));
          hi = Math.max(hi, ratio); lo = Math.min(lo, ratio); bMin = Math.min(bMin, br);
          if (ratio > worstL) { worstL = ratio; worstAt = key; }
          worstB = Math.min(worstB, br);
        }
      }
      rows.push(`${key} ${lo.toFixed(2)}–${hi.toFixed(2)}× B/R ≥${bMin.toFixed(2)}`);
      dome.dispose();
      terrain.dispose();
    }
    assert(rows.length >= 3, 'no outdoor level built ranges to measure');
    assert(worstL < 0.95,
      `a range reaches ${worstL.toFixed(3)}× the sky above it on ${worstAt} — a landform behind 300 m ` +
      'of the same air cannot be that bright');
    assert(worstB > 1.05,
      `a range is only ${worstB.toFixed(3)}× as blue-over-red as its own sky — distance is not reading as distance`);
    return `${rows.join(', ')} (radiance, before the tone curve)`;
  });

  check('sky: the painted skyline is the sky times an extinction, and a storm takes it away', () => {
    /* The dome and the geometry do different jobs: the geometry owns 170-340 m
     * and parallaxes, the dome owns everything past it and does not.
     *
     * There used to be four painted ranges, mixed toward the haze at
     * 0.08 / 0.18 / 0.32 / 0.50. Composited contrast is exactly
     * alpha × mix × (land − haze), so the top two landed under two per cent of
     * the sky's luminance once the grade was applied: below the threshold at
     * which anything is a shape. Two ranges that can be seen beat four where
     * half are paid for and not delivered — and both are now the SKY IN THAT
     * DIRECTION times a per-range extinction, so neither can come out brighter
     * than what is behind it whatever the level authored. */
    const src = SKY_SOURCE();
    const bands = (src.match(/float ridge(Far|Near)\s*=/g) || []).length;
    assert(bands === 2, `the dome paints ${bands} ranges`);
    assert(/uSkyBand/.test(src) && /texture2D\(uSkyBand/.test(src),
      'the dome has no directional sky, so its skyline is one colour round the whole compass again');
    const tints = [...src.matchAll(/const vec3 BAND_(FAR|NEAR)\s*=\s*vec3\(([^)]*)\)/g)]
      .map((m) => [m[1], m[2].split(',').map(Number)]);
    assert(tints.length === 2, 'the painted ranges no longer declare their extinction');
    for (const [name, t] of tints) {
      assert(t.every((v) => v > 0 && v < 1), `BAND_${name} is not an extinction — ${t.join(', ')}`);
      assert(t[2] > t[1] && t[1] > t[0], `BAND_${name} is not Rayleigh-ordered, so it cannot read as distance`);
      const L = t[0] * 0.2126 + t[1] * 0.7152 + t[2] * 0.0722;
      // ~2% of the sky's own luminance is where a soft-edged shape stops being
      // a shape. Both ranges have to clear that by a wide margin.
      assert(1 - L > 0.08, `BAND_${name} sits ${((1 - L) * 100).toFixed(1)}% under its sky — invisible`);
    }
    assert(/uStorm/.test(src), 'the dome cannot see the weather, so the skyline survives a dust storm');
    assert(/mix\(0\.10, 0\.62, uStorm\)/.test(src),
      'the skyline haze band does not lift during a front — dust does not stay near the ground');
    const contrast = tints.map(([n, t]) =>
      `${n} ${((1 - (t[0] * 0.2126 + t[1] * 0.7152 + t[2] * 0.0722)) * 100).toFixed(1)}%`).join(', ');
    return `2 painted ranges off the sky band, contrast ${contrast}, band 0.10 → 0.62 rad in a storm`;
  });
}

/** `1 + gain·wave` must stay positive, or the crest of every band bends upwind. */
function lay0Positive(gain) { return gain * 1.25 < 1; }

/**
 * The sky dome's source. Its shader is a module-private template literal, so
 * the only honest way to assert on it is to read the file — a copy of the
 * constants in here would agree with itself forever.
 */
let _skySrc = null;
function SKY_SOURCE() {
  if (_skySrc === null) {
    _skySrc = readFileSync(new URL('../../src/engine/SkyDome.js', import.meta.url), 'utf8');
  }
  return _skySrc;
}
