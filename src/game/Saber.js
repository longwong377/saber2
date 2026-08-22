/**
 * BATTLEFRONT BORZ — the weapon.
 *
 * A hilt pose in, a swept blade volume out. Everything downstream — deflection,
 * cutting, the arm IK, the hum — reads from the sweep this produces, so the
 * blade is the single source of truth about where the weapon has been this
 * frame and how fast each point along it was moving when it got there.
 */

import * as THREE from 'three';
import { clamp, lerp } from '../engine/MathUtil.js';
import { ground } from '../world/Scenery.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * THE RACK.
 *
 * APPENDED TO, NEVER INSERTED INTO. `colorIndex` is an index — it is what the
 * menu stores in a saved profile, what Order.js's crystal sets are written in,
 * and what World hands the Player — so putting a new crystal in the middle
 * would silently change the colour of every saved character and every order's
 * rack at once. New crystals go on the end. tools/checks/order.mjs pins each
 * index to the name it is meant to be, so an insertion fails loudly.
 *
 * `dark` is the bled family, and it is a FIELD rather than a rule about keys.
 * It used to be `key === 'red' || key === 'black'` written out twice inside
 * Saber, which is a classification living in an expression: nothing could
 * declare a new bled crystal without editing two lines of the constructor, and
 * the two lines could disagree with each other.
 *
 * WHERE THE FIVE NEW ONES CAME FROM, because "more colours" is not a licence
 * to fill the wheel evenly. Every one of them is a gap in the hue circle the
 * ten had left open — the shipped rack ran 0° 25° 38° then jumped to 148°,
 * which is a hundred and ten degrees of yellow and green with nothing in it —
 * and every one was MEASURED against the two bounds that actually constrain a
 * crystal before it was chosen. See tools/checks/saber-bloom.mjs: the halo has
 * to survive 120 mm from the axis and clear 5:1 against the white core, and
 * both bounds are minima over the whole rack, so a new crystal can only ever
 * lower them.
 *
 * That is a real constraint and it threw a candidate out. A deep indigo
 * (0x4a2cff) measures 76 mm — blue carries 7% of luminance, so a blue-dominant
 * emission falls under the visibility gate close to the axis and its coloured
 * halo is tight. The shipped Void sits at 121 mm for the same reason and is
 * the tightest thing on the rack. The indigo here is lifted to 0x8878ff, which
 * measures 129 mm: it is a paler violet than the one I wanted, and it is the
 * one the blade can actually draw.
 *
 *     Gold     182 mm  15.4:1  core 11.8 mm     Jade    183 mm  13.7:1  13.4 mm
 *     Azure    164 mm  11.1:1       14.8 mm     Indigo  129 mm   9.5:1  13.6 mm
 *     Orchid   142 mm  13.0:1       11.0 mm
 *
 * THE THIRD BOUND THREW OUT A SECOND CANDIDATE, and it is the one I had not
 * measured. `blade: the white core is a core, not a bar` caps the widest white
 * core in the game at 24 mm, and a PALE crystal blows it: the tone curve
 * desaturates a wide band around a low-chroma emitter, so a cold near-white
 * "Frost" measured 28.8 mm untuned and 38.4 mm under an order's tuning — the
 * exact "fat white bar" the player reported and this bound exists to stop.
 * Ivory only survives because its chroma is under 0.15 and the measurement
 * skips it entirely, and nothing paler than Ivory is far enough from Ivory to
 * be worth a slot. So the rack has no second white on it, and the fifth
 * crystal is a saturated Azure instead.
 */
export const SABER_COLORS = [
  { name: 'Cerulean',  hex: 0x3ba7ff, glow: 0x8fd8ff, key: 'blue' },
  { name: 'Verdant',   hex: 0x37f07a, glow: 0xa6ffc8, key: 'green' },
  { name: 'Amethyst',  hex: 0xa459ff, glow: 0xd7b0ff, key: 'purple' },
  { name: 'Sunfire',   hex: 0xffb02e, glow: 0xffe0a0, key: 'amber' },
  { name: 'Crimson',   hex: 0xff2d2d, glow: 0xff9a90, key: 'red', dark: true },
  { name: 'Ivory',     hex: 0xf2f6ff, glow: 0xffffff, key: 'white' },
  { name: 'Bronze',    hex: 0xff7a1a, glow: 0xffc888, key: 'orange' },
  { name: 'Cyanite',   hex: 0x21f0e0, glow: 0xa8fff8, key: 'cyan' },
  { name: 'Rose',      hex: 0xff5fae, glow: 0xffc0e0, key: 'rose' },
  { name: 'Void',      hex: 0x241a3a, glow: 0x7a4fd0, key: 'black', dark: true },
  // ── the five, in the five gaps ──────────────────────────────────────
  // 53°, between Sunfire's amber and the green side. The Temple Guard yellow.
  { name: 'Gold',      hex: 0xffe019, glow: 0xfff5a8, key: 'gold' },
  // 90°. The yellow-green nothing on the rack reached.
  { name: 'Jade',      hex: 0x8ef03a, glow: 0xd6ffa8, key: 'jade' },
  // 192°, in the 30° between Cyanite's turquoise and Cerulean's sky.
  { name: 'Azure',     hex: 0x14c8ff, glow: 0xa0e6ff, key: 'azure' },
  // 248°, in the gap between Cerulean and Amethyst. See the note above for
  // why it is this pale and not the deep indigo it wants to be.
  { name: 'Indigo',    hex: 0x8878ff, glow: 0xd0c8ff, key: 'indigo' },
  // 296°, between Amethyst and Rose.
  { name: 'Orchid',    hex: 0xf03cff, glow: 0xffb0f8, key: 'orchid' },
];

/**
 * THE HILTS, AS SPECIFICATIONS RATHER THAN AS THREE `if`s ON ONE BODY.
 *
 * What was here: one shared hilt — the same shroud, the same three neck rings,
 * the same body, the same seven grip rings, the same control box, the same
 * pommel — with three small additions bolted on at the end, one each for
 * Crossguard, Consular and Sentinel. So of five named hilts, GRAFLEX AND
 * GUARDIAN WERE BYTE-IDENTICAL, and the other three were that same weapon plus
 * a part. The player's note is "more hilt options, in more detail", and the
 * honest reading of it is that there were really only four, one of which was a
 * cone stuck on the end.
 *
 * Everything a hilt is is now data, and `_buildHilt` is a loop. That is what
 * makes ten of them affordable: adding one is a row, not a branch, and the
 * check that measures them (tools/checks/hilts.mjs) reads the same table
 * rather than a list of names someone kept in step by hand.
 *
 * THE FIELDS. Lengths in metres, radii as multiples of the hilt's own R so a
 * spec reads as proportions:
 *
 *   len       overall, emitter face to pommel end. 0.24 is the shipped hilt.
 *   r         the body radius. Everything else is a multiple of it.
 *   shroud    [topR, botR, len] of the emitter shroud
 *   rings     [count, spacing, radius, thickness] at the neck, or null
 *   grip      { len, r, kind } — 'ribbed' | 'wrapped' | 'fluted' | 'plain'
 *   box       [w, h, d] of the control box, or null for a clean body
 *   studs     how many activator studs, 0-3
 *   pommel    'cap' | 'ring' | 'spike' | 'sphere' | 'none'
 *   extras    any of 'crossguard' | 'sleeve' | 'claw' | 'window' | 'hook' |
 *             'wings' | 'collar' | 'knurl'
 *   metal     which of the four materials the BODY takes, so a hilt can be
 *             black-and-gold rather than steel-and-gold without a new material
 *
 * WHAT MAY NOT MOVE. `GRIP_AT` in Player.js puts the right hand at +0.050 and
 * the left at -0.015 along the hilt's axis, so every spec's grip section has to
 * span that range or the hands close on air; `emitterY` is where the blade
 * starts and therefore part of the weapon's reach, so it is held at 0.155 for
 * the five that shipped and only the new ones are free to differ — and even
 * they stay inside ±15 mm of it, because a hilt that emits 4 cm further out is
 * a longer sword wearing a hilt's name.
 */
/**
 * WHERE THE METAL STOPS, off the geometry rather than off the spec.
 *
 * A hilt's own extent is what says whether a hand closes on it, and the ten
 * hilts do not agree about it: the Graflex bottoms out 85 mm below the origin
 * and the Shoto 54 mm, because a pommel, a control box and a belt hook all
 * reach past whatever `len` says. So this is measured from the built meshes and
 * not computed from `HILT_SPECS` — a second derivation off the spec would be a
 * hand-maintained twin of the geometry, and the geometry is what the player
 * sees a fist against.
 *
 * Once per build, on ten hilts, in the constructor. Never per frame.
 */
function hiltFloor(group) {
  group.updateMatrixWorld(true);
  let lo = Infinity;
  const v = new THREE.Vector3();
  group.traverse((o) => {
    const pos = o.isMesh && o.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y < lo) lo = v.y;
    }
  });
  return Number.isFinite(lo) ? lo : -0.09;
}

export const HILT_SPECS = {
  /* ── the five that shipped, now actually different from each other ──── */
  Graflex: {
    blurb: 'A camera flash, once. The one everybody copies.',
    len: 0.24, r: 0.019, emitter: 0.155,
    shroud: [1.24, 1.05, 0.035], rings: [3, 0.014, 1.02, 0.0035],
    grip: { len: 0.062, r: 0.97, kind: 'ribbed' },
    box: [0.018, 0.05, 0.012], studs: 2, pommel: 'cap',
    extras: ['window'], metal: 'steel',
  },
  Guardian: {
    // Was identical to the Graflex. It is the soldier's hilt now: no glass, no
    // neck jewellery, a longer grip and a flared cap you could club with.
    blurb: 'Plain, heavy, and made to be held in a fist all day.',
    len: 0.25, r: 0.0205, emitter: 0.155,
    shroud: [1.16, 1.02, 0.042], rings: null,
    grip: { len: 0.078, r: 1.0, kind: 'wrapped' },
    box: [0.022, 0.036, 0.014], studs: 1, pommel: 'sphere',
    extras: ['collar'], metal: 'dark',
  },
  Sentinel: {
    blurb: 'Ridged the whole way down, for a hand that never lets go.',
    len: 0.235, r: 0.018, emitter: 0.155,
    shroud: [1.30, 0.98, 0.030], rings: [5, 0.009, 1.06, 0.0026],
    grip: { len: 0.070, r: 0.95, kind: 'fluted' },
    box: [0.014, 0.062, 0.010], studs: 3, pommel: 'spike',
    extras: ['claw'], metal: 'steel',
  },
  Consular: {
    blurb: 'More jewellery than weapon, and it was never meant to be drawn.',
    len: 0.245, r: 0.0186, emitter: 0.155,
    shroud: [1.10, 1.10, 0.026], rings: [2, 0.020, 1.10, 0.0042],
    grip: { len: 0.058, r: 0.92, kind: 'plain' },
    box: null, studs: 1, pommel: 'ring',
    extras: ['sleeve', 'knurl'], metal: 'gold',
  },
  Crossguard: {
    blurb: 'Vented sideways because the crystal cannot hold what it is asked to.',
    len: 0.255, r: 0.0198, emitter: 0.155,
    shroud: [1.34, 1.00, 0.040], rings: [1, 0.016, 1.14, 0.005],
    grip: { len: 0.072, r: 0.99, kind: 'ribbed' },
    box: [0.020, 0.044, 0.013], studs: 2, pommel: 'cap',
    extras: ['crossguard'], metal: 'dark',
  },

  /* ── five more ──────────────────────────────────────────────────────── */
  Duelist: {
    // The curved grip is the whole point and it is a real curve: `bend` tilts
    // the grip and pommel off axis, so the weapon sits in the hand at an angle
    // the way a duelling sabre does.
    blurb: 'Curved, so the point sits where the wrist points and not where the arm does.',
    len: 0.25, r: 0.0182, emitter: 0.158,
    shroud: [1.18, 1.00, 0.030], rings: [2, 0.012, 1.04, 0.003],
    grip: { len: 0.074, r: 0.94, kind: 'fluted', bend: 0.22 },
    box: [0.015, 0.040, 0.011], studs: 1, pommel: 'cap',
    extras: ['knurl'], metal: 'gold',
  },
  Archaic: {
    blurb: 'Older than the Order that carries it. The crystal shows through.',
    len: 0.26, r: 0.021, emitter: 0.160,
    shroud: [1.06, 1.06, 0.048], rings: [4, 0.011, 1.00, 0.0044],
    grip: { len: 0.066, r: 1.02, kind: 'wrapped' },
    box: null, studs: 0, pommel: 'ring',
    extras: ['window', 'collar'], metal: 'dark',
  },
  Warden: {
    blurb: 'Two boxes, four studs and a cap you could drive a nail with.',
    len: 0.265, r: 0.0215, emitter: 0.162,
    shroud: [1.12, 1.08, 0.044], rings: [2, 0.016, 1.06, 0.005],
    grip: { len: 0.080, r: 1.0, kind: 'ribbed' },
    box: [0.026, 0.056, 0.016], studs: 3, pommel: 'sphere',
    extras: ['hook', 'collar'], metal: 'steel',
  },
  Ascetic: {
    // The belt hook is not a decoration and it is the only thing on this hilt
    // that is not structural — which is exactly why an ascetic's weapon has one
    // and a ceremonial one does not.
    blurb: 'A tube. Nothing on it that does not have to be on it.',
    len: 0.228, r: 0.0175, emitter: 0.150,
    shroud: [1.02, 1.02, 0.022], rings: [1, 0.010, 1.00, 0.0022],
    grip: { len: 0.060, r: 1.0, kind: 'plain' },
    box: null, studs: 2, pommel: 'none',
    extras: ['hook'], metal: 'black',
  },
  Shoto: {
    // Short. Everything scales with `len`, so this is genuinely a smaller
    // object in the hand rather than the same hilt with a note on the card.
    blurb: 'Short-hilted, for the off hand or for someone small.',
    len: 0.196, r: 0.0166, emitter: 0.142,
    shroud: [1.22, 1.02, 0.026], rings: [3, 0.010, 1.03, 0.0028],
    grip: { len: 0.048, r: 0.96, kind: 'ribbed' },
    box: [0.013, 0.030, 0.010], studs: 2, pommel: 'cap',
    extras: ['wings'], metal: 'steel',
  },
};

export const HILT_STYLES = Object.keys(HILT_SPECS);

/* ── the orders, as blade physics ────────────────────────────────────── */

