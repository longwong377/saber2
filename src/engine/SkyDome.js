/**
 * BATTLEFRONT BORZ — clouds and the far horizon.
 *
 * A Preetham sky is a gradient. It is physically reasonable and completely
 * empty, and an empty sky over an empty horizon is most of what makes a scene
 * read as a diorama rather than a place: there is nothing at distance for the
 * eye to measure the world against.
 *
 * This adds the two things that fix that, in ONE draw call:
 *
 *   1. A cloud deck. Clouds do more work than any other single element for
 *      "this is a real sky" — they give the dome scale, they move, and they
 *      catch the sun. Two layers: cumulus with real internal density, and thin
 *      cirrus high above drifting faster.
 *
 *   2. A horizon silhouette. Distant landforms sitting on the skyline, washed
 *      out by aerial perspective. Without this the world visibly ends where the
 *      terrain mesh stops, and no amount of fog hides that the edge is a circle.
 *
 * Both are generated from view direction alone — no geometry, no raymarching
 * through a volume, no texture fetches. The dome is a single inverted sphere
 * drawn behind everything with depth writes off.
 *
 * WHAT MAKES A CLOUD LOOK LIKE A CLOUD is not the noise. It is:
 *
 *   • self-shadowing. Light entering the top is absorbed on the way down, so a
 *     cumulus is brilliant on top and slate grey underneath. A deck shaded by
 *     `mix(dark, lit, dot(view, sun))` has no such gradient and reads as paper
 *     cut-outs — which is exactly what this used to look like.
 *   • the powder term. Near a lit edge the light has not travelled far enough
 *     to scatter back out, so thin rims go DARKER than the body, not brighter.
 *   • forward scattering. Water droplets throw light forward hard (g≈0.75), so
 *     a cloud between you and the sun has a blazing rim and a bright interior.
 *   • parallax. Clouds are hundreds of metres thick; their tops are visibly
 *     displaced from their bases as you look across the deck.
 *
 * All four are here, and all four are one or two lines each.
 *
 * AND THE LEVEL HAS TO COME FROM THE LIGHT, NOT FROM A SWATCH. This is the
 * fault that made the deck read as smoke. cloudLit/cloudDark were authored as
 * sRGB colours and used as absolute radiance, so the arena's 0xa89880 pinned
 * the shadowed side at linear (0.39, 0.31, 0.22) — brown — and the shading
 * terms took it DOWN from there: measured, a thick core came out at linear
 * 0.145 against a sky behind it at 1.49 and a skyline at 3.19. A cloud an
 * order of magnitude darker than the sky it hangs in is not a cloud, it is a
 * hole, and a brown one is a smoke smear. A cumulus is a white body with an
 * albedo near 0.9; its sunlit face is the sun's own irradiance over pi and its
 * base is what the sky and the ground throw back up at it. Those two numbers
 * arrive as uCloudSun and uCloudAmb, in the same radiance units as the rest of
 * the frame, and the authored swatches are demoted to what they always were —
 * a HUE, normalised to unit luminance and pulled most of the way to white,
 * because whatever colour a white body has comes from the light on it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { CEL_BAND_GLSL } from '../toon/Cel.js';
import { ground } from '../world/Scenery.js';
/* The sky, from the one place that derives it. Engine imports this file, so
 * this closes a cycle — safe because every one of these is a hoisted function
 * declaration and none is called while a module body is still evaluating. */
import { skyRadiance, skyShoulder, skyDisplayShoulder, sunDirection } from './Engine.js';
import { clamp, smoothstep, TAU, DEG } from './MathUtil.js';

const _lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const _WHITE = new THREE.Color(1, 1, 1);
const _scratch = new THREE.Color();
const _UP = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _spare = new THREE.Vector3();
const _scratchV = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/**
 * An authored swatch, demoted to a tint: renormalised to unit luminance so it
 * can only ever say WHAT COLOUR and never HOW BRIGHT, then pulled toward white
 * by (1 - keep). A cumulus is a white body; the arena's 0xa89880 underside is
 * 0.45 saturated as authored, and a cloud base that saturated is a mud smear
 * whatever its level, because the only chroma a white body has is the chroma
 * of the light landing on it — which arrives separately, as uSkyAmb.
 */
function tint(c, keep) {
  return unitLum(c).lerp(_WHITE, 1 - keep);
}

/**
 * No floor on the divisor. A floor is the usual guard against dividing by a
 * black swatch, and it silently breaks the guarantee tint() exists for: with a
 * 0.02 floor, 0x101014 came out at 0.78 luminance instead of 1, so an author
 * picking a very dark cloud colour was still setting the deck's LEVEL through
 * the back door. Only literal black needs handling.
 */
/** A seed number to a unit float, the way the shader's hash11 does it, so a
 *  level's `planet.seed` lands the same world for the same number. */
function hashSeed(n) {
  let x = (n * 0.1031) % 1; if (x < 0) x += 1;
  x = (x * (x + 33.33)) % 1;
  x = (x * (x + x)) % 1;
  return x < 0 ? x + 1 : x;
}

function unitLum(c) {
  const L = _lum(c);
  if (L > 1e-5) c.multiplyScalar(1 / L); else c.copy(_WHITE);
  return c;
}

/* ── the sky, as a function of where you are looking ────────────────────
 *
 * Everything the dome paints below the cloud deck used to converge on
 * uHazeColor, and uHazeColor is ONE COLOUR. hazeRadiance anchors it to the
 * skyline BESIDE THE SUN, which is the brightest sky there is, so on the shade
 * half of the horizon the dome was painting ranges and a haze band BRIGHTER
 * than the sky they sit in. Measured on the dune atmosphere, drawn sky
 * radiance at 8° elevation against the one fog colour:
 *
 *     bearing from sun     20°    65°   110°   155°
 *     drawn sky           0.821  0.589  0.444  0.391
 *     uHazeColor                  0.589 everywhere
 *
 * One and a half to one on the anti-sun side. That is the milky horizon, and
 * it is the same fault the far ranges in Scenery.js were scored for.
 *
 * So the dome carries the sky it is standing in: a 128 × 32 map of the DRAWN
 * dome over bearing and elevation, built on the CPU from the engine's own
 * Preetham derivation whenever the level changes. Half-float, because the
 * values are radiance and 8 bits over a 0.2–1.6 range bands visibly in a
 * gradient this smooth. It costs one texture fetch and four thousand
 * evaluations per level, and it turns every painted landform from "a swatch,
 * hopefully darker than the sky" into "the sky, times an extinction" — which
 * is a thing that cannot come out brighter than what is behind it.
 *
 * 128 × 32 and not the 64 × 16 first shipped, and that is a measurement rather
 * than a round-up. Scenery's far ranges read this same array for their
 * asymptote, and the property they now have to hold is CHROMATIC — a range may
 * not be more saturated than its own sky. At 64 × 16 a texel spans 5.6° of
 * bearing and 2.6° of elevation near the horizon, and inside the aureole, where
 * the sky whites out to 0.006 saturation over a few degrees, that quantisation
 * alone made the band up to 1.20× as saturated as the sky at the same point.
 * The ranges inherited it and the check could not clear 1.0. At 128 × 32 the
 * same worst case is 1.05, and the property holds on the sky's own numbers
 * rather than on the map's resolution.
 */
/**
 * Plateaus in the deck's colour, and steps in its coverage.
 *
 * THREE, not four like the sky mesh behind it, and the reason is the range each
 * one covers. The sky spans eight to one from zenith to aureole and needs four
 * plates to keep the time of day; a cumulus spans about three to one from its
 * sunlit shoulder to its shadowed belly, so three plates put a boundary every
 * 0.8 stops — the same visual step width as the sky's four, on a third of the
 * range. Matching the COUNT rather than the step width is what makes a deck
 * read as a smoother object than the sky it hangs in, which is backwards.
 *
 * The coverage gets five, because it is a shape and not a tone: fewer and thin
 * cirrus disappears entirely between one step and the next.
 */
const CLOUD_BANDS = 3, CLOUD_ALPHA_BANDS = 5;

const BAND_AZ = 128, BAND_EL = 32;
/** Top of the map, in sin(elevation). Covers the tallest painted range any
 *  level asks for (canyon: 0.53) and the storm band's reach (0.62). */
const BAND_TOP = 0.72;

function skyBandTexture(a, prev) {
  const data = new Uint16Array(BAND_AZ * BAND_EL * 4);
  const rgb = new Float32Array(BAND_AZ * BAND_EL * 3);
  const sun = sunDirection(a, new THREE.Vector3());
  const disp = skyDisplayShoulder(a);
  const dir = new THREE.Vector3(), col = new THREE.Color();
  const H = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < BAND_EL; j++) {
    // sin(elevation) at the row centre, so a texel means the middle of its band
    const s = ((j + 0.5) / BAND_EL) * BAND_TOP;
    const c = Math.sqrt(Math.max(0, 1 - s * s));
    for (let i = 0; i < BAND_AZ; i++) {
      // Texel centres, so RepeatWrapping interpolates across the seam at ±π
      // without a stripe there.
      const b = -Math.PI + ((i + 0.5) / BAND_AZ) * Math.PI * 2;
      skyShoulder(skyRadiance(dir.set(Math.cos(b) * c, s, Math.sin(b) * c), sun, a, col),
        disp.knee, disp.ceil);
      const o = (j * BAND_AZ + i) * 4, q = (j * BAND_AZ + i) * 3;
      data[o] = H(col.r); data[o + 1] = H(col.g); data[o + 2] = H(col.b); data[o + 3] = H(1);
      rgb[q] = col.r; rgb[q + 1] = col.g; rgb[q + 2] = col.b;
    }
  }
  /* Publish the same numbers to the CPU side. Scenery's far ranges stand along
   * exactly the line of the frame this band paints, so they read THIS array
   * rather than deriving a sky of their own — two derivations that could
   * disagree would disagree in the one place the eye is already looking. */
  ground.skyBand = { az: BAND_AZ, el: BAND_EL, top: BAND_TOP, rgb };
  if (prev) prev.dispose();
  const tex = new THREE.DataTexture(data, BAND_AZ, BAND_EL, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping;      // bearing is a circle
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;   // radiance, not a picture
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    // The dome is centred on the camera, so the local position IS the view
    // direction — no matrix round-trip and no parallax as the player walks.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pin to the far plane, exactly as three's own Sky does. The camera's far
    // is only 380-900 depending on quality, so a dome at any believable sky
    // radius is otherwise clipped away entirely and never renders at all.
    gl_Position.z = gl_Position.w;
  }
`;

/**
 * ══ THE SCRIPT OF THE BATTLE ══════════════════════════════════════════════
 *
 * "make it way more dynamic and engaging and changing over time" — so the
 * fight outside the window is a SCRIPT and not a steady state. One round is
 * six minutes; two rounds make the full cycle, because the second round is
 * the first with the navies' luck reversed — the other side loses the ship.
 * Seconds into a round:
 *
 *     arriveA   0.4   our line drops out of hyperspace, one hull at a time
 *     arriveB   6.0   theirs
 *     fire     62     the guns open as the lines close
 *     closed   70     both lines on station; fighter screens out
 *     burn    160     one capital takes fire it cannot put out
 *     list    185     …and starts to roll
 *     breakAt 228     the hull parts amidships, with a flash
 *     reactor 236     the stern half goes: the biggest light of the round
 *     jumpIn  246     a replacement arrives into the gap
 *     withdraw 330    the lines pull apart; the wreck has fallen to the world
 *     cease   332     the guns stop
 *     jumpOut 342     both lines jump; forty seconds later the round repeats
 *
 * ONE TABLE, TWO READERS. The fragment shader gets every number below through
 * its template (the T_ constants at the top of the orbit block), and
 * _orbitTick reads the same object to raise the deck's events — the thump of
 * the break, the reactor, the arrivals — so the sound cannot drift from the
 * light by an edit to one of them. `battlePhase(t)` is the JS-side answer to
 * "what is happening out there", and it is a pure function of t with period
 * `cycle`: the check suite calls it at t and t + cycle and expects equality.
 */
export const BATTLE = Object.freeze({
  round: 360, cycle: 720,
  arriveA: 0.4, arriveB: 6.0, fire: 62, closed: 70,
  burn: 160, list: 185, breakAt: 228, reactor: 236, jumpIn: 246,
  withdraw: 330, cease: 332, jumpOut: 342,
});

/**
 * What the battle is doing at clock t. Deterministic, periodic in
 * BATTLE.cycle, and cheap enough to call every frame.
 *
 * @returns {{ round: number, t: number, phase: string, victim: number,
 *             victimSide: 'republic'|'separatist', sep: number, fire: number }}
 *   `t` is seconds into the round, `victim` the hull slot that dies this round
 *   (5 = a Providence, 1 = a Venator — the shader's slot table), `sep` how far
 *   apart the lines are (1 far, 0 on station), `fire` the volley gain.
 */
export function battlePhase(t) {
  const B = BATTLE;
  const roundN = Math.floor(t / B.round);
  const tc = t - roundN * B.round;
  const parity = ((roundN % 2) + 2) % 2;
  const victim = parity === 0 ? 5 : 1;
  const phase = tc < B.arriveB ? 'arrive'
    : tc < B.closed ? 'approach'
    : tc < B.burn ? 'broadside'
    : tc < B.breakAt ? 'dying'
    : tc < B.jumpIn ? 'breakup'
    : tc < B.withdraw ? 'reinforced'
    : tc < B.jumpOut ? 'withdraw' : 'departed';
  const sep = 1 - smoothstep(B.arriveB + 3, B.closed, tc) + smoothstep(B.withdraw, B.jumpOut, tc);
  const fire = smoothstep(B.fire, B.fire + 20, tc) * (1 - smoothstep(B.cease - 12, B.cease, tc));
  return { round: parity, t: tc, phase, victim, victimSide: victim > 3 ? 'separatist' : 'republic', sep, fire };
}

/* The shader's hash11, in doubles. Only the slot table below reads it, and
 * the shader no longer computes any of these numbers itself — so there is
 * exactly one copy of each formula, and it is this one. */
const _frac = (x) => x - Math.floor(x);
function hash11(n) {
  n = _frac(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return _frac(n);
}

/**
 * ══ WHERE EVERY HULL IS, ON THE CPU ═══════════════════════════════════════
 *
 * Nine slots — four a navy and one reinforcement — each (x, y, heading,
 * arrival time) in the fleet's tangent plane. Computed here once a frame and
 * handed to the fragment as `uSlot[9]`, because the first cut computed them
 * in the fragment and the guns, the fighters, the bombers and the landing
 * strings each asked again: twenty-five evaluations of six hashes and two
 * sines PER PIXEL for nine numbers that do not vary across the frame.
 *
 * Our navy holds the left of the field and theirs the right; a slot's home is
 * a station on its own line, staggered so the line reads as a formation and
 * not a queue; `sep` from battlePhase pulls both lines apart during the
 * approach and the withdrawal; the bounded wobble is a tenth of what the old
 * shipAt had, because a hull on station still moves and never far. Bows face
 * the enemy with a few degrees of individual heading.
 *
 * @param {number} t      the orbit clock
 * @param {number} side   0 = we are the Republic, 1 = the Separatists
 * @param {THREE.Vector4[]} out  nine, filled in place
 */
export function battleSlots(t, side, out) {
  const B = BATTLE;
  const { t: tc, victim, sep } = battlePhase(t);
  for (let i = 0; i < 9; i++) {
    const a = hash11(i * 1.31 + 0.17), b = hash11(i * 2.77 + 0.41), c = hash11(i * 4.13 + 0.83);
    const slotSide = i < 4 ? 0 : i < 8 ? 1 : (victim < 4 ? 0 : 1);
    const ours = slotSide === side ? -1 : 1;
    const rank = i % 4;
    let x0 = 0.22 + rank * 0.055 + a * 0.05;
    let y0 = (rank - 1.5) * 0.085 + (b - 0.5) * 0.05;
    if (i === 8) { x0 = 0.30 + a * 0.04; y0 = (b - 0.5) * 0.22; }
    const wob = 0.004 + c * 0.004;
    const x = ours * (x0 + sep * 0.46) + Math.sin(tc * 0.0231 + a * TAU) * wob;
    const y = y0 + Math.sin(tc * 0.0157 + b * TAU) * wob;
    const head = (ours < 0 ? 0 : Math.PI) + (c - 0.5) * 0.55;
    const arrive = i === 8 ? B.jumpIn
      : (i < 4 ? B.arriveA : B.arriveB) + rank * 0.7 + hash11(i * 2.3 + 0.2) * 0.4;
    out[i].set(x, y, head, arrive);
  }
  return out;
}

/** The two batteries a hull carries, as (period, phase) pairs. Constant per
 *  slot; filled once so the fragment reads four numbers instead of hashing. */
export function battleGuns(out) {
  for (let i = 0; i < 9; i++) {
    const gA = i * 2, gB = i * 2 + 1;
    const hA = hash11(gA * 3.71 + 0.9), hB = hash11(gB * 3.71 + 0.9);
    out[i].set(6.0 + hA * 4.0, hash11(gA * 1.13 + 2.2), 6.0 + hB * 4.0, hash11(gB * 1.13 + 2.2));
  }
  return out;
}

/* Assembled from three pieces rather than one literal, and the SHAPE of the
 * join matters: tools/verify.mjs walks each /* glsl *​/ literal from its own
 * marker to the first backtick that JS could legally be continuing from, and
 * accepts `;,)]}` as that continuation. A literal closed with ` + … + ` is
 * therefore not seen to close at all, and the scan runs on into the next one —
 * so every backtick between them reads as a stray one inside the GLSL. Joining
 * an array keeps each piece terminated by a comma.
 *
 * `precision highp float;` has to come first: this shader is written from
 * scratch, a fragment shader has no default float precision in GLSL ES, and
 * saberCelBand declares floats. */
const FRAG = [/* glsl */`
  precision highp float;
