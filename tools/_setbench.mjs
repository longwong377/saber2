/**
 * THE TWO HALVES OF DUAL WIELDING'S OWN SENTENCE, DRIVEN.
 *
 *   node --import ./tools/register.mjs tools/_setbench.mjs
 *
 * *"perhaps there will be pluses and minuses to each like maybe with dual
 *  wielding BLOCKING BOLTS IS EASIER OR AREA THAT YOU CAN COVER IS LARGER …
 *  Dual-wielding lightsabers generally provides increased offensive
 *  capabilities AND MOBILITY, making it effective against multiple
 *  opponents."*
 *
 * Everything else in that request has a driven check behind it — the staff's
 * reach against a real body, the spin barrier against real bolts, the throw,
 * the follow-up, the four-body work. These two clauses did not, and both were
 * measured to be false on the tree that shipped them:
 *
 *     PACE   three sets, ten seconds of held-forward mashing, 4.600 m/s each,
 *            to three decimals. `Player._move`'s `base` never asked what was
 *            in your hands and nothing downstream of it did either.
 *     ROSE   sixty bolts round a full circle into a planted guard: single 20
 *            of 60 landed, staff 18, pair 19, and all three stopped answering
 *            at the same 96° bearing.
 *
 * So this file is the instrument those two clauses are now held to. It drives
 * the shipped world — real `Player._move`, real `Bolts.update`, real guard
 * ladder — and recomputes no rule it is measuring.
 *
 * ── ONE WORLD, THREE ARMS, AND WHY THAT IS NOT A TIDINESS POINT ──────────
 *
 * `tools/_beaten.mjs`'s `mixedLine` header is the argument and it was learned
 * expensively there: booting a world per arm compares two worlds, not two
 * weapons. Level dressing, prop placement and the weather are drawn from
 * module-level streams, and this bench felt it — the identical pair arm read
 * 18 landed of 60 in one process and 20 in another, purely because a different
 * number of worlds had been built before it.
 *
 * A set is chosen at `spawnPlayer`, so three arms genuinely need three worlds.
 * What they do not need is three DIFFERENT worlds: `_shared.mjs`'s
 * snapshot/restore puts every shared stream back to the same phase before each
 * boot, so all three arms stand on the same ground under the same sky with the
 * same props, and the only thing that differs between them is what is in the
 * player's hands.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { resolve } from 'node:path';
import { makeRng } from '../src/engine/MathUtil.js';

const H = await import('./checks/_coop.mjs');
const SH = await import('./checks/_shared.mjs');

const STEP = 1 / 60;
const UP = new THREE.Vector3(0, 1, 0);
const DEG = 180 / Math.PI;

/** The three sets, in the order every readout in this project prints them. */
export const SETS = ['single', 'staff', 'pair'];

/**
 * Holds the guard and nothing else — `tools/_beaten.mjs`'s own input, kept
 * here rather than imported because that file's copy is bound to its firing
 * line and this one has to be handed a fresh `moveAxis` per bench.
 *
 * `blade` is the DIRECTIONAL guard's key: `_updateZone` raises `lastZone`
 * (HIGH) on the first frame it is held and holds it, so the rose is live and
 * `guard.active` is true. That is the shipped path and not a poked field.
 */
function scriptedInput({ axis = { x: 0, y: 0 }, guard = false, mash = null } = {}) {
  let want = 0;
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { if (o) { o.x = axis.x; o.y = axis.y; return o; } return { ...axis }; },
    act: (id) => guard && id === 'blade',
    actHit: (id) => (mash && id === 'thrust' && want > 0) ? (want--, true) : false,
    actDown: () => false, end() {},
    press: () => { want = 1; },
  };
}

/**
 * A world with one set in the player's hands, on ground that is the same
 * ground for every arm. `snap` comes from `snapshotShared()` and is taken ONCE
 * by the caller, before the first boot — see the header.
 */
