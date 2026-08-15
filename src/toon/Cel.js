/**
 * BATTLEFRONT BORZ — the cel render model.
 *
 * Read src/toon/REFERENCE.md first. This file is the eight rules in that
 * document turned into arithmetic.
 *
 * ── WHY THIS IS NOT A MATERIAL SWAP ────────────────────────────────────────
 *
 * The first attempt at this (src/toon/Toon.js, kept as the record of what was
 * learned) walked the scene and replaced MeshStandardMaterial with
 * MeshToonMaterial. It was rejected — "there will be PBR leftovers everywhere",
 * and there were, necessarily:
 *
 *   · a material with an `onBeforeCompile` cannot be swapped without throwing
 *     the extension away, so the terrain, the particles and the sign material
 *     all had to stay physical — i.e. the ground, which is 60% of the frame,
 *     kept its GGX lobe and its smooth Lambert falloff;
 *   · every hand-written ShaderMaterial (grass, water, sky dome, blade, motes,
 *     snow, haze, shimmer) was invisible to the sweep;
 *   · anything constructed AFTER the sweep — a severed limb, a fractured
 *     chunk, a prop spawned by a wave — came back physical;
 *   · MeshToonMaterial still runs a specular term and still zeroes the diffuse
 *     of a metal, so hilts and droid plate came out shiny or black.
 *
 * So this file does not touch materials at all. It rewrites the BRDF, once, in
 * three's own ShaderChunks — the same mechanism Engine.js already uses for
 * aerial perspective and cascaded shadows, and for the same reason: it reaches
 * every material in the game, including the ones that do not exist yet, and
 * including the ones with extensions of their own.
 *
 * There is no toggle. A gate would mean a material that failed to receive the
 * uniform silently rendered physical, which is precisely the failure mode being
 * fixed. The numbers below are exported so a check can transcribe them into JS
 * and measure both sides of the change without a GPU (the house pattern — see
 * tools/checks/terrain-aerial.mjs).
 *
 * ── THE FIVE CHANGES TO THE LIGHT TRANSPORT ───────────────────────────────
 *
 * 1. TWO TONES, HARD EDGE (rule 1). `saturate(dot(N,L))` becomes a step. Not a
 *    three-band ramp: a lit level and an AUTHORED SHADOW LEVEL, meeting over
 *    2.4% of the range. The shadow level is 0.30 of the key and arrives in the
 *    key's own colour — see CEL.shadowBand, which was zero and should not have
 *    been. A shadow left over from switching the sun off is the ambient's
 *    colour, and this rig's ambient is blue because the physical model expected
 *    the direct term to do the work; the frames came back with a near-black
 *    player character and a grey ball whose shadow side was saturated blue.
 *    In the reference frames the shadow tone is the SURFACE'S OWN COLOUR, one
 *    step deeper.
 *
 * 2. THE LIT LEVEL IS THE LIGHT'S OWN HORIZONTAL RESPONSE (see CEL_KEY below).
 *    This is the one number that is derived rather than chosen, and getting it
 *    wrong breaks the game's exposure metering.
 *
 * 3. NO SPECULAR ANYWHERE (rule 8). The GGX lobe, the sheen lobe and the
 *    environment reflection are deleted from the shader rather than driven to
 *    zero — a deleted term cannot come back, and the ALU comes back with it.
 *
 * 4. THE INDIRECT TERM IS FLAT (rule 1 again, by implication). A probe sampled
 *    along the normal is a smooth gradient over every curved surface, and a
 *    smooth gradient on top of two tones is three tones and a wash. The probe
 *    and the hemisphere are sampled along a FIXED direction instead, so the
 *    shadow side of everything is one flat colour — the sky's colour, which is
 *    what makes shadows read as coloured shapes rather than as darkness.
 *
 *    …and its CHROMA is trimmed, because that flat colour is now literally the
 *    colour of every shadow in the game and at full strength the canyon's blue
 *    fill repainted its coral cliffs. See saberCelAmbient. A light that owns no
 *    shadow map is part of this term rather than a second key — see
 *    saberCelShape, which is what keeps a surface at TWO tones rather than the
 *    four a sun terminator crossing a fill terminator would give it.
 *
 * 5. CAST SHADOWS ARE HARD (rule 2) AND LAND ON THE SAME TONE. The filter still
 *    runs — its 50% contour is a far better silhouette than a single tap, and it
 *    is what keeps acne out — but its output is stepped, so there is no penumbra
 *    anywhere. It is then carried into the tone as a mask (saberCelCast) rather
 *    than multiplied into the light's colour, so a fragment in a cast shadow
 *    lands on exactly the shadow band a fragment facing away lands on, and a
 *    cast shadow crossing a shadow face does not square it.
 *
 * And two changes to what surfaces ARE:
 *
 * 6. METALNESS NO LONGER ZEROES DIFFUSE. In three's physical model a metal has
 *    no diffuse colour at all; all of its appearance is the specular lobe. Kill
 *    specular without touching that and every hilt, every droid plate and every
 *    blast door renders BLACK. This is the single most dangerous PBR leftover
 *    in the file and it is fixed at the root: under a cel model a metal is a
 *    flat coloured surface like everything else.
 *
 * 7. ALBEDO IS POSTERISED (rule 6, in the shader half — the other half is the
 *    texture foundry). Value is quantised into CEL_ALBEDO_BANDS plateaus in a
 *    perceptual space and chroma is lifted, so a procedural map's variation
 *    collapses into flat fields with drawn boundaries instead of reading as
 *    photographic grain.
 */

/* ══════════════════════════════════════════════════════════════════════ */
/*  The constants                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every number the cel model runs on, in one object, because each one is
 * inlined into GLSL as a literal and a check has to be able to transcribe the
 * shader without copying the value.
 */
