/**
 * WHAT IS ACTUALLY MATTER, OBJECT BY OBJECT — the audit behind the claim.
 *
 * This repository has told the player, more than once and in a commit
 * headline, that everything in the game has physics. "A falling tree is
 * matter: the last thing in the game that was not" was true of COLLISION and
 * false of CUTTING: the trunk was a real kinematic body while it fell and the
 * blade was offered no capsule for it, so a swing passed straight through the
 * thing that was about to crush you. One word, two meanings, and nothing in
 * the tree measured the difference.
 *
 * So this asks all three questions of every object a level actually contains,
 * and prints the ones that answer no:
 *
 *   BODY     is it in the physics world at all — can it be walked into,
 *            shoved, landed on
 *   STRIKER  is it armed, so that moving into something prices a blow
 *   BLADE    does it offer the blade a capsule — can it be CUT
 *
 * A no is not automatically a defect: a hazard volume is not meant to be cut,
 * and a manager object that sits in `world.props` so the loops can find it is
 * not a thing at all. What this file exists for is that the nos are LISTED,
 * with the reason beside them, instead of being invisible until somebody
 * swings at one.
 *
 *   node --import ./tools/register.mjs tools/_matter.mjs [level…]
 */
import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';

const LEVELS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
/* Each entry is a level and the mode to see it under, because what is IN a
 * world is the mode's doing: sandbox puts nothing on the field, and the mass
 * ranks only exist in the one mode that lays a front. */
const SCENES = LEVELS.length
  ? LEVELS.map((l) => ({ level: l, mode: 'sandbox' }))
  : [{ level: 'wood', mode: 'sandbox' }, { level: 'geonosis', mode: 'waves', warm: 20 },
     { level: 'geonosis', mode: 'thefront', warm: 20 }];

/* Objects that are in `world.props` to be ITERATED rather than to be hit: a
 * pack, a director, a front. They are named here so a real prop that starts
 * answering no cannot hide among them. */
const MANAGERS = new Set(['front', 'levy', 'flight', 'riders', 'mass']);

const idle = { act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => (o ? (o.x = 0, o.y = 0, o) : { x: 0, y: 0 }),
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };

for (const scene of SCENES) {
  const { level, mode, warm } = scene;
  const { world } = await bootWorld({ level, settings: { mode, difficulty: 'knight' } });
  /* Let the mode actually put its contents on the field — a wave director
   * spawns nothing on frame 0, and a front is laid over the first seconds. */
  for (let i = 0; i < (warm || 0) * 60; i++) world.update(1 / 60, idle);
  const rows = [];
  const seen = new Map();
  const scan = (o, what) => {
    if (!o) return;
    const kind = o.kind || o.type || o.constructor?.name || what;
    /**
     * ASKED WHERE THE THING IS, NOT WHERE THE PROBE LEFT IT.
     *
     * A forest and the destruction proxy both cull their capsule list to what
     * is near their own body, which follows the blade in play. Asked once with
     * the body wherever it happened to sit, both answer zero — and zero here
     * reads as "the blade cannot touch this", which is exactly the false
     * negative this file exists to avoid producing. So the proxy is walked to
     * the player and to a spread of the level's own content before the answer
     * is believed, and put back afterwards.
     */
    let caps = 0;
    const ask = () => {
      try { return typeof o.capsules === 'function' ? (o.capsules([]) || []).length : -1; }
      catch { return -2; }
    };
    caps = ask();
    if (caps === 0 && o.body?.position && probes.length) {
      const was = o.body.position.clone();
      for (const pt of probes) {
        o.body.position.copy(pt);
        const n = ask();
        if (n > 0) { caps = n; break; }
      }
      o.body.position.copy(was);
    }
    const body = o.body || null;
    const armed = !!(body && typeof body.onContact === 'function');
    const key = `${what}:${kind}`;
    const prev = seen.get(key) || { what, kind, n: 0, body: 0, armed: 0, caps: 0, capsMax: 0 };
    prev.n++;
    if (body) prev.body++;
    if (armed) prev.armed++;
    if (caps > 0) { prev.caps++; prev.capsMax = Math.max(prev.capsMax, caps); }
    prev.capsRaw = caps;
    seen.set(key, prev);
  };
  /* Somewhere to stand the proxies: the player, and a spread of whatever the
   * level actually put on the ground. */
  const probes = [];
  if (world.player) probes.push(world.player.position.clone());
  for (const p of world.props || []) if (p?.body?.position && p.kind !== 'forest') probes.push(p.body.position.clone());
  const forest = (world.props || []).find((p) => p?.kind === 'forest');
  if (forest?.data) {
    for (let i = 0; i < forest.count && probes.length < 40; i += Math.max(1, forest.count >> 5)) {
      const k = i * 15;
      probes.push(new (world.player.position.constructor)(forest.data[k], forest.data[k + 2] + 1, forest.data[k + 1]));
    }
  }
  for (const p of world.props || []) scan(p, 'prop');
  for (const e of world.enemies || []) scan(e, 'enemy');
  for (const p of world.players || []) scan(p, 'player');

  console.log(`\n══ ${level} / ${mode} — ${world.props?.length || 0} props, `
    + `${world.enemies?.length || 0} enemies`);
  console.log('  what   kind                 n   body  striker  blade');
  for (const r of [...seen.values()].sort((a, b) => (a.what + a.kind).localeCompare(b.what + b.kind))) {
    const flag = (have, n) => (have === n ? `${have}/${n}` : `${have}/${n} <`);
    const bladeCol = r.capsRaw === -1 ? 'no capsules()'
      : r.capsRaw === -2 ? 'THREW'
        : `${r.caps}/${r.n}${r.capsMax ? ` (max ${r.capsMax})` : ''}`;
    const manager = MANAGERS.has(String(r.kind).toLowerCase());
    console.log(`  ${r.what.padEnd(6)} ${String(r.kind).padEnd(18)} ${String(r.n).padStart(4)}  `
      + `${flag(r.body, r.n).padEnd(7)} ${flag(r.armed, r.n).padEnd(8)} ${bladeCol}`
      + (manager ? '   [manager]' : ''));
  }
  world.unload?.(); world.dispose?.();
}
process.exit(0);
