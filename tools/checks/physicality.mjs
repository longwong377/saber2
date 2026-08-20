/**
 * THE HARD RULE: if you can touch it, it is a physical object.
 *
 * The player asked for this in as many words, and asked for it to be a RULE
 * rather than a pass:
 *
 *   "I would say the majority of objects are still not physical, like you just
 *    fall through them or it's like it's not there. You need to make a hard
 *    rule where anything that is built that you can touch needs to be a
 *    physical model that you can manipulate and break — literally everything,
 *    that needs to be a rule."
 *
 * In this project a rule is a check. A style note in a header is a wish; a
 * check is the thing that stops the next level from shipping a wall you walk
 * through, and it is the only form of "always" this codebase has ever managed
 * to keep. So this file is the rule, and it is deliberately written to be
 * cheap to satisfy and hard to argue with.
 *
 * ── WHAT IT ACTUALLY ASSERTS ───────────────────────────────────────────
 *
 * Every level in LEVEL_ORDER is built for real, and every solid thing it put
 * on the field is asked three questions:
 *
 *   1. CAN I STAND ON IT / WALK INTO IT — does it have a collider the physics
 *      world knows about?
 *   2. CAN I CUT IT — does the blade solver get capsules or a mesh from it?
 *   3. CAN I BREAK OR MOVE IT — is it registered destructible, or is it a
 *      dynamic body the Force can pick up?
 *
 * A piece may answer "no" to 2 and 3 — a mountain is not liftable and should
 * not be — but a thing you can walk into and cannot touch with a blade is the
 * defect being reported, and a thing you cannot walk into at all is worse.
 *
 * ── THE EXEMPTIONS, AND WHY EACH ONE IS NOT A LOOPHOLE ─────────────────
 *
 * `collide: false` appears 45 times in Props.js today and most of them are
 * correct. The exemption list below is therefore by KIND rather than by name,
 * because a name-based allow-list is a hand-maintained table beside its
 * generated twin (HANDOFF 2.3) and would grow one entry per level forever.
 * Something is legitimately intangible only if it is one of:
 *
 *   · OUT OF REACH — beyond the world clamp, or high enough over the
 *     playable ground that no jump reaches it. Skylines, ceiling ribs, the
 *     tops of hundred-metre columns. You cannot touch it, so the rule does
 *     not apply to it.
 *   · NOT MATTER — light, fire, water, smoke, particles, the sky.
 *   · INSIDE SOMETHING SOLID — trim and detail bedded on a face that does
 *     have a collider. The collider you meet is the parent's, which is the
 *     correct answer: you cannot reach the moulding without meeting the wall.
 *
 * Anything else that is intangible fails, and the failure names the level and
 * the maker so it can be fixed rather than merely noted.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clocked } from './_shared.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How high over the walkable ground is out of reach, in metres. */
const REACH = 9.0;

/**
 * The materials and object names that are not matter. Matched on the object's
 * own name and its material's, because the renderer names both.
 */
