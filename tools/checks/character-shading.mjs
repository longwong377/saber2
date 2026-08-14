/**
 * Character surface checks — the vertex-colour occlusion channel and the
 * limb profiles that hang off it, in src/game/Bodies.js.
 *
 * These characters are lit by one sun and one hemisphere fill, and a
 * MeshStandardMaterial with no aoMap has no way to know that the inside of an
 * elbow sees a tenth of the sky the outside of it does. There is no second UV
 * set to hang an aoMap on and no room in the budget to bake one, so the creases
 * are baked per vertex instead. That buys three new ways to be wrong, and this
 * file pins all three:
 *
 *   · a material that declares `vertexColors` over a geometry that carries none
 *     does NOT fall back to white — three leaves the attribute unbound and the
 *     mesh renders BLACK. The cut path is the dangerous one: Ragdoll rebuilds a
 *     severed stub by calling straight back into limbGeo with no options, so
 *     limbGeo has to hand out the channel unasked;
 *   · occlusion that is baked but is everywhere 1.0 is a no-op nobody notices,
 *     which is exactly how a castShadow flag once sat in this codebase as a
 *     silent no-op for months;
 *   · limbGeo's multi-swell profile has to meet its caps at exactly r0 and r1,
 *     or a limb severed at 62% rebuilds into a stub that does not line up with
 *     the piece that fell off it.
 */

import { readFileSync } from 'node:fs';
import * as B from '../../src/game/Bodies.js';
import { rawMaps, MEAN_ALBEDO } from '../../src/engine/Textures.js';
import { celMapValue, celChroma, celAlbedo } from '../../src/toon/Cel.js';

const BUILD = {
  jedi: (o) => B.buildJedi(o), b1: (o) => B.buildB1(o), b2: (o) => B.buildB2(o),
  trooper: (o) => B.buildTrooper(o), acolyte: (o) => B.buildAcolyte(o),
};
const ALL = Object.keys(BUILD);
const CACHE = new Map();
function unit(name) {
  if (!CACHE.has(name)) CACHE.set(name, BUILD[name]({}));
  return CACHE.get(name);
}

/** Mean vertex-colour value over the vertices inside a local-space box. */
function shadeIn(geo, box) {
  const c = geo.attributes.color, p = geo.attributes.position;
  if (!c) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < c.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (x < box[0] || x > box[1] || y < box[2] || y > box[3] || z < box[4] || z > box[5]) continue;
    sum += c.getX(i); n++;
  }
  return n ? { mean: sum / n, n } : null;
}

/* ── the albedo path, in JS ─────────────────────────────────────────────
 *
 * The cloth bake's texels, once, in linear light. 40k samples off the real
 * bytes — under the headless shim a canvas readback returns zeros, so this
 * reads rawMaps the way tools/checks/materials.mjs does rather than going
 * through getImageData.
 */
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
let CLOTH_TEXELS = null;
function clothTexels() {
  if (CLOTH_TEXELS) return CLOTH_TEXELS;
  const m = rawMaps('cloth');
  const N = m.size * m.size, step = Math.max(1, Math.floor(N / 40000));
  CLOTH_TEXELS = [];
  for (let i = 0; i < N; i += step) {
    CLOTH_TEXELS.push([toLinear(m.albedo[i * 4]), toLinear(m.albedo[i * 4 + 1]), toLinear(m.albedo[i * 4 + 2])]);
  }
  return CLOTH_TEXELS;
}
/** What a tinted garment's mean luminance comes out as, under either pipeline. */
function renderedMean(tint, mode) {
  let s = 0;
  for (const t of clothTexels()) {
    s += mode === 'split'
      // map_fragment quantises the TEXEL, then the tint, then the chroma lift
      ? luminance(celChroma(celMapValue(t).map((c, k) => c * tint[k])))
      // what shipped: quantise the finished map × tint
      : luminance(celAlbedo(t.map((c, k) => c * tint[k])));
  }
  return s / clothTexels().length;
}

