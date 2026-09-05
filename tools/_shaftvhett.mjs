/* THROWAWAY PROBE — the two audit findings, measured in a booted station. */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
function diskFetch(){ if(globalThis.fetch&&globalThis.__stationFetch)return; const root=new URL('../',import.meta.url); globalThis.__stationFetch=true;
 globalThis.fetch=async(u)=>{const b=await readFile(new URL(String(u),root));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};}
diskFetch();
const { bootWorld } = await import('./checks/_coop.mjs');
const St = await import('../src/game/Station.js');
const V = await import('../src/game/Vendors.js');
await import('../src/game/Levels.js');
const { liftFloors } = await import('../src/game/DeckLift.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
await St.prepareStation();

const sig = (root) => { let n = 0, v = 0; const cols = new Set();
  root?.traverse?.((o) => { if (o.isMesh) { n++; v += o.geometry?.attributes?.position?.count || 0;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      const a = m?.userData?.authored;
      if (a) cols.add('#' + [0,1,2].map((i)=>Math.round(a[i]*255).toString(16).padStart(2,'0')).join(''));
      else if (m?.color) cols.add('#' + m.color.getHexString());
    } } });
  return { n, v, cols: [...cols].sort() }; };

console.log('── (2) THE SHAFT EVERY FLOOR ROW NAMES ──');
for (const f of liftFloors()) if (f.deck != null) console.log(`  deck ${String(f.deck).padStart(2)}  row says shaft=${f.shaft ?? '(NONE)'}`);

console.log('\n── (1) THE ROW AND THE BODY IT BUILDS ──');
for (const c of V.COUNTERS) {
  const a = St.keeperArmour(c.keeper || {});
  console.log(`  ${c.id.padEnd(10)} keeper=${JSON.stringify(c.keeper || {})}\n      armour -> ${JSON.stringify(a)}`);
}
const bare = sig(ARCHETYPES.res_human.build({}).rig.root);
const clad = sig(ARCHETYPES.res_human.build({ armour: St.keeperArmour(V.ARMOURER.keeper) }).rig.root);
const bareOff = sig(ARCHETYPES.res_human.build({ armour: St.keeperArmour({ mando: true, helm: false }) }).rig.root);
console.log(`\n  res_human in robes:            ${bare.n} meshes`);
console.log(`  res_human, mando + bucket ON:  ${clad.n} meshes`);
console.log(`  res_human, mando + bucket OFF: ${bareOff.n} meshes`);
console.log(`  robes ${bare.v} verts / clad ${clad.v} verts / bucket-off ${bareOff.v} verts`);
console.log(`  colours only the clad body has:  ${clad.cols.filter((m) => !bare.cols.includes(m)).join(' ')}`);
console.log(`  colours the bucket adds:         ${clad.cols.filter((m) => !bareOff.cols.includes(m)).join(' ')}`);

for (const deck of [40, 44, 48, 60]) {
  const { world } = await bootWorld({ level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; } });
  const st = world._station, sp = world._playerSpawn();
  const sh = st.shaft, r = sh ? Math.hypot(sh.x, sh.z) : 1, k = (r + 3.2) / r;
  const cx = sh ? sh.x * k : NaN, cz = sh ? sh.z * k : NaN;
  const d = Math.hypot(cx - sp.x, cz - sp.z);
  console.log(`\ndeck ${deck}: car in the ${st.shaft?.id} shaft at (${cx.toFixed(1)}, ${cz.toFixed(1)}); `
    + `player put down at (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)}) — ${d.toFixed(1)} m apart`);
  const smith = (st.keepers || []).find((k) => k.id === 'armourer');
  if (smith) {
    const s = sig(smith.body?.rig?.root);
    console.log(`  #10: ${smith.body?.stationName} — helm=${smith.helm} mando=${smith.mando} `
      + `armour=${JSON.stringify(smith.body?.stationArmour)} ${s.n} meshes`);
    console.log(`       ${s.v} verts; colours the robed man does not have: ${s.cols.filter((m) => !bare.cols.includes(m)).join(' ') || 'NONE'}`);
    console.log(`  panel line: "${St.keeperOf('armourer', world).said}"`);
    console.log(`  clothier:   "${St.keeperOf('clothier', world).said}"`);
    const { idleInput } = await import('./checks/_coop.mjs');
    const p0s = new Map((st.keepers || []).map((k) => [k.id, k.body.position.clone()]));
    const p0 = smith.body.position.clone();
    for (let i = 0; i < 180; i++) world.update(1 / 60, idleInput());
    console.log('  drift after 3 s: ' + (st.keepers || []).map((k) => `${k.id} ${p0s.get(k.id).distanceTo(k.body.position).toFixed(2)}m`).join(', '));
    const p1 = smith.body.position;
    const s2 = sig(smith.body.rig?.root);
    console.log(`  after 3 s of world.update: alive=${!smith.body.dead} moved ${p0.distanceTo(p1).toFixed(2)} m, `
      + `still ${s2.n} meshes, beskar still on: ${s2.cols.includes('#58afca')}`);
  }
  world.unload();
}
process.exit(0);
