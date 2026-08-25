# What the engine actually costs

**Superseded.** The numbers that were here were taken headless, at quality
`low`, in wall-clock, with no load average recorded, in `waves` — a mode where
the O(bodies²) cross-army pass at `World.js:2989` does not run — and by a
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

**EVERY FIGURE IN THE BLOCK ABOVE IS RETRACTED, BY THE INSTRUMENT THAT PRINTED
IT.** `tools/scale.mjs`'s own header now records why: the run warmed for 90
frames and **fifty-two dressing props were still coming to rest**, so the "fixed
overhead" was somebody else's crates settling and every per-body figure carried a
share of it. The settled empty world is **about 2.5 ms and still falling**, not
10.98, and `WARM` is 1200 frames now. There is no 23-body ceiling.

What has been measured since, and what should be quoted instead: the ladder runs
to **160 bodies in the two-army front layout, 120 of them at 16.60 ms**, and
`tools/_frame.mjs` reports the browser split (see below). The three findings
that follow this line are kept because the third one is still true and is the
reason the first two were wrong.

**The fixed overhead was reported as 10.98 ms, not 4.2** — retracted; it was
unsettled dressing.

**The marginal cost was reported as 238 µs, not 198**, with a ceiling of **23
bodies** — retracted for the same reason.

**It is not linear, and the old claim that it was is an artefact of the mode it
was measured in.** 167 µs at the bottom of the sweep and 275 µs at the top, a
bend of ×1.65 across a 3× population. `World.js:2989` is O(bodies²) and gated on
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

The browser instrument this file used to say "does not exist yet" DOES exist,
and it is now read. `src/engine/Profiler.js` reports the frame, our own JS, real
GPU time through `EXT_disjoint_timer_query_webgl2`, p99 and the 1% low, always
on; `tools/_frame.mjs` boots the shipped page in Chromium, deploys, plays and
prints the split:

    node tools/_frame.mjs [--level geonosis] [--mode theline] [--quality high]

## What the browser says, on a box with no GPU in it

    theline · geonosis · quality high · 768x432 drawing buffer
    ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)

      rung              alive   draws   ktris   median ms   JS med   GPU med
      as deployed          12    2413    1968        3417     45.9    3397.7
      +40 bodies           51    4843    2586        3567    103.2    3478.7

**The GPU timer query resolves here.** ANGLE-on-SwiftShader answers
`EXT_disjoint_timer_query_webgl2` on every frame, which is the finding that
matters most: PLAN §4.3's "is it GPU-bound or JS-bound" is answerable by tool
now, on this box and on a player's.

**The frame is 93–99% draw and 1.3–3.0% our own JS.** That is a real reading of
this machine and it is a software rasteriser being a software rasteriser — it
does not license a claim about a player's graphics card. What transfers is the
counts: twelve living men on geonosis cost ~2400 draw calls and ~1.9 M submitted
triangles a frame at quality `high`, and forty more men add ~2430 calls and
~618k triangles.

**The milliseconds are only sometimes measurable here.** At load 5 on four cores
the population step resolved at +400 ms (10 ms a body); at load 8 the same step
was inside the tool's own noise band and it said so rather than printing it.
`_cpuclock.mjs`'s rule, one layer out: quote the number with the load or do not
quote it.

## Content already built and barely used

37 archetypes (`node tools/state.mjs`, not `Object.keys(ARCHETYPES)` — that
reader answers 16 and the roster is more than twice that). 20+ vehicles: AAT,
AT-TE, Hailfire, Juggernaut, SPHA-T, snail tank, tri-droid, dwarf spider,
gunships and transports for both sides, capital ships. 7 levels, 9 modes.