/**
 * WHAT AN ORDER DOES TO THE WEAPON.
 *
 * The identity — names, crystal sets, robes, what the player's numbers become —
 * lives in Order.js. This is only the half of it that is a blade: how the
 * emitter is tuned, how steady it burns, and what the hilt is machined out of.
 * The dependency runs one way (Order.js imports this file, never the reverse)
 * because a Saber has to be constructible by Enemy, Net and the menu preview
 * without any of them knowing what an order is.
 *
 * EVERY FIELD IS A MULTIPLIER ON THE SHIPPED PROFILE, and NEUTRAL is exactly
 * 1.0 in all of them. `x * 1` is exact in IEEE754, so a Saber built with no
 * order at all produces bit-identical uniforms to the ones this file produced
 * before orders existed — which is asserted, per uniform, in
 * tools/checks/order.mjs. That is the whole reason the tuning is expressed as
 * factors and not as three parallel copies of PROFILE.
 *
 *   amp/width   per-lobe factors on PROFILE.amp / PROFILE.width — core, glow,
 *               halo. A blade is a shape, not a brightness, so these are chosen
 *               to MOVE flux between lobes rather than to add it: the Sith
 *               blade's core keeps its line integral (1.26 amp × 0.84 sigma =
 *               1.06) and its halo gains half again (1.30 × 1.16 = 1.51). The
 *               core must stay the majority of the flux for every order or
 *               CORE_WHITE is aimed at the wrong lobe — see the flux check in
 *               tools/checks/saber-light.mjs, which this file's own check
 *               extends to the orders.
 *   radius      the quad has to reach past the widest lobe or the halo is cut
 *               off square. Scaled with the halo sigma.
 *   unstable    the shader's standing-instability amplitude. 1.0 is the shipped
 *               0.030 — ±6% of the blade's own amplitude, crawling along it at
 *               8–17 Hz. This is the one number that makes a Sith blade READ as
 *               a contained fault rather than as a red lamp.
 *   flicker     the whole-blade temporal wobble in _updateVisuals. It scales the
 *               AC term ONLY: the 0.94 DC level is untouched, so the mean over a
 *               cycle is identical for every order and an unstable blade is a
 *               modulation and never a gain. (Asserted.)
 *   coreWhite   how far the core lobe gives up its chroma. Never BELOW the
 *               shipped 0.85 for any order — see the note in Order.js on why a
 *               redder Sith core was measured and refused.
 *   trailLife   how long a slice of the smear lives, as a factor on 0.17 s.
 *   metal       the hilt. `steel`/`dark`/`black`/`gold` are the four materials
 *               _buildHilt machines the weapon out of; `rough` moves with them,
 *               because the difference between a temple hilt and a forge hilt is
 *               as much finish as colour.
 */
const NEUTRAL_TUNING = {
  amp: [1, 1, 1], width: [1, 1, 1], radius: 1,
  unstable: 1, flicker: 1, coreWhite: 0.85, trailLife: 1,
  metal: { steel: 0x8d939c, steelRough: 0.34, dark: 0x1c1f26, black: 0x0c0e12,
           gold: 0xb98b3e, goldRough: 0.28 },
};

/** Shallow-merge a partial tuning over NEUTRAL, so a table only states deltas. */
function tune(spec) {
  return { ...NEUTRAL_TUNING, ...spec, metal: { ...NEUTRAL_TUNING.metal, ...(spec.metal || {}) } };
}

/**
 * One order's tuning at one temper, which for every order but the Grey is the
 * order's tuning and nothing else.
 *
 * The returned object is FRESH each call — the caller writes it into uniforms
 * and must never be handed a table entry it could mutate.
 */
function tuningAt(spec, temper) {
  if (!spec) return NEUTRAL_TUNING;
  if (!spec.tempered) return spec;
  const t = clamp(temper, 0, 1), a = spec.calm, b = spec.fury;
  const L = (x, y) => x + (y - x) * t;
  return {
    amp: [L(a.amp[0], b.amp[0]), L(a.amp[1], b.amp[1]), L(a.amp[2], b.amp[2])],
    width: [L(a.width[0], b.width[0]), L(a.width[1], b.width[1]), L(a.width[2], b.width[2])],
    radius: L(a.radius, b.radius),
    unstable: L(a.unstable, b.unstable),
    flicker: L(a.flicker, b.flicker),
    coreWhite: L(a.coreWhite, b.coreWhite),
    trailLife: L(a.trailLife, b.trailLife),
    metal: spec.metal,
  };
}

export const BLADE_TUNING = {
  /**
   * JEDI — the shipped core, focused.
   *
   * The CORE lobe is untouched — amp 1, sigma 1 — and that is deliberate: those
   * two numbers were solved against the arena's real back end and there is
   * nothing about a temple blade that wants them re-solved. What an attuned
   * crystal in a properly tuned emitter earns is everything OUTSIDE the core:
   * the halo comes in a tenth and dims by a seventh, the glow lobe with it, the
   * quad closes to match, and the standing instability drops by a quarter. The
   * read is a clean line rather than a hot smear — the exact opposite of the row
   * below it, which is the point of having both.
   */
  jedi: tune({
    amp: [1.0, 0.96, 0.86], width: [1.0, 0.97, 0.90], radius: 0.94,
    unstable: 0.75, flicker: 0.6, trailLife: 0.92,
    // Satin rather than the untuned weapon's brushed finish, and brighter gold:
    // a temple armoury maintains its blades.
    metal: { steel: 0x9aa1ab, steelRough: 0.30, gold: 0xd9ae54, goldRough: 0.22 },
  }),

  /**
   * SITH — a synthetic crystal in an over-driven emitter.
   *
   * A bled crystal is cracked, and the containment field is what is holding the
   * crack together; that is the whole visual argument for this row. The core is
   * driven harder and pinched tighter (its flux barely moves, 1.06×), the halo
   * is opened up and pushed 51% harder — so the light that used to be in the
   * beam is now around it — and the standing instability goes to 3.6× the
   * shipped figure, which is ±21.6% of amplitude writhing along the blade
   * instead of ±6%. The smear lingers a third longer, so a Sith arc hangs in
   * the air behind the swing.
   */
  sith: tune({
    amp: [1.26, 1.10, 1.30], width: [0.84, 1.0, 1.16], radius: 1.14,
    unstable: 3.6, flicker: 3.2, trailLife: 1.35,
    metal: { steel: 0x4a4d55, steelRough: 0.20, dark: 0x14161b, black: 0x08090c,
             gold: 0x8e3a2a, goldRough: 0.36 },
  }),

  /**
   * GREY — a healed crystal, and the only blade in the game that is not a
   * constant.
   *
   * The top level states no lobes of its own because there is no one answer: a
   * Grey blade is `calm` when its wielder is still and `fury` when they are
   * swinging, and every frame it is somewhere between the two. Saber.temper is
   * the state and _retune() is what spends it. See TEMPER below for the driver.
   *
   * The poles are outside the other two orders in BOTH directions, which is the
   * point and is asserted. Composed, this is a purified crystal: the WIDEST core
   * in the game (sigma 1.14) giving up more of its chroma than any other
   * (coreWhite 0.94) inside the tightest, faintest halo in the game — a fat
   * white blade with a thin coloured fringe, which is what a healed crystal
   * looks like. Furious, the same blade is a needle core (sigma 0.80) inside a
   * halo wider and hotter than a Sith's, and the least stable thing in the
   * build. No other blade here travels that far.
   */
  grey: tune({
    tempered: true,
    calm: tune({ amp: [0.98, 0.86, 0.68], width: [1.14, 0.98, 0.86], radius: 0.90,
                 unstable: 0.45, flicker: 0.5, coreWhite: 0.94, trailLife: 0.85 }),
    fury: tune({ amp: [1.30, 1.16, 1.45], width: [0.80, 1.0, 1.26], radius: 1.22,
                 unstable: 4.4, flicker: 4.0, coreWhite: 0.86, trailLife: 1.5 }),
    metal: { steel: 0x9aa0a4, steelRough: 0.62, dark: 0x272a2e, black: 0x121417,
             gold: 0x7d6a48, goldRough: 0.55 },
  }),
};

/**
 * THE TEMPER, which is the Grey order's whole mechanic.
 *
 * It is driven by the one thing about the fight the blade already knows without
 * anybody wiring anything: how hard it is being SWUNG, measured against the body
 * that carries it (`swingSpeed`, not tip speed — sprinting moves the tip at
 * 7 m/s with the wrist perfectly still, and reading that as fury would let a
 * player raise a Grey blade's temper by jogging).
 *
 * Asymmetric on purpose, and this is the fiction as a number. Measured on the
 * real update loop (tools/checks/order.mjs quotes both): 1.44 s of swinging at
 * 20 m/s to reach 0.9, and 2.62 s of perfect stillness to fall from 0.9 back to
 * 0.3. Fury is easy to reach for and slow to let go of, by a factor of 1.8.
 *
 * FLOOR/SPAN are in metres per second at the tip. 4 m/s is a blade being
 * carried; 18 m/s is a committed cut — the same regime `_trailPunch` reads, so
 * the temper rises exactly when the smear does.
 */
export const TEMPER = { floor: 4.0, span: 14.0, rise: 1.6, fall: 0.42 };

/* ── shaders ─────────────────────────────────────────────────────────── */

/**
 * THE BLADE.
 *
 * One camera-facing quad spanning the blade axis, and an emission profile
 * evaluated analytically against the distance to that axis. Everything that
 * makes plasma read as plasma is in that profile:
 *
 *   • it is ONE colour at THREE amplitudes, spanning nearly two orders of
 *     magnitude. The centre is the crystal's own hue pushed so far past white
 *     that every channel saturates — which is exactly why an over-exposed
 *     emitter photographs as a white core with a coloured halo, and it is the
 *     only way to get a coloured bloom out of a tonemapped renderer. A blade
 *     built the other way round — a white core mesh with a tinted shell over
 *     it — can only ever be a white stick, because the white is authored, not
 *     earned, and the tint sits UNDER it.
 *   • the falloff is Gaussian, so there is no silhouette anywhere. The old
 *     build was four nested cylinders: a hard-edged solid core capsule and
 *     three shells whose alpha came from the facing angle of a 14-sided tube,
 *     so the blade had a polygonal edge, banded where the shells crossed, and
 *     lost its coloured shell entirely at any distance.
 *   • the field is a CAPSULE, not a tube, so the tip is a proper rounded cap
 *     for free and from every angle, including end-on where the blade should
 *     collapse to a bright disc rather than disappear.
 *   • it is one draw call and two triangles.
 */
