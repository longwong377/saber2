# SABER — Design Specification

> *A single blade against a hundred. The blade is yours to move.*

This is the refined brief, rewritten as a build spec, followed by the systems that implement it.

---

## 1. The Perfected Prompt

**Genre.** First/third-person physics melee action. Wave-based horde survival with roguelite runs and drop-in co-op.

**Core fantasy.** You are a lone Jedi in a storm of blaster fire. Not a Jedi who *plays an animation* of deflecting — a Jedi who *actually put the blade there*. Every bolt you turn away, you turned away because your hand was in the right place at the right moment, moving the right direction.

**The one non-negotiable.** The saber is not a set of canned attacks bound to buttons. It is a rigid body with mass, inertia and reach, welded to your hand, and your mouse is your wrist. The blade can be anywhere on screen, at any angle, at any speed, at any moment. Everything else in the game is downstream of that.

**Skill curve.** A new player flails and dies to four droids. A practiced player holds a line against thirty and sends every bolt home into the chest of the droid that fired it. The gap between those two players is *mechanical skill*, not stats. No auto-block. No "press F to deflect". Assist exists only as a difficulty dial that a Master turns off.

**Depth borrowed from duelling games** (Chivalry 2, Mordhau, Half Sword) and pushed further: parries, ripostes, chambers, feints, accels/decels, drags, blade binds — but expressed through a blade with 6 degrees of freedom rather than four cardinal swing directions.

**Physics-first world.** Everything is simulated. Ragdolls are real articulated bodies, not canned death animations. Dismemberment is geometric: the mesh is cut on the plane your blade actually swept, wherever that was. Sand kicks up, water splashes, grass bends around you, props shatter, walls come down. A blast door takes twenty seconds of held blade and a shower of molten slag — because that is how long it should take.

**Force powers** as physics verbs, not damage buttons: jump, push, pull, grip-and-throw, saber throw and recall, time dilation.

**Presentation bar.** Chivalry 2 / Jedi: Survivor. HDR lighting, physically based materials, volumetric-feeling atmospherics, bloom that makes the blade the brightest thing in your life. It must never read as "a web game".

**Access.** Opens in a browser at a URL. No install, no launcher, no build step.

**Multiplayer.** Peer-to-peer co-op. One friend hosts, others join with a code.

---

## 2. The Blade — control model

The single most important system. Read this one twice.

### 2.1 Kinematics

The saber is a rigid body with a hilt pose `(p, q)` and a blade axis. It is not snapped to the hand — the *hand is snapped to it* (two-bone IK), so the character's arms, shoulders and spine are all driven by where you put the blade. This is why the animation always looks connected: there is no animation, there is a consequence.

The mouse drives a **guard point** on a sphere of radius ≈ 0.55 m centered on the chest. The blade wants to point through that guard point. But it does not get there instantly:

```
τ  = k_p · shortestArc(q, q_target) − k_d · ω        // angular spring-damper
ω += I⁻¹ τ dt
q += ½ ω q dt
```

`k_p`, `k_d` and effective inertia `I` change with grip (two-handed = stiff and strong; one-handed = loose, faster, longer reach), with stance, with stamina, and with Flow. That single equation buys you:

- **Momentum** — the blade lags behind the mouse and overshoots on a flick.
- **Accels / decels** — accelerate the mouse mid-arc and the blade whips through faster than the enemy read; decelerate and it hangs, baiting their parry early.
- **Drags** — pull the mouse backwards along the arc and the strike lands late and from an unexpected angle.
- **Feints** — reverse the mouse before contact and the blade genuinely reverses, because it is a physical object and nothing is committed.

Nothing on that list is a scripted move. They all fall out of the physics for free, which is exactly why they feel honest.

### 2.2 Blade point velocity

Contact resolution samples the blade as a swept segment across the frame, sub-stepped so a fast blade never tunnels. Velocity at a contact point `r` along the blade:

```
v(r) = v_hilt + ω × r
```

This makes **reach into speed**: the tip of the blade moves much faster than the emitter, so cutting with the tip severs cleanly while the same motion near the hilt only shoves. Real weapon behaviour, for free.

