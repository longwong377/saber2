/* Scratch probe: the well, the rail and what is over the void. */
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

async function station(deck) {
  const { bootWorld } = await import('./checks/_coop.mjs');
  const { prepareStation } = await import('../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

const { PLACE, DECK_Y, DRUM, placesOn } = await import('../src/game/StationPlan.js');
const p56 = PLACE.get(56);
console.log(`#56 x=${p56.x.toFixed(2)} z=${p56.z.toFixed(2)} w=${p56.w} d=${p56.d} h=${p56.h} yaw=${(p56.yaw*180/Math.PI).toFixed(2)}deg r=${Math.hypot(p56.x,p56.z).toFixed(2)} bearing=${(Math.atan2(p56.x,p56.z)*180/Math.PI).toFixed(2)}deg`);

/* the polar bounding box the shipped standingWell() derives */
{
  const c = Math.cos(p56.yaw), s = Math.sin(p56.yaw);
  let r0=Infinity,r1=-Infinity,a0=Infinity,a1=-Infinity;
  for (const [lx,lz] of [[-p56.w/2,-p56.d/2],[p56.w/2,-p56.d/2],[p56.w/2,p56.d/2],[-p56.w/2,p56.d/2]]) {
    const x=p56.x+lx*c+lz*s, z=p56.z-lx*s+lz*c;
    const r=Math.hypot(x,z), a=Math.atan2(x,z);
    r0=Math.min(r0,r); r1=Math.max(r1,r); a0=Math.min(a0,a); a1=Math.max(a1,a);
  }
  console.log(`polar box: a ${(a0*180/Math.PI).toFixed(2)}..${(a1*180/Math.PI).toFixed(2)}deg  r ${r0.toFixed(2)}..${r1.toFixed(2)}`);
  const TAU = Math.PI*2, seg = 72;
  const segs = [];
  for (let i=0;i<seg;i++){ const a=TAU*((i+0.5)/seg); if (a>a0&&a<a1) segs.push(a); }
  console.log(`plate n=72 cuts ${segs.length} segments: ${segs.map(a=>(a*180/Math.PI).toFixed(1)).join(', ')} -> cut spans ${((segs.length*TAU/seg)*180/Math.PI).toFixed(1)}deg`);
  const area = (segs.length*TAU/seg)/2*(r1*r1-r0*r0);
  console.log(`cut area = ${area.toFixed(1)} m2 ; footprint = ${(p56.w*p56.d).toFixed(1)} m2`);
}

const CELL = 0.4;
for (const deck of [44, 48]) {
  const world = await station(deck);
  const st = world._station;
  const y = DECK_Y[deck];
  /* every mesh in the scene, so a room's own floor counts as floor */
  const targets = [];
  world.scene.traverse((o) => { if (o.isMesh && o.geometry) targets.push(o); });
  const R = new THREE.Raycaster();
  R.far = 400;
  const down = new THREE.Vector3(0,-1,0);

  /* grid over the polar region + margin, in world xz */
  const c = Math.cos(p56.yaw), s = Math.sin(p56.yaw);
  let r0=Infinity,r1=-Infinity,a0=Infinity,a1=-Infinity;
  for (const [lx,lz] of [[-p56.w/2,-p56.d/2],[p56.w/2,-p56.d/2],[p56.w/2,p56.d/2],[-p56.w/2,p56.d/2]]) {
    const x=p56.x+lx*c+lz*s, z=p56.z-lx*s+lz*c;
    const r=Math.hypot(x,z), a=Math.atan2(x,z);
    r0=Math.min(r0,r); r1=Math.max(r1,r); a0=Math.min(a0,a); a1=Math.max(a1,a);
  }
  const TAU=Math.PI*2;
  const G0 = Math.floor(a0/(TAU/72)), G1 = Math.ceil(a1/(TAU/72));
  const A0 = G0*(TAU/72)-0.06, A1 = G1*(TAU/72)+0.06;
  const R0 = r0-4, R1 = r1+4;
  const pts = [];
  const nA = Math.ceil((A1-A0)*((R0+R1)/2)/CELL), nR = Math.ceil((R1-R0)/CELL);
  const grid = [];
  for (let i=0;i<=nA;i++) {
    const a = A0 + (A1-A0)*(i/nA);
    const row = [];
    for (let j=0;j<=nR;j++) {
      const r = R0 + (R1-R0)*(j/nR);
      const x = r*Math.sin(a), z = r*Math.cos(a);
      R.set(new THREE.Vector3(x, y+1.2, z), down);
      const hit = R.intersectObjects(targets, false)[0];
      const hy = hit ? hit.point.y : -1e6;
      row.push({ x, z, a, r, hy, drop: y - hy });
    }
    grid.push(row);
  }
  const cellA = (A1-A0)/nA * ((R0+R1)/2) * (R1-R0)/nR;
  const voids = [];
  const floors = [];
  for (const row of grid) for (const p of row) {
    if (p.drop < 0.6) floors.push(p); else voids.push(p);
  }
  console.log(`\ndeck ${deck}: floorAt=${y.toFixed(2)}  grid ${grid.length}x${nR+1} cell~${cellA.toFixed(3)} m2`);
  console.log(`  void cells ${voids.length} (~${(voids.length*cellA).toFixed(1)} m2), floored ${floors.length}`);
  /* worst: distance from a void point to the nearest floored point */
  let worst=0, worstP=null;
  for (const v of voids) {
    let best=Infinity;
    for (const f of floors) { const d=Math.hypot(v.x-f.x, v.z-f.z); if (d<best) best=d; }
    if (best>worst) { worst=best; worstP=v; }
  }
  if (worstP) console.log(`  worst void point ${worst.toFixed(2)} m from any floored point at (${worstP.x.toFixed(1)}, ${worstP.z.toFixed(1)}) drop=${worstP.drop.toFixed(2)}`);
  /* rail: reachability. knee-height ray between adjacent cells */
  const kneeY = y + 0.5;
  const dir = new THREE.Vector3();
  const blocked = (p, q) => {
    dir.set(q.x-p.x, 0, q.z-p.z);
    const len = dir.length(); dir.normalize();
    R.set(new THREE.Vector3(p.x, kneeY, p.z), dir);
    R.far = len;
    const h = R.intersectObjects(targets, false).length > 0;
    R.far = 400;
    return h;
  };
  /* flood from the outermost ring of cells that are floored */
  const key = (i,j)=>i*10000+j;
  const seen = new Set(); const q = [];
  for (let i=0;i<grid.length;i++) for (let j=0;j<grid[i].length;j++) {
    if ((i===0||i===grid.length-1||j===0||j===grid[i].length-1) && grid[i][j].drop<0.6) { seen.add(key(i,j)); q.push([i,j]); }
  }
  let head=0;
  while (head<q.length) {
    const [i,j]=q[head++];
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni=i+di, nj=j+dj;
      if (ni<0||nj<0||ni>=grid.length||nj>=grid[0].length) continue;
      if (seen.has(key(ni,nj))) continue;
      if (blocked(grid[i][j], grid[ni][nj])) continue;
      seen.add(key(ni,nj)); q.push([ni,nj]);
    }
  }
  const unfenced = [];
  for (let i=0;i<grid.length;i++) for (let j=0;j<grid[i].length;j++) {
    if (seen.has(key(i,j)) && grid[i][j].drop>=0.6) unfenced.push(grid[i][j]);
  }
  let gw=0, gp=null;
  for (const v of unfenced) {
    let best=Infinity;
    for (const f of floors) { const d=Math.hypot(v.x-f.x, v.z-f.z); if (d<best) best=d; }
    if (best>gw) { gw=best; gp=v; }
  }
  console.log(`  UNFENCED reachable void: ${unfenced.length} cells (~${(unfenced.length*cellA).toFixed(1)} m2), worst gap ${gw.toFixed(2)} m`
    + (gp?` at (${gp.x.toFixed(1)}, ${gp.z.toFixed(1)}) drop ${gp.drop.toFixed(2)} m`:''));
  world.dispose?.();
}
process.exit(0);