`,
CEL_BAND_GLSL,
/* glsl */`
  uniform vec3  uSunDir;
  uniform float uTime;
  uniform float uCoverage;     // 0 = clear, 1 = overcast
  uniform vec3  uCloudLit;     // hue of the sunlit face, unit luminance
  uniform vec3  uCloudDark;    // hue of the shadowed underside, unit luminance
  uniform vec3  uHazeColor;    // what distance dissolves into
  uniform float uHorizonAmt;   // 0 = flat empty horizon, 1 = full range
  uniform float uHorizonScale; // angular size of the landforms
  uniform vec3  uHorizonColor;
  uniform float uWindDir;
  uniform float uWindSpeed;
  uniform float uOpacity;
  uniform float uHdr;          // radiance scale, matched to the linear sky
  uniform float uCloudSun;     // radiance of a white cloud face square to the sun
  uniform float uCloudAmb;     // radiance of a white cloud face lit by sky + ground
  uniform vec3  uSkyAmb;       // colour of the skylight falling on the deck
  uniform float uStorm;        // 0 clear .. 1 the front is on top of you
  uniform sampler2D uSkyBand;  // the drawn dome over (bearing, sin elevation)
  uniform vec3  uHazeHue;      // the dust, renormalised to unit luminance

  /* What a range at that distance hands back, relative to the sky standing
   * over it. Under 1 — a finite path cannot return what an infinite one does —
   * and SCALAR, which is the correction.
   *
   * These used to be vec3(0.855, 0.885, 0.955) and vec3(0.760, 0.800, 0.910):
   * Rayleigh-ordered, which sounds right and is not. A per-channel constant
   * multiplied onto the sky raises blue-over-red by a fixed 1.12 whatever
   * colour that sky is, so a painted range converges on a colour its own sky
   * never reaches — on canyon, where the sky at 8° runs warm, it turned the
   * skyline blue against a gold horizon. The same fault as the far ranges in
   * Scenery.js, in the same frame, one file over. A landform is DARKER than
   * its sky and no more saturated than it; the shortfall is in value, and
   * whatever chroma it has of its own is bounded by the sky's below.
   *
   * These are deliberately darker than the shades Scenery.js gives the three
   * REAL ranges at 170-340 m: those parallax, these do not, so these have to
   * sit behind them tonally as well.
   *
   * Two ranges, not four. The old four were mixed toward the haze at
   * 0.08 / 0.18 / 0.32 / 0.50, and composited contrast is exactly
   * alpha × mix × (land − haze): the top two came out under two per cent of
   * the sky's own luminance once the grade was applied, which is below the
   * threshold at which anything is a shape at all. Two ranges that can be seen
   * beat four where half are being paid for and not delivered. */
  const float BAND_FAR  = 0.885;    // 11.5% under the sky
  const float BAND_NEAR = 0.800;    // 20.0% under the sky
  /** The most of the sky's own saturation a painted range may carry. Matches
   *  RANGE_CHROMA in Scenery.js — the two meet along the same line of frame. */
  const float BAND_CHROMA = 0.55;
  const vec3 LUM_W = vec3(0.2126, 0.7152, 0.0722);

  varying vec3 vDir;

  // ── value noise + fbm. Cheap, and clouds do not need gradient noise.
  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // Rotating each octave stops the layers lining up into visible grain.
  const mat2 R2 = mat2(0.80, 0.60, -0.60, 0.80);
  float fbm3(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = R2 * p * 2.03; a *= 0.5; }
    return s;
  }
  float fbm5(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = R2 * p * 2.03; a *= 0.5; }
    return s;
  }

  // Henyey–Greenstein. Water droplets scatter forward hard; this is why a
  // cloud in front of the sun is brighter than the sky beside it.
  float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
  }

  // ── the deck's density field, in deck-plane coordinates.
  // thr is the coverage threshold; the return is signed "thickness".
  float deck(vec2 p, float thr, vec2 wind) {
    // A slow domain warp is what turns fbm's isotropic mush into billows that
    // curl. Without it every cloud is the same blob at a different size.
    vec2 w = vec2(fbm3(p * 0.45 + wind * 0.004),
                  fbm3(p * 0.45 + wind * 0.004 + 31.7)) - 0.5;
    float shape = fbm5(p + w * 0.75 + wind * 0.012);
    return shape - thr;
  }
`,
/* glsl */`
/* ══ THE VIEW OUT OF A SHIP ═══════════════════════════════════════════════
 *
 * Everything below draws only when uOrbit is 1, and uOrbit is 1 only when a
 * level hands atmosphere.orbit an object. Every other level takes the branch
 * in main() that was always there, evaluates none of this, and renders the
 * same bits it rendered before — see the note on configureOrbit for why the
 * gate is a uniform and not a #define.
 *
 * WHY IT IS ALL IN THIS FRAGMENT. A hangar is a room whose entire content is
 * the view out of it, and that view has to cost nothing, because the room it
 * is seen from is already spending the draw budget. A geometry planet needs
 * its own depth range, its own fog exemption and its own line in the ink pass;
 * a Points starfield is a second draw call that fades by opacity instead of by
 * band, which is the one thing this renderer does not do. The dome is already
 * here, already direction-only, already banded, already excluded from the ink
 * prepass because it is transparent. Planet, stars and fleet cost ZERO new
 * draw calls and zero new geometry between them, and that is still true of
 * everything added in the second pass below.
 *
 * ── THE SECOND PASS, AND WHAT THE PLAYER SAID ─────────────────────────────
 *
 * "while the hangar looks really good it almost makes how crude all the
 *  different planets are and how crude the giant battle is stand out even
 *  more … you really really need to improve the detail on all the different
 *  planets or start over … same goes for the space battle like the idea is
 *  there but the execution is really rough like it's just bare static
 *  triangles like it really kills the immersion you need to go to town on the
 *  massive space battle and make it way more dynamic and engaging and
 *  changing over time"
 *
 * He is right on both counts and the reasons are specific.
 *
 * THE PLANETS were seven copies of one world in seven swatches. The land was
 * the terrain's sand colour, the sea was water.deep, and that was the whole
 * of the difference: the same four-octave continents in the same places on
 * every theatre, because nothing seeded the noise. So now:
 *
 *   · uPlanetSeed moves every field, so no two worlds share a coastline;
 *   · the atmosphere block carries a planet record — land, highland, basin,
 *     sea, ice, cloud, cities, lava, scatter, haze, storms, glint, ring — so a
 *     level can say what its world IS rather than inherit what its ground
 *     happens to be, and a level that says nothing still gets the derivation
 *     that was here (see configureOrbit);
 *   · the cloud deck casts a SHADOW: the same field sampled a few degrees
 *     toward the star darkens the ground it stands over, which is the single
 *     cue that puts the clouds ABOVE the surface instead of painted on it;
 *   · storm swirls: two cyclones per world, a domain rotation about a point
 *     with an eye wall of bright cloud, gained by storms;
 *   · a Fresnel rim in a scatter colour of its own, and a twilight band where
 *     the air past the terminator still glows — the old rim was the sky
 *     colour times N·L, which went to nothing exactly where a limb is most
 *     visible;
 *   · a specular glint on open water, quantised to a flat disc so it is a
 *     drawn highlight and not a lobe;
 *   · dark canyon seams in the high-frequency term the coast is torn with —
 *     free, because the field was already being evaluated;
 *   · city specks under the conurbation mask, so a settled night side has a
 *     grain of individual lights rather than three soft patches;
 *   · a dust veil over the day side for the worlds whose air is mostly grit;
 *   · a RING, for the one world that asks: an analytic plane through the
 *     centre, occluded by the sphere, in the sphere's shadow behind it, and
 *     casting its own shadow band across the surface. Four dot products and
 *     one noise sample, and it is the thing that says "planet" fastest of
 *     anything in this file.
 *
 * THE BATTLE was seven tapered boxes on bounded sinusoids, and it was the same
 * fight at minute one and minute twenty. Every hull is now a silhouette built
 * from signed-distance boxes in its own frame — five kinds, two navies, see
 * shipMask — and the whole action runs on a SCRIPT: a 360-second round in
 * which two fleets jump in, close, open fire in volleys, lose a capital ship
 * to fires, a list, a break and a reactor, are reinforced out of hyperspace,
 * and jump out again, with a second round in which the OTHER side loses the
 * ship. Fighters fly arcs around the capitals rather than sinusoids, bombers
 * run a hull and walk a string of hits down its keel, and the wreck falls to
 * the world below and burns in at the limb. See BATTLE in the JS above for
 * the timeline, which the shader reads through the constants below so the
 * deck's audio and this fragment cannot disagree about when the ship goes.
 *
 * ALL OF IT IS STILL A FUNCTION OF uOrbitT. No state, no per-frame RNG: a
 * reload puts the battle back exactly where the fiction says it is.
 *
 * AND THE PALETTE IS STILL THE LEVEL'S. Not one colour is typed here that a
 * level cannot override, and every default is derived from the same swatches
 * the ground under the player is painted with.
 */
uniform float uOrbit;        /* 0 = this dome is a sky; 1 = it is a window */
uniform float uOrbitT;       /* the clock everything scripted below runs on */
uniform float uOrbitKey;     /* radiance a white face square to the star returns */
uniform vec3  uSpaceCol;     /* the void, off the level's own bgColor */
uniform vec3  uStarCol;      /* the star, as a hue: the level's sunColor */

uniform vec3  uPlanetDir;    /* unit; where the disc is, drifted on the CPU */
uniform vec3  uPlanetAxis;   /* unit; the planet's own spin axis */
uniform float uPlanetCos;    /* cos of its angular radius */
uniform float uPlanetSin;    /* sin of it, so the limb costs no trig per pixel */
uniform float uPlanetSpin;   /* surface rotation, radians */
uniform float uCloudSpin;    /* cloud rotation, radians, and always the slower */
uniform vec3  uPlanetSeed;   /* where in the noise this world lives */
uniform vec3  uLandCol;      /* the lowlands */
uniform vec3  uRockCol;      /* …the highlands */
uniform vec3  uBasinCol;     /* …the low ground round a coast, and the canyons */
uniform vec3  uSeaCol;       /* water.deep, or what a lava sea throws up */
uniform float uSeaAmt;       /* how much of the disc is under it */
uniform float uSeaGlow;      /* 1 when that sea is lava and does not go out */
uniform float uCapAmt;       /* polar ice */
uniform float uCityAmt;      /* lights on the night side, for a settled world */
uniform float uCloudAmt;     /* the level's own cloudCover */
uniform vec3  uPlanetLit;    /* its cloudLit, as a hue */
uniform vec3  uPlanetDark;   /* its cloudDark, as a hue */
uniform vec3  uAtmoCol;      /* the limb: the level's own skyColor, as a hue */
uniform vec3  uScatterCol;   /* the rim's own colour, as a hue */
uniform float uHazeAmt;      /* dust veil over the day side */
uniform float uStormAmt;     /* cyclone gain */
uniform float uGlint;        /* specular on open water */
uniform float uRingAmt;      /* 0 = no ring */
uniform float uRingIn;       /* inner edge, planet radii */
uniform float uRingOut;      /* outer edge, planet radii */
uniform vec3  uRingCol;      /* the ring's albedo */
uniform vec3  uRingAxis;     /* unit; the ring plane's normal */

uniform float uStars;        /* starfield gain */
uniform float uStarSpin;     /* the ship's attitude — this is the parallax */
/**
 * -- THE JUMP, V16 SS A1 -- and these two were WRITTEN TO AND DID NOT EXIST --
 *
 * Station.orderJump's stars(k, swing) sink has always ended:
 *
 *     if (u.uWarp) u.uWarp.value = k;
 *     if (u.uOrbitSpin) u.uOrbitSpin.value = swing;
 *
 * against a uniform table that declared neither, so both guards were false on
 * every frame of every jump and the whole star half of the sequence was a
 * silent no-op. Measured in the shipped build, walking a player onto #41,
 * picking a theatre and pressing Escape: the deck went amber, the planet
 * swapped, the PA spoke -- and uWarp peaked at 0.00 and uOrbitSpin at 0.00.
 * That is the same defect tools/checks/hangar.mjs exists for, one file along:
 * a call into an optional chain that eats it.
 *
 *   uOrbitSpin  how far the sky has swung while the station comes onto its
 *               bearing, in radians, about the deck's own up axis.
 *   uWarp       0 is a starfield and 1 is star-lines. See starField.
 */
uniform float uWarp;
uniform float uOrbitSpin;
uniform float uFleet;        /* fleet gain */
uniform vec3  uFleetDir;     /* unit; the bearing of the action */
uniform vec3  uBoltCol;      /* our turbolasers */
uniform vec3  uFoeCol;       /* theirs */
uniform float uSide;         /* 0 = we are the Republic; 1 = we are the Separatists */
uniform float uDeathSpan;    /* kept for callers; the round length now lives in ROUND */
/* THE DETONATIONS ARE SCHEDULED ON THE CPU AND CONSUMED HERE, and the reason
 * is one line long: the deck has to hear them. A muffled thump through the
 * hull two seconds after a flash is the single cheapest thing in this whole
 * view that says the ship you are standing on is a physical object in the same
 * space as the fight — and a schedule that exists only inside a fragment
 * shader cannot be subscribed to. So the timeline lives in _orbitTick, which
 * raises an event as each one fires and hands the shader the same three slots
 * it is about to draw. One schedule, two consumers; not two schedules that
 * agree until somebody edits one. xy = where, z = seconds since the flash
 * (negative = not lit), w = how big. */
uniform vec4  uBlast[3];
uniform float uLanding;      /* strings of landing craft going down */
/* THE SLOT TABLE: nine hulls as (x, y, heading, arrival), from battleSlots on
 * the CPU. See that function for why it is not computed here. */
uniform vec4  uSlot[9];
/* …and each hull's two batteries as (period A, phase A, period B, phase B),
 * so no pixel hashes a gun's cadence. */
uniform vec4  uGun[9];

/* ── the script, in seconds into a round. One source: BATTLE in the JS. ── */
const float ROUND       = ${BATTLE.round.toFixed(1)};
const float T_ARRIVE_A  = ${BATTLE.arriveA.toFixed(1)};
const float T_ARRIVE_B  = ${BATTLE.arriveB.toFixed(1)};
const float T_CLOSED    = ${BATTLE.closed.toFixed(1)};
const float T_FIRE      = ${BATTLE.fire.toFixed(1)};
const float T_BURN      = ${BATTLE.burn.toFixed(1)};
const float T_LIST      = ${BATTLE.list.toFixed(1)};
const float T_BREAK     = ${BATTLE.breakAt.toFixed(1)};
const float T_REACTOR   = ${BATTLE.reactor.toFixed(1)};
const float T_JUMPIN    = ${BATTLE.jumpIn.toFixed(1)};
const float T_CEASE     = ${BATTLE.cease.toFixed(1)};
const float T_WITHDRAW  = ${BATTLE.withdraw.toFixed(1)};
const float T_JUMPOUT   = ${BATTLE.jumpOut.toFixed(1)};

/* The plane of the arm we are looking along. One direction, so the band is a
 * band and not a wash — a nebula everywhere is a fog, and fog in vacuum is the
 * same bug as haze in a hangar. */
const vec3 ARM_AXIS = vec3(0.34, 0.88, -0.33);

float hash11(float n) {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}

/* Deliberately not a sin() hash. sin() past a few thousand is a different
 * number on different drivers, and every position below is a function of a
 * clock that runs for as long as the player stands there. */
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a0 = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
  float a1 = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
  float b0 = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
  float b1 = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a0, a1, f.y), mix(b0, b1, f.y), f.z);
}

/* Three octaves for the thing being described and two for the thing modifying
 * it. Sums to 0.875 and 0.75 respectively, both centred near six-tenths of
 * that — the thresholds below are stated against those numbers, not against
 * a nominal 0..1, which is how a noise threshold quietly becomes a flat wash. */
float orbFbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}
float orbFbm2(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { s += a * vnoise3(p); p = p * 2.11 + 7.7; a *= 0.5; }
  return s;
}
/* FOUR, for the one field the eye actually reads as a place.
 *
 * At three octaves the continents came out as half a dozen rounded blobs with
 * smooth coasts — graphic in the wrong way, a logo rather than a world. The
 * fourth octave is a sixteenth of the amplitude and costs eight more hashes,
 * and what it buys is the scale between a landmass and a bay, which is the
 * scale a coastline is legible at. */
float orbFbm4(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 11.3; a *= 0.5; }
  return s;
}

/* Rodrigues. The planet turns under its own weather and the sky turns under
 * the ship, and both are one rotation of a unit vector about a unit axis. */
vec3 spinAbout(vec3 v, vec3 ax, float ang) {
  float c = cos(ang), sn = sin(ang);
  return v * c + cross(ax, v) * sn + ax * (dot(ax, v) * (1.0 - c));
}

vec2 rot2(vec2 v, float a) {
  float c = cos(a), sn = sin(a);
  return vec2(v.x * c - v.y * sn, v.x * sn + v.y * c);
}

/**
 * ONE STAR PER CELL, AND THE CELL IS NEVER SEARCHED.
 *
 * The usual direction-hash starfield walks the 3x3x3 neighbourhood so a star
 * near a cell wall is not clipped in half — twenty-seven hashes a pixel for a
 * field that is 95% empty. Keeping every star inside the middle 56% of its own
 * cell makes clipping impossible by construction, so this is ONE hash for the
 * gate and three more only for the cells that actually hold a star.
 *
 * Brightness comes off the same hash that gates it, so a rarer star is a
 * brighter one and the field has a magnitude distribution rather than a
 * uniform sprinkle of identical dots.
 */
float starAt(vec3 v, float scale, float thr, float rad, out float tone) {
  vec3 p = v * scale;
  vec3 i = floor(p);
  float h = hash13(i);
  tone = 0.0;
  if (h < thr) return 0.0;
  vec3 c = vec3(hash13(i + 11.3), hash13(i + 27.7), hash13(i + 41.1)) * 0.56 + 0.22;
  tone = hash13(i + 59.9);
  float dd = length(fract(p) - c) / rad;
  return max(0.0, 1.0 - dd * dd) * (0.30 + 0.70 * (h - thr) / (1.0 - thr));
}

/**
 * The field, and the arm behind it.
 *
 * QUANTISED, not faded. The dome bands every other thing it draws and a smooth
 * point-spread would be the one gradient in the frame; three plateaus give a
 * star a flat core with a drawn edge, which is what the reference frames do
 * with the single glowing point in plate 2.
 *
 * The whole field is sampled through the ship's attitude and the planet is
 * drifted separately on the CPU. That is the parallax: the sky is very nearly
 * fixed and the world slides across it, which is the only cue in the frame
 * that says the thing you are standing on is moving.
 */
vec3 starDots(vec3 v) {
  float t1, t2;
  float a = starAt(v, 340.0, 0.918, 0.30, t1);
  float b = starAt(v, 97.0, 0.945, 0.21, t2);
  a = saberCelQuant(clamp(a, 0.0, 1.0), 3.0);
  b = saberCelQuant(clamp(b, 0.0, 1.0), 3.0);
  /* Three hues, not a spectrum: a cool white, a plain white and an amber. */
  vec3 ca = mix(vec3(0.74, 0.83, 1.0), vec3(1.0, 0.85, 0.63), saberCelQuant(t1, 2.0));
  vec3 cb = mix(vec3(0.74, 0.83, 1.0), vec3(1.0, 0.85, 0.63), saberCelQuant(t2, 2.0));
  return ca * a * 0.85 + cb * b * 2.1;
}

/**
 * -- THE STAR-LINES, AND THEY ARE THE SAME FIELD SMEARED -----------------
 *
 * A second starfield drawn in streaks would be two fields that have to agree
 * about where every star is; this is the ONE field, sampled WARP_TAPS times
 * along the great circle through the pixel and the direction of travel, which
 * is exactly what a radial smear is. At uWarp = 0 the loop is skipped and the
 * cost is the field as it has always been.
 *
 * THE ARC IS SCALED BY THE SINE OF THE ANGLE OFF THE TRAVEL AXIS --
 * length(cross(v, WARP_DIR)) -- because that is what perspective does: a star
 * dead ahead of you does not move on your retina and one abeam of you crosses
 * it fastest. A constant arc gives an even smear that reads as motion blur on
 * a camera rather than as a ship going somewhere.
 *
 * The taps are weighted to a triangle so the middle of a streak is brighter
 * than its ends, and the whole thing is gained UP with uWarp: at full lines
 * the field is about twice as bright, which is the beat the sequence puts the
 * sky reconfigure inside (see Warp.js -- the one frame a hitch is invisible).
 */
const int   WARP_TAPS = 7;
const vec3  WARP_DIR  = vec3(0.0, 0.10, -0.995);   /* where the station is pointed */
const float WARP_ARC  = 0.34;                       /* radians of smear at full lines */

