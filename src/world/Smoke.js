/**
 * BATTLEFRONT BORZ — the vertical smoke columns off a burning battlefield.
 *
 * Eleven reference images of Geonosis were read for the Command mode, and after
 * "the ground is flat" the thing they agree on hardest is this: the ONLY strong
 * verticals in the frame are smoke. `geonosis fight wide shot with troops and
 * all the different vehicles.webp` has five of them standing across a plain that
 * is otherwise a horizontal band; they lean with the wind, they are the tallest
 * thing in shot, and they are how the eye reads depth across ground that has no
 * other landmark. A flat plain without them is a plain; with them it is a battle
 * that has been going on for a while.
 *
 * ── WHY GEOMETRY AND NOT PARTICLES ─────────────────────────────────────
 *
 * The obvious build is `particles.smoke` emitting from each wreck. It is wrong
 * three times over here:
 *
 *   SCALE. These columns are 40 to 70 m tall and 8 to 20 m across at the top. A
 *     particle system that filled one costs hundreds of live sprites, and there
 *     are half a dozen columns.
 *   DISTANCE. Half of them are meant to be 200 m away, which is past every
 *     particle system's own culling and well past the point where a sprite's
 *     size and a real volume disagree.
 *   PERSISTENCE. A column is a thing that has been burning since before you
 *     arrived. A particle system has to spin up, so the level would open with
 *     no smoke on it and grow some over the first ten seconds.
 *
 * So a column is a LOFTED TUBE — a stack of rings rising, widening, drifting
 * downwind and wobbling, with the alpha carried on the vertices so it is dense
 * at the base and gone at the top. Every column on the level is merged into ONE
 * geometry: six columns for one draw call, on a level whose whole premise is
 * that you can see a very long way and therefore has a lot else to draw.
 *
 * It is deliberately NOT lit. A smoke column at this distance is being read as a
 * silhouette against a bright dusty sky; putting it on the standard material
 * would have it take the sun and the fill and come out as a solid brown object.
 * `MeshBasicMaterial` with vertex alpha, `depthWrite: false` and no shadow is
 * what a translucent volume is in this renderer — the same treatment the
 * dropship's rotor wash and the stasis field already use.
 */

import * as THREE from 'three';
import { makeRng, clamp, lerp, TAU } from '../engine/MathUtil.js';

/**
 * The one material, shared by every column on every level.
 *
 * Lazy and cached for the same reason `propMaterials()` is: `World.unload`
 * disposes a static's GEOMETRY and not its material, so a material allocated
 * per level is a material leaked per level. One per process cannot leak.
 */
let _mat = null;
function smokeMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshBasicMaterial({
    // White, because the COLOUR comes off the vertices — a column near a fire
    // is warmer and dirtier than one that has been burning for a minute, and
    // one material with per-vertex colour is how you get both for one draw.
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: true,
  });
  return _mat;
}

/**
 * How a column is shaped, and every number in it is off the reference frames.
 *
 *   `rings`  14. A tube needs enough stations to bend; at 8 the lean reads as
 *            three straight segments. 14 × 7 sides is 98 vertices a column,
 *            which is nothing.
 *   `sides`  7. Odd on purpose: an even ring has two vertices exactly on the
 *            silhouette from a cardinal direction and reads as a flat card
 *            when it is edge-on.
 *   `lean`   how far downwind the top is from the base, as a fraction of the
 *            height. 0.55 in the wide shot — the columns are noticeably raked
 *            but nowhere near horizontal.
 *   `spread` the top radius as a fraction of the height. A real plume widens
 *            because it is entraining air; 0.22 puts a 60 m column at 13 m
 *            across the top, which is what the plates show.
 */
const RINGS = 14;
const SIDES = 7;

/**
 * BUILD THE SMOKE FOR A WHOLE LEVEL, AS ONE MESH.
 *
 * @param world   needs `scene`, `statics` and (for grounding) `terrain`
 * @param columns `[{x, z, height, radius?, seed?, warm?}]` — the wrecks
 * @param opts.wind   [x, z] downwind direction. The columns all lean the same
 *                    way, which is the thing that makes them read as weather
 *                    rather than as six independent objects.
 * @param opts.color  the smoke's own body colour at the base
 * @param opts.tip    what it fades toward at the top — the sky's colour, so a
 *                    column dissolves into the haze rather than ending
 * @returns the mesh, already added to the scene and to `world.statics`.
 */
