/**
 * SABER — terrain.
 *
 * A single large heightfield: one draw call, sampled analytically for physics,
 * and deformable at runtime so a Force landing actually leaves a crater in the
 * dune. Slope drives a blend from sand to rock, and a low-frequency world-space
 * noise breaks the texture tiling that otherwise gives away every open field.
 */

import * as THREE from 'three';
import { fbm2, ridged2, noise2, clamp, lerp, smoothstep } from '../engine/MathUtil.js';
import { sandMaps, rockMaps } from '../engine/Textures.js';

export const TERRAIN_PRESETS = {
  dunes: {
    scale: 560, res: 340, waterLevel: -999,
    sandColor: 0xcbae82, rockColor: 0x6b5d4c,
    height(x, z) {
      const big = ridged2(x * 0.0032, z * 0.0032, 4) * 26;
      const dune = Math.pow(Math.max(0, ridged2(x * 0.011 + 3.1, z * 0.0072, 3)), 1.5) * 9.5;
      const roll = fbm2(x * 0.0065, z * 0.0065, 4) * 5.2;
      const micro = fbm2(x * 0.055, z * 0.055, 3) * 0.34;
      // a flat-ish battleground at the centre so waves have somewhere to happen
      const d = Math.hypot(x, z);
      const flat = smoothstep(16, 62, d);
      return (big * 0.55 + dune + roll) * flat + micro;
    },
    rockAt(x, z, slope) { return clamp(slope * 2.1 - 0.35, 0, 1); },
  },

  arena: {
    scale: 460, res: 300, waterLevel: -999,
    sandColor: 0xc2a279, rockColor: 0x8c7a63,
    height(x, z) {
      const d = Math.hypot(x, z);
      const bowl = smoothstep(58, 104, d) * 20 + smoothstep(104, 150, d) * 34;
      const dust = fbm2(x * 0.02, z * 0.02, 4) * 0.55;
      const ridges = ridged2(x * 0.004, z * 0.004, 3) * smoothstep(90, 190, d) * 22;
      return bowl + ridges + dust;
    },
    rockAt(x, z, slope) { return clamp(slope * 2.4 - 0.2, 0, 1); },
  },

  canyon: {
    scale: 520, res: 320, waterLevel: 0.4,
    sandColor: 0xa89170, rockColor: 0x5e4c3d,
    height(x, z) {
      const river = Math.abs(z + Math.sin(x * 0.012) * 22) ;
      const walls = smoothstep(18, 74, river) * (28 + ridged2(x * 0.006, z * 0.006, 4) * 34);
      const bed = -smoothstep(26, 0, river) * 1.6;
      const detail = fbm2(x * 0.03, z * 0.03, 4) * 1.1;
      return walls + bed + detail;
    },
    rockAt(x, z, slope) { return clamp(slope * 1.7 + 0.12, 0, 1); },
  },

  hangar: {
    scale: 300, res: 160, waterLevel: -999, flat: true,
    sandColor: 0x585d66, rockColor: 0x3a3e46,
    height(x, z) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      return smoothstep(74, 132, d) * 42 + fbm2(x * 0.09, z * 0.09, 2) * 0.05;
    },
    rockAt() { return 1; },
  },
};

