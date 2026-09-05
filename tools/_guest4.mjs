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
const alive=(w)=>(w.enemies||[]).filter(e=>e&&!e.dead);
const line=(tag,w)=>{const a=alive(w);return `${tag} bodies ${a.length} (net ${a.filter(e=>e.netDriven).length}, resident ${a.filter(e=>e.stationResident).length}, guard ${a.filter(e=>e.stationGuard).length}) hour ${w._station.hour.toFixed(3)} day ${w._station.day??0} lift ${w._deckLift?(w._deckLift.car?.position?.y??'?'):'none'}`;}
console.log('t=0  ', line('host',H)); console.log('t=0  ', line('peer',C));
const pos=(w)=>alive(w).map(e=>`${e.position.x.toFixed(3)},${e.position.z.toFixed(3)}`);
const p0h=pos(H), p0c=pos(C);
s.pump(30);
console.log('t=30 ', line('host',H)); console.log('t=30 ', line('peer',C));
const p1h=pos(H), p1c=pos(C);
const frozen=(a,b)=>{let n=0;for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]===b[i]) n++; return n;};
console.log(`still at the exact same spot: host ${frozen(p0h,p1h)}/${Math.min(p0h.length,p1h.length)}  peer ${frozen(p0c,p1c)}/${Math.min(p0c.length,p1c.length)}`);
const cE=alive(C), nd=cE.filter(e=>e.netDriven), res=cE.filter(e=>e.stationResident&&!e.netDriven);
let pairs=0, closest=1e9;
for (const a of nd) for (const b of res){const d=a.position.distanceTo(b.position); if(d<closest) closest=d; if(d<0.6){pairs++;break;}}
console.log(`peer netDriven within 0.6 m of a local resident: ${pairs}/${nd.length}; closest ${nd.length&&res.length?closest.toFixed(2):'n/a'} m`);
console.log(`clock  host ${H._station.hour.toFixed(4)}  peer ${C._station.hour.toFixed(4)}  gap ${(H._station.hour-C._station.hour).toFixed(4)} h`);
/* the wire: how many enemy rows a host snapshot carries on the station */
const { packSnapshot } = await import('../src/net/Net.js');
const snap = packSnapshot(H);
console.log(`host snapshot enemy rows: ${snap.e.length}, bytes ${JSON.stringify(snap).length}`);
/* the lift, driven on both sides */
const { liftFloors } = await import('../src/game/DeckLift.js');
const carY=(w)=>w._deckLift?.car?.position?.y ?? null;
console.log('lift car y  host', carY(H), ' peer', carY(C));
s.close(); process.exit(0);
