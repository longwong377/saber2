/**
 * JEDI, SITH, GREY — and whether any of it is real.
 *
 * This project's signature bug is a feature that looks shipped and is a
 * parameter nobody reads: `skinColor` and `hairColor` were arguments of
 * buildJedi that nothing ever passed, Cleaving Throw set a flag with no reader,
 * Makashi wrote its own identity value, `coreWidth` was read once at
 * construction while a boon card promised it moved. There are five checks in
 * this directory whose entire job is to catch the next one.
 *
 * An "order" is exactly the kind of feature that becomes the sixth. It is three
 * names, three blurbs and three colour lists, and every one of those can be
 * shipped without a single line of code downstream doing anything differently.
 * So nothing here checks that the data exists. Everything here checks that a
 * VALUE ARRIVES: at a uniform the shader reads, at a material the renderer
 * draws, at a field World or Player or Combat consults on a frame that matters.
 *
 * The five questions, in order of how much a player would feel the answer:
 *
 *   1. Does picking an order change the blade the GPU is handed? (§2, §3)
 *   2. Does it change what the player's own numbers are worth? (§5, §6)
 *   3. Is the Grey a third thing, or a slider between the other two? (§6)
 *   4. Does NOT picking one leave the game exactly as it was? (§1)
 *   5. Is any of it a number nobody reads? (§7)
 *
 * WHICH OF THESE FAIL ON THE CODE BEFORE THIS FEATURE, verified by running them
 * against a worktree at HEAD: §2, §3, §4, §5, §6 and §7 all fail — most of them
 * because `new Saber(scene, { order })` and `applyOrder` did not exist, and §2
 * additionally has an in-file teeth clause that fails on the NEUTRAL tuning, so
 * it would still fail if the table were ever flattened back to one blade. §1 is
 * a regression guard and passes on both, which is the point of it.
 */

import * as THREE from 'three';
import { Saber, SABER_COLORS, HILT_STYLES, BLADE_TUNING, TEMPER } from '../../src/game/Saber.js';
import { ORDERS, ORDER_IDS, getOrder, applyOrder, crystalPalette, crystalAt,
  crystalForOrder, hiltsForOrder, orderReadout, temperTime } from '../../src/game/Order.js';
import { ROBE_COLORS } from '../../src/game/Bodies.js';
import { BOONS } from '../../src/game/Waves.js';
import { readFile } from 'node:fs/promises';

const src = (p) => new URL(`../../src/${p}`, import.meta.url);

/* ── the shader, in JS ───────────────────────────────────────────────── */

/**
 * BLADE_FRAG's radial profile, driven by the uniforms of a REAL material so the
 * model cannot drift from the shader without this drifting with it. Lifted from
 * the same transcription tools/checks/vfx.mjs uses, which is the established
 * instrument for this question — the point of reusing it is that a Sith blade
 * gets measured by exactly the ruler the shipped blade was measured by.
 */
