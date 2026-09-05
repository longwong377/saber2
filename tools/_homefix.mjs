import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}
const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const H = await import('../src/game/Home.js');
const HAB = await import('../src/game/Habitat.js');
const K = await import('../src/game/Kennel.js');
const S = await import('../src/game/StationSave.js');
diskFetch();
await prepareStation();
const station = async () => (await bootWorld({ level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 44; } })).world;

const count = (r) => { let d = 0, t = 0; r?.traverse?.((o) => { if (o.isMesh && o.geometry) { d++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { d, t: Math.round(t) }; };

S.clearStation(); K.clear();
console.log('— WHAT SUITS WHAT —');
const { COMPANION_ORDER, COMPANION_KINDS } = await import('../src/game/CompanionKinds.js');
for (const id of COMPANION_ORDER) console.log(' ', id.padEnd(8), String(H.padSuit(id)));

console.log('\n— THE CHOICE, AT THE HABITAT —');
K.adopt('hawk', 'KITE');
let p = HAB.habitatPanel();
console.log('  live         ', p.rec?.kind, p.rec?.name);
console.log('  pad.who      ', JSON.stringify(p.pad.who));
console.log('  pad.chosen   ', JSON.stringify(p.pad.chosen));
console.log('  rows         ', p.pad.rows.map((r) => `${r.id}${r.fits ? '*' : ''}`).join(' '));
HAB.choosePad('perch');
console.log('  after choose ', JSON.stringify(H.homePad()), 'fold=', JSON.stringify(S.homeState()?.pad));

console.log('\n— IN THE ROOM —');
let w = await station();
let h = w._home;
console.log('  state.pad    ', JSON.stringify(h.state.pad));
console.log('  h.pad        ', h.pad && { id: h.pad.id, rest: h.pad.rest, meshes: h.pad.meshes.length, seated: !!h.pad.root });
if (h.pad?.root) {
  h.pad.root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(h.pad.root);
  const s = b.getSize(new THREE.Vector3());
  console.log('  bird bbox    ', `${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m, feet at y=${b.min.y.toFixed(3)} (floor ${h.y}, rest ${h.pad.rest})`);
  console.log('  bird cost    ', JSON.stringify(count(h.pad.root)));
}
console.log('  homeRecord   ', JSON.stringify(H.homeRecord(w)));
w.dispose?.();
console.log('  after leave  ', JSON.stringify(S.homeState()?.pad));

console.log('\n— RELOAD —');
w = await station(); h = w._home;
console.log('  state.pad    ', JSON.stringify(h.state.pad), 'fixture', !!h.pad, 'seated', !!h.pad?.root);
console.log('\n— SWITCH FROM THE HABITAT WITH THE ROOM UP —');
HAB.choosePad('basket', w);
console.log('  h.pad        ', w._home.pad && { id: w._home.pad.id, seated: !!w._home.pad.root });
HAB.choosePad(null, w);
console.log('  taken out    ', w._home.pad, 'fold=', JSON.stringify(S.homeState()?.pad));
w.dispose?.();

/* ── THE GLASS ────────────────────────────────────────────────────────── */
function fakeRenderer(fw, fh) {
  const R = {
    calls: [], target: null, autoClear: false, cleared: 0,
    xr: { enabled: false },
    shadowMap: { autoUpdate: true, needsUpdate: false },
    state: { buffers: { depth: { setMask() {} } }, viewport() {} },
    getDrawingBufferSize(v) { v.set(fw, fh); return v; },
    getRenderTarget() { return R.target; },
    setRenderTarget(t) { R.target = t; },
    clear() { R.cleared++; },
    render(scene, camera) {
      let draws = 0, tris = 0;
      const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      scene.traverse((o) => {
        if (!o.isMesh || !o.geometry || !shown(o)) return;
        draws++;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      R.calls.push({ target: R.target, camera, draws, tris: Math.round(tris),
        shadowAuto: R.shadowMap.autoUpdate });
    },
  };
  return R;
}

console.log('\n══ THE MIRROR ══');
S.clearStation();
const hi = async () => (await bootWorld({ level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
  onWorld: (w) => { w._stationFloor = 44; } })).world;
const w2 = await hi();
const h2 = w2._home;
const M = h2.mirror;
console.log('  glass built  ', !!M.S, 'scale', M.S?.scale, 'tier', w2.settings.quality);
const cam = w2.engine.camera;
const glass = M.glass;
// baseline: everything visible
let full = 0, fullTris = 0;
w2.scene.traverse((o) => { if (o.isMesh && o.geometry) { full++; const g = o.geometry;
  fullTris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
const before = new Map(); w2.scene.traverse((o) => before.set(o, o.visible));
// stand the camera in the room, 2.5 m off the glass, looking at it
const n = M.S.normal;
cam.position.copy(M.S.plane).addScaledVector(n, 2.5);
cam.lookAt(M.S.plane);
cam.updateMatrixWorld(true);
w2.time = 1.0;
let R = fakeRenderer(1920, 1080);
glass.onBeforeRender(R, w2.scene, cam);
glass.onBeforeRender(R, w2.scene, cam);
glass.onBeforeRender(R, w2.scene, cam);
console.log('  three hooks  ', R.calls.length, 'render(s) — one per frame');
console.log('  target       ', M.S.target.width + 'x' + M.S.target.height, 'of a 1920x1080 buffer');
console.log('  scene meshes ', full, '→ reflected', R.calls[0]?.draws, 'draws /', R.calls[0]?.tris, 'tris');
console.log('  shadow auto  ', R.calls[0]?.shadowAuto, '(false while reflecting)', 'restored', R.shadowMap.autoUpdate);
console.log('  target back  ', R.target === null);
console.log('  uOn          ', M.S.material.uniforms.uOn.value);
let changed = 0; w2.scene.traverse((o) => { if (before.get(o) !== o.visible) changed++; });
console.log('  visibility   ', changed === 0 ? 'every object restored exactly' : `${changed} NOT RESTORED`);
let vis = 0, visTris = 0;
const shownNow = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
w2.scene.traverse((o) => { if (o.isMesh && o.geometry && shownNow(o)) { vis++; const g = o.geometry;
  visTris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
console.log('  whole scene  ', full, 'meshes /', Math.round(fullTris), 'tris');
console.log('  drawn now    ', vis, 'visible meshes /', Math.round(visTris), 'tris  (the beauty pass)');
console.log('  the glass is ', `${(100 * R.calls[0].draws / vis).toFixed(1)}% of those draws, `
  + `${(100 * R.calls[0].tris / visTris).toFixed(1)}% of those triangles`);
console.log('  player in it ', !!(w2.player?.rig?.root));
// a second frame
w2.time = 2.0;
const R2 = fakeRenderer(1920, 1080);
glass.onBeforeRender(R2, w2.scene, cam);
console.log('  next frame   ', R2.calls.length, 'render');
// far away
cam.position.copy(M.S.plane).addScaledVector(n, 40);
cam.updateMatrixWorld(true);
w2.time = 3.0;
const R3 = fakeRenderer(1920, 1080);
glass.onBeforeRender(R3, w2.scene, cam);
console.log('  40 m away    ', R3.calls.length, 'renders, uOn', M.S.material.uniforms.uOn.value);
// behind the glass
cam.position.copy(M.S.plane).addScaledVector(n, -1.0);
cam.updateMatrixWorld(true);
w2.time = 4.0;
const R4 = fakeRenderer(1920, 1080);
glass.onBeforeRender(R4, w2.scene, cam);
console.log('  behind it    ', R4.calls.length, 'renders, uOn', M.S.material.uniforms.uOn.value);
// a foreign camera (the ink prepass)
cam.position.copy(M.S.plane).addScaledVector(n, 2.5); cam.updateMatrixWorld(true);
w2.time = 5.0;
const R5 = fakeRenderer(1920, 1080);
const clone = cam.clone();
glass.onBeforeRender(R5, w2.scene, clone);
console.log('  ink prepass  ', R5.calls.length, 'renders (a cloned camera)');
w2.dispose?.();
console.log('  after dispose', M.S === null || M.S.disposed ? 'target disposed' : 'LEAK');
