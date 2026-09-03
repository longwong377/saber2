/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE BATTLE OUTSIDE THE APERTURE — a fleet action in geometry
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player, on the shader fleet that used to be painted into the sky dome:
 *
 *   "the greater battle happening outside still looks like big triangles
 *    shooting lasers … a 1/10 for me, it's also weirdly localized to one
 *    area idk it's just lazy and janky"
 *
 * That fleet was seven 2D silhouettes 0.068 units wide in one patch of the
 * dome's fragment. This file replaces it with modelled hulls in the world:
 *
 *   · SIX HULL CLASSES, three a navy, built from tapered slabs with plating
 *     steps, bridge towers, engine bells with glow discs, lit hangar slots
 *     and window strips — one InstancedMesh per class (the two carriers are
 *     two halves each, so they can break).
 *   · FIVE ENGAGEMENTS across the whole opening — a line-of-battle broadside
 *     left-high, a carrier duel right-low against the planet, a distant line
 *     over the planet's limb, and two more only a player at the lip looking
 *     sideways or up can see — so the sky is busy wherever he looks out.
 *   · TURRETS that traverse toward their target and fire turbolaser bolts
 *     that TRAVEL: instanced capsules, hundreds in flight, shield flashes
 *     that bloom and fade where they land, hull hits that throw debris.
 *   · TWO HUNDRED FIGHTERS on 3D dogfight curves round the carriers with
 *     tracer fire and deaths, bomber runs walking hits along a keel, and
 *     near passes across the aperture at real size.
 *   · THE ROUND: `SkyDome.BATTLE`'s own script — arrivals out of hyperspace
 *     as a streak that resolves into a hull, a carrier burning, listing,
 *     breaking in two, the reactor, the halves drifting to the world, a
 *     replacement jumping in, the withdrawal. The clock is the dome's
 *     `uOrbitT`, so `battlePhase` and DeckAudio's thumps stay true.
 *
 * ── SCALE ─────────────────────────────────────────────────────────────────
 *
 * The room's far plane is about a kilometre (`DeckLife.frame().FAR`). A
 * 1137 m Venator cannot stand 2.5 km out, so every hull is a SCALE MODEL:
 * a hull at range r with scale s subtends what the real ship would at r/s.
 * Everything a hull owns — turrets, bolts, fighters — is in the same model
 * metres, so nothing in an engagement disagrees about its size.
 *
 * ── COST ──────────────────────────────────────────────────────────────────
 *
 * Fourteen draw calls, all instanced, every material `fog: false` and
 * `saberNoInk` (space has no haze and a hull at 700 m has no outline worth
 * a second rasterisation). The step allocates nothing: every pool is a
 * Float32Array sized at dress, every vector a module scratch.
 *
 *   dressDeckBattle(world)     build, and gate the dome's shader fleet off
 *   stepDeckBattle(world, dt)  advance
 *   undressDeckBattle(world)   remove, and give the shader fleet back
 *
 * Checked by tools/checks/deckbattle.mjs.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, lerp, smoothstep, TAU } from '../engine/MathUtil.js';
import { BATTLE, battlePhase } from '../engine/SkyDome.js';
import { farHullGeometry } from './DeckCast.js';
/* Read inside functions only — Hangar.js imports this file. */
import { DECK } from './Hangar.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  SCRATCH                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3(0, 0, 0);
const Z1 = new THREE.Vector3(0, 0, 1);

const _frac = (x) => x - Math.floor(x);
/** The dome's hash11, so a slot's luck here is the slot's luck there. */
function hash(n) {
  n = _frac(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return _frac(n);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  PARTS — tapered slabs and primitives into one vertex-coloured geometry */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A pile of coloured parts with a `glow` per vertex, merged into one
 * non-indexed geometry: position, normal, color, glow. `glow` is the
 * emissive gain the hull material adds (0 for plate, 2–4 for a lamp).
 */
class Parts {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.glo = []; this.turrets = []; this.fires = []; this.prims = 0; }

  /**
   * A tapered box along +Z from z−len/2 (stern) to z+len/2 (bow).
   *   wS/wB   half-width at stern / bow
   *   bS/tS   bottom / top y at stern;  bB/tB at the bow
   * Every face is flat-shaded; winding is settled by the centroid so a
   * slab tapered to a blade still faces out.
   */
  slab(hex, glow, len, wS, wB, bS, tS, bB, tB, x = 0, y = 0, z = 0, yaw = 0, pitch = 0) {
    const h = len / 2;
    const C = [
      [-wS, bS, -h], [wS, bS, -h], [wS, tS, -h], [-wS, tS, -h],
      [-wB, bB, h], [wB, bB, h], [wB, tB, h], [-wB, tB, h],
    ];
    if (yaw || pitch) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      for (const p of C) {
        let [px, py, pz] = p;
        /* pitch about X then yaw about Y */
        const y2 = py * cp - pz * sp, z2 = py * sp + pz * cp;
        py = y2; pz = z2;
        const x3 = px * cy + pz * sy, z3 = -px * sy + pz * cy;
        p[0] = x3; p[1] = py; p[2] = z3;
      }
    }
    for (const p of C) { p[0] += x; p[1] += y; p[2] += z; }
    const cx = C.reduce((a, p) => a + p[0], 0) / 8, cy2 = C.reduce((a, p) => a + p[1], 0) / 8, cz = C.reduce((a, p) => a + p[2], 0) / 8;
    const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]];
    for (const qd of quads) this._quad(C[qd[0]], C[qd[1]], C[qd[2]], C[qd[3]], hex, glow, cx, cy2, cz);
    this.prims++;
    return this;
  }

  /** A box. */
  box(hex, glow, w, hgt, d, x, y, z, yaw = 0, pitch = 0) {
    return this.slab(hex, glow, d, w / 2, w / 2, -hgt / 2, hgt / 2, -hgt / 2, hgt / 2, x, y, z, yaw, pitch);
  }

  _quad(a, b, c, d, hex, glow, cx, cy, cz) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const qx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx, qy = (a[1] + b[1] + c[1] + d[1]) / 4 - cy, qz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz;
    let tri = [a, b, c, a, c, d];
    if (nx * qx + ny * qy + nz * qz < 0) { nx = -nx; ny = -ny; nz = -nz; tri = [a, c, b, a, d, c]; }
    _c.set(hex);
    /* BAKED FORM: the toon bands flatten a lit plate to one tone, so the
     * belly is darkened in the vertex colour and the flanks between — a
     * hull reads as a solid from any angle, lit or not. Lamps keep theirs. */
    const f = glow > 0 ? 1 : 0.68 + 0.32 * clamp(ny * 0.5 + 0.5, 0, 1) - 0.10 * Math.abs(nx);
    for (const p of tri) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(_c.r * f, _c.g * f, _c.b * f);
      this.glo.push(glow);
    }
  }

  /** A three geometry (cylinder, sphere…) placed and painted. */
  geo(geo, hex, glow, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
    if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_eu.set(rx, ry, rz)));
    if (x || y || z) g.translate(x, y, z);
    const P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color;
    if (hex != null) _c.set(hex);
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      const ny = N ? N.getY(i) : 1;
      this.nor.push(N ? N.getX(i) : 0, ny, N ? N.getZ(i) : 0);
      const f = glow > 0 ? 1 : 0.7 + 0.3 * clamp(ny * 0.5 + 0.5, 0, 1);
      if (hex != null || !Cc) this.col.push(_c.r * f, _c.g * f, _c.b * f);
      else this.col.push(Cc.getX(i) * f, Cc.getY(i) * f, Cc.getZ(i) * f);
      this.glo.push(glow);
    }
    if (g !== geo) g.dispose();
    this.prims++;
    return this;
  }

  /** An engine: a bell, a rim and a glow disc facing −Z at the stern. */
  engine(dark, rim, glowHex, r, x, y, z, len = r * 1.1) {
    this.geo(new THREE.CylinderGeometry(r * 0.9, r, len, 12, 1, true), dark, 0, x, y, z + len / 2, Math.PI / 2, 0, 0);
    this.geo(new THREE.TorusGeometry(r, r * 0.09, 5, 14), rim, 0, x, y, z, 0, 0, 0);
    this.geo(new THREE.CircleGeometry(r * 1.25, 14), glowHex, 5.0, x, y, z - r * 0.05, Math.PI, 0, 0);
    return this;
  }

  /** A turret hardpoint: position and the direction the mount faces. */
  turret(x, y, z, nx, ny, nz, half = 0) { this.turrets.push([x, y, z, nx, ny, nz, half]); return this; }

  /** Where a dying hull burns. */
  fire(x, y, z) { this.fires.push([x, y, z]); return this; }

  merge() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glo, 1));
    g.computeBoundingSphere();
    this.pos = []; this.nor = []; this.col = []; this.glo = [];
    return g;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE HULLS — six classes, in real metres, +Z the bow                   */
/* ══════════════════════════════════════════════════════════════════════ */

const REP = { hull: 0xa39c8f, panel: 0x7c766c, dark: 0x2a2b2e, trim: 0x55504a, red: 0x8c2626, gold: 0xc09a44, band: 0x8f887c,
  window: 0xffe2b0, engine: 0x7fd0ff, bay: 0x9fd8ff, rim: 0x505560 };
const SEP = { hull: 0x4e5666, panel: 0x39404e, dark: 0x1c1f26, trim: 0xc9bfa2, red: 0x6b7a90, gold: 0x9a8c60, band: 0x5d6574,
  window: 0xffe8c0, engine: 0x9ff0ff, bay: 0xb0f0ff, rim: 0x42474c };

/**
 * Every class: `build(P) → { halves: [geo, geo?], turrets, fires, len, halfW, halfH }`.
 * A class with two halves is split at `split` (z); the stern half is index 1.
 */
