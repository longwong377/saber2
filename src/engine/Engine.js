/**
 * BATTLEFRONT BORZ — renderer, HDR pipeline, post stack.
 *
 * Scene renders into a multisampled half-float target so the blade and the
 * bolts stay bright above 1.0 and bloom picks them up honestly; ACES filmic
 * tonemapping brings it back down at the end. The composite pass is where the
 * frame gets its character — grain, chromatic aberration, vignette, heat haze
 * off the blade, and the desaturated pull of Force Sense.
 *
 * Three things here are load-bearing for whether the frame reads as photographed:
 *
 *   1. THE SKY IS ACTUAL RADIANCE. three's Preetham sky ships display-referred:
 *      its last line is pow(texColor, 1/2.4), which is a gamma curve applied to
 *      a value we then consume as LINEAR light. Measured on the dune atmosphere,
 *      the true sky spans 100:1 from zenith (0.23) to the horizon glow beside
 *      the sun (21.7); that pow flattens it to 7:1, and ACES then squeezes the
 *      remainder into a fifty-value band. That is the entire reason the sky was
 *      a flat wash, why nothing in it bloomed, and why the image-based light
 *      baked from it had no direction. `_linearSky` undoes it.
 *
 *   2. FOG IS AERIAL PERSPECTIVE, not a wash. `_installAerialPerspective`
 *      replaces three's fog chunk with height-stratified extinction plus sun
 *      inscattering, so distance separates into layers and haze glows toward
 *      the sun. It reaches every material in the game — terrain, grass, water,
 *      props — without any of them knowing, because it is the stock chunk.
 *
 *   3. …AND THEN IT IS COMPRESSED BACK DOWN FOR THE CAMERA, on a different
 *      curve from the one light transport wants. See SKY_PHYSICAL /
 *      SKY_DISPLAY. 42.3% of the arena's sky hemisphere rendered above the
 *      bloom pass's threshold, which turns a highlight effect into a
 *      frame-wide veil, and measured on the deployed frame that — not fog, not
 *      albedo — was what bleached the landscape: the rim wall read 0.441
 *      display luminance with bloom off and 0.782 with it on.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkyDome } from './SkyDome.js';
import { installCelShading, CEL, CEL_BAND_GLSL } from '../toon/Cel.js';
import { OutlinePass } from '../toon/Ink.js';
import { Profiler } from './Profiler.js';
import { noiseTexture } from './Textures.js';
import { setSceneDepth } from '../world/SoftDepth.js';
import { clamp, damp } from './MathUtil.js';

/** Finite-or-default. Game maths produces NaN; a uniform holding one is a black frame. */
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * THE LADDER IS A FILL-RATE LADDER, AND THE TOP THREE ROWS COST THE SAME CPU.
 *
 * Read down the columns: `shadow`, `msaa`, `pixelRatio`, `bloom`, `shadowDist`
 * and `ink` are all fragments and shadow texels. `grass` and `particles` move
 * how many instances are DRAWN. `viewDist` reaches CPU work through World.js,
 * which derives the terrain's `detail` from it. The one column that changes how
 * much simulation runs EVERY frame is `cloth`, and only `low` sets it to 0.
 *
 * `grass` is the one qualification, and it is a tail rather than a median: the
 * field refills a ring's window on the frame the player crosses its cell line,
 * one frame in ten while sprinting, and that spike scales with the column even
 * though the steady-state update does not (audit 3, frame-budget#1 — the fix is
 * a one-ring-per-frame queue in Scenery.js, which belongs to another
 * workstream). So a player on `low` does get a smaller worst frame out of it;
 * they do not get a smaller typical one.
 *
 * Measured rather than argued: all four tiers built in ONE process, driven in
 * interleaved rounds so contention lands on all of them equally, temple, 20
 * acolytes from a fixed seed, 3 rounds of 250 frames, medians of round medians,
 * `world.update` only (there is no renderer here):
 *
 *   enemies in melee (6-15 m)     low 2.41   medium 4.24   high 4.45   ultra 3.84
 *   enemies spread (4-50 m)       low 2.14   medium 4.80   high 4.57   ultra 5.01
 *
 * In the melee case ULTRA measures cheaper than high AND than medium; in the
 * spread case medium measures more expensive than high. An ordering that is
 * impossible if the ladder were doing anything is noise, and that is what these
 * three rows are. `low` is the only real step — 46% and 53% of the simulation
 * frame — and all of it is cloth: `clothOn` counted live is 0/19 at low and
 * 18/18, 18/18, 20/20 at medium, high and ultra. 18, 30 and 46 m all mean "on"
 * once the fight starts, because a fight happens inside 15 m and the enemies
 * close, so a DISTANCE cut stops differentiating exactly when the frame is
 * fullest.
 *
 * WHAT THIS MEANS FOR A PLAYER WHOSE BOTTLENECK IS THE CPU — the likely case
 * for a JS game on a laptop: dropping from Cinematic to Fidelity to Balanced
 * moves nothing they can feel, and the only step that helps them is the one at
 * the bottom of the menu. That is a real gap and it is not fixed here. The
 * shape of the fix is a COUNT rather than a distance — `cloth: 0 / 4 / 10 / 20`
 * nearest characters — which steps at every tier in the scenario that matters;
 * it needs World.js to rank the characters by camera distance once a frame, and
 * World.js belongs to another workstream. `grass` and `particles` have the same
 * flat-in-melee shape and the same fix.
 *
 * What the top three rows DO buy is real and is not visible from here: this
 * machine has no GPU, so the only honest statements are proxies — shadow memory
 * (12 / 27 / 75 / 108 MB, three cascades of size² × 4 B, listed below), ink
 * prepass fragments (25% / 36% / 72% / 100% of the frame), pixel ratio
 * (1.0x / 1.0x / 1.56x / 2.25x fragments) and msaa (0 / 2 / 4 / 4). Never quote
 * a frame rate for any of it.
 */
export const LIGHT_POOL_SIZE = 8;

export const QUALITY = {
  // `shadowDist` is the REACH of the outermost cascade, and `shadow` is the map
  // size of EACH of the three (see CASCADE_SPLIT / cascadeBoxes). It used to be
  // the radius of the one and only box, and one box has to buy reach with texel
  // size because they are the same number — which is why the world stopped
  // being lit at 58 m at medium and a landscape with nothing casting in its
  // middle distance read as a painted backdrop.
  //
  // Three maps per tier is three times the shadow memory, and that is simply
  // what cascades cost; it is paid for at the top by dropping ultra's map from
  // 4096 to 3072, which a cascaded rig no longer needs. Per tier, near/mid/far
  // texel size and total shadow memory:
  //
  //   low     2.60 / 6.15 / 13.67 cm    12 MB   (was 8.2 cm, 4 MB, 42 m)
  //   medium  2.60 / 6.15 / 13.67 cm    27 MB   (was 5.7 cm, 16 MB, 58 m)
  //   high    2.23 / 5.27 / 11.72 cm    75 MB   (was 5.0 cm, 36 MB, 76 m)
  //   ultra   2.23 / 5.27 / 11.72 cm   108 MB   (was 4.7 cm, 64 MB, 96 m)
  //
  // So every tier's NEAR shadows — the ones under the fight, where the eye is —
  // are two to three times finer than the single box ever managed, and the
  // reach roughly doubles again on top of that. The ladder buys reach at every
  // step and density every other step, because reach and density are the same
  // texel budget and there is no tier at which you get both for free.
  //
  // `ink` is the outline prepass's resolution as a fraction of the frame, and
  // it is the only knob that pass has. What it costs is a second rasterisation
  // of every opaque object with a trivial shader (see src/toon/Ink.js): no
  // texture fetch, no light loop, no shadow lookup, and the whole cover field
  // and every transparent thing excluded. On the meadow — the heaviest level in
  // the game for draw calls — that is 118 of the frame's 214 draws, and at 0.6
  // it rasterises 36% of the pixels the beauty pass does.
  //
  //   low     0.50   quarter the fragments; lines ~2 px and a little ragged
  //   medium  0.60
  //   high    0.85   the knee — 1 px lines with no visible stair-stepping
  //   ultra   1.00
  // `cloth` is how far an ENEMY may be and still have simulated garments, in
  // metres — and it is the only column in this table that changes how much
  // simulation the CPU runs. It had no budget at all before: see the note
  // below, and the one above the table for what the other columns do and do
  // not buy.
  //
  // `bloom` is false at low for the first time here. It was `true` on all four
  // rows, which made it a column with a reader that could not change anything —
  // the tier the menu labels "For laptops and integrated graphics" still ran
  // the five-tap mip pyramid and the composite.
  low:    { shadow: 1024, msaa: 0, pixelRatio: 1.0,  bloom: false, grass: 0.25, particles: 0.4, shadowDist: 70, viewDist: 380, ink: 0.50, cloth: 0 },
  medium: { shadow: 1536, msaa: 2, pixelRatio: 1.0,  bloom: true,  grass: 0.55, particles: 0.7, shadowDist: 105, viewDist: 520, ink: 0.60, cloth: 18 },
  high:   { shadow: 2560, msaa: 4, pixelRatio: 1.25, bloom: true,  grass: 1.0,  particles: 1.0, shadowDist: 150, viewDist: 700, ink: 0.85, cloth: 30 },
  ultra:  { shadow: 3072, msaa: 4, pixelRatio: 1.5,  bloom: true,  grass: 1.5,  particles: 1.35, shadowDist: 180, viewDist: 900, ink: 1.00, cloth: 46 },
};

/**
 * WHY `cloth` IS A COLUMN, and what it was before.
 *
 * Enemy's own level-of-detail gate switched the garments off past `lod > 1`,
 * which is 62 m. The largest `spawnRadius` of the thirteen levels is [36, 60]
 * (Levels.js) and every enemy is born inside it and then walks TOWARD the
 * player — so the cut sat above the farthest an enemy is ever placed, and the
 * only way to reach it was to outrun one. In an ordinary fight it never fired
 * once, and there was no other switch: not a slider, not a tier, nothing.
 *
 * WHAT IT COSTS — AND THE FIGURE THAT USED TO BE HERE WAS FOR A POPULATION THE
 * GAME CANNOT FIELD.
 *
 * This note said "20 clothed duellists walking: 6.28 ms of garment solve and
 * 1.26 ms of collider refresh per frame — 7.5 ms of a 16.67 ms budget … per
 * character 287 particles, 1466 links … four garments deep". Every one of
 * those per-character numbers is the PLAYER's row. `attachSkirt` is reached
 * only when `built.robeSkirt` is truthy (Enemy.js), and `robeSkirt` is returned
 * by exactly one builder, `buildJedi` — which is what the Player is built from
 * and no enemy is. Counted on a live World at `ultra`, where the cut gates
 * nothing off:
 *
 *   the PLAYER      4 garments   287 particles  1466 links  51 colliders
 *                   cloak 99/496, skirt 140/770, two sash straps 24/100 each
 *   an ACOLYTE      1 garment     63 particles   300 links  21 colliders
 *   sparring, bodyguard   the same one cloak
 *   b1, b2, trooper, sniper, droideka, walker, remote, dummy, beast,
 *   charger, stalker      nothing at all
 *
 * Three of fourteen archetypes wear anything, and each of those wears one cape.
 * So "20 clothed duellists, four garments deep" is 5740 particles and 29 320
 * links, and twenty acolytes are 1260 and 6000 — the note was sized for 4.9x
 * the work the game can actually put on screen, and a tuning decision made from
 * it is made against a figure five times the real one.
 *
 * The ratio is written down here rather than a millisecond count on purpose:
 * the defect being fixed IS one machine's number written into a comment, and
 * two runs of this project's own harness on two differently loaded boxes gave
 * 1.9 ms and 3.3 ms for the same fight. tools/checks/cloth-cost.mjs counts the
 * population — which is machine-independent — and holds the timing to a band.
 *
 * And `low` does not hand back even that much. The PLAYER's cloth is not gated
 * at all: `Player.update` calls `this.skirt.update(...)` and
 * `this.cloak.update(...)` with no `clothOn` test, because the player is always
 * the nearest character to the camera and the one garment set the eye is on.
 * What the column switches off is the enemy share.
 *
 * 30 m at `high` is not a new number: it is where Enemy already drops 37 of a
 * character's 56 meshes. Cloth now stops where the game had already decided
 * detail stops mattering. The rigid lathes come back in the same frame — they
 * were never deleted, only hidden — so the silhouette is unchanged; what goes
 * is the fold motion, at a distance where a fold is under a pixel.
 *
 * 0 at `low` means the rigid robe, always: the tier the menu offers to
 * integrated graphics. It is the largest thing the CPU side of the ladder hands
 * back — which is a smaller claim than the one that used to be here, and the
 * note over QUALITY explains why.
 */

/* ── aerial perspective ──────────────────────────────────────────────────
 *
 * three's fog is one colour mixed in by distance. That is not what distance
 * does. Distance does two things, and the frame reads flat without both:
 *
 *   • EXTINCTION IS STRATIFIED. Haze is a fluid sitting in a gravity well, so
 *     it is dense at the valley floor and thin on the ridge tops. A ridge two
 *     hundred metres away therefore has a hazy base and a clear crest, which is
 *     the layering that makes a landscape read as deep. Uniform fog gives every
 *     surface at 200m exactly the same veil and flattens the whole range into
 *     one card.
 *   • THE HAZE IS LIT. It scatters sunlight forward hard, so looking toward the
 *     sun it glows and looking away it goes cool and blue. That single gradient
 *     across the frame is most of what "photographed" means outdoors.
 *
 * Both are computed here, and it reaches EVERY material in the game — terrain,
 * grass, water, props, characters, the hand-written shaders in Scenery.js —
 * because it *is* the stock chunk. Nothing else has to know.
 *
 * The uniforms travel by a deliberate trick: three's UniformsUtils.clone copies
 * a uniform value by reference unless it is a Color/Vector/Matrix/Texture/Array.
 * A plain {x,y,z,w} is none of those, so every material that clones the fog
 * uniforms ends up pointing at THE SAME object, and one write per frame updates
 * the entire scene. The GL uniform setters accept it because they only ever ask
 * for .x/.y/.z/.w.
 *
 * If any of it fails to arrive — a shader that never merged UniformsLib.fog, a
 * material compiled before install — the uniforms read as zero and the chunk
 * falls through to exactly three's stock behaviour rather than to black.
 */

export const AERIAL = {
  // x: 1/scale-height, y: base height, z: unused, w: extinction multiplier
  shape: { x: 0, y: 0, z: 0, w: 1 },
  // xyz: sun direction, w: inscatter strength (0 disables)
  sun: { x: 0, y: 1, z: 0, w: 0 },
  // rgb: inscatter colour, w: phase anisotropy
  tint: { x: 0, y: 0, z: 0, w: 0.7 },
};

