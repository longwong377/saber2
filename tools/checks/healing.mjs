/**
 * THE WARD, SEEN — and the beds under the station (V18 holes 5 and 7).
 *
 * Driven through the shipped station on deck 48 with two real men checked in
 * off a real roll, and through the shipped audio engine on an offline context
 * so the beds are measured on the gain nodes they actually command.
 *
 *   THE MEDIC VISITS BOTH within sixty seconds of the ward being dressed.
 *   THE MONITOR CHANGES between two frames — a trace that does not move is a
 *     picture of a monitor.
 *   A MAN WALKS OUT when his tank goes dark, and the ward's count falls.
 *   THE BED UNDER THE CANTINA is not the bed under the ring, and the crossfade
 *     between them lands inside two seconds.
 *   THE PA says twenty distinct kinds of thing over a day and never twice
 *     inside ninety seconds.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import * as Company from '../../src/game/Company.js';
import * as Medbay from '../../src/game/Medbay.js';
import { ARMIES, CommandRoster } from '../../src/game/Command.js';
import { clearStation } from '../../src/game/StationSave.js';
import { PLACE } from '../../src/game/StationPlan.js';
import * as Healing from '../../src/game/Healing.js';
import * as Sound from '../../src/game/StationSound.js';
import { audio } from '../../src/engine/Audio.js';
import { OfflineCtx } from './_offline-audio.mjs';

const KEY = 'saber.company.v1';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function withCleanStoreAsync(fn) {
  const had = localStorage.getItem(KEY);
  const hadStation = localStorage.getItem('saber.station.v1');
  localStorage.removeItem(KEY);
  clearStation();
  try { return await fn(); }
  finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    clearStation();
    if (hadStation != null) localStorage.setItem('saber.station.v1', hadStation);
  }
}

async function station(deck = 48) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

const hurtBody = (frac, max = 100) => ({ hp: max * frac, maxHp: max, dead: false });

/** A 2-D context that remembers what was drawn on it. */
function recorder() {
  const log = [];
  const ctx = { log, measureText: () => ({ width: 0 }) };
  for (const k of ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'save', 'restore'])
    ctx[k] = (...a) => { log.push(k + ':' + a.map((v) => (typeof v === 'number' ? v.toFixed(1) : String(v))).join(',')); };
  ctx.fillText = (s, x, y) => { log.push(`fillText:${s},${x},${y}`); };
  for (const k of ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'textAlign']) Object.defineProperty(ctx, k, { set(v) { log.push(`${k}=${v}`); }, get() { return ''; } });
  return ctx;
}