export const HULL_CLASSES = {
  /* ── REPUBLIC ─────────────────────────────────────────────────────── */
  venator: { faction: 'republic', role: 'carrier', len: 1137, halfW: 274, halfH: 130, halves: 2,
    build() {
      const P = REP;
      const bow = new Parts(), stern = new Parts();
      /* THE WEDGE, in two: the stern block, thick, and the forward hull thinning to the split bow. */
      stern.slab(P.hull, 0, 450, 272, 236, -48, 62, -44, 54, 0, 0, -345);
      bow.slab(P.hull, 0, 350, 236, 200, -44, 54, -36, 42, 0, 0, 55);
      for (const sx of [1, -1]) {
        bow.slab(P.hull, 0, 340, 96, 34, -36, 42, -12, 14, sx * 108, 0, 400);
        /* the prongs' inner faces are a trench of machinery */
        bow.slab(P.dark, 0, 300, 3, 3, -24, 30, -8, 10, sx * 12, 0, 390);
      }
      /* PLATING STEPS: bands a few metres proud of the plate, one dark, one light. */
      stern.slab(P.dark, 0, 440, 276, 240, -8, 8, -8, 8, 0, 4, -345);
      bow.slab(P.dark, 0, 340, 240, 204, -8, 8, -8, 8, 0, 4, 55);
      stern.slab(P.panel, 0, 420, 262, 232, 30, 40, 26, 36, 0, 0, -345);
      bow.slab(P.panel, 0, 330, 232, 196, 26, 36, 20, 28, 0, 0, 55);
      /* THE FLIGHT DECK on top, red-edged, with the dorsal doors as a lighter strip. */
      stern.slab(P.panel, 0, 220, 130, 122, 62, 74, 54, 68, 0, 0, -230);
      bow.slab(P.panel, 0, 300, 122, 90, 54, 68, 42, 52, 0, 0, 30);
      bow.slab(P.hull, 0, 260, 40, 34, 68, 71, 52, 55, 0, 0, 20);
      for (const sx of [1, -1]) {
        stern.slab(P.red, 0, 210, 5, 5, 74, 76, 68, 70, sx * 118, 0, -230);
        bow.slab(P.red, 0, 290, 5, 5, 68, 70, 52, 54, sx * 108, 0, 30);
        /* three stripes a side on the plate aft */
        for (let i = 0; i < 3; i++) stern.slab(P.red, 0, 90, 5, 5, 40, 41.5, 37, 38.5, sx * (180 + i * 22), 0, -380);
      }
      /* THE TWIN BRIDGE TOWERS, with the superstructure block between. */
      stern.box(P.panel, 0, 110, 36, 120, 0, 76, -420);
      for (const sx of [1, -1]) {
        stern.slab(P.trim, 0, 46, 14, 12, 62, 126, 62, 122, sx * 78, 0, -410);
        stern.box(P.panel, 0, 76, 18, 34, sx * 78, 134, -410);
        stern.box(P.trim, 0, 40, 10, 22, sx * 78, 148, -416);
        stern.box(P.window, 3.8, 66, 3.5, 2, sx * 78, 134, -392);
        stern.geo(new THREE.SphereGeometry(6, 8, 6), P.dark, 0, sx * 78 + sx * 26, 156, -418);
        stern.turret(sx * 78, 154, -404, 0, 1, 0, 1);
      }
      stern.geo(new THREE.CylinderGeometry(1.2, 2, 44, 6), P.dark, 0, 0, 116, -430);
      /* THE ENGINES: three main, four secondary, across the flat stern. */
      stern.slab(P.panel, 0, 14, 270, 270, -44, 58, -44, 58, 0, 0, -565);
      for (const [x, y, r] of [[-105, 4, 34], [0, 6, 36], [105, 4, 34], [-190, 24, 14], [190, 24, 14], [-190, -14, 14], [190, -14, 14]])
        stern.engine(P.dark, P.rim, P.engine, r, x, y, -572);
      /* FLANK WINDOWS and the ventral hangar. */
      for (const sx of [1, -1]) {
        for (let i = 0; i < 5; i++) {
          const z = -420 + i * 110;
          const w = 272 - (z + 570) * (272 - 200) / 800;
          (z < -120 ? stern : bow).slab(P.window, 3.4, 44, 2, 2, 14, 17, 14, 17, sx * (w + 2), 0, z);
          (z < -120 ? stern : bow).slab(P.window, 3.0, 30, 2, 2, -20, -17.5, -20, -17.5, sx * (w + 2), 0, z + 40);
        }
      }
      bow.box(P.dark, 0, 80, 6, 200, 0, -48, 0);
      bow.box(P.bay, 3.6, 62, 2, 170, 0, -51, 0);
      stern.box(P.bay, 3.2, 40, 2, 90, 0, -51, -300);
      /* TURRETS: eight a flank along the top edge, and two dorsal. */
      for (let i = 0; i < 8; i++) {
        const z = -470 + i * 120;
        const w = z < 230 ? 272 - (z + 570) * (272 - 200) / 800 : 96 + 108 - (z - 230) * 0.3;
        const H = z < -120 ? stern : bow;
        for (const sx of [1, -1]) H.turret(sx * (w - 14), z < 230 ? 50 : 40, z, sx, 0.25, 0, z < -120 ? 1 : 0);
      }
      bow.turret(0, 56, 200, 0, 1, 0, 0); bow.turret(0, 72, -40, 0, 1, 0, 0);
      /* WHERE IT BURNS. */
      stern.fire(60, 40, -300); stern.fire(-90, 20, -200); bow.fire(30, 50, 0); bow.fire(-120, 0, 250); stern.fire(0, 90, -420);
      return { halves: [bow, stern], split: -120 };
    } },
  acclamator: { faction: 'republic', role: 'assault', len: 752, halfW: 230, halfH: 90, halves: 1,
    build() {
      const P = REP;
      const A = new Parts();
      A.slab(P.hull, 0, 752, 228, 14, -30, 32, -14, 16, 0, 0, 0);
      A.slab(P.dark, 0, 740, 232, 18, -6, 6, -6, 6, 0, 2, 0);
      A.slab(P.panel, 0, 520, 150, 40, 32, 48, 20, 30, 0, 0, -80);
      A.slab(P.hull, 0, 300, 40, 18, 48, 52, 32, 34, 0, 0, -120);
      /* the fin-like tower and its bridge */
      A.slab(P.trim, 0, 70, 14, 10, 48, 120, 48, 112, 0, 0, -250);
      A.box(P.panel, 0, 88, 16, 36, 0, 128, -252);
      A.box(P.trim, 0, 40, 10, 20, 0, 141, -256);
      A.box(P.window, 3.8, 76, 3, 2, 0, 128, -233);
      A.geo(new THREE.CylinderGeometry(1, 1.6, 40, 6), P.dark, 0, 0, 160, -262);
      for (const sx of [1, -1]) {
        A.slab(P.red, 0, 300, 4, 4, 33, 35, 17, 19, sx * 160, 0, -100, sx * -0.28);
        A.geo(new THREE.CylinderGeometry(24, 24, 2, 16), P.red, 0, sx * 110, 33, -40);
        A.geo(new THREE.CylinderGeometry(15, 15, 2.4, 14), P.gold, 0, sx * 110, 33, -40);
        for (let i = 0; i < 4; i++) {
          const z = -300 + i * 130, w = 228 - (z + 376) * (228 - 14) / 752;
          A.slab(P.window, 3.4, 36, 2, 2, 4, 7, 4, 7, sx * (w + 1), 0, z, sx * -0.28);
          A.turret(sx * (w - 12), 30, z, sx, 0.3, 0);
        }
      }
      A.slab(P.panel, 0, 12, 220, 220, -26, 30, -26, 30, 0, 0, -370);
      for (const [x, y, r] of [[-120, 2, 22], [-40, 4, 24], [40, 4, 24], [120, 2, 22], [-190, 8, 10], [190, 8, 10]])
        A.engine(P.dark, P.rim, P.engine, r, x, y, -376);
      A.box(P.dark, 0, 90, 4, 150, 0, -31, 60);
      A.box(P.bay, 3.6, 70, 2, 130, 0, -33, 60);
      A.turret(0, 50, -20, 0, 1, 0); A.turret(0, 36, 180, 0, 1, 0);
      A.fire(40, 30, -100); A.fire(-80, 10, 100); A.fire(0, 60, -250);
      return { halves: [A] };
    } },
  arquitens: { faction: 'republic', role: 'light', len: 325, halfW: 76, halfH: 40, halves: 1,
    build() {
      const P = REP;
      const A = new Parts();
      A.slab(P.hull, 0, 270, 24, 18, -14, 14, -10, 10, 0, 0, 25);
      A.slab(P.dark, 0, 260, 26, 20, -3, 3, -3, 3, 0, 0, 25);
      A.slab(P.band, 0, 250, 10, 6, 14, 20, 10, 14, 0, 0, 25);
      for (const sx of [1, -1]) {
        A.slab(P.hull, 0, 110, 12, 6, -9, 9, -4, 4, sx * 28, 0, 208, sx * 0.06);
        A.slab(P.panel, 0, 210, 20, 16, -9, 9, -7, 7, sx * 56, 0, -40);
        A.slab(P.red, 0, 120, 3, 3, 9, 10.5, 7, 8.5, sx * 56, 0, -60);
        A.engine(P.dark, P.rim, P.engine, 9, sx * 50, 2, -146);
        A.engine(P.dark, P.rim, P.engine, 7, sx * 66, -4, -142);
        A.slab(P.window, 3.4, 24, 1.5, 1.5, 2, 4, 2, 4, sx * 25, 0, 40);
        A.turret(sx * 24, 12, 90, sx, 0.4, 0);
        A.turret(sx * 56, 8, 10, sx, 0.4, 0);
      }
      A.box(P.panel, 0, 130, 10, 26, 0, 0, -60);
      A.box(P.panel, 0, 30, 14, 34, 0, 20, -70);
      A.box(P.window, 3.8, 26, 2.5, 2, 0, 22, -52);
      A.geo(new THREE.CylinderGeometry(0.8, 1.2, 22, 6), P.dark, 0, 0, 36, -80);
      A.turret(0, 15, 60, 0, 1, 0); A.turret(0, -15, 20, 0, -1, 0);
      A.fire(0, 10, 0); A.fire(40, 0, -100);
      return { halves: [A] };
    } },
  /* ── SEPARATIST ───────────────────────────────────────────────────── */
  providence: { faction: 'separatist', role: 'carrier', len: 1088, halfW: 100, halfH: 190, halves: 2,
    build() {
      const P = SEP;
      const bow = new Parts(), stern = new Parts();
      /* the long hull, in two */
      stern.slab(P.hull, 0, 300, 72, 62, -42, 42, -36, 36, 0, 0, -250);
      bow.slab(P.hull, 0, 600, 62, 18, -36, 36, -14, 14, 0, 0, 200);
      stern.slab(P.panel, 0, 290, 76, 66, -6, 8, -6, 8, 0, 14, -250);
      bow.slab(P.panel, 0, 580, 66, 22, -6, 8, -6, 8, 0, 10, 200);
      bow.slab(P.dark, 0, 560, 64, 20, -8, -2, -6, -2, 0, -30, 200);
      /* THE STERN BLOCK with its ears and the engine bank */
      /* THE HAMMER-HEAD: the stern block is twice the hull's width, with the ears out past it */
      stern.slab(P.hull, 0, 220, 130, 96, -66, 66, -48, 48, 0, 0, -450);
      stern.slab(P.band, 0, 210, 134, 100, -10, 12, -10, 12, 0, 20, -450);
      stern.slab(P.dark, 0, 200, 132, 98, -8, 8, -8, 8, 0, -30, -450);
      for (const sx of [1, -1]) {
        stern.box(P.trim, 0, 30, 56, 170, sx * 150, 30, -440);
        stern.box(P.dark, 0, 32, 12, 140, sx * 150, -4, -445);
      }
      /* the dorsal ridge and flank bands the length of the hull */
      stern.slab(P.band, 0, 290, 20, 16, 36, 50, 30, 42, 0, 0, -250);
      bow.slab(P.band, 0, 580, 16, 6, 30, 42, 12, 18, 0, 0, 200);
      bow.slab(P.trim, 0, 560, 66, 20, 2, 8, 0, 4, 0, 0, 200);
      stern.slab(P.panel, 0, 12, 92, 92, -58, 58, -58, 58, 0, 0, -546);
      for (const [x, y, r] of [[-60, 10, 18], [-20, 12, 20], [20, 12, 20], [60, 10, 18], [-40, -30, 12], [40, -30, 12]])
        stern.engine(P.dark, P.rim, P.engine, r, x, y, -552);
      /* THE DORSAL FIN AND THE BRIDGE ON IT; a smaller ventral fin. */
      /* THE FIN: 200 m tall, the bridge riding its top */
      stern.slab(P.hull, 0, 300, 16, 8, 36, 236, 66, 150, 0, 0, -200);
      stern.slab(P.trim, 0, 280, 18, 10, 120, 130, 110, 118, 0, 0, -200);
      stern.box(P.panel, 0, 64, 22, 90, 0, 246, -250);
      stern.box(P.trim, 0, 36, 10, 50, 0, 262, -254);
      stern.box(P.window, 3.8, 50, 5, 3, 0, 246, -204);
      stern.geo(new THREE.CylinderGeometry(1.5, 2.5, 70, 6), P.dark, 0, 0, 302, -270);
      stern.slab(P.hull, 0, 200, 10, 6, -110, -36, -70, -36, 0, 0, -180);
      /* THE FLANK HANGARS, lit, and the window rows */
      for (const sx of [1, -1]) {
        for (const z of [40, 190]) {
          const w = 62 - (z + 100) * (62 - 18) / 600;
          bow.box(P.dark, 0, 6, 30, 100, sx * (w + 1), 0, z, 0, 0);
          bow.box(P.bay, 4.0, 3, 22, 84, sx * (w + 4), 0, z);
        }
        for (let i = 0; i < 4; i++) {
          const z = -380 + i * 60;
          stern.slab(P.window, 3.4, 30, 2, 2, 20, 23, 20, 23, sx * 74, 0, z);
        }
        stern.slab(P.window, 3.4, 90, 2, 2, 18, 21, 18, 21, sx * 98, 0, -450);
        /* turrets: six a side along the hull top */
        for (let i = 0; i < 6; i++) {
          const z = -420 + i * 150;
          const w = z < -100 ? 72 : 62 - (z + 100) * (62 - 18) / 600;
          (z < -100 ? stern : bow).turret(sx * (w - 6), z < -100 ? 40 : 34 - (z + 100) * 0.03, z, sx, 0.3, 0, z < -100 ? 1 : 0);
        }
      }
      bow.turret(0, 14, 420, 0, 1, 0, 0);
      stern.fire(0, 60, -250); stern.fire(40, 0, -400); bow.fire(-20, 20, 100); bow.fire(10, -10, 300); stern.fire(0, 150, -200);
      return { halves: [bow, stern], split: -100 };
    } },
  munificent: { faction: 'separatist', role: 'light', len: 825, halfW: 213, halfH: 120, halves: 1,
    build() {
      const P = SEP;
      const A = new Parts();
      A.slab(P.hull, 0, 600, 44, 30, -22, 22, -16, 16, 0, 0, 0);
      A.slab(P.dark, 0, 590, 46, 32, -5, 5, -5, 5, 0, 0, 0);
      /* the broad flat midsection */
      A.slab(P.panel, 0, 320, 210, 130, -7, 7, -5, 5, 0, -4, 0);
      A.slab(P.dark, 0, 300, 200, 124, 7, 9, 5, 7, 0, -4, 0);
      A.slab(P.red, 0, 200, 60, 40, 9, 10.5, 7, 8.5, 0, -4, 0);
      /* THE FORKED BOW with the dish between the prongs */
      for (const sx of [1, -1]) {
        A.slab(P.hull, 0, 240, 20, 10, -16, 16, -8, 8, sx * 62, 0, 420, sx * -0.14);
        A.slab(P.window, 3.4, 60, 1.5, 1.5, 2, 4, 2, 4, sx * 40, 0, 360, sx * -0.14);
      }
      A.geo(new THREE.CylinderGeometry(52, 52, 4, 18), P.dark, 0, 0, -10, 360, Math.PI / 2, 0, 0);
      A.geo(new THREE.CylinderGeometry(10, 16, 40, 8), P.trim, 0, 0, -10, 340, Math.PI / 2, 0, 0);
      /* THE SPINE: the tall stern fin, its mast, and the shorter fin below */
      A.slab(P.hull, 0, 170, 12, 6, 22, 200, 50, 140, 0, 0, -170);
      A.slab(P.trim, 0, 160, 14, 8, 80, 90, 80, 90, 0, 0, -170);
      A.slab(P.window, 3.4, 120, 2, 2, 100, 170, 100, 128, 0, 0, -180);
      A.box(P.panel, 0, 30, 16, 50, 0, 208, -210);
      A.box(P.window, 3.8, 24, 4, 3, 0, 208, -184);
      A.geo(new THREE.CylinderGeometry(1, 1.6, 90, 6), P.dark, 0, 0, 260, -230);
      A.slab(P.hull, 0, 140, 9, 5, -130, -22, -80, -22, 0, 0, -160);
      /* THE FORE BLADE: a vertical blade over the bow, the class's other tell */
      A.slab(P.hull, 0, 200, 8, 3, 16, 110, 8, 40, 0, 0, 280);
      A.slab(P.trim, 0, 190, 10, 5, 50, 58, 30, 36, 0, 0, 280);
      /* the dorsal ridge and a flank band */
      A.slab(P.band, 0, 580, 18, 12, 22, 34, 16, 24, 0, 0, 0);
      A.slab(P.band, 0, 560, 48, 34, -10, 2, -8, 0, 0, 0, 0);
      /* engines */
      A.slab(P.panel, 0, 12, 40, 40, -20, 20, -20, 20, 0, 0, -298);
      A.engine(P.dark, P.rim, P.engine, 16, -22, 0, -304);
      A.engine(P.dark, P.rim, P.engine, 16, 22, 0, -304);
      A.engine(P.dark, P.rim, P.engine, 8, 0, -14, -300);
      /* turrets on the wing edges */
      for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {
        const z = -100 + i * 100, w = 210 - (z + 160) * (210 - 130) / 320;
        A.turret(sx * (w - 16), 6, z, sx, 0.3, 0);
      }
      A.turret(0, 24, 120, 0, 1, 0); A.turret(0, 24, -40, 0, 1, 0);
      A.fire(0, 10, 0); A.fire(120, 0, 40); A.fire(0, 60, -170);
      return { halves: [A] };
    } },
  recusant: { faction: 'separatist', role: 'assault', len: 1187, halfW: 120, halfH: 80, halves: 1,
    build() {
      const P = SEP;
      const A = new Parts();
      /* the needle */
      A.slab(P.hull, 0, 900, 30, 12, -26, 26, -10, 10, 0, 0, 100);
      A.slab(P.dark, 0, 880, 32, 14, -5, 5, -5, 5, 0, 0, 100);
      /* segmented modules along it, alternating */
      for (let i = 0; i < 7; i++) {
        const z = -300 + i * 92;
        A.box(i % 2 ? P.panel : P.hull, 0, 64 - i * 4, 42 - i * 2, 54, 0, 0, z);
        A.box(P.dark, 0, 66 - i * 4, 6, 8, 0, 0, z + 26);
        A.slab(P.window, 3.4, 30, 1, 1, 8, 10, 8, 10, (33 - i * 2), 0, z);
        A.slab(P.window, 3.4, 30, 1, 1, 8, 10, 8, 10, -(33 - i * 2), 0, z);
      }
      /* THE FORWARD FORK and the prow */
      for (const sx of [1, -1]) A.slab(P.hull, 0, 200, 14, 6, -12, 12, -6, 6, sx * 44, 0, 450, sx * -0.12);
      A.slab(P.hull, 0, 160, 12, 3, -10, 10, -3, 3, 0, 0, 520);
      /* THE STERN BLOCK and the four engines */
      /* THE BROAD AFT: a 320 m stern block on a 60 m spindle */
      A.slab(P.hull, 0, 190, 160, 70, -56, 56, -30, 30, 0, 0, -430);
      A.slab(P.band, 0, 180, 164, 74, 10, 24, 6, 14, 0, 0, -430);
      A.slab(P.dark, 0, 180, 164, 74, -8, 8, -8, 8, 0, -20, -430);
      /* the ridge along the spindle */
      A.slab(P.band, 0, 880, 14, 6, 26, 40, 10, 16, 0, 0, 100);
      A.box(P.panel, 0, 40, 14, 40, 0, 52, -420);
      A.box(P.window, 3.8, 30, 3, 2, 0, 52, -399);
      A.geo(new THREE.CylinderGeometry(1, 1.6, 40, 6), P.dark, 0, 0, 78, -440);
      A.slab(P.panel, 0, 12, 156, 156, -52, 52, -52, 52, 0, 0, -520);
      for (const [x, y, r] of [[-105, 4, 24], [-35, 8, 26], [35, 8, 26], [105, 4, 24], [-70, -30, 12], [70, -30, 12]])
        A.engine(P.dark, P.rim, P.engine, r, x, y, -526);
      for (const sx of [1, -1]) for (let i = 0; i < 4; i++) A.turret(sx * (34 - i * 4), 22 - i * 2, -270 + i * 184, sx, 0.3, 0);
      A.turret(0, 44, -380, 0, 1, 0); A.turret(0, 24, 320, 0, 1, 0);
      A.fire(0, 10, -100); A.fire(20, 0, 200); A.fire(0, 30, -425);
      return { halves: [A] };
    } },
};

