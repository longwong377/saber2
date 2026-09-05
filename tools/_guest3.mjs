import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
function diskFetch(){ if (globalThis.fetch&&globalThis.__stationFetch) return; const root=new URL('../',import.meta.url); globalThis.__stationFetch=true;
  globalThis.fetch=async(u)=>{const b=await readFile(new URL(String(u),root));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};}
diskFetch();
import { bootSession } from './checks/_coop.mjs';
import { prepareStation } from '../src/game/Station.js';
await prepareStation();
const s = await bootSession({ n:2, level:'station', settings:{mode:'station',level:'station',allies:0}, onWorld:(w)=>{w._stationFloor=40;} });
const H=s.host.world, C=s.clients[0].world;
s.pump(30);
const cE=(C.enemies||[]).filter(e=>e&&!e.dead);
const nd=cE.filter(e=>e.netDriven), res=cE.filter(e=>e.stationResident);
console.log(`peer: ${cE.length} bodies — netDriven ${nd.length}, stationResident ${res.length}, both ${cE.filter(e=>e.netDriven&&e.stationResident).length}`);
const hE=(H.enemies||[]).filter(e=>e&&!e.dead);
console.log(`host: ${hE.length} bodies — netDriven ${hE.filter(e=>e.netDriven).length}, stationResident ${hE.filter(e=>e.stationResident).length}`);
// how close does a netDriven body stand to a local resident?
let pairs=0, closest=1e9;
for (const a of nd) for (const b of res) { const d=a.position.distanceTo(b.position); if (d<closest) closest=d; if (d<0.6) { pairs++; break; } }
console.log(`netDriven bodies standing within 0.6 m of a local resident: ${pairs}/${nd.length}; closest ${closest.toFixed(2)} m`);
console.log(`peer clock ${C._station.hour.toFixed(3)}  host clock ${H._station.hour.toFixed(3)}`);
s.close(); process.exit(0);
