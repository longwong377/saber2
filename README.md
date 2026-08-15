# SABER

> *A single blade against a hundred.*

A physics-driven lightsaber game that runs in a browser tab. No install, no
launcher, no build step — the repository *is* the game.

> **Working on it?** Read [HANDOFF.md](HANDOFF.md) first. It carries the traps —
> the loader that must be used, the container that rolls the clone back, and the
> four occasions a harness invented a defect that was not there.

The premise: you do not press a button and watch a deflection animation. The
blade is a rigid body with mass, inertia and reach, welded to your hand, and
your mouse is your wrist. Every bolt you turn away, you turned away because your
hand was in the right place at the right moment, moving the right direction.

---

## Play it

**Locally** — clone and serve the folder. Any static server works:

```bash
git clone https://github.com/longwong377/saber2.git
cd saber2
node tools/serve.mjs        # → http://localhost:8080
```

or, without cloning anything at all:

```bash
npx serve .                 # or:  python3 -m http.server 8080
```

Then open the URL. That is the whole setup — there is nothing to install and
nothing to compile.

**On the web** — the repository is a static site, so it deploys as-is to GitHub
Pages, Netlify, Cloudflare Pages, or anything that serves files.

A Pages workflow is included at `.github/workflows/pages.yml`. It needs one
click first: **Settings → Pages → Source: “GitHub Actions”**. (GitHub's default
workflow token is not permitted to create a Pages site that doesn't exist yet,
so the workflow fails until a human flips that switch — after which every push
publishes automatically to `https://longwong377.github.io/saber2/`.)

Opening `index.html` straight off disk will *not* work: browsers refuse to load
ES modules over `file://`. The page says so if you try.

Requires WebGL2 — any current Chrome, Edge, Firefox or Safari. Click the canvas
to capture the mouse; `Esc` releases it.

---

## The controls

| | |
|---|---|
| **Mouse** | Moves the **blade**, not the camera. The camera follows when the blade leaves the centre. |
| **RMB** | Hold to pin the blade and look around freely. |
| **LMB** | Thrust — drives the hands forward along the blade. |
| **W A S D** | Move. `Shift` sprint, `Ctrl` crouch, `Shift`+direction dashes. |
| **Space** | Force jump. *Hold* while rising to pour the Force into the leap. |
| **Q / E** | Roll the wrist — changes the plane your blade cuts on. |
| **F** | Force push. `Shift+F` pulls. |
| **G** | Grip an object; move the mouse to swing it, middle-click to hurl it. |
| **R** | Throw the saber. Press again to recall it. |
| **C** | Force sense — the world slows, you do not. |
| **V** | First / third person. **X** ignite / retract. |

Prefer the classic split? **Options → Control → Hold to Blade** makes the mouse
look and `LMB` take the blade.

---

## The four things that make a master

1. **Return, don't block.** A still blade scatters a bolt. A blade moving *into*
   the bolt mirrors it. A fast tip with an enemy under your reticle sends it back
   through their chest.
2. **Chamber.** When a duellist swings, whip your blade *against* the direction of
   their arc. Their attack dies and yours is already free.
3. **Drag and accelerate.** Your blade has mass. Slow the mouse mid-arc and the
   strike lands late, past their parry. Snap it and you arrive early.
4. **Cut with the tip.** The end of the blade travels many times faster than the
   emitter. That is where limbs come off.

---

## What's in it

**The blade.** A guard point on a sphere in front of your chest, driven by the
mouse. The hands follow it partway; the blade points from the hands through the
guard point. Both are integrated through a spring-damper with real inertia, so
the weapon lags a flick, overshoots a snap by about a tenth of the arc, and hangs
when you decelerate. Accels, decels, drags and feints are not moves in a list —
they are what happens when a heavy object is attached to your wrist and you
change your mind.

**Cutting.** Geometric, not tagged. A limb is a tube of known length, so a blade
crossing it at 62 % rebuilds the stub at 0.62·L, builds a new tube for the rest,
caps both faces with a molten disc that cools from white through orange to black,
and hands the severed piece — with everything hanging off it — to the solver with
the blade's momentum already in it. Props are cut on the plane the blade actually
swept, so a crate cut corner-to-corner gives two wedges. Cut rate is
`bladeSpeed × sharpness / toughness`: plastoid parts instantly, durasteel takes a
deliberate push, and a **blast door** takes twenty seconds of held blade, a
traced molten kerf and a shower of slag before the slug falls out and clangs.