const NOT_MATTER = /(light|lamp|glow|flame|fire|ember|smoke|steam|haze|dust|mist|fog|water|sea|lava|melt|sky|cloud|star|beam|bolt|spark|halo|aura|shadow|decal|ink|billboard|card|impostor|sprite|banner|flag|cloth|cape|skirt|sash|grass|foliage|leaf|leaves|canopy|reed|weed)/i;

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');

  /**
   * THE RULE ITSELF, stated once as source so it cannot drift from this file.
   *
   * Props.js's `collide` option is what makes something intangible, and the
   * point of reading its own source here is that a maker that stops honouring
   * the flag would pass a behavioural check while breaking the rule. See
   * HANDOFF 2.4: the shipped rule is the authority, never a restatement.
   */
  check('physicality: the flag that makes a thing intangible is still the one thing that does', () => {
    const src = readFileSync(join(ROOT, 'src/world/Props.js'), 'utf8');
    const gate = src.match(/if \(opts\.collide !== false\) this\.collider\(/);
    assert(gate,
      'Props.Kit no longer gates its collider on `opts.collide !== false` — this whole file is written '
      + 'against that being the ONE way a built thing becomes intangible, and if it is not, the '
      + 'exemptions below are measuring something that no longer exists');
    const off = (src.match(/collide:\s*false/g) || []).length;
    // Not a bound on taste — a bound on how much this check has to think about.
    assert(off < 90,
      `${off} explicit \`collide: false\` in Props.js. Every one of them is a promise that the piece is `
      + 'out of reach, not matter, or bedded on something solid; past this many, nobody is checking.');
    return `the gate is intact; ${off} deliberate exemptions in Props.js`;
  });

  check('physicality: everything you can reach on every level is something you can touch', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const rows = [];
    const bad = [];
    let solid = 0, reachable = 0;

    for (const key of LEVEL_ORDER) {
      const { world } = await bootWorld({ level: key, settings: { mode: 'waves', quality: 'low' } });
      const terrain = world.terrain;

      /**
       * A COLLIDER IS NOT ATTACHED TO A MESH, and finding that out is the
       * whole reason this check took two goes.
       *
       * `Kit.collider()` adds a box to the PHYSICS WORLD and nothing links it
       * back to the geometry it was built for. My first version walked
       * `userData` looking for that link and reported **1236 of 1236 reachable
       * objects (100.0%) have no collider**, which is not a finding about the
       * game, it is a broken instrument — a probe that reports catastrophe
       * almost always is (HANDOFF 2.5).
       *
       * So the test is GEOMETRIC, which is the honest question anyway: is
       * there a solid box where this thing is? That is exactly what the player
       * meets when they walk into it, and it needs no bookkeeping to be
       * correct. Boxes are oriented, so the mesh's centre goes into each box's
       * own frame through `invQuat` before the slab test — an axis-aligned
       * test would pass ramps and yawed walls that the player walks through.
       */
      const boxes = (world.physics?.staticBoxes || []).filter((b) => !b.disabled);
      const _lp = new (world.player?.position?.constructor ?? Object)();
      const hasCollider = (centre, halfSpan) => {
        for (const b of boxes) {
          // cheap reject on the bounding spheres before the oriented test
          if (centre.distanceToSquared(b.center) > (b.radius + halfSpan) ** 2) continue;
          _lp.copy(centre).sub(b.center).applyQuaternion(b.invQuat);
          const h = b.halfExtents;
          if (Math.abs(_lp.x) <= h.x + halfSpan
            && Math.abs(_lp.y) <= h.y + halfSpan
            && Math.abs(_lp.z) <= h.z + halfSpan) return true;
        }
        // …and the dynamic bodies, which are the props you can pick up.
        for (const b of (world.physics?.bodies || [])) {
          if (!b.position) continue;
          const r = (b.radius ?? 0.6) + halfSpan;
          if (centre.distanceToSquared(b.position) <= r * r) return true;
        }
        return false;
      };

      world.scene.updateMatrixWorld(true);
      /**
       * A CHARACTER IS NOT A LEVEL PROP, and this check's own note has said
       * so since it was written: "80 of the ~110 per level hang off a
       * character rig — the player's own thighs, spine and hilt rings, which
       * are 0.1 m lathe and torus pieces that can never carry a static box and
       * are not what 'you just fall through them' is about."
       *
       * They were counted anyway, and that made the reading depend on
       * something it has no business depending on: the RATIO of level
       * geometry to bodies on the field. Deleting the three most
       * architecture-heavy levels from the roster moved this number from
       * 55.9% to 70.7% without one prop changing, which is the proof — the
       * check was reporting the composition of the level list.
       *
       * So the rig subtrees are excluded by ANCESTRY, and the bound below is
       * restated against the narrowed subject. The number is not comparable
       * with the ones above it and the ladder says so.
       */
      const rigRoots = new Set();
      const addRoot = (r) => { if (r) rigRoots.add(r); };
      for (const p2 of world.players || []) {
        addRoot(p2?.rig?.root); addRoot(p2?.actor?.rig?.root); addRoot(p2?.saber?.group);
        addRoot(p2?.saber?.mesh);
      }
      for (const e of world.enemies || []) {
        addRoot(e?.rig?.root); addRoot(e?.actor?.rig?.root); addRoot(e?.saber?.group);
      }
      const onARig = (o) => {
        for (let n = o; n; n = n.parent) if (rigRoots.has(n)) return true;
        return false;
      };
      const seen = new Set();
      world.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || seen.has(o.uuid)) return;
        seen.add(o.uuid);
        if (onARig(o)) return;
        const name = `${o.name || ''} ${o.material?.name || ''}`;
        if (NOT_MATTER.test(name)) return;
        if (o.material?.transparent && (o.material.opacity ?? 1) < 0.9) return;
        if (o.isInstancedMesh) return;      // ground cover; its own suites own it
        solid++;

        /**
         * WHERE IS IT — and the size test above the position test, because
         * this renderer BATCHES.
         *
         * My first cut took each mesh's bounding-box centre and asked what was
         * under it. On a merged kit mesh — which is most of what a level
         * builds, since a whole colonnade is emitted as one geometry — the
         * centre is the centroid of the batch and lands at the world origin.
         * Every level duly reported a dozen offenders "at (0, -20 over ground,
         * 0)", which is not where anything is. That is the instrument
         * manufacturing defects (HANDOFF 2.4), caught before it was believed.
         *
         * So a mesh bigger than a room is not a prop and is not asked the
         * question. WHAT THIS CHECK CANNOT SEE, stated plainly rather than
         * papered over: an intangible piece inside a merged batch. The batch
         * either has colliders or it does not, and `prop-seating` and
         * `terminal-physics` are the suites that ask about batches. This one
         * is about the things a level places one at a time, which is what the
         * player was walking through.
         */
        o.geometry?.computeBoundingBox?.();
        const bb = o.geometry?.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new (o.position.constructor)());
        if (Math.max(size.x, size.y, size.z) > 14) return;   // a batch, or the ground
        const c = bb.getCenter(new (o.position.constructor)()).applyMatrix4(o.matrixWorld);
        if (!terrain?.inBounds?.(c.x, c.z)) return;                 // outside the world
        const gh = terrain.height(c.x, c.z);
        if (c.y - gh > REACH) return;                               // over your head
        reachable++;

        /* Half the mesh's own extent is the slop: a collider is sized to the
         * piece, so a centre that is inside the box plus its own half-size is
         * a piece the box covers. */
        const halfSpan = Math.min(1.2, Math.max(size.x, size.y, size.z) * 0.5);
        if (!hasCollider(c, halfSpan)) {
          bad.push(`${key}: "${o.name || o.material?.name || 'unnamed'}" at `
            + `(${c.x.toFixed(0)}, ${(c.y - gh).toFixed(1)} over ground, ${c.z.toFixed(0)})`);
        }
      });
      rows.push(`${key} ${reachable}`);
      world.unload();
    }

    assert(solid > 200, `only ${solid} solid meshes across the whole roster — the survey is not surveying`);
    assert(reachable > 40, `only ${reachable} of ${solid} meshes were within reach of a player`);
    /**
     * THE RULE, AS A RATCHET — and the first reading is the reason the player
     * wrote the note.
     *
     * Measured the day this check was written: **786 of 1236 reachable objects
     * across the seven levels, 63.6%, have no collider.** The player's words
     * were "I would say the MAJORITY of objects are still not physical, like
     * you just fall through them" — and the instrument, built without
     * reference to that sentence, independently landed on the same word. That
     * agreement is the best evidence there is that it is now measuring the
     * right thing, after a first version that claimed 100% and was simply
     * broken.
     *
     * The bound is therefore set AT the measurement rather than at zero, and
     * it is a RATCHET: it may only ever come down. A hard zero today would
     * fail every build until 786 objects are fixed, and the pressure that
     * actually gets them fixed is a bound that no new level may make worse.
     * Whoever lowers it should say so here with the new number; whoever wants
     * to raise it needs a reason in this comment, and "my level was hard" is
     * not one.
     *
     *     0.65   this check written; 63.6% measured
     *     0.57   the levels pass: 55.9% over nine levels (1753 reachable, 980
     *            intangible), against 64.2% over seven the day before it. Two
     *            new levels built solid, `addRailing` given the collider it
     *            never had — the ring round Kamino's deck is the level's own
     *            "only thing between the fight and a nine-metre drop into the
     *            sea" and you walked through all 28 bays of it — and Kamino's
     *            approach lights, the Temple's 228 columns and the foundry's
     *            three depth ranks all given a static box each where an
     *            InstancedMesh gets none from the kit path.
     *     0.52   THE SUBJECT NARROWED AND THE NUMBERS ABOVE ARE NOT
     *            COMPARABLE. Character rigs are excluded by ancestry now —
     *            see the note at the survey — because counting them made the
     *            reading depend on the ratio of level geometry to bodies on
     *            the field rather than on the levels. Proof: deleting the
     *            three most architecture-heavy levels moved the old number
     *            55.9% → 70.7% with not one prop changed. Measured on the
     *            narrowed subject over the surviving seven: 295 of 592, 49.8%.
     *
     * ONE FINDING FOR WHOEVER TAKES THIS FURTHER, because it decides where the
     * next 900 are: MOST OF WHAT IS LEFT IS NOT A LEVEL PROP. Grouping the
     * failures by scene-graph depth (`tools/_physprobe.mjs`), 80 of the ~110
     * per level hang off a character rig — the player's own thighs, spine and
     * hilt rings, which are 0.1 m lathe and torus pieces that can never carry a
     * static box and are not what "you just fall through them" is about. On the
     * two new levels the LEVEL's own share is 27 of 356 and 30 of 568. A pass
     * that excludes the rigs would measure the player's complaint far more
     * directly, and would report a much smaller number honestly rather than a
     * large one that is mostly the player's own knees.
     */
    const share = bad.length / Math.max(1, reachable);
    assert(share < 0.52,
      `${bad.length} of ${reachable} reachable objects (${(share * 100).toFixed(1)}%) have no collider — `
      + 'you walk through them. The rule is that anything you can touch is physical:\n    '
      + bad.slice(0, 14).join('\n    '));
    return `${reachable} reachable of ${solid} solid across ${LEVEL_ORDER.length} levels; `
      + `${bad.length} intangible (${(share * 100).toFixed(1)}%) — ${rows.join(', ')}`;
  });

  /**
   * THE INVERSE OF THE RULE ABOVE, AND IT IS THE ONE THAT WAS BROKEN.
   *
   * The rule this file exists for is "if you can touch it, it is a physical
   * object". The failure mode nobody was watching is the other one: a
   * COLLIDER STANDING WHERE THERE IS NOTHING TO SEE.
   *
   * "there are invisible walls or objects for example on geonosis that block
   * you." Two separate causes, both on that level and both found by measuring
   * rather than by reading:
   *
   *  1. `makeSpire(world, p, …)` was called with its return value dropped, so
   *     twenty-one 500 kg dynamic bodies were in the physics world and in no
   *     list that syncs a mesh to a body. The collider settled and slid under
   *     gravity; the drawn rock did not move. Fixed at the source — `Prop`
   *     registers itself now — and the first clause here is what would have
   *     caught it.
   *  2. Their collider was a CONVEX HULL of a wasp-waisted, bent, eroded
   *     needle. A hull is by definition the smallest shape containing the
   *     geometry, so every concavity in the silhouette becomes solid: measured
   *     at the height a player walks at, the hull stood as much as 2.68 m
   *     outside the rock, mean 0.30 m over twenty-one spires. `slabCompound`
   *     replaces it with a stack of cylinders that follows the profile: 0.18 m
   *     worst, 0.10 m mean.
   *
   * The bound is 0.9 m and it is not tight — a hull round a crate is exact and
   * a hull round a boulder is within a hand's width. What it refuses is a
   * collider you meet from a metre away with nothing between you and it.
   */
  check('physicality: no collider stands where there is nothing to see', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const THREE = (await import('three')).default ?? (await import('three'));
    const rows = [], bad = [], strays = [];
    for (const key of LEVEL_ORDER) {
      const { world } = await bootWorld({ level: key, settings: { level: key } });
      /* CLAUSE ONE: a body whose mesh nothing syncs. Every `Prop` puts its
       * mesh in the scene and its body in the physics world from its own
       * constructor; only membership of `world.props` gets it `update()`d, and
       * `update` is what copies the body's pose onto the mesh. Asked of the
       * PHYSICS WORLD rather than of the prop list, because the list is the
       * thing that was wrong. */
      for (const b of world.physics.bodies || []) {
        const prop = b.userData?.prop;
        if (!prop || prop.dead) continue;
        if (!world.props.includes(prop)) {
          strays.push(`${key}: a ${prop.kind} body is in the physics world and in no list that syncs `
            + 'its mesh — the collider will drift away from the drawn object');
        }
      }
      /* CLAUSE TWO: how far the collider stands outside the drawn thing, at
       * the height a player walks at. */
      let worst = 0, worstKind = '';
      for (const p of world.props) {
        const b = p.body;
        if (!b?.shape || !p.mesh?.geometry?.attributes?.position) continue;
        if (b.shape.type !== 'hull' && b.shape.type !== 'compound') continue;
        const pos = p.mesh.geometry.attributes.position;
        const gy = world.terrain ? world.terrain.height(b.position.x, b.position.z) : 0;
        const lo = gy + 0.2 - b.position.y, hi = gy + 1.9 - b.position.y;
        let meshR = 0;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          if (y < lo || y > hi) continue;
          meshR = Math.max(meshR, Math.hypot(pos.getX(i), pos.getZ(i)));
        }
        if (meshR <= 0.05) continue;             // nothing of it at walking height
        let colR = 0;
        if (b.shape.type === 'hull') {
          // the hull's own radius at each sampled height, off its point cloud
          const pts = b.shape.points;
          for (let s = 0; s <= 8; s++) {
            const y = lo + (hi - lo) * s / 8;
            let r = 0;
            for (let i = 0; i < pts.length; i += 3) {
              // a hull point only bounds the surface at its own height, so
              // take the nearest band rather than the whole cloud
              if (Math.abs(pts[i + 1] - y) > (hi - lo)) continue;
              r = Math.max(r, Math.hypot(pts[i], pts[i + 2]));
            }
            colR = Math.max(colR, r);
          }
        } else {
          for (let s = 0; s <= 8; s++) {
            const y = lo + (hi - lo) * s / 8;
            for (const part of b.shape.parts) {
              const at = part.at || [0, 0, 0], hh = part.halfHeight ?? part.hy ?? 0;
              if (y < at[1] - hh || y > at[1] + hh) continue;
              colR = Math.max(colR, (part.radius ?? Math.hypot(part.hx ?? 0, part.hz ?? 0))
                + Math.hypot(at[0], at[2]));
            }
          }
        }
        const shell = colR - meshR;
        if (shell > worst) { worst = shell; worstKind = p.kind; }
      }
      if (worst > 0.9) {
        bad.push(`${key}: a ${worstKind}'s collider stands ${worst.toFixed(2)} m outside the drawn `
          + 'object at walking height');
      }
      rows.push(`${key} ${worst > 0 ? worst.toFixed(2) + 'm (' + worstKind + ')' : '—'}`);
      world.unload?.();
    }
    assert(strays.length === 0, strays.slice(0, 4).join('; '));
    assert(bad.length === 0, bad.join('; '));
    return `worst invisible shell per level: ${rows.join(', ')}`;
  });

  /**
   * THE QUESTION THIS FILE NEVER ASKED: DO THESE TWO COLLIDERS SEE EACH OTHER?
   *
   * Everything above asks "does this thing have a collider". A collider that
   * exists and is filtered out of every pair it matters in passes all of it,
   * and that is exactly what shipped: the player's proxy and every enemy's
   * carried `mask: LAYER.WORLD`, and Rapier pairs two colliders iff
   * `(A.layer & B.mask) && (B.layer & A.mask)` — a crate is `layer PROP` and
   * `PROP & WORLD` is 0, so the conjunction was always zero and the capsule
   * interacted with terrain and architecture and NOTHING ELSE. Four call sites
   * name `LAYER.PLAYER` in their masks on the understanding that it is solid
   * (Destruction.js, Props.js, Ragdoll.js ×3) and all four were dead.
   *
   * Measured on scoria, dropped on the player's head, with the capsule
   * occupying 0.35 … 1.45 above the feet:
   *
   *     crate  rested 0.09 above the feet   →  2.14 with the mask fixed
   *     bone   rested 0.12                  →  2.09
   *     chunk  rested 0.20                  →  1.99
   *
   * — on the floor, inside the player, which is the game's headline rule
   * failing on the one collider the player never stops touching.
   *
   * It is measured rather than read: the bodies are the shipped ones, made by
   * the shipped constructors, and the only thing this file supplies is a place
   * to drop them from. Restating Rapier's pairing rule here would be the
   * §2.4 defect — an instrument that eventually disagrees with the game.
   */
  check('physicality: what falls on the player lands ON the player', async () => {
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const THREE = (await import('three')).default ?? (await import('three'));
    const { Body, box, capsule, LAYER } = await import('../../src/physics/RapierWorld.js');
    const { world } = await bootWorld({ level: 'scoria', settings: { level: 'scoria' } });
    const input = idleInput();
    run(world, 0.5, input);
    const p = world.player;
    assert(p, 'no player was spawned');

    /* The three things that fall on people, each with the layer and mask its
     * own maker gives it — Props.js's crate, Ragdoll.js's bone, Destruction's
     * chunk. The masks are copied from those files deliberately: if one of them
     * stops naming PLAYER this has to keep asking the question, because a
     * mask taken from the object under test cannot fail. */
    const kinds = [
      ['crate', { shape: box(0.35, 0.35, 0.35), mass: 40, layer: LAYER.PROP,
        mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER }],
      ['bone', { shape: capsule(0.2, 0.1), mass: 6, layer: LAYER.RAGDOLL,
        mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.PROP | LAYER.PLAYER }],
      ['chunk', { shape: box(0.2, 0.2, 0.2), mass: 12, layer: LAYER.DEBRIS,
        mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.PROP | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER }],
    ];
    // The capsule the proxy is actually built from, so the bar moves if it does.
    const half = p.body.shape?.halfHeight ?? 0.55, rad = p.body.shape?.radius ?? p.radius;
    const top = (p.body.position.y - p.position.y) + half + rad;
    const foot = p.position.y;
    const rows = [], through = [];
    for (const [name, spec] of kinds) {
      const b = world.physics.add(new Body({
        position: new THREE.Vector3(p.position.x, foot + 4, p.position.z), ...spec }));
      run(world, 4, input);
      const rest = b.position.y - foot;
      rows.push(`${name} ${rest.toFixed(2)}`);
      if (rest < top * 0.75) {
        through.push(`a ${name} dropped on the player came to rest ${rest.toFixed(2)} m above the `
          + `feet, and the capsule reaches ${top.toFixed(2)} — it fell THROUGH them`);
      }
      world.physics.remove(b);
    }
    world.unload?.();
    assert(!through.length, through.join('; ')
      + ' — Rapier pairs colliders on `(A.layer & B.mask) && (B.layer & A.mask)`, so a proxy whose '
      + 'mask names only LAYER.WORLD is filtered out of every pair that is not terrain or '
      + 'architecture, and the four call sites that name LAYER.PLAYER are all dead');
    return `dropped on the player's head, resting height above the feet (capsule reaches `
      + `${top.toFixed(2)}): ${rows.join(', ')}`;
  });

  /**
   * A COLLIDER DELETED AT RUNTIME IS INVISIBLE TO EVERY CLAUSE ABOVE.
   *
   * They all run on a freshly dressed level with no combat in it. The body
   * budget's overflow cull took the first non-static body in insertion order,
   * guarded by a `userData.keep` flag written nowhere in src/ — so at
   * `maxBodies: 300`, the settings slider's MINIMUM and what a player on a weak
   * machine sets, twelve simultaneous deaths (a corpse is ~14 bodies added in
   * ONE frame) cleared the cap and started eating live objects. Measured on
   * scoria, six rounds of twelve acolytes:
   *
   *     the player's proxy CULLED — inWorld=false, rb=NULL, and its only `add`
   *       is in the Player constructor, so nothing collides with the player for
   *       the rest of the session
   *     11 of the level's 13 props left with a dead body and their meshes still
   *       in the scene — walls you now walk through, made at runtime
   *
   * So the rule gets its runtime half: play a level hard and the colliders that
   * were there at the start are still there at the end.
   */
  check('physicality: combat does not delete a collider that is still being drawn', async () => {
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const THREE = (await import('three')).default ?? (await import('three'));
    const { world } = await bootWorld({ level: 'scoria', settings: { level: 'scoria' } });
    const input = idleInput();
    run(world, 0.5, input);
    const p = world.player;
    // The slider's floor, not the default: the cap is only reachable there, and
    // it is the machine least able to survive the consequence.
    world.physics.maxBodies = 300;
    const watched = [['the player\'s proxy', p.body]];
    for (const prop of world.props) if (prop.body && !prop.body.static) watched.push([`a ${prop.kind}`, prop.body]);

    let peak = 0;
    for (let round = 0; round < 6; round++) {
      const dead = [];
      for (let i = 0; i < 12; i++) {
        const x = p.position.x + 3 + i * 1.6, z = p.position.z + 6;
        const e = world.spawnEnemy('acolyte', new THREE.Vector3(x, world.terrain.height(x, z), z));
        if (e) dead.push(e);
      }
      run(world, 1, input);
      for (const e of dead) e.die(e.position.clone(), null, 'saber');
      run(world, 3, input, () => { peak = Math.max(peak, world.physics.bodies.length); });
    }
    const gone = watched.filter(([, b]) => b.dead || !world.physics.bodies.includes(b));
    // …and the second half of the same defect: a corpse the game still holds
    // must still have every bone it was built with. One bone short is a corpse
    // whose joints have been dropped and whose mesh is copying a null `rb`.
    const maimed = [];
    for (const c of world.corpses?.list || []) {
      const bodies = c.e?.actor?.bodies;
      if (!bodies || c.e.actor.slept) continue;
      const lost = [...bodies.values()].filter((b) => b.dead || !world.physics.bodies.includes(b));
      if (lost.length) maimed.push(`a corpse the field still holds is ${lost.length} bone(s) short`);
    }
    const stats = world.physics.stats, left = world.physics.bodies.length;
    world.unload?.();
    assert(!gone.length,
      `${gone.map(([n]) => n).join(', ')} lost its collider to the body budget during combat — the `
      + 'mesh is still in the scene and there is nothing behind it. The budget may only spend '
      + 'DEBRIS, which is the one thing the game makes without counting; everything else has an '
      + 'owner that knows how to take it away whole');
    assert(!maimed.length, maimed.slice(0, 3).join('; ')
      + ' — evicting one bone of a live corpse is not enforcing a bound, it is corrupting an '
      + 'object another system still holds');
    return `6 rounds of 12 simultaneous deaths at the slider's minimum budget of 300: peak `
      + `${peak} bodies, drained to ${left}, ${stats.overBudget} refusal(s), `
      + `${watched.length} live collider(s) all intact`;
  });


  /**
   * …AND THE DEBRIS THE GAME MAKES ITSELF, WHICH THE CLAUSE ABOVE CANNOT SEE.
   *
   * That one drops three bodies built here from masks copied out of Props.js,
   * Ragdoll.js and Destruction.js — deliberately, so a mask taken from the
   * object under test cannot fail. The cost is that it only covers the three
   * makers somebody thought to transcribe, and there are five. The two it
   * missed are `World.spawnDebris` and `World.spawnDebrisGroup`, and the second
   * is handed the ENTIRE wrecked chassis of a destroyed machine (Enemy.js).
   * So this one calls the game's own makers instead of describing them, and it
   * drops on a LIVING BODY as well as on the player, because the enemy proxy is
   * the other half of every one of these pairs and nothing had ever asked it
   * anything. Driven, from 4 m, clearance above the victim's feet against
   * capsules reaching 1.79 (player) and 1.81 (droid):
   *
   *                              was            now
   *     World.spawnDebris        -0.04 / 0.35   1.99 / 2.01
   *     World.spawnDebrisGroup   -0.06 / 0.26   1.99 / 2.01
   *     Ragdoll severed limb      2.09 / -2.02  2.09 / 2.09
   *
   * The victim is the Training Droid because it is the one body in the game
   * that does not walk (`speed: 0`), and a victim that steps out from under the
   * drop reports every body as passing through it — which is what the first
   * three runs of this measurement did before the confound was found. The spin
   * the makers put on their debris is zeroed for the same reason: a spinning
   * box rolls off a rounded capsule, and rolling off is not falling through.
   */
  check('physicality: the debris the game itself makes lands on the people in it', async () => {
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const THREE = (await import('three')).default ?? (await import('three'));
    const { Body, box, capsule, LAYER } = await import('../../src/physics/RapierWorld.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    assert(ARCHETYPES.dummy && !ARCHETYPES.dummy.speed,
      'the Training Droid is the only body in the game that stands still, and it is what this '
      + 'measurement needs — a victim that walks steps out from under the drop and every body '
      + 'reads as passing through it');

    const { world } = await bootWorld({ level: 'scoria', settings: { level: 'scoria' } });
    const input = idleInput();
    run(world, 0.5, input);
    const p = world.player;
    const ep = p.position.clone(); ep.x += 14; ep.y = world.terrain.height(ep.x, ep.z);
    const e = world.spawnEnemy('dummy', ep);
    assert(e, 'the Training Droid would not spawn');
    const home = p.position.clone();
    const pin = () => { p.position.x = home.x; p.position.z = home.z; };
    run(world, 1, input, pin);

    const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
    const group = () => { const g = new THREE.Group(); g.add(mesh()); return g; };
    const at = (v) => v.position.clone().setY(v.position.y + 4);
    /* The game's own makers, called rather than described. The severed limb is
     * the one that has to be built here — `Severed` needs a rig and a cut — and
     * its spec is Ragdoll.js's, copied on purpose for the reason above. */
    const makers = {
      'World.spawnDebris': (v) => world.spawnDebris(mesh(), at(v), new THREE.Vector3(), new THREE.Vector3(0.4, 0.4, 0.4)).body,
      'World.spawnDebrisGroup': (v) => world.spawnDebrisGroup(group(), at(v), new THREE.Vector3(), 0.4).body,
      'a severed limb': (v) => world.physics.add(new Body({ position: at(v), shape: capsule(0.2, 0.1),
        mass: 6, layer: LAYER.DEBRIS,
        mask: LAYER.WORLD | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.PROP | LAYER.PLAYER | LAYER.ENEMY })),
    };
    const victims = [['the player', p], ['a living body', e]];
    const rows = [], through = [];
    for (const [mname, make] of Object.entries(makers)) {
      const dropped = victims.map(([, v]) => make(v));
      for (const b of dropped) { b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); }
      run(world, 4, input, pin);
      victims.forEach(([vname, v], i) => {
        const b = dropped[i];
        const half = v.body.shape?.halfHeight ?? 0.55, rad = v.body.shape?.radius ?? v.radius;
        const top = (v.body.position.y - v.position.y) + half + rad;
        const rest = b.position.y - v.position.y;
        rows.push(`${mname} on ${vname} ${rest.toFixed(2)}`);
        if (rest < top * 0.75) {
          through.push(`${mname} dropped on ${vname} came to rest ${rest.toFixed(2)} m above the feet, `
            + `and the capsule reaches ${top.toFixed(2)}`);
        }
        if (!b.dead) world.physics.remove(b);
      });
    }
    world.unload?.();
    assert(!through.length, through.join('; ')
      + ' — it fell THROUGH. Rapier pairs on `(A.layer & B.mask) && (B.layer & A.mask)`, so a loose '
      + 'body whose mask leaves PLAYER or ENEMY out is half a pair and the pair is dead, however '
      + 'solid the other half believes itself to be. See LOOSE_MASK in src/physics/Physics.js');
    return `dropped on the player and on a Training Droid, resting height above the feet: ${rows.join(', ')}`;
  });

  /**
   * A LIMB THE BLADE HAS SHORTENED STILL WEIGHS WHAT IT WEIGHS.
   *
   * `Body.setShape` is the one thing the sphere solver was originally kept for
   * — a lightsaber takes part of a limb away and the collider has to become a
   * shorter limb mid-flight — and on Rapier it rebuilt the collider without
   * rebuilding the MASS. `_buildColliders` scales collider density by
   * `this.mass / rb.mass()`, and on a rebuild `rb.mass()` still reported what
   * the OLD colliders had been scaled to, so the ratio came out at 1 and the
   * recompute then replaced the body's mass with the raw volume of the new
   * shape. Driven through `Ragdoll.cutRagdoll` on a B1 corpse: a 1.499 kg thigh
   * stump weighed 0.001 kg, a 5.573 kg head 0.003 — every stump 0.0004x of what
   * it asked for, with `inertiaScale` (the whole reason a corpse lies still)
   * left at zero on top.
   *
   * What that is on screen: the joint solve shares its correction by `invMass`,
   * so a weightless stump takes essentially all of every correction from the
   * limb it hangs off. Measured over 20 s of settling, three bones cut on one
   * B1 against the same B1 uncut as the control — 269.1 m of bone travel and a
   * 37.1 m/s peak, against 102.1 m and 12.5 m/s once the mass is right, and the
   * uncut control identical at 193.4 m either way.
   */
  check('physicality: a limb the blade has shortened still weighs what it weighs', async () => {
    const THREE = (await import('three')).default ?? (await import('three'));
    const { RapierWorld, Body, capsule } = await import('../../src/physics/RapierWorld.js');
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();

    // 1 — the contract itself, with no game in the way.
    const w = new RapierWorld({ gravity: -22 });
    const b = w.add(new Body({ position: new THREE.Vector3(0, 3, 0), shape: capsule(0.25, 0.07),
      mass: 6, inertiaScale: 3 }));
    const born = b.rb.mass();
    b.setShape(capsule(0.08, 0.07));
    const rebuilt = b.rb.mass();
    b.setShape(capsule(0.04, 0.05), { mass: 1.2 });
    const reweighed = b.rb.mass();
    const spin = b.rb.principalInertia();
    w.dispose();
    const off = [];
    if (Math.abs(born - 6) > 0.01) off.push(`built at ${born.toFixed(3)} kg against 6.000 asked`);
    if (Math.abs(rebuilt - 6) > 0.01) off.push(`a shorter shape left it at ${rebuilt.toFixed(3)} kg against 6.000`);
    if (Math.abs(reweighed - 1.2) > 0.01) off.push(`setShape({mass:1.2}) left it at ${reweighed.toFixed(3)} kg`);
    if (!(spin.x > 0 && spin.y > 0 && spin.z > 0)) off.push('the rebuilt body has no rotational inertia at all');

    // 2 — and the one call site in the game, on a real corpse.
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'scoria', settings: { level: 'scoria' } });
    const input = idleInput();
    run(world, 0.5, input);
    const p = world.player;
    const x = p.position.x + 5, z = p.position.z + 5;
    const en = world.spawnEnemy('b1', new THREE.Vector3(x, world.terrain.height(x, z), z));
    run(world, 0.5, input);
    en.die(en.position.clone(), null, 'saber');
    run(world, 0.6, input);
    const actor = en.actor;
    assert(actor && actor.bodies?.size, 'the B1 died without a ragdoll, so nothing here was measured');
    const cut = [];
    for (const name of ['armL', 'thighR', 'shinR', 'head']) {
      const bone = actor.bodies.get(name);
      if (!bone) continue;
      actor.cutRagdoll(name, null, 0.5);
      if (!bone.rb) continue;
      const got = bone.rb.mass();
      cut.push(`${name} ${bone.mass.toFixed(3)}→${got.toFixed(3)}`);
      if (Math.abs(got - bone.mass) > Math.max(1e-3, bone.mass * 0.02)) {
        off.push(`the ${name} stump asked for ${bone.mass.toFixed(3)} kg and the solver gave it `
          + `${got.toFixed(3)} (${(got / bone.mass).toFixed(4)}x)`);
      }
    }
    world.unload?.();
    assert(cut.length >= 3, `only ${cut.length} bone(s) could be cut, so this measured almost nothing`);
    assert(!off.length, off.join('; ')
      + ' — a rebuilt collider must be re-weighed against ITS OWN volume, not against the mass the '
      + 'colliders it replaced were scaled to. A near-weightless stump takes the whole of every '
      + 'joint correction, because the joint solve shares by invMass');
    return `setShape holds the mass through a reshape and a re-weigh (6.000, 6.000, 1.200 kg), and a `
      + `cut B1's stumps keep theirs: ${cut.join(', ')}`;
  });

  /**
   * THE BUDGET MAY SPEND DEBRIS AND NOTHING ELSE — IN BOTH SOLVERS.
   *
   * The clause above proves it through real combat on the Rapier world. The
   * sphere solver in Physics.js is the twin that world's API was copied from,
   * it is still what `verify.mjs` raycasts against as an oracle, and it kept
   * the defect verbatim: a debris pass guarded by `b.userData.keep` — a flag
   * READ on two lines and WRITTEN NOWHERE IN src/ — and under it a second pass
   * that took the first non-static body in insertion order. Driven at
   * `maxBodies: 12` with a player proxy, twenty ragdoll bones and no debris:
   *
   *     RapierWorld   0 culled, 9 refusals counted
   *     PhysicsWorld  9 culled → the player proxy, bone 0 … bone 7
   *
   * Cheap, deterministic and no world: this is the rule itself rather than a
   * consequence of it, so it belongs next to the expensive one and not instead.
   */
  check('physicality: a body budget with no debris to spend refuses instead of eating a live body', async () => {
    const THREE = (await import('three')).default ?? (await import('three'));
    const { initPhysics } = await import('../../src/physics/Rapier.js');
    await initPhysics();
    const RW = await import('../../src/physics/RapierWorld.js');
    const PH = await import('../../src/physics/Physics.js');
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const CAP = 12, N = 20;

    const drive = (label, make, mk) => {
      const w = make();
      const live = [['the player\'s proxy', w.add(mk({ position: V(0, 1, 0), mass: 78, kinematic: true,
        layer: PH.LAYER.PLAYER }))]];
      for (let i = 0; i < N; i++) {
        live.push([`bone ${i}`, w.add(mk({ position: V(i * 0.5, 1, 0), mass: 6, layer: PH.LAYER.RAGDOLL }))]);
      }
      const lost = live.filter(([, b]) => b.dead || !w.bodies.includes(b));
      w.dispose?.();
      return { label, lost: lost.map(([n]) => n), refusals: w.stats.overBudget };
    };
    const runs = [
      drive('RapierWorld', () => new RW.RapierWorld({ gravity: -22, maxBodies: CAP }),
        (o) => new RW.Body({ ...o, shape: RW.capsule(0.2, 0.1) })),
      drive('PhysicsWorld', () => new PH.PhysicsWorld({ maxBodies: CAP }),
        (o) => new PH.Body({ ...o, spheres: PH.capsuleSpheres(0.2, 0.1, 'y', 2) })),
    ];
    const guilty = runs.filter((r) => r.lost.length);
    assert(!guilty.length, guilty.map((r) => `${r.label} culled ${r.lost.length} live bodies to make room — `
      + r.lost.slice(0, 4).join(', ')).join('; ')
      + ` — with ${N + 1} live bodies against a cap of ${CAP} and NO DEBRIS in the world at all. DEBRIS is `
      + 'the only thing the game makes without counting, so it is the only thing the budget may spend; '
      + 'the player\'s proxy is added exactly once, in the Player constructor, and after its cull '
      + 'nothing collides with the player for the rest of the session');
    assert(runs.every((r) => r.refusals > 0),
      `a budget that culled nothing also counted no refusals (${runs.map((r) => `${r.label} ${r.refusals}`).join(', ')}) `
      + '— the overshoot has to be visible somewhere or it is silent');
    return `${N + 1} live bodies, cap ${CAP}, no debris: `
      + runs.map((r) => `${r.label} 0 culled / ${r.refusals} refusals`).join(', ');
  });

}
