import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => { const b = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
}
const { bootWorld } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
diskFetch(); await prepareStation();
const { world } = await bootWorld({ level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 44; } });
const P = world.player;
console.log('player keys:', ['rig','cloak','skirt','waistCape','hoodShell','hoodDrape'].map(k => `${k}=${P?.[k] ? typeof P[k] : 'none'}`).join(' '));
for (const k of ['cloak','skirt','waistCape','hoodDrape']) {
  const c = P?.[k]; if (!c) continue;
  console.log(' ', k, 'keys:', Object.keys(c).join(','));
  for (const kk of ['mesh','obj','group','root','object']) if (c[kk]) console.log('    ', kk, c[kk].type, c[kk].parent === P.world?.scene ? '(scene child)' : `(parent ${c[kk].parent?.name || c[kk].parent?.type})`, JSON.stringify(c[kk].position));
}
const kinds = new Map();
for (const c of world.scene.children) {
  const key = `${c.type}:${c.name || '(anon)'}`;
  kinds.set(key, (kinds.get(key) || 0) + 1);
}
console.log('top-level children by kind:');
for (const [k, n] of [...kinds].sort((a,b)=>b[1]-a[1]).slice(0, 25)) console.log('   ', n, k);
console.log('station group name:', world._station?.group?.name, 'parent is scene:', world._station?.group?.parent === world.scene);
const h = world._home;
let node = h.group, path = [];
while (node) { path.push(`${node.type}:${node.name||'(anon)'}(${node.children.length})`); node = node.parent; }
console.log('cabin path up:', path.join(' -> '));
world.dispose?.();
