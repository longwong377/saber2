/**
 * SABER — Rapier.
 *
 * The bespoke solver in Physics.js approximates every object as a cluster of
 * spheres. That was a deliberate trade: when a limb is cut off, its collider
 * has to be rebuilt at runtime, and spheres make that trivial. The cost is that
 * nothing in the world is really the shape it looks like. A crate is eight
 * spheres, so it rolls when it should tip; stacks slide apart; a wall is a
 * lumpy approximation of a wall; and nothing arbitrary can be a collider at
 * all. That is the whole of "it doesn't feel like a real place".
 *
 * Rapier gives the world real convex hulls, real boxes, real compound bodies,
 * proper contact manifolds, joints and continuous collision detection. It is
 * WASM, and the `-compat` build inlines the binary as base64 — so it is one
 * vendored file, no separate fetch, and nothing to build.
 *
 * This module owns exactly two things: getting the WASM initialised before
 * anyone touches it, and handing out the module once it is ready. Everything
 * about actual bodies lives in the world wrapper.
 */

let RAPIER = null;
let ready = null;

/**
 * Initialise the engine. Safe to call repeatedly — every caller awaits the same
 * promise, so a second call while the first is still loading does not start a
 * second instantiation of a 1.4MB WASM module.
 */
export function initPhysics() {
  if (ready) return ready;
  ready = (async () => {
    const mod = await import('rapier');
    const R = mod.default ?? mod;
    await R.init();
    RAPIER = R;
    return R;
  })().catch((e) => {
    // Resolve with null rather than rejecting, so a browser without WASM still
    // reaches the main menu instead of dying on the loading screen. Deploying a
    // level will then fail loudly in RapierWorld's constructor — the world, its
    // props and its terrain are all Rapier's now, and there is no half-world to
    // fall back to. Only the ragdolls still run on the bespoke sphere solver.
    console.error('Rapier failed to initialise. Levels will not load.', e);
    RAPIER = null;
    return null;
  });
  return ready;
}

/** The initialised module, or null if init has not finished or has failed. */
export function rapier() { return RAPIER; }

/** True once the engine is usable. */
export function physicsReady() { return RAPIER !== null; }