/** The engine on an offline context. Every own property goes back after. */
function bootAudio() {
  const prev = globalThis.AudioContext;
  let ctx = null;
  globalThis.AudioContext = function () { ctx = new OfflineCtx(48000); return ctx; };
  const was = { ...audio };
  audio.ctx = null; audio.ready = false; audio._lastWake = -1e9;
  try { audio.init(); } finally { globalThis.AudioContext = prev; }
  return { ctx, was };
}
function restoreAudio(was) {
  for (const k of Object.keys(audio)) delete audio[k];
  Object.assign(audio, was);
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  check('healing: two men in the tanks — the medic visits both inside 60 s, the monitor moves, one walks out when healed',
    () => withCleanStoreAsync(async () => {
      const roster = new CommandRoster(ARMIES.republic);
      for (let i = 0; i < 2; i++) roster.enlist(ARMIES.republic.tiers[0].type);
      const [a, b] = roster.all;
      a.body = hurtBody(0.35); b.body = hurtBody(0.20);
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
      const admitted = Medbay.checkIn('republic');
      assert(admitted.admitted.length === 2, `${admitted.admitted.length} admitted`);

      const { world, idle } = await station(48);
      try {
        const H = world._healing;
        assert(H, 'the ward was not dressed on deck 48');
        assert(H.medic && world.enemies.includes(H.medic), 'there is no medic body in the ward');
        assert(H.monitors.length === Medbay.TANKS && H.bubbles.length === Medbay.TANKS,
          `${H.monitors.length} monitors and ${H.bubbles.length} bubble columns for ${Medbay.TANKS} tanks`);
        /* The register is read on the first step: two tanks lit. */
        world.update(1 / 60, idle);
        assert(Healing.wardCount(world) === 2, `the ward counts ${Healing.wardCount(world)} with two in the tanks`);
        const lit = H.bubbles.filter((c) => c.group.visible).length;
        assert(lit === 2, `${lit} tanks bubbling with two occupied`);

        /* THE MONITOR: paint on a recorder at two moments and compare. */
        const litMon = H.monitors.find((m) => H.tanks[m.tank]);
        assert(litMon, 'no monitor over an occupied tank');
        const r1 = recorder();
        litMon.canvas.getContext = () => r1;
        H.monitorIn = 0;
        world.update(1 / 60, idle);
        const frame1 = r1.log.slice();
        assert(frame1.length > 50, `the monitor painted ${frame1.length} ops — that is not a trace`);
        assert(frame1.some((l) => /bpm/.test(l)), 'the monitor prints no heart rate');
        const r2 = recorder();
        litMon.canvas.getContext = () => r2;
        for (let i = 0; i < 12; i++) world.update(1 / 60, idle);
        const frame2 = r2.log.slice();
        let diff = 0;
        for (let i = 0; i < Math.max(frame1.length, frame2.length); i++) if (frame1[i] !== frame2[i]) diff++;
        assert(diff > 20, `the trace moved on ${diff} ops between frames — a still picture of a monitor`);

        /* THE MEDIC'S ROUND: sixty seconds, both tanks visited. */
        const tanksLit = [];
        for (let i = 0; i < Medbay.TANKS; i++) if (H.tanks[i]) tanksLit.push(i);
        let visitedBoth = -1;
        for (let s = 0; s < 60 * 10; s++) {
          world.update(0.1, idle);
          const seen = new Set(H.visits.map((v) => v.tank));
          if (tanksLit.every((i) => seen.has(i))) { visitedBoth = (s + 1) / 10; break; }
        }
        assert(visitedBoth > 0, `after 60 s the medic had visited tanks ${[...new Set(H.visits.map((v) => v.tank))].join(',') || 'none'} of ${tanksLit.join(',')}`);
        const medicMoved = Math.hypot(H.medic.position.x - H.counter.x, H.medic.position.z - H.counter.z);
        assert(medicMoved > 1, `the medic is ${medicMoved.toFixed(2)} m from the counter after the round`);

        /* ONE HEALED: six hours of bacta for the first man, his tank goes dark,
         * and a body walks out to the ring. */
        const first = admitted.admitted[0];
        Medbay.discharge('republic', first);
        let spawned = null, gone = -1;
        for (let s = 0; s < 90 * 10; s++) {
          world.update(0.1, idle);
          if (!spawned && H.walkers.length) spawned = { name: H.walkers[0].name, at: H.walkers[0].body.position.clone() };
          if (H.walkedOut.length) { gone = (s + 1) / 10; break; }
        }
        assert(spawned, 'no patient stood up when his tank went dark');
        assert(gone > 0, `the patient never reached the ring (walkers still ${H.walkers.length})`);
        const door = PLACE.get(44).door;
        const out = Math.hypot(spawned.at.x - door[0], spawned.at.z - door[1]);
        assert(out > 2, 'the patient appeared at the door and not at his tank');
        assert(Healing.wardCount(world) === 1, `the ward still counts ${Healing.wardCount(world)} after one walked out`);
        return `2 lit, 2 bubbling, monitor ${frame1.length} ops and ${diff} moved; medic visited both by ${visitedBoth.toFixed(1)} s; `
          + `${spawned.name} stood ${out.toFixed(1)} m from the door and was out in ${gone.toFixed(1)} s; count 2 → 1`;
      } finally {
        world.dispose?.();
      }
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('stationsound: the cantina is not the ring — beds crossfade on their gain nodes inside 2 s, the tram falls off with distance',
    async () => {
      const { ctx, was } = bootAudio();
      let world = null;
      try {
        const st0 = await station(40);
        world = st0.world;
        const idle = st0.idle;
        const S = world._stationSound;
        assert(S && S.built, 'the station sound was not dressed on deck 40');
        const cantina = PLACE.get(14);
        const p = world.player.position;
        /* ONE METRE FROM THE CANTINA'S CENTRE. */
        p.x = cantina.x + Math.sin(cantina.yaw) * 1; p.z = cantina.z + Math.cos(cantina.yaw) * 1;
        world.update(1 / 60, idle);
        const L1 = { ...Sound.bedLevels(world) };
        assert(L1.cantina === 1, `in the cantina the bed is ${JSON.stringify(L1)}`);
        /* THREE SECONDS OF AUDIO CLOCK, so the cantina's fade-in has landed
         * before the fade-out is commanded — an offline clock only moves when
         * it is told to. */
        ctx.currentTime += 3;
        const t1 = ctx.currentTime;
        assert(S.beds.cantina.gain.gain.at(t1) > 0.95, `the cantina bed reached ${S.beds.cantina.gain.gain.at(t1).toFixed(3)} in 3 s`);
        /* OUT ON THE RING: 12 m past the door, radially. */
        const d = cantina.door;
        const r = Math.hypot(d[0], d[1]);
        const k = (r + 12) / r;
        p.x = d[0] * k; p.z = d[1] * k;
        world.update(1 / 60, idle);
        const L2 = { ...Sound.bedLevels(world) };
        assert(L2.ring === 1 && L2.cantina === 0, `on the ring the bed is ${JSON.stringify(L2)}`);
        const gC = S.beds.cantina.gain.gain, gR = S.beds.ring.gain.gain;
        assert(gC.last('tgt') === 0 && gR.last('tgt') === 1, 'the gain nodes were not commanded');
        const cAt2 = gC.at(t1 + 2), rAt2 = gR.at(t1 + 2);
        assert(cAt2 < 0.05 && rAt2 > 0.95, `2 s after the step the cantina sits at ${cAt2.toFixed(3)} and the ring at ${rAt2.toFixed(3)}`);
        const cAt05 = gC.at(t1 + 0.5);
        assert(cAt05 > 0.2 && cAt05 < 0.8, `half a second in the cantina is at ${cAt05.toFixed(2)} — that is a switch, not a crossfade`);
        /* THE TRAM: a car near and a car far. */
        const life = world._stationLife;
        const THREE = await import('three');
        const car = new THREE.Object3D();
        world.scene.add(car);
        car.position.set(p.x + 5, 0, p.z);
        life.tram.car = car;
        Sound.stepStationSound(world, world._station, 1 / 60);
        const near = S.tram.at;
        car.position.set(p.x + 90, 0, p.z);
        Sound.stepStationSound(world, world._station, 1 / 60);
        const far = S.tram.at;
        life.tram.car = null;
        world.scene.remove(car);
        assert(near > 0.1 && far < near * 0.1, `the tram at 5 m is ${near.toFixed(3)} and at 90 m ${far.toFixed(3)}`);
        return `cantina→ring: cantina ${cAt05.toFixed(2)} at 0.5 s, ${cAt2.toFixed(3)} at 2 s; ring ${rAt2.toFixed(3)} at 2 s; `
          + `tram ${near.toFixed(3)} at 5 m, ${far.toFixed(4)} at 90 m; ${Object.keys(S.beds).length} beds on ${S.started.length} sources`;
      } finally {
        world?.dispose?.();
        restoreAudio(was);
      }
    });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('stationsound: the PA says twenty kinds of thing over a day, never two inside 90 s, chimed, spoken and read',
    async () => {
      const realRadio = audio.radio;
      const realShape = audio.shape;
      const { world, idle } = await station(40);
      const spoken = [], banners = [];
      let chimes = 0;
      try {
        const st = world._station;
        audio.radio = (spec, text) => { spoken.push(String(text || '')); return String(text || ''); };
        audio.shape = () => { chimes++; return true; };
        const notify = world.notify?.bind(world);
        world.notify = (a, b) => { banners.push(`${a} — ${b}`); notify?.(a, b); };
        const { tickStationClock } = await import('../../src/game/Station.js');
        const S = world._stationSound;
        S.paLog.length = 0;
        st.pa = null;
        /* ONE STATION DAY, in one-second frames of the shipped step. */
        const frames = 24 * 120;
        for (let i = 0; i < frames; i++) {
          tickStationClock(world, 1);
          Sound.stepStationSound(world, st, 1);
          Sound.stepPA(world, st, 1);
        }
        const log = S.paLog;
        assert(log.length >= 20, `${log.length} calls in a day`);
        const kinds = new Set(log.map((l) => l.kind));
        assert(kinds.size >= 20, `${kinds.size} distinct kinds over a day: ${[...kinds].join(',')}`);
        let minGap = Infinity;
        for (let i = 1; i < log.length; i++) minGap = Math.min(minGap, log[i].t - log[i - 1].t);
        assert(minGap >= 90, `two calls ${minGap} s apart`);
        assert(spoken.length === log.length && banners.length >= log.length, `${spoken.length} spoken, ${banners.length} read of ${log.length}`);
        assert(chimes === log.length, `${chimes} chimes for ${log.length} calls`);
        assert(Sound.PA_KINDS.length >= 20, `${Sound.PA_KINDS.length} kinds in the rota`);
        const wanted = ['arrival', 'departure', 'lostchild', 'weather', 'market', 'vigil', 'lightsout'];
        const missing = wanted.filter((k) => !kinds.has(k));
        assert(!missing.length, `the day never said: ${missing.join(', ')}`);
        const sample = [log[0].line, log[3].line], calls = log.length;
        /* AND THE HOOK: the shipped loop reaches it. */
        st.pa = null; S.paLog.length = 0;
        st.hour += 0.8; world.update(1 / 60, idle);
        st.hour += 0.8; world.update(1 / 60, idle);
        assert(st.pa && st.pa.calls >= 1 && st.pa.kind, 'stepStation did not reach the PA');
        return `${calls} calls, ${kinds.size} kinds, min gap ${minGap} s; e.g. "${sample[0]}" / "${sample[1]}"`;
      } finally {
        audio.radio = realRadio;
        audio.shape = realShape;
        world.dispose?.();
      }
    });
}