export class Terrain {
  constructor(scene, presetName = 'dunes', quality = 1) {
    const preset = TERRAIN_PRESETS[presetName] || TERRAIN_PRESETS.dunes;
    this.preset = preset;
    this.size = preset.scale;
    this.res = Math.max(64, Math.floor(preset.res * clamp(quality, 0.4, 1.6)));
    this.half = this.size / 2;
    this.step = this.size / (this.res - 1);
    this.invStep = 1 / this.step;
    this.waterLevel = preset.waterLevel;
    this.friction = 0.95;

    this.heights = new Float32Array(this.res * this.res);
    this.deform = new Float32Array(this.res * this.res);

    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = -this.half + i * this.step;
        const z = -this.half + j * this.step;
        this.heights[j * this.res + i] = preset.height(x, z);
      }
    }

    this._buildMesh(scene);
    this._dirtyRegion = null;
  }

  _buildMesh(scene) {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.res - 1, this.res - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        pos.setY(j * this.res + i, this.heights[j * this.res + i]);
      }
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.geometry = geo;

    const sand = sandMaps(this.size / 3.2);
    const rock = rockMaps(this.size / 9);

    const mat = new THREE.MeshStandardMaterial({
      map: sand.map,
      normalMap: sand.normalMap,
      roughnessMap: sand.roughnessMap,
      roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(1.15, 1.15),
      color: new THREE.Color(this.preset.sandColor),
      dithering: true,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRockMap = { value: rock.map };
      shader.uniforms.uRockRough = { value: rock.roughnessMap };
      shader.uniforms.uRockColor = { value: new THREE.Color(this.preset.rockColor) };
      shader.uniforms.uRockScale = { value: 3.2 };
      shader.uniforms.uMacroScale = { value: 0.0072 };
      shader.uniforms.uWaterLevel = { value: this.waterLevel };
      shader.uniforms.uDetailFade = { value: 92.0 };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNrm;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWNrm;
          uniform sampler2D uRockMap; uniform sampler2D uRockRough;
          uniform vec3 uRockColor; uniform float uRockScale; uniform float uMacroScale;
          uniform float uWaterLevel; uniform float uDetailFade;
          float vnoise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f*f*(3.0-2.0*f);
            float a = fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453);
            float b = fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
            float c = fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453);
            float d = fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }`)
        .replace('#include <map_fragment>', `
          float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
          float rockBlend = smoothstep(0.16, 0.46, slope);
          vec2 ruv = vWPos.xz * (uRockScale / 100.0);
          vec4 sandTex = texture2D( map, vMapUv );
          vec4 rockTex = texture2D( uRockMap, ruv );
          vec3 base = mix(sandTex.rgb * diffuse, rockTex.rgb * uRockColor, rockBlend);

          // macro variation kills the tiling tell
          float m1 = vnoise(vWPos.xz * uMacroScale);
          float m2 = vnoise(vWPos.xz * uMacroScale * 4.3);
          base *= 0.80 + m1 * 0.42 + m2 * 0.14;

          // damp sand near the waterline
          float wet = smoothstep(uWaterLevel + 1.4, uWaterLevel - 0.25, vWPos.y);
          base *= mix(1.0, 0.52, wet);

          diffuseColor = vec4( base, opacity );`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          vec4 sandR = texture2D( roughnessMap, vRoughnessMapUv );
          vec4 rockR = texture2D( uRockRough, ruv );
          roughnessFactor *= mix(sandR.g, rockR.g, rockBlend);
          roughnessFactor = mix(roughnessFactor, 0.22, wet);`);
      this._shader = shader;
    };

    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    scene.add(this.mesh);
  }

  /* ── sampling ──────────────────────────────────────────────────────── */

  _idx(i, j) {
    i = i < 0 ? 0 : i >= this.res ? this.res - 1 : i;
    j = j < 0 ? 0 : j >= this.res ? this.res - 1 : j;
    return j * this.res + i;
  }

  /** Bilinear height at a world position. */
  height(x, z) {
    const fx = (x + this.half) * this.invStep;
    const fz = (z + this.half) * this.invStep;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h00 = this.heights[this._idx(i, j)], h10 = this.heights[this._idx(i + 1, j)];
    const h01 = this.heights[this._idx(i, j + 1)], h11 = this.heights[this._idx(i + 1, j + 1)];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.step;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z, _tv);
    return 1 - clamp(n.y, 0, 1);
  }

  /** Surface keyword used for footstep audio and particle colour. */
  surfaceAt(x, z) {
    if (this.preset.flat) return 'metal';
    const y = this.height(x, z);
    if (this.waterLevel > -900 && y < this.waterLevel + 0.05) return 'water';
    return this.slopeAt(x, z) > 0.42 ? 'stone' : 'sand';
  }

  raycast(origin, dir, maxDist, outPoint, outNormal) {
    // Coarse march then bisect — plenty accurate for a heightfield.
    let t = 0, lastT = 0;
    let lastAbove = origin.y - this.height(origin.x, origin.z);
    if (lastAbove < 0) return null;
    const stepLen = Math.max(this.step * 0.5, 0.35);
    while (t < maxDist) {
      t = Math.min(t + stepLen * (1 + t * 0.035), maxDist);
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (Math.abs(px) > this.half || Math.abs(pz) > this.half) { lastT = t; continue; }
      const above = py - this.height(px, pz);
      if (above <= 0) {
        let lo = lastT, hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my - this.height(mx, mz) > 0) lo = mid; else hi = mid;
        }
        outPoint.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        this.normalAt(outPoint.x, outPoint.z, outNormal);
        return hi;
      }
      lastAbove = above; lastT = t;
    }
    return null;
  }

  /* ── deformation ───────────────────────────────────────────────────── */

  /**
   * Push the surface down (or up with a negative depth) — craters from Force
   * landings, gouges from a body hitting the dune at speed.
   */
  crater(x, z, radius, depth, rim = 0.28) {
    if (this.preset.flat) return;
    const i0 = Math.max(0, Math.floor((x - radius + this.half) * this.invStep));
    const i1 = Math.min(this.res - 1, Math.ceil((x + radius + this.half) * this.invStep));
    const j0 = Math.max(0, Math.floor((z - radius + this.half) * this.invStep));
    const j1 = Math.min(this.res - 1, Math.ceil((z + radius + this.half) * this.invStep));
    if (i1 < i0 || j1 < j0) return;
    const inv = 1 / radius;
    for (let j = j0; j <= j1; j++) {
      const wz = -this.half + j * this.step;
      for (let i = i0; i <= i1; i++) {
        const wx = -this.half + i * this.step;
        const d = Math.hypot(wx - x, wz - z) * inv;
        if (d > 1.15) continue;
        const k = this._idx(i, j);
        // bowl with a raised lip
        const bowl = -depth * Math.pow(clamp(1 - d, 0, 1), 1.6);
        const lip = depth * rim * Math.exp(-Math.pow((d - 0.92) * 5.5, 2));
        const delta = bowl + lip;
        this.deform[k] += delta;
        this.deform[k] = clamp(this.deform[k], -4.5, 3.0);
        this.heights[k] += delta;
      }
    }
    this._markDirty(i0, j0, i1, j1);
  }

  _markDirty(i0, j0, i1, j1) {
    const r = this._dirtyRegion;
    if (!r) this._dirtyRegion = { i0, j0, i1, j1 };
    else {
      r.i0 = Math.min(r.i0, i0); r.j0 = Math.min(r.j0, j0);
      r.i1 = Math.max(r.i1, i1); r.j1 = Math.max(r.j1, j1);
    }
  }

  /** Apply pending deformation to the GPU buffers (once per frame at most). */
  flush() {
    const r = this._dirtyRegion;
    if (!r) return;
    this._dirtyRegion = null;
    const pos = this.geometry.attributes.position;
    const nrm = this.geometry.attributes.normal;
    const i0 = Math.max(0, r.i0 - 1), i1 = Math.min(this.res - 1, r.i1 + 1);
    const j0 = Math.max(0, r.j0 - 1), j1 = Math.min(this.res - 1, r.j1 + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.res + i;
        pos.setY(k, this.heights[k]);
      }
    }
    // recompute normals only in the touched region
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.res + i;
        const hL = this.heights[this._idx(i - 1, j)], hR = this.heights[this._idx(i + 1, j)];
        const hD = this.heights[this._idx(i, j - 1)], hU = this.heights[this._idx(i, j + 1)];
        _tv.set(hL - hR, 2 * this.step, hD - hU).normalize();
        nrm.setXYZ(k, _tv.x, _tv.y, _tv.z);
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  /** Keep an entity above the ground; returns the ground height at the point. */
  clampToGround(v, offset = 0) {
    const h = this.height(v.x, v.z) + offset;
    if (v.y < h) v.y = h;
    return h;
  }

  inBounds(x, z, margin = 4) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

const _tv = new THREE.Vector3();