### 2.3 Deflection grades

When a bolt's swept segment crosses the blade's swept quad, the outcome is graded — not rolled:

| Grade | Condition | Result |
|---|---|---|
| **Block** | blade nearly still, contact anywhere | bolt scatters wide, small stamina chip |
| **Deflect** | blade moving into the bolt | bolt mirrors about the blade plane, can hit anything it flies into |
| **Return** | fast blade + contact within the tip third + your reticle within a cone of an enemy | bolt is redirected into that enemy |
| **Perfect Return** | Return, executed inside the 90 ms Flow window | bolt is redirected, damage ×2.5, Flow surges, hitstop |

*Return* is the mastery payoff and the reason players will keep playing. It cannot be spammed: it needs blade speed, tip contact, and your aim, simultaneously.

### 2.4 Blade-on-blade

| Action | Condition | Result |
|---|---|---|
| **Parry** | your blade intersects theirs during their windup→release | their attack stops, both blades recoil |
| **Chamber** | your blade's angular velocity opposes their swing direction within 35° during a 140 ms window before their contact | their attack is cancelled outright, you gain an instant free riposte |
| **Riposte** | any attack begun within 500 ms of a parry/chamber | +45 % blade speed, +60 % damage, cannot be chambered |
| **Bind** | both blades slow at contact | blade lock: push the mouse to win the contest, loser is staggered wide open |
| **Clash** | both blades fast at contact | sparks, mutual recoil, whoever had more momentum wins ground |

### 2.5 Flow

A meter that is only fed by precision — perfect returns, chambers, tip cuts, near-misses. Flow grants time dilation on the *inputs that deserve it* (a hair of slow-mo on a perfect deflect), tighter spring constants (a steadier blade), and a brighter trail. It bleeds away when you are hit or when you flail. It is the game telling you, visually and mechanically, that you are getting good.

### 2.6 Camera

The perpetual problem of "the mouse has two jobs" is not solved by splitting the
mouse between them — it is solved by making the guard a STATE instead of a
position, so it never needs the mouse held anywhere:

- **Directional Guard (default).** Four zones — high, left, right, low — each set
  by a flick. Slow aiming never disturbs your guard; a flick past the gate sets
  it. The camera stays live the whole time, which is the entire point: measured
  on the same bolt, this scheme sweeps 30.0° of yaw during a block where
  Hold-to-Blade swept exactly 0.0°. A bolt is answered if its zone matches
  yours, and your guard covers your centreline plus one quadrant — a shot inside
  a 20° disc has no meaningful direction to have come from, and past 20° of
  bearing you need the right zone. Enter the zone inside the parry window and
  you get the return.
- **Free Blade (option).** The mouse always moves the blade; the camera is
  dragged only when the blade leaves an inner deadzone. Hold **RMB** to pin the
  blade and look around.
- **Hold-to-Blade (option).** Classic split: mouse looks, hold **LMB** to take
  the blade. This was the default, and it is the scheme the player described as
  "when you're moving the blade to specifically deflect the cursor can't move".
- **First person** for maximum immersion and reach reading, **third person** for
  spatial awareness. Both fully modelled.

---

## 3. Cutting and destruction

**Geometric, not tagged.** When the blade sweeps through a body, the sweep defines a plane. The mesh is cut *on that plane*. Cut a droid's forearm halfway and you get a half forearm. There is no list of valid cut points.

**Cauterisation.** Cut faces are capped with a glowing molten disc that cools from white through orange to black over a few seconds, with smoke and dripping sparks. No blood — a lightsaber does not bleed things.

**Severance drives physics.** Cutting a joint removes the constraint. The distal ragdoll inherits the parent's velocity plus the blade's impulse. A leg cut mid-stride sends the body tumbling exactly as it should, because nothing about that was authored.

**Material resistance.** Cut rate is `bladeSpeed × sharpness / material.toughness`. Flesh and plastoid part instantly. Durasteel takes a slow, deliberate push. A **blast door** is a hold: you drive the blade in, a molten kerf traces the exact path you carve, slag runs down the metal, and when your traced loop closes the slug falls out and clangs. Twenty seconds of tension, entirely player-driven.