const BLADE_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  uniform float uLen;        // blade length, metres, from the emitter
  uniform float uRadius;     // how far out the quad has to reach
  attribute vec2 aQuad;      // x across in [-1,1], y along in [0,1]
  varying vec2 vP;           // (across, along) in view-space metres
  varying float vLen;
  void main(){
    vec3 B = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 T = (modelViewMatrix * vec4(0.0, uLen, 0.0, 1.0)).xyz;
    vec3 ax = T - B;
    float L = length(ax);
    vec3 A = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
    // Any scale on the way down the hierarchy has to reach the radius too, or
    // a scaled saber gets a full-sized halo around a small blade.
    float sc = L / max(uLen, 1e-4);
    float R = uRadius * sc;
    // Billboard about the blade's own axis: the quad turns to face the camera
    // but never leaves the axis, so the blade is where it says it is.
    vec3 V = normalize(-(B + T) * 0.5);
    vec3 S = cross(A, V);
    float sl = length(S);
    // End-on the cross product vanishes; any perpendicular will do, because the
    // capsule field below collapses to a disc there anyway.
    S = sl > 1e-4 ? S / sl : normalize(cross(A, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
    // The quad reaches a full radius past the TIP, because the tip is a round
    // cap, but barely past the emitter, because the emitter is a hole in a
    // piece of machined steel. Symmetrical bounds put a 30 cm ball of light
    // around the hilt.
    float along = mix(-0.055 * sc, L + R, aQuad.y);
    vec3 p = B + A * along + S * (aQuad.x * R);
    vP = vec2(aQuad.x * R, along);
    vLen = L;
    vec4 mvPosition = vec4(p, 1.0);
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
/**
 * THE SHARE OF AN EMITTER THE HAZE MAY NEVER TAKE.
 *
 * Both blade and trail multiply themselves by (1 - fogFactor), which is right
 * in principle — haze takes light away from a light source, it does not tint it
 * — and was wrong at the limit, because nothing stopped the product reaching
 * zero. On the heavy-weather levels the blade stopped being a colour before it
 * stopped being on screen.
 *
 * Written into the GLSL as a define rather than a uniform: it is one number,
 * the same for every saber in the world, and a uniform would be a per-material
 * write every frame to say the same thing. Named in one place so the blade and
 * the trail cannot drift apart — they are one object to the eye.
 */
export const FOG_FLOOR = 0.42;

/* EXPORTED so `tools/checks/_glsl.mjs` can be handed the same string the
 * shader is built from. That helper evaluates the template it extracts, so an
 * interpolation it has no binding for is a hard failure — which is the design:
 * a check reads the SHIPPED number rather than a copy of it. */
export const FOG_FLOOR_GLSL = `const float FOG_FLOOR = ${FOG_FLOOR.toFixed(3)};`;

const BLADE_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  ${FOG_FLOOR_GLSL}
  uniform vec3 uHue;         // the crystal, normalised so its peak channel is 1
  uniform vec3 uWidth;       // gaussian sigma: core, glow, halo
  uniform vec3 uAmp;         // amplitude:      core, glow, halo
  uniform float uRadius;
  uniform float uFlicker;
  uniform float uTime;
  uniform float uSurge;      // ignition front
  uniform float uCoreWhite;  // how far the core lobe is neutralised. See CORE_WHITE.
  uniform float uUnstable;   // standing-instability amplitude. See BLADE_TUNING.
  varying vec2 vP;
  varying float vLen;
  void main(){
    float a = vP.y;
    // Distance to the segment [0, vLen] — a capsule field, so the tip is round
    // for free from every angle. The emitter end is compressed rather than
    // capped: plasma comes OUT of the shroud, it does not pool around it.
    float dy = a < 0.0 ? a * 3.2 : (a > vLen ? a - vLen : 0.0);
    float d = length(vec2(vP.x, dy));
    float t = clamp(a / max(vLen, 1e-4), 0.0, 1.0);

    // The plasma leaves the emitter wide and hot and closes toward the tip,
    // which brightens as it narrows.
    float w = 1.0 + 0.30 * exp(-a * 26.0) - 0.09 * smoothstep(0.5, 1.0, t);
    // Standing instability: three incommensurate waves crawling along the
    // blade. Small — 6% on an untuned crystal — but it is the difference
    // between a lamp and a contained arc, and it is the only thing on the blade
    // that moves. It is a UNIFORM rather than a constant because it is the one
    // number that separates a temple blade from a bled one: at uUnstable 0.108
    // (BLADE_TUNING.sith) the same three waves run at ±21.6% and the blade
    // visibly writhes. The default is exactly the 0.030 that was here.
    float n = sin(a * 57.0 - uTime * 8.0)
            + sin(a * 23.0 + uTime * 5.3) * 0.7
            + sin(a * 127.0 + uTime * 17.0) * 0.3;
    float amp = uFlicker * (1.0 + n * uUnstable) * (1.0 + 0.22 * smoothstep(0.86, 1.0, t));
    // the ignition front burns hotter than the blade behind it
    amp *= 1.0 + uSurge * exp(-(1.0 - t) * 7.0);

    /* A 2 cm blade at 20 m is a fifth of a pixel wide, and a gaussian narrower
     * than the sample grid is a line of aliased dots that mostly misses. So no
     * lobe is allowed to be thinner than about a pixel, and whatever is
     * widened has its amplitude cut by the same factor — the LINE INTEGRAL of
     * a gaussian is amp·sigma, so holding that product constant keeps the
     * blade's total light identical while it stops being sub-pixel. This is
     * the difference between a blade that carries across a battlefield and one
     * that shimmers out at ten metres. */
    float px = max(fwidth(vP.x), 1e-7);
    vec3 wid = uWidth * w;
    vec3 we = max(wid, vec3(px * 0.62));
    vec3 keep = wid / we;
    vec3 dd = vec3(d) / we;
    float core = exp(-dd.x * dd.x) * keep.x;
    float glow = exp(-dd.y * dd.y) * keep.y;
    // a longer tail than a gaussian on the outermost lobe — this is the wash
    // that lands on walls and faces, and it has to reach
    float halo = exp(-pow(dd.z, 1.4)) * keep.z;
    float ec = uAmp.x * core * amp;                       // the core lobe alone
    float e0 = ec + (uAmp.y * glow + uAmp.z * halo) * amp;
    // guarantee it is exactly zero at the quad's edge
    float e = e0 * smoothstep(uRadius, uRadius * 0.55, d);
    if(e < 0.002) discard;

    /* THE CORE IS NEUTRALISED WHERE IT DOMINATES — see CORE_WHITE in the class.
     * The mix is toward the hue's own LUMINANCE, not toward white: a lift toward
     * white would add radiance and make the bloom veil brighter as well as
     * paler, and then no measurement could say which of the two fixed anything.
     * This way the lobe's luminance is identical before and after and the only
     * thing that moves is chroma. */
    vec3 hueN = vec3(dot(uHue, vec3(0.2126, 0.7152, 0.0722)));
    float fogK = 0.0;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        fogK = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        fogK = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    /* ── WHY THE COLOUR WASHES OUT IN WEATHER, AND WHICH LEVER IT IS NOT ──
     *
     * "Sometimes it's hard to make out your lightsaber colour in game depending
     * on the weather, it drowns out the colour a little too much."
     *
     * THREE CANDIDATE CAUSES WERE MEASURED THROUGH THIS SHADER AND TWO OF THEM
     * ARE INNOCENT, which is worth writing down because both look guilty:
     *
     *   CORE_WHITE is not it. The core lobe runs at amp 58, so far over 1.0
     *     that ACES clips it to white whatever hue went in. Moving CORE_WHITE
     *     from 0.85 to 0.55 moved the measured chroma at 8 mm by 0.011 — and
     *     the core stays clipped at L=1.00 even at 140 m through the heaviest
     *     shipped fog, so a haze-driven version of the same idea is inert too.
     *     It was written, measured at zero, and taken back out.
     *
     *   THE HALO'S WIDTH is not it either. The band that reads as colour after
     *     tone mapping already runs from 16 mm to 155 mm — the blade is a white
     *     filament inside a wide, FULLY SATURATED skirt, because the mix toward
     *     luminance is weighted by the core's share and that share is nil out
     *     there. Widening the halo lobe 25% bought 35 mm of band and a fatter
     *     blade; it is not short of coloured pixels.
     *
     * WHAT IS LEFT is the one thing neither number can fix from in here: the
     * skirt is ADDITIVE, so what it is worth depends on what is behind it. Over
     * a dark level it is the whole picture. Over a bright hazy one the
     * background is already near the top of the range and the same added blue
     * is a smaller fraction of it — the colour is not being removed, it is
     * being out-voted. That is why it is weather-dependent and why it is a
     * per-level quantity rather than a constant here.
     *
     * So the fix is the amplitude the LEVEL asks for (BLADE_TUNING / the level's
     * own bloom strength) plus the floor below, and NOT another curve in this
     * function. Recorded here so the next reader does not re-derive the two
     * dead ends. */
    vec3 col = mix(uHue, hueN, uCoreWhite * (ec / max(e0, 1e-5)));
    vec3 c = col * e;
    #ifdef USE_FOG
      float fogFactor = fogK;
      // Haze takes light AWAY from an emitter. Mixing toward the fog colour —
      // what the stock chunk does — makes a distant blade brighter than a near
      // one, which is how you get a glowing stick on the horizon.
      //
      // BUT NOT ALL THE WAY TO NOTHING, and that was the bug. This was a bare
      // multiply by (1.0 - fogFactor) with no floor at all, so on a heavy
      // level the blade did not lose SATURATION with distance, it lost all
      // radiance — "sometimes it's hard to make out your lightsaber colour in
      // game depending on the weather, like it drowns out the colour a little
      // too much". A weapon whose colour is its identity cannot be allowed to
      // reach zero while it is still on screen and still in your hands.
      //
      // FOG_FLOOR is the share of the emitter the haze may never take. 0.42
      // keeps the halo lobe over Engine's 1.8 bloom threshold in the worst
      // shipped weather, which is what makes it read as COLOUR rather than as a
      // grey stick; the first 58% of the extinction still applies in full, so a
      // blade across the valley is still hazed and still dimmer than one at
      // your feet. It is a floor, not a cancellation.
      c *= max(1.0 - fogFactor, FOG_FLOOR);
    #endif
    // Additive blending ignores alpha, but the canvas does not: the menu
    // preview composites over the page, and emitting alpha 1 across the whole
    // quad painted a 60 cm opaque black rectangle behind the blade.
    gl_FragColor = vec4(c, clamp(max(max(c.r, c.g), c.b), 0.0, 1.0));
  }
`;

/**
 * THE TRAIL.
 *
 * The swept volume of the blade over the last fraction of a second, as three
 * parallel sheets offset along the sweep's own normal. The thickness is what
 * stops a chop swung nearly in the view plane — where the swept surface turns
 * edge-on — from collapsing to nothing, which a zero-thickness ribbon does.
 */
const TRAIL_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  attribute float aAge;      // 0 = this frame, 1 = gone
  attribute float aSide;     // 0 at the emitter, ~1.05 past the tip
  attribute float aThick;    // -1, 0, +1 across the swept sheet
  attribute float aPunch;    // how fast the blade was moving when it was here
  varying float vAge; varying float vSide; varying float vThick; varying float vPunch;
  void main(){
    vAge = aAge; vSide = aSide; vThick = aThick; vPunch = aPunch;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const TRAIL_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  ${FOG_FLOOR_GLSL}
  uniform vec3 uHue; uniform float uGlow; uniform float uHot;
  uniform float uCoreWhite;  // how far the HOT lobe is neutralised. See CORE_WHITE.
  varying float vAge; varying float vSide; varying float vThick; varying float vPunch;
  void main(){
    float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.5);
    // feathered at the emitter, carried a little past the tip
    float prof = smoothstep(0.0, 0.13, vSide) * (1.0 - smoothstep(0.99, 1.06, vSide));
    float th = exp(-vThick * vThick * 1.3);
    // The smear has the same two-lobe structure the blade has: a HOT lobe that
    // dies within a couple of frames, and a GLOW lobe that carries the length of
    // the arc. uHot * hot is the smear's core, uGlow * fade is its halo.
    float hot = pow(clamp(1.0 - vAge * 2.6, 0.0, 1.0), 2.0);
    float ec = uHot * hot;               // the hot lobe alone
    float e0 = uGlow * fade + ec;
    float e = prof * th * vPunch * e0;
    if(e < 0.002) discard;
    /* THE FRESHEST SLICE GIVES UP ITS CHROMA, exactly as the blade's core does —
     * same constant, same target, same reason. prof, th and vPunch are common to
     * both lobes and cancel out of the ratio, so what is neutralised is decided
     * by AGE alone: the freshest slice is 71% hot lobe and comes out near-neutral,
     * and once the hot lobe has died (vAge > 0.385, about four frames) the mix is
     * exactly zero and the wisp is the crystal at full chroma. That is the read
     * this is for — a white-hot leading edge trailing into a coloured wisp — and
     * it is what the old line, vec3 c = uHue * e, could never produce: hot only
     * ever raised the AMPLITUDE of the same 22.9:1 blue, so the whole ribbon was
     * one saturated sheet and the comment here claiming it "whites out" described
     * a mechanism the code did not have.
     *
     * Toward the hue's own LUMINANCE and never toward white, for a reason that is
     * sharper here than on the blade: UnrealBloomPass's high pass thresholds on
     * luminance() with the SAME Rec.709 weights, so a mix toward hueN leaves the
     * pass's own value bit-identical. Exactly as much of the trail blooms as
     * before and only its colour moves — which is what makes the A/B on the
     * wielder readable at all. A lift toward white would raise that value, bloom
     * MORE of the ribbon, and confound the two. */
    vec3 hueN = vec3(dot(uHue, vec3(0.2126, 0.7152, 0.0722)));
    vec3 col = mix(uHue, hueN, uCoreWhite * (ec / max(e0, 1e-5)));
    vec3 c = col * e;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      // The same floor as the blade's, and for the same reason — a trail that
      // fades to nothing behind a blade that does not is a smear that detaches
      // from its own weapon. See BLADE_FRAG.
      c *= max(1.0 - fogFactor, FOG_FLOOR);
    #endif
    gl_FragColor = vec4(c, clamp(max(max(c.r, c.g), c.b), 0.0, 1.0));
  }
`;

/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE ENGINE EVERY BLADE IN THE PLAYING SCENE SENDS ITS LIGHT TO.
 *
 * A registry rather than a constructor argument, and the reason is where the
 * Sabers are built: `Enemy.js` (twice), `Net.js`, `Menu.js`, `toon/scene.js`
 * and a dozen checks all call `new Saber(scene, …)`, and thirty ENEMY blades
 * are what note #15 is about — the player's own two lights were never the
 * problem. Threading a parameter to all of them means editing four files that
 * other work is live in.
 *
 * So the first Saber that is TOLD about an engine publishes it, and every blade
 * built into that engine's scene afterwards finds it. `Player` is that first
 * Saber in every real game: `World.spawnPlayer` runs before any wave.
 *
 * `resolveLightSink` is the guard, and its test is the SCENE and not the
 * registry: a blade only uses the pool if the object it was parented into
 * belongs to that engine's scene graph. The character creator's preview runs
 * its own renderer over its own scene while a game engine is alive, and a
 * request posted from there would light nothing and cost a slot.
 */
let LIGHT_SINK = null;

/** @returns the engine this saber should ask for light, or null for its own. */
export function resolveLightSink(engine, scene) {
  if (engine && typeof engine.lightUp === 'function') LIGHT_SINK = engine;
  const sink = LIGHT_SINK;
  if (!sink || !sink.scene) return null;
  let top = scene;
  while (top && top.parent) top = top.parent;
  return top === sink.scene ? sink : null;
}

export class Saber {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.colorIndex = opts.colorIndex ?? 0;
    const c = SABER_COLORS[this.colorIndex] || SABER_COLORS[0];
    this.color = new THREE.Color(c.hex);
    this.glowColor = new THREE.Color(c.glow);
    this.hue = new THREE.Color(1, 1, 1);
    this.punch = 1;
    /**
     * Which view this blade is being LOOKED at from, and therefore which pinch
     * its lobes take. A field with a setter rather than a flag Player pokes,
     * because the lobes have to be re-synced when it changes and there is
     * exactly one place that may write them (_syncWidth). Set before
     * `coreWidth` below, whose setter runs that sync.
     */
    this._firstPerson = false;
    this.bladeLength = opts.bladeLength ?? 1.15;
    /**
     * The order this weapon was built by, or null for a blade that belongs to
     * nobody's tradition. null is not a synonym for 'jedi': it is the untuned
     * emitter every Saber in this game was until orders existed, and every
     * uniform it produces is bit-identical to what it produced then.
     *
     * Set BEFORE _coreWidth, because the coreWidth setter runs _syncWidth,
     * which reads the tuning.
     */
    this._order = null;
    this._tuning = NEUTRAL_TUNING;
    /** 0 = still, 1 = fury. Only a tempered order ever moves it. See TEMPER. */
    this.temper = 0;
    if (opts.order && BLADE_TUNING[opts.order]) {
      this._order = opts.order;
      this._tuning = tuningAt(BLADE_TUNING[opts.order], 0);
    }
    this.coreWidth = opts.coreWidth ?? 1;
    this.hiltStyle = opts.hiltStyle ?? 'Graflex';
    /**
     * A WEAPON THAT IS NOT A LIGHTSABRE, and this exists because of one
     * player note: "sometimes I see my own troops and they have light sabers
     * and I don't know why, unless they are other jedi or sith that are
     * helping you it doesn't make sense for a fucking droid to be holding a
     * lightsaber."
     *
     * They were right, and the reason is in the roster rather than in a bug.
     * `bx` (the BX commando droid) and `magna` (the MagnaGuard) are both
     * `melee: true, saber: true`, and both of them are RUNGS OF THE
     * SEPARATIST LADDER — so a Sith player, whose army IS the Separatists
     * (`sideForOrder`), musters a line that carries glowing plasma. Their own
     * archetype notes had already admitted it: Command.js calls the BX's
     * weapon "a VIBROSWORD… melee: true, saber: true today, which puts a
     * glowing blade in a commando droid's hand", and Bodies.js builds the
     * scabbard for it down the chassis's spine.
     *
     * The `saber: true` flag is not the problem — it is what routes a body
     * through `DuelBrain`, and a BX absolutely should duel. What was wrong is
     * that ONE flag decided both the brain and the look. So the look is its
     * own field now:
     *
     *   null      plasma. A lightsabre, and the only thing that is one.
     *   'vibro'   a solid alloy blade. Ground metal, no emission, no light,
     *             no hum, no trail — a sword.
     *   'staff'   an electrostaff: a long dark shaft with the charge only at
     *             the two ends, which is the entire visual idea of the weapon.
     *
     * Everything downstream is untouched by design. The blade's LENGTH, its
     * sweep, `cutPowerAt`, the contact solver, the clash and the duel all read
     * geometry that is identical either way, so a vibrosword cuts exactly as
     * hard as it did yesterday and this is a change of what you SEE.
     */
    this.weaponStyle = opts.weaponStyle ?? null;
    /** True for anything that is not plasma. Read by ignite, the lights, the
     *  trail and the audio, which is every system that says "lightsabre". */
    this.physical = this.weaponStyle === 'vibro' || this.weaponStyle === 'staff';

    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = true;
    scene.add(this.root);

    this.lit = false;
    this.ignition = 0;            // 0..1 extension
    this.surge = 0;               // how fast that extension is changing
    this.throwState = 'held';     // held | flying | returning
    this.contactStrain = 0;

    // sweep state
    this.base = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevBase = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.tipVelocity = new THREE.Vector3();
    this.baseVelocity = new THREE.Vector3();
    this.tipSpeed = 0;
    this.swingSpeed = 0;
    this.sweepNormal = new THREE.Vector3(1, 0, 0);
    this.sweepArea = 0;
    this.valid = false;

    this._buildHilt();
    this._buildBlade();
    if (this.physical) this._buildPhysicalBlade();
    this._buildTrail();
    // The lobes were already tuned by _syncWidth on the way through; this is
    // what lands the SCALARS — instability, core neutralisation, smear lifetime
    // — on a blade that now has materials to put them on.
    this._retune();

    // A metre of plasma is a LINE light, and the decay exponent is where that
    // gets said. An infinite line falls off as 1/r near it and only reaches
    // 1/r² far away, so `decay = 1` with the cutoff window doing the far end is
    // a better model of a blade than `decay = 2` is — and the difference is not
    // cosmetic. Measured on a blade held 24 cm off the sand, the old inverse
    // square put 35 units of irradiance on the ground directly under the tip
    // (the sun is 7) and clipped it to (1.00, 0.98, 0.91): the hue was
    // destroyed by the very brightness that was supposed to carry it, while
    // the wielder's chest a metre and a half away moved by 0.016. 1/r closes
    // that ratio by a factor of r: six times less light at the tip, the same at
    // the chest, twice as much three metres out.
    //
    // Two lights, not more, on purpose: every enemy in a wave carries one of
    // these, and NUM_POINT_LIGHTS is a per-fragment unrolled loop in every lit
    // material in the game.
    //
    // THAT COMMENT SAW HALF OF NOTE #15 AND CAPPED THE WRONG THING. It capped
    // the lights PER BLADE at two and nothing capped the number of BLADES:
    // measured with tools/_crowd.mjs, an empty colosseum carries 2 dynamic
    // point lights and thirty acolytes carry 64. The second cost is the one the
    // player calls a freeze rather than lag — three.js bakes NUM_POINT_LIGHTS
    // into the shader SOURCE, so a blade igniting or a wielder dying moves the
    // count and recompiles every lit material in the scene.
    //
    // These two are now REQUESTS rather than lights: they carry the position,
    // the colour (see `_applyColour` and FLOOR_CHANNEL), the 5.4/2.4 candela
    // tuning and the 1/r decay that the whole near/far balance is built on, and
    // once a frame `_updateVisuals` offers them to `Engine.lightUp`. The engine
    // holds a FIXED pool of eight that is never added to or removed from the
    // scene, so the count cannot change and the recompile cannot happen.
    //
    // They are still PointLights and not plain records, because everything that
    // grades this blade's light — tools/checks/saber-light.mjs, vfx.mjs — reads
    // `decay`, `distance`, `castShadow` and `color` off them, and a second
    // description of a light beside the light is the defect this project keeps
    // removing.
    this.light = new THREE.PointLight(0xffffff, 0, 7, 1);
    this.light.castShadow = false;
    this.tipLight = new THREE.PointLight(0xffffff, 0, 4.5, 1);
    this.tipLight.castShadow = false;
    /**
     * …AND THEY GO IN THE SCENE WHEN THERE IS NO POOL TO ASK.
     *
     * The character-creator preview (Menu.js) builds its Saber into `p.pivot`
     * inside its OWN scene with its own renderer, and so does `toon/scene.js`
     * and every headless check that news up a Saber against a bare
     * `THREE.Scene`. None of those has an Engine, none of them has more than one
     * blade, and a preview whose sabre stopped lighting anything would be a
     * regression bought for nothing. So the fallback is exactly the old
     * behaviour, and the test is IDENTITY OF THE SCENE — not merely "an engine
     * was registered", because the menu preview runs while a game's engine is
     * alive and its blade must not post requests into a pool that renders a
     * different scene.
     */
    this.engine = resolveLightSink(opts.engine, scene);
    /** Whose blade never loses a pool slot. See Engine.lightUp's ranking. */
    this.lightPriority = opts.lightPriority ?? 0;
    if (!this.engine) { scene.add(this.light); scene.add(this.tipLight); }

    this._applyColour();
  }

  setColor(index) {
    this.colorIndex = index;
    const c = SABER_COLORS[index] || SABER_COLORS[0];
    this.color.setHex(c.hex);
    this.glowColor.setHex(c.glow);
    this._applyColour();
  }

  /**
   * Take on another order's tuning — or none.
   *
   * This exists for the weapon that was not yours. Picking a hilt up off the
   * ground gives you the blade its builder made, and an order's tuning is most
   * of what a blade IS here: the emission profile, the metals, the temper. A
   * Sith hilt in a Jedi's hand should look and cut like a Sith's, or "you can
   * take their sword" is a recolour. See Dropped.js.
   */
  setOrderTuning(orderId) {
    this._order = orderId && BLADE_TUNING[orderId] ? orderId : null;
    this.temper = 0;
    this._retune();
  }

  /**
   * Machine a new hilt, because the style changed under a live weapon.
   *
   * Only reachable through a pick-up, and it disposes what it replaces — a
   * player who spends a fight swapping hilts off the floor would otherwise
   * leave one dead Group per swap in the scene graph for the level's lifetime.
   */
  rebuildHilt() {
    if (this.hilt) {
      this.root.remove(this.hilt);
      this.hilt.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    }
    this._buildHilt();
    this._applyColour();
  }

  /**
   * The blade emits ONE colour. Everything else about how it reads — white
   * core, coloured halo, coloured bloom — comes from the amplitude profile
   * running that colour from 66 down to 0.01 over a quarter of a metre.
   *
   * So the hue is normalised to a peak channel of 1: a crystal is a hue, not a
   * brightness. `punch` then puts the brightness back, but only partly, so a
   * deliberately dim crystal (Void) stays moody instead of being renormalised
   * into a lamp.
   */
  _applyColour() {
    const c = this.color;
    const peak = Math.max(c.r, c.g, c.b, 1e-4);
    this.hue.copy(c).multiplyScalar(1 / peak);
    this.punch = 0.62 + 0.38 * Math.pow(peak, 0.6);

    /* WHAT THE BLADE THROWS — the crystal's hue, with a FLOOR under its dimmest
     * channel and nothing else.
     *
     * The argument this replaces was that the light must not be lifted toward
     * white at all, because on sand a lifted light "lands RED-dominant and the
     * ground hands back white". The direction of that argument is right and the
     * arithmetic under it was not: it was computed on colours that had been
     * through the sRGB-to-linear transform TWICE. `new THREE.Color(0x3ba7ff)`
     * is (0.0437, 0.3864, 1.0000) in the working space, not (0.0034, 0.1236,
     * 1.0000); the dune sea's sand is (0.687, 0.527, 0.324), not (0.51, …,
     * 0.109). Redone at the real values, the old 22% lift returns
     * (0.172, 0.274, 0.324) off that sand — still BLUE-dominant at 1.9:1, not
     * red-dominant — and the un-lifted crystal returns 10.8:1 rather than the
     * 4.9:1 the comment quoted. Every ratio in that paragraph was roughly
     * doubled, and the one claim that made a lift unthinkable is not true.
     *
     * What IS true, and what the floor is for: across the palette the crystal
     * hues run from 4.1:1 (Void) to 96.8:1 (Bronze) between their brightest and
     * dimmest channel. A Bronze blade throws light with one part blue in a
     * hundred. That is not a coloured light, it is a channel filter — anything
     * it lights loses a whole primary and with it every material distinction
     * carried in that primary. A floor at FLOOR_CHANNEL of the peak is the
     * narrow fix for exactly that: it is a no-op on Ivory (89%) and Void (24%),
     * and it is nearly the whole story on Bronze, Cyanite, Crimson and Sunfire.
     *
     * This is also the fix for the SECOND fault, which is a different fault
     * from the wielder's: the player's own cast shadow reading as a bright cyan
     * hole. That one IS the point lights — they are unshadowed on purpose, so
     * in the one region the sun cannot reach they are the only thing there.
     * With the blade drawn but both lights zeroed the shadow measures R/B 1.494
     * against an unlit 1.605, i.e. barely touched; the lights are what invert it.
     *
     * Measured on the dune sea, one frozen frame, floor off then on
     * (tools/_wielder.mjs sweep --only before,after,core0):
     *
     *   the player's own cast shadow, R/B   1.052 -> 1.113   (unlit 1.611)
     *   sunlit sand, B/R                    0.803 -> 0.799   (unlit 0.754)
     *
     * so the ground still reads the blade — the blade moves sunlit sand's B/R
     * by +0.045 where before it moved it +0.049, i.e. the floor costs 8% of the
     * blade's effect on the ground — while the shadow it fills gets some of its
     * warmth back. The pool on sand is still about 3:1 blue.
     *
     * The floor does NOT fix the shadow's brightness, only its hue: the lights
     * still lift it 1.2x. Cutting their intensity is the only thing that would,
     * and it was measured and rejected — see the near-field check in
     * tools/checks/saber-light.mjs.
     *
     * It is a FLOOR and not a lerp toward white on purpose: a lerp moves every
     * colour, including the ones that were never the problem, and would take
     * Void and Ivory with it for nothing. */
    this.light.color.copy(this.hue);
    this.tipLight.color.copy(this.hue);
    Saber.floorChannels(this.light.color);
    Saber.floorChannels(this.tipLight.color);

    // The blade, the trail and the hilt accent are NOT floored. They are the
    // emitter, and the emitter is the crystal — the floor is a statement about
    // what a light source may do to other people's materials, not about what
    // colour the plasma is.
    if (this.bladeMat) this.bladeMat.uniforms.uHue.value.copy(this.hue);
    if (this.trailMat) this.trailMat.uniforms.uHue.value.copy(this.hue);
    this.hiltAccent.emissive.copy(this.color);
  }

  /**
   * Raise a light colour's dimmest channel to FLOOR_CHANNEL of its brightest,
   * in place.
   *
   * Writes r/g/b directly rather than going through setRGB: the components are
   * already in the renderer's working space and setRGB's colour-space argument
   * is the kind of thing that silently changes meaning across a three upgrade.
   */
  static FLOOR_CHANNEL = 0.16;

  static floorChannels(col, f = Saber.FLOOR_CHANNEL) {
    const p = Math.max(col.r, col.g, col.b, 1e-4) * f;
    col.r = Math.max(col.r, p);
    col.g = Math.max(col.g, p);
    col.b = Math.max(col.b, p);
    return col;
  }

  /* ── construction ──────────────────────────────────────────────────── */

  /**
   * THE HILT IS MACHINED BY THE ORDER THAT BUILT IT.
   *
   * Four materials and two finishes, all four of them already here — this only
   * stopped hard-coding them. A temple hilt is satin steel with bright gold neck
   * rings, because an armoury maintains its weapons; a Sith hilt is blackened
   * chrome with blood-bronze; a Grey hilt is raw unpolished alloy with dull
   * brass, because a salvaged weapon is not finished by a smith who had time.
   * The untuned hilt — nobody's tradition — keeps the brushed steel it always
   * had, and is a fourth distinct weapon rather than a synonym for the Jedi's.
   *
   * The materials are kept on the instance so the ORDER SETTER can restyle a
   * live hilt: the forge preview flips orders without rebuilding, and a hilt
   * that kept its old metal while the blade changed would be the same
   * half-wired feature this file's checks exist to stop.
   */
  /**
   * Machine the hilt out of its spec.
   *
   * Everything is placed relative to the emitter face at the top and the pommel
   * end at the bottom, so `len` genuinely resizes the object rather than
   * stretching one section. The four materials are the order's, unchanged — a
   * spec picks WHICH of them the body takes, which is how a hilt can be black
   * and gold instead of steel and gold without anyone authoring a fifth.
   */
  _buildHilt() {
    const built = buildHiltGroup({ tuning: this._tuning, color: this.color, style: this.hiltStyle });
    this.hiltAccent = built.accent;
    this.hiltMetals = built.metals;
    this.hiltSpec = built.spec;
    this.hilt = built.group;
    // BEFORE the group is parented and before the grip scale is applied, so the
    // number comes out in the same space `GRIP_AT` is written in — the caller
    // multiplies by `gs` exactly as it does for the third-person grip.
    this.hiltFloor = hiltFloor(built.group);
    this.root.add(built.group);
    this._emitter0 = built.emitter;
    this.setGripScale(this.gripScale ?? 1);
  }

  /**
   * HOW BIG THIS WEAPON'S HILT IS, because a grip is a contact between two
   * objects and the smaller of them sets the scale.
   *
   * The hilt is the ONE part of a figure that is not built by `Bodies.js` and
   * therefore the one part that never took a species scale. Measured on the
   * shipped small frame (tools/_stature.mjs), in units of the hand holding it:
   *
   *     hilt / hand      human 2.44        smallfolk 6.10
   *
   * A 0.24 m bar through a 0.04 m fist is a quarterstaff. It is also why the
   * arms sat high after the guard itself was fixed: `GRIP_AT.R` is a HILT-local
   * +0.050, so the fist is pushed 50 mm up a blade that points upward in a
   * guard — a tenth of a human's arm and a fifth of this one's — and both fists
   * straddle a 65 mm span of shaft on a hand only 40 mm wide, which cannot
   * close on it and cannot look like it has.
   *
   * WHY IT SHRINKS AT ALL, since a lightsaber is a machined object and not a
   * texture: because the reference says so. `assets/reference/units/heroes/
   * yoda.jpg` is a SHOTO — the metal standing clear above the fist is about one
   * fist, and below it about half of one, which is the same proportion Obi-Wan's
   * Graflex has in his much bigger hand two plates over. Across all fourteen
   * plates the constant is not the hilt's length in centimetres, it is the hilt
   * against the hand. At the hand's own scale this hilt is 96 mm — a heavy
   * torch, not "nothing" — and it lands at 2.44 hands, the human's figure
   * exactly, without that number being typed anywhere.
   *
   * The BLADE is untouched. `bladeLength` is a player setting and a combat
   * reach, and a smaller wielder is not carrying a shorter sword; only the
   * emitter face comes down with the hilt it is machined into, which shortens
   * the whole weapon by 9 cm on a 1.3 m one.
   */
  setGripScale(g = 1) {
    this.gripScale = g;
    if (this.hilt) this.hilt.scale.setScalar(g);
    this.emitterY = (this._emitter0 ?? this.emitterY ?? 0) * g;
    if (this.bladeGroup) this.bladeGroup.position.y = this.emitterY;
    return this;
  }

  /**
   * The emission profile, in metres of gaussian sigma and in linear radiance.
   *
   * These numbers are not taste. They were solved against the arena's actual
   * back end — exposure 0.68, ACES in its MATRIX form, the composite grade
   * (gain 1.04/1.00/0.95, saturation 1.06) — over the sand radiance measured
   * out of a real capture with the blade hidden, (0.73, 0.40, 0.156).
   *
   * The matrix is the whole reason a blade goes white, and it is not obvious:
   * ACES mixes 0.355·G + 0.048·B into the RED input channel before the curve.
   * A cerulean crystal has hue.r = 0.044, so per-channel arithmetic says its
   * core can never blow out red — and yet it does, because the green and blue
   * leak sideways. Solving that properly is what lets the core width be chosen
   * rather than discovered.
   *
   * What the old numbers (5.6/23/88 mm at 30/2.75/0.50) actually produced, at
   * a blade 227 px long — measured, not assumed:
   *
   *   fully clipped core   ±0.6 px   ~3 mm    — a hairline, i.e. "a white line"
   *   near-white core      ±1.2 px
   *   blue-dominant out to  5 px    ~25 mm
   *   over the bloom line   9 mm             — almost nothing for bloom to find
   *
   * and with these:
   *
   *   fully clipped core   ±2.3 px  ~12 mm    a 23 mm blown core: a real blade
   *   near-white core      ±3.4 px  ~17 mm
   *   blue-dominant out to 12 px    ~61 mm    five core widths of colour
   *   over the bloom line  25 mm              a coloured halo bloom can chew on
   *
   * The halo lobe is deliberately NOT allowed to clip: it tops out around 1.5,
   * which lands mid-curve where ACES still keeps chroma. The core is 39× that,
   * which is what buys the white.
   *
   * One thing this cannot fix, and it is worth writing down so nobody chases
   * it: over sunlit sand, screen B−R for an additive blue emitter maxes out at
   * 0.084 whatever the amplitude, because red is already at 0.73 radiance
   * before the blade adds anything. On the wielder's dark robe the same profile
   * reaches B−R = 0.53. Saturated halos live against dark, never against sun.
   *
   * ── AND THEN IT WAS TOO FAT ─────────────────────────────────────────────
   *
   * The paragraph above solved the OPPOSITE fault — a hairline core with
   * nothing for bloom to find — and overshot. Reported as "the blade covers way
   * too much of the screen" and "reads as a white flurry", and the numbers
   * agree: the white — the part with no crystal left in it, measured through
   * ACES on the same probe vfx.mjs uses — ran 13 to 37 mm of RADIUS depending
   * on the crystal, i.e. a blown bar up to 74 mm across on a weapon whose prop
   * is 40 mm of glass, and the band over the bloom threshold reached 47 mm.
   * Two lobes were doing that and only one of them was the core: at coreWidth 1
   * the GLOW lobe's own 6.5 is over the ACES white point all by itself, so it
   * whited out to 17 mm before the core was counted.
   *
   * So the fix is on the two inner lobes and the fix is geometric — sigma, not
   * amplitude. The core stays at 58 because that is what keeps it CLIPPED (the
   * blown radius only goes as sqrt(ln amp), so halving the amplitude would buy
   * 13% of width and cost the core its share of the flux, which is the one
   * thing CORE_WHITE depends on — see tools/checks/saber-light.mjs). Pinching
   * the sigmas costs nothing but width, which is the complaint.
   *
   *                        was                 now
   *   core sigma          11.0 mm             7.0 mm
   *   glow sigma          33.0 mm            20.0 mm   amp 6.50 -> 5.20
   *   halo sigma         105.0 mm            90.0 mm   amp 1.50 -> 1.45
   *   quad radius        360   mm           309   mm   (same 3.43 halo sigmas)
   *
   * measured on the same five crystals vfx.mjs pins, white core radius and the
   * radius the crystal's own chroma still survives to:
   *
   *     crystal   white mm        coloured mm      coloured/white
   *     red       13.0 ->  8.0    159 -> 134        12.2 -> 16.8
   *     amber     17.6 -> 10.8    196 -> 166        11.1 -> 15.4
   *     purple    18.8 -> 11.4    146 -> 123         7.7 -> 10.8
   *     blue      22.6 -> 13.2    174 -> 148         7.7 -> 11.2
   *     green     36.8 -> 20.6    214 -> 182         5.8 ->  8.8
   *
   * The white core roughly halves; the coloured halo gives up a sixth. That
   * ratio is the design statement — a bright thin core in a coloured halo —
   * and every crystal's is now HIGHER than it was, so the existing bound in
   * vfx.mjs (`coloured/white > 5`) is met by a wider margin than before rather
   * than re-derived down to fit. The band over the bloom threshold falls from
   * 47 mm to 28 mm, which is what the bloom pass actually eats.
   *
   * The core keeps 63% of the blade's flux (63.2% before, 63.4% now): the
   * sigmas moved almost proportionally on purpose, because that share is what
   * makes neutralising the core the right lever and it was not up for trade.
   */
  static PROFILE = {
    width: [0.0070, 0.0200, 0.090],
    amp:   [58.0,   5.20,   1.45],
    radius: 0.309,
  };

  /**
   * The per-VIEW pinch on that profile. See _syncWidth for the derivation; the
   * short version is that first person is five times the angular size and the
   * bloom pass works in screen space.
   *
   * NEUTRAL is 1.0 in every slot and `x * 1` is exact in IEEE float, so a
   * third-person blade comes out of _syncWidth bit-for-bit what it was before
   * this existed — which is what lets the whole saber-bloom suite, every one of
   * whose bounds was measured in third person, stay untouched.
   */
  static NEUTRAL_PINCH = { width: [1, 1, 1], amp: [1, 1, 1] };
  static FP_PINCH = { width: [0.82, 0.66, 0.52], amp: [0.90, 0.72, 0.58] };

  /**
   * HOW MUCH OF THE CORE LOBE'S CHROMA IS GIVEN UP, and why there is any.
   *
   * Set from measurement. The established experiment for "why does the wielder
   * look wrong" was the same walk with the blade LIT and with it RETRACTED, and
   * it is a real effect — but retracting the blade removes two different things
   * at once, the two POINT LIGHTS and the drawn emitter, and the difference
   * between those had never been measured. Rendering one frozen frame of the
   * real level once per condition separates them (tools/_wielder.mjs sweep),
   * reading the wielder's silhouette masked off the retracted cell:
   *
   *     wielder, dune sea, one pose             R/B
   *     blade retracted (control)              0.984
   *     blade DRAWN, both point lights ZERO    0.303    <- already ruined
   *     as shipped                             0.283
   *     as shipped, bloom pass disabled        0.650    <- most of it back
   *
   * The drawn blade with its lights switched off does 88% of the damage, and
   * disabling the bloom pass with the lights switched back ON undoes most of it.
   * So what flattens a wielder is not what the blade throws, it is the bloom
   * halo of what the blade IS — and that halo is the crystal's hue at 22:1
   * blue-to-red, laid over the figure as a wash.
   *
   * It is a wash because the pass sees the core at 58 against its 1.8 threshold
   * and spreads it over a quarter of the screen. The core carries 63% of the
   * blade's flux (amp x sigma, the line integral), and it is the ONE lobe whose
   * chroma nothing needs: it is 39x over the clip, so it renders white either
   * way — but bloom samples the linear buffer BEFORE the tonemap, where it is
   * not white at all, it is (2.5, 22, 58). Neutralising it there costs the
   * drawn blade nothing and takes the veil's blue-to-red from 22:1 to about 2:1.
   *
   * The GLOW and HALO lobes keep the crystal's hue untouched, which is the part
   * that has to stay: they are the coloured halo, they are what still says blue,
   * and the glow lobe is over the bloom threshold too, so the bloom stays
   * tinted — just no longer monochromatic.
   *
   * What it is worth, old and new rendered from the SAME frozen frame of the
   * same build so the level cannot move between them:
   *
   *     wielder            R/B     p10..p90 band   overlap with control
   *     retracted         1.020    [0.56, 1.33]         —
   *     before            0.364    [0.11, 0.76]        26%
   *     after             0.638    [0.38, 0.95]        51%
   *
   * The band is the point. Before, the whole middle 80% of the figure was
   * COLDER than the coldest fifth of its own material — there was no overlap
   * worth the name, which is what "it lost its material" means as a number.
   * Luminance is deliberately quoted separately and barely moves (1.96x -> 1.99x
   * of the retracted figure): this is a chroma fix and it is not allowed to be
   * anything else.
   *
   * IT ALSO DRIVES THE TRAIL, and did not until this round. The smear ended
   * `vec3 c = uHue * e` while its own comment claimed the freshest slice "whites
   * out" — it never did, `hot` only raised the amplitude of the same 22.9:1 blue.
   * Measured the same way, one frozen frame of a real slash on the dune sea
   * (tools/_wielder.mjs sweep --clip slash), wielder silhouette, 12086 px:
   *
   *     blade retracted (control)                       R/B 0.995
   *     blade drawn, smear HIDDEN                           0.676   overlit 2.98x
   *     + the old smear                                     0.654   overlit 3.26x
   *     + chroma fixed only  (defect 1 alone)                0.668   overlit 3.26x
   *     + amplitudes fixed only (defect 2 alone)             0.657   overlit 3.15x
   *     + as now shipped                                    0.667   overlit 3.16x
   *
   * Read it as a decomposition, because that is the point of the two middle rows:
   * the chroma half moves R/B by +0.014 and luminance by NOTHING (3.26x -> 3.26x,
   * which is the mix toward hueN doing exactly what it promises), and the width
   * half moves luminance by -3% and R/B by +0.003. Neither can be credited with
   * the other's work. Together they give back 59% of the damage the smear does to
   * the figure — and the smear's damage is only 7% of the blade's own on this
   * frame, because the blade is held against the body while the arc sweeps away
   * from it. Over the whole frame the smear is the bigger object: it moves 16% of
   * the pixels, against the blade's bloom which moves 50%.
   */
  static CORE_WHITE = 0.85;

  /**
   * HOW MUCH THE LEVEL'S OWN AIR IS ALLOWED TO ASK FOR, at the top end.
   *
   * The bright hazy grounds — the snowfields and the arena, where the sky sits
   * near the top of the range — are exactly the ones the player named. This is
   * the most the outer lobes may be lifted on the worst of them; a clear dark
   * level asks for nothing and gets 1.0.
   */
  static ENV_GAIN_MAX = 1.42;

  /**
   * Tell the blade what air it is being swung in.
   *
   * Called by the world when a level's atmosphere is installed. `haze` is the
   * fog density and `skyLum` the sky's linear luminance — the two things that
   * decide how much of the additive skirt survives — and both are read off the
   * level rather than typed here, so this cannot drift from the sky it is
   * compensating for. Safe to call with nothing: it resets to neutral.
   */
  setEnvironment({ haze = 0, skyLum = 0 } = {}) {
    /* NORMALISED ACROSS THE SHIPPED SPREAD, not against a round number.
     *
     * The first cut divided by the default density and by the brightest sky,
     * and every one of the seven levels came out at the ceiling — which is a
     * flat brightness rise wearing a per-level costume. These are the measured
     * ends of what the game actually presents: fog runs 0.0044 (drifts) to
     * 0.0125 (wood), and sky luminance 0.19 (mustafar) to 0.66 (alpine). A
     * level at the clear, dark end asks for nothing.
     *
     * `** 1.5` biases the middle down so only a genuinely bright or genuinely
     * thick ground collects most of the lift; `max` rather than a sum because
     * either condition alone is enough to out-vote an additive skirt, and a
     * level that is both should not be paid twice. */
    const span = (v, lo, hi) => Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
    const want = Math.max(span(haze, 0.0044, 0.0125), span(skyLum, 0.19, 0.66)) ** 1.5;
    this.envGain = 1 + (Saber.ENV_GAIN_MAX - 1) * want;
    this._syncWidth?.();
    return this.envGain;
  }

  /**
   * The smear's two amplitudes, as FRACTIONS of the blade lobes they are tied to.
   * See _buildTrail for what the tie means and _syncWidth for what keeps it.
   *
   * They used to be absolute numbers — `PROFILE.amp[1] * 0.85` evaluated once at
   * class-definition time — which made the tie a comment rather than a fact. The
   * blade's lobes scale with the width slider and these did not, so at the
   * shipped default of 0.7 the smear's hot lobe was 5.525 against a glow lobe of
   * 4.55 — 1.21x the lobe it is defined as 0.85x OF, a 1.43x drift — and its glow
   * lobe was 2.25 against a halo lobe of 0.735, 3.06x what it is defined as 1.5x
   * of, a 2.04x drift. Worse, the smear's hot lobe was then 7.5x the whole halo
   * lobe of the blade that drew it. Stated as fractions there is nothing to drift.
   */
  static TRAIL_HOT_OF_GLOW = 0.85;
  static TRAIL_GLOW_OF_HALO = 1.5;

  /**
   * The standing instability's amplitude on an untuned crystal — the constant
   * that used to be written into BLADE_FRAG as `n * 0.030`. Named here so
   * BLADE_TUNING's factors have something to be factors OF, and so nothing can
   * change the default without the checks noticing.
   */
  static UNSTABLE = 0.030;

  /** How long one slice of the smear lives, in seconds, on an untuned blade. */
  static TRAIL_LIFE = 0.17;

  _buildBlade() {
    this.bladeGroup = new THREE.Group();
    this.bladeGroup.position.y = this.emitterY;
    this.root.add(this.bladeGroup);

    const P = Saber.PROFILE;
    // The initial values only; _syncWidth below is what owns them from here on.
    const w = this.coreWidth;

    // Two triangles. aQuad.x runs across the blade, aQuad.y along it.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array([
      -1, 0, 1, 0, 1, 1, -1, 1,
    ]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    this.bladeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHue: { value: new THREE.Color(1, 1, 1) },
        uWidth: { value: new THREE.Vector3(P.width[0] * w, P.width[1] * w, P.width[2] * w) },
        uAmp: { value: new THREE.Vector3(...P.amp) },
        uRadius: { value: P.radius * w },
        uLen: { value: 0.001 },
        uFlicker: { value: 1 },
        uTime: { value: 0 },
        uSurge: { value: 0 },
        uCoreWhite: { value: Saber.CORE_WHITE },
        uUnstable: { value: Saber.UNSTABLE },
      }]),
      vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
      // The shader emits vec4(c, 1.0) with the colour already carrying all of
      // its own weight, so the blend must be ONE/ONE. Without this flag three
      // uses SRC_ALPHA/ONE, which happens to be the same here — but only
      // because alpha is 1, and saying so keeps it that way.
      premultipliedAlpha: true,
      fog: true,
      side: THREE.DoubleSide, toneMapped: true,
    });
    this.blade = new THREE.Mesh(geo, this.bladeMat);
    this.blade.frustumCulled = false;
    this.blade.renderOrder = 12;
    this.bladeGroup.add(this.blade);
    this.bladeGroup.visible = false;
    this._syncWidth();
  }

  /**
   * The core width, and everything built out of it, in one place.
   *
   * `coreWidth` used to be a plain field that these three lines read ONCE, at
   * construction. Focusing Crystal does `p.saber.coreWidth *= 1.25` on a saber
   * that is already in the player's hand, so measured on a live blade the field
   * went 1 → 1.25 and uWidth stayed (0.0110, 0.0330, 0.1050), uRadius stayed
   * 0.360 and trailThickness stayed 0.0528 — sixty frames later, still. Two of
   * that card's three promises ("a brighter, hotter blade… the trail burns
   * wider") were dead; only cutPower landed.
   *
   * Null-safe on purpose: the constructor assigns coreWidth before the blade
   * material or the trail exist, and the forge preview rebuilds a Saber from
   * scratch on every drag of the width slider.
   *
   * The 1.6 on the trail is the blade's HALO lobe, not a taste number: the
   * smear is the swept slab of the thing that made it, and a slab thinner than
   * the blade's own glow reads as a decal stuck on behind it.
   *
   * The smear's two AMPLITUDES live here for the same reason its thickness does,
   * and they did not until this round — see the second half of the body.
   */
  get firstPerson() { return this._firstPerson; }
  set firstPerson(v) {
    const b = !!v;
    if (b === this._firstPerson) return;    // _syncWidth is not free; a no-op write is common
    this._firstPerson = b;
    this._syncWidth();
  }

  _syncWidth() {
    const w = this._coreWidth, P = Saber.PROFILE;
    /**
     * FIRST PERSON IS A DIFFERENT ANGULAR SIZE, and the bloom pass works in
     * screen space.
     *
     * The profile above is measured and tuned in THIRD person, where the
     * camera sits 3.05 m back and the blade is another 1.4 m out in front of
     * the chest — call it 3.5 m of eye-to-blade. In first person the emitter
     * is in the player's own hand and the blade runs out from roughly 0.7 m.
     * That is five times the angular size, so the same world-space lobe covers
     * five times the screen WIDTH and twenty-five times the screen AREA, and
     * every one of those pixels is over the bloom threshold. Nothing about the
     * blade changed between views; the solid angle did.
     *
     * THE LEVER IS SIGMA AND NOT AMPLITUDE, which is not a preference — the
     * blown radius of a gaussian against a threshold goes as
     * sigma·sqrt(2·ln(amp/t)), so it is LINEAR in sigma and only square-root-
     * of-log in amplitude. tools/checks/saber-bloom.mjs reached the same
     * conclusion the last time this was pinched and says so at length.
     *
     * `FP_PINCH` is deliberately not 1/5. Matching the screen-space halo
     * exactly would put the core sigma at 1.4 mm, which is not a lightsaber,
     * it is a scratch. It is the largest step that leaves the core reading as
     * a blade in the hand — the halo takes most of the cut because the halo is
     * the term that is actually spread across the frame, and the core takes
     * least because the core is the object.
     */
    const V = this.firstPerson ? Saber.FP_PINCH : Saber.NEUTRAL_PINCH;
    /* THE ORDER'S TUNING IS A FACTOR ON EVERY LOBE, applied here and nowhere
     * else, for exactly the reason the width slider is: a second place that
     * writes uWidth is a second place that can be forgotten. NEUTRAL_TUNING is
     * 1.0 in all of them and `x * 1` is exact, so an order-less blade comes out
     * of this bit-for-bit what it was. */
    const T = this._tuning;
    // The two lobes the SMEAR is defined against, computed once here so the
    // blade and the trail cannot be given different exponents by accident.
    /* AND THE GROUND GETS A SAY, because the skirt is additive.
     *
     * BLADE_FRAG's long note works out that the colour "drowning out" in
     * weather is not a curve in the shader — the halo is already wide and
     * fully saturated — it is that an ADDITIVE skirt over a bright hazy
     * background is a smaller fraction of it. That makes it a per-LEVEL
     * quantity, and this is where a level gets to state it.
     *
     * DERIVED, not authored per level: a `bladeGain:` column on seven
     * atmospheres is seven numbers to keep in step with seven skies, which is
     * the drift HANDOFF §2.3 is about. `envGain` is computed from the level's
     * own fog density and sky luminance when the world hands them over, so a
     * level that is re-lit carries its blade with it. 1.0 when nobody has said
     * anything, and `x * 1` is exact — an unlit blade is bit-for-bit what it
     * was. Only the two OUTER lobes take it: the core is already clipped white
     * at 32x the bloom threshold and lifting it further buys nothing but a
     * fatter white stick. */
    const G = this.envGain ?? 1;
    const glow = P.amp[1] * w * T.amp[1] * V.amp[1] * G;
    const halo = P.amp[2] * w * w * T.amp[2] * V.amp[2] * G;
    if (this.bladeMat) {
      this.bladeMat.uniforms.uWidth.value.set(
        P.width[0] * w * T.width[0] * V.width[0],
        P.width[1] * w * T.width[1] * V.width[1],
        P.width[2] * w * T.width[2] * V.width[2]);
      // The quad has to reach past the widest lobe, so an order that opens the
      // halo up has to open the quad with it or the halo is cut off square.
      this.bladeMat.uniforms.uRadius.value = P.radius * w * T.radius * V.width[2];
      // THE WIDTH SLIDER HAS TO REACH THE BLOOM, or it does not do what its
      // label says. It used to scale only the gaussian SIGMAS, and the player
      // reported — twice — that the blade "covers way too much of the screen in
      // both 1st person and 3rd person even with the width fully reduced".
      // They were right, and the reason is that bloom is driven by AMPLITUDE,
      // not width: the core sits at 58 against UnrealBloomPass's 1.8 threshold,
      // 32x over, and no setting moved it. A narrower blade bloomed exactly as
      // hard and the halo it threw was the same brightness, just over a
      // slightly smaller disc.
      //
      // The core keeps most of its punch (a lightsaber's centre is meant to be
      // blown out, and scaling it linearly would make a thin blade a dull
      // stripe), but the GLOW and HALO — the two terms that actually spread
      // across the screen — now scale with the setting, superlinearly for the
      // halo because that is the one you see from the far side of an arena.
      this.bladeMat.uniforms.uAmp.value.set(
        P.amp[0] * (0.55 + 0.45 * w) * T.amp[0] * V.amp[0], glow, halo);
    }
    this.trailThickness = P.width[1] * 1.6 * w;
    /* AND IT HAS TO REACH THE SMEAR, for the same reason and with more force.
     *
     * The paragraph above is about screen area, and the trail is nothing BUT
     * screen area: it is a whole blade's length dragged through a whole arc, and
     * its amplitude is the only handle the slider has on it — unlike the blade,
     * whose sigmas and quad shrink with the setting, the smear's geometry is the
     * arc the wrist made and does not shrink with `w` at all. Only the 5 cm slab
     * between the three sheets does.
     *
     * The exponents are not a choice. TRAIL_HOT_OF_GLOW and TRAIL_GLOW_OF_HALO
     * define the smear as a fraction of two blade lobes, so they inherit those
     * lobes' exponents — `w` and `w*w` — or the definition is false at every
     * width but 1. Measured on cerulean (luminance factor 0.3579) at the peak of
     * the freshest slice with all three sheets stacked, against the bloom pass's
     * 1.8 threshold:
     *
     *     width   trail peak lum   was
     *     0.45         1.34        4.30    under the line: the slider can now
     *     0.70         2.30        4.30    switch the smear's bloom OFF
     *     1.00         3.65        4.30
     *     1.60         6.99        4.30
     *
     * i.e. it went from a flat 4.30 at every setting — a player who dragged the
     * width to minimum got the identical blooming ribbon — to a 5:1 range with
     * the bottom of it under the threshold entirely.
     *
     * The left column moved down a further sixth when the blade's own profile
     * was pinched (see PROFILE — glow 6.50 -> 5.20, halo 1.50 -> 1.45): the
     * smear is DEFINED as a fraction of those two lobes, so it inherits the
     * thinning without anything here changing, which is the whole point of
     * stating it as a fraction. Full width was 4.30 then and is 3.65 now. */
    this.trailHot = glow * Saber.TRAIL_HOT_OF_GLOW;
    this.trailGlow = halo * Saber.TRAIL_GLOW_OF_HALO;
  }

  /**
   * One home for the width. Reading it is a plain read (Bolts.js sizes the
   * bolt-catch radius off it every frame); WRITING it is what pushes it into
   * the uniforms, which is why this is an accessor and not a setWidth() the
   * boon table would have to remember to call.
   *
   * An accessor pair is not a method (`Object.getOwnPropertyDescriptor` gives
   * get/set, never value), so this does not put a property over a method of the
   * same name — the class of bug tools/checks/shadowing.mjs exists for.
   */
  get coreWidth() { return this._coreWidth; }
  set coreWidth(v) { this._coreWidth = v; this._syncWidth(); }

  /**
   * THE ORDER, live.
   *
   * Writable so the forge preview can flip between Jedi, Sith and Grey without
   * rebuilding a Saber — and writing it re-machines the HILT as well as
   * re-tuning the blade, because a hilt that kept its old metal while the blade
   * changed is precisely the half-wired feature the checks in this project
   * exist to catch. An unknown id falls back to the untuned blade rather than
   * throwing: a stored settings blob from an older build must not be able to
   * stop the game booting.
   */
  get order() { return this._order; }
  set order(v) {
    const id = v && BLADE_TUNING[v] ? v : null;
    if (id === this._order) return;
    this._order = id;
    this.temper = 0;
    this._retune();
  }

  /** Is this order's blade one whose tuning moves with `temper`? */
  get tempered() { return !!(this._order && BLADE_TUNING[this._order]?.tempered); }

  /**
   * Push the current order (and, for the Grey, the current temper) into
   * everything that draws.
   *
   * ONE writer for all of it, for the same reason _syncWidth is one writer for
   * the lobes: the tuning reaches five different objects — two shader materials,
   * the trail's lifetime, the hilt's four metals and the temporal flicker — and
   * the way this feature would rot is by growing a second place that sets three
   * of the five.
   */
  _retune() {
    this._tuning = tuningAt(BLADE_TUNING[this._order], this.temper);
    const T = this._tuning;
    this._syncWidth();
    if (this.bladeMat) {
      this.bladeMat.uniforms.uCoreWhite.value = T.coreWhite;
      this.bladeMat.uniforms.uUnstable.value = Saber.UNSTABLE * T.unstable;
    }
    if (this.trailMat) this.trailMat.uniforms.uCoreWhite.value = T.coreWhite;
    this.trailLife = Saber.TRAIL_LIFE * T.trailLife;
    // The metal does not move with the temper — tuningAt hands back the order's
    // own table entry by reference — so this runs on an order change and not
    // sixty times a second on a Grey player's hilt. Identity, not deep compare:
    // the tables are module constants and are never mutated.
    if (this.hiltMetals && this._hiltMetal !== T.metal) {
      this._hiltMetal = T.metal;
      const M = T.metal, m = this.hiltMetals;
      m.steel.color.setHex(M.steel); m.steel.roughness = M.steelRough;
      m.dark.color.setHex(M.dark);
      m.black.color.setHex(M.black);
      m.gold.color.setHex(M.gold); m.gold.roughness = M.goldRough;
    }
  }

  /**
   * Move the temper toward what the wrist is doing, and re-tune if it moved.
   *
   * IT HAS TO LAND ON THE TARGET, not merely approach it. An exponential never
   * arrives, and a blade that settles a thousandth short of composed is a latch
   * rather than a temper: it would hold a sliver of fury for the rest of the run
   * and re-write eleven uniforms every frame to keep holding it. The snap is
   * what makes "a blade at rest is at rest" true, and it is also the whole cost
   * control — a still Grey blade does no work at all here, and neither does a
   * blade of any other order.
   */
  _updateTemper(dt) {
    if (!this.tempered || !(dt > 0)) return;
    const want = clamp((this.swingSpeed - TEMPER.floor) / TEMPER.span, 0, 1);
    if (this.temper === want) return;
    const rate = want > this.temper ? TEMPER.rise : TEMPER.fall;
    let next = this.temper + (want - this.temper) * Math.min(1, dt * rate);
    if (Math.abs(want - next) < 1e-3) next = want;
    if (next === this.temper) return;
    this.temper = next;
    this._retune();
  }

  /**
   * The trail is SHEETS × SAMPLES quads. Three sheets, offset along the normal
   * of the surface the blade swept, so the smear has thickness: a vertical
   * chop puts the swept plane edge-on to the camera, and a zero-thickness
   * ribbon disappears completely in exactly the strike you most want to see.
   */
  /**
   * THE BLADE THAT IS NOT PLASMA — a vibrosword or an electrostaff.
   *
   * Built into the SAME `bladeGroup` transform, so it starts at the emitter
   * and runs up +Y exactly as the plasma quad does. That is the whole trick:
   * every consumer of this class works in blade-space off `base` and `tip`,
   * which are computed from `bladeLength` and the root's pose and know nothing
   * about which mesh is drawn. A body swapped from plasma to alloy fights
   * identically and looks like a droid with a sword.
   *
   * Neither shape is emissive and neither is in the bloom pass. `Cel.js` grades
   * them like any other lit surface, which is the point — the complaint was
   * that a droid's weapon GLOWED.
   */
  _buildPhysicalBlade() {
    const L = this.bladeLength;
    const g = new THREE.Group();
    g.position.y = this.emitterY;
    this.root.add(g);
    this.hardGroup = g;
    this.hardGroup.visible = false;

    if (this.weaponStyle === 'staff') {
      /* AN ELECTROSTAFF IS A POLE WITH THE CHARGE AT THE ENDS, and it is
       * double-ended: the shaft runs BOTH ways off the grip, which is what
       * makes an IG-100 read as an IG-100 from a hundred metres. The hand is
       * at the middle, so the near half hangs below the emitter. */
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.019, L * 1.72, 7),
        new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.75 }));
      shaft.position.y = L * 0.36;
      g.add(shaft);
      const collar = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.35, metalness: 0.9 });
      for (const y of [L * 0.10, L * 0.62]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 8), collar);
        c.position.y = y; g.add(c);
      }
      /* THE CHARGE. Two short emissive tips and nothing between them — the one
       * place a physical weapon is allowed to emit, because that is what the
       * weapon IS. They are the only thing on the staff that answers
       * `_applyColour`, which is why the colour is taken here and not shared
       * with the plasma material. */
      const arc = new THREE.MeshBasicMaterial({ color: this.glowColor, transparent: true, opacity: 0.92 });
      this.staffArcs = [];
      for (const y of [L * 1.16, L * -0.44]) {
        const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.030, 0.10, 3, 6), arc);
        tip.position.y = y; g.add(tip); this.staffArcs.push(tip);
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.15, 6),
          new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.45, metalness: 0.8 }));
        claw.position.y = y - Math.sign(y || 1) * 0.11;
        claw.rotation.x = y > 0 ? 0 : Math.PI;
        g.add(claw);
      }
      return;
    }

    /* A VIBROSWORD: a flat ground blade with a fuller down the middle and a
     * clipped point. Two boxes and a wedge — it is seen at ten metres in a
     * crowd and every extra face is per-body cost in exactly the mode that
     * fields thirty of them. */
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.24, metalness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.4, metalness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, L * 0.88, 0.014), steel);
    body.position.y = L * 0.44; g.add(body);
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.018, L * 0.78, 0.017), dark);
    fuller.position.y = L * 0.44; g.add(fuller);
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.030, L * 0.20, 4), steel);
    point.position.y = L * 0.96; point.rotation.y = Math.PI / 4;
    point.scale.set(1, 1, 0.45); g.add(point);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.026, 0.030), dark);
    g.add(guard);
  }

  _buildTrail() {
    this.trailSegments = 30;
    this.trailSheets = 3;
    // Half the thickness of the swept slab — set by _syncWidth, which is the
    // only writer of it, so a width change mid-run reaches the smear as well as
    // the blade. `(k - 1) * TH` in _updateTrail is what spends it.
    this._syncWidth();
    const n = this.trailSegments, S = this.trailSheets;
    const verts = n * S * 2;
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(verts * 3);
    this.trailAge = new Float32Array(verts);
    this.trailPunch = new Float32Array(verts);
    const side = new Float32Array(verts);
    const thick = new Float32Array(verts);
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < S; s++) {
        const v = (i * S + s) * 2;
        side[v] = 0; side[v + 1] = 1.05;      // carried a little past the tip
        thick[v] = thick[v + 1] = s - 1;      // -1, 0, +1
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < S; s++) {
        const a = (i * S + s) * 2, b = a + 1;
        const c = ((i + 1) * S + s) * 2, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPunch', new THREE.BufferAttribute(this.trailPunch, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aThick', new THREE.BufferAttribute(thick, 1));

    /* The smear's two amplitudes are derived from the blade's own lobes so the
     * two cannot drift apart — _syncWidth owns both ends of that tie: the
     * freshest slice runs at 0.85 of the GLOW lobe's temperature, which puts it
     * over the bloom line (at w = 1 the three sheets stack to linear luminance
     * 4.30 for a cerulean crystal against a threshold of 1.8, so a fast cut
     * leaves a glowing arc and not a coloured film), and the body of the smear
     * settles at 1.5 of the HALO lobe, where ACES still keeps its chroma.
     *
     * uCoreWhite is the blade's own CORE_WHITE, on the smear's own hot lobe. The
     * two are one knob on purpose: the trail is the swept volume of the blade,
     * and a smear whose leading edge is a different colour from the edge that
     * made it reads as a decal rather than as light. */
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHue: { value: new THREE.Color(1, 1, 1) },
        uGlow: { value: this.trailGlow },
        uHot: { value: this.trailHot },
        uCoreWhite: { value: Saber.CORE_WHITE },
      }]),
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      fog: true,
      side: THREE.DoubleSide, toneMapped: true,
    });
    this.trail = new THREE.Mesh(geo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 11;
    this.scene.add(this.trail);
    this.trailHistory = [];
    this._trailTimer = 0;
  }

  /* ── control ───────────────────────────────────────────────────────── */

  /**
   * A PHYSICAL WEAPON IS ALREADY OUT. `lit` stays the field every other system
   * reads — `cutPowerAt` gates on it, the duel gates on it, `bladeTargets`
   * gates on it — so a vibrosword still answers yes; what changes is that the
   * plasma quad never becomes visible and the metal is shown instead. There is
   * no ignition ramp either: `update` snaps `ignition` to 1 for these, because
   * a sword does not extend.
   */
  ignite() {
    if (this.lit) return;
    this.lit = true;
    if (this.physical) { this.hardGroup.visible = true; this.ignition = 1; return; }
    this.bladeGroup.visible = true;
  }
  retract() {
    this.lit = false;
    /* A SWORD CANNOT BE PUT AWAY MID-FIGHT, so `retract` on a physical weapon
     * only drops the flag the combat model reads. It is called by the same
     * paths that disarm a Jedi — a lost hand, a death, boarding a transport —
     * and in every one of them the metal staying in the frame is correct: it
     * is still a sword, and it is now on the floor or in a dead hand. */
  }
  toggle() { this.lit ? this.retract() : this.ignite(); }

  setHiltPose(pos, quat) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
  }

  /** Blade tip in world space for a given extension fraction (0 = base). */
  pointAt(t, out = new THREE.Vector3()) {
    return out.lerpVectors(this.base, this.tip, t);
  }

  /** Speed of the blade at a fraction along its length, this frame. */
  speedAt(t) {
    return lerp(this.baseVelocity.length(), this.tipVelocity.length(), t);
  }

  /** Effective cut power at a point: fast tips sever, slow hilts shove. */
  cutPowerAt(t) {
    if (!this.lit || this.ignition < 0.85) return 0;
    return this.speedAt(t);
  }

  update(dt, time, carrierVel = null) {
    const target = this.lit ? 1 : 0;
    const rate = this.lit ? 6.5 : 8.5;
    const was = this.ignition;
    this.ignition += (target - this.ignition) * Math.min(1, dt * rate);
    // How fast the blade is growing, in blade-lengths per second. The plasma
    // front is hotter than the column behind it, which is the whole read of an
    // ignition — without it the blade simply appears, one length at a time.
    this.surge = dt > 0 ? clamp((this.ignition - was) / dt / 5.5, 0, 1) : 0;
    if (this.ignition < 0.002 && !this.lit) { this.bladeGroup.visible = false; this.ignition = 0; }
    else if (this.ignition > 0.002) this.bladeGroup.visible = true;

    const len = this.bladeLength * this.ignition;
    this.root.updateMatrixWorld(true);

    // sweep bookkeeping
    this.prevBase.copy(this.base);
    this.prevTip.copy(this.tip);
    this.base.set(0, this.emitterY, 0).applyMatrix4(this.root.matrixWorld);
    this.tip.set(0, this.emitterY + len, 0).applyMatrix4(this.root.matrixWorld);
    this.axis.subVectors(this.tip, this.base);
    const alen = this.axis.length();
    if (alen > 1e-5) this.axis.multiplyScalar(1 / alen); else this.axis.set(0, 1, 0);

    /**
     * THE BLADE ON THE GROUND.
     *
     * Reported as "saber contact with the ground must do something with a real
     * effect", and it did nothing at all: `Particles.bladeScar` — molten line,
     * spatter, smoke, cooling scorch — existed with ZERO callers anywhere in
     * src/, because the blade solver only ever tests enemies, props and doors,
     * and the ground is none of those.
     *
     * This is the whole call. `ground.scar` owns the ground-proximity gate, the
     * minimum stroke, the 15 Hz throttle against the decal ring, the trench it
     * presses into the loose layer, the glow, the char it cools to and the
     * spatter — see Scenery.js — so the blade does not have to know what it is
     * dragging through.
     */
    if (this.lit && this.valid) ground.scar(this.prevTip, this.tip);

    if (this.valid && dt > 0) {
      this.tipVelocity.subVectors(this.tip, this.prevTip).multiplyScalar(1 / dt);
      this.baseVelocity.subVectors(this.base, this.prevBase).multiplyScalar(1 / dt);
    } else {
      this.tipVelocity.set(0, 0, 0); this.baseVelocity.set(0, 0, 0);
      this.prevBase.copy(this.base); this.prevTip.copy(this.tip);
    }
    this.valid = true;
    this.tipSpeed = this.tipVelocity.length();

    // Swing speed is measured against the body that carries the blade, not the
    // world. Sprinting moves the tip at 7 m/s while the wrist is perfectly
    // still — read as world speed that is a swing, and the game whooshes,
    // burns stamina and blurs the screen just because you are walking.
    if (carrierVel) {
      this.swingSpeed = _v4.subVectors(this.tipVelocity, carrierVel).length();
    } else this.swingSpeed = this.tipSpeed;

    // plane the blade swept this frame — this is the cut plane
    _v1.subVectors(this.tip, this.base);
    _v2.subVectors(this.tip, this.prevTip);
    this.sweepArea = _v3.crossVectors(_v1, _v2).length();
    if (this.sweepArea > 1e-6) this.sweepNormal.copy(_v3).multiplyScalar(1 / this.sweepArea);

    // AFTER the sweep bookkeeping, because it reads this frame's swingSpeed,
    // and BEFORE the visuals, so the uniforms it writes are the ones this frame
    // draws with. A tempered blade whose retune landed a frame late would read
    // as input lag on the one order whose blade is supposed to answer the hand.
    this._updateTemper(dt);

    this._updateVisuals(dt, time, len);
    this._updateTrail(dt, len);
  }

  _updateVisuals(dt, time, len) {
    /* THE ORDER SCALES THE AC TERM AND NOT THE DC ONE.
     *
     * 0.94 is what the blade burns at; the three sine terms are what it burns
     * UNSTEADILY by. Multiplying only the second group means an unstable order
     * is a MODULATION and never a gain — the mean of `flick` over a cycle is
     * 0.94 for every order, so a Sith blade does not quietly become a 20%
     * brighter light on the world as well as a twitchier one. (Pinned in
     * tools/checks/order.mjs, which averages this expression over a second.)
     * The same discipline as CORE_WHITE's mix toward hueN: one axis at a time,
     * or no measurement afterwards can say which half did the work.
     *
     * The factor is applied to each term rather than to their sum, and that is
     * not a style choice: `0.94 + F*(a+b+c)` re-associates the addition and
     * lands one ulp away from `0.94 + a + b + c` even at F = 1, which would
     * make an order-less blade measurably — if barely — not the blade it was.
     * `(x * 0.022) * 1` is exact, so this form is bit-identical at F = 1 and
     * arithmetically the same at every other F. Measured against HEAD across
     * four crystals and 130 frames: 4 ulp of drift the other way, 0 this way. */
    const F = this._tuning.flicker;
    const flick = 0.94 + Math.sin(time * 47.3) * 0.022 * F + Math.sin(time * 111.7) * 0.014 * F
                  + this.contactStrain * 0.22 * Math.sin(time * 180) * F;
    const u = this.bladeMat.uniforms;
    u.uLen.value = Math.max(0.001, len);
    u.uTime.value = time;
    // A blade under load runs hot: the amplitude rises and the instability with
    // it, so a bind or a bolt on the blade is visible on the blade itself.
    u.uFlicker.value = flick * this.punch * (1 + this.contactStrain * 0.5);
    u.uSurge.value = this.surge * 2.4;

    const on = this.ignition > 0.05;
    if (on) {
      // The wash is split along the blade rather than pinned to its middle, so
      // a blade held low lights the floor and a blade held high does not. The
      // second sample sits at 88% rather than ON the tip: a point light exactly
      // at the tip of a blade laid on the deck is a singularity sitting on the
      // deck, and no decay exponent saves you from that.
      this.pointAt(0.42, _v1);
      this.light.position.copy(_v1);
      // 5.4 and 2.4 candela. Under 1/r these cross the old inverse-square rig
      // at 0.95 m: closer than that the blade throws less light than it used to
      // (which is the point — 55 units of irradiance on sand 30 cm away was
      // what clipped the ground to white and threw the hue away), further out
      // it throws more, and at three metres it throws three times more.
      this.light.intensity = 5.4 * this.ignition * (1 + this.contactStrain * 1.6) * flick * this.punch;
      this.light.distance = 5.6 + len * 3.6;
      this.pointAt(0.88, _v1);
      this.tipLight.position.copy(_v1);
      this.tipLight.intensity = 2.4 * this.ignition * (1 + this.contactStrain * 0.9) * flick * this.punch;
      this.tipLight.distance = 3.8 + len * 2.2;
      /* ASK, rather than BE, a light. Once a frame, both samples, with the
       * numbers above unchanged — the pool ranks the frame's requests and the
       * eight best drive real point lights. A blade that loses a slot still
       * lights the shot through its own emissive geometry and the bloom, which
       * is 88% of the visible effect (measured — see PROFILE). Unlit blades ask
       * for nothing, so `retract()` costs a slot the same frame it takes the
       * blade out. */
      /* A SWORD IS NOT A LAMP. An electrostaff's tips are, faintly, and that
       * is the whole difference between the two physical styles: the staff
       * keeps the TIP sample at a fifth of a blade's candela and drops the
       * length sample, because the charge is at the ends. A vibrosword posts
       * neither, so it costs the pool nothing. */
      if (!this.physical) {
        this.engine?.lightUp(this.light.position, this.light.color,
          this.light.intensity, this.light.distance, this.lightPriority);
        this.engine?.lightUp(this.tipLight.position, this.tipLight.color,
          this.tipLight.intensity, this.tipLight.distance, this.lightPriority);
      } else if (this.weaponStyle === 'staff') {
        this.engine?.lightUp(this.tipLight.position, this.tipLight.color,
          this.tipLight.intensity * 0.2, this.tipLight.distance * 0.5, this.lightPriority);
      }
    } else {
      this.light.intensity = 0;
      this.tipLight.intensity = 0;
    }
    this.contactStrain *= Math.max(0, 1 - dt * 6);
  }

  /**
   * How hard this instant of the sweep smears, 0..1.
   *
   * Measured against the BODY, not the world: sprinting carries the tip at
   * 7 m/s with the wrist perfectly still, and read as world speed that lays a
   * full-strength trail down behind a player who is only jogging.
   *
   * And it reaches exactly zero below 2.6 m/s. A blade at rest has to leave a
   * clean frame; the old floor of 0.08 meant one never did, so every still
   * blade dragged a permanent ribbon behind it.
   */
  _trailPunch() {
    return clamp((this.swingSpeed - 2.6) / 13, 0, 1) * this.ignition;
  }

  _updateTrail(dt, len) {
    const n = this.trailSegments, S = this.trailSheets;
    const h = this.trailHistory;
    // From _retune, so a Sith arc hangs a third longer than a temple one and a
    // Grey blade's smear lengthens as its wielder loses patience. Exactly 0.17
    // for an untuned blade.
    const LIFE = this.trailLife;
    const punch = this._trailPunch();

    if (this.ignition > 0.4) {
      const sample = (b, t, age, k) => {
        const s = { b: b.clone(), t: t.clone(), age, punch: k, n: new THREE.Vector3() };
        // The sheet normal is the normal of the surface the blade is sweeping:
        // blade axis × direction of travel. Degenerate when the blade is not
        // moving, which is also when nothing is drawn.
        _v1.subVectors(s.t, s.b);
        _v2.subVectors(s.t, this.prevTip);
        s.n.crossVectors(_v1, _v2);
        const nl = s.n.length();
        if (nl > 1e-6) s.n.multiplyScalar(1 / nl);
        else if (h.length) s.n.copy(h[0].n);
        else s.n.set(1, 0, 0);
        return s;
      };
      // On a slow frame the blade can cross a metre between samples, which
      // would leave the ribbon a fan of huge triangles. Fill in the gap so the
      // trail reads the same at 20 fps as it does at 144.
      const gap = this.tip.distanceTo(this.prevTip);
      const fill = Math.min(8, Math.floor(gap / 0.18));
      for (let i = fill; i >= 1; i--) {
        const k = i / (fill + 1);
        h.unshift(sample(_v3.lerpVectors(this.prevBase, this.base, 1 - k),
                         _v4.lerpVectors(this.prevTip, this.tip, 1 - k),
                         dt * (1 / LIFE) * k, punch));
      }
      h.unshift(sample(this.base, this.tip, 0, punch));
    } else h.length = 0;
    while (h.length > n) h.pop();

    for (const s of h) s.age += dt * (1 / LIFE);

    const pos = this.trailPos, age = this.trailAge, pun = this.trailPunch;
    const TH = this.trailThickness;
    let live = 0;
    for (let i = 0; i < n; i++) {
      const s = h[i];
      const dead = !s || s.age >= 1 || s.punch <= 0.001;
      if (!dead) live++;
      for (let k = 0; k < S; k++) {
        const v = (i * S + k) * 2, p = v * 3;
        if (dead) {
          // collapse unused segments onto the hilt so they rasterise nothing
          pos[p] = pos[p + 3] = this.base.x;
          pos[p + 1] = pos[p + 4] = this.base.y;
          pos[p + 2] = pos[p + 5] = this.base.z;
          age[v] = age[v + 1] = 1;
          pun[v] = pun[v + 1] = 0;
          continue;
        }
        const o = (k - 1) * TH;
        pos[p] = s.b.x + s.n.x * o; pos[p + 1] = s.b.y + s.n.y * o; pos[p + 2] = s.b.z + s.n.z * o;
        // carried 6% past the tip so the smear's leading edge is feathered
        pos[p + 3] = s.t.x + (s.t.x - s.b.x) * 0.06 + s.n.x * o;
        pos[p + 4] = s.t.y + (s.t.y - s.b.y) * 0.06 + s.n.y * o;
        pos[p + 5] = s.t.z + (s.t.z - s.b.z) * 0.06 + s.n.z * o;
        age[v] = age[v + 1] = s.age;
        pun[v] = pun[v + 1] = s.punch;
      }
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAge.needsUpdate = true;
    this.trail.geometry.attributes.aPunch.needsUpdate = true;
    // From _syncWidth, so the width slider and the Focusing Crystal boon reach
    // the smear's amplitudes and not only its thickness.
    this.trailMat.uniforms.uHot.value = this.trailHot * this.punch;
    this.trailMat.uniforms.uGlow.value = this.trailGlow * this.punch;
    this.trail.visible = this.ignition > 0.2 && live > 1;
  }

  /** Register a contact so the blade flares and the hum strains. */
  strain(amount) { this.contactStrain = Math.min(1.6, this.contactStrain + amount); }

  setVisible(v) {
    this.root.visible = v;
    this.trail.visible = v && this.ignition > 0.2;
    if (!v) { this.light.intensity = 0; this.tipLight.intensity = 0; }
  }

  dispose() {
    this.scene.remove(this.root, this.trail, this.light, this.tipLight);
    this.trail.geometry.dispose();
    this.trailMat.dispose();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
  }
}