vec3 starField(vec3 dir) {
  /* THE BEARING TURN, before the parallax: the station swings and the whole
   * sky swings with it. uOrbitSpin is 0 for every frame that is not a jump,
   * and spinAbout by 0 is the identity, so nothing standing still moves. */
  vec3 d = uOrbitSpin == 0.0 ? dir : spinAbout(dir, vec3(0.0, 1.0, 0.0), uOrbitSpin);
  vec3 v = spinAbout(d, ARM_AXIS, uStarSpin);
  vec3 col;
  if (uWarp < 0.004) {
    col = starDots(v);
  } else {
    vec3 ax = cross(v, WARP_DIR);
    float sinA = length(ax);
    ax = sinA > 1e-4 ? ax / sinA : vec3(0.0, 1.0, 0.0);
    float arc = WARP_ARC * uWarp * sinA;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < WARP_TAPS; i++) {
      float t = float(i) / float(WARP_TAPS - 1) - 0.5;   /* -0.5 … 0.5 */
      float w = 1.0 - abs(t) * 1.2;
      acc += starDots(spinAbout(v, ax, t * arc)) * w;
      wsum += w;
    }
    col = acc / wsum * (1.0 + uWarp);
  }

  /* The arm: unresolved stars along one great circle, banded to three plates
   * so it reads as drawn rather than as a photograph.
   *
   * THE FREQUENCY IS THE WHOLE OF IT. At v * 2.6 the field has about three
   * cells across the visible sky, so the band came out as a handful of pale
   * amoebas the size of a fist held at arm's length — a lens smear, not a
   * galaxy. At v * 11 a cell is under two degrees and what the eye reads is
   * mottling inside a band, which is what unresolved stars actually look
   * like. Narrower too (0.20 rather than 0.42 of the sphere), and a third the
   * level: this is the faintest thing in the frame by construction, because
   * anything brighter competes with the planet for the same eye. */
  float band = 1.0 - smoothstep(0.0, 0.20, abs(dot(v, ARM_AXIS)));
  float dust = orbFbm2(v * 11.0 + 4.0);
  float arm = saberCelQuant(clamp((dust - 0.34) * 3.2 * band, 0.0, 1.0), 3.0);
  col += mix(uAtmoCol, vec3(1.0), 0.4) * arm * 0.011;
  return col * uStars;
}

/* ── 2-D signed distance, and the one edge rule ──────────────────────────
 * Every hull below is a union and difference of these. The edges are
 * smoothstepped over a screen-space width rather than stepped, because a
 * two-pixel shape with a hard edge crawls; the shading either side of the
 * edge is still the flat tones rule 1 asks for. */
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float fillM(float d, float aa) { return smoothstep(aa, -aa, d); }

/**
 * ══ A WARSHIP, AS A SILHOUETTE ═══════════════════════════════════════════
 *
 * Five kinds, in the hull's own frame: +x is the bow, y is across the beam,
 * L is the half-length and W the half-beam at the stern. At the angular size
 * these sit at — a capital ship is about three degrees long — what separates
 * one navy from the other is the OUTLINE, and what separates a warship from a
 * grey lozenge is one or two things standing proud of it. So each is an
 * outline plus the two or three features that outline is known by:
 *
 *   0  Venator     a wedge, the bow split into two prongs, a dorsal spine
 *                  the length of the ship, twin bridge towers aft, and two
 *                  hangar notches amidships with the bay lit inside
 *   1  Acclamator  a plain wedge, one tower, a lit ventral bay at the stern
 *   2  Lucrehulk   a ring open at the bow round a core sphere, with a bridge
 *                  on the sphere's brow and hangars lit round the inner rim
 *   3  Providence  a cigar, pointed, with a tall dorsal fin, a smaller
 *                  ventral one and a row of lit ports along the flank
 *   4  Munificent  a needle: narrow hull, a blunt head at the bow, two pods
 *                  flared out at the stern
 *
 * em is the mask of what is LIT from inside — bays, ports — and raised
 * the mask of what stands above the deck, which takes the lighter plate so a
 * spine reads as a ridge and not as paint.
 */
float shipMask(vec2 h, float kind, float L, float W, float aa, out float em, out float raised) {
  em = 0.0; raised = 0.0;
  float t01 = clamp((h.x + L) / (2.0 * L), 0.0, 1.0);
  if (kind < 0.5) {
    float beam = W * (1.0 - t01 * 0.92);
    float d = max(abs(h.x) - L, abs(h.y) - beam);
    d = max(d, -sdBox(h - vec2(L * 0.80, 0.0), vec2(L * 0.30, W * 0.085)));
    float notch = sdBox(vec2(h.x - L * 0.05, abs(h.y) - beam), vec2(L * 0.11, W * 0.17));
    d = max(d, -notch);
    float body = fillM(d, aa);
    em = fillM(sdBox(vec2(h.x - L * 0.05, abs(h.y) - beam + W * 0.11), vec2(L * 0.09, W * 0.035)), aa);
    float spine = fillM(sdBox(h - vec2(-L * 0.18, 0.0), vec2(L * 0.62, W * 0.12)), aa) * body;
    float towers = fillM(sdBox(vec2(h.x + L * 0.58, abs(h.y) - W * 0.80), vec2(L * 0.12, W * 0.22)), aa);
    raised = max(spine, towers);
    return max(max(body, towers), em);
  } else if (kind < 1.5) {
    float beam = W * (1.0 - t01 * 0.90);
    float body = fillM(max(abs(h.x) - L, abs(h.y) - beam), aa);
    float tower = fillM(sdBox(h - vec2(-L * 0.50, W * 0.62), vec2(L * 0.13, W * 0.26)), aa);
    em = fillM(sdBox(h - vec2(-L * 0.94, 0.0), vec2(L * 0.035, W * 0.34)), aa);
    raised = tower;
    return max(body, tower);
  } else if (kind < 2.5) {
    float r = length(h);
    float ring = abs(r - L * 0.72) - L * 0.26;
    float gap = sdBox(h - vec2(L * 1.0, 0.0), vec2(L * 0.55, L * 0.34));
    ring = max(ring, -gap);
    float core = r - L * 0.37;
    float bridge = sdBox(h - vec2(L * 0.34, 0.0), vec2(L * 0.11, L * 0.09));
    float body = fillM(min(min(ring, core), bridge), aa);
    /* hangars, lit, round the inner rim of the ring, and not in the gap */
    float ang = atan(h.y, h.x);
    em = fillM(abs(r - L * 0.505) - L * 0.030, aa) * step(0.45, fract(ang * 2.2)) * (1.0 - fillM(gap - L * 0.05, aa));
    raised = fillM(core, aa);
    return max(body, em);
  } else if (kind < 3.5) {
    float x = h.x / L;
    float hb = W * sqrt(max(1.0 - x * x, 0.0)) * (1.0 - 0.28 * x);
    float body = fillM(max(abs(h.y) - hb, abs(h.x) - L), aa);
    float fin = fillM(sdBox(h - vec2(-L * 0.28, W * 1.05), vec2(L * 0.16, W * 0.55)), aa);
    float keel = fillM(sdBox(h - vec2(-L * 0.10, -W * 0.85), vec2(L * 0.12, W * 0.30)), aa);
    float bridge = fillM(sdBox(h - vec2(-L * 0.62, W * 0.55), vec2(L * 0.07, W * 0.25)), aa);
    em = fillM(abs(h.y - W * 0.22) - W * 0.06, aa) * step(0.55, fract(h.x / (L * 0.075))) * body
       * step(-L * 0.75, h.x) * step(h.x, L * 0.55);
    raised = max(fin, max(keel, bridge));
    return max(body, raised);
  } else {
    float beam = W * (0.55 - t01 * 0.42);
    float body = fillM(max(abs(h.x) - L, abs(h.y) - beam), aa);
    float head = fillM(sdBox(h - vec2(L * 0.86, 0.0), vec2(L * 0.14, W * 0.42)), aa);
    float pods = fillM(sdBox(vec2(h.x + L * 0.80, abs(h.y) - W * 0.68), vec2(L * 0.20, W * 0.30)), aa);
    em = fillM(sdBox(h - vec2(L * 0.86, 0.0), vec2(L * 0.03, W * 0.18)), aa);
    raised = head;
    return max(body, max(head, pods));
  }
}

/* Which navy a slot belongs to (0 Republic, 1 Separatist), and what it is. The
 * ninth slot is the reinforcement, and it is whichever navy is short a ship
 * this round. */
float slotSide(float i, float victim) {
  if (i < 3.5) return 0.0;
  if (i < 7.5) return 1.0;
  return victim < 3.5 ? 0.0 : 1.0;
}
float slotKind(float i, float victim) {
  if (i < 1.5) return 0.0;           /* two Venators */
  if (i < 3.5) return 1.0;           /* two Acclamators */
  if (i < 4.5) return 2.0;           /* one Lucrehulk */
  if (i < 6.5) return 3.0;           /* two Providences */
  if (i < 7.5) return 4.0;           /* one Munificent */
  return victim < 3.5 ? 0.0 : 3.0;   /* the reinforcement is a capital */
}
float slotBig(float i) {
  return (i < 1.5 || (i > 3.5 && i < 5.5) || i > 7.5) ? 1.0 : 0.62;
}

/* A slot by number. A chain of constant indices rather than uSlot[int(i)],
 * because ESSL 1.00 lets a fragment index an array only by a constant and
 * this literal has to compile under both versions the harness can hand it. */
vec4 slotAt(float i) {
  if (i < 0.5) return uSlot[0];
  if (i < 1.5) return uSlot[1];
  if (i < 2.5) return uSlot[2];
  if (i < 3.5) return uSlot[3];
  if (i < 4.5) return uSlot[4];
  if (i < 5.5) return uSlot[5];
  if (i < 6.5) return uSlot[6];
  if (i < 7.5) return uSlot[7];
  return uSlot[8];
}