export const CEL = {
  /**
   * THE TERMINATOR, as a fraction of the lit level — and the ceiling on it.
   *
   * A fixed threshold on N·L cannot work in this game and the reason is
   * arithmetic. The ground is horizontal, so its N·L is sin(sun elevation):
   * 0.24 on the canyon's 14° sun, 0.37 on the meadow's 22°, 0.44 on the
   * arena's 26°. A terminator at the textbook 0.5 puts EVERY level's ground on
   * the dark side of its own two-tone — the entire landscape in shadow, at
   * noon. Measured that way once; it looks exactly like a bug.
   *
   * So the terminator is placed relative to the light's own horizontal
   * response: at 0.60 of it, the ground sits comfortably in the lit band on
   * every level in the game, and a surface has to be tilted more than 40% of
   * the way further from the sun than flat ground is before it turns. On a
   * sphere that puts the terminator arc between 8° and 10° off the geometric
   * limb, so a lit sphere reads a little over half lit — which is what the
   * mech in reference frame (1) does.
   *
   * The ceiling matters for point lights, whose key is 1.0 (see CEL_KEY).
   */
  terminatorRel: 0.60,
  terminatorMax: 0.20,

  /**
   * HALF-WIDTH OF THE STEP, in N·L.
   *
   * 0.012 is about a pixel and a half of gradient across a sphere a third of
   * the screen high, which is anti-aliasing rather than a ramp. Rule 1 is
   * explicit that the boundary is crisp and that widening it is the failure
   * being avoided; this exists only so the terminator does not crawl with
   * pixel-sized steps as a head turns.
   */
  edge: 0.012,

  /**
   * THE SHADOW BAND'S SHARE OF THE DIRECT TERM — THE SHADOW TONE, AUTHORED.
   *
   * This was 0.0, on the argument that the flat indirect term (CEL.flat) was
   * already the "never let the shadow side go black" lift and that a floor on
   * the direct term would be a soft second terminator. Both halves of that were
   * wrong and the frames said so:
   *
   *   IT IS NOT A GRADIENT. `mix( shadowBand, 1.0, s )` with s a step is a
   *   CONSTANT below the terminator, so the shadow side stays exactly one flat
   *   value — two tones, hard edge, rule 1 intact. There is no second
   *   terminator; there is a second LEVEL, which is the thing rule 1 asks for.
   *
   *   THE INDIRECT TERM IS NOT A SHADOW TONE. It is what is left over after the
   *   direct term is switched off, and this rig's indirect is a blue sky probe
   *   plus a blue fill because the physical model expected the sun to do the
   *   work. Measured on three probe spheres in the arena's own rig
   *   (.shots/probe-sphere.png), a mid-grey ball came out sRGB 0.679,0.640,0.637
   *   on its lit side and 0.143,0.272,0.528 on its shadow side: 2.46:1 in
   *   display, and a shadow whose SATURATION was 0.73 — the shadow side of a
   *   grey ball was saturated blue. The player character was a near-black
   *   silhouette in every frame for the same reason.
   *
   * Nothing in the four reference frames does that. "The coral butte's shadow
   * side is a slightly deeper coral, the mint mech's shadow panels are a deeper
   * mint" — the shadow is a COLOUR, and it is the surface's own colour. So the
   * shadow band is authored: a fixed share of the key, arriving in the KEY'S
   * OWN COLOUR (warm, 0xfff0d8), which both raises the level and dilutes the
   * blue ambient that was setting the hue.
   *
   * 0.30 is where the measurement lands: the lit:shadow ratio comes out between
   * 1.4:1 and 1.6:1 in display across all five outdoor levels, which is the
   * reference's own separation, and the shadow side of a grey ball reads grey.
   *
   * The LIT band is untouched — a lit surface still gets exactly `key`, which is
   * what flat ground gets under Lambert — so the exposure meter, the bloom
   * headroom and every lighting check are exactly where they were. This can only
   * ever raise a surface the sun does not reach.
   */
  shadowBand: 0.30,

  /**
   * HOW HARD THE INDIRECT TERM IS FLATTENED, 0 = three's directional probe,
   * 1 = one colour over the whole object.
   *
   * 1.0. Anything less leaves a smooth gradient across every curved surface,
   * and the whole argument of rule 1 is that a surface has two tones.
   *
   * What is lost is real and worth stating: an upward-facing plane and a
   * downward-facing one now receive the same ambient, so overhangs no longer
   * darken by themselves. The ambient occlusion in the baked maps and the
   * terrain's own cavity term still do that, and they do it as an albedo
   * rather than as a light, which is the drawn version of the same cue.
   *
   * AND ONE THING THAT WAS NOT NOTICED WHEN THIS WENT TO 1.0: the fixed
   * direction is world UP, so every lookup is the lookup an up-facing surface
   * would make, and an up-facing surface sees no ground. That silently zeroed
   * `hemi.groundColor` — three's hemisphere weight is `0.5·dotNL + 0.5`, and
   * with the light at its default (0,1,0) dotNL is exactly 1 — and it zeroed
   * the probe's `_bounce` hemisphere, which sits under the horizon where a
   * cosine lobe about +Y weights it at nothing. Both are authored per level and
   * both were unreachable. CEL.bounce is the answer; see saberCelBounce.
   */
  flat: 1.0,

  /** Albedo posterisation: plateaus in sqrt(luminance), and the chroma lift. */
  albedoBands: 5.0,
  chroma: 1.14,

  /**
   * HOW MANY STEPS A LAYER BLEND GETS — quantise the blend, then the result.
   *
   * Rule 1 applied to the ground's PALETTE rather than to its tone. Unquantised,
   * a hillside blending from sand to rock is a continuum of mixtures and no two
   * pixels of it are the same colour — countable is exactly what it is not. With
   * the weights snapped, the same hillside is a handful of flat fields with a
   * drawn boundary between each pair, which is what the reference's ground is:
   * "one coral and one darker coral", not five hundred corals.
   *
   * NOT, as it turns out, an anti-dither measure, and the note is here because
   * the obvious argument for this is wrong and someone will make it again: "a
   * posteriser dithers where its input drifts across a band boundary, so
   * quantise the input first". Measured in tools/checks/cel.mjs, a posteriser
   * only dithers on input that varies per PIXEL, and these weights are driven by
   * noise at 9 m and 140 m — fifteen pixels and more across at any range you can
   * see a cliff from. What was actually speckling the arena's far wall was the
   * rock MAP, whose features are centimetres wide, and that is fixed by
   * Terrain's terFlat.
   *
   * Four steps, snapped to nodes (saberCelQuant, not saberCelBand1 — a blend
   * that can never reach 0 or 1 puts a quarter of a rock tint on flat sand).
   * Fewer and a cliff's edge is a staircase you can count; more and the fields
   * stop being fields.
   */
  blendBands: 4.0,

  /**
   * How much of the ambient's own chroma reaches the shadow side. See
   * saberCelAmbient — this is the colour of every shadow in the game, and at
   * 1.0 the canyon's blue fill repainted its coral cliffs.
   */
  ambientChroma: 0.55,

  /**
   * HOW MUCH OF THE FLAT AMBIENT'S COLOUR COMES FROM UNDER THE HORIZON.
   *
   * `flat` above evaluates the indirect term along world up, which is what
   * makes the shadow side of an object one shape rather than a gradient — and
   * which also means every surface in the game is lit as if it faced straight
   * up. An up-facing surface sees no ground, so at 0 this term is exactly what
   * shipped: `hemi.groundColor` (26 authored values in Levels.js) multiplied by
   * a weight of zero, and the `_bounce` hemisphere baked into the probe at a
   * cosine weight of ~0. Both were dead.
   *
   * 0.35 is the ground's share of the flat ambient's HUE. See saberCelBounce —
   * the luminance is renormalised back to the sky's, so this cannot move the
   * exposure meter, the bloom headroom or the lit:shade ratio, and the only
   * thing it can change is what colour a shadow is. It is deliberately not the
   * physically-averaged 0.5: measured across the eight outdoor levels, folding
   * the bounce in by ENERGY as well takes the ambient down 3–15% and pushes the
   * ratio outside the 1.3–2.2 band on two levels at a share of 0.20, which is
   * a change to the light budget wearing a colour fix's clothes.
   *
   * What it buys, measured on the shipped atmospheres as the flat ambient's
   * blue/red: kamino 2.55 → 1.58, colosseum 2.39 → 1.82, drifts 1.82 → 1.47,
   * arena 2.35 → 1.92 — every one of them toward the level's own ground, which
   * is rule 5 (one hue family) applied to the light instead of to the palette.
   *
   * THESE ARE THE NUMBERS THE SUITE PRINTS, and they were not. The comment
   * shipped with 1.50/1.66/1.29/1.77 — the measurements from a DIFFERENT value
   * of `bounce`, best-fitting a share of 0.435 against the 0.35 two lines up.
   * Somebody tuned the constant and left the evidence for the old one, which
   * is the most expensive kind of stale comment: it reads as corroboration.
   * `tools/checks/lighting.mjs`'s "the ground colour every level authors
   * reaches the frame" prints all eight levels on every run, so the live
   * numbers were four lines away in the terminal the whole time.
   */
  bounce: 0.35,

  /**
   * DISTANCE IN PLATES (rule 3's other half).
   *
   * The aerial term's STRENGTH is quantised, not its colour: the colour is the
   * sky in the view direction and has to stay a smooth function of bearing
   * (reference frame 4 grades orange to cyan across the sky and the ground
   * under it does the same). Quantising the strength is what turns a
   * continuous veil into the flat plates a background painting is built from.
   */
  fogBands: 5.0,

  /**
   * THE 50% CONTOUR IS THE SHADOW EDGE (rule 2).
   *
   * The filter that produces the value being stepped is a 12-tap Poisson disc
   * whose radius tracks the sun's angular size (Engine.saberSoftShadow). None
   * of that is wasted: a single-tap hard shadow is a staircase on the shadow
   * map's own grid, and the 50% contour of a wide filter is a smooth curve
   * through the same blocker silhouette with the jaggedness bounded by the
   * texel size rather than by the tap pattern. That is the "deliberate jagged
   * silhouette" the reference frames have, and it is free — the filter was
   * already running.
   */
  shadowStep: 0.5,
  /** Half-width of the shadow step, in shadow units. One tap of the 12. */
  shadowEdge: 0.045,
};

