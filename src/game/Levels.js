/**
 * SABER — theatres.
 *
 * Each level is a terrain preset, an atmosphere, and a dressing pass that
 * scatters architecture and props. They are large by design — the horde needs
 * somewhere to come from, and a Jedi needs somewhere to fall back to.
 */

import * as THREE from 'three';
import { makeCrate, makeBarrel, makePillar, makeVaporator, makeSpire, makeConsole, addWall, addRock, BlastDoor, propMaterials } from '../world/Props.js';
import { makeRng, clamp, TAU, lerp } from '../engine/MathUtil.js';
import { DOJO_LEVEL } from './Dojo.js';

const rng = makeRng(20250805);

/* ══════════════════════════════════════════════════════════════════════ */
/*  Composition                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The single biggest reason a procedural level reads as a toy is UNIFORM
 * SCATTER: N objects placed at independent random positions over a disc. Real
 * places are not uniform. Things cluster, because something put them there —
 * a building fell, a convoy stopped, water ran. The eye reads that instantly
 * and reads its absence just as fast.
 *
 * These are the placement primitives the dressing passes compose with. They
 * know nothing about what they are placing, so any new prop maker drops in.
 */

const _p = new THREE.Vector3();

/** Polar sample with a density exponent: <1 crowds the centre, >1 the rim. */
export function polar(rmin, rmax, bias = 1, angle = null) {
  const a = angle ?? rng() * TAU;
  const r = lerp(rmin, rmax, Math.pow(rng(), bias));
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, a, r };
}

/**
 * Is this somewhere a thing could plausibly rest, and is it clear of what is
 * already there? Uniform scatter happily stacks two crates in the same metre
 * and drops a pillar down a cliff face; both read as broken.
 */
export function siteOk(world, x, z, opts = {}) {
  const T = world.terrain;
  if (!T) return true;
  if (T.slopeAt(x, z) > (opts.maxSlope ?? 0.38)) return false;
  const y = T.height(x, z);
  if (opts.minHeight !== undefined && y < opts.minHeight) return false;
  if (opts.maxHeight !== undefined && y > opts.maxHeight) return false;
  // keep the player's own footing clear so a run never starts inside a wall
  const keep = opts.spawnClear ?? 6;
  if (x * x + z * z < keep * keep) return false;
  const taken = world._siteTaken || (world._siteTaken = []);
  const rad = opts.clearance ?? 2.2;
  for (let i = 0; i < taken.length; i++) {
    const t = taken[i];
    const dx = t.x - x, dz = t.z - z;
    const min = rad + t.r;
    if (dx * dx + dz * dz < min * min) return false;
  }
  taken.push({ x, z, r: rad });
  return true;
}

/** Find a site that passes, or give up rather than force a bad one. */
export function findSite(world, rmin, rmax, opts = {}) {
  for (let i = 0; i < (opts.tries ?? 14); i++) {
    const q = polar(rmin, rmax, opts.bias ?? 1, opts.angle);
    if (siteOk(world, q.x, q.z, opts)) {
      _p.set(q.x, world.terrain ? world.terrain.height(q.x, q.z) : 0, q.z);
      return { pos: _p.clone(), a: q.a, r: q.r };
    }
  }
  return null;
}

/**
 * A cluster: one anchor, then satellites falling off around it. This is the
 * workhorse — a camp, a rockfall, a debris field, a stand of trees. `place` is
 * called with (position, indexInCluster, distanceFromAnchor, clusterAngle).
 */
export function cluster(world, opts, place) {
  const site = findSite(world, opts.rmin ?? 20, opts.rmax ?? 80, opts);
  if (!site) return 0;
  const n = opts.count ?? 6;
  const spread = opts.spread ?? 7;
  let placed = 0;
  for (let i = 0; i < n; i++) {
    // sqrt keeps the areal density even instead of piling everything on the
    // anchor; the bias exponent then lets a caller crowd it deliberately
    const d = Math.pow(rng(), opts.falloff ?? 0.5) * spread;
    const a = rng() * TAU;
    const x = site.pos.x + Math.cos(a) * d;
    const z = site.pos.z + Math.sin(a) * d;
    if (!siteOk(world, x, z, { ...opts, clearance: opts.satClearance ?? 1.4 })) continue;
    _p.set(x, world.terrain ? world.terrain.height(x, z) : 0, z);
    place(_p, i, d, site.a);
    placed++;
  }
  return placed;
}