async function bootPinned(set, snap, { level, mode = 'waves', extra = {} } = {}) {
  SH.restoreShared(snap);
  const { world } = await H.bootWorld({
    level,
    settings: { mode, level, quality: 'low', difficulty: 'knight', saberSet: set, ...extra },
    runSeed: 5,
  });
  return { world, p: world.player };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  1. THE PACE — ground covered per second of mashed attack             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * GROUND COVERED PER SECOND BY A PLAYER WHO IS FIGHTING, not by one walking a
 * straight line with the blade down.
 *
 * The script holds the move axis forward, presses the light cut every sixth
 * frame — faster than any of the three sets can accept, so each set runs at
 * its OWN cadence and not at the script's — and turns the camera at 0.28 rad/s
 * so the body traces a wide circle instead of walking off the arena. What is
 * summed is the horizontal PATH, frame by frame, which is "ground covered" and
 * is immune to where the circle happens to close.
 *
 * THE BODY IS TOPPED UP EVERY FRAME, hp and stamina both, for the reason
 * `_beaten.mjs` records in full: a fixture that lets its player be hurt is
 * measuring `staggerTimer`'s 0.35, and one that lets the bar run out is
 * measuring the regen rate wearing three costumes. The arena is cleared of
 * bodies for the same reason — this bench is about the legs.
 *
 * `strikes` is the controller's own count of accepted presses (`slashT`
 * leaving −1, exactly as `_setfight.mjs` counts it), so the cadence each set
 * paid for its pace with is read off the same run rather than argued.
 */