/**
 * THE LIT LEVEL, and why it is not 1.0.
 *
 * This is the only number in the file that is forced rather than chosen, so it
 * gets its own note.
 *
 * The game meters its own exposure. `atmosphereMeter` computes the irradiance
 * landing on a horizontal surface from the level's sun and sky and sets
 * `toneMappingExposure` so that a mid-grey ground lands on KEY = 0.191. Every
 * level's exposure, every level's bloom threshold headroom and every existing
 * lighting check is anchored to that arithmetic.
 *
 * A two-tone ramp that puts the lit band at 1.0 hands a horizontal surface the
 * sun's full irradiance instead of `sin(elevation)` of it — 2.7x too much on
 * the meadow, 4.2x on the canyon. The meter does not know, so every level
 * comes out one and a half to two stops over, and the fix is not to re-meter:
 * the frame would then be correct on average and wrong everywhere, because a
 * vertical wall facing the sun would also be at 1.0 and a landscape in which
 * every lit surface is equally bright regardless of its orientation is exactly
 * what the ramp is FOR.
 *
 * So the lit band is set to what the light delivers to flat ground:
 *
 *     level = saturate( dot( L_world, up ) )
 *
 * — a per-light quantity the shader can compute for itself, with no uniform and
 * no plumbing. Three things fall out of it and all three are wanted:
 *
 *   · the ground is EXACTLY as bright as it is under Lambert, so the meter,
 *     the exposure, the bloom threshold and the lighting checks are untouched;
 *   · every lit surface in the frame is the same brightness whatever way it
 *     faces, so value contrast comes from the PALETTE rather than from the
 *     light — which is rule 5, arrived at from the other direction;
 *   · a low sun automatically flattens the whole frame toward its ambient,
 *     which is what a low sun does.
 *
 * Point and spot lights have no horizon to be measured against and are local
 * accents rather than key light, so they keep a level of 1.0.
 */
export const CEL_KEY = 'saturate( inverseTransformDirection( dir, viewMatrix ).y )';

/* The two directions a light can be in. Three keeps every light direction in
 * VIEW space; `inverseTransformDirection` is three's own rigid-inverse helper
 * out of `common`, so this costs one dot product per light. */

/* ══════════════════════════════════════════════════════════════════════ */
/*  The GLSL                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Appended to `common`, which every shader in the build includes — including
 * the hand-written ones in Scenery.js, which is how the grass and the water get
 * the same arithmetic as the terrain rather than a second copy of it.
 *
 * NO DERIVATIVES IN HERE. `common` is included by vertex shaders too and
 * fwidth/dFdx are fragment-only; a single use would fail to compile every
 * material in the game. The albedo posteriser therefore quantises on a fixed
 * grid rather than an screen-space-adaptive one.
 *
 * RESERVED WORDS. `flat`, `sample`, `filter`, `packed`, `patch`, `mat` and
 * `half` are keywords in GLSL ES 3.00 and one of them as a variable name takes
 * the whole material out of the frame silently. Nothing here is named any of
 * them; tools/verify.mjs has a check that says so.
 */
