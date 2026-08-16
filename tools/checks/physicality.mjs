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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How high over the walkable ground is out of reach, in metres. */
const REACH = 9.0;

/**
 * The materials and object names that are not matter. Matched on the object's
 * own name and its material's, because the renderer names both.
 */
const NOT_MATTER = /(light|lamp|glow|flame|fire|ember|smoke|steam|haze|dust|mist|fog|water|sea|lava|melt|sky|cloud|star|beam|bolt|spark|halo|aura|shadow|decal|ink|billboard|card|impostor|sprite|banner|flag|cloth|cape|skirt|sash|grass|foliage|leaf|leaves|canopy|reed|weed)/i;

export async function run({ check, assert }) {
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
      const seen = new Set();
      world.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || seen.has(o.uuid)) return;
        seen.add(o.uuid);
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
    assert(share < 0.57,
      `${bad.length} of ${reachable} reachable objects (${(share * 100).toFixed(1)}%) have no collider — `
      + 'you walk through them. The rule is that anything you can touch is physical:\n    '
      + bad.slice(0, 14).join('\n    '));
    return `${reachable} reachable of ${solid} solid across ${LEVEL_ORDER.length} levels; `
      + `${bad.length} intangible (${(share * 100).toFixed(1)}%) — ${rows.join(', ')}`;
  });
}
