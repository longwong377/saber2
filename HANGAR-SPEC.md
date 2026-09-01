# THE FLIGHT DECK — THE ASK, AS IT WAS GIVEN

Every line below is the player's own, from the brief. It is here so that
"finished" can be checked against what was asked rather than against what was
convenient, and so the audit at the end has a subject.

Status: `·` not started · `~` partial · `✓` done and driven

## THE ROOM

- `✓` Aft bulkhead is the only real interior surface. Everything else is field,
  space, or distance haze.
- `✓` Deck extends out toward the shield and just ends. Warning strobes at the
  lip, no railing.
- `✓` **No ceiling, ever.** Vertical structural spars arc up and out of frame so
  the space reads as enclosed without ever showing a ceiling plane.
- `✓` **No bare side walls. It cannot look like a box.**
- `·` Haze/fog volume in the hangar so far rows dissolve — kills the need for
  detailed distant geometry entirely.

## THE COMPANY

- `~` You give an order, audibly, and it calls your troops — similar in carrying
  out to a stratagem.
- `✓` Troops file in from off-camera in a loose column, then snap to formation.
  **The filing in sells it more than the standing.**
- `✓` Staggered arrival — they don't all take the same number of steps. Slight
  timing offsets on the snap-to. (three things differ per man, not one: start,
  pace and distance; 11 men formed up in 9 s)
- `✓` Idle micro-motion while at attention: breathing, weight shifts, helmet
  turns, one man adjusting his grip.
- `·` Camera close-focus when you select one: he breaks attention, turns to face
  you, salutes, holds.
- `·` Deselect returns him to attention with a snap.
- `·` Multiple salute types, order barks, formation changes (at ease, present
  arms, dismissed).
- `~` at ease / present arms / salute / dismissed all exist as ORDERS with barks
  (`DECK_ORDERS`); no audible voice line yet, no formation change on dismissal.
- `·` Troops sing/chant on command, faction-specific.

## CUSTOMISING THEM, IN FRONT OF YOU

- `·` Change them live from the hangar — rename, paint, attach — and see it
  happen on the man in front of you.
- `·` Paint applies as a **sweep, not a pop** — like a wash moving over the armour.
- `·` Attachment parts physically drop in from off-frame or are handed over by a
  droid.
- `~` Every change plays a one-shot audio cue. The four cues exist and are
  measured (`cuePaint`/`cueAttach`/`cueDetach`/`cueName`); nothing calls them yet.
- `·` Everything you change is saved on leaving, and everything doable here is
  doable in the main menu.

## THE DECK, ALIVE

- `·` Crew crossing the deck in the far midground, silhouettes only, looping paths.
- `·` Repair droids / R2 units on fixed loops, near enough to see clearly, since
  they are the closest NPCs and need to be real.
- `·` A gantry crane traversing overhead on a slow loop.
- `~` One ship on a pad mid-repair with a tech on a scaffold, sparks, welding
  flare. (hull + scaffold placed; no tech, no sparks, no flare)
- `·` Sparks, steam vents, coolant hiss — motion in the periphery is worth more
  than detail.
- `·` Loader sled crossing the far deck with a crate.
- `✓` Idle chatter callouts on the PA, distant and unintelligible. 12/12
  announcements distinct, no words in the source.
- `·` Ships pass through the shield on a schedule — pop, shockwave ring, engine
  wash, deck grit blown sideways.
- `·` Launches: clamps release, repulsor spin-up whine, taxi, punch through.
- `·` Arrivals with battle damage: smoke trail, hard landing, fire crew sprinting in.
- `·` Keep it to 3–4 scripted traffic events on a loose loop so it never feels
  dead but never needs AI.
- `·` Heat shimmer over idling engines.

## THE FIELD

- `✓` Visible energy plane with a subtle hex/interference pattern, mostly
  transparent.
- `·` Ripples outward from anything that passes through.
- `·` Flickers and browns out when a big hit lands on the ship.
- `✓` Audible pressure differential — muffled hush right at the boundary, deck
  noise behind you. −12.1 dB A-weighted spawn→lip; 3k–12k down 18.3 dB while
  20–60 Hz goes UP 0.8, and sub share 90% → 99%.
- `·` Debris occasionally hits it from outside and burns off in a flare.

## THE PLANET

- `✓` Fills 30–40% of the visible space, curvature edge visible, terminator.
  A 39° disc, and the terminator is three concentric plates over 40° of sphere
  rather than one edge, which is what makes it a ball and not a circle.
- `✓` Biome-driven per map selection: ice, forest, desert, volcanic, urban, ocean.
  Every swatch derived, none typed: `sandColor`/`rockColor`/`gritColor` for the
  ground, `water.deep` (or `water.sky` when the sea is lava), `cloudCover`/
  `cloudLit`/`cloudDark` for the weather, `skyColor` for the limb, `sunColor`
  for the star. Ice line solved from the ground swatch's own brightness and
  blue-over-red: alpine 1.00, wood/colosseum/drifts 0.10, the lava pair 0.
- `✓` Slow orbital drift — visibly moves over 2–3 minutes. **17.7° in 180 s**,
  measured (`tools/_orbitprobe.mjs`), as a ±24° station-keeping sway so the
  world always comes back into the aperture. `sway: 0` gives a true lap.