/**
 * THE QUANTISER, on its own, because two shaders in the build need it and
 * neither of them includes three's `common`.
 *
 * The sky mesh (three's Sky addon) and the cloud dome (SkyDome.js) are written
 * from scratch and include only the tone-mapping chunks, so they cannot see
 * anything appended to `common`. Rule 7 — the sky is flat, or one simple
 * gradient, and clouds are flat shapes — is exactly the rule that needs this
 * function, so it is exported for them to paste. Anything that DOES include
 * `common` must not paste it as well: a second definition is a compile error
 * and takes the material out of the frame.
 *
 * Bands are cut on sqrt(luminance) rather than on luminance, so they are
 * perceptually even rather than crowded into the highlights, and the plateau
 * CENTRE is taken rather than its lower edge, so quantising cannot darken a
 * field on average. Hue and chroma ride through untouched: the band decides
 * VALUE and nothing else, which is what keeps a posterised colour field
 * looking chosen rather than crushed.
 */
export const CEL_BAND_GLSL = /* glsl */`
vec3 saberCelBand( const in vec3 c, const in float n ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( l <= 1.0e-5 ) return c;
  float q = ( floor( sqrt( l ) * n ) + 0.5 ) / n;
  return c * ( ( q * q ) / l );
}
float saberCelBand1( const in float v, const in float n ) {
  return ( floor( v * n ) + 0.5 ) / n;
}
/**
 * THE OTHER QUANTISER, and the difference between the two is not a detail.
 *
 * saberCelBand1 takes the plateau CENTRE, which is right for a LEVEL — it
 * cannot darken a field on average, which is what keeps the albedo posteriser
 * off the material palette's toes. It is wrong for a BLEND WEIGHT, because it
 * never returns 0 or 1: a rock mask quantised that way puts an eighth of a
 * rock tint on the flattest sand in the level and can never reach full rock.
 *
 * This one snaps to the nearest NODE, so 0 stays 0, 1 stays 1, and what lies
 * between arrives as n flat regions with a drawn boundary between them. That
 * is the form a mask wants, and it is why the far field stopped dithering: a
 * blend that drifts slowly across a posteriser's band boundary flickers
 * between two output colours pixel by pixel, and one that is constant over a
 * region cannot.
 */
float saberCelQuant( const in float v, const in float n ) {
  return floor( v * n + 0.5 ) / n;
}
`;