/* When slot i goes back into hyperspace. Its arrival rides in uSlot. */
float slotLeave(float i) {
  return T_JUMPOUT + hash11(i * 3.7 + 1.1) * 2.8;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1.0e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

/* Rotate by a heading given as (cos, sin): no trig at the call. */
vec2 rotBy(vec2 v, vec2 hd) { return vec2(v.x * hd.x - v.y * hd.y, v.x * hd.y + v.y * hd.x); }
vec2 unrotBy(vec2 v, vec2 hd) { return vec2(v.x * hd.x + v.y * hd.y, -v.x * hd.y + v.y * hd.x); }

/* A hyperspace streak: a line along the heading that contracts into the
 * hull's position (arriving) or stretches away from it (leaving), and a flash
 * at the point it resolves. The streak is what says the fleet came from
 * SOMEWHERE rather than fading up. */
vec3 hyperStreak(vec2 q, vec2 pos, vec2 hd, float age, float leaving) {
  vec2 dirn = hd * (leaving > 0.5 ? 1.0 : -1.0);
  float k = leaving > 0.5 ? smoothstep(0.0, 1.0, age / 0.9) : 1.0 - smoothstep(0.0, 1.0, age / 0.9);
  vec2 far = pos + dirn * (0.05 + 1.3 * k);
  float dd = segDist(q, pos, far);
  float streak = smoothstep(0.0030, 0.0006, dd) * (1.0 - k * 0.7) + exp(-dd / 0.010) * 0.30;
  float fl = leaving > 0.5 ? max(1.0 - age * 2.4, 0.0) : max(1.0 - abs(age - 1.0) * 2.4, 0.0);
  float flash = exp(-length(q - pos) / 0.020) * fl * fl * 3.0;
  return vec3(0.70, 0.86, 1.0) * (streak * 2.2 + flash);
}

/**
 * ══ THE FLEET ACTION ══════════════════════════════════════════════════════
 *
 * Layered by distance, and distance here is stated as SIZE AND RATE rather
 * than as haze, because there is no air out there to state it with: the
 * capitals are eight times the length of a fighter and move a hundred times
 * slower, and that is the whole depth cue.
 *
 * What is in a round, in order — see BATTLE for the seconds:
 *
 *   · two navies of four out of hyperspace, one line then the other
 *   · the lines close over a minute; fighter screens come out as they do
 *   · volleys: twelve guns in bursts of three, a bolt taking a second and a
 *     half to cross, a shield crescent where each one lands facing the way
 *     it came — green and blue from the Republic line, red from the other
 *   · fighters in arcs round the capitals, two swarms, trading shots
 *   · bombers in a line at a hull, and a string of hits walked down its keel
 *   · landing craft going down to the world, burning in at the limb
 *   · one capital dying: fires that spread, a list that rolls, a break with
 *     a flash, the reactor going with a shock ring, a debris field that
 *     tumbles, and the wreck falling toward the planet and burning in
 *   · a replacement out of hyperspace into the gap
 *   · the lines pull apart and jump out; the next round the OTHER navy
 *     loses the ship
 *
 * ALL OF IT IS A FUNCTION OF t. There is no per-frame RNG and no state, so a
 * reload puts the battle back exactly where the fiction says it is, and two
 * players in the same room at the same clock see the same fight.
 */
vec4 fleetScene(vec2 q, float aa, float t, vec2 sq, vec2 pq, float pr) {
  /* Nothing below reaches past this box — the chase passes cross at x 1.25,
   * the lines sit inside 0.8 — and the cone this is called for is three
   * times wider, so most of its pixels leave here having paid one compare. */
  if (abs(q.x) > 1.35 || abs(q.y) > 0.80) return vec4(0.0);
  vec3 hullAcc = vec3(0.0), glow = vec3(0.0);
  float cov = 0.0;
  /* Hulls are lit by the same star as everything else, and their shade side is
   * the same air colour the planet's limb is. That is what keeps the fleet
   * inside the level's own hue family rather than putting a second grey scheme
   * in the frame — rule 5. */
  vec3 lit = uStarCol * uOrbitKey * 0.32;
  /* The shade side is PLANETSHINE, and the number is not a guess: the disc
   * subtends about a steradian and a half at this angular size and returns its
   * own albedo of what lands on it, which _publishOrbit works out at four to
   * five per cent of the key. A hull with a black shadow side beside a world
   * that bright is the same error as a cloud base painted black under an open
   * sky, one file up. */
  vec3 shade = uAtmoCol * uOrbitKey * 0.095;
  vec3 emCol = mix(uAtmoCol, vec3(1.0), 0.55);

  /* the round, and who dies in it */
  float roundN = floor(t / ROUND);
  float tc = t - roundN * ROUND;
  float victim = mod(roundN, 2.0) < 0.5 ? 5.0 : 1.0;
  float fire = smoothstep(T_FIRE, T_FIRE + 20.0, tc) * (1.0 - smoothstep(T_CEASE - 12.0, T_CEASE, tc));
  /* the wreck's fall, shared by its two halves and its debris */
  float fall = smoothstep(T_REACTOR, T_WITHDRAW, tc);
  fall *= fall;
  vec4 vS = victim < 3.0 ? uSlot[1] : uSlot[5];
  vec2 vPos = vS.xy;
  vec2 toWorld = pq - vPos;
  vec2 fallTo = pq - normalize(toWorld + vec2(1.0e-5, 0.0)) * pr * 0.88;
  vec2 fallOff = (fallTo - vPos) * fall;
  float wreckGone = smoothstep(0.78, 0.94, fall);

  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float big = slotBig(fi);
    float kind = slotKind(fi, victim);
    vec4 S = uSlot[i];
    vec2 c = S.xy;
    float head = S.z;
    /* 0.068 rather than the 0.050 the boxes were drawn at: a silhouette with
     * a split bow and two towers needs about seventy pixels across a 58-degree
     * field to be read as one, and at fifty it was a triangle again. */
    float L = 0.068 * big, W = 0.0215 * big;
    if (kind > 1.5 && kind < 2.5) { L *= 0.78; W = L; }
    if (kind > 2.5 && kind < 3.5) { L *= 1.15; W *= 0.62; }
    if (kind > 3.5) { L *= 1.05; W *= 0.55; }
    bool vic = abs(fi - victim) < 0.5;

    /* in or out of hyperspace */
    float ta = S.w, tl = slotLeave(fi);
    float ageIn = tc - ta, ageOut = tc - tl;
    if (ageIn < 0.0) continue;
    /* the one trig pair this hull costs: everything in its frame goes
     * through rotBy/unrotBy on these */
    vec2 hd = vec2(cos(head), sin(head));
    if (ageIn < 1.4) glow += hyperStreak(q, c, hd, ageIn, 0.0);
    if (!vic && ageOut > 0.0 && ageOut < 1.4) glow += hyperStreak(q, c, hd, ageOut, 1.0);
    if (ageIn < 1.05 || (!vic && ageOut > 0.15)) continue;

    /* The one that is dying rolls as it goes, and keeps rolling after it has
     * broken. Squared, so the list is barely there for the first minute and
     * unmistakable by the end. */
    float brk = 0.0, burn = 0.0, reactor = -1.0;
    if (vic) {
      float list = smoothstep(T_LIST, T_BREAK + 40.0, tc);
      head += list * list * 1.35;
      if (list > 0.0) hd = vec2(cos(head), sin(head));
      brk = clamp((tc - T_BREAK) / 40.0, 0.0, 1.0);
      burn = clamp((tc - T_BURN) / (T_BREAK - T_BURN), 0.0, 1.0);
      reactor = tc - T_REACTOR;
      c += fallOff;
      if (wreckGone > 0.999) continue;
    }

    /* everything a hull IS is inside three lengths of it; what it fires
     * reaches further and is drawn below whatever this says */
    bool near = max(abs(q.x - c.x), abs(q.y - c.y)) < L * 3.4;
    vec2 h = unrotBy(q - c, hd);
    float hull = 0.0, em = 0.0, raised = 0.0;
    if (near) {
    if (vic && brk > 0.0) {
      /* Two pieces. At brk = 0 they are exactly the two halves of one hull and
       * the seam at h.x = 0 is invisible; at brk = 1 the bow has tumbled a
       * third of a hull length clear of the stern. The stern half is what the
       * reactor was in, and it is gone the moment the reactor goes. */
      float emA, rA, emF, rF;
      float mAft = shipMask(h, kind, L, W, aa, emA, rA) * smoothstep(aa, -aa, h.x)
                 * (reactor > 0.0 ? 0.0 : 1.0);
      vec2 hf = rot2(h + vec2(brk * L * 0.62, -brk * W * 2.4), -brk * 0.5);
      float mFore = shipMask(hf, kind, L, W, aa, emF, rF) * smoothstep(-aa, aa, hf.x);
      hull = max(mAft, mFore);
      em = 0.0;                                   /* a broken hull has no power */
      raised = max(rA * mAft, rF * mFore);
    } else {
      hull = shipMask(h, kind, L, W, aa, em, raised);
    }
    hull *= (1.0 - wreckGone * float(vic));
    }

    if (hull > 0.002) {
      float t01 = clamp((h.x + L) / (2.0 * L), 0.0, 1.0);
      float beam = W * (1.0 - t01 * 0.90);
      vec2 sh = unrotBy(sq, hd);
      /* The hull is a plate, so it has no normal. Treating it as a cylinder
       * about its own keel gives one: the visible surface sweeps from one beam
       * to the other across the silhouette, with a constant nose-on component
       * for the bow. NORMALISED — a unit normal against a unit sun cannot come
       * out as one small number over a whole hull. */
      vec2 nrm = normalize(vec2(0.45, clamp(h.y / max(beam, 1.0e-5), -1.0, 1.0)));
      float ndl = dot(nrm, sh);
      /* Republic hulls are pale; the other navy's are darker and bluer, and
       * the Lucrehulk is the tan it always was. A wreck goes dark as it cools. */
      vec3 alb = kind < 1.5 ? vec3(1.0, 0.98, 0.94)
               : (kind < 2.5 ? vec3(0.78, 0.66, 0.52) : vec3(0.62, 0.66, 0.74));
      vec3 tone = mix(shade, lit, step(0.02, ndl) * (1.0 + raised * 0.35)) * alb;
      if (vic) tone *= 1.0 - smoothstep(0.0, 30.0, reactor) * 0.55;
      hullAcc = mix(hullAcc, tone, hull);
      cov = max(cov, hull);
      /* the lit bays and ports, warm, on a hull that still has power */
      glow += emCol * vec3(1.0, 0.92, 0.78) * em * (1.0 - burn) * 1.6;
    }

    /* Engines. A soft bar at the stern, and the distance it falls off along is
     * the ROUNDED box distance rather than the Chebyshev one: max(dx, dy) has
     * square level sets, so an exponential falloff off it is a four-pointed
     * star and every engine in the fleet came out as a lens flare. A wreck's
     * engines are out. */
    if (near && (!vic || brk < 0.001)) {
      vec2 engD = vec2(abs(h.x + L * 1.02) - L * 0.03, abs(h.y) - W * (kind > 1.5 && kind < 2.5 ? 0.3 : 0.55));
      glow += emCol * exp(-length(max(engD, 0.0)) / (W * 0.42 + aa)) * 0.85 * big * (1.0 - burn * 0.8);
    }

    /* Fires, on the one that is dying. A cell along the keel lights when the
     * clock passes its own hash, so the burn SPREADS from a couple of hits to
     * the length of the ship rather than fading up everywhere at once. */
    if (vic && near) {
      float cell = floor((h.x + L) / (L * 0.14));
      float fh = hash13(vec3(cell, 0.0, 3.0));
      float lit01 = step(fh, burn * 1.4) * hull;
      float flick = 0.62 + 0.38 * sin(t * (5.0 + fh * 8.0) + fh * 30.0);
      glow += vec3(1.0, 0.40, 0.11) * lit01 * flick * 1.9 * (1.0 - smoothstep(20.0, 60.0, reactor));
      /* the break: one flash, four seconds wide */
      float f = max(1.0 - abs(tc - T_BREAK - 0.5) * 0.5, 0.0);
      float fem, fra;
      glow += vec3(1.0, 0.82, 0.55) * f * f * shipMask(h, kind, L * 1.5, W * 2.2, aa, fem, fra) * 5.5;
      /* …and the reactor. The biggest thing in the sky for six seconds: a
       * white core that swells and cools to orange, and a shock ring that
       * runs out past the whole line. */
      if (reactor > 0.0 && reactor < 7.0) {
        vec2 aftC = c + rotBy(vec2(-L * 0.5, 0.0), hd);
        float rr = length(q - aftC);
        float r0 = 0.006 + reactor * 0.045;
        float core = smoothstep(r0, r0 * 0.3, rr) * pow(1.0 - reactor / 7.0, 1.6);
        float ring = exp(-(rr - r0 * 1.6) * (rr - r0 * 1.6) / (3.0e-5 + reactor * 4.0e-5)) * (1.0 - reactor / 7.0);
        float white = max(1.0 - reactor * 2.0, 0.0);
        vec3 fcol = mix(vec3(1.0, 0.55, 0.22), vec3(1.0), white);
        glow += fcol * (core * 7.0 + ring * 2.2) + vec3(1.0) * exp(-rr / 0.09) * white * white * 3.0;
      }
    }

    /* ── ION FLASH AND SHIELD BLOOM, FROM THE FIGHTERS' STRAFES ─────────
     * A shot that lands on a hull is the difference between a light show and
     * a fight going badly. The bloom is the shell lighting up a hull-length
     * out; the ion flash is the hull going blue-white for a fifth of a
     * second. A dying hull has no shield to light. */
    float hitPer = 14.0 + fi * 3.7;
    float hitN = floor(tc / hitPer + hash11(fi * 5.53 + 2.9));
    float hitAge = tc - (hitN - hash11(fi * 5.53 + 2.9)) * hitPer;
    if (near && hitAge >= 0.0 && hitAge < 0.65 && fire > 0.3 && !(vic && burn > 0.0)) {
      vec2 rel = q - c;
      float rr = length(rel);
      float r0 = L * 0.80 + hitAge * L * 2.0;
      float wdt = L * (0.09 + hitAge * 0.40);
      float inA = hash11(fi * 3.91 + hitN * 0.317) * 6.2832;
      float face = 0.20 + 0.80 * max(dot(rel / max(rr, 1.0e-5), vec2(cos(inA), sin(inA))), 0.0);
      float shellM = exp(-(rr - r0) * (rr - r0) / (wdt * wdt + 1.0e-10)) * face;
      float fade = 1.0 - hitAge / 0.65;
      glow += vec3(0.52, 0.78, 1.0) * saberCelQuant(clamp(shellM, 0.0, 1.0), 3.0) * fade * fade * 1.4;
      float ion = max(1.0 - hitAge * 5.0, 0.0);
      glow += vec3(0.62, 0.84, 1.0) * ion * ion * hull * 2.0;
    }

    /* ── ITS GUNS ───────────────────────────────────────────────────────
     * Two batteries a hull, at one hull on the other line, each firing a
     * BURST of three every six to ten seconds — a volley is a rhythm and a
     * rhythm is what the old one-bolt-a-gun-a-cycle never had. A bolt takes
     * a second and a half to cross, which is a bar of light crossing a gulf:
     * the only way scale reads out there. Where it lands, a crescent on the
     * shield facing the way it came; on a hull that is already burning, a
     * fireball instead. A broken ship neither fires nor is worth firing at:
     * the batteries retarget. */
    if (fire > 0.002 && !(vic && tc > T_BREAK)) {
      float side = slotSide(fi, victim);
      float oBase = side < 0.5 ? 4.0 : 0.0;
      float dst = oBase + floor(mod(fi * 1.7 + 1.0, 4.0));
      if (abs(dst - victim) < 0.5 && tc > T_BREAK) dst = oBase + mod(dst - oBase + 1.0, 4.0);
      vec4 D = slotAt(dst);
      if (tc >= D.w + 1.1) {
        vec2 b = D.xy;
        bool dVic = abs(dst - victim) < 0.5;
        if (dVic) b += fallOff;
        float tBurn = dVic ? clamp((tc - T_BURN) / 20.0, 0.0, 1.0) : 0.0;
        /* our colour on our guns, theirs on theirs; half the Republic's are green */
        bool ourGun = abs(side - uSide) < 0.5;
        vec3 boltA = ourGun ? uBoltCol : uFoeCol;
        vec3 boltB = boltA;
        if (side < 0.5) boltB = mix(boltA, vec3(0.35, 1.0, 0.45), 0.75);
        vec2 inD = normalize(c - b + vec2(1.0e-5, 0.0));
        vec4 G = uGun[i];
        for (int g = 0; g < 2; g++) {
          float per = g < 1 ? G.x : G.z;
          float phs = g < 1 ? G.y : G.w;
          /* the batteries come on line with the engagement, longest-period last */
          if ((per - 6.0) * 0.25 > fire) continue;
          vec3 bolt = g < 1 ? boltA : boltB;
          float age = fract(tc / per + phs) * per;
          /* the battery sits a little off the keel, so the two do not overlap */
          vec2 a = c + rotBy(vec2(L * (0.2 - float(g) * 0.5), W * (float(g) - 0.5) * 0.8), hd);
          for (int j = 0; j < 3; j++) {
            float u = (age - float(j) * 0.42) / 1.5;
            if (u <= 0.0 || u > 1.34) continue;
            if (u <= 1.0) {
              vec2 tip = mix(a, b, u), tail = mix(a, b, max(u - 0.12, 0.0));
              float dd = segDist(q, tail, tip);
              float hd = length(q - tip);
              glow += bolt * (smoothstep(0.0019, 0.0006, dd) * 2.8 + exp(-dd / 0.0045) * 0.35)
                    + mix(bolt, vec3(1.0), 0.6) * exp(-hd * hd / 4.0e-6) * 2.0;
            } else {
              float ia = (u - 1.0) * 1.5;
              vec2 rel = q - b;
              float rr = length(rel);
              if (tBurn > 0.5) {
                float r = 0.003 + ia * 0.016;
                glow += vec3(1.0, 0.62, 0.30) * smoothstep(r, r * 0.3, rr) * (1.0 - ia * 2.0) * 3.0;
              } else {
                float r0 = 0.012 + ia * 0.05;
                float wdt = 0.004 + ia * 0.012;
                float face = max(dot(rel / max(rr, 1.0e-5), inD), 0.0);
                face = face * face;
                float shellM = exp(-(rr - r0) * (rr - r0) / (wdt * wdt)) * face;
                float fade = 1.0 - ia * 2.0;
                glow += mix(bolt, vec3(1.0), 0.45) * saberCelQuant(clamp(shellM, 0.0, 1.0), 3.0) * fade * fade * 2.2;
              }
            }
          }
        }
      }
    }
  }

  /* ── fighters ─────────────────────────────────────────────────────────
   * Points of light, and fast. Nothing about a fighter at this range is a
   * shape; what identifies it is that it is the only thing in the frame that
   * moves quickly, which is exactly the depth cue the capitals cannot give.
   *
   * IN ARCS, NOT SINUSOIDS. Two swarms of twelve, each swarm wheeling about a
   * point that drifts between two capitals — one of ours, one of theirs — so
   * the fight is always AROUND something. Each fighter sits on its own
   * ellipse about that point, at its own rate, with the ellipse itself
   * turning, which is the shape a dogfight has from a distance: everything
   * curving, nothing repeating. Drawn as a short segment from where it was to
   * where it is, which is the cheapest honest motion blur there is. */
  float screen = smoothstep(T_CLOSED - 25.0, T_CLOSED, tc) * (1.0 - smoothstep(T_WITHDRAW - 8.0, T_WITHDRAW + 4.0, tc));
  if (screen > 0.002) {
    for (int s = 0; s < 2; s++) {
      float fs = float(s);
      vec2 A = fs < 0.5 ? uSlot[0].xy : uSlot[2].xy;
      vec2 B = fs < 0.5 ? uSlot[5].xy : uSlot[4].xy;
      if (fs < 0.5 && victim > 4.0) B += fallOff;
      if (fs > 0.5 && victim < 4.0) A += fallOff;
      vec2 centre = mix(A, B, 0.5 + 0.42 * sin(t * 0.045 + fs * 3.1));
      if (max(abs(q.x - centre.x), abs(q.y - centre.y)) > 0.24) continue;
      /* the swarm's ellipse turns as one; each fighter has its own place and
       * rate on it. Three trig calls a fighter: the trail and the shot both
       * come off the same velocity vector the position does. */
      float tilt = t * 0.11 + fs * 2.4;
      float ct = cos(tilt), st = sin(tilt);
      mat2 tm = mat2(ct, st, -st, ct);
      for (int k = 0; k < 12; k++) {
        float fk = float(k) + fs * 12.0;
        float a = hash11(fk * 1.73 + 2.3);
        float b = fract(a * 7.31 + 0.43), c = fract(a * 13.7 + 0.81);
        float rate = (1.1 + a * 0.9) * (c < 0.5 ? 1.0 : -1.0);
        float rr = 0.055 + 0.075 * (0.5 + 0.5 * sin(t * 0.31 + b * 6.2832));
        float th = t * rate + fk * 0.52;
        float cth = cos(th), sth = sin(th);
        vec2 p = centre + tm * (vec2(cth, 0.42 * sth) * rr);
        vec2 vel = tm * (vec2(-sth, 0.42 * cth) * rr * rate);
        float dd = segDist(q, p - vel * 0.07, p);
        vec3 fc = mix(vec3(1.0), c < 0.5 ? uBoltCol : uFoeCol, 0.45);
        glow += fc * (exp(-dd * dd / 1.6e-6) * 1.3 + exp(-dd / 0.0035) * 0.25) * screen;
        /* …and it is shooting at the one ahead of it */
        float sh = fract(t * 0.9 + a * 7.0);
        if (sh < 0.12) {
          vec2 vd = normalize(vel + vec2(1.0e-6, 0.0));
          vec2 pS = p + vd * (0.006 + sh * 0.12);
          glow += (c < 0.5 ? uBoltCol : uFoeCol) * smoothstep(0.0016, 0.0004, segDist(q, pS, pS + vd * 0.009)) * 2.4 * screen;
        }
      }
    }
  }

  /* ── bombers ──────────────────────────────────────────────────────────
   * Five in a line, out of one of our hangars at one of their capitals,
   * every fifty seconds during the volleys. Nine seconds across; then a
   * string of six hits walked down the target's keel four tenths of a second
   * apart, each a small fireball that swells and goes out. */
  if (fire > 0.3) {
    float bPer = 50.0;
    float bN = floor(tc / bPer + 0.37);
    float bAge = tc - (bN - 0.37) * bPer;
    float bh = hash11(bN * 2.9 + 4.4);
    float tgt = uSide < 0.5 ? (bh < 0.5 ? 4.0 : 6.0) : (bh < 0.5 ? 0.0 : 3.0);
    if (abs(tgt - victim) < 0.5) tgt = tgt + 1.0;
    if (bAge > 0.0 && bAge < 11.7) {
    vec4 Fs = uSide < 0.5 ? uSlot[2] : uSlot[7];
    vec4 Ts = slotAt(tgt);
    vec2 pF = Fs.xy, pT = Ts.xy;
    float hT = Ts.z;
    if (bAge < 9.0) {
      for (int k = 0; k < 5; k++) {
        float u = (bAge - float(k) * 0.32) / 8.4;
        if (u <= 0.0 || u > 1.0) continue;
        vec2 p = mix(pF, pT, u);
        p.y += sin(u * 3.14159) * 0.05 * (bh - 0.5);
        float dd = length(q - p);
        glow += vec3(1.0, 0.95, 0.85) * exp(-dd * dd / 1.4e-6) * 0.9;
      }
    }
    float hitAge = bAge - 8.5;
    if (hitAge > 0.0 && hitAge < 3.2) {
      float Lt = 0.068 * slotBig(tgt);
      for (int k = 0; k < 6; k++) {
        float a = hitAge - float(k) * 0.42;
        if (a <= 0.0 || a > 0.7) continue;
        vec2 p = pT + rot2(vec2((float(k) - 2.5) * Lt * 0.32, (hash11(bN + float(k) * 1.7) - 0.5) * Lt * 0.2), hT);
        float dd = length(q - p);
        float r = 0.002 + a * 0.012;
        glow += vec3(1.0, 0.66, 0.32) * smoothstep(r, r * 0.35, dd) * (1.0 - a / 0.7) * 3.2
              + vec3(1.0, 0.5, 0.2) * exp(-dd / 0.006) * (1.0 - a / 0.7) * 0.4;
      }
    }
    }
  }

  /* ── THE ONES THAT COME PAST YOU ──────────────────────────────────────
   *
   * Everything else out there is slow on purpose, and a scene where nothing
   * moves quickly has no scale at the near end: the eye has nothing to measure
   * the capitals' slowness AGAINST. So four passes, in pairs, crossing the
   * whole field in two and a half seconds — one running, one on its tail,
   * bolts going between them. Bounded to a pass every fifteen to thirty
   * seconds each, so they are an event rather than traffic. */
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float per = 15.0 + fk * 5.1;
    float ph = fract(t / per + hash11(fk * 8.13 + 1.3));
    if (ph < 0.17 && screen > 0.5) {
      float u = ph / 0.17;
      float a = hash11(fk * 2.71 + 0.5), b = hash11(fk * 4.93 + 3.1);
      float side = a < 0.5 ? -1.0 : 1.0;
      vec2 from = vec2(side * -1.25, (b - 0.5) * 0.85);
      vec2 to = vec2(side * 1.25, (b - 0.5) * 0.85 + (a - 0.5) * 0.72);
      for (int j = 0; j < 2; j++) {
        float uj = u - float(j) * 0.055;
        if (uj <= 0.0) continue;
        vec2 tip = mix(from, to, uj), tl = mix(from, to, max(uj - 0.045, 0.0));
        float dd = segDist(q, tl, tip);
        vec3 cCol = j < 1 ? uFoeCol : uBoltCol;
        glow += mix(vec3(1.0), cCol, 0.40)
              * (smoothstep(0.0038, 0.0009, dd) * 2.4 + exp(-dd / 0.008) * 0.35);
      }
      float shot = fract(u * 7.0);
      if (shot < 0.42) {
        float su = u - 0.055 + shot * 0.13;
        vec2 bt = mix(from, to, clamp(su, 0.0, 1.0));
        vec2 bh = mix(from, to, clamp(su + 0.020, 0.0, 1.0));
        glow += uBoltCol * smoothstep(0.0022, 0.0006, segDist(q, bt, bh)) * 2.6;
      }
    }
  }

  /* ── DOWN TO THE SURFACE ──────────────────────────────────────────────
   *
   * Landing craft leave our line in strings and go down, and the last stretch
   * of that trip is through air: the speck lengthens into a streak, warms, and
   * goes out at the limb. Three lanes of four, on one flattened loop.
   *
   * The target is the near EDGE of the disc rather than its centre — a craft
   * that appears to fly into the middle of a world is a craft flying at the
   * camera, and the whole point of this layer is that it is going away. */
  if (uLanding > 0.002 && screen > 0.002) {
    for (int ln = 0; ln < 3; ln++) {
      float lane = float(ln);
      vec2 org = uSide < 0.5 ? uSlot[ln].xy : uSlot[ln + 4].xy;
      vec2 toW = pq - org;
      vec2 aim = pq - normalize(toW + vec2(1.0e-5, 0.0)) * pr * 0.86;
      vec2 tgt = aim + vec2(hash11(lane * 3.3) - 0.5, hash11(lane * 5.9) - 0.5) * pr * 0.5;
      /* only pixels near the lane's line see any of its four craft */
      if (segDist(q, org, tgt) > 0.02) continue;
      for (int k = 0; k < 4; k++) {
        float slot = float(k);
        float u = fract(t / (34.0 + lane * 9.0) + slot * 0.16 + hash11(lane * 7.7));
        vec2 p = mix(org, tgt, u);
        float dd = length(q - p);
        float burn = smoothstep(0.80, 0.94, u) * (1.0 - smoothstep(0.965, 1.0, u));
        vec2 back = mix(org, tgt, max(u - 0.030 * burn - 0.004, 0.0));
        float sd = segDist(q, back, p);
        glow += mix(vec3(1.0), vec3(1.0, 0.62, 0.28), burn)
              * (exp(-dd * dd / 1.4e-6) * (0.35 + 0.25 * burn)
               + smoothstep(0.0016, 0.0004, sd) * burn * 2.2) * uLanding * screen;
      }
    }
  }

  /* ── what is left of the one that broke ───────────────────────────────
   * The tumble is the point. A plate turning end over end in vacuum flashes as
   * it catches the star, so brightness is |sin| on its own rate, quantised to
   * three plates. The cloud spreads from the reactor, cools to shade over a
   * minute, and falls with the rest of the wreck. */
  float dAge = tc - T_REACTOR;
  if (dAge > 0.0 && wreckGone < 0.999) {
    vec2 wreck = vPos + fallOff;
    if (max(abs(q.x - wreck.x), abs(q.y - wreck.y)) < 0.02 + dAge * 0.004) {
      for (int k = 0; k < 20; k++) {
        float fk = float(k);
        float a = hash11(fk * 1.13 + 0.7), b = hash11(fk * 2.29 + 1.9), c = hash11(fk * 3.71 + 3.3);
        vec2 p = wreck + vec2((a - 0.5) * 2.0, (b - 0.5) * 1.2) * (0.004 + dAge * 0.0022);
        float dd = max(abs(q.x - p.x) - 0.0014 - c * 0.0024, abs(q.y - p.y) - 0.0010 - c * 0.0016);
        float chunk = smoothstep(aa, -aa, dd) * (1.0 - wreckGone);
        float tum = saberCelQuant(0.16 + 0.84 * abs(sin(t * (0.5 + c * 1.5) + a * 6.2832)), 3.0);
        vec3 ct = mix(lit * tum, shade, smoothstep(10.0, 70.0, dAge));
        hullAcc = mix(hullAcc, ct, chunk);
        cov = max(cov, chunk);
        /* the hot ones glow for the first half minute */
        glow += vec3(1.0, 0.45, 0.15) * chunk * step(0.6, c) * max(1.0 - dAge / 30.0, 0.0) * 1.2;
      }
    }
  }
  /* the wreck burning in: the last of its fall is through air */
  if (fall > 0.55 && wreckGone < 0.999) {
    vec2 wreck = vPos + fallOff;
    float dd = length(q - wreck);
    float entry = smoothstep(0.55, 0.85, fall) * (1.0 - wreckGone);
    vec2 back = vPos + fallOff * 0.94;
    glow += vec3(1.0, 0.58, 0.24) * (exp(-dd / 0.012) * 1.6 + smoothstep(0.004, 0.001, segDist(q, back, wreck)) * 2.0) * entry;
  }

  /* ── something else going up, a long way off ────────────────────────────
   *
   * Read from uBlast rather than scheduled here — see the note on that uniform.
   * z is the age in seconds and negative means this slot is idle, so the whole
   * layer is three compares when nothing is happening.
   *
   * NO SOUND, and that is the point of it: light arrives now and the shock
   * arrives through the hull a couple of seconds later, which is a thing the
   * player feels rather than sees. */
  for (int k = 0; k < 3; k++) {
    vec4 blast = uBlast[k];
    float ag = blast.z;
    if (ag >= 0.0 && ag < 1.0) {
      float dd = length(q - blast.xy);
      float r = (0.004 + ag * 0.055) * blast.w;
      float core = smoothstep(r, r * 0.25, dd) * (1.0 - ag) * (1.0 - ag);
      float ring = exp(-(dd - r) * (dd - r) / (2.6e-5 * blast.w * blast.w)) * (1.0 - ag);
      glow += mix(vec3(1.0, 0.86, 0.58), uBoltCol, 0.25) * (core * 3.4 + ring * 1.6) * blast.w;
    }
  }

  return vec4(hullAcc * cov + glow * uFleet, cov * uFleet);
}

