/**
 * BATTLEFIELD BORZ — WHAT THE HORDE ACTUALLY DOES, PER BODY-SECOND.
 *
 * ── WHY A CENSUS AND NOT A CHECK ─────────────────────────────────────────
 *
 * `src/game/Enemy.js` is 7 900 lines and most of them describe a behaviour:
 * a droideka raising its shield, a grenadier deciding a clump is worth a
 * grenade, a body whose nerve has gone giving ground at an angle, a beast
 * choosing between five verbs, an elite rallying the men inside its ring. Every
 * one of those reads correctly in the source. NONE of the source says how often
 * it happens in a fight, and this repository's signature defect (HANDOFF §2.3)
 * is a thing that reads correctly and is inert.
 *
 * So this counts. One number per behaviour: how many times it fired, divided by
 * the BODY-SECONDS the arm actually simulated — the sum over frames of (living
 * enemies × dt) — which is the only denominator that lets a 40-body Command
 * battle and a 12-body wave be read on one axis.
 *
 * A rate of 0.000 is the finding. It means either nobody reaches the branch or
 * nothing can.
 *
 * ── HOW IT MEASURES ─────────────────────────────────────────────────────
 *
 * By WRAPPING the shipped methods, never by restating what they do (HANDOFF
 * §2.4). `_castPower`, `_beginTelegraph`, `cry`, `dropShield`, `_shoot`,
 * `GrenadeField.throw` are wrapped on the prototype; everything else is a
 * per-frame sample of a field the shipped code writes. Nothing here decides
 * whether a behaviour SHOULD have fired.
 *
 * ── THE TRAPS IT OBEYS ──────────────────────────────────────────────────
 *
 *  §2.5c  the player is `tools/_flagship.mjs`'s `dutyInput`, driven through its
 *         own `drive`, which ticks the script before every step. A bench that
 *         writes its own loop gets a statue.
 *  §2.11  ONE rng stream per process. Each arm is one invocation of this file;
 *         two arms in one process are not comparable and this file does not
 *         claim they are — it prints a census, not an A/B.
 *  §2.1   run it as `node --import ./tools/register.mjs tools/_horde.mjs`.
 *
 *   node --import ./tools/register.mjs tools/_horde.mjs [--mode waves|command]
 *        [--level geonosis] [--seconds 120] [--seed 7]
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootWorld } from './checks/_coop.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const MODE = flag('mode', 'waves');
const LEVEL = flag('level', MODE === 'command' ? 'geonosis' : 'colosseum');
const SECONDS = Number(flag('seconds', '120'));
const SEED = Number(flag('seed', '7'));
const JSONOUT = argv.includes('--json');

/** §2.5c/§2.6: 1/30 is inside the range main.js clamps to and every arm uses it. */
const STEP = 1 / 30;

/* ── the tally ────────────────────────────────────────────────────────── */

const T = {
  bodySeconds: 0,
  frames: 0,
  peakLive: 0,
  /** counts */
  n: Object.create(null),
  /** body-seconds spent in a state */
  s: Object.create(null),
  /** which archetypes were ever seen doing a thing */
  who: Object.create(null),
  /** which archetypes were on the field at all, and for how many body-seconds */
  roster: Object.create(null),
};
const bump = (k, by = 1, type = null) => {
  T.n[k] = (T.n[k] || 0) + by;
  if (type) (T.who[k] = T.who[k] || new Set()).add(type);
};
const dwell = (k, by, type = null) => {
  T.s[k] = (T.s[k] || 0) + by;
  if (type) (T.who[k] = T.who[k] || new Set()).add(type);
};

/* ── instrumentation ──────────────────────────────────────────────────── */