const CEL_COMMON = CEL_BAND_GLSL + /* glsl */`
/* How bright this light makes flat ground — see CEL_KEY in src/toon/Cel.js.
 * A mutable global rather than a parameter because RE_Direct's signature is
 * three's and the light loop is in a different chunk from the BRDF. */
float saberCelKey = 1.0;

/* IS THIS LIGHT ALLOWED A TERMINATOR? 1 = yes (a key light), 0 = no (a fill).
 *
 * Two two-toned lights give a surface FOUR tones, not two, and the frame goes
 * straight back to reading as a gradient — which is the whole failure being
 * fixed. This game's rig is a sun and a sky fill (Engine._setupLights), so left
 * alone that is exactly what would happen: a sun terminator crossing a fill
 * terminator, at an angle, on every curved surface in the game.
 *
 * The discriminator is the rig's own construction and needs no new plumbing: A
 * LIGHT THAT OWNS A SHADOW MAP IS A KEY LIGHT. That is not a trick, it is the
 * definition — a light that casts no shadow is not modelling occlusion, so it
 * has no business modelling orientation either; it is standing in for the sky,
 * and the sky in this model is flat. The cascades carry shadow maps and the
 * fill does not, so the test is three's own UNROLLED_LOOP_INDEX <
 * NUM_DIR_LIGHT_SHADOWS, resolved at compile time.
 *
 * A flat fill still lands EXACTLY the Lambert answer on flat ground, because
 * its level is the same horizontal response every other light uses — so the
 * exposure meter does not move. */
float saberCelShape = 1.0;

/* IS THIS LIGHT REACHING THIS FRAGMENT? 1 = yes, 0 = a cast shadow.
 *
 * A GLOBAL RATHER THAN A MULTIPLY ON directLight.color, and the difference is
 * the whole of why cast shadows are no longer holes.
 *
 * three's own arrangement — and this file's, until now — multiplies the shadow
 * mask into the light's COLOUR before RE_Direct sees it, so a fragment in a cast
 * shadow is lit by a black light and lands on the ambient. With an authored
 * shadow band that is wrong twice over: it skips the band entirely, and where a
 * cast shadow falls on a surface that ALSO faces away from the sun the two
 * darkenings multiply — shadowBand², a third and much darker tone, on exactly
 * the surfaces (a character's own self-shadowed robe) where it is most visible.
 *
 * Carried as a mask instead, the two questions combine with a min: a surface is
 * lit if the sun can see it AND it faces the sun, and it is in THE shadow tone —
 * one tone, the same one — otherwise. Two tones per surface, which is rule 1,
 * and a cast shadow that reads as the same deliberate colour as a shadow face,
 * which is what the reference frames do. */
float saberCelCast = 1.0;

/** The two-tone response. In: N.L. Out: the direct term's multiplier. */
float saberCelTone( const in float dotNL ) {
  float t = min( ${CEL.terminatorMax.toFixed(4)}, ${CEL.terminatorRel.toFixed(4)} * saberCelKey );
  float s = smoothstep( t - ${CEL.edge.toFixed(4)}, t + ${CEL.edge.toFixed(4)}, dotNL );
  float onLight = min( s, saberCelCast );
  return saberCelKey * mix( 1.0, mix( ${CEL.shadowBand.toFixed(4)}, 1.0, onLight ), saberCelShape );
}

/** The lit level of a light whose view-space direction is the argument. */
float saberCelLightKey( const in vec3 dir ) {
  return ${CEL_KEY};
}

/** A cast shadow as a flat shape: the filter's 50% contour, nothing softer. */
float saberCelShadow( const in float s ) {
  return smoothstep( ${CEL.shadowStep.toFixed(4)} - ${CEL.shadowEdge.toFixed(4)},
                     ${CEL.shadowStep.toFixed(4)} + ${CEL.shadowEdge.toFixed(4)}, s );
}

/* The direction every flat-ambient lookup is made along: world up, in view
 * space. One colour over an object, so its shadow side is a shape rather than
 * a gradient. viewMatrix is a built-in uniform in both shader stages. */
vec3 saberCelFlatDir( const in vec3 n ) {
  vec3 up = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
  return normalize( mix( n, up, ${CEL.flat.toFixed(4)} ) );
}

/**
 * The ambient, with its chroma trimmed — the shadow TONE, in one place.
 *
 * With the direct term stepped to zero, a surface's shadow side is exactly its
 * albedo times this, so whatever colour this carries IS the colour of every
 * shadow in the game. Left at full strength that is the sky's own chroma plus
 * the fill's, and on the canyon — whose fill runs B/R 5.05 — a coral cliff's
 * shadow side came out saturated BLUE while its lit side stayed tan. Two hue
 * families on one rock, which is rule 5 broken by the lighting rather than by
 * the palette, and it is not what the reference does: "the rock buttes in (1)
 * are one coral and one darker coral".
 *
 * Trimmed to a little over half, so a shadow is still cooler than its own lit
 * side — which is true, and is most of what makes an outdoor frame read as
 * outdoors — without the light being allowed to repaint the surface. The
 * LUMINANCE is untouched, so nothing about the exposure or the light budget
 * moves; this can only ever change a cast.
 */
vec3 saberCelAmbient( const in vec3 c ) {
  return mix( vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), c, ${CEL.ambientChroma.toFixed(4)} );
}

/**
 * The ground half of the flat ambient — HUE ONLY. See CEL.bounce.
 *
 * sky is the indirect term looked up along the flat axis and ground is the
 * same lookup along its opposite: for the hemisphere light that is exactly
 * skyColor and exactly groundColor, and for the probe it is the upper and lower
 * halves of the bake. They are blended, and then the result is scaled back to
 * the sky lookup's own luminance, so the answer carries the ground's COLOUR at
 * the sky's ENERGY. That keeps a term that was authored per level (and read by
 * nothing) out of the exposure meter's business: a level's brightness is the
 * meter's question and it already has an answer, and this can only ever change
 * what colour a shadow is.
 *
 * The guard is not decoration. A level may author a black groundColor and an
 * interior bakes a near-black lower hemisphere; at a blend of 0.35 the mixed
 * luminance stays well clear of zero, but a level that authored both ends black
 * would divide by it, and a NaN in the ambient is every surface in the frame.
 */
vec3 saberCelBounce( const in vec3 sky, const in vec3 ground ) {
  vec3 m = mix( sky, ground, ${CEL.bounce.toFixed(4)} );
  float ls = dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) );
  float lm = dot( m, vec3( 0.2126, 0.7152, 0.0722 ) );
  return lm > 1.0e-6 ? m * ( ls / lm ) : sky;
}

/**
 * Albedo as a flat graphic colour field — IN TWO HALVES, AND WHICH HALF RUNS
 * WHERE IS THE WHOLE OF WHY THIS IS NOT ONE FUNCTION ANY MORE.
 *
 * The posteriser exists to collapse a PHOTOGRAPHIC MAP into flat fields (rule
 * 6). It was applied to the finished surface colour instead — map × authored
 * tint — and a quantiser applied to a product quantises the tint as well, which
 * is a different and much worse operator: a tint is not a photograph, it is the
 * palette, and the palette is the one thing in the frame that was chosen by
 * hand.
 *
 * What that cost, measured per texel through the real cloth bake at 40k
 * samples, on the five-layer robe ladder Bodies.js builds by hand (the numbers
 * are mean rendered luminance, and the authored order is trim < over < outer <
 * sleeve < tunic on every palette):
 *
 *   Night    tunic .0781  outer .0100  over .0100  sleeve .0100  trim .0100
 *   Ash      tunic .4032  outer .0900  over .0900  sleeve .2334  trim .0100
 *
 * — Night's five authored layers land on TWO values, four of them on the same
 * one, and the order comes out outer < over < sleeve < trim < tunic: the trim,
 * authored as the darkest thing on the figure, renders identical to the
 * over-robe and BRIGHTER than the outer. Ash loses one layer the same way. The
 * cause is the bottom plateau: bands are cut on sqrt(luminance), so band 0
 * spans 0 → 0.04 linear, which is everything below sRGB 55 — every dark garment
 * in the game, in one bucket. Widening the ladder cannot fix that and neither
 * can more bands; the layers are 1.3–1.5× apart and any global grid coarse
 * enough to give flat fields has bands wider than that down there.
 *
 * So the two halves are applied in the two places they belong:
 *
 *   saberCelMapValue  quantises the MAP TEXEL, in map_fragment, before the
 *                     tint multiplies it. Plateaus survive a constant multiply,
 *                     so a textured surface still comes out as a handful of
 *                     flat fields — measured, 3 rather than the 1 a dark robe
 *                     collapsed to — and the tint rides through untouched.
 *   saberCelChroma    lifts chroma about luminance on the finished colour,
 *                     where it always ran. It is not a quantiser, so it cannot
 *                     collapse anything, and it is what stops a posterised
 *                     texture reading as a greyed-out photograph.
 *
 * Same operator, same constants, same calibration: the drift lit() sees is
 * the drift of the MAP alone and comes out identical to four places on all
 * seven bakes (cloth +4.5%, sand −1.0%, duracrete −15.0%, …). All five layers
 * come back, in the authored order, on all six palettes.
 *
 * Value is quantised on a sqrt grid — perceptually even steps, so the plateaus
 * are the same visual width in the shadows as in the highlights — and the
 * plateau CENTRE is taken rather than the nearest edge, so a map whose whole
 * histogram sits inside one band comes out as one colour.
 */
vec3 saberCelMapValue( const in vec3 c ) {
  return max( saberCelBand( c, ${CEL.albedoBands.toFixed(1)} ), vec3( 0.0 ) );
}
vec3 saberCelChroma( const in vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( mix( vec3( l ), c, ${CEL.chroma.toFixed(4)} ), vec3( 0.0 ) );
}
/* Both at once, on a colour that never was a map times a tint — the grass
 * builds its albedo procedurally per blade (Scenery.js) and wants the whole
 * operator in one call. */
vec3 saberCelAlbedo( const in vec3 c ) {
  return saberCelChroma( saberCelMapValue( c ) );
}

/** Distance as flat plates rather than as a continuous veil. */
float saberCelDistance( const in float f ) {
  return saberCelQuant( f, ${CEL.fogBands.toFixed(1)} );
}
`;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Installation                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

let _installed = false;

/**
 * Rewrite three's lighting chunks in place. Idempotent; returns false if it has
 * already run.
 *
 * ORDER MATTERS AND IT IS THE CALLER'S JOB. This must run AFTER
 * installAerialPerspective (which replaces fog_fragment wholesale — patching
 * the stock chunk instead would be silently undone) and AFTER
 * installCascadeShadows (which rewrites the line this wraps in
 * lights_fragment_begin). Engine.js calls all three in that order.
 *
 * Every replacement is checked and reported. A chunk that changes shape between
 * three releases would otherwise leave the game half physical and half cel,
 * which is far worse than either.
 */