/**
 * A HILT ON ITS OWN — no blade, no lights, no Saber around it.
 *
 * Extracted from `Saber._buildHilt` rather than copied, because a hilt lying on
 * the ground has to be the SAME OBJECT as the one in the hand: a second builder
 * is a second place for the Warden's belt hook to be forgotten about. See
 * `Dropped.js` — when a duellist loses the arm holding its weapon, or a player
 * puts theirs down, what falls is this group built with that weapon's own
 * crystal and style, and picking it up hands both back.
 *
 * @param tuning  a BLADE_TUNING entry, or nothing for the neutral metals
 * @param color   the crystal, for the activator studs and any lit window
 * @param style   a key of HILT_SPECS
 */
export function buildHiltGroup({ tuning, color, style }) {
  const g = new THREE.Group();
  const M = (tuning || NEUTRAL_TUNING).metal;
    const steel = new THREE.MeshStandardMaterial({ color: M.steel, metalness: 1, roughness: M.steelRough });
    const dark = new THREE.MeshStandardMaterial({ color: M.dark, metalness: 0.75, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: M.black, metalness: 0.3, roughness: 0.82 });
    const gold = new THREE.MeshStandardMaterial({ color: M.gold, metalness: 1, roughness: M.goldRough });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x2a2f38, metalness: 0.9, roughness: 0.3,
      emissive: color ?? 0x57c9ff, emissiveIntensity: 0.9,
    });
    const mats = { steel, dark, black, gold };

    const spec = HILT_SPECS[style] || HILT_SPECS.Graflex;
    const R = spec.r;
    const body = mats[spec.metal] || steel;
    const add = (mesh, y) => { mesh.position.y = y; mesh.castShadow = true; g.add(mesh); return mesh; };

    // The emitter face, and everything measured down from it.
    const top = spec.emitter;
    const bottom = top - spec.len;

    /* ── emitter shroud ─────────────────────────────────────────────── */
    const [sTop, sBot, sLen] = spec.shroud;
    add(new THREE.Mesh(new THREE.CylinderGeometry(R * sTop, R * sBot, sLen, 16, 1), body), top - sLen / 2);
    // the blade window in the shroud's mouth: dark, so the emitter reads as a
    // hole rather than as a flat end
    add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.012, 14), black), top - 0.003);

    /* ── neck rings ─────────────────────────────────────────────────── */
    const neckTop = top - sLen - 0.004;
    if (spec.rings) {
      const [n, gap, rr, th] = spec.rings;
      for (let i = 0; i < n; i++) {
        add(new THREE.Mesh(new THREE.TorusGeometry(R * rr, th, 6, 18), gold), neckTop - i * gap)
          .rotation.x = Math.PI / 2;
      }
    }

    /* ── body, grip, pommel ─────────────────────────────────────────── */
    const gripLen = spec.grip.len;
    const pommelLen = spec.pommel === 'none' ? 0.008 : 0.030;
    const gripTop = bottom + pommelLen + gripLen;
    const bodyLen = Math.max(0.02, top - sLen - gripTop);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyLen, 18, 1), body), gripTop + bodyLen / 2);

    /* THE GRIP IS ITS OWN GROUP, because a curved hilt bends HERE and nowhere
     * else: the emitter and the body stay on the blade's axis (they have to —
     * the blade is solved along it) and the grip and pommel tilt away from it,
     * which is exactly what a duelling hilt does. */
    const gg = new THREE.Group();
    gg.position.y = gripTop;
    if (spec.grip.bend) gg.rotation.x = spec.grip.bend;
    g.add(gg);
    const gr = R * spec.grip.r;
    const gadd = (mesh, y) => { mesh.position.y = y; mesh.castShadow = true; gg.add(mesh); return mesh; };
    gadd(new THREE.Mesh(new THREE.CylinderGeometry(gr, gr, gripLen, 18, 1), black), -gripLen / 2);

    const K = spec.grip.kind;
    if (K === 'ribbed' || K === 'wrapped') {
      // rings down the grip: a rib is metal and proud, a wrap is cord and sunk
      const n = Math.max(3, Math.round(gripLen / (K === 'wrapped' ? 0.0072 : 0.0092)));
      for (let i = 0; i < n; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(gr * (K === 'wrapped' ? 1.02 : 0.99), K === 'wrapped' ? 0.0018 : 0.0026, 5, 16),
          K === 'wrapped' ? black : dark);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -gripLen + (i + 0.5) * (gripLen / n);
        gg.add(ring);
      }
    } else if (K === 'plain') {
      /* Even a plain grip is not a bare tube: a machined section has a seam at
       * each end where it meets the body and the pommel. Two rings, and they
       * are the difference between "restrained" and "unfinished" — the Ascetic
       * measured six pieces before them, which tools/checks/hilts.mjs calls a
       * prop rather than a weapon, and it was right. */
      for (const yy of [-0.0015, -gripLen + 0.0015]) {
        const seam = new THREE.Mesh(new THREE.TorusGeometry(gr * 1.01, 0.0014, 5, 16), dark);
        seam.rotation.x = Math.PI / 2; seam.position.y = yy; gg.add(seam);
      }
    } else if (K === 'fluted') {
      // flutes run ALONG the grip rather than round it, which is the whole
      // difference between a grip you can turn in the hand and one you cannot
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.0022, gripLen * 0.86, 0.0022), dark);
        f.position.set(Math.cos(a) * gr, -gripLen / 2, Math.sin(a) * gr);
        f.castShadow = true; gg.add(f);
      }
    }

    /* ── the pommel, on the grip's frame so a bent hilt bends with it ── */
    const py = -gripLen;
    if (spec.pommel === 'cap') {
      gadd(new THREE.Mesh(new THREE.CylinderGeometry(gr * 1.14, gr * 0.88, pommelLen, 16, 1), body), py - pommelLen / 2);
    } else if (spec.pommel === 'sphere') {
      gadd(new THREE.Mesh(new THREE.CylinderGeometry(gr * 1.10, gr * 1.10, pommelLen * 0.5, 16, 1), body), py - pommelLen * 0.25);
      gadd(new THREE.Mesh(new THREE.SphereGeometry(gr * 0.86, 14, 10), dark), py - pommelLen * 0.72);
    } else if (spec.pommel === 'ring') {
      const ring = gadd(new THREE.Mesh(new THREE.TorusGeometry(gr * 0.95, 0.0042, 8, 20), gold), py - pommelLen * 0.55);
      ring.rotation.x = Math.PI / 2;
      gadd(new THREE.Mesh(new THREE.CylinderGeometry(gr * 0.7, gr * 0.7, pommelLen * 0.5, 14), body), py - pommelLen * 0.25);
    } else if (spec.pommel === 'spike') {
      gadd(new THREE.Mesh(new THREE.CylinderGeometry(gr * 1.05, gr * 0.5, pommelLen * 0.45, 14), body), py - pommelLen * 0.22);
      const sp = gadd(new THREE.Mesh(new THREE.ConeGeometry(gr * 0.5, pommelLen * 0.8, 10), dark), py - pommelLen * 0.82);
      sp.rotation.x = Math.PI;
    } else {
      gadd(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.94, pommelLen, 14), body), py - pommelLen / 2);
    }

    /* ── control box and studs ──────────────────────────────────────── */
    const boxY = gripTop + bodyLen * 0.55;
    if (spec.box) {
      const [bw, bh, bd] = spec.box;
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), dark);
      box.position.set(R * 0.92, boxY, 0); box.castShadow = true; g.add(box);
    }
    for (let i = 0; i < (spec.studs || 0); i++) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 10), accent);
      stud.rotation.z = Math.PI / 2;
      stud.position.set(R * 1.35, boxY + 0.012 - i * 0.014, 0);
      stud.castShadow = true; g.add(stud);
    }

    /* ── the extras, each of which is what makes one hilt that hilt ─── */
    const ex = new Set(spec.extras || []);
    if (ex.has('crossguard')) {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.5, 0.055, 12), body);
        arm.rotation.z = Math.PI / 2 * side;
        arm.position.set(0.032 * side, top - sLen * 0.75, 0);
        arm.castShadow = true; g.add(arm);
        // the vent's own glow, so the quillons read as plasma escaping rather
        // than as two rods welded on
        const vent = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.30, R * 0.30, 0.010, 10), accent);
        vent.rotation.z = Math.PI / 2 * side;
        vent.position.set(0.058 * side, top - sLen * 0.75, 0);
        g.add(vent);
      }
    }
    if (ex.has('sleeve')) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.08, bodyLen * 0.45, 16), gold);
      sleeve.position.y = gripTop + bodyLen * 0.28; sleeve.castShadow = true; g.add(sleeve);
    }
    if (ex.has('claw')) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(R * 1.3, 0.03, 8, 1, true), dark);
      claw.position.y = top - 0.005; claw.castShadow = true; g.add(claw);
    }
    if (ex.has('window')) {
      // a slot cut down the body with the crystal's own light behind it
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.004, bodyLen * 0.4, R * 1.1), accent);
      win.position.set(-R * 0.92, gripTop + bodyLen * 0.5, 0); g.add(win);
    }
    if (ex.has('collar')) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.16, R * 1.06, 0.010, 16), gold);
      collar.position.y = gripTop + 0.006; collar.castShadow = true; g.add(collar);
    }
    if (ex.has('knurl')) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const k = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.010, 0.0016), gold);
        k.position.set(Math.cos(a) * R * 1.02, gripTop + bodyLen * 0.86, Math.sin(a) * R * 1.02);
        g.add(k);
      }
    }
    if (ex.has('hook')) {
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.010, 0.0026, 6, 14, Math.PI * 1.3), dark);
      hook.position.set(-R * 1.1, gripTop + bodyLen * 0.25, 0);
      hook.rotation.set(Math.PI / 2, 0, 0); hook.castShadow = true; g.add(hook);
    }
    if (ex.has('wings')) {
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.003), body);
        w.position.set(side * R * 1.5, top - sLen - 0.006, 0);
        w.castShadow = true; g.add(w);
      }
    }

  g.scale.setScalar(1.0);
  return { group: g, accent, metals: mats, spec, emitter: spec.emitter };
}
