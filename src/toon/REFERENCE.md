# The look we are going for

Read this before touching a material. It is written from four **Sable**
(Shedworks) frames the player supplied as the reference for this game's art
direction, and it exists because a cel-shaded prototype was rejected with
"there will be PBR leftovers everywhere" and "something about it still looks
similar to non-toon, especially the ground/grass/sky."

The frames, so the notes below can be checked against something:

1. A masked figure crouched in front of a mint-green mech, coral rock buttes
   behind, flat pale-cyan sky.
2. A pink-and-grey fortress on a mauve hill, flat lavender sky with cream cloud
   bands, red-orange foreground ground, one small glowing pink point light.
3. A canyon almost entirely in the green/teal family: mint cliffs drawn with
   contour strata lines, a chartreuse dome as the single saturated accent, flat
   dark-green cloud blobs, cream ashlar with drawn mortar.
4. A speeder low over orange dunes, cream rock ridge with one hard-edged dark
   brown cast shadow, sky graded orange to cyan at the horizon.

## The eight rules those frames actually follow

**1. Two tones per surface, and the boundary is crisp.** Not a four-band ramp
with soft steps — a lit colour and a shadow colour meeting on a hard edge. The
rock buttes in (1) are one coral and one darker coral. The mech is one mint and
one charcoal. A ramp with more than two or three steps starts reading as a
smooth gradient again, which is the thing being avoided.

**2. A cast shadow is a flat SHAPE with an interesting silhouette.** The
speeder's shadow in (4) and the ridge's shadow beside it are solid, hard-edged,
high-contrast, and their outline is jagged and deliberate. There is no penumbra
anywhere in any of these frames. A soft shadow is a PBR leftover.

**3. Aerial perspective is a HUE SHIFT toward the sky, not grey fog.** Distant
rock in (1) goes lavender; the far cliffs in (3) go pale mint. They move toward
the sky's own colour and lose saturation and contrast — they do not get greyer
or hazier. A distance fog that mixes toward white or grey will read as
non-toon on its own, no matter what the materials do.

**4. Outlines: dark, thin, even weight, on interior detail as well as
silhouettes.** They are dark brown or charcoal rather than black. Crucially
they draw the strata in the cliffs, the mortar between stones and the panel
seams on the mech — not just the outside edge. An outline pass that only inks
silhouettes gives you half the look.

**5. One hue family per scene, plus one or two saturated accents.** (3) is
green on green on green with a chartreuse dome. (2) is lavender and pink with
one hot pink light. The accent is small and it is the subject. A scene with six
competing hues is not this.

**6. Texture is DRAWN, not shaded.** Strata as thin contour lines. Mortar as
drawn lines. Ground detail as sparse dark speckle dots — literal dots, widely
spaced, no noise field. There is no bump, no roughness variation, no detail
normal anywhere in these frames.

**7. The sky is flat, or one simple gradient, and clouds are flat shapes with
outlines.** (1) and (3) are a single flat colour. (2) has flat cream bands.
(4) grades orange to cyan and is the only gradient in four frames. Clouds are
solid shapes with a line around them, not volumetric anything.

**8. Nothing is shiny.** Not the armour, not the metal, not the stone. There is
no specular highlight in any of the four frames. The only light source that
reads as a light is the small glowing point in (2), and it is drawn as a disc
with a halo rather than as a lit falloff.

## What that means for this codebase, concretely

- Ramps: two steps, not four. Sharpen the step edge; do not smooth it.
- Kill specular entirely. `roughness`/`metalness` ladders that existing checks
  measure are being REPLACED — re-derive those checks against the stronger
  property (a flat field has no specular lobe at all), do not weaken them.
- The aerial-perspective term must interpolate toward the SKY COLOUR in hue,
  not toward a grey. `terrain-aerial.mjs` measures the old behaviour.
- The outline pass needs interior creases, not just depth silhouettes — that is
  what the crease width in `OutlinePass` is for, and it should be doing more
  work than it currently does.
- Ground detail should become drawn marks (contour lines on cliffs, speckle
  dots on sand) rather than noise-driven albedo variation.
- Each level gets a palette: one hue family, one accent. `PALETTES` in Toon.js
  is the right home for it.