export function installCelShading(THREE_) {
  if (_installed) return false;
  _installed = true;
  const C = THREE_.ShaderChunk;
  const missed = [];
  let subs = 0;
  const sub = (chunk, from, to, label) => {
    subs++;
    const src = C[chunk];
    if (src.indexOf(from) < 0) { missed.push(label); return; }
    C[chunk] = src.replace(from, to);
  };

  /**
   * The same, for a whole PROGRAM rather than a chunk — and it needs its own
   * function because `ShaderChunk.meshphysical_frag`,
   * `ShaderLib.physical.fragmentShader` and `ShaderLib.standard.fragmentShader`
   * are the SAME STRING OBJECT in three, and strings are immutable: assigning a
   * patched copy to the chunk leaves both ShaderLib entries pointing at the
   * original, and ShaderLib is the one WebGLPrograms compiles from. Verified in
   * process — `ShaderChunk.meshphysical_frag === ShaderLib.physical.fragmentShader`
   * is true on r169, so a `sub()` here would have reported success and changed
   * nothing the GPU sees.
   */
  const subProgram = (from, to, label) => {
    subs++;
    const targets = [];
    if (C.meshphysical_frag?.indexOf(from) >= 0) targets.push(['chunk', null]);
    for (const k of ['standard', 'physical']) {
      if (THREE_.ShaderLib[k]?.fragmentShader.indexOf(from) >= 0) targets.push(['lib', k]);
    }
    if (!targets.length) { missed.push(label); return; }
    for (const [kind, k] of targets) {
      if (kind === 'chunk') C.meshphysical_frag = C.meshphysical_frag.replace(from, to);
      else THREE_.ShaderLib[k].fragmentShader = THREE_.ShaderLib[k].fragmentShader.replace(from, to);
    }
  };

  C.common += CEL_COMMON;

  /* ── 1, 3, 6: the physical BRDF ─────────────────────────────────────── */

  // TWO TONES. The rest of RE_Direct_Physical is untouched, so `irradiance`
  // still carries the light's colour and the shadow mask that was folded into
  // it — only its SHAPE over the surface changes.
  sub('lights_physical_pars_fragment',
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;',
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n'
    // A fill is standing in for the sky, so it is ambient in every respect —
    // flat over the surface (saberCelShape) AND chroma-trimmed like the rest of
    // the ambient (saberCelAmbient). Without the second half the canyon's fill,
    // which runs B/R 5.05, painted every shadow side in the level saturated
    // blue on its own: it is the largest single term in a shadow and the only
    // one that was still arriving at full chroma.
    + '\tvec3 irradiance = saberCelTone( dotNL )\n'
    + '\t\t* mix( saberCelAmbient( directLight.color ), directLight.color, saberCelShape );',
    'two-tone direct');

  // NO GGX LOBE. Deleted, not scaled: rule 8 says nothing in four reference
  // frames is shiny, and a term that is not in the shader cannot be brought
  // back by a material setting roughness to 0.06 (Props.MATS.glass does).
  sub('lights_physical_pars_fragment',
    '\treflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );\n',
    '',
    'kill direct GGX');

  // NO SHEEN LOBE. The robes and cloaks use MeshPhysicalMaterial's sheen for a
  // retroreflective rim; it is a cloth-fibre light-transport effect and reads
  // as satin, which is the opposite of a flat colour field.
  sub('lights_physical_pars_fragment',
    '\t\tsheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );\n',
    '',
    'kill direct sheen');
  sub('lights_physical_pars_fragment',
    '\t\tsheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );\n',
    '',
    'kill indirect sheen');

  /* …AND THE ENERGY THE LOBE WAS BORROWING HAS TO COME BACK WITH IT.
   *
   * Deleting the two accumulations above leaves `sheenSpecularDirect` and
   * `sheenSpecularIndirect` at zero, which is right — but three pays for the
   * sheen lobe by TAKING IT OUT OF THE DIFFUSE first, in meshphysical_frag:
   *
   *     float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
   *     outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect
   *                   + sheenSpecularIndirect;
   *
   * With the lobe gone that is a subtraction with nothing on the other side of
   * it: a straight darkening of every material that happens to declare `sheen`,
   * for a term the renderer no longer has. It is not hypothetical and it is not
   * uniform across the cast — walked on a built figure, 38 of the player
   * character's 64 meshes are MeshPhysicalMaterial with sheen (0.40 ×20, 0.30
   * ×10, 0.24 ×6, 0.34 ×2, all on sheenColor 0xd8cdbc), and buildAcolyte has 0.
   * three uploads the uniform as `sheenColor × sheen`, so max3 is 0.6867 × the
   * sheen value and the compensation lands at 0.9569 / 0.9677 / 0.9741 / 0.9921
   * — the player's robe renders 2.6–4.3% darker than the identical cloth on an
   * NPC beside them, and than the albedo `lit()` was calibrated to deliver.
   *
   * Small, and it is the kind of small that never gets found: it is a constant
   * multiply, it is invisible against any single surface, and it silently
   * decalibrates the one ladder in the game that was authored by hand. So the
   * whole block goes, rather than the constant being neutralised — with both
   * accumulators identically zero the line's only remaining effect IS the
   * subtraction. Written through subProgram, because this text lives in a
   * PROGRAM and not in a chunk. */
  subProgram(
    '\t#ifdef USE_SHEEN\n\t\tfloat sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );\n'
    + '\t\toutgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;\n\t#endif\n',
    '',
    'kill sheen energy compensation');

  // NO ENVIRONMENT REFLECTION, and no energy compensation for one either — with
  // the specular lobe gone the diffuse is not sharing the surface with
  // anything, so it takes all of it. Removing the `totalScattering` reference
  // is what lets the compiler drop computeMultiscattering entirely.
  sub('lights_physical_pars_fragment',
    'vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );',
    'vec3 diffuse = material.diffuseColor;',
    'no specular energy split');
  sub('lights_physical_pars_fragment',
    '\treflectedLight.indirectSpecular += radiance * singleScattering;\n',
    '',
    'kill IBL specular');
  sub('lights_physical_pars_fragment',
    '\treflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;\n',
    '',
    'kill IBL multiscatter');

  // THE MAP IS WHAT GETS POSTERISED, AND IT GETS POSTERISED BEFORE THE TINT.
  // See saberCelMapValue: quantising map × tint quantises the PALETTE, which
  // collapsed the player's five-layer robe ladder to two tones on the 'Night'
  // swatch and inverted its order. This is the only place a sampled albedo
  // exists on its own, and every fragment shader in three includes <common>
  // before <map_fragment>, so the function is in scope wherever this lands.
  // The alpha is multiplied through untouched — an alpha-tested leaf or a
  // depth material's cutout must not be quantised.
  sub('map_fragment',
    '\tdiffuseColor *= sampledDiffuseColor;\n',
    '\tdiffuseColor.rgb *= saberCelMapValue( sampledDiffuseColor.rgb );\n'
    + '\tdiffuseColor.a *= sampledDiffuseColor.a;\n',
    'posterise the map, not the palette');

  // METALNESS MUST NOT ZERO THE DIFFUSE — see the header note. This is the one
  // line standing between "no specular" and "every metal object is black".
  // The chroma lift goes on the same line because this is the last place the
  // surface colour is written before it is lit — and because it is a lift and
  // not a quantiser, it is the half of the old saberCelAlbedo that is safe to
  // run on a colour the palette has already been multiplied into.
  sub('lights_physical_fragment',
    'material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );',
    'material.diffuseColor = saberCelChroma( diffuseColor.rgb );',
    'flat albedo, metals keep theirs');

  /* ── 2, 4, 5: the light loop ────────────────────────────────────────── */

  // The key, per light. Point and spot lights are set explicitly rather than
  // left to the initialiser: the chunk's loop order is point, spot, then
  // directional today, and a future three that reorders them would otherwise
  // hand a point light the sun's key.
  sub('lights_fragment_begin', 'getPointLightInfo( pointLight, geometryPosition, directLight );',
    'getPointLightInfo( pointLight, geometryPosition, directLight );'
    + '\n\t\tsaberCelKey = 1.0;\n\t\tsaberCelShape = 1.0;\n\t\tsaberCelCast = 1.0;',
    'point key');
  sub('lights_fragment_begin', 'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    'getSpotLightInfo( spotLight, geometryPosition, directLight );'
    + '\n\t\tsaberCelKey = 1.0;\n\t\tsaberCelShape = 1.0;\n\t\tsaberCelCast = 1.0;',
    'spot key');
  sub('lights_fragment_begin', 'getDirectionalLightInfo( directionalLight, directLight );', [
    'getDirectionalLightInfo( directionalLight, directLight );',
    '\t\tsaberCelKey = saberCelLightKey( directLight.direction );',
    // Reset per light, not once: the cascade line below only runs for light 0,
    // so without this every later light in the unrolled loop would inherit the
    // sun's occlusion mask and the fill would be shadowed by the sun.
    '\t\tsaberCelCast = 1.0;',
    '\t\t#if UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS',
    '\t\tsaberCelShape = 1.0;',
    '\t\t#else',
    '\t\tsaberCelShape = 0.0;',
    '\t\t#endif',
  ].join('\n'), 'directional key');

  // HARD CAST SHADOWS, ON THE SHADOW BAND. Engine has already replaced this line
  // with its cascade selector, so the text matched here is Engine's and not
  // three's. The mask is CARRIED rather than multiplied into the light — see
  // saberCelCast: multiplying it in lands a cast shadow on the ambient and skips
  // the authored shadow tone entirely, and squares it where a cast shadow falls
  // on a face that was already turned away.
  sub('lights_fragment_begin',
    'directLight.color *= ( directLight.visible && receiveShadow ) ? saberCascadeShadow() : 1.0;',
    'saberCelCast = ( directLight.visible && receiveShadow ) ? saberCelShadow( saberCascadeShadow() ) : 1.0;',
    'hard cascade shadow');
  sub('shadowmask_pars_fragment',
    'shadow *= receiveShadow ? saberCascadeShadow() : 1.0;',
    'shadow *= receiveShadow ? saberCelShadow( saberCascadeShadow() ) : 1.0;',
    'hard shadow mask');

  /* FLAT AMBIENT. The hemisphere light's sky/ground blend and the probe's
   * directional convolution are the two smooth gradients left on a surface
   * once the direct term is a step, and they are the same gradient twice.
   *
   * BOTH ENDS OF THE AXIS ARE READ, and that is the whole of what changed here.
   * Flattening to world up (CEL.flat = 1) does not merely remove a gradient, it
   * evaluates every surface in the game AS IF IT FACED STRAIGHT UP, and an
   * up-facing surface sees no ground at all. Two things followed, both measured
   * in process rather than argued:
   *
   *   · `getHemisphereLightIrradiance` is `mix( groundColor, skyColor, 0.5·dotNL
   *     + 0.5 )` and the HemisphereLight sits at three's default (0,1,0), which
   *     Engine never moves — so dotNL is exactly 1, the weight is exactly 1, and
   *     `hemi.groundColor` returns skyColor with the ground term multiplied by
   *     zero. Engine.applyAtmosphere writes that value on every level change and
   *     Levels.js authors it 26 separate times. Not one of them could reach the
   *     frame.
   *   · `getIBLIrradiance` at +Y is a cosine lobe about +Y, so the `_bounce`
   *     hemisphere Engine bakes into the probe — the lower half, tinted from the
   *     same groundColor, and itself the subject of a written-up fix — lands at
   *     a weight of ~0. It was baked every level load and read at 0%.
   *
   * So the ground half is read explicitly, at the opposite end of the same
   * fixed axis, and folded in by saberCelBounce — WHICH MOVES HUE ONLY. That is
   * not timidity, it is the same rule saberCelAmbient states three functions
   * up: "the LUMINANCE is untouched, so nothing about the exposure or the light
   * budget moves; this can only ever change a cast." Measured, the alternative:
   * folding the bounce in by energy as well takes the ambient down 3–15% per
   * level and pushes the lit:shade ratio from 1.70–2.19 to 1.78–2.27 at a
   * ground share of only 0.20 — outside the 1.3–2.2 band cel.mjs measures and
   * defends, on the Colosseum and the arena, before the share is large enough
   * to be worth having. The energy question is the exposure meter's and it
   * already has an answer; the COLOUR of what is under a chin is this term's,
   * and it had none.
   *
   * The probe pays one extra fetch of the top mip for it. The lobe that was
   * deleted for rule 8 was several. */
  sub('lights_fragment_begin',
    'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
    'irradiance += saberCelAmbient( saberCelBounce('
    + ' getHemisphereLightIrradiance( hemisphereLights[ i ], saberCelFlatDir( geometryNormal ) ),'
    + ' getHemisphereLightIrradiance( hemisphereLights[ i ], -saberCelFlatDir( geometryNormal ) ) ) );',
    'flat hemisphere');
  sub('lights_fragment_maps',
    'iblIrradiance += getIBLIrradiance( geometryNormal );',
    'iblIrradiance += saberCelAmbient( saberCelBounce('
    + ' getIBLIrradiance( saberCelFlatDir( geometryNormal ) ),'
    + ' getIBLIrradiance( -saberCelFlatDir( geometryNormal ) ) ) );',
    'flat probe');

  /* ── distance in plates ─────────────────────────────────────────────── */

  // fog_fragment is Engine's rewritten version by the time this runs; the line
  // is the last one in it, and it is the only place the factor is consumed.
  sub('fog_fragment',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTone, fogFactor );',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTone, saberCelDistance( fogFactor ) );',
    'banded distance');

  if (missed.length) {
    console.warn('SABER: cel shading could not patch: ' + missed.join(', ')
      + ' — the frame will be part physical.');
  }
  celInstall = { missed, count: subs };
  return celInstall;
}