function emission(mat, d, pxSize = 0) {
  const u = mat.uniforms;
  const wid = [u.uWidth.value.x, u.uWidth.value.y, u.uWidth.value.z];
  const amp = [u.uAmp.value.x, u.uAmp.value.y, u.uAmp.value.z];
  const R = u.uRadius.value;
  let e = 0;
  for (let i = 0; i < 3; i++) {
    const we = Math.max(wid[i], pxSize * 0.62);
    const keep = wid[i] / we;
    const dd = d / we;
    e += amp[i] * (i === 2 ? Math.exp(-Math.pow(dd, 1.4)) : Math.exp(-dd * dd)) * keep;
  }
  const t = Math.min(1, Math.max(0, (d - R) / (R * 0.55 - R)));
  return e * (t * t * (3 - 2 * t));
}
const emissionRGB = (s, d, px = 0) => {
  const e = emission(s.bladeMat, d, px) * s.punch;
  return [s.hue.r * e, s.hue.g * e, s.hue.b * e];
};
const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const chroma = (r, g, b) => {
  const M = Math.max(r, g, b), m = Math.min(r, g, b);
  return M < 1e-6 ? 0 : (M - m) / M;
};
/** three's ACESFilmicToneMapping, at vfx.mjs's probe exposure. */
function aces(rgb, exposure = 0.9) {
  const mul = (m, v) => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  let v = rgb.map((c) => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  return mul(OUT, v).map((x) => Math.min(1, Math.max(0, x)));
}
/** The shader's standing instability, sampled over the blade and over time. */
function instability(u, samples = 160) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < samples; i++) {
    const a = i / samples * 1.15;
    for (let j = 0; j < samples; j++) {
      const t = j / samples * 2.4;
      const n = Math.sin(a * 57 - t * 8) + Math.sin(a * 23 + t * 5.3) * 0.7
        + Math.sin(a * 127 + t * 17) * 0.3;
      const v = 1 + n * u;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  return { lo, hi, pp: hi - lo };
}

/** A blade, driven for a few frames so the uniforms are the ones a frame draws. */
function blade(opts, frames = 6) {
  const s = new Saber(new THREE.Scene(), opts);
  s.ignite(); s.ignition = 1;
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(0, 1.1, 0);
  for (let k = 0; k < frames; k++) { s.setHiltPose(pos, q); s.update(1 / 60, k / 60, null); }
  return s;
}

/** Swing a saber for `n` frames at a given wrist speed, in m/s at the tip. */
function swing(s, speed, n, carrier = null, dt = 1 / 60) {
  const pos = new THREE.Vector3(0, 1.1, 0);
  const q = new THREE.Quaternion();
  // The tip is bladeLength+emitterY from the pivot; an angular rate of
  // speed/radius puts the tip at exactly `speed`.
  const radius = s.bladeLength + s.emitterY;
  let th = s._probeTh || 0;
  for (let k = 0; k < n; k++) {
    th += (speed / radius) * dt * (Math.floor(k / 14) % 2 ? -1 : 1);
    q.setFromEuler(new THREE.Euler(0, 0, th));
    const p = carrier ? pos.clone().addScaledVector(carrier, dt * k) : pos;
    s.setHiltPose(p, q);
    s.update(dt, k / 60, carrier);
  }
  s._probeTh = th;
  return s;
}

/** A Player-shaped target: exactly the fields applyOrder and the readers touch. */
function subject(orderId, saberOpts = {}) {
  const p = {
    saber: blade({ colorIndex: 0, ...saberOpts }),
    control: { deadzone: 0.22, sensitivity: 1 },
    maxHp: 100, hp: 100, maxForce: 100, force: 100, maxStamina: 100, stamina: 100,
    boonMods: {
      deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lightning: false,
      repulse: false, throwPierce: false, doubleJump: false, lifesteal: 0,
    },
  };
  if (orderId) applyOrder(p, orderId);
  return p;
}

export async function run({ check, assert, near }) {
  const P = Saber.PROFILE;

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §1. NOT CHOOSING AN ORDER LEAVES THE GAME EXACTLY AS IT WAS       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: a blade with no order is bit-for-bit the blade that shipped', () => {
    /* The load-bearing one. Player, Enemy, the sparring acolytes, Net's remote
     * players and the forge preview all build Sabers, and only one of those five
     * is going to pass an order for a long time. If adding orders moved the
     * default blade by so much as an ulp, every measured number in
     * tools/checks/saber-light.mjs and tools/checks/vfx.mjs would be describing
     * a weapon that no longer exists.
     *
     * Asserted against the FORMULA rather than a snapshot, at four widths, so it
     * is still true if PROFILE is ever re-solved. NEUTRAL_TUNING is 1.0 in every
     * factor and `x * 1` is exact in IEEE754 — that is why the tuning is
     * expressed as factors on the shipped profile and not as three parallel
     * copies of it. */
    const rows = [];
    for (const w of [0.45, 0.7, 1.0, 1.6]) {
      const s = blade({ colorIndex: 0, coreWidth: w });
      const u = s.bladeMat.uniforms;
      assert(s.order === null, `an order-less Saber reports order ${s.order}`);
      near(u.uWidth.value.x, P.width[0] * w, 0, 'uWidth.x moved on an order-less blade');
      near(u.uWidth.value.y, P.width[1] * w, 0, 'uWidth.y moved on an order-less blade');
      near(u.uWidth.value.z, P.width[2] * w, 0, 'uWidth.z moved on an order-less blade');
      near(u.uAmp.value.x, P.amp[0] * (0.55 + 0.45 * w), 0, 'uAmp.x moved on an order-less blade');
      near(u.uAmp.value.y, P.amp[1] * w, 0, 'uAmp.y moved on an order-less blade');
      near(u.uAmp.value.z, P.amp[2] * w * w, 0, 'uAmp.z moved on an order-less blade');
      near(u.uRadius.value, P.radius * w, 0, 'uRadius moved on an order-less blade');
      near(u.uCoreWhite.value, Saber.CORE_WHITE, 0, 'uCoreWhite moved on an order-less blade');
      near(u.uUnstable.value, Saber.UNSTABLE, 0,
        'uUnstable is not the 0.030 that used to be written into the shader');
      near(s.trailLife, Saber.TRAIL_LIFE, 0, 'the smear lifetime moved on an order-less blade');
      near(s.trailThickness, P.width[1] * 1.6 * w, 0, 'trailThickness moved on an order-less blade');
      // the hilt too: four materials, and an order is allowed to change all four
      const M = { steel: 0x8d939c, dark: 0x1c1f26, black: 0x0c0e12, gold: 0xb98b3e };
      for (const [k, hex] of Object.entries(M)) {
        assert(s.hiltMetals[k].color.getHex() === hex,
          `the ${k} the hilt is machined out of moved on an order-less blade`);
      }
      near(s.hiltMetals.steel.roughness, 0.34, 0, 'the steel finish moved on an order-less blade');
      near(s.hiltMetals.gold.roughness, 0.28, 0, 'the gold finish moved on an order-less blade');
      rows.push(w);
      s.dispose();
    }
    /* And the temporal flicker, which is the one EXPRESSION an order scales
     * rather than a uniform it replaces. Compared without a division: the
     * factor is applied per term precisely so the sum re-associates to the same
     * bits, and re-deriving the AC part by subtracting 0.94 back out would lose
     * a bit to the subtraction and make an exact claim untestable. */
    const s = blade({ colorIndex: 0 }, 40);
    const t = 39 / 60;
    const want = (0.94 + Math.sin(t * 47.3) * 0.022 + Math.sin(t * 111.7) * 0.014) * s.punch;
    near(s.bladeMat.uniforms.uFlicker.value, want, 0,
      'the order-less blade\'s flicker is not the sum it always was');
    s.dispose();
    return `every drawn uniform, the smear lifetime, the four hilt metals and the flicker `
      + `identical at widths ${rows.join('/')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §2. THE ORDER REACHES THE GPU                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: choosing one changes the blade the shader is handed, per lobe', () => {
    /* THE ONE THAT WOULD SHIP THE SIXTH DEAD PARAMETER. `order` could be stored
     * in the settings blob, printed on a card, coloured in the menu and passed
     * to the Saber constructor, and if _syncWidth never read it the blade would
     * be identical for all three and nothing else in this file would notice.
     *
     * So: same crystal, same width, three orders, and every lobe of the drawn
     * uniforms has to differ from the untuned blade by the factor its table
     * entry claims. Cerulean throughout — the question is the TUNING, and using
     * each order's own crystal would confound the two.
     *
     * The magnitudes are quoted because "differs" is not a design. What the
     * table is buying, at the shipped default width of 0.7 on a cerulean
     * crystal, measured through the tone curve further down this file:
     *
     *   coloured band    Jedi 90 mm    Sith 118 mm   Grey 72 mm (calm) 135 (fury)
     *   peak radiance    Jedi 19.8     Sith 24.8     Grey 18.2         25.6
     *   instability      Jedi ±4.5%    Sith ±21.6%   Grey ±2.7%        ±26.4% */
    const base = blade({ colorIndex: 0, coreWidth: 0.7 });
    const b = base.bladeMat.uniforms;
    const rows = [];
    for (const id of ORDER_IDS) {
      const s = blade({ colorIndex: 0, coreWidth: 0.7, order: id });
      const u = s.bladeMat.uniforms;
      assert(s.order === id, `a Saber built with order '${id}' reports '${s.order}'`);
      const spec = BLADE_TUNING[id];
      const T = spec.tempered ? spec.calm : spec;   // temper starts at 0
      const got = [
        ['uWidth.x', u.uWidth.value.x / b.uWidth.value.x, T.width[0]],
        ['uWidth.y', u.uWidth.value.y / b.uWidth.value.y, T.width[1]],
        ['uWidth.z', u.uWidth.value.z / b.uWidth.value.z, T.width[2]],
        ['uAmp.x', u.uAmp.value.x / b.uAmp.value.x, T.amp[0]],
        ['uAmp.y', u.uAmp.value.y / b.uAmp.value.y, T.amp[1]],
        ['uAmp.z', u.uAmp.value.z / b.uAmp.value.z, T.amp[2]],
        ['uRadius', u.uRadius.value / b.uRadius.value, T.radius],
        ['uUnstable', u.uUnstable.value / b.uUnstable.value, T.unstable],
        ['trailLife', s.trailLife / base.trailLife, T.trailLife],
      ];
      for (const [name, ratio, want] of got) {
        near(ratio, want, 1e-12,
          `${id}: ${name} came out ${ratio.toFixed(4)}x the untuned blade and the table says ${want}x`);
      }
      // At least one lobe has to actually MOVE, or the row is decoration.
      const moved = got.filter(([, , want]) => Math.abs(want - 1) > 0.02);
      assert(moved.length >= 3,
        `${id} only moves ${moved.length} of the blade's nine drawn numbers — that is a label`);
      // and uCoreWhite is per-instance now, so it has to arrive too
      near(u.uCoreWhite.value, T.coreWhite, 1e-12, `${id}: uCoreWhite did not arrive`);
      near(s.trailMat.uniforms.uCoreWhite.value, T.coreWhite, 1e-12,
        `${id}: the smear kept the old core neutralisation while the blade changed`);
      rows.push(`${id} ${moved.length}/9 lobes moved`);
      s.dispose();
    }
    /* TEETH. The same arithmetic against a table that had been flattened back to
     * one blade — which is what "the order is a label" looks like as code — must
     * fail the `moved.length >= 3` clause above for every order. */
    const flat = ORDER_IDS.filter((id) => {
      const spec = BLADE_TUNING[id], T = spec.tempered ? spec.calm : spec;
      const n = [...T.width, ...T.amp, T.radius, T.unstable, T.trailLife]
        .filter((v) => Math.abs(v - 1) > 0.02).length;
      return n < 3;
    });
    assert(!flat.length,
      `these orders draw a blade within 2% of the untuned one on every lobe: ${flat.join(', ')}`);
    base.dispose();
    return rows.join(', ');
  });

  check('order: the instability is a modulation and never a gain', () => {
    /* The discipline CORE_WHITE is held to, applied to the other axis this
     * feature moves. An unstable blade must be a blade that WOBBLES, not a blade
     * that is brighter — otherwise "the Sith blade is unstable" and "the Sith
     * blade is a stronger light on the world" are the same change wearing one
     * name, and no measurement afterwards can separate them.
     *
     * Two halves. The spatial one: uUnstable multiplies a sum of three sines
     * whose mean over the blade is zero, so raising it widens the swing without
     * touching the average. The temporal one: _updateVisuals scales the AC terms
     * of `flick` and leaves the 0.94 DC alone, which is checked here as an exact
     * proportionality rather than as an average, because it is exact. */
    const rows = [];
    for (const id of [null, ...ORDER_IDS]) {
      const s = blade({ colorIndex: 0, order: id });
      const u = s.bladeMat.uniforms.uUnstable.value;
      const sp = instability(u);
      near((sp.hi + sp.lo) / 2, 1, 2e-3,
        `${id}: the instability's own mean is ${((sp.hi + sp.lo) / 2).toFixed(4)}, not 1 — it is a gain`);
      rows.push([id ?? 'none', u, sp.pp]);
      s.dispose();
    }
    // temporal: same time, same crystal, AC term exactly proportional to the
    // order's flicker factor and the DC term untouched.
    const ref = blade({ colorIndex: 0 }, 40);
    const dc = 0.94, refAc = ref.bladeMat.uniforms.uFlicker.value / ref.punch - dc;
    for (const id of ORDER_IDS) {
      const s = blade({ colorIndex: 0, order: id }, 40);
      const spec = BLADE_TUNING[id], T = spec.tempered ? spec.calm : spec;
      const ac = s.bladeMat.uniforms.uFlicker.value / s.punch - dc;
      near(ac / refAc, T.flicker, 1e-9,
        `${id}: the flicker's AC term is ${(ac / refAc).toFixed(4)}x and the table says ${T.flicker}x`);
      // and the DC has to be exactly where it was, or the blade got brighter.
      // Against the reference blade's own DC rather than a re-derived one, so
      // the claim is "these two have the same resting level" and not a
      // subtraction compared with itself.
      near(s.bladeMat.uniforms.uFlicker.value / s.punch - ac,
        ref.bladeMat.uniforms.uFlicker.value / ref.punch - refAc, 1e-15,
        `${id}: the flicker's resting level moved off ${dc} — an unstable blade became a brighter one`);
      s.dispose();
    }
    ref.dispose();
    // the whole point: the range must actually differ, a lot
    const pp = rows.map((r) => r[2]);
    assert(Math.max(...pp) / Math.min(...pp) > 4,
      `the steadiest and the least steady blade differ by only ${(Math.max(...pp) / Math.min(...pp)).toFixed(2)}x`);
    return rows.map(([n, u, p]) => `${n} u=${u.toFixed(4)} ±${(p / 2 * 100).toFixed(1)}%`).join(', ')
      + `; ${(Math.max(...pp) / Math.min(...pp)).toFixed(1)}:1 across the orders, all centred on 1`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §3. EVERY ORDER'S BLADE IS STILL A BLADE                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: a re-tuned blade is still a white core in a coloured halo', () => {
    /* The tuning table is three ways to break the emission profile, and the
     * profile is the most argued-over object in this codebase. So every order's
     * blade is put through the SAME probe tools/checks/vfx.mjs puts the shipped
     * one through — white core radius, coloured band, monotone falloff, a
     * feather that starts where there is nothing left to cut — on each order's
     * own crystals, at the shipped width.
     *
     * Ivory is exempted from the CHROMA clauses and nothing else, for a reason
     * that is the whole point of the crystal: a purified crystal's linear chroma
     * is 0.11 against every other crystal's 0.76–0.99, so "how much of its hue
     * survives" divides by almost nothing. It is held to the geometric clauses
     * like everything else.
     *
     * WHICH OF VFX.MJS'S BOUNDS ARE USED, AND WHY NOT ALL OF THEM. The two
     * STRUCTURAL ones are — a white core between 3.5 and 42 mm (a hairline at
     * one end, a slab at the other) and a coloured region several times wider
     * than it. The third, `coloured > 120 mm`, is not: it is a statement about
     * an untuned blade at coreWidth 1, and it is the one number here that the
     * orders are DESIGNED to move — the Jedi's blade is tighter on purpose and
     * the Grey's composed blade is the tightest in the game on purpose. Holding
     * a deliberately focused beam to the halo width of the beam it was focused
     * from would be asserting that the feature must not work. What replaces it
     * is stronger and is the actual claim: the ratio floor below, at BOTH the
     * shipped width and vfx's, plus the on-screen spread at the end — the same
     * crystal has to come out visibly different under each order, measured
     * through the tone curve rather than at the uniforms. */
    const bad = [], rows = [];
    for (const o of ORDERS) {
      for (const idx of o.crystals) {
        for (const cw of [0.7, 1.0]) {
        const s = blade({ colorIndex: idx, coreWidth: cw, order: o.id });
        const own = chroma(s.hue.r, s.hue.g, s.hue.b);
        const kept = (d) => chroma(...aces(emissionRGB(s, d))) / own;
        let white = 0, coloured = 0, over = 0;
        for (let d = 0; d < 0.25; d += 0.0002) {
          const L = lum(...aces(emissionRGB(s, d)));
          if (own > 0.15) {
            if (kept(d) < 0.25 && L > 0.05) white = d;
            if (kept(d) > 0.75 && L > 0.05) coloured = d;
          }
          if (lum(...emissionRGB(s, d)) > 1.8) over = d;
        }
        // geometric, for every crystal: monotone, and zero at the quad edge
        const R = s.bladeMat.uniforms.uRadius.value;
        let prev = Infinity, peak = 0;
        for (let d = 0; d <= R; d += R / 400) {
          const e = emission(s.bladeMat, d);
          peak = Math.max(peak, e);
          if (e > prev + 1e-9) bad.push(`${o.id}/${SABER_COLORS[idx].name}: profile rises again`);
          prev = e;
        }
        if (emission(s.bladeMat, R) !== 0) bad.push(`${o.id}/${SABER_COLORS[idx].name}: not zero at the quad edge`);
        const uncut = s.bladeMat.uniforms.uAmp.value.z
          * Math.exp(-Math.pow(R * 0.8 / s.bladeMat.uniforms.uWidth.value.z, 1.4));
        if (uncut / peak >= 0.004) {
          bad.push(`${o.id}/${SABER_COLORS[idx].name}: the feather cuts ${(100 * uncut / peak).toFixed(2)}% of peak`);
        }
        // it has to bloom, and it must not be a ball of light
        if (over <= 0) bad.push(`${o.id}/${SABER_COLORS[idx].name}: never crosses the bloom threshold`);
        if (over > 0.060) bad.push(`${o.id}/${SABER_COLORS[idx].name}: over the bloom line to ${(over * 1000) | 0}mm`);
        const tag = `${o.id}/${SABER_COLORS[idx].name}@${cw}`;
        if (own > 0.15) {
          if (!(white > 0.0035 && white < 0.042)) {
            bad.push(`${tag}: white core ${(white * 1000).toFixed(1)}mm, outside 3.5–42mm`);
          }
          if (coloured / white < 4) {
            bad.push(`${tag}: only ${(coloured / white).toFixed(1)}x more coloured blade than white blade`);
          }
          rows.push([tag, white * 1000, coloured * 1000, coloured / white]);
        }
        s.dispose();
        }
      }
    }
    assert(!bad.length, bad.join('; '));

    /* AND IT HAS TO LOOK DIFFERENT, on screen, not only in the uniforms.
     * One crystal, four tunings, measured through the tone curve. Cerulean
     * because it is the crystal every other measurement in this project is
     * quoted on; a Saber does not care which rack a crystal came off, so this
     * isolates the tuning exactly as §2 does at the uniforms. */
    const band = (order, temper = 0) => {
      const s = blade({ colorIndex: 0, coreWidth: 0.7, order });
      if (temper) { s.temper = temper; s._retune(); }
      const own = chroma(s.hue.r, s.hue.g, s.hue.b);
      let c = 0;
      for (let d = 0; d < 0.25; d += 0.0002) {
        if (chroma(...aces(emissionRGB(s, d))) / own > 0.75 && lum(...aces(emissionRGB(s, d))) > 0.05) c = d;
      }
      const pk = lum(...emissionRGB(s, 0));
      s.dispose();
      return { c: c * 1000, pk };
    };
    const seen = { none: band(null), jedi: band('jedi'), sith: band('sith'),
      greyCalm: band('grey'), greyFury: band('grey', 1) };
    const widths = Object.values(seen).map((v) => v.c);
    assert(Math.max(...widths) / Math.min(...widths) > 1.8,
      `the widest and narrowest order blade differ by only ${(Math.max(...widths) / Math.min(...widths)).toFixed(2)}x `
      + 'of coloured band on the same crystal — that is a palette, not a weapon');
    assert(seen.jedi.c < seen.none.c && seen.sith.c > seen.none.c,
      'the Jedi blade is meant to be tighter than the untuned one and the Sith wider; they are not');
    assert(seen.greyCalm.c < seen.jedi.c && seen.greyFury.c > seen.sith.c,
      'the Grey blade is meant to travel past both of them and does not');
    return `${rows.length} order/crystal/width blades, white 3.5–42 mm and ≥4x coloured; `
      + `coloured band on one crystal: grey-calm ${seen.greyCalm.c | 0} < jedi ${seen.jedi.c | 0} < `
      + `none ${seen.none.c | 0} < sith ${seen.sith.c | 0} < grey-fury ${seen.greyFury.c | 0} mm `
      + `(${(Math.max(...widths) / Math.min(...widths)).toFixed(2)}x), peak radiance `
      + `${seen.greyCalm.pk.toFixed(1)}…${seen.greyFury.pk.toFixed(1)}`;
  });

  check('order: the core stays the lobe worth neutralising, for every order', () => {
    /* CORE_WHITE only earns its place because the core carries most of the
     * blade's flux — tools/checks/saber-light.mjs asserts that on PROFILE, which
     * is now only the UNTUNED blade. Each order re-weights the three lobes, so
     * the same argument has to be re-made per order or the most expensive fix in
     * this file quietly stops being aimed at anything.
     *
     * The line integral of a gaussian is amp x sigma, so that is the weighting,
     * and it is the same arithmetic saber-light.mjs uses. */
    const rows = [];
    for (const id of [null, ...ORDER_IDS]) {
      for (const temper of (id === 'grey' ? [0, 1] : [0])) {
        const s = blade({ colorIndex: 0, order: id });
        if (temper) { s.temper = 1; s._retune(); }
        const u = s.bladeMat.uniforms;
        const flux = [u.uAmp.value.x * u.uWidth.value.x, u.uAmp.value.y * u.uWidth.value.y,
          u.uAmp.value.z * u.uWidth.value.z];
        const share = flux[0] / flux.reduce((a, b) => a + b, 0);
        assert(share > 0.5,
          `${id}${temper ? '/fury' : ''}: the core is only ${(share * 100).toFixed(0)}% of the blade's `
          + 'flux, so CORE_WHITE is aimed at the wrong lobe on this order');
        // and the glow lobe must stay over the bloom threshold, or the halo has
        // no colour left once the core has gone neutral
        assert(u.uAmp.value.y > 1.8 * 1.5,
          `${id}${temper ? '/fury' : ''}: the glow lobe fell to ${u.uAmp.value.y.toFixed(2)}, which is not `
          + 'clear of the 1.8 bloom threshold — the bloom would be entirely white');
        rows.push(`${id ?? 'none'}${temper ? '/fury' : ''} ${(share * 100).toFixed(0)}%`);
        s.dispose();
      }
    }
    return `core share of blade flux: ${rows.join(', ')} (all > 50%)`;
  });

  check('order: no order hands the bloom pass a channel filter', () => {
    /* saber-light.mjs bounds the SMEAR's bloom veil at 1/FLOOR_CHANNEL — a wash
     * laid across a quarter of the screen is a light, and a light whose dimmest
     * channel is under a sixth of its brightest deletes a primary from
     * everything it touches rather than tinting it. That bound was established
     * on the untuned blade. Three orders now move both trail amplitudes AND
     * uCoreWhite, so it has to be re-made for each of them and for each of their
     * crystals — the Sith's rack is the reddest in the game, which is exactly
     * the case the bound exists for.
     *
     * Same model as saber-light's trailAt, driven by the order's own uniforms. */
    const BOUND = 1 / Saber.FLOOR_CHANNEL;
    const SHEET = Math.exp(-1.3) * 2 + 1;
    const L709 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const bad = [], rows = [];
    for (const o of ORDERS) {
      for (const idx of o.crystals) {
        for (const temper of (o.id === 'grey' ? [0, 1] : [0])) {
          const s = blade({ colorIndex: idx, coreWidth: 0.7, order: o.id });
          if (temper) { s.temper = 1; s._retune(); }
          // drive one frame so uHot/uGlow are the ones the shader reads
          swing(s, 14, 4);
          const t = s.trailMat.uniforms;
          const hue = [t.uHue.value.r, t.uHue.value.g, t.uHue.value.b];
          const hueN = L709(hue);
          const sum = [0, 0, 0];
          let w = 0;
          for (let a = 0; a <= 1.0001; a += 0.002) {
            const fade = Math.pow(Math.max(0, 1 - a), 1.5);
            const hot = Math.pow(Math.max(0, Math.min(1, 1 - a * 2.6)), 2);
            const ec = t.uHot.value * hot, e0 = t.uGlow.value * fade + ec;
            const k = t.uCoreWhite.value * (ec / Math.max(e0, 1e-5));
            const col = hue.map((v) => v + (hueN - v) * k);
            if (e0 * SHEET * L709(col) <= 1.8) continue;
            w += e0;
            for (let c = 0; c < 3; c++) sum[c] += col[c] * e0;
          }
          const m = w ? sum.map((v) => v / w) : [1, 1, 1];
          const r = Math.max(...m) / Math.max(Math.min(...m), 1e-9);
          const label = `${o.id}/${SABER_COLORS[idx].name}${temper ? '/fury' : ''}`;
          if (r > BOUND) bad.push(`${label} ${r.toFixed(2)}:1`);
          rows.push([label, r]);
          s.dispose();
        }
      }
    }
    assert(!bad.length,
      `these order blades smear a channel filter across the screen: ${bad.join(', ')} `
      + `(bound ${BOUND.toFixed(2)}:1, the same FLOOR_CHANNEL the thrown light is held to)`);
    const worst = rows.reduce((a, b) => (a[1] > b[1] ? a : b));
    return `${rows.length} order/crystal/temper smears, worst ${worst[0]} at ${worst[1].toFixed(2)}:1 `
      + `against a ${BOUND.toFixed(2)}:1 bound`;
  });

  check('order: the hilt is machined by the order, and re-machined when it changes', () => {
    // Four materials and two finishes were hard-coded in _buildHilt. A weapon
    // whose blade changed and whose steel did not would be the same half-wired
    // feature this file is about — and the forge preview flips orders on a live
    // Saber, so it has to land without a rebuild.
    const seen = new Map();
    for (const id of [null, ...ORDER_IDS]) {
      const s = blade({ colorIndex: 0, order: id });
      const key = ['steel', 'dark', 'black', 'gold']
        .map((k) => s.hiltMetals[k].color.getHexString()).join('/')
        + `|${s.hiltMetals.steel.roughness}|${s.hiltMetals.gold.roughness}`;
      assert(!seen.has(key), `${id ?? 'none'} and ${seen.get(key)} are machined out of the same metal`);
      seen.set(key, id ?? 'none');
      s.dispose();
    }
    // live switch, which is the forge preview's path
    const s = blade({ colorIndex: 0 });
    const before = s.hiltMetals.gold.color.getHex();
    const beforeAmp = s.bladeMat.uniforms.uAmp.value.x;
    s.order = 'sith';
    assert(s.hiltMetals.gold.color.getHex() !== before, 'setting the order did not re-machine the hilt');
    assert(s.bladeMat.uniforms.uAmp.value.x !== beforeAmp, 'setting the order did not re-tune the blade');
    s.order = null;
    assert(s.hiltMetals.gold.color.getHex() === before, 'putting the order back did not put the metal back');
    near(s.bladeMat.uniforms.uAmp.value.x, beforeAmp, 0, 'putting the order back did not put the blade back');
    // an id from an older settings blob must not stop the game booting
    s.order = 'nightsister';
    assert(s.order === null, 'an unknown order id was accepted');
    s.dispose();
    return `${seen.size} distinct hilts (${[...seen.values()].join('/')}), live switch lands and reverts`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §4. THE TEMPER IS DRIVEN BY THE HAND                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: the Grey blade\'s temper answers the wrist, and only the wrist', () => {
    /* The Grey's whole mechanic is a state, so the state needs a driver that is
     * the player and not the clock. It is swingSpeed — measured against the body
     * that carries the blade, which is the same quantity _trailPunch reads and
     * for the same reason: a sprinting player moves the tip at 7 m/s with the
     * wrist perfectly still, and a temper that read WORLD speed could be raised
     * by jogging in a straight line. That is the failure mode this clause is
     * for, and it is tested directly. */
    const s = blade({ colorIndex: 5, order: 'grey' });
    assert(s.tempered, 'the Grey blade is not a tempered one');
    assert(s.temper === 0, `it starts at temper ${s.temper}`);

    // 1. hard swinging raises it
    swing(s, 20, 120);
    const hot = s.temper;
    assert(hot > 0.85, `two seconds of 20 m/s swinging only reached temper ${hot.toFixed(3)}`);

    // 2. stillness puts it down, slower than it came up
    const q = new THREE.Quaternion(), pos = new THREE.Vector3(0, 1.1, 0);
    for (let k = 0; k < 120; k++) { s.setHiltPose(pos, q); s.update(1 / 60, k / 60, null); }
    const cooled = s.temper;
    assert(cooled < hot * 0.6, `two seconds of stillness only took it from ${hot.toFixed(3)} to ${cooled.toFixed(3)}`);
    assert(cooled > 0.05, 'the temper collapses the instant you stop, which is not a temper');

    // 3. SPRINTING WITH A STILL WRIST MUST NOT RAISE IT
    const jog = blade({ colorIndex: 5, order: 'grey' });
    const carrier = new THREE.Vector3(0, 0, -8.5);      // faster than a sprint
    const p = new THREE.Vector3(0, 1.1, 0);
    for (let k = 0; k < 180; k++) {
      p.addScaledVector(carrier, 1 / 60);
      jog.setHiltPose(p, q);
      jog.update(1 / 60, k / 60, carrier);
    }
    assert(jog.temper < 1e-3,
      `three seconds of sprinting with a motionless wrist raised the temper to ${jog.temper.toFixed(4)} — `
      + 'the Grey can heat their blade by running away');
    assert(jog.tipSpeed > 6,
      `the sprint probe only moved the tip at ${jog.tipSpeed.toFixed(1)} m/s, so it never tested anything`);

    // 4. and the temper reaches the drawn uniforms, which is the whole point
    const cold = blade({ colorIndex: 5, order: 'grey' });
    const hotS = blade({ colorIndex: 5, order: 'grey' });
    swing(hotS, 22, 200);
    const moved = ['uAmp', 'uWidth'].map((k) =>
      hotS.bladeMat.uniforms[k].value.toArray().map((v, i) => v / cold.bladeMat.uniforms[k].value.toArray()[i]));
    assert(hotS.bladeMat.uniforms.uUnstable.value / cold.bladeMat.uniforms.uUnstable.value > 5,
      'a furious Grey blade is no less stable than a composed one at the uniform the shader reads');
    assert(moved[0][2] / 1 > 1.6, `the halo lobe only went ${moved[0][2].toFixed(2)}x between calm and fury`);

    const rise = temperTime(0, 0.9, 20), fall = temperTime(0.9, 0.3, 0);
    assert(fall > rise * 1.5,
      `fury takes ${rise.toFixed(2)}s to raise and ${fall.toFixed(2)}s to put down — it is not hard to let go of`);
    s.dispose(); jog.dispose(); cold.dispose(); hotS.dispose();
    return `0 → ${hot.toFixed(2)} in 2 s of 20 m/s swinging, back to ${cooled.toFixed(2)} in 2 s still; `
      + `rise ${rise.toFixed(2)}s / fall ${fall.toFixed(2)}s (TEMPER ${TEMPER.floor}–${TEMPER.floor + TEMPER.span} m/s); `
      + `a 8.5 m/s sprint with a still wrist moves it ${jog.temper.toExponential(1)}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §5. THE NUMBERS REACH THE PLAYER                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: it changes what the player is worth, and every field has a reader', async () => {
    /* The boonMods half, held to exactly the standard tools/checks/controls.mjs
     * holds a boon card to: a field an order writes that nothing outside
     * Order.js reads is a promise the code never keeps.
     *
     * Two directions. Every key an order touches must appear in a reader
     * elsewhere; and every order must actually move the player, in more than one
     * place, or it is a name. */
    const elsewhere = [
      await readFile(src('game/Player.js'), 'utf8'),
      await readFile(src('game/World.js'), 'utf8'),
      await readFile(src('game/Duel.js'), 'utf8'),
      await readFile(src('game/Combat.js'), 'utf8'),
      await readFile(src('ui/HUD.js'), 'utf8'),
    ].join('\n');
    const unread = [], inert = [], rows = [];
    for (const o of ORDERS) {
      const p = subject(o.id);
      const before = subject(null);
      const touched = [];
      for (const k of Object.keys(p.boonMods)) {
        if (p.boonMods[k] !== before.boonMods[k]) touched.push(k);
      }
      for (const k of ['maxHp', 'maxForce', 'maxStamina']) if (p[k] !== before[k]) touched.push(k);
      if (touched.length < 2) inert.push(`${o.id} (${touched.length} fields)`);
      for (const k of touched) {
        // boonMods keys are read as boonMods.<k>; stats as this.<k> / p.<k>
        const re = ['maxHp', 'maxForce', 'maxStamina'].includes(k)
          ? new RegExp(`\\.${k}\\b`) : new RegExp(`boonMods\\??\\.${k}\\b`);
        if (!re.test(elsewhere)) unread.push(`${o.id} → ${k}`);
      }
      rows.push(`${o.id}: ${touched.join(', ')}`);
      p.saber.dispose(); before.saber.dispose();
    }
    assert(!inert.length, `orders that barely change the player: ${inert.join(', ')}`);
    assert(!unread.length,
      `fields an order writes that nothing outside Order.js reads: ${unread.join(', ')} — the blurb `
      + 'promises what the code never does');

    /* THE POOLS MOVE WITH THEIR MAXIMA, or a Sith spawns on 100 of 78.
     *
     * DERIVED FROM THE ORDER'S OWN TABLE. These were the literals `78` and
     * `125`, and they are exactly the copied-answer-key shape this suite exists
     * to catch: the Sith's `maxHp` add moved from -22 to -20 so that "you start
     * with a fifth less to lose" in its own blurb is a fifth, and this check
     * went red for a change that made the game more honest, quoting a number no
     * longer in Order.js. The PROPERTY is that the pool follows the maximum and
     * the maximum is whatever `mods.add` says; both now come from the table. */
    const sith = subject('sith'), jedi = subject('jedi');
    const stock = subject(null);
    const wantHp = stock.maxHp + (getOrder('sith').mods.add?.maxHp ?? 0);
    const wantForce = stock.maxForce + (getOrder('jedi').mods.add?.maxForce ?? 0);
    stock.saber.dispose();
    assert(sith.maxHp === wantHp && sith.hp === wantHp,
      `a Sith spawns on ${sith.hp} of ${sith.maxHp}, and its order table says ${wantHp}`);
    assert(jedi.maxForce === wantForce && jedi.force === wantForce,
      `a Jedi spawns on ${jedi.force} of ${jedi.maxForce}, and its order table says ${wantForce}`);
    // once, at spawn: a second order is refused rather than compounded
    let threw = false;
    try { applyOrder(sith, 'jedi'); } catch { threw = true; }
    assert(threw, 'a player was allowed to join a second order and take both sets of numbers');
    assert(applyOrder(sith, 'sith') === sith.orderRecord, 're-applying the same order was not a no-op');
    assert(sith.boonMods.cutPower === 1.40, `re-applying compounded cutPower to ${sith.boonMods.cutPower}`);
    // the draft must not offer a card the order already gave
    assert(sith.orderRecord.grants.includes('lightning') && sith.boonMods.lightning === true,
      'the Sith is granted lightning but does not report it, so the draft will offer it again');
    assert(BOONS.some((b) => b.id === 'lightning'),
      'the lightning boon is gone, so the Sith grant has nothing to suppress');
    sith.saber.dispose(); jedi.saber.dispose();
    return rows.join(' | ');
  });

  check('order: no order is strictly better than another', () => {
    /* An order that wins on every axis is a difficulty setting with a costume.
     * The axes here are the ones every order actually moves, normalised so that
     * bigger is better in all of them, and the claim is pairwise: for each pair,
     * each one has to beat the other somewhere. */
    const axes = (p) => ({
      cut: p.boonMods.cutPower,
      guard: p.boonMods.returnCone,
      cheapForce: 1 / p.boonMods.forceCost,
      stamina: p.boonMods.staminaRegen,
      vitality: p.maxHp,
      reserve: p.maxForce,
      sustain: p.boonMods.lifesteal + p.boonMods.healOnKill,
      flow: p.boonMods.flowGain,
      returned: p.boonMods.deflectDamage,
    });
    const S = {};
    for (const id of ORDER_IDS) { const p = subject(id); S[id] = axes(p); p.saber.dispose(); }
    const beats = (a, b) => Object.keys(S[a]).filter((k) => S[a][k] > S[b][k] + 1e-9);
    const rows = [];
    for (const a of ORDER_IDS) {
      for (const b of ORDER_IDS) {
        if (a >= b) continue;
        const ab = beats(a, b), ba = beats(b, a);
        assert(ab.length && ba.length,
          `${a} vs ${b}: ${a} wins ${ab.length} axes and ${b} wins ${ba.length} — one of them is `
          + 'strictly better, which makes the choice a difficulty setting');
        rows.push(`${a}>${b} in ${ab.length}, ${b}>${a} in ${ba.length}`);
      }
    }
    return rows.join('; ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §6. THE GREY IS A THIRD THING                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: the Grey\'s numbers are live, and a boon still composes with them', () => {
    /* The mechanism, not the design. The Grey's two live factors are installed
     * as an accessor pair on boonMods so that every reader that already existed
     * — the blade solver's `power`, gradeCaught's `returnCone` — picks them up
     * with no line added to World, Player, Duel or Combat. That is only honest
     * if two things hold:
     *
     *   the value actually MOVES with the blade, on the field the reader reads;
     *   `p.boonMods.cutPower *= 1.55` still means what it says, because the boon
     *   table does exactly that and a getter that ignored its setter would eat
     *   the card silently.
     *
     * The second is the one worth the machinery: the getter multiplies by the
     * live factor and the setter divides the same factor back out, so a card
     * taken while furious is worth precisely what it is worth while composed. */
    const p = subject('grey', { colorIndex: 5 });
    const calm = { cut: p.boonMods.cutPower, cone: p.boonMods.returnCone };
    swing(p.saber, 22, 200);
    assert(p.saber.temper > 0.9, `the probe only reached temper ${p.saber.temper.toFixed(3)}`);
    const fury = { cut: p.boonMods.cutPower, cone: p.boonMods.returnCone };
    assert(fury.cut / calm.cut > 1.8,
      `cutPower only moved ${(fury.cut / calm.cut).toFixed(2)}x across the whole temper range`);
    assert(calm.cone / fury.cone > 2.5,
      `the guard cone only moved ${(calm.cone / fury.cone).toFixed(2)}x across the whole temper range`);
    // it is a property, not a snapshot: it has to track the blade continuously
    p.saber.temper = 0.5; p.saber._retune();
    const mid = p.boonMods.cutPower;
    assert(mid > calm.cut && mid < fury.cut, `at half temper cutPower is ${mid}, outside its own range`);

    // a boon composes, at any temper, and lands on the base rather than the view
    for (const t of [0, 0.37, 1]) {
      const q = subject('grey', { colorIndex: 5 });
      q.saber.temper = t; q.saber._retune();
      const was = q.boonMods.cutPower;
      BOONS.find((b) => b.id === 'shatterpoint').apply(q);        // cutPower *= 1.9
      near(q.boonMods.cutPower / was, 1.9, 1e-12,
        `at temper ${t} taking Shatterpoint moved cutPower ${(q.boonMods.cutPower / was).toFixed(4)}x`);
      // and the card is worth the same at every temper, which is what the
      // setter's division buys: read it again at a DIFFERENT temper.
      q.saber.temper = 1 - t; q.saber._retune();
      const other = subject('grey', { colorIndex: 5 });
      other.saber.temper = 1 - t; other.saber._retune();
      near(q.boonMods.cutPower / other.boonMods.cutPower, 1.9, 1e-12,
        `a Shatterpoint taken at temper ${t} is worth `
        + `${(q.boonMods.cutPower / other.boonMods.cutPower).toFixed(3)}x once the temper moves`);
      q.saber.dispose(); other.saber.dispose();
    }
    // enumerable, or controls.mjs's boon diff cannot see the field at all
    assert(Object.keys(p.boonMods).includes('cutPower') && Object.keys(p.boonMods).includes('returnCone'),
      'the live fields dropped out of Object.keys(boonMods)');
    p.saber.dispose();
    return `cutPower ${calm.cut.toFixed(2)} → ${fury.cut.toFixed(2)}, guard cone `
      + `${calm.cone.toFixed(3)} → ${fury.cone.toFixed(3)}; a 1.9x card is 1.9x at every temper`;
  });

  check('order: the Grey is outside the line the other two span, at both ends', () => {
    /* THE CLAIM THAT WOULD BE EASIEST TO FAKE. "A third path" is what a slider
     * midpoint is always called, and a midpoint is what you get for free.
     *
     * The two axes the Grey moves are the two the other orders also move, so
     * they can be compared directly. What has to be true, or the Grey is a
     * blend: at rest it must out-guard a Jedi (and cut worse than one), and at
     * full temper it must out-cut a Sith (and guard worse than one). Both ends
     * strictly outside the segment, not inside it. */
    const j = subject('jedi'), s = subject('sith'), g = subject('grey', { colorIndex: 5 });
    const calm = { cut: g.boonMods.cutPower, cone: g.boonMods.returnCone };
    g.saber.temper = 1; g.saber._retune();
    const fury = { cut: g.boonMods.cutPower, cone: g.boonMods.returnCone };

    assert(calm.cone > j.boonMods.returnCone,
      `composed, the Grey's guard cone is ${calm.cone.toFixed(3)} against a Jedi's `
      + `${j.boonMods.returnCone} — that is inside the Jedi, not past them`);
    assert(calm.cut < j.boonMods.cutPower,
      `composed, the Grey cuts at ${calm.cut} against a Jedi's ${j.boonMods.cutPower} — no cost`);
    assert(fury.cut > s.boonMods.cutPower,
      `furious, the Grey cuts at ${fury.cut.toFixed(2)} against a Sith's ${s.boonMods.cutPower} — `
      + 'that is inside the Sith, not past them');
    assert(fury.cone < s.boonMods.returnCone,
      `furious, the Grey's guard is ${fury.cone.toFixed(3)} against a Sith's ${s.boonMods.returnCone} — no cost`);

    // and the two axes must move in OPPOSITE directions, or it is one slider
    // with two labels on it.
    assert((fury.cut - calm.cut) * (fury.cone - calm.cone) < 0,
      'the Grey\'s two live numbers move the same way, so the temper is a straight upgrade');

    // the readout the HUD needs, and that it says something different at each end
    g.saber.temper = 0; g.saber._retune();
    const a = orderReadout(g);
    g.saber.temper = 1; g.saber._retune();
    const b = orderReadout(g);
    assert(a.temper && b.temper && a.temper !== b.temper,
      `the readout says "${a.temper}" composed and "${b.temper}" furious`);
    assert(orderReadout(j).temper === null && orderReadout(s).temper === null,
      'a Jedi or a Sith reports a temper, and neither of them has one');
    j.saber.dispose(); s.saber.dispose(); g.saber.dispose();
    return `cut: grey ${calm.cut} < jedi ${j.boonMods.cutPower} … sith ${s.boonMods.cutPower} < grey `
      + `${fury.cut.toFixed(2)}; guard: grey ${fury.cone.toFixed(3)} < sith ${s.boonMods.returnCone} … `
      + `jedi ${j.boonMods.returnCone} < grey ${calm.cone.toFixed(3)}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  §7. THE ROSTER IS BUILDABLE, AND ITS DATA POINTS AT REAL THINGS   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('order: every crystal, hilt and robe an order names actually exists', () => {
    /* An index is a promise about another file's array. The last time this
     * project shipped a table of indices into somebody else's list, the list
     * moved. So each one is pinned to the NAME it is meant to be — inserting a
     * crystal into SABER_COLORS then fails here loudly instead of quietly
     * handing the Sith a green blade. */
    const NAMES = {
      jedi: ['Cerulean', 'Verdant', 'Amethyst', 'Sunfire', 'Cyanite',
             'Gold', 'Jade', 'Azure', 'Indigo'],
      sith: ['Crimson', 'Bronze', 'Rose', 'Void'],
      grey: ['Ivory', 'Rose', 'Bronze', 'Orchid'],
    };
    const ROBES = { jedi: ['Sand', 'Ivory', 'Ochre', 'Umber'], sith: ['Night', 'Ash'], grey: ['Ash', 'Umber', 'Night'] };
    for (const o of ORDERS) {
      assert(o.crystals.length >= 3, `${o.id} offers only ${o.crystals.length} crystals`);
      o.crystals.forEach((i, k) => {
        assert(SABER_COLORS[i], `${o.id} crystal ${i} is off the end of SABER_COLORS`);
        assert(SABER_COLORS[i].name === NAMES[o.id][k],
          `${o.id} crystal ${k} is index ${i}, which is ${SABER_COLORS[i].name} and not ${NAMES[o.id][k]}`);
      });
      o.robes.forEach((i, k) => {
        assert(ROBE_COLORS[i], `${o.id} robe ${i} is off the end of ROBE_COLORS`);
        assert(ROBE_COLORS[i].name === ROBES[o.id][k],
          `${o.id} robe ${k} is index ${i}, which is ${ROBE_COLORS[i].name} and not ${ROBES[o.id][k]}`);
      });
      for (const h of o.hilts) assert(HILT_STYLES.includes(h), `${o.id} builds a '${h}', which is not a hilt`);
      assert(o.crystals.includes(o.crystalDefault), `${o.id}'s default crystal is not in its own rack`);
      assert(o.robes.includes(o.robeDefault), `${o.id}'s default robe is not in its own list`);
      assert(o.hilts.includes(o.hiltDefault), `${o.id}'s default hilt is not one it builds`);
      assert(o.blurb.length > 80 && o.doctrine, `${o.id} has no blurb worth reading`);
      assert(BLADE_TUNING[o.id], `${o.id} has no blade tuning`);
    }
    return ORDERS.map((o) => `${o.name} ${o.crystals.length}c/${o.hilts.length}h/${o.robes.length}r`).join(', ');
  });

  check('order: the crystal sets are a rule, not a mood — and Ivory is the Grey\'s alone', () => {
    /* The sets say something about where a crystal came from, and the something
     * has to be true of the data:
     *
     *   every crystal belongs to someone — no orphans, so an order-less player
     *     still sees the whole rack and no colour is lost by adding orders;
     *   the Sith's rack is ENTIRELY the bled family — which is exactly the flag
     *     Saber.isDark already computes, so the two definitions are pinned to
     *     each other rather than drifting;
     *   the Grey has no blue and no green, because they never went to a temple;
     *   Ivory — a fully purified crystal — is reachable by exactly one order. */
    const union = new Set(ORDERS.flatMap((o) => o.crystals));
    assert(union.size === SABER_COLORS.length,
      `${SABER_COLORS.length - union.size} crystals belong to no order at all`);
    const ivory = SABER_COLORS.findIndex((c) => c.key === 'white');
    const owners = ORDERS.filter((o) => o.crystals.includes(ivory)).map((o) => o.id);
    assert(owners.length === 1 && owners[0] === 'grey',
      `the purified crystal is reachable by ${owners.join('/') || 'nobody'}, and it is the Grey's alone`);
    const grey = getOrder('grey');
    for (const key of ['blue', 'green']) {
      const i = SABER_COLORS.findIndex((c) => c.key === key);
      assert(!grey.crystals.includes(i), `the Grey can reach ${SABER_COLORS[i].name}, and they never went to a temple`);
    }
    /* The bled family, read off the crystal table.
     *
     * This used to build a Saber per crystal and read `s.isDark` back — a field
     * the constructor computed, wrote twice, and which no line of game code
     * ever read. A classification with no reader is a second source of truth
     * waiting to disagree with the first, and the project's own standard for a
     * setting nothing reads is that it is a bug. `dark` is a field on the
     * crystal now and this reads it where it lives. */
    const bled = SABER_COLORS.map((c) => !!c.dark);
    const sith = getOrder('sith');
    for (const i of sith.crystals) {
      const cls = SABER_COLORS[i];
      assert(bled[i] || ['orange', 'rose'].includes(cls.key),
        `${cls.name} is on the Sith rack and is not a bled crystal by any definition here`);
    }
    for (let i = 0; i < bled.length; i++) {
      if (!bled[i]) continue;
      assert(sith.crystals.includes(i),
        `${SABER_COLORS[i].name} is flagged isDark and no Sith can carry it`);
      assert(!getOrder('jedi').crystals.includes(i),
        `a Jedi can carry ${SABER_COLORS[i].name}, which Saber itself flags as a dark crystal`);
    }
    return `${union.size}/${SABER_COLORS.length} crystals placed; Ivory to the Grey alone; `
      + `every isDark crystal on the Sith rack and none on the Jedi's`;
  });

  check('order: the menu can build every control it needs from this file', () => {
    /* The UI is another lane's, so what this lane owes it is a shape that cannot
     * silently mislead. The trap that matters: Menu._swatchRow writes the
     * POSITION in the array it was handed into the setting, and for a filtered
     * rack the position is not the SABER_COLORS index. crystalAt is the mapping,
     * and it exists so nobody has to notice. */
    for (const id of [null, ...ORDER_IDS]) {
      const pal = crystalPalette(id);
      assert(pal.length, `${id} has an empty rack`);
      pal.forEach((c, slot) => {
        assert(SABER_COLORS[c.index].name === c.name, `${id} slot ${slot} carries the wrong index`);
        assert(crystalAt(id, slot) === c.index, `${id} slot ${slot}: crystalAt disagrees with the palette`);
      });
      const hs = hiltsForOrder(id);
      assert(hs.length >= 3, `${id} offers only ${hs.length} hilts`);
    }
    assert(crystalPalette(null).length === SABER_COLORS.length,
      'with no order the rack is not the whole rack');
    // an out-of-rack crystal is moved into it rather than left dangling, and it
    // keeps the closest hue rather than snapping to the default
    const verdant = SABER_COLORS.findIndex((c) => c.key === 'green');
    const moved = crystalForOrder('sith', verdant);
    assert(getOrder('sith').crystals.includes(moved),
      `a green blade carried into the Sith stayed at index ${moved}, which is not on their rack`);
    const crimson = SABER_COLORS.findIndex((c) => c.key === 'red');
    assert(crystalForOrder('sith', crimson) === crimson, 'a crystal already on the rack was moved anyway');
    assert(crystalForOrder(null, verdant) === verdant, 'with no order the crystal was moved anyway');
    // Rose is the nearest hue to Amethyst on the Sith rack; the point is that it
    // is a hue match and not a fallback to Crimson.
    const amethyst = SABER_COLORS.findIndex((c) => c.key === 'purple');
    const near2 = crystalForOrder('sith', amethyst);
    assert(near2 !== getOrder('sith').crystalDefault || amethyst === near2,
      `a purple blade taken to the Sith fell back to the default (${SABER_COLORS[near2].name}) `
      + 'rather than finding the nearest hue');
    return `racks ${ORDER_IDS.map((i) => `${i} ${crystalPalette(i).length}`).join('/')}; `
      + `green → ${SABER_COLORS[moved].name} and purple → ${SABER_COLORS[near2].name} on the Sith rack`;
  });
}