- `✓` Cloud layer with a second slower rotation. Surface 36.0°/180 s, deck
  22.3°/180 s — 0.62×, measured.
- `✓` Atmospheric rim glow, biome-tinted.
- `✓` City lights on the night side for inhabited maps. Two gates so they
  cluster, occluded by the cloud over them, quantised to three. Which worlds
  is derived from `L.party` — the spectator field, the only thing a level
  record carries that asserts non-combatants live there. **This is the weakest
  derivation in the feature**; a real settlement flag should replace it.
- `✓` Landing craft as tiny specks descending toward it in strings — three
  lanes of four, aimed at the near limb, and the last sixth of the trip is an
  entry streak that lengthens, warms and goes out.

## THE BATTLE

- `✓` Layered by distance: capital ships as huge slow silhouettes, cruisers
  midground, fighters as fast points of light near you. Distance is stated as
  size and RATE, because vacuum has no haze to state it with: a capital is 5.7°
  long and drifts at a four-minute period, a fighter is two pixels and crosses
  the field in two and a half seconds.
- `✓` Turbolaser exchanges between capital ships — long, slow tracer bolts. Slow
  = big. Six guns, 6.4–13.3 s a shot, the bolt a sixth of the gap.
- `✓` Distant explosions with no sound, then a delayed muffled thump through the
  hull. The schedule is on the CPU (`SkyDome._blasts`) and the shader is a
  consumer of it, so the flash can be subscribed to: each one pushes
  `{ kind, strength, delay, at }` onto `ground.orbit.events` — a queue to
  drain, capped at 12 — which is exactly `hullThump(world, strength, {delay})`.
  Delay 0.9–2.1 s, dramatic rather than physical, for the reason `DeckAudio`
  writes down. **Nothing drains it yet.**
- `✓` One capital ship visibly dying over the whole session: fires spreading,
  listing, breaking apart. 240 s: the list rolls as t², fires light cell by
  cell along the keel as the clock passes each one's own hash, and at 0.80 the
  hull is drawn as two pieces that separate and tumble.
- `✓` Debris field with slowly tumbling wreckage — 16 chunks, brightness |sin|
  on each one's own rate quantised to three plates, so a plate catching the
  star is a step and not a fade.
- `✓` Fighter dogfights that pass close to the shield and streak past. Four
  passes, in pairs, one on the other's tail with bolts between them, crossing
  the whole aperture in 2.5 s every 15–31 s. Drawn as segments from where the
  craft was to where it is — the only reason something that fast is visible.
- `✓` Ion flashes, shield impact blooms on friendly hulls. The bloom is a
  crescent shell facing where the shot came in, not a ring; the ion flash takes
  the whole hull blue-white for a fifth of a second.
- `✓` Atmospheric entry streaks going down toward the planet.
- `✓` Starfield behind all of it, dense, with parallax against the orbital drift.
  The field turns at 5.9°/180 s against the world's 17.7° — three to one, which
  is the parallax.

## SOUND

- `✓` Deep hull hum bed, constant. 7 layers, 25 nodes, no pool voice.
- `✓` PA announcements, faction-flavoured. Republic 82% in 800 Hz–3 kHz;
  Separatist lower horn, more drive, 3 pips. No words anywhere in the source.
- `✓` Distant muffled battle thumps, irregular. 100% under 200 Hz, one voice,
  blooms the bed's rumble for 1.6 s. `hullThump(world, strength, {delay})`.
- `✓` Repulsor whine dopplering as ships pass. WebAudio's Doppler was removed
  from browsers in 2016; this is done on the oscillator frequency instead, plus
  the noise rate and both filter cutoffs. 3.08 semitones on a 240 m pass.
- `✓` Boot steps on deck grating for the troop line. The halt is ONE sound, not
  eleven — coalesced in 55 ms, shorter than the 64 ms flight time from the line.
- `✓` Your own footsteps changing material as you walk toward the shield. Plate
  893 Hz, grating 2143, lip 1762, against 1852 for everything before.

## FACTION PURITY

- `·` Ship classes, trooper models, deck insignia, PA voice, lighting colour
  temperature, and the enemy capital ships in the battle outside all swap
  together.
- `·` **Never mix — if the player sees one wrong-faction asset the whole illusion
  dies.**

## PLAY

- `·` Force powers work in here: shove the line over, they get up and re-form,
  annoyed.
- `·` Pick up crates and ships, throw them at the shield.
- `·` Walk to the shield edge and stand there — reward it with the best view in
  the scene.
- `·` Physics on everything, in the hangar and on every troop, mine or anyone's.
- `·` Every single thing in that hangar is modelled and real — no less detailed
  than a map.

## MINE, ADDED ON TOP

- `·` The muster call reuses the real order wheel, so the deck is where the
  command interface is learned.
- `·` `ORDER_REACH` applies: walk away from the line and they cannot hear you.
- `✓` The line is the actual persistent roll, dealt by the fight's own
  `squadPlan` and led by its own `leadOf`, with the gaps where last run's dead
  used to stand.
- `·` A memorial on the one real wall you walk past.
- `·` Deploy for the run by walking up the gunship's ramp.
