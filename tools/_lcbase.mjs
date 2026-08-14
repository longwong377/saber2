/* scratch: lane-C baselines. Delete before commit. */
import './dom-shim.mjs';
import { makeDocument } from './checks/_page.mjs';
import { readFile } from 'node:fs/promises';

const INDEX = await readFile(new URL('../index.html', import.meta.url), 'utf8');

/* ── 1. pool.length vs unique types ───────────────────────────────────── */
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
console.log('--- level cards: pool.length vs unique');
let over = 0, tot = 0;
for (const k of LEVEL_ORDER) {
  const L = LEVELS[k];
  const u = new Set(L.pool).size;
  if (L.pool.length !== u) { over++; tot += L.pool.length - u; }
  console.log(`  ${k.padEnd(10)} bag ${L.pool.length}  unique ${u}${L.pool.length !== u ? '  OVERSTATED' : ''}`);
}
console.log(`  ${over}/${LEVEL_ORDER.length} overstate, ${tot} excess`);

/* ── 2. announcer + presence classification ───────────────────────────── */
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { Announcer } = await import('../src/ui/Announcer.js');
const { bodyOf } = await import('../src/engine/Presence.js');
const { ENEMY_VOICES } = await import('../src/engine/Voice.js');
const vname = (spec) => Object.keys(ENEMY_VOICES).find(k => ENEMY_VOICES[k] === spec) || '?';
console.log('--- voices / bodies by archetype (', Object.keys(ARCHETYPES).length, 'keys )');
for (const k of Object.keys(ARCHETYPES)) {
  const e = { type: k, A: ARCHETYPES[k] };
  const spec = Announcer.prototype._enemySpec.call(null, e);
  const b = bodyOf(e);
  console.log(`  ${k.padEnd(10)} voice ${vname(spec).padEnd(8)} f0 ${String(spec.f0).padEnd(4)} ring ${spec.ring ? 'y' : 'n'}  | presence droid=${b.droid ? 1 : 0} beast=${b.beast ? 1 : 0} trooper=${b.trooper ? 1 : 0} legs=${b.legs}`);
}

/* ── 3. wardrobe rows per species ─────────────────────────────────────── */
const { Menu, DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
const { SPECIES, HAIR_STYLES, BEARD_STYLES } = await import('../src/game/Bodies.js');
console.log('--- wardrobe rows per species (HAIR_STYLES', HAIR_STYLES.length, 'BEARD_STYLES', BEARD_STYLES.length, ')');
for (const sp of SPECIES) {
  const doc = makeDocument(INDEX);
  const restore = doc.install();
  try {
    const s = { ...structuredClone(DEFAULT_SETTINGS), species: sp.id };
    const menu = new Menu(s, {});
    const n = (id) => doc.getElementById(id)?.children.length ?? -1;
    const hid = (id) => doc.getElementById(id)?.style.display;
    console.log(`  ${sp.id.padEnd(9)} hair:${sp.hair ? 'yes' : 'NO '} #hairstyle-list ${n('hairstyle-list')} (display ${hid('hairstyle-list') ?? '-'}) #beard-list ${n('beard-list')} #skin-list ${n('skin-list')}`);
    void menu;
  } finally { restore(); }
}