/**
 * A line of things — a colonnade, a wall run, a ridge of wreckage. Straight
 * scatter never produces one, and a single line does more to make a space feel
 * built than fifty scattered objects.
 */
export function run(world, from, to, count, place, opts = {}) {
  const jitter = opts.jitter ?? 0;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = lerp(from.x, to.x, t) + (rng() - 0.5) * jitter;
    const z = lerp(from.z, to.z, t) + (rng() - 0.5) * jitter;
    if (opts.checked !== false && !siteOk(world, x, z, opts)) continue;
    _p.set(x, world.terrain ? world.terrain.height(x, z) : 0, z);
    place(_p, i, t);
    placed++;
  }
  return placed;
}

/** Reset the occupancy grid at the start of a dressing pass. */
export function beginDressing(world) { world._siteTaken = []; }


export const LEVELS = {
  dojo: DOJO_LEVEL,
  dunes: {
    name: 'The Dune Sea',
    blurb: 'Open dunes under a white sun. Nothing between you and the horde but sand.',
    terrain: 'dunes',
    pool: ['b1', 'b1', 'b1', 'trooper', 'b2', 'sniper', 'droideka', 'acolyte', 'walker'],
    groundColor: 0xd8c09a,
    spawnRadius: [38, 62],
    atmosphere: {
      turbidity: 8.5, rayleigh: 1.5, mie: 0.012, mieG: 0.83,
      elevation: 26, azimuth: 155,
      sunColor: 0xfff2d6, sunIntensity: 7.2, ambient: 0.30,
      skyColor: 0xcfe0f5, groundColor: 0x8a6a44,
      fogColor: 0xd8c8a4, fogDensity: 0.0042, exposure: 0.86, bloom: 0.36,
      saturation: 1.02, lift: [0.010, 0.008, 0.006], gain: [1.05, 1.0, 0.93],
      // Thin, scorched cloud and a long line of dune ranges receding into the
      // heat. Sparse cover on purpose — a desert sky is mostly empty, and what
      // sells the distance here is the horizon, not the clouds.
      cloudCover: 0.44, cloudLit: 0xfff0d4, cloudDark: 0xbba98c,
      cloudWindDir: 2.7, cloudWindSpeed: 0.7,
      horizonAmount: 0.85, horizonScale: 0.75, horizonColor: 0x9a7f5c,
    },
    ambience: { wind: 0.12, windFreq: 520, drone: 0.05 },
    dust: { count: 1300, color: 0xd8c8a8, opacity: 0.34, size: 26 },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      beginDressing(world);

      // ── Landmarks first. Three big wrecks, spread apart so that wherever you
      // stand at least one is on your skyline and you can navigate by it. A
      // desert with nothing to steer by is where "featureless" comes from.
      for (let k = 0; k < 3; k++) {
        const site = findSite(world, 34, 78, { angle: (k / 3) * TAU + rng() * 0.6, clearance: 16, maxSlope: 0.3 });
        if (!site) continue;
        const y = site.pos.y, cx = site.pos.x, cz = site.pos.z;
        const yaw = rng() * TAU;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.3 - 0.15, yaw, rng() * 0.24 - 0.12));
        addWall(world, new THREE.Vector3(cx, y + 1.6, cz), new THREE.Vector3(11 + rng() * 6, 3.6, 2.4), q, M.hull);
        addWall(world, new THREE.Vector3(cx + Math.cos(yaw) * 6, y + 3.4, cz + Math.sin(yaw) * 6),
          new THREE.Vector3(4.5, 6.5, 1.8),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, yaw + 0.4, 0.1)), M.hull);

        // Debris falls off from where the thing broke — big pieces near, small
        // far. Scattering identical crates uniformly is the single most
        // recognisable tell of a generated level.
        cluster(world, { rmin: 0, rmax: 0, count: 14, spread: 15, falloff: 0.75,
          angle: site.a, satClearance: 1.3, maxSlope: 0.42 }, (pos, i2, d) => {
          const near = 1 - clamp(d / 15, 0, 1);
          if (rng() < near * 0.55) {
            world.addProp(makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.6 + near * 0.9));
          } else {
            const sz = 0.6 + near * 1.9;
            addRock(world, pos.clone().setY(pos.y + sz * 0.2),
              new THREE.Vector3(sz * 1.4, sz * 0.8, sz * 1.2), i2 + k * 31 + 1);
          }
        });
      }

      // ── A moisture farm: vaporators stand in surveyed LINES, not scattered.
      // One line of them says people worked here; nine random ones say nothing.
      const fa = rng() * TAU, fr = 26 + rng() * 34;
      const fx = Math.cos(fa) * fr, fz = Math.sin(fa) * fr;
      const dir = fa + Math.PI * 0.5;
      run(world,
        { x: fx - Math.cos(dir) * 26, z: fz - Math.sin(dir) * 26 },
        { x: fx + Math.cos(dir) * 26, z: fz + Math.sin(dir) * 26 },
        6, (pos) => world.addProp(makeVaporator(world, pos.clone().setY(pos.y + 1.3))),
        { jitter: 3.5, clearance: 5, maxSlope: 0.3 });
      // and the clutter of working them
      cluster(world, { rmin: 0, rmax: 0, count: 9, spread: 9, angle: fa,
        satClearance: 1.2 }, (pos) => {
        if (rng() < 0.5) world.addProp(makeBarrel(world, pos.clone().setY(pos.y + 0.55)));
        else world.addProp(makeCrate(world, pos.clone().setY(pos.y + 0.45), 0.7));
      });

      // ── Rock. Outcrops come in groups along a fault, with scree trailing off
      // downslope — not as evenly spaced lumps.
      for (let g = 0; g < 5; g++) {
        cluster(world, { rmin: 18, rmax: 92, count: 7, spread: 11, falloff: 0.6,
          satClearance: 2.0, maxSlope: 0.5 }, (pos, i2, d) => {
          const sz = lerp(2.6, 0.5, clamp(d / 11, 0, 1)) * (0.75 + rng() * 0.5);
          addRock(world, pos.clone().setY(pos.y + sz * 0.22),
            new THREE.Vector3(sz * 1.5, sz * 1.0, sz * 1.3), g * 17 + i2 + 1);
        });
      }

      // ── Loose cover, thinned deliberately: it exists to break sight-lines
      // near the fight, not to fill the map.
      for (let i = 0; i < 10; i++) {
        const site = findSite(world, 14, 46, { bias: 0.7, clearance: 4 });
        if (site) world.addProp(makeCrate(world, site.pos.clone().setY(site.pos.y + 0.45), 0.85));
      }
    },
  },

  arena: {
    name: 'The Execution Arena',
    blurb: 'A bowl of sand ringed by stone. Nowhere to run, and something large is waking up.',
    terrain: 'arena',
    pool: ['b1', 'b1', 'trooper', 'b2', 'droideka', 'acolyte', 'beast', 'walker', 'sniper'],
    groundColor: 0xcfae82,
    spawnRadius: [30, 52],
    atmosphere: {
      turbidity: 6, rayleigh: 2.4, mie: 0.01, mieG: 0.8,
      elevation: 34, azimuth: 210,
      sunColor: 0xffe8c0, sunIntensity: 7.0, ambient: 0.30,
      skyColor: 0xc0d4ee, groundColor: 0x7a6244,
      fogColor: 0xc8b291, fogDensity: 0.0034, exposure: 0.9, bloom: 0.38,
      saturation: 1.06, lift: [0.008, 0.007, 0.008], gain: [1.04, 1.0, 0.95],
      // Mesas ringing the bowl, so the arena sits INSIDE a landscape rather
      // than on top of an empty disc.
      cloudCover: 0.52, cloudLit: 0xfff4e2, cloudDark: 0xa89880,
      cloudWindDir: 1.1, cloudWindSpeed: 0.85,
      horizonAmount: 1.15, horizonScale: 1.25, horizonColor: 0x8d7452,
    },
    ambience: { wind: 0.07, windFreq: 340, drone: 0.10 },
    dust: { count: 800, color: 0xd0bc94, opacity: 0.24, size: 22 },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      // the ring wall
      const R = 56, seg = 44;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
        const y = T.height(cx, cz);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        addWall(world, new THREE.Vector3(cx, y + 4.4, cz), new THREE.Vector3(8.6, 8.8, 2.2), q, M.duracrete);
        if (i % 4 === 0) {
          addRock(world, new THREE.Vector3(cx, y + 9.4, cz), new THREE.Vector3(1.5, 1.4, 1.8), 200 + i);
        }
      }
      // execution pillars in the middle
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.4;
        const cx = Math.cos(a) * 9, cz = Math.sin(a) * 9;
        const p = new THREE.Vector3(cx, T.height(cx, cz) + 3.2, cz);
        world.addProp(makePillar(world, p, 6.4));
      }
      for (let i = 0; i < 22; i++) {
        const a = rng() * TAU, r = 12 + rng() * 40;
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        p.y = T.height(p.x, p.z) + 0.5;
        world.addProp(rng() < 0.3 ? makeBarrel(world, p) : makeCrate(world, p, 0.75));
      }
      // gates the horde walks out of
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.7;
        const cx = Math.cos(a) * (R - 2), cz = Math.sin(a) * (R - 2);
        const y = T.height(cx, cz);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
        addWall(world, new THREE.Vector3(cx, y + 5.6, cz), new THREE.Vector3(7, 1.4, 2.6), q, M.darkSteel);
      }
    },
  },

  hangar: {
    name: 'Hangar Bay Nine',
    blurb: 'Industrial light, cover everywhere, and a blast door between you and the way out.',
    terrain: 'hangar',
    pool: ['b1', 'trooper', 'b2', 'droideka', 'acolyte', 'sniper'],
    groundColor: 0x8a8f98,
    spawnRadius: [24, 44],
    atmosphere: {
      sky: false, bgColor: 0x0a0d13, fog: true, fogColor: 0x141922, fogDensity: 0.016,
      sunColor: 0xbcd0ff, sunIntensity: 3.4, ambient: 0.26,
      skyColor: 0x5f7398, groundColor: 0x232830, elevation: 62, azimuth: 40,
      fillColor: 0xffb070, fillIntensity: 0.6,
      exposure: 1.15, bloom: 0.55, saturation: 1.0,
      lift: [0.006, 0.008, 0.014], gain: [0.98, 1.0, 1.06],
      clouds: false, horizon: false,   // interior — there is no sky to dress
    },
    ambience: { wind: 0.03, windFreq: 180, drone: 0.16 },
    dust: { count: 500, color: 0xa8b4c8, opacity: 0.16, size: 16 },
    grass: 0,
    dress(world) {
      const M = propMaterials();
      const T = world.terrain;
      const H = 12;
      // outer shell
      for (const [x, z, sx, sz] of [[0, -46, 100, 2.4], [0, 46, 100, 2.4], [-46, 0, 2.4, 92], [46, 0, 2.4, 92]]) {
        addWall(world, new THREE.Vector3(x, H / 2, z), new THREE.Vector3(sx, H, sz), new THREE.Quaternion(), M.hull);
      }
      // roof trusses + lights
      for (let i = -4; i <= 4; i++) {
        addWall(world, new THREE.Vector3(0, H - 0.6, i * 10), new THREE.Vector3(92, 0.9, 1.1), new THREE.Quaternion(), M.darkSteel);
        const lamp = new THREE.PointLight(0xcfe4ff, 26, 34, 2);
        lamp.position.set((i % 2 ? -14 : 14), H - 1.6, i * 10);
        world.scene.add(lamp);
        world.levelLights.push(lamp);
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.0),
          new THREE.MeshStandardMaterial({ color: 0x0e1116, emissive: 0xbcd8ff, emissiveIntensity: 3.4, roughness: 0.4 }));
        fixture.position.copy(lamp.position);
        world.scene.add(fixture);
        world.statics.push(fixture);
      }
      // interior cover blocks
      for (let i = 0; i < 16; i++) {
        const x = (rng() - 0.5) * 78, z = (rng() - 0.5) * 74;
        if (Math.hypot(x, z) < 9) continue;
        addWall(world, new THREE.Vector3(x, 1.3, z), new THREE.Vector3(3.4 + rng() * 3, 2.6, 2.2 + rng() * 3),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU), M.duracrete);
      }
      for (let i = 0; i < 40; i++) {
        const x = (rng() - 0.5) * 84, z = (rng() - 0.5) * 80;
        const p = new THREE.Vector3(x, T.height(x, z) + 0.5, z);
        world.addProp(rng() < 0.25 ? makeBarrel(world, p) : makeCrate(world, p, 0.8));
      }
      for (let i = 0; i < 5; i++) {
        const x = (rng() - 0.5) * 70, z = (rng() - 0.5) * 66;
        world.addProp(makeConsole(world, new THREE.Vector3(x, T.height(x, z) + 0.5, z)));
      }
      // THE blast door
      const door = new BlastDoor(world, {
        position: new THREE.Vector3(0, 2.6, -44.4),
        width: 6.2, height: 5.2, thickness: 0.62,
        onBreach: () => {
          world.notify('BREACHED', 'the way out is open');
          world.player?.addFlow(0.5);
          world.score += 2500;
        },
      });
      world.doors.push(door);
      world.notify('HANGAR BAY NINE', 'the door will not open for you — cut it');
    },
  },

  canyon: {
    name: 'The Wash',
    blurb: 'A river cut through red rock. Water underfoot, cover in the walls.',
    terrain: 'canyon',
    pool: ['b1', 'trooper', 'b2', 'sniper', 'acolyte', 'droideka', 'beast'],
    groundColor: 0xb09578,
    spawnRadius: [32, 58],
    water: { level: 0.35, shallow: 0x3f8fa6, deep: 0x123448 },
    atmosphere: {
      turbidity: 4.5, rayleigh: 3.0, mie: 0.006, mieG: 0.78,
      elevation: 14, azimuth: 95,
      sunColor: 0xffd9a8, sunIntensity: 6.4, ambient: 0.32,
      skyColor: 0xa8c8f0, groundColor: 0x6a5440,
      fogColor: 0xb4a894, fogDensity: 0.0052, exposure: 0.94, bloom: 0.42,
      saturation: 1.1, lift: [0.008, 0.010, 0.014], gain: [1.03, 1.0, 0.98],
      // A 14-degree sun under heavy cloud: the light rakes along the canyon and
      // the cloud base catches it. This is the level that should look like
      // weather is happening.
      cloudCover: 0.74, cloudLit: 0xffd9b4, cloudDark: 0x6f7488,
      cloudWindDir: 0.35, cloudWindSpeed: 1.5,
      horizonAmount: 1.4, horizonScale: 1.6, horizonColor: 0x5e5347,
    },
    ambience: { wind: 0.09, windFreq: 300, drone: 0.08 },
    dust: { count: 700, color: 0xc8bca8, opacity: 0.2, size: 18 },
    grass: 1.0,
    grassTint: [0x8a9a58, 0x4d5c2e],
    dress(world) {
      const T = world.terrain;
      const M = propMaterials();
      for (let i = 0; i < 30; i++) {
        const x = (rng() - 0.5) * 150, z = (rng() - 0.5) * 44;
        const y = T.height(x, z);
        if (y > 6) continue;
        const p = new THREE.Vector3(x, y + 0.5, z);
        world.addProp(rng() < 0.3 ? makeBarrel(world, p) : makeCrate(world, p, 0.8));
      }
      for (let i = 0; i < 26; i++) {
        const x = (rng() - 0.5) * 170, z = (rng() - 0.5) * 90;
        const y = T.height(x, z);
        const s = 1.1 + rng() * 2.8;
        addRock(world, new THREE.Vector3(x, y + s * 0.26, z),
          new THREE.Vector3(s * 1.4, s * 1.1, s * 1.4), 100 + i);
      }
      for (let i = 0; i < 10; i++) {
        const x = (rng() - 0.5) * 130, z = (rng() - 0.5) * 70;
        const y = T.height(x, z);
        if (y < 1) continue;
        world.addProp(makeSpire(world, new THREE.Vector3(x, y + 3, z), 5 + rng() * 4));
      }
    },
  },
};

export const LEVEL_ORDER = ['dojo', 'dunes', 'arena', 'hangar', 'canyon'];
