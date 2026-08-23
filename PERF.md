# What the engine actually costs, measured 2026-08-23

Headless (no GPU), geonosis, quality low, bodies ringed round a fighting player.
`tools/register.mjs` loader, 120 measured frames after 40 warm.

## The ceiling today

    bodies   ms/frame   marginal us/body
         0       4.20    (world overhead: terrain, grass, physics, player)
        15       6.65    443
        30       9.33    311
        60      12.05    201
       120      23.78    198
       232      50.20    216

Marginal cost is **~198 us/body** and LINEAR — no O(n^2) anywhere in the sim.

At a 16.7 ms frame with 4.2 ms of world overhead:
**(16.7 - 4.2) / 0.198 = 63 fully-simulated bodies.** In a browser, with the
render pass on top, fewer. `WaveDirector.maxAlive` is 26, which is consistent.

## Distance does almost nothing

Same 90 bodies, ringed at three radii:

    12 m    198 us/body
    90 m    192 us/body
    200 m   178 us/body

**10% off at 200 m.** There is effectively no behaviour LOD: a body across the
map costs what a body in your face costs. This is the finding the whole scale
problem turns on.

## Where the 198 us goes (118 bodies)

    Enemy.update      126 us/body   62%
      _pose            81 us/body   40%   <-- skeletal animation
      _move            27 us/body   13%
      _think           12 us/body    6%   <-- the actual AI
      _shoot            0 us/body    0%
      _syncBody         1 us/body    0%
    physics.step       38 us/body   19%
    World's own loops  ~40 us/body  ~20%  (blade resolution, targeting, plates)

**The AI is 12 us. The animation is 81.** The thing that makes a body a soldier
is 6% of its cost; the thing that makes it a *puppet* is 40%.

## What that implies

A body that is posed cheaply or not at all, and carries no rigid body, costs
roughly `12 + 27 + a share of the world loops` ~= 40-55 us. That is a **4x
multiplier on the population** before a single rendering trick is applied:
~230 simulated instead of ~63. Gate the World-side per-enemy loops too and it
goes further.

So the two-tier design is not a nice-to-have. It is the only road to the
battle the brief describes, and the measurement says which tier boundary
matters: **pose and physics, not AI.**

## Content already built and barely used

- 16 archetypes: b1, b2, conscript, trooper, sniper, acolyte, jedi, sentinel,
  guardian, master, droideka, walker, remote, dummy, sparring, beast
- 20+ vehicles: AAT, AT-TE, Hailfire, Juggernaut, SPHA-T, snail tank, tri-droid,
  dwarf spider, gunships (both sides), transports (both sides), capital ships
- 7 levels, 9 modes, a stratagem table, emplacements, blast doors, breaching

## And the cheap tier pays — measured, not calculated

Same 119 bodies, same fight, with pieces taken away:

    full body                155 us/body    ceiling  80
    no _pose                  60 us/body    ceiling 207
    no _pose, no rigid body   53 us/body    ceiling 233

**Dropping the skeleton alone nearly triples the population.** `_think` still
runs at 12 us, so a cheap body is still a soldier with a brain, a target and a
morale value — it just is not a puppet and does not collide.

So: ~50 full bodies near the player + ~250 cheap ones = **300 fighting units**,
every one of them with real AI. Gate the World-side per-enemy loops on the same
boundary and it goes further still.