let _aerialInstalled = false;
function installAerialPerspective(THREE_) {
  if (_aerialInstalled) return false;
  _aerialInstalled = true;
  const C = THREE_.ShaderChunk;

  // The world-space offset from the camera, without needing `worldPosition`
  // (which three only defines for envmap/shadow/transmission builds) and
  // without touching any shader's own code. v * mat3(M) is transpose(M) * v,
  // and the view matrix is rigid, so that is exactly the inverse rotation.
  C.fog_pars_vertex = [
    '#ifdef USE_FOG',
    '  varying float vFogDepth;',
    '  varying vec3 vFogRay;',
    '#endif',
  ].join('\n');

  C.fog_vertex = [
    '#ifdef USE_FOG',
    '  vFogDepth = - mvPosition.z;',
    '  vFogRay = mvPosition.xyz * mat3( viewMatrix );',
    '#endif',
  ].join('\n');

  C.fog_pars_fragment = [
    '#ifdef USE_FOG',
    '  uniform vec3 fogColor;',
    '  varying float vFogDepth;',
    '  varying vec3 vFogRay;',
    '  uniform vec4 uAerialShape;',
    '  uniform vec4 uAerialSun;',
    '  uniform vec4 uAerialTint;',
    '  #ifdef FOG_EXP2',
    '    uniform float fogDensity;',
    '  #else',
    '    uniform float fogNear;',
    '    uniform float fogFar;',
    '  #endif',
    '#endif',
  ].join('\n');

  C.fog_fragment = [
    '#ifdef USE_FOG',
    '  float fogRadial = length( vFogRay );',
    '  float fogPath = vFogDepth;',
    '  if ( uAerialShape.x > 0.0 ) {',
    // Analytic integral of exp(-h/H) along the view ray: the whole point is
    // that a ray climbing out of the haze accumulates far less than one
    // crossing the valley floor at the same length.
    '    float y0 = clamp( cameraPosition.y - uAerialShape.y, -40.0, 600.0 );',
    '    float k = vFogRay.y * uAerialShape.x;',
    '    float t0 = exp( - y0 * uAerialShape.x );',
    '    float m = abs( k ) < 1.0e-3 ? t0 : t0 * ( 1.0 - exp( - k ) ) / k;',
    '    fogPath = fogRadial * clamp( m, 0.0, 6.0 ) * uAerialShape.w;',
    '  }',
    '  #ifdef FOG_EXP2',
    '    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogPath * fogPath );',
    '  #else',
    '    float fogFactor = smoothstep( fogNear, fogFar, fogPath );',
    '  #endif',
    '  vec3 fogTone = fogColor;',
    '  if ( uAerialSun.w > 0.0 ) {',
    '    vec3 fogDir = vFogRay / max( fogRadial, 1.0e-4 );',
    '    float fogCos = dot( fogDir, uAerialSun.xyz );',
    '    float g = uAerialTint.w;',
    '    float g2 = g * g;',
    '    float phase = ( 1.0 - g2 ) / pow( max( 1.0 + g2 - 2.0 * g * fogCos, 1.0e-4 ), 1.5 );',
    // Rayleigh-ish backscatter keeps the anti-sun side from going dead flat.
    '    float back = 0.75 * ( 1.0 + fogCos * fogCos );',
    '    vec3 fogGlow = uAerialTint.xyz * uAerialSun.w * ( phase + back * 0.16 );',
    // ENERGY LIMIT. Added raw, this term is unbounded: the forward lobe peaks
    // at 6.0 at g = 0.5, so on the arena it put 0.79 on top of a fog colour of
    // 3.19 and every distant surface converged on something a quarter BRIGHTER
    // than the haze it was supposed to be dissolving into. Distance then
    // bleaches instead of receding, and a far wall ends up brighter than the
    // sky behind it — which for a passive surface behind a scattering medium
    // is not a matter of taste.
    //
    // The haze cannot hand back more light than it holds. The same exponential
    // shoulder the sky uses turns the sum into an ASYMPTOTE: identical to the
    // raw term while the glow is small, bending over to at most a quarter above
    // the fog colour however hard the phase function is driven. Convergence is
    // guaranteed by construction rather than by the numbers happening to stay
    // small.
    '    vec3 fogCap = max( fogColor, vec3( 1.0e-4 ) ) * 0.26;',
    '    fogTone += fogCap * ( 1.0 - exp( - fogGlow / fogCap ) );',
    '  }',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTone, fogFactor );',
    '#endif',
  ].join('\n');

  // Publish the shared uniforms everywhere a fogged material can pick them up.
  const extra = () => ({
    uAerialShape: { value: AERIAL.shape },
    uAerialSun: { value: AERIAL.sun },
    uAerialTint: { value: AERIAL.tint },
  });
  Object.assign(THREE_.UniformsLib.fog, extra());
  for (const key of Object.keys(THREE_.ShaderLib)) {
    const u = THREE_.ShaderLib[key].uniforms;
    if (u && u.fogColor) Object.assign(u, extra());
  }
  return true;
}

installAerialPerspective(THREE);

/* ── cascaded shadows ────────────────────────────────────────────────────
 *
 * ONE shadow box is the reason nothing past the near field is lit.
 *
 * A single ortho box has to buy reach with texel size — the two are the same
 * number, 2·radius/mapSize — so at medium it was 58 m of reach at 5.7 cm, and
 * everything beyond 58 m threw nothing at all. In an arena frame that is
 * roughly forty scattered rocks casting nothing between them and a whole ruin
 * line at 70–100 m standing in flat light. A landscape whose middle distance
 * has no cast shadow in it reads as a painted backdrop, because that is
 * precisely what a painted backdrop is.
 *
 * So: three nested boxes instead of one, sized as a fraction of the reach.
 * At medium, which is 1536² per cascade against the one 2048² box before:
 *
 *                 before            after
 *   near        5.66 cm / 58 m    2.60 cm, box radius  19.95 m
 *   middle              —         6.15 cm, box radius  47.25 m
 *   far                 —        13.67 cm, box radius 105.00 m
 *
 *   a 2 m rock stops casting at   58 m in any direction
 *                            →   at least 163 m ahead, 47 m behind
 *
 * — the asymmetry because the boxes are pushed forward along the view (see
 * fitShadows), which is where the far cascade's reach actually comes from. "At
 * least" because the box is square in LIGHT space, and its footprint on the
 * ground is an ellipse stretched 1/sin(elevation) along the sun's bearing: at
 * the arena's 34° sun it reaches 1.79 × its radius that way and exactly its
 * radius across. The guaranteed number is the short axis.
 *
 * The middle cascade is very nearly the box that used to be the whole rig, so
 * what this actually buys is one finer box under it and one much larger box
 * outside it. It costs two more shadow-map renders and two more maps — that is
 * what cascades cost everywhere, and there is no version of "shadows in the
 * middle distance" that does not pay it.
 *
 * HOW IT REACHES THE SHADER, and why it is done this way. three renders one map
 * per light, so the cascades are three DirectionalLights sharing one direction.
 * Only the first carries the sun's colour; the other two are BLACK, so they add
 * no light anywhere — including in the hand-written shaders that sum
 * `directionalLights[i].color` themselves (the grass does exactly that, and a
 * second lit sun would have tripled its key). They exist only to own a shadow
 * map. Two stock chunks are then patched so that light 0's shadow is looked up
 * in whichever cascade has the fragment:
 *
 *   · lights_fragment_begin — every lit material in the game
 *   · shadowmask_pars_fragment — getShadowMask(), which is how the grass and
 *     the shadow-only materials ask the same question
 *
 * Selection is by WHICH MAP THE FRAGMENT LANDS IN, not by view depth. The boxes
 * are nested, so the first one that contains the fragment is always the one
 * with the finest texels that can see it — and it needs no extra uniform, no
 * knowledge of the split distances in the shader, and it degrades to exactly
 * three's behaviour if a cascade's map is missing. The last 1/12 of each box is
 * a blend band into the next one out, because a hard handover between texel
 * sizes 2.4× apart is a visible line across the ground.
 */

/** Cascade radii as a fraction of the tier's reach, near to far. Roughly the
 *  usual practical split — geometric enough that the texel ratio between
 *  neighbours stays about 2.4, which is as far apart as two cascades can be
 *  before the blend band stops hiding the change in penumbra width. */
export const CASCADE_SPLIT = [0.19, 0.45, 1.0];

/**
 * What each cascade actually covers, for a quality tier. Exported because it is
 * the arithmetic the whole claim rests on, and a check should assert on the
 * engine's own numbers rather than on a copy of them that drifts.
 *
 * @returns {{radius:number, texel:number, map:number}[]} near → far, metres.
 */
export function cascadeBoxes(quality = 'high') {
  const q = QUALITY[quality] || QUALITY.high;
  return CASCADE_SPLIT.map((f) => {
    const radius = q.shadowDist * f;
    return { radius, map: q.shadow, texel: (radius * 2) / q.shadow };
  });
}

const CSM_GLSL = /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  // How far inside its own map a fragment sits: 0 at the edge, 1 once it is a
  // twelfth of the box in. Also 0 past the box's far plane, which is what makes
  // a fragment the near cascade cannot see fall through to the next one.
  // Same frustum test three's own getShadow does, so the two cannot disagree
  // about which cascade is answering.
  float saberCascadeFit( const in vec4 c ) {
    if ( c.z > c.w ) return 0.0;
    vec2 d = min( c.xy / c.w, 1.0 - c.xy / c.w );
    return clamp( min( d.x, d.y ) * 12.0, 0.0, 1.0 );
  }

  /* ── THE PENUMBRA ────────────────────────────────────────────────────
   *
   * A sun shadow with a hard edge is one of the loudest synthetic tells there
   * is, and this rig had one: measured on a 6 m blocker at the arena's 34° sun,
   * the terminator was 8.1 cm across the ground, which is the shadow an
   * 0.24°-wide source casts — under half the sun's own 0.53° disc, before any
   * blocker distance is counted at all. It could not be anything else. Read
   * three's shadowmap chunk: the SHADOWMAP_TYPE_PCF_SOFT branch builds a
   * bilinear 3×3 at exactly one texel and never mentions shadowRadius, so the
   * edge width was set by texel size and by nothing else — the shadow of a
   * crate and the shadow of a spire came out the same width, and both of them
   * came out the width of the shadow map.
   *
   * So: a blocker search, then a filter sized by what it finds. The width of a
   * real penumbra is the source's angular size times HOW FAR IN FRONT the
   * caster is, which is why a foot on the ground is sharp and the same body's
   * shadow on a wall ten metres behind it is not. One filter width cannot be
   * both, and picking either one is picking which half of the frame is wrong.
   *
   * shadowRadius is repurposed to carry it, and that is the only channel
   * there is: three uploads exactly one float per light, and adding a uniform
   * to every material in the game to carry a second is not worth what it buys.
   * It holds the PENUMBRA SLOPE — the shadow-map UV radius the source paints
   * per unit of NORMALISED depth between blocker and receiver. Ortho depth is
   * linear, so that one float folds the source's angular size, the cascade's
   * box and its depth range together (see fitShadows), and the shader is left
   * knowing none of them — which is also why it stays right when the split,
   * the tier or the weather changes.
   */

  /** Vogel disc: n points spiralling out to unit radius, evenly spread by the
   *  golden angle. Generated rather than tabulated because GLSL ES 1.00 has no
   *  const array initialisers, and this is two trig calls either way. */
  vec2 saberDisc( const in float i, const in float n, const in float phi ) {
    float t = i * 2.39996323 + phi;
    return vec2( cos( t ), sin( t ) ) * sqrt( ( i + 0.5 ) / n );
  }

  #define SABER_SEARCH 6
  #define SABER_TAPS 12
  /** The widest penumbra a cascade may paint, in its OWN texels. Past this the
   *  taps are further apart than the feature they are filtering and the edge
   *  starts to boil instead of blur. 14 texels is 31 cm in the near cascade at
   *  high and 1.6 m in the far one. It binds on a very low sun — the canyon's
   *  14° key wants 18 texels off a 6 m blocker — and there the edge comes out
   *  narrower than the air says it should, which is the honest trade. */
  #define SABER_PENUMBRA_MAX 14.0

  float saberSoftShadow( sampler2D map, vec2 mapSize, float intensity, float bias, float slope, vec4 coord ) {
    coord.xyz /= coord.w;
    coord.z += bias;
    bool inFrustum = coord.x >= 0.0 && coord.x <= 1.0 && coord.y >= 0.0 && coord.y <= 1.0;
    if ( ! ( inFrustum && coord.z <= 1.0 ) ) return 1.0;
    vec2 texel = vec2( 1.0 ) / mapSize;
    float maxR = SABER_PENUMBRA_MAX * texel.x;
    // Rotate the disc per pixel. Unrotated, twelve taps are a rosette, and a
    // rosette repeated along a shadow edge is a pattern you can read; rotated,
    // the same error lands as dither.
    //
    // AND IT IS MEASURABLY MORE DITHER THAN THE FILM GRAIN, which is the honest
    // number to leave here rather than to discover later: on the arena's macro
    // plate the row-wise standard deviation is 0.0018 on lit sand, 0.0017 in
    // the umbra and 0.0292 across the penumbra band, against a grain of about
    // 0.0086 at that luminance. Twelve stochastic taps buy a soft edge and pay
    // for it in speckle inside the band and nowhere else, and the exchange rate
    // is the square root: reaching grain level needs about 140 taps. The ways
    // out are temporal reuse or a denoise, not a bigger loop.
    float phi = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.283185;
    float sum = 0.0, n = 0.0;
    float d0 = unpackRGBAToDepth( texture2D( map, coord.xy ) );
    if ( d0 < coord.z ) { sum = d0; n = 1.0; }
    for ( int i = 0; i < SABER_SEARCH; i ++ ) {
      vec2 o = saberDisc( float( i ), float( SABER_SEARCH ), phi ) * maxR;
      float d = unpackRGBAToDepth( texture2D( map, coord.xy + o ) );
      if ( d < coord.z ) { sum += d; n += 1.0; }
    }
    // Nothing between this fragment and the sun anywhere in the search disc:
    // seven fetches and out. Count three's PCF_SOFT branch and it is SIXTEEN
    // fetches — four corners plus four two-tap mixes plus a four-tap nested one
    // — spent on every lit pixel in the game, so most of the frame gets cheaper
    // here and only the pixels actually near an edge pay the twelve-tap filter.
    if ( n < 0.5 ) return 1.0;
    float r = clamp( slope * ( coord.z - sum / n ), texel.x, maxR );
    float shadow = 0.0;
    for ( int i = 0; i < SABER_TAPS; i ++ ) {
      shadow += texture2DCompare( map, coord.xy + saberDisc( float( i ), float( SABER_TAPS ), phi ) * r, coord.z );
    }
    return mix( 1.0, shadow / float( SABER_TAPS ), intensity );
  }

  #define SABER_CASCADE(i) saberSoftShadow( directionalShadowMap[ i ], directionalLightShadows[ i ].shadowMapSize, directionalLightShadows[ i ].shadowIntensity, directionalLightShadows[ i ].shadowBias, directionalLightShadows[ i ].shadowRadius, vDirectionalShadowCoord[ i ] )
  float saberCascadeShadow() {
    float f = saberCascadeFit( vDirectionalShadowCoord[ 0 ] );
    if ( f >= 1.0 ) return SABER_CASCADE( 0 );
    #if NUM_DIR_LIGHT_SHADOWS > 1
      if ( f > 0.0 ) return mix( SABER_CASCADE( 1 ), SABER_CASCADE( 0 ), f );
      f = saberCascadeFit( vDirectionalShadowCoord[ 1 ] );
      #if NUM_DIR_LIGHT_SHADOWS > 2
        if ( f >= 1.0 ) return SABER_CASCADE( 1 );
        if ( f > 0.0 ) return mix( SABER_CASCADE( 2 ), SABER_CASCADE( 1 ), f );
        return SABER_CASCADE( 2 );
      #else
        return f > 0.0 ? SABER_CASCADE( 1 ) : 1.0;
      #endif
    #else
      return f > 0.0 ? SABER_CASCADE( 0 ) : 1.0;
    #endif
  }
