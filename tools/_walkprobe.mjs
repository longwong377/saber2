/**
 * THE BETWEEN-SPACE, MEASURED — a probe, not a check.
 *
 *   node --import ./tools/register.mjs tools/_walkprobe.mjs [deck]
 *
 * Rule 4 (tools/checks/station.mjs) measures the twenty PLACES on a deck and
 * says nothing at all about the corridor between them. This stands in the
 * walkways — the ring, the four spines, the atrium rim, the tram platforms —
 * and runs THE SAME raster over the view down them.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { rasterView, iou, W, H } from './checks/_raster.mjs';

function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const { DRUM, DECK_Y, PLACES } = await import('../src/game/StationPlan.js');
const { walkPoints } = await import('./checks/_raster.mjs');

diskFetch();
await prepareStation();

const decks = process.argv[2] ? [Number(process.argv[2])] : [40, 44, 48];
for (const deck of decks) {
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  const st = world._station;
  const y = DECK_Y[deck];

  /* THREE SETS, because they answer three different questions and mixing them
   * hides the answer. The crowd is sixty bodies seeded at random seats: it
   * decorrelates any two views on its own and would report a copy-paste
   * corridor as varied. */
  const shell = st.shell.slice();
  const placed = [];
  for (const rec of st.places.values()) rec.group.traverse((o) => { if (o.isMesh) placed.push(o); });
  const all = [];
  world.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) all.push(o); });

  const pts = walkPoints(deck, DRUM, PLACES);
  const measure = (objects, label, show) => {
    const views = [];
    for (const p of pts) {
      for (const s of [1, -1]) {
        const dir = { x: p.dx * s, z: p.dz * s };
        const r = rasterView(THREE, { objects, eye: { x: p.x, y: y + 1.7, z: p.z }, dir, far: 70 });
        views.push({ tag: `${p.tag}${s > 0 ? '+' : '-'}`, ...r });
      }
    }
    let worst = 0, worstPair = '', sum = [];
    const famLines = [];
    for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) {
      const v = iou(views[i].bits, views[j].bits);
      sum.push(v);
      if (v > worst) { worst = v; worstPair = `${views[i].tag} × ${views[j].tag}`; }
    }
    sum.sort((a, b) => a - b);
    const med = sum[sum.length >> 1];
    const p90 = sum[Math.floor(sum.length * 0.9)];
    const q = (f) => f.slice().sort((a, b) => a - b)[views.length >> 1];
    /* WITHIN A FAMILY is where copy-paste lives: a ring view and a spine view
     * differ because they are different kinds of space, which says nothing. */
    const fam = (t) => t.replace(/[@#].*$/, '').replace(/\d+$/, '');
    for (const f of ['ring', 'spine', 'rim', 'tram']) {
      const g = views.filter((v) => fam(v.tag) === f);
      if (g.length < 3) continue;
      let w2 = 0, wp = '', ss = [];
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const v = iou(g[i].bits, g[j].bits); ss.push(v);
        if (v > w2) { w2 = v; wp = `${g[i].tag} × ${g[j].tag}`; }
      }
      ss.sort((a, b) => a - b);
      famLines.push(`      ${f.padEnd(6)} ${g.length} views: median ${ss[ss.length >> 1].toFixed(3)}  worst ${w2.toFixed(3)}  over .85: ${ss.filter((v) => v > 0.85).length}/${ss.length}  (${wp})`);
    }
    console.log(`  ${label.padEnd(18)} median ${med.toFixed(3)}  p90 ${p90.toFixed(3)}  worst ${worst.toFixed(3)}`
      + `  over .85: ${sum.filter((v) => v > 0.85).length}/${sum.length}   (${worstPair})`);
    if (show) {
      const empty = views.filter((v) => v.on < 40).length;
      const bare = views.filter((v) => v.mats <= 4).length;
      console.log(`      fill median ${q(views.map((v) => v.on))} of ${W * H};  near-empty ${empty};  <=4 materials ${bare}`);
      console.log(`      materials/view median ${q(views.map((v) => v.mats))};  meshes/view median ${q(views.map((v) => v.meshes))}`);
      console.log(`      forward sight median ${q(views.map((v) => v.depth)).toFixed(1)} m`);
      const near = views.filter((v) => v.depth < 12).length;
      console.log(`      views walled in under 12 m: ${near}/${views.length}`);
      for (const l of famLines) console.log(l);
    }
    return { med, worst, views };
  };

  /* ══ WHAT IS IN THE VIEW AT ALL ═══════════════════════════════════════
   * A landmark is something a person could steer by: a door, a sign, a prop
   * they can pick up, a window. Counted as "in frame" — inside the same 90°
   * × 60° cone the raster uses, within 70 m — because the question is whether
   * the view has anything in it, not whether it is occluded. */
  const marks = [];
  for (const p of PLACES) {
    if (p.deck !== deck || p.external || !p.door) continue;
    marks.push({ x: p.door[0], z: p.door[1], kind: 'door' });
  }
  for (const b of world.props) marks.push({ x: b.body?.position?.x ?? b.mesh?.position?.x ?? 0, z: b.body?.position?.z ?? b.mesh?.position?.z ?? 0, kind: 'prop' });
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.parent) return;
    let a = o, name = '';
    while (a) { if (a.name && /obelisk|board|sign/.test(a.name)) { name = a.name; break; } a = a.parent; }
    if (name) { const w = new THREE.Vector3(); o.getWorldPosition(w); marks.push({ x: w.x, z: w.z, kind: 'sign' }); }
  });
  const inFrame = (p, s) => {
    const dx = p.dx * s, dz = p.dz * s, rx = -dz, rz = dx;
    let n = 0;
    for (const m of marks) {
      const ox = m.x - p.x, oz = m.z - p.z;
      const fwd = ox * dx + oz * dz;
      if (fwd < 1 || fwd > 70) continue;
      if (Math.abs((ox * rx + oz * rz) / fwd) > 1) continue;
      n++;
    }
    return n;
  };
  let bareViews = 0, markCounts = [];
  for (const p of pts) for (const s of [1, -1]) { const n = inFrame(p, s); markCounts.push(n); if (n === 0) bareViews++; }
  markCounts.sort((a, b) => a - b);

  console.log(`\n── DECK ${deck} ─────────────────────────────────`);
  console.log(`  ${pts.length} points, ${pts.length * 2} views; shell ${shell.length} meshes, places ${placed.length}, scene ${all.length}`);
  measure(shell, 'shell only', true);
  measure(shell.concat(placed), 'shell + places', true);
  measure(all, 'everything (crowd)', false);
  console.log(`  landmarks in frame: median ${markCounts[markCounts.length >> 1]};  views with none: ${bareViews}/${markCounts.length}  (${marks.length} landmarks on the deck)`);
  console.log(`  deck draws ${st.draws} (shell ${st.shellDraws})  tris ${Math.round(st.tris / 1000)}k (shell ${Math.round(st.shellTris / 1000)}k)`);
  world.dispose?.();
}
