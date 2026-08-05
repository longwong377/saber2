/**
 * SABER — theatres.
 *
 * Each level is a terrain preset, an atmosphere, and a dressing pass that
 * scatters architecture and props. They are large by design — the horde needs
 * somewhere to come from, and a Jedi needs somewhere to fall back to.
 */

import * as THREE from 'three';
import { makeCrate, makeBarrel, makePillar, makeVaporator, makeSpire, makeConsole, addWall, BlastDoor, propMaterials } from '../world/Props.js';
import { makeRng, clamp, TAU, lerp } from '../engine/MathUtil.js';

const rng = makeRng(20250805);

export const LEVELS = {
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
      sunColor: 0xfff2d6, sunIntensity: 4.4, ambient: 0.9,
      skyColor: 0xcfe0f5, groundColor: 0x8a6a44,
      fogColor: 0xd8c8a4, fogDensity: 0.0042, exposure: 1.0, bloom: 0.58,
      saturation: 1.02, lift: [0.010, 0.008, 0.006], gain: [1.05, 1.0, 0.93],
    },
    ambience: { wind: 0.12, windFreq: 520, drone: 0.05 },
    dust: { count: 1300, color: 0xd8c8a8, opacity: 0.34, size: 26 },
    grass: 0,
    dress(world) {
      const T = world.terrain;
      // scattered wrecks and vaporators, denser near the middle
      for (let i = 0; i < 26; i++) {
        const a = rng() * TAU, r = 12 + Math.pow(rng(), 0.6) * 78;
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        if (T.slopeAt(p.x, p.z) > 0.38) continue;
        p.y = T.height(p.x, p.z) + 0.5;
        world.addProp(makeCrate(world, p, 0.8));
      }
      for (let i = 0; i < 9; i++) {
        const a = rng() * TAU, r = 22 + rng() * 74;
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        p.y = T.height(p.x, p.z) + 1.3;
        world.addProp(makeVaporator(world, p));
      }
      for (let i = 0; i < 12; i++) {
        const a = rng() * TAU, r = 16 + rng() * 80;
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        p.y = T.height(p.x, p.z) + 0.55;
        world.addProp(makeBarrel(world, p));
      }
      // a half-buried hull to fight around
      const M = propMaterials();
      for (let k = 0; k < 3; k++) {
        const a = rng() * TAU, r = 30 + rng() * 46;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const y = T.height(cx, cz);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4 - 0.2, rng() * TAU, rng() * 0.3 - 0.15));
        addWall(world, new THREE.Vector3(cx, y + 1.6, cz), new THREE.Vector3(9 + rng() * 6, 3.4, 2.2), q, M.hull);
        addWall(world, new THREE.Vector3(cx + 5, y + 3.0, cz + 3), new THREE.Vector3(4, 5.5, 1.6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, rng() * TAU, 0.1)), M.hull);
      }
      // rocky outcrops for cover
      for (let i = 0; i < 16; i++) {
        const a = rng() * TAU, r = 18 + rng() * 84;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const y = T.height(cx, cz);
        const s = 1.4 + rng() * 3.2;
        addWall(world, new THREE.Vector3(cx, y + s * 0.4, cz), new THREE.Vector3(s * 2, s, s * 1.6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.3, rng() * TAU, rng() * 0.3)), M.stone);
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
      sunColor: 0xffe8c0, sunIntensity: 4.0, ambient: 0.85,
      skyColor: 0xc0d4ee, groundColor: 0x7a6244,
      fogColor: 0xc8b291, fogDensity: 0.0034, exposure: 1.02, bloom: 0.6,
      saturation: 1.06, lift: [0.008, 0.007, 0.008], gain: [1.04, 1.0, 0.95],
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
          addWall(world, new THREE.Vector3(cx, y + 9.4, cz), new THREE.Vector3(2.4, 2.4, 3.2), q, M.stone);
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
      sunColor: 0xbcd0ff, sunIntensity: 1.9, ambient: 0.55,
      skyColor: 0x5f7398, groundColor: 0x232830, elevation: 62, azimuth: 40,
      fillColor: 0xffb070, fillIntensity: 0.6,
      exposure: 1.15, bloom: 0.85, saturation: 1.0,
      lift: [0.006, 0.008, 0.014], gain: [0.98, 1.0, 1.06],
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
      sunColor: 0xffd9a8, sunIntensity: 3.4, ambient: 0.95,
      skyColor: 0xa8c8f0, groundColor: 0x6a5440,
      fogColor: 0xb4a894, fogDensity: 0.0052, exposure: 1.05, bloom: 0.7,
      saturation: 1.1, lift: [0.008, 0.010, 0.014], gain: [1.03, 1.0, 0.98],
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
      for (let i = 0; i < 22; i++) {
        const x = (rng() - 0.5) * 170, z = (rng() - 0.5) * 90;
        const y = T.height(x, z);
        const s = 1.2 + rng() * 3.4;
        addWall(world, new THREE.Vector3(x, y + s * 0.4, z), new THREE.Vector3(s * 2, s, s * 1.7),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4, rng() * TAU, rng() * 0.4)), M.stone);
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

export const LEVEL_ORDER = ['dunes', 'arena', 'hangar', 'canyon'];