---

## 4. Force

| Power | Verb |
|---|---|
| **Jump** | real impulse, real arc, air control, landing shockwave that scatters sand and staggers |
| **Push** | radial impulse cone; ragdolls fly, props become projectiles, bolts scatter |
| **Pull** | reel an enemy in — into your blade if you time it |
| **Grip** | lift any dynamic body, orbit it with the mouse, hurl it |
| **Throw saber** | the blade leaves your hand as a physical spinning body that cuts everything on its path, and returns on an arc you steer |
| **Sense** | time dilation; the world slows, your blade does not |
| **Repulse / Lightning / Heal** | unlocked as run boons |

---

## 5. Enemies

| Unit | Threat |
|---|---|
| **B1 Battle Droid** | horde filler, poor aim, cuts like paper |
| **B2 Super Battle Droid** | armoured, wrist cannon, needs real cuts |
| **Droideka** | rolls in, deploys a bolt-proof shield — the shield is porous to a *slow* blade, so you must walk it in |
| **Clone Trooper** | disciplined bursts, uses cover, throws grenades |
| **Sniper** | telegraphed beam then a lethal shot — deflect it or die |
| **Acolyte** | duelist AI that feints, chambers, ripostes and punishes greed |
| **Spider Walker** | cut the legs and it topples, physically |
| **Acklay** | boss beast, huge physics mass, real staggering |

All of them respect the same physics you do. All of them can be cut anywhere.

---

## 6. Run structure

Levels: **Dune Sea** (open dunes, sandstorm, wind-driven sand), **Geonosis Arena** (the execution arena, pillars, sand, beasts), **Hangar Bay** (blast doors, crates, cover, industrial light), **Temple Steps** (verticality, water, statuary).

Difficulties: **Padawan → Knight → Master → Grandmaster.** These change assist cone, enemy accuracy and aggression, deflect window widths, and damage. Grandmaster has zero assist.

Waves escalate with a spawn budget. Every third wave, draft one of three **boons** — Vaapad, Soresu, Ataru, Djem So, saber-throw upgrades, Force cost reductions, blade properties. Runs are built, not saved.

---

## 7. Technical

- **Renderer** — WebGL2 / Three.js, HDR half-float pipeline, ACES filmic tonemapping, PBR materials, fitted cascade shadows, threshold bloom, custom composite pass (grain, chromatic aberration, vignette, heat haze off the blade, grade).
- **Physics** — Rapier (WASM, vendored) for the world: real cuboids, cylinders, convex hulls from mesh vertices, compound colliders, a terrain heightfield, continuous collision detection, islands and sleeping. Alongside it, the original bespoke sequential-impulse sphere solver still runs the ragdolls, because a body that can be taken apart mid-flight needs a collider that can be rebuilt mid-flight.
- **Content** — procedural apart from the soundtrack. Meshes, skeletons, materials, textures, animation and every sound *except the score* are generated in code, so there is nothing to download and every character can be sliced because every character was built to be. The score is one streamed MP3 (`assets/music/theme.mp3`, 29.4 MB, licensed); the Music slider at 0 means it is never fetched.
- **Animation** — no clips. Gait solver with terrain foot IK, two-bone arm IK to the hilt, spine counter-rotation from blade momentum, additive hit reactions.
- **Audio** — WebAudio synthesis. The hum is an oscillator bank whose pitch and amplitude track blade speed, so the saber *sings when you move it*.
- **Netcode** — WebRTC peer-to-peer. Host simulates enemies and waves; each player is authoritative over their own blade so it never feels laggy where it matters most.
- **Delivery** — static files, no build step, no bundler.

---

## 8. Bar of quality

The blade must feel like it has weight. The sand must move. The droid you cut in half must fall the way a cut-in-half droid falls. When you turn a bolt back into the chest of the thing that fired it, you must feel it in your hands.

Anything less is a web game.