export async function pace(set, snap, { seconds = 10, turn = 0.28, level = 'colosseum' } = {}) {
  const { world, p } = await bootPinned(set, snap, { level, extra: { instantSpawn: true } });
  const input = scriptedInput({ axis: { x: 0, y: 1 }, mash: true });
  try {
    for (let i = 0; i < 40; i++) world.update(STEP, input);
    for (const e of world.enemies) e.dispose();
    world.enemies.length = 0;
    let path = 0, strikes = 0, wasT = -1;
    const frames = Math.round(seconds / STEP);
    for (let i = 0; i < frames; i++) {
      if (i % 6 === 0) input.press();
      const x0 = p.position.x, z0 = p.position.z;
      p.camera.yaw += turn * STEP;
      world.update(STEP, input);
      world.enemies.length = 0;
      p.hp = p.maxHp; p.stamina = 100;
      path += Math.hypot(p.position.x - x0, p.position.z - z0);
      const t = p.control.slashT;
      if (t >= 0 && wasT < 0) strikes++;
      wasT = t;
    }
    return { set, seconds, metres: +path.toFixed(2), mps: +(path / seconds).toFixed(3), strikes };
  } finally { world.unload?.(); }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2. THE ROSE — bolts at a guarding player, from every bearing          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SIXTY BOLTS, ONE AT A TIME, ROUND THE WHOLE CIRCLE, INTO A HELD GUARD.
 *
 * `tools/_spinprobe.mjs`'s `stream` does this for the staff's spin barrier at
 * 24 down one sightline; this is the same shape opened out to a rose, because
 * the claim under test is about AREA and a bench that fires down one bearing
 * cannot see one.
 *
 * ── THREE THINGS THE FIRST CUT GOT WRONG, ALL OF THEM MEASUREMENT ───────
 *
 * IT FIRED FROM A GRID OF YAW × PITCH AND PUT A THIRD OF ITS SHOOTERS
 * UNDERGROUND. Nine metres out at −21° of elevation is 3.3 m below the chest,
 * which on the colosseum floor is inside the ground: those bolts died at the
 * muzzle and were scored as neither landed nor answered. Every shooter here
 * stands at the player's own chest height and AIMS at a point on the torso
 * instead — four heights spanning 0.85 m, which is what puts pitch into the
 * bolt's arrival bearing the way a real firing line does.
 *
 * IT SAMPLED YAW AT 20° AND THE THING IT WAS MEASURING IS 17°. A bench whose
 * grid is coarser than the effect cannot resolve the effect. Sixty bearings
 * round a full circle is 6°, so a shoulder line that moves 17.5° moves this
 * bench by three samples a side and not by rounding.
 *
 * AND IT LEFT THE AUTO-GUARD CONE OPEN, which is the confound that made the
 * whole comparison read as noise. `CATCH.autoGuard` is 0.40 s of free cover
 * opened by any manual catch, `Bolts.update` falls through to it as
 * `entry.guard` the moment the directional zone declines, and EVERY SET HAS
 * ONE — so a stream tight enough for the cone to still be open is mostly
 * measuring a mechanic the three sets share. 36 frames between shots is
 * 0.60 s, and the bolt is answered about 0.15 s in, so the cone has shut
 * before the next round leaves the muzzle. `coneOpen` counts any round fired
 * while it had not, so the isolation is asserted rather than assumed.
 *
 * `landed` is health lost, which is the honest question — `GRADE_DAMAGE` gives
 * an answered bolt no damage at all, so a bolt that costs you hp is exactly a
 * bolt the guard did not answer. `far` is the furthest bearing off the aim
 * that was answered at all, which is the shoulder line read off the run rather
 * than off `GUARD.reach`.
 */
export async function rose(set, snap, { bolts = 60, dist = 9, gap = 36, level = 'geonosis',
  scanFrom = 92, scanTo = 126, scanStep = 2 } = {}) {
  const { world, p } = await bootPinned(set, snap, { level, mode: 'sandbox', extra: { allies: 0 } });
  const input = scriptedInput({ guard: true });
  const loose = pinScatter();
  try {
    const step = (n) => {
      for (let i = 0; i < n; i++) { world.update(STEP, input); world.enemies.length = 0; }
    };
    step(40);
    /* `deflects` is the shipped callback's own count and `turned` is the
     * per-ROUND verdict, and they are not the same number: one round can raise
     * `onDeflect` twice — the pair has two blade entries and a bolt met by one
     * of them can still be graded by the other — and a bolt can be met and
     * still cost health. So the round is classified once, by health, and the
     * three categories tile the sixty by construction. The first cut returned
     * the raw counter under the name `answered` and its own accounting
     * assertion went red at 61 of 60. */
    let deflects = 0;
    const onDeflect = world.bolts.onDeflect;
    world.bolts.onDeflect = (...a) => { deflects++; return onDeflect.apply(world.bolts, a); };
    /* THE AIM IS READ ONCE AND EVERY BEARING IS TAKEN OFF IT, so "in front"
     * means in front of the PLAYER — `_spinprobe.mjs` records the cost of
     * getting that backwards. */
    const aim = p.aimDir.clone().setY(0).normalize();
    /* Four points down the torso, spanning 0.85 m about the chest. A shooter
     * at chest height aiming at the belt puts the bolt's crossing point
     * BELOW the chest on the guard sphere, which is a rose bearing and is
     * exactly what a rose bench has to contain. */
    const AIM_AT = [-0.45, -0.15, 0.15, 0.40];
    let coneOpen = 0;
    /** One round from `yaw` radians off the player's own sightline. */
    const shot = (yaw, at) => {
      p.hp = p.maxHp; p.stamina = 100; p.force = p.maxForce;
      if ((p.boltCatch?.auto ?? 0) > 0) coneOpen++;
      const away = aim.clone().applyAxisAngle(UP, yaw);
      const from = p.chest.clone().addScaledVector(away, dist);
      const to = p.chest.clone(); to.y += at;
      const hp = p.hp, d0 = deflects;
      world.bolts.fire(from, to.sub(from).normalize(), { speed: 60, team: 1, damage: 10 });
      step(gap);
      if (p.hp < hp - 1e-6) return 'landed';
      return deflects === d0 ? 'missed' : 'turned';
    };

    /* ── (a) THE ROSE. Sixty bearings round the whole circle. */
    let landed = 0, missed = 0, turned = 0, far = 0;
    for (let i = 0; i < bolts; i++) {
      const yaw = -Math.PI + 2 * Math.PI * i / bolts;
      const r = shot(yaw, AIM_AT[i % AIM_AT.length]);
      if (r === 'landed') landed++;
      else if (r === 'missed') missed++;
      else { turned++; far = Math.max(far, Math.abs(yaw)); }
    }

    /**
     * ── (b) THE SHOULDER LINE, SCANNED.
     *
     * The rose above is 6° of grid and the thing it is measuring is 8.6°, so
     * on its own it can only ever say "about one sample". This walks one flank
     * in 2° steps and reports the LAST bearing that was answered, which is the
     * shoulder line read off the shipped `guardZoneAccepts` rather than off
     * `GUARD.reach` — the same distinction `_setfight.mjs`'s `measureOut`
     * makes between a set's reach and the constant it is written from.
     *
     * It is a scan and not a bisection on purpose: a bisection would assume
     * the predicate is monotone in the bearing, and the whole point of the
     * exercise is that two different refusals (`half` and `reach`) are live
     * at once and nobody had established which one was firing.
     *
     * The bolt aims at the CHEST here — `at` 0 — so the crossing point's rose
     * bearing is level and the only thing that can refuse it is the shoulder
     * line. That is what makes this a measurement of `reach` and not of the
     * two gates mixed together.
     */
    const scan = [];
    let shoulder = 0;
    for (let d = scanFrom; d <= scanTo + 1e-9; d += scanStep) {
      const r = shot(d / DEG, 0);
      scan.push(`${d}${r === 'turned' ? '+' : '-'}`);
      if (r === 'turned') shoulder = d;
    }
    return { set, fired: bolts, landed, turned, missed, coneOpen,
      far: +(far * DEG).toFixed(1), shoulder, scan: scan.join(' ') };
  } finally { loose(); world.unload?.(); }
}

/**
 * ── THE ONE STREAM IN THE BOLT PATH `_shared.mjs` CANNOT PIN ─────────────
 *
 * FOUND BY MEASURING, after this bench's own check was reported as straddling
 * its threshold: four runs of `saberforms` on unchanged code read the pair at
 * 14, 17, 14 and 14 of 60 against a bound set at 85% of the single blade's 20.
 * Two runs of this file standalone — one process each, nothing interleaved,
 * every module stream restored — read the pair at 14 and 16, with its 2° scan
 * starting `92+` in one and `92-` in the other, while `single` and `staff` came
 * back byte-identical both times. So it was never the suite's interleave and
 * never a stream `_shared.mjs` had missed.
 *
 * It is `Combat.gradeCaught`'s outgoing direction: a BLOCK scatters 0.55 about
 * the mirror and a caught throw jitters, and both draw from the bare global
 * `Math.random()` — the one generator in the tree that is not a module `rng`
 * and that `moduleSeed`, `register.mjs` and `restoreShared` therefore have no
 * purchase on at all. The pair is the arm that feels it because the pair is the
 * arm that ANSWERS the most: 37 bolts turned against the single blade's 31, and
 * every one of those is a scatter direction drawn from an unpinned stream, in
 * front of a player whose own health is the verdict.
 *
 * PROVED, three consecutive runs with the global replaced by a fixed sequence:
 * pair 14/60 and shoulder 106° every time, where the same code unpinned gave
 * 14–17 and 106–108. The single blade read 20/60 and the staff 18/60 either
 * way, which is why nothing had noticed.
 *
 * WHY IT IS PINNED HERE AND NOT FIXED AT SOURCE: `Combat.js` gains ZERO lines
 * in this feature — SABERFORMS.md says so and `saberforms: Saber.js and
 * Combat.js gained nothing at all` asserts it against the shipped file — and a
 * seedable scatter is a change to the game, not to the bench. This is the
 * bench stating the phase it measures in, which is the same thing
 * `_shared.mjs` does for the other thirteen streams.
 *
 * THE SWAP WINDOW CONTAINS NO `await`, WHICH IS THE WHOLE OF WHY IT IS SAFE.
 * `rose` awaits exactly once, at its boot, and everything after that is
 * synchronous to the return — so no other check can be running while the global
 * is borrowed, and §2.9's rule ("a suite that borrows a singleton must hand
 * back all of it") is kept by a `finally` that cannot be jumped over.
 */
function pinScatter(seed = 0x5CA77E5) {
  const was = Math.random;
  const rng = makeRng(seed);
  Math.random = rng;
  return () => { Math.random = was; };
}

/* ══════════════════════════════════════════════════════════════════════ */

const ENTRY = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (ENTRY) {
  const snap = await SH.snapshotShared();
  console.log('PACE — ten seconds of held-forward mashing, ground covered per second');
  for (const s of SETS) {
    const r = await pace(s, snap);
    console.log(`  ${s.padEnd(7)} ${r.mps.toFixed(3)} m/s over ${r.metres.toFixed(1)} m · ${r.strikes} strikes accepted`);
  }
  console.log('\nROSE — sixty bolts round the circle at 9 m, one at a time, guard held');
  for (const s of SETS) {
    const r = await rose(s, snap);
    console.log(`  ${s.padEnd(7)} ${r.landed}/${r.fired} landed · ${r.turned} turned · ${r.missed} never arrived`
      + ` · furthest bearing answered ${r.far}° · cone open on ${r.coneOpen}`);
    console.log(`          shoulder line, scanned at 2°: ${r.shoulder}°   ${r.scan}`);
  }
}
