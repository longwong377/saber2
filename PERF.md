# What the engine actually costs

**Superseded.** The numbers that were here were taken headless, at quality
`low`, in wall-clock, with no load average recorded, in `waves` — a mode where
the O(bodies²) cross-army pass at `World.js:2743` does not run — and by a
harness that was never committed. They reported 198 µs a body and a ceiling of
63, and a scale plan was written on them.

`tools/scale.mjs` is the committed replacement and it measures CPU time at
quality `high` in `command`, which is a mode with two armies in it. Run it:

    node --import ./tools/register.mjs tools/scale.mjs

## What it says

    scale — command · geonosis · quality high · 120 frames after 60 warm
    loadavg 0.3 0.1 0.1 on 4 cores

      19 alive     15.98 ms CPU
      36 alive     18.82 ms CPU
      64 alive     26.53 ms CPU

    fixed overhead 10.98 ms · marginal 238 µs/body
    ceiling at a 16.7 ms frame, SIMULATION ONLY: 23 bodies
    marginal at the bottom 167 µs · at the top 275 µs · bend x1.65
      <-- NOT LINEAR; the straight-line ceiling above is optimistic

Three findings, and the third is the one that matters.

**The fixed overhead is 10.98 ms, not 4.2.** Two thirds of a 16.7 ms frame is
gone before a single soldier is placed. That is quality `high` against the old
figure's `low`, and it is the tier a player uses.

**The marginal cost is 238 µs, not 198**, and the ceiling on simulation alone is
**23 bodies** — against `Levy` making `alive` **66** in the flagship modes.

**It is not linear, and the old claim that it was is an artefact of the mode it
was measured in.** 167 µs at the bottom of the sweep and 275 µs at the top, a
bend of ×1.65 across a 3× population. `World.js:2743` is O(bodies²) and gated on
`this.command`, so a benchmark run in `waves` never executes it. The plan built
on that benchmark called the simulation linear and derived a ceiling from a
slope that does not exist.

**So the flagship mode is already over frame budget on simulation alone.** 64
bodies cost 26.53 ms CPU against a 16.67 ms frame, before rendering, before the
ink prepass, before three shadow cascades. This is a live defect, not a scaling
question, and it outranks everything in the plan.

## What this file does not measure

The render pass. There is no GPU here, so nothing about draw calls, skinning or
shadow cost is knowable from it. `tools/checks/frame-ledger.mjs` splits the same
frame by subsystem — physics 47%, animation 22.5%.

The browser instrument this file used to say "does not exist yet" DOES exist:
`src/engine/Profiler.js` reports the frame, our own JS, real GPU time through
`EXT_disjoint_timer_query_webgl2`, p99 and the 1% low, it is always-on, `Engine`
constructs it and the HUD reads it. What is still missing is a READER — nothing
in `tools/` starts a real browser, plays for two minutes and prints the split —
so the numbers exist on the player's screen and have never once reached a
document. That, and not the instrument, is what the rendering decisions in
PLAN §4.3 are actually waiting on.

## Content already built and barely used

37 archetypes (`node tools/state.mjs`, not `Object.keys(ARCHETYPES)` — that
reader answers 16 and the roster is more than twice that). 20+ vehicles: AAT,
AT-TE, Hailfire, Juggernaut, SPHA-T, snail tank, tri-droid, dwarf spider,
gunships and transports for both sides, capital ships. 7 levels, 9 modes.