#endif
`;

let _csmInstalled = false;
function installCascadeShadows(THREE_) {
  if (_csmInstalled) return false;
  _csmInstalled = true;
  const C = THREE_.ShaderChunk;

  C.shadowmap_pars_fragment += CSM_GLSL;

  // lights_fragment_begin: light 0 is the sun and reads the cascade chain.
  // Lights 1 and 2 are the black carriers — they contribute nothing to shading,
  // so emitting nothing for them is not an optimisation, it is the correct
  // result, and it keeps their coarse maps from also multiplying into the near
  // field. UNROLLED_LOOP_INDEX is substituted with a literal before the
  // preprocessor runs, so this is a compile-time choice per light.
  const line = C.lights_fragment_begin.split('\n')
    .find((l) => l.includes('directLight.color *=') && l.includes('vDirectionalShadowCoord'));
  if (line) {
    C.lights_fragment_begin = C.lights_fragment_begin.replace(line, [
      '\t\t#if UNROLLED_LOOP_INDEX == 0',
      '\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? saberCascadeShadow() : 1.0;',
      '\t\t#endif',
    ].join('\n'));
  }

  // getShadowMask() multiplies every directional shadow together, so with three
  // cascades a fragment inside two of them was shadowed twice — the coarse map's
  // penumbra darkening the fine map's. Same selection, same answer as above.
  const mask = C.shadowmask_pars_fragment;
  const i0 = mask.indexOf('#if NUM_DIR_LIGHT_SHADOWS > 0');
  const i1 = mask.indexOf('#if NUM_SPOT_LIGHT_SHADOWS > 0');
  if (i0 >= 0 && i1 > i0) {
    C.shadowmask_pars_fragment = mask.slice(0, i0)
      + '#if NUM_DIR_LIGHT_SHADOWS > 0\n\tshadow *= receiveShadow ? saberCascadeShadow() : 1.0;\n\t#endif\n\t'
      + mask.slice(i1);
  }
  return true;
}

installCascadeShadows(THREE);

/* ── and then the whole light transport is made cel ───────────────────────
 *
 * THIRD, AND THE ORDER IS LOAD-BEARING. `installCelShading` wraps two lines
 * that `installCascadeShadows` has just written (the cascade selector in
 * lights_fragment_begin and in shadowmask_pars_fragment) and one that
 * `installAerialPerspective` has just written (the mix at the end of
 * fog_fragment). Run it first and all three replacements miss silently and the
 * frame comes out half physical — which is the exact failure the file exists to
 * remove. It reports what it could not patch rather than assuming.
 *
 * See src/toon/Cel.js for what it does and src/toon/REFERENCE.md for why. */
installCelShading(THREE);

const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * The frame is exposed for the highlights and graded for contrast, which is
 * the order a camera does it in. ACES has a long shoulder; a scene pushed up
 * against it comes out with no separation left in the top half, so exposure is
 * pulled down and the job of making the image contrasty is handed to the grade,
 * where a black point and an S-curve can do it without destroying highlights.
 *
 * EXPOSURE is the trim for interiors, which have no atmosphere to meter — their
 * light comes from lamps this cannot see. Outdoors, exposure is METERED (see
 * `atmosphereMeter`): the authored value becomes a ± bias about a measured key
 * instead of an absolute. It has to be. The authored numbers span 0.86 to 0.94
 * across three levels whose actual ground irradiance spans 2.2 to 5.2 — a stop
 * and a quarter of real difference against a 5% nominal one — so the canyon
 * shipped nearly a stop underexposed and the arena nearly a stop over, and no
 * amount of grading fixes a frame that is simply metered wrong.
 */
const EXPOSURE = 0.92;

/**
 * WHAT THE BLOOM PASS IS ALLOWED TO ADD, and why it is one table rather than
 * a literal in two places.
 *
 * Bloom is added to the LINEAR buffer, before exposure and before ACES. So the
 * halo it lays down does not brighten a pixel by a fixed amount on screen — it
 * spends whatever headroom that pixel had left on the tone curve, and a high
 * albedo surface has almost none. That is the whole of the snow complaint, and
 * it is not what it looks like. Measured on the White Pass, first person, one
 * frozen frame, in the linear buffer the pass actually thresholds:
 *
 *     the snow itself, p50 0.240, p90 0.389 linear    — 4.6x UNDER the threshold
 *     ground pixels over the 1.8 threshold             0.004%
 *     whole frame with the blade hidden, over 1.8      0.003%, max 2.41
 *     as shipped, with the blade drawn                 1.32%, max 19.9
 *
 * i.e. the snow is not a bloom source and never was — raising the threshold
 * would do nothing for it, and would only strip the colour out of the halo by
 * pushing the blade's glow lobe under the line (see the flux check in
 * tools/checks/saber-light.mjs). The blade is the entire source. What the snow
 * does is receive: the same frame in DISPLAY luminance, bloom off then on —
 *
 *     pixels blown past 0.97          1.9%  ->  8.0%
 *     pixels past 0.90               14.0%  -> 23.4%
 *     widest run of blown pixels       24px ->   77px
 *     darkest tenth of the ground     0.128 ->  0.346
 *
 * a halo three times the width of the blade that drew it, and the shadowed
 * snow lifted nearly 3x. On the dune sea the same measurement is 1.3% -> 2.9%
 * and 17px -> 33px: half the damage, on a level whose ground sits at 0.183
 * linear against the snow's 0.240 and which had authored its own bloom.
 *
 * TRIM is that authored scale, pulled down across every level at once, because
 * the complaint is not level-specific. FALLBACK is the second half of the snow
 * fault and is a bug on its own: the three levels that never authored a bloom
 * value — the White Pass, the Shifting Waste and the meadow — were handed 0.5,
 * MORE than every hand-authored outdoor level in the game (0.36 to 0.42) and
 * more than the pass is even constructed with. A default may not be the hottest
 * setting in the build.
 *
 * WHAT THE TWO OF THEM BOUGHT, together with the pinched emission profile,
 * re-measured on the shipped tree by the same script (a fresh boot, so the
 * blade's pose is not bit-identical — read the magnitudes, not the last digit):
 *
 *     White Pass, first person       before      after     bloom off
 *       widest blown run              77 px      23 px       24 px
 *       frame past 0.97               8.0 %      2.7 %       1.9 %
 *       frame past 0.90              23.4 %     16.3 %      14.0 %
 *       ground, darkest tenth         0.346      0.141       0.128
 *       ground, interquartile range   0.352      0.388       0.389
 *
 * The last two lines are the report itself: the snow's own contrast — the thing
 * a "white flurry" has none of — is back to what the frame has with the pass
 * switched off entirely, while the blade keeps a halo.
 */
const BLOOM = {
  radius: 0.55,
  /** LINEAR HDR. See the note in _setupComposer before moving it. */
  threshold: 1.8,
  /** A level that authored no bloom of its own gets what the pass is built with. */
  fallback: 0.42,
  /**
   * Every level's authored strength, trimmed by this.
   *
   * Chosen against the widest run of blown-to-white pixels across the blade in
   * a first-person frame, which is the "fat white bar" as one number. On the
   * White Pass, with the thinner emission profile already in (see
   * Saber.PROFILE), sweeping the strength on one frozen frame:
   *
   *     strength   blown run   frame past 0.97   frame past 0.90
   *     0.50 (was)     39 px        3.3 %            21.3 %
   *     0.34           18 px        1.6 %            17.7 %
   *     0.30           16 px        1.4 %            17.1 %
   *     0.26           14 px        1.2 %            16.2 %
   *     bloom off      ~13 px       ~1.0 %           ~15 %
   *
   * The halo has to be a halo, so the target is not the bloom-off floor: it is
   * the smallest number that still reads as one. Past about 0.30 the curve has
   * flattened onto the floor and further trimming buys nothing but a duller
   * blade. 0.42 x 0.72 = 0.3024 for the snow levels; the dune sea, which
   * authored 0.36, lands at 0.259.
   */
  trim: 0.72,
};

/** Radiance a mid-grey horizontal surface should land on. Calibrated so the
 *  dune sea, the one level that was correctly exposed, does not move. */
const KEY = 0.191;

/**
 * HOW MANY PLATEAUS THE DRAWN SKY IS CUT INTO.
 *
 * Six, and it is bounded by the levels rather than chosen.
 *
 * The bands are cut on a FIXED grid in sqrt(radiance) — they have to be, or the
 * same sky would quantise differently as the sun moved and every level would
 * get its own staircase — so what a level actually gets is however many
 * boundaries its own range happens to cross. Measured on the shipped
 * atmospheres, distinct fields drawn across the whole dome:
 *
 *                 4 bands   6 bands
 *     dune sea       4         5      clear air, 26° sun, the widest range
 *     meadow         3         4
 *     arena          3         4
 *     white pass     2         3
 *     canyon         2         2      a 14° sun; the sky spans very little
 *
 * At four, the canyon and the white pass both came out as TWO flat fields with
 * a single hard arc between them, which does not read as a graphic sky — it
 * reads as a rendering fault, and both were screenshotted that way. Six lifts
 * the white pass off that floor and leaves the widest level at five fields,
 * comfortably inside rule 7's "one simple gradient". Further up starts putting
 * a visible staircase down the aureole on the dune sea, which is the level with
 * the most range to spend.
 *
 * THE CANYON STAYS AT TWO and no band count fixes it: its sky at a 14° sun
 * spans less than one band's width however finely the grid is cut. That is a
 * property of the atmosphere the level authored, not of this number, and it is
 * left alone — a level whose sky really is two colours should draw two.
 */
const SKY_BANDS = 6;

/** How much of the environment probe is allowed to count as light. */
const ENV_INTENSITY = 0.38;

/** The hemisphere light is a floor under the probe, not a second ambient. */
const HEMI_TRIM = 0.45;

/**
 * How much diffuse sky a level is allowed, as a fraction of its direct sun —
 * and the reason it is a FUNCTION of the sun's height rather than a constant.
 *
 * It used to be a flat 0.55, defended as "about where a real daylit scene sits
 * anyway". It is not. On a clear day the diffuse horizontal irradiance runs
 * about a fifth of the direct at a high sun; 0.55 is three times that, and it
 * is the whole reason the frame had no blacks in it. Measured on a controlled
 * cast shadow (tools/_shade.mjs), sand in the sun and the same sand in its own
 * shadow came out 1.97:1 in display on the arena, off 2.64:1 of metered linear
 * irradiance — a shadow at better than half the brightness of the light. A
 * clear desert at that sun is nearer five to one; this curve puts it at 4.26.
 *
 * But it cannot be a smaller constant either, because the diffuse fraction is
 * not constant: it is set by AIR MASS. A sun at 14° is shining through nearly
 * four times the atmosphere a sun at 60° is, so far more of its beam arrives
 * as sky and far less as sun — which is exactly why the canyon, at a 14° sun,
 * was already the one level the judge called tonally lit, and why cutting
 * every level by the same factor would have broken the one that was right.
 * This curve leaves the canyon at 0.48 (87% of what it had) and takes the
 * arena to 0.24 and the dune sea to 0.31.
 *
 * @param {number} sunY sin(elevation), i.e. the sun direction's y.
 */
export function diffuseCap(sunY) {
  return 0.14 + 0.62 * Math.pow(Math.max(1 - Math.max(sunY, 0), 0), 2.2);
}

/**
 * How much of the sky's own chroma the environment probe keeps.
 *
 * This was 0.6, on the reasoning that the probe stands in for bounce as well
 * as sky and "real bounce has been through two or three surfaces and is much
 * less saturated than Preetham's blue; baked at full chroma every shadowed
 * face turns cyan". The first half was true and the second half was a
 * consequence of a bug, not of chroma: the ground-bounce hemisphere the probe
 * was supposed to be getting its warm, desaturated half from HAS NEVER BEEN IN
 * THE BAKE (see refreshEnvironment). So the sky was desaturated to stand in
 * for a term that was missing, and the result is that a warm albedo under a
 * de-blued sky lands on neutral by construction: measured, sand in cast shadow
 * came out saturation 0.075 at hue 58° on the arena, 0.051 at 197° on the dune
 * sea and 0.013 at 79° on the canyon. Grey, whatever the level.
 *
 * Full chroma, and the bounce put back where it belongs, is the pair.
 */
const PROBE_CHROMA = 1.0;

/** The sun's own angular diameter, degrees. A floor, and only a floor. */
const SUN_DISC_DEG = 0.53;
/**
 * …and the circumsolar aureole around it. Forward Mie scattering does not
 * remove light from the beam so much as smear it into a few degrees around the
 * disc, and that aureole casts a shadow too — which is why a desert shadow
 * edge measures wider than 0.53° at noon and why the edge softens visibly as
 * the air thickens. Scaled by the level's own turbidity: the canyon's 4.5 adds
 * 0.40°, the arena's 6 adds 0.64°, the dune sea's 8.5 adds 1.04°.
 */
const AUREOLE_DEG = 1.6;
/**
 * Where the source ends up when a front has taken the whole beam: the sky
 * itself is the light, and it is tens of degrees across. A crate in a dust
 * storm has no edge to its shadow, and until now it had the same razor edge it
 * has at noon — the storm work could dim the key and lift the fill from its
 * own file but the edge lives here.
 */
const OVERCAST_DEG = 60;

/**
 * The far plane the probe is baked through, and the radius of the ground-bounce
 * hemisphere that has to fit inside it.
 *
 * These are a PAIR and that is the whole point of naming them. PMREMGenerator
 * .fromScene defaults to near 0.1 / far 100; the bounce dome was scaled to
 * 4000, so every one of its vertices sat past the far plane, every triangle was
 * clipped, and the "only thing that puts colour under a chin" has contributed
 * nothing to any frame this game has ever drawn. Nothing threw, nothing warned,
 * and the sky was then desaturated by 40% to cover for the missing term.
 *
 * The far plane is passed explicitly now so the two numbers are connected by
 * code rather than by a comment, and a check asserts one is inside the other.
 */
export const PMREM_FAR = 100;
export const BOUNCE_RADIUS = 60;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _sv1 = new THREE.Vector3(), _sv2 = new THREE.Vector3();
/* fitShadows' own scratch. Deliberately not _sv1/_sv2: those belong to
 * skyRadiance, and a shared scratch that is only safe "because the call stacks
 * do not overlap today" is a bug with a date on it. */
const _fs = Array.from({ length: 5 }, () => new THREE.Vector3());
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/* ── the sky, evaluated on the CPU ───────────────────────────────────────
 *
 * The same Preetham model the dome runs, in JS, so the things that have to
 * agree with the sky can be derived from it instead of guessed at: the haze
 * distance dissolves into, and the colour that haze glows when it is between
 * you and the sun. Guessing those is how a level ends up with fog the same
 * colour as its own sand — 50% fog at two hundred metres that changes nothing,
 * and a horizon where the land meets the sky at a hard edge.
 *
 * Transcribed from vendor/three/objects/Sky.js. tools/checks/lighting.mjs pins
 * it against the shader's own constants.
 */
const SKY = {
  betaR: [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5],
  mieConst: [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14],
  cutoff: 1.6110731556870734, steepness: 1.5, EE: 1000,
  rayleighZenith: 8.4e3, mieZenith: 1.25e3,
};

export function skyRadiance(dir, sunDir, a, out = new THREE.Color()) {
  const turbidity = a.turbidity ?? 6, rayleigh = a.rayleigh ?? 2.2;
  const mieCoefficient = a.mie ?? 0.008, g = a.mieG ?? 0.82;
  // Private scratch. Callers routinely pass _v1/_v2 in as `dir`, so borrowing
  // them here would clobber the caller's own vector between two calls.
  const d = _sv1.copy(dir).normalize(), s = _sv2.copy(sunDir).normalize();
  const sunE = SKY.EE * Math.max(0, 1 - Math.exp(-((SKY.cutoff - Math.acos(clamp(s.y, -1, 1))) / SKY.steepness)));
  // vSunfade uses the raw sunPosition.y, which the engine always feeds as a
  // unit vector, so exp(y/450000) is 1 to eleven places and this is 1.
  const rc = rayleigh;
  const zen = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = SKY.rayleighZenith * inv, sM = SKY.mieZenith * inv;
  const cosT = d.dot(s);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(Math.max(1 - 2 * g * cosT + g2, 1e-6), 1.5));
  const mie = 0.434 * (0.2 * turbidity) * 10e-18;
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = SKY.betaR[i] * rc, bM = SKY.mieConst[i] * mie * mieCoefficient;
    const Fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    const k = clamp(Math.pow(1 - s.y, 5), 0, 1);
    Lin *= 1 + (Math.sqrt(sunE * ratio * Fex) - 1) * k;
    c[i] = (Lin + 0.1 * Fex) * 0.04;
  }
  return out.setRGB(c[0] + 0, c[1] + 0.0003, c[2] + 0.00075, THREE.LinearSRGBColorSpace);
}

/* ── two shoulders, because the sky is doing two jobs ────────────────────
 *
 * LIGHT TRANSPORT wants the sky as it really is. The exposure meter integrates
 * it for the irradiance landing on the ground, and the environment probe baked
 * from it is the only indirect light in the game; both need a sky whose
 * horizon is genuinely twenty times its zenith or the shading loses all its
 * direction. SKY_PHYSICAL is that, and it exists at all only because
 * Preetham's solar term reaches 7e5 and a half-float target turns anything
 * past 65504 into Infinity — which takes bloom to NaN.
 *
 * WHAT IS DRAWN has to fit inside the camera, and it did not. Measured on the
 * arena: 42.3% of the sky hemisphere renders above 1.8 — which is the bloom
 * pass's threshold, and the threshold every VFX in the game is authored
 * against (Particles.js pins sparks at 1.50 against it, Saber.js the blade).
 * Bloom is a HIGHLIGHT effect. Handed half the frame as a source it is not a
 * highlight, it is a veil, and it was measurably the thing bleaching the
 * landscape: with bloom off the arena rim reads 0.441 display luminance and
 * with it on 0.782, the spire at 60 m goes 0.321 → 0.866, and the whole sky
 * clips to white. Not fog. Not albedo. Bloom, fed a sky two to four times over
 * its own threshold across half the dome.
 *
 * So the DRAWN dome is compressed onto a ceiling under that threshold. The sun
 * disc is added AFTER the shoulder and still reaches 34, so it stays the one
 * thing in the sky that blooms — which is the one thing that should. Nothing
 * about the light the scene is lit by changes: refreshEnvironment swaps the
 * physical pair back in for the duration of the bake.
 */
export const SKY_PHYSICAL = { knee: 2.4, ceil: 9.5 };

/**
 * The exposed radiance the brightest piece of sky is allowed to reach.
 *
 * 0.72 was defended as landing the skyline "around 0.92 display luminance".
 * It does not, and that is measurable without a GPU: 0.72 exposed is 0.842
 * through ACES, and the sky never reaches its own asymptote anyway — measured
 * on the arena's pinned frame the sunward skyline read 0.829 and the mid sky
 * 0.584 against sunlit sand at 0.655. The sky was DARKER than the ground it
 * stood over, on a desert, which is the "no whites" half of the complaint and
 * is the one thing a desert frame cannot be.
 *
 * 1.18 exposed is 0.906 through ACES, which is what the old comment claimed
 * and what a skyline should be: the brightest thing in the frame, a hair short
 * of paper white, the sun disc still the only thing that clips. It stays under
 * the 1.55 linear ceiling below and therefore under the bloom pass's 1.8, so
 * the dome still cannot become a bloom source — the drawn sky approaches its
 * ceiling asymptotically and tops out around three quarters of it.
 */
const SKY_CLIP = 1.18;
/**
 * …held inside this band in LINEAR radiance whatever the exposure asks for.
 * The ceiling is the load-bearing one: 1.55 is under the bloom pass's 1.8
 * threshold, so the dome cannot become a bloom source. The floor stops a level
 * metered for a dark gorge — the canyon meters at 1.71, two and a half stops
 * off the arena — from compressing its own sky into a flat grey card.
 */
const SKY_CLIP_RANGE = [0.45, 1.55];

/**
 * The shoulder the DRAWN sky is compressed onto for a given atmosphere. It has
 * to move with the exposure: a single fixed pair put the arena's skyline at
 * 0.96 display and the canyon's at 1.002 — clipped — because the two levels
 * meter two and a half stops apart off the same authored numbers.
 */
export function skyDisplayShoulder(a, meter = null) {
  const m = meter || atmosphereMeter(a);
  const ceil = clamp(SKY_CLIP / Math.max(m.exposure, 1e-3), SKY_CLIP_RANGE[0], SKY_CLIP_RANGE[1]);
  // The knee is where compression starts, and it has to be LOW. The drawn sky
  // spans about ten to one from zenith to skyline; put the knee where the
  // zenith is and everything above it lands inside the last 5% of the range.
  // At 0.15 of the ceiling the whole dome is on the reciprocal tail, which is
  // the part that keeps separating — arena zenith 0.765 → 0.52 against a
  // skyline of 3.19 → 0.85, a gradient you can see rather than a wash.
  return { knee: ceil * 0.15, ceil };
}

/**
 * The shoulder _linearSky bakes into the dome, so the CPU side agrees with it.
 *
 * A RECIPROCAL tail, not an exponential one. The exponential is within a per
 * cent of its ceiling two spans past the knee and flat as a board after that,
 * which is fine when the ceiling is 9.5 and almost nothing reaches it, and
 * catastrophic once the ceiling comes down to where the drawn sky lives:
 * measured on the arena with a 1.056 ceiling, the whole sky from the skyline
 * to 50° elevation — physical radiance 1.6 to 3.9, well over two stops of real
 * modelling — came out between 0.99 and 1.056. One flat card. The reciprocal
 * has the same value and the same slope at the knee and the same asymptote,
 * but it never stops separating: those same two stops come out 0.81 to 0.96.
 */
export function skyShoulder(c, knee = SKY_PHYSICAL.knee, ceil = SKY_PHYSICAL.ceil) {
  const span = Math.max(ceil - knee, 0.001);
  const f = (v) => { const x = Math.max(v - knee, 0); return Math.min(v, knee) + span * x / (x + span); };
  return c.setRGB(f(c.r), f(c.g), f(c.b), THREE.LinearSRGBColorSpace);
}

/**
 * What distance dissolves into, in radiance. One function, so the checks can
 * assert on the thing the engine actually runs instead of on a transcription
 * of it that drifts the first time either changes.
 *
 * Authored fog colours are albedo-ish sRGB swatches; used raw they dissolve
 * distance into something DARKER than the horizon it meets, which is a hard
 * silhouette where there should be a merge, and — when the swatch is the same
 * tan as the sand, which it was — 50% fog at 200 m that changes nothing at all.
 * Keep the authored hue, take the LEVEL from the sky.
 *
 * From the DRAWN sky, specifically. Anchored to the physical skyline the arena
 * fog landed at linear luminance 3.19 while the same skyline rendered at 1.50,
 * so everything at distance converged on something twice as bright as the sky
 * standing over it.
 */
export function hazeRadiance(a, out = new THREE.Color(), shoulder = null) {
  out.set(a.fogColor ?? 0xc9b391);
  if (a.sky === false) return out;
  const s = shoulder || skyDisplayShoulder(a);
  const sunPos = sunDirection(a, new THREE.Vector3());
  // Beside the sun, at the skyline: the direction most of the haze in a level
  // is actually seen against. Local vectors — skyRadiance borrows the module
  // scratch for its own normalisation.
  const side = sunPos.clone().setY(0).normalize()
    .cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
  const haze = skyShoulder(skyRadiance(side, sunPos, a, new THREE.Color()), s.knee, s.ceil);
  // Half the HUE comes from the sky too. In a bright desert the haze is barely
  // brighter than the sand, so what actually reads as distance is losing
  // SATURATION into the sky, and a fog swatch authored the same tan as the sand
  // it hides takes no saturation from anything. Keep enough of the author's
  // dust to keep the mood.
  /* 0.88, not 0.55, and this is rule 3 of src/toon/REFERENCE.md as a number:
   * "aerial perspective is a HUE SHIFT toward the sky, not grey fog … distant
   * rock in (1) goes lavender; the far cliffs in (3) go pale mint. They move
   * toward the sky's own colour."
   *
   * At 0.55 the authored dust keeps nearly half the say in what distance
   * converges on, and where the level's sky is close to neutral that is not a
   * cast, it is a different colour. Measured on the shipped atmospheres, haze
   * saturation against the saturation of the skyline it is standing in:
   *
   *                  sky     haze at 0.55    haze at 0.88
   *     alpine       0.006      0.186           0.041
   *     canyon       0.012      0.091           0.023
   *     arena        0.082      0.045           0.026
   *     dunes        0.222      0.071           0.058
   *
   * — so on the two levels with a near-neutral sky, distance was dissolving
   * everything into something fifteen to thirty times more chromatic than the
   * sky behind it. That is the definition of the thing the reference calls
   * "grey fog": a veil with a colour of its own, laid over the scene, rather
   * than the scene walking toward the sky. The authored swatch is not
   * discarded — an eighth of it survives as a cast, which is what keeps a dust
   * level warm and a snow level cold — but it can no longer set the hue.
   *
   * tools/checks/cel.mjs pins the property this is here to satisfy: the haze
   * may not be more saturated than the sky it converges on. */
  out.lerp(haze.clone().multiplyScalar(1 / Math.max(0.02, lum(haze))), 0.88);
  const want = clamp(lum(haze), 0.25, 3.2);
  // The lower bound used to be 0.9 — a guard against crushing the authored
  // swatch, from when the sky it was matching to was three times brighter than
  // anything else in the frame. Against the drawn sky it is the wrong way
  // round: on the canyon it pinned the fog at 0.66 under a skyline of 0.45, so
  // distance converged on something half again brighter than the sky it was
  // dissolving into. The sky is the authority; let it pull the swatch down.
  return out.multiplyScalar(clamp(want / Math.max(0.02, lum(out)), 0.35, 4.5));
}

/**
 * What lights a cloud, in the same radiance units as everything else. Pure
 * function of an atmosphere block, because it is the number the whole deck's
 * tonality hangs off and it has to be checkable without a GL context.
 *
 * A cumulus is a WHITE BODY — albedo about 0.9 — not an authored swatch. Its
 * sunlit face returns the sun's own irradiance over pi; on the arena that is
 * 1.12 against the 0.145 a swatch-as-radiance was giving a thick cloud. Eight
 * times too dark is not a cloud, it is a hole in the sky, and that is exactly
 * how the deck read.
 *
 * Its base has three sources and none of them is optional:
 *   · the GROUND BOUNCE. Over pale sand this rivals the other two, and it is
 *     why a desert cumulus has a warm belly rather than a blue one.
 *   · the SKY, which the base sees a good slice of around the cloud's edge.
 *   · MULTIPLE SCATTERING inside the deck itself. Single scattering alone puts
 *     a base at 0.30 display against a 0.83 top, which is a thunderhead; a
 *     fair-weather cumulus is grey underneath, not black, and essentially all
 *     of that grey is light that has bounced twice inside the cloud.
 *
 * `tint` is those same three weighted by how much each contributes, which is
 * the only honest way to get the base's colour. Read straight off the dome and
 * lerped toward white it measured 0.51 saturated and the deck came out
 * turquoise over an ochre desert; weighted, it lands near 0.29 — a cool grey
 * with a warm undertone, which is what a cloud base is.
 */
const CLOUD_ALBEDO = 0.9;
const CLOUD_FACING = 0.35;
export function cloudLight(a, meter = null) {
  const m = meter || atmosphereMeter(a);
  const sunPos = m.sunPos;
  // A CUMULUS TOP IS NOT A HORIZONTAL PLATE. `sunY` is the cosine for flat
  // ground, and using it here said a cloud at a 14° sun receives a quarter of
  // the beam a cloud at noon does — which is why the canyon's deck was the
  // darkest in the game under the level with the most weather in it. A cumulus
  // is a bulging cauliflower above the haze: some of its facets always face the
  // sun squarely, and those are the ones that read as the top. CLOUD_FACING is
  // how far toward normal incidence the brightest facets sit; 0.35 keeps every
  // level's deck under the bloom pass's 1.8 after exposure (the canyon, metered
  // 2.4 stops off the arena, is the one that binds — it lands at 1.64) while
  // leaving it above the sky it stands in front of, which is the pair a deck
  // has to satisfy to read as a cloud rather than as a hole.
  const facing = sunPos.y + CLOUD_FACING * (1 - Math.max(sunPos.y, 0.05));
  const sun = CLOUD_ALBEDO * (a.sunIntensity ?? 3.6) * Math.max(facing, 0.05) / Math.PI;
  const tint = new THREE.Color(1, 1, 1);
  if (!m.outdoor) return { sun, amb: 0.42, tint, bounce: 0, sky: 0, inner: 0 };
  const ground = new THREE.Color(a.groundColor ?? 0x60482e);
  const bounce = lum(ground) * m.irradiance / Math.PI;
  ground.multiplyScalar(1 / Math.max(0.02, lum(ground)));
  const zen = new THREE.Color();
  const sky = lum(skyShoulder(skyRadiance(new THREE.Vector3(0, 1, 0), sunPos, a, zen))) * 0.25;
  // The sky's CHROMA from the shade side, which is the bluest part of the dome
  // — and a cloud base does not see one direction, it sees the whole
  // hemisphere, most of which is the pale sky near the horizon. Standing that
  // average in with a single sample left the canyon's base tint 0.43 saturated,
  // which is a turquoise cloud. Pulling a third of the way to white is the
  // cheap version of the integral and lands all three levels under 0.35.
  const skyHue = skyRadiance(new THREE.Vector3(-sunPos.x, 1.6, -sunPos.z).normalize(),
    sunPos, a, new THREE.Color());
  skyHue.multiplyScalar(1 / Math.max(0.02, lum(skyHue))).lerp(WHITE, 0.34);
  const inner = sun * 0.22;
  const amb = bounce + sky + inner;
  const inv = 1 / Math.max(amb, 1e-4);
  tint.setRGB((ground.r * bounce + skyHue.r * sky + inner) * inv,
    (ground.g * bounce + skyHue.g * sky + inner) * inv,
    (ground.b * bounce + skyHue.b * sky + inner) * inv, THREE.LinearSRGBColorSpace);
  tint.multiplyScalar(1 / Math.max(0.02, lum(tint)));
  return { sun, amb, tint, bounce, sky, inner };
}

/** Where the sun is, from an atmosphere block. */
export function sunDirection(a, out = new THREE.Vector3()) {
  return out.setFromSphericalCoords(1,
    THREE.MathUtils.degToRad(90 - (a.elevation ?? 22)),
    THREE.MathUtils.degToRad(a.azimuth ?? 140));
}

/**
 * The light meter, and the ambient budget that goes with it. Pure function of
 * an atmosphere block so it can be checked without a GL context.
 *
 * Integrates the whole sky, cosine-weighted, for the irradiance it actually
 * lands on a horizontal surface. Two things come out of that:
 *
 *   • HOW MUCH INDIRECT LIGHT TO ALLOW. Preetham's sky is bright relative to
 *     the sun intensities the levels author, and a scene whose indirect light
 *     rivals its direct light has no shape in it — every surface reads the same
 *     whichever way it faces. Measured: the arena's sky puts 2.34 on the ground
 *     against 2.74 from its sun, and it looked like a white-out. Capping
 *     indirect at 55% of direct is the difference between a lit scene and a
 *     lightbox, and it is about where a real daylit scene sits anyway.
 *   • WHAT EXPOSURE PUTS A MID-GREY ON THE CURVE. The authored exposures span
 *     5% across three levels whose real ground irradiance spans 140%, so the
 *     canyon shipped the best part of a stop under and the arena a stop over.
 *     The authored number becomes a ± bias about the measured key.
 */
export function atmosphereMeter(a) {
  const sunPos = sunDirection(a, new THREE.Vector3());
  const sunI = a.sunIntensity ?? 3.6;
  const outdoor = a.sky !== false;
  const hemiI = (a.ambient ?? 0.85) * (outdoor ? HEMI_TRIM : 1);
  const fillI = a.fillIntensity ?? 0.25;
  const hemiIrr = hemiI * lum(_c2.set(a.skyColor ?? 0xbcd8ff));
  const fillIrr = fillI * lum(_c2.set(a.fillColor ?? 0x9fc4ff)) * 0.5;
  // A landscape is not a flat plate, so only part of it takes the sun square
  // on; 0.7 is about the average of cos over gently rolling ground.
  const direct = outdoor ? sunI * Math.max(sunPos.y, 0) * 0.7 : sunI * 0.7;

  if (!outdoor) {
    // No atmosphere to meter — an interior is lit by lamps this cannot see.
    return { sunPos, outdoor, direct, skyFull: 0, envI: ENV_INTENSITY,
      irradiance: direct + hemiIrr + fillIrr, key: null,
      exposure: (a.exposure ?? 1.05) * EXPOSURE };
  }

  let e = 0, w = 0;
  for (let ring = 0; ring < 4; ring++) {
    const el = ((ring + 0.5) / 4) * (Math.PI / 2);
    const s = Math.sin(el), c = Math.cos(el);
    for (let k = 0; k < 6; k++) {
      const az = ((k + 0.5) / 6) * Math.PI * 2;
      _v1.set(s * Math.cos(az), c, s * Math.sin(az));
      e += lum(skyShoulder(skyRadiance(_v1, sunPos, a, _c1))) * c * s;
      w += c * s;
    }
  }
  const skyFull = Math.PI * (e / Math.max(w, 1e-6)) * ENV_INTENSITY;
  // The floor was 0.45 and is now 0.16, because the cap it guards is no longer
  // a flat 0.55: a floor set just under the old cap turned the whole thing into
  // a constant the moment the cap came down. No level sits on it — the clamp's
  // input measures 0.29 on the arena, 0.50 on the dune sea and 0.49 on the
  // canyon — so it guards against an unauthored sky, not against these three.
  const envI = ENV_INTENSITY * clamp(diffuseCap(sunPos.y) * direct / Math.max(skyFull, 1e-4), 0.16, 1);
  const irradiance = direct + skyFull * (envI / ENV_INTENSITY) + hemiIrr + fillIrr;
  const key = irradiance * 0.18 / Math.PI;
  return { sunPos, outdoor, direct, skyFull, envI, irradiance, key,
    exposure: clamp((a.exposure ?? 1.05) * KEY / Math.max(key, 1e-4), 0.2, 3.0) };
}

/* ── composite shader ────────────────────────────────────────────────── */

const CompositeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    tNoise:      { value: null },
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    /* ── THE LENS IS NOT IN THE PICTURE ────────────────────────────────
     *
     * Grain and chromatic aberration are CAMERA artefacts. They say "a lens
     * and a sensor were here", and they are three of the strongest such cues
     * available — which is exactly why they were dialled in when the brief was
     * "does it read as photographed". Under the brief in src/toon/REFERENCE.md
     * they work directly against everything else in this change: there is no
     * grain in a painting, and a drawn line does not fringe red on one side and
     * cyan on the other. Left in, they are the last thing in the frame still
     * arguing that this is a photograph, and they argue it at pixel level where
     * flat colour fields make them MORE visible than they were over a noisy
     * PBR image, not less.
     *
     * Both are zeroed rather than removed: the code paths cost nothing at zero
     * (the shader branches on the uniform), `setGrain` is a player-facing
     * setting that has to keep working, and the damage flash drives aberration
     * deliberately as an EVENT — `uHurt` multiplies it — which is a drawn
     * effect rather than a permanent lens.
     *
     * The vignette stays, at a little under half. It is not a lens artefact in
     * the same sense: every one of the reference frames is darker at its edges
     * because it was COMPOSED that way, and a vignette is the cheapest possible
     * version of that composition. At 0.22 it read as a lens; at 0.10 it reads
     * as the edge of a painted board. */
    uGrain:      { value: 0 },
    uVignette:   { value: 0.10 },
    uAberration: { value: 0 },
    uSaturation: { value: 1.06 },
    uContrast:   { value: 1.04 },
    uLift:       { value: new THREE.Vector3(0.004, 0.006, 0.012) },
    uGain:       { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    uSense:      { value: 0 },      // Force Sense 0..1
    uHurt:       { value: 0 },      // damage flash 0..1
    uHeat:       { value: [] },     // vec4 x,y,radius,strength (screen space)
    uHeatCount:  { value: 0 },
    uRadial:     { value: 0 },      // radial blur amount
    /* ZERO, FOR EXACTLY THE REASON uGrain AND uAberration ARE ZERO — and this
     * one was missed when they were, which is worse than either of them.
     *
     * The pass order (see _buildComposite's chain) is bloom → OutputPass →
     * OutlinePass → this shader with renderToScreen. So the frame this unsharp
     * mask sharpens is the frame with the INK ALREADY DRAWN INTO IT: every
     * outline the pass in src/toon/Ink.js draws, and every boundary between two
     * posterised bands, arrives here as a step edge and leaves with a bright rim
     * along it. That is the single most recognisable "this went through a
     * sharpen filter" artefact there is, and it is being applied to the drawn
     * lines that are supposed to be the least photographic thing in the frame.
     *
     * Re-derived from the four taps below at the shipped 0.12: a field pixel
     * beside a one-pixel line gains 0.03·(field − line) and the line pixel loses
     * 0.06·(field − line). On the arena's measured pair (field 0.600, ink 0.223)
     * that is +2.9/255 on both sides of every line and −5.8/255 down the line
     * itself; over a bright field at 0.90 the halo reaches +5.2/255. Small per
     * pixel and continuous along every line in the frame, on precisely the flat
     * colour fields the note above argues make such artefacts MORE visible.
     *
     * It was also unreachable: nothing in src or tools ever wrote this uniform,
     * on any quality tier or setting, so 0.12 was the only value it ever had.
     * Kept as a uniform rather than deleted because the branch costs nothing at
     * zero and tools/skyshot.mjs reports it. */
    uSharpen:    { value: 0 },
    uFlash:      { value: 0 },
    /**
     * A PUNCH IN THE FRAME, and it is NOT uFlash.
     *
     * uFlash adds white everywhere, which is a detonation. What a kill wants is
     * the other thing a camera does when something lands: the edges close in
     * and the middle gets harder for about a sixth of a second. So this drives
     * the vignette up and the contrast with it, centred — the frame squeezes
     * around what you just did rather than washing out.
     *
     * Kept separate from uVignette rather than added into it because the
     * vignette is COMPOSITION (see the note on it) and this is an EVENT: the
     * composition must be able to stay at 0.10 while an event rides on top, and
     * a check reading uVignette must still measure the composition.
     */
    uPunch:      { value: 0 },
    /**
     * DRAIN THE COLOUR OUT, over seconds rather than frames. Death, and only
     * death: the run is over and the world stops being a place you can act on.
     * 1.0 is fully grey. Kept off the Sense grade, which is a COOL desaturation
     * that silvers the highlights — an ability reads as an ability, and a death
     * has to read as an ending.
     */
    uDrain:      { value: 0 },
    /**
     * LETTERBOX. `x` is the bar height as a fraction of the frame, 0 for none.
     * It is here rather than in the DOM because the DOM overlay is Agent B's
     * file and because a bar drawn in the composite is inside the grade — it
     * cannot disagree with the frame's own black point.
     */
    uBars:       { value: 0 },
    uBlack:      { value: 0.018 },  // where black actually is
    uCurve:      { value: 0.32 },   // filmic S, applied in display space
    uShadowTint: { value: new THREE.Vector3(0.955, 0.985, 1.070) },
    uHighTint:   { value: new THREE.Vector3(1.035, 1.000, 0.955) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, tNoise;
    uniform vec2 uResolution;
    uniform float uTime, uGrain, uVignette, uAberration, uSaturation, uContrast;
    uniform float uSense, uHurt, uRadial, uSharpen, uFlash;
    uniform float uPunch, uDrain, uBars;
    uniform float uBlack, uCurve;
    uniform vec3 uLift, uGain, uShadowTint, uHighTint;
    uniform vec4 uHeat[6];
    uniform int uHeatCount;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

    // One place that knows how to read the frame, so the radial blur cannot be
    // silently dropped by a later channel-wise fetch.
    vec3 sampleScene(vec2 uv){
      if(uRadial <= 0.001) return texture2D(tDiffuse, uv).rgb;
      vec3 acc = vec3(0.0);
      for(int i=0;i<6;i++){
        float t = float(i)/5.0;
        acc += texture2D(tDiffuse, mix(uv, vec2(0.5), t * uRadial * 0.16)).rgb;
      }
      return acc / 6.0;
    }

    void main(){
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // — heat haze: refractive wobble around hot emitters
      vec2 warp = vec2(0.0);
      for(int i=0;i<6;i++){
        if(i >= uHeatCount) break;
        vec4 h = uHeat[i];
        vec2 d = uv - h.xy;
        d.x *= uResolution.x / uResolution.y;
        float dist = length(d);
        float fall = smoothstep(h.z, 0.0, dist);
        if(fall <= 0.0) continue;
        float n1 = texture2D(tNoise, uv*3.0 + vec2(uTime*0.31, uTime*0.47)).r - 0.5;
        float n2 = texture2D(tNoise, uv*4.7 - vec2(uTime*0.23, uTime*0.19)).g - 0.5;
        warp += vec2(n1, n2) * fall * h.w * 0.028;
      }
      uv += warp;

      // — radial blur (Force Sense / impacts)
      vec3 col = sampleScene(uv);

      // — chromatic aberration, stronger toward the corners
      // ~1px of R/B separation at the corners, not seven. The old falloff had
      // a constant term, so even dead centre was fringing.
      // uHurt ADDS rather than multiplies. It used to be a gain on
      // uAberration, and uAberration is zero now (see the uniform's note), so a
      // gain on it is a gain on nothing — the damage fringe would have gone
      // silently missing along with the permanent one. A hit is an EVENT and a
      // drawn one; the lens is what was removed.
      float ca = (uAberration + uHurt * 0.42) * (0.0002 + r2 * 0.0035);
      if(ca > 0.00001){
        // NB: sample through the same path col came from. Reading tDiffuse
        // directly here discarded the radial blur in R and B, so Force Sense
        // blurred the green channel only and the screen looked broken.
        col.r = sampleScene(uv + centred * ca).r;
        col.b = sampleScene(uv - centred * ca).b;
      }

      // — unsharp mask for micro contrast. uSharpen is 0; see the uniform.
      // The four taps go through sampleScene() rather than straight at
      // tDiffuse, because reading tDiffuse directly six lines above is the bug
      // the chromatic-aberration note describes — it discarded the radial blur
      // and broke Force Sense — and the same fault was sitting here unfixed.
      if(uSharpen > 0.001){
        vec2 tx = 1.0 / uResolution;
        vec3 blur = sampleScene(uv + vec2(tx.x,0.0))
                  + sampleScene(uv - vec2(tx.x,0.0))
                  + sampleScene(uv + vec2(0.0,tx.y))
                  + sampleScene(uv - vec2(0.0,tx.y));
        col += (col - blur * 0.25) * uSharpen;
      }

      // — grade
      //
      // The scene arrives already through ACES, and ACES has a long shoulder.
      // A sunlit desert sits ON that shoulder: measured, sand at 0.90 linear
      // and the haze behind it at 1.20 — a third brighter — came out six 8-bit
      // values apart. Every bit of aerial perspective, every dune face turning
      // away from the sun, every bit of modelling in the highlights was being
      // compressed into nothing. Exposure now leaves the ground lower on the
      // curve and the contrast is put back HERE, where it can be shaped.

      // black point: something in the frame has to actually be black
      col = max(col - uBlack, 0.0) / (1.0 - uBlack);

      // filmic S about the midtones. smoothstep is a hermite S — steeper in
      // the middle, gentle at both ends — so it adds bite without clipping.
      col = mix(col, col * col * (3.0 - 2.0 * col), uCurve);
      col = (col - 0.5) * uContrast + 0.5;

      /**
       * THE GAIN ROLLS OFF INTO THE HIGHLIGHTS, and the blue lightsaber that
       * came out YELLOW is why.
       *
       * A channel gain is a tint, and a tint applied at full strength to a
       * pixel that is already at the top of the curve does not tint it — it
       * REPLACES its hue, because the three channels are all near 1 and their
       * ratios are whatever the gain says. The Ember Shelf grades
       * [1.13, 1.00, 0.74], which is correct for a world lit by fire and is
       * catastrophic for the one object in that world making its own light:
       * measured in this shader's own arithmetic, a Cerulean blade core came
       * out 147 degrees off its crystal — blue in, yellow out. Amethyst went
       * 139 the other way. The coloured lobe around the core, which is dimmer,
       * only moved 56, which is why the halo stayed blue while the blade in
       * the middle of it did not.
       *
       * Rolling the gain toward neutral as luma approaches white is what film
       * does and what the saturation term two lines down ALREADY does, on this
       * same ramp. It was simply the one operator that had no shoulder. After
       * it, every level's core sits within 26 degrees of its crystal, which is
       * the ACES shoulder alone and is the same on all seven.
       *
       * The ramp is driven by luma BEFORE the gain — the whole point is to
       * decide how much tint a pixel can take from how bright it already is,
       * and a luma read afterwards has the tint in it.
       */
      float preLuma = dot(col, vec3(0.2126,0.7152,0.0722));
      float tintable = 1.0 - smoothstep(0.62, 1.0, preLuma);
      col = col * mix(vec3(1.0), uGain, tintable) + uLift * tintable;

      float luma = dot(col, vec3(0.2126,0.7152,0.0722));
      // Split tone. Daylight is two lights — a warm sun and a cold sky — and
      // separating them by colour as well as by value is most of why a
      // photographed frame reads as lit rather than shaded.
      col *= mix(uShadowTint, uHighTint, smoothstep(0.12, 0.72, luma));
      // Film desaturates as it approaches white; digital does not, which is
      // what makes bright CG look like paint.
      col = mix(vec3(luma), col, uSaturation * mix(1.0, 0.70, smoothstep(0.62, 1.0, luma)));

      // — Force Sense: cool, desaturated, silvered highlights
      if(uSense > 0.001){
        vec3 sense = mix(vec3(luma), col, 0.34);
        sense *= vec3(0.82, 0.94, 1.22);
        sense += pow(max(luma-0.55,0.0), 1.6) * vec3(0.35,0.5,0.75);
        col = mix(col, sense, uSense);
      }

      // — damage
      if(uHurt > 0.001){
        col = mix(col, col*vec3(1.5,0.28,0.3), uHurt*0.5);
      }
      col += uFlash;

      // — THE COLOUR GOING OUT OF IT. Before the vignette, so a drained frame
      //   still darkens at its edges rather than going flat grey to the corner.
      if(uDrain > 0.001){
        float dl = dot(col, vec3(0.2126,0.7152,0.0722));
        // Not a straight mix to luma: a drained frame also loses its highlights,
        // which is what stops it reading as a black-and-white photograph and
        // starts it reading as consciousness leaving.
        col = mix(col, vec3(dl) * mix(1.0, 0.72, uDrain), uDrain);
      }

      // — vignette. The composition (uVignette) and the EVENT (uPunch) are one
      //   operator here and two numbers everywhere else, so a kill can squeeze
      //   the frame without moving the level's own grade.
      vec2 vc = centred * vec2(uResolution.x / uResolution.y, 1.0);
      float r2v = dot(vc, vc) * 1.6;
      float vig = 1.0 - (uVignette + uPunch * 0.55) * smoothstep(0.16, 0.86, r2v);
      col *= vig;
      // …and the middle gets harder for the same sixth of a second. Pivoted on
      // 0.36 rather than 0.5 so the punch bites in the mid-tones the fight
      // actually lives in and cannot blow the sky.
      if(uPunch > 0.001){
        col = mix(col, (col - 0.36) * (1.0 + uPunch * 0.30) + 0.36,
                  1.0 - smoothstep(0.0, 0.9, r2v));
      }

      // — letterbox, drawn inside the grade so the bars are the frame's own black
      if(uBars > 0.0005){
        float edge = min(vUv.y, 1.0 - vUv.y);
        col *= smoothstep(uBars - 0.004, uBars + 0.004, edge);
      }

      // — grain, gently animated, scaled by darkness so highlights stay clean
      float g = hash(gl_FragCoord.xy + fract(uTime)*vec2(311.0,271.0)) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.15, 0.95, luma));
      // The grain above is deliberately absent in the highlights, which is
      // exactly where an 8-bit framebuffer bands — the sky was stepping. A
      // triangular dither of one LSB underneath fixes it and is invisible.
      col += (hash(gl_FragCoord.xy + 17.0) - hash(gl_FragCoord.xy + 71.0)) * (1.0/255.0);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ══════════════════════════════════════════════════════════════════════ */

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY[quality] ? quality : 'high';
    const q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    // NB: three's `fov` is VERTICAL. 78 vertical at 16:9 is 111 horizontal —
    // fisheye, which stretched everything at the edges and pushed more of the
    // frame into the region where vignette and aberration are strongest.
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.15, q.viewDist);
    this.scene.add(this.camera);

    this.resolutionScale = 1;
    // The shared aerial-perspective uniforms, reachable from the instance so
    // they can be inspected and driven from a console or a harness.
    this.aerial = AERIAL;
    this._setupLights();
    this._setupComposer();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.heatSources = [];
    /**
     * THE FIXED POINT-LIGHT POOL. See `lightUp` for why it is fixed.
     *
     * EIGHT, and the number is derived rather than felt. `_crowd.mjs` measures
     * an empty colosseum at 2 lights and thirty saber users at 64; the shading
     * cost of a forward frame is linear in this number and the recompile
     * hazard is the number CHANGING. Eight is the most a scene can carry
     * without the per-fragment loop dominating at this project's material
     * count (465 materials with thirty bodies on the field), and it is enough
     * that the player's own blade, an opponent's, and half a dozen of the
     * nearest others are all real lights. Everything past that still glows —
     * the drawn blade does 88% of the visible work without its lights at all,
     * which is measured in Saber.js.
     *
     * They live in the scene from construction and are never added or removed,
     * so NUM_POINT_LIGHTS is a constant for the life of the renderer.
     */
    this.lightPool = [];
    this._lightReq = [];
    this._lightsWanted = 0;
    this._lightsLit = 0;
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 7, 1);
      L.castShadow = false;
      this.scene.add(L);
      this.lightPool.push(L);
    }
    this._flash = 0;
    this._hurt = 0;
    this._sense = 0;
    this._radial = 0;
    /* The event punch decays on its own; the drain and the bars are held at a
     * target until something lets go of them, because a death is a state and
     * not an impulse. */
    this._punch = 0;
    this._drain = 0; this._drainTarget = 0;
    this._bars = 0; this._barsTarget = 0;
    /** Wall-clock ms the pad is busy until — see rumble(). */
    this._rumbleUntil = 0;
    /**
     * How hard the pad is allowed to be driven, 0..1. One number rather than a
     * boolean so the same seam serves "off" and "less", and it is a MULTIPLIER
     * on every call — a caller never has to know the setting. Written by the
     * feel funnel; 1 until something says otherwise.
     */
    this.rumbleLevel = 1;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _setupLights() {
    /* THE SUN IS THREE LIGHTS. See CASCADE_SPLIT: only `cascades[0]` — which is
     * `this.sun`, so every caller that reaches for the sun's colour, intensity
     * or direction still finds it — carries any light at all. The other two are
     * black and exist only to own a shadow map for the middle and far bands.
     *
     * They are added consecutively and before anything else that could cast,
     * because three sorts shadow-casting lights first and is otherwise stable,
     * so `directionalShadowMap[0..2]` is near, middle, far in that order — which
     * is the assumption saberCascadeShadow() is built on. */
    this.cascades = [];
    for (let i = 0; i < CASCADE_SPLIT.length; i++) {
      const L = new THREE.DirectionalLight(i === 0 ? 0xfff0d8 : 0x000000, i === 0 ? 3.6 : 0);
      L.castShadow = true;
      L.shadow.mapSize.set(QUALITY[this.quality].shadow, QUALITY[this.quality].shadow);
      // Ortho shadow depth is linear, so -0.0006 NDC over a 250-unit frustum was
      // ~7.5cm of world bias — feet detached from their own shadows. This one
      // scales with the cascade for free: it is applied in the [0,1] depth of
      // that cascade's own camera, whose range is 4.2 × its radius.
      L.shadow.bias = -0.00015;
      // NORMAL BIAS BARELY MOVES WITH THE CASCADE, and that is measured, not
      // conservative. The terrain's self-shadow at these sun angles lives
      // inside a ~15 cm depth window (see Terrain._buildMesh), so a normal
      // offset big enough to matter for acne on the coarse maps erases exactly
      // the shadows it is there to clean up. Scaled with the texel — 0.02 /
      // 0.064 / 0.108 for the three boxes — the dune sea's ground came out
      // 5–7% BRIGHTER between 20 and 70 m in a measured frame, which is the
      // whole of its own modelling gone. These three stay inside a quarter of
      // that window; the depth bias above is what grows with the box.
      L.shadow.normalBias = 0.02 * (1 + i * 0.375);
      L.shadow.camera.near = 0.5;
      L.shadow.camera.far = 260;
      // `radius` used to do NOTHING — three's PCF_SOFT path never reads it —
      // and the rig's whole penumbra was therefore one shadow-map texel wide.
      // It is the penumbra SLOPE now (see saberSoftShadow), and fitShadows
      // rewrites it every frame from the source's angular size and the box it
      // belongs to. Seeded at 0, which clamps to one texel — exactly the old
      // hard edge — so a frame taken before anything has moved degrades to what
      // shipped rather than to "maximally soft".
      L.shadow.radius = 0;
      this.scene.add(L);
      this.scene.add(L.target);
      this.cascades.push(L);
    }
    this.sun = this.cascades[0];

    // Was 0.85, which alone put a shadowed pixel at over half the brightness of
    // a lit one. Sun and sky IBL do the lighting now; this is only a floor.
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x60482e, 0.30);
    this.scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x9fc4ff, 0.45);
    this.fill.position.set(-1, 0.6, -0.8);
    this.scene.add(this.fill);

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this._linearSky();
    this.scene.add(this.sky);
    // Clouds and a distant skyline, composited over the Preetham gradient. One
    // draw call, and it is most of what stops the world reading as a diorama.
    this.skyDome = new SkyDome(this.scene);

    // The lower half of the environment probe. Baking the sky alone leaves the
    // ground hemisphere filled with whatever Preetham returns below the horizon
    // — a flat wash with none of the level's own colour in it — so every
    // upward-facing crevice and every underside is lit by the wrong thing. A
    // sunlit desert throws a great deal of warm light back up; this is it.
    //
    // AND IT HAS NEVER RENDERED. PMREMGenerator.fromScene defaults its cube
    // camera to near 0.1 / far 100 and this was scaled to 4000, so every one of
    // its vertices sat past the far plane and every triangle was clipped: the
    // probe has been pure sky since the day it was written, and the sky was
    // then desaturated by 40% to stand in for the term that was missing (see
    // PROBE_CHROMA). BOUNCE_RADIUS is inside that far plane with room to
    // spare, and the dome is drawn from its own centre so its radius means
    // nothing else.
    this._bounce = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: 0x6b543a, side: THREE.BackSide, fog: false, toneMapped: false }));
    this._bounce.scale.setScalar(BOUNCE_RADIUS);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /**
   * three's Preetham sky ends with `pow(texColor, 1/2.4)` — a display transform
   * baked into a value this renderer then treats as linear radiance. Measured
   * on the dune atmosphere the real sky runs 0.23 at the zenith to 21.7 in the
   * glow beside the sun; that pow returns 0.52 … 3.60. A hundred to one becomes
   * seven to one, and after exposure and ACES the entire sky lands inside fifty
   * 8-bit values. That is not a stylistic choice, it is a unit error, and it is
   * why the sky was a flat card, why the sun never bloomed, and why the image
   * based light baked out of it carried no direction at all.
   *
   * Undo it. The disc has to be clamped on the way out: Preetham's solar term
   * reaches ~7e5, and the scene target is half-float, where anything past 65504
   * is Infinity and takes bloom to NaN with it.
   */
  _linearSky() {
    const m = this.sky.material;
    const grade = 'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );';
    const disc = 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;';
    const size = 'float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );';
    if (m.fragmentShader.indexOf(grade) < 0 || m.fragmentShader.indexOf(disc) < 0
        || m.fragmentShader.indexOf(size) < 0) {
      console.warn('SABER: Sky shader changed shape — sky is still display-referred');
      this.skyLinear = false;
      return;
    }
    m.uniforms.uSkyScale = { value: 1 };
    // Knee and ceiling for the sky's own soft shoulder — the DRAWN pair, see
    // skyDisplayShoulder, re-derived per level in applyAtmosphere because it
    // tracks the metered exposure. refreshEnvironment lifts these to
    // SKY_PHYSICAL for the duration of the probe bake so the light the world
    // is lit by keeps the full hundred-to-one the model actually produces.
    this.skyDisplay = skyDisplayShoulder({});
    m.uniforms.uSkyKnee = { value: this.skyDisplay.knee };
    m.uniforms.uSkyCeil = { value: this.skyDisplay.ceil };
    // The disc, separated out so it is not compressed along with the aureole
    // it sits in — it is the one thing in the sky that SHOULD read as a hole
    // punched through the exposure, and the one thing that should still bloom.
    // Scaled with the drawn ceiling in applyAtmosphere: a fixed 34 against a
    // sky that used to reach 9.5 was a 3.6:1 highlight, and against the 1.06
    // the arena draws now it is 32:1, which is far enough past UnrealBloomPass's
    // mip chain to leave a vertical smear up the frame instead of a halo.
    m.uniforms.uSkyDisc = { value: new THREE.Vector3(34, 32, 29) };
    m.uniforms.uSkyDiscCos = { value: new THREE.Vector2(0.99993, 0.99998) };
    // Only ever anything but 1 while the environment probe is being baked, see
    // refreshEnvironment.
    m.uniforms.uSkySat = { value: 1 };
    m.fragmentShader = ([
      /* THE SKY IS FLAT, OR ONE SIMPLE GRADIENT — rule 7 of
       * src/toon/REFERENCE.md, and the single thing the player named first
       * ("especially the ground/grass/sky").
       *
       * The Preetham model is a smooth two-dimensional radiance field and no
       * amount of work on the ground will stop a photographic sky reading as
       * photographic. Banding it into SKY_BANDS plateaus turns it into a set of
       * concentric colour fields around the sun — which is what every one of
       * the reference frames has, and what a painted backdrop is.
       *
       * The bands are cut BEFORE the sun's disc is added, so the disc stays the
       * one hole punched through the exposure and keeps its halo. And they are
       * cut on the shouldered value, i.e. on what is actually drawn, so the
       * count on screen is the count here rather than whatever survives the
       * tone curve.
       *
       * `saberCelBand` is pasted in rather than reached through <common>: this
       * shader is three's Sky addon and includes only the tone-mapping chunks. */
      CEL_BAND_GLSL,
      'uniform float uSkyScale, uSkyKnee, uSkyCeil, uSkySat;',
      'uniform vec3 uSkyDisc;',
      'uniform vec2 uSkyDiscCos;',
      // Reciprocal shoulder: identity below the knee, asymptotic to the ceiling
      // above it, and — unlike the exponential this replaces — still separating
      // decades past it. Keeps the horizon glow bright without letting it
      // become a flat white plate. Must stay identical to skyShoulder() above.
      'vec3 skyShoulder( vec3 c ) {',
      '  vec3 over = max( c - uSkyKnee, 0.0 );',
      '  float span = max( uSkyCeil - uSkyKnee, 0.001 );',
      '  return min( c, vec3( uSkyKnee ) ) + span * over / ( over + span );',
      '}',
      m.fragmentShader,
    ].join('\n'))
      .replace(size, 'float sundisk = smoothstep( uSkyDiscCos.x, uSkyDiscCos.y, cosTheta );')
      .replace(disc, '')
      .replace(grade, [
        `vec3 retColor = saberCelBand( skyShoulder( texColor * uSkyScale ), ${SKY_BANDS.toFixed(1)} )`
          + ' + uSkyDisc * sundisk;',
        'retColor = mix( vec3( dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), retColor, uSkySat );',
      ].join('\n'));
    m.needsUpdate = true;
    this.skyLinear = true;
  }

  /** Configure sky + sun + fog for a level mood. */
  applyAtmosphere(a) {
    const u = this.sky.material.uniforms;
    u.turbidity.value = a.turbidity ?? 6;
    u.rayleigh.value = a.rayleigh ?? 2.2;
    u.mieCoefficient.value = a.mie ?? 0.008;
    u.mieDirectionalG.value = a.mieG ?? 0.82;

    const phi = THREE.MathUtils.degToRad(90 - (a.elevation ?? 22));
    const theta = THREE.MathUtils.degToRad(a.azimuth ?? 140);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunPos);
    this.sunDir = sunPos.clone();

    // Every cascade points the same way; only the first one is a light. Their
    // positions are overwritten by fitShadows on the first frame, but a level
    // that is measured before anything moves still needs them somewhere sane.
    for (const L of this.cascades) L.position.copy(sunPos).multiplyScalar(90);
    this.sun.color.set(a.sunColor ?? 0xfff0d8);
    this.sun.intensity = a.sunIntensity ?? 3.6;
    // How wide the thing casting the shadows is, in degrees, in clear air. See
    // SUN_DISC_DEG / AUREOLE_DEG; fitShadows turns it into a filter width.
    this._sourceDeg = SUN_DISC_DEG
      + AUREOLE_DEG * clamp(((a.turbidity ?? 6) - 2) / 10, 0, 1);
    // The authored key, kept so fitShadows can see how much of it the weather
    // has taken. Scenery dims `sun.intensity` during a front and Engine has no
    // other way to know a front is happening — and it should not import one:
    // the fraction of the beam that has been scattered out IS the quantity that
    // sets how big the source has become, so the number the engine can already
    // see is the right one to read.
    this._sunKey = a.sunIntensity ?? 3.6;
    this.hemi.color.set(a.skyColor ?? 0xbcd8ff);
    this.hemi.groundColor.set(a.groundColor ?? 0x60482e);
    // The probe is doing this job properly now, so the hand-rolled hemisphere
    // is trimmed to a floor rather than run alongside it at full strength.
    this.hemi.intensity = (a.ambient ?? 0.85) * (this.skyLinear && a.sky !== false ? HEMI_TRIM : 1);
    /* THE FILL IS A SHAPING LIGHT, NOT A SECOND SKY.
     *
     * It is the one shade term a level authors outright, and for one round it
     * was authored as "a real skylight" on the reasoning that the probe is an
     * average over the hemisphere and so cannot make a face turning toward the
     * open sky get bluer for it. That is not what the probe does. Three's
     * `getIBLIrradiance` samples the diffuse convolution ALONG THE NORMAL, so
     * the probe is directional already — measured GL-free on the arena, its
     * irradiance runs 0.053 lum / B/R 0.30 straight down to 0.964 / B/R 1.94
     * toward the sun and 0.293 / B/R 4.34 toward the open sky. Eighteen to one
     * in level, fourteen to one in chroma. The fill was therefore a SECOND COPY
     * of the probe's own directional sky term, and it was laid on at B/R 5.05,
     * bluer than the probe's open-sky sample it was standing in for.
     *
     * What it is actually for is the one thing the probe cannot do: the probe
     * is unoccluded and unshadowed, so it has no local falloff, and max(N·L,0)
     * is what puts a terminator on a shoulder. That job wants LUMINANCE. On a
     * backlit figure, sweeping the two knobs apart:
     *
     *   intensity 0 → 0.66   luminance σ across the silhouette 0.050 → 0.080
     *   chroma  ×1 → ×0.3    saturation 0.568 → 0.318, σ unmoved at 0.073
     *
     * — so a level buys form with intensity and buys nothing but saturation
     * with chroma. Levels.js authors accordingly: intensity untouched, chroma
     * scaled about the colour's own luminance so the light meter cannot move.
     *
     * There is NO derived ceiling on the chroma and one was tried. "The fill
     * may not be more chromatic than the shade it joins" is a good-sounding
     * rule that the measurements refuse: shipped, the amount each level's fill
     * raised its own shade's B/R was dunes ×1.247, arena ×1.120, canyon ×1.239
     * — and the canyon is the level that looked right. The correction is per
     * level and has to be measured per level; lighting.mjs pins only what
     * survives without a threshold (see "one authored skylight cannot stand for
     * three different skies").
     *
     * Sky bounce from the shadow side. Pinned to a fixed direction it was
     * nearly co-directional with the arena's sun (doing nothing) and opposed to
     * the canyon's (fighting it).
     */
    this.fill.color.set(a.fillColor ?? 0x9fc4ff);
    this.fill.intensity = a.fillIntensity ?? 0.25;
    this.fill.position.copy(sunPos).multiplyScalar(-1).setY(0.5).normalize().multiplyScalar(60);
    this.sky.visible = a.sky !== false;

    const sunI = a.sunIntensity ?? 3.6;
    const outdoor = a.sky !== false;
    // Everything about level, ambient budget and exposure comes off the meter.
    const meter = atmosphereMeter(a);
    this.meter = meter;

    // What the sky is doing at the skyline, away from the sun and toward it,
    // and what it is throwing down on everything the sun cannot reach.
    // Everything about distance and everything about shade derives from these.
    const side = _v1.copy(sunPos).setY(0).normalize().cross(_v2.set(0, 1, 0)).setY(0.02).normalize();
    const flat = _v2.copy(sunPos).setY(0.03).normalize();
    // Which shoulder a sample is read through depends on what the answer is
    // FOR, and getting that backwards costs you the effect either way:
    //
    //   · what distance CONVERGES ON has to be what the dome actually draws,
    //     or the far ground comes out brighter than the sky standing over it.
    //     The fog was anchored to the physical skyline at linear 3.19 while
    //     that same skyline drew at 1.50. hazeRadiance does that job.
    //   · the sunward glow's COLOUR and STRENGTH are properties of the air, and
    //     come off the physical pair below. Read through the display shoulder
    //     the two skyline samples sit within half a per cent of the same
    //     ceiling in every channel — the sunward tint measured (1.000, 1.000,
    //     1.000), dead neutral, and the strength measured 0.07 where the air
    //     actually carries 4.59. That is the whole sunset colour of the haze
    //     compressed out of existence by a curve with no business setting it.
    const disp = this.skyDisplay = skyDisplayShoulder(a, meter);
    const skyU = this.sky.material.uniforms;
    if (skyU.uSkyKnee) {
      skyU.uSkyKnee.value = disp.knee; skyU.uSkyCeil.value = disp.ceil;
      // Nine times the brightest sky: five stops over, so it is unambiguously a
      // blown highlight and blooms into a halo, without the 32:1 that streaks.
      skyU.uSkyDisc.value.set(disp.ceil * 9.0, disp.ceil * 8.5, disp.ceil * 7.7);
    }
    const hazeSun = skyShoulder(skyRadiance(flat, sunPos, a, _c3));
    const glowSide = lum(skyShoulder(skyRadiance(side, sunPos, a, _c2)));
    const glowSun = lum(hazeSun);
    const light = cloudLight(a, meter);

    this.skyDome.configure(a);
    this.skyDome.setSun(sunPos);
    this.skyDome.setRadiance(this.skyLinear ? 0.95 : 1, light.sun, light.tint, light.amb);

    if (a.fog !== false) {
      // Haze is LIT, and it is lit by the sky it is part of — see hazeRadiance,
      // which is where that derivation lives so the checks can assert on the
      // engine's own arithmetic rather than on a copy of it.
      const fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
      hazeRadiance(a, fog.color, disp);
      this.scene.fog = fog;
      this.skyDome.setHaze(fog.color, _c1.set(a.horizonColor ?? 0x6d6152)
        .multiplyScalar(clamp(sunI * Math.max(0.12, sunPos.y) / Math.PI, 0.05, 8)));
      // And the ink stops where sight does — see OutlinePass.setHaze. Without
      // this the outline pass rules a hard black line along the far rim of the
      // heightfield, which is the edge of the world and the one thing every
      // level's fog is authored to hide.
      this.outline?.setHaze(fog.density);
    } else { this.scene.fog = null; this.outline?.setHaze(0); }

    /* ── THE LINE IS THE LEVEL'S OWN DARKEST NOTE ──────────────────────────
     *
     * Rule 5 of src/toon/REFERENCE.md — one hue family per scene — and rule 4,
     * which is explicit that the ink is "dark brown or charcoal rather than
     * black". A single ink colour across seven levels breaks both: pure black
     * on a coral butte reads as a hole punched in it, and a warm brown line on
     * snow reads as dirt.
     *
     * It is DERIVED rather than authored, because there is exactly one right
     * answer available and no level should have to remember to pick it. Every
     * level already states the colour of the light its own ground throws back
     * up — `groundColor`, the hemisphere's lower half and the probe's bounce
     * hemisphere — and that is the scene's warm/cool axis stated once. Driven
     * driven down to a fixed linear luminance of 0.021 — sRGB 40/255, dark
     * enough to read as a drawn line on every ground in the game and never
     * black — it is precisely the dark chromatic neutral the reference inks in:
     *
     *     dune sea   #332515  warm brown       white pass  #23282f  blue charcoal
     *     arena      #312618  warm brown       meadow      #26282d  cool grey
     *     canyon     #31261b  warm brown       hangar      #232830  blue charcoal
     *
     * Written straight to the pass without an sRGB→linear conversion, because
     * the ink is composited after the tone curve — see OutlinePass.setColor. */
    if (this.outline) {
      const g = _c1.set(a.groundColor ?? 0x60482e);
      // linear → the sRGB byte the pass mixes with, at a fixed low value
      const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92
        : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
      const k = 0.021 / Math.max(lum(g), 1e-4);
      this.outline.setColor((enc(g.r * k) << 16) | (enc(g.g * k) << 8) | enc(g.b * k));
    }
    this.scene.background = a.sky === false ? new THREE.Color(a.bgColor ?? 0x0b0e14) : null;

    // Aerial perspective. Interiors get neither term — a hangar has no sun to
    // scatter and no gravity well of haze to stratify, and faking either there
    // reads immediately as a bug.
    AERIAL.shape.x = outdoor ? 1 / (a.fogHeight ?? 38) : 0;
    AERIAL.shape.y = a.fogBase ?? 0;
    AERIAL.shape.w = 1;
    AERIAL.sun.x = sunPos.x; AERIAL.sun.y = sunPos.y; AERIAL.sun.z = sunPos.z;
    // How much brighter the skyline gets as it swings toward the sun, spread
    // over the phase lobe. Straight out of the model rather than a taste knob,
    // and off the PHYSICAL sky — the drawn one has this gradient compressed
    // out of it by design, and reading it there would silently switch the
    // sunward haze off. The chunk energy-limits what this can actually add.
    const gain = clamp(glowSun - glowSide, 0, 12);
    AERIAL.sun.w = outdoor ? (a.inscatter ?? gain * 0.028) : 0;
    const sl = Math.max(0.02, lum(hazeSun));
    AERIAL.tint.x = hazeSun.r / sl; AERIAL.tint.y = hazeSun.g / sl; AERIAL.tint.z = hazeSun.b / sl;
    AERIAL.tint.w = 0.50;

    this._envI = this.skyLinear ? meter.envI : 0.30;
    this.renderer.toneMappingExposure = this.skyLinear
      ? meter.exposure : (a.exposure ?? 1.05);
    this.composite.uniforms.uLift.value.set(...(a.lift ?? [0.004, 0.006, 0.012]));
    this.composite.uniforms.uGain.value.set(...(a.gain ?? [1.02, 1.0, 0.98]));
    this.composite.uniforms.uSaturation.value = a.saturation ?? 1.06;
    this.bloom.strength = (a.bloom ?? BLOOM.fallback) * BLOOM.trim;

    // What the ground throws back up, for the probe: albedo × the irradiance
    // actually landing on it. A 26° sun over pale sand is a genuine second
    // light source and it is the only thing that puts colour under a chin.
    //
    // The irradiance is the METER's, not `sunI * sunY`: the sun is not the only
    // thing lighting the ground, and now that the indirect budget moves with the
    // sun's height (diffuseCap) a bounce keyed to the beam alone would drift
    // away from the ground it is meant to be a reflection of.
    this._bounce.material.color.set(a.groundColor ?? 0x60482e)
      .multiplyScalar(clamp(meter.irradiance / Math.PI, 0.02, 6));
    this.refreshEnvironment();
  }

  /** Bake the current sky into an IBL probe. */
  refreshEnvironment() {
    if (this._envRT) this._envRT.dispose();
    const tmp = new THREE.Scene();
    const skyClone = this.sky.clone();
    if (this.scene.background instanceof THREE.Color) tmp.background = this.scene.background;
    if (this.sky.visible) { tmp.add(skyClone); tmp.add(this._bounce); }
    else tmp.background = new THREE.Color(0x11151d);
    // See PROBE_CHROMA. The sky goes in at its own chroma now; the bounce
    // hemisphere above is what carries the warm, desaturated half, and it is
    // in the bake for the first time.
    const sat = this.sky.material.uniforms.uSkySat;
    if (sat) sat.value = PROBE_CHROMA;
    // And bake from the PHYSICAL sky, not the drawn one. The drawn dome is
    // soft-clipped at 1.55 so it cannot feed the bloom pass (see SKY_DISPLAY);
    // baking the probe from that would quietly re-flatten the image-based
    // light — a horizon only twice the zenith carries no direction, which is
    // the exact fault _linearSky was written to fix. Mesh.clone shares the
    // material, so moving the uniforms here moves the clone too.
    const knee = this.sky.material.uniforms.uSkyKnee, ceil = this.sky.material.uniforms.uSkyCeil;
    if (knee) { knee.value = SKY_PHYSICAL.knee; ceil.value = SKY_PHYSICAL.ceil; }
    this._envRT = this.pmrem.fromScene(tmp, 0.04, 0.1, PMREM_FAR);
    if (knee) { knee.value = this.skyDisplay.knee; ceil.value = this.skyDisplay.ceil; }
    if (sat) sat.value = 1;
    this.scene.environment = this._envRT.texture;
    // With the sky linearised the probe is in the same units as the sun, so
    // this is 1.0 — the physical answer — instead of a fudge factor cancelling
    // a gamma curve. The hemisphere light below is trimmed to match: the probe
    // now does the job it was faking, and running both at full strength put a
    // shadowed pixel at over half the brightness of a lit one, which is why
    // nothing had shape and there was nothing dark for a blade to glow against.
    this.scene.environmentIntensity = this._envI ?? (this.skyLinear ? ENV_INTENSITY : 0.30);
  }

  _setupComposer() {
    const q = QUALITY[this.quality];
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: THREE.HalfFloatType,
      samples: q.msaa,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Threshold is in LINEAR HDR, and the Preetham sky sits at 0.7-1.5 there — at
    // 0.92 the sky bloomed harder than the lightsaber did, which is the milky
    // smear across the top of every outdoor frame. Above 1.8 only the blade,
    // bolts and molten cuts qualify. It stays at 1.8 and the trim went on the
    // STRENGTH instead: nothing in a snow level's ground ever reaches 1.8 to
    // begin with (see BLOOM), and lifting the line would take the blade's glow
    // lobe with it and leave a bloom with no crystal left in it.
    //
    // The three numbers are BLOOM.fallback × BLOOM.trim, BLOOM.radius and
    // BLOOM.threshold, spelled out as literals rather than read off the table:
    // tools/checks/saber-light.mjs and tools/checks/order.mjs both learn the
    // bloom threshold by matching this line, so it has to stay a line with
    // numbers in it. tools/checks/saber-bloom.mjs pins the two forms equal.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3024, 0.55, 1.8);
    this.composer.addPass(this.bloom);
    // Always on. Sampling costs a few microseconds, and a profiler you have to
    // remember to enable is off at the exact moment the stutter happens.
    this.profiler = new Profiler(this.renderer);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    /* THE INK GOES AFTER THE TONE CURVE. See src/toon/Ink.js — the line colour
     * is an authored sRGB value and this is the first point in the chain where
     * writing one means it survives to the screen. It is also after the bloom,
     * because a drawn line that glows is not a drawn line. */
    this.outline = new OutlinePass(this.scene, this.camera, q.ink ?? 1);
    this.composer.addPass(this.outline);

    this.composite = new ShaderPass(CompositeShader);
    this.composite.material.uniforms.tNoise.value = noiseTexture(256);
    this.composite.material.uniforms.uHeat.value = Array.from({ length: 6 }, () => new THREE.Vector4());
    this.composite.renderToScreen = true;
    this.composer.addPass(this.composite);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return;
    this.quality = name;
    const q = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio) * this.resolutionScale);
    for (const L of this.cascades) {
      L.shadow.mapSize.set(q.shadow, q.shadow);
      if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; }
    }
    this.camera.far = q.viewDist;
    this.camera.updateProjectionMatrix();
    // The ink's prepass resolution is a tier property; resize() below is what
    // actually re-allocates its target.
    if (this.outline) this.outline.scale = q.ink ?? 1;
    this.resize();
  }

  setResolutionScale(s) {
    this.resolutionScale = clamp(s, 0.4, 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio) * this.resolutionScale);
    this.resize();
  }

  setBloom(on) { this.bloom.enabled = !!on; }

  /** 0..1 — how hard time is being bent. Drives the Focus grade. */
  setFocus(v) { this._focusTarget = v; }
  /**
   * The grain switch, now a PAPER TOOTH rather than film grain.
   *
   * 0.045 was sensor noise, and it is the wrong artefact for this frame (see
   * the uniform's note). But the setting exists, it defaults to on, and a
   * toggle that does nothing is worse than one that does the wrong thing — so
   * it does a third of what it did, which on flat colour fields reads as the
   * tooth of the paper rather than as a camera. Off is still exactly zero.
   */
  setGrain(on) { this.composite.uniforms.uGrain.value = on ? 0.014 : 0; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    // Must precede setSize: EffectComposer multiplies by its own stored ratio,
    // and a stale one leaves its targets smaller than the drawing buffer, so
    // the final full-screen quad upscales and the whole frame goes soft.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.composite.uniforms.uResolution.value.set(size.x, size.y);
    this.bloom.resolution.set(size.x, size.y);
  }

  /**
   * Keep the shadow frusta tight around the action — three nested boxes, near
   * to far, each centred on the slice of the view it is responsible for.
   *
   * TWO THINGS HERE ARE NOT DECORATION.
   *
   * The boxes are pushed FORWARD along the view, not centred on the player. A
   * box centred on the player spends half its texels behind the camera; pushed
   * out by 0.55 of its own radius it covers 1.55 radii of what is actually on
   * screen for the same texel size. That is where most of the far cascade's
   * reach comes from.
   *
   * And the snap is in LIGHT SPACE. The old one rounded world x and z, which is
   * only the texel grid if the light happens to look down a world axis — at the
   * arena's 248° bearing the grid is 32° off, so "snapped" positions still slid
   * the map by a fraction of a texel every frame and the shadow edges crawled.
   * Rounding along the shadow camera's own right/up vectors is what actually
   * pins them.
   */
  fitShadows(center) {
    const dir = this.sunDir || _fs[0].set(0.5, 0.8, 0.3);
    const boxes = cascadeBoxes(this.quality);
    /* HOW BIG THE SOURCE IS RIGHT NOW. In clear air it is the disc plus the
     * aureole; a front replaces it with the sky. The storm term is read off the
     * key the level authored versus the key the sun is actually carrying —
     * Scenery dims it during a front — so a shadow edge softens as the light
     * goes flat without either file knowing about the other.
     *
     * A full squall is half the beam gone (Scenery's sunLoss is 0.50), which
     * asks for a source near 31°. It does not get one: SABER_PENUMBRA_MAX caps
     * the filter at 14 texels and the storm runs into that cap on every level
     * whose sun is low enough to stretch the shadow. Measured, half the key
     * gone widens the implied source from 1.42° to 2.15° on the arena and from
     * 0.27° to 3.63° in the dojo — the direction is right and the magnitude is
     * bounded by the filter, not by the model. A wider cap needs more than
     * twelve taps to stay smooth; see saberSoftShadow. */
    const dim = clamp(1 - this.sun.intensity / Math.max(this._sunKey || 1e-3, 1e-3), 0, 1);
    const src = this._sourceDeg ?? SUN_DISC_DEG;
    const tanSrc = Math.tan(THREE.MathUtils.degToRad(src + (OVERCAST_DEG - src) * dim));
    // The view forward, flattened: a box that pitches with the camera would
    // swing its whole footprint every time the player looks at their feet.
    const fwd = _fs[1].set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
    for (let i = 0; i < this.cascades.length; i++) {
      const L = this.cascades[i], d = boxes[i].radius, texel = boxes[i].texel;
      const cam = L.shadow.camera;
      cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
      cam.near = 1; cam.far = d * 4.2;
      // The penumbra slope this cascade hands the shader: UV radius per unit of
      // normalised depth. Ortho depth is linear over [near, far] and the box is
      // 2d of UV across, so a blocker `z` metres in front of its receiver wants
      // z·tan(source) of world penumbra, which is that over 2d in UV, which is
      // this constant times the normalised depth the shader already has.
      L.shadow.radius = tanSrc * (cam.far - cam.near) / (2 * d);
      _fs[2].copy(center).addScaledVector(fwd, d * 0.55);
      // Light-space basis: the shadow camera looks down -dir with three's
      // default up, so right = up × dir and camUp = dir × right.
      _fs[3].set(0, 1, 0).cross(dir);
      if (_fs[3].lengthSq() < 1e-6) _fs[3].set(1, 0, 0); else _fs[3].normalize();
      _fs[4].copy(dir).cross(_fs[3]).normalize();
      const u = Math.round(_fs[2].dot(_fs[3]) / texel) * texel - _fs[2].dot(_fs[3]);
      const v = Math.round(_fs[2].dot(_fs[4]) / texel) * texel - _fs[2].dot(_fs[4]);
      _fs[2].addScaledVector(_fs[3], u).addScaledVector(_fs[4], v);
      L.target.position.copy(_fs[2]);
      L.position.copy(dir).multiplyScalar(d * 2.2).add(_fs[2]);
      L.target.updateMatrixWorld();
      cam.updateProjectionMatrix();
    }
  }

  addHeat(screenX, screenY, radius, strength) {
    if (this.heatSources.length < 6) this.heatSources.push([screenX, screenY, radius, strength]);
  }

  flash(v) { this._flash = Math.max(this._flash, v); }
  hurt(v) { this._hurt = Math.max(this._hurt, v); }
  setSense(v) { this._senseTarget = v; }
  setRadial(v) { this._radialTarget = v; }

  /**
   * The frame squeezing around something that just landed. 0..1, decays.
   *
   * `Math.max` for the same reason flash() and hurt() use it: two kills on one
   * frame are one punch at the strength of the bigger, not a doubled one.
   */
  punch(v) { this._punch = Math.max(this._punch, Math.min(1, num(v, 0))); }
  /** Hold the colour out of the frame, 0..1. A state — nothing decays it. */
  setDrain(v) { this._drainTarget = clamp(num(v, 0), 0, 1); }
  /** Letterbox bar height as a fraction of the frame. A state, like the drain. */
  setBars(v) { this._barsTarget = clamp(num(v, 0), 0, 0.2); }

  /**
   * RUMBLE, and it is here rather than in the input layer on purpose.
   *
   * Bindings own which pad the player is holding; this owns what the GAME does
   * to it, and the events worth feeling — a kill, a death, a detonation — are
   * raised in exactly the same breath as flash() and punch(). Putting it beside
   * them means one call site says the whole sentence.
   *
   * Everything about it is best-effort. Two vendor spellings of the same
   * feature exist (`vibrationActuator` on Chromium, `hapticActuators[]` on
   * Firefox), neither is present on a keyboard-only player, and `playEffect`
   * rejects on a pad that has gone away mid-frame — so every path ends in "no
   * rumble" and never in a thrown frame.
   *
   * A SHORTER EFFECT DOES NOT INTERRUPT A LONGER ONE. `playEffect` replaces
   * whatever is playing, so a wave of kills at 60 ms each would cut the 400 ms
   * of a boss going down back to 60. The wall-clock deadline is what stops it.
   *
   * @param strong 0..1 the low-frequency (heavy) motor
   * @param weak   0..1 the high-frequency (buzz) motor
   * @param ms     duration in milliseconds
   */
  rumble(strong = 0.4, weak = 0.2, ms = 90) {
    if (this.rumbleLevel <= 0) return false;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.getGamepads !== 'function') return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dur = clamp(num(ms, 90), 20, 1200);
    if (now < this._rumbleUntil) return false;
    const g = clamp(num(this.rumbleLevel, 1), 0, 1);
    const s = clamp(num(strong, 0) * g, 0, 1), w = clamp(num(weak, 0) * g, 0, 1);
    let sent = false;
    let pads = null;
    try { pads = nav.getGamepads(); } catch { return false; }
    for (const p of pads || []) {
      if (!p || !p.connected) continue;
      const act = p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]);
      if (!act || typeof act.playEffect !== 'function') continue;
      try {
        act.playEffect('dual-rumble', { startDelay: 0, duration: dur,
          strongMagnitude: s, weakMagnitude: w })?.catch?.(() => {});
        sent = true;
      } catch {}
    }
    if (sent) this._rumbleUntil = now + dur;
    return sent;
  }

  /**
   * THE LIGHT POOL — a FIXED number of point lights, whoever asks.
   *
   * Player note #15, and it is two complaints in one sentence: "any situation
   * where multiple characters with sabers are on the screen it gets really
   * really laggy AND FREEZES too", and "sometimes for fun I'll spawn like 30
   * enemies and then it gets really really laggy, framerate probably <10".
   *
   * Measured with tools/_crowd.mjs, thirty acolytes on the colosseum:
   *
   *     empty            2 lights
   *     30 alive        64 lights        ← two per lit saber, plus the sky pair
   *
   * Sixty-four dynamic point lights in a FORWARD renderer. Saber.js's own
   * comment already saw half of this — "every enemy in a wave carries one of
   * these, and NUM_POINT_LIGHTS is a per-fragment unrolled loop in every lit
   * material in the game" — and capped it at two per blade. Nothing capped the
   * number of BLADES.
   *
   * TWO SEPARATE COSTS, and the second is the one that explains "freezes":
   *
   *   · every lit fragment loops over every light, so the shading cost of the
   *     whole frame scales with how many people are holding a sabre;
   *   · three.js bakes NUM_POINT_LIGHTS into the shader SOURCE, so the count
   *     changing recompiles every lit material in the scene. A blade igniting,
   *     retracting, or a body dying mid-fight moves that count, and a compile
   *     of four hundred materials is a stall you feel as a freeze rather than
   *     as a frame rate.
   *
   * So the pool is FIXED SIZE and always in the scene. Nothing else may add a
   * point light: callers ask for illumination once a frame with `lightUp()`,
   * the best `POOL` requests win, and the losers still light the scene through
   * their own emissive geometry and the bloom — which is where most of a
   * lightsaber's apparent light comes from anyway (see the note over
   * Saber.PROFILE: the drawn blade with its lights switched off does 88% of
   * the work).
   *
   * The count therefore never changes, which means the recompile never
   * happens, which is the freeze gone by construction rather than by tuning.
   */
  lightUp(pos, color, intensity, range = 7, priority = 0) {
    if (!(intensity > 0)) return;
    this._lightReq.push({ pos, color, intensity, range, priority });
  }

  /** Rank the frame's requests and drive the fixed pool from the winners. */
  _syncLights() {
    const req = this._lightReq;
    const cam = this.camera.position;
    /* IMPORTANCE, not distance. A blade behind you lighting the wall you are
     * looking at matters more than a brighter one off screen, but the camera
     * is the only cheap proxy for "is this on screen", so the rank is the
     * request's own priority first (the local player's blade declares one) and
     * then its brightness attenuated by how far away it is. */
    for (const r of req) {
      r._score = r.priority * 1e6 + r.intensity / (1 + cam.distanceToSquared(r.pos) * 0.02);
    }
    req.sort((a, b) => b._score - a._score);
    for (let i = 0; i < this.lightPool.length; i++) {
      const L = this.lightPool[i], r = req[i];
      if (r) {
        L.position.copy(r.pos);
        L.color.set(r.color);
        L.intensity = r.intensity;
        L.distance = r.range;
      } else {
        // Parked, NOT removed: taking it out of the scene is the recompile.
        L.intensity = 0;
      }
    }
    this._lightsWanted = req.length;
    this._lightsLit = Math.min(req.length, this.lightPool.length);
    req.length = 0;
  }

  render(dt) {
    this._syncLights();
    const u = this.composite.uniforms;
    this.time += dt;
    u.uTime.value = this.time;
    this.skyDome?.update(dt, this.camera);

    this._flash = damp(this._flash, 0, 9, dt);
    this._hurt = damp(this._hurt, 0, 4.2, dt);
    this._sense = damp(this._sense, this._senseTarget || 0, 7, dt);
    this._radial = damp(this._radial, this._radialTarget || 0, 8, dt);
    // The punch is FAST — 6.4 puts a 0.5 punch under a tenth of its peak in
    // 0.36 s — because an event you can still see when the next one lands is a
    // filter and not an event. The drain and the bars are slow on purpose: they
    // are the two seconds after a death and they should be felt arriving.
    this._punch = damp(this._punch, 0, 6.4, dt);
    this._drain = damp(this._drain, this._drainTarget || 0, 1.9, dt);
    this._bars = damp(this._bars, this._barsTarget || 0, 3.4, dt);
    u.uFlash.value = this._flash;
    u.uHurt.value = this._hurt;
    u.uPunch.value = this._punch;
    u.uDrain.value = this._drain;
    u.uBars.value = this._bars;
    u.uSense.value = this._sense;
    // Focus reuses the Sense grade's cool desaturation at a fraction of its
    // strength, so the two read as the same family of ability.
    this._focus = damp(this._focus || 0, this._focusTarget || 0, 12, dt);
    if (this._focus > 0.002) u.uSense.value = Math.max(u.uSense.value, this._focus * 0.55);
    u.uRadial.value = this._radial;

    const heat = u.uHeat.value;
    for (let i = 0; i < 6; i++) {
      const h = this.heatSources[i];
      if (h) heat[i].set(h[0], h[1], h[2], h[3]); else heat[i].set(0, 0, 0, 0);
    }
    u.uHeatCount.value = Math.min(6, this.heatSources.length);
    this.heatSources.length = 0;

    this.renderer.info.reset();
    // The GPU query brackets the DRAW and nothing else. Wrapping the whole
    // frame would fold our own JS into it and report a number that is neither
    // CPU nor GPU time.
    this.profiler.beginDraw();
    // Normals and depth for the ink, before the composer takes the frame over.
    // Inside the profiler bracket because it is part of the frame's GPU cost
    // and a pass that does not show up in the profile is a pass nobody tunes.
    this.outline.prepass(this.renderer);
    /**
     * …AND PUBLISH ITS DEPTH, which is the whole of what soft particles cost.
     *
     * The prepass has just rasterised the scene with every transparent,
     * additive and alpha-tested material hidden (`cutsItsOwnSilhouette`), into
     * a target with a 24-bit DepthTexture on it. That is opaque-only depth,
     * finished, for THIS frame, before the composer draws a single particle —
     * so the sprites can be faded against it with no second target and no
     * second pass. `uRange.x/.y` is the near/far pair the prepass actually
     * used, and it is NOT the camera's: Ink narrows its own far plane to the
     * ink's reach, and linearising against the camera's frustum instead would
     * put the fade at the wrong distance by a factor of three on a foggy level.
     */
    const r = this.outline.uniforms.uRange.value;
    // The FRAME's size and not the prepass target's. `gl_FragCoord` in the
    // particle pass is in the composer's pixel space; the prepass may be at
    // half of that on the medium tier, and dividing by ITS size would sample
    // the depth buffer at uv up to 2.0 — the whole frame reading as empty sky
    // on exactly the tier most likely to need the help.
    const px = u.uResolution.value;
    setSceneDepth(this.outline.target?.depthTexture, r.x, r.y, px.x, px.y);
    this.composer.render(dt);
    this.profiler.endDraw();
  }

  dispose() {
    this.profiler?.dispose();
    this.skyDome?.dispose();
    this._bounce?.geometry.dispose();
    this._bounce?.material.dispose();
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.pmrem?.dispose();
    this._envRT?.dispose();
    this.renderer.dispose();
  }
}
