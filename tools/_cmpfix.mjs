import './dom-shim.mjs';
/* THROWAWAY. Measures that each temper axis now moves a number in a driven
 * world, and that PLAY is a real care act. Delete when read. */
import * as THREE from 'three';

const STEP = 1 / 30;

async function field(kind = 'massiff', rec = null, settings = {}) {
  const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
  const { fieldCompanion } = await import('../src/game/Companions.js');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', ...settings },
    runSeed: 21,
  });
  const input = idleInput();
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  const e = fieldCompanion(world, world.player, kind, rec ? { rec } : {});
  return { world, input, e, p: world.player };
}
const tick = (world, input, p, n) => {
  for (let i = 0; i < n; i++) { if (p) p.hp = p.maxHp ?? 100; world.update(STEP, input); }
};

const C = await import('../src/game/Companions.js');
const K = await import('../src/game/CompanionKinds.js');
const Kn = await import('../src/game/Kennel.js');

const line = (s) => console.log(s);

/* ── 1. THE AUDITOR'S MUTATION, NOW EXPECTED TO MOVE ──────────────────── */
{
  const { world, input, e, p } = await field('massiff');
  tick(world, input, p, 10);
  const before = {
    leash: C.leashOf(e), band: C.settledBand(e),
    hold: C.holdOf(e), stand: C.standoffOf(e), ward: K.wardOf(e),
  };
  e._cmpSwing = { hold: 999, reach: 0, recall: 0, ward: 999, exposure: -999 };
  const after = {
    leash: C.leashOf(e), band: C.settledBand(e),
    hold: C.holdOf(e), stand: C.standoffOf(e), ward: K.wardOf(e),
  };
  line('[1] mutation  hold 999 / ward 999 / exposure -999 on a fielded massiff');
  for (const k of Object.keys(before)) {
    line(`      ${k.padEnd(6)} ${String(before[k].toFixed(2)).padStart(8)} -> ${String(after[k].toFixed(2)).padStart(8)}`
      + (before[k] === after[k] ? '   UNCHANGED' : '   moved'));
  }
  world.unload?.();
}

/* ── 2. hold: frames until it gives up the ground when dragged ─────────── */
async function dragTest(hold) {
  const { world, input, e, p } = await field('massiff');
  tick(world, input, p, 20);
  e._cmpSwing = { hold, reach: 0, recall: 0, ward: 0, exposure: 0 };
  e._cmpHeld = 0;
  /* WALK OFF. The heel station goes with the owner, so the rope goes taut on
   * the frame after and the animal is past the end of it by 40 m. */
  p.position.x += 40;
  let moved = -1;
  const at0 = e.position.clone();
  const trace = [];
  for (let i = 0; i < 300; i++) {
    tick(world, input, p, 1);
    const d = e.position.distanceTo(at0);
    if (moved < 0 && d > 2) moved = i;
    if (i % 30 === 29) trace.push(d.toFixed(1));
  }
  world.unload?.();
  return { moved, s: moved < 0 ? null : (moved * STEP), trace: trace.slice(0, 5).join('/') };
}
{
  const a = await dragTest(0);
  const b = await dragTest(2.0);
  line(`[2] hold      the owner walks 40 m off. Ground covered after 1/2/3/4/5 s: `
    + `${a.trace} with hold 0, ${b.trace} with hold 2.0`);
  line(`      first 2 m of the walk home at frame ${a.moved} (${a.s?.toFixed(2)}s) with hold 0, `
    + `frame ${b.moved} (${b.s?.toFixed(2)}s) with hold 2.0 — a grace of `
    + `${((b.moved - a.moved) * STEP).toFixed(2)}s`);
}

/* ── 3. ward: how wide the ring the order actually defends is ──────────── */
{
  const rec = Kn.readOne({ id: 'ward1', kind: 'massiff', xp: 400, runs: 4 });
  const { world, input, e, p } = await field('massiff', rec);
  tick(world, input, p, 10);
  const home = new THREE.Vector3();
  const foe = { position: p.position.clone(), team: 99, dead: false };
  const reach = (sw) => {
    e._cmpSwing = sw;
    C.stationFor(e, home);
    let r = 0;
    for (let d = 0.5; d < 30; d += 0.25) {
      foe.position.copy(p.position); foe.position.x += d;
      if (C.dutyAllows(e, foe, home, 1e9)) r = d; else break;
    }
    return r;
  };
  const why = C.orderCompanion(e, 'ward', null);
  line(`      the WARD order: ${why === null ? 'given' : `REFUSED — ${why}`}; duty is ${e._cmpDuty?.id}`);
  const base = reach({ hold: 0, reach: 0, recall: 0, ward: 0, exposure: 0 });
  const rang = reach({ hold: 0, reach: 0, recall: 0, ward: 4.5, exposure: 0 });
  const kept = reach({ hold: 0, reach: 0, recall: 0, ward: -4.5, exposure: 0 });
  line(`[3] ward      WARD meets a hostile out to ${base} m plain, ${rang} m with RANGING (+4.5), `
    + `${kept} m with KEPT (-4.5); K.ward is ${K.COMPANION_KINDS.massiff.ward}`);
  world.unload?.();
}

