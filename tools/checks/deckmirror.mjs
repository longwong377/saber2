/**
 * BATTLEFRONT BORZ — THE BLACK MIRROR, AND WHETHER IT IS ONE.
 *
 * `assets/reference/REFERENCES.md` rule 2: every hangar floor in every
 * reference doubles the room in itself. `src/game/DeckMirror.js` is a real
 * planar reflection — a mirrored camera, an oblique near plane, a render
 * target, a plane that samples it — and every one of those pieces can be
 * wrong in a way that still draws SOMETHING on the floor. So this drives the
 * shipped hook with a fake renderer and reads what it did, rather than
 * reading the source for the words.
 *
 *   IT EXISTS.          A booted hangar carries a mirror state, in the scene.
 *   IT COVERS THE DECK. The geometry covers every point of ground inside the
 *                       walls and none of the pit — decided by asking the
 *                       heightfield itself where the ground is, not the
 *                       mirror's own table of rectangles.
 *   IT DECLARES.        Every uniform the GLSL reads is in the material.
 *   IT IS SIZED.        Half the frame at medium, three quarters at high,
 *                       nothing at low.
 *   IT KNOWS WHEN NOT TO. Below the plane, on the lowest tier, through any
 *                       camera but the engine's own, and twice in one frame.
 *   IT IS A MIRROR.     The virtual camera is the real one reflected, the
 *                       near plane is the deck, and a point under the deck is
 *                       clipped while one over it is not.
 *   IT IS DARK AND CEL. Strengths transcribed from the shader; no lights, no
 *                       specular; no ink.
 *   IT GOES AWAY.       Undress disposes the target and the mesh leaves.
 */

import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { DECK } from '../../src/game/Hangar.js';
import {
  MIRROR, mirrorScale, strengthAt, mirrorRects, fitMirror,
  dressDeckMirror, stepDeckMirror, undressDeckMirror,
} from '../../src/game/DeckMirror.js';

/** Boot the deck through the same door the game uses, at the tier under test. */
async function deck(quality = 'medium') {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { world, engine } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0, quality },
  });
  return { world, engine, input: idleInput() };
}

/**
 * A renderer with exactly the surface the hook touches, and a record of what
 * it was asked to do. `render` looks at the scene AS IT IS at the moment of
 * the call, which is the only moment the hide list matters.
 */
function fakeRenderer(w = 1920, h = 1080, THREE) {
  const R = {
    calls: [], target: null, autoClear: false,
    xr: { enabled: false },
    shadowMap: { autoUpdate: true, needsUpdate: false },
    state: { buffers: { depth: { setMask() {} } }, viewport() {} },
    info: { render: { calls: 0 } },
    getDrawingBufferSize(v) { v.set(w, h); return v; },
    getRenderTarget() { return R.target; },
    setRenderTarget(t) { R.target = t; },
    clear() { R.cleared = (R.cleared || 0) + 1; },
    render(scene, camera) {
      const seen = { visible: new Map(), target: R.target, shadowAuto: R.shadowMap.autoUpdate, camera };
      scene.traverse((o) => { seen.visible.set(o, o.visible); });
      // what an object's visibility is as the renderer walks it: a hidden
      // parent hides its subtree, so record the effective flag
      seen.shown = (o) => { for (let p = o; p; p = p.parent) if (seen.visible.get(p) === false) return false; return true; };
      R.calls.push(seen);
    },
  };
  return R;
}

/** Is (x, z) under one of the geometry's triangles? A real test of the buffer. */
function covered(geometry, x, z) {
  const p = geometry.attributes.position.array;
  const idx = geometry.index.array;
  const side = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const s1 = side(p[a], p[a + 2], p[b], p[b + 2], x, z);
    const s2 = side(p[b], p[b + 2], p[c], p[c + 2], x, z);
    const s3 = side(p[c], p[c + 2], p[a], p[a + 2], x, z);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  }
  return false;
}

