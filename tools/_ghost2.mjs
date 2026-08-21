/**
 * THE INVISIBLE TROOPS PROBE, second form — measured the way a player sees it.
 *
 * "troops go completely invisible a lot like I see their names above their
 *  heads but they're invisible, I can still throw them around though."
 *
 * A nameplate is drawn for a body that is ALIVE. So the defect is: alive, and
 * not one triangle of it on screen. That is what this counts — every frame,
 * over every body in the fight, walking the real scene graph rather than
 * trusting any one flag.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
const THREE = await import('three');
const { enemyRng } = await import('../src/game/Enemy.js');
enemyRng.seed(Number(process.argv[3] || 5));
const MODE = process.argv[2] || 'command';

const LEVEL = MODE === 'command' ? 'geonosis' : 'colosseum';
const { world } = await bootWorld({
  level: LEVEL,
  settings: { mode: MODE, level: LEVEL, quality: 'low', order: 'jedi' },
});
world.director?.start?.(1);
const input = idleInput();

/** Any mesh of this body that would actually be rasterised, and how faded. */
const shown = (e) => {
  let n = 0;
  const walk = (o) => {
    if (!o || !o.visible) return;
    if (o.isMesh && o.geometry) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      /* A mesh drawn at zero opacity is a mesh nobody can see, which is the
       * player's complaint and not a philosophical point. */
      if (mats.some((m) => m && (!m.transparent || m.opacity > 0.02))) n++;
    }
    for (const c of o.children) walk(c);
  };
  const attached = (o) => { for (let p = o; p; p = p.parent) if (p === world.scene) return true; return false; };
  if (e.rig?.root && attached(e.rig.root)) walk(e.rig.root);
  if (e.actor?.holders) for (const h of e.actor.holders.values()) if (attached(h)) walk(h);
  return n;
};

/* THE FIGHT, BRIEFLY: a probe that only watches finds nothing, because none of
 * the paths that could strand a body run in a quiet field. Every abuse below is
 * a thing the player does — a kill, a cut, a body lifted and dropped — and the
 * corpse budget is squeezed so the sink path runs constantly. */
if (world.corpses) world.corpses.budget = 3;
const P = world.player;
let rr = 1234567;
const rand = () => ((rr = (rr * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = () => {
  const live = world.enemies.filter((e) => !e.dead);
  return live.length ? live[Math.floor(rand() * live.length) % live.length] : null;
};
const abuse = (f) => {
  const e = pick();
  if (!e) return;
  const k = Math.floor(rand() * 6);
  if (k === 0) e.damage?.(1e4, e.position.clone(), P, 'probe');
  else if (k === 1) e.actor?.goRagdoll?.(e.velocity.clone(), null);
  else if (k === 2) { P.gripEnemy = e; e.gripped = true; e.actor?.goRagdoll?.(e.velocity.clone(), null); }
  else if (k === 3) { P.gripEnemy = null; e.gripped = false; }   // a grip abandoned, not released
  else if (k === 4) e.applyKnockback?.(new THREE.Vector3((rand() - 0.5) * 40, 12, (rand() - 0.5) * 40), 12, P, true);
  else if (k === 5 && e.actor?.cut) {
    const bones = e.rig?.list?.filter((b) => !b.severed) || [];
    const b = bones[Math.floor(rand() * bones.length) % Math.max(1, bones.length)];
    if (b) { try { e.actor.cut(b.name, e.position.clone(), new THREE.Vector3(1, 0, 0)); } catch { /* not every bone can be cut */ } }
  }
};

const ghosts = new Map();
const limp = new Map();
const STEP = 1 / 30;
for (let f = 0; f < 30 * 150; f++) {
  world.update(STEP, input);
  if (f % 30 === 0) abuse(f);
  if (f % 6) continue;
  for (const e of world.enemies) {
    if (e.dead) { ghosts.delete(e); limp.delete(e); continue; }
    /* HOW LONG IT HAS BEEN DOWN. A body that is limp for a moment is a body
     * that was hit; one that is limp for a quarter of a minute is one nothing
     * is ever going to stand up again. */
    if (e.actor?.ragdolled) {
      const L = limp.get(e) || { first: f, kind: e.type };
      L.last = f; L.secs = (f - L.first) * STEP;
      L.state = `gripped=${!!e.gripped} toppled=${!!e.toppled} legsLost=${!!e.legsLost} recoverAt=${(e._recoverAt || 0).toFixed(1)} suspended=${!!e.liftTarget}`;
      limp.set(e, L);
    } else limp.delete(e);
    /* NOT ZERO — a QUARTER of what it spawned with. A body reduced to a few
     * rivets reads as invisible from ten metres, and a test that only counts
     * the total wipe-out misses the shape the player actually reported. */
    const base = (e._ghostBase ??= shown(e));
    if (shown(e) > Math.max(1, base * 0.25)) { ghosts.delete(e); continue; }
    const g = ghosts.get(e) || { first: f, n: 0, kind: e.type ?? e.kind, team: e.team };
    g.n++; g.last = f;
    g.state = `shown=${shown(e)}/${e._ghostBase} ragdolled=${!!e.actor?.ragdolled} gripped=${!!e.gripped} lod=${e.lod} rig=${e.rig?.root?.visible} holders=${e.actor?.holders?.size ?? 0} toppled=${!!e.toppled}`;
    ghosts.set(e, g);
  }
}

console.log(`${MODE}: ${world.enemies.filter((e) => !e.dead).length} alive of ${world.enemies.length}, ${ghosts.size} ghosts, ${[...limp.values()].filter((L) => L.secs > 12).length} stuck limp, ${world.ghostFixes} ghost repairs`);
for (const [, L] of limp) if (L.secs > 12) console.log(`  limp ${L.kind} for ${L.secs.toFixed(0)} s — ${L.state}`);
for (const [, g] of ghosts) {
  console.log(`  ${g.kind} team${g.team} invisible from frame ${g.first} to ${g.last} (${g.n} samples) — ${g.state}`);
}