/* ── 4. exposure: where it stands when it has settled ──────────────────── */
async function standTest(exposure) {
  const { world, input, e, p } = await field('massiff');
  tick(world, input, p, 10);
  e._cmpSwing = { hold: 0, reach: 0, recall: 0, ward: 0, exposure };
  tick(world, input, p, 200);
  const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
  world.unload?.();
  return d;
}
{
  const a = await standTest(0);
  const b = await standTest(-4.0);
  line(`[4] exposure  settled distance from the player: ${a.toFixed(2)} m plain, ${b.toFixed(2)} m `
    + `with KEEN's exposure 4 (heel is ${C.HEEL.back} m)`);
}

/* ── 5. KEPT panics when it is hurt ────────────────────────────────────── */
{
  const rec = Kn.readOne({ id: 'shy1', kind: 'massiff', xp: 0, runs: 9, meals: 9, grooms: 9 });
  Kn.applyTempers(rec);
  const { world, input, e, p } = await field('massiff', rec);
  tick(world, input, p, 10);
  line(`[5] shy       record wears ${JSON.stringify(rec.tempers)}; shyTemper=${Kn.shyTemper(rec)}`);
  const home = new THREE.Vector3();
  const foe = { position: e.position.clone(), team: 99, dead: false };
  foe.position.x += 1;
  C.orderCompanion(e, 'ward', null);
  C.stationFor(e, home);
  const before = C.dutyAllows(e, foe, home, 1e9);
  /* hurt it */
  e.hp = (e.hp ?? e.maxHp) - 12;
  tick(world, input, p, 1);
  const shyT = e._cmpShy;
  C.stationFor(e, home);
  const during = C.dutyAllows(e, foe, home, 1e9);
  const dHome = home.distanceTo(p.position);
  tick(world, input, p, Math.ceil(3.2 / STEP));
  C.stationFor(e, home);
  const after = C.dutyAllows(e, foe, home, 1e9);
  line(`      takes a target before the wound: ${before}; the frame after 12 hp: ${during} `
    + `(_cmpShy ${shyT?.toFixed(2)}s, station is ${dHome.toFixed(2)} m from the player); `
    + `after the clock: ${after}, shies=${e._cmpShies}`);
  /* an animal WITHOUT the temper is untouched */
  const { world: w2, input: i2, e: e2, p: p2 } = await field('massiff');
  tick(w2, i2, p2, 10);
  C.orderCompanion(e2, 'ward', null);
  e2.hp = (e2.hp ?? e2.maxHp) - 12;
  tick(w2, i2, p2, 1);
  const h2 = new THREE.Vector3(); C.stationFor(e2, h2);
  const f2 = { position: e2.position.clone(), team: 99, dead: false }; f2.position.x += 1;
  line(`      a plain massiff hurt the same way: shy=${e2._cmpShy}, takes a target ${C.dutyAllows(e2, f2, h2, 1e9)}`);
  world.unload?.(); w2.unload?.();
}

/* ── 6. PLAY is a real care act ────────────────────────────────────────── */
{
  globalThis.localStorage = (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  })();
  Kn.clear();
  const live = Kn.adopt('massiff', 'Borz');
  line(`[6] play      CARE_ACTS = ${JSON.stringify(Kn.CARE_ACTS)}`);
  for (let i = 0; i < 50; i++) Kn.careFor(live.id, 'plays');
  let r = Kn.load().live;
  line(`      50 presses on a fresh animal: plays=${r.plays}, careOf=${K.careOf(r)}`);
  const k = Kn.load(); k.live.runs = 6; Kn.save(k);
  for (let i = 0; i < 50; i++) { Kn.careFor(live.id, 'plays'); Kn.careFor(live.id, 'meals'); Kn.careFor(live.id, 'grooms'); }
  r = Kn.load().live;
  line(`      after 6 runs: plays=${r.plays} meals=${r.meals} grooms=${r.grooms} careOf=${K.careOf(r)} `
    + `stage=${K.GROWTH_STAGES[K.stageOf(r)].label} tempers=${JSON.stringify(r.tempers)}`);
  line(`      it survives a save/load round trip: plays=${Kn.load().live.plays}`);
  const lines = [];
  for (let n = 1; n <= 4; n++) lines.push(Kn.playLine({ id: r.id, kind: 'massiff', plays: n }));
  line(`      playLine, deterministic: ${lines.map((l) => l.slice(0, 34)).join(' | ')}`);
  line(`      same input twice: ${Kn.playLine(r) === Kn.playLine(r)}`);
  const H = await import('../src/game/Habitat.js');
  const panel = H.habitatPanel();
  line(`      the panel offers ${panel.care.acts.length} controls: `
    + panel.care.acts.map((a) => `${a.label}[${a.can ? 'live' : `grey: ${a.why}`}]`).join(', '));
  Kn.clear();
}
process.exit(0);