export async function run({ check, assert, near, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  /* ONE BOOT FOR THE SUITE. The hangar is the most expensive room to dress
   * and every check below reads the same mirror; `clocked` runs the bodies in
   * order, so a state built in the first is there for the rest. */
  let W = null, bootErr = null;
  try { W = await deck('medium'); } catch (e) { bootErr = e; }
  const S = () => W.world._deckMirror;
  /* The hook wants the camera's matrixWorld current; a renderer would do
   * this itself at the top of render(). */
  const place = (x, y, z) => {
    const c = W.engine.camera;
    c.position.set(x, y, z);
    c.rotation.set(0, Math.PI, 0);   // yaw pi is forward (+z) on this deck
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
  };
  const hook = (R) => S().mesh.onBeforeRender(R, W.world.scene, W.engine.camera);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It exists                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: a booted hangar carries a mirror, in the scene, at the tier it booted on', () => {
    if (bootErr) throw bootErr;
    const s = S();
    assert(s, 'the hangar booted with no `world._deckMirror` — dressHangar did not build one');
    assert(s.mesh && s.mesh.parent === W.world.scene, 'the mirror mesh is not in the scene');
    assert(s.target && s.target.isWebGLRenderTarget, 'there is no render target');
    assert(s.material && s.material.isShaderMaterial, 'the mirror is not a ShaderMaterial');
    assert(s.camera && s.camera.isPerspectiveCamera, 'there is no mirrored camera');
    assert(s.tier === 'medium', `booted at medium and the mirror thinks it is at ${s.tier}`);
    assert(dressDeckMirror(W.world) === s, 'a second dress built a second mirror');
    return `mesh ${s.mesh.name}, tier ${s.tier}, scale ${s.scale}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It covers the deck                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: the plane covers the ground inside the walls and none of the pit', () => {
    if (bootErr) throw bootErr;
    const g = S().geometry;
    const P = TERRAIN_PRESETS.hangardeck;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    near(bb.min.y, MIRROR.y, 1e-6, 'the plane is not at MIRROR.y');
    near(bb.max.y, MIRROR.y, 1e-6, 'the plane is not flat');
    /* NOTHING CROSSES THE WALLS. The rack walls' inboard collider face is at
     * ±72.5 and their geometry at ±80; a plane past 80 is under the wall's
     * own mass, and past 144 or before -104 it is off the ship. */
    assert(bb.min.x >= -DECK.wall - 1e-6 && bb.max.x <= DECK.wall + 1e-6,
      `the mirror spans x ${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)}, past the walls at ±${DECK.wall}`);
    assert(bb.min.z >= DECK.aft - 1e-6 && bb.max.z <= DECK.lip + 1e-6,
      `the mirror spans z ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)}, off the deck (${DECK.aft}..${DECK.lip})`);
    /* THE GROUND DECIDES, NOT THE TABLE. Every 2 m over the deck inside the
     * collider faces: ground at deck level must be under the mirror, and a
     * point more than half a metre down (the pit) must not be. A 3 m band
     * round the pit's edge — where the kerbs stand and the rim slopes — is
     * allowed to go either way. */
    let ground = 0, hole = 0, missed = [], floated = [];
    for (let x = -72; x <= 72; x += 2) {
      for (let z = -102; z <= 138; z += 2) {
        const h = P.height(x, z);
        const c = covered(g, x, z);
        const pitDx = Math.abs(x - MIRROR.pit.x) - MIRROR.pit.hx;
        const pitDz = Math.abs(z - MIRROR.pit.z) - MIRROR.pit.hz;
        const onRim = Math.max(pitDx, pitDz) > -3 && Math.max(pitDx, pitDz) < 3;
        if (onRim) continue;
        if (h > -0.3) { ground++; if (!c) missed.push(`(${x},${z})`); }
        else if (h < -0.5) { hole++; if (c) floated.push(`(${x},${z}) ${h.toFixed(1)} m down`); }
      }
    }
    assert(ground > 4000, `only ${ground} ground samples — the probe grid is wrong`);
    assert(hole > 100, `only ${hole} samples in the pit — the pit has moved or gone, and MIRROR.pit no longer agrees with the ground`);
    assert(missed.length === 0, `${missed.length} points of deck have no mirror over them: ${missed.slice(0, 5).join(' ')}`);
    assert(floated.length === 0, `${floated.length} points of the pit have a mirror floating over them: ${floated.slice(0, 5).join(' ')}`);
    assert(g.index.count === 8 * 3, `${g.index.count / 3} triangles — the plate is ${mirrorRects().length} rectangles`);
    return `${ground} ground samples covered, ${hole} pit samples clear, 8 triangles`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It declares                                                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: the material declares every uniform its shaders read', () => {
    if (bootErr) throw bootErr;
    const m = S().material;
    const src = m.vertexShader + '\n' + m.fragmentShader;
    const read = new Set();
    for (const [, name] of src.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)) read.add(name);
    assert(read.size >= 4, `only ${read.size} uniforms declared in the GLSL — the shader is not the mirror's`);
    const missing = [...read].filter((n) => !(n in m.uniforms));
    assert(missing.length === 0, `the GLSL reads ${missing.join(', ')} and the material has no such uniform`);
    /* And the other way, minus the fog block: the renderer writes
     * `fogColor` into any fogged material whether or not the program reads
     * it, and an additive surface has no fog colour to take on. The block is
     * read off `UniformsLib.fog` AS IT IS, because Engine's aerial
     * perspective extends it (uAerialShape, uAerialSun, uAerialTint) and a
     * list written here would be a second copy of that. */
    const FOG = new Set(Object.keys(THREE.UniformsLib.fog));
    assert(FOG.has('fogColor') && FOG.has('fogDensity'), 'UniformsLib.fog is not three\'s fog block');
    const unread = Object.keys(m.uniforms).filter((n) => !read.has(n) && !FOG.has(n));
    assert(unread.length === 0, `the material carries ${unread.join(', ')} and the GLSL never reads them`);
    for (const n of ['tMirror', 'uTexMat', 'uOn']) assert(read.has(n), `the shader does not read ${n}`);
    assert(m.uniforms.tMirror.value === S().target.texture, 'tMirror is not the render target\'s texture');
    assert(m.fog === true && 'fogDensity' in m.uniforms, 'the mirror is not fogged — it would glow at full strength under a rim 200 m away');
    return `${read.size} uniforms read, all declared`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It is sized                                                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: the target is half the frame at medium, three quarters at high, nothing at low', () => {
    if (bootErr) throw bootErr;
    assert(mirrorScale('low') === 0, `low is ${mirrorScale('low')} — the lowest tier is supposed to skip the mirror entirely`);
    near(mirrorScale('medium'), 0.5, 1e-9, 'medium');
    near(mirrorScale('high'), 0.75, 1e-9, 'high');
    assert(mirrorScale('ultra') >= 0.75, 'ultra is below high');
    assert(mirrorScale('nonsense') > 0, 'an unknown tier switched the mirror off rather than falling back');
    const s = S();
    assert(s.scale === 0.5, `booted at medium and the scale is ${s.scale}`);
    const t = fitMirror(s, 1920, 1080);
    assert(t === s.target, 'fitMirror handed back a different target');
    assert(t.width === 960 && t.height === 540, `a 1920×1080 frame at medium sized the target ${t.width}×${t.height}, not 960×540`);
    /* Through the hook, off the renderer's own drawing buffer. */
    place(0, 1.7, -60);
    stepDeckMirror(W.world, 1 / 60);
    const R = fakeRenderer(1280, 720, THREE);
    hook(R);
    assert(R.calls.length === 1, `the hook rendered ${R.calls.length} times`);
    assert(t.width === 640 && t.height === 360, `a 1280×720 drawing buffer sized the target ${t.width}×${t.height}`);
    assert(R.calls[0].target === t, 'the reflection was rendered somewhere other than the mirror\'s target');
    assert(R.calls[0].shadowAuto === false, 'the shadow cascades were re-rendered for the reflection');
    assert(R.shadowMap.autoUpdate === true, 'shadow auto-update was not restored after the reflection');
    assert(R.target === null, 'the render target was not restored after the reflection');
    return `960×540 at medium from 1080p; 640×360 from a 720p drawing buffer through the hook`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It knows when not to                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: one reflection per frame, through the engine\'s camera only', () => {
    if (bootErr) throw bootErr;
    const s = S();
    place(0, 1.7, -60);
    stepDeckMirror(W.world, 1 / 60);
    const R = fakeRenderer(1920, 1080, THREE);
    const before = s.renders;
    hook(R);
    hook(R);
    hook(R);
    assert(R.calls.length === 1, `three hooks in one frame rendered ${R.calls.length} reflections`);
    assert(s.renders === before + 1, 'the render count did not advance by one');
    /* The ink prepass renders through a CLONE of the camera. */
    stepDeckMirror(W.world, 1 / 60);
    const clone = W.engine.camera.clone();
    clone.updateMatrixWorld(true);
    s.mesh.onBeforeRender(R, W.world.scene, clone);
    assert(R.calls.length === 1, 'a render through a cloned camera — the ink prepass — rendered a reflection');
    hook(R);
    assert(R.calls.length === 2, 'the frame that the clone tried to take was not still available to the engine\'s camera');
    /* Without a step, nothing: the frame is not armed. */
    hook(R);
    assert(R.calls.length === 2, 'a hook with no step behind it rendered');
    return `3 hooks → 1 render; clone camera → 0; unarmed → 0`;
  });

  check('deckmirror: the mirror is off under the plane and on the lowest tier, and comes back', () => {
    if (bootErr) throw bootErr;
    const s = S();
    const R = fakeRenderer(1920, 1080, THREE);
    /* Under the plane — the pit, or a fall through the floor. */
    place(-52, -1.0, 6);
    stepDeckMirror(W.world, 1 / 60);
    assert(s.below === true, 'a camera at y = -1 is not "below"');
    assert(s.mesh.visible === false, 'the mirror is drawn with the camera under it');
    assert(s.armed === false, 'a frame under the plane was armed');
    hook(R);
    assert(R.calls.length === 0, 'the reflection was rendered from under the plane');
    /* Back up. */
    place(0, 1.7, -60);
    stepDeckMirror(W.world, 1 / 60);
    assert(s.below === false && s.mesh.visible === true && s.armed === true, 'the mirror did not come back above the plane');
    hook(R);
    assert(R.calls.length === 1, 'no reflection above the plane');
    assert(s.material.uniforms.uOn.value === 1, 'uOn is not 1 after a render');
    /* THE LOWEST TIER. Headless there is no engine tier, so the settings'
     * is read; the director's step reads it every frame. */
    W.world.settings.quality = 'low';
    stepDeckMirror(W.world, 1 / 60);
    assert(s.tier === 'low' && s.scale === 0, `low did not take: tier ${s.tier}, scale ${s.scale}`);
    assert(s.mesh.visible === false, 'the mirror is drawn on the lowest tier');
    assert(s.target.width === 2 && s.target.height === 2, `the target still holds ${s.target.width}×${s.target.height} on the lowest tier`);
    assert(s.material.uniforms.uOn.value === 0, 'uOn is not 0 on the lowest tier');
    hook(R);
    assert(R.calls.length === 1, 'the reflection was rendered on the lowest tier');
    /* And the hook itself refuses the frame if the step was skipped but the
     * camera dropped: a stale arm must not render from under the plane. */
    W.world.settings.quality = 'high';
    stepDeckMirror(W.world, 1 / 60);
    assert(s.tier === 'high' && s.scale === 0.75 && s.mesh.visible === true, 'raising the tier did not bring the mirror back');
    place(0, -0.5, -60);
    hook(R);
    assert(R.calls.length === 1 && s.material.uniforms.uOn.value === 0, 'an armed frame rendered after the camera dropped under the plane');
    /* THE ENGINE'S TIER WINS. `world.settings` is a copy taken at boot and a
     * mid-visit change in the options screen goes to `engine.setQuality`;
     * a mirror reading the copy would stay on after the player dropped to
     * the tier that is supposed to have none. */
    place(0, 1.7, -60);
    W.engine.quality = 'low';
    stepDeckMirror(W.world, 1 / 60);
    assert(s.tier === 'low' && s.mesh.visible === false, 'the engine\'s tier did not win over the settings copy');
    delete W.engine.quality;
    stepDeckMirror(W.world, 1 / 60);
    assert(s.tier === 'high' && s.mesh.visible === true, 'the mirror did not come back when the engine tier was gone');
    /* The manual switch, which the profiler's A/B uses. */
    place(0, 1.7, -60);
    s.enabled = false;
    stepDeckMirror(W.world, 1 / 60);
    assert(s.mesh.visible === false && s.armed === false, '`enabled = false` did not switch the mirror off');
    s.enabled = true;
    W.world.settings.quality = 'medium';
    stepDeckMirror(W.world, 1 / 60);
    hook(R);
    assert(R.calls.length === 2, 'the mirror did not come back after the switch');
    assert(s.target.width === 960, `back at medium the target is ${s.target.width} wide, not 960`);
    return 'below → off; low → off, 2×2; high → 0.75; stale arm under the plane → off; engine tier wins; switch → off/on';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It is a mirror                                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: the virtual camera is the real one reflected, and the near plane is the deck', () => {
    if (bootErr) throw bootErr;
    const s = S();
    /* A real look: 1.7 m up, pitched a quarter radian down at the deck. */
    const c = W.engine.camera;
    c.position.set(3, 1.7, -60);
    c.rotation.set(-0.25, Math.PI, 0, 'YXZ');
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    stepDeckMirror(W.world, 1 / 60);
    const R = fakeRenderer(1920, 1080, THREE);
    hook(R);
    assert(R.calls.length === 1, 'no render');
    const V = s.camera;
    assert(R.calls[0].camera === V, 'the reflection was rendered through some other camera');
    near(V.position.x, 3, 1e-6, 'virtual x');
    near(V.position.z, -60, 1e-6, 'virtual z');
    near(V.position.y, 2 * MIRROR.y - 1.7, 1e-6, 'virtual y is not the real camera reflected about the plane');
    const fwd = (cam) => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const f = fwd(c), g = fwd(V);
    near(g.x, f.x, 1e-6, 'forward x');
    near(g.z, f.z, 1e-6, 'forward z');
    near(g.y, -f.y, 1e-6, 'the virtual camera does not look UP where the real one looks down');
    /* THE OBLIQUE CLIP. A point a metre under the deck, ten metres ahead, is
     * behind the virtual camera's near plane (clip z < -w); a point a metre
     * over the deck is inside. Projected through the matrices the hook built. */
    const clip = (x, y, z) => new THREE.Vector4(x, y, z, 1).applyMatrix4(V.matrixWorldInverse).applyMatrix4(V.projectionMatrix);
    const under = clip(3, -1.0, -50), over = clip(3, 1.0, -50), on = clip(3, MIRROR.y, -50);
    assert(under.z < -under.w, `a point under the deck survives the near plane (z ${under.z.toFixed(3)} w ${under.w.toFixed(3)})`);
    assert(over.z > -over.w, `a point over the deck is clipped (z ${over.z.toFixed(3)} w ${over.w.toFixed(3)})`);
    near(on.z / on.w, -1, 1e-3, 'a point ON the plane is not exactly at the near plane');
    /* THE PROJECTIVE MAPPING. A plane point lands at the same screen HEIGHT
     * in both cameras with the horizontal mirrored — the fact the vertical
     * smear depends on. */
    const real = new THREE.Vector3(10, MIRROR.y, -40).project(c);
    const tex = new THREE.Vector4(10, MIRROR.y, -40, 1).applyMatrix4(s.texMat);
    const u = tex.x / tex.w, v = tex.y / tex.w;
    near(v, (real.y + 1) / 2, 1e-4, 'texture v is not the screen\'s vertical');
    near(u, 1 - (real.x + 1) / 2, 1e-4, 'texture u is not the screen\'s horizontal mirrored');
    assert(s.material.uniforms.uTexMat.value.equals(s.texMat), 'the shader\'s texture matrix is not the one the hook built');
    return `virtual at (3, ${V.position.y.toFixed(2)}, -60); under clipped, over kept; v = screen y, u = 1 - screen x`;
  });

  check('deckmirror: the reflection hides the transparent things and keeps the sky dome; all come back', () => {
    if (bootErr) throw bootErr;
    const s = S();
    const scene = W.world.scene;
    place(0, 1.7, -60);
    /* A transparent object of our own, so this does not depend on which
     * lanes have built what today, plus whatever the room already has. */
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }));
    probe.name = 'deckmirror-probe';
    const kept = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }));
    kept.material.userData.saberMirror = true;
    const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    scene.add(probe, kept, pts);
    /* Every object's flag BEFORE the hook, so afterwards the question is
     * exact: did anything's visibility change hands and not come back? */
    const before = new Map();
    scene.traverse((o) => before.set(o, o.visible));
    try {
      stepDeckMirror(W.world, 1 / 60);
      const R = fakeRenderer(1920, 1080, THREE);
      hook(R);
      const seen = R.calls[0];
      assert(seen.shown(s.mesh) === false, 'the mirror rendered itself into its own reflection');
      assert(seen.shown(probe) === false, 'a transparent mesh was rendered into the reflection');
      assert(seen.shown(pts) === false, 'a Points object was rendered into the reflection');
      assert(seen.shown(kept) === true, 'a material that opted in with saberMirror was hidden');
      const dome = W.engine.skyDome?.mesh;
      assert(dome && dome.material.transparent, 'the sky dome is not transparent any more — re-read hideForReflection');
      assert(seen.shown(dome) === true, 'the sky dome — the planet in the aperture — was hidden from the reflection');
      const field = scene.getObjectByName('deck-field');
      if (field) assert(seen.shown(field) === false, 'the field plane was rendered into the reflection');
      const changed = [];
      scene.traverse((o) => { if (before.has(o) && before.get(o) !== o.visible) changed.push(o.name || o.type); });
      assert(changed.length === 0, `${changed.length} objects did not get their visibility back after the render: ${changed.slice(0, 5).join(', ')}`);
      assert(s.mesh.visible === true, 'the mirror did not come back after its render');
      assert(probe.visible && kept.visible && pts.visible, 'the probes were left hidden');
      assert(s.hidden.length === 0, 'the hide list was not emptied');
      /* Hidden FOR the render: visible before, not visible as it rendered. */
      let hiddenCount = 0;
      for (const [o, v] of before) if (v && seen.shown(o) === false && o !== s.mesh) hiddenCount++;
      assert(hiddenCount >= 3, `only ${hiddenCount} objects were hidden for the render`);
      return `${hiddenCount} objects hidden for the render, every flag back afterwards`;
    } finally {
      scene.remove(probe, kept, pts);
    }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It is dark and cel                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: dark — 0.18 head-on rising to 0.45 at grazing, and the shader carries the same numbers', async () => {
    if (bootErr) throw bootErr;
    near(strengthAt(1), MIRROR.headOn, 1e-9, 'head-on');
    near(strengthAt(0), MIRROR.graze, 1e-9, 'grazing');
    assert(MIRROR.headOn >= 0.12 && MIRROR.headOn <= 0.25, `head-on strength ${MIRROR.headOn} — a black mirror, not a bathroom one`);
    assert(MIRROR.graze >= 0.35 && MIRROR.graze <= 0.6, `grazing strength ${MIRROR.graze}`);
    let prev = -1;
    for (let c = 1; c >= 0; c -= 0.05) { const k = strengthAt(c); assert(k >= prev, 'not monotone'); prev = k; }
    /* A man 20 m away looking at the plate under the rim: about 5° up. */
    const at5 = strengthAt(Math.sin(5 * Math.PI / 180));
    assert(at5 > 0.35, `at 5° the reflection is only ${at5.toFixed(3)} — too steep a curve; the far deck reads matte`);
    const src = S().material.fragmentShader;
    for (const n of [MIRROR.headOn, MIRROR.graze, MIRROR.smear]) {
      assert(src.includes(n.toFixed(3)), `the shader does not carry ${n.toFixed(3)} — MIRROR and the GLSL have parted`);
    }
    assert(/g \* g \* g/.test(src), 'the shader\'s curve is not the cubed one strengthAt transcribes');
    assert((src.match(/texture2D\s*\(\s*tMirror/g) || []).length === 1 && /for \(int i = -3; i <= 3; i\+\+\)/.test(src),
      'the seven-tap vertical smear is not in the shader');
    assert(/vec2\(0\.0,\s*t \* /.test(src), 'the smear is not along the texture\'s v axis');
    return `0.18 → ${at5.toFixed(3)} at 5° → 0.45; literals present`;
  });

  check('deckmirror: cel — no lights, no specular, no ink, added over the plate', async () => {
    if (bootErr) throw bootErr;
    const m = S().material;
    assert(m.lights === false, 'the mirror asks for the light rig');
    assert(!/specular|GGX|BRDF/i.test(m.fragmentShader), 'the mirror shader has a specular term');
    assert(m.userData.saberNoInk === true, 'the mirror is not marked saberNoInk — the prepass would rasterise it and fire the hook a second time');
    const { cutsItsOwnSilhouette } = await import('../../src/toon/Ink.js');
    assert(cutsItsOwnSilhouette(m) === true, 'the ink prepass would draw the mirror');
    assert(m.transparent === true && m.depthWrite === false && m.blending === THREE.AdditiveBlending,
      'the mirror is not an additive, depth-read-only surface — it would replace the plate rather than reflect on it');
    assert(m.polygonOffset === true && m.polygonOffsetFactor < 0, 'no polygon offset: the far reflection speckles against the plate');
    assert(S().mesh.renderOrder < 0, 'the mirror is not drawn first among the transparents');
    assert(S().mesh.castShadow === false, 'the mirror casts a shadow');
    return 'lights off, no specular, saberNoInk, additive, depthWrite off, offset';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  It goes away                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deckmirror: undress disposes the target and the mesh leaves — nothing leaks', () => {
    if (bootErr) throw bootErr;
    const s = S();
    const scene = W.world.scene;
    let targets = 0, materials = 0, geometries = 0;
    s.target.addEventListener('dispose', () => targets++);
    s.material.addEventListener('dispose', () => materials++);
    s.geometry.addEventListener('dispose', () => geometries++);
    /* Count render targets reachable from the scene's materials before and
     * after: the mirror's is the only one the deck holds, and afterwards
     * none may remain. */
    const reachable = () => {
      const set = new Set();
      scene.traverse((o) => {
        const m = o.material; if (!m) return;
        for (const x of (Array.isArray(m) ? m : [m])) {
          for (const u of Object.values(x?.uniforms || {})) {
            const t = u?.value;
            if (t?.isTexture && t.name === 'deck-mirror') set.add(t);
          }
        }
      });
      return set.size;
    };
    const before = reachable();
    assert(before === 1, `${before} mirror textures reachable from the scene before undress`);
    const mesh = s.mesh, target = s.target;
    undressDeckMirror(W.world);
    assert(W.world._deckMirror === null, 'world._deckMirror still points at the mirror');
    assert(mesh.parent === null && !scene.getObjectByName('deck-mirror'), 'the mirror mesh is still in the scene');
    assert(targets === 1, `the render target was disposed ${targets} times`);
    assert(materials === 1 && geometries === 1, `material disposed ${materials}, geometry ${geometries}`);
    assert(reachable() === 0, 'the mirror texture is still reachable from the scene');
    assert(s.material.uniforms.tMirror.value === null, 'the material still holds the target\'s texture');
    /* A hook that fires late — a frame already in flight — must do nothing. */
    const R = fakeRenderer(1920, 1080, THREE);
    mesh.onBeforeRender(R, scene, W.engine.camera);
    assert(R.calls.length === 0, 'a disposed mirror rendered');
    stepDeckMirror(W.world, 1 / 60);
    undressDeckMirror(W.world);
    assert(targets === 1, 'a second undress disposed the target again');
    /* And it can be dressed again on the same world. */
    const again = dressDeckMirror(W.world);
    assert(again && again !== s && again.target !== target && again.mesh.parent === scene, 'the deck could not be re-dressed');
    return 'target ×1, material ×1, geometry ×1 disposed; 0 textures reachable; re-dressed';
  });
}
