/**
 * Build every station species body under the check harness and weigh it —
 * triangles, meshes, the bounding box — with no browser. The fast half of
 * `_speciesshot.mjs`, for iterating on a builder before paying for a render.
 *
 *   node --import ./tools/register.mjs tools/_speciesbuild.mjs [key,key]
 */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('run with --import ./tools/register.mjs'); process.exit(2); }
const B = await import('../src/game/Bodies.js');
const C = await import('../src/game/StationCast.js');
const M = await import('../src/ui/Menu.js');
const only = process.argv[2] ? process.argv[2].split(',') : C.SPECIES_KEYS;
for (const k of only) {
  const S = C.SPECIES_BY.get(k);
  try {
    const built = B.buildPlayerBody({ species: S.row, robe: S.robe, top: S.wear, hood: false });
    M.standPreviewFigure(built.rig);
    const root = built.rig.root;
    root.updateMatrixWorld(true);
    let tris = 0, meshes = 0, hidden = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      meshes++; if (!o.visible) hidden++;
      const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
    const box = new THREE.Box3().setFromObject(root);
    console.log(`${k.padEnd(9)} ${Math.round(tris)} tris / ${meshes} meshes (${hidden} hidden)  y ${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)}  x ±${Math.max(-box.min.x, box.max.x).toFixed(3)}`);
  } catch (e) { console.log(`${k}: FAILED ${e.stack}`); process.exitCode = 1; }
}
