/**
 * THE MANDALORIAN TESTS YOUR SABER — V18 cool 19.
 *
 * *"The Mandalorian tests your saber against a remote in the Forge."* Bo
 * Vhett (`Vendors` 'armourer', `{helm, mando}`) stands behind #10's counter
 * and sells plate. Walk up to his desk with the BLADE LIT and press the key:
 * instead of the shop, a training remote lifts off his bench — the Dojo's own
 * (`Dojo.buildRemote`), a sphere with an emissive band and five eyes — and
 * hangs in front of you for `TEST.secs`, firing `TEST.shots` slow bolts
 * through the game's real pool (`world.bolts.fire`, team 1, so the blade's
 * own contact path in `World` grades them and the auto-guard catches what
 * you get in the way of). Bo calls the count after every shot — "four of
 * six" — and reads you a line at the end. The result is written to the
 * station fold (`StationSave.forgeTest: { best, last, day, n }`) and shown on
 * a plaque on the counter, so the number you want to beat is standing there
 * the next time you walk in.
 *
 * With the blade OFF the press is the shop's, as before: one hook line in
 * `Station.stationKey`'s counter branch, and it answers false unless the blade
 * is lit or a test is running (when the press stops it).
 *
 * Nothing rolls. The remote's drift is sinusoids on the test clock.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { buildRemote } from './Dojo.js';
import { signPanel } from './StationKit.js';
import { forgeTest, setForgeTest, stationDay } from './StationSave.js';
import { note } from './Journal.js';
import { clamp, damp } from '../engine/MathUtil.js';

export const TEST = { secs: 45, shots: 8, first: 3.0, speed: 20, damage: 3, hover: 4.2, high: 1.45 };
/** The Forge's place and its counter id. */
const FORGE = 10;
const COUNTER = 'armourer';

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] ?? String(n);

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════════ */
/*  DRESS — the plaque on the counter                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

function plaqueRows() {
  const f = forgeTest();
  if (!f) return ['REMOTE TEST', 'no blade tested yet', 'lit blade at the desk'];
  return ['REMOTE TEST', { t: `best ${f.best} of ${f.n}`, lit: true }, `last ${f.last} of ${f.n} · day ${f.day}`];
}

export function dressRemoteTest(world, st, M) {
  if (!st || !world?.scene) return null;
  const rec = st.places?.get(FORGE);
  const desk = st.counters?.get(FORGE)?.[0];
  if (!rec || !desk?.front) return null;
  const R = { plaque: null, geo: null, test: null, tests: 0, last: null, keeperName: 'BO VHETT' };
  const k = st.keepers?.find((x) => x.id === COUNTER);
  if (k?.who?.name) R.keeperName = String(k.who.name).toUpperCase();
  /* The desk's frame: `front` is a point out in front of `at`. */
  const nx = desk.front.x - desk.at.x, nz = desk.front.z - desk.at.z;
  const nl = Math.hypot(nx, nz) || 1;
  const ux = nx / nl, uz = nz / nl;
  const tx = uz, tz = -ux;
  const panel = signPanel(plaqueRows(), { px: 256, pyx: 128, name: 'forge-plaque', bg: '#12100c', head1: '#ffd9a0', ink2: '#b89468', lit1: '#ffe6bd' });
  const geo = new THREE.PlaneGeometry(0.62, 0.31);
  const m = new THREE.Mesh(geo, panel.material);
  const off = Math.max(0.6, desk.w / 2 - 0.55);
  m.position.set(desk.at.x + tx * off + ux * 0.08, desk.at.y + (desk.h || 1.08) + 0.17, desk.at.z + tz * off + uz * 0.08);
  m.rotation.y = Math.atan2(ux, uz);
  m.rotation.x = -0.18;
  m.name = 'forge-plaque';
  rec.group.add(m);
  R.plaque = panel; R.geo = geo; R.mesh = m;
  R.desk = desk;
  R.state = () => remoteTestState(world);
  world._remoteTest = R;
  return R;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE KEY                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

/** True when the press was the test's: a lit blade at Bo's desk starts one; a
 *  press during one stops it. A dark blade leaves the press to the shop. */
export function remoteTestKey(world) {
  const R = world?._remoteTest;
  const p = world?.player;
  if (!R || !p) return false;
  if (R.test) { endTest(world, R, 'stopped'); return true; }
  if (!p.saber?.lit || p.alive === false) return false;
  return startTest(world, R);
}