async function instrument() {
  const E = await import('../src/game/Enemy.js');
  const R = await import('../src/game/Reactions.js');
  const P = E.Enemy.prototype;

  const wrap = (obj, name, tag, extra = null) => {
    const base = obj[name];
    if (typeof base !== 'function') throw new Error(`nothing to wrap at ${name}`);
    obj[name] = function (...a) {
      const out = base.apply(this, a);
      try { bump(tag, 1, this.type); extra?.(this, a, out); } catch {}
      return out;
    };
  };

  /* WHAT THE BODY WAS DOING WHEN IT FIRED. `aimQuality`'s MOVEMENT term —
   * "a body running is not aiming … troops that stop shoot better" — is worth
   * up to 1.55x of a body's own spread, and nothing in the brain ever chooses
   * to stand still. Sampled at the moment of the shot, off the same two fields
   * the term reads, so this cannot disagree with it about what "moving" is. */
  const shootBase = P._shoot;
  P._shoot = function (...a) {
    try {
      const v = this.velocity ? this.velocity.length() : 0;
      const k = Math.min(1, Math.max(0, v / Math.max(1.5, this.speed || 4)));
      T._moveTerm = (T._moveTerm || 0) + (1 + Math.min(k, 1.4) * 0.55);
      T._moveN = (T._moveN || 0) + 1;
      if (k < 0.15) bump('shoot.planted', 1, this.type);
      T._aimQ = (T._aimQ || 0) + this.aimQuality(20);
    } catch {}
    return shootBase.apply(this, a);
  };
  wrap(P, '_shoot', 'shoot');
  wrap(P, '_beginTelegraph', 'telegraph');
  wrap(P, 'dropShield', 'shield.broken');
  wrap(P, 'cry', 'cry', (self, a) => bump('cry.' + (a[0] || '?'), 1, self.type));
  wrap(P, '_castPower', 'force.cast', (self, a) => bump('force.' + (a[0] || '?'), 1, self.type));
  wrap(P, '_detonate', 'unstable.detonate');
  wrap(P, 'knockFlat', 'knockFlat');
  wrap(P, 'topple', 'topple');
  /* `_hasLineOfSight` is the one query in this class that costs real work — see
   * the note over GRENADE_LOOK. Counting it is how a per-frame scan is caught. */
  wrap(P, '_hasLineOfSight', 'query.los');

  const GF = R.GrenadeField.prototype;
  const throwBase = GF.throw;
  GF.throw = function (from, to, opts = {}) {
    const g = throwBase.call(this, from, to, opts);
    if (opts.owner) bump('grenade.thrown', 1, opts.owner.type);
    return g;
  };
  return { E, R };
}

/* ── the per-frame sample ─────────────────────────────────────────────── */

function sample(world, dt, mods) {
  const { R, Nerve } = mods;
  let live = 0;
  for (const e of world.enemies) {
    if (!e || e.dead) continue;
    live++;
    const ty = e.type;
    T.roster[ty] = (T.roster[ty] || 0) + dt;

    /* REACTIONS. Counted as a START — a transition into a kind — because a
     * dive that owns a body for 1.5 s is one decision, not 45 of them. */
    const kind = e.reaction?.kind || null;
    if (kind !== e._benchReact) {
      if (kind) bump('react.' + kind, 1, ty);
      e._benchReact = kind;
    }
    if (kind) dwell('react.sec', dt, ty);

    /* NERVE. Both thresholds, and the ledger is read through the shipped
     * accessor so this cannot disagree with the game about where they are. */
    const nv = Nerve.nerveOf(e);
    if (Nerve.nerveBroken(e)) dwell('nerve.broken.sec', dt, ty);
    if (Nerve.nerveRefusing(e)) dwell('nerve.refusing.sec', dt, ty);
    if (nv < (T._worstNerve ?? 2)) T._worstNerve = nv;

    /* SHIELD. Up is a dwell; the RAISE is the decision. */
    if (e.A?.shield || e.mod === 'shielded') {
      if (e.shieldUp) dwell('shield.up.sec', dt, ty);
      if (e.shieldUp && !e._benchShield) bump('shield.raised', 1, ty);
      e._benchShield = !!e.shieldUp;
    }

    /* THE SIEGE GUN'S PLANT — `planted` is smoothed 0..1 and read by the poser. */
    if (e.A?.plant) {
      if ((e.planted ?? 0) > 0.5) dwell('plant.settled.sec', dt, ty);
      if ((e.plantTimer || 0) >= e.A.plant) dwell('plant.ready.sec', dt, ty);
    }

    /* THE LEADER'S RING. */
    if (e.rallyTimer > 0) dwell('rally.sec', dt, ty);
    if (e.dread > 0) dwell('dread.sec', dt, ty);

    /* NAVIGATION. `_stuckT` past 0.5 is the COMMIT term swinging the wish. */
    if ((e._stuckT || 0) > 0.5) dwell('stuck.sec', dt, ty);
    if ((e._wallT || 0) > 0) dwell('wall.sec', dt, ty);

    /* THE DUELLIST'S FEET — `pressIn` is Ataru's in/out and `strafeDir` its line. */
    if (e.pressIn !== e._benchPress) { if (e._benchPress !== undefined) bump('strafe.flip', 1, ty); e._benchPress = e.pressIn; }

    /* A BEAST'S VERB. `beastMove` is the key the brain committed to. */
    const bm = e.beastMove || e.beastKey || null;
    if (bm !== e._benchBeast) { if (bm) bump('beast.' + bm, 1, ty); e._benchBeast = bm; }

    /* FORCE POOL — a duellist that never spends is a duellist with no kit. */
    if (e.powers) {
      dwell('kit.sec', dt, ty);
      if (e.casting) dwell('kit.casting.sec', dt, ty);
      if (e._castTimer > 0) dwell('kit.windup.sec', dt, ty);
    }

    /* GRENADIERS — how much of the fight a body that CAN throw one spends
     * inside the band where it is allowed to. */
    if (e.A?.grenades) {
      dwell('grenadier.sec', dt, ty);
      if ((e.grenadeCd ?? 0) <= 0) dwell('grenadier.ready.sec', dt, ty);
    }

    /* WHO IT IS SHOOTING AT — a body with no target is a body doing nothing. */
    if (!e.target) dwell('no-target.sec', dt, ty);
  }
  /* LIVE GRENADES and who shouted about them. */
  for (const g of (world.grenades?.list || [])) {
    if (g.dead) continue;
    dwell('grenade.live.sec', dt);
    const sh = g._shouted ? g._shouted.size : 0;
    if (sh > (g._benchShout || 0)) { bump('grenade.shout', sh - (g._benchShout || 0)); g._benchShout = sh; }
  }
  T.bodySeconds += live * dt;
  T.frames++;
  T.peakLive = Math.max(T.peakLive, live);
}

