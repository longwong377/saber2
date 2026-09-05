import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
function diskFetch(){ if(globalThis.fetch&&globalThis.__stationFetch)return; const root=new URL('../',import.meta.url); globalThis.__stationFetch=true;
 globalThis.fetch=async(u)=>{const b=await readFile(new URL(String(u),root));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};}
diskFetch();
const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation, keeperOf } = await import('../src/game/Station.js');
await prepareStation();
const { world } = await bootWorld({ level:'station', settings:{mode:'station',level:'station',allies:0}, onWorld:(w)=>{w._stationFloor=40;} });
const st = world._station;
console.log(`keepers dressed: ${st.keepers.length}`);
for (const k of st.keepers) {
  const b = k.body;
  const A = b?.A || {};
  console.log(`  ${k.id.padEnd(10)} ${String(k.who.name).padEnd(20)} species=${k.who.species.padEnd(9)} helm=${k.helm} mando=${k.mando}  body type=${b?.type ?? b?.archetype ?? '?'} A.helmet=${A.helmet ?? A.helm ?? '(none)'} keys=${Object.keys(A).filter(x=>/helm|hat|mask|bucket/i.test(x)).join(',')||'-'}`);
}
const smith = st.keepers.find(k=>k.id==='armourer');
if (smith) {
  const b = smith.body;
  console.log('\n#10 smith body detail:');
  console.log('  constructor:', b?.constructor?.name, ' A keys sample:', Object.keys(b?.A||{}).slice(0,25).join(','));
  console.log('  stationName:', b?.stationName, 'stationSpecies:', b?.stationSpecies);
}
console.log('\nkeeperOf("armourer") says:', JSON.stringify(keeperOf('armourer', world)));
process.exit(0);