**Physics.** The world runs on Rapier, so everything in it is the shape it looks
like: cuboids for crates, cylinders for drums and columns, convex hulls built
from the actual vertex data for anything irregular, compound colliders for props
made of several parts, and the terrain as a real heightfield. A crate tips off a
ledge instead of rolling off it, a stack stays a stack, and continuous collision
detection keeps a hurled object out of the geometry it used to tunnel through.

Ragdolls are still the bespoke sphere solver's, because cutting a limb rebuilds
that limb's collider mid-flight and spheres make that trivial. The two engines
share the terrain and the architecture, so a corpse still lands on the ground.

**Force.** Jump, push, pull, grip-and-hurl, saber throw and recall, and time
dilation — all of them physics verbs rather than damage buttons.

**Enemies.** B1s, super battle droids, clone troopers, marksmen with a telegraphed
beam, droidekas that deploy a bolt-proof shield you have to walk a slow blade
through, duellist acolytes that feint and chamber, spider walkers that topple when
you take their legs, and an acklay. All of them cut anywhere.

**Runs.** Four theatres, four difficulties (Grandmaster has zero assist), a wave
director that spends a threat budget rather than reading a script, and sixteen
boons drafted three at a time.

**Co-op.** Peer-to-peer. One player hosts, the rest join with a code. The host
simulates the horde; each player's blade is resolved on their own machine,
because enemy positions tolerate 80 ms of interpolation and a blade does not.

**Content.** All of it is generated in code — meshes, skeletons, materials,
textures, animation and audio. Nothing to download, nothing to license, and every
character can be cut apart because every character was built to be. The saber hum
is an oscillator bank whose pitch and filter track blade speed, so the weapon
sings when you move it.

There are no animation clips. Feet are planted by a gait solver against the
terrain, arms are IK'd to wherever the blade currently is, and the spine
counter-rotates against the blade's momentum. The character always looks
connected to the weapon because it is, structurally, downstream of it.

---

## Development

```
node tools/verify.mjs     # 34 headless checks of the mechanics — no GPU needed
node tools/smoke.mjs --shots   # boots the real game in Chromium, screenshots it
node tools/serve.mjs      # play it
```

`verify.mjs` is the one that matters. It asserts things like *a fast sweep across
a forearm severs it at the crossing point*, *a motionless blade does not*, *a
still blade blocks while a fast tip returns*, and *a ragdoll settles instead of
exploding*. It found five real bugs during development, including a left-handed
basis in the bone-aiming maths that was silently mirroring every joint in the
game, and a sign error that made every ball joint fly apart.

Layout:

```
src/engine/    renderer, HDR post stack, input, synthesised audio, texture foundry
src/physics/   Rapier for the world, the bespoke sphere solver for ragdolls
src/game/      blade control, combat resolution, bodies, rigs, dismemberment,
               enemies, waves, levels, the world loop
src/world/     terrain, particles, props, slicing, scenery
src/net/       peer-to-peer co-op
src/ui/        HUD and menus
vendor/        three.js and peerjs, committed so there is nothing to install
```

Everything is plain ES modules loaded through an import map. The same source runs
under Node for testing via a resolver hook (`tools/three-resolver.mjs`), so there
is exactly one copy of the code.

See [`DESIGN.md`](DESIGN.md) for the full design spec.

---

## Honest limits

This is one repository, not a studio. The bar it clears is *"a real game with real
systems that plays well and looks good in a browser"* — not shot-for-shot
Jedi: Survivor. Specifically:

- Characters are procedurally assembled from primitives rather than sculpted and
  hand-textured. They read well in motion and at combat distance; they are not
  scanned actors.
- Destruction is convex slicing plus chunking, not a full fracture simulation.
  Concave props fall back to shattering.
- Co-op is trusted peer-to-peer for playing with friends. There is no
  anti-cheat, and there is no matchmaking beyond sharing a code.
- Multiplayer signalling uses the public PeerJS broker by default. Set
  `window.SABER_SIGNAL` to point at your own.