/**
 * ══ THE WORLD OUTSIDE ═════════════════════════════════════════════════════
 *
 * An analytic disc on dot(dir, uPlanetDir), with the surface normal recovered
 * from the impact parameter — no ray-sphere intersection, no geometry, no
 * second depth range. At the sub-viewer point the normal is -uPlanetDir and at
 * the limb it is the ray's own perpendicular, and everything between is one
 * sqrt.
 *
 * SHADED IN PLATES. The terminator is a quantised N·L, so the day side is
 * three flat fields with the star's direction still legible across them, and
 * the boundary between them is drawn rather than smeared. A body this size
 * gets four plates in the final band rather than the deck's three: it is the
 * largest single field in the frame and the one the player asked for detail
 * on, and three plates put the whole of a continent into one tone.
 *
 * THE RING is the sphere's own geometry made explicit: the disc is a sphere
 * of radius uPlanetSin at unit distance along uPlanetDir, the ring is the
 * plane through its centre normal to uRingAxis, and the ray, the sphere and
 * the plane are intersected in that frame. Behind the sphere the ring is
 * hidden; in its shadow the ring is dark; and the ring throws a band of shadow
 * back across the day side, which is the cue that puts it in the same space
 * as the world rather than drawn over it.
 */
vec3 orbitScene(vec3 dir) {
  /* Both derivatives are taken here, ahead of every branch below. fwidth in
   * non-uniform control flow is undefined, and every guard from this point on
   * is a per-pixel test. */
  vec3 F = uFleetDir;
  vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), F));
  vec3 U = cross(F, R);
  float w = dot(dir, F);
  vec2 q = vec2(dot(dir, R), dot(dir, U)) / max(w, 1.0e-3);
  float aa = (fwidth(q.x) + fwidth(q.y)) * 0.6;

  float d = dot(dir, uPlanetDir);
  vec3 perp = dir - uPlanetDir * d;
  float pl = length(perp);
  /* The impact parameter, normalised: 0 at the centre of the disc, 1 at the
   * limb, and it keeps going past 1 into the air outside. */
  float s = pl / max(uPlanetSin, 1.0e-4);
  float aaS = fwidth(s) * 0.75 + 1.0e-5;

  vec3 col = uSpaceCol + starField(dir);

  float reach = uRingAmt > 0.002 ? max(1.30, uRingOut * 1.06) : 1.30;
  if (d > 0.0 && s < reach) {
    vec3 e = perp / max(pl, 1.0e-6);
    /* the ring: where this ray meets the plane, in planet radii, and whether
     * the sphere is in the way */
    float ringDen = 0.0, ringLit = 0.0;
    if (uRingAmt > 0.002) {
      float dn = dot(dir, uRingAxis);
      float tau = dot(uPlanetDir, uRingAxis) / (abs(dn) < 1.0e-4 ? 1.0e-4 : dn);
      if (tau > 0.0) {
        vec3 rv = dir * tau - uPlanetDir;
        float rr = length(rv) / uPlanetSin;
        float tauNear = d - sqrt(max(uPlanetSin * uPlanetSin - pl * pl, 0.0));
        float front = (s >= 1.0 || tau < tauNear) ? 1.0 : 0.0;
        float band = smoothstep(uRingIn, uRingIn + 0.06, rr) * (1.0 - smoothstep(uRingOut - 0.10, uRingOut, rr));
        float grain = 0.45 + 0.55 * vnoise(vec2(rr * 9.0 + uPlanetSeed.x, 1.7));
        float gapR = mix(uRingIn, uRingOut, 0.60);
        grain *= 1.0 - 0.85 * (1.0 - smoothstep(0.0, 0.035, abs(rr - gapR)));
        ringDen = band * grain * front * uRingAmt;
        /* in the world's shadow */
        float along = dot(rv, uSunDir);
        float offAx = length(rv - uSunDir * along);
        float shadow = (along < 0.0 && offAx < uPlanetSin) ? 0.06 : 1.0;
        ringLit = shadow * (0.30 + 0.70 * abs(dot(uRingAxis, uSunDir)));
      }
    }

    if (s < 1.30) {
    vec3 n = normalize(e * s - uPlanetDir * sqrt(max(1.0 - s * s, 0.0)));
    float ndl = dot(n, uSunDir);
    /* THE TERMINATOR HAS TO BE WIDE ENOUGH TO HAVE PLATES IN IT. (-0.25, 0.55)
     * puts the two middle plates over about forty degrees, so the day side is
     * a set of concentric crescents that close on the sub-solar point. */
    float day = saberCelQuant(clamp(smoothstep(-0.25, 0.55, ndl), 0.0, 1.0), 3.0);

    /* The surface, in the planet's own frame, and the seed is what makes it
     * THIS world's surface: every field below reads the same offset. */
    vec3 bp = spinAbout(n, uPlanetAxis, uPlanetSpin) + uPlanetSeed;
    /* The coast is torn at a frequency an order of magnitude above the landmass
     * it bounds: the outline of a real thing is not the level set of a smooth
     * field. Zero mean, so it cannot move the sea fraction. The same term is
     * read again below as the canyon seams, for nothing. */
    float fine = orbFbm2(bp * 17.0);
    float cont = orbFbm4(bp * 1.9) + (fine - 0.375) * 0.060;
    float relief = orbFbm(bp * 5.3 + 21.7);
    float seaThr = mix(0.34, 0.50, uSeaAmt);
    float sea = 1.0 - smoothstep(seaThr - 0.012, seaThr + 0.012, cont);

    vec3 land = mix(uLandCol, uRockCol, smoothstep(0.34, 0.54, relief));
    land = mix(land, uBasinCol, smoothstep(seaThr + 0.09, seaThr, cont) * 0.55);
    /* canyons: dark seams where the fine term drops, on the high ground */
    land = mix(land, uBasinCol * 0.55, smoothstep(0.30, 0.22, fine) * smoothstep(0.30, 0.44, relief) * 0.7);
    /* Ice, at whatever latitude this world keeps it. The relief breaks the
     * line so a cap is a coastline and not a circle drawn with a compass. */
    float lat = abs(dot(n, uPlanetAxis));
    float cap = uCapAmt * smoothstep(0.62, 0.84, lat + (relief - 0.40) * 0.36);
    vec3 iceCol = mix(vec3(0.88, 0.93, 1.0), uAtmoCol, 0.25) * 0.82;
    vec3 albedo = mix(mix(land, uSeaCol, sea * (1.0 - uSeaGlow)), iceCol, cap);

    /* The deck, in the planet's other frame — slower than the surface, so the
     * weather visibly shears across the land it is over. */
    vec3 cp = spinAbout(n, uPlanetAxis, uCloudSpin) + uPlanetSeed * 1.3;
    /* …and the same deck a few degrees toward the star, which is where the
     * shadow it casts lands on the ground. */
    vec3 sunT = uSunDir - n * ndl;
    vec3 cps = spinAbout(normalize(n + sunT * 0.045), uPlanetAxis, uCloudSpin) + uPlanetSeed * 1.3;
    /* STORMS. Two cyclones, placed off the seed in the cloud frame. Inside a
     * tenth of a radian of one the cloud field is ROTATED about it — the arms
     * — and at a third of that an eye wall of solid cloud with a clear eye.
     * Two Rodrigues rotations a pixel, and only the swirl term is per-storm. */
    float eye = 0.0;
    if (uStormAmt > 0.002) {
      for (int j = 0; j < 2; j++) {
        float fj = float(j) * 3.1 + uPlanetSeed.y;
        vec3 Sc = normalize(vec3(hash11(fj + 0.3) - 0.5, (hash11(fj + 1.7) - 0.5) * 0.7, hash11(fj + 2.9) - 0.5));
        float ax = dot(cp, Sc);
        vec3 v = cp - Sc * ax;
        float dd = length(v);
        float sw = uStormAmt * 3.2 * exp(-dd / 0.075);
        cp = Sc * ax + spinAbout(v, Sc, sw);
        eye = max(eye, uStormAmt * exp(-(dd - 0.026) * (dd - 0.026) / 1.5e-4) * (1.0 - exp(-dd * dd / 6.0e-5)));
      }
    }
    float cThr = mix(0.56, 0.30, uCloudAmt);
    float cm = smoothstep(cThr, cThr + 0.075, orbFbm(cp * 3.1 + 9.4));
    cm = max(cm, eye);
    cm *= smoothstep(1.0, 0.90, s);
    float cmS = smoothstep(cThr, cThr + 0.075, orbFbm(cps * 3.1 + 9.4));

    /* …and the ground itself dims toward the limb, where the light leaves
     * through a long slant of the same air the rim glow is made of. */
    float slant = mix(1.0, 0.66, smoothstep(0.58, 1.0, s));
    /* the cloud's shadow on the ground, only where there is no cloud over it */
    float cShadow = 1.0 - cmS * (1.0 - cm) * 0.45;
    /* the ring's shadow on the ground: the sunward ray from this point through
     * the ring plane */
    float rShadow = 1.0;
    if (uRingAmt > 0.002) {
      float sdn = dot(uSunDir, uRingAxis);
      float ts = -dot(n, uRingAxis) * uPlanetSin / (abs(sdn) < 1.0e-3 ? 1.0e-3 : sdn);
      if (ts > 0.0) {
        float rr = length(n * uPlanetSin + uSunDir * ts) / uPlanetSin;
        float band = smoothstep(uRingIn, uRingIn + 0.06, rr) * (1.0 - smoothstep(uRingOut - 0.10, uRingOut, rr));
        rShadow = 1.0 - band * uRingAmt * 0.55;
      }
    }
    vec3 body = albedo * uOrbitKey * uStarCol * day * slant * cShadow * rShadow;
    /* A night side is not black. It is lit by the star's light scattered
     * through the world's own air, which is why this term carries the limb's
     * colour and not a grey. */
    body += albedo * uOrbitKey * uAtmoCol * 0.035;
    /* …and a lava sea does not go out at the terminator. */
    if (uSeaGlow > 0.5) {
      float vein = smoothstep(0.44, 0.62, orbFbm2(bp * 13.0 + 5.5));
      body += uSeaCol * sea * uOrbitKey * (0.05 + 0.95 * vein) * (1.0 - day * 0.80);
      /* the crust round a lava sea glows faintly with it */
      body += uSeaCol * uOrbitKey * 0.10 * (1.0 - sea) * smoothstep(seaThr + 0.10, seaThr, cont) * (1.0 - day * 0.6);
    }

    /* THE GLINT. The star in the water, where the surface normal bisects the
     * ray and the star. Quantised to two plates so it is a drawn highlight —
     * a flat bright disc with an edge — and not a lobe. On open water only,
     * and not under cloud. */
    if (uGlint > 0.002) {
      vec3 hv = normalize(uSunDir - dir);
      float spec = pow(max(dot(n, hv), 0.0), 110.0) * sea * (1.0 - uSeaGlow) * (1.0 - cm) * uGlint;
      body += uStarCol * uOrbitKey * saberCelQuant(clamp(spec * 1.8, 0.0, 1.0), 2.0) * 0.5 * day;
    }

    vec3 cloudCol = (uPlanetLit * uStarCol * day * 0.95 + uPlanetDark * uAtmoCol * 0.10) * uOrbitKey;
    body = mix(body, cloudCol, cm * 0.92);

    /* ── CITY LIGHTS ──────────────────────────────────────────────────
     * The one thing on a night side that is not the star's light bounced off
     * something. Sparse, warm, on land only, under the cloud that is over it.
     * Two gates make them CLUSTER — people live in a few regions — and a third,
     * fine one puts the GRAIN in: individual specks inside a conurbation, so a
     * settled world has ten thousand lights and not three soft patches. */
    if (uCityAmt > 0.002 && day < 0.5) {
      float grid = orbFbm2(bp * 34.0 + 3.3);
      float region = smoothstep(0.38, 0.52, orbFbm2(bp * 7.0 + 61.0));
      float lamp = smoothstep(0.46, 0.58, grid) * region;
      float speck = smoothstep(0.66, 0.78, vnoise3(bp * 140.0)) * smoothstep(0.40, 0.50, grid) * region;
      lamp = max(lamp, speck * 0.8);
      lamp *= (1.0 - sea) * (1.0 - cap) * (1.0 - day) * (1.0 - cm * 0.80) * uCityAmt;
      body += vec3(1.0, 0.80, 0.48) * saberCelQuant(clamp(lamp, 0.0, 1.0), 3.0) * uOrbitKey * 0.42;
    }

    /* THE AIR. Thickening toward the limb: the path through it is longest
     * where you are looking along it — a Fresnel rim in the scatter colour,
     * lit on the day side, and a TWILIGHT band past the terminator where the
     * air is still in the star and the ground under it is not. The old rim
     * went as N·L and vanished exactly where a limb is most visible. */
    float rim = smoothstep(0.52, 1.0, s);
    float twi = smoothstep(-0.45, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.50, ndl));
    body += uScatterCol * uOrbitKey * (rim * rim * max(ndl, 0.0) * 0.42 + rim * rim * rim * twi * 0.34);
    /* dust in the air over the day side, most of it toward the limb */
    body = mix(body, uScatterCol * uOrbitKey * day * 0.50, uHazeAmt * (0.22 + 0.78 * rim) * day);

    /* ── A SHOULDER, AND IT IS LOAD-BEARING ───────────────────────────
     * saberCelBand quantises sqrt(luminance), so the plate above 1.0 is 1.96
     * times the one below it; a field that drifts across that node JUMPS.
     * Asymptote 0.96, knee 0.52 — a lit surface keeps its range up to where
     * the top plate begins and can approach the node without reaching it.
     * The things that ARE allowed to bloom out here are small and additive
     * and come after this: a turbolaser, a detonation, a hull on fire. */
    float bl = dot(body, LUM_W);
    if (bl > 0.52) body *= (0.52 + (bl - 0.52) / (1.0 + (bl - 0.52) / 0.44)) / max(bl, 1.0e-4);

    body = saberCelBand(body, 4.0);
    float pcov = smoothstep(1.0 + aaS, 1.0 - aaS, s);
    col = mix(col, body, pcov);

    /* …and the same air seen past the edge of the world. THE PRODUCT IS
     * QUANTISED, NOT THE TERMS, so the boundaries fall on contours of the halo
     * itself, which follow the rim. */
    float outAir = smoothstep(1.13, 1.00, s) * smoothstep(1.0 - aaS, 1.0 + aaS, s);
    col += mix(uAtmoCol, uScatterCol, 0.6) * uOrbitKey * 0.62
         * saberCelQuant(clamp(outAir * (dot(e, uSunDir) * 0.85 + 0.15), 0.0, 1.0), 3.0);
    }

    if (ringDen > 0.002) {
      vec3 ringCol = uRingCol * uStarCol * uOrbitKey * ringLit;
      float rq = saberCelQuant(clamp(ringDen, 0.0, 1.0), 3.0);
      col = mix(col, saberCelBand(ringCol, 3.0), rq * 0.92);
    }
  }

  /* 0.35 rather than 0.60, and it is the dogfights that moved it: they cross
   * the WHOLE aperture, and a cone that only just contains the line of battle
   * clipped them off halfway. The gnomonic scale factor is 1/w, so 0.35 is
   * where the projection is still under three to one and a hull drawn near the
   * edge of it is not visibly stretched. */
  if (uFleet > 0.002 && w > 0.35) {
    vec2 sq = normalize(vec2(dot(uSunDir, R), dot(uSunDir, U)) + vec2(1.0e-4, 0.0));
    /* Where the world is, in the same plane the fleet is drawn in, so the
     * landing craft and the wreck have something to fall to. Guarded: with
     * the world behind the action the strings are aimed off the near side. */
    float pw = dot(uPlanetDir, F);
    vec2 pq = vec2(dot(uPlanetDir, R), dot(uPlanetDir, U)) / max(pw, 0.25);
    float pr = uPlanetSin / max(uPlanetCos, 0.05);
    vec4 f = fleetScene(q, aa, uOrbitT, sq, pq, pr);
    col = col * (1.0 - f.a) + f.rgb;
  }
  return col;
}
`,
/* glsl */`
  void main() {
    vec3 dir = normalize(vDir);

    /* THE ONE BRANCH THAT SEPARATES A SKY FROM A WINDOW.
     *
     * uOrbit is 0 for every level that has ever shipped, so this is a uniform
     * test that no shipped frame takes: no cost, and — because everything the
     * orbit path reads is a uniform nothing else writes — no way for it to
     * move a single bit of what the seven grounds already draw. It returns
     * before the horizon, the deck and the front, because out there none of
     * the three is a thing that exists.
     *
     * Alpha is flat, and that is deliberate: space is not a translucent
     * medium. The dome is the only thing painting these pixels, so the
     * scene background behind it never shows through and a level cannot half
     * dissolve its own sky by authoring an opacity it forgot about. */
    if (uOrbit > 0.5) {
      gl_FragColor = vec4(orbitScene(dir), uOpacity);
      return;
    }

    float el = dir.y;

    /* A FRONT, as distinct from the air merely not being perfectly still.
     * Weather's unrest rides under every level all the time — it tops out at
     * 0.16 on the dune sea, 0.124 on the arena, 0.187 in the gorge — and it is
     * there so the calm between squalls is not a flat line near the ground.
     * Everything below it has no business clouding the sky over or putting a
     * lid on the zenith: an overhead quietly 11% dust in fair weather is the
     * same bug as a storm that never reaches it, pointing the other way. So
     * the terms that change what the WEATHER IS start above the highest unrest
     * any level authors, and the terms that only thicken the skyline keep
     * reading uStorm raw. */
    float front = smoothstep(0.22, 1.0, uStorm);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // The sky THIS ray is looking at, which is the only honest thing for
    // anything at distance to converge on. 0.15915494 is 1/2pi; the map wraps
    // in bearing so the seam at ±pi interpolates instead of banding.
    float bearing = atan(dir.z, dir.x);
    vec3 skyHere = texture2D(uSkyBand,
      vec2(bearing * 0.15915494 + 0.5, clamp(el / ${BAND_TOP.toFixed(2)}, 0.0, 1.0))).rgb;
    float skyLum = dot(skyHere, LUM_W);

    // ── horizon silhouette ────────────────────────────────────────────
    // Two ranges of painted landform standing behind the three real ones
    // Scenery.js puts at 170/250/340 m. Each is the SKY IN THIS DIRECTION
    // times what a range at that distance gives back, so it is guaranteed
    // darker and bluer than the sky above it in every direction and at every
    // hour, and it composites at full alpha because there is nothing to see
    // through a mountain.
    if (uHorizonAmt > 0.001) {
      float far  = fbm3(vec2(bearing * 2.1, 0.0));
      float near = fbm3(vec2(bearing * 5.3 + 11.0, 3.0));

      float ridgeFar  = (far  - 0.30) * 0.34 * uHorizonScale * uHorizonAmt;
      float ridgeNear = (near - 0.34) * 0.21 * uHorizonScale * uHorizonAmt;

      // The far range is hazier and higher; the near one is darker and lower.
      float aaF = fwidth(el) * 1.5 + 0.0006;
      float mF = smoothstep(ridgeFar + aaF, ridgeFar - aaF, el);
      float mN = smoothstep(ridgeNear + aaF, ridgeNear - aaF, el);
      // only below the skyline, and only just above it
      float win = smoothstep(-0.05, 0.01, el);
      mF *= win; mN *= win;

      // sun side catches a little light on the facing slopes. Held under 1 —
      // the boost may lighten a range toward its sky and never past it.
      float lit = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
      lit = lit * lit;
      /* The land's own colour, demoted to a HUE — renormalised to unit
       * luminance so the level author's swatch can say what the rock is and
       * never how bright a range twenty kilometres out is allowed to be — and
       * then held to a fraction of THIS DIRECTION'S OWN SATURATION.
       *
       * That second half is the point. A fixed pull toward white is a fixed
       * amount of chroma laid over every bearing, and beside the sun, where
       * the sky whites out to 0.006 saturation over a couple of degrees, a
       * fixed 0.20 of a warm swatch is a coloured smear on a neutral sky.
       * Saturation along the pull t is t·(mx−mn) / ((1−t) + t·mx) for a
       * unit-luminance hue, which is monotone, so solving it for the target
       * gives the exact pull rather than a guess. Same construction as
       * capChroma() in Scenery.js, because it is the same claim. */
      vec3 hue = uHorizonColor / max(dot(uHorizonColor, LUM_W), 1.0e-3);
      float hMax = max(max(hue.r, hue.g), hue.b);
      float hMin = min(min(hue.r, hue.g), hue.b);
      float sMax = max(max(skyHere.r, skyHere.g), skyHere.b);
      float skySat = sMax > 1.0e-5 ? (sMax - min(min(skyHere.r, skyHere.g), skyHere.b)) / sMax : 0.0;
      float want = min(BAND_CHROMA * skySat, 0.20);
      float t = clamp(want / max((hMax - hMin) - want * (hMax - 1.0), 1.0e-5), 0.0, 1.0);
      vec3 landHue = mix(vec3(1.0), hue, t);
      vec3 cFar  = skyHere * min(BAND_FAR  * landHue * (1.0 + lit * 0.07), vec3(0.985));
      vec3 cNear = skyHere * min(BAND_NEAR * landHue * (1.0 + lit * 0.09), vec3(0.955));

      col = mix(col, cFar, mF);   alpha = max(alpha, mF);
      col = mix(col, cNear, mN);  alpha = max(alpha, mN);

      // A front takes the distance out. This is the term that makes a squall
      // change what the level IS rather than just what is floating in it: the
      // ranges go first, from the bottom up, and come back as it passes.
      float eaten = uStorm * (1.0 - smoothstep(0.0, 0.30, el));
      col = mix(col, uHazeColor, clamp(eaten * 1.35, 0.0, 1.0));
    }

    // ── clouds ────────────────────────────────────────────────────────
    // Skip everything below the horizon; there is nothing to draw there.
    if (el > 0.004) {
      // Project the view ray onto a flat deck. The 1/el term is what gives
      // clouds their perspective — they crowd together toward the horizon
      // exactly as a real deck does.
      float t = 1.0 / max(el, 0.018);
      vec2 base = dir.xz * t;
      vec2 wind = vec2(cos(uWindDir), sin(uWindDir)) * uWindSpeed * uTime;

      // NB: base only spans ~2 units across the whole visible sky, so a scale
      // near 0.05 samples a SINGLE noise cell — a flat, cloudless wash. At 1.5
      // the deck spans a few cells, the right apparent size for cloud a
      // kilometre up.
      vec2 p = base * 1.5;

      // Coverage as a threshold on density: raising it does not just fade the
      // clouds in, it grows them, which is how a sky actually clouds over.
      // The constants are measured, not guessed: this warped fbm runs p05 0.29
      // to p95 0.70 about a median of 0.50, so 0.60→0.30 walks the sky from 22%
      // covered to 95% as uCoverage goes 0→1. tools/checks/lighting.mjs ports
      // the field and pins those numbers.
      //
      // A FRONT BRINGS ITS OWN CLOUD. Nothing here read uStorm before, which is
      // most of why a full-strength squall on the dune sea left crisp fair
      // weather cumulus over an 80 m whiteout. 0.42 of coverage is the
      // difference between a scattered deck and an overcast one.
      float cover = clamp(uCoverage + front * 0.42, 0.0, 1.0);
      float thr = mix(0.60, 0.30, cover);

      // — parallax. A cumulus is as tall as it is wide, so its top is visibly
      // displaced from its base along the view ray. One cheap iteration: read
      // the density, then re-read it shifted "up" through the deck by that
      // much. Flat noise becomes something with a lit top and a shaded flank.
      float d0 = deck(p, thr, wind);
      vec2  up = -p * 0.16;                       // toward the zenith on the deck
      float d  = deck(p + up * clamp(d0 * 4.0, 0.0, 1.0), thr, wind);

      // — erosion. The outline of a cumulus is not the level set of a smooth
      // field; it is torn by turbulence an order of magnitude finer than the
      // billow it sits on. A high-frequency field subtracted at the RIM only —
      // weighted out by the time the density is 0.22 above threshold, so the
      // core is untouched — eats the silhouette into fringes and wisps. Kept
      // OUT of deck() on purpose: the coverage statistics in
      // tools/checks/lighting.mjs port that function, and this term has zero
      // mean, so it must not be allowed to move the threshold calibration.
      float fine = fbm3(p * 6.3 + wind * 0.028) - 0.5;
      d -= fine * 0.075 * (1.0 - smoothstep(0.0, 0.22, d));

      // Thickness in optical units. d tops out near 0.40, so ×3.4 puts a solid
      // cloud around 1 and a wisp around 0.15.
      float h = clamp(d * 3.4, 0.0, 1.3);
      // Coverage mask. The ramp is 0.085 wide because that is where this field
      // actually lives — at the 0.30 the eye wants, EVERY cloud is a 40%
      // translucent smear and the deck disappears.
      float cum = smoothstep(0.0, 0.085, d);
      // thin toward the horizon so the deck ends in haze, not a line
      cum *= smoothstep(0.0, 0.05, el);

      // — self-shadowing. March toward the sun THROUGH the deck: the sun's
      // direction projected onto the deck plane, divided by its elevation, is
      // exactly the horizontal distance light travels per unit of height.
      // Absorb along it. This is the entire reason a cloud has a bright
      // shoulder and a slate flank, and no amount of noise substitutes for it.
      vec2 sstep = uSunDir.xz / max(uSunDir.y, 0.25) * 0.085;
      float od = clamp(deck(p + sstep,       thr, wind) * 3.4, 0.0, 1.3) * 1.00
               + clamp(deck(p + sstep * 2.3, thr, wind) * 3.4, 0.0, 1.3) * 0.72
               + clamp(deck(p + sstep * 4.2, thr, wind) * 3.4, 0.0, 1.3) * 0.44;
      float trans = exp(-od * 0.85);

      // — powder. Light has not scattered back out of a thin edge yet, so rims
      // facing the sun read DARKER than the body. Without it clouds glow at
      // the edges like neon and the illusion collapses.
      float powder = 1.0 - exp(-h * 3.0);

      // — phase. Forward scattering gives the rim in front of the sun its
      // blaze and the backlit interior its glow. Capped, or a cloud crossing
      // the sun becomes a white hole.
      //
      // NORMALISED so a face the sun reaches square-on returns about 1. The
      // old constants peaked at 0.68 across the side-lit majority of the deck,
      // which quietly took a third off every lit shoulder in the sky — a white
      // body cannot return less light than falls on it and then still read as
      // white. The forward lobe is what is meant to be big here, not the
      // baseline.
      float cosT = dot(dir, uSunDir);
      float phase = min(0.88 + 0.30 * hg(cosT, 0.72), 2.4);

      // and under a front the deck stops having a sunlit face at all: what is
      // over you is the underside of the weather, lit by scattered light only.
      float sun = trans * mix(0.42, 1.0, powder) * phase * (1.0 - 0.72 * front);
      // ambient: the underside is not black, it is lit by the whole dome and
      // by everything the ground throws back up, more so where the cloud is
      // thin. The floor is 0.55 rather than 0.30 because uCloudAmb already
      // carries the multiple-scattering term — light that has bounced twice
      // INSIDE the deck is most of what makes a fair-weather base grey instead
      // of the storm-black a single-scatter model gives you.
      float amb = mix(0.95, 0.55, clamp(h, 0.0, 1.0));

      // The shaded part of a cloud is not "a darker cloud colour" — it is a
      // white surface lit by the BLUE SKY. Multiplying the authored underside
      // by the sky's own chroma is what turns a deck of tan paper cut-outs
      // into cumulus with cold bellies and warm shoulders. The LEVEL of both
      // faces comes from uCloudSun / uCloudAmb; the swatches only tint.
      vec3 cloud = (uCloudDark * uSkyAmb * uCloudAmb * amb
                  + uCloudLit * uCloudSun * sun) * uHdr;
      // a touch of extra silver right on the sunward rim
      cloud += uCloudLit * uCloudSun * uHdr
             * pow(max(cosT, 0.0), 12.0) * (1.0 - clamp(h, 0.0, 1.0)) * cum * 0.35;

      // — cirrus: stretched, faster, much fainter, and high enough that it
      // does not fight the cumulus for the same piece of sky.
      vec2 q = base * vec2(0.50, 2.4) + wind * 0.030;
      float cir = smoothstep(0.50, 0.80, fbm3(q)) * smoothstep(0.03, 0.32, el);
      // Ice, not water: cirrus is thin enough that essentially all of it is
      // lit, so it sits at the deck's own sunlit level rather than below it.
      vec3 cirrusCol = uCloudLit * uCloudSun * uHdr * (0.62 + 0.55 * pow(max(cosT, 0.0), 6.0));

      float ca = clamp(cum, 0.0, 1.0);
      col = mix(col, cloud, ca);
      alpha = max(alpha, ca);
      // cirrus sits over whatever is already there, additively weighted
      float cw = cir * 0.34 * (1.0 - ca * 0.7);
      col = mix(col, cirrusCol, cw);
      alpha = max(alpha, cw);

      // and a wash of haze right at the skyline so the deck, the silhouette
      // and the sky all meet in the same colour. A front lifts that band a long
      // way up the dome — dust does not stay near the ground, and a storm that
      // only fogs the bottom four degrees of the sky reads as a bug in the fog.
      //
      // THE DUST'S HUE AT THE SKY'S OWN LEVEL, in calm air. Painted as
      // uHazeColor outright it was a band of the sunward skyline pasted right
      // round the compass: on the dune sea that is 0.589 laid over an anti-sun
      // sky of 0.391, a fifty per cent lift, and it is most of why the horizon
      // read as milk. Renormalising the dust onto skyLum leaves it able to
      // change the CAST of the skyline and nothing else — which is all a hue
      // can honestly do. Only a real front is allowed to move the level, and
      // then it moves it to exactly what the scene fog converges on, so the
      // ground and the sky meet inside the same wall.
      float bandTop = mix(0.10, 0.62, uStorm);
      float band = (1.0 - smoothstep(0.0, bandTop, el));
      band *= band;
      float wash = band * mix(0.92, 1.0, uStorm);
      vec3 bandCol = mix(mix(skyHere, uHazeHue * skyLum, 0.62), uHazeColor, uStorm);
      col = mix(col, bandCol, wash);
      alpha = max(alpha, band * 0.86);
    }

    /* ── the front, over the WHOLE dome ────────────────────────────────
     *
     * A storm that only fogs the bottom four degrees of the sky is a fog
     * slider, and that is exactly what this was. Measured on the dune sea at
     * forced peak: the horizon band moved luminance 0.511 → 0.731 and
     * saturation 0.197 → 0.064 — real, and welcome — while the sky 200 px above
     * it moved 1.4%. An 80 m whiteout under an untouched clear blue sky with
     * crisp clouds and a hard sun in it.
     *
     * The dust between you and the zenith is the same dust that is between you
     * and the ridge; there is simply less of it, because the path up is short
     * and the path out is not. So the lid falls off with elevation and never to
     * nothing, and because this dome composites over the Preetham sky mesh, it
     * takes the sun's own disc with it — which is what a front actually does.
     *
     * Written as a proper over-operator rather than another mix into col:
     * the frame multiplies the colour by alpha on the way out, so a term that
     * raises alpha has to divide that back out or a half-strength front lands
     * at a quarter strength. */
    if (front > 0.001) {
      float lid = front * mix(1.0, 0.62, smoothstep(0.0, 0.60, max(el, 0.0)));
      float w = clamp(lid * 1.15, 0.0, 1.0);
      float na = 1.0 - (1.0 - w) * (1.0 - alpha);
      col = ((1.0 - w) * col * alpha + w * uHazeColor) / max(na, 1.0e-4);
      alpha = na;
    }

    /* ── FLAT SHAPES, HARD EDGES ───────────────────────────────────────
     *
     * Rule 7 of src/toon/REFERENCE.md: "clouds are solid shapes with a line
     * around them, not volumetric anything." Everything above this point is a
     * volumetric model — self-shadowing through the deck, the powder term at
     * thin rims, forward scattering toward the sun — and every one of those is
     * a smooth function that reads, correctly, as photographed cumulus.
     *
     * None of it is thrown away. It is QUANTISED, which keeps the shape the
     * model produces (a cumulus with a bright shoulder and a cold belly) and
     * loses only the continuity — so the deck comes out as three or four flat
     * fields with the sun's own direction still legible across them. That is
     * the difference between a cel sky and a cut-out sky.
     *
     * The ALPHA is quantised too, and that is what actually makes the edge. A
     * cloud whose colour is banded but whose coverage still ramps smoothly to
     * zero has a soft edge and reads as fog; stepping the coverage is what puts
     * a boundary there for the eye — and for the ink, which cannot see this
     * dome at all (it is transparent, and transparent things are excluded from
     * the outline prepass — see src/toon/Ink.js).
     *
     * COARSER THAN THE SKY BEHIND IT, on purpose: the deck is the subject and
     * the gradient is the ground it sits on.
     *
     * AND THE ALPHA IS QUANTISED TO NODES, NOT TO PLATEAU CENTRES.
     *
     * This read saberCelBand1, and the difference is the whole of Cel.js's own
     * note on the two: saberCelBand1 returns (floor(v*n)+0.5)/n, the CENTRE of
     * the band, which is right for a LEVEL because taking the centre cannot
     * darken a field on average. Coverage is not a level. At five bands the
     * centre of the lowest band is 0.5/5 = 0.100, so a pixel with NO cloud
     * over it composited a tenth of the deck's colour anyway — 6.4 display
     * codes of dark over a bright noon sky, 4.7 over a pale dawn — and the
     * discard below could never fire, because alpha could not get under 0.002.
     *
     * saberCelQuant is floor(v*n+0.5)/n, which lands on the nodes: 0 maps to 0
     * and 1 maps to 1. The clamp stays but is belt-and-braces now rather than
     * load-bearing; it was there because band1 takes an input of exactly 1.0
     * to 1.1.
     *
     * NO BACKTICKS IN HERE. This whole block is inside a GLSL template
     * literal, and a backtick closes it — the first draft of this comment
     * quoted the two function names that way and took four cel checks down
     * with a JS syntax error. */
    col = saberCelBand(col, ${CLOUD_BANDS.toFixed(1)});
    alpha = clamp(saberCelQuant(alpha, ${CLOUD_ALPHA_BANDS.toFixed(1)}), 0.0, 1.0);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`,
].join('\n');

export class SkyDome {
  constructor(scene, opts = {}) {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir:       { value: new THREE.Vector3(0.3, 0.4, 0.85).normalize() },
        uTime:         { value: 0 },
        uCoverage:     { value: 0.42 },
        uCloudLit:     { value: new THREE.Color(0xfff6e6) },
        uCloudDark:    { value: new THREE.Color(0x9aa8bd) },
        uHazeColor:    { value: new THREE.Color(0xd8c8a4) },
        uHorizonAmt:   { value: 1 },
        uHorizonScale: { value: 1 },
        uHorizonColor: { value: new THREE.Color(0x6d6152) },
        uWindDir:      { value: 0.7 },
        uWindSpeed:    { value: 1 },
        uOpacity:      { value: 1 },
        uHdr:          { value: 1 },
        // Defaults are a fair-weather day at a 30° sun with a 0.9-albedo deck,
        // so a SkyDome built without an Engine still draws cloud rather than a
        // black cut-out.
        uCloudSun:     { value: 1.0 },
        uCloudAmb:     { value: 0.42 },
        uSkyAmb:       { value: new THREE.Color(1, 1, 1) },
        uStorm:        { value: 0 },
        // A flat white band until configure() bakes the level's own sky into
        // it, so a dome built without an Engine still draws something sane.
        uSkyBand:      { value: null },
        uHazeHue:      { value: new THREE.Color(1, 1, 1) },

        /* ── the window (see configureOrbit) ──────────────────────────────
         * uOrbit is the whole gate. Every default below is what a dome built
         * with no Engine and no level draws if somebody turns it on by hand:
         * a temperate world under a white star, a fleet in the middle of a
         * fight. Nothing here is read while uOrbit is 0. */
        uOrbit:        { value: 0 },
        uOrbitT:       { value: 0 },
        uOrbitKey:     { value: 0.58 },
        uSpaceCol:     { value: new THREE.Color(0.006, 0.008, 0.014) },
        uStarCol:      { value: new THREE.Color(1, 1, 1) },
        uPlanetDir:    { value: new THREE.Vector3(0.62, 0.28, -0.74).normalize() },
        uPlanetAxis:   { value: new THREE.Vector3(0.16, 0.96, 0.22).normalize() },
        uPlanetCos:    { value: Math.cos(0.32) },
        uPlanetSin:    { value: Math.sin(0.32) },
        uPlanetSpin:   { value: 0 },
        uCloudSpin:    { value: 0 },
        uLandCol:      { value: new THREE.Color(0x8a7f6e) },
        uRockCol:      { value: new THREE.Color(0x5c5044) },
        uBasinCol:     { value: new THREE.Color(0x4a4238) },
        uSeaCol:       { value: new THREE.Color(0x123a4e) },
        uSeaAmt:       { value: 0.55 },
        uSeaGlow:      { value: 0 },
        uCapAmt:       { value: 0.35 },
        uCloudAmt:     { value: 0.42 },
        uPlanetLit:    { value: new THREE.Color(1, 1, 1) },
        uPlanetDark:   { value: new THREE.Color(1, 1, 1) },
        uAtmoCol:      { value: new THREE.Color(1, 1, 1) },
        uStars:        { value: 1 },
        uStarSpin:     { value: 0 },
        /* The jump — see the two declarations in the fragment source. Both are
         * identity here, so a dome that never jumps is the dome that shipped. */
        uWarp:         { value: 0 },
        uOrbitSpin:    { value: 0 },
        uFleet:        { value: 1 },
        uFleetDir:     { value: new THREE.Vector3(0.20, 0.16, -0.97).normalize() },
        uBoltCol:      { value: new THREE.Color(0x35b0ff) },
        uFoeCol:       { value: new THREE.Color(0xff2a18) },
        uDeathSpan:    { value: 360 },
        uCityAmt:      { value: 0.3 },
        uSide:         { value: 0 },
        /* ── the world's own record (see configureOrbit, `planet`) ──── */
        uPlanetSeed:   { value: new THREE.Vector3(0, 0, 0) },
        uScatterCol:   { value: new THREE.Color(1, 1, 1) },
        uHazeAmt:      { value: 0 },
        uStormAmt:     { value: 0.3 },
        uGlint:        { value: 1 },
        uRingAmt:      { value: 0 },
        uRingIn:       { value: 1.4 },
        uRingOut:      { value: 2.1 },
        uRingCol:      { value: new THREE.Color(0.8, 0.8, 0.8) },
        uRingAxis:     { value: new THREE.Vector3(0.19, 0.94, 0.29).normalize() },
        uLanding:      { value: 1 },
        /* Three slots, filled by _orbitTick. z < 0 is an idle slot. */
        uBlast:        { value: [new THREE.Vector4(0, 0, -1, 1),
                                 new THREE.Vector4(0, 0, -1, 1),
                                 new THREE.Vector4(0, 0, -1, 1)] },
        /* nine hulls, from battleSlots each tick */
        uSlot:         { value: Array.from({ length: 9 }, () => new THREE.Vector4(0, 0, 0, 1e9)) },
        uGun:          { value: battleGuns(Array.from({ length: 9 }, () => new THREE.Vector4())) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    // Behind everything, including the Preetham sky it is composited over.
    this.mesh.renderOrder = -900;
    this.mesh.scale.setScalar(opts.radius ?? 9000);
    scene.add(this.mesh);
    this.scene = scene;
  }

  /** Per-level mood. Keys mirror the atmosphere blocks in Levels.js. */
  configure(a = {}) {
    const u = this.mat.uniforms;
    u.uCoverage.value = a.cloudCover ?? 0.42;
    u.uOpacity.value = a.clouds === false ? 0 : (a.cloudOpacity ?? 1);
    // Hue only — see tint(). The lit face keeps more of its authored cast than
    // the shadowed one because the sun genuinely is coloured at low elevation,
    // whereas a base is lit by the whole hemisphere and averages out nearly
    // neutral whatever the level author had in mind.
    //
    // And the lit face is a white body under THE SUN, so the sun's own colour
    // belongs on it — pulled halfway to white, because a cumulus top is above
    // most of the dust that reddens the same sun down at ground level. Without
    // this the tops came out the same cold grey-blue as the bases, since the
    // level of the sunlit term is a scalar and carries no chroma at all.
    tint(u.uCloudLit.value.set(a.cloudLit ?? 0xfff6e6), 0.55)
      .multiply(tint(_scratch.set(a.sunColor ?? 0xfff0d8), 0.5));
    // the product of two unit-luminance tints is not unit luminance
    unitLum(u.uCloudLit.value);
    tint(u.uCloudDark.value.set(a.cloudDark ?? 0x9aa8bd), 0.30);
    u.uHazeColor.value.set(a.fogColor ?? 0xd8c8a4);
    // The level's own sky, baked over bearing and elevation. Everything below
    // the deck reads it, so this is what makes the horizon directional.
    u.uSkyBand.value = this._band = skyBandTexture(a, this._band);
    u.uHorizonAmt.value = a.horizon === false ? 0 : (a.horizonAmount ?? 1);
    u.uHorizonScale.value = a.horizonScale ?? 1;
    u.uHorizonColor.value.set(a.horizonColor ?? 0x6d6152);
    u.uWindDir.value = a.cloudWindDir ?? 0.7;
    u.uWindSpeed.value = a.cloudWindSpeed ?? 1;
    /* The void, for the orbit path, and it is the ROOM's colour rather than
     * the planet's: a hangar already authors what the dark behind its aperture
     * is, and two numbers for the same dark is how a seam appears along the
     * lip of the opening. Halved, because bgColor is what an unlit corner of
     * the deck reads as and space is darker than any corner. */
    this._bg = a.bgColor ?? 0x0b0e14;
    /* A level with no orbit block clears the mode outright rather than
     * inheriting the last one's planet — configure() is the per-level entry
     * point and the one place that is allowed to forget. */
    this._orbit = null;
    this.configureOrbit(a.orbit === true ? {} : a.orbit);
    /* An interior with a window is still visible. Everything else is exactly
     * the test that was here: a sky, and something to draw on it. */
    this.mesh.visible = (a.sky !== false || this._orbit !== null)
      && u.uOpacity.value > 0.001;
  }

  /**
   * ══ THE WINDOW ════════════════════════════════════════════════════════
   *
   * Turn this dome into the view out of a ship in orbit: a planet, a
   * starfield and a fleet action, all inside the fragment that was already
   * being drawn, for zero new draw calls and zero new geometry.
   *
   *     sky.configureOrbit({ level: LEVELS[k], terrain: TERRAIN_PRESETS[t] })
   *
   * or, from a level record, so the mode is on from the moment
   * `Engine.applyAtmosphere` runs:
   *
   *     atmosphere: { sky: false, bgColor: 0x05070c, orbit: true }
   *
   * `orbit: true` is the same as `orbit: {}` — defaults, a temperate world —
   * and the level then calls this from its `dress` to say which world.
   *
   * ── IT TAKES THE LEVEL RECORD, NOT THE KEY, AND THAT IS NOT LAZINESS ──
   *
   * `Levels.js` imports Props, Scenery, Terrain, Enemy, Waves, Command,
   * Vehicles and thirty more; `Engine` imports this file. Resolving a key here
   * would close that ring, and the one cycle this file already has is safe
   * only because every symbol in it is a hoisted function declaration. The
   * caller has both tables in hand at the call site — it is one line there and
   * a module graph here.
   *
   * ── EVERY SWATCH IS DERIVED ───────────────────────────────────────────
   *
   * Nothing about the world outside is authored. The land is the terrain's own
   * `sandColor` — the same number `Terrain` hands the ground the player walks
   * on — the highlands its `rockColor`, the low ground its `gritColor`, the
   * sea `water.deep`, the ice line a function of how bright and how cold that
   * ground swatch is, the weather the level's own `cloudCover`, the limb its
   * `skyColor` and the star its `sunColor`. Measured over the roster:
   *
   *     level       ground albedo   b/r    ice    sea
   *     alpine          0.512       1.29   1.00   dry
   *     colosseum       0.273       0.27   0.10   dry
   *     drifts          0.216       0.12   0.10   dry
   *     geonosis        0.148       0.11   0.10   dry
   *     wood            0.037       0.41   0.10   water
   *     scoria          0.037       0.78   0     lava
   *     mustafar        0.020       0.66   0     lava
   *
   * — so the White Pass really does put an ice world outside the window and
   * the Ash Flats a black one with lava in the seams, and there is no new art
   * data anywhere that had to be written for either.
   *
   * ── MERGE, NOT REPLACE ────────────────────────────────────────────────
   *
   * Calls fold into the stored spec, so the load order a level actually has —
   * `applyAtmosphere` at stage 4 turning the mode on, `dress` at stage 6
   * naming the theatre — works without either half having to know the other's
   * fields. `configure` is the only thing that clears it.
   *
   * @param {object|null} spec
   * @param {object} [spec.level]    a LEVELS record: the theatre outside
   * @param {object} [spec.terrain]  its TERRAIN_PRESETS row
   * @param {string} [spec.faction]  whose guns are which colour
   * @param {number} [spec.time]     seconds into the battle; the clock runs on
   * @param {number} [spec.size]     angular RADIUS of the disc, radians
   * @param {number} [spec.period]   seconds for one cycle of the ship's drift
   * @param {number} [spec.sway]     radians of that drift; 0 = a true sweep
   * @param {number} [spec.day]      seconds for one rotation of the planet
   * @param {number} [spec.cloud]    override the derived cloud coverage
   * @param {number} [spec.key]      override the derived radiance outright
   * @param {number} [spec.stars]    starfield gain, 0 = none
   * @param {number} [spec.fleet]    fleet gain, 0 = an empty sky
   * @param {number} [spec.landing]  landing-craft gain, 0 = nobody going down
   * @param {number} [spec.city]     override the derived night-side lights
   * @param {number} [spec.sea]      override the derived sea fraction
   * @param {number} [spec.caps]     override the derived ice line
   * @param {number} [spec.phase]    dot(planet, star); -1 full, 0 half
   * @param {number} [spec.rise]     wanted elevation of the disc, as sin
   * @param {number[]} [spec.at]     place the disc outright, ignoring phase
   * @param {number} [spec.deathSpan] seconds a capital takes to die
   * @param {number} [spec.gain]     multiplier on the derived exposure
   *
   * ── WHAT IT PUBLISHES ─────────────────────────────────────────────────
   *
   * `ground.orbit` — see the note on _publishOrbit and the field's own note in
   * Scenery.js. The room is lit from outside by the thing this draws, and the
   * detonations it schedules are things the deck can hear a couple of seconds
   * later; both are read off the broker rather than reached for through this
   * object, so nothing downstream has to hold a reference to the dome.
   */
  configureOrbit(spec) {
    const u = this.mat.uniforms;
    if (!spec) {
      u.uOrbit.value = 0;
      this._orbit = null;
      /* A ground deployed after a hangar visit must not find a planet still
       * published on the broker and light itself off it. */
      if (ground.orbit) ground.orbit = null;
      return;
    }
    const o = this._orbit = Object.assign({}, this._orbit, spec);
    const L = o.level || {};
    const A = L.atmosphere || {};
    const P = o.terrain || {};
    const W = L.water || null;
    const lava = (L.atmosphere?.planet?.lava != null) ? !!L.atmosphere.planet.lava
      : (!!W && W.kind === 'lava');

    u.uOrbit.value = 1;
    /* clouds:false is the switch for NO WEATHER IN THIS SKY and it means the
     * cloud deck. It cannot be allowed to zero the window as well, so the
     * orbit path states its own opacity. */
    u.uOpacity.value = o.opacity ?? 1;

    /* Albedo, in the renderer's linear space, exactly as Terrain reads the
     * same three swatches. A planet is a lit body, so what a level authors is
     * what fraction of the star it returns, and the LEVEL of it comes from
     * uOrbitKey below — the same separation the cloud deck makes between a
     * swatch and a radiance, and for the same reason. */
    /* ── THE PLANET RECORD ─────────────────────────────────────────────
     * `atmosphere.planet` is where a level says what its world looks like
     * from orbit, and every field is optional: what follows is the derivation
     * from the ground swatches that was always here, with the record's own
     * value taking precedence wherever it has one. Fields:
     *
     *     seed        any number; moves every noise field, so no two worlds
     *                 share a coastline. Default: derived from the level id.
     *     land, highland, basin, sea    hex colours (albedo)
     *     seaAmt      0..1 fraction of the disc under the sea
     *     lava        true: the sea glows and does not go out at night
     *     ice         0..1 how far the caps reach
     *     cloudCover  0..1
     *     cities      0..1 night-side lights
     *     scatter     hex; the limb's rim colour. Default: the sky colour.
     *     haze        0..1 dust veil over the day side
     *     storms      0..1 cyclone gain
     *     glint       0..1 specular on the seas
     *     ring        { tilt, inner, outer, color, amount } or true
     */
    const PL = A.planet || {};
    const seedN = PL.seed ?? (String(L.id ?? L.name ?? '').split('')
      .reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000003, 7));
    u.uPlanetSeed.value.set(
      (hashSeed(seedN) - 0.5) * 60, (hashSeed(seedN + 1) - 0.5) * 60, (hashSeed(seedN + 2) - 0.5) * 60);
    u.uLandCol.value.set(PL.land ?? P.sandColor ?? L.groundColor ?? 0x8a7f6e);
    u.uRockCol.value.set(PL.highland ?? P.rockColor ?? P.sandColor ?? 0x5c5044);
    u.uBasinCol.value.set(PL.basin ?? P.gritColor ?? P.sandColor ?? 0x4a4238);
    /* A lava sea is not a colour you see, it is a light you see BY, so it
     * takes what the level says that light is — `water.sky`, the cast a lava
     * field throws into the air above it — demoted to a hue like every other
     * emissive swatch in this file. Water takes its own deep colour, which is
     * an albedo and stays one. */
    if (lava) unitLum(u.uSeaCol.value.set(PL.sea ?? W?.sky ?? W?.shallow ?? 0xdc4206));
    else u.uSeaCol.value.set(PL.sea ?? (W ? (W.deep ?? 0x123a4e) : (P.gritColor ?? 0x4a4238)));
    u.uSeaGlow.value = lava ? 1 : 0;
    /* `water.level` is a HEIGHT on a heightfield, not a coverage — mustafar
     * and the bog both sit at 0.0 and both are drowned — so what the record
     * can honestly answer is whether this world has a sea at all. A world with
     * one is about half water; a world without still has low ground, and 14%
     * of basin is what stops a dry planet reading as one flat field. */
    u.uSeaAmt.value = o.sea ?? PL.seaAmt ?? (W ? 0.55 : 0.14);

    /* THE ICE LINE, off the ground swatch and nothing else. A world is capped
     * where its own surface is bright AND cold: alpine's snow is 0.512 linear
     * at blue-over-red 1.29 and takes the caps to the tropics, the two lava
     * grounds are 0.02-0.04 and warm and get none, and everything between
     * keeps the 0.10 floor — every world with weather has poles. */
    const g = _scratch.set(P.sandColor ?? L.groundColor ?? 0x8a7f6e);
    u.uCapAmt.value = o.caps ?? PL.ice ?? (lava ? 0 : clamp(0.10
      + 1.40 * smoothstep(0.16, 0.50, _lum(g))
             * smoothstep(0.45, 1.15, g.b / Math.max(g.r, 1e-4)), 0, 1));

    u.uCloudAmt.value = o.cloud ?? PL.cloudCover ?? (A.cloudCover ?? 0.42);
    unitLum(u.uScatterCol.value.set(PL.scatter ?? A.skyColor ?? 0xbcd8ff));
    u.uHazeAmt.value = PL.haze ?? 0;
    u.uStormAmt.value = PL.storms ?? 0.3;
    u.uGlint.value = PL.glint ?? 1;
    /* THE RING. Stated in planet radii about the planet's own axis tilted by
     * `tilt` radians toward the viewer, so a level can put a ring on edge or
     * open it up. The shadow it throws and the shadow it stands in are both
     * derived in the shader from this one normal. */
    const ring = PL.ring === true ? {} : PL.ring;
    u.uRingAmt.value = ring ? (ring.amount ?? 0.8) : 0;
    u.uRingIn.value = ring?.inner ?? 1.4;
    u.uRingOut.value = ring?.outer ?? 2.1;
    u.uRingCol.value.set(ring?.color ?? 0xd8dde6);
    tint(u.uPlanetLit.value.set(A.cloudLit ?? 0xfff6e6), 0.55);
    tint(u.uPlanetDark.value.set(A.cloudDark ?? 0x9aa8bd), 0.30);
    /* The limb IS the level's sky. That is not an analogy — the colour of the
     * air seen edge-on from outside and the colour of it seen from underneath
     * are the same scattering, and the level already states it. */
    unitLum(u.uAtmoCol.value.set(A.skyColor ?? 0xbcd8ff));
    unitLum(u.uStarCol.value.set(A.sunColor ?? 0xfff0d8));
    u.uSpaceCol.value.set(o.space ?? this._bg ?? 0x0b0e14).multiplyScalar(0.5);

    /* WHAT A WHITE FACE SQUARE TO THE STAR RETURNS, in the same radiance units
     * as the rest of the frame — the planet's half of what uCloudSun is for
     * the deck. 0.16 rather than 1/pi: a planet is a diffuse body seen at
     * every phase at once, and metering it as one flat plate at normal
     * incidence put alpine's 0.512 snow at 1.11 linear against a bloom
     * threshold of 1.8, which is a white disc with no shading left in it.
     * 0.16 lands the same snow at 0.56 — inside the range Engine's own note
     * measures the White Pass's real snow at, 0.24 to 0.39, with the caps and
     * the cloud tops above it and room under the threshold for a turbolaser to
     * be the thing that blooms. */
    u.uOrbitKey.value = o.key ?? ((A.sunIntensity ?? 3.6) * 0.16 * (o.gain ?? 1));

    /* Two accents and no third. `BOLT_COLORS` is the game's own answer to what
     * a blaster looks like; naming the pair here rather than importing it
     * keeps Bolts.js out of Engine's import ring for two constants. */
    const ours = o.faction === 'separatist' ? 0xff2a18 : 0x35b0ff;
    u.uBoltCol.value.set(o.boltColor ?? ours);
    u.uFoeCol.value.set(o.foeColor ?? (ours === 0x35b0ff ? 0xff2a18 : 0x35b0ff));

    u.uStars.value = o.stars ?? 1;
    u.uFleet.value = o.fleet ?? 1;
    u.uLanding.value = o.landing ?? 1;
    u.uSide.value = o.faction === 'separatist' ? 1 : 0;
    /* Kept for anything that reads it; the death is on the round now. */
    u.uDeathSpan.value = o.deathSpan ?? BATTLE.round;

    /* WHICH WORLDS HAVE THEIR LIGHTS ON, and the record does answer it — but
     * this is the weakest derivation in the file and it is worth saying so.
     * There is no `urban` field anywhere in `Levels.js`, so what stands in for
     * one is `party`: the spectator field, the only thing a level record
     * carries that asserts there are people on this ground who are not
     * fighting. A world with a crowd on it has cities. A world with water has
     * somebody living beside it. A world whose sea is lava does not.
     *
     * `city` overrides it outright, and a level that ever grows a real
     * settlement flag should be read here instead of this. */
    u.uCityAmt.value = o.city ?? PL.cities
      ?? (lava ? 0 : (L.party ? 1 : (W ? 0.34 : 0.12)));

    /* Geometry. The disc is stated as an angular RADIUS and everything the
     * shader needs off it is the sine and the cosine, so the per-pixel limb
     * test costs no trig at all. 0.34 rad is a 39° disc: the ask is 30-40% of
     * the visible sky and a 39° body fills 39/60 of a 60° field across, which
     * is a planet you cannot look past. */
    const rad = o.size ?? 0.34;
    u.uPlanetCos.value = Math.cos(rad);
    u.uPlanetSin.value = Math.sin(rad);
    /* WHERE THE WORLD SITS IS DERIVED FROM WHERE THE STAR IS, and that is the
     * difference between a planet and a decal.
     *
     * A disc placed at a fixed bearing takes whatever phase the level's sun
     * happens to give it: the Flight Deck's sun is at azimuth 0 and a planet
     * authored at -Z came out at FULL phase — a flat white circle with the
     * terminator hidden round the back, which is the one thing that says the
     * thing you are looking at is a sphere. So the default is stated as a
     * PHASE and solved for: dot(planet, sun) = -0.45 puts the terminator about
     * a fifth of the way in from the limb, which is the gibbous every
     * photograph of a world from orbit is.
     *
     * The roll about the star's own axis is then free — it cannot change the
     * phase — so it is spent on getting the disc up out of the deck and into
     * the aperture. `at` overrides the whole thing for a level that wants the
     * world somewhere specific. */
    this._planetHome = (this._planetHome || new THREE.Vector3());
    this._derivePlace = !o.at;
    if (o.at) this._planetHome.fromArray(o.at).normalize();
    else this._placeByPhase(o.phase ?? -0.45, o.rise ?? 0.26, o.forward ? _fwd.fromArray(o.forward) : null);
    u.uPlanetAxis.value.fromArray(o.axis ?? [0.19, 0.94, 0.29]).normalize();
    u.uRingAxis.value.copy(u.uPlanetAxis.value);
    if (ring) {
      _axis.set(-u.uPlanetAxis.value.z, 0, u.uPlanetAxis.value.x);
      if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
      u.uRingAxis.value.applyAxisAngle(_axis.normalize(), ring.tilt ?? 0.35).normalize();
    }
    this._orbitPeriod = o.period ?? 1200;
    /* THE DRIFT IS A SWAY, NOT A LAP, AND THAT IS A FRAMING DECISION.
     *
     * A true orbit takes the planet all the way round and out of the aperture,
     * which is correct and useless: a room whose whole content is one view
     * cannot have that view leave. A station-keeping yaw of ±24° over twenty
     * minutes peaks at 0.126°/s — 23° of travel in three minutes, against a
     * doorframe that is not moving — so the planet is unmistakably in motion
     * every time you look, and it always comes back. `sway: 0` gives the lap
     * instead, for a scene that wants one.
     *
     * The bob is a second rotation at an incommensurate rate and a fifth of
     * the amplitude, so the path is a slow open figure rather than a line the
     * eye can predict. */
    this._orbitSway = o.sway ?? 0.42;
    this._daySpan = o.day ?? 1800;
    this._fleetOff = o.fleetOffset ?? 0.44;
    /* The clock. Seeded once so a caller can put the fight where the fiction
     * says it is, then advanced by update() — one number, no state, and a
     * reload with the same seed replays the same battle frame for frame. */
    if (spec.time != null) this._orbitT = spec.time;
    else if (this._orbitT == null) this._orbitT = 0;
    this._blastSeen = null;
    this._markSeen = null;
    /* Called on its own — from a level's dress, after applyAtmosphere has
     * already run — this is the only thing that can put the dome back on
     * screen, because configure()'s visibility test has been and gone. */
    if (u.uOpacity.value > 0.001) this.mesh.visible = true;
    this._orbitTick(0);
  }

  /**
   * ══ WHAT THE DECK CAN SEE AND HEAR ════════════════════════════════════
   *
   * Published on `ground`, the same broker `skyBandTexture` already hands the
   * drawn sky to Scenery through, and for the same reason: there is one
   * derivation of where the world is and what colour it throws, and everything
   * that needs to agree with the view reads THAT rather than deriving a second
   * one that is right until somebody edits one of them.
   *
   *     ground.orbit = {
   *       dir:    Vector3, unit, FROM the deck TOWARD the planet. A directional
   *               light standing in for the planet goes at +dir and points back.
   *       colour: Color, unit luminance — the hue of the light the lit side
   *               throws, which is the star through that world's own air.
   *       key:    number, the radiance a white face square to the star returns.
   *               Planetshine is a fraction of it; `bounce` is that fraction.
   *       bounce: number, the radiance a white face turned toward the planet
   *               actually gets from it — the number a fill light wants.
   *       sun:    Vector3, unit, toward the star.
   *       events: an array to DRAIN. Each is { kind, strength, delay, at }.
   *     }
   *
   * `events` is the hook the deck's audio wants: a detonation out there is
   * silent, and what arrives is a thump through the hull a couple of seconds
   * later. `delay` is that couple of seconds, derived from how far off the
   * flash was; the consumer decides what to do with it and this file neither
   * knows nor imports anything that does. Drain it — nothing here empties it
   * except the cap, which drops the oldest at 12 so an unattended queue cannot
   * grow without bound.
   */
  _publishOrbit() {
    const u = this.mat.uniforms;
    const o = ground.orbit || (ground.orbit = { events: [] });
    o.dir = (o.dir || new THREE.Vector3()).copy(u.uPlanetDir.value);
    o.sun = (o.sun || new THREE.Vector3()).copy(u.uSunDir.value);
    /* The hue is the star seen through that world's air and bounced off its
     * ground — the same three swatches the disc is painted with, weighted the
     * way the disc actually shows them. */
    const c = (o.colour || (o.colour = new THREE.Color()));
    c.copy(u.uStarCol.value)
      .lerp(_scratch.copy(u.uAtmoCol.value), 0.45)
      .lerp(_scratch.copy(u.uLandCol.value), 0.20 * (1 - u.uCloudAmt.value));
    unitLum(c);
    o.key = u.uOrbitKey.value;
    /* What a planet this big actually throws back. It subtends about a
     * steradian and a half at this angular size and returns its own albedo of
     * what lands on it, so the fill is a few per cent of the key — small, and
     * the reason the shade side of a hull out there is not black. */
    const alb = _lum(_scratch.copy(u.uLandCol.value)) * (1 - u.uCloudAmt.value)
      + 0.62 * u.uCloudAmt.value;
    const solid = 1 - u.uPlanetCos.value;
    o.bounce = o.key * alb * solid * 2.0;
    return o;
  }

  /**
   * The detonation schedule. Three slots, each on its own long period, and the
   * whole of it is a pure function of the clock — so this is not a second
   * timeline standing beside the shader's, it IS the shader's, read on the CPU
   * and handed down as three vec4s.
   *
   * Periods are unequal and share no small factor (53, 76, 99 s) so the three
   * never fall into step: three flashes together once a minute is a rhythm,
   * and a rhythm out there reads as a loop. About one detonation every
   * twenty-seven seconds between them, which is often enough that the room is
   * never quiet for long and rare enough that each one is an event.
   */
  _blasts(t) {
    const u = this.mat.uniforms;
    const slots = u.uBlast.value;
    for (let k = 0; k < 3; k++) {
      const per = 53 + k * 23;
      const seed = (k * 0.3137 + 0.11) % 1;
      const n = Math.floor(t / per + seed);
      const age = t - (n - seed) * per;
      const h = ((Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
      const h2 = ((Math.sin(n * 39.3468 + k * 11.135) * 24634.6345) % 1 + 1) % 1;
      const v = slots[k];
      v.x = (h - 0.5) * 0.92;
      v.y = (h2 - 0.5) * 0.34;
      v.w = 0.55 + h2 * 0.85;
      v.z = age >= 0 && age < 1 ? age : -1;
      /* Fire the event once, on the frame the flash starts. `_blastSeen` holds
       * the last detonation index each slot raised, so a clock that is seeded
       * forward — a reload, a level that starts the battle at t = 600 — does
       * not fire a hundred stale thumps into the room. */
      if (this._blastSeen == null) this._blastSeen = [n, n, n];
      else if (n !== this._blastSeen[k]) {
        this._blastSeen[k] = n;
        const o = this._publishOrbit();
        /* THE DELAY IS DRAMATIC, NOT PHYSICAL, and that is a deliberate choice
         * rather than an approximation. These detonations are drawn at
         * capital-ship distance; the sound of one genuinely that far off
         * arrives fifteen to twenty seconds later, by which time it is four
         * flashes ago and the ear has nothing to bind it to — and the binding
         * is the entire content of the effect. About a second, stretched with
         * how far across the frame the flash was, is the longest a person will
         * still hear a bang as belonging to a light they saw. The band lands
         * where the deck's own thump wants it without this file knowing
         * anything about the deck. */
        const r = Math.hypot(v.x, v.y);
        o.events.push({ kind: 'blast', strength: v.w, delay: 0.9 + r * 2.4, at: t });
        while (o.events.length > 12) o.events.shift();
      }
    }
  }



  /**
   * Solve for a placement with a given phase and the highest elevation that
   * phase allows.
   *
   * Rotating about the star's own direction leaves dot(planet, star) — and so
   * the phase — exactly where it was, so the two constraints do not fight:
   * the phase is set by construction and the roll is a free parameter spent
   * entirely on elevation. Twenty-four samples of a one-dimensional family,
   * once per level, is cheaper than any closed form is worth here.
   */
  /**
   * ══ …AND BY AZIMUTH, WHICH IT NEVER WAS ═══════════════════════════════════
   *
   * The roll about the star's axis was scored on ELEVATION ALONE, and the
   * comment above promised the free roll "is spent on getting the disc up out
   * of the deck and into the aperture" — but the aperture is a direction, and
   * nothing here ever asked which one. Measured in a browser on the flight
   * deck: `planetDir = [-0.013, 0.218, -0.976]`, 167° off the deck's forward
   * axis, so the world sat over the 58 m bulkhead behind the player's head on
   * every theatre, identically, and the one sentence the room was designed
   * around — "the planet fills a third of the sky" — was never once true.
   *
   * `forward` is the direction the opening faces. When a caller gives one,
   * the score is the elevation term AND the azimuth term, and the azimuth
   * term is weighted to win: a disc a few degrees off its wanted height is a
   * planet; a disc behind the only wall is a rumour. Without one the old
   * behaviour is kept, for a sky that has no opening to point at.
   */
  _placeByPhase(phase, rise, forward = null) {
    const sun = _scratchV.copy(this.mat.uniforms.uSunDir.value).normalize();
    _axis.set(-sun.z, 0, sun.x);
    if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
    _axis.normalize();
    const home = this._planetHome;
    let best = -Infinity;
    const fx = forward ? forward.x : 0, fz = forward ? forward.z : 0;
    const fl = Math.hypot(fx, fz) || 1;
    for (let i = 0; i < 72; i++) {
      _spare.copy(sun).multiplyScalar(phase)
        .addScaledVector(_axis, Math.sqrt(Math.max(1 - phase * phase, 0)))
        .normalize()
        .applyAxisAngle(sun, (i / 72) * TAU);
      /* Closest to the wanted elevation, and never below the deck: a world
       * under your feet is a world you cannot see out of a hangar door. */
      let score = -Math.abs(_spare.y - rise) - (_spare.y < 0.02 ? 10 : 0);
      if (forward) {
        const hl = Math.hypot(_spare.x, _spare.z) || 1e-6;
        const along = (_spare.x * fx + _spare.z * fz) / (hl * fl);
        /* 3×: a full reversal costs six, an elevation miss of a whole radian
         * costs one. The opening wins. */
        score -= (1 - along) * 3.0;
      }
      if (score > best) { best = score; home.copy(_spare); }
    }
    /* AND IF THE PHASE CIRCLE NEVER PASSES THE OPENING, put the disc in the
     * opening anyway and let the terminator fall where the star puts it: a
     * lit sphere in the window beats a perfect gibbous behind a wall. */
    if (forward) {
      const hl = Math.hypot(home.x, home.z) || 1e-6;
      const along = (home.x * fx + home.z * fz) / (hl * fl);
      if (along < 0.85) {
        home.set(fx / fl, 0, fz / fl).multiplyScalar(Math.sqrt(Math.max(0, 1 - rise * rise)));
        home.y = rise;
        home.normalize();
      }
    }
    return home;
  }

  /**
   * Where the world is this frame. On the CPU rather than in the shader
   * because the drift is four trig calls a FRAME here and would be four a
   * PIXEL there, and because a caller that wants to point a light or a camera
   * at the planet can then read uPlanetDir and get the truth.
   */
  _orbitTick(dt) {
    const u = this.mat.uniforms;
    this._orbitT += dt;
    const t = this._orbitT;
    u.uOrbitT.value = t;
    const w = TAU / Math.max(this._orbitPeriod, 1);
    const yaw = this._orbitSway > 0 ? Math.sin(t * w) * this._orbitSway : t * w;
    const bob = Math.sin(t * w * 0.61 + 1.1) * Math.max(this._orbitSway, 0.35) * 0.20;
    const dir = u.uPlanetDir.value.copy(this._planetHome);
    dir.applyAxisAngle(_UP, yaw);
    _axis.set(-dir.z, 0, dir.x).normalize();
    dir.applyAxisAngle(_axis, bob).normalize();
    /* The action sits beside the world rather than opposite it, so hulls cross
     * the disc and read as silhouettes against something. It rides the same
     * drift, because it is at the same distance. */
    u.uFleetDir.value.copy(dir).applyAxisAngle(_UP, this._fleetOff).normalize();
    /* The surface turns, the weather turns slower, and the sky behind both
     * turns slower again — the last of those is the ship's own attitude and is
     * the whole of the parallax between the planet and the stars. */
    const day = TAU / Math.max(this._daySpan, 1);
    u.uPlanetSpin.value = t * day;
    u.uCloudSpin.value = t * day * 0.62;
    u.uStarSpin.value = t * w * 0.11;
    this._blasts(t);
    battleSlots(t, u.uSide.value, u.uSlot.value);
    /* THE ROUND'S OWN EVENTS, off the same table the shader draws from. Each
     * is an index — which round's break, which round's reactor — so a seeded
     * clock cannot fire it retroactively and a paused world cannot fire it
     * twice. The reactor is the loudest thing in the session; the arrivals
     * are a whump through the hull, which is what a fleet dropping out of
     * hyperspace beside you ought to be. */
    const R = BATTLE.round;
    const marks = [
      ['breakup', BATTLE.breakAt, 2.4, 1.9],
      ['blast', BATTLE.reactor, 3.2, 2.6],
      ['blast', BATTLE.arriveA + 1.0, 0.7, 0.8],
      ['blast', BATTLE.arriveB + 1.0, 0.7, 1.4],
      ['blast', BATTLE.jumpIn + 1.0, 0.9, 1.2],
    ];
    if (this._markSeen == null) this._markSeen = marks.map(([, at]) => Math.floor((t - at) / R));
    else {
      for (let k = 0; k < marks.length; k++) {
        const [kind, at, strength, delay] = marks[k];
        const n = Math.floor((t - at) / R);
        if (n === this._markSeen[k]) continue;
        this._markSeen[k] = n;
        const o = this._publishOrbit();
        o.events.push({ kind, strength, delay, at: t });
        while (o.events.length > 12) o.events.shift();
      }
    }
    this._publishOrbit();
  }

  /**
   * Tie the deck to the sky it hangs in. The Preetham dome is consumed as
   * linear radiance, so the clouds have to be scaled into the same units or
   * they are either black paper or blown-out white paper against it.
   *
   * `cloudSun` and `cloudAmb` are the two numbers the whole deck's tonality
   * hangs off: the radiance of a white cloud face square to the sun, and the
   * radiance of one lit by nothing but the sky and the ground bounce. Engine
   * derives both from the level's own light, so a deck cannot come out darker
   * than the sky behind it however the level's swatches were authored.
   */
  setRadiance(hdr, cloudSun = 1, skyAmbient = null, cloudAmb = null) {
    this.mat.uniforms.uHdr.value = hdr;
    this.mat.uniforms.uCloudSun.value = cloudSun;
    if (cloudAmb != null) this.mat.uniforms.uCloudAmb.value = cloudAmb;
    if (skyAmbient) this.mat.uniforms.uSkyAmb.value.copy(skyAmbient);
  }

  /**
   * The haze the deck and the skyline dissolve into. It has to be the SAME
   * radiance the scene's fog dissolves into, or the world ends at a visible
   * seam where the terrain stops and the dome takes over — which is what an
   * sRGB swatch used raw against a linear sky gives you: a dark band under a
   * bright horizon. Engine hands us the value it gave the fog.
   */
  setHaze(color, land) {
    if (color) {
      this.mat.uniforms.uHazeColor.value.copy(color);
      // …and the same dust demoted to a HUE, for the calm-air skyline band,
      // which may say what colour the distance is and never how bright.
      unitLum(this.mat.uniforms.uHazeHue.value.copy(color));
    }
    // The ranges are terrain seen through a great deal of air, so their colour
    // is the ground's own radiance — albedo times the light actually landing
    // on it — not an sRGB swatch read as light.
    if (land) this.mat.uniforms.uHorizonColor.value.copy(land);
  }

  /**
   * …and the window follows it. `Engine.applyAtmosphere` calls configure()
   * BEFORE setSun(), so a placement solved for the phase at configure time was
   * solved against the PREVIOUS level's star. Re-solving here makes the answer
   * independent of the order the two are called in, which is the only way it
   * can be right for both the atmosphere block and a later configureOrbit.
   */
  setSun(dir) {
    this.mat.uniforms.uSunDir.value.copy(dir).normalize();
    if (this._orbit && this._derivePlace) {
      this._placeByPhase(this._orbit.phase ?? -0.45, this._orbit.rise ?? 0.26,
        this._orbit.forward ? _fwd.fromArray(this._orbit.forward) : null);
      this._orbitTick(0);
    }
  }

  /**
   * Keep the dome centred on the camera so it never has parallax, and read the
   * weather.
   *
   * The dome PULLS the storm rather than being pushed it, on purpose: there is
   * exactly one weather scheduler (Scenery's `ground.weather`) and everything
   * downstream of it reads the same number in the same frame. Handing the sky
   * its own copy through Engine would be a second place that could disagree,
   * and two systems each deciding independently how stormy it is is precisely
   * what reads as fake.
   */
  update(dt, camera) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uStorm.value = ground.weather ? ground.weather.intensity : 0;
    if (this._orbit) this._orbitTick(dt);
    if (camera) this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this._band?.dispose();
    this._band = null;
    /* The broker is module-global and outlives every dome that ever publishes
     * to it, so a dead dome's planet left standing there is a reference the
     * next world reads and a corpse nothing frees. Same reason skyBand is
     * rebuilt per level rather than accumulated. */
    this._orbit = null;
    ground.orbit = null;
  }
}