/* ── the arms ─────────────────────────────────────────────────────────── */

async function boot() {
  if (MODE === 'command') {
    const { world } = await bootWorld({
      level: LEVEL,
      settings: { mode: 'command', level: LEVEL, order: 'jedi', seed: SEED,
        difficulty: 'knight', quality: 'low' },
    });
    world.director.start(1);
    return world;
  }
  const { world } = await bootWorld({
    level: LEVEL,
    settings: { mode: 'waves', level: LEVEL, difficulty: 'knight', quality: 'low' },
  });
  world.director?.start?.(1);
  return world;
}

async function main() {
  const mods = await instrument();
  const { enemyRng } = mods.E;
  const Nerve = await import('../src/game/Nerve.js');
  const { seedWaves } = await import('../src/game/Waves.js');
  const W = await import('../src/game/World.js');
  enemyRng.seed(SEED);
  seedWaves?.(SEED);
  W.seedWorld?.(SEED);

  const world = await boot();
  /* §2.5c — the scripted Jedi, and `dutyInput` installs the tick on
   * `world.update` itself so no loop here can forget it. */
  const { dutyInput } = await import('./_flagship.mjs');
  const input = dutyInput(world);

  const n = Math.round(SECONDS / STEP);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    sample(world, STEP, { R: mods.R, Nerve });
  }
  const wall = Date.now() - t0;

  /* ── the report ───────────────────────────────────────────────────── */
  const bs = T.bodySeconds || 1;
  const rows = [];
  for (const k of Object.keys(T.n).sort()) {
    rows.push({ what: k, unit: 'per body-s', n: T.n[k], rate: T.n[k] / bs,
      who: [...(T.who[k] || [])].sort().join(',') });
  }
  for (const k of Object.keys(T.s).sort()) {
    rows.push({ what: k, unit: 'share', n: +T.s[k].toFixed(2), rate: T.s[k] / bs,
      who: [...(T.who[k] || [])].sort().join(',') });
  }
  const report = {
    mode: MODE, level: LEVEL, seed: SEED, seconds: SECONDS, step: STEP,
    frames: T.frames, bodySeconds: +bs.toFixed(1), peakLive: T.peakLive,
    worstNerve: T._worstNerve === undefined ? null : +T._worstNerve.toFixed(3),
    /* The MOVEMENT term of `aimQuality` averaged over every shot fired: 1.00 is
     * a body standing still and 1.55 is one at its own top speed. */
    moveTermAtFire: T._moveN ? +(T._moveTerm / T._moveN).toFixed(3) : null,
    aimQualityAtFire: T._moveN ? +(T._aimQ / T._moveN).toFixed(3) : null,
    wallMs: wall,
    roster: Object.fromEntries(Object.entries(T.roster)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(1)])),
    rows,
  };
  if (JSONOUT) { console.log(JSON.stringify(report, null, 2)); return; }

  mkdirSync(resolve(ROOT, '.horde'), { recursive: true });
  writeFileSync(resolve(ROOT, `.horde/${MODE}-${LEVEL}-s${SEED}.json`), JSON.stringify(report, null, 2));

  console.log(`\n${MODE} · ${LEVEL} · seed ${SEED} · ${SECONDS} game-s in ${(wall / 1000).toFixed(1)} s wall`);
  console.log(`${T.frames} frames · ${bs.toFixed(0)} body-seconds · peak ${T.peakLive} alive · worst nerve ${report.worstNerve}`);
  console.log(`movement term at fire ${report.moveTermAtFire} (1.00 still … 1.55 flat out) · aimQuality ${report.aimQualityAtFire}`);
  console.log(`roster: ${Object.entries(report.roster).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log('');
  const w = Math.max(...rows.map((r) => r.what.length), 20);
  console.log('  ' + 'behaviour'.padEnd(w) + '   count      per body-s   who');
  for (const r of rows) {
    console.log('  ' + r.what.padEnd(w) + '  ' + String(r.n).padStart(7) + '   '
      + r.rate.toFixed(5).padStart(9) + '   ' + r.who.slice(0, 60));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