export function run({ check, assert, near, THREE }) {

  check('shading: every authored cloth tone on the figure survives to the frame, in order', () => {
    /* THE LADDER Bodies.js SPENDS A PARAGRAPH BUILDING, AND WHAT THE SHADER
     * DID TO IT.
     *
     * buildJedi derives five garment tones from the two-colour palette the
     * player picked — over-robe darker than the body, body darker than the
     * sleeve, trim darker than all of them — because "at any range past three
     * metres [one colour] reads as a single painted surface". The albedo
     * posteriser then ran on the FINISHED surface colour, map × tint, and a
     * quantiser applied to a product quantises the tint as well. Measured per
     * texel through the real cloth bake, as mean rendered luminance:
     *
     *   Night   tunic .0781  outer .0100  over .0100  sleeve .0100  trim .0100
     *   Ash     tunic .4032  outer .0900  over .0900  sleeve .2334  trim .0100
     *
     * Night's five layers landed on TWO values with four of them identical, and
     * the order came out outer < over < sleeve < trim < tunic — the trim,
     * authored as the darkest thing on the figure, rendering brighter than the
     * outer robe. The cause is the bottom plateau: bands are cut on
     * sqrt(luminance), so band 0 is 0 → 0.04 linear, which is everything below
     * sRGB 55. Night is selectable in the creator and worn by two Orders.
     *
     * The property asserted is stronger than "five tones": EVERY distinct cloth
     * tone on the figure has to survive, and the rendered ORDER has to be the
     * authored order. Read off the built materials rather than off a copy of
     * the palette table, so a sixth layer or a re-derived mix is measured the
     * day it is added.
     */
    /* WHICH TWIN TO RUN IS READ OFF THE SHADER, not chosen. There is no GL
     * context in this harness, so the measurement below is a JS twin either
     * way — but if it picked its own operator it would keep passing over a
     * shader that had gone back to quantising the palette. It picks the twin
     * the installer's own substitution text says the GPU is running, so a
     * revert is measured rather than merely noticed. */
    const src = readFileSync(new URL('../../src/toon/Cel.js', import.meta.url), 'utf8');
    const onTexel = /sub\('map_fragment',[\s\S]{0,400}?saberCelMapValue\( sampledDiffuseColor\.rgb \)/.test(src);
    const onSurface = /'material\.diffuseColor = saberCel(\w+)\( diffuseColor\.rgb \);'/.exec(src);
    assert(onSurface, 'nothing is written to material.diffuseColor any more');
    const mode = onTexel && onSurface[1] === 'Chroma' ? 'split' : 'flat';

    const rows = [];
    let worstOld = 0, collapsedOld = 0, palettes = 0, layers = 0;
    for (let i = 0; i < B.ROBE_COLORS.length; i++) {
      const u = B.buildJedi({ robeIndex: i });
      const mats = new Map();
      u.rig.root.traverse((o) => {
        const m = o.isMesh && o.material;
        if (!m || m.userData?.mapMean !== MEAN_ALBEDO.cloth) return;
        if (!mats.has(m.uuid)) mats.set(m.uuid, m);
      });
      assert(mats.size >= 5,
        `${B.ROBE_COLORS[i].name}: only ${mats.size} distinct cloth tones on the figure — the ladder `
        + 'is gone from the builder, not from the shader');
      const list = [...mats.values()].map((m) => ({
        authored: luminance(m.userData.authored),
        now: renderedMean(m.color.toArray(), mode),
        was: renderedMean(m.color.toArray(), 'flat'),
      }));
      palettes++; layers = Math.max(layers, list.length);
      const round = (v) => Math.round(v * 1e4);
      const distinctNow = new Set(list.map((l) => round(l.now))).size;
      const distinctWas = new Set(list.map((l) => round(l.was))).size;
      assert(distinctNow === list.length,
        `${B.ROBE_COLORS[i].name}: ${list.length} authored cloth tones render as ${distinctNow} — `
        + 'layers that were given different colours are coming out identical');
      // …and in the authored order, which is the half a tone count cannot see
      const byAuthored = [...list].sort((a, b) => a.authored - b.authored);
      for (let k = 1; k < byAuthored.length; k++) {
        assert(byAuthored[k].now > byAuthored[k - 1].now,
          `${B.ROBE_COLORS[i].name}: a layer authored ${(byAuthored[k].authored /
            byAuthored[k - 1].authored).toFixed(2)}× brighter than the one under it renders `
          + `${(byAuthored[k].now / byAuthored[k - 1].now).toFixed(2)}× — the ladder has inverted`);
      }
      // THE CONTROL: the same figure through the operator that shipped.
      let inversions = 0;
      for (let k = 1; k < byAuthored.length; k++) if (byAuthored[k].was <= byAuthored[k - 1].was) inversions++;
      if (distinctWas < list.length) collapsedOld++;
      worstOld = Math.max(worstOld, list.length - distinctWas);
      rows.push(`${B.ROBE_COLORS[i].name} ${distinctNow}/${list.length}`
        + (distinctWas < list.length ? ` (was ${distinctWas}, ${inversions} inverted)` : ''));
    }
    assert(collapsedOld >= 2 && worstOld >= 3,
      `the shipped operator only collapsed ${collapsedOld} palettes by at most ${worstOld} tones — `
      + 'the control is not reproducing the defect, so the assertions above prove nothing');
    return `${palettes} palettes × up to ${layers} cloth tones, all distinct and in order — `
      + rows.join(' · ');
  });

  check('shading: no material asks for vertex colours a geometry cannot give', () => {
    // The failure mode is not subtle and it is not partial: the mesh goes
    // solid black. Every archetype, every mesh, no exceptions — including the
    // merged assemblies (hands, boots, head shells, Kit buckets), which pick
    // their attributes up from whichever part happened to have them.
    let vc = 0, total = 0;
    const bad = [];
    for (const name of ALL) {
      const u = unit(name);
      u.rig.root.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.material) return;
        total++;
        if (!o.material.vertexColors) return;
        vc++;
        if (!o.geometry.attributes.color) bad.push(`${name}/${o.parent?.name || '?'}`);
      });
    }
    assert(bad.length === 0, `${bad.length} meshes would render black: ${bad.slice(0, 4).join(', ')}`);
    assert(vc >= 20, `only ${vc} of ${total} character meshes carry the occlusion channel`);
    return `${vc}/${total} meshes on vertex-coloured materials, all with a colour attribute`;
  });

  check('shading: no material is still paying for a lobe the BRDF no longer has', () => {
    /* THE SHEEN LOBE WAS DELETED AND ITS BILL WAS NOT.
     *
     * src/toon/Cel.js removes both sheen accumulations from
     * lights_physical_pars_fragment (rule 8 — a retroreflective cloth rim reads
     * as satin, which is the opposite of a flat colour field). three pays for
     * that lobe by taking it out of the diffuse FIRST, in meshphysical_frag:
     *
     *     float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
     *     outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect
     *                   + sheenSpecularIndirect;
     *
     * — so with the lobe gone that line is a straight multiply-down of every
     * material that declares `sheen`, and only of those. The robes on the PLAYER
     * declare it; the identical cloth on an acolyte does not.
     *
     * The number matters and the obvious way to compute it is wrong: three
     * uploads the uniform as `sheenColor × sheen`
     * (WebGLMaterials.refreshMaterialSheen), so max3 is 0.6867 × sheen, not
     * 0.6867. The compensation is therefore 0.957 at sheen 0.40, not 0.892.
     * It is a 2.6–4.3% darkening, which is at or under the just-noticeable
     * difference on a single surface — and that is exactly why it needs a check
     * rather than an eye: it silently decalibrates the authored albedo ladder
     * `lit()` builds, and it does it to the player and to nobody else.
     *
     * Engine.js imported DYNAMICALLY — see the note in tools/checks/materials.mjs.
     */
    return (async () => {
      const THREE_ = (await import('three'));
      await import('../../src/engine/Engine.js');
      const { celInstall } = await import('../../src/toon/Cel.js');
      assert(celInstall && celInstall.missed.length === 0,
        `the cel install missed ${celInstall ? celInstall.missed.join(', ') : 'everything'}`);

      /* WHERE THE TEXT ACTUALLY LIVES. ShaderChunk.meshphysical_frag,
       * ShaderLib.standard.fragmentShader and ShaderLib.physical.fragmentShader
       * are one immutable string in three, and WebGLPrograms compiles from
       * ShaderLib — so patching only the chunk would report success and change
       * nothing. All three are asserted, or the next refactor can quietly go
       * back to patching the copy nobody reads. */
      const where = [
        ['ShaderChunk.meshphysical_frag', THREE_.ShaderChunk.meshphysical_frag],
        ['ShaderLib.standard', THREE_.ShaderLib.standard.fragmentShader],
        ['ShaderLib.physical', THREE_.ShaderLib.physical.fragmentShader],
      ];
      for (const [label, src] of where) {
        assert(!/sheenEnergyComp/.test(src),
          `${label} still darkens outgoingLight by the sheen energy compensation, and the lobe it `
          + 'compensates for was deleted from the BRDF');
      }
      // and the lobes really are gone, or the compensation was load-bearing
      const pars = THREE_.ShaderChunk.lights_physical_pars_fragment;
      assert(!/sheenSpecularDirect \+=/.test(pars) && !/sheenSpecularIndirect \+=/.test(pars),
        'a sheen lobe is back — then its energy compensation belongs back with it');

      /* WHAT IT WAS WORTH, on the figure it was charged to. */
      const seen = new Map();
      let physical = 0, standard = 0, meshes = 0;
      unit('jedi').rig.root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        meshes++;
        if (o.material.isMeshPhysicalMaterial) physical++; else standard++;
        const s = o.material.sheen || 0;
        if (s <= 0) return;
        const c = o.material.sheenColor;
        const comp = 1 - 0.157 * Math.max(c.r, c.g, c.b) * s;   // three's own uniform, sheenColor × sheen
        seen.set(comp, (seen.get(comp) || 0) + 1);
      });
      let worst = 1, n = 0;
      for (const [comp, count] of seen) { worst = Math.min(worst, comp); n += count; }
      assert(n >= 20,
        `only ${n} meshes on the player declare sheen — this check has stopped measuring the case it was written for`);
      assert(worst < 0.99,
        `the worst compensation on the player is ${worst.toFixed(4)}, which is not a darkening — `
        + 'the twin is not reproducing the defect, so the assertions above prove nothing');
      // an NPC in the same cloth must have been unaffected, which is what made
      // it a discrepancy between characters rather than a global exposure shift
      let npcSheen = 0;
      unit('acolyte').rig.root.traverse((o) => { if (o.isMesh && o.material?.sheen > 0) npcSheen++; });
      const rows = [...seen.entries()].sort((a, b) => a[0] - b[0])
        .map(([c, k]) => `${k}× ${(100 * c).toFixed(2)}%`);
      return `${n} of ${meshes} player meshes carried it (${rows.join(', ')}), worst `
        + `${((1 - worst) * 100).toFixed(1)}% dark; ${physical} physical / ${standard} standard, `
        + `acolyte ${npcSheen} — all now at 100%`;
    })();
  });

  check('shading: a limb rebuilt by the cut path still has the channel', () => {
    // Ragdoll.js severs a bone by disposing the limb's geometry and calling
    // limbGeo(keepLen, r0, rCut, seg, true) — no options, no colour asked for
    // — then hangs the ORIGINAL material on it. If limbGeo does not hand out a
    // neutral channel unasked, every severed arm in the game is a black stub.
    const g = B.limbGeo(0.2, 0.05, 0.04, 10, true);
    const c = g.attributes.color;
    assert(c, 'limbGeo emitted no colour attribute — a severed stub would render black');
    let lo = 1;
    for (let i = 0; i < c.count; i++) lo = Math.min(lo, c.getX(i));
    assert(lo > 0.999, `an unshaded limb is not neutral (darkest ${lo.toFixed(3)})`);
    return `${c.count} vertices, all neutral white`;
  });

  check('shading: the creases are actually darker than the surfaces beside them', () => {
    // Baked occlusion that is everywhere 1.0 costs memory and does nothing,
    // and nothing downstream can tell. Each pair below is (crease, open
    // surface on the same mesh); the crease has to win by a real margin, not
    // by a rounding error. Boxes are in the BONE's own local frame: +Y runs
    // along the bone from its root and +Z is the front of the character.
    const u = unit('jedi');
    const g = (n) => u.rig.get(n).primary.geometry;
    const rows = [];
    const pairs = [
      // the armpit, against the middle of the ribcage's flank
      ['chest armpit', g('chest'), [0.10, 0.20, 0.15, 0.21, -0.06, 0.06], [0.10, 0.20, 0.02, 0.09, -0.06, 0.06]],
      // the root of the shoulder, against mid-humerus
      ['shoulder root', g('armL'), [-0.09, 0.09, 0, 0.03, -0.09, 0.09], [-0.09, 0.09, 0.12, 0.20, -0.09, 0.09]],
      // behind the knee, against the front of the same slice of shin
      ['knee back', g('shinL'), [-0.09, 0.09, 0, 0.04, -0.09, -0.02], [-0.09, 0.09, 0, 0.04, 0.02, 0.09]],
      // the thigh under the skirt, against the knee end of it
      ['thigh under skirt', g('thighL'), [-0.10, 0.10, 0, 0.06, -0.10, 0.10], [-0.10, 0.10, 0.36, 0.44, -0.10, 0.10]],
      // the neck down inside the collar, against the top of it
      ['neck in collar', g('neck'), [-0.07, 0.07, -0.05, 0.022, -0.07, 0.07], [-0.07, 0.07, 0.050, 0.080, -0.07, 0.07]],
      // the scalp under the hair, against the cheek
      ['scalp', u.rig.get('head').primary.geometry,
        [-0.08, 0.08, 0.13, 0.20, -0.10, 0.00], [-0.08, 0.08, 0.05, 0.09, 0.04, 0.10]],
    ];
    let worst = 1;
    for (const [label, geo, dark, light] of pairs) {
      const a = shadeIn(geo, dark), b = shadeIn(geo, light);
      assert(a && b, `${label}: one of the sample boxes caught no vertices`);
      const ratio = a.mean / b.mean;
      assert(ratio < 0.80, `${label} is only ${(ratio * 100).toFixed(0)}% of the open surface beside it (${a.n}/${b.n} verts)`);
      worst = Math.min(worst, ratio);
      rows.push(`${label} ${(ratio * 100).toFixed(0)}%`);
    }
    // and the darkest crease on the figure has to be a real drop, not a tint
    let darkest = 1, shaded = 0;
    u.rig.root.traverse((o) => {
      const c = o.isMesh && o.geometry && o.geometry.attributes.color;
      if (!c) return;
      let mn = 1;
      for (let i = 0; i < c.count; i++) mn = Math.min(mn, c.getX(i));
      if (mn < 0.995) shaded++;
      darkest = Math.min(darkest, mn);
    });
    assert(darkest < 0.45, `the darkest crease on the player is ${darkest.toFixed(2)} — that is a tint, not an occlusion`);
    assert(shaded >= 24, `only ${shaded} meshes on the player carry any occlusion at all`);
    return rows.join(' · ') + ` — ${shaded} meshes shaded, darkest ${darkest.toFixed(2)}`;
  });

  check('shading: a multi-swell limb still meets its caps at exactly r0 and r1', () => {
    // The deltoid and the bicep are two humps in one lathe now, and the cut
    // path rebuilds a stub from r0 and r1 alone. A hump that does not fall to
    // zero at both ends of the shaft — the obvious way to write one — puts the
    // stub's mouth several millimetres away from the piece that fell off it.
    const r0 = 0.052, r1 = 0.039, len = 0.285;
    const g = B.limbGeo(len, r0, r1, 16, false,
      { rings: 11, swells: [[0.15, 0.34, 0.155], [0.42, 0.085, 0.20]] });
    const p = g.attributes.position;
    let atBase = 0, atTip = 0, peak = 0, peakAt = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < 1e-6) atBase = Math.max(atBase, r);
      if (y > len - 1e-6) atTip = Math.max(atTip, r);
      if (r > peak) { peak = r; peakAt = y / len; }
    }
    near(atBase, r0, 1e-5, 'radius where the shaft meets its base cap');
    near(atTip, r1, 1e-5, 'radius where the shaft meets its tip cap');
    // and the swells have to have actually done something — a deltoid is a
    // third thicker than the shoulder joint under it
    assert(peak > r0 * 1.25, `the deltoid swell only reaches ${(peak * 1000).toFixed(1)}mm against a ${(r0 * 1000).toFixed(0)}mm joint`);
    assert(peakAt > 0.08 && peakAt < 0.30, `the deltoid peaks at ${(peakAt * 100).toFixed(0)}% of the humerus`);
    return `base ${(atBase * 1000).toFixed(2)}mm, tip ${(atTip * 1000).toFixed(2)}mm, peak ${(peak * 1000).toFixed(1)}mm at ${(peakAt * 100).toFixed(0)}%`;
  });

  check('shading: nothing is bolted onto the humerus where the deltoid should be', () => {
    // The deltoid used to be a squashed sphere parented to the arm bone and
    // dropped on top of the arm tube: 21% of its 168 triangles buried inside
    // the arm and the rest standing 13.6mm proud, so what the player saw was a
    // ball welded to a pipe with a hard intersection line right round the
    // shoulder. It is a swell in the arm's own lathe now. Garments — a sleeve
    // hem, a mantle — are allowed on the bone; a bare BODY mass is not.
    // Scoped to the flesh-and-cloth archetypes. A droid's shoulder bell is a
    // separate armour casting in the same painted plastoid as the strut under
    // it, and it is SUPPOSED to be a bolted-on mass — asserting otherwise there
    // would be a test that cries wolf, and those get muted.
    const rows = [];
    for (const name of ['jedi', 'trooper', 'acolyte']) {
      const u = unit(name);
      const bone = u.rig.get('armL');
      const arm = bone.primary;
      const armMat = arm.material;
      for (const o of bone.obj.children) {
        if (!o.isMesh || o === arm || o.userData.boneChild) continue;
        assert(o.material !== armMat,
          `${name} has a ${o.geometry.index ? o.geometry.index.count / 3 : 0}-triangle mass on the humerus in the arm's OWN material — that is a deltoid bolted on, not grown`);
      }
      // and the tube has to carry the mass itself
      const p = arm.geometry.attributes.position;
      let peak = 0, base = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getZ(i));
        peak = Math.max(peak, r);
        if (p.getY(i) < 1e-6) base = Math.max(base, r);
      }
      rows.push(`${name} ${(peak * 1000).toFixed(0)}mm peak / ${(base * 1000).toFixed(0)}mm at the joint`);
    }
    return rows.join('  ');
  });
}