export function addSmokeColumns(world, columns, opts = {}) {
  if (!world?.scene || !columns?.length) return null;
  const wind = opts.wind || [0.94, 0.34];
  const wl = Math.hypot(wind[0], wind[1]) || 1;
  const wx = wind[0] / wl, wz = wind[1] / wl;
  const body = new THREE.Color(opts.color ?? 0x3a2b23);
  const tip = new THREE.Color(opts.tip ?? 0xb8875a);
  const lean = opts.lean ?? 0.55;
  const spread = opts.spread ?? 0.22;

  const pos = [], col = [], idx = [];
  let base = 0;

  for (const c of columns) {
    const r = makeRng((c.seed ?? 1) * 9176 + 13);
    const H = c.height ?? 48;
    const r0 = c.radius ?? Math.max(1.4, H * 0.035);
    const y0 = world.terrain ? world.terrain.height(c.x, c.z) : 0;
    // Each column gets its own phase, so six of them are not one shape drawn
    // six times — which is exactly the fault the Colosseum's crowd has.
    const ph = r() * TAU;
    const wob = 0.55 + r() * 0.9;

    for (let j = 0; j < RINGS; j++) {
      const t = j / (RINGS - 1);
      /* The rise is not linear. A plume accelerates out of the fire and then
       * stalls as it cools, so the rings bunch at the bottom — which is also
       * where the detail wants to be, because that is the end you can be
       * standing next to. */
      const y = y0 + Math.pow(t, 0.78) * H;
      /* The lean grows faster than the height: the top of a column has been in
       * the wind for longer than the bottom of it. t^1.5 rather than t is the
       * whole reason these curve instead of tilting. */
      const drift = Math.pow(t, 1.5) * H * lean;
      const wobble = Math.sin(t * 5.1 + ph) * H * 0.045 * wob;
      const cx = c.x + wx * drift - wz * wobble;
      const cz = c.z + wz * drift + wx * wobble;
      const rad = lerp(r0, r0 + H * spread, Math.pow(t, 0.85));
      /* Dense at the foot, gone at the top, and never fully opaque — smoke you
       * cannot see anything through is a wall. 0.62 at the base is enough to
       * read as a column against a bright sky and thin enough that a gunship
       * flying behind one is still a gunship. */
      const a = clamp((1 - Math.pow(t, 0.62)) * 0.62 + 0.03, 0, 1)
        * (c.strength ?? 1);
      const shade = new THREE.Color().copy(body).lerp(tip, Math.pow(t, 0.7));
      if (c.warm) shade.lerp(new THREE.Color(0xff7a2a), (1 - t) * 0.45);

      for (let s = 0; s < SIDES; s++) {
        const ang = (s / SIDES) * TAU + t * 0.6 + ph;
        // The ring is not a circle: ±18% of radius on a per-station hash, so a
        // column has a lumpy silhouette rather than a machined one.
        const rr = rad * (0.82 + ((Math.sin(ang * 3.1 + t * 9.7 + ph) + 1) * 0.5) * 0.36);
        pos.push(cx + Math.cos(ang) * rr, y, cz + Math.sin(ang) * rr);
        col.push(shade.r, shade.g, shade.b, a);
      }
    }
    for (let j = 0; j < RINGS - 1; j++) {
      for (let s = 0; s < SIDES; s++) {
        const a0 = base + j * SIDES + s;
        const b0 = base + j * SIDES + ((s + 1) % SIDES);
        const a1 = a0 + SIDES, b1 = b0 + SIDES;
        idx.push(a0, a1, b0, b0, a1, b1);
      }
    }
    base += RINGS * SIDES;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Four components: RGB and the alpha the material reads through
  // `vertexColors` + `transparent`. Three would need a second attribute and a
  // custom shader for what is one extra float a vertex.
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, smokeMaterial());
  mesh.name = 'smoke-columns';
  // Never casts and never receives: it is not an object, it is air with soot in
  // it, and a shadow off a translucent tube is the tell that it is a tube.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  // After the opaque world and before the ink pass, in the same band the other
  // translucent volumes in this game sit in.
  mesh.renderOrder = 5;
  world.scene.add(mesh);
  world.statics.push(mesh);
  return mesh;
}

/**
 * Where the columns go, given a level's own site picker.
 *
 * Split out because "which points on this map are burning" is a level's
 * decision and "what a burning point looks like" is this file's, and mixing
 * them is how a helper ends up with a level's radii baked into it.
 *
 * The heights are drawn over a wide range on purpose: a plain with six columns
 * all 50 m tall reads as a repeated object, and one with columns at 24, 38 and
 * 71 reads as a battlefield with near and far wrecks on it. That range IS the
 * depth cue — on ground with no other landmark, the only thing telling you how
 * far away something is, is how big you know it should be.
 */
export function smokeSites(rng, count, opts = {}) {
  const rmin = opts.rmin ?? 60, rmax = opts.rmax ?? 250;
  const out = [];
  for (let i = 0; i < count; i++) {
    // Golden-angle bearings so the columns never clump on one side of the map,
    // which a uniform draw does about a third of the time at six samples.
    const a = i * 2.399963 + (opts.phase ?? 0);
    const r = lerp(rmin, rmax, Math.pow((i + 0.5) / count, 0.6)) * (0.82 + rng() * 0.36);
    out.push({
      x: Math.cos(a) * r, z: Math.sin(a) * r,
      height: lerp(22, 74, rng() * rng() + 0.15 * i / count),
      seed: 400 + i * 7,
      // A third of them are still burning at the base. The others have burned
      // out and are only smoking, which is what most of a battlefield is.
      warm: rng() < 0.34,
      strength: 0.75 + rng() * 0.5,
    });
  }
  return out;
}