/** role → class, per navy. */
export const ROLES = {
  republic: { carrier: 'venator', assault: 'acclamator', light: 'arquitens' },
  separatist: { carrier: 'providence', assault: 'recusant', light: 'munificent' },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE FIELD — where the engagements are, seen from the aperture         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Bearings from the aperture's centre: azimuth (+ right), elevation, range,
 * model scale, and the hulls of each group in a local frame — u across (+
 * right), v up, w away — with the direction their bows point. Group A is
 * OURS (the deck's navy), group B theirs; ours holds the left, as the dome
 * did. The near lane is the pass across the opening.
 *
 * Fighter counts are per side; `fscale` is the fighters' own model scale,
 * cheated up at the far engagement so a fighter is a speck and not nothing.
 */
export const ENGAGEMENTS = [
  { id: 'line', az: -0.36, el: 0.27, r: 600, scale: 0.22, close: 160, fighters: 22, fscale: 1.4,
    A: [{ role: 'carrier', at: [-140, 20, 30], fwd: [1, 0, 0.05], roll: 0.30 }, { role: 'assault', at: [-165, -45, -80], fwd: [1, 0, -0.08], pitch: -0.18 }, { role: 'light', at: [-110, 70, 100], fwd: [1, 0.02, 0.1], roll: -0.42 }],
    B: [{ role: 'assault', at: [150, 10, 20], fwd: [-1, 0, 0.06], roll: -0.22 }, { role: 'light', at: [190, -45, -90], fwd: [-1, 0, -0.1], pitch: 0.2 }, { role: 'light', at: [130, 65, 110], fwd: [-1, 0, 0.12], roll: 0.38 }] },
  /* THE DUEL. Our carrier is pushed close and stood large — the one hull whose towers and turrets resolve from the deck. */
  { id: 'carrier', az: 0.40, el: 0.09, r: 560, scale: 0.18, close: 120, fighters: 52, fscale: 1.4, duel: true,
    A: [{ role: 'carrier', at: [-200, -24, -150], fwd: [0.72, 0.02, -0.55], scale: 0.30, roll: 0.14 }, { role: 'light', at: [-230, 50, -60], fwd: [0.9, 0, -0.3], roll: 0.3 }],
    B: [{ role: 'carrier', at: [130, -10, -10], fwd: [-0.8, 0, 0.5], roll: -0.2 }, { role: 'light', at: [230, 50, 100], fwd: [-0.9, 0, 0.3], pitch: 0.16 }] },
  { id: 'limb', az: 0.10, el: 0.50, r: 640, scale: 0.075, close: 60, fighters: 16, fscale: 0.6,
    A: [{ role: 'carrier', at: [-60, 0, 0], fwd: [1, 0, 0] }, { role: 'assault', at: [-115, -20, 40], fwd: [1, 0, 0], roll: 0.25 }],
    B: [{ role: 'carrier', at: [60, 5, 10], fwd: [-1, 0, 0], roll: -0.3 }, { role: 'assault', at: [120, -15, -30], fwd: [-1, 0, 0] }] },
  { id: 'port', az: -0.95, el: 0.12, r: 480, scale: 0.16, close: 90, fighters: 8, fscale: 1.2,
    A: [{ role: 'light', at: [-70, 0, 0], fwd: [1, 0, 0.3], roll: 0.4 }],
    B: [{ role: 'assault', at: [90, 10, 30], fwd: [-1, 0, 0.3], roll: 0.2 }] },
  { id: 'zenith', az: 0.85, el: 0.48, r: 520, scale: 0.14, close: 100, fighters: 12, fscale: 1.2,
    A: [{ role: 'assault', at: [-90, 0, 0], fwd: [1, 0.1, 0], roll: -0.3 }],
    B: [{ role: 'carrier', at: [100, 20, 40], fwd: [-1, 0, 0], roll: 0.35 }] },
];

/** Pools. Sized here so the check can price them. */
export const POOLS = { bolts: 640, flashes: 220, debris: 360, turrets: 320, nearPerSide: 3 };

/* ══════════════════════════════════════════════════════════════════════ */
/*  MATERIALS                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

function hullMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.28, fog: false });
  m.userData.saberNoInk = true;
  m.userData.deckBattle = true;
  /* `glow` per vertex is emissive gain: the lamp's own colour, times it. */
  m.onBeforeCompile = (s) => {
    s.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + s.vertexShader
      .replace('#include <color_vertex>', '#include <color_vertex>\n\tvGlow = glow;');
    s.fragmentShader = 'varying float vGlow;\n' + s.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * vGlow;\n\tdiffuseColor.rgb *= 1.0 - 0.85 * min(vGlow, 1.0);');
  };
  m.customProgramCacheKey = () => 'deck-battle-hull';
  return m;
}

function boltMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, toneMapped: false });
  m.userData.saberNoInk = true;
  return m;
}

function debrisMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
  m.userData.saberNoInk = true;
  return m;
}

/** A billboarded soft blob: the instance matrix's scale is its radius. */
function flashMaterial() {
  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sx = length(instanceMatrix[0].xyz);
          float sy = length(instanceMatrix[1].xyz);
          c.xy += position.xy * vec2(sx, sy);
        #else
          vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          c.xy += position.xy;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float d = dot(p, p);
        if (d > 1.0) discard;
        float a = exp(-d * 4.5) * (1.0 - d);
        float core = exp(-d * 28.0);
        gl_FragColor = vec4(vCol * (a + core * 1.6), 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false,
  });
  m.userData.saberNoInk = true;
  return m;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  DRESS                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

function instanced(geo, mat, n, name) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  im.name = name;
  im.frustumCulled = false;
  im.castShadow = false; im.receiveShadow = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _s.set(0, 0, 0); _q.identity(); _v.set(0, 0, 0);
  _m.compose(_v, _q, _s);
  for (let i = 0; i < n; i++) im.setMatrixAt(i, _m);
  return im;
}

/** The fighter silhouette with an engine lamp on its tail, `glow` attribute added. */
function fighterGeometry(faction) {
  const src = farHullGeometry(0, faction).geo;
  src.computeBoundingBox();
  const bb = src.boundingBox;
  const P = new Parts();
  P.geo(src, null, 0);
  const lamp = faction === 'republic' ? 0x8fd8ff : 0xb0ffff;
  /* two small lamps either side of the tail, so a fighter seen from behind is a pair of lights */
  const zt = bb.min.z + 0.4;
  P.box(lamp, 3.2, 1.2, 0.8, 0.6, 1.4, 0.1, zt);
  P.box(lamp, 3.2, 1.2, 0.8, 0.6, -1.4, 0.1, zt);
  src.dispose();
  return P.merge();
}

/** The turret: a base, a dome, two barrels along +Z. */
function turretGeometry(hex) {
  const P = new Parts();
  P.geo(new THREE.CylinderGeometry(4.2, 4.6, 2.6, 10), hex, 0, 0, 1.3, 0);
  P.geo(new THREE.SphereGeometry(3.6, 10, 6, 0, TAU, 0, Math.PI / 2), hex, 0, 0, 2.6, 0);
  P.geo(new THREE.CylinderGeometry(0.7, 0.9, 16, 6), 0x2a2c30, 0, 1.7, 3.2, 9, Math.PI / 2, 0, 0);
  P.geo(new THREE.CylinderGeometry(0.7, 0.9, 16, 6), 0x2a2c30, 0, -1.7, 3.2, 9, Math.PI / 2, 0, 0);
  return P.merge();
}

/** Where a bearing lands, from the aperture centre. */
function place(az, el, r, out) {
  const ce = Math.cos(el);
  return out.set(Math.sin(az) * ce * r, 43 + Math.sin(el) * r, DECK.lip + Math.cos(az) * ce * r);
}

export function dressDeckBattle(world) {
  const prev = world._deckBattle;
  if (prev && prev.group?.parent) return prev;
  const side = world._deckFaction === 'separatist' ? 'separatist' : 'republic';
  const foe = side === 'republic' ? 'separatist' : 'republic';
  const sky = world.engine?.skyDome || null;
  const group = new THREE.Group();
  group.name = 'deck-battle';
  group.frustumCulled = false;

  const st = {
    group, side, foe, t: 0, lastSky: null, frame: 0, sky,
    hulls: [], classes: {}, engagements: [], fighters: null, near: null,
    hullMat: hullMaterial(), boltMat: boltMaterial(), flashMat: flashMaterial(), debrisMat: debrisMaterial(),
    geometries: [], turret: null, bolts: null, flashes: null, debris: null, blastSeen: [-1, -1, -1],
    planetDir: new THREE.Vector3(0, 0.22, 0.97).normalize(),
    colours: { republic: new THREE.Color(0x35b0ff), separatist: new THREE.Color(0xff2a18) },
    sentinel: null, fleet0: null, halfMeshes: [], fighterMeshes: [], ph: null,
  };
  /* THE BOLT COLOURS ARE THE DOME'S, so a Republic bolt here is the blue the
   * shader would have fired, whichever navy the deck belongs to. */
  const U = sky?.mat?.uniforms;
  if (U?.uBoltCol && U?.uFoeCol) {
    st.colours[side].copy(U.uBoltCol.value);
    st.colours[foe].copy(U.uFoeCol.value);
  }
  if (U?.uPlanetDir) st.planetDir.copy(U.uPlanetDir.value).normalize();
  /* GATE THE SHADER FLEET OFF. `uFleet` wraps the whole of fleetScene; the
   * planet, the star and the starfield are untouched. Given back on undress.
   * `_orbit.fleet` too, so a later configureOrbit keeps it off. */
  if (U?.uFleet) { st.fleet0 = U.uFleet.value; U.uFleet.value = 0; if (sky._orbit) sky._orbit.fleet = 0; }

  /* ── the classes ─────────────────────────────────────────────────── */
  const need = {};
  const want = (cls) => { need[cls] = (need[cls] | 0) + 1; };
  for (const E of ENGAGEMENTS) {
    for (const h of E.A) want(ROLES[side][h.role]);
    for (const h of E.B) want(ROLES[foe][h.role]);
  }
  /* the replacement that jumps in: one more carrier of each navy */
  want(ROLES.republic.carrier); want(ROLES.separatist.carrier);
  for (const [cls, n] of Object.entries(need)) {
    const C = HULL_CLASSES[cls];
    const built = C.build();
    const halves = built.halves.map((P, i) => {
      const geo = P.merge();
      st.geometries.push(geo);
      const im = instanced(geo, st.hullMat, n, `battle-${cls}-${i}`);
      group.add(im);
      return im;
    });
    const turrets = built.halves.flatMap((P) => P.turrets);
    const fires = built.halves.flatMap((P, i) => P.fires.map((f) => [f[0], f[1], f[2], i]));
    st.classes[cls] = { cls, C, halves, n, used: 0, turrets, fires, split: built.split ?? null };
    st.halfMeshes.push(...halves);
  }

  /* ── the engagements and their hulls ─────────────────────────────── */
  const ORIGIN = new THREE.Vector3(0, 43, DECK.lip);
  const arrive = (isOurs, rank) => (isOurs ? BATTLE.arriveA : BATTLE.arriveB) + rank * 0.7 + hash(rank * 2.3 + 0.2) * 0.4;
  let rankA = 0, rankB = 0;
  const pB = new THREE.Vector3();
  for (let ei = 0; ei < ENGAGEMENTS.length; ei++) {
    const E = ENGAGEMENTS[ei];
    const centre = place(E.az, E.el, E.r, new THREE.Vector3());
    const D = centre.clone().sub(ORIGIN).normalize();
    const R = new THREE.Vector3().crossVectors(UP, D).normalize();
    const Uv = new THREE.Vector3().crossVectors(D, R).normalize();
    const eng = { E, centre, R, U: Uv, D, hulls: [], A: [], B: [], carrierA: null, carrierB: null };
    st.engagements.push(eng);
    const addHull = (spec, faction, isOurs) => {
      const cls = ROLES[faction][spec.role];
      const K = st.classes[cls];
      const idx = K.used++;
      const base = centre.clone().addScaledVector(R, spec.at[0]).addScaledVector(Uv, spec.at[1]).addScaledVector(D, spec.at[2]);
      const fwd = new THREE.Vector3().addScaledVector(R, spec.fwd[0]).addScaledVector(Uv, spec.fwd[1]).addScaledVector(D, spec.fwd[2]).normalize();
      const rank = isOurs ? rankA++ : rankB++;
      const h = {
        cls, K, idx, eng, faction, ours: isOurs, role: spec.role, scale: spec.scale ?? E.scale,
        base, fwd, q0: new THREE.Quaternion(), q: new THREE.Quaternion(), pos: new THREE.Vector3(),
        m: [new THREE.Matrix4(), new THREE.Matrix4()], inv: new THREE.Matrix4(),
        arrive: arrive(isOurs, rank), depart: BATTLE.jumpOut + rank * 0.55 + hash(rank * 1.7 + 0.9) * 0.5,
        rank, shown: false, alive: true, victim: false, reinforcement: false, target: null,
        tStart: 0, tCount: 0, seedA: hash(ei * 7.1 + rank * 3.3 + 0.5), seedB: hash(ei * 3.7 + rank * 5.1 + 0.9),
        len: K.C.len * (spec.scale ?? E.scale), halfW: K.C.halfW * (spec.scale ?? E.scale), halfH: K.C.halfH * (spec.scale ?? E.scale), u: (spec.scale ?? E.scale) / 0.2,
        burnAt: -1, dead: false, halfVis: [1, 1],
      };
      _m.lookAt(fwd, ZERO, UP);
      h.q0.setFromRotationMatrix(_m);
      /* off the ecliptic: a line of battle is not a stack of parallel slabs */
      if (spec.roll || spec.pitch) h.q0.multiply(_q.setFromEuler(_eu.set(spec.pitch || 0, 0, spec.roll || 0, 'YXZ')));
      h.pos.copy(base);
      eng.hulls.push(h);
      (isOurs ? eng.A : eng.B).push(h);
      if (spec.role === 'carrier') { if (isOurs) eng.carrierA = h; else eng.carrierB = h; }
      st.hulls.push(h);
      return h;
    };
    for (const spec of E.A) addHull(spec, side, true);
    for (const spec of E.B) addHull(spec, foe, false);
    if (E.duel) {
      /* THE REPLACEMENTS: one carrier of each navy, standing behind its own
       * carrier's station, arriving at jumpIn in the round its navy lost. */
      for (const [faction, isOurs, src] of [[side, true, eng.carrierA], [foe, false, eng.carrierB]]) {
        const spec = { role: 'carrier', at: [0, 0, 0], fwd: [1, 0, 0] };
        const h = addHull(spec, faction, isOurs);
        h.base.copy(src.base).addScaledVector(Uv, 40).addScaledVector(D, -90);
        h.fwd.copy(src.fwd); h.q0.copy(src.q0); h.pos.copy(h.base);
        h.reinforcement = true;
        h.arrive = BATTLE.jumpIn; h.depart = BATTLE.jumpOut + 1.2;
      }
    }
  }

  /* ── turrets: one pool, each hull owns a run ─────────────────────── */
  const turretGeo = turretGeometry(0x3c3f45);
  st.geometries.push(turretGeo);
  let nT = 0;
  for (const h of st.hulls) { h.tStart = nT; h.tCount = h.K.turrets.length; nT += h.tCount; }
  const NT = Math.min(nT, POOLS.turrets);
  st.turret = {
    mesh: instanced(turretGeo, st.hullMat, Math.max(NT, 1), 'battle-turrets'),
    yaw: new Float32Array(NT), pitch: new Float32Array(NT), next: new Float32Array(NT), burst: new Uint8Array(NT),
    n: NT,
  };
  for (let i = 0; i < NT; i++) st.turret.next[i] = hash(i * 1.9 + 0.3) * 4;
  group.add(st.turret.mesh);

  /* ── bolts ───────────────────────────────────────────────────────── */
  /* a unit-length capsule along +Z: the instance's z scale IS its length */
  const boltGeo = new THREE.CapsuleGeometry(1, 1, 2, 6);
  boltGeo.rotateX(Math.PI / 2);
  boltGeo.scale(1, 1, 1 / 3);
  st.geometries.push(boltGeo);
  const NB = POOLS.bolts;
  st.bolts = {
    mesh: instanced(boltGeo, st.boltMat, NB, 'battle-bolts'),
    from: new Float32Array(NB * 3), to: new Float32Array(NB * 3), q: new Float32Array(NB * 4),
    t0: new Float32Array(NB), dur: new Float32Array(NB), w: new Float32Array(NB), len: new Float32Array(NB),
    kind: new Uint8Array(NB), hit: new Int16Array(NB), live: new Uint8Array(NB), n: NB, cursor: 0, alive: 0,
  };
  st.bolts.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NB * 3), 3);
  st.bolts.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(st.bolts.mesh);

  /* ── flashes ─────────────────────────────────────────────────────── */
  const flashGeo = new THREE.PlaneGeometry(2, 2);
  st.geometries.push(flashGeo);
  const NF = POOLS.flashes;
  st.flashes = {
    mesh: instanced(flashGeo, st.flashMat, NF, 'battle-flashes'),
    pos: new Float32Array(NF * 3), t0: new Float32Array(NF), dur: new Float32Array(NF), size: new Float32Array(NF),
    col: new Float32Array(NF * 3), live: new Uint8Array(NF), n: NF, cursor: 0,
  };
  st.flashes.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NF * 3), 3);
  st.flashes.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(st.flashes.mesh);

  /* ── debris ──────────────────────────────────────────────────────── */
  const debrisGeo = new THREE.TetrahedronGeometry(1, 0);
  debrisGeo.scale(1, 0.6, 1.4);
  st.geometries.push(debrisGeo);
  const ND = POOLS.debris;
  st.debris = {
    mesh: instanced(debrisGeo, st.debrisMat, ND, 'battle-debris'),
    pos: new Float32Array(ND * 3), vel: new Float32Array(ND * 3), axis: new Float32Array(ND * 3), rate: new Float32Array(ND),
    t0: new Float32Array(ND), life: new Float32Array(ND), size: new Float32Array(ND), hot: new Float32Array(ND),
    live: new Uint8Array(ND), n: ND, cursor: 0,
  };
  st.debris.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ND * 3), 3);
  st.debris.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(st.debris.mesh);

  /* ── fighters ────────────────────────────────────────────────────── */
  buildFighters(st);

  world.scene.add(group);
  /* THE SENTINEL: `World.unload` disposes every static's geometry, and this
   * one's dispose is the undress — so the shader fleet comes back and the
   * pools go, whether or not anybody calls undressDeckBattle. */
  const sentinel = new THREE.Object3D();
  sentinel.name = 'deck-battle-sentinel';
  sentinel.geometry = { dispose: () => undressDeckBattle(world) };
  world.statics?.push(sentinel);
  st.sentinel = sentinel;
  world._deckBattle = st;
  /* Stand everything at t = 0 so the first frame is not a frame of zeros. */
  seekDeckBattle(world, sky?.mat?.uniforms?.uOrbitT?.value ?? 0);
  return st;
}