function startTest(world, R) {
  const p = world.player;
  if (!world.bolts?.fire) return false;
  const built = buildRemote({ scale: 1.5 });
  const g = built.group;
  g.name = 'forge-remote';
  const st = world._station;
  const keeper = st?.keepers?.find((x) => x.id === COUNTER)?.body;
  const from = keeper?.position || R.desk.behind || R.desk.at;
  g.position.set(from.x, from.y + 1.3, from.z);
  world.scene.add(g);
  /* Where it hangs: in front of the player, at the height of the chest and a
   * little above, so the bolts come at the guard. */
  const f = p.facing || 0;
  const hover = new THREE.Vector3(p.position.x + Math.sin(f) * TEST.hover, p.position.y + TEST.high, p.position.z + Math.cos(f) * TEST.hover);
  const proxy = {
    remote: true, team: 1, dead: false, alive: true, isLocal: false, score: 0,
    position: g.position, stationName: 'training remote', noAmbientHarm: true,
  };
  R.test = {
    t: 0, g, built, hover, proxy, shots: 0, judged: 0, met: 0, bolts: [], done: false,
    nextAt: TEST.first, gap: (TEST.secs - TEST.first - 6) / Math.max(1, TEST.shots - 1),
  };
  world.notify?.(R.keeperName, `${word(TEST.shots)} shots, slow. Meet every one`);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

export function stepRemoteTest(world, dt) {
  const R = world?._remoteTest;
  const T = R?.test;
  if (!T || !(dt > 0)) return;
  const p = world.player;
  if (!p || p.alive === false) { endTest(world, R, 'the blade is down'); return; }
  T.t += dt;
  /* The remote: up off the bench and out to its hover, then a drift. */
  const g = T.g;
  const k = clamp(T.t / 2.2, 0, 1);
  const hx = T.hover.x + Math.sin(T.t * 0.9) * 0.55, hz = T.hover.z + Math.cos(T.t * 0.7) * 0.45;
  const hy = T.hover.y + Math.sin(T.t * 1.3) * 0.18;
  g.position.x = damp(g.position.x, hx, 2.5 + k * 2, dt);
  g.position.y = damp(g.position.y, hy, 2.5 + k * 2, dt);
  g.position.z = damp(g.position.z, hz, 2.5 + k * 2, dt);
  g.rotation.y += dt * 1.7;
  g.rotation.x = Math.sin(T.t * 1.1) * 0.25;
  const halo = T.built.halo;
  if (halo) halo.intensity = 1.2 + 0.8 * Math.max(0, Math.sin(T.t * 9));

  /* Fire. */
  if (T.shots < TEST.shots && T.t >= T.nextAt && k >= 1) {
    _v.set(p.position.x, p.position.y + 1.25, p.position.z);
    _d.subVectors(_v, g.position);
    const dist = _d.length() || 1;
    _d.multiplyScalar(1 / dist);
    const b = world.bolts.fire(g.position, _d, {
      speed: TEST.speed, team: 1, owner: T.proxy, damage: TEST.damage, color: 0xffc040, big: true,
      life: Math.max(2.5, dist / TEST.speed + 1.5),
    });
    if (b) {
      T.bolts.push({ b, id: T.shots, met: false, judged: false, life0: b.life });
      T.shots++;
      T.nextAt = TEST.first + T.shots * T.gap;
    }
  }
  /* Judge. A bolt the blade has met is `deflected` (World's contact path)
   * or `held` (the catch window). One that went out any other way missed. */
  for (const e of T.bolts) {
    if (e.judged) continue;
    const b = e.b;
    if (b.deflected || b.held || (b.deflector && b.deflector === p)) e.met = true;
    if (!b.active || e.met) {
      e.judged = true;
      T.judged++;
      if (e.met) T.met++;
      world.notify?.(R.keeperName, `${word(T.met)} of ${word(T.judged)}`);
    }
  }
  if ((T.shots >= TEST.shots && T.judged >= T.shots) || T.t >= TEST.secs) endTest(world, R, 'done');
}

function rating(met, n) {
  const r = n > 0 ? met / n : 0;
  if (r >= 1) return 'every one. Beskar-grade. I would stand behind that blade';
  if (r >= 0.75) return 'a blade that would do. Not a helmet though';
  if (r >= 0.5) return 'half. You flinch on the ones from the left';
  if (r > 0) return 'buy a helmet. I sell them';
  return 'not one. Keep it lit next time';
}

function endTest(world, R, why) {
  const T = R.test;
  if (!T) return;
  R.test = null;
  T.done = true;
  T.g.parent?.remove(T.g);
  T.g.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  /* Anything still in the air is the remote's no longer. */
  for (const e of T.bolts) if (e.b.active && !e.b.held && !e.b.deflected) e.b.active = false;
  const met = T.met, n = TEST.shots;
  const day = stationDay();
  const prev = forgeTest();
  const rec = { best: Math.max(prev?.best | 0, met), last: met, day, n, stopped: why !== 'done' };
  try { setForgeTest(rec); } catch { /* the fold refused; the plaque still says it */ }
  note('test', `the Forge's remote — ${met} of ${n} met, ${rating(met, n)}${why !== 'done' ? ` (${why})` : ''}`, world); // V19: the journal
  R.plaque?.draw(plaqueRows());
  R.tests++;
  R.last = { met, n, why, t: T.t, fired: T.shots };
  world.notify?.(R.keeperName, why === 'done' ? `${word(met)} of ${word(n)} — ${rating(met, n)}` : `${why}. ${word(met)} of ${word(T.judged)} met`);
}

/** For the HUD and the checks — `world._remoteTest.state()`. */
function remoteTestState(world) {
  const R = world?._remoteTest;
  if (!R) return null;
  const T = R.test;
  return {
    running: !!T, t: T ? T.t : 0, fired: T ? T.shots : 0, judged: T ? T.judged : 0, met: T ? T.met : 0,
    remote: T ? { x: T.g.position.x, y: T.g.position.y, z: T.g.position.z } : null,
    tests: R.tests, last: R.last, saved: forgeTest(),
  };
}

export function undressRemoteTest(world) {
  const R = world?._remoteTest;
  if (!R) return;
  if (R.test) {
    const T = R.test; R.test = null;
    T.g.parent?.remove(T.g);
    T.g.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  R.geo?.dispose?.();
  R.plaque?.texture?.dispose?.();
  world._remoteTest = null;
}
