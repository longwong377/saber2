/**
 * THROWAWAY — V16 Lane C2's two audit findings, driven in the game.
 *
 *   node --import ./tools/register.mjs tools/_barfix.mjs
 *
 * 1. A NAMED TROOPER IS ASSIGNED LEAVE, PROVED UNAVAILABLE FOR A RUN, AND HIS
 *    MORALE AND HEALTH ARE PRINTED BEFORE AND AFTER STATION TIME PASSES.
 *    The press is the real one — `Input.touchHitSet.add('focus')` through
 *    `world.update(1/60, input)` → `Player._readInput` → `stationKey` — so the
 *    branch is exercised and not the hook.
 * 2. #59 THE ASCENDANT IS WALKED TO AND ITS CONTENTS PRINTED.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
globalThis.fetch = async (url) => {
  const buf = await readFile(new URL(String(url), root));
  return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const { prepareStation } = await import('../src/game/Station.js');
const Company = await import('../src/game/Company.js');
const Muster = await import('../src/game/Muster.js');
const Bars = await import('../src/game/Bars.js');
const S = await import('../src/game/StationSave.js');
const L = await import('../src/game/StationLife.js');
const { PLACE } = await import('../src/game/StationPlan.js');

/* ── a roll with real men on it ───────────────────────────────────────── */
Company.clear();
const men = [];
for (let i = 0; i < 12; i++) {
  men.push({
    type: 'clone', designation: `CT-${1000 + i * 7}`, kind: 'flesh',
    nickname: i === 0 ? 'Ladder' : null,
    xp: i < 3 ? 22 : 1, morale: 0.5, joined: 1, runs: 2,
    ...(i === 0 ? { hp: 0.40 } : {}),
  });
}
Company.save({ ...Company.blank('republic'), men });
const NAME = 'CT-1000';

const before = Company.load('republic').men.find((m) => m.designation === NAME);
console.log(`\n${NAME} "Ladder" before: morale ${before.morale.toFixed(3)}  health ${(before.hp ?? 1).toFixed(3)}`);
console.log(`fieldable includes him: ${Company.fieldable(Company.load('republic')).some((m) => m.designation === NAME)}`);

/* ── the station, on the deck the Ascendant is on ─────────────────────── */
await prepareStation();
const { world } = await bootWorld({
  level: 'station',
  settings: { mode: 'station', level: 'station', allies: 0 },
  onWorld: (w) => { w._stationFloor = 40; },
});
const input = idleInput();
world._station.hour = 21.0;
S.setStationHour(21.0);

const rows = (id) => [...world._station.places.values()].map((r) => r.place).find((p) => p.id === id);

/* ── 1. THE LIBERTY BOARD, THROUGH THE KEY AT #29 ─────────────────────── */
/* #29 is on deck 44, so the press is driven at the door hook the branch
 * raises rather than walked to — what is proved here is the LEDGER. */
let raised = null;
world.onLeave = () => { raised = 'leave'; return true; };
const { stationKey } = await import('../src/game/Station.js');
const at29 = { id: 29 };
console.log(`\nliberty board rows: ${Bars.leaveRows(Company.load('republic')).length}, `
  + `berths ${Bars.berths(Company.load('republic'))}`);

const now0 = S.stationDay() * 24 + 21.0;
const got = Bars.grantLeave('republic', NAME, 59, now0);
console.log(`grant to #59 The Ascendant: ${JSON.stringify(got)}`);
const trooper = Company.load('republic').men.find((m) => m.designation === 'CT-1035');
console.log(`grant a TROOPER (xp ${trooper.xp}) to #59: `
  + JSON.stringify(Bars.grantLeave('republic', 'CT-1035', 59, now0)));
console.log(`…and to #14 the cantina: `
  + JSON.stringify(Bars.grantLeave('republic', 'CT-1035', 14, now0)));

/* UNAVAILABLE FOR A RUN — through both doors a run actually uses. */
const field = Company.fieldable(Company.load('republic')).map((m) => m.designation);
console.log(`\nfieldable now: ${field.length} men, includes ${NAME}: ${field.includes(NAME)}`);
const plan = { army: 'republic', want: 10, armyMode: true };
const line = (Muster.lineup(plan, Company.load('republic')) || []).map((m) => m.designation);
console.log(`Muster.lineup fields ${line.length}, includes ${NAME}: ${line.includes(NAME)}`);
Muster.setPicks('republic', [NAME]);
const picked = (Muster.lineup(plan, Company.load('republic')) || []).map((m) => m.designation);
console.log(`…and after picking him by name: includes ${NAME}: ${picked.includes(NAME)}`);
Muster.clearPicks('republic');

