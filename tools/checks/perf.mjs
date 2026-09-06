/**
 * BATTLEFRONT BORZ — the frame-time overlay and the quality auto-tune (V19 hole 2).
 *
 * `src/game/Perf.js` is the first thing in the project that can move a
 * quality tier on its own, so the policy is pinned here with synthetic frames
 * on a synthetic clock: down after two bad windows, never two steps inside
 * ten seconds, up only after twenty seconds of good frames, and no motion at
 * all on a p95 that sits exactly on a threshold. The overlay's copy line and
 * its twenty-deep log, the F3 binding and the absence of Math.random are the
 * rest.
 */
import { readFile } from 'node:fs/promises';
import { AutoTuner, Perf, TIERS, WINDOW_MS, DOWN_MS, UP_MS, STEP_GAP_MS, UP_HOLD_MS, LOG_KEY, LOG_KEEP,
  summaryLine, appendLog, band } from '../../src/game/Perf.js';
import { ACTIONS, defaultBindings, findConflicts } from '../../src/engine/Bindings.js';
import { Input } from '../../src/engine/Input.js';

const read = async (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/** Drive a tuner for `ms` of play at a constant frame time; return the steps taken. */
function drive(t, ms, frameMs, { from = 0, playing = true } = {}) {
  const steps = [];
  for (let now = from; now < from + ms; now += frameMs) {
    const r = t.feed(frameMs, now, playing);
    if (r) steps.push({ at: now - from, to: r });
  }
  return steps;
}

/** A fake store with the localStorage surface the log uses. */
function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

export async function run({ check, assert }) {
  check('perf: two bad windows step down, and the next step waits ten seconds', () => {
    const t = new AutoTuner('high');
    const steps = drive(t, 30000, 30); // p95 = 30 ms > 24, every window bad
    assert(steps.length >= 2, `no steps at all on a 30 ms frame: ${JSON.stringify(steps)}`);
    assert(steps[0].to === 'medium', `first step went to ${steps[0].to}, not medium`);
    // Two windows of 4 s: the first step lands as the second window closes.
    assert(steps[0].at >= 2 * WINDOW_MS - 40 && steps[0].at < 3 * WINDOW_MS,
      `stepped at ${steps[0].at} ms; two windows are ${2 * WINDOW_MS}`);
    for (let i = 1; i < steps.length; i++) {
      assert(steps[i].at - steps[i - 1].at >= STEP_GAP_MS,
        `steps ${i - 1}→${i} are ${steps[i].at - steps[i - 1].at} ms apart, under ${STEP_GAP_MS}`);
    }
    assert(t.tier === 'low', `after 30 s of 30 ms frames the tier is ${t.tier}, not low`);
    return `high → ${steps.map(s => s.to).join(' → ')} at ${steps.map(s => (s.at / 1000).toFixed(1) + 's').join(', ')}`;
  });

  check('perf: one bad window between good ones does not step', () => {
    const t = new AutoTuner('high');
    drive(t, WINDOW_MS + 20, 30);          // one bad window
    drive(t, WINDOW_MS * 2, 16, { from: WINDOW_MS + 20 }); // then fine
    assert(t.tier === 'high', `a single bad window moved the tier to ${t.tier}`);
    return 'one 30 ms window, then 16 ms: still high';
  });

  check('perf: stepping up takes twenty seconds of good frames, and not a window less', () => {
    const t = new AutoTuner('medium');
    const early = drive(t, UP_HOLD_MS - WINDOW_MS / 2, 8);
    assert(!early.length, `stepped up after ${early[0]?.at} ms, before ${UP_HOLD_MS}`);
    const late = drive(t, WINDOW_MS * 2, 8, { from: UP_HOLD_MS - WINDOW_MS / 2 });
    assert(late.length === 1 && late[0].to === 'high', `expected one step to high, got ${JSON.stringify(late)}`);
    const at = UP_HOLD_MS - WINDOW_MS / 2 + late[0].at;
    return `no step by ${(UP_HOLD_MS - WINDOW_MS / 2) / 1000} s, high at ${(at / 1000).toFixed(1)} s`;
  });

  check('perf: frames between 11 and 24 ms move nothing, and neither does a p95 ON either threshold', () => {
    for (const ms of [UP_MS, 16, DOWN_MS]) {
      const t = new AutoTuner('medium');
      const steps = drive(t, 120000, ms);
      assert(!steps.length, `a constant ${ms} ms frame stepped: ${JSON.stringify(steps)}`);
      assert(t.tier === 'medium', `tier moved to ${t.tier} at ${ms} ms`);
    }
    return `${UP_MS}, 16 and ${DOWN_MS} ms: two minutes each, medium throughout`;
  });

  check('perf: a machine that is bad at high and good at medium settles instead of bouncing', () => {
    // 30 ms at high, 8 ms at medium: the step up costs longer each time it is
    // taken back, so the bounces spread out and then stop within four minutes.
    const t = new AutoTuner('high');
    const cost = { high: 30, medium: 8 };
    let now = 0, ups = 0, downs = 0;
    const gaps = []; let lastUp = null;
    for (; now < 240000; now += cost[t.tier]) {
      const r = t.feed(cost[t.tier], now, true);
      if (r === 'high') { ups++; if (lastUp !== null) gaps.push(now - lastUp); lastUp = now; }
      if (r === 'medium') downs++;
    }
    assert(ups < 5, `${ups} steps up in four minutes: it is oscillating`);
    for (let i = 1; i < gaps.length; i++) assert(gaps[i] > gaps[i - 1], `the gap between bounces did not grow: ${gaps.join(', ')}`);
    assert(t.tier === 'medium', `ended on ${t.tier}`);
    return `${ups} up, ${downs} down, gaps ${gaps.map(g => (g / 1000).toFixed(0) + 's').join(' → ')}; ends medium`;
  });

  check('perf: a paused or loading frame is not measured, and the window starts again on play', () => {
    const t = new AutoTuner('high');
    drive(t, WINDOW_MS + 20, 30);                       // one bad window banked
    drive(t, 60000, 80, { playing: false, from: 5000 }); // a minute of "loading" at 80 ms
    assert(t.tier === 'high', `frames outside play stepped the tier to ${t.tier}`);
    const steps = drive(t, WINDOW_MS * 2 + 100, 30, { from: 70000 });
    assert(steps.length === 1, `after play resumed: ${JSON.stringify(steps)}`);
    return 'a minute of 80 ms frames while not playing: no step; two bad windows on resume: one';
  });

  check('perf: the summary line carries every field and the log keeps twenty', () => {
    const s = { level: 'The Station', deck: 'the Concourse', place: 'Cantina', quality: 'auto:high',
      mean: 12.345, p95: 23.9, calls: 812, tris: 1234567, stationMs: 0.42, bodies: 311, gpu: 'ANGLE (NVIDIA, RTX 3060)' };
    const line = summaryLine(s);
    for (const f of ['level=', 'deck=', 'place=', 'quality=auto:high', 'ms=12.3/23.9', 'calls=812', 'tris=1234567',
      'station=0.42', 'bodies=311', 'gpu=ANGLE_(NVIDIA,_RTX_3060)']) {
      assert(line.includes(f), `the line lacks ${f}: ${line}`);
    }
    assert(!/\n/.test(line), 'the line has a newline in it');
    const store = fakeStore();
    let list;
    for (let i = 0; i < 27; i++) list = appendLog(`${line} n=${i}`, store);
    assert(list.length === LOG_KEEP, `the log kept ${list.length}, not ${LOG_KEEP}`);
    assert(JSON.parse(store.getItem(LOG_KEY)).length === LOG_KEEP, 'the stored blob is not the kept list');
    assert(list[list.length - 1].endsWith('n=26') && list[0].endsWith('n=7'), 'the log did not drop the oldest');
    return `${line.length} chars; 27 appended, ${LOG_KEEP} kept, oldest dropped`;
  });

  check('perf: the live box samples the engine, the world and the station, and logs while up', () => {
    const store = fakeStore();
    const engine = { quality: 'medium', renderer: { info: { render: { calls: 77, triangles: 12000 } },
      getContext: () => null } };
    const applied = [];
    const notes = [];
    const perf = new Perf(engine, { applyTier: (q) => applied.push(q), notify: (t, s) => notes.push([t, s]), store, say: () => {} });
    const world = { level: { name: 'The Station' }, _station: { deck: 40 }, player: { position: { x: 0, y: 0, z: 0 } },
      _stationLife: { stepMs: 0.31 }, physics: { bodies: new Array(45) } };
    assert(perf.visible === false, 'the box starts visible');
    perf.toggle();
    let now = 0;
    for (let i = 0; i < 600; i++) { now += 16; perf.frame(now, { world, playing: true }); }
    const s = perf.last;
    assert(s && Math.abs(s.mean - 16) < 0.01 && Math.abs(s.p95 - 16) < 0.01, `mean/p95 ${s?.mean}/${s?.p95}, not 16`);
    assert(s.calls === 77 && s.tris === 12000, `draw ${s.calls}/${s.tris}`);
    assert(s.stationMs === 0.31 && s.bodies === 45, `station ${s.stationMs} bodies ${s.bodies}`);
    assert(s.deck === 'the Concourse', `deck read as ${s.deck}`);
    assert(s.quality === 'medium', `quality read as ${s.quality}`);
    assert(perf.el && /copy: perf level=/.test(perf.el.textContent), 'the box has no copy line');
    assert(perf.el.textContent.split('\n').length === 6, `the box is ${perf.el.textContent.split('\n').length} lines`);
    const logged = JSON.parse(store.getItem(LOG_KEY) || '[]');
    assert(logged.length >= 1 && logged.length <= 3, `${logged.length} lines logged over 9.6 s (every 5 s)`);
    assert(!applied.length && !notes.length, 'the box alone moved a tier or said something');
    // …and off 'auto' nothing at all changes, however bad the frames
    for (let i = 0; i < 1200; i++) { now += 40; perf.frame(now, { world, playing: true }); }
    assert(!applied.length, `48 s of 40 ms frames applied ${applied.join(',')} with auto off`);
    perf.setAuto(true);
    assert(applied.length === 1 && applied[0] === perf.tier, 'switching auto on did not apply the tuner\'s tier');
    for (let i = 0; i < 600; i++) { now += 40; perf.frame(now, { world, playing: true }); }
    assert(applied.includes('medium') && applied.length >= 2, `auto on, 40 ms frames: applied ${applied.join(',')}`);
    assert(notes.length >= 1 && /QUALITY MEDIUM/.test(notes[0][0]) && /auto/.test(notes[0][1]), `banner said ${JSON.stringify(notes[0])}`);
    assert(store.getItem('saber.perf.tier.v1') === applied[applied.length - 1], 'the chosen tier is not remembered');
    perf.toggle();
    assert(perf.el.hidden === true, 'toggling off did not hide the box');
    return `${s.mean.toFixed(1)} ms, ${s.calls} calls, ${s.deck}; ${logged.length} logged; auto: ${applied.join(' → ')}`;
  });

  check('perf: the overlay key is an action, bound to F3, read by main.js, and free of conflicts', async () => {
    const a = ACTIONS.find(x => x.id === 'perf');
    assert(a, 'no `perf` action in ACTIONS');
    const b = defaultBindings();
    assert(b.perf?.includes('F3'), `perf defaults to ${b.perf?.join('+')}, not F3`);
    assert(a.pad, 'perf has no pad chord');
    const c = findConflicts(b).filter(x => JSON.stringify(x).includes('perf'));
    assert(!c.length, `perf collides: ${JSON.stringify(c)}`);
    const main = await read('src/main.js');
    assert(/actHit\(\s*'perf'\s*\)/.test(main), 'main.js never asks actHit(\'perf\')');
    assert(/perf\.frame\(now/.test(main) && /perf\.toggle\(\)/.test(main), 'main.js does not drive the box');
    const input = await read('src/engine/Input.js');
    assert(!/'F3'/.test(input), 'Input passes F3 through to the browser');
    // and the key reaches the action through a real Input
    const i = new Input(globalThis.document.createElement('canvas'));
    i.keys.add('F3'); i.pressed.add('F3');
    assert(i.actHit('perf'), 'F3 pressed does not fire perf');
    return `perf = ${b.perf.join('+')} / ${a.pad}; read in main.js`;
  });

  check('perf: quality \'auto\' is the first card, and the engine falls to a real row under it', async () => {
    const menu = await read('src/ui/Menu.js');
    const i = menu.indexOf("['auto', 'Auto'"), j = menu.indexOf("['low', 'Performance'");
    assert(i > 0 && j > i, 'the auto card is not first in the quality row');
    const { QUALITY } = await import('../../src/engine/Engine.js');
    assert(!QUALITY.auto, "'auto' became a row of QUALITY; the tuner walks the four real rows");
    assert(TIERS.every(t => QUALITY[t]), `TIERS names a tier QUALITY lacks: ${TIERS.join(',')}`);
    const main = await read('src/main.js');
    assert(/QUALITY\[engine\.quality\]/.test(main), 'qualityBloom does not read the live tier under auto');
    const world = await read('src/game/World.js');
    assert(/QUALITY\[this\.engine\?\.quality\]/.test(world), 'World does not follow the engine\'s tier under auto');
    return "auto first; QUALITY has no 'auto' row; bloom, grass and cloth follow engine.quality";
  });

  check('perf: no Math.random anywhere in Perf.js, and the band is a plain sorted p95', async () => {
    const src = await read('src/game/Perf.js');
    assert(!/Math\.random/.test(src), 'Perf.js reaches for Math.random');
    const b = band([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    assert(b.p95 === 100 && Math.abs(b.mean - 14.5) < 1e-9, `band ${JSON.stringify(b)}`);
    return 'no Math.random; p95 of 1..9,100 is 100, mean 14.5';
  });
}