/**
 * WHAT THE INSTALL ACTUALLY DID, kept where a check can read it.
 *
 * The return value above was handed to Engine.js and dropped on the floor, and
 * `_installed` makes a second call return `false` — so after boot there was no
 * way to ask whether the patch landed. That mattered more than it looks:
 * `tools/checks/cel.mjs` asserts its shader claims against THIS FILE'S SOURCE
 * TEXT, never against `THREE.ShaderChunk`, so all nineteen of its checks pass
 * in a process where `installCelShading` has never run and the frame is fully
 * physical. Verified: run cel.mjs without importing Engine and it reports 19
 * passed, 0 failed with `lights_physical_pars_fragment` still carrying
 * `reflectedLight.directSpecular += irradiance * BRDF_GGX`.
 *
 * The failure this guards is not hypothetical either. Every `sub()` matches
 * three's chunk text exactly, tabs included, and TWO of the chunks are ones
 * Engine has already rewritten — so the order of the three installers is
 * load-bearing. Calling this one on stock three, out of order, drops three of
 * the sixteen substitutions on the floor with nothing but a console warning:
 * measured, `hard cascade shadow`, `hard shadow mask` and `banded distance`.
 * A player would see a part-physical frame; the suite would print all green.
 */
export let celInstall = null;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The same arithmetic, in JS                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/* Transcriptions, for checks. This build never boots a GPU under test (see
 * tools/dom-shim.mjs — there is no GL context anywhere in the harness), so the
 * house pattern is a JS twin plus source-shape assertions that pin the shader
 * text it stands for. tools/checks/cel.mjs holds both. */