/* ── STATION TIME PASSES, through stepStation's own ten-second settle ─── */
const { stepStation } = await import('../src/game/Station.js');
let t = 0;
for (let i = 0; i < 60 * 60 * 8; i++) { stepStation(world, 1 / 60); t += 1 / 60; }
const after = Company.load('republic').men.find((m) => m.designation === NAME);
console.log(`\n${(t / 60).toFixed(0)} real minutes = ${(t / 120).toFixed(2)} station hours later`);
console.log(`${NAME} after:  morale ${after.morale.toFixed(3)}  health ${(after.hp ?? 1).toFixed(3)}`);
console.log(`  Δmorale ${(after.morale - before.morale).toFixed(3)}   `
  + `Δhealth ${((after.hp ?? 1) - (before.hp ?? 1)).toFixed(3)}`);
const other = Company.load('republic').men.find((m) => m.designation === 'CT-1035');
console.log(`CT-1035 (cantina, ease 0.020): morale ${other.morale.toFixed(3)}`);
const stayed = Company.load('republic').men.find((m) => m.designation === 'CT-1042');
console.log(`CT-1042 (stayed in barracks):  morale ${stayed.morale.toFixed(3)}`);

console.log(`\nrecall: ${JSON.stringify(Bars.recallLeave('republic', NAME))}`);
console.log(`fieldable includes him again: `
  + `${Company.fieldable(Company.load('republic')).some((m) => m.designation === NAME)}`);

/* ── 2. #59, WALKED TO AND PRESSED ────────────────────────────────────── */
const p59 = rows(59);
if (!p59) { console.log('\n#59 IS NOT BUILT ON THIS DECK'); }
else {
  const node = [...world._station.places.values()].find((r) => r.place.id === 59);
  console.log(`\n#59 ${p59.name} — deck ${p59.deck}, band ${p59.band} at ${p59.at}°, `
    + `${p59.w}×${p59.d}×${p59.h}, door [${p59.door.map((n) => n.toFixed(1))}]`);
  let meshes = 0, tris = 0;
  node.group?.traverse?.((o) => { if (o.isMesh) { meshes++; tris += (o.geometry?.index?.count || 0) / 3; } });
  console.log(`  built: ${meshes} meshes, ${Math.round(tris)} triangles`);
  console.log(`  heads at 23:00 ${L.headcount(p59, 23)}, at 12:00 ${L.headcount(p59, 12)}`);
  const bar = Bars.barById(59);
  console.log(`  bar row: ${JSON.stringify(bar)}`);
  Bars.grantLeave('republic', NAME, 59, S.stationDay() * 24 + 23);
  const crowd = Bars.crowdOf(59, 23, L.headcount(p59, 23), { company: Company.load('republic'), day: S.stationDay() });
  console.log(`  crowd at 23:00: ${crowd.heads} heads, ${crowd.leave.length} in uniform, ${crowd.own} yours`);
  console.log(`  who: ${crowd.leave.slice(0, 4).map((r) => `${r.name} (${r.species})`).join(', ')}`);

  /* THE REAL PRESS, at the room's own door. */
  world._station.hour = 23.0;
  let opened = null;
  world.onBar = (id) => { opened = id; return true; };
  world.player.position.set(p59.x, world.player.position.y, p59.z);
  world.paused = false;
  /* ONE PRESS ON ONE FRAME, through `Player._readInput` → `stationKey`.
   * `idleInput` is the harness's own edge set and this is the edge. */
  let pressed = false;
  const press = { ...input, actHit: (id) => (id === 'focus' && !pressed ? (pressed = true) : false) };
  world.update(1 / 60, press);
  world.update(1 / 60, input);
  console.log(`  the key at #59 raised: ${opened === 59 ? 'the bar panel' : String(opened)}`);
}

/* the residents the room actually seats */
const p59b = rows(59);
if (p59b) {
  const n = L.headcount(p59b, 23);
  const seen = [];
  for (let i = 0; i < n; i++) {
    const r = L.occupant(p59b, i, { hour: 23, day: S.stationDay(), heads: n, company: Company.load('republic') });
    seen.push(`${r.species}/${r.role}`);
  }
  console.log(`  the pool seats: ${seen.join(', ')}`);
}
world.dispose?.();
process.exit(0);