/**
 * Fighters: two instanced meshes, one a navy. Each fighter belongs to an
 * engagement and flies a Lissajous curve about a point near the carrier it
 * is attacking; pairs share a curve with a small offset so they read as
 * wingmen. Bombers are fighters at a larger scale on a straight run along
 * the enemy carrier's keel. The last three of each navy are the near lane.
 */
function buildFighters(st) {
  const specs = [];
  const engs = st.engagements;
  for (let ei = 0; ei < engs.length; ei++) {
    const E = engs[ei].E;
    for (const ours of [true, false]) {
      for (let i = 0; i < E.fighters; i++) specs.push({ eng: ei, ours, kind: 0, i });
      if (E.duel) for (let i = 0; i < 3; i++) specs.push({ eng: ei, ours, kind: 1, i });
    }
  }
  for (const ours of [true, false]) for (let i = 0; i < POOLS.nearPerSide; i++) specs.push({ eng: -1, ours, kind: 2, i });
  const N = specs.length;
  const F = st.fighters = {
    n: N, spec: specs,
    side: new Uint8Array(N), eng: new Int8Array(N), kind: new Uint8Array(N), slot: new Uint16Array(N),
    /* the curve */
    ax: new Float32Array(N), ay: new Float32Array(N), az: new Float32Array(N),
    fx: new Float32Array(N), fy: new Float32Array(N), fz: new Float32Array(N),
    px: new Float32Array(N), py: new Float32Array(N), pz: new Float32Array(N),
    cx: new Float32Array(N), cy: new Float32Array(N), cz: new Float32Array(N),
    scale: new Float32Array(N),
    pos: new Float32Array(N * 3), yaw: new Float32Array(N), roll: new Float32Array(N),
    /* deaths */
    deathP: new Float32Array(N), deathPh: new Float32Array(N), deathSeen: new Uint8Array(N),
    deathPos: new Float32Array(N * 3), deathVel: new Float32Array(N * 3), deadNow: new Uint8Array(N),
    nextFire: new Float32Array(N), target: new Int16Array(N), lastFlame: new Float32Array(N),
    meshes: {},
    counts: { republic: 0, separatist: 0 },
  };
  const perSide = { republic: 0, separatist: 0 };
  for (let i = 0; i < N; i++) {
    const S = specs[i];
    const faction = S.ours ? st.side : st.foe;
    F.side[i] = S.ours ? 0 : 1;
    F.eng[i] = S.eng;
    F.kind[i] = S.kind;
    F.slot[i] = perSide[faction]++;
    const pair = Math.floor(S.i / 2), inPair = S.i % 2;
    const h1 = hash(i * 1.37 + pair * 0.3 + 0.11), h2 = hash(i * 2.11 + pair * 0.7 + 0.29), h3 = hash(pair * 3.71 + S.eng * 0.5 + 0.43);
    const E = S.eng >= 0 ? engs[S.eng].E : null;
    const sc = E ? E.scale : 1;
    const amp = E ? (50 + h3 * 110) * (sc / 0.2) : 1;
    F.ax[i] = amp * (0.8 + h1 * 0.4); F.ay[i] = amp * (0.35 + h2 * 0.35); F.az[i] = amp * (0.7 + h3 * 0.5);
    F.fx[i] = 0.16 + h1 * 0.16; F.fy[i] = 0.22 + h2 * 0.2; F.fz[i] = 0.12 + h3 * 0.14;
    F.px[i] = pair * 1.7 + inPair * 0.18; F.py[i] = pair * 2.9 + inPair * 0.12; F.pz[i] = pair * 0.9 + inPair * 0.2;
    /* around the ENEMY carrier if there is one, else the enemy line's centre */
    if (E) {
      const eng = engs[S.eng];
      const tgt = S.ours ? (eng.carrierB || eng.B[0]) : (eng.carrierA || eng.A[0]);
      const own = S.ours ? (eng.carrierA || eng.A[0]) : (eng.carrierB || eng.B[0]);
      /* half attack, half defend */
      const about = (S.i % 4 < 2) ? tgt : own;
      const j = 40 * (sc / 0.2);
      F.cx[i] = about.base.x + (h1 - 0.5) * j; F.cy[i] = about.base.y + (h2 - 0.5) * j; F.cz[i] = about.base.z + (h3 - 0.5) * j;
    }
    F.scale[i] = S.kind === 2 ? 1.0 : (E.fscale * (S.kind === 1 ? 1.9 : 1));
    F.deathP[i] = 220 + hash(i * 5.3 + 0.7) * 420;
    F.deathPh[i] = hash(i * 7.9 + 0.2) * F.deathP[i];
    F.nextFire[i] = hash(i * 0.77 + 0.5) * 3;
    F.target[i] = -1;
  }
  /* pair every fighter with the opposite navy's fighter of the same index in its engagement */
  for (let i = 0; i < N; i++) {
    if (F.kind[i] !== 0) continue;
    for (let j = 0; j < N; j++) {
      if (F.kind[j] === 0 && F.eng[j] === F.eng[i] && F.side[j] !== F.side[i] && specs[j].i === specs[i].i) { F.target[i] = j; break; }
    }
  }
  for (const faction of ['republic', 'separatist']) {
    const n = Math.max(perSide[faction], 1);
    const geo = fighterGeometry(faction);
    st.geometries.push(geo);
    const im = instanced(geo, st.hullMat, n, `battle-fighters-${faction}`);
    F.meshes[faction] = im;
    st.fighterMeshes.push(im);
    F.counts[faction] = perSide[faction];
    st.group.add(im);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  POOLS — spawn                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A bolt from a to b. `kind` 0 turbolaser, 1 tracer, 2 hyperspace streak.
 * `hit` is the hull index it lands on (−1 none), which decides the flash.
 */
function spawnBolt(st, ax, ay, az, bx, by, bz, speed, w, len, r, g, b, kind, hit) {
  const B = st.bolts;
  const i = B.cursor; B.cursor = (B.cursor + 1) % B.n;
  B.from[i * 3] = ax; B.from[i * 3 + 1] = ay; B.from[i * 3 + 2] = az;
  B.to[i * 3] = bx; B.to[i * 3 + 1] = by; B.to[i * 3 + 2] = bz;
  const d = Math.hypot(bx - ax, by - ay, bz - az) || 1;
  _v.set((bx - ax) / d, (by - ay) / d, (bz - az) / d);
  _q.setFromUnitVectors(Z1, _v);
  B.q[i * 4] = _q.x; B.q[i * 4 + 1] = _q.y; B.q[i * 4 + 2] = _q.z; B.q[i * 4 + 3] = _q.w;
  B.t0[i] = st.t; B.dur[i] = d / speed; B.w[i] = w; B.len[i] = len; B.kind[i] = kind; B.hit[i] = hit; B.live[i] = 1;
  B.mesh.instanceColor.setXYZ(i, r, g, b);
  return i;
}

function spawnFlash(st, x, y, z, size, dur, r, g, b) {
  const F = st.flashes;
  const i = F.cursor; F.cursor = (F.cursor + 1) % F.n;
  F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z;
  F.t0[i] = st.t; F.dur[i] = dur; F.size[i] = size;
  F.col[i * 3] = r; F.col[i * 3 + 1] = g; F.col[i * 3 + 2] = b;
  F.live[i] = 1;
}

function spawnDebris(st, x, y, z, vx, vy, vz, size, life, hot) {
  const D = st.debris;
  const i = D.cursor; D.cursor = (D.cursor + 1) % D.n;
  D.pos[i * 3] = x; D.pos[i * 3 + 1] = y; D.pos[i * 3 + 2] = z;
  D.vel[i * 3] = vx; D.vel[i * 3 + 1] = vy; D.vel[i * 3 + 2] = vz;
  const h = hash(i * 0.37 + st.t * 0.01);
  D.axis[i * 3] = h - 0.5; D.axis[i * 3 + 1] = hash(h + 1) - 0.5; D.axis[i * 3 + 2] = hash(h + 2) - 0.5;
  const l = Math.hypot(D.axis[i * 3], D.axis[i * 3 + 1], D.axis[i * 3 + 2]) || 1;
  D.axis[i * 3] /= l; D.axis[i * 3 + 1] /= l; D.axis[i * 3 + 2] /= l;
  D.rate[i] = 1 + h * 5;
  D.t0[i] = st.t; D.life[i] = life; D.size[i] = size; D.hot[i] = hot; D.live[i] = 1;
}

/** A burst of debris out of a point, spread about a direction. */
function burst(st, x, y, z, n, speed, size, life, hot, seed) {
  for (let k = 0; k < n; k++) {
    const a = hash(seed + k * 1.3) * TAU, b = (hash(seed + k * 2.7 + 0.5) - 0.5) * Math.PI;
    const s = speed * (0.4 + hash(seed + k * 0.9 + 0.2));
    spawnDebris(st, x, y, z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s, Math.sin(a) * Math.cos(b) * s,
      size * (0.5 + hash(seed + k * 3.1)), life * (0.6 + hash(seed + k * 1.1) * 0.8), hot);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ROUND — where every hull is, as a function of the clock           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Pose hull `h` at `tc` seconds into a round whose victim is `victimSide`.
 * Writes h.pos, h.q, h.m[0..1], h.halfVis, h.alive, h.victim. Pure in
 * (h, tc, victimSide): the check calls it at t and t + cycle.
 */
export function poseHull(st, h, tc, victimSide, sep) {
  const B = BATTLE;
  const E = h.eng.E;
  /* Is this the hull that dies this round? The duel's carrier of the losing navy. */
  h.victim = !!(h.eng.E.duel && h.role === 'carrier' && !h.reinforcement && h.faction === victimSide);
  /* The replacement stands in only for the navy that lost. */
  const idle = h.reinforcement && h.faction !== victimSide;
  const arrive = h.arrive, depart = h.depart;
  const shown = !idle && tc >= arrive && tc < depart + 0.6;
  h.shown = shown;
  h.alive = shown && !(h.victim && tc >= B.breakAt);
  h.halfVis[0] = shown ? 1 : 0; h.halfVis[1] = shown ? 1 : 0;
  if (!shown) {
    _s.set(0, 0, 0); h.m[0].compose(h.base, h.q0, _s); h.m[1].copy(h.m[0]);
    h.pos.copy(h.base); h.q.copy(h.q0);
    return;
  }
  /* ON STATION, closing from `sep` and wobbling a little. */
  const close = E.close * (h.reinforcement ? 0 : sep);
  h.pos.copy(h.base).addScaledVector(h.fwd, -close);
  const wob = 2.5;
  h.pos.x += Math.sin(tc * 0.031 + h.seedA * TAU) * wob;
  h.pos.y += Math.sin(tc * 0.023 + h.seedB * TAU) * wob;
  let roll = Math.sin(tc * 0.017 + h.seedA * 5) * 0.02, pitch = 0, yawOff = 0;
  let sternOff = 0, sternDrop = 0, sternPitch = 0, bowDrift = 0;
  if (h.victim) {
    const list = smoothstep(B.list, B.breakAt, tc);
    roll += list * 0.55; pitch -= list * 0.14;
    h.pos.y -= list * 30 * h.u * 0.25;
    if (tc >= B.breakAt) {
      const k = tc - B.breakAt;
      /* the halves part, the stern falling away and back; the bow drifts toward the world */
      sternOff = -Math.min(k, 30) * 1.4 * h.u - 8 * h.u;
      sternDrop = -Math.min(k, 30) * 0.9 * h.u;
      sternPitch = Math.min(k * 0.02, 0.35);
      bowDrift = Math.min(k, 120) * 0.9 * h.u * 0.25;
      roll += Math.min(k * 0.006, 0.5);
      yawOff = Math.min(k * 0.003, 0.3);
      /* the stern goes with the reactor */
      if (tc >= B.reactor + 0.35) h.halfVis[1] = 0;
      /* the wreck fades before the round repeats */
      if (tc > B.jumpOut + 6) { h.halfVis[0] = 0; h.halfVis[1] = 0; }
    }
  }
  h.pos.addScaledVector(st.planetDir, bowDrift);
  _eu.set(pitch, yawOff, roll, 'YXZ');
  h.q.copy(h.q0).multiply(_q.setFromEuler(_eu));
  /* the arrival: the hull grows out of the streak in a third of a second */
  const grow = smoothstep(arrive, arrive + 0.35, tc) * (1 - smoothstep(depart, depart + 0.35, tc));
  _s.set(h.scale * grow * h.halfVis[0], h.scale * grow * h.halfVis[0], h.scale * grow * h.halfVis[0]);
  h.m[0].compose(h.pos, h.q, _s);
  if (h.K.halves.length > 1) {
    _v.copy(h.pos).addScaledVector(h.fwd, sternOff).addScaledVector(UP, sternDrop).addScaledVector(st.planetDir, -bowDrift * 0.6);
    _eu.set(pitch + sternPitch, -yawOff * 0.5, roll * 1.3, 'YXZ');
    _q2.copy(h.q0).multiply(_q.setFromEuler(_eu));
    const sv = h.scale * grow * h.halfVis[1];
    _s.set(sv, sv, sv);
    h.m[1].compose(_v, _q2, _s);
  }
}

/** Seek the director to clock t (seconds); used by dress and the check. */
export function seekDeckBattle(world, t) {
  const st = world?._deckBattle;
  if (!st) return;
  st.t = t;
  /* A dome that is not ticking (a headless check) must not pull the clock
   * back to its own standing value on the next step. */
  st.lastSky = st.sky?.mat?.uniforms?.uOrbitT?.value ?? null;
  const { t: tc, victimSide, sep } = battlePhase(t);
  for (const h of st.hulls) {
    poseHull(st, h, tc, victimSide, sep);
    for (let k = 0; k < h.K.halves.length; k++) h.K.halves[k].setMatrixAt(h.idx, h.m[k]);
  }
  for (const im of st.halfMeshes) im.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/** The nearest living enemy hull in the same engagement, or null. */
function pickTarget(h) {
  let best = null, bd = Infinity;
  const foes = h.ours ? h.eng.B : h.eng.A;
  for (const f of foes) {
    if (!f.alive || !f.shown) continue;
    const d = f.pos.distanceToSquared(h.pos);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function stepHulls(st, dt, tc, ph) {
  const B = BATTLE;
  for (const h of st.hulls) {
    const wasShown = h.shown, wasAlive = h.alive, was1 = h.halfVis[1];
    poseHull(st, h, tc, ph.victimSide, ph.sep);
    for (let k = 0; k < h.K.halves.length; k++) h.K.halves[k].setMatrixAt(h.idx, h.m[k]);
    h.inv.copy(h.m[0]).invert();
    /* ── HYPERSPACE: the streak in, the flash, and the streak out ─── */
    if (!wasShown && h.shown) {
      const L = 520;
      _v.copy(h.pos).addScaledVector(h.fwd, -L);
      spawnBolt(st, _v.x, _v.y, _v.z, h.pos.x, h.pos.y, h.pos.z, L / 0.45, 1.2 * h.u, L, 2.6, 2.8, 3.2, 2, -1);
      spawnFlash(st, h.pos.x, h.pos.y, h.pos.z, h.halfW * 1.6, 0.7, 2.2, 2.4, 3.0);
    }
    if (h.shown && tc >= h.depart && tc < h.depart + dt * 1.5 && !h.victim) {
      const L = 700;
      _v.copy(h.pos).addScaledVector(h.fwd, L);
      spawnBolt(st, h.pos.x, h.pos.y, h.pos.z, _v.x, _v.y, _v.z, L / 0.4, 1.2 * h.u, L, 2.6, 2.8, 3.2, 2, -1);
      spawnFlash(st, h.pos.x, h.pos.y, h.pos.z, h.halfW * 1.2, 0.5, 2.0, 2.2, 3.0);
    }
    /* ── THE VICTIM: burning, breaking, the reactor ─────────────── */
    if (h.victim && h.shown) {
      const burn = smoothstep(B.burn, B.burn + 14, tc) * (1 - smoothstep(B.jumpOut, B.jumpOut + 6, tc));
      if (burn > 0 && st.frame % 3 === 0) {
        const fires = h.K.fires;
        for (let i = 0; i < fires.length; i++) {
          const f = fires[i];
          if (!h.halfVis[f[3]]) continue;
          const flick = 0.7 + 0.5 * Math.sin(st.t * 9 + i * 2.1) * Math.sin(st.t * 13.7 + i);
          _v.set(f[0], f[1], f[2]).applyMatrix4(h.m[f[3]]);
          spawnFlash(st, _v.x, _v.y, _v.z, (14 + 12 * burn) * h.u * flick, 0.28, 2.6 * burn, 1.1 * burn, 0.25 * burn);
          if (hash(st.frame * 0.13 + i) < 0.05 * burn) burst(st, _v.x, _v.y, _v.z, 3, 6 * h.u, 1.2 * h.u, 6, 1, st.t + i);
        }
      }
      if (wasAlive && !h.alive) {
        /* THE BREAK: a flash amidships and a shell of plate */
        _v.set(0, 0, h.K.split ?? 0).applyMatrix4(h.m[0]);
        spawnFlash(st, _v.x, _v.y, _v.z, h.halfW * 3.0, 1.4, 3.2, 2.2, 1.2);
        spawnFlash(st, _v.x, _v.y, _v.z, h.halfW * 1.2, 0.5, 4, 3.4, 2.6);
        burst(st, _v.x, _v.y, _v.z, 60, 22 * h.u, 2.2 * h.u, 40, 1, st.t);
      }
      if (was1 && !h.halfVis[1]) {
        /* THE REACTOR: the biggest light of the round */
        _v.setFromMatrixPosition(h.m[1]);
        spawnFlash(st, _v.x, _v.y, _v.z, h.len * 1.5, 3.5, 4.5, 3.6, 2.6);
        spawnFlash(st, _v.x, _v.y, _v.z, h.len * 0.6, 0.9, 8, 7, 6);
        spawnFlash(st, _v.x, _v.y, _v.z, h.len * 0.45, 4.0, 3.2, 1.4, 0.4);
        burst(st, _v.x, _v.y, _v.z, 110, 40 * h.u, 3 * h.u, 60, 1, st.t + 7);
      }
    }
  }
  /* targets, after every pose */
  for (const h of st.hulls) h.target = (h.shown && h.alive) ? pickTarget(h) : null;
}

/**
 * Turrets slew toward their hull's target and fire in bursts while the
 * round's guns are open. Traverse is 1.2 rad/s; a mount that cannot see
 * the target (behind its own plate) holds at rest and does not fire.
 */
function stepTurrets(st, dt, fire) {
  const T = st.turret;
  const cR = st.colours.republic, cS = st.colours.separatist;
  for (const h of st.hulls) {
    const K = h.K;
    const tg = h.target;
    const canSee = tg && h.alive && h.shown;
    if (canSee) _v2.copy(tg.pos).applyMatrix4(h.inv);
    for (let k = 0; k < h.tCount; k++) {
      const ti = h.tStart + k;
      if (ti >= T.n) break;
      const tt = K.turrets[k];
      const half = tt[6];
      const visible = h.shown && h.halfVis[half];
      const M = h.m[half];
      if (!visible) {
        _s.set(0, 0, 0); _v.set(0, 0, 0); _q.identity();
        T.mesh.setMatrixAt(ti, _m.compose(_v, _q, _s));
        continue;
      }
      /* rest: along the mount's normal, mostly sideways */
      const restYaw = Math.atan2(tt[3], tt[5]);
      let wantYaw = restYaw, wantPitch = 0, arc = false;
      if (canSee) {
        const dx = _v2.x - tt[0], dy = _v2.y - tt[1], dz = _v2.z - tt[2];
        const hyp = Math.hypot(dx, dz) || 1;
        wantYaw = Math.atan2(dx, dz);
        wantPitch = Math.atan2(dy, hyp);
        /* within 110° of the mount's facing */
        const dot = (dx * tt[3] + dy * tt[4] + dz * tt[5]) / (Math.hypot(dx, dy, dz) || 1);
        arc = dot > -0.34;
        if (!arc) { wantYaw = restYaw; wantPitch = 0; }
      }
      let dy = wantYaw - T.yaw[ti];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const slew = 1.2 * dt;
      T.yaw[ti] += clamp(dy, -slew, slew);
      T.pitch[ti] += clamp(wantPitch - T.pitch[ti], -slew, slew);
      const aimed = arc && Math.abs(dy) < 0.12;
      _eu.set(-T.pitch[ti], T.yaw[ti], 0, 'YXZ');
      _q.setFromEuler(_eu);
      _v.set(tt[0], tt[1], tt[2]);
      const ts = 3.2;
      _s.set(ts, ts, ts);
      _m.compose(_v, _q, _s).premultiply(M);
      T.mesh.setMatrixAt(ti, _m);
      /* FIRE. A burst of three, a barrel a shot, then a rest. */
      if (aimed && fire > 0 && st.t >= T.next[ti]) {
        const seed = ti * 3.1 + st.t;
        if (T.burst[ti] === 0 && hash(seed) > fire) { T.next[ti] = st.t + 0.6; continue; }
        const barrel = T.burst[ti] % 2 ? 1.7 : -1.7;
        _v3.set(barrel * ts, 3.2 * ts, 17 * ts).applyMatrix4(_m);
        /* a point on the target's plate, offset by the shooter's own luck */
        const rx = (hash(seed + 0.3) - 0.5) * 2 * tg.halfW * 0.8, ry = (hash(seed + 0.6) - 0.5) * 2 * tg.halfH * 0.7, rz = (hash(seed + 0.9) - 0.5) * tg.len * 0.9;
        _v4.set(rx / tg.scale, ry / tg.scale, rz / tg.scale).applyMatrix4(tg.m[0]);
        const c = h.faction === 'republic' ? cR : cS;
        const hullHit = tg.victim || hash(seed + 1.2) < 0.2;
        spawnBolt(st, _v3.x, _v3.y, _v3.z, _v4.x, _v4.y, _v4.z, 260, 0.95 * h.u + 0.3, 11 * h.u + 4,
          c.r * 3.0 + 0.2, c.g * 3.0 + 0.2, c.b * 3.0 + 0.2, 0, hullHit ? (tg.idx + 1) : 0);
        T.burst[ti]++;
        if (T.burst[ti] >= 3) { T.burst[ti] = 0; T.next[ti] = st.t + 2.2 + hash(seed + 2) * 3.4; }
        else T.next[ti] = st.t + 0.13;
      }
    }
  }
  T.mesh.instanceMatrix.needsUpdate = true;
}

function stepBolts(st, dt) {
  const B = st.bolts;
  const IM = B.mesh;
  let alive = 0;
  for (let i = 0; i < B.n; i++) {
    if (!B.live[i]) continue;
    const k = (st.t - B.t0[i]) / B.dur[i];
    if (k >= 1 || k < -0.01) {
      B.live[i] = 0;
      _s.set(0, 0, 0); _v.set(0, 0, 0); _q.identity();
      IM.setMatrixAt(i, _m.compose(_v, _q, _s));
      /* LAND IT: a shield bloom, or a hull hit with debris */
      if (B.kind[i] === 0) {
        const x = B.to[i * 3], y = B.to[i * 3 + 1], z = B.to[i * 3 + 2];
        const w = B.w[i];
        if (B.hit[i] > 0) {
          spawnFlash(st, x, y, z, w * 11, 0.55, 3.0, 1.3, 0.4);
          burst(st, x, y, z, 5, 9 * w, 0.9 * w, 4, 1, st.t + i);
        } else {
          /* the shield takes the bolt's own colour, paled a little */
          const c = IM.instanceColor;
          spawnFlash(st, x, y, z, w * 14, 0.45, c.getX(i) * 0.7 + 0.35, c.getY(i) * 0.7 + 0.45, c.getZ(i) * 0.7 + 0.6);
        }
      } else if (B.kind[i] === 1 && B.hit[i] > 0) {
        spawnFlash(st, B.to[i * 3], B.to[i * 3 + 1], B.to[i * 3 + 2], B.w[i] * 8, 0.25, 2.4, 1.6, 0.8);
      }
      continue;
    }
    alive++;
    const kk = clamp(k, 0, 1);
    let len = B.len[i], w = B.w[i];
    if (B.kind[i] === 2) {
      /* a streak: full length at the start, drawn into the hull */
      len = B.len[i] * (1 - kk);
      w = B.w[i] * (1 - kk * 0.6);
    }
    _v.set(lerp(B.from[i * 3], B.to[i * 3], kk), lerp(B.from[i * 3 + 1], B.to[i * 3 + 1], kk), lerp(B.from[i * 3 + 2], B.to[i * 3 + 2], kk));
    _q.set(B.q[i * 4], B.q[i * 4 + 1], B.q[i * 4 + 2], B.q[i * 4 + 3]);
    _s.set(w, w, len);
    IM.setMatrixAt(i, _m.compose(_v, _q, _s));
  }
  B.alive = alive;
  IM.instanceMatrix.needsUpdate = true;
  IM.instanceColor.needsUpdate = true;
}

function stepFlashes(st) {
  const F = st.flashes, IM = F.mesh;
  for (let i = 0; i < F.n; i++) {
    if (!F.live[i]) continue;
    const k = (st.t - F.t0[i]) / F.dur[i];
    if (k >= 1 || k < 0) {
      F.live[i] = 0;
      _s.set(0, 0, 0); _v.set(0, 0, 0); _q.identity();
      IM.setMatrixAt(i, _m.compose(_v, _q, _s));
      IM.instanceColor.setXYZ(i, 0, 0, 0);
      continue;
    }
    /* bloom fast, fade slow */
    const g = smoothstep(0, 0.18, k);
    const f = 1 - smoothstep(0.25, 1, k);
    const size = F.size[i] * (0.35 + 0.65 * g) * (0.7 + 0.3 * f);
    const a = g * f;
    _v.set(F.pos[i * 3], F.pos[i * 3 + 1], F.pos[i * 3 + 2]);
    _q.identity(); _s.set(size, size, size);
    IM.setMatrixAt(i, _m.compose(_v, _q, _s));
    IM.instanceColor.setXYZ(i, F.col[i * 3] * a, F.col[i * 3 + 1] * a, F.col[i * 3 + 2] * a);
  }
  IM.instanceMatrix.needsUpdate = true;
  IM.instanceColor.needsUpdate = true;
}

function stepDebris(st, dt) {
  const D = st.debris, IM = D.mesh;
  for (let i = 0; i < D.n; i++) {
    if (!D.live[i]) continue;
    const age = st.t - D.t0[i];
    if (age >= D.life[i] || age < 0) {
      D.live[i] = 0;
      _s.set(0, 0, 0); _v.set(0, 0, 0); _q.identity();
      IM.setMatrixAt(i, _m.compose(_v, _q, _s));
      continue;
    }
    D.pos[i * 3] += D.vel[i * 3] * dt; D.pos[i * 3 + 1] += D.vel[i * 3 + 1] * dt; D.pos[i * 3 + 2] += D.vel[i * 3 + 2] * dt;
    _v.set(D.pos[i * 3], D.pos[i * 3 + 1], D.pos[i * 3 + 2]);
    _v2.set(D.axis[i * 3], D.axis[i * 3 + 1], D.axis[i * 3 + 2]);
    _q.setFromAxisAngle(_v2, age * D.rate[i]);
    const fade = 1 - smoothstep(D.life[i] * 0.7, D.life[i], age);
    const s = D.size[i] * fade;
    _s.set(s, s, s);
    IM.setMatrixAt(i, _m.compose(_v, _q, _s));
    /* hot plate cools to dark in a few seconds */
    const hot = D.hot[i] * Math.exp(-age * 0.5);
    IM.instanceColor.setXYZ(i, 0.16 + hot * 3.0, 0.17 + hot * 1.2, 0.2 + hot * 0.3);
  }
  IM.instanceMatrix.needsUpdate = true;
  IM.instanceColor.needsUpdate = true;
}

/**
 * Fighters, per frame. Kind 0 on the curve about its point; kind 1 a bomber
 * on its run; kind 2 the near lane. Deaths are a schedule per fighter:
 * `(t + phase) mod period` under 7 s is the wreck — a flash, a tumble with
 * flame, then nothing, then back on the curve.
 */
function stepFighters(st, dt, tc, ph, fire) {
  const F = st.fighters;
  const engs = st.engagements;
  const B = BATTLE;
  const cR = st.colours.republic, cS = st.colours.separatist;
  const onField = smoothstep(B.arriveB + 4, B.closed, tc) * (1 - smoothstep(B.withdraw, B.jumpOut, tc));
  for (let i = 0; i < F.n; i++) {
    const faction = F.side[i] === 0 ? st.side : st.foe;
    const IM = F.meshes[faction];
    const slot = F.slot[i];
    const kind = F.kind[i];
    let vis = 1, sc = F.scale[i];
    let roll = 0, yaw = 0, pitch = 0;
    if (kind === 2) {
      /* THE NEAR LANE: a pass every 23 s a slot, alternating direction; slot 2 is a tumbling wreck. */
      const per = slot === 2 ? 71 : 23 + slot * 7;
      const off = F.side[i] * 11 + slot * 5;
      const k = ((st.t + off) % per) / per;
      const dur = slot === 2 ? 9 : 5.2;
      const on = k * per < dur;
      if (!on) { vis = 0; }
      else {
        const u = (k * per) / dur;
        const dir = (Math.floor((st.t + off) / per) + F.side[i]) % 2 ? 1 : -1;
        const z = DECK.lip + (slot === 2 ? 150 : 105 + slot * 30);
        const x = dir * (-300 + 600 * u);
        if (slot === 2) {
          const y = 96 - 90 * u * u;
          F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z;
          yaw = st.t * 2.1; pitch = st.t * 1.3; roll = st.t * 0.7;
          if (st.t - F.lastFlame[i] > 0.12) {
            F.lastFlame[i] = st.t;
            spawnFlash(st, x, y, z, 5 + hash(st.t) * 4, 0.35, 2.6, 1.2, 0.3);
            if (hash(st.t * 3.3) < 0.35) spawnDebris(st, x, y, z, (hash(st.t) - 0.5) * 8, 4 + hash(st.t + 1) * 6, (hash(st.t + 2) - 0.5) * 8, 0.6, 2.5, 1);
          }
        } else {
          const y = 30 + slot * 18 + Math.sin(u * TAU + slot) * 6;
          F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z;
          yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          roll = dir * (0.25 + 0.3 * Math.sin(u * 6 + slot));
        }
      }
    } else {
      const ei = F.eng[i];
      const eng = engs[ei];
      const E = eng.E;
      vis = onField;
      if (kind === 1) {
        /* THE BOMBERS: a run along the enemy carrier's keel every 36 s, walking hits along it */
        const tgt = F.side[i] === 0 ? eng.carrierB : eng.carrierA;
        const per = 36, off = slot * 3 + F.side[i] * 17;
        const k = ((st.t + off) % per) / per;
        const run = tgt.len * 2.2;
        _v.copy(tgt.pos).addScaledVector(tgt.fwd, -run / 2 + run * k).addScaledVector(eng.U, (26 + slot * 6) * tgt.u);
        _v.addScaledVector(eng.R, (slot - 1) * 14 * tgt.u);
        F.pos[i * 3] = _v.x; F.pos[i * 3 + 1] = _v.y; F.pos[i * 3 + 2] = _v.z;
        yaw = Math.atan2(tgt.fwd.x, tgt.fwd.z);
        pitch = -Math.asin(clamp(tgt.fwd.y, -1, 1));
        if (!tgt.shown || !tgt.alive) vis = 0;
        else if (k > 0.3 && k < 0.7 && fire > 0.2 && st.t - F.lastFlame[i] > 0.22) {
          F.lastFlame[i] = st.t;
          const h = hash(st.t * 1.7 + i);
          _v2.set((h - 0.5) * tgt.K.C.halfW * 0.6, tgt.K.C.halfH * 0.5, (-0.5 + (k - 0.3) / 0.4) * tgt.K.C.len * 0.9).applyMatrix4(tgt.m[0]);
          spawnFlash(st, _v2.x, _v2.y, _v2.z, 10 * tgt.u, 0.5, 3.2, 1.6, 0.5);
          burst(st, _v2.x, _v2.y, _v2.z, 3, 6 * tgt.u, 0.6 * tgt.u, 4, 1, st.t + i);
        }
      } else {
        /* THE DOGFIGHT: on the curve, or dying */
        const age = (st.t + F.deathPh[i]) % F.deathP[i];
        const dying = age < 7 && vis > 0.5;
        const t = st.t;
        const x = F.cx[i] + F.ax[i] * Math.sin(F.fx[i] * t + F.px[i]);
        const y = F.cy[i] + F.ay[i] * Math.sin(F.fy[i] * t + F.py[i]);
        const z = F.cz[i] + F.az[i] * Math.sin(F.fz[i] * t + F.pz[i]);
        const vx = F.ax[i] * F.fx[i] * Math.cos(F.fx[i] * t + F.px[i]);
        const vy = F.ay[i] * F.fy[i] * Math.cos(F.fy[i] * t + F.py[i]);
        const vz = F.az[i] * F.fz[i] * Math.cos(F.fz[i] * t + F.pz[i]);
        if (!dying) {
          F.deadNow[i] = 0;
          F.pos[i * 3] = x; F.pos[i * 3 + 1] = y; F.pos[i * 3 + 2] = z;
          yaw = Math.atan2(vx, vz);
          pitch = -Math.atan2(vy, Math.hypot(vx, vz) || 1);
          let dyaw = yaw - F.yaw[i];
          dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
          F.roll[i] = lerp(F.roll[i], clamp(-dyaw / Math.max(dt, 1e-3) * 0.9, -1.2, 1.2), 0.15);
          roll = F.roll[i];
          /* back from the dead: grow in over a second */
          vis *= smoothstep(7, 8.2, age);
          /* TRACERS at the paired enemy */
          const j = F.target[i];
          if (j >= 0 && fire > 0 && st.t >= F.nextFire[i] && !F.deadNow[j]) {
            const tx = F.pos[j * 3], ty = F.pos[j * 3 + 1], tz = F.pos[j * 3 + 2];
            const d = Math.hypot(tx - x, ty - y, tz - z);
            if (d < 260 * (E.scale / 0.2) && d > 4) {
              const c = faction === 'republic' ? cR : cS;
              const miss = hash(st.t + i) < 0.75 ? 1 : 0;
              const s = 6 * E.scale;
              spawnBolt(st, x, y, z, tx + (hash(i + t) - 0.5) * s * miss, ty + (hash(i + t + 1) - 0.5) * s * miss, tz + (hash(i + t + 2) - 0.5) * s * miss,
                380, 0.3 * sc, 3.5 * sc, c.r * 2.6 + 0.15, c.g * 2.6 + 0.15, c.b * 2.6 + 0.15, 1, miss ? 0 : 1);
              F.nextFire[i] = st.t + (F.nextFire[i] > 0 && hash(i * 0.3 + st.t) < 0.6 ? 0.09 : 1.1 + hash(i + st.t) * 1.6);
            } else F.nextFire[i] = st.t + 0.4;
          }
        } else {
          /* THE DEATH: at the first frame, a flash and the wreck starts from where the curve was */
          if (!F.deadNow[i]) {
            F.deadNow[i] = 1;
            F.deathPos[i * 3] = x; F.deathPos[i * 3 + 1] = y; F.deathPos[i * 3 + 2] = z;
            F.deathVel[i * 3] = vx; F.deathVel[i * 3 + 1] = vy; F.deathVel[i * 3 + 2] = vz;
            spawnFlash(st, x, y, z, 9 * sc, 0.5, 3.2, 2.2, 1.2);
            burst(st, x, y, z, 6, 8 * sc, 0.4 * sc, 5, 1, st.t + i);
          }
          const wx = F.deathPos[i * 3] + F.deathVel[i * 3] * age, wy = F.deathPos[i * 3 + 1] + F.deathVel[i * 3 + 1] * age - 1.2 * age * age * (E.scale / 0.2), wz = F.deathPos[i * 3 + 2] + F.deathVel[i * 3 + 2] * age;
          F.pos[i * 3] = wx; F.pos[i * 3 + 1] = wy; F.pos[i * 3 + 2] = wz;
          const y0 = F.yaw[i];
          yaw = y0 + age * 3.1; pitch = age * 2.2; roll = age * 1.4;
          vis *= 1 - smoothstep(5.5, 6.5, age);
          if (age < 5.5 && st.t - F.lastFlame[i] > 0.2) {
            F.lastFlame[i] = st.t;
            spawnFlash(st, wx, wy, wz, 4 * sc, 0.4, 2.4, 1.0, 0.25);
          }
          /* the heading it died on is kept, so the tumble starts from it */
          yaw = y0;
          F.yaw[i] = y0; roll = age * 1.4; pitch = age * 2.2; yaw = y0 + age * 3.1;
        }
      }
    }
    if (!(kind === 0 && F.deadNow[i])) F.yaw[i] = yaw;
    _v.set(F.pos[i * 3], F.pos[i * 3 + 1], F.pos[i * 3 + 2]);
    _eu.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_eu);
    const s = sc * vis;
    _s.set(s, s, s);
    IM.setMatrixAt(slot, _m.compose(_v, _q, _s));
  }
  for (const im of st.fighterMeshes) im.instanceMatrix.needsUpdate = true;
}

/**
 * THE DOME'S OWN DETONATIONS, bound to a hull. `_blasts` publishes three
 * slots as (x, y, age, strength) and DeckAudio thumps for each; the light
 * the thump belonged to was in the shader fleet, which is off. So the slot's
 * rising edge is read here and its flash is put on a hull — a magazine going
 * up somewhere along the line.
 */
function stepBlasts(st) {
  const u = st.sky?.mat?.uniforms?.uBlast?.value;
  if (!u) return;
  for (let k = 0; k < 3; k++) {
    const v = u[k];
    const on = v.z >= 0 && v.z < 0.5;
    if (on && st.blastSeen[k] < 0) {
      /* pick a shown hull by the slot's own position — a walk, no allocation */
      let n = 0;
      for (const h of st.hulls) if (h.shown && h.alive) n++;
      if (n) {
        let pick = Math.floor(hash(v.x * 3.1 + v.y * 7.7 + k) * n), h = null;
        for (const c of st.hulls) { if (!(c.shown && c.alive)) continue; if (pick-- === 0) { h = c; break; } }
        if (h) {
          const f = h.K.fires[Math.floor(hash(v.x + k) * h.K.fires.length)];
          _v.set(f[0], f[1], f[2]).applyMatrix4(h.m[f[3]]);
          spawnFlash(st, _v.x, _v.y, _v.z, h.halfW * (1.2 + v.w), 1.0 + v.w * 0.5, 3.4, 2.2, 1.1);
          spawnFlash(st, _v.x, _v.y, _v.z, h.halfW * 0.5, 0.35, 5, 4.5, 3.8);
          burst(st, _v.x, _v.y, _v.z, 24, 14 * h.u, 1.5 * h.u, 20, 1, st.t + k);
        }
      }
      st.blastSeen[k] = 1;
    } else if (!on) st.blastSeen[k] = -1;
  }
}

export function stepDeckBattle(world, dt) {
  const st = world && world._deckBattle;
  if (!st || !(dt > 0) || !st.group.parent) return;
  dt = Math.min(dt, 0.1);
  /* THE CLOCK IS THE DOME'S. While it ticks, follow it exactly, so the
   * phase the sound plays is the phase the light shows; when it does not
   * (a headless check, a paused dome) keep our own. */
  const T = st.sky?.mat?.uniforms?.uOrbitT?.value;
  if (Number.isFinite(T) && T !== st.lastSky) { st.t = T; st.lastSky = T; }
  else st.t += dt;
  st.frame++;
  const ph = battlePhase(st.t);
  const tc = ph.t;
  stepHulls(st, dt, tc, ph);
  stepTurrets(st, dt, ph.fire);
  stepFighters(st, dt, tc, ph, ph.fire);
  stepBlasts(st);
  stepBolts(st, dt);
  stepFlashes(st);
  stepDebris(st, dt);
  for (const im of st.halfMeshes) im.instanceMatrix.needsUpdate = true;
}

export function undressDeckBattle(world) {
  const st = world?._deckBattle;
  if (!st) return;
  const U = st.sky?.mat?.uniforms;
  if (U?.uFleet && st.fleet0 != null) { U.uFleet.value = st.fleet0; if (st.sky._orbit) st.sky._orbit.fleet = st.fleet0; }
  st.group.parent?.remove(st.group);
  for (const g of st.geometries) { try { g.dispose(); } catch {} }
  for (const m of [st.hullMat, st.boltMat, st.flashMat, st.debrisMat]) { try { m.dispose(); } catch {} }
  if (world.statics && st.sentinel) {
    const i = world.statics.indexOf(st.sentinel);
    if (i >= 0) world.statics.splice(i, 1);
  }
  world._deckBattle = null;
}

/** What the director is doing, for the HUD, a check or a probe. */
export function deckBattleState(world) {
  const st = world?._deckBattle;
  if (!st) return null;
  const ph = battlePhase(st.t);
  let shown = 0;
  for (const h of st.hulls) if (h.shown) shown++;
  return { t: st.t, phase: ph.phase, round: ph.round, victimSide: ph.victimSide, hulls: st.hulls.length, shown,
    bolts: st.bolts.alive, fighters: st.fighters.n, draws: st.group.children.length };
}