const saturate = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const t = saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * saberCelTone(). `key` is the light's lit level — see CEL_KEY. `shape` is 1
 * for a light that owns a shadow map and 0 for a fill, which lands flat. `cast`
 * is the stepped cast-shadow mask, 1 in the open and 0 in a shadow; it combines
 * with the terminator by min, so both roads into the shadow arrive at the same
 * band rather than multiplying.
 */
export function celTone(dotNL, key, shape = 1, cast = 1) {
  const t = Math.min(CEL.terminatorMax, CEL.terminatorRel * key);
  const s = Math.min(smoothstep(t - CEL.edge, t + CEL.edge, dotNL), cast);
  return key * (1 + shape * (CEL.shadowBand + (1 - CEL.shadowBand) * s - 1));
}

/** saberCelBand(), on a linear RGB triple. */
export function celBand(rgb, n) {
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  if (l <= 1e-5) return rgb.slice();
  const q = (Math.floor(Math.sqrt(l) * n) + 0.5) / n;
  return rgb.map((c) => c * ((q * q) / l));
}

/** What three's physical model does with the same input, for the control. */
export function lambertTone(dotNL) { return saturate(dotNL); }

/**
 * saberCelBounce(), on two linear RGB triples — the flat ambient's sky lookup
 * and its ground lookup. Hue moves, luminance does not.
 */
export function celBounce(sky, ground) {
  const L = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const m = sky.map((c, i) => c + (ground[i] - c) * CEL.bounce);
  const ls = L(sky), lm = L(m);
  return lm > 1e-6 ? m.map((c) => c * (ls / lm)) : sky.slice();
}

/** saberCelShadow(). */
export function celShadow(s) {
  return smoothstep(CEL.shadowStep - CEL.shadowEdge, CEL.shadowStep + CEL.shadowEdge, s);
}

/** saberCelMapValue() — the band, on a sampled map texel, before any tint. */
export function celMapValue(rgb) {
  return celBand(rgb, CEL.albedoBands).map((c) => Math.max(0, c));
}

/** saberCelChroma() — the chroma lift, on the finished surface colour. */
export function celChroma(rgb) {
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return rgb.map((c) => Math.max(0, l + (c - l) * CEL.chroma));
}

/**
 * saberCelAlbedo(), on a linear RGB triple — both halves, for the one caller
 * that wants them together (the grass).
 *
 * Written out rather than composed because the identity is worth stating: the
 * band preserves luminance up to its own quantisation and the chroma lift
 * preserves it exactly, so band-then-chroma and chroma-then-band are the same
 * operator to the last bit, which is why splitting them moved nothing that was
 * not the defect. tools/checks/cel.mjs asserts that both orders agree.
 */
export function celAlbedo(rgb) {
  const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  if (l <= 1e-5) return rgb.slice();
  const n = CEL.albedoBands;
  const q = (Math.floor(Math.sqrt(l) * n) + 0.5) / n;
  const k = (q * q) / l;
  return rgb.map((c) => Math.max(0, (l + (c - l) * CEL.chroma) * k));
}

/** saberCelDistance(). */
export function celDistance(f) {
  return Math.floor(f * CEL.fogBands + 0.5) / CEL.fogBands;
}

/**
 * How many distinct plateaus a smooth 0..1 sweep comes out as, for a
 * quantiser. The measurement the checks are built on: a cel surface has a
 * countable number of tones and a PBR one does not.
 */
export function bandCount(fn, samples = 4096, tol = 1e-4) {
  const seen = [];
  for (let i = 0; i < samples; i++) {
    const v = fn(i / (samples - 1));
    if (!seen.some((s) => Math.abs(s - v) < tol)) seen.push(v);
  }
  return seen.length;
}
